# P0-7 Phase 2 인수인계 문서

## 📋 현재 상태 (2026-09-27)

### 완료 ✅

1. **회귀 테스트 완료: 95/95 통과 (100%)**
   - Unit: 31/31
   - Workflow: 7/7 (Scenario C max-repair 버그 수정)
   - Validation: 19/19
   - CLI: 38/38 (brief 명령 4개 테스트 추가)

2. **생성물 검증 조건 복구**
   - tsconfig.json: `strict: true` 활성화
   - validation_commands: build, test, architecture-check (3개)
   - Windows 경로 정규화 수정
   - 엄격한 TypeScript 오류 감지

3. **자연어 입력 파이프라인 (규칙 기반 v0.1)**
   - `orchestrate brief --file path/to/brief.md` 명령
   - brief.md → request-spec 변환
   - HUMAN_GATE_SPEC에서 workflow 시작
   - FakeAgentClient 주입 가능 (테스트용)

4. **Preview 서버**
   - `orchestrate preview --run-id <id> [--port 3000]` 명령
   - localhost에서 생성 결과물 표시
   - 디렉토리 목록 및 파일 서빙
   - 경로 탈출 방지 (보안)

### 미완료 ⏳

1. **실제 Claude API 호출**
   - brief → request-spec을 Claude로 생성
   - src/cli/commands/brief.ts의 generateRequestSpecFromBrief() 함수가 준비됨
   - API 키 설정 후 구현 가능 (지금은 규칙 기반 반환)

2. **Release 승인 및 배포**
   - HUMAN_GATE_RELEASE 상태 도달 O
   - Release 실행 후 배포 flow X

3. **E2E 테스트**
   - brief → approve-spec → resume → 생성 → 검증 → preview 전체 흐름
   - 테스트용 샘플: samples/ox-quiz-brief.md

---

## 🔧 다음에 수행할 작업 (우선순위)

### 1. 실제 Claude API 호출 구현

**파일**: src/cli/commands/brief.ts

**함수**: `generateRequestSpecFromBrief()`

```typescript
// TODO: 실제 Claude 호출 활성화
async function generateRequestSpecFromBrief(
  briefContent: string,
  agentClient: IAgentClient  // ← runner.agentClient 주입 필요
): Promise<any> {
  // 현재: 규칙 기반 반환
  // 다음: 
  // const response = await agentClient.generateResponse(prompt);
  // return parseResponse(response);
}
```

**필요 조건**:
- WorkflowRunner에서 agentClient 노출
- ANTHROPIC_API_KEY 설정
- FakeAgentClient와 실제 AgentClient 모두 지원

### 2. E2E 테스트 (선택)

```bash
# 1. brief 명령으로 run 생성
TEST_RUN_DIR=/tmp/test-e2e orchestrate brief --file samples/ox-quiz-brief.md --json

# 2. spec 승인
orchestrate approve-spec --run-id <run-id> --approver "dev"

# 3. 실행 재개
orchestrate resume --run-id <run-id>

# 4. 생성 결과 확인
orchestrate artifacts --run-id <run-id>

# 5. preview 서버 시작
orchestrate preview --run-id <run-id>

# 6. http://localhost:3000 접속
```

### 3. Preview 서버 향상 (선택)

- React 컴포넌트 미리보기 (demo/index.html에서)
- 실시간 갱신
- 타입스크립트 컴파일 에러 표시

---

## 📂 핵심 파일 변경 요약

### 수정된 파일

| 파일 | 변경사항 | 이유 |
|------|---------|------|
| src/workflow/save-generated-code.ts | strict: true 추가 | TypeScript 엄격 모드 활성화 |
| src/builders/plan-builder.ts | validation_commands 복구 | build/test/architecture-check 3개 |
| src/cli/index.ts | brief, preview 라우팅 추가 | 신규 CLI 명령 |
| tests/workflow-runner.integration.test.ts | 검증 시나리오 수정 | 3-check 맞춤 |
| tests/cli/cli.integration.test.ts | brief 테스트 추가 | 신규 명령 검증 |

### 신규 파일

| 파일 | 목적 |
|------|------|
| src/builders/brief-to-spec.ts | 자연어 → spec 변환 |
| src/cli/commands/brief.ts | brief 명령 핸들러 |
| src/cli/commands/preview.ts | localhost preview |
| samples/ox-quiz-brief.md | 테스트용 기획서 |

---

## 🐛 알려진 이슈

**없음** - 모든 테스트 통과

---

## 📊 메트릭

| 항목 | 값 |
|------|-----|
| 총 테스트 | 95 |
| 통과율 | 100% |
| 코드 변경 | 5개 파일 수정, 4개 신규 |
| 신규 CLI 명령 | 2개 (brief, preview) |
| 신규 테스트 | 4개 |

---

## 🚀 배포 전 확인사항

- [ ] API 키 설정 (ANTHROPIC_API_KEY)
- [ ] Claude API 호출 활성화 (brief.ts)
- [ ] E2E 테스트 실행
- [ ] preview 서버 포트 충돌 확인
- [ ] 운영 환경 경로 설정 (TEST_RUN_DIR)

---

## 📝 커밋 정보

- **커밋**: 81d331f
- **브랜치**: p0-6-cli
- **메시지**: P0-7 Phase 2: Natural language input + validation recovery + preview server
- **파일 변경**: 9 (+666, -13)

---

## ⚙️ 마지막 실행 명령

```bash
npm test  # 95/95 통과
npm run build  # TypeScript 컴파일 성공
```

---

**상태**: WIP (Working in Progress)
**다음 단계**: 실제 Claude API 호출 구현 또는 E2E 테스트 추가
