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
  EffectiveClientConfig,
  RawAgentResponse,
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
      model: config.model ?? "claude-opus-5-5",
      max_tokens: config.max_tokens ?? 8192,
      timeout_ms: config.timeout_ms ?? 60000,
      max_retries: config.max_retries ?? 3,
      retry_delay_ms: config.retry_delay_ms ?? 1000,
    };

    this.client = new Anthropic({
      apiKey: this.config.apiKey,
      timeout: this.config.timeout_ms,
      maxRetries: 0,  // SDK 내부 재시도 비활성화 (앱 레벨에서 제어)
    });
  }

  getEffectiveConfig(): EffectiveClientConfig {
    return {
      model: this.config.model,
      max_tokens: this.config.max_tokens,
      timeout_ms: this.client.timeout,
      app_max_retries: this.config.max_retries,
      sdk_max_retries: this.client.maxRetries,
    };
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
          model: this.config.model,
          max_tokens: this.config.max_tokens,
          system: systemPrompt,
          messages: messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
        });

        // 응답 추출: 모든 text 블록을 순서대로 연결 (thinking 제외)
        const textBlocks = response.content.filter(
          (block: any) => block.type === "text"
        );

        if (textBlocks.length === 0) {
          const blockTypes = response.content.map((b: any) => b.type);
          const err = new Error(`No text content in response. Blocks: ${blockTypes.join(", ")}`);
          const raw: RawAgentResponse = {
            stop_reason: response.stop_reason ?? null,
            usage: {
              input_tokens: response.usage.input_tokens,
              output_tokens: response.usage.output_tokens,
            },
            block_types: blockTypes,
            text: "",
          };
          (err as Error & { raw?: RawAgentResponse }).raw = raw;
          // 응답을 받은 뒤의 형식 오류는 재시도하지 않음 (과금 요청 추가 방지)
          (err as Error & { noRetry?: boolean }).noRetry = true;
          throw err;
        }

        const content = textBlocks.map((b: any) => (b as any).text).join("\n");
        const blockSummary = response.content
          .map((b: any) => {
            if (b.type === "text") {
              return `text(${(b as any).text.length})`;
            } else if (b.type === "thinking") {
              return `thinking(${(b as any).thinking?.length || 0})`;
            }
            return `${b.type}(?)`;
          })
          .join(", ");

        console.log(
          `[ClaudeAgentClient] success! blocks=[${blockSummary}], text_blocks=${textBlocks.length}, content_length=${content.length}, ` +
          `tokens: input=${response.usage.input_tokens}, output=${response.usage.output_tokens}, stop_reason=${response.stop_reason}`
        );
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
        if ((lastError as Error & { noRetry?: boolean }).noRetry) {
          throw lastError;
        }

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
