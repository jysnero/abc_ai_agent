/**
 * Validation Runner
 *
 * execution-plan의 validation checks를 실행하고 결과를 기록합니다.
 * 보안 조건: shell 불사용, arguments 분리, timeout, 출력 제한
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import {
  CheckDefinition,
  getCheckDefinition,
  maskSensitiveOutput,
  filterEnvironmentVariables,
} from "./check-registry.js";

const execFileAsync = promisify(execFile);

export interface ValidationCheckResult {
  check_id: string;
  status: "passed" | "failed" | "skipped" | "error";
  exit_code?: number;
  duration_ms: number;
  stdout_summary: string;
  stderr_summary: string;
  artifact_checksum?: string; // 검사 대상 artifact의 checksum
  started_at: string;
  finished_at: string;
}

export interface ValidationReport {
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  skipped_checks: number;
  checks: ValidationCheckResult[];
  generated_at: string;
}

/**
 * Validation Runner: 단일 check 실행
 */
export async function runValidationCheck(
  checkId: string,
  artifactChecksum?: string
): Promise<ValidationCheckResult> {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();

  // Check 정의 조회
  const checkDef = getCheckDefinition(checkId);
  if (!checkDef) {
    return {
      check_id: checkId,
      status: "error",
      duration_ms: Date.now() - startTime,
      stdout_summary: "",
      stderr_summary: `Unknown check: ${checkId}`,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
  }

  try {
    // 환경변수 필터링
    const env = filterEnvironmentVariables(checkDef);

    // Check 실행 (shell 불사용)
    const { stdout, stderr } = await execFileAsync(checkDef.command, checkDef.args, {
      cwd: checkDef.cwd,
      env,
      timeout: checkDef.timeout_ms,
      maxBuffer: checkDef.max_output_bytes,
      shell: false, // 보안: shell 금지
    });

    // 로그 마스킹
    const maskedStdout = maskSensitiveOutput(stdout, checkDef);
    const maskedStderr = maskSensitiveOutput(stderr, checkDef);

    // 출력 요약 (크기 제한)
    const stdoutSummary = maskedStdout.slice(0, 500);
    const stderrSummary = maskedStderr.slice(0, 500);

    return {
      check_id: checkId,
      status: "passed",
      exit_code: 0,
      duration_ms: Date.now() - startTime,
      stdout_summary: stdoutSummary,
      stderr_summary: stderrSummary,
      artifact_checksum: artifactChecksum,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };

    // 타임아웃
    if (err.code === "ETIMEDOUT") {
      return {
        check_id: checkId,
        status: "error",
        duration_ms: Date.now() - startTime,
        stdout_summary: err.stdout ? maskSensitiveOutput(err.stdout, checkDef).slice(0, 500) : "",
        stderr_summary: `Check timeout after ${checkDef.timeout_ms}ms`,
        artifact_checksum: artifactChecksum,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      };
    }

    // 일반 오류 (exit code != 0)
    const stdout = err.stdout ? maskSensitiveOutput(err.stdout as string, checkDef) : "";
    const stderr = err.stderr ? maskSensitiveOutput(err.stderr as string, checkDef) : String(err.message);
    const exitCode = typeof err.code === "number" ? err.code : 1;

    return {
      check_id: checkId,
      status: "failed",
      exit_code: exitCode,
      duration_ms: Date.now() - startTime,
      stdout_summary: stdout.slice(0, 500),
      stderr_summary: stderr.slice(0, 500),
      artifact_checksum: artifactChecksum,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
  }
}

/**
 * 모든 checks 실행
 */
export async function runValidationSuite(
  checkIds: string[],
  artifactChecksum?: string
): Promise<ValidationReport> {
  const results: ValidationCheckResult[] = [];

  // 등록되지 않은 ID 즉시 거부
  const invalidIds = checkIds.filter((id) => !getCheckDefinition(id));
  if (invalidIds.length > 0) {
    return {
      total_checks: checkIds.length,
      passed_checks: 0,
      failed_checks: invalidIds.length,
      skipped_checks: checkIds.length - invalidIds.length,
      checks: invalidIds.map((id) => ({
        check_id: id,
        status: "error" as const,
        duration_ms: 0,
        stdout_summary: "",
        stderr_summary: `Check not found in registry`,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })),
      generated_at: new Date().toISOString(),
    };
  }

  // 순차 실행 (병렬화는 v0.2+)
  for (const checkId of checkIds) {
    const result = await runValidationCheck(checkId, artifactChecksum);
    results.push(result);
  }

  // 결과 요약
  const passedCount = results.filter((r) => r.status === "passed").length;
  const failedCount = results.filter((r) => r.status === "failed").length;
  const skippedCount = results.filter((r) => r.status === "skipped").length;

  return {
    total_checks: checkIds.length,
    passed_checks: passedCount,
    failed_checks: failedCount,
    skipped_checks: skippedCount,
    checks: results,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Checksum 계산 (파일 내용 기반)
 */
export function calculateChecksum(content: string | Buffer): string {
  const hash = createHash("sha256");
  hash.update(content);
  return `sha256:${hash.digest("hex")}`;
}

/**
 * 검증 보고서의 checksum 일치 확인
 */
export function verifyArtifactChecksum(
  report: ValidationReport,
  expectedChecksum: string
): boolean {
  // 모든 checks가 동일한 checksum을 기록해야 함
  const checksums = report.checks
    .filter((c) => c.artifact_checksum)
    .map((c) => c.artifact_checksum);

  if (checksums.length === 0) {
    return false; // checksum 기록 없음
  }

  return checksums.every((cs) => cs === expectedChecksum);
}
