/**
 * Run Storage Types
 *
 * 파일 기반 실행 상태 저장소의 데이터 구조
 */

export interface RunMetadata {
  run_id: string;
  created_at: string;
  updated_at: string;
  status: "PLANNING" | "DESIGN" | "ARCH_CONTRACT" | "PLAN_BUILD" | "HUMAN_GATE_SPEC" | "DEV_VALIDATION_LOOP" | "HUMAN_GATE_RELEASE" | "DEVOPS" | "DONE" | "ESCALATED" | "PLAN_CHANGE_REQUIRED" | "NEEDS_HUMAN_REVIEW";

  // Artifact revisions (immutable)
  request_spec_revision?: string;      // checksum
  architecture_contract_revision?: string;
  execution_plan_revision?: string;
  developer_result_revision?: string;
  validation_report_revision?: string;

  // Approval records
  spec_approval?: {
    approver: string;
    approved_at: string;
    artifact_checksums: {
      request_spec: string;
      architecture_contract: string;
      execution_plan: string;
    };
  };

  release_approval?: {
    approver: string;
    approved_at: string;
    artifact_checksums: {
      developer_result: string;
      validation_report: string;
    };
  };

  // Retry tracking
  retry_count: {
    arch: number;
    dev_repair: number;
  };

  // State transition events (append-only)
  events: StateTransitionEvent[];
}

export interface StateTransitionEvent {
  timestamp: string;
  from_state: string;
  to_state: string;
  triggered_by: string;      // "user", "system", "auto"
  metadata?: Record<string, unknown>;
}

export interface ArtifactRevision {
  revision: string;           // checksum
  stored_at: string;
  size_bytes: number;
}

export interface RunDirectory {
  root: string;               // .blueprint/runs/{run_id}/
  manifest: RunMetadata;
  artifacts: {
    request_spec?: ArtifactRevision;
    architecture_contract?: ArtifactRevision;
    execution_plan?: ArtifactRevision;
    developer_result?: ArtifactRevision;
    validation_report?: ArtifactRevision;
  };
}
