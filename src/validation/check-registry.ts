/**
 * Check Registry
 *
 * Approved validation checks와 그들의 실행 설정을 관리합니다.
 * execution-plan의 validation_commands는 check_id만 받고,
 * 실제 executable과 arguments는 여기서 결정합니다.
 *
 * 보안 조건:
 * - shell 사용 금지
 * - executable과 arguments 분리
 * - 허용된 환경변수만 전달
 */

export interface CheckDefinition {
  id: string;
  command: string;           // executable 경로
  args: string[];            // arguments
  timeout_ms: number;
  max_output_bytes: number;
  cwd: string;               // 실행 디렉토리 (workspace)
  allowed_env_vars?: string[]; // 전달할 환경변수 (기본: PATH, HOME, TEMP)
  sensitive_patterns?: RegExp[]; // 로그에서 마스킹할 패턴
}

/**
 * 등록된 checks
 * v0.1에서는 4가지 check만 지원
 */
export const CHECK_REGISTRY: Record<string, CheckDefinition> = {
  "typecheck": {
    id: "typecheck",
    command: "npx",
    args: ["tsc", "--noEmit"],
    timeout_ms: 30000,
    max_output_bytes: 1024 * 100, // 100KB
    cwd: process.cwd(),
    allowed_env_vars: ["PATH", "HOME", "TEMP", "NODE_PATH"],
  },

  "unit-test": {
    id: "unit-test",
    command: "npm",
    args: ["test"],
    timeout_ms: 60000,
    max_output_bytes: 1024 * 500, // 500KB
    cwd: process.cwd(),
    allowed_env_vars: ["PATH", "HOME", "TEMP", "NODE_PATH"],
  },

  "architecture-check": {
    id: "architecture-check",
    command: "node",
    args: ["scripts/check-architecture.mjs"],
    timeout_ms: 30000,
    max_output_bytes: 1024 * 100,
    cwd: process.cwd(),
    allowed_env_vars: ["PATH", "HOME", "TEMP"],
  },

  "build": {
    id: "build",
    command: "npm",
    args: ["run", "build"],
    timeout_ms: 60000,
    max_output_bytes: 1024 * 200, // 200KB
    cwd: process.cwd(),
    allowed_env_vars: ["PATH", "HOME", "TEMP", "NODE_PATH"],
  },
};

/**
 * Check ID로 CheckDefinition 조회
 * 등록되지 않은 ID는 null 반환
 */
export function getCheckDefinition(checkId: string): CheckDefinition | null {
  return CHECK_REGISTRY[checkId] ?? null;
}

/**
 * 모든 등록된 check ID 조회
 */
export function listAvailableChecks(): string[] {
  return Object.keys(CHECK_REGISTRY);
}

/**
 * 환경변수 필터링 (허용된 것만 전달)
 */
export function filterEnvironmentVariables(
  check: CheckDefinition,
  source: Record<string, string> = process.env as Record<string, string>
): Record<string, string> {
  const allowed = check.allowed_env_vars || ["PATH", "HOME", "TEMP"];
  const filtered: Record<string, string> = {};

  for (const key of allowed) {
    if (key in source) {
      filtered[key] = source[key];
    }
  }

  return filtered;
}

/**
 * 로그 마스킹 (비밀정보 제거)
 */
export function maskSensitiveOutput(
  output: string,
  check: CheckDefinition
): string {
  let masked = output;

  // API 키, 토큰 등 마스킹
  const sensitivePatterns = [
    /ANTHROPIC_API_KEY=[^\s]+/g,
    /api[_-]?key=[^\s]+/gi,
    /token=[^\s]+/gi,
    /password=[^\s]+/gi,
  ];

  for (const pattern of sensitivePatterns) {
    masked = masked.replace(pattern, "[REDACTED]");
  }

  // Check 정의의 추가 패턴
  if (check.sensitive_patterns) {
    for (const pattern of check.sensitive_patterns) {
      masked = masked.replace(pattern, "[REDACTED]");
    }
  }

  return masked;
}
