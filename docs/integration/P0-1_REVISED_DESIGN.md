# P0-1 수정 설계안 보고서

> **작성일**: 2026-09-20  
> **목적**: 사용자 피드백 반영 후 architecture-contract.schema.json 최종 설계안 제시  
> **참조**: C:\Users\cho\Downloads\nh-agent-platform-starter\nh-agent-platform\contracts\architecture-contract.schema.json

---

## 1. 계약 대상 명확화

### 1.1 이 계약의 목적 (명시 문구)

```
Architecture Contract: Architect Agent가 정의한 생성 대상 WebView 서비스의 
구조적 경계와 수정 허용 범위를 Developer Agent가 준수하도록 강제하는 기계 검증 가능한 계약.

대상: Agent Platform 소스가 아닌, 생성되는 각 WebView 서비스 (예: 미니게임, 퀴즈)
범위: 파일 구조, 의존성, Bridge API 사용 범위, 금지된 코딩 패턴
검증: 각 커밋 시 자동 실행 (P0-3 check-architecture.mjs)
```

### 1.2 Agent Platform 보호와의 구분

**이 계약에서 제외**:
- Agent Platform 자체의 orchestrator, agents, runtime 구조 보호
- Platform 소스 수정 제한
- Platform 내부 의존성 규칙

**별도 관리 (현재)**:
- CLAUDE.md: v0.1 제약 명시, 재설계 금지 항목 기록
- 정적 검사: CI/CD 단계에서 수행 (추후)
- Platform Policy: 별도 schema 분리 (v0.2+)

---

## 2. 최상위 필드 구조 (수정안)

### 2.1 필드 목록 및 변경사항

**참조 파일의 필드** (nh-agent-platform-starter):
```json
{
  "contract_id": "string",                    // 요청 건별 고유 ID
  "version": "string",                        // Semantic versioning
  "pattern_type": "string",                   // 템플릿 패턴 ID
  "issued_by": "architect_agent",             // 발급 주체 (상수)
  
  "folder_structure": {                       // 파일 경로 제약
    "required_files": [],                     // 반드시 존재
    "allowed_globs": []                       // 허용 경로 패턴
  },
  
  "allowed_dependencies": {                   // 의존성 allowlist
    "script_hosts": [],                       // CDN 호스트
    "npm_packages": []                        // npm 패키지
  },
  
  "bridge_api_contract": {                    // Bridge API 메서드 정의
    "<method_name>": {
      "params_schema": {},
      "returns_schema": {},
      "max_calls_per_session": 7,
      "idempotent": false
    }
  },
  
  "forbidden_patterns": [                     // 금지된 코딩 패턴
    {
      "id": "pattern_id",
      "regex": "pattern",
      "reason": "why forbidden",
      "severity": "block" | "warn"
    }
  ],
  
  "design_tokens_ref": "path/to/tokens"      // 디자인 토큰 참조
}
```

### 2.2 현재 설계 평가

**유지할 부분** (참조 파일 설계 우수):
- folder_structure: 경로 제약을 required_files + allowed_globs로 단순화 ✅
- forbidden_patterns: 정규식 기반 코드 패턴 검사 ✅
- allowed_dependencies: allowlist 방식 (명시적, 안전) ✅
- bridge_api_contract: 메서드별 스펙 정의 ✅

**수정할 부분** (사용자 피드백):

| 항목 | 현재 | 수정안 | 근거 |
|------|------|--------|------|
| **file_boundaries** | 없음 | folder_structure 유지 | 이미 최적화 |
| **protected_files** | 없음 | forbidden_patterns의 regex로 표현 가능 | 중복 제거 |
| **auto_fix_scope** | 없음 | 불필요 (execution-plan이 담당) | 책임 분리 |
| **bridge_contract_ref** | bridge_api_contract 직접 | 현 설계 유지 | minigame_shell과 중복되지 않음 |

---

## 3. 필드별 소유 책임

### 3.1 Architecture Contract 책임 (P0-1)

