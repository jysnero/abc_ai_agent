# NH Agent Platform 통합 분석 보고서

> **분석 기준**: E:\ai-agent-platform (Developer Agent v0.1 설계) ↔ C:\Users\cho\Downloads\nh-agent-platform-starter\nh-agent-platform (목표 아키텍처)
>
> **작성일**: 2026-09-19

---

## 1. 파일 단위 매핑표 (구조 비교)

| 첨부 파일 경로 | 현재 프로젝트 경로 | 관계 | 상태 | 비고 |
|---|---|---|---|---|
| CLAUDE.md | E:\ai-agent-platform\CLAUDE.md | **수정** | ◐ 부분 통합 | v0.1 제약 명시, 파이프라인 전체 설명 추가 |
| package.json | E:\ai-agent-platform\package.json | **그대로** | ✓ 재사용 가능 | @anthropic-ai/claude-agent-sdk 의존성 동일 |
| README.md | E:\ai-agent-platform\README.md | **수정** | ◐ 부분 통합 | 목표는 더 상세한 파이프라인 설명 필요 |
| tsconfig.json | E:\ai-agent-platform\tsconfig.json | **그대로** | ✓ 재사용 가능 | TypeScript/ESM 설정 동일 |
| scripts/check-architecture.mjs | E:\ai-agent-platform\scripts\check-arch.ts | **수정** | ◐ 마이그레이션 필요 | TypeScript → Node.js로 변환, 규칙 기반 검증 추가 |
| contracts/patterns/minigame_shell_v1.json | E:\ai-agent-platform\contracts\patterns\minigame_shell_v1.json | **수정** | ◐ 확장 필요 | 예시 → 실제 bridge_api_contract 포함 |
| contracts/architecture-contract.schema.json | ← **신규** | **신규** | ◉ 생성 필요 | Architect Agent 계약 형식 정의 (목표에서 복사 가능) |
| src/orchestrator.ts | E:\ai-agent-platform\src\orchestrator.ts | **수정** | ◐ 전체 재설계 | 기본 Agent 등록 → 상태머신 + callAgent() 래퍼 |
| src/agents/developer.ts | E:\ai-agent-platform\src\agents\developer.ts | **수정** | ◐ 경량화 필요 | SDK query() 호출로 단순화, 메서드 제거 |
| src/index.ts | E:\ai-agent-platform\src\index.ts | **수정** | ◐ 진입점 변경 | 간단한 테스트 → orchestrate() 호출로 변경 |

---

## 2. 그대로 재사용 가능한 항목

### 2.1 코드 및 라이브러리

| 항목 | 파일명 | 적용 방법 |
|---|---|---|
| **Orchestrator 기본 인터페이스** | E:\ai-agent-platform\src\orchestrator.ts | Agent/AgentTask/PipelineState 타입 정의 |
| **Agent Role enum** | minigame_shell_v1.json | 역할 목록: developer, validator, optimizer, executor, monitor, feedback, config |
| **Bridge API 개념** | contracts/patterns/minigame_shell_v1.json | NHBridge.* 메서드 패턴 |
| **프로젝트 설정** | CLAUDE.md + package.json | v0.1 제약, npm 스크립트 그대로 사용 |
| **개발 워크플로우** | CLAUDE.md | /blueprint, /deep-dive, /reflect 스킬 지시 |

### 2.2 설정 및 문서

- **CLAUDE.md 핵심 내용**: v0.1은 Developer Agent 하나만, bridge_api_contract는 예시 → 그대로 유지
- **package.json 의존성**: @anthropic-ai/claude-agent-sdk 버전 → 그대로 유지
- **Agent Role 정의**: 7개 역할 → 그대로 유지

---

## 3. 수정 후 재사용할 항목

### 3.1 Orchestrator 상태머신 업그레이드

**현재 v0.1**:
- Agent 등록 / Task 생성 / Task 실행 (시뮬레이션)
- 상태: pending, running, completed, failed
- ✗ 상태 전환 제어 없음

