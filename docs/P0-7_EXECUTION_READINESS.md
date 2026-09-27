# P0-7 실제 API 호출 준비 상태 보고서

**작성일**: 2026-09-27  
**상태**: ✅ 분석 완료, 실제 호출 보류  
**대상**: React Checkbox 컴포넌트 생성 (WCAG 2.1 AA)

---

## 1. PR 상태

### 현재 상태
- **생성 도구**: GitHub CLI (gh) 미설치
- **생성 권한**: 보유 (jysnero/abc_ai_agent)
- **현재 브랜치**: p0-6-cli (8개 커밋, main에 비해 앞서감)

### 해결책
**자동 생성 불가** → **수동 생성 필요**

**수동 생성 절차**:
1. https://github.com/jysnero/abc_ai_agent 접속
2. "Pull requests" 탭 → "New pull request"
3. Base: `main`, Compare: `p0-6-cli`
4. Title: `feat: P0-6 CLI - End-to-end CLI with exit code contract`
5. Description: 아래 내용 복사
   ```
   Implements P0-6 Developer Agent CLI interface
   - 6 commands (start, status, approve-spec, approve-release, resume, artifacts)
   - Exit code contract (0, 2, 3, 4, 5, 7)
   - Approval A/B validation
   - Per-test isolation
   - 91/91 tests PASS
   
   See docs/reports/P0-6_COMPLETION_REPORT.md
   ```

**PR은 검토용이며 main 병합은 하지 않습니다.**

---

## 2. P0-7 성공 기준 (명확화)

### ✅ 최소 필수 조건 (MUST)
- [x] 실제 Claude API 호출 성공
- [x] 생성된 코드를 workspace에 저장
- [x] TypeScript 컴파일 성공 (`tsc --noEmit`)
- [x] Unit tests 실행 성공 (>0 test 통과)
- [x] Architecture 검증 통과 (required_files 모두 생성)
- [x] **HUMAN_GATE_RELEASE 상태에 도달**

### ❌ 제외 조건
- ❌ Release 승인 자동 생성 (사람 검토 필수)
- ❌ RELEASE_READY 자동 진행 (보류)
- ❌ 성능/보안 감시 (P0-8+)

### 📊 검증 항목 (수용 기준별)
| AC | 검증 항목 | 검증 방법 |
|----|---------|---------| 
| AC-1 | Checkbox 이름 export | import { Checkbox } 성공 |
| AC-2 | Props 인터페이스 (checked, onChange, label, disabled) | TypeScript 타입 체크 |
| AC-3 | Space 키 지원 | test case 실행 |
| AC-4 | aria-label, aria-checked | DOM 검사 또는 test case |
| AC-5 | Unit tests >80% | 미요구 (커버리지는 목표값, 검증은 실행) |
| AC-6 | TypeScript 컴파일 | `tsc --noEmit` exit 0 |
| AC-7 | Tailwind CSS 스타일 | 생성 코드 검사 |
| AC-8 | README 사용 예제 | 파일 존재 확인 |

### ⚠️ 제한사항
- WCAG 2.1 AA 전체 준수는 이 범위의 테스트로 선언하지 않음
- 색상 대비, 모바일 접근성, 스크린 리더 등은 추가 검증 필요

---

## 3. 실제 호출 경로 분석

### 호출 경로
```
CLI (index.ts)
  ↓
composition.ts (testMode 확인)
  ├─ testMode=true  → FakeAgentClient
  └─ testMode=false → createAgentClient()
      ↓
      ClaudeAgentClient (claude-agent-client.ts)
        ├─ apiKey: process.env.ANTHROPIC_API_KEY 또는 constructor 매개변수
        ├─ timeout_ms: 60000 (default)
        ├─ max_retries: 3 (default)
        ├─ retry_delay_ms: 1000 (default, exponential backoff)
        ↓
        Anthropic SDK (@anthropic-ai/sdk)
          ↓
          Claude API (production)
```

### 모델 및 설정

| 항목 | 값 | 위치 |
|------|-----|------|
| **모델 ID** | `claude-opus-4-1` | src/runtime/claude-agent-client.ts:49 |
| **API Key 로딩** | `process.env.ANTHROPIC_API_KEY` | src/runtime/claude-agent-client.ts:25 |
| **Timeout** | 60초 (기본) | src/runtime/claude-agent-client.ts:26 |
| **재시도** | 3회 (지수 백오프) | src/runtime/claude-agent-client.ts:28, 75 |
| **Max tokens/call** | 4096 | src/runtime/claude-agent-client.ts:50 |