| 필드 | 의미 | 검증 시점 | 책임자 |
|------|------|---------|--------|
| **contract_id** | 요청 건별 고유 ID | 스키마 검증 | Architect Agent (발급) |
| **version** | 계약 버전 | 스키마 검증 | Architect Agent |
| **pattern_type** | 사용할 템플릿 | P0-3: 템플릿 존재 확인 | Architect Agent |
| **folder_structure** | 파일 경로 제약 | P0-3: glob 패턴 일치성 | Developer Agent (준수) |
| **allowed_dependencies** | 의존성 allowlist | P0-3: import 문 분석 | Developer Agent (준수) |
| **bridge_api_contract** | Bridge 메서드 스펙 | P0-3: 호출 가능성 검증 | Architect Agent (발급) |
| **forbidden_patterns** | 코드 패턴 금지 | P0-3: regex 매치 검사 | Developer Agent (준수) |
| **design_tokens_ref** | 디자인 시스템 참조 | P0-3: 파일 존재 확인 | Architect Agent (발급) |

### 3.2 Execution Plan 책임 (별도, P0-2)

| 필드 | 의미 | 제약 |
|------|------|------|
| **target_files** | 실제 생성/수정 파일 | ⊆ folder_structure.allowed_globs |
| **allowed_scope** | 수정 깊이 (function/module) | ⊆ architecture_contract 범위 |
| **commands** | 실행할 검증 명령 | typeCheck, test, lint 등 |

**관계식**:
```
execution_plan.target_files ⊆ architecture_contract.allowed_globs
execution_plan.changes ⊆ architecture_contract.permitted_changes
```

---

## 4. Architecture-Contract와 Execution-Plan 관계

### 4.1 개념적 관계

```
Architecture Contract (최대 경계)
├─ 허용 경로: src/game/**, src/pages/**
├─ 금지 패턴: eval, hardcoded_secret, direct_bridge_string
├─ Bridge 메서드: NHBridge.reward.grantPoint (max_calls=7)
└─ 의존성: @react/hooks, axios만 허용

    ↓ subset of

Execution Plan (실행별 계획)
├─ 이번 실행에서 생성할 파일: src/game/minigame.tsx
├─ 이번 실행에서 수정할 범위: function 수준
├─ 이번 실행에서 사용할 Bridge: NHBridge.reward.grantPoint (2회)
└─ 이번 실행에서 금지할 변경: interface 변경, 기존 파일 삭제
```

### 4.2 설계 원칙

**Architecture Contract 정책**:
```json
"bridge_api_contract": {
  "NHBridge.reward.grantPoint": {
    "max_calls_per_session": 7,        // 이 계약의 최대 한도
    "idempotent": false                // 특성 (정책)
  }
}
```

**Execution Plan 결정** (예):
```json
"bridge_usage": {
  "NHBridge.reward.grantPoint": 2      // 이 실행에서 2회 사용 (한도 7 이내)
}
```

✅ **원칙**: architecture_contract의 정책(max, forbidden)만 정의. 실제 파일과 개수는 execution_plan이 결정.

---

## 5. JSON Schema 검증 vs P0-3 의미 검증

### 5.1 JSON Schema가 검증할 항목 (P0-1)

✅ **JSON Schema Draft 2020-12 내에서 검증 가능**:

```
□ contract_id: 필수, 타입=string
□ version: 필수, 패턴="\d+\.\d+\.\d+"
□ pattern_type: 필수, 타입=string
□ issued_by: 필수, const="architect_agent"
□ folder_structure.required_files: 필수, 배열, 요소=string
□ folder_structure.allowed_globs: 필수, 배열, 요소=string (glob 패턴)
□ allowed_dependencies.script_hosts: 필수, 배열, 요소=uri format
□ allowed_dependencies.npm_packages: 필수, 배열, 요소=string
□ bridge_api_contract: 필수, object, additionalProperties
  └─ 각 메서드:
    ├─ params_schema: 필수, object
    ├─ returns_schema: 필수, object
    ├─ max_calls_per_session: 필수, integer ≥ 1
    └─ idempotent: 선택, boolean
□ forbidden_patterns: 필수, 배열, 각 항목:
  ├─ id: 필수, string
  ├─ regex: 필수, string
  ├─ reason: 필수, string
  └─ severity: 필수, enum["block", "warn"]
□ design_tokens_ref: 필수, 상대경로 format
□ additionalProperties: false (허용되지 않은 필드 차단)
```

