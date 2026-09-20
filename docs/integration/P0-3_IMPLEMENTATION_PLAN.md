# P0-3 구현 계획

> **목표**: scripts/check-architecture.mjs 작성  
> **대상**: architecture-contract.schema.json 검증  
> **포맷**: Node.js ESM (mjs)  
> **의존성**: 신규 라이브러리 추가 최소화

---

## 1. 검증 범위 (우선순위순)

### Phase 1: JSON Schema 검증 (P1)
```
□ 스키마 파일 존재 확인
□ JSON 파싱 성공
□ 필수 필드 존재 (10개)
□ 필드 타입 일치
□ enum 값 일치
□ additionalProperties 위반 감지
```

### Phase 2: 경로 검증 (P2 - Core)
```
□ required_files 모두 존재
□ allowed_globs 패턴 매치 (glob 라이브러리 필요)
□ 생성된 파일이 어떤 glob에 매치되는가
□ "../"와 절대경로 거부
```

### Phase 3: 의존성 검증 (P3)
```
□ npm_packages: package.json 비교
□ script_hosts: HTML <script src> 분석
```

### Phase 4: Bridge 검증 (P4)
```
□ bridge_contract_ref 파일 존재
□ bridge_policy 메서드가 활성인가
□ requires_approval 플래그 감지
```

### Phase 5: 금지 패턴 검증 (P5 - Core)
```
□ 각 forbidden_patterns regex 컴파일
□ 생성 파일 전체 스캔
□ severity별 에러/경고 분류
```

### Phase 6: 설계 토큰 검증 (P6)
```
□ design_tokens_ref 파일 존재
```

---

## 2. 의존성 검토

### 현재 package.json
```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest"
  },
  "devDependencies": {
    "@anthropic-ai/sdk": "^0.127.0",
    "@types/node": "^20.10.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3"
  }
}
```

### 필요한 라이브러리 (신규 추가)

| 라이브러리 | 용도 | 선택 | 이유 |
|----------|------|------|------|
| **minimatch** | glob 패턴 매칭 | 필수 | 경로 검증에 필수 |
| **ajv** | JSON Schema 검증 | 선택 | 현재 수동 검증, P0-3에서 추가 고려 |

### 권장: Phase 1에서는 수동 검증, Phase 2부터 minimatch 사용

---

## 3. 파일 구조

```
scripts/
├── check-arch.ts          (기존: minigame_shell_v1 검증)
└── check-architecture.mjs (신규: architecture-contract 검증)

usage:
  npm run check:arch -- contracts/patterns/minigame_shell_v1.json src/agents
  npm run check:arch -- contracts/architecture-contract.schema.json ./generated-service/
```

---

## 4. 기본 구조 (check-architecture.mjs)

```javascript
#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. CLI 인자 파싱
// 2. 스키마 로드
// 3. 검증 함수들
// 4. 결과 포맷팅 및 출력

class ArchitectureValidator {
  constructor(schemaPath, contractPath) { ... }
  
  validateJsonSchema() { ... }
  validatePathStructure() { ... }
  validateDependencies() { ... }
  validateBridgePolicy() { ... }
  validateForbiddenPatterns() { ... }
  validateDesignTokens() { ... }
  
  validate() { ... }
}

async function main() { ... }
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

---

## 5. 구현 단계

### Step 1: 기본 구조 작성
- [ ] CLI 인자 파싱
- [ ] 파일 존재 확인
- [ ] JSON 파싱

### Step 2: 필수 필드 검증 (수동)
- [ ] 10개 필수 필드 존재 여부
- [ ] 필드 타입 확인
- [ ] enum 값 일치

### Step 3: 경로 검증 (minimatch 도입)
- [ ] npm install minimatch --save-dev
- [ ] glob 패턴 컴파일
- [ ] 생성 파일 매칭

### Step 4: 나머지 검증
- [ ] 의존성, Bridge, 토큰, 패턴

### Step 5: 테스트
- [ ] valid-minigame-contract.json → PASS
- [ ] invalid-additional-properties.json → FAIL
- [ ] invalid-forbidden-path.json → WARN

---

## 6. 출력 형식 (예상)

```
🏗️  Architecture Contract Validation
Contract: req-2026-0920-001-minigame
Schema: contracts/architecture-contract.schema.json

✅ JSON Schema validation PASSED
✅ Required files: 4/4 found
✅ Allowed paths: 42/42 matched
✅ Bridge methods: 3/3 in policy
⚠️  Forbidden patterns: 0 blocks, 2 warns
✅ Design tokens: found

📊 Summary:
  - Errors: 0
  - Warnings: 2
  - Status: PASSED (with warnings)

Exit code: 0
```

---

## 7. 시간 예상

- Phase 1-2: 30분 (CLI, JSON, 경로)
- Phase 3-5: 20분 (의존성, Bridge, 패턴)
- Phase 6 (테스트): 10분
- **총**: ~60분

---

## 다음: 구현 시작

준비 완료. 구현을 진행할까요?
