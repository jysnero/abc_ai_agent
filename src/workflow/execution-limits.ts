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
  steps: Record<LimitedStep, StepLimit>;
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
  const steps = {} as Record<LimitedStep, StepLimit>;
  for (const s of STEPS) {
    const step = raw.steps?.[s];
    steps[s] = {
      max_tokens: positiveInt(step?.max_tokens, `steps.${s}.max_tokens`),
      timeout_ms: positiveInt(step?.timeout_ms, `steps.${s}.timeout_ms`),
    };
  }
  return {
    model: raw.model,
    app_max_retries: nonNegativeInt(raw.app_max_retries, "app_max_retries"),
    sdk_max_retries: 0,
    max_repair_attempts: nonNegativeInt(raw.max_repair_attempts, "max_repair_attempts"),
    max_logical_calls: positiveInt(raw.max_logical_calls, "max_logical_calls"),
    stop_on_first_error: true,
    steps,
  };
}
