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

import type { IAgentClient, RawAgentResponse, EffectiveClientConfig } from "../runtime/agent-client.js";
import { createAgentClient } from "../runtime/agent-client.js";
import type { ExecutionPlan } from "../orchestrator.js";

export interface DeveloperAgentConfig {
  apiKey?: string;
  model?: string;
  max_tokens?: number;
  timeout_ms?: number;
  client?: IAgentClient;  // For dependency injection (testing)
  max_retries?: number;   // For smoke tests: override default retries
}

export type DeveloperStep = "generateCode" | "generateTests" | "selfValidate";

export interface DeveloperStepRecord {
  step: DeveloperStep;
  api_requests_started: number;
  outcome: "ok" | "error" | "incomplete";
  error?: string;
  raw: RawAgentResponse | null;
}

export interface DeveloperAgentResult {
  status: "success" | "failure";
  generatedCode: Record<string, string>;
  testCode: Record<string, string>;
  selfValidation: Record<string, unknown>;
  steps: DeveloperStepRecord[];
  errors?: string[];
}

class IncompleteResponseError extends Error {}

export class DeveloperAgent {
  private client: IAgentClient;
  private model: string;
  private steps: DeveloperStepRecord[] = [];

  constructor(config: DeveloperAgentConfig = {}) {
    this.client = config.client || createAgentClient({
      apiKey: config.apiKey,
      model: config.model,
      max_tokens: config.max_tokens,
      timeout_ms: config.timeout_ms ?? 60000,
      max_retries: config.max_retries ?? 3,
    });
    this.model = config.model || "claude-opus-5-5";
  }

  getEffectiveConfig(): EffectiveClientConfig | null {
    return this.client.getEffectiveConfig ? this.client.getEffectiveConfig() : null;
  }

  /**
   * 단계별 API 호출: 파싱 전에 text/stop_reason/usage를 기록하고,
   * 오류 또는 불완전 응답(stop_reason != end_turn)이면 예외로 이후 단계를 중단
   */
  private async callStep(step: DeveloperStep, prompt: string, systemPrompt: string): Promise<string> {
    const record: DeveloperStepRecord = {
      step,
      api_requests_started: 1,
      outcome: "ok",
      raw: null,
    };
    this.steps.push(record);

    try {
      const response = await this.client.chat([{ role: "user", content: prompt }], systemPrompt);
      record.raw = {
        stop_reason: response.stop_reason ?? null,
        usage: response.usage ?? null,
        block_types: ["text"],
        text: response.content,
      };
      if (response.stop_reason !== "end_turn") {
        record.outcome = "incomplete";
        record.error = `stop_reason=${response.stop_reason}`;
        throw new IncompleteResponseError(`${step}: incomplete response (stop_reason=${response.stop_reason})`);
      }
      return response.content;
    } catch (error) {
      if (!(error instanceof IncompleteResponseError)) {
        record.outcome = "error";
        record.error = error instanceof Error ? error.message : String(error);
        record.raw = (error as { raw?: RawAgentResponse }).raw ?? null;
      }
      throw error;
    }
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

    this.steps = [];
    const result: DeveloperAgentResult = {
      status: "success",
      generatedCode: {},
      testCode: {},
      selfValidation: {},
      steps: this.steps,
    };

    try {
      // Step 1: 코드 생성
      console.log(`\n📝 Step 1: 코드 생성 (${executionPlan.target_files.length} 파일)`);
      result.generatedCode = await this.generateCode(executionPlan, architectureContract);

      const missing = executionPlan.target_files.filter((f) => !(f in result.generatedCode));
      if (missing.length > 0) {
        const last = this.steps[this.steps.length - 1];
        last.outcome = "incomplete";
        last.error = `missing target files: ${missing.join(", ")}`;
        throw new IncompleteResponseError(`generateCode: missing target files: ${missing.join(", ")}`);
      }

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
   * Step 1: 코드 생성 (### File:과 ### Test: 모두 파싱)
   */
  private async generateCode(
    plan: ExecutionPlan,
    contractStr: string
  ): Promise<Record<string, string>> {
    const fileList = plan.target_files.map((f) => `- ${f}`).join("\n");
    const platformFiles = plan.platform_files || [];
    const platformSection = platformFiles.length > 0
      ? `
## Platform-Provided Files (already exist in the workspace — do NOT generate them)
${platformFiles.map((f) => `- ${f}`).join("\n")}
- demo/main.tsx mounts the component with \`import App from "../src/App"\`, so src/App.tsx must \`export default\` the App component.
- Tests run with vitest (jsdom) and @testing-library/react; jest-dom matchers are preloaded. Import test APIs from "vitest".
`
      : "";

    const prompt = `
You are a developer implementing a WebView service according to an execution plan.

## Execution Plan
- Contract ID: ${plan.contract_id}
- Target Files (generate exactly these, ALL of them):
${fileList}
- Bridge Usage: ${JSON.stringify(plan.bridge_usage)}
${platformSection}
## Architecture Contract (constraints)
${contractStr}

## Task
Generate COMPLETE, production-ready code for EACH target file listed above. Do not skip any files.

Output format: For each file, start with "### File: <path>" on a new line, then the complete file content.
`;

    const content = await this.callStep("generateCode", prompt, "You are a professional TypeScript developer.");

    // 파싱: "### File: <path>"와 "### Test: <path>" 모두 지원
    const codeMap: Record<string, string> = {};

    // File 항목 파싱
    const fileMatches = content.split(/^### File: /m);
    for (let i = 1; i < fileMatches.length; i++) {
      const lines = fileMatches[i].split("\n");
      const filePath = lines[0].trim();
      const code = lines.slice(1).join("\n").trim();

      // 다음 섹션까지만 추출 (### Test: 또는 ### File: 만나면 중단)
      const nextSectionMatch = code.match(/^###\s+(Test|File):/m);
      const finalCode = nextSectionMatch
        ? code.substring(0, nextSectionMatch.index).trim()
        : code;

      codeMap[filePath] = finalCode;
    }

    // Test 항목도 파싱
    const testMatches = content.split(/^### Test: /m);
    for (let i = 1; i < testMatches.length; i++) {
      const lines = testMatches[i].split("\n");
      const filePath = lines[0].trim();
      const code = lines.slice(1).join("\n").trim();

      const nextSectionMatch = code.match(/^###\s+(Test|File):/m);
      const finalCode = nextSectionMatch
        ? code.substring(0, nextSectionMatch.index).trim()
        : code;

      codeMap[filePath] = finalCode;
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
${plan.platform_files?.length ? 'Use vitest (import { describe, it, expect, vi } from "vitest") with @testing-library/react (jsdom, jest-dom matchers preloaded). Import the component from "../src/App".' : ""}
`;

    const content = await this.callStep(
      "generateTests",
      prompt,
      "You are an experienced QA engineer writing comprehensive tests."
    );

    const testMap: Record<string, string> = {};
    const matches = content.split(/^### Test: /m);

    for (let i = 1; i < matches.length; i++) {
      const lines = matches[i].split("\n");
      const filePath = lines[0].trim();
      let code = lines.slice(1).join("\n").trim();

      // 다음 섹션까지만 추출 (### File: 또는 ### Test: 만나면 중단)
      const nextSectionMatch = code.match(/^###\s+(Test|File):/m);
      if (nextSectionMatch) {
        code = code.substring(0, nextSectionMatch.index).trim();
      }

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

    const content = await this.callStep(
      "selfValidate",
      prompt,
      "You are a code quality reviewer verifying implementation completeness."
    );

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
