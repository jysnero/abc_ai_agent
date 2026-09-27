# P0-7 실제 Claude API 연동 검증 계획

**시작일**: 2026-09-27  
**목표**: FakeAgentClient → 실제 Claude API 전환 검증  
**범위**: 작은 WebView 샘플 1개 (완전한 실행 흐름)  
**제약**: NHBridge mock 유지 (실제 포인트 지급 없음)

---

## 1단계: 샘플 선정 및 명세 준비

### 선정 샘플: "React Checkbox 컴포넌트 생성"

**이유**:
- 요구사항 명확함 (단순하지만 실제 코드 생성 필요)
- 검증 용이 (build/test/architecture 모두 검증 가능)
- 시간 효율적 (API 호출 횟수 제한 가능)

### 입력 명세 (request-spec)

```json
{
  "requirement": "Create a reusable React checkbox component with accessibility support",
  "constraints": {
    "language": "TypeScript",
    "framework": "React",
    "style": "Tailwind CSS",
    "accessibility": "WCAG 2.1 AA"
  },
  "acceptance_criteria": [
    "Component exports named function Checkbox",
    "Props interface includes checked, onChange, label, disabled",
    "Supports keyboard navigation (Space to toggle)",
    "Has proper aria-label and aria-checked attributes",
    "Includes unit tests with >80% coverage",
    "TSLint passes without errors"
  ]
}
```

### 기대 산출물

```
src/components/
├── Checkbox.tsx                    # React component
├── Checkbox.test.tsx              # Unit tests (>80% coverage)
└── Checkbox.types.ts              # TypeScript types

tests/
└── components/
    └── Checkbox.integration.test.tsx  # Integration test

README.md                           # Component documentation
```

### Architecture Contract 예상 내용

```json
{
  "type": "webview-component",
  "version": "1.0",
  "name": "React Checkbox Component",
  "required_files": [
    "src/components/Checkbox.tsx",
    "src/components/Checkbox.types.ts",
    "src/components/Checkbox.test.tsx"
  ],
  "allowed_globs": [
    "src/**/*.tsx",
    "src/**/*.ts",
    "tests/**/*.ts",
    "tests/**/*.tsx",
    "README.md",
    "package.json"
  ],
  "dependencies": {
    "npm_packages": ["react", "typescript"],
    "dev_packages": ["vitest", "react-testing-library"]
  },
  "validation": {
    "build_cmd": "tsc --noEmit",
    "test_cmd": "vitest run --coverage",
    "lint_cmd": "eslint src/"
  }
}
```

---

## 2단계: 실제 AgentClient 연결

### 현재 상태
```typescript
// src/runtime/agent-client.ts (실제 Claude API)
export class AgentClient implements IAgentClient {
  async executeByPlan(contract, plan): Promise<AgentResponse> {
    // 실제 Claude API 호출
  }
}

// src/runtime/fake-agent-client.ts (현재 P0-6 사용)
export class FakeAgentClient implements IAgentClient {
  // mock 응답
}
```

### P0-7 변경 계획
1. **AgentClient 구현 검증**
   - 메시지 형식 확인 (plan/contract 직렬화)
   - Token 계산 로직 검증
   - 응답 파싱 검증

2. **API 호출 설정**
   ```typescript
   const agentClient = process.env.USE_REAL_API === 'true'
     ? new AgentClient({ apiKey: process.env.ANTHROPIC_API_KEY })
     : new FakeAgentClient(FakeScenario.SUCCESS);
   ```

3. **호출 횟수 제한**
   - 초기: Checkbox 샘플 1개만 (최대 5회 호출)
   - Token 사용량: <100K 예상
   - 중단 조건: Token 초과/에러 시 자동 ESCALATED

---

## 3단계: NHBridge Mock 유지

### 현재 구현
```typescript
// src/runtime/native-bridge.ts
export class NHBridge implements INativeHostBridge {
  async executeNativeCode(code: string): Promise<void> {
    if (process.env.ENABLE_REAL_BRIDGE === 'true') {
      // 실제 Native 호출
    } else {
      // Mock: 아무것도 하지 않음
      console.log(`[Mock NHBridge] ${code}`);
    }
  }
}
```

### P0-7 정책
- ✅ Mock 유지 (실제 포인트 지급 없음)
- ✅ 로그만 출력
- ✅ 응답: 항상 success (credit 차감 없음)

---

## 4단계: 생성 파일 검증

### Build 검증
```bash
npm run build  # TypeScript 컴파일
# 예상: 0 error, 0 warning
```

### Test 검증
```bash
npm run test  # Unit + Integration tests
# 예상: 100% pass, >80% coverage
```

### Architecture 검증
```bash
node scripts/check-architecture.mjs <contract-file>
# 예상: 모든 제약 만족
```

### 통합 검증
```bash
npm run build && npm run test && npm run lint
# 예상: 모두 성공
```

---

## 5단계: 성공 기준

### 로컬 검증 (100%)
- [ ] start → HUMAN_GATE_SPEC 도달
- [ ] approve-spec → 성공
- [ ] resume → DEV_VALIDATION_LOOP 시작
- [ ] Agent 실행 → 코드 생성 (실제 Claude API)
- [ ] 생성 파일 build/test/lint 모두 성공
- [ ] Resume → HUMAN_GATE_RELEASE 도달
- [ ] approve-release → 성공
- [ ] 최종 상태: RELEASE_READY

### 생성물 검증
- [ ] Checkbox.tsx 존재 및 export
- [ ] Checkbox.test.tsx 존재 및 >80% coverage
- [ ] README.md 문서화 완료
- [ ] TypeScript 타입 정확함
- [ ] Accessibility 요구사항 충족

