# P0-6 CLI 완료 보고서

**날짜**: 2026-09-27  
**브랜치**: p0-6-cli  
**최종 커밋**: 18f84cc  
**상태**: ✅ 완료 (Main 병합 준비)

---

## 📋 완료 기능

### CLI 커맨드 (6개)
✅ `start` - Run 생성, HUMAN_GATE_SPEC 상태 도달  
✅ `status` - Run 상태 조회 및 agent_mode 표시  
✅ `approve-spec` - Spec 승인 (Architecture Contract/Execution Plan 승인 대상 포함)  
✅ `approve-release` - Release 승인  
✅ `resume` - Run 재개 (Spec 승인 → DEV_VALIDATION_LOOP 실행)  
✅ `artifacts` - 생성된 artifact 목록 조회  

### 에러 처리 및 Exit Code
✅ Exception 기반 에러 처리 (string matching 제거)  
✅ Exit Code 계약 구현:
- `0` (SUCCESS) - 정상 완료
- `2` (CLI_ARGS_ERROR) - 필수 옵션 부재, 잘못된 Run ID 형식
- `3` (INPUT_FILE_ERROR) - 입력 파일 에러 (JSON 파싱 실패)
- `4` (RUN_NOT_FOUND_ERROR) - Run 없음 (존재하는 형식이지만 없는 ID)
- `5` (INVALID_STATE_ERROR) - 잘못된 workflow 상태, 중복 승인
- `7` (WORKFLOW_ERROR) - 예상 밖의 에러

### 승인 상태 검증 (A/B)
✅ **A. 잘못된 상태 (Wrong Workflow State)**
- status ≠ "HUMAN_GATE_SPEC"에서 approve-spec 시도
- Exception: InvalidWorkflowStateError
- Exit: 5 (INVALID_STATE_ERROR)
- 테스트: "approve-spec: wrong state (not HUMAN_GATE_SPEC) exits 5"

✅ **B. 중복 승인 (Duplicate Approval)**
- HUMAN_GATE_SPEC에서 이미 승인된 대상 재승인 시도
- Exception: DuplicateApprovalError
- Exit: 5 (INVALID_STATE_ERROR)
- 테스트: "approve-spec: duplicate approval exits 5"

❌ **C. 과거 승인 무효화 후 재승인 (Re-approval after Artifact Change)**
- 현재 미지원: v0.1 workflow에 HUMAN_GATE_SPEC 복귀 경로 없음
- 현재 flow: HUMAN_GATE_SPEC → DEV_VALIDATION_LOOP → HUMAN_GATE_RELEASE (종료)
- 새 Run 생성으로 대체: 변경된 spec으로 새로운 Run을 시작하는 절차 (아래 참고)

### Run Storage 및 Manifest
✅ RFC 4122 v4 UUID 기반 Run ID (`run-<UUID>` 형식)  
✅ 파일 기반 Run Storage (filesystem source of truth)  
✅ 각 Run마다 독립적인 격리 디렉토리  
✅ Atomic write로 데이터 무결성 보장  
✅ Manifest checksum 검증 (artifact 변경 감지)  

### 테스트 검증
✅ **전체 테스트**: 91/91 PASS
- Unit: 31 (orchestrator 6, plan-builder 8, run-storage 17)
- Workflow: 7
- Validation: 19
- CLI: 34

✅ **Per-test Isolation**: 각 테스트가 독립적인 testRunDir 사용  
✅ **Exit Code Coverage**: 0, 2, 3, 4, 5 모두 테스트 검증  
✅ **Error Distinction**: Invalid format (exit 2) vs Not Found (exit 4) 분리  

---

## 🚫 미지원 기능 (v0.1 제약)

### C 시나리오: 변경된 Spec 재승인
**이유**: 현재 workflow 설계상 HUMAN_GATE_SPEC으로 복귀하는 경로 없음