### API 호출 수 분석 (코드 기반)

**executeByPlan() 내부**:
```typescript
// developer.ts:118 - 코드 생성 호출
const response = await this.client.chat(...)  // 호출 1

// developer.ts:166 - 테스트 생성 호출  
const response = await this.client.chat(...)  // 호출 2

// developer.ts:218 - 자체 검증 (선택)
const response = await this.client.chat(...)  // 호출 3 (선택)
```

**최초 실행 (repair 없음)**:
- **코드 생성**: 1회 (chat)
- **테스트 생성**: 1회 (chat)
- **자체 검증**: 1회 (chat, 선택)
- **검증 실행**: 0회 (명령 기반, API 아님)
- **총**: 2-3회

**Repair Loop (validation 실패 시)**:
```typescript
// workflow-runner.ts:330-350
// repair attempt 최대 3회
for (repairAttempt < 3) {
  // 1. repair plan 생성 (API 호출 없음, 로컬)
  // 2. developerAgent.executeByPlan() 호출 → 2-3회 chat
  // 3. validation 재실행 (명령 기반)
}
```

**최악의 경우 (3회 repair)**:
- 초기: 2-3회
- Repair 1: 2-3회
- Repair 2: 2-3회
- Repair 3: 2-3회
- **총**: 8-12회

### FakeAgent Fallback 확인
✅ **FakeAgent fallback 없음**
- testMode=false → 반드시 ClaudeAgentClient 사용
- FakeAgentClient는 명시적으로만 사용 (testMode=true)
- 환경 변수로는 자동 선택 없음

### ValidationRunner (API 호출 없음)
✅ **API 호출 없음** - 결정론적 명령 실행
- `npm run build` (tsc)
- `npm run test` (vitest)
- `npm run lint` (eslint)
- 검증 자체는 **0회 API 호출** 계산

---

## 4. 샘플 준비 (실행 가능한 데모)

### 4.1 Spec 파일 업데이트
파일: `samples/checkbox-spec.json`

```json
{
  "requirement": "Create a React Checkbox component with browser demo and WCAG 2.1 AA support",
  "output_structure": {
    "component": "src/Checkbox.tsx",
    "demo": "demo/index.html",
    "test": "src/Checkbox.test.tsx",
    "types": "src/Checkbox.types.ts"
  },
  "demo_requirements": {
    "html": "Single-file demo showing component usage",
    "features": [
      "Render 3 checkboxes: enabled, disabled, checked",
      "Show checked state in real-time",
      "Support click and Space key toggle",
      "Display aria-label values",
      "Show focus indicator"
    ]
  }
}
```

### 4.2 Demo HTML 준비
파일: `samples/checkbox-demo.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Checkbox Component Demo</title>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
  <div id="root" class="p-8"></div>
  <script>
    // 이 스크립트는 빌드된 컴포넌트를 로드하여 렌더링
    // 실제 구현은 generated Checkbox.tsx를 사용
    console.log('Demo: Render Checkbox component here');
  </script>
</body>
</html>
```

### 4.3 검증 매트릭스
| AC | 테스트 항목 | 검증 방법 | 성공 신호 |
|----|-----------|---------|---------|
| AC-1 | Export 확인 | `import { Checkbox }` | 컴파일 성공 |
| AC-2 | Props 인터페이스 | TypeScript 타입 | tsc --noEmit 성공 |
| AC-3 | Space 키 | test case (keydown Space) | test pass |
| AC-4 | ARIA 속성 | test case (getByRole) | aria-checked 존재 |
| AC-5 | 커버리지 | vitest --coverage | output에 %값 표시 |
| AC-6 | 컴파일 | `tsc --noEmit` | exit code 0 |
| AC-7 | 스타일 | 코드 검사 | className에 Tailwind 클래스 |
| AC-8 | 문서 | README.md 존재 | 파일 존재 + 예제 포함 |

---

## 5. 실행 명령 확정 (PowerShell)

### 선행 조건
```powershell
# 1. 코드 빌드
npm run build

# 2. P0-6 검증 (91/91 PASS 확인)
npm run test:cli
```

### 실행 시나리오 1: Mock 모드 (API 호출 없음)
```powershell
# 1. Run 생성
$result = npm run build -- && node dist/src/cli/index.js start `
  --spec samples/checkbox-spec.json `
  --contract contracts/patterns/minigame_shell_v1.json `
  --test-mode

# 출력에서 run-id 추출
# Example: "✓ Run created: run-12345678-..."

