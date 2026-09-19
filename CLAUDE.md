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

`npm run check:arch`를 자주 실행하세요:
- API 비용 **없음**
- 설계 오류를 초기에 감지
- 다른 개발자와 공유 가능한 검증 결과

---

## 🔄 개발 절차

### Claude Code 사용 시

1. 이 파일(`CLAUDE.md`)을 먼저 읽기 (자동)
2. 새 기능 설계: `/blueprint` 스킬 사용
3. 스펙 구체화: `/deep-dive` 스킬 사용
4. 코드 작성: Claude Code 직접 사용
5. 검증: `npm run check:arch` 실행
6. 최적화: `/autoresearch` 스킬 (선택)
7. 마무리: `/reflect` 스킬로 학습 저장

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

### 핵심 구현
- **contracts/patterns/minigame_shell_v1.json** - Agent 계약서 스키마 + 예시 (⚠️ bridge_api_contract는 예시)
- **scripts/check-arch.ts** - 아키텍처 검증 레이어
- **src/orchestrator.ts** - Agent 오케스트레이터
- **src/agents/developer.ts** - v0.1 구현 대상

---

## 🚨 일반적인 함정과 해결책

| 함정 | 원인 | 해결책 |
|------|------|--------|
| "7개 Agent를 다 만들어야 해" | 조직도를 그대로 따름 | v0.1은 Developer만 + README 재확인 |
| "bridge_api_contract를 테스트해야 해" | 예시를 진짜로 착각 | CLAUDE.md 1번 섹션 재읽음 + 스킵 |
| "npm run check:arch에서 실패했어" | 설계 오류 | blueprint 재검토 + 수정 후 재실행 |
| "다른 Agent도 구현하면 어때?" | 동료 제안 | 이 파일의 v0.1 제약 설명 후 거절 |

---

## ✅ 체크리스트 (시작 전)

- [ ] `.env.example`을 복사해서 `.env` 생성
- [ ] `ANTHROPIC_API_KEY` 입력
- [ ] `npm install` 실행
- [ ] `npm run check:arch -- contracts/patterns/minigame_shell_v1.json .` 성공 확인
- [ ] 이 파일(`CLAUDE.md`) 읽음
- [ ] README.md의 "Bridge API Contract는 예시" 부분 다시 읽음

---

## 📞 의문 사항

**Q**: "내가 Developer Agent 대신 다른 Agent를 먼저 구현하고 싶어"
**A**: v0.1 계획을 바꾸려면 팀 동의 필요 → README와 이 파일 업데이트 필수

**Q**: "bridge_api_contract를 실제 스펙으로 교체하려면?"
**A**: 네이티브 앱팀의 스펙 파일을 받으면 이 파일과 검증 스크립트를 함께 업데이트 (이 파일의 1번 섹션 참고)

**Q**: "npm run check:arch가 실패했어"
**A**: 검증 레이어가 설계 오류를 감지한 것 → CLAUDE.md 2번 섹션의 해결책 실행

---

**마지막 확인**: 이 파일을 읽은 모든 개발자는 v0.1의 제약(Developer Agent 하나만, bridge_api_contract는 예시)을 인식하고 있습니다.
