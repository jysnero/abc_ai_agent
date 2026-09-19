# AI Agent Platform

Multi-Agent Orchestration Framework for collaborative AI development.

## 🚀 Quick Start

### 1. 프로젝트 셋업

```bash
npm install
```

### 2. 환경 변수 설정

```bash
cp .env.example .env
# .env 에 ANTHROPIC_API_KEY 입력
```

### 3. 아키텍처 검증 (API 비용 없음)

```bash
npm run check:arch -- contracts/patterns/minigame_shell_v1.json <target-folder>
```

이 명령으로 설계 검증 레이어가 제대로 작동하는지 확인할 수 있습니다.

### 4. Claude Code 시작

```bash
claude
```

`CLAUDE.md`를 먼저 읽고 진행합니다. **v0.1 목표**: Developer Agent 하나만 구현.

---

## 📁 프로젝트 구조

```
ai-agent-platform/
├── CLAUDE.md                          # 프로젝트 컨텍스트 (모든 개발자가 읽음)
├── README.md
├── package.json
├── .env.example
├── tsconfig.json
├── contracts/
│   └── patterns/
│       └── minigame_shell_v1.json     # Agent 계약서 스키마 + 예시
├── scripts/
│   └── check-arch.ts                  # 아키텍처 검증 스크립트
└── src/
    ├── index.ts
    ├── orchestrator.ts                # Agent 오케스트레이터
    └── agents/
        ├── developer.ts               # v0.1: Developer Agent 구현
        ├── validator.ts
        ├── optimizer.ts
        └── index.ts
```

---

## ⚠️ 주의사항

### Bridge API Contract는 **아직 예시입니다**

`contracts/patterns/minigame_shell_v1.json` 의 `bridge_api_contract` 섹션은 **샘플 데이터**입니다.

실제 API 스펙은 네이티브 앱팀에서 받아서 교체해야 합니다.

### 다중 Agent 구현 금지 (v0.1 단계)

코드를 작성할 때 "조직도대로 7개 Agent를 한 번에 만들려고" 하는 것은 **가장 흔한 실패 패턴**입니다.

- **v0.1 목표**: Developer Agent **하나만** end-to-end 구현 + 검증
- 나머지 6개는 틀 만들고 실제 로직은 v0.2 이후

자세한 내용은 `CLAUDE.md`를 참고하세요.

---

## 🔄 개발 워크플로우

1. **설계**: `/blueprint` 스킬로 Agent 설계 생성
2. **스펙**: `/deep-dive` 스킬로 요구사항 구체화
3. **구현**: Claude Code로 코드 작성
4. **최적화**: `/autoresearch` 스킬로 자동 평가 및 개선
5. **마무리**: `/reflect` 스킬로 세션 정리 및 학습 저장

---

## 📚 참고

- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)
- CLAUDE.md - 프로젝트 컨텍스트 및 의사결정 기록
