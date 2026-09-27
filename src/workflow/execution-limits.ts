/**
 * Run 전용 실행 한도 (start 시 run에 저장, SPEC 승인 대상에 포함)
 * 전역 CLI 정책(--single-trial 등)보다 우선한다.
 */

export type LimitedStep = "generateCode" | "generateTests" | "selfValidate";

export interface StepLimit {
  max_tokens: number;
  timeout_ms: number;
}

export interface ExecutionLimits {
  model: string;
  app_max_retries: number;
  sdk_max_retries: 0;
  max_repair_attempts: number;
  max_logical_calls: number;
  stop_on_first_error: true;
  // 단일 흐름(generateCode/generateTests/selfValidate)용. 생성 단위 모드에서는 units를 쓴다
  steps?: Record<LimitedStep, StepLimit>;
  // 생성 단위 모드: 단위 id별 한도
  units?: Record<string, StepLimit>;
}

export function limitFor(limits: ExecutionLimits, key: string): StepLimit {
  const l = limits.units?.[key] ?? (limits.steps as Record<string, StepLimit> | undefined)?.[key];
  if (!l) throw new Error(`execution-limits: no limit defined for "${key}"`);
  return l;
}

const STEPS: LimitedStep[] = ["generateCode", "generateTests", "selfValidate"];

function positiveInt(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
    throw new Error(`execution-limits: ${name} must be a positive integer`);
  }
  return v;
}

function nonNegativeInt(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new Error(`execution-limits: ${name} must be a non-negative integer`);
  }
  return v;
}

export function parseExecutionLimits(json: string): ExecutionLimits {
  const raw = JSON.parse(json);
  if (typeof raw.model !== "string" || raw.model.length === 0) {
    throw new Error("execution-limits: model is required");
  }
  if (raw.sdk_max_retries !== 0) {
    throw new Error("execution-limits: sdk_max_retries must be 0 (retries are controlled by the app)");
  }
  if (raw.stop_on_first_error !== true) {
    throw new Error("execution-limits: stop_on_first_error must be true");
  }
  const parseLimit = (v: any, name: string): StepLimit => ({
    max_tokens: positiveInt(v?.max_tokens, `${name}.max_tokens`),
    timeout_ms: positiveInt(v?.timeout_ms, `${name}.timeout_ms`),
  });
  if (!raw.steps && !raw.units) {
    throw new Error("execution-limits: steps or units is required");
  }
  let steps: Record<LimitedStep, StepLimit> | undefined;
  if (raw.steps) {
    steps = {} as Record<LimitedStep, StepLimit>;
    for (const s of STEPS) steps[s] = parseLimit(raw.steps[s], `steps.${s}`);
  }
  let units: Record<string, StepLimit> | undefined;
  if (raw.units) {
    units = {};
    for (const [id, v] of Object.entries(raw.units)) units[id] = parseLimit(v, `units.${id}`);
  }
  return {
    model: raw.model,
    app_max_retries: nonNegativeInt(raw.app_max_retries, "app_max_retries"),
    sdk_max_retries: 0,
    max_repair_attempts: nonNegativeInt(raw.max_repair_attempts, "max_repair_attempts"),
    max_logical_calls: positiveInt(raw.max_logical_calls, "max_logical_calls"),
    stop_on_first_error: true,
    ...(steps ? { steps } : {}),
    ...(units ? { units } : {}),
  };
}