### 에러 처리
- [ ] Token 초과 → ESCALATED 상태로 전환
- [ ] API 에러 → 재시도 로직 작동
- [ ] Validation 실패 → repair loop 작동

---

## 6단계: 호출 횟수 및 토큰 관리

### 예상 호출 수
| 단계 | 호출 내용 | 예상 횟수 |
|------|---------|---------|
| DEV_VALIDATION_LOOP | Developer Agent 실행 | 1 |
| Validation | Validation Runner 실행 | 1 (실패 시 repair 3회 추가) |
| Total | 최악의 경우 | 5 |

### Token 제한 설정
```typescript
const CLAUDE_API_CONFIG = {
  max_tokens_per_call: 4096,
  max_tokens_per_session: 100000,
  timeout_seconds: 300,
  auto_escalate_on_overrun: true,
};
```

### 중단 조건
1. **Token 초과** → ESCALATED (사람 검토 필요)
2. **API Error** → 자동 재시도 (3회)
3. **Timeout** → ESCALATED
4. **Validation 실패 3회 이상** → ESCALATED

---

## 7단계: 테스트 절차

### 사전 체크
```bash
# 1. P0-6 CLI 정상 작동 확인
npm run test:cli
# 예상: 34/34 PASS

# 2. Architecture contract 검증
node scripts/check-architecture.mjs contracts/patterns/minigame_shell_v1.json
# 예상: PASS
```

### 실행 절차
```bash
# 1. Checkbox 요구사항으로 Run 생성
USE_REAL_API=false npm run cli -- start \
  --spec samples/checkbox-spec.json \
  --contract contracts/checkbox-contract.json

# 2. Spec 승인
npm run cli -- approve-spec \
  --run-id <run-id> \
  --approver test-user

# 3. 실제 API로 전환하고 재개
USE_REAL_API=true npm run cli -- resume --run-id <run-id>

# 4. 최종 상태 확인
npm run cli -- status --run-id <run-id>
```

### 검증 후
```bash
# 생성된 파일 확인
ls .blueprint/runs/<run-id>/artifacts/

# 생성 파일로 build/test 수행
cd .blueprint/runs/<run-id>/artifacts/
npm install
npm run build
npm run test
```

---

## 8단계: 실패 처리

### 경우 1: API 호출 실패
```
상태: ESCALATED
원인: API 에러 / Token 초과 / Timeout
조치: 
  1. 에러 메시지 저장
  2. ESCALATED로 상태 전환
  3. 사람 검토 필요 플래그 설정
```

### 경우 2: 생성 파일 검증 실패
```
상태: NEEDS_HUMAN_REVIEW
원인: Build/Test 실패 / 요구사항 미충족
조치:
  1. Validation Report 생성
  2. Repair 시도 (최대 3회)
  3. 3회 실패 시 ESCALATED
```

### 경우 3: 완전 성공
```
상태: RELEASE_READY
산출물: 
  - 생성된 Checkbox 컴포넌트 (검증됨)
  - Validation Report (모두 passed)
  - Build/Test 로그 (성공)
```

---

## 9단계: 문서화 및 리포팅

### 생성 리포트
```
P0-7_REAL_API_TEST_RESULTS.md
├── API 호출 횟수 및 token 사용량
├── 생성 파일 목록 및 검증 결과
├── Build/Test/Lint 결과
├── Architecture 검증 결과
├── 총 실행 시간
└── 다음 단계 추천사항
```

### 예상 결과 (성공 시)
```
✅ P0-7 완료
- 실제 Claude API로 Checkbox 컴포넌트 생성 성공
- 생성 파일 모두 검증 통과
- RELEASE_READY 상태 도달
- Token 사용량: 45K / 100K (예상)
- 다음: 실제 배포 및 Native 앱 연동 (P0-8+)
```

---

## 🚨 주의사항

1. **API Key 보안**
   - `.env` 파일에 ANTHROPIC_API_KEY 설정
   - Git에 커밋하지 않기

2. **Token 사용량**
   - 초기 테스트는 작은 샘플로 (Checkbox)
   - 확대 전에 비용 예산 재검토

3. **Mock ↔ Real 전환**
   - USE_REAL_API 환경 변수로 제어
   - 기본값: false (mock 사용)

4. **실패 시 격리**
   - 각 Run은 독립적인 디렉토리 사용
   - 실패해도 다른 Run에 영향 없음

5. **다음 API 비용**
   - 예상: Checkbox 샘플 1개당 ~$0.5-1.0
   - 5회 반복 시 최대 ~$5

---

## 📅 예상 일정

| 단계 | 소요 시간 | 비고 |
|------|---------|------|
| 샘플 명세 작성 | 1시간 | Checkbox spec/contract |
| AgentClient 검증 | 2시간 | API 연결 확인 |
| 첫 실행 (mock) | 1시간 | 로컬 테스트 |
| 실제 API 실행 | 30분 | 1회 API 호출 |
| 생성물 검증 | 1시간 | Build/Test/Lint |
| 리포팅 | 1시간 | 결과 문서화 |
| **Total** | **6-7시간** | - |

---

## ✅ 체크리스트

- [ ] Checkbox 샘플 spec 작성
- [ ] Checkbox architecture-contract 작성
- [ ] AgentClient 메시지 형식 검증
- [ ] NHBridge mock 상태 확인
- [ ] USE_REAL_API 환경 변수 설정
- [ ] ANTHROPIC_API_KEY 설정
- [ ] Token 제한값 설정 (max 100K)
- [ ] 테스트 절차 드라이 런
- [ ] P0-7 테스트 스크립트 작성
- [ ] 생성물 검증 자동화

---

**다음**: P0-7_CHECKBOX_SAMPLE_SPEC.md (샘플 명세 상세)
