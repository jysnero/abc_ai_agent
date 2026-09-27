# P0-7 준비 완료 체크리스트

**상태**: ✅ 준비 완료  
**날짜**: 2026-09-27  
**목표**: 실제 Claude API로 React Checkbox 컴포넌트 생성 검증

---

## 📋 준비 상태

### ✅ P0-6 완료 (선행 조건)
- [x] CLI 6개 커맨드 구현 및 테스트 (91/91 PASS)
- [x] Exit code 계약 구현
- [x] Exception 기반 에러 처리
- [x] Per-test 격리
- [x] A/B 승인 시나리오 검증
- [x] P0-5 회귀: 57/57 PASS

### ✅ 샘플 명세 준비
- [x] Checkbox 컴포넌트 요구사항 정의 (samples/checkbox-spec.json)
- [x] 8개 수용 기준(AC) 명시
- [x] 예상 API 호출 수: 2회 (dev agent + validation)
- [x] 예상 Token 사용: 15K-25K

### ✅ 계획 및 문서
- [x] P0-7 전체 테스트 계획 (docs/plans/P0-7_REAL_CLAUDE_API_TEST_PLAN.md)
- [x] 8단계 상세 프로세스
- [x] NHBridge mock 유지 정책
- [x] 성공 기준 명확화
- [x] 실패 처리 프로세스

### ⏳ P0-7 실행 전 필요 작업
- [ ] AgentClient 메시지 형식 최종 검증
- [ ] USE_REAL_API 환경 변수 추가
- [ ] ANTHROPIC_API_KEY 설정
- [ ] Token 제한값 설정
- [ ] Checkbox 샘플로 첫 실행

---

## 🎯 P0-7 성공 기준 (모두 만족 필요)

### 1. 실행 성공 (로컬 CLI)
```bash
✅ start --spec checkbox-spec.json           → HUMAN_GATE_SPEC
✅ approve-spec --run-id run-xxx             → exit 0
✅ resume --run-id run-xxx                   → DEV_VALIDATION_LOOP (실제 API 호출)
✅ Agent 완료 후 자동 전환                    → HUMAN_GATE_RELEASE
✅ approve-release --run-id run-xxx          → exit 0
✅ 최종 상태                                   → RELEASE_READY
```

### 2. 생성 파일 검증
```
✅ src/components/Checkbox.tsx               (존재 + 올바른 export)
✅ src/components/Checkbox.types.ts          (TypeScript 타입)
✅ src/components/Checkbox.test.tsx          (>80% 커버리지)
✅ README.md                                  (사용 예제 포함)
```

### 3. 빌드/테스트 성공
```
✅ tsc --noEmit                              (0 에러)
✅ vitest run --coverage                     (>80% 커버리지)
✅ eslint src/                               (0 에러)
```

### 4. API 호출 관리
```
✅ 호출 횟수 ≤ 2회 (dev agent + validation)
✅ Token 사용 ≤ 25K
✅ 모든 호출 성공 또는 자동 재시도
✅ 에러 시 ESCALATED 상태 전환
```

### 5. 검증 결과
```
✅ 8개 AC 모두 satisfied
✅ NHBridge mock으로 호출됨 (실제 포인트 미지급)
✅ Generation 단계 완료
```

---

## 🔍 각 단계별 검증 포인트

| 단계 | 검증 항목 | 성공 신호 |
|------|---------|---------|
| **1. Run 생성** | start 명령어 실행 | HUMAN_GATE_SPEC 도달 |
| **2. Spec 승인** | approve-spec 명령어 | exit code 0 |
| **3. API 호출** | 실제 Claude API 사용 | Agent 응답 수신 |
| **4. 코드 생성** | 파일 생성 | 4개 파일 존재 |
| **5. 빌드 검증** | tsc, vitest 실행 | 모두 성공 |
| **6. Release 승인** | approve-release 명령어 | exit code 0, RELEASE_READY |

---

## 🚀 실행 명령어 (P0-7)

### 준비 단계
```bash
# 1. 최신 코드 확인
git checkout main
git pull origin main

# 2. 의존성 설치
npm install

# 3. P0-6 테스트 통과 확인
npm run test
# 예상: 91/91 PASS
```

### 실행 단계 (Mock으로 먼저 테스트)
```bash
# 1. Mock으로 전체 흐름 검증
USE_REAL_API=false npm run cli -- start \
  --spec samples/checkbox-spec.json \
  --contract contracts/patterns/minigame_shell_v1.json

# 출력에서 run-id 추출: run-xxx-xxx

# 2. Spec 승인
npm run cli -- approve-spec \
  --run-id run-xxx-xxx \
  --approver test-user

# 예상: exit 0, checksum 출력

# 3. Mock 재개 (Agent 실행 스킵)
USE_REAL_API=false npm run cli -- resume --run-id run-xxx-xxx

# 예상: HUMAN_GATE_RELEASE 도달
```

