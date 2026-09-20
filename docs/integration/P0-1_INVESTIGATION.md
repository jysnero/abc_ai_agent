# P0-1 저장소 조사 보고서

> **작성일**: 2026-09-20  
> **목표**: architecture-contract.schema.json 설계를 위한 기존 구조 및 역할 파악

---

## 1. 기존 Contracts 구조 및 명명 규칙

### 1.1 파일 위치

```
contracts/
└── patterns/
    └── minigame_shell_v1.json
```

### 1.2 명명 규칙

- **패턴**: `<domain>_<pattern>_v<major>.json`
- **예**: minigame_shell_v1 → minigame 게임 쉘, v1 버전
- **버전**: 의미론적 버전 (major.minor.patch, 현재 v1.0.0)

### 1.3 schema_version 기록

minigame_shell_v1.json:
- `$schema`: "http://json-schema.org/draft-07/schema#"
- title: "Agent Contract Schema v1.0"

---

## 2. minigame_shell_v1.json 역할 분석

### 2.1 필드 구조

```
{
  "agent_metadata": {           // Agent 정의
    "name", "version", "role"
  },
  "capabilities": {              // 기능 정의
    "core_functions": [...]      // 수행 가능한 작업
    "dependencies": [...]        // Agent 간 의존성
  },
  "bridge_api_contract": {        // WebView 연동 계약
    "api_base_url": "...",
    "endpoints": [...],
    "authentication": {...}
  },
  "validation_rules": {           // 검증 규칙
    "required_fields": [...],
    "constraints": [...]
  }
}
```

### 2.2 역할 정의

| 필드 | 담당 | 목적 |
|------|------|------|
| **agent_metadata** | Agent 정의 | 누가 실행하는가 |
| **capabilities** | 기능 명세 | 무엇을 하는가 |
| **bridge_api_contract** | WebView 연동 | 어떻게 통신하는가 |
| **validation_rules** | 검증 규칙 | 무엇을 검증하는가 |

### 2.3 현재 상태

- ⚠️ bridge_api_contract: EXAMPLE 값 사용 ("https://api.example.com")
- ⚠️ 실제 bridge API 스펙은 네이티브 앱팀에서 별도 제공 필요

---

## 3. 다른 계약과의 관계

### 3.1 계약별 역할 (전체 맥락)

```
User Request
    ↓
request-spec.json (무엇을 만들 것인가?)
    ↓
architecture-contract.schema.json (어떤 구조 안에서 만들 것인가?)
    ↓
execution-plan.json (이번 실행에서 뭘 할 것인가?)
    ↓
code-generation (코드 생성)
    ↓
minigame_shell_v1.json (WebView와 어떻게 통신할 것인가?)
```

### 3.2 중복 가능 필드 분석

| 필드 | minigame_shell | architecture-contract | 중복? | 권장 |
|------|-------|-------|--------|------|
| **role/project_type** | agent_metadata.role | project_type | ❌ 다름 | arch에서 정의 |
| **capabilities** | capabilities.core_functions | 제외 (execution-plan 담당) | ⚠️ 유사 | 중복 제거 |
| **bridge_api** | bridge_api_contract 전체 | bridge_contract_ref (참조만) | ✅ 분리 | $ref 사용 |
| **validation_rules** | validation_rules | quality_gates | ⚠️ 겹침 | 명확히 분리 |
| **dependencies** | capabilities.dependencies | dependency_rules | ⚠️ 겹침 | arch에서 상세화 |

### 3.3 역할 분담 (권장)

**minigame_shell_v1.json** (변경 금지):
- Agent 메타데이터 (이름, 버전, 역할)
- 기능 목록 (core_functions)
- WebView 연동 스펙 (bridge_api_contract 상세)
- Agent 간 의존성 (상위 수준)

**architecture-contract.schema.json** (신규):
- 프로젝트 유형 및 scope (어떤 환경)
- 파일 경로 제약 (어디를 수정할 수 있는가)
- 코드 구조 보호 (무엇을 수정하면 안 되는가)
- 의존성 방향 규칙 (어떻게 연결하는가)
- 인터페이스 보호 (공개 API는 무엇인가)
- 자동 수정 범위 (어디까지 LLM이 건드릴 수 있는가)

