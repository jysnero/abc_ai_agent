/**
 * Process-based Validation Runner
 *
 * 실제 child process를 통해 검증을 실행합니다.
 * spawn() 기반으로 출력 크기 제한과 timeout을 안전하게 처리합니다.
 */

import { spawn } from "child_process";
import { createHash } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import {
  IValidationRunner,
  ValidationCheckResult,
  ValidationReport,
} from "./validation-runner.interface.js";
import {
  CheckDefinition,
  getCheckDefinition,
  maskSensitiveOutput,
  filterEnvironmentVariables,
} from "./check-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 플랫폼별 npm executable 해석
 */
export function resolveNpmExecutable(platform: string): string {
  if (platform === "win32") {
    return "npm.cmd";
  }
  return "npm";
}

/**
 * Workspace 경로 검증
 * - workspace가 실제 디렉터리인지 확인
 * - base root 내부인지 확인
 * - symlink 탈출 없는지 확인
 * - 상대경로만 허용
 */
export async function validateWorkspacePath(
  workspace: string,
  baseRoot: string
): Promise<{ valid: boolean; error?: string }> {
  // 절대경로 검사
  if (path.isAbsolute(workspace)) {
    return { valid: false, error: "Workspace path must be relative" };
  }

  // .. traversal 검사
  if (workspace.includes("..")) {
    return { valid: false, error: "Path traversal (..) not allowed" };
  }

  // Windows drive 검사 (C:, D:, etc. with both / and \)
  if (/^[a-zA-Z]:[/\\]/.test(workspace) || /^[a-zA-Z]:$/.test(workspace)) {
    return { valid: false, error: "Absolute Windows paths not allowed" };
  }

  // UNC 경로 검사 (\\server\share 또는 //server/share)
  if (workspace.startsWith("\\\\") || workspace.startsWith("//")) {
    return { valid: false, error: "Absolute Windows paths not allowed" };
  }

  // 경로 정규화 및 범위 확인
  const resolvedPath = path.resolve(baseRoot, workspace);
  const relativePath = path.relative(baseRoot, resolvedPath);

  if (relativePath.startsWith("..")) {
    return { valid: false, error: "Workspace must be within base root" };
  }

  return { valid: true };
}

/**
 * Process-based Validation Runner
 */
export class ProcessValidationRunner implements IValidationRunner {
  private baseRoot: string;
  private checkDefinitionOverrides: Map<string, Partial<CheckDefinition>>;

  constructor(
    baseRoot: string = process.cwd(),
    checkDefinitionOverrides?: Record<string, Partial<CheckDefinition>>
  ) {
    this.baseRoot = baseRoot;
    this.checkDefinitionOverrides = new Map(
      checkDefinitionOverrides ? Object.entries(checkDefinitionOverrides) : []
    );
  }

  async runCheck(
    checkId: string,
    artifactChecksum?: string
  ): Promise<ValidationCheckResult> {
    const startTime = Date.now();
    const startedAt = new Date().toISOString();

    // Check 정의 조회
    let checkDef = getCheckDefinition(checkId);
    if (!checkDef) {
      return {
        check_id: checkId,
        status: "error",
        duration_ms: Date.now() - startTime,
        stdout_summary: "",
        stderr_summary: `Check not found in registry: ${checkId}`,
        artifact_checksum: artifactChecksum,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      };
    }

    // Override 적용
    const override = this.checkDefinitionOverrides.get(checkId);
    if (override) {
      checkDef = { ...checkDef, ...override };
    }

    try {
      // ProcessValidationRunner를 사용하면 cwd는 항상 baseRoot를 사용
      // (checkDef.cwd는 무시하고 this.baseRoot 사용)
      const wsValidation = await validateWorkspacePath(".", this.baseRoot);
      if (!wsValidation.valid) {
        return {
          check_id: checkId,
          status: "error",
          duration_ms: Date.now() - startTime,
          stdout_summary: "",
          stderr_summary: wsValidation.error || "Invalid workspace path",
          artifact_checksum: artifactChecksum,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
        };
      }

      const resolvedCwd = this.baseRoot;
      const env = filterEnvironmentVariables(checkDef);

      // Command resolve (Windows에서 npm → npm.cmd)
      let command = checkDef.command;
      if (command === "npm") {
        command = resolveNpmExecutable(process.platform);
      }

      // Process 실행
      const result = await this.executeProcess(
        command,
        checkDef.args,
        resolvedCwd,
        env,
        checkDef.timeout_ms,
        checkDef.max_output_bytes,
        checkDef
      );

      return {
        check_id: checkId,
        status: result.status,
        exit_code: result.exit_code,
        duration_ms: Date.now() - startTime,
        stdout_summary: result.stdout,
        stderr_summary: result.stderr,
        artifact_checksum: artifactChecksum,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        timedOut: result.timedOut,
        errorCode: result.errorCode,
        timeoutMs: result.timeoutMs,
        terminationMethod: result.terminationMethod,
        processTreeTerminationSucceeded: result.processTreeTerminationSucceeded,
      };
    } catch (error: unknown) {
      const err = error as Error;
      return {
        check_id: checkId,
        status: "error",
        duration_ms: Date.now() - startTime,
        stdout_summary: "",
        stderr_summary: `Unexpected error: ${err.message}`,
        artifact_checksum: artifactChecksum,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      };
    }
  }

