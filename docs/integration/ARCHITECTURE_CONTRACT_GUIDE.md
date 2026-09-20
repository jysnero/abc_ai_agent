# Architecture Contract 가이드

> **대상**: Developer Agent, Architect Agent, P0-3 검증 담당자  
> **문서 버전**: 1.0.0  
> **작성일**: 2026-09-20

---

## 1. 개요

### 1.1 Architecture Contract의 목적

**Architecture Contract** (`contracts/architecture-contract.schema.json`)는 Architect Agent가 발급하는 생성 대상 WebView 서비스의 구조적 경계와 수정 허용 범위를 정의하는 계약입니다.

```
Architect Agent
    ↓ (발급)
Architecture Contract
    ↓ (준수)
Developer Agent
    ↓ (생성)
WebView Service Source Code
    ↓ (검증)
P0-3 check-architecture.mjs
```

### 1.2 계약의 역할

| 계약 | 역할 |
|------|------|
| **Architect Contract** | 각 요청의 생성 대상이 준수할 구조 규칙 정의 |
| **minigame_shell_v1.json** | Agent 템플릿과 기본 정책 정의 (플랫폼팀 관리) |
| **execution-plan.json** | 이번 실행에서 실제로 수정할 파일과 작업 (Developer Agent이 결정) |

---

## 2. 필드 상세 설명

### 2.1 contract_id

**용도**: 요청 건별 고유 식별자

**형식**: `req-YYYY-MMDD-NNN-<service_type>`

**예시**:
- `req-2026-0920-001-minigame` (2026년 9월 20일, 001번째, 미니게임)
- `req-2026-0920-002-quiz` (같은 날 002번째, 퀴즈)

**검증** (P0-3):
- 형식 일치 확인
- 다른 계약과 중복되지 않는지 확인

---

### 2.2 version

**용도**: 계약의 버전

**형식**: Semantic Versioning (`X.Y.Z`)

**예시**:
- `1.0.0` (초기 계약)
- `1.1.0` (Bridge API 확장)
- `2.0.0` (주요 구조 변경)

**검증** (P0-3):
- 패턴 일치 확인

---

### 2.3 pattern_type

**용도**: 생성 대상이 기반할 템플릿 패턴 식별

**형식**:
- 기존 패턴: `<도메인>_shell_v<N>` (예: `minigame_shell_v1`)
- 신규 패턴: `custom:<설명>` (예: `custom:만보걷기형`)

**예시**:
```json
"pattern_type": "minigame_shell_v1"
```

**검증** (P0-3):
- `minigame_shell_v1`이면 `contracts/patterns/minigame_shell_v1.json` 존재 확인
- `custom:*`이면 계약 내용이 충분히 상세한지 검토
- 등록되지 않은 패턴은 에러

---

### 2.4 issued_by

**용도**: 계약 발급 주체 명시

**값**: 상수 `"architect_agent"`

**예시**:
```json
"issued_by": "architect_agent"
```

**검증** (P0-3):
- 값이 정확히 `"architect_agent"`인지 확인

---

### 2.5 folder_structure

**용도**: 생성되는 WebView 서비스의 파일 구조 규칙

**부분 필드**:

#### 2.5.1 required_files

**정의**: 반드시 존재해야 하는 파일 목록

**형식**: 저장소 상대경로 배열

**예시**:
```json
"required_files": [
  "src/index.tsx",
  "src/pages/Game.tsx",
  "package.json",
  "tsconfig.json"
]
```

**검증** (P0-3):
- 생성된 서비스에서 이 파일들이 모두 존재하는지 확인
- 하나라도 빠지면 에러

#### 2.5.2 allowed_globs

**정의**: 생성 가능한 파일 경로 패턴

**형식**: glob 패턴 배열 (상대경로만)

**제약**:
- `../`를 포함한 경로는 금지 (상위 디렉토리 접근 금지)
- 절대경로 금지
- 저장소 루트 기준 상대경로만

**예시**:
```json
"allowed_globs": [
  "src/**/*.{ts,tsx}",    // src 아래 모든 TypeScript/TSX
  "tests/**/*.{ts,tsx}",  // 테스트 파일
  "public/**/*",          // 정적 자산
  "package.json",         // 패키지 설정
  "tsconfig.json"
]
```

**금지된 경로**:
```json
// ❌ 상위 디렉토리 접근
"../other-project/**/*",

// ❌ 절대경로
"/absolute/path/**/*",

// ❌ WebView 외부
"../../platform/**/*"
```

**검증** (P0-3):
- 생성된 모든 파일이 어떤 glob 패턴에 매치되는지 확인
- 매치되지 않는 파일 존재 → 에러