---

## 4. JSON Schema 검증 라이브러리 설치 상태

### 4.1 현재 설치 현황

| 라이브러리 | 설치 | 용도 |
|----------|------|------|
| **ajv** | ❌ 미설치 | JSON Schema 검증 |
| **typescript** | ✅ 설치 | 타입 검증 |

### 4.2 평가

**check-arch.ts의 현재 검증**:
- 수동으로 필드 존재 여부만 확인
- JSON Schema validation 미실시
- 경고만 출력 (Error 아님)

**P0-1 선택사항**:

**옵션 A**: 신규 라이브러리 도입 (Ajv)
- ✅ 정식 JSON Schema validation
- ✅ 규칙 변경 시 유연함
- ❌ 런타임 의존성 추가

**옵션 B**: 수동 검증 유지 (현재 방식)
- ✅ 의존성 없음
- ✅ 경량
- ❌ 복잡한 규칙은 구현 어려움

**P0-1 권장**: **옵션 B** (수동 검증)
- 이유: P0-3에서 check-architecture.mjs 작성 시 검증 로직 구현
- P0-3에서 Ajv 도입 검토 후 결정

---

## 5. P0-3 (check-architecture.mjs) 예상 사용 필드

### 5.1 현재 check-arch.ts 검증 내용

```typescript
// 1. 스키마 파일 존재 확인
// 2. 스키마 파일 파싱
// 3. 필수 필드 검증 (agent_metadata, capabilities, bridge_api_contract)
// 4. Bridge API Contract 예제값 검사
// 5. 타겟 폴더 파일 존재 확인
// 6. Agent 클래스/인터페이스 정의 확인
```

### 5.2 P0-3에서 추가될 예상 필드

architecture-contract.schema.json에서:

| 필드 | 검증 방식 | P0-3 구현 예상 |
|------|---------|-------------|
| **schema_version** | 일치 여부 | 스키마 버전 매칭 |
| **contract_id** | 형식 검증 | 계약 ID 포맷 확인 |
| **allowed_paths** | 정규표현식 | 파일 경로 검증 (허용) |
| **forbidden_paths** | 정규표현식 | 파일 경로 검증 (금지) |
| **protected_files** | 목록 비교 | 보호 파일 변경 여부 감시 |
| **allowed_dependencies** | 방향 검증 | import/require 구문 분석 |
| **forbidden_dependencies** | 방향 검증 | 금지된 의존성 감지 |
| **protected_interfaces** | 목록 비교 | public API 서명 변경 감시 |
| **quality_gates** | 임계값 검증 | 테스트 커버리지, 타입 에러 등 |

### 5.3 검증 규칙 상세

**path validation** (정규표현식):
```
allowed_paths: [
  "src/agents/developer.ts",
  "src/runtime/*.ts"
]

forbidden_paths: [
  "src/orchestrator.ts",      // P0-2 전까진 수정 금지
  "package.json",             // 의존성 변경 금지
  ".env*"                      // 환경변수 파일
]
```

**dependency validation** (import 문 분석):
```
allowed_dependencies: {
  "src/agents/developer.ts": [
    "@anthropic-ai/sdk",
    "./index.ts"
  ]
}

forbidden_dependencies: {
  "src/agents/developer.ts": [
    "@anthropic-ai/claude-agent-sdk",  // P0-0에서 변경됨
    "src/orchestrator.ts"               // 순환 참조 방지
  ]
}
```

**interface protection** (클래스/인터페이스):
```
protected_interfaces: {
  "src/agents/developer.ts": [
    "DeveloperAgent",          // 클래스 이름 변경 금지
    "DeveloperAgentConfig",    // 인터페이스 필드 추가 금지
    "execute"                  // 메서드 서명 변경 금지
  ]
}
```

---

## 6. 권장 파일 위치 및 명명

### 6.1 후보 위치

