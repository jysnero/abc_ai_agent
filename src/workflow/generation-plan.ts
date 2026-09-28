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
  // 테스트 단위: 요구사항별 확인 방법 (automated = 이 단위의 테스트, browser = 별도 브라우저 근거)
  acceptance_checks?: AcceptanceCheck[];
}

export interface AcceptanceCheck {
  requirement: string;
  method: "automated" | "browser";
  check: string;
}

/** 원본 내용에 적용할 정확한 치환 (find는 원본에 정확히 한 번 나와야 한다) */
export interface TextReplacement {
  find: string;
  replace: string;
}

export interface ReusedFileRef {
  path: string;
  // 원본 출처: source_run의 source_artifact(developer-result 또는 units/<id>-passed)에 저장된 source_step 응답
  source_run: string;
  source_artifact: string;
  source_step: string;
  // 원본 응답 안 파일 내용의 checksum (수정 전)
  sha256: string;
  // 담당 범위: 이 파일이 구현을 맡은 요구사항. 검증 통과를 뜻하지 않는다
  requirements?: string[];
  // 원본을 수정해 재사용하는 경우: 치환 내역과 수정 후 checksum
  modification?: {
    reason: string;
    replacements: TextReplacement[];
    sha256: string;
  };
}

/** start 시 run에 저장하는 재사용 파일 (원본 출처와 실제 사용 내용의 checksum을 구분) */
export interface ResolvedReusedFile {
  path: string;
  origin: { source_run: string; source_artifact: string; source_step: string; sha256: string };
  modified: boolean;
  modification?: ReusedFileRef["modification"];
  // 실제로 workspace·프롬프트에 쓰이는 내용의 checksum (수정본이면 수정 후 값)
  content_sha256: string;
  assigned_requirements: string[];
  requirements_verified: false;
  content: string;
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
      ...(Array.isArray(u.acceptance_checks)
        ? {
            acceptance_checks: u.acceptance_checks.map((c: any) => ({
              requirement: String(c.requirement),
              method: c.method,
              check: String(c.check || ""),
            })),
          }
        : {}),
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
  for (const r of plan.reused_files) {
    if (owner.has(r.path)) errors.push(`reused file ${r.path} is declared more than once`);
    owner.set(r.path, `reused(${r.source_run})`);
    for (const id of r.requirements || []) {
      if (!requirementIds.includes(id)) errors.push(`reused file ${r.path} references unknown requirement ${id}`);
    }
    if (r.modification) {
      if (!r.modification.reason?.trim()) errors.push(`reused file ${r.path}: modification.reason is required`);
      if (!Array.isArray(r.modification.replacements) || r.modification.replacements.length === 0) {
        errors.push(`reused file ${r.path}: modification.replacements is required`);
      }
      if (r.modification.sha256 === r.sha256) errors.push(`reused file ${r.path}: modified checksum equals the original`);
    }
  }

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
    if (u.acceptance_checks) {
      if (u.kind !== "test") errors.push(`unit ${u.id}: acceptance_checks are only for test units`);
      for (const c of u.acceptance_checks) {
        if (!u.requirements.includes(c.requirement)) {
          errors.push(`unit ${u.id} has an acceptance check for ${c.requirement}, which is not a requirement of the unit`);
        }
        if (c.method !== "automated" && c.method !== "browser") {
          errors.push(`unit ${u.id} acceptance check for ${c.requirement}: method must be automated or browser`);
        }
        if (!c.check.trim()) errors.push(`unit ${u.id} acceptance check for ${c.requirement}: check is empty`);
      }
      for (const r of u.requirements) {
        if (!u.acceptance_checks.some((c) => c.requirement === r)) errors.push(`unit ${u.id}: requirement ${r} has no acceptance check`);
      }
    }
    seenUnits.push(u.id);
  }

  const owned = [...owner.keys()].sort();
  const expected = [...targetFiles].sort();
  for (const f of expected) if (!owner.has(f)) errors.push(`target file ${f} is not produced by any unit or reuse`);
  for (const f of owned) if (!expected.includes(f)) errors.push(`file ${f} is not a target file of the execution plan`);

  // 재사용 파일의 요구사항은 담당 범위로만 계산한다 (검증은 테스트 단위와 validation이 따로 맡는다)
  const sourceReqs = new Set([
    ...plan.units.filter((u) => u.kind === "source").flatMap((u) => u.requirements),
    ...plan.reused_files.flatMap((r) => r.requirements || []),
  ]);
  const testReqs = new Set(plan.units.filter((u) => u.kind === "test").flatMap((u) => u.requirements));
  for (const id of requirementIds) {
    if (!sourceReqs.has(id)) errors.push(`requirement ${id} is not assigned to any source unit or reused file`);
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
 * 요구사항 배정 요약: 구현 담당(생성 단위·재사용 파일)과 확인 방법(테스트 단위)을 분리해 보여준다.
 * 배정은 담당 범위일 뿐이며 verified는 항상 false (검증 결과는 validation 단계에서만 나온다)
 */
export function summarizeRequirementAssignment(plan: GenerationPlan, requirementIds: string[]) {
  return requirementIds.map((id) => ({
    requirement: id,
    generated_by: plan.units.filter((u) => u.kind === "source" && u.requirements.includes(id)).map((u) => u.id),
    reused_scope: plan.reused_files.filter((r) => (r.requirements || []).includes(id)).map((r) => r.path),
    tests: plan.units
      .filter((u) => u.kind === "test" && u.requirements.includes(id))
      .map((u) => ({
        unit: u.id,
        automated: (u.acceptance_checks || []).filter((c) => c.requirement === id && c.method === "automated").map((c) => c.check),
        browser: (u.acceptance_checks || []).filter((c) => c.requirement === id && c.method === "browser").map((c) => c.check),
      })),
    verified: false as const,
  }));
}

/** 원본에 치환을 적용한다. find가 정확히 한 번 나오지 않으면 오류 */
export function applyReplacements(pathLabel: string, original: string, replacements: TextReplacement[]): string {
  let out = original;
  for (const r of replacements) {
    const count = out.split(r.find).length - 1;
    if (count !== 1) {
      throw new Error(`reused file ${pathLabel}: replacement target must occur exactly once (found ${count}): ${JSON.stringify(r.find.slice(0, 80))}`);
    }
    out = out.replace(r.find, () => r.replace);
  }
  return out;
}

/** 원본 artifact에서 해당 단계 응답 원문을 꺼낸다 (developer-result의 steps[] 또는 units/<id>-passed checkpoint) */
function sourceResponseText(ref: ReusedFileRef, artifact: string): string {
  const json = JSON.parse(artifact);
  if (json.record && json.unit !== undefined) {
    if (json.phase !== "passed") throw new Error(`reused file ${ref.path}: ${ref.source_artifact} is not a passed unit checkpoint`);
    if (json.unit !== ref.source_step) throw new Error(`reused file ${ref.path}: checkpoint is for unit ${json.unit}, not ${ref.source_step}`);
    const recorded = json.file_checksums?.[ref.path];
    if (recorded && recorded !== ref.sha256) {
      throw new Error(`reused file ${ref.path}: checksum mismatch with checkpoint (declared ${ref.sha256}, checkpoint ${recorded})`);
    }
    if (!json.record?.raw?.text) throw new Error(`reused file ${ref.path}: checkpoint has no saved response`);
    return json.record.raw.text;
  }
  const step = (json.steps || []).find((s: any) => s.step === ref.source_step);
  if (!step?.raw?.text) throw new Error(`reused file ${ref.path}: step ${ref.source_step} has no saved response`);
  return step.raw.text;
}

/**
 * 재사용 파일 해석: 원본 run의 저장된 응답에서 파일을 꺼내고 선언된 checksum과 일치하는지 확인한다.
 * 수정본은 원본 checksum 확인 → 치환 적용 → 수정 후 checksum 확인 순서로 만든다. (원본 run은 읽기만 한다)
 */
export function resolveReusedFiles(
  plan: GenerationPlan,
  loadSourceArtifact: (runId: string, artifact: string) => string | null
): Record<string, ResolvedReusedFile> {
  const out: Record<string, ResolvedReusedFile> = {};
  for (const ref of plan.reused_files) {
    const artifact = loadSourceArtifact(ref.source_run, ref.source_artifact);
    if (!artifact) throw new Error(`reused file ${ref.path}: source artifact not found (${ref.source_run}/${ref.source_artifact})`);
    const { files } = parseFileSections(sourceResponseText(ref, artifact));
    const original = files[ref.path];
    if (original === undefined) throw new Error(`reused file ${ref.path}: not a complete section in the source response`);
    if (sha256(original) !== ref.sha256) {
      throw new Error(`reused file ${ref.path}: checksum mismatch (declared ${ref.sha256}, actual ${sha256(original)})`);
    }
    let content = original;
    if (ref.modification) {
      content = applyReplacements(ref.path, original, ref.modification.replacements);
      if (sha256(content) !== ref.modification.sha256) {
        throw new Error(`reused file ${ref.path}: modified checksum mismatch (declared ${ref.modification.sha256}, actual ${sha256(content)})`);
      }
    }
    out[ref.path] = {
      path: ref.path,
      origin: { source_run: ref.source_run, source_artifact: ref.source_artifact, source_step: ref.source_step, sha256: ref.sha256 },
      modified: Boolean(ref.modification),
      ...(ref.modification ? { modification: ref.modification } : {}),
      content_sha256: sha256(content),
      assigned_requirements: [...(ref.requirements || [])],
      requirements_verified: false,
      content,
    };
  }
  return out;
}
