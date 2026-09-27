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

import path from "path";
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
import { loadDesignContext, resolveArchitectureChecker } from "./platform-template.js";
import {
  computeSpecApprovalComponents,
  computeApprovalTargetChecksum,
  diffApprovalComponents,
} from "../storage/run-storage.js";
import { parseExecutionLimits, type ExecutionLimits } from "./execution-limits.js";
import {
  parseGenerationPlan,
  validateGenerationPlan,
  resolveReusedFiles,
  type GenerationPlan,
} from "./generation-plan.js";

// Run storage 기본 디렉터리 조회
function getRunsBaseDir(): string {
  return process.env.TEST_RUN_DIR || path.resolve(".blueprint/runs");
}

/**
 * architecture-check 실행 명령: 플랫폼 checker + Run에 저장된 계약 + 생성 workspace (모두 절대경로, shell 미사용)
 */
export function buildArchitectureCheckCommand(
  runId: string,
  workspaceDir: string,
  platformFiles: string[]
): { command: string; args: string[] } {
  const contractPath = path.resolve(getRunsBaseDir(), runId, "architecture-contract.v1.json");
  const args = [resolveArchitectureChecker(), contractPath, "--workspace", path.resolve(workspaceDir)];
  for (const f of platformFiles) {
    args.push("--ignore", f);
  }
  return { command: process.execPath, args };
}

export interface WorkflowInput {
  requestSpec: string;        // JSON 문자열
  architectureContract: string; // JSON 문자열
  executionLimits?: string;   // JSON 문자열 (run 전용 단계별 실행 한도)
  generationPlan?: string;    // JSON 문자열 (생성 단위 계획)
}

async function resolveReusedFilesFromRuns(plan: GenerationPlan) {
  const cache = new Map<string, string | null>();
  for (const ref of plan.reused_files) {
    const key = `${ref.source_run}/${ref.source_artifact}`;
    if (!cache.has(key)) cache.set(key, await loadArtifact(ref.source_run, ref.source_artifact));
  }
  return resolveReusedFiles(plan, (run, artifact) => cache.get(`${run}/${artifact}`) ?? null);
}

export interface WorkflowApproval {
  approver: string;
  comment?: string;
  expectedChecksum?: string;
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
  private maxRepairAttempts: number;

  constructor(
    orchestrator: AgentOrchestrator,
    developerAgent: DeveloperAgent,
    validationRunner: IValidationRunner,
    options: { maxRepairAttempts?: number } = {}
  ) {
    this.orchestrator = orchestrator;
    this.developerAgent = developerAgent;
    this.validationRunner = validationRunner;
    this.maxRepairAttempts = options.maxRepairAttempts ?? 3;
  }

  getMaxRepairAttempts(): number {
    const isSmokeTest = process.env.SMOKE_TEST === "true";
    const isNoRepair = process.env.NO_REPAIR === "true";
    return (isSmokeTest || isNoRepair) ? 0 : this.maxRepairAttempts;
  }