**후보 1**: `contracts/architecture-contract.schema.json`
- 장점: contracts 폴더와 일관성, minigame_shell_v1.json과 나란히 배치
- 단점: "contracts" 이름이 agent contract을 의미할 수도 있어 약간 모호함

**후보 2**: `contracts/schemas/architecture-contract.json`
- 장점: schema 세분화, 향후 확장 용이
- 단점: 중첩 깊어짐

**후보 3**: `.blueprint/contracts/architecture-contract.json`
- 장점: blueprint 설계 문서와 함께 보관
- 단점: contracts 폴더와 분산됨

### 6.2 권장 결정

**선택**: `contracts/architecture-contract.schema.json`

**근거**:
- 기존 minigame_shell_v1.json과 나란히 배치
- "schema.json" suffix로 구분
- contracts 폴더를 "계약" 저장소로 일관성 유지
- P0-3 검사 명령어 일관성 (같은 폴더 내)

**명명**:
- 파일명: `architecture-contract.schema.json`
- 이유: Draft 2020-12 JSON Schema 명명 관례

---

## 7. 중복 및 충돌 가능성 최종 점검

### 7.1 필드별 중복 점검

| 필드 분류 | minigame_shell_v1.json | architecture-contract | 충돌? | 해결 |
|----------|-------|----------|--------|-----|
| **메타데이터** | agent_metadata | contract_metadata | ✅ 분리 | 다른 목적 |
| **기능** | capabilities.core_functions | (excluded) | ✅ 분리 | execution-plan 담당 |
| **의존성** | capabilities.dependencies | dependency_rules | ⚠️ 유사 | arch는 구조 규칙 중심 |
| **Bridge** | bridge_api_contract (전체) | bridge_contract_ref (참조) | ✅ 분리 | $ref로 외부 참조 |
| **검증** | validation_rules | quality_gates | ⚠️ 다른 개념 | 명확히 정의 |
| **경로** | (없음) | allowed/forbidden_paths | ✅ 신규 | 아키텍처에만 필요 |

### 7.2 결론

**충돌 없음** ✅

- minigame_shell_v1.json은 Agent 계약 (무엇을 하는가)
- architecture-contract는 구조 계약 (어떻게 만드는가)
- $ref로 bridge_api_contract 참조하면 중복 제거 완성

---

## 8. P0-1 작업 계획

### 8.1 산출물 목록

1. **contracts/architecture-contract.schema.json**
   - JSON Schema Draft 2020-12
   - 모든 필드 정의 (scope, constraints, rules 포함)

2. **정상 예제**:
   - examples/valid-architecture-contract.json

3. **실패 예제**:
   - examples/invalid-additional-properties.json (추가 필드)
   - examples/invalid-forbidden-path.json (금지된 경로)

4. **문서**:
   - docs/integration/ARCHITECTURE_CONTRACT_GUIDE.md

5. **P0-3 점검 목록**:
   - docs/integration/P0-3_VALIDATION_CHECKLIST.md

### 8.2 예상 스키마 구조

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://nh-ollone.example.com/schemas/architecture-contract.schema.json",
  "title": "Architecture Contract Schema",
  "version": "1.0.0",
  "type": "object",
  
  "required": [
    "schema_version", "contract_id", "project_type",
    "scope", "allowed_paths", "forbidden_paths",
    "dependency_rules", "quality_gates"
  ],
  
  "properties": {
    "schema_version": { ... },
    "contract_id": { ... },
    "project_type": { ... },
    "scope": { ... },
    "allowed_paths": { ... },
    "forbidden_paths": { ... },
    "protected_files": { ... },
    "dependency_rules": { ... },
    "protected_interfaces": { ... },
    "bridge_contract_ref": { ... },
    "external_integrations": { ... },
    "security_constraints": { ... },
    "quality_gates": { ... },
    "auto_fix_scope": { ... },
    "approval_requirements": { ... }
  },
  
  "additionalProperties": false
}
```

---

**조사 완료**: P0-1 설계 진행 가능  
**다음**: 스키마 설계 및 파일 생성