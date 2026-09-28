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

import type { IAgentClient, RawAgentResponse, EffectiveClientConfig, ChatOptions } from "../runtime/agent-client.js";
import { limitFor, type ExecutionLimits } from "../workflow/execution-limits.js";
import type { GenerationPlan, GenerationUnit } from "../workflow/generation-plan.js";
import { checkUnitFile, type UnitFileCheck } from "../workflow/unit-checks.js";
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

// 단일 흐름 단계명 또는 생성 단위 id
export type DeveloperStep = "generateCode" | "generateTests" | "selfValidate" | (string & {});

export interface DeveloperStepRecord {
  step: DeveloperStep;
  api_requests_started: number;
  outcome: "ok" | "error" | "incomplete";
  error?: string;
  prompt: { system: string; user: string };
  applied_options: ChatOptions | null;
  raw: RawAgentResponse | null;
}

/**
 * 생성 프롬프트에 전달할 승인된 요구사항과 디자인 자료 (런타임 Agent는 CLAUDE.md를 읽지 않으므로 명시적으로 전달)
 */
export interface GenerationContext {
  requestSpec?: string;
  uiGuide?: string | null;
  designTokens?: string | null;
  limits?: ExecutionLimits | null;
}

export interface UnitCheckpoint {
  unit: string;
  phase: "response" | "passed" | "failed";
  record: DeveloperStepRecord | null;
  checks?: UnitFileCheck[];
  files?: Record<string, string>;
}

const UNIT_SYSTEM_PROMPT =
  "You are a professional TypeScript/React developer implementing one unit of a larger WebView service. Other units are written separately against the same Interface Contract, so follow it exactly.";

function fence(file: string, code: string): string {
  const lang = file.endsWith(".tsx") ? "tsx" : "ts";
  return `### ${file}\n\`\`\`${lang}\n${code}\`\`\``;
}

export function buildUnitPrompt(
  unit: GenerationUnit,
  plan: GenerationPlan,
  executionPlan: ExecutionPlan,
  architectureContract: string,
  spec: any,
  reqById: Map<string, unknown>,
  produced: Record<string, string>,
  ctx: GenerationContext
): string {
  const reqs = unit.requirements.map((id) => reqById.get(id) ?? { id, missing: true });
  const contextFiles = unit.context_files.map((f) => fence(f, produced[f] ?? "")).join("\n\n");
  const platform = executionPlan.platform_files || [];
  const parts = [
    `## Unit\n- id: ${unit.id} (${unit.kind})\n- Files to generate (exactly these, no other files):\n${unit.files.map((f) => `  - ${f}`).join("\n")}\n- Unit instructions: ${unit.instructions}`,
    `## Core Rules (shared by every unit; must not diverge)\n${JSON.stringify({ target: spec.target, rules: spec.requirement?.rules, sample_data: spec.requirement?.sample_data, constraints: spec.constraints, out_of_scope: spec.requirement?.out_of_scope }, null, 2)}`,
    `## Requirements for this unit (implement all of them; do not add features)\n${JSON.stringify(reqs, null, 2)}`,
    `## Interface Contract (shared; do not rename exports, props, callbacks or move state ownership)\n${plan.interface_contract}`,
    contextFiles ? `## Existing files (already generated or reused — import from them, do not redefine or modify)\n${contextFiles}` : "",
    platform.length
      ? `## Platform-Provided Files (exist already; never generate)\n${platform.map((f) => `- ${f}`).join("\n")}\n- demo/main.tsx mounts \`import App from "../src/App"\`.\n- Tests run with vitest (jsdom) + @testing-library/react + @testing-library/user-event; jest-dom matchers are preloaded. Import test APIs from "vitest".`
      : "",
    `## Architecture Contract (constraints)\n${architectureContract}`,
    unit.include_ui_guide && ctx.uiGuide ? `## UI Guide (values marked provisional are not official)\n${ctx.uiGuide}` : "",
    unit.include_ui_guide && ctx.designTokens ? `## Design Tokens (use the token-based Tailwind classes from the UI Guide, not raw hex)\n${ctx.designTokens}` : "",
    unit.kind === "test"
      ? `## Test rules\nWrite the tests against the approved requirements and acceptance criteria above, NOT against whatever the existing code happens to do. Include the requirement ID in each test name (e.g. "REQ-PRED-04: ..."). Use fake timers or findBy* for the sample loading delay.`
      : "",
    unit.acceptance_checks?.length
      ? `## Acceptance checks for this unit\n- automated: write a test that asserts exactly this. Do not loosen the expected value or the condition to make it pass.\n- browser: verified separately with browser evidence (layout, pixel size, visual). Do not write a jsdom test that claims to verify it.\n${unit.acceptance_checks.map((c) => `- [${c.method}] ${c.requirement}: ${c.check}`).join("\n")}`
      : "",
    `## Output format\nFor each file: a line "### File: <path>", then the complete file in one fenced code block. Output only the files listed for this unit.`,
  ];
  return parts.filter(Boolean).join("\n\n");
}

