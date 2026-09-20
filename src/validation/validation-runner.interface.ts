/**
 * Validation Runner Interface
 *
 * 검증 실행기의 contract
 * 구현체: RealValidationRunner, FakeValidationRunner
 */

export interface ValidationCheckResult {
  check_id: string;
  status: "passed" | "failed" | "timed_out" | "skipped" | "error";
  exit_code?: number;
  duration_ms: number;
  stdout_summary: string;
  stderr_summary: string;
  artifact_checksum?: string;
  started_at: string;
  finished_at: string;
  timedOut?: boolean;
  errorCode?: string;
  timeoutMs?: number;
  terminationMethod?: string;
  processTreeTerminationSucceeded?: boolean;
}

export interface ValidationReport {
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  timed_out_checks?: number;
  skipped_checks: number;
  checks: ValidationCheckResult[];
  generated_at: string;
}

/**
 * IValidationRunner: Validation 실행을 위한 interface
 */
export interface IValidationRunner {
  /**
   * 단일 check 실행
   */
  runCheck(
    checkId: string,
    artifactChecksum?: string
  ): Promise<ValidationCheckResult>;

  /**
   * 여러 checks 실행 (순서대로)
   */
  runSuite(
    checkIds: string[],
    artifactChecksum?: string
  ): Promise<ValidationReport>;
}
