# 프로젝트 컨텍스트: AI Agent Platform v0.1

## 📋 프로젝트 개요

**목표**: Claude Agent SDK를 활용한 멀티-에이전트 오케스트레이션 플랫폼 구축

**현재 단계**: v0.1 (Developer Agent 단독 구현 + 검증)

**팀**: 다중 개발자 협업

---

## ⚠️ 핵심 주의사항 (반드시 읽기)

### 1. Bridge API Contract는 **예시값입니다**

`contracts/patterns/minigame_shell_v1.json`의 `bridge_api_contract` 섹션은 **샘플 데이터**입니다.

```json
{
  "bridge_api_contract": {
    "example": "이것은 예시입니다",
    "real_spec": "네이티브 앱팀에서 받아야 함"
  }
}
```

**나중에 하지 말아야 할 것**:
- ❌ 이 예시를 진짜 스펙으로 착각하고 구현
- ❌ 예시 API 엔드포인트를 실제로 호출

**해야 할 것**:
- ✅ 네이티브 앱팀에서 실제 스펙을 받으면 이 섹션을 교체
- ✅ 교체 후 `npm run check:arch`로 검증

---

### 2. v0.1은 Developer Agent **하나만** 구현

**가장 흔한 실패 패턴**:
```
"조직도대로 7개 Agent를 한 번에 만들어줘"
→ 복잡성 폭발 → 아무것도 제대로 안 됨
```

**v0.1 목표**:
- Developer Agent **하나만** end-to-end 완성
- 아키텍처 검증 레이어 작동 확인
- 다른 6개 Agent는 **틀만** 만들기

**7개 Agent 리스트** (참고용, v0.2 이후):
1. **Developer Agent** ✓ v0.1에서 구현
2. Validator Agent (틀만)
3. Optimizer Agent (틀만)
4. Executor Agent (틀만)
5. Monitor Agent (틀만)
6. Feedback Agent (틀만)
7. Config Agent (틀만)

---

### 3. 아키텍처 검증은 필수

**두 가지 검증 스크립트**:

| 대상 | 명령어 | 용도 |
|------|--------|------|
| **Agent 구현** | `npm run check:arch -- contracts/patterns/minigame_shell_v1.json src/agents` | Agent 역할/기능 검증 |
| **WebView 서비스** | `node scripts/check-architecture.mjs <contract-file>` | 구조/정책 검증 |

**이점**:
- API 비용 **없음** (로컬 검증)
- 설계 오류를 초기에 감지
- 다른 개발자와 공유 가능한 검증 결과
- `execution_plan ⊆ architecture_contract` 관계 확인

---

## 🔄 개발 절차

### Claude Code 사용 시

1. 이 파일(`CLAUDE.md`)을 먼저 읽기 (자동)
2. 새 기능 설계: `/blueprint` 스킬 사용
3. 스펙 구체화: `/deep-dive` 스킬 사용
4. 코드 작성: Claude Code 직접 사용
5. **아키텍처 검증**: 다음 중 실행
   - `npm run check:arch -- contracts/patterns/minigame_shell_v1.json src/agents` (Agent 구현 시)
   - `node scripts/check-architecture.mjs <contract-file>` (WebView 서비스 검증 시)
6. 최적화: `/autoresearch` 스킬 (선택)
7. 마무리: `/reflect` 스킬로 학습 저장

### Architecture Contract 워크플로우

**생성 대상 WebView 서비스를 만들 때**:

1. **계약 정의**: Architect Agent가 architecture-contract.json 발행
   - 파일 구조 (required_files, allowed_globs)
   - 의존성 (script_hosts, npm_packages)
   - Bridge API 정책 (max_calls_per_session, requires_approval)
   - 금지된 패턴 (regex 기반)

2. **개발 계획**: Developer Agent가 execution-plan.json 생성
   - `target_files ⊆ architecture_contract.allowed_globs`
   - Bridge 호출 ≤ max_calls_per_session
   - forbidden_patterns 미사용

3. **자동 검증**: `node scripts/check-architecture.mjs <contract-file>`
   - JSON Schema 검증
   - 경로 구조 확인
   - Bridge 정책 준수
   - 금지 패턴 감지

### 상태머신 (8-stage, v0.2+ 목표)

```
PLANNING (Planner Agent)
    ↓
DESIGN (Designer Agent)
    ↓
ARCH_CONTRACT (Architect Agent)
    ↓
HUMAN_GATE_SPEC (사람 승인)
    ↓
DEV_QA_LOOP (Developer + QA Agent, 최대 3회)
    ↓
HUMAN_GATE_RELEASE (사람 승인)
    ↓
DEVOPS (DevOps Agent)
    ↓
DONE / ESCALATED (종료 또는 에스컬레이션)
```

**v0.1 범위**: DEV_QA_LOOP (Developer Agent만 구현), 사람 승인 게이트 2곳