function contextSections(ctx: GenerationContext): string {
  const parts: string[] = [];
  if (ctx.requestSpec) {
    parts.push(`## Approved Request Spec (source of truth for screens, copy, rules and behavior)\n${ctx.requestSpec}`);
  }
  if (ctx.uiGuide) {
    parts.push(`## UI Guide (follow it; values marked provisional are not official)\n${ctx.uiGuide}`);
  }
  if (ctx.designTokens) {
    parts.push(`## Design Tokens (use the token-based Tailwind classes named in the UI Guide instead of raw hex values)\n${ctx.designTokens}`);
  }
  return parts.join("\n\n");
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

export function isTestFile(filePath: string): boolean {
  return /(^|\/)tests?\//.test(filePath) || /\.test\.[jt]sx?$/.test(filePath);
}

export function splitTargetFiles(files: string[]): { sourceFiles: string[]; testFiles: string[] } {
  return {
    sourceFiles: files.filter((f) => !isTestFile(f)),
    testFiles: files.filter((f) => isTestFile(f)),
  };
}

/**
 * "### File: <path>" / "### Test: <path>" 섹션 파싱.
 * 섹션 전체를 감싼 코드블록(```lang ... ```)은 제거하고, 닫히지 않은 코드블록(잘린 응답)은 files에서 제외한다.
 */
export function parseFileSections(content: string): { files: Record<string, string>; unterminated: string[] } {
  const files: Record<string, string> = {};
  const unterminated: string[] = [];
  const parts = content.split(/^### (?:File|Test): /m);
  for (let i = 1; i < parts.length; i++) {
    const lines = parts[i].split("\n");
    const filePath = lines[0].trim();
    let body = lines.slice(1).join("\n").trim();
    if (/^```[\w-]*[ \t]*(\r?\n|$)/.test(body)) {
      const closing = body.lastIndexOf("\n```");
      if (closing < 0 || body.slice(closing + 4).trim() !== "") {
        unterminated.push(filePath);
        continue;
      }
      body = body.slice(body.indexOf("\n") + 1, closing);
    }
    files[filePath] = body.replace(/\s+$/, "") + "\n";
  }
  return { files, unterminated };
}

export class DeveloperAgent {
  private client: IAgentClient;
  private model: string;
  private steps: DeveloperStepRecord[] = [];
  private context: GenerationContext = {};

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
    const limits = this.context.limits;
    if (limits && this.steps.length >= limits.max_logical_calls) {
      throw new IncompleteResponseError(`${step}: max_logical_calls (${limits.max_logical_calls}) reached`);
    }
    const stepLimit = limits ? limitFor(limits, step) : null;
    const options: ChatOptions | null = limits && stepLimit
      ? {
          model: limits.model,
          max_tokens: stepLimit.max_tokens,
          timeout_ms: stepLimit.timeout_ms,
          max_retries: limits.app_max_retries,
        }
      : null;
    const record: DeveloperStepRecord = {
      step,
      api_requests_started: 1,
      outcome: "ok",
      prompt: { system: systemPrompt, user: prompt },
      applied_options: options,
      raw: null,
    };
    this.steps.push(record);

    try {
      const response = await this.client.chat(
        [{ role: "user", content: prompt }],
        systemPrompt,
        options ?? undefined
      );
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
    architectureContract: string,
    context: GenerationContext = {}
  ): Promise<DeveloperAgentResult> {
    console.log(`📋 Developer Agent executing plan: ${executionPlan.contract_id}`);

    this.context = context;
    this.steps = [];
    const result: DeveloperAgentResult = {
      status: "success",
      generatedCode: {},
      testCode: {},
      selfValidation: {},
      steps: this.steps,
    };

    try {
      // 단계별 담당 파일: generateCode = 앱 소스, generateTests = 테스트 (최종 required_files 전체는 저장 단계에서 검사)
      const { sourceFiles, testFiles } = splitTargetFiles(executionPlan.target_files);

      // Step 1: 코드 생성
      console.log(`\n📝 Step 1: 코드 생성 (${sourceFiles.length} 파일)`);
      result.generatedCode = await this.generateCode(executionPlan, architectureContract, sourceFiles);
      this.requireFiles("generateCode", sourceFiles, result.generatedCode);

      // Step 2: 테스트 생성
      console.log(`\n🧪 Step 2: 테스트 생성 (${testFiles.length} 파일)`);
      result.testCode = await this.generateTests(executionPlan, result.generatedCode, testFiles);
      this.requireFiles("generateTests", testFiles, result.testCode);

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

  // 잘린 섹션이 하나라도 있으면 해당 파일을 빼고 성공 처리하지 않음
  private rejectUnterminated(step: DeveloperStep, unterminated: string[]): void {
    if (unterminated.length === 0) return;
    const last = this.steps[this.steps.length - 1];
    last.outcome = "incomplete";
    last.error = `unterminated code block: ${unterminated.join(", ")}`;
    throw new IncompleteResponseError(`${step}: unterminated code block: ${unterminated.join(", ")}`);
  }

  private requireFiles(step: DeveloperStep, required: string[], produced: Record<string, string>): void {
    const missing = required.filter((f) => !(f in produced));
    if (missing.length === 0) return;
    const last = this.steps[this.steps.length - 1];
    last.outcome = "incomplete";
    last.error = `missing files: ${missing.join(", ")}`;
    throw new IncompleteResponseError(`${step}: missing files: ${missing.join(", ")}`);
  }

  /**
   * 생성 단위 모드: 계획의 단위를 순차 생성한다.
   * 각 응답은 파싱 전에 checkpoint로 저장하고, 오류·불완전 응답·담당 파일 불일치·구문/경로 오류면 즉시 중단한다.
   */
  async executeUnits(
    plan: GenerationPlan,
    executionPlan: ExecutionPlan,
    architectureContract: string,
    context: GenerationContext & {
      reusedFiles: Record<string, string>;
      onCheckpoint?: (cp: UnitCheckpoint) => Promise<void>;
    }
  ): Promise<DeveloperAgentResult> {
    this.context = context;
    this.steps = [];
    const produced: Record<string, string> = { ...context.reusedFiles };
    const result: DeveloperAgentResult = { status: "success", generatedCode: {}, testCode: {}, selfValidation: {}, steps: this.steps };
    const spec = context.requestSpec ? JSON.parse(context.requestSpec) : {};
    const reqById = new Map<string, unknown>((spec.requirement?.requirements || []).map((r: any) => [r.id, r]));

    for (let i = 0; i < plan.units.length; i++) {
      const unit = plan.units[i];
      const prompt = buildUnitPrompt(unit, plan, executionPlan, architectureContract, spec, reqById, produced, context);
      let content: string;
      const stepsBefore = this.steps.length;
      try {
        content = await this.callStep(unit.id, prompt, UNIT_SYSTEM_PROMPT);
      } catch (error) {
        const failedRecord = this.steps.length > stepsBefore ? this.steps[this.steps.length - 1] : null;
        await context.onCheckpoint?.({ unit: unit.id, phase: "failed", record: failedRecord });
        result.status = "failure";
        result.errors = [String(error)];
        return result;
      }
      const record = this.steps[this.steps.length - 1];
      // 파싱 전에 원문·usage·stop_reason 저장
      await context.onCheckpoint?.({ unit: unit.id, phase: "response", record });

      const { files, unterminated } = parseFileSections(content);
      const problems: string[] = [];
      if (unterminated.length > 0) problems.push(`unterminated code block: ${unterminated.join(", ")}`);
      const missing = unit.files.filter((f) => !(f in files));
      if (missing.length > 0) problems.push(`missing files: ${missing.join(", ")}`);
      const unexpected = Object.keys(files).filter((f) => !unit.files.includes(f));
      if (unexpected.length > 0) problems.push(`unexpected files (not owned by this unit): ${unexpected.join(", ")}`);

      const available = new Set([...Object.keys(produced), ...unit.files]);
      const pending = new Set(plan.units.slice(i + 1).flatMap((u) => u.files));
      const checks = unit.files.filter((f) => f in files).map((f) => checkUnitFile(f, files[f], available, pending));
      for (const c of checks) {
        if (c.syntax_errors.length) problems.push(`${c.file}: syntax: ${c.syntax_errors.join("; ")}`);
        if (c.import_errors.length) problems.push(`${c.file}: import: ${c.import_errors.join("; ")}`);
      }

      if (problems.length > 0) {
        record.outcome = unterminated.length || missing.length ? "incomplete" : "error";
        record.error = problems.join(" | ");
        await context.onCheckpoint?.({ unit: unit.id, phase: "failed", record, checks });
        result.status = "failure";
        result.errors = [`${unit.id}: ${record.error}`];
        return result;
      }

      for (const f of unit.files) produced[f] = files[f];
      await context.onCheckpoint?.({ unit: unit.id, phase: "passed", record, checks, files: Object.fromEntries(unit.files.map((f) => [f, files[f]])) });
    }

    for (const [f, code] of Object.entries(produced)) {
      if (isTestFile(f)) result.testCode[f] = code;
      else result.generatedCode[f] = code;
    }
    return result;
  }

  /**
   * Step 1: 앱 소스 코드 생성 (테스트 파일 제외)
   */
  private async generateCode(
    plan: ExecutionPlan,
    contractStr: string,
    sourceFiles: string[]
  ): Promise<Record<string, string>> {
    const fileList = sourceFiles.map((f) => `- ${f}`).join("\n");
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
- Source Files (generate exactly these, ALL of them):
${fileList}
- Bridge Usage: ${JSON.stringify(plan.bridge_usage)}
${platformSection}
## Architecture Contract (constraints)
${contractStr}

${contextSections(this.context)}

## Task
Generate COMPLETE, production-ready code for EACH source file listed above. Do not skip any files.
Implement every requirement in the Approved Request Spec (if given); do not add features it does not describe.
Do NOT write test files; tests are generated in a separate step.

Output format: For each file, start with "### File: <path>" on a new line, then the complete file content.
`;

    const content = await this.callStep("generateCode", prompt, "You are a professional TypeScript developer.");
    const { files, unterminated } = parseFileSections(content);
    this.rejectUnterminated("generateCode", unterminated);
    return Object.fromEntries(Object.entries(files).filter(([p]) => !isTestFile(p)));
  }

  /**
   * Step 2: 테스트 생성
   */
  private async generateTests(
    plan: ExecutionPlan,
    generatedCode: Record<string, string>,
    testFiles: string[]
  ): Promise<Record<string, string>> {
    const codeStr = Object.entries(generatedCode)
      .map(([path, code]) => `File: ${path}\n${code}`)
      .join("\n\n---\n\n");

    const prompt = `
You are writing tests for the generated code.

## Generated Code
${codeStr}
${this.context.requestSpec ? `
## Approved Request Spec
${this.context.requestSpec}

Write the tests against the approved requirements and their acceptance criteria, NOT against whatever the generated code currently does.
Include the requirement ID in each test name (e.g. "REQ-PRD-03: ...").
` : ""}
## Task
Write comprehensive test cases covering:
1. Main functionality
2. Error cases
3. Edge cases

Output format: For each test file, start with "### Test: <path>" on a new line, then the test code.
${testFiles.length > 0
  ? `Test Files (generate exactly these, ALL of them):\n${testFiles.map((f) => `- ${f}`).join("\n")}`
  : "Target files should be in tests/ directory with similar structure."}
${plan.platform_files?.length ? 'Use vitest (import { describe, it, expect, vi } from "vitest") with @testing-library/react (jsdom, jest-dom matchers preloaded). Import the component from "../src/App".' : ""}
`;

    const content = await this.callStep(
      "generateTests",
      prompt,
      "You are an experienced QA engineer writing comprehensive tests."
    );
    const { files, unterminated } = parseFileSections(content);
    this.rejectUnterminated("generateTests", unterminated);
    return Object.fromEntries(Object.entries(files).filter(([p]) => isTestFile(p)));
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
${this.context.requestSpec ? `
## Approved Request Spec
${this.context.requestSpec}
` : ""}
## Task
Check if the generated code completely implements the execution plan${this.context.requestSpec ? " and the approved requirements (list uncovered requirement IDs under \"issues\")" : ""}.
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
