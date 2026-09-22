/**
 * Workflow Runner
 *
 * 모든 컴포넌트를 연결하는 오케스트레이션 레이어
 *
 * 흐름:
 * startRun → PLANNING → PlanBuilder → HUMAN_GATE_SPEC (중단)
 * resumeRun → DEV_VALIDATION_LOOP → Developer + Validation → auto-repair → HUMAN_GATE_RELEASE (중단)
 * resumeRun → RELEASE_READY (v0.1 종료)
 */

import type { AgentOrchestrator } from "../orchestrator.js";
import type { IValidationRunner } from "../validation/validation-runner.interface.js";
import type { ArtifactMetadata } from "../storage/run-storage.types.js";
import { buildExecutionPlan, validateExecutionPlan } from "../builders/plan-builder.js";
import {
  initializeRun,
  loadManifest,
  saveArtifact,
  loadArtifact,
  transitionState,
  recordSpecApproval,
  recordReleaseApproval,
  incrementRetryCount,
  listArtifacts as listStoredArtifacts,
} from "../storage/run-storage.js";
import { calculateChecksum } from "../validation/validation-runner.js";
import { DeveloperAgent } from "../agents/developer.js";
import { autoRepair } from "../agents/repair-agent.js";

export interface WorkflowInput {
  requestSpec: string;        // JSON 문자열
  architectureContract: string; // JSON 문자열
}

export interface WorkflowApproval {
  approver: string;
  comment?: string;
}

export interface WorkflowStatus {
  runId: string;
  status: string;
  blocked: boolean;           // HUMAN_GATE_*에서 중단 여부
  artifacts: {
    requestSpec?: string;
    architectureContract?: string;
    executionPlan?: string;
    developerResult?: string;
    validationReport?: string;
  };
  errors: string[];
}

/**
 * Workflow Runner: 상태머신 진행 관리
 */
export class WorkflowRunner {
  private orchestrator: AgentOrchestrator;
  private developerAgent: DeveloperAgent;
  private validationRunner: IValidationRunner;

  constructor(
    orchestrator: AgentOrchestrator,
    developerAgent: DeveloperAgent,
    validationRunner: IValidationRunner
  ) {
    this.orchestrator = orchestrator;
    this.developerAgent = developerAgent;
    this.validationRunner = validationRunner;
  }

  /**
   * 새 run 시작
   */
  async startRun(input: WorkflowInput): Promise<string> {
    // Request spec 저장 + run 초기화
    const requestId = this.orchestrator.createRequest({
      topic: JSON.parse(input.requestSpec).topic || "WebView Service",
      target: JSON.parse(input.requestSpec).target || "service",
      requirements: JSON.parse(input.requestSpec).requirements || "",
    });

    // Run Storage 초기화 (request-spec 포함)
    await initializeRun(requestId, input.requestSpec);

    // Architecture Contract 저장
    await saveArtifact(requestId, "architecture-contract", input.architectureContract);

    // 상태 전환: PLANNING → DESIGN → ARCH_CONTRACT → PLAN_BUILD
    await transitionState(requestId, "DESIGN");
    await transitionState(requestId, "ARCH_CONTRACT");
    await transitionState(requestId, "PLAN_BUILD");

    // Execution Plan 생성
    const contract = JSON.parse(input.architectureContract);
    const executionPlan = buildExecutionPlan(contract);

    // Plan validation
    const validation = validateExecutionPlan(executionPlan, contract);
    if (!validation.valid) {
      throw new Error(`Execution plan validation failed: ${validation.errors.join(", ")}`);
    }

    // Plan 저장
    await saveArtifact(requestId, "execution-plan", JSON.stringify(executionPlan, null, 2));

    // Approval target 생성 (모든 artifact 저장 후)
    // 최신 manifest 재로드해서 stale overwrite 방지
    const manifest = await loadManifest(requestId);
    const specChecksum = manifest.request_spec_revision;
    const contractChecksum = manifest.architecture_contract_revision;
    const planChecksum = manifest.execution_plan_revision;

    if (!specChecksum || !contractChecksum || !planChecksum) {
      throw new Error(
        `Missing artifact checksums: spec=${specChecksum}, contract=${contractChecksum}, plan=${planChecksum}`
      );
    }

    // approval_targets.spec 생성 (모든 artifact 저장 후)
    const { createSpecApprovalTarget } = await import("../storage/run-storage.js");
    await createSpecApprovalTarget(requestId, {
      request_spec: specChecksum,
      architecture_contract: contractChecksum,
      execution_plan: planChecksum,
    });

    // HUMAN_GATE_SPEC에 도달
    await transitionState(requestId, "HUMAN_GATE_SPEC");

    return requestId;
  }