**현재 해결책**: v0.1에서는 변경된 spec으로 **새 Run 생성**
```bash
# 1단계: 기존 Run 상태 확인
cli status --run-id run-xxx

# 2단계: 수정된 spec으로 새 Run 생성
cli start --spec spec-v2.json --contract contract.json
# → 새로운 run-yyy 생성, HUMAN_GATE_SPEC 도달

# 3단계: 새 Run 승인 및 재개
cli approve-spec --run-id run-yyy --approver alice
cli resume --run-id run-yyy
```

**향후 기능 (P1+)**: "Spec 수정 후 재평가" workflow
- HUMAN_GATE_RELEASE에서 spec 수정 감지 시 HUMAN_GATE_SPEC으로 복귀
- 변경된 spec 승인 후 재실행
- v0.2 이상에서 구현 예정

---

## ⚠️ 검증되지 않은 영역

이 보고서는 **로컬 CLI 단계**까지만 검증합니다. 다음은 미검증:

❌ **실제 Claude API 호출**
- FakeAgentClient (mock) 사용
- AgentClient의 실제 메시지 포맷 미검증
- Token 사용량 미측정

❌ **Native App 연동**
- WebView bridge API 미검증
- NHBridge 실제 호출 미수행
- 포인트 지급 메커니즘 테스트 안 함

❌ **배포 및 프로덕션**
- 실제 환경 테스트 안 함
- 성능/부하 테스트 미수행
- 보안 감사 미완료

---

## 📊 변경 요약

### 파일 추가/수정 (핵심)
```
src/cli/
  ├── cli.ts (main entry point)
  ├── commands/
  │   ├── start.ts
  │   ├── status.ts
  │   ├── approve-spec.ts
  │   ├── approve-release.ts
  │   ├── resume.ts
  │   └── artifacts.ts
  ├── output/
  │   └── formatter.ts (human/JSON formatting)
  ├── cli-errors.ts (error classes)
  └── index.ts (error handler)

src/workflow/workflow-runner.ts (submitSpecApproval 수정)
src/storage/run-storage.ts (exception classes 추가)

tests/cli/cli.integration.test.ts (34 tests)
```

### 주요 변경
- ✅ Exception 기반 에러 처리로 전환
- ✅ InvalidRunIdFormatError / RunNotFoundError 분리
- ✅ InvalidWorkflowStateError / DuplicateApprovalError 추가
- ✅ Per-test Run Storage 격리
- ✅ A/B 승인 시나리오 검증 완료

---

## ✅ 인수 기준 (모두 만족)

| 기준 | 상태 | 증거 |
|------|------|------|
| CLI 6개 커맨드 구현 | ✅ | start, status, approve-spec, approve-release, resume, artifacts |
| Exit code 계약 | ✅ | 0, 2, 3, 4, 5, 7 구현 및 테스트 |
| 승인 A/B 검증 | ✅ | 34/34 테스트, 2개 시나리오 분리 |
| P0-5 회귀 테스트 | ✅ | 57/57 PASS (unit + workflow + validation) |
| 전체 테스트 | ✅ | 91/91 PASS |
| 에러 처리 개선 | ✅ | String matching 제거, exception 기반 전환 |
| C 시나리오 명확화 | ✅ | 미지원 및 대체 절차 문서화 |

---

## 🔄 Main 병합 단계

1. ✅ p0-6-cli 완료 및 검증 (현재 상태)
2. ⏳ 코드 리뷰 및 승인
3. ⏳ Main 병합
4. ⏳ 실제 Claude API 호출 검증 (P0-7+)

---

## 📝 다음 단계

**P0-7 준비 (Claude API 실제 호출)**
- 작은 WebView 샘플 선정 (예: 간단한 React 컴포넌트 생성)
- AgentClient → 실제 Claude API 전환
- Bridge API (NHBridge) mock 유지, 실제 포인트 미지급
- 생성 결과물의 실제 build/test/architecture 검증
- 성공 기준: HUMAN_GATE_RELEASE 도달 + 검증된 산출물

---

**이 보고서의 유효 기간**: 2026-09-27 이후 최신 커밋 18f84cc 기준
