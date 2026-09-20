/**
 * Run Storage
 *
 * 파일 기반 실행 상태 저장소
 * Source of Truth: 파일 시스템
 * 메모리: 캐시만
 *
 * 보안 조건:
 * - run ID 형식 제한 (req-YYYYMMDD-NNN-*)
 * - 저장 경로 탈출 차단 (path.resolve 사용)
 * - Atomic write (임시 파일 → rename)
 * - Artifact revision 덮어쓰기 금지
 * - Checksum 불일치 시 실행 중단
 * - 승인 후 대상 artifact 변경 시 승인 무효화
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { RunMetadata, StateTransitionEvent } from "./run-storage.types.js";

const RUN_ID_PATTERN = /^req-\d{8}-\d{3}-[a-z0-9_-]+$/;

/**
 * Run 디렉토리 경로 동적 결정
 */
function getRunsBaseDir(): string {
  return process.env.TEST_RUN_DIR || path.resolve(".blueprint/runs");
}

/**
 * SHA-256 checksum validation pattern
 * Format: sha256:<64 lowercase hex characters>
 */
const SHA256_CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/;

/**
 * Validate checksum format
 */
export function validateChecksumFormat(checksum: string | undefined): boolean {
  if (!checksum) return false;
  return SHA256_CHECKSUM_PATTERN.test(checksum);
}

/**
 * Accessor: request_spec_revision (checksum)
 *
 * TODO(v0.2): Migrate to structured format
 * Currently stores SHA-256 checksum; will refactor to:
 * { revision: number; path: string; checksum: string }
 *
 * Validates checksum format (sha256:<64-char hex>)
 */
export function getRequestSpecChecksum(manifest: RunMetadata): string {
  const checksum = manifest.request_spec_revision;
  if (!checksum) {
    throw new Error("INVALID_CHECKSUM_FORMAT: request_spec_revision missing");
  }
  if (!validateChecksumFormat(checksum)) {
    throw new Error(
      `INVALID_CHECKSUM_FORMAT: request_spec_revision must be sha256:<64-char hex>, got: ${checksum}`
    );
  }
  return checksum;
}

/**
 * Run ID 검증
 */
function validateRunId(runId: string): boolean {
  return RUN_ID_PATTERN.test(runId);
}

/**
 * 저장 경로 보안 검사 (탈출 차단)
 */
function securePath(runId: string, relativePath: string): string {
  const baseDir = getRunsBaseDir();
  const resolved = path.resolve(baseDir, runId, relativePath);
  const base = path.resolve(baseDir, runId);

  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path traversal detected: ${relativePath}`);
  }

  return resolved;
}

/**
 * Checksum 계산 (전체 SHA-256 digest, 64자리)
 */
function calculateChecksum(content: string | Buffer): string {
  const hash = createHash("sha256");
  hash.update(content);
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Atomic write: 임시 파일 → rename
 */
async function atomicWrite(
  filePath: string,
  content: string | Buffer
): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = `${filePath}.tmp`;

  // 디렉토리 생성
  fs.mkdirSync(dir, { recursive: true });

  // 임시 파일에 쓰기
  await fs.promises.writeFile(tempPath, content);

  // 원본으로 이동
  await fs.promises.rename(tempPath, filePath);
}

/**
 * Run 초기화
 */
export async function initializeRun(
  runId: string,
  requestSpec: string
): Promise<RunMetadata> {
  if (!validateRunId(runId)) {
    throw new Error(`Invalid run ID format: ${runId}`);
  }

  const runDir = securePath(runId, ".");
  const manifestPath = securePath(runId, "manifest.json");

  // 이미 존재하는지 확인
  if (fs.existsSync(manifestPath)) {
    throw new Error(`Run already exists: ${runId}`);
  }

  const now = new Date().toISOString();
  const metadata: RunMetadata = {
    run_id: runId,
    created_at: now,
    updated_at: now,
    status: "PLANNING",
    initialization_status: "INITIALIZING",
    retry_count: { arch: 0, dev_repair: 0 },
    events: [
      {
        timestamp: now,
        from_state: "INITIAL",
        to_state: "PLANNING",
        triggered_by: "system",
      },
    ],
  };

  // 디렉토리 생성
  fs.mkdirSync(runDir, { recursive: true });

  // Manifest 저장 (INITIALIZING 상태)
  await atomicWrite(manifestPath, JSON.stringify(metadata, null, 2));

  // Request spec 저장 (saveArtifact가 manifest를 로드하고 업데이트)
  // TODO(v0.2): Add transaction/rollback support if saveArtifact fails to prevent
  // orphaned manifest files. Currently saveArtifact is atomic per-file, but not across artifacts.
  try {
    await saveArtifact(runId, "request-spec", requestSpec);
  } catch (error) {
    // Mark initialization as failed
    const failedManifest = await loadManifest(runId);
    failedManifest.initialization_status = "FAILED";
    failedManifest.updated_at = new Date().toISOString();
    await atomicWrite(manifestPath, JSON.stringify(failedManifest, null, 2));
    throw error;
  }

  // 초기화 완료: READY 상태로 변경
  const readyManifest = await loadManifest(runId);
  readyManifest.initialization_status = "READY";
  readyManifest.updated_at = new Date().toISOString();
  await atomicWrite(manifestPath, JSON.stringify(readyManifest, null, 2));

  // 업데이트된 manifest 반환
  return await loadManifest(runId);
}

/**
 * Manifest 로드
 */
export async function loadManifest(runId: string): Promise<RunMetadata> {
  if (!validateRunId(runId)) {
    throw new Error(`Invalid run ID format: ${runId}`);
  }

  const manifestPath = securePath(runId, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Run not found: ${runId}`);
  }

  const content = await fs.promises.readFile(manifestPath, "utf-8");
  return JSON.parse(content);
}

