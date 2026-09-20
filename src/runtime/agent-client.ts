/**
 * Agent Client Interface
 *
 * Developer Agent가 LLM과 통신하는 추상 인터페이스
 * 구현: claude-agent-client.ts
 *
 * 목적: SDK를 직접 import하지 않고, 의존성 역전
 */

import { ClaudeAgentClient } from "./claude-agent-client.js";

export interface AgentClientConfig {
  apiKey?: string;
  timeout_ms?: number;
  max_retries?: number;
  retry_delay_ms?: number;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentResponse {
  content: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence";
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Agent Client 추상 인터페이스
 */
export interface IAgentClient {
  /**
   * LLM에 메시지를 전송하고 응답을 받음
   */
  chat(messages: AgentMessage[], systemPrompt?: string): Promise<AgentResponse>;

  /**
   * 스트리밍 응답 (v0.2+)
   */
  streamChat?(
    messages: AgentMessage[],
    systemPrompt?: string,
    onChunk?: (chunk: string) => void
  ): Promise<AgentResponse>;
}

/**
 * Agent Client 팩토리
 * v0.1: ClaudeAgentClient만 지원
 */
export function createAgentClient(config: AgentClientConfig): IAgentClient {
  return new ClaudeAgentClient(config);
}
