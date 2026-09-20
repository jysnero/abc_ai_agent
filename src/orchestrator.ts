/**
 * Agent Orchestrator with 8-Stage State Machine
 *
 * 8단계 상태머신:
 * PLANNING → DESIGN → ARCH_CONTRACT → PLAN_BUILD → HUMAN_GATE_SPEC → DEV_VALIDATION_LOOP → HUMAN_GATE_RELEASE → DEVOPS → DONE
 *
 * v0.1: RunStorage + PlanBuilder + ValidationRunner + DeveloperAgent 통합
 * - 파일 기반 상태 저장 (RunStorage)
 * - 아키텍처 제약 → 실행 계획 (PlanBuilder)
 * - Validation checks 실행 (ValidationRunner)
 * - 코드 생성 (DeveloperAgent)
 */

import { DeveloperAgent } from "./agents/developer.js";
import { buildExecutionPlan, validateExecutionPlan } from "./builders/plan-builder.js";
import { runValidationSuite, calculateChecksum } from "./validation/validation-runner.js";
import {
  initializeRun,
  loadManifest,
  saveArtifact,
  loadArtifact,
  transitionState,
  recordSpecApproval,
  recordReleaseApproval,
  incrementRetryCount,
} from "./storage/run-storage.js";

export type State =
  | "PLANNING"
  | "DESIGN"
  | "ARCH_CONTRACT"
  | "PLAN_BUILD"
  | "HUMAN_GATE_SPEC"
  | "DEV_VALIDATION_LOOP"
  | "HUMAN_GATE_RELEASE"
  | "DEVOPS"
  | "DONE"
  | "ESCALATED"
  | "PLAN_CHANGE_REQUIRED"
  | "NEEDS_HUMAN_REVIEW";

export interface Agent {
  id: string;
  name: string;
  role: "developer" | "validator" | "optimizer" | "executor" | "monitor" | "feedback" | "config";
  version: string;
  enabled: boolean;
}

export interface ExecutionPlan {
  contract_id: string;
  version: string;
  request_spec_revision: string;
  target_files: string[];
  bridge_usage: Record<string, number>;
  validation_commands: Array<{
    check_id: string;
    command: string;
  }>;
  completion_criteria: {
    required_files_created: string[];
    all_validation_pass: boolean;
    forbidden_patterns: "none" | "block_free";
  };
  generated_at: string;
  generated_by?: string;
}

