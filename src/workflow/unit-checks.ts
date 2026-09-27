/**
 * 생성 단위 체크: 구문 검사와 import 해석
 * - 아직 생성하지 않은 뒤 단위 파일의 import → pending (오류 아님)
 * - 계획에 없는 파일·템플릿에 없는 패키지 import → error
 * 전체 타입 검사·build·test는 모든 단위가 연결된 뒤 workspace에서 수행한다.
 */

import path from "path";
import ts from "typescript";

export interface UnitFileCheck {
  file: string;
  syntax_errors: string[];
  import_errors: string[];
  pending_imports: string[];
}

const ALLOWED_PACKAGES = [
  "react",
  "react-dom",
  "vitest",
  "@testing-library/react",
  "@testing-library/user-event",
  "@testing-library/jest-dom",
];

export function syntaxErrors(file: string, content: string): string[] {
  const out = ts.transpileModule(content, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  });
  return (out.diagnostics || []).map((d) => {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    if (d.file && d.start !== undefined) {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      return `${line + 1}:${character + 1} ${msg}`;
    }
    return msg;
  });
}

function resolveRelative(from: string, spec: string, known: Set<string>): string | null {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (known.has(c)) return c;
  }
  return null;
}

export function checkUnitFile(
  file: string,
  content: string,
  available: Set<string>,
  pending: Set<string>
): UnitFileCheck {
  const result: UnitFileCheck = { file, syntax_errors: syntaxErrors(file, content), import_errors: [], pending_imports: [] };
  for (const imp of ts.preProcessFile(content, true, true).importedFiles) {
    const spec = imp.fileName;
    if (spec.startsWith(".")) {
      if (resolveRelative(file, spec, available)) continue;
      const later = resolveRelative(file, spec, pending);
      if (later) result.pending_imports.push(later);
      else result.import_errors.push(`${spec}: not a planned file`);
    } else {
      const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (!ALLOWED_PACKAGES.includes(pkg)) result.import_errors.push(`${spec}: package not provided by the platform template`);
    }
  }
  return result;
}