  /**
   * Spec 승인 저장 (승인만, 실행 아님)
   */
  async submitSpecApproval(runId: string, approval: WorkflowApproval): Promise<string> {
    console.log(`[WorkflowRunner] submitSpecApproval START for ${runId}`);

    // Run 상태 검증
    const manifest = await loadManifest(runId);
    if (manifest.status !== "HUMAN_GATE_SPEC") {
      throw new Error(
        `Cannot approve spec in state ${manifest.status}. Current state must be HUMAN_GATE_SPEC.`
      );
    }

    // Approval target checksum 계산
    const contractArtifact = await loadArtifact(runId, "architecture-contract");
    const planArtifact = await loadArtifact(runId, "execution-plan");
    const specArtifact = await loadArtifact(runId, "request-spec");
    console.log(`[WorkflowRunner] artifacts loaded: contract=${!!contractArtifact}, plan=${!!planArtifact}, spec=${!!specArtifact}`);

    const specChecksums = {
      request_spec: calculateChecksum(specArtifact || ""),
      architecture_contract: calculateChecksum(contractArtifact || ""),
      execution_plan: calculateChecksum(planArtifact || ""),
    };

    // 승인 기록 및 checksum 반환 (run-storage에서 결정론적으로 계산)
    const targetChecksum = await recordSpecApproval(runId, approval.approver, specChecksums);
    console.log(`[WorkflowRunner] spec approval recorded, target checksum: ${targetChecksum}`);

    return targetChecksum;
  }

  /**
   * Spec 승인 후 재개 (v0.1 호환성 유지)
   * @deprecated 신규 코드는 submitSpecApproval() + resumeRun() 사용
   */
  async resumeAfterSpecApproval(runId: string, approval: WorkflowApproval): Promise<void> {
    console.log(`[WorkflowRunner] resumeAfterSpecApproval START for ${runId} (deprecated)`);

    // Run 초기화 상태 검증
    const manifest = await loadManifest(runId);
    if (manifest.initialization_status !== "READY") {
      throw new Error(
        `Cannot resume run in ${manifest.initialization_status || "unknown"} initialization state. ` +
        `Run must be READY to execute.`
      );
    }

    // submitSpecApproval 호출 (이미 승인된 경우 에러 처리)
    if (!manifest.spec_approval) {
      await this.submitSpecApproval(runId, approval);
    }

    // resumeRun 호출
    await this.resumeRun(runId);
  }