  private async escalateDeveloperFailure(runId: string, errorMsg: string): Promise<never> {
    const isApiTimeout = errorMsg.includes("timed out") || errorMsg.includes("timeout");
    if (isApiTimeout) {
      const effective = this.developerAgent.getEffectiveConfig?.() ?? null;
      const timeoutDiagnosis = {
        error_type: "api_timeout",
        error_message: errorMsg,
        timestamp: new Date().toISOString(),
        stage: "developer_execution",
        config: effective,
        api_response: null,
        usage: null,
        stop_reason: null,
      };
      await saveArtifact(runId, "timeout-diagnosis", JSON.stringify(timeoutDiagnosis, null, 2));
      await transitionState(runId, "NEEDS_HUMAN_REVIEW");
      throw new Error(`Agent execution timeout: ${errorMsg}. Saved to timeout-diagnosis artifact.`);
    }
    await transitionState(runId, "NEEDS_HUMAN_REVIEW");
    throw new Error(`Developer Agent failed: ${errorMsg}. Subsequent steps halted.`);
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

    // 디자인 자료 스냅샷: 승인 검토 시점의 토큰·가이드를 run에 고정 (이후 생성은 스냅샷만 사용)
    const design = loadDesignContext(JSON.parse(input.architectureContract).design_tokens_ref);
    if (design) {
      await saveArtifact(requestId, "design-tokens", design.designTokens);
      if (design.uiGuide) await saveArtifact(requestId, "ui-guide", design.uiGuide);
    }

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

    // Run 전용 실행 한도 (승인 대상에 포함)
    let parsedLimits: ExecutionLimits | null = null;
    if (input.executionLimits) {
      parsedLimits = parseExecutionLimits(input.executionLimits);
      await saveArtifact(requestId, "execution-limits", JSON.stringify(parsedLimits, null, 2));
    }

    // 생성 단위 계획 + 재사용 파일 (승인 대상에 포함). 원본 run은 읽기만 한다
    if (input.generationPlan) {
      const genPlan = parseGenerationPlan(input.generationPlan);
      const reqIds = (JSON.parse(input.requestSpec).requirement?.requirements || []).map((r: any) => r.id);
      const planErrors = validateGenerationPlan(genPlan, executionPlan.target_files, reqIds, parsedLimits);
      if (!parsedLimits) planErrors.push("generation-plan requires execution-limits with per-unit limits");
      if (planErrors.length > 0) throw new Error(`Generation plan invalid: ${planErrors.join("; ")}`);
      const reused = await resolveReusedFilesFromRuns(genPlan);
      await saveArtifact(requestId, "generation-plan", JSON.stringify(genPlan, null, 2));
      await saveArtifact(requestId, "reused-files", JSON.stringify(reused, null, 2));
    }

    // approval_targets.spec 생성 (모든 artifact 저장 후, run에 저장된 내용 기준)
    const components = await computeSpecApprovalComponents(requestId);
    const missing = ["request_spec", "architecture_contract", "execution_plan"].filter((k) => !components[k]);
    if (missing.length > 0) {
      throw new Error(`Missing artifacts for approval target: ${missing.join(", ")}`);
    }
    const { createSpecApprovalTarget } = await import("../storage/run-storage.js");
    await createSpecApprovalTarget(requestId, components);

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
      const { InvalidWorkflowStateError } = await import("../cli/cli-errors.js");
      throw new InvalidWorkflowStateError(
        manifest.status,
        `Cannot approve spec in state ${manifest.status}. Current state must be HUMAN_GATE_SPEC.`
      );
    }

    // 중복 승인 검증
    if (manifest.spec_approval) {
      const { DuplicateApprovalError } = await import("../cli/cli-errors.js");
      throw new DuplicateApprovalError(
        manifest.spec_approval.approver,
        `Spec has already been approved by ${manifest.spec_approval.approver}. ` +
        `Cannot approve twice in the same HUMAN_GATE_SPEC state.`
      );
    }

    // 현재 run 내용으로 승인 대상을 다시 계산하고, 검토된 approval target 및 기대 checksum과 일치할 때만 기록
    const specChecksums = await computeSpecApprovalComponents(runId);
    const reviewed = manifest.approval_targets?.spec?.components;
    if (reviewed) {
      const changed = diffApprovalComponents(reviewed, specChecksums);
      if (changed.length > 0) {
        throw new Error(`Approval target changed since it was created (${changed.join(", ")}). Not approved.`);
      }
    }
    const computedTarget = computeApprovalTargetChecksum(specChecksums);
    if (approval.expectedChecksum && approval.expectedChecksum !== computedTarget) {
      const { InvalidWorkflowStateError } = await import("../cli/cli-errors.js");
      throw new InvalidWorkflowStateError(
        manifest.status,
        `Expected checksum does not match the approval target (${computedTarget}). Not approved.`
      );
    }

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

