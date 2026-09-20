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

    // Run Storage 초기화
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

    // HUMAN_GATE_SPEC에 도달
    await transitionState(requestId, "HUMAN_GATE_SPEC");

    return requestId;
  }

  /**
   * Spec 승인 후 재개
   */
  async resumeAfterSpecApproval(runId: string, approval: WorkflowApproval): Promise<void> {
    console.log(`[WorkflowRunner] resumeAfterSpecApproval START for ${runId}`);

    // 승인 기록
    const contractArtifact = await loadArtifact(runId, "architecture-contract");
    const planArtifact = await loadArtifact(runId, "execution-plan");
    const specArtifact = await loadArtifact(runId, "request-spec");
    console.log(`[WorkflowRunner] artifacts loaded: contract=${!!contractArtifact}, plan=${!!planArtifact}, spec=${!!specArtifact}`);

    await recordSpecApproval(runId, approval.approver, {
      request_spec: calculateChecksum(specArtifact || ""),
      architecture_contract: calculateChecksum(contractArtifact || ""),
      execution_plan: calculateChecksum(planArtifact || ""),
    });
    console.log(`[WorkflowRunner] spec approval recorded`);

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
    if (finalValidationReport.failed_checks > 0) {
      await transitionState(runId, "NEEDS_HUMAN_REVIEW");
      throw new Error(
        `Validation failed after ${repairAttempt} repair attempts: ${finalValidationReport.failed_checks} checks failed`
      );
    }

    // HUMAN_GATE_RELEASE에 도달
    await transitionState(runId, "HUMAN_GATE_RELEASE");
  }

  /**
   * Release 승인 후 재개
   */
  async resumeAfterReleaseApproval(runId: string, approval: WorkflowApproval): Promise<void> {
    // 승인 기록
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

    await recordReleaseApproval(runId, approval.approver, {
      developer_result: calculateChecksum(devResultArtifact || ""),
      validation_report: calculateChecksum(validationReportArtifact || ""),
    });

    // RELEASE_READY (v0.1 종료)
    await transitionState(runId, "RELEASE_READY");
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
}