### 5.2 P0-3 (check-architecture.mjs)가 검증할 항목

⚠️ **코드 실행과 파일 시스템 접근 필요**:

```
□ pattern_type 일치성: 템플릿 저장소(contracts/patterns/)에 실제 존재?
□ folder_structure 일치성:
  ├─ required_files: 생성된 서비스에서 모두 존재?
  └─ allowed_globs: 생성된 파일이 이 패턴 내에만?
□ allowed_dependencies 준수:
  ├─ script_hosts: <script src>가 allowlist 내 호스트만?
  └─ npm_packages: package.json의 의존성이 allowlist 내만?
□ forbidden_patterns 준수:
  ├─ 각 regex를 모든 생성 파일에 적용
  └─ 매치되면 에러(severity=block) 또는 경고(severity=warn)
□ bridge_api_contract 준수:
  ├─ 코드 내 NHBridge.* 호출 분석
  ├─ 허용된 메서드만 사용?
  └─ 세션당 호출 횟수 ≤ max_calls_per_session?
□ design_tokens_ref: 지정된 파일 존재?
□ execution_plan과의 관계:
  └─ execution_plan.target_files ⊆ this.allowed_globs?
```

### 5.3 구분 설계

**JSON Schema**:
- 필수 필드, 타입, enum, 형식 검증
- 구조적 무결성만 확인
- 런타임 의존성 없음

**P0-3 의미 검증**:
- 파일 시스템 접근 필요
- 실제 프로젝트와 일치성 검증
- 정규표현식 실행 및 분석

---

## 6. 정상 예제에서 사용할 실제 경로

### 6.1 생성 대상 WebView 프로젝트 구조 조사

**참조**: blueprint-developer-agent.md의 Step 2-2 "Repository Context"

생성되는 WebView 서비스의 예상 구조:
```
generated-project/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.tsx               // 진입점
│   ├── pages/
│   │   ├── Game.tsx            // 게임 페이지
│   │   └── Result.tsx          # 결과 페이지
│   ├── components/
│   │   ├── GameBoard.tsx       # 게임 보드
│   │   └── ScoreDisplay.tsx    # 점수 표시
│   ├── hooks/
│   │   └── useGameLogic.ts     # 게임 로직
│   ├── types/
│   │   └── index.ts            # 타입 정의
│   └── utils/
│       ├── bridge.ts           # NHBridge 호출
│       └── api.ts              # API 유틸
├── public/
│   └── index.html
└── tests/
    └── Game.test.tsx
```

### 6.2 정상 예제의 설정

**예제 이름**: `valid-minigame-contract.json`

```json
{
  "contract_id": "req-2026-0920-001-minigame",
  "version": "1.0.0",
  "pattern_type": "minigame_shell_v1",
  "issued_by": "architect_agent",
  
  "folder_structure": {
    "required_files": [
      "src/index.tsx",
      "src/pages/Game.tsx",
      "package.json",
      "tsconfig.json"
    ],
    "allowed_globs": [
      "src/**/*.{ts,tsx}",
      "tests/**/*.{ts,tsx}",
      "public/**/*",
      "package.json",
      "tsconfig.json"
    ]
  },
  
  "allowed_dependencies": {
    "script_hosts": [
      "https://cdnjs.cloudflare.com",
      "https://cdn.jsdelivr.net"
    ],
    "npm_packages": [
      "react@^18.0.0",
      "react-dom@^18.0.0",
      "typescript@^5.0.0"
    ]
  },
  
  "bridge_api_contract": {
    "NHBridge.reward.grantPoint": {
      "params_schema": {
        "type": "object",
        "required": ["stage", "amount"],
        "properties": {
          "stage": { "type": "string" },
          "amount": { "type": "number" }
        }
      },
      "returns_schema": {
        "type": "object",
        "properties": {
          "success": { "type": "boolean" },
          "newTotal": { "type": "number" }
        }
      },
      "max_calls_per_session": 7,
      "idempotent": false
    },
    "NHBridge.nav.close": {
      "params_schema": { "type": "object" },
      "returns_schema": { "type": "object" },
      "max_calls_per_session": 1,
      "idempotent": true
    }
  },
  
  "forbidden_patterns": [
    {
      "id": "no-eval",
      "regex": "\\beval\\s*\\(",
      "reason": "eval() is security risk",
      "severity": "block"
    },
    {
      "id": "no-hardcoded-secret",
      "regex": "api[_-]?key|secret|token.*=.*['\\\"]",
      "reason": "Hardcoded credentials must not be committed",
      "severity": "block"
    },
    {
      "id": "no-direct-bridge-string",
      "regex": "NHBridge\\.['\\\"]",
      "reason": "Must use bridge adapter, not string literals",
      "severity": "block"
    }
  ],
  
  "design_tokens_ref": "design/tokens.json"
}
```

