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
 * 자연어 기획 → request-spec 생성 (실제 Claude API 호출)
 * agentClient.generateResponse() 또는 Fake 기반
 */
async function generateRequestSpecFromBrief(
  briefContent: string
): Promise<any> {
  // 실제 Claude API 호출: brief.md → request-spec JSON
  const systemPrompt = `You are an expert web component specification generator.
Your task is to parse natural language requirements and generate a JSON spec.

Output ONLY valid JSON with this structure (no markdown, no code blocks):
{
  "type": "webview-component",
  "version": "1.0",
  "name": "Component name",
  "description": "One-line description",
  "requirement": {
    "summary": "Brief summary",
    "details": ["requirement 1", "requirement 2", ...]
  },
  "constraints": {
    "language": "TypeScript",
    "framework": "React 18+",
    "style": "Tailwind CSS only"
  },
  "expected_files": {
    "component": "src/App.tsx",
    "demo": "demo/index.html",
    "docs": "README.md"
  }
}`;

  const userMessage = `Parse this requirement and generate a JSON spec:\n\n${briefContent}`;

  // Use Anthropic SDK directly (no Agent SDK wrapper)
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    // Extract JSON from response
    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    const text = content.text.trim();
    // Remove markdown code blocks if present
    let jsonText = text;
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/^```json\n/, "").replace(/\n```$/, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```\n/, "").replace(/\n```$/, "");
    }

    console.log("[Brief] API Response tokens - input:", response.usage.input_tokens, "output:", response.usage.output_tokens);

    return JSON.parse(jsonText);
  } catch (err) {
    // Fallback to rule-based generation if API fails
    console.warn("[Brief] API call failed, falling back to rule-based generation:", (err as Error).message);
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

    // 3. Generate request-spec from brief (실제 Claude API 호출)
    const requestSpec = await generateRequestSpecFromBrief(briefContent);

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
