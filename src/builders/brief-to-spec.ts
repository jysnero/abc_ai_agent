/**
 * Brief to Spec Converter
 *
 * 자연어 기획 (brief.md) → request-spec.json 변환
 * v0.1: Fake 기반 간단한 변환
 */

import type { IAgentClient } from "../runtime/agent-client.js";

export interface BriefContent {
  title: string;
  description: string;
  requirements: string[];
  design: string;
}

export async function briefToSpec(
  briefContent: string,
  agentClient: IAgentClient
): Promise<Record<string, unknown>> {
  // v0.1: Fake 기반 변환 (실제 Claude 호출은 나중에)
  // 사용자의 자연어를 파싱해서 기본 구조 생성

  const lines = briefContent.split("\n").map(l => l.trim());

  return {
    type: "webview-component",
    version: "1.0",
    name: extractTitle(lines),
    description: extractDescription(briefContent),
    requirement: {
      summary: extractSummary(lines),
      details: extractRequirements(lines),
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
  return lines.find(l => l.length > 0) || "Generated Component";
}

function extractDescription(content: string): string {
  const lines = content.split("\n");
  return lines.slice(0, 3).join(" ").trim();
}

function extractSummary(lines: string[]): string {
  return lines
    .filter(l => l.length > 0 && !l.startsWith("#"))
    .slice(0, 1)
    .join(" ");
}

function extractRequirements(lines: string[]): string[] {
  return lines
    .filter(l => l.startsWith("- ") || l.startsWith("* "))
    .map(l => l.replace(/^[-*]\s+/, ""));
}
