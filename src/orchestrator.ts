/**
 * Agent Orchestrator
 *
 * 여러 AI Agent를 조율하고 관리하는 중앙 오케스트레이터입니다.
 * v0.1: Developer Agent만 구현
 * v0.2+: 나머지 6개 Agent 추가
 */

export interface Agent {
  id: string;
  name: string;
  role: "developer" | "validator" | "optimizer" | "executor" | "monitor" | "feedback" | "config";
  version: string;
  enabled: boolean;
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
  private taskIdCounter: number = 0;

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
      // v0.1: 실제 Agent 실행 로직
      // 현재는 시뮬레이션
      const agent = this.agents.get(task.agentId)!;
      console.log(`Running task for agent: ${agent.name}`);

      // 실제 구현은 src/agents/developer.ts 참고
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
   * 모든 활성화된 Agent의 상태 출력
   */
  printStatus(): void {
    console.log("\n📊 Orchestrator Status");
    console.log(`- Total Agents: ${this.agents.size}`);
    console.log(`- Enabled Agents: ${Array.from(this.agents.values()).filter((a) => a.enabled).length}`);
    console.log(`- Pending Tasks: ${Array.from(this.tasks.values()).filter((t) => t.status === "pending").length}`);
    console.log(`- Completed Tasks: ${Array.from(this.tasks.values()).filter((t) => t.status === "completed").length}`);
  }
}

/**
 * 글로벌 Orchestrator 인스턴스 생성 및 초기화
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
  // orchestrator.registerAgent({
  //   id: "agent_validator",
  //   name: "Validator Agent",
  //   role: "validator",
  //   version: "0.1.0",
  //   enabled: process.env.VALIDATOR_AGENT_ENABLED === "true",
  // });

  return orchestrator;
}
