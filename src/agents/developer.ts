/**
 * Developer Agent
 *
 * v0.1 구현 대상: 코드 작성, 아키텍처 설계, 테스트 생성 등을 수행하는 Agent
 *
 * Status: 구현 준비 단계
 */

import Anthropic from "@anthropic-ai/claude-agent-sdk";

export interface DeveloperAgentConfig {
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
}

export class DeveloperAgent {
  private client: InstanceType<typeof Anthropic>;
  private model: string;
  private systemPrompt: string;

  constructor(config: DeveloperAgentConfig = {}) {
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.model = config.model || "claude-3-5-sonnet-20241022";
    this.systemPrompt =
      config.systemPrompt ||
      `You are a Developer Agent specialized in:
- Code architecture and design
- Implementation of features
- Writing and improving tests
- Code review and optimization

When tasked with development work, provide clear, well-structured solutions.`;
  }

  /**
   * Agent 초기화 및 준비 상태 확인
   */
  async initialize(): Promise<void> {
    console.log("🔧 Developer Agent initializing...");
    // 실제 초기화 로직 (필요시)
    console.log("✓ Developer Agent ready");
  }

  /**
   * 개발 작업 실행
   * @param task - 실행할 작업 설명
   * @param context - 작업의 문맥 (코드, 요구사항 등)
   */
  async execute(task: string, context?: string): Promise<string> {
    console.log(`📝 Developer Agent executing: ${task}`);

    const messages = [
      {
        role: "user" as const,
        content: context
          ? `${task}\n\nContext:\n${context}`
          : task,
      },
    ];

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: this.systemPrompt,
        messages,
      });

      const result = response.content
        .filter((block) => block.type === "text")
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n");

      return result;
    } catch (error) {
      console.error("❌ Developer Agent execution failed:", error);
      throw error;
    }
  }

  /**
   * 코드 리뷰 수행
   */
  async reviewCode(code: string, guidelines?: string): Promise<string> {
    const context = guidelines
      ? `Review Guidelines:\n${guidelines}`
      : undefined;

    return this.execute(
      `Please review the following code and provide suggestions for improvement:\n\n\`\`\`\n${code}\n\`\`\``,
      context
    );
  }

  /**
   * 테스트 생성
   */
  async generateTests(code: string, testFramework: string = "jest"): Promise<string> {
    return this.execute(
      `Generate comprehensive ${testFramework} tests for the following code:\n\n\`\`\`\n${code}\n\`\`\``,
      `Use ${testFramework} as the test framework.`
    );
  }

  /**
   * 아키텍처 검토
   */
  async reviewArchitecture(architectureDoc: string): Promise<string> {
    return this.execute(
      "Review the following architecture design and identify potential issues:\n\n" +
        architectureDoc
    );
  }

  /**
   * v0.1 상태 정보
   */
  getStatus(): Record<string, unknown> {
    return {
      agent: "Developer Agent",
      version: "0.1.0",
      status: "ready",
      model: this.model,
      capabilities: [
        "code review",
        "test generation",
        "architecture review",
        "feature implementation",
      ],
    };
  }
}

/**
 * 글로벌 Developer Agent 인스턴스 생성
 */
export async function createDeveloperAgent(
  config?: DeveloperAgentConfig
): Promise<DeveloperAgent> {
  const agent = new DeveloperAgent(config);
  await agent.initialize();
  return agent;
}
