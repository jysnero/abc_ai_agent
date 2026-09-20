# P0-2: Orchestrator & Developer Agent 재설계

> 작성일: 2026-09-20
> 목적: 8-stage 상태머신 및 execution-plan 기반 Developer Agent 구현 계획서

---

## 1. 작업 컨텍스트

### 배경 및 목적

현재 orchestrator.ts와 developer.ts는 기본 프레임워크만 있고, 상태머신과 execution-plan 기반 워크플로우가 없습니다. P0-2는 8-stage 상태머신을 구현하여:

1. **순차적 상태 관리**: 요청 생명주기를 PLANNING → DONE까지 추적
2. **실패 복구**: 에러 발생 시 자동 재시도 또는 사람 승인으로 에스컬레이션
3. **execution-plan 기반 작업**: 생성 코드가 architecture-contract 준수 확인
4. **v0.1 범위 명시**: DEV_QA_LOOP (Developer만) + 2개 사람 승인 게이트

### 범위

- **포함**:
  - orchestrator.ts: 8-stage 상태머신 + 상태 전환 로직
  - Orchestrator 내부 Plan Builder: execution-plan 결정론적 생성
  - developer.ts: execution-plan 기반 작업 수행 (Step-by-step 실행)
  - 상태 전환 도식 (Mermaid)
  - 각 단계별 성공 기준 + 검증 방법 + 실패 처리

- **제외**:
  - Architect Agent 구현 (v0.2+)
  - QA Agent 구현 (v0.2+)
  - 사람 승인 게이트의 UI (orchestrator 상태만 관리)
  - DEVOPS Agent 구현 (v0.2+)

### 입출력 정의

| 항목 | 내용 |
|------|------|
| **입력** | 사용자 요청 (요청 주제, 대상 WebView 서비스, 요구사항) |
| **출력** | (1) 생성된 WebView 서비스 코드 (2) execution-plan.json (3) 검증 보고서 |
| **트리거** | Orchestrator.createRequest(input) 호출 시 PLANNING 상태로 시작 |

### 제약조건

- **기술 제약**:
  - Claude SDK (Anthropic API) 사용
  - architecture-contract.schema.json 준수
  - check-architecture.mjs로 최종 검증
  
- **운영 제약**:
  - v0.1: DEV_QA_LOOP만 구현 (Architect/QA 미구현)
  - 재시도 정책: MAX_DEV_QA_RETRIES=3, MAX_ARCH_RETRIES=2 (v0.1에서는 MAX_DEV_QA_RETRIES만 적용)
  - 사람 승인 게이트: 2곳 (SPEC, RELEASE)

- **품질 제약**:
  - execution-plan ⊆ architecture-contract (부분집합 관계)
  - 생성 코드는 check-architecture.mjs 자동 검증 통과

### 용어 정의

| 용어 | 정의 |
|------|------|
| **State** | 요청의 현재 처리 단계 (PLANNING, DESIGN, ..., DONE) |
| **Architecture Contract** | Architect가 발행한 생성 대상 WebView 서비스의 구조 규칙 (JSON) |
| **Execution Plan** | 이번 실행에서 실제로 수정할 파일/작업 목록 (architecture-contract 부분집합) |
| **Plan Builder** | orchestrator 내부의 결정론적 모듈. architecture-contract를 받아 execution-plan 생성 |
| **Human Gate** | 사람 승인이 필요한 체크포인트 (2곳: SPEC, RELEASE) |

---

## 2. 워크플로우 정의

### 전체 흐름도

```mermaid
flowchart TD
    A["사용자 요청"] --> B["PLANNING: 요청 분석"]
    B --> C["DESIGN: 아키텍처 설계"]
    C --> D["ARCH_CONTRACT: 계약 발행"]
    D --> E["PLAN_BUILD: execution-plan 생성"]
    E --> F["HUMAN_GATE_SPEC: 사람 승인"]
    F -->|승인 거부| G["에스컬레이션"]
    F -->|승인| H["DEV_VALIDATION_LOOP: 개발 + 검증"]
    H --> I["검증 성공?"]
    I -->|실패 (≤3회 수정)| J["자동 수정 + 재검증"]
    J --> I
    I -->|실패 (>3회)| G
    I -->|성공| K["HUMAN_GATE_RELEASE: 최종 승인"]
    K -->|승인 거부| G
    K -->|승인| L["DEVOPS: 배포"]
    L --> M["DONE / 완료"]
    G --> N["ESCALATED / 에스컬레이션"]
```

