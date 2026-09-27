/**
 * brief command: Natural language input workflow
 *
 * Usage: orchestrate brief --file path/to/brief.md --template examples/valid-minigame-contract
 *
 * 흐름:
 * 1. brief.md 읽기
 * 2. Claude API로 자연어 → request-spec 생성 (또는 Fake 주입)
 * 3. request-spec 검증
 * 4. architecture-contract 로드
 * 5. execution-plan 생성
 * 6. HUMAN_GATE_SPEC 상태로 run 시작
 */

import fs from "fs";
import path from "path";
import type { WorkflowRunner } from "../../workflow/workflow-runner.js";
import type { IAgentClient } from "../../runtime/agent-client.js";
import { ExitCode } from "../cli-errors.js";
import { JsonFormatter } from "../output/formatter.js";
import { buildExecutionPlan } from "../../builders/plan-builder.js";

export interface BriefCommandOptions {
  file: string;
  template?: string;
  json?: boolean;
}

/**
 * 자연어 기획 → request-spec 생성 (Claude 호출)
 * 테스트에서는 FakeAgentClient 주입
 */
async function generateRequestSpecFromBrief(
  briefContent: string,
  agentClient: IAgentClient
): Promise<any> {
  // Claude API 호출: brief.md → request-spec
  // v0.1: 실제 호출은 미실행, FakeAgentClient로 테스트
  const prompt = `
당신은 웹뷰 컴포넌트 명세 생성 전문가입니다.
다음 자연어 기획서를 읽고 request-spec JSON을 생성하세요.

요구사항:
- type: "webview-component"
- version: "1.0"
- name: 컴포넌트 이름
- description: 한 줄 설명
- requirement.summary: 기획 요약
- requirement.details: 요구사항 배열
- constraints: 제약조건 (language, framework, style)
- expected_files: 예상 결과물 파일

기획서:
${briefContent}

JSON만 반환하세요 (설명 없음).
`;

  // TODO: 실제 Claude API 호출 (API 키 설정 후)
  // const response = await agentClient.createMessage({ prompt });

  // v0.1: FakeAgentClient는 기본값 반환
  // 실제 호출: agentClient.generateResponse(prompt)를 사용하되, 구현은 다음 phase

  return {
    type: "webview-component",
    version: "1.0",
    name: extractTitle(briefContent.split("\n")),
    description: extractDescription(briefContent),
    requirement: {
      summary: extractSummary(briefContent.split("\n")),
      details: extractRequirements(briefContent.split("\n")),
    },
    constraints: {
      language: "TypeScript",
      framework: "React 18+",
      style: "Tailwind CSS only",
    },
    expected_files: {
      component: "src/App.tsx",
      demo: "demo/index.html",
      docs: "README.md",
    },
  };
}

function extractTitle(lines: string[]): string {
  return lines.find(l => l.trim().length > 0) || "Generated Component";
}

function extractDescription(content: string): string {
  const lines = content.split("\n");
  return lines.slice(0, 3).join(" ").trim();
}

function extractSummary(lines: string[]): string {
  return lines
    .filter(l => l.trim().length > 0 && !l.startsWith("#"))
    .slice(0, 1)
    .join(" ");
}

function extractRequirements(lines: string[]): string[] {
  return lines
    .filter(l => l.trim().startsWith("- ") || l.trim().startsWith("* "))
    .map(l => l.trim().replace(/^[-*]\s+/, ""));
}

export async function briefCommand(
  runner: WorkflowRunner,
  opts: BriefCommandOptions
): Promise<{ output: string; exitCode: number }> {
  try {
    // 1. Validate input
    if (!opts.file) {
      return {
        output: JsonFormatter.formatError(
          "Missing required option: --file <path>",
          ExitCode.CLI_ARGS_ERROR
        ),
        exitCode: ExitCode.CLI_ARGS_ERROR,
      };
    }

    if (!fs.existsSync(opts.file)) {
      return {
        output: JsonFormatter.formatError(
          `Brief file not found: ${opts.file}`,
          ExitCode.INPUT_FILE_ERROR
        ),
        exitCode: ExitCode.INPUT_FILE_ERROR,
      };
    }

    const briefContent = fs.readFileSync(opts.file, "utf-8");

    // 2. Load architecture contract
    const template = opts.template || "examples/valid-minigame-contract";
    const contractPath = path.resolve(
      process.cwd(),
      `contracts/${template}.json`
    );

    if (!fs.existsSync(contractPath)) {
      return {
        output: JsonFormatter.formatError(
          `Contract not found: ${contractPath}`,
          ExitCode.INPUT_FILE_ERROR
        ),
        exitCode: ExitCode.INPUT_FILE_ERROR,
      };
    }

    const contract = JSON.parse(fs.readFileSync(contractPath, "utf-8"));

    // 3. Generate request-spec from brief (Claude API 또는 Fake)
    // v0.1: FakeAgentClient 사용, 실제 호출은 Workflow에서 처리
    const requestSpec = await generateRequestSpecFromBrief(briefContent, null as any);

    // 4. Validate request-spec against schema
    if (!requestSpec.type || !requestSpec.name) {
      return {
        output: JsonFormatter.formatError(
          "Invalid request-spec: missing required fields (type, name)",
          ExitCode.WORKFLOW_ERROR
        ),
        exitCode: ExitCode.WORKFLOW_ERROR,
      };
    }

    // 5. Build execution plan from contract
    const plan = buildExecutionPlan(contract);

    // 6. Prepare spec and contract JSON strings for startRun
    const requestSpecJson = JSON.stringify(requestSpec);
    const contractJson = JSON.stringify(contract);

    // 7. Create workflow run at HUMAN_GATE_SPEC
    const runId = await runner.startRun({
      requestSpec: requestSpecJson,
      architectureContract: contractJson,
    });

    // 8. Output summary for review
    const output = {
      ok: true,
      run_id: runId,
      message: "Brief processed: request-spec ready for approval",
      state: "HUMAN_GATE_SPEC",
      request_spec_summary: {
        name: requestSpec.name,
        description: requestSpec.description,
        requirements_count: requestSpec.requirement.details.length,
      },
      contract_summary: {
        contract_id: contract.contract_id,
        target_files: plan.target_files.length,
        validation_checks: plan.validation_commands.length,
      },
      next_step: `Run 'orchestrate approve-spec --run-id ${runId} --approver <name>' to continue`,
    };

    return {
      output: JSON.stringify(output, null, 2),
      exitCode: ExitCode.SUCCESS,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      output: JsonFormatter.formatError(msg, ExitCode.WORKFLOW_ERROR),
      exitCode: ExitCode.WORKFLOW_ERROR,
    };
  }
}
