/**
 * Fake Validation Runner
 *
 * 테스트용 mock ValidationRunner
 * 사전 정의된 결과를 순서대로 반환
 */

import type { IValidationRunner, ValidationCheckResult, ValidationReport } from "./validation-runner.interface.js";

/**
 * 검증 결과 시나리오 정의
 */
export interface ValidationScenario {
  checkId: string;
  status: "passed" | "failed" | "timed_out" | "error";
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  errorCode?: string;
  timeoutMs?: number;
  terminationMethod?: string;
  processTreeTerminationSucceeded?: boolean;
}

/**
 * Fake Validation Runner 구현
 */
export class FakeValidationRunner implements IValidationRunner {
  private scenarios: ValidationScenario[] = [];
  private callIndex = 0;

  constructor(scenarios: ValidationScenario[] = []) {
    this.scenarios = scenarios;
    this.callIndex = 0;
  }

  /**
   * 단일 check 실행
   */
  async runCheck(
    checkId: string,
    artifactChecksum?: string
  ): Promise<ValidationCheckResult> {
    const scenario = this.scenarios[this.callIndex] || {
      checkId,
      status: "passed" as const,
    };
    this.callIndex++;

    const startTime = Date.now();
    const startedAt = new Date().toISOString();

    return {
      check_id: scenario.checkId || checkId,
      status: scenario.status,
      exit_code: scenario.exitCode ?? (scenario.status === "passed" ? 0 : 1),
      duration_ms: Math.random() * 1000 + 100,
      stdout_summary: scenario.stdout || "",
      stderr_summary: scenario.stderr || "",
      artifact_checksum: artifactChecksum,
      started_at: startedAt,
      finished_at: new Date(Date.now() + 500).toISOString(),
      timedOut: scenario.timedOut,
      errorCode: scenario.errorCode,
      timeoutMs: scenario.timeoutMs,
      terminationMethod: scenario.terminationMethod,
      processTreeTerminationSucceeded: scenario.processTreeTerminationSucceeded,
    };
  }

  /**
   * 여러 checks 실행
   */
  async runSuite(
    checkIds: string[],
    artifactChecksum?: string
  ): Promise<ValidationReport> {
    const checks: ValidationCheckResult[] = [];
    let passedCount = 0;
    let failedCount = 0;
    let timedOutCount = 0;

    for (const checkId of checkIds) {
      const result = await this.runCheck(checkId, artifactChecksum);
      checks.push(result);
      if (result.status === "passed") passedCount++;
      if (result.status === "failed") failedCount++;
      if (result.status === "timed_out") timedOutCount++;
    }

    return {
      total_checks: checks.length,
      passed_checks: passedCount,
      failed_checks: failedCount,
      timed_out_checks: timedOutCount > 0 ? timedOutCount : undefined,
      skipped_checks: 0,
      checks,
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * 테스트용: 다음 시나리오 설정
   */
  setScenarios(scenarios: ValidationScenario[]): void {
    this.scenarios = scenarios;
    this.callIndex = 0;
  }

  /**
   * 테스트용: 호출 카운트 리셋
   */
  reset(): void {
    this.callIndex = 0;
  }
}