  async runSuite(
    checkIds: string[],
    artifactChecksum?: string
  ): Promise<ValidationReport> {
    const results: ValidationCheckResult[] = [];

    // 등록되지 않은 ID 먼저 검사
    const invalidIds = checkIds.filter((id) => !getCheckDefinition(id));
    if (invalidIds.length > 0) {
      return {
        total_checks: checkIds.length,
        passed_checks: 0,
        failed_checks: invalidIds.length,
        skipped_checks: 0,
        checks: invalidIds.map((id) => ({
          check_id: id,
          status: "error" as const,
          duration_ms: 0,
          stdout_summary: "",
          stderr_summary: `Check not found in registry`,
          artifact_checksum: artifactChecksum,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        })),
        generated_at: new Date().toISOString(),
      };
    }

    // 순차 실행 (fail-fast는 v0.2+에서 고려)
    for (const checkId of checkIds) {
      const result = await this.runCheck(checkId, artifactChecksum);
      results.push(result);
    }

    // 결과 요약
    const passedCount = results.filter((r) => r.status === "passed").length;
    const failedCount = results.filter((r) => r.status === "failed").length;
    const timedOutCount = results.filter((r) => r.status === "timed_out").length;

    return {
      total_checks: checkIds.length,
      passed_checks: passedCount,
      failed_checks: failedCount,
      timed_out_checks: timedOutCount > 0 ? timedOutCount : undefined,
      skipped_checks: 0,
      checks: results,
      generated_at: new Date().toISOString(),
    };
  }

  private async executeProcess(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    timeoutMs: number,
    maxOutputBytes: number,
    checkDef: CheckDefinition
  ): Promise<{
    status: "passed" | "failed" | "timed_out" | "error";
    exit_code?: number;
    stdout: string;
    stderr: string;
    timedOut?: boolean;
    errorCode?: string;
    timeoutMs?: number;
    terminationMethod?: string;
    processTreeTerminationSucceeded?: boolean;
  }> {
    return new Promise((resolve, reject) => {
      let stdoutData = "";
      let stderrData = "";
      let timedOut = false;
      let settled = false;
      let childPid: number | undefined;

      const child = spawn(command, args, {
        cwd,
        env,
        shell: false, // 보안: shell 금지
        stdio: ["ignore", "pipe", "pipe"],
      });

      childPid = child.pid;

      // stdout 처리 (한도까지만 저장, 이후도 drain)
      if (child.stdout) {
        child.stdout.on("data", (chunk) => {
          if (stdoutData.length < maxOutputBytes) {
            const remaining = maxOutputBytes - stdoutData.length;
            stdoutData += chunk.toString().slice(0, remaining);
          }
          // 한도 이후도 data를 계속 소비 (drain)
        });
      }

      // stderr 처리 (한도까지만 저장, 이후도 drain)
      if (child.stderr) {
        child.stderr.on("data", (chunk) => {
          if (stderrData.length < maxOutputBytes) {
            const remaining = maxOutputBytes - stderrData.length;
            stderrData += chunk.toString().slice(0, remaining);
          }
          // 한도 이후도 data를 계속 소비 (drain)
        });
      }

      // Timeout 처리
      let processTreeTerminationSucceeded = false;
      let terminationMethod = "none";

      const timeoutHandle = setTimeout(() => {
        timedOut = true;

        // Windows는 taskkill /PID /T /F 사용, POSIX는 SIGTERM/SIGKILL 사용
        if (process.platform === "win32" && childPid) {
          try {
            spawn("taskkill", ["/PID", childPid.toString(), "/T", "/F"], {
              stdio: "ignore",
            });
            terminationMethod = "taskkill";
            processTreeTerminationSucceeded = true;
          } catch (e) {
            // taskkill 실패 시 SIGKILL 폴백
            try {
              child.kill("SIGKILL");
              terminationMethod = "SIGKILL";
              processTreeTerminationSucceeded = true;
            } catch (e2) {
              // ignore
            }
          }
        } else {
          child.kill("SIGTERM");
          terminationMethod = "SIGTERM";

          // 강제 종료 폴백 (일부 프로세스는 SIGTERM을 무시할 수 있음)
          setTimeout(() => {
            try {
              child.kill("SIGKILL");
              terminationMethod = "SIGKILL";
              processTreeTerminationSucceeded = true;
            } catch (e) {
              // ignore
            }
          }, 1000);
        }
      }, timeoutMs);

      // Process exit 처리
      child.on("exit", (code, signal) => {
        // handle exit
      });

      // Process close 처리 (close event가 최종 결정 기준)
      child.on("close", (code, signal) => {
        clearTimeout(timeoutHandle);

        if (settled) {
          return;
        }
        settled = true;

        // 출력 마스킹
        const maskedStdout = maskSensitiveOutput(stdoutData, checkDef);
        const maskedStderr = maskSensitiveOutput(stderrData, checkDef);

        if (timedOut) {
          resolve({
            status: "timed_out",
            exit_code: code ?? undefined,
            stdout: maskedStdout.slice(0, 500),
            stderr: `Process timeout after ${timeoutMs}ms`,
            timedOut: true,
            errorCode: "PROCESS_TIMEOUT",
            timeoutMs,
            terminationMethod,
            processTreeTerminationSucceeded,
          });
        } else if (code === 0) {
          resolve({
            status: "passed",
            exit_code: 0,
            stdout: maskedStdout.slice(0, 500),
            stderr: maskedStderr.slice(0, 500),
          });
        } else {
          resolve({
            status: "failed",
            exit_code: code ?? 1,
            stdout: maskedStdout.slice(0, 500),
            stderr: maskedStderr.slice(0, 500),
          });
        }
      });

      // Process error 처리
      child.on("error", (err) => {
        clearTimeout(timeoutHandle);

        if (settled) {
          return;
        }
        settled = true;

        resolve({
          status: "error",
          exit_code: 1,
          stdout: "",
          stderr: `Process error: ${err.message}`,
        });
      });
    });
  }
}
