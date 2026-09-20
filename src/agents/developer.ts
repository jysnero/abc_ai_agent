/**
 * Developer Agent with Execution Plan
 *
 * v0.1: execution-plan 기반 step-by-step 코드 생성
 * - Step 1: 코드 생성 (target_files 목록 기반)
 * - Step 2: 테스트 생성
 * - Step 3: 자기 검증
 * - Step 4: 최종 정리
 *
 * SDK 의존성 분리: Agent Client를 통한 통신
 */

import type { IAgentClient } from "../runtime/agent-client.js";
import { createAgentClient } from "../runtime/agent-client.js";
import type { ExecutionPlan } from "../orchestrator.js";

export interface DeveloperAgentConfig {
  apiKey?: string;
  model?: string;
}

export interface DeveloperAgentResult {
  status: "success" | "failure";
  generatedCode: Record<string, string>;
  testCode: Record<string, string>;
  selfValidation: Record<string, unknown>;
  errors?: string[];
}

export class DeveloperAgent {
  private client: IAgentClient;
  private model: string;

  constructor(config: DeveloperAgentConfig = {}) {
    this.client = createAgentClient({
      apiKey: config.apiKey,
      timeout_ms: 60000,
      max_retries: 3,
    });
    this.model = config.model || "claude-opus-4-1";
  }

  /**
   * Agent 초기화
   */
  async initialize(): Promise<void> {
    console.log("🔧 Developer Agent initializing...");
    console.log("✓ Developer Agent ready");
  }

  /**
   * Execution Plan 기반 step-by-step 실행
   * @param executionPlan - 수행할 작업 계획
   * @param architectureContract - 구조 제약 (string으로 전달)
   */
  async executeByPlan(
    executionPlan: ExecutionPlan,
    architectureContract: string
  ): Promise<DeveloperAgentResult> {
    console.log(`📋 Developer Agent executing plan: ${executionPlan.contract_id}`);

    const result: DeveloperAgentResult = {
      status: "success",
      generatedCode: {},
      testCode: {},
      selfValidation: {},
    };

    try {
      // Step 1: 코드 생성
      console.log(`\n📝 Step 1: 코드 생성 (${executionPlan.target_files.length} 파일)`);
      result.generatedCode = await this.generateCode(executionPlan, architectureContract);

      // Step 2: 테스트 생성
      console.log(`\n🧪 Step 2: 테스트 생성`);
      result.testCode = await this.generateTests(executionPlan, result.generatedCode);

      // Step 3: 자기 검증
      console.log(`\n✅ Step 3: 자기 검증`);
      result.selfValidation = await this.selfValidate(executionPlan, result.generatedCode);

      console.log(`✓ Developer Agent completed successfully`);
      return result;
    } catch (error) {
      console.error("❌ Developer Agent execution failed:", error);
      result.status = "failure";
      result.errors = [String(error)];
      return result;
    }
  }

  /**
   * Step 1: 코드 생성
   */
  private async generateCode(
    plan: ExecutionPlan,
    contractStr: string
  ): Promise<Record<string, string>> {
    const fileList = plan.target_files.join("\n");

    const prompt = `
You are a developer implementing a WebView service according to an execution plan.

## Execution Plan
- Contract ID: ${plan.contract_id}
- Target Files: ${fileList}
- Bridge Usage: ${JSON.stringify(plan.bridge_usage)}

## Architecture Contract (constraints)
${contractStr}

## Task
Generate complete, production-ready code for each target file. Follow the architecture contract constraints strictly.
Output format: For each file, start with "### File: <path>" on a new line, then the code.
`;

    const response = await this.client.chat(
      [{ role: "user", content: prompt }],
      "You are a professional TypeScript developer."
    );

    const content = response.content;

    // 파싱: "### File: <path>" 마크로부터 코드 추출
    const codeMap: Record<string, string> = {};
    const matches = content.split(/^### File: /m);

    for (let i = 1; i < matches.length; i++) {
      const lines = matches[i].split("\n");
      const filePath = lines[0].trim();
      const code = lines.slice(1).join("\n").trim();
      codeMap[filePath] = code;
    }

    return codeMap;
  }

  /**
   * Step 2: 테스트 생성
   */
  private async generateTests(
    plan: ExecutionPlan,
    generatedCode: Record<string, string>
  ): Promise<Record<string, string>> {
    const codeStr = Object.entries(generatedCode)
      .map(([path, code]) => `File: ${path}\n${code}`)
      .join("\n\n---\n\n");

    const prompt = `
You are writing tests for the generated code.

## Generated Code
${codeStr}

## Task
Write comprehensive test cases covering:
1. Main functionality
2. Error cases
3. Edge cases

Output format: For each test file, start with "### Test: <path>" on a new line, then the test code.
Target files should be in tests/ directory with similar structure.
`;

    const response = await this.client.chat(
      [{ role: "user", content: prompt }],
      "You are an experienced QA engineer writing comprehensive tests."
    );

    const content = response.content;

    const testMap: Record<string, string> = {};
    const matches = content.split(/^### Test: /m);

    for (let i = 1; i < matches.length; i++) {
      const lines = matches[i].split("\n");
      const filePath = lines[0].trim();
      const code = lines.slice(1).join("\n").trim();
      testMap[filePath] = code;
    }

    return testMap;
  }

  /**
   * Step 3: 자기 검증
   */
  private async selfValidate(
    plan: ExecutionPlan,
    generatedCode: Record<string, string>
  ): Promise<Record<string, unknown>> {
    const codeStr = Object.entries(generatedCode)
      .map(([path, code]) => `${path}: ${code.slice(0, 500)}...`) // 처음 500자만
      .join("\n");

    const prompt = `
You are validating your generated code against an execution plan.

## Execution Plan
${JSON.stringify(plan, null, 2)}

## Generated Code Summary
${codeStr}

## Task
Check if the generated code completely implements the execution plan.
Answer in JSON format:
{
  "completeness": "yes" | "no",
  "coverage": ["list of covered target files"],
  "missing": ["list of missing target files"],
  "issues": ["list of any issues"],
  "notes": "any additional notes"
}
`;

    const response = await this.client.chat(
      [{ role: "user", content: prompt }],
      "You are a code quality reviewer verifying implementation completeness."
    );

    const content = response.content;

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      // 파싱 실패 시 원본 텍스트 반환
    }

    return { raw: content };
  }

  /**
   * 코드 리뷰 (v0.2+)
   */
  async reviewCode(code: string, guidelines?: string): Promise<string> {
    const prompt = `Review this code:\n\n\`\`\`\n${code}\n\`\`\`${
      guidelines ? `\n\nGuidelines:\n${guidelines}` : ""
    }`;

    const response = await this.client.chat(
      [{ role: "user", content: prompt }],
      "You are an experienced code reviewer."
    );

    return response.content;
  }

  /**
   * 아키텍처 검토 (v0.2+)
   */
  async reviewArchitecture(architectureDoc: string): Promise<string> {
    const prompt = `Review this architecture design and identify issues:\n\n${architectureDoc}`;

    const response = await this.client.chat(
      [{ role: "user", content: prompt }],
      "You are an experienced system architect."
    );

    return response.content;
  }

  /**
   * 상태 정보
   */
  getStatus(): Record<string, unknown> {
    return {
      agent: "Developer Agent",
      version: "0.1.0",
      model: this.model,
      capabilities: ["executeByPlan", "reviewCode", "reviewArchitecture"],
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