/**
 * Artifact 저장 (revision 불변성 보장, 경로 기반 저장 지원)
 */
export async function saveArtifact(
  runId: string,
  artifactType: string,
  content: string | Buffer,
  versionNumber: number = 1
): Promise<string> {
  if (!validateRunId(runId)) {
    throw new Error(`Invalid run ID format: ${runId}`);
  }

  const checksum = calculateChecksum(content);
  // 경로 기반 아티팩트 (예: "validation/initial") 지원
  const fileName = artifactType.includes('/')
    ? `${artifactType}.json`
    : `${artifactType}.v${versionNumber}.json`;
  const filePath = securePath(runId, fileName);

  // Revision 덮어쓰기 금지
  if (fs.existsSync(filePath)) {
    const existing = await fs.promises.readFile(filePath, "utf-8");
    const existingChecksum = calculateChecksum(existing);

    if (existingChecksum !== checksum) {
      throw new Error(
        `Cannot overwrite artifact revision: ${artifactType} (existing: ${existingChecksum}, new: ${checksum})`
      );
    }

    // 동일한 내용이므로 기존 파일 반환
    return checksum;
  }

  // 새 파일 저장
  await atomicWrite(filePath, content);

  // Manifest 업데이트
  const manifest = await loadManifest(runId);
  if (artifactType === "request-spec") {
    manifest.request_spec_revision = checksum;
  } else if (artifactType === "architecture-contract") {
    manifest.architecture_contract_revision = checksum;
  } else if (artifactType === "execution-plan") {
    manifest.execution_plan_revision = checksum;
  } else if (artifactType === "developer-result") {
    manifest.developer_result_revision = checksum;
  } else if (artifactType === "validation-report") {
    manifest.validation_report_revision = checksum;
  }
  manifest.updated_at = new Date().toISOString();

  const manifestPath = securePath(runId, "manifest.json");
  await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));

  return checksum;
}

/**
 * Artifact 로드 (경로 기반 로드 지원)
 */
export async function loadArtifact(
  runId: string,
  artifactType: string,
  versionNumber: number = 1
): Promise<string | null> {
  if (!validateRunId(runId)) {
    throw new Error(`Invalid run ID format: ${runId}`);
  }

  // 경로 기반 아티팩트 (예: "validation/initial") 지원
  const fileName = artifactType.includes('/')
    ? `${artifactType}.json`
    : `${artifactType}.v${versionNumber}.json`;
  const filePath = securePath(runId, fileName);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.promises.readFile(filePath, "utf-8");
}