---

### 2.6 allowed_dependencies

**용도**: 외부 라이브러리와 스크립트 호스트의 allowlist

**부분 필드**:

#### 2.6.1 script_hosts

**정의**: `<script src>` 태그로 로드 가능한 CDN 호스트

**형식**: URI 배열

**예시**:
```json
"script_hosts": [
  "https://cdnjs.cloudflare.com",
  "https://cdn.jsdelivr.net"
]
```

**검증** (P0-3):
- 생성된 HTML/JS에서 `<script src>` 호스트가 이 리스트 내에만 있는지 확인
- 다른 호스트에서 스크립트 로드 → 에러

#### 2.6.2 npm_packages

**정의**: 번들에 포함 가능한 npm 패키지 allowlist

**형식**: 패키지명 또는 `패키지명@버전` 배열

**예시**:
```json
"npm_packages": [
  "react@^18.0.0",
  "react-dom@^18.0.0",
  "typescript@^5.0.0",
  "axios@^1.4.0"
]
```

**검증** (P0-3):
- 생성된 `package.json`의 의존성이 이 리스트 내에만 있는지 확인
- 허용되지 않은 패키지 추가 → 에러
- 버전 범위는 P0-3에서 검증 (현재 단계: 형식만 검증)

---

### 2.7 bridge_contract_ref

**용도**: 외부에 정의된 Bridge 계약 파일 참조

**형식**: contract_id + 상대경로

**예시**:
```json
"bridge_contract_ref": {
  "contract_id": "minigame_shell_v1",
  "path": "contracts/patterns/minigame_shell_v1.json"
}
```

**필드**:

| 필드 | 설명 |
|------|------|
| **contract_id** | 외부 계약 식별자 (예: minigame_shell_v1) |
| **path** | 계약 파일 상대경로 (P0-3에서 존재 확인) |

**검증** (P0-3):
- 지정된 파일이 존재하는지 확인
- 파일의 contract_id와 일치하는지 확인

---

### 2.8 bridge_policy

**용도**: 이 요청에서 허용되는 Bridge 메서드와 호출 제약

**형식**: 메서드명을 키로 하는 객체

**예시**:
```json
"bridge_policy": {
  "NHBridge.reward.grantPoint": {
    "max_calls_per_session": 7,
    "requires_approval": false
  },
  "NHBridge.payment.charge": {
    "max_calls_per_session": 1,
    "requires_approval": true
  }
}
```

**메서드별 필드**:

| 필드 | 타입 | 설명 |
|------|------|------|
| **max_calls_per_session** | integer | 세션당 최대 호출 횟수 (최소 1) |
| **requires_approval** | boolean | 이 메서드 사용 시 사람 승인 필요 (선택) |

**검증** (P0-3):
- 생성된 코드에서 호출하는 Bridge 메서드가 이 정책에 정의되어 있는지 확인
- 허용되지 않은 메서드 호출 → 에러
- requires_approval = true인 메서드는 execution-plan에 있으면 사람 승인 필수
- 세션당 호출 횟수 추적: execution_plan.bridge_usage ≤ max_calls_per_session

---

### 2.9 forbidden_patterns (수정됨)

**용도**: 생성 코드에서 금지되는 코딩 패턴

---

### 2.8 forbidden_patterns

**용도**: 생성 코드에서 금지되는 코딩 패턴

**형식**: 정규표현식 기반 패턴 배열

**각 패턴 필드**:

| 필드 | 타입 | 설명 |
|------|------|------|
| **id** | string | 패턴 고유 ID |
| **regex** | string | 정규표현식 |
| **reason** | string | 금지 이유 |
| **severity** | string | `"block"` 또는 `"warn"` |

**예시**:
```json
"forbidden_patterns": [
  {
    "id": "no-eval",
    "regex": "\\beval\\s*\\(",
    "reason": "eval() is a security risk",
    "severity": "block"
  },
  {
    "id": "no-hardcoded-secret",
    "regex": "api[_-]?key|secret|token.*=.*['\\\"]",
    "reason": "Hardcoded credentials must not be committed",
    "severity": "block"
  }
]
```

**검증** (P0-3):
- 생성된 모든 파일을 대상으로 각 regex 실행
- 매치되면:
  - `severity: "block"` → 에러 (커밋 불가)
  - `severity: "warn"` → 경고 (커밋 가능하지만 주의)
- Regex 유효성 오류 → 에러

**주의**:
- Regex는 P0-1에서는 문법 검증만 함
- 실제 정규표현식 실행은 P0-3에서 수행

---

### 2.10 design_tokens_ref