  /**
   * Workflow 재개 (현재 상태에 따라 다르게 동작)
   * - HUMAN_GATE_SPEC + 유효한 승인 → DEV_VALIDATION_LOOP 실행
   * - HUMAN_GATE_RELEASE + 유효한 승인 → RELEASE_READY로 전환
   */
  async resumeRun(runId: string): Promise<void> {
    console.log(`[WorkflowRunner] resumeRun START for ${runId}`);

    const manifest = await loadManifest(runId);
    if (manifest.initialization_status !== "READY") {
      throw new Error(
        `Cannot resume run in ${manifest.initialization_status || "unknown"} initialization state. ` +
        `Run must be READY to execute.`
      );
    }

    // HUMAN_GATE_RELEASE 상태에서 호출된 경우: 승인 후 완료
    if (manifest.status === "HUMAN_GATE_RELEASE") {
      if (!manifest.release_approval) {
        throw new Error(`Cannot resume: release has not been approved. Call submitReleaseApproval first.`);
      }
      await this.markReleaseReady(runId);
      return;
    }

    // HUMAN_GATE_SPEC 상태: 개발·검증 실행
    if (manifest.status !== "HUMAN_GATE_SPEC") {
      throw new Error(
        `Cannot resume from state ${manifest.status}. Current state must be HUMAN_GATE_SPEC or HUMAN_GATE_RELEASE.`
      );
    }

    // Spec 승인 확인
    if (!manifest.spec_approval) {
      throw new Error(`Cannot resume: spec has not been approved. Call submitSpecApproval first.`);
    }

    // DEV_VALIDATION_LOOP 시작
    try {
      await transitionState(runId, "DEV_VALIDATION_LOOP");
      console.log(`[WorkflowRunner] transitioned to DEV_VALIDATION_LOOP`);
    } catch (err) {
      const manifest = await loadManifest(runId);
      const errMsg = `transitionState(DEV_VALIDATION_LOOP) failed: ${(err as Error).message}. Manifest spec_approval: ${JSON.stringify(manifest.spec_approval)}`;
      console.log(`[WorkflowRunner] ERROR: ${errMsg}`);
      throw new Error(errMsg);
    }

    // Load artifacts for execution
    const contractArtifact = await loadArtifact(runId, "architecture-contract");
    const planArtifact = await loadArtifact(runId, "execution-plan");

    // Developer Agent 실행
    console.log(`[WorkflowRunner] about to call developerAgent.executeByPlan`);
    const executionPlan = JSON.parse(planArtifact || "{}");

    const devResult = await this.developerAgent.executeByPlan(executionPlan, contractArtifact || "");
    const devResultJson = JSON.stringify(devResult, null, 2);

    // Developer result 초기값 저장 (repair-0으로 저장)
    await saveArtifact(runId, "developer-result-initial", devResultJson);

    // Validation 실행
    const checkIds = executionPlan.validation_commands?.map((cmd: any) => cmd.check_id) || [
      "typecheck",
      "build",
    ];

    const initialValidationReport = await this.validationRunner.runSuite(
      checkIds,
      calculateChecksum(devResultJson)
    );

    // 초기 validation report 저장 (revision-based)
    const initialReportWithMetadata = {
      report_id: `val-${runId}-initial`,
      run_id: runId,
      attempt: { type: "initial", number: 0 },
      artifact_revision: "validation/initial",
      artifact_checksum: calculateChecksum(JSON.stringify(initialValidationReport)),
      ...initialValidationReport,
      created_at: new Date().toISOString(),
    };
    await saveArtifact(
      runId,
      "validation/initial",
      JSON.stringify(initialReportWithMetadata, null, 2)
    );

    // Timeout 발생 시 즉시 NEEDS_HUMAN_REVIEW로 전환 (repair 미실행)
    if (initialValidationReport.timed_out_checks && initialValidationReport.timed_out_checks > 0) {
      // Timeout 진단정보 저장
      const timeoutDiagnosis = {
        run_id: runId,
        timeout_occurred_at: "validation/initial",
        timed_out_checks: initialValidationReport.timed_out_checks,
        total_checks: initialValidationReport.total_checks,
        timed_out_check_details: initialValidationReport.checks
          .filter((c: any) => c.status === "timed_out")
          .map((c: any) => ({
            check_id: c.check_id,
            timeoutMs: c.timeoutMs,
            terminationMethod: c.terminationMethod,
            processTreeTerminationSucceeded: c.processTreeTerminationSucceeded,
          })),
        escalation_reason: "Validation timeout - not a code error, requires human investigation",
        created_at: new Date().toISOString(),
      };
      await saveArtifact(runId, "timeout-diagnosis", JSON.stringify(timeoutDiagnosis, null, 2));

      // NEEDS_HUMAN_REVIEW로 전환
      await transitionState(runId, "NEEDS_HUMAN_REVIEW");
      throw new Error(
        `Validation timeout detected: ${initialValidationReport.timed_out_checks} check(s) timed out. ` +
        `This may indicate an infinite loop, resource exhaustion, or environmental issue. ` +
        `Escalating to human review instead of automatic repair.`
      );
    }

    // Auto-repair loop (최대 3회)
    let finalDevResultJson = devResultJson;
    let finalValidationReport = initialValidationReport;
    let repairAttempt = 0;

    while (
      finalValidationReport.failed_checks > 0 &&
      repairAttempt < 3
    ) {
      repairAttempt++;

      // Retry count 증가
      await incrementRetryCount(runId, "dev_repair");

      // Auto-repair 실행
      const contractObj = JSON.parse(contractArtifact || "{}");
      const previousResultObj = JSON.parse(finalDevResultJson);
      const repairResult = await autoRepair(this.developerAgent["client"], {
        executionPlan,
        architectureContract: contractObj,
        previousResult: previousResultObj,
        validationReport: finalValidationReport,
        retryCount: repairAttempt,
      });

      // Repair result 저장
      finalDevResultJson = JSON.stringify(repairResult, null, 2);
      await saveArtifact(runId, `developer-result-repair-${repairAttempt}`, finalDevResultJson);

      // Re-validate
      const repairChecksum = calculateChecksum(finalDevResultJson);
      finalValidationReport = await this.validationRunner.runSuite(checkIds, repairChecksum);

      // Timeout 발생 시 loop 탈출
      if (finalValidationReport.timed_out_checks && finalValidationReport.timed_out_checks > 0) {
        console.log(
          `Timeout detected during repair attempt ${repairAttempt}: ${finalValidationReport.timed_out_checks} check(s) timed out. ` +
          `Stopping repair loop and escalating to human review.`
        );
        break; // repair loop 종료, 아래의 failed_checks > 0 체크에서 NEEDS_HUMAN_REVIEW로 전환
      }

      // Repair validation report 저장 (revision-based)
      const repairReportWithMetadata = {
        report_id: `val-${runId}-repair-${repairAttempt}`,
        run_id: runId,
        attempt: { type: "repair", number: repairAttempt },
        artifact_revision: `validation/repair-${repairAttempt}`,
        artifact_checksum: calculateChecksum(JSON.stringify(finalValidationReport)),
        ...finalValidationReport,
        created_at: new Date().toISOString(),
      };
      await saveArtifact(
        runId,
        `validation/repair-${repairAttempt}`,
        JSON.stringify(repairReportWithMetadata, null, 2)
      );

      // Log repair attempt
      console.log(
        `Repair attempt ${repairAttempt}: ${finalValidationReport.failed_checks} checks still failing`
      );
    }

    // 최종 결과 저장
    await saveArtifact(runId, "developer-result", finalDevResultJson);

    // Validation summary 저장
    const validationSummary = {
      run_id: runId,
      final_status: finalValidationReport.failed_checks === 0 ? "passed" : "failed",
      total_validations: repairAttempt + 1,
      total_repairs: repairAttempt,
      final_artifact_revision: repairAttempt > 0 ? `validation/repair-${repairAttempt}` : "validation/initial",
      final_artifact_checksum: calculateChecksum(JSON.stringify(finalValidationReport)),
      final_report_ref: repairAttempt > 0 ? `validation/repair-${repairAttempt}` : "validation/initial",
      remaining_errors: finalValidationReport.checks
        .filter((c: any) => c.status === "failed")
        .map((c: any) => c.check_id),
      termination_reason:
        finalValidationReport.failed_checks === 0
          ? "all_checks_passed"
          : repairAttempt >= 3
            ? "repair_limit_exceeded"
            : "manual_termination",
      completed_at: new Date().toISOString(),
    };
    await saveArtifact(runId, "validation-summary", JSON.stringify(validationSummary, null, 2));

    // 검증 완료 확인
    const hasTimeouts = finalValidationReport.timed_out_checks && finalValidationReport.timed_out_checks > 0;
    if (finalValidationReport.failed_checks > 0 || hasTimeouts) {
      await transitionState(runId, "NEEDS_HUMAN_REVIEW");
      if (hasTimeouts) {
        throw new Error(
          `Validation timeout detected: ${finalValidationReport.timed_out_checks} check(s) timed out after ${repairAttempt} repair attempts. ` +
          `Escalating to human review.`
        );
      } else {
        throw new Error(
          `Validation failed after ${repairAttempt} repair attempts: ${finalValidationReport.failed_checks} checks failed`
        );
      }
    }

    // HUMAN_GATE_RELEASE에 도달
    await transitionState(runId, "HUMAN_GATE_RELEASE");
  }