### LLM 판단 vs 코드 처리 구분

| LLM이 직접 수행 | 스크립트 (규칙 기반) |
|----------------|------------------|
| 요청 분석 및 아키텍처 설계 (Step 1, 2) | execution-plan 생성 (Plan Builder) |
| 코드 작성 (Step 3) | 상태 전환 로직 (orchestrator) |
| 테스트 코드 작성 (Step 3) | 재시도 카운터 관리 |
| 자기 검증 (Step 4) | 조건부 상태 전환 |
| | architecture-contract ⊆ execution-plan 검증 |

### 단계별 상세

#### Step 1: PLANNING (요청 분석)

- **처리 주체**: Orchestrator (상태 관리) + 향후 Planner Agent (v0.2+)
- **입력**: 사용자 요청 (텍스트)
- **처리 내용**: 요청 분석, 필요 정보 추출, 추진 가능성 판단
- **출력**: 분석 결과 (JSON, `/output/planning-result.json`)
- **성공 기준**: 요청이 이해되고, 필수 정보(WebView 유형, 핵심 기능) 특정됨
- **검증 방법**: 구조화된 출력 (필드 존재 + 타입 확인)
- **실패 시 처리**: 자동 재시도 없음. 사람에게 필요 정보 요청

#### Step 2: DESIGN (아키텍처 설계)

- **처리 주체**: Orchestrator (상태 관리) + 향후 Designer Agent (v0.2+)
- **입력**: 분석 결과
- **처리 내용**: 시스템 아키텍처 설계, 컴포넌트 정의, 데이터 흐름
- **출력**: 설계 문서 (JSON, `/output/design-result.json`)
- **성공 기준**: 아키텍처가 명확하고, 구현 단계로 진행 가능한 수준
- **검증 방법**: 설계서 구조화 검증
- **실패 시 처리**: 자동 재시도 없음. 사람 확인 또는 재설계

#### Step 3: ARCH_CONTRACT (계약 발행)

- **처리 주체**: (v0.2+) Architect Agent, v0.1은 template 로드
- **입력**: 설계 결과
- **처리 내용**: 승인된 architecture-contract 로드 또는 생성
- **출력**: architecture-contract.json (`/output/architecture-contract.json`)
- **성공 기준**: JSON Schema 검증 통과 (P0-3: check-architecture.mjs)
- **검증 방법**: `node scripts/check-architecture.mjs`
- **실패 시 처리**: 자동 재시도 최대 2회 (MAX_ARCH_RETRIES=2)

#### Step 4: PLAN_BUILD (execution-plan 생성)

- **처리 주체**: Orchestrator 내부 Plan Builder (결정론적 스크립트)
- **입력**: PlanBuilderInput (request-spec, architecture-contract, repository-context, template-registry, previousPlan?)
- **처리 내용**:
  - request-spec 분석 (작업 요구사항)
  - repository-context 확인 (실제 파일 구조, writable/readonly/forbidden 범위)
  - architecture-contract 범위 안에서 target_files 결정
  - 검증 명령(validation_commands) 및 완료 조건 생성
  - custom 작업이면 LLM 필요 여부만 플래그 지정
- **출력**: execution-plan.json (`/output/execution-plan.json`)
- **성공 기준**: 
  - execution_plan.target_files ⊆ architecture-contract.allowed_globs
  - 모든 target_files가 repository의 writable 범위 안
  - bridge_usage ≤ max_calls_per_session
  - forbidden_patterns 미사용
- **검증 방법**: Plan Builder 내부 결정론적 검증
- **실패 시 처리**: PLAN_CHANGE_REQUIRED 상태로 전환 (재시도 아님)

#### Step 4: HUMAN_GATE_SPEC (사람 승인)

- **처리 주체**: 사람 (개발팀 리더)
- **입력**: execution-plan.json (+ architecture-contract)
- **처리 내용**: 계획의 타당성 검토 (범위, 위험도, 의존성)
- **출력**: 승인 (Y/N) + 피드백
- **성공 기준**: 승인자가 "승인" 표시
- **검증 방법**: 외부 (사람 판단)
- **실패 시 처리**: 
  - 거부 시 에스컬레이션 (ESCALATED)
  - 수정 요청 시 DESIGN으로 되돌아가기 (v0.2+)

