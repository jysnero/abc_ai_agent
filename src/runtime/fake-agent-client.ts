/**
 * Fake Agent Client
 *
 * 테스트용 mock AgentClient
 * 실제 Claude API 호출 없이 통합 테스트 가능
 */

import type { IAgentClient, AgentClientConfig, AgentMessage, AgentResponse } from "./agent-client.js";

export enum FakeScenario {
  SUCCESS = "success",                    // 정상 완료
  VALIDATION_FAILURE = "validation_failure", // 검증 실패
  REPAIR_FAILURE = "repair_failure",      // 수정 실패 (3회 초과)
  RANGE_EXCEEDED = "range_exceeded",      // 범위 초과
}

/**
 * Fake Agent Client 구현
 */
export class FakeAgentClient implements IAgentClient {
  private scenario: FakeScenario;
  private callCount: number = 0;

  constructor(scenario: FakeScenario = FakeScenario.SUCCESS) {
    this.scenario = scenario;
  }

  getCallCount(): number {
    return this.callCount;
  }

  async chat(
    messages: AgentMessage[],
    systemPrompt?: string
  ): Promise<AgentResponse> {
    this.callCount++;

    // 시나리오별 응답
    switch (this.scenario) {
      case FakeScenario.SUCCESS:
        return this.generateSuccessResponse();

      case FakeScenario.VALIDATION_FAILURE:
        return this.generateValidationFailureResponse();

      case FakeScenario.REPAIR_FAILURE:
        // 3회 이상이면 포기
        if (this.callCount > 3) {
          return this.generateRepairFailureResponse();
        }
        return this.generateValidationFailureResponse();

      case FakeScenario.RANGE_EXCEEDED:
        return this.generateRangeExceededResponse();

      default:
        return this.generateSuccessResponse();
    }
  }

  /**
   * 정상 응답
   */
  private generateSuccessResponse(): AgentResponse {
    return {
      content: JSON.stringify({
        status: "success",
        generatedCode: {
          "src/main.ts": "export function main() { console.log('Hello'); }",
          "src/utils.ts": "export function util() { return 42; }",
        },
        testCode: {
          "tests/main.test.ts": "test('main', () => { expect(true).toBe(true); });",
        },
        selfValidation: {
          completeness: "yes",
          coverage: ["src/main.ts", "src/utils.ts"],
          missing: [],
          issues: [],
          notes: "All target files generated with proper type safety",
        },
      }),
      stop_reason: "end_turn",
      usage: { input_tokens: 500, output_tokens: 500 },
    };
  }

  /**
   * 검증 실패 응답
   */
  private generateValidationFailureResponse(): AgentResponse {
    return {
      content: JSON.stringify({
        status: "success",
        generatedCode: {
          "src/main.ts": "export function main() { console.log('Hello'); }", // 타입 오류 포함
        },
        testCode: {},
        selfValidation: {
          completeness: "partial",
          coverage: ["src/main.ts"],
          missing: ["src/utils.ts"],
          issues: ["TypeScript compilation error: Type mismatch"],
          notes: "Missing some target files",
        },
      }),
      stop_reason: "end_turn",
      usage: { input_tokens: 500, output_tokens: 300 },
    };
  }

  /**
   * 수정 실패 응답
   */
  private generateRepairFailureResponse(): AgentResponse {
    return {
      content: JSON.stringify({
        status: "failure",
        generatedCode: {},
        testCode: {},
        selfValidation: {
          completeness: "no",
          coverage: [],
          missing: ["all"],
          issues: ["Cannot generate code within constraints"],
          notes: "Maximum repair attempts exceeded",
        },
      }),
      stop_reason: "end_turn",
      usage: { input_tokens: 500, output_tokens: 200 },
    };
  }

  /**
   * 범위 초과 응답
   */
  private generateRangeExceededResponse(): AgentResponse {
    return {
      content: JSON.stringify({
        status: "success",
        generatedCode: {
          "src/main.ts": "...",
          "src/unauthorized/new-file.ts": "// New file outside execution plan",
        },
        testCode: {},
        selfValidation: {
          completeness: "yes",
          coverage: ["src/main.ts", "src/unauthorized/new-file.ts"],
          missing: [],
          issues: [],
          notes: "Added file outside architecture contract",
        },
      }),
      stop_reason: "end_turn",
      usage: { input_tokens: 500, output_tokens: 400 },
    };
  }
}
