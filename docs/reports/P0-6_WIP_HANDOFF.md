# P0-6 CLI WIP Handoff

**Date**: 2026-09-23  
**Branch**: p0-6-cli  
**Commit**: f99fe01  
**Status**: Work in Progress (incomplete)

---

## Current status

- **P0-5 regression**: 57/57 PASS (validation suite)
- **CLI last full result**: 17/29 PASS (before UUID Run ID change)
- **CLI start contract**: PASS (reaches HUMAN_GATE_SPEC, generates approval_targets.spec)
- **Run ID format**: `run-<full-UUID>` (128-bit entropy preserved)
- **P0-6 completion**: ~25% (CLI structure + approval/resume separation + artifacts)

---

## Completed

✓ CLI command structure (6 commands: start, status, approve-spec, approve-release, resume, artifacts)  
✓ Approval and resume separation (approve-spec → resume flow)  
✓ Approval target checksum persistence (SHA-256, stored in manifest)  
✓ Artifact listing API (request_spec, architecture_contract, execution_plan)  
✓ Agent mode output (fake mode in tests)  
✓ Clean JSON start output (no stdout pollution)  
✓ Start reaches HUMAN_GATE_SPEC state  
✓ Full UUID Run ID generation (no collision risk)  
✓ Package.json build scripts  
✓ Process-based integration tests (29 test structure)

---

## Remaining blockers

### 1. Per-test temporary Run Storage isolation
**Status**: CRITICAL  
**Issue**: Suite-wide `testRunDir` created once in `before()`, shared across all 29 tests.  
**Requirement**: Each test must have isolated temp directory (beforeEach/afterEach).  
**Impact**: Run ID collisions when multiple start commands in sequence.  
**Fix approach**: Move testRunDir creation from before→beforeEach, cleanup from after→afterEach.

### 2. Cross-process status command failure
**Status**: CRITICAL  
**Current**: `npm test` shows 12 failures, exit code 7 (UNKNOWN_ERROR) on status/approve-spec.  
**Expected**: Exit code 0 on status happy-path.  
**Evidence**: Last test run (17/29 pass) shows status tests all returning 7 instead of 0.  
**Root cause**: One of:
  - Manifest file not found or malformed
  - WorkflowRunner constructor not reading manifest (using in-memory state instead)
  - Permission error on Run directory access
  - RUN_NOT_FOUND being thrown but not mapped to exit code 4

### 3. Manifest-based WorkflowRunner rehydration
**Status**: INCOMPLETE  
**Requirement**: Start command creates manifest; status/approve-spec/resume must load it.  
**Current issue**: Each new process has empty in-memory Orchestrator state.  
**Solution needed**:
  - status command: `loadManifest(runId)` → read state + approval_targets
  - approve-spec: `loadManifest()` → validate current state before approve
  - resume: `loadManifest()` → verify approval_targets.spec exists

### 4. Domain error to CLI exit-code mapping
**Status**: INCOMPLETE  
**Current**: All errors return exit code 7.  
**Required mapping**:
  - 0 = SUCCESS
  - 2 = CLI_ARGS_ERROR (missing required flags)
  - 3 = INPUT_FILE_ERROR (file not found, invalid JSON)
  - 4 = RUN_NOT_FOUND_ERROR (loadManifest fails, Run dir missing)
  - 5 = INVALID_STATE_ERROR (cannot transition from current state)
  - 7 = UNKNOWN_ERROR (catch-all, log stack)

**Current code**: Throws errors but src/cli/index.ts does not catch and map them.  
**Fix location**: src/cli/index.ts main() → try/catch with error domain detection.

### 5. Group A: status/artifacts verification
**Status**: PENDING  
**Tests**: 4 tests (nonexistent run, show state, JSON output, --json field)  
**Dependency**: Blockers 2, 3, 4 must be fixed first.

