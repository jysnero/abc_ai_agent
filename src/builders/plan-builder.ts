/**
 * Execution Plan Builder
 *
 * architecture-contract.json을 읽어 execution-plan.json을 결정론적으로 생성합니다.
 * v0.1: 규칙 기반 생성 (LLM 불사용)
 *
 * 경로 정규화: Windows \ → / 변환, 상대경로 확인
 * Glob 매칭: minimatch 사용
 * 우선순위: forbidden > readonly > writable
 */

import type { ExecutionPlan } from "../orchestrator.js";
import { minimatch } from "minimatch";

export type { ExecutionPlan };

export interface ArchitectureContract {
  contract_id: string;
  version: string;
  pattern_type: string;
  issued_by: string;
  folder_structure: {
    required_files: string[];
    allowed_globs: string[];
  };
  allowed_dependencies: {
    script_hosts: string[];
    npm_packages: string[];
  };
  bridge_contract_ref: {
    contract_id: string;
    path: string;
  };
  bridge_policy: Record<string, {
    max_calls_per_session: number;
    requires_approval?: boolean;
  }>;
  forbidden_patterns: Array<{
    id: string;
    regex: string;
    reason: string;
    severity: "block" | "warn";
  }>;
  design_tokens_ref: string;
}

/**
 * Architecture Contract로부터 Execution Plan 생성
 * v0.1: 최소 집합 (required_files만 포함)
 */
export function buildExecutionPlan(
  contract: ArchitectureContract
): ExecutionPlan {
  // v0.1: required_files를 target_files로 변환 (모두 포함)
  const targetFiles = contract.folder_structure.required_files;

  // v0.1: bridge_policy의 메서드 모두를 포함 (호출 횟수는 0으로 초기화)
  const bridgeUsage: Record<string, number> = {};
  for (const methodName in contract.bridge_policy) {
    bridgeUsage[methodName] = 0;
  }

  const executionPlan: ExecutionPlan = {
    contract_id: contract.contract_id,
    version: contract.version,
    request_spec_revision: "",  // placeholder, set by caller
    target_files: targetFiles,
    bridge_usage: bridgeUsage,
    validation_commands: [
      { check_id: "architecture", command: "node scripts/check-architecture.mjs" },
      { check_id: "tests", command: "npm test" },
    ],
    completion_criteria: {
      required_files_created: targetFiles,
      all_validation_pass: true,
      forbidden_patterns: "block_free",
    },
    generated_at: new Date().toISOString(),
    generated_by: "plan_builder",
  };

  return executionPlan;
}

/**
 * Execution Plan 검증
 * execution_plan ⊆ architecture_contract 확인
 * 경로 보안 검사 포함
 */
export function validateExecutionPlan(
  plan: ExecutionPlan,
  contract: ArchitectureContract,
  workspace: string = process.cwd()
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. contract_id 일치 확인
  if (plan.contract_id !== contract.contract_id) {
    errors.push(
      `contract_id mismatch: plan has ${plan.contract_id}, contract has ${contract.contract_id}`
    );
  }

  // 2. target_files ⊆ allowed_globs 확인 (보안 검사 포함)
  for (const file of plan.target_files) {
    // 경로 탈출 검사
    const { isValid, error } = normalizePath(file, workspace);
    if (!isValid) {
      errors.push(`target_file "${file}": ${error}`);
      continue;
    }

    // glob 매칭 검사
    const isAllowed = contract.folder_structure.allowed_globs.some((glob) =>
      isGlobMatch(file, glob, workspace)
    );
    if (!isAllowed) {
      errors.push(`target_file "${file}" does not match any allowed_glob`);
    }
  }

  // 3. bridge_usage ⊆ bridge_policy 확인
  for (const methodName in plan.bridge_usage) {
    if (!(methodName in contract.bridge_policy)) {
      errors.push(`bridge method "${methodName}" not in bridge_policy`);
    } else {
      const maxCalls = contract.bridge_policy[methodName].max_calls_per_session;
      const usage = plan.bridge_usage[methodName];
      if (usage > maxCalls) {
        errors.push(
          `bridge method "${methodName}" usage (${usage}) exceeds max_calls (${maxCalls})`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

import path from "path";

/**
 * 경로 보안 검증: 작업공간 탈출 차단
 *
 * 검사 항목:
 * - 절대경로 (Unix, Windows)
 * - Windows 드라이브 경로 (C:\, D:\, ...)
 * - UNC 경로 (\\server\share)
 * - 부모 디렉토리 탈출 (../)
 * - 정규화 후 작업공간 외부
 *
 * 안전성: path.resolve + path.relative 사용
 */
function normalizePath(
  filePath: string,
  workspace: string = process.cwd()
): { normalized: string; isValid: boolean; error?: string } {
  // 1. Windows 경로를 POSIX로 변환
  const posixPath = filePath.replace(/\\/g, "/");

  // 2. 절대경로 감지
  if (path.isAbsolute(filePath) || posixPath.startsWith("/")) {
    return { normalized: filePath, isValid: false, error: "Absolute path not allowed" };
  }

  // 3. Windows 드라이브 경로 감지 (C:, D:, ...)
  if (/^[a-zA-Z]:/.test(filePath)) {
    return { normalized: filePath, isValid: false, error: "Windows drive path not allowed" };
  }

  // 4. UNC 경로 감지 (\\server\share)
  if (posixPath.startsWith("//") || filePath.startsWith("\\\\")) {
    return { normalized: filePath, isValid: false, error: "UNC path not allowed" };
  }

  // 5. 빠른 문자열 검사 (../ 직접 포함)
  if (posixPath.includes("../") || posixPath.startsWith("..")) {
    return { normalized: filePath, isValid: false, error: "Parent directory traversal detected" };
  }

  // 6. 정규화 후 작업공간 외부 확인
  try {
    const resolved = path.resolve(workspace, filePath);
    const relative = path.relative(workspace, resolved);

    // relative가 .. 로 시작하면 작업공간 외부
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return {
        normalized: filePath,
        isValid: false,
        error: "Path escapes workspace after normalization",
      };
    }

    // 정규화된 경로 반환
    const normalized = relative.replace(/\\/g, "/");
    return { normalized, isValid: true };
  } catch (err) {
    return {
      normalized: filePath,
      isValid: false,
      error: `Path resolution failed: ${err}`,
    };
  }
}

/**
 * Minimatch 기반 glob 패턴 매칭
 * Windows와 POSIX 경로 모두 지원
 * 작업공간 탈출 경로는 거부
 */
function isGlobMatch(
  filePath: string,
  globPattern: string,
  workspace: string = process.cwd()
): boolean {
  const { normalized, isValid } = normalizePath(filePath, workspace);

  // 정규화 실패 (절대경로, ../ 포함, 작업공간 탈출)
  if (!isValid) return false;

  // 정규화된 패턴
  const normalizedPattern = globPattern.replace(/\\/g, "/");

  // Minimatch를 사용한 매칭 (동일한 옵션)
  try {
    return minimatch(normalized, normalizedPattern, {
      noglobstar: false,
      noext: false,
      nocase: false, // 대소문자 구분 (Unix 스타일)
    });
  } catch {
    // 패턴이 유효하지 않으면 정확한 매칭만 시도
    return normalized === normalizedPattern;
  }
}