#### Step 5: DEV_VALIDATION_LOOP (개발 + 검증 + 수정)

- **처리 주체**: Developer Agent + Validation Runner (신규)
- **입력**: execution-plan.json + architecture-contract.json + generated code
- **처리 내용**: 
  - Step 5A: 코드 생성 (첫 1회)
  - Step 5B: 테스트 코드 생성
  - Step 5C: Validation Runner 실행 (구조화된 검증)
  - Step 5D: 검증 결과 분석 (Orchestrator가 수행, Developer는 아님)
  - Step 5E: 자동 수정 (MAX_DEV_REPAIR_RETRIES=3까지만)
  - Step 5C 재실행 (검증 재수행)
- **출력**: 
  - 생성된 코드 (파일)
  - 테스트 코드 (파일)
  - 최종 검증 보고서 (validation-report.json)
- **성공 기준**: 모든 validation_commands 통과, 허용되지 않은 경로 수정 없음
- **검증 방법**: 
  - `node scripts/check-architecture.mjs` (아키텍처 검증)
  - `npm test` (테스트 실행)
  - 경로 검사 (forbidden/readonly 범위 확인)
- **실패 시 처리**: 
  - 자동 수정 최대 3회 (MAX_DEV_REPAIR_RETRIES=3)
  - 3회 초과: NEEDS_HUMAN_REVIEW 상태로 전환
  - 같은 오류 반복: 조기 종료 (ESCALATED)
  - 오류 심각도 증가: 조기 종료 (ESCALATED)

##### Step 5A: 코드 생성

- Developer Agent가 LLM을 호출하여 execution-plan 기반 코드 작성
- LLM은 **절대로** execution-plan/architecture-contract에 없는 파일을 수정할 수 없음
- LLM 프롬프트: "execution-plan의 target_files를 다음 조건에 따라 생성:\n[architecture-contract 제약]\n\n생성 범위:\n- 반드시 포함: [target_files]\n- 생성 금지: [forbidden_paths]\n- 읽기만: [readonly_paths]"

##### Step 5B: 테스트 코드 생성

- Developer Agent가 생성된 코드에 대한 테스트 작성
- 최소 커버리지: 주요 함수 + 에러 경로

##### Step 5C: Validation Runner 실행

- Validation Runner (신규 컴포넌트)가 execution-plan의 validation_commands 실행
- 각 검사마다:
  - check_id (식별자)
  - 실행 명령 또는 검사 종류
  - 성공/실패/건너뜀 상태
  - exit code
  - 실행 시간
  - 제한된 stdout/stderr
  - 검사 대상 artifact checksum
  - 실패 요약
- 모든 결과를 JSON으로 저장

##### Step 5D: 검증 결과 분석

- **Orchestrator가 결과 분석** (Developer가 아님)
- 실패 여부 판단
- 재시도 가능 여부 판단
- 수정 가능 여부 판단
- 에스컬레이션 필요 여부 판단

##### Step 5E: 자동 수정

- Developer Agent가 validation 보고서를 받아 수정 계획 수립
- **오류 중복/심각도 증가 감지 시 조기 종료**
- 수정된 코드만 재생성 (Step 5C로 루프)

#### Step 6: HUMAN_GATE_RELEASE (최종 승인)

- **처리 주체**: 사람 (개발팀 리더 또는 QA 담당자)
- **입력**: 생성된 코드 + 테스트 결과 + validation 보고서
- **검토 조건**:
  - 모든 필수 검증 통과
  - 미해결 blocker 0건
  - artifact checksum 기록
- **처리 내용**: 최종 품질 확인 (동작, 성능, 보안, 배포 준비)
- **출력**: 승인 기록 (approvals.json)
  ```json
  {
    "gate": "HUMAN_GATE_RELEASE",
    "approver": "user@example.com",
    "approved_at": "2026-09-20T10:30:00Z",
    "artifacts": {
      "code_checksum": "sha256:abc123...",
      "test_checksum": "sha256:def456...",
      "validation_report_checksum": "sha256:ghi789..."
    },
    "result": "approved",
    "notes": "Ready for deployment"
  }
  ```
