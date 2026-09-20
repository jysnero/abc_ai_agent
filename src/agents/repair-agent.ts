/**
 * Repair Agent
 *
 * Validation 실패 시 자동으로 코드를 수정하려는 Developer Agent
 *
 * 제약:
 * 1. Bridge API 호출 금지 (새로운 서비스 생성 불가)
 * 2. 금지된 경로 수정 불가
 * 3. 새로운 의존성 추가 금지
 * 4. 최대 3회까지만 재시도 가능
 */

import type { IAgentClient } from "../runtime/agent-client.js";
import type { ExecutionPlan } from "../orchestrator.js";
import type { ValidationReport } from "../validation/validation-runner.js";

export interface RepairRequest {
  executionPlan: ExecutionPlan;
  architectureContract: Record<string, unknown>; // JSON 객체
  previousResult: Record<string, unknown>; // 이전 Developer Agent 결과
  validationReport: ValidationReport; // 검증 실패 내용
  retryCount: number; // 현재 재시도 횟수 (1~3)
}

export interface RepairResult {
  status: "success" | "failure";
  generatedCode: Record<string, string>;
  testCode: Record<string, string>;
  repairStrategy: string; // 어떻게 수정했는지
  selfValidation?: Record<string, unknown>; // 선택적
  errors?: string[];
}

/**
 * Auto-Repair: Validation 실패 시 자동 수정
 */
export async function autoRepair(
  client: IAgentClient,
  request: RepairRequest
): Promise<RepairResult> {
  if (request.retryCount > 3) {
    return {
      status: "failure",
      generatedCode: {},
      testCode: {},
      repairStrategy: "Maximum repair attempts exceeded (3)",
      errors: ["Cannot repair: exceeded maximum retry count"],
    };
  }

  const prompt = buildRepairPrompt(request);
  const systemPrompt =
    "You are a code repair specialist. Fix the code to pass validation while respecting the architecture constraints.";

  const response = await client.chat(
    [
      {
        role: "user",
        content: prompt,
      },
    ],
    systemPrompt
  );

  // Parse response
  let result: RepairResult;
  try {
    const parsed = JSON.parse(response.content);
    result = {
      status: parsed.status,
      generatedCode: parsed.generatedCode || {},
      testCode: parsed.testCode || {},
      repairStrategy: parsed.repairStrategy || "Unknown",
      errors: parsed.errors,
    };
  } catch {
    result = {
      status: "failure",
      generatedCode: {},
      testCode: {},
      repairStrategy: "Failed to parse response",
      errors: ["Response parsing failed"],
    };
  }

  return result;
}

/**
 * Repair 프롬프트 생성
 */
function buildRepairPrompt(request: RepairRequest): string {
  return `
Your task: Fix the previously generated code to pass validation.

CONSTRAINTS (MUST OBEY):
1. NO new Bridge API calls (cannot add external service integrations)
2. DO NOT modify protected paths: ${
    Array.isArray(request.architectureContract.protected_paths)
      ? (request.architectureContract.protected_paths as string[]).join(", ")
      : "none"
  }
3. NO new dependencies (npm packages)
4. Retry count: ${request.retryCount}/3

Previous attempt result:
\`\`\`json
${JSON.stringify(request.previousResult, null, 2)}
\`\`\`

Validation failures:
\`\`\`json
${JSON.stringify(request.validationReport, null, 2)}
\`\`\`

Generate a JSON response with:
{
  "status": "success" | "failure",
  "generatedCode": { "path/file.ts": "content" },
  "testCode": { "path/test.ts": "content" },
  "repairStrategy": "description of what you fixed",
  "errors": ["error messages if status=failure"]
}

Focus on fixing:
- TypeScript compilation errors
- Missing target files
- Architecture validation failures

Do NOT:
- Add new files outside execution plan
- Call external APIs
- Add new npm packages
`;
}
