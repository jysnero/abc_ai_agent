# P0-3 Architecture Check 검증 체크리스트

> **목적**: P0-3 (check-architecture.mjs) 작성 시 구현해야 할 검증 항목 목록  
> **대상**: 아키텍처 검증 엔진 개발자  
> **문서 버전**: 1.0.0  
> **작성일**: 2026-09-20

---

## 1. JSON Schema 검증 (P0-1이 담당, P0-3은 통과 확인만)

### 1.1 스키마 파일 로드

```typescript
// P0-3 구현 예시
const schema = JSON.parse(fs.readFileSync('contracts/architecture-contract.schema.json'));
// ✅ 스키마 파일 존재 확인
// ✅ JSON 파싱 성공 확인
```

### 1.2 JSON Schema 검증

```
□ 필수 필드: contract_id, version, pattern_type, issued_by, ...
□ 타입 검증: 각 필드의 type
□ Enum 검증: issued_by = "architect_agent", severity = "block"|"warn"
□ Pattern 검증: version 형식, contract_id 형식
□ additionalProperties: false (허용되지 않은 필드 감지)
□ 파일 전체가 유효한 JSON Schema Draft 2020-12인지 확인
```

---

## 2. 의미 검증 항목 (P0-3에서 구현)

### 2.1 contract_id 검증

```typescript
// contract_id 형식: req-YYYY-MMDD-NNN-<service_type>
const idPattern = /^req-\d{4}-\d{4}-\d{3}-[a-z-]+$/;
if (!idPattern.test(contract.contract_id)) {
  error("contract_id format invalid");
}
```

**검증 항목**:
- [ ] 형식 일치 (`req-YYYY-MMDD-NNN-<service_type>`)
- [ ] 다른 계약과 중복되지 않는지 확인 (선택)

---

### 2.2 pattern_type 검증

```typescript
const contractFile = `contracts/patterns/${contract.pattern_type}.json`;
if (!fs.existsSync(contractFile)) {
  error(`Pattern not found: ${contract.pattern_type}`);
}
```

**검증 항목**:
- [ ] 기존 패턴이면 `contracts/patterns/<pattern>.json` 파일 존재
- [ ] `custom:` 접두사면 계약 내용이 충분히 상세한지 검토
- [ ] 등록되지 않은 패턴 감지

---

### 2.3 folder_structure 검증

#### 2.3.1 required_files 검증

```typescript
const serviceRoot = '.'; // 생성된 서비스 루트
for (const file of contract.folder_structure.required_files) {
  if (!fs.existsSync(path.join(serviceRoot, file))) {
    error(`Required file not found: ${file}`);
  }
}
```

**검증 항목**:
- [ ] 모든 required_files 존재 확인
- [ ] 하나라도 빠지면 에러

#### 2.3.2 allowed_globs 검증

```typescript
import minimatch from 'minimatch'; // glob 라이브러리

const allFiles = getAllFilesRecursively('.');
for (const file of allFiles) {
  let matched = false;
  for (const glob of contract.folder_structure.allowed_globs) {
    if (minimatch(file, glob)) {
      matched = true;
      break;
    }
  }
  if (!matched) {
    error(`File not in allowed globs: ${file}`);
  }
}
```

**검증 항목**:
- [ ] 생성된 모든 파일이 어떤 glob 패턴에 매치되는지 확인
- [ ] 매치되지 않는 파일 감지 → 에러
- [ ] 상위 디렉토리 접근(`../`) glob은 무시하고 경고

---

### 2.4 allowed_dependencies 검증

#### 2.4.1 script_hosts 검증

```typescript
const htmlContent = fs.readFileSync('src/index.html', 'utf-8');
const scriptSrcRegex = /<script[^>]+src=["']([^"']+)["']/g;
let match;

while ((match = scriptSrcRegex.exec(htmlContent)) !== null) {
  const src = match[1];
  const allowed = contract.allowed_dependencies.script_hosts.some(host => src.startsWith(host));
  if (!allowed) {
    error(`Script host not allowed: ${src}`);
  }
}
```

**검증 항목**:
- [ ] 생성된 HTML의 모든 `<script src>` 호스트가 allowlist 내에 있는지 확인
- [ ] 허용되지 않은 호스트 감지 → 에러

#### 2.4.2 npm_packages 검증

```typescript
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

for (const [pkg, version] of Object.entries(deps)) {
  const allowed = contract.allowed_dependencies.npm_packages.some(
    allowedPkg => allowedPkg.split('@')[0] === pkg
  );
  if (!allowed) {
    error(`Package not allowed: ${pkg}@${version}`);
  }
}
```

**검증 항목**:
- [ ] `package.json`의 모든 의존성이 allowlist 내에 있는지 확인
- [ ] 허용되지 않은 패키지 감지 → 에러
- [ ] 버전 범위 검증 (선택: `package.json`의 버전이 계약 버전 범위에 맞는가)

---

### 2.5 bridge_api_contract 검증

```typescript
// 생성된 코드에서 Bridge 호출 분석
const sourceFiles = glob('src/**/*.{ts,tsx}');
const bridgeCallRegex = /(NHBridge\.\w+\.\w+)\s*\(/g;

for (const file of sourceFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  let match;
  
  while ((match = bridgeCallRegex.exec(content)) !== null) {
    const methodName = match[1]; // 예: NHBridge.reward.grantPoint
    
    if (!contract.bridge_api_contract[methodName]) {
      error(`Bridge method not in contract: ${methodName}`);
    }
  }
}
```