/**
 * 상태 전환 (checksum 및 승인 검증)
 */
export async function transitionState(
  runId: string,
  newState: string,
  triggeredBy: string = "system",
  metadata?: Record<string, unknown>
): Promise<RunMetadata> {
  const manifest = await loadManifest(runId);

  // 사람 승인 게이트 검증
  if (newState === "DEV_VALIDATION_LOOP") {
    if (!manifest.spec_approval) {
      throw new Error(`SPEC approval required before DEV_VALIDATION_LOOP`);
    }

    // Approval 대상 artifact 변경 여부 확인
    const currentRequestSpec =
      await loadArtifact(runId, "request-spec", 1);
    const currentArchContract = await loadArtifact(
      runId,
      "architecture-contract",
      1
    );
    const currentExecPlan = await loadArtifact(
      runId,
      "execution-plan",
      1
    );

    if (currentRequestSpec) {
      const checksum = calculateChecksum(currentRequestSpec);
      // Use accessor for future-proof manifest field access
      try {
        const storedChecksum = getRequestSpecChecksum(manifest);
        if (checksum !== manifest.spec_approval.artifact_checksums.request_spec) {
          // 승인 무효화
          manifest.spec_approval = undefined;
          console.warn(`SPEC approval invalidated: request-spec changed`);
        }
      } catch (error) {
        // Invalid checksum format in manifest - mark approval as invalid
        console.warn(`SPEC approval invalidated: invalid checksum format`);
        manifest.spec_approval = undefined;
      }
    }
  }

  if (newState === "DEVOPS") {
    if (!manifest.release_approval) {
      throw new Error(`RELEASE approval required before DEVOPS`);
    }

    // Release approval 검증
    const currentDevResult = await loadArtifact(
      runId,
      "developer-result",
      1
    );
    const currentValReport = await loadArtifact(
      runId,
      "validation-report",
      1
    );

    if (currentDevResult) {
      const checksum = calculateChecksum(currentDevResult);
      if (checksum !== manifest.release_approval.artifact_checksums.developer_result) {
        manifest.release_approval = undefined;
        console.warn(`RELEASE approval invalidated: developer-result changed`);
      }
    }
  }

  // 상태 전환 기록
  const event: StateTransitionEvent = {
    timestamp: new Date().toISOString(),
    from_state: manifest.status,
    to_state: newState,
    triggered_by: triggeredBy,
    metadata,
  };

  manifest.status = newState as any;
  manifest.updated_at = new Date().toISOString();
  manifest.events.push(event);

  // Manifest 저장
  const manifestPath = securePath(runId, "manifest.json");
  await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));

  return manifest;
}

/**
 * 승인 기록 저장 (SPEC)
 */
export async function recordSpecApproval(
  runId: string,
  approver: string,
  artifactChecksums: {
    request_spec: string;
    architecture_contract: string;
    execution_plan: string;
  }
): Promise<void> {
  const manifest = await loadManifest(runId);

  manifest.spec_approval = {
    approver,
    approved_at: new Date().toISOString(),
    artifact_checksums: artifactChecksums,
  };

  const manifestPath = securePath(runId, "manifest.json");
  await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * 승인 기록 저장 (RELEASE)
 */
export async function recordReleaseApproval(
  runId: string,
  approver: string,
  artifactChecksums: {
    developer_result: string;
    validation_report: string;
  }
): Promise<void> {
  const manifest = await loadManifest(runId);

  manifest.release_approval = {
    approver,
    approved_at: new Date().toISOString(),
    artifact_checksums: artifactChecksums,
  };

  const manifestPath = securePath(runId, "manifest.json");
  await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * 재시도 카운트 증가
 */
export async function incrementRetryCount(
  runId: string,
  stage: "arch" | "dev_repair"
): Promise<void> {
  const manifest = await loadManifest(runId);

  if (stage === "arch") {
    manifest.retry_count.arch++;
  } else if (stage === "dev_repair") {
    manifest.retry_count.dev_repair++;
  }

  const manifestPath = securePath(runId, "manifest.json");
  await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
}