### 6. Group B: resume-without-approval verification
**Status**: PENDING  
**Test**: 1 test (resume before spec approval → exit 5)  
**Dependency**: Blockers 2, 3, 4 must be fixed first.

### 7. CLI full suite 29/29
**Status**: PENDING  
**Dependency**: Blockers 1–6 must be resolved.  
**Expected improvement**: 17 → 29 (12 blocker failures cleared).

### 8. Full regression P0-5 + P0-6
**Status**: PENDING  
**Target**: 57/57 + 29/29 = 86/86  
**Dependency**: Blockers 1–7 must be resolved.

---

## Important constraints

**Manifest is the source of truth**
- `Run/manifest.json` is the persistent state.
- In-memory `Orchestrator.requests` is a cache.
- Each process that reads a Run must load manifest, never assume in-memory state.

**Each CLI command runs in a new process**
- No singleton state.
- No environment variables carrying run state.
- No reliance on prior command's in-memory objects.

**Do not use fallbacks or workarounds**
- No `getRequest()` call when loadManifest fails → propagate error.
- No FakeAgent silent fallback → throw.
- No weaken test assertions → maintain strict exit codes and JSON schema.
- No skip validation checks → keep full checksum verification.

**Test isolation is mandatory**
- Do not commit `test-path-validation.js` (temporary debugging file).
- Each test must create and destroy its own temp directory.
- No suite-wide shared `testRunDir`.

**Do not merge to main**
- P0-6 is incomplete (17/29).
- No auto-merge, no release tag.
- Only push to origin/p0-6-cli.
- Main branch must stay clean for P0-5 stability.

---

## Next task

**Priority 1: Run single status happy-path test in isolation**

```bash
cd E:\ai-agent-platform
npm test -- --grep "status: shows current state and agent_mode"
```

**Capture and report**:
1. Exact stdout and stderr
2. Exit code (expecting 0, likely seeing 7)
3. Exception message, code, and stack trace (if thrown)
4. Manifest file existence and content (after start runs)
5. Run directory structure
6. Whether WorkflowRunner reads manifest or in-memory state
7. Which blocker(s) this failure belongs to

**Do not yet fix multiple failures**  
Identify the root cause of status command's exit code 7 first. Once fixed, remaining failures should clear quickly (same root cause across Group A).

---

## Files changed in this WIP

```
package.json                           +7 lines (build:cli, test:cli scripts)
src/orchestrator.ts                   -20 lines +20 lines (UUID generation)
src/storage/run-storage.ts            +158 lines (approval targets, checksum)
src/storage/run-storage.types.ts      +31 lines (manifest schema extensions)
src/workflow/workflow-runner.ts       +191 lines (artifact creation flow)
src/cli/cli-errors.ts                 +NEW (error definitions)
src/cli/index.ts                      +NEW (entry point, parseArgs)
src/cli/composition.ts                +NEW (command registration)
src/cli/commands/start.ts             +NEW (initialize run)
src/cli/commands/status.ts            +NEW (query run state)
src/cli/commands/approve-spec.ts      +NEW (approve architecture)
src/cli/commands/approve-release.ts   +NEW (approve release)
src/cli/commands/resume.ts            +NEW (continue after approval)
src/cli/commands/artifacts.ts         +NEW (list artifacts)
src/cli/output/formatter.ts           +NEW (text/JSON output)
tests/cli/cli.integration.test.ts     +NEW (29 tests)
```

---

## Quick debug checklist for next session

- [ ] Verify P0-5 still passes (57/57)
- [ ] Run CLI build: `npm run build`
- [ ] Single status test: capture full output
- [ ] Stack trace: identify exception type (not generic 7)
- [ ] Manifest load: confirm file exists after start
- [ ] WorkflowRunner: add debug log to show manifest vs in-memory
- [ ] Error mapping: trace src/cli/index.ts catch block
- [ ] Per-test isolation: move testRunDir to beforeEach
- [ ] Re-run full suite: watch for improvement from 17→X

---

**End of handoff document**
