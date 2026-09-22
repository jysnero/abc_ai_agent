import type { WorkflowStatus } from "../../workflow/workflow-runner.js";
import type { ArtifactMetadata } from "../../storage/run-storage.types.js";

export type PendingAction = "SPEC_APPROVAL" | "RELEASE_APPROVAL" | "HUMAN_REVIEW" | null;

export function derivePendingAction(status: string): PendingAction {
  switch (status) {
    case "HUMAN_GATE_SPEC":
      return "SPEC_APPROVAL";
    case "HUMAN_GATE_RELEASE":
      return "RELEASE_APPROVAL";
    case "NEEDS_HUMAN_REVIEW":
      return "HUMAN_REVIEW";
    default:
      return null;
  }
}

export class HumanFormatter {
  static formatStartMessage(runId: string): string {
    return `✓ Run created: ${runId}\n  Next: approve-spec`;
  }

  static formatStatusMessage(status: WorkflowStatus, agentMode: string): string {
    return `Status: ${status.status}\nAgent Mode: ${agentMode}\nBlocked: ${status.blocked}`;
  }

  static formatApprovalMessage(targetChecksum: string): string {
    return `Approval recorded\nTarget checksum: ${targetChecksum}`;
  }

  static formatArtifacts(artifacts: ArtifactMetadata[]): string {
    return `Artifacts:\n${JSON.stringify(artifacts, null, 2)}`;
  }
}

export class JsonFormatter {
  static formatStart(runId: string, manifest?: any, pendingAction?: PendingAction | null): string {
    const base = { ok: true, run_id: runId };

    if (manifest) {
      const result: any = {
        ...base,
        command: "start",
        state: manifest.status,
        agent_mode: "fake",
        pending_action: pendingAction,
        approval_status: pendingAction ? "pending" : null,
      };

      if (manifest.approval_targets?.spec) {
        result.approval_target = {
          gate: "spec",
          checksum: manifest.approval_targets.spec.checksum,
        };
      }

      return JSON.stringify(result, null, 2);
    }

    return JSON.stringify(base, null, 2);
  }

  static formatStatus(status: WorkflowStatus, agentMode: string): string {
    return JSON.stringify({
      ok: true,
      run_id: status.runId,
      state: status.status,
      blocked: status.blocked,
      agent_mode: agentMode,
    }, null, 2);
  }

  static formatApproval(targetChecksum: string): string {
    return JSON.stringify({ ok: true, target_checksum: targetChecksum }, null, 2);
  }

  static formatArtifacts(artifacts: ArtifactMetadata[]): string {
    return JSON.stringify({ ok: true, artifacts }, null, 2);
  }

  static formatError(message: string, exitCode: number): string {
    return JSON.stringify({ ok: false, error: message, exit_code: exitCode }, null, 2);
  }
}