- **성공 기준**: 승인자가 "approved" 표시
- **검증 방법**: 외부 (사람 판단, 선택적 수동 테스트)
- **실패 시 처리**: 
  - 거부 시 에스컬레이션 (ESCALATED)
  - artifact 변경 감지 시 기존 승인 무효화 + ESCALATED
  - 수정 요청 시 DEV_VALIDATION_LOOP으로 되돌아가기 (새 artifact checksum)

#### Step 7: DEVOPS (배포)

- **처리 주체**: (v0.2+) DevOps Agent, v0.1은 RELEASE_READY artifact만 생성
- **입력**: 최종 승인된 코드
- **처리 내용**:
  - v0.1: RELEASE_READY artifact 생성 (빌드 결과, 번들 체크섬)
  - v0.2+: 실제 배포 (빌드, 스테이징, 프로덕션)
- **출력**: RELEASE_READY artifact 또는 배포 완료 보고서
- **성공 기준**: artifact 생성 성공 또는 배포 성공
- **검증 방법**: 로컬 검증 (v0.1) 또는 배포 로그 + 상태 모니터링 (v0.2+)
- **실패 시 처리**: 자동 롤백 또는 수동 개입 (ESCALATED)

#### Step 8: DONE (완료)

- **처리 주체**: Orchestrator (상태 정리)
- **입력**: 배포/릴리즈 결과
- **처리 내용**: 최종 상태 저장, 요청 종료, 메타데이터 정리
- **출력**: 최종 보고서 (`/output/manifest.json`)
  ```json
  {
    "request_id": "req-...",
    "status": "DONE",
    "started_at": "2026-09-20T10:00:00Z",
    "completed_at": "2026-09-20T11:30:00Z",
    "artifacts": {
      "request_spec_checksum": "...",
      "architecture_contract_checksum": "...",
      "execution_plan_checksum": "...",
      "generated_code_checksum": "...",
      "validation_report_checksum": "..."
    },
    "approvals": ["SPEC", "RELEASE"],
    "retry_stats": {
      "arch_retries": 0,
      "dev_repair_retries": 1
    }
  }
  ```
- **성공 기준**: 모든 단계 완료 기록 및 checksum 저장
- **검증 방법**: manifest 일관성 확인
- **실패 시 처리**: 해당 없음 (종료 단계)

### 상태 전이

| 현재 상태 | 조건 | 다음 상태 |
|----------|------|----------|
| PLANNING | 요청 분석 완료 | DESIGN |
| DESIGN | 설계 완료 | ARCH_CONTRACT |
| ARCH_CONTRACT | 계약 발행 성공 | PLAN_BUILD |
| ARCH_CONTRACT | 발행 실패 (≤2회) | ARCH_CONTRACT (재시도) |
| ARCH_CONTRACT | 발행 실패 (>2회) | ESCALATED |
| PLAN_BUILD | execution-plan 생성 성공 | HUMAN_GATE_SPEC |
| PLAN_BUILD | 계약/계획 변경 필요 | PLAN_CHANGE_REQUIRED |
| HUMAN_GATE_SPEC | 모든 artifact 승인 (request-spec, architecture-contract, execution-plan) | DEV_VALIDATION_LOOP |
| HUMAN_GATE_SPEC | 승인 거부 또는 artifact 변경 요청 | ESCALATED |
| DEV_VALIDATION_LOOP | 모든 검증 통과 | HUMAN_GATE_RELEASE |
| DEV_VALIDATION_LOOP | 생성 실패 후 자동 수정 (≤3회) | DEV_VALIDATION_LOOP (수정 후 재검증) |
| DEV_VALIDATION_LOOP | 자동 수정 한도 초과 | NEEDS_HUMAN_REVIEW |
| HUMAN_GATE_RELEASE | artifact checksum 불변 + 모든 검증 통과 + blocker 0건 | DEVOPS |
| HUMAN_GATE_RELEASE | artifact 변경 감지 (checksum 변경) | 기존 승인 무효화 + ESCALATED |
| HUMAN_GATE_RELEASE | 승인 거부 | ESCALATED |
| DEVOPS | 배포 완료 (v0.1: RELEASE_READY artifact만 생성) | DONE |
| DEVOPS | 배포 실패 | ESCALATED |
| ESCALATED | 수동 개입 후 복구 | [PLAN_BUILD / DEV_VALIDATION_LOOP 등 복구 지점으로 전환] |
| PLAN_CHANGE_REQUIRED | [종료 상태: 계약/계획 변경 필요] | [없음] |
| NEEDS_HUMAN_REVIEW | [종료 상태: 사람 검토 필요] | [없음] |
| DONE | [완료] | [없음] |