**목표 아키텍처**:
- 상태머신: PLANNING → DESIGN → ARCH_CONTRACT → HUMAN_GATE_SPEC → DEV_QA_LOOP → HUMAN_GATE_RELEASE → DEVOPS → DONE/ESCALATED
- callAgent() 래퍼 (systemPrompt, allowedTools, cwd)
- 감사 로그 (AuditEntry: ts, stage, actor, summary)
- Retry 정책 (MAX_DEV_QA_RETRIES=3, MAX_ARCH_RETRIES=2)

**마이그레이션**:
1. `type Stage` 추가 (PLANNING, DESIGN, ..., ESCALATED)
2. `interface PipelineState` 확장 (requestId, stage, artifacts, auditLog, projectDir)
3. `callAgent()` 함수 추가 (query() 호출 + audit logging)
4. `orchestrate()` 메인 루프 구현

### 3.2 Developer Agent 간소화

**현재**: Anthropic SDK 직접 사용, 여러 메서드 (reviewCode, generateTests, etc.)
**목표**: callAgent() 래퍼로 통일, allowedTools 최소 권한

### 3.3 검증 스크립트 마이그레이션

**현재**: check-arch.ts (TypeScript, 기본 스키마만)
**목표**: check-architecture.mjs (Node.js, 규칙 기반)

**추가 검증**:
- folder_structure, allowed_dependencies
- bridge_api_contract (max_calls_per_session)
- forbidden_patterns (regex 기반)

---

## 4. 폐기할 항목과 이유

| 항목 | 이유 |
|---|---|
| **DeveloperAgent 클래스의 execute()** | callAgent() 래퍼로 통일하여 감사 로그 일관성 보장 |
| **DeveloperAgent.reviewCode()** | unified prompt 기반으로 통합 |
| **DeveloperAgent.generateTests()** | unified prompt 기반으로 통합 |
| **DeveloperAgent.reviewArchitecture()** | unified prompt 기반으로 통합 |
| **src/index.ts의 간단한 테스트** | full orchestration flow 테스트 필요 |
| **기본 Agent 등록 (createOrchestrator)** | 상태머신이 Agent를 암묵적으로 관리 |
| **Validator/Optimizer/Executor 틀** | v0.1은 Developer만, 다른 Agent는 v0.2+ |

---

## 5. 계약 필드 비교표 (minigame_shell_v1.json 통합)

| 필드명 | v0.1 현재 | 목표 | 통합 후 | 상태 |
|---|---|---|---|---|
| **contract_id** | ✗ 없음 | evt-2026-0917-001 | 추가 필요 | ◉ 신규 |
| **version** | ✓ 1.0.0 | 1.0.0 | 그대로 | ✓ |
| **pattern_type** | ✗ 없음 | minigame_shell_v1 | 추가 필요 | ◉ 신규 |
| **issued_by** | ✗ 없음 | architect_agent | 추가 필요 | ◉ 신규 |
| **folder_structure** | ✗ 없음 | { required_files, allowed_globs } | 추가 필요 | ◉ 신규 |
| **allowed_dependencies** | ✗ 없음 | { script_hosts, npm_packages } | 추가 필요 | ◉ 신규 |
| **bridge_api_contract** | ⚠️ 기본만 | 실제 메서드 | 실제 메서드 추가 | ◐ 확장 필요 |
| **forbidden_patterns** | ✓ 배열 | 상세 규칙 | 상세 규칙 추가 | ◐ 확장 필요 |
| **design_tokens_ref** | ✗ 없음 | 경로 정의 | 경로 추가 | ◉ 신규 |

### 5.1 bridge_api_contract 상세

**현재**:
```json
{
  "api_base_url": "https://api.example.com",
  "endpoints": [],
  "authentication": { "type": "bearer|api_key|oauth2" }
}
```

**목표** (실제 메서드):
```json
{
  "NHBridge.reward.grantPoint": {
    "params_schema": { "type": "object", "required": ["stage", "amount"] },
    "max_calls_per_session": 7,
    "idempotent": false
  },
  "NHBridge.ad.showRewarded": { ... },
  "NHBridge.nav.close": { ... }
}
```