### 실제 API 실행 (준비 완료 후)
```bash
# 환경 설정
export ANTHROPIC_API_KEY="sk-ant-..."
export USE_REAL_API="true"

# 4. 실제 API로 새 Run 생성
npm run cli -- start \
  --spec samples/checkbox-spec.json \
  --contract contracts/patterns/minigame_shell_v1.json

# 5. Spec 승인
npm run cli -- approve-spec \
  --run-id <new-run-id> \
  --approver test-user

# 6. 실제 API로 재개
npm run cli -- resume --run-id <new-run-id>

# 예상: 10-30초 대기 → HUMAN_GATE_RELEASE

# 7. Release 승인
npm run cli -- approve-release \
  --run-id <new-run-id> \
  --approver test-user

# 8. 최종 상태 확인
npm run cli -- status --run-id <new-run-id>
# 예상: status = "RELEASE_READY"

# 9. 생성 파일 검증
npm run cli -- artifacts --run-id <new-run-id>
```

### 검증 단계
```bash
# 10. 생성된 파일 확인
ls .blueprint/runs/<run-id>/artifacts/

# 11. 빌드 검증
cd .blueprint/runs/<run-id>/artifacts/
npm install
npm run build
npm run test

# 12. 결과 확인
echo "생성 파일:"
ls -la src/components/
echo "테스트 커버리지:"
cat coverage/coverage-final.json | grep '"lines"'
```

---

## 📊 예상 결과

### 성공 시 (90% 확률)
```
✅ Checkbox.tsx 생성됨
✅ 5개 이상의 unit test 자동 작성됨
✅ TypeScript 컴파일 성공
✅ vitest --coverage 실행 → 82% 커버리지
✅ RELEASE_READY 상태 도달
💰 Token 사용: ~18K (비용: ~$0.09)
```

### 부분 실패 시 (8% 확률)
```
⚠️ Test coverage 미달 (80% 미만)
→ Validation repair loop 자동 실행 (최대 3회)
→ 3회 모두 실패 시 ESCALATED
```

### 완전 실패 시 (2% 확률)
```
❌ API 에러 / Token 초과
→ ESCALATED 상태 전환
→ 사람 검토 필요
```

---

## 🔧 문제 해결

### 문제 1: "No such file or directory: samples/checkbox-spec.json"
**해결**: 파일이 생성되어야 함
```bash
cat docs/plans/P0-7_REAL_CLAUDE_API_TEST_PLAN.md | grep "선정 샘플"
```

### 문제 2: "ANTHROPIC_API_KEY not set"
**해결**: 환경 변수 설정
```bash
export ANTHROPIC_API_KEY="sk-ant-v..." # 실제 키 입력
```

### 문제 3: "Token limit exceeded"
**해결**: 요청 크기 감소
```bash
# 더 작은 샘플 사용 (예: 단순 버튼 컴포넌트)
```

### 문제 4: "Agent response parsing failed"
**해결**: AgentClient 메시지 형식 검증
```bash
# src/runtime/agent-client.ts 의 메시지 포맷 재확인
```

---

## ✅ 최종 체크리스트

- [ ] P0-6 (CLI) 완료 및 91/91 PASS 확인
- [ ] samples/checkbox-spec.json 존재 확인
- [ ] P0-7_REAL_CLAUDE_API_TEST_PLAN.md 읽음
- [ ] ANTHROPIC_API_KEY 확보 (아직 설정하지 않음)
- [ ] 비용 예산 검토 (~$5-10 예상)
- [ ] Mock으로 전체 흐름 한 번 실행
- [ ] 실제 API 실행 승인 준비 완료
- [ ] Token 제한값 설정 준비
- [ ] 결과 리포팅 양식 준비

---

## 📅 예상 일정

```
P0-6 완료 (현재):  2026-09-27
├─ Mock 테스트:    1시간
├─ 실제 API 실행:  30분
├─ 생성물 검증:    1시간
└─ 리포팅:        1시간
────────────────
P0-7 완료:        2026-09-27 (당일 가능)
```

---

## 📝 다음 문서

1. **P0-7 실행 보고서**: P0-7_REAL_API_TEST_RESULTS.md
2. **P0-8 계획**: 실제 WebView 통합 및 배포
3. **P0-9 계획**: Native 앱 연동 및 포인트 시스템

---

**상태**: ✅ P0-7 실행 준비 완료  
**다음 단계**: ANTHROPIC_API_KEY 설정 후 P0-7 시작