export interface Request {
  id: string;
  status: State;
  userInput: {
    topic: string;
    target: string;
    requirements: string;
  };
  planningResult?: Record<string, unknown>;
  designResult?: Record<string, unknown>;
  architectureContract?: Record<string, unknown>;
  executionPlan?: ExecutionPlan;
  devValidationResult?: Record<string, unknown>;
  finalReport?: Record<string, unknown>;
  retryCount: {
    arch: number;
    devRepair: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentTask {
  id: string;
  agentId: string;
  status: "pending" | "running" | "completed" | "failed";
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export class AgentOrchestrator {
  private agents: Map<string, Agent> = new Map();
  private tasks: Map<string, AgentTask> = new Map();
  private requests: Map<string, Request> = new Map();
  private taskIdCounter: number = 0;
  private requestIdCounter: number = 0;
  private developerAgent: DeveloperAgent;

  private readonly MAX_ARCH_RETRIES = 2;
  private readonly MAX_DEV_REPAIR_RETRIES = 3;

  constructor() {
    this.developerAgent = new DeveloperAgent({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  /**
   * Agent를 등록합니다 (v0.1: Developer Agent만)
   */
  registerAgent(agent: Agent): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent with ID '${agent.id}' already registered`);
    }
    this.agents.set(agent.id, agent);
    console.log(`✓ Agent registered: ${agent.name} (${agent.role})`);
  }

  /**
   * 등록된 Agent 목록 반환
   */
  getAgents(role?: Agent["role"]): Agent[] {
    const agents = Array.from(this.agents.values());
    if (role) {
      return agents.filter((a) => a.role === role);
    }
    return agents;
  }

  /**
   * 특정 Agent를 활성화/비활성화
   */
  setAgentEnabled(agentId: string, enabled: boolean): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    agent.enabled = enabled;
  }

  /**
   * 새 요청 생성 (PLANNING 상태로 시작)
   */
  createRequest(userInput: Request["userInput"]): string {
    const requestId = `req-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(++this.requestIdCounter).padStart(3, "0")}-${userInput.target}`;
    const request: Request = {
      id: requestId,
      status: "PLANNING",
      userInput,
      retryCount: { arch: 0, devRepair: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.requests.set(requestId, request);
    console.log(`✓ Request created: ${requestId} (PLANNING)`);
    return requestId;
  }

  /**
   * 요청 조회
   */
  getRequest(requestId: string): Request | undefined {
    return this.requests.get(requestId);
  }

  /**
   * 상태 전환 (상태 검증 + 재시도 로직 포함)
   */
  async transitionState(
    requestId: string,
    nextState: State,
    result?: Record<string, unknown>
  ): Promise<void> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Request not found: ${requestId}`);
    }

    const currentState = request.status;

    // 상태 전환 검증
    if (!this.isValidTransition(currentState, nextState)) {
      throw new Error(`Invalid state transition: ${currentState} → ${nextState}`);
    }

    // 결과 저장
    if (result) {
      switch (nextState) {
        case "PLANNING":
          request.planningResult = result;
          break;
        case "DESIGN":
          request.designResult = result;
          break;
        case "ARCH_CONTRACT":
          request.architectureContract = result;
          break;
        case "DEV_VALIDATION_LOOP":
          request.devValidationResult = result;
          break;
        case "DONE":
          request.finalReport = result;
          break;
      }
    }

    // 상태 업데이트
    request.status = nextState;
    request.updatedAt = new Date();

    console.log(`✓ State transition: ${requestId} (${currentState} → ${nextState})`);
  }

  /**
   * 상태 전환 규칙 검증
   */
  private isValidTransition(from: State, to: State): boolean {
    const transitions: Record<State, State[]> = {
      PLANNING: ["DESIGN"],
      DESIGN: ["ARCH_CONTRACT"],
      ARCH_CONTRACT: ["PLAN_BUILD", "ESCALATED"],
      PLAN_BUILD: ["HUMAN_GATE_SPEC", "PLAN_CHANGE_REQUIRED"],
      HUMAN_GATE_SPEC: ["DEV_VALIDATION_LOOP", "ESCALATED"],
      DEV_VALIDATION_LOOP: [
        "HUMAN_GATE_RELEASE",
        "DEV_VALIDATION_LOOP",
        "NEEDS_HUMAN_REVIEW",
        "ESCALATED",
      ],
      HUMAN_GATE_RELEASE: ["DEVOPS", "ESCALATED"],
      DEVOPS: ["DONE", "ESCALATED"],
      DONE: [],
      ESCALATED: [],
      PLAN_CHANGE_REQUIRED: [],
      NEEDS_HUMAN_REVIEW: [],
    };
    return transitions[from]?.includes(to) ?? false;
  }

  /**
   * 재시도 가능 여부 확인
   */
  canRetry(requestId: string, stage: "arch" | "devRepair"): boolean {
    const request = this.requests.get(requestId);
    if (!request) return false;

    const maxRetries =
      stage === "arch" ? this.MAX_ARCH_RETRIES : this.MAX_DEV_REPAIR_RETRIES;
    return request.retryCount[stage] < maxRetries;
  }

  /**
   * 재시도 카운트 증가
   */
  incrementRetryCount(requestId: string, stage: "arch" | "devRepair"): void {
    const request = this.requests.get(requestId);
    if (request) {
      request.retryCount[stage]++;
    }
  }

  /**
   * Task를 생성하고 대기열에 추가
   */
  createTask(
    agentId: string,
    input: Record<string, unknown>
  ): string {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    if (!agent.enabled) {
      throw new Error(`Agent is disabled: ${agentId}`);
    }

    const taskId = `task_${++this.taskIdCounter}`;
    const task: AgentTask = {
      id: taskId,
      agentId,
      status: "pending",
      input,
      createdAt: new Date(),
    };

    this.tasks.set(taskId, task);
    return taskId;
  }

  /**
   * Task 상태 조회
   */
  getTaskStatus(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Task 실행 (시뮬레이션)
   */
  async executeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.status = "running";

    try {
      const agent = this.agents.get(task.agentId)!;
      console.log(`Running task for agent: ${agent.name}`);

      task.output = {
        success: true,
        message: `Task executed by ${agent.name}`,
      };
      task.status = "completed";
      task.completedAt = new Date();
    } catch (error) {
      task.status = "failed";
      task.error = String(error);
      task.completedAt = new Date();
      throw error;
    }
  }

  /**
   * PLAN_BUILD 단계: Execution Plan 생성
   * architecture-contract → execution-plan
   */
  async executePlanBuild(
    requestId: string,
    architectureContractStr: string
  ): Promise<void> {
    const request = this.requests.get(requestId);
    if (!request) throw new Error(`Request not found: ${requestId}`);

    try {
      // 아키텍처 계약 파싱
      const contract = JSON.parse(architectureContractStr);

      // Execution Plan 생성
      const executionPlan = buildExecutionPlan(contract);
      executionPlan.request_spec_revision =
        request.executionPlan?.request_spec_revision || "";

      // 검증
      const validation = validateExecutionPlan(
        executionPlan,
        contract,
        process.cwd()
      );
      if (!validation.valid) {
        throw new Error(`Execution plan validation failed: ${validation.errors.join(", ")}`);
      }

      // 저장
      await saveArtifact(
        requestId,
        "execution-plan",
        JSON.stringify(executionPlan, null, 2)
      );

      request.executionPlan = executionPlan;
      console.log(`✓ Execution plan created: ${executionPlan.contract_id}`);
    } catch (error) {
      throw new Error(`Plan build failed: ${error}`);
    }
  }

  /**
   * DEV_VALIDATION_LOOP 단계: 코드 생성 + 검증 + 자동 수정
   */
  async executeDevValidationLoop(
    requestId: string,
    architectureContractStr: string
  ): Promise<void> {
    const request = this.requests.get(requestId);
    if (!request || !request.executionPlan) {
      throw new Error(`Request not found or execution plan missing: ${requestId}`);
    }

    const executionPlan = request.executionPlan;

    try {
      // Step 1: 코드 생성
      console.log(`\n📝 Developer Agent executing plan...`);
      await this.developerAgent.initialize();
      const devResult = await this.developerAgent.executeByPlan(
        executionPlan,
        architectureContractStr
      );

      if (devResult.status === "failure") {
        throw new Error(`Developer Agent failed: ${devResult.errors?.join(", ")}`);
      }

      // Step 2: 검증 실행
      console.log(`\n✅ Running validation suite...`);
      const checkIds = executionPlan.validation_commands.map((cmd) => cmd.check_id);
      const validationReport = await runValidationSuite(
        checkIds,
        calculateChecksum(JSON.stringify(devResult.generatedCode))
      );

      // 검증 결과 저장
      await saveArtifact(
        requestId,
        "developer-result",
        JSON.stringify(devResult, null, 2)
      );
      await saveArtifact(
        requestId,
        "validation-report",
        JSON.stringify(validationReport, null, 2)
      );

      request.devValidationResult = validationReport as unknown as Record<string, unknown>;

      // 검증 결과 확인
      if (validationReport.failed_checks > 0) {
        // 자동 수정 재시도
        if (this.canRetry(requestId, "devRepair")) {
          console.log(`⚠️ Validation failed, attempting auto-repair...`);
          this.incrementRetryCount(requestId, "devRepair");
          // v0.2: 자동 수정 로직 추가
          throw new Error(`Auto-repair not yet implemented (v0.2+)`);
        } else {
          throw new Error(
            `Validation failed and max retries exceeded. Manual review required.`
          );
        }
      }

      console.log(`✓ All validations passed`);
    } catch (error) {
      throw new Error(`Dev validation loop failed: ${error}`);
    }
  }

  /**
   * 모든 활성화된 Agent의 상태 출력
   */
  printStatus(): void {
    console.log("\n📊 Orchestrator Status");
    console.log(`- Total Agents: ${this.agents.size}`);
    console.log(`- Enabled Agents: ${Array.from(this.agents.values()).filter((a) => a.enabled).length}`);
    console.log(`- Active Requests: ${this.requests.size}`);
    console.log(`- Pending Tasks: ${Array.from(this.tasks.values()).filter((t) => t.status === "pending").length}`);
    console.log(`- Completed Tasks: ${Array.from(this.tasks.values()).filter((t) => t.status === "completed").length}`);
  }
}

/**
 * 글로벌 Orchestrator 인스턴스 생성 및 초기화
 * 8-stage 상태머신 설정
 */
export function createOrchestrator(): AgentOrchestrator {
  const orchestrator = new AgentOrchestrator();

  // v0.1: Developer Agent만 등록
  orchestrator.registerAgent({
    id: "agent_developer",
    name: "Developer Agent",
    role: "developer",
    version: "0.1.0",
    enabled: process.env.DEVELOPER_AGENT_ENABLED !== "false",
  });

  // v0.2 이후: 나머지 Agent들을 여기에 추가
  // - planner_agent (PLANNING)
  // - designer_agent (DESIGN)
  // - architect_agent (ARCH_CONTRACT)
  // - devops_agent (DEVOPS)

  return orchestrator;
}