---

### v0.1 구현 상태 명확화

| 단계 | 상태 | 설명 |
|------|------|------|
| PLANNING | TEMPLATE_BASED | 템플릿 로드 (사람이 제공하거나 기본값) |
| DESIGN | HUMAN_PROVIDED | 설계 사양을 사람이 제공 |
| ARCH_CONTRACT | HUMAN_PROVIDED | 사람이 제공한 계약 또는 템플릿 로드 |
| PLAN_BUILD | AUTOMATED (결정론적) | Orchestrator 내부 Plan Builder가 자동 생성 |
| HUMAN_GATE_SPEC | HUMAN_PROVIDED | 사람이 명시적 승인 |
| DEV_VALIDATION_LOOP | AUTOMATED (Developer + ValidationRunner) | Developer Agent + ValidationRunner가 자동 실행 |
| HUMAN_GATE_RELEASE | HUMAN_PROVIDED | 사람이 명시적 승인 |
| DEVOPS | TEMPLATE_BASED (v0.1) | RELEASE_READY artifact 생성만 (배포 아님) |
| DONE | AUTOMATED | 상태 정리 (자동) |

**v0.1 배포 지원**: RELEASE_READY artifact 생성까지만. 실제 배포는 v0.2+

---

## 3. 구현 스펙

### 폴더 구조

```
/project-root
  ├── CLAUDE.md
  ├── src/
  │   ├── orchestrator.ts                  ← 재설계 (8-stage 상태머신, 파일 기반)
  │   ├── agents/
  │   │   └── developer.ts                 ← 재설계 (execution-plan 기반)
  │   ├── builders/
  │   │   └── plan-builder.ts              ← 신규 (execution-plan 생성)
  │   ├── validation/
  │   │   └── validation-runner.ts         ← 신규 (검증 실행 및 보고)
  │   ├── runtime/
  │   │   └── agent-client.ts              ← 신규 (SDK adapter)
  │   └── storage/
  │       └── run-storage.ts               ← 신규 (파일 기반 상태 저장)
  ├── contracts/
  │   ├── patterns/
  │   │   └── minigame_shell_v1.json
  │   ├── architecture-contract.schema.json
  │   └── examples/
  ├── scripts/
  │   ├── check-arch.ts                    ← 기존 (Agent 검증)
  │   └── check-architecture.mjs           ← P0-3 (Contract 검증)
  ├── .blueprint/
  │   └── runs/
  │       └── {run-id}/
  │           ├── manifest.json            ← 상태 머신 이력
  │           ├── request-spec.json        ← 요청 사양
  │           ├── architecture-contract.json
  │           ├── execution-plan.v1.json   (v1, v2, ... 버전 관리)
  │           ├── generated-code/
  │           │   └── {file}.{ext}
  │           ├── test-code/
  │           │   └── {file}.test.{ext}
  │           ├── validation-report.json   ← 모든 검증 결과
  │           ├── approvals.json           ← 사람 승인 기록
  │           └── release-artifact/        ← v0.1: 배포 준비 아티팩트
  ├── output/
  │   └── (deprecated, .blueprint/runs로 이동)
  └── docs/
      └── integration/
```

### CLAUDE.md 핵심 섹션 목록

- **P0-2: 상태머신 설명**: 8-stage 흐름, 상태 전환 조건, 실패 처리
- **Execution Plan 가이드**: 정의, 생성 방식 (Plan Builder), 검증 규칙
- **Developer Agent 역할**: execution-plan 소비, Step-by-step 작업, 자기 검증
- **Orchestrator 사용법**: 상태 조회, 상태 전환 트리거
- **재시도 정책**: MAX_ARCH_RETRIES=2, MAX_DEV_QA_RETRIES=3
- **Human Gate 프로토콜**: SPEC/RELEASE 게이트 입력/출력 정의

### 에이전트 구조

**구조 선택**: 멀티 에이전트 (Orchestrator 중심)

**선택 근거**:
1. orchestrator.ts는 상태머신 관리 (규칙 기반, 복잡하지 않음)
2. developer.ts는 실제 코드 작성 (LLM 판단, 충분한 맥락 필요)
3. plan-builder.ts는 결정론적 모듈 (규칙 기반, 독립적)
4. 각각 독립적인 책임이므로 메인 에이전트(CLAUDE.md)에서 조율

