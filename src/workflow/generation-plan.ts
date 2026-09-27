/**
 * 생성 단위 계획 (start 시 run에 저장, SPEC 승인 대상에 포함)
 *
 * 한 번의 응답으로 전체 소스를 만들지 않고, 인터페이스 계약을 공유하는 작은 단위로 순차 생성한다.
 */

import { createHash } from "crypto";
import { parseFileSections } from "../agents/developer.js";
import type { ExecutionLimits } from "./execution-limits.js";

export interface GenerationUnit {
  id: string;
  kind: "source" | "test";
  files: string[];
  // 앞선 단위 id (순차 실행이므로 계획상 앞에 있어야 함)
  depends_on: string[];
  // 프롬프트에 전문을 넣을 기존 파일 (재사용 파일 또는 의존 단위의 파일)
  context_files: string[];
  requirements: string[];
  include_ui_guide: boolean;
  instructions: string;
}

export interface ReusedFileRef {
  path: string;
  source_run: string;
  source_artifact: string;
  source_step: string;
  sha256: string;
}

export interface GenerationPlan {
  version: 1;
  interface_contract: string;
  reused_files: ReusedFileRef[];
  units: GenerationUnit[];
}

const sha256 = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");

export function parseGenerationPlan(json: string): GenerationPlan {
  const raw = JSON.parse(json);
  if (raw.version !== 1) throw new Error("generation-plan: version must be 1");
  if (typeof raw.interface_contract !== "string" || !raw.interface_contract.trim()) {
    throw new Error("generation-plan: interface_contract is required");
  }
  if (!Array.isArray(raw.units) || raw.units.length === 0) throw new Error("generation-plan: units required");
  return {
    version: 1,
    interface_contract: raw.interface_contract,
    reused_files: Array.isArray(raw.reused_files) ? raw.reused_files : [],
    units: raw.units.map((u: any) => ({
      id: String(u.id),
      kind: u.kind === "test" ? "test" : "source",
      files: [...u.files],
      depends_on: [...(u.depends_on || [])],
      context_files: [...(u.context_files || [])],
      requirements: [...(u.requirements || [])],
      include_ui_guide: u.include_ui_guide === true,
      instructions: String(u.instructions || ""),
    })),
  };
}

/**
 * 계획 검증: 파일 소유 중복·누락, 의존 순서, 문맥 파일 출처, 요구사항 연결, 단위별 실행 한도
 */
export function validateGenerationPlan(
  plan: GenerationPlan,
  targetFiles: string[],
  requirementIds: string[],
  limits: ExecutionLimits | null
): string[] {
  const errors: string[] = [];
  const owner = new Map<string, string>();
  for (const r of plan.reused_files) owner.set(r.path, `reused(${r.source_run})`);

  const seenUnits: string[] = [];
  for (const u of plan.units) {
    if (seenUnits.includes(u.id)) errors.push(`duplicate unit id: ${u.id}`);
    for (const d of u.depends_on) {
      if (!seenUnits.includes(d)) errors.push(`unit ${u.id} depends on ${d}, which is not an earlier unit`);
    }
    for (const f of u.files) {
      if (owner.has(f)) errors.push(`file ${f} owned by both ${owner.get(f)} and ${u.id}`);
      owner.set(f, u.id);
    }
    const available = new Set<string>(plan.reused_files.map((r) => r.path));
    const closure = new Set<string>();
    const visit = (id: string) => {
      if (closure.has(id)) return;
      closure.add(id);
      plan.units.find((x) => x.id === id)?.depends_on.forEach(visit);
    };
    u.depends_on.forEach(visit);
    for (const id of closure) plan.units.find((x) => x.id === id)?.files.forEach((f) => available.add(f));
    for (const f of u.context_files) {
      if (!available.has(f)) errors.push(`unit ${u.id} context file ${f} is neither reused nor produced by a dependency`);
    }
    for (const r of u.requirements) {
      if (!requirementIds.includes(r)) errors.push(`unit ${u.id} references unknown requirement ${r}`);
    }
    if (u.kind === "test" && u.files.some((f) => !/(^|\/)tests?\//.test(f))) {
      errors.push(`test unit ${u.id} must only produce files under tests/`);
    }
    seenUnits.push(u.id);
  }

  const owned = [...owner.keys()].sort();
  const expected = [...targetFiles].sort();
  for (const f of expected) if (!owner.has(f)) errors.push(`target file ${f} is not produced by any unit or reuse`);
  for (const f of owned) if (!expected.includes(f)) errors.push(`file ${f} is not a target file of the execution plan`);

  const sourceReqs = new Set(plan.units.filter((u) => u.kind === "source").flatMap((u) => u.requirements));
  const testReqs = new Set(plan.units.filter((u) => u.kind === "test").flatMap((u) => u.requirements));
  for (const id of requirementIds) {
    if (!sourceReqs.has(id)) errors.push(`requirement ${id} is not assigned to any source unit`);
    if (!testReqs.has(id)) errors.push(`requirement ${id} is not covered by the test unit`);
  }

  if (limits) {
    for (const u of plan.units) {
      if (!limits.units?.[u.id]) errors.push(`execution-limits has no limit for unit ${u.id}`);
    }
    if (limits.max_logical_calls < plan.units.length) {
      errors.push(`max_logical_calls (${limits.max_logical_calls}) < number of units (${plan.units.length})`);
    }
  }
  return errors;
}

/**
 * 재사용 파일 해석: 원본 run의 저장된 응답에서 파일을 꺼내고 선언된 checksum과 일치하는지 확인한다.
 * (원본 run은 읽기만 한다)
 */
export function resolveReusedFiles(
  plan: GenerationPlan,
  loadSourceArtifact: (runId: string, artifact: string) => string | null
): Record<string, { content: string } & ReusedFileRef> {
  const out: Record<string, { content: string } & ReusedFileRef> = {};
  for (const ref of plan.reused_files) {
    const artifact = loadSourceArtifact(ref.source_run, ref.source_artifact);
    if (!artifact) throw new Error(`reused file ${ref.path}: source artifact not found (${ref.source_run}/${ref.source_artifact})`);
    const step = (JSON.parse(artifact).steps || []).find((s: any) => s.step === ref.source_step);
    if (!step?.raw?.text) throw new Error(`reused file ${ref.path}: step ${ref.source_step} has no saved response`);
    const { files } = parseFileSections(step.raw.text);
    const content = files[ref.path];
    if (content === undefined) throw new Error(`reused file ${ref.path}: not a complete section in the source response`);
    if (sha256(content) !== ref.sha256) {
      throw new Error(`reused file ${ref.path}: checksum mismatch (declared ${ref.sha256}, actual ${sha256(content)})`);
    }
    out[ref.path] = { ...ref, content };
  }
  return out;
}