    // Step 1: Developer Agent 실행
    console.log(`[WorkflowRunner] about to call developerAgent.executeByPlan`);
    const executionPlan = JSON.parse(planArtifact || "{}");
    const contract = JSON.parse(contractArtifact || "{}");

    // 생성 프롬프트에 전달할 승인된 요구사항과 디자인 자료
    const requestSpecArtifact = await loadArtifact(runId, "request-spec");
    const limitsArtifact = await loadArtifact(runId, "execution-limits");
    const runLimits: ExecutionLimits | null = limitsArtifact ? parseExecutionLimits(limitsArtifact) : null;
    const genPlanForConfigRaw = await loadArtifact(runId, "generation-plan");
    const genPlanForConfig = genPlanForConfigRaw ? parseGenerationPlan(genPlanForConfigRaw) : null;
    const tokensSnapshot = await loadArtifact(runId, "design-tokens");
    const guideSnapshot = await loadArtifact(runId, "ui-guide");
    const designContext = tokensSnapshot
      ? {
          designTokensRef: `run:design-tokens (from ${contract.design_tokens_ref})`,
          designTokens: tokensSnapshot,
          uiGuideRef: guideSnapshot ? "run:ui-guide" : null,
          uiGuide: guideSnapshot,
        }
      : null;

    // 첫 API 요청 전에 실제 적용 설정 기록 (비밀정보 제외)
    await saveArtifact(
      runId,
      "execution-config",
      JSON.stringify(
        {
          agent: this.developerAgent.getEffectiveConfig?.() ?? null,
          run_execution_limits: runLimits,
          max_repair_attempts: runLimits ? runLimits.max_repair_attempts : this.getMaxRepairAttempts(),
          developer_steps: genPlanForConfig ? genPlanForConfig.units.map((u) => u.id) : ["generateCode", "generateTests", "selfValidate"],
          mode: genPlanForConfig ? "generation-units" : "single-flow",
          prompt_context: {
            request_spec: requestSpecArtifact ? calculateChecksum(requestSpecArtifact) : null,
            design_tokens: designContext ? { ref: designContext.designTokensRef, checksum: calculateChecksum(designContext.designTokens) } : null,
            ui_guide: designContext?.uiGuide ? { ref: designContext.uiGuideRef, checksum: calculateChecksum(designContext.uiGuide) } : null,
          },
          recorded_at: new Date().toISOString(),
        },
        null,
        2
      )
    );

    const genPlanArtifact = await loadArtifact(runId, "generation-plan");
    const reusedArtifact = await loadArtifact(runId, "reused-files");

    let devResult;
    try {
      const generationContext = {
        requestSpec: requestSpecArtifact || undefined,
        uiGuide: designContext?.uiGuide ?? null,
        designTokens: designContext?.designTokens ?? null,
        limits: runLimits,
      };
      if (genPlanArtifact) {
        // 생성 단위 모드: 승인된 계획·재사용 파일로 순차 생성, 단위마다 checkpoint 저장
        const genPlan = parseGenerationPlan(genPlanArtifact);
        const reused = JSON.parse(reusedArtifact || "{}") as Record<string, { content: string }>;
        devResult = await this.developerAgent.executeUnits(genPlan, executionPlan, contractArtifact || "", {
          ...generationContext,
          reusedFiles: Object.fromEntries(Object.entries(reused).map(([p, v]) => [p, v.content])),
          onCheckpoint: async (cp) => {
            const payload: Record<string, unknown> = { unit: cp.unit, phase: cp.phase, record: cp.record, recorded_at: new Date().toISOString() };
            if (cp.checks) payload.checks = cp.checks;
            if (cp.files) {
              payload.file_checksums = Object.fromEntries(Object.entries(cp.files).map(([f, c]) => [f, calculateChecksum(c)]));
            }
            await saveArtifact(runId, `units/${cp.unit}-${cp.phase}`, JSON.stringify(payload, null, 2));
          },
        });
      } else {
        devResult = await this.developerAgent.executeByPlan(executionPlan, contractArtifact || "", generationContext);
      }
    } catch (agentError) {
      const errorMsg = (agentError as Error).message || String(agentError);
      if (errorMsg.includes("timed out") || errorMsg.includes("timeout")) {
        await this.escalateDeveloperFailure(runId, errorMsg);
      }
      throw agentError;
    }

