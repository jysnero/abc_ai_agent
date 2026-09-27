/**
 * Claude Agent Client
 *
 * Anthropic SDK를 사용한 AgentClient 구현
 * 재시도, 타임아웃, 에러 처리 포함
 */

import { Anthropic } from "@anthropic-ai/sdk";
import type {
  IAgentClient,
  AgentClientConfig,
  AgentMessage,
  AgentResponse,
} from "./agent-client.js";

/**
 * Claude Agent Client 구현
 */
export class ClaudeAgentClient implements IAgentClient {
  private client: Anthropic;
  private config: Required<AgentClientConfig>;

  constructor(config: AgentClientConfig = {}) {
    this.config = {
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY || "",
      timeout_ms: config.timeout_ms ?? 60000,
      max_retries: config.max_retries ?? 3,
      retry_delay_ms: config.retry_delay_ms ?? 1000,
    };

    this.client = new Anthropic({
      apiKey: this.config.apiKey,
      timeout: this.config.timeout_ms,
    });
  }

  /**
   * 메시지 전송 (재시도 포함)
   */
  async chat(
    messages: AgentMessage[],
    systemPrompt?: string
  ): Promise<AgentResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.max_retries; attempt++) {
      try {
        console.log(`[ClaudeAgentClient] chat attempt ${attempt + 1}/${this.config.max_retries + 1}, apiKey=${this.config.apiKey ? 'set' : 'unset'}`);
        const response = await this.client.messages.create({
          model: "claude-opus-5-5",
          max_tokens: 8192,
          system: systemPrompt,
          messages: messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
        });

        // 응답 추출 (Extended Thinking 지원: thinking + text 콘텐츠)
        const textBlock = response.content.find((block: any) => block.type === "text");
        const content = textBlock && textBlock.type === "text" ? textBlock.text : "";

        const blockTypes = response.content.map((b: any) => `${b.type}(${b.type === "text" ? b.text.length : 0})`).join(", ");
        console.log(`[ClaudeAgentClient] success! blocks=[${blockTypes}], text_found=${!!textBlock}, content.length=${content.length}, tokens: input=${response.usage.input_tokens}, output=${response.usage.output_tokens}`);
        return {
          content,
          stop_reason: response.stop_reason as "end_turn" | "max_tokens" | "stop_sequence",
          usage: {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
          },
        };
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 마지막 시도가 아니면 대기 후 재시도
        if (attempt < this.config.max_retries) {
          const delay = this.config.retry_delay_ms * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(
      `Agent chat failed after ${this.config.max_retries} retries: ${lastError?.message}`
    );
  }

  /**
   * 스트리밍 응답 (v0.2+)
   */
  async streamChat(
    messages: AgentMessage[],
    systemPrompt?: string,
    onChunk?: (chunk: string) => void
  ): Promise<AgentResponse> {
    // v0.1: 스트리밍 미지원, 일단 일반 chat으로 대체
    const response = await this.chat(messages, systemPrompt);

    if (onChunk) {
      onChunk(response.content);
    }

    return response;
  }
}

/**
 * 팩토리 함수
 */
export function createClaudeAgentClient(
  config: AgentClientConfig
): IAgentClient {
  return new ClaudeAgentClient(config);
}