  /**
   * Release 승인 저장 (승인만, 실행 아님)
   */
  async submitReleaseApproval(runId: string, approval: WorkflowApproval): Promise<string> {
    console.log(`[WorkflowRunner] submitReleaseApproval START for ${runId}`);

    const manifest = await loadManifest(runId);
    if (manifest.status !== "HUMAN_GATE_RELEASE") {
      throw new Error(
        `Cannot approve release in state ${manifest.status}. Current state must be HUMAN_GATE_RELEASE.`
      );
    }

    // Release approval target checksum 계산
    const devResultArtifact = await loadArtifact(runId, "developer-result");

    // Validation report: 최종 검증 결과 로드
    let validationReportArtifact = "";
    for (const attempt of ["repair-3", "repair-2", "repair-1", "initial"]) {
      const reportPath = attempt === "initial" ? "validation/initial" : `validation/${attempt}`;
      const report = await loadArtifact(runId, reportPath);
      if (report) {
        validationReportArtifact = report;
        break;
      }
    }

    const releaseChecksums = {
      developer_result: calculateChecksum(devResultArtifact || ""),
      validation_report: calculateChecksum(validationReportArtifact || ""),
    };

    // 승인 기록 및 checksum 반환 (run-storage에서 결정론적으로 계산)
    const targetChecksum = await recordReleaseApproval(runId, approval.approver, releaseChecksums);
    console.log(`[WorkflowRunner] release approval recorded, target checksum: ${targetChecksum}`);

    return targetChecksum;
  }