### 커밋 메시지 규칙

```
[Agent] 간단한 설명

상세 설명 (필요시)

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
```

---

## 📁 중요 파일 설명

### 설정 파일
- **CLAUDE.md** ← 지금 읽고 있는 파일 (모든 개발자의 진입점)
- **package.json** - npm 스크립트, 의존성
- **.env.example** - 환경 변수 템플릿

### 계약 및 검증
- **contracts/patterns/minigame_shell_v1.json** - Agent 템플릿 계약 (⚠️ bridge_api_contract는 예시)
- **contracts/architecture-contract.schema.json** - WebView 생성 서비스의 아키텍처 제약 정의
- **contracts/examples/** - 정상/실패 예제 (valid-minigame, invalid-additional-properties, invalid-forbidden-path)
- **scripts/check-arch.ts** - minigame_shell_v1 기반 검증 (기존)
- **scripts/check-architecture.mjs** - architecture-contract 기반 검증 (P0-3 신규)

### 핵심 구현
- **src/orchestrator.ts** - Agent 오케스트레이터 (8-stage 상태머신, P0-2 재설계)
- **src/agents/developer.ts** - v0.1 구현 대상 (P0-2 재설계)

---

## 🚨 일반적인 함정과 해결책

| 함정 | 원인 | 해결책 |
|------|------|--------|
| "7개 Agent를 다 만들어야 해" | 조직도를 그대로 따름 | v0.1은 Developer만 + README 재확인 |
| "bridge_api_contract를 테스트해야 해" | 예시를 진짜로 착각 | CLAUDE.md 1번 섹션 재읽음 + 스킵 |
| "check:arch에서 실패했어" (Agent) | 설계 오류 | blueprint 재검토 + 수정 후 재실행 |
| "check-architecture.mjs에서 실패했어" (서비스) | 정책 위반 | contracts/examples 참고 + architecture-contract 재검토 |
| "bridge_contract_ref가 뭐야?" | 새 필드 혼동 | CLAUDE.md의 "계약 및 검증" 섹션 참고 |
| "execution_plan과 architecture_contract 차이?" | 범위 이해 부족 | `execution_plan ⊆ architecture_contract` 원칙 확인 |
| "다른 Agent도 구현하면 어때?" | 동료 제안 | 이 파일의 v0.1 제약 설명 후 거절 |

---

## ✅ 체크리스트 (시작 전)

- [ ] `.env.example`을 복사해서 `.env` 생성
- [ ] `ANTHROPIC_API_KEY` 입력
- [ ] `npm install` 실행
- [ ] `npm run check:arch -- contracts/patterns/minigame_shell_v1.json .` 성공 확인
- [ ] `node scripts/check-architecture.mjs contracts/examples/valid-minigame-contract.json` 성공 확인
- [ ] 이 파일(`CLAUDE.md`) 읽음
- [ ] README.md의 "Bridge API Contract는 예시" 부분 다시 읽음
- [ ] P0-1 (architecture-contract.schema.json)과 P0-3 (check-architecture.mjs) 문서 읽음

---

## 📞 의문 사항

**Q**: "내가 Developer Agent 대신 다른 Agent를 먼저 구현하고 싶어"
**A**: v0.1 계획을 바꾸려면 팀 동의 필요 → README와 이 파일 업데이트 필수

**Q**: "bridge_api_contract를 실제 스펙으로 교체하려면?"
**A**: 네이티브 앱팀의 스펙 파일을 받으면 이 파일과 검증 스크립트를 함께 업데이트 (이 파일의 1번 섹션 참고)

**Q**: "npm run check:arch가 실패했어"
**A**: Agent 검증 실패 → CLAUDE.md 2번 섹션의 해결책 실행

**Q**: "node scripts/check-architecture.mjs가 실패했어"
**A**: WebView 서비스 정책 위반 → contracts/examples 참고 후 architecture-contract 재검토

**Q**: "architecture-contract.schema.json과 minigame_shell_v1.json의 차이?"
**A**: 
- minigame_shell_v1.json: Agent 템플릿 정의 (메타데이터, 기능)
- architecture-contract.schema.json: 생성 서비스의 구조 제약 (파일, 의존성, Bridge 정책)

**Q**: "execution-plan이 뭐야?"
**A**: architecture-contract의 부분집합. 이번 실행에서 실제로 수정할 파일과 작업을 정의하는 계획서. `execution_plan ⊆ architecture_contract` 원칙 준수 필수.

**Q**: "requires_approval 플래그가 뭐야?"
**A**: Bridge 메서드 사용 시 사람 승인이 필요하다는 뜻. 결제, 보상 등 중요 작업에 사용. P0-2 구현 시 고려할 사항.

---

**마지막 확인**: 이 파일을 읽은 모든 개발자는 v0.1의 제약(Developer Agent 하나만, bridge_api_contract는 예시)을 인식하고 있습니다.