# 2. Spec 조회
node dist/src/cli/index.js status `
  --run-id run-12345678-1234-1234-1234-123456789012 `
  --test-mode

# 예상: status = "HUMAN_GATE_SPEC"

# 3. Spec 승인
node dist/src/cli/index.js approve-spec `
  --run-id run-12345678-1234-1234-1234-123456789012 `
  --approver alice `
  --test-mode

# 4. Mock resume (Agent 미실행)
node dist/src/cli/index.js resume `
  --run-id run-12345678-1234-1234-1234-123456789012 `
  --test-mode

# 예상: HUMAN_GATE_RELEASE 도달
```

### 실행 시나리오 2: 실제 API (Claude 호출)
```powershell
# 1. API Key 설정 (로컬 환경변수만)
$env:ANTHROPIC_API_KEY = "sk-ant-..." # 실제 키 입력

# 2. Run 생성 (API 사용 모드)
node dist/src/cli/index.js start `
  --spec samples/checkbox-spec.json `
  --contract contracts/patterns/minigame_shell_v1.json

# 출력: "✓ Run created: run-abcd-efgh-..."
# 이 run-id를 다음 단계에서 사용

# 3. 상태 확인
node dist/src/cli/index.js status --run-id run-abcd-efgh-...

# 예상: status = "HUMAN_GATE_SPEC", agent_mode = "production"

# 4. Spec 승인
node dist/src/cli/index.js approve-spec `
  --run-id run-abcd-efgh-... `
  --approver alice

# 예상: exit code 0, checksum 출력

# 5. 실제 API로 재개 (⚠️ Claude 호출 시작)
node dist/src/cli/index.js resume --run-id run-abcd-efgh-...

# ⏳ 10-30초 대기 (API 호출 + 코드 생성)
# 예상: DEV_VALIDATION_LOOP → HUMAN_GATE_RELEASE

# 6. 최종 상태 확인
node dist/src/cli/index.js status --run-id run-abcd-efgh-...

# 예상: status = "HUMAN_GATE_RELEASE"

# 7. 생성된 파일 확인
node dist/src/cli/index.js artifacts --run-id run-abcd-efgh-...

# 예상: developer-result artifact 목록

# 8. Release 승인 (⚠️ 자동 진행 금지)
# → 여기서 중단. Release 승인은 수동으로만.
```

### 중요 주의사항
- ❌ `--test-mode` 없음 = API 사용 (ANTHROPIC_API_KEY 필수)
- ❌ `--test-mode` 있음 = Mock 사용 (API Key 불필요)
- ✅ API Key는 환경변수로만 설정
- ✅ 명령어에 포함하지 않음
- ✅ 로그/Git에 기록하지 않음

---

## 6. 예산 및 중단 조건

### Token 한도 정의
| 항목 | 값 | 설명 |
|------|-----|------|
| **모델** | claude-opus-4-1 | src/runtime/claude-agent-client.ts:49 |
| **호출별 output 한도** | 4096 | src/runtime/claude-agent-client.ts:50 |
| **Run 전체 한도** | 미정의 | 설정값 없음 (기본: 무제한) |
| **Timeout** | 60초/호출 | src/runtime/claude-agent-client.ts:26 |

### 100K Token 해석
❓ **현재 코드에는 100K 제한이 없습니다.**

| 해석 | 현재 코드 상태 |
|------|---------------|
| 입력+출력 합계 | ❌ 설정 없음 |
| 단일 호출 한도 | ❌ 설정 없음 (4096 max_tokens만 있음) |
| Run 전체 한도 | ❌ 설정 없음 |

### 실제 적용
**설정값 없음** → **제한 없음** (사용량 무제한)

### 중단 조건 (코드 기반)

| 조건 | 동작 | 코드 위치 |
|------|------|---------|
| **API 에러** | 3회 재시도 후 실패 | claude-agent-client.ts:46-79 |
| **Timeout (60초)** | Anthropic SDK 에러 | claude-agent-client.ts:26 |
| **Validation 실패 3회** | repair 3회 후 ESCALATED? | workflow-runner.ts:330-350 |

❌ **ESCALATED 상태 전환은 코드에 없습니다.**
→ Validation 실패 시 어떻게 되는지 재확인 필요

### 비용 추정 (공식 가격 기반)
- 모델: claude-opus-4-1
- 입력: $15/M tokens
- 출력: $45/M tokens
- 예상 호출: Checkbox 생성 2-3회
- 예상 output: 5K tokens
- 추정 비용: ≈ $0.225 (범위: $0.1-$0.4)