  /**
   * Release 승인 후 재개 (v0.1 호환성 유지)
   * @deprecated 신규 코드는 submitReleaseApproval() + completeRun() 사용
   */
  async resumeAfterReleaseApproval(runId: string, approval: WorkflowApproval): Promise<void> {
    console.log(`[WorkflowRunner] resumeAfterReleaseApproval START for ${runId} (deprecated)`);

    const manifest = await loadManifest(runId);
    if (!manifest.release_approval) {
      await this.submitReleaseApproval(runId, approval);
    }

    await this.completeRun(runId);
  }

  /**
   * Release 준비 완료 (RELEASE_READY로 전환, v0.1 종료)
   */
  async markReleaseReady(runId: string): Promise<void> {
    console.log(`[WorkflowRunner] markReleaseReady START for ${runId}`);

    const manifest = await loadManifest(runId);
    if (manifest.status !== "HUMAN_GATE_RELEASE") {
      throw new Error(
        `Cannot mark release ready in state ${manifest.status}. Current state must be HUMAN_GATE_RELEASE.`
      );
    }

    if (!manifest.release_approval) {
      throw new Error(`Cannot mark release ready: release has not been approved. Call submitReleaseApproval first.`);
    }

    // RELEASE_READY (v0.1 종료)
    await transitionState(runId, "RELEASE_READY");
  }

  /**
   * 호환성 유지용 completeRun (v0.1)
   * @deprecated 신규 코드는 markReleaseReady() 사용
   */
  async completeRun(runId: string): Promise<void> {
    await this.markReleaseReady(runId);
  }

  /**
   * Run 상태 조회
   */
  async getRunStatus(runId: string): Promise<WorkflowStatus> {
    const manifest = await loadManifest(runId);

    // Artifacts 로드 (null → undefined 변환)
    const requestSpec = (await loadArtifact(runId, "request-spec")) || undefined;
    const architectureContract = (await loadArtifact(runId, "architecture-contract")) || undefined;
    const executionPlan = (await loadArtifact(runId, "execution-plan")) || undefined;
    const developerResult = (await loadArtifact(runId, "developer-result")) || undefined;

    // Validation report: 최종 검증 결과 로드
    // 우선 repair-3, repair-2, repair-1, initial 순서로 시도
    let validationReport = undefined;
    for (const attempt of ["repair-3", "repair-2", "repair-1", "initial"]) {
      const reportPath = attempt === "initial" ? "validation/initial" : `validation/${attempt}`;
      const report = await loadArtifact(runId, reportPath);
      if (report) {
        validationReport = report;
        break;
      }
    }

    // 블로킹 상태 확인
    const blocked =
      manifest.status === "HUMAN_GATE_SPEC" || manifest.status === "HUMAN_GATE_RELEASE";

    return {
      runId,
      status: manifest.status,
      blocked,
      artifacts: {
        requestSpec,
        architectureContract,
        executionPlan,
        developerResult,
        validationReport,
      },
      errors: [],
    };
  }

  /**
   * 테스트 및 디버깅용: artifact 로드
   */
  async loadArtifact(runId: string, artifactPath: string): Promise<string | null> {
    return await loadArtifact(runId, artifactPath);
  }

  /**
   * Run의 모든 artifact 메타데이터 조회
   */
  async listArtifacts(runId: string): Promise<ArtifactMetadata[]> {
    return await listStoredArtifacts(runId);
  }
}