**용도**: 디자인 시스템 토큰 문서 또는 파일 참조

**형식**: 저장소 상대경로

**제약**:
- 절대경로 금지
- `../` 상위 디렉토리 접근 금지

**예시**:
```json
"design_tokens_ref": "design/tokens.json"
```

**검증** (P0-3):
- 지정된 파일이 존재하는지 확인
- 파일 없으면 경고 또는 에러

---

## 3. Plan Builder와 Execution-Plan 생성

### 3.1 입력 (Plan Builder Input)

Plan Builder는 다음을 모두 받아야 합니다:

| 입력 | 역할 | 예시 |
|------|------|------|
| **request-spec** | 작업 요구사항 ("무엇을 만들어야 하는가") | "미니게임 유형: 순발력 게임, 점수 시스템 포함" |
| **architecture-contract** | 구조 제약 ("무엇이 허용되는가") | "src/**/*.tsx, tests/**/*.tsx만 수정 가능" |
| **repository-context** | 실제 파일 구조 | 현재 저장소의 파일 목록, writable/readonly/forbidden 범위 |
| **template-registry** | 재사용 가능한 템플릿 | minigame_shell_v1의 파일 패턴 |
| **previousPlan?** | 이전 plan (선택) | 다시 시도할 때 이전 결과 참고 |

### 3.2 개념적 위계

```
Architecture Contract (최대 경계: "무엇이 허용되는가")
    ↑ (포함)
    │
    └─→ Execution Plan (실제 작업 범위: "무엇을 만들어야 하는가" + 제약 준수)
```

**규칙**: `execution_plan.target_files ⊆ architecture_contract.allowed_globs`

### 3.2 예시

**Architecture Contract**:
```json
{
  "folder_structure": {
    "allowed_globs": ["src/**/*.tsx", "tests/**/*.tsx", "public/**/*"]
  },
  "bridge_api_contract": {
    "NHBridge.reward.grantPoint": {
      "max_calls_per_session": 7
    }
  }
}
```

**Execution Plan** (부분):
```json
{
  "target_files": ["src/game/Game.tsx", "tests/game/Game.test.tsx"],
  "bridge_usage": {
    "NHBridge.reward.grantPoint": 2
  }
}
```

**검증**:
- ✅ `src/game/Game.tsx` ⊆ `src/**/*.tsx`
- ✅ `tests/game/Game.test.tsx` ⊆ `tests/**/*.tsx`
- ✅ `2` ≤ `7` (호출 횟수)

---

## 4. 생성 및 관리

### 4.1 발급 프로세스

1. **Architect Agent**: 사용자 요청을 분석하고 architecture-contract 생성
2. **Developer Agent**: 계약 로드 및 준수 확인
3. **P0-3 검증**: 자동 검증 실행

### 4.2 버전 관리

계약이 변경될 때:
1. `version` 필드 증분 (Semantic Versioning)
2. 새 `contract_id` 발급
3. 기존 계약과의 차이점 문서화

---

## 5. 일반적인 에러

### 5.1 JSON Schema 검증 실패

**원인**: 필드 누락, 타입 오류, enum 위반 등

```
❌ "contract_id" is required
❌ "version" must match pattern "^\d+\.\d+\.\d+$"
❌ "issued_by" must be "architect_agent"
```

**해결**: 스키마 파일 재검토

### 5.2 P0-3 검증 실패

**원인**: 경로 패턴, Bridge 호출, 금지된 패턴 등

```
❌ File "dist/bundle.js" does not match any allowed glob
❌ Bridge method "NHBridge.payment.charge" not in contract
❌ Forbidden pattern "eval(" found in src/utils.ts:42
```

**해결**: execution-plan 또는 생성 코드 수정

---

## 6. 체크리스트 (계약 작성 시)

- [ ] `contract_id` 형식 확인 (`req-YYYY-MMDD-NNN-...`)
- [ ] `version`이 Semantic Versioning 준수
- [ ] `pattern_type` 등록된 패턴이거나 `custom:` 접두사
- [ ] `folder_structure.required_files` 필수 파일 최소한 하나 이상
- [ ] `folder_structure.allowed_globs` 상위 디렉토리 접근(`../`) 없는지 확인
- [ ] `allowed_dependencies.npm_packages` 버전 명시 권장
- [ ] `bridge_api_contract` 메서드별 `max_calls_per_session` ≥ 1
- [ ] `forbidden_patterns` 정규표현식 검증 (P0-1: 문법, P0-3: 실행)
- [ ] `design_tokens_ref` 경로 형식 확인
- [ ] 전체 JSON 형식 검증

---

**문서 끝**