#### 메인 에이전트 (CLAUDE.md)

- **역할**: 
  - 요청 입수 (사용자 입력)
  - Orchestrator 상태 관리 (PLANNING → DONE)
  - 각 단계 트리거 결정
  - 두 사람 승인 게이트 대기/처리

- **담당 단계**: 모든 상태 전환 + Step 1 (PLANNING) + Step 2 (DESIGN, 향후)

#### 서브 컴포넌트

| 이름 | 역할 | 트리거 조건 | 입력 | 출력 |
|------|------|-----------|------|------|
| **Developer Agent** | 코드 + 테스트 생성, 자동 수정 | DEV_VALIDATION_LOOP 진입 | execution-plan.json + architecture-contract | 생성 코드 + 테스트 코드 |
| **Validation Runner** | 구조화된 검증 실행 | Step 5C 트리거 | execution-plan.validation_commands | validation-report.json (checksum, exit code 포함) |
| **Plan Builder** | execution-plan 생성 | PLAN_BUILD 단계 | PlanBuilderInput | execution-plan.json (검증 명령 포함) |
| **Run Storage** | 파일 기반 상태 저장 | 모든 상태 전환 시 | Request + 결과 아티팩트 | .blueprint/runs/{run-id}/* 파일 |
| **Agent Client** | SDK adapter (v0.2+) | Developer 호출 시 | 프롬프트 + 이전 결과 | LLM 응답 |

### 주요 데이터 구조

#### Request

```typescript
interface Request {
  id: string;                    // req-YYYY-MMDD-NNN-service
  status: State;                 // 현재 상태
  userInput: {
    topic: string;
    target: string;              // WebView 유형 (minigame, quiz, ...)
    requirements: string;
  };
  planningResult?: JSON;
  designResult?: JSON;
  requestSpec?: JSON;            // PLAN_BUILD 입력
  architectureContract?: JSON;
  executionPlan?: JSON;
  devQaResult?: JSON;
  finalReport?: JSON;
  retryCount: {
    arch: number;
    devRepair: number;           // 자동 수정 재시도
  };
  createdAt: Date;
  updatedAt: Date;
}
```

#### PlanBuilderInput

```typescript
interface PlanBuilderInput {
  requestSpec: {
    id: string;
    target: string;              // minigame, quiz, ...
    requirements: string[];
    constraints?: string[];
    revision: string;            // checksum or semver
  };
  architectureContract: {
    contract_id: string;
    version: string;
    folder_structure: { required_files: string[]; allowed_globs: string[] };
    bridge_policy: Record<string, { max_calls_per_session: number }>;
    forbidden_patterns: Array<{ id: string; regex: string; severity: string }>;
    revision: string;            // checksum
  };
  repositoryContext: {
    root_path: string;
    current_files: string[];     // 현재 저장소의 실제 파일 목록
    writable_paths: string[];    // 수정 가능한 경로 (allowed_globs 매칭)
    readonly_paths: string[];    // 읽기만 가능한 경로
    forbidden_paths: string[];   // 접근 불가 경로
  };
  templateRegistry: {
    templates: Array<{
      id: string;
      pattern: string;           // minigame_shell_v1 등
      filePaths: string[];
      dependencies: string[];
    }>;
  };
  previousPlan?: {
    execution_plan: ExecutionPlan;
    status: "success" | "failure" | "modified";
  };
}
```

#### Execution Plan

```typescript
interface ExecutionPlan {
  contract_id: string;           // architecture-contract와 매칭
  version: string;
  request_spec_revision: string; // 검증 용도
  target_files: string[];        // 생성할 파일 (allowed_globs 부분집합, writable 범위 안)
  bridge_usage: {
    [methodName: string]: number; // 호출 횟수 (max_calls_per_session 이하)
  };
  validation_commands: Array<{
    check_id: string;
    command: string;             // npm test, check-architecture.mjs 등
  }>;
  completion_criteria: {
    required_files_created: string[];
    all_validation_pass: boolean;
    forbidden_patterns: "none" | "block_free";  // 명시적 금지 패턴 여부
  };
  generated_at: string;
  generated_by: "plan_builder";  // 생성자 명시 (v0.2+ 확장용)
}
```

### 재시도 및 실패 처리 정책

#### Architecture Contract 생성 (ARCH_CONTRACT → PLAN_BUILD)

```
MAX_ARCH_RETRIES = 2

최초: 1회
실패 시: 최대 2회 재시도
총: 최대 3회 시도
초과 시: ESCALATED
```

#### Developer 코드 생성 (DEV_VALIDATION_LOOP)

```
최초 생성: 1회
자동 수정: 최대 3회 (MAX_DEV_REPAIR_RETRIES=3)
총: 최대 4회 시도 (1 + 3)

조기 종료 조건:
- 같은 오류 반복 (2회 연속 동일 오류)
- 오류 수 증가 (이전보다 많은 오류 발생)
- 오류 심각도 증가 (block이 이전에 없음)
- 계약/계획 변경 필요 (forbidden 범위 수정 시도)

초과 시: NEEDS_HUMAN_REVIEW
```

#### 요청 스펙 변경 필요

```
DEV_VALIDATION_LOOP 중 다음이 필요하면 재시도하지 않음:
- architecture-contract 범위 확대
- execution-plan 범위 변경
→ PLAN_CHANGE_REQUIRED 상태로 전환
```

### CLAUDE.md 작성 원칙

이 시스템의 CLAUDE.md는 아래 4가지 원칙을 따라 작성한다. 50줄 이내 간결한 형태.

| 원칙 | 핵심 | 자기 검증 테스트 |
|------|------|-----------------|
| **구현 전에 생각하라** | 8-stage 상태 전환 조건이 명확하고, 각 에이전트의 책임이 겹치지 않는가? | "상태 전환이 막힐 만한 모호한 조건이 있는가?" |
| **단순함 우선** | v0.1은 Developer만 구현. Architect/QA는 미구현. Plan Builder는 규칙 기반만. | "v0.2 기능을 v0.1에 섞지 않았는가?" |
| **수술적 변경** | orchestrator.ts와 developer.ts에 상태머신만 추가. 기존 인터페이스는 보존. | "상태머신 외에 건드린 게 있는가?" |
| **목표 중심 실행** | 성공 기준: orchestrator가 상태 전환 가능 + developer가 execution-plan 소비 가능 | "자동 검증(check-architecture.mjs) 통과를 확인했는가?" |

**트레이드오프**: 이 가이드는 안정성(상태 일관성, 명확한 경계) > 유연성(동적 상태 추가, 에이전트 추가)에 편향. 단순 상태 전환에는 판단력 사용.

**이 가이드라인이 잘 작동하고 있다면:**
- 상태 전환이 막혀도 명확한 다음 단계(재시도 또는 에스컬레이션) 존재
- Developer Agent가 execution-plan을 받아 단계별 작업 수행 가능
- 검증 실패 시 자동 재시도 또는 사람 개입으로 복구

### 스킬 생성 규칙

> 이 설계서에 정의된 스킬(없음)은 구현 시 반드시 `skill-creator` 스킬을 사용하여 생성할 것.
> 
> 참고: P0-2는 orchestrator, developer, plan-builder의 **클래스/타입스크립트 모듈**만 포함.
> 스킬 신규 생성은 없으며, 기존 skills(`/blueprint`, `/deep-dive` 등)는 변경하지 않음.

### 검증 체크리스트

- [x] 모든 단계에 성공 기준 / 검증 방법 / 실패 시 처리가 있다
- [x] LLM 판단 vs 코드 처리 구분 표가 채워져 있다
- [x] 상태 전이 표가 완성되었다
- [x] CLAUDE.md 작성 원칙이 4원칙 + 자기 검증 테스트 + 트레이드오프 + 성공 지표를 포함한다
- [x] 에이전트 구조가 명시되어 있다 (Orchestrator 중심 + Developer/PlanBuilder)
- [x] 모든 데이터 구조가 정의되었다 (Request, ExecutionPlan)
- [x] 폴더 구조가 정의되었다
- [x] 표와 섹션에 TBD가 없다

---

## 4. 변경 이력

| 날짜 | 변경 내용 | 이유 |
|------|----------|------|
| 2026-09-20 | 초안 작성 | P0-2 설계 시작 |

---

**이 설계서는 구현 전 계획서입니다. 구현 중 변경이 필요하면 위 "변경 이력"에 기록합니다.**