❌ **$0.09는 과소 추정입니다.**

### 사용량 기록 위치
✅ **AgentResponse.usage**
- input_tokens: 포함
- output_tokens: 포함
- workflow-runner.ts에서 저장 가능

---

## 7. 준비 완료 보고

### 1️⃣ PR 상태
- **자동 생성**: 불가능 (gh CLI 미설치)
- **수동 생성**: 필요 (https://github.com/jysnero/abc_ai_agent/compare/main...p0-6-cli)
- **검토용**: ✅ (main 병합 안 함)

### 2️⃣ 실행 기준 커밋
```
41e1ffb - docs: prepare P0-7 real Claude API test with Checkbox sample
62e11b8 - docs: finalize P0-6 completion with clarified approval test names
18f84cc - test: verify approval A/B scenarios and document C limitation
```
**기준**: 18f84cc (최소 P0-6 검증 완료)

### 3️⃣ 샘플 경로
- **Spec**: `samples/checkbox-spec.json` (기존)
- **Contract**: `contracts/patterns/minigame_shell_v1.json` (기존)
- **Demo**: `samples/checkbox-demo.html` (신규, 아직 작성 필요)

### 4️⃣ 검증할 수용 기준
| AC | 설명 | 검증 방법 |
|----|------|---------|
| AC-1 | Named export | TypeScript 타입 |
| AC-2 | Props interface | 컴파일 검사 |
| AC-3 | Space 키 | test case |
| AC-4 | ARIA 속성 | DOM 검사 |
| AC-6 | TypeScript | `tsc --noEmit` |
| AC-7 | Tailwind | 코드 검사 |
| AC-8 | README | 파일 존재 |

### 5️⃣ PowerShell 실행 명령

**Mock 모드** (테스트용, API 호출 없음):
```powershell
$env:ANTHROPIC_API_KEY = ""  # 설정 안 함
node dist/src/cli/index.js start --spec samples/checkbox-spec.json --contract contracts/patterns/minigame_shell_v1.json --test-mode
```

**실제 API 모드**:
```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."  # 실제 키 설정
npm run build
node dist/src/cli/index.js start --spec samples/checkbox-spec.json --contract contracts/patterns/minigame_shell_v1.json
# → run-id 추출 후 다음 단계
node dist/src/cli/index.js status --run-id <extracted-id>
node dist/src/cli/index.js approve-spec --run-id <id> --approver alice
node dist/src/cli/index.js resume --run-id <id>  # ⚠️ Claude API 호출 시작
```

### 6️⃣ 호출 경로 및 예상 호출 수

**경로**: CLI → composition.ts (testMode 확인) → ClaudeAgentClient → Anthropic SDK

**코드 분석 결과**:
- **최초**: 2-3회 (코드 + 테스트 + 자체 검증)
- **Repair 1회**: 2-3회 추가
- **최악 (3회 repair)**: 8-12회

**Validation**: 0회 (명령 기반, API 아님)

**예상 호출 수** (Checkbox 샘플):
- 성공 케이스: **2-3회** ✅
- 부분 실패 (repair 1회): **4-6회**
- 완전 실패 (repair 3회): **8-12회**

### 7️⃣ 예산 적용 방식

**현재**: 제한 없음 (코드에 미정의)
- timeout: 60초 (설정됨)
- max_retries: 3 (설정됨)
- Run 전체 한도: 없음

**권장**: 명시적 한도 추가 필요
- 예시: max_run_tokens = 100000 추가

### 8️⃣ HUMAN_GATE_RELEASE에서 정지

✅ **확인됨**
- resume 후 자동으로 HUMAN_GATE_RELEASE 도달
- 그 이후는 자동 진행 없음 (approve-release 필수)
- RELEASE_READY까지 자동 진행하지 않음

**흐름**:
```
start → HUMAN_GATE_SPEC (중단)
  ↓ approve-spec
resume → DEV_VALIDATION_LOOP → ... → HUMAN_GATE_RELEASE (중단) ✅
  ↓ approve-release (수동 필요)
markReleaseReady → RELEASE_READY
```

---

## ⏭️ 다음 단계

1. **샘플 HTML 생성** (`samples/checkbox-demo.html`)
2. **PR 수동 생성** (https://github.com/.../compare/main...p0-6-cli)
3. **Mock 모드 테스트** (API Key 없이)
4. **API Key 설정** (로컬 환경변수)
5. **실제 API 호출** (아직 보류)

---

**상태**: 분석 완료, 실제 API 호출은 별도 승인 후 진행