### 6.3 실패 예제

**예제 1**: `invalid-additional-properties.json`
- 추가 필드 포함 (additionalProperties: false 위반)
- JSON Schema 검증 실패 ❌

**예제 2**: `invalid-forbidden-path.json`
- allowed_globs 패턴 외 경로 포함 (예: `dist/**`)
- JSON Schema는 통과, P0-3에서 실패 ⚠️

**예제 3**: `invalid-bridge-api.json`
- bridge_api_contract 메서드 필드 부족 (params_schema 없음)
- JSON Schema 검증 실패 ❌

---

## 7. 기존 minigame_shell_v1.json과의 참조 방식

### 7.1 두 계약의 역할 구분

| 계약 | minigame_shell_v1.json | architecture-contract |
|-----|-------|----------|
| **발급 주체** | 플랫폼팀 (템플릿) | Architect Agent (요청별) |
| **버전** | 고정 (v1.0.0) | 요청별 버전 |
| **대상** | Agent 역할 정의 | 생성 서비스 구조 |
| **agent_metadata** | ✅ 포함 | ❌ 제외 |
| **capabilities** | ✅ 포함 (Agent 기능) | ❌ 제외 |
| **bridge_api_contract** | ⚠️ EXAMPLE | ✅ 실제 스펙 |
| **validation_rules** | ✅ 기본 규칙 | ❌ 제외 |
| **folder_structure** | ❌ 없음 | ✅ 추가 |
| **forbidden_patterns** | ❌ 없음 | ✅ 추가 |

### 7.2 참조 방식 (채택)

**방식**: 독립적 정의 (중복 제거)

```json
// architecture-contract.schema.json
{
  "pattern_type": "minigame_shell_v1",  // 어떤 템플릿인가 (참조)
  
  "bridge_api_contract": {               // 이 요청에서 허용되는 실제 메서드
    "NHBridge.reward.grantPoint": { ... }
  }
}
```

**검증 규칙** (P0-3):
1. `pattern_type`과 일치하는 템플릿(minigame_shell_v1.json) 파일 존재 확인
2. `bridge_api_contract`의 메서드명이 minigame_shell_v1.json의 capabilities에 포함되는지 검증
3. 중복 정의 없음 (각 계약이 책임영역만 정의)

**이유**:
- minigame_shell_v1.json: Agent와 템플릿 정의 (정적, 플랫폼팀 관리)
- architecture-contract: 각 요청의 실제 제약 (동적, Architect Agent 발급)
- 중복 저장 방지, 참조 무결성 유지

---

## 최종 정리

| 항목 | 설계 | 상태 |
|------|------|------|
| **계약 대상** | 생성 대상 WebView 서비스 (Agent Platform 아님) | ✅ 확정 |
| **최상위 필드** | 참조 파일 설계 유지 (8개 필드) | ✅ 확정 |
| **경로 제약** | folder_structure.allowed_globs (통합) | ✅ 확정 |
| **architecture-contract ⊆ execution-plan** | 관계식 명시 | ✅ 확정 |
| **JSON Schema 검증** | 필수/타입/enum/format만 | ✅ 확정 |
| **P0-3 의미 검증** | 파일/패턴/의존성 분석 | ✅ 확정 |
| **정상 예제 경로** | src/**/*.tsx, tests/**, public/ | ✅ 확정 |
| **bridge 참조** | pattern_type으로 간접 참조 | ✅ 확정 |

---

**다음**: 수정 설계안 확인 후 파일 생성 진행