---

## 6. Orchestrator 상태 전환 비교표

### 6.1 v0.1 현재 상태 (기본)

| 상태명 | 설명 | 다음 상태 | 완성도 |
|---|---|---|---|
| **pending** | Task 대기 중 | running | ✓ 구현됨 |
| **running** | Task 실행 중 | completed / failed | ✓ 구현됨 |
| **completed** | Task 완료 | (종료) | ✓ 구현됨 |
| **failed** | Task 실패 | (종료) | ✓ 구현됨 |

### 6.2 목표 파이프라인 상태

| 단계 | 설명 | 실행 주체 | v0.1 상태 |
|---|---|---|---|
| **PLANNING** | 자연어 기획안 분류 | Product Planner Agent | 사람 입력 |
| **DESIGN** | UX/UI 설계 스펙 생성 | UX/UI Designer Agent | 사람 입력 |
| **ARCH_CONTRACT** | 아키텍처 계약 발행 | Architect Agent | 사람 입력 |
| **HUMAN_GATE_SPEC** | 명세 단계 사람 승인 게이트 | 사람 | **구현 필수** |
| **DEV_QA_LOOP** | 개발-QA 반복 루프 | Developer + QA Agent | ✓ 핵심 구간 |
| **HUMAN_GATE_RELEASE** | 배포 후보 사람 승인 게이트 | 사람 | **구현 필수** |
| **DEVOPS** | 배포 후보 패키지 생성 | DevOps/Release Agent | 사람 입력 |
| **DONE** | 파이프라인 완료 | (시스템) | ✓ 자동 |
| **ESCALATED** | 반복 실패 후 에스컬레이션 | (시스템) | ✗ 없음 |

---

## 7. CLAUDE.md 통합 초안

### 프로젝트 정체성 변경

**현재**: "범용 Developer Agent v0.1"
**목표**: "NH 올원뱅크 WebView 이벤트·게임 생성 플랫폼"

### 구조 변경

**현재 CLAUDE.md**:
- v0.1 제약 강조
- Developer Agent 단독
- bridge_api_contract 예시 경고

**통합 후**:
- 프로젝트 정체성 명확화
- 목표 아키텍처 설명 (7개 Agent + 사람 게이트)
- v0.1 범위 명시 (Developer Agent 중심)
- 상태 전환 도식화
- Architect 2단계 검증 설명

---

## 8. 생성·수정할 파일 목록 (우선순위 순)

| 파일명 | 작업 | 우선순위 |
|---|---|---|
| **contracts/architecture-contract.schema.json** | 신규 생성 | ◉ P0 |
| **src/orchestrator.ts** | 전체 재설계 | ◉ P0 |
| **scripts/check-architecture.mjs** | 신규 생성 (마이그레이션) | ◉ P0 |
| **CLAUDE.md** | 수정 | ◉ P0 |
| **contracts/patterns/minigame_shell_v1.json** | 확장 수정 | ◐ P1 |
| **src/agents/developer.ts** | 간소화 | ◐ P1 |
| **README.md** | 수정 | ◐ P1 |
| **src/index.ts** | 수정 | ◐ P1 |

---

## 9. v0.1에서 활성화되는 기능 목록

✓ Orchestrator 상태머신 (PLANNING → DONE)
✓ Developer Agent + query() 호출
✓ check-architecture.mjs 검증 (LLM 미사용)
✓ 감사 로그 (auditLog)
✓ 사람 승인 게이트 2곳 (명세, 배포 후보)
✓ Architect 판단형 검증
✓ DEV_QA_LOOP Retry 정책

---

## 10. 향후 단계로 보류되는 기능 목록 (v0.2+)

✗ Planner/Designer/QA/DevOps Agent 실제 구현
✗ 사람 게이트의 실제 사내 시스템 연결
✗ 병렬 작업 지원
✗ 실제 bridge_api_contract 값 통합
✗ 운영 API 연결

---

**최종 확인**: P0 4개 항목 (Orchestrator, check-architecture, CLAUDE.md, architecture-contract.schema.json)부터 순차 적용 권장.