**검증 항목**:
- [ ] 생성된 코드에서 호출하는 모든 Bridge 메서드가 계약에 정의되어 있는지 확인
- [ ] 허용되지 않은 메서드 호출 감지 → 에러
- [ ] 세션당 호출 횟수 추적 (execution-plan과 비교, 선택)

---

### 2.6 forbidden_patterns 검증

```typescript
const sourceFiles = glob('src/**/*.{ts,tsx}');

for (const pattern of contract.forbidden_patterns) {
  try {
    const regex = new RegExp(pattern.regex);
    
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      
      lines.forEach((line, lineNo) => {
        if (regex.test(line)) {
          const severity = pattern.severity;
          const msg = `${severity.toUpperCase()}: ${pattern.id} (${pattern.reason}) at ${file}:${lineNo + 1}`;
          
          if (severity === 'block') {
            error(msg);
          } else {
            warn(msg);
          }
        }
      });
    }
  } catch (e) {
    error(`Invalid regex in pattern "${pattern.id}": ${e.message}`);
  }
}
```

**검증 항목**:
- [ ] 각 forbidden_patterns의 regex 문법 검증
- [ ] regex가 유효하지 않으면 에러
- [ ] 생성된 모든 파일을 대상으로 regex 실행
- [ ] 매치되면:
  - [ ] severity = "block" → 에러 (커밋 불가)
  - [ ] severity = "warn" → 경고 (커밋 가능)

---

### 2.7 design_tokens_ref 검증

```typescript
const tokenFile = contract.design_tokens_ref;
if (!fs.existsSync(tokenFile)) {
  warn(`Design tokens file not found: ${tokenFile}`);
  // 또는 에러
}
```

**검증 항목**:
- [ ] 지정된 파일이 존재하는지 확인
- [ ] 파일 없으면 경고 또는 에러

---

## 3. 고급 검증 항목 (선택)

### 3.1 execution-plan과의 관계 검증

```typescript
if (executionPlan) {
  // target_files ⊆ allowed_globs
  for (const targetFile of executionPlan.target_files) {
    let matched = false;
    for (const glob of architecture.folder_structure.allowed_globs) {
      if (minimatch(targetFile, glob)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      error(`execution-plan target exceeds architecture boundary: ${targetFile}`);
    }
  }
}
```

**검증 항목**:
- [ ] execution-plan의 target_files이 architecture의 allowed_globs 범위 내에 있는지
- [ ] execution-plan의 Bridge 호출이 max_calls_per_session을 초과하지 않는지

### 3.2 경로 충돌 분석 (선택)

```typescript
// forbidden_paths와 allowed_globs의 충돌 감지
// (현재 버전: forbidden_patterns로 구현되므로 불필요)
```

---

## 4. 검증 규칙 우선순위

| 규칙 | 우선순위 | 설명 |
|------|---------|------|
| **JSON Schema** | P0 | 반드시 검증 |
| **required_files** | P0 | 필수 파일 존재 |
| **allowed_globs** | P0 | 경로 범위 확인 |
| **pattern_type** | P0 | 템플릿 존재 확인 |
| **allowed_dependencies** | P1 | 의존성 검증 |
| **bridge_api_contract** | P1 | Bridge 메서드 검증 |
| **forbidden_patterns** | P1 | 코드 패턴 검증 |
| **design_tokens_ref** | P2 | 토큰 파일 존재 |
| **execution-plan 관계** | P2 | 부분집합 검증 |

---

## 5. 에러 vs 경고 분류

### 5.1 에러 (에러 코드 1로 종료)

- JSON Schema 검증 실패
- required_files 빠짐
- allowed_globs 초과 경로
- pattern_type 미등록
- Bridge 메서드 미허용
- forbidden_patterns (severity="block") 매치

### 5.2 경고 (에러 코드 0, 메시지만 출력)

- forbidden_patterns (severity="warn") 매치
- design_tokens_ref 파일 미존재
- execution-plan 주의사항

---

## 6. 출력 형식 (권장)

```
🏗️  Architecture Validation
Contract: contracts/architecture-contract.schema.json
Service: ./

✅ All checks passed
Details:
  - Required files: 4/4 found
  - Allowed paths: 42/42 matched
  - Bridge methods: 3/3 authorized
  - Code patterns: 0 violations
  - Design tokens: found

⚠️  WARNINGS: 1
  - Design system reference not found: design/tokens.json

❌ ERRORS: 0
```

---

## 7. 구현 순서 (권장)

1. **Phase 1**: JSON Schema 검증 (P0-1)
2. **Phase 2**: 경로 검증 (required_files, allowed_globs)
3. **Phase 3**: 의존성 검증 (npm, script hosts)
4. **Phase 4**: Bridge API 검증
5. **Phase 5**: 금지된 패턴 검증
6. **Phase 6**: 고급 검증 (execution-plan 관계)

---

## 8. 테스트 케이스

### 테스트 1: 정상 계약 (`valid-minigame-contract.json`)

```bash
$ npm run check:arch contracts/architecture-contract.schema.json contracts/examples/valid-minigame-contract.json
✅ PASSED
```

### 테스트 2: 추가 필드 (`invalid-additional-properties.json`)

```bash
$ npm run check:arch contracts/architecture-contract.schema.json contracts/examples/invalid-additional-properties.json
❌ FAILED: additionalProperties "custom_field_not_allowed" not allowed
```

### 테스트 3: 금지된 경로 (`invalid-forbidden-path.json`)

```bash
$ npm run check:arch contracts/architecture-contract.schema.json contracts/examples/invalid-forbidden-path.json
⚠️  WARNING: allowed_globs includes "dist/**/*" which is typically a build output directory
```

---

**체크리스트 끝**