    const devResultJson = JSON.stringify(devResult, null, 2);

    // Developer result 초기값 저장 (단계별 raw text/stop_reason/usage 포함, 파싱 결과보다 먼저 보존)
    await saveArtifact(runId, "developer-result-initial", devResultJson);

    // 오류 또는 불완전 응답: 저장·검증·repair 없이 중단
    if (devResult.status === "failure") {
      await this.escalateDeveloperFailure(runId, (devResult.errors || []).join("; ") || "unknown error");
    }

    // Step 2: 생성 코드를 실제 workspace에 저장
    const { saveGeneratedCode, initializeWorkspace } = await import("../workflow/save-generated-code.js");
    const workspaceDir = path.join(path.dirname(getRunsBaseDir()), "workspace", runId);

    initializeWorkspace(workspaceDir, contract.pattern_type, designContext?.designTokens);

    const saveResult = await saveGeneratedCode({
      workspaceDir,
      generatedCode: devResult.generatedCode,
      testCode: devResult.testCode,
      allowedGlobs: contract.folder_structure?.allowed_globs || ["src/**/*", "**/*.md"],
      requiredFiles: contract.folder_structure?.required_files || [],
      platformFiles: executionPlan.platform_files || [],
    });

    if (saveResult.skippedPlatformFiles.length > 0) {
      await saveArtifact(runId, "skipped-platform-files", JSON.stringify(saveResult.skippedPlatformFiles, null, 2));
    }

    if (saveResult.errors.length > 0) {
      console.log(`[WorkflowRunner] Code save errors: ${saveResult.errors.join(", ")}`);
      await saveArtifact(runId, "save-errors", JSON.stringify(saveResult.errors, null, 2));
      throw new Error(`Failed to save generated code: ${saveResult.errors.join(", ")}`);
    }

    console.log(`[WorkflowRunner] Saved ${saveResult.savedFiles.length} files to ${workspaceDir}`);

    // Step 3: Workspace를 대상으로 실제 Validation 실행
    const checkIds = executionPlan.validation_commands?.map((cmd: any) => cmd.check_id) || [
      "typecheck",
      "build",
    ];

    // Workspace 경로를 validationRunner에 설정
    // (테스트는 FakeValidationRunner 주입, 프로덕션은 ProcessValidationRunner)
    if ("setBaseRoot" in this.validationRunner && typeof this.validationRunner.setBaseRoot === "function") {
      (this.validationRunner as any).setBaseRoot(workspaceDir);
    }
    if ("setCheckOverride" in this.validationRunner && typeof (this.validationRunner as any).setCheckOverride === "function") {
      (this.validationRunner as any).setCheckOverride(
        "architecture-check",
        buildArchitectureCheckCommand(runId, workspaceDir, executionPlan.platform_files || [])
      );
    }

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

    // Auto-repair loop (기본 3회, CLI production/smoke/no-repair에서는 0회)
    let finalDevResultJson = devResultJson;
    let finalValidationReport = initialValidationReport;
    let repairAttempt = 0;
    const maxRepairAttempts = runLimits ? runLimits.max_repair_attempts : this.getMaxRepairAttempts();

    while (
      finalValidationReport.failed_checks > 0 &&
      repairAttempt < maxRepairAttempts
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
          : repairAttempt >= maxRepairAttempts
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
      const { InvalidWorkflowStateError } = await import("../cli/cli-errors.js");
      throw new InvalidWorkflowStateError(
        manifest.status,
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
