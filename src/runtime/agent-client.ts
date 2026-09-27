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
  model?: string;
  max_tokens?: number;
  timeout_ms?: number;
  max_retries?: number;
  retry_delay_ms?: number;
}

export interface EffectiveClientConfig {
  model: string;
  max_tokens: number;
  timeout_ms: number;
  app_max_retries: number;
  sdk_max_retries: number;
}

/** 요청 단위 설정 (지정하지 않으면 client 설정 사용) */
export interface ChatOptions {
  model?: string;
  max_tokens?: number;
  timeout_ms?: number;
  max_retries?: number;
}

export interface RawAgentResponse {
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  block_types: string[];
  text: string;
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
  chat(messages: AgentMessage[], systemPrompt?: string, options?: ChatOptions): Promise<AgentResponse>;

  getEffectiveConfig?(): EffectiveClientConfig;

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
