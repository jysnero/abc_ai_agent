/**
 * Generated Code 저장 및 검증
 *
 * Developer Agent 결과를 실제 workspace 파일로 저장
 * Architecture contract의 allowed_globs와 required_files를 검증
 */

import fs from "fs";
import path from "path";
import { minimatch } from "minimatch";

export interface SaveCodeOptions {
  workspaceDir: string;
  generatedCode: Record<string, string>;
  testCode: Record<string, string>;
  allowedGlobs: string[];
  requiredFiles: string[];
}

/**
 * Generated code를 workspace에 저장
 * @throws Error if path validation fails or required files missing
 */
export async function saveGeneratedCode(options: SaveCodeOptions): Promise<{
  savedFiles: string[];
  errors: string[];
}> {
  const { workspaceDir, generatedCode, testCode, allowedGlobs, requiredFiles } = options;

  const savedFiles: string[] = [];
  const errors: string[] = [];

  // 모든 generated code 병합
  const allCode = { ...generatedCode, ...testCode };

  // 각 파일 검증 및 저장
  for (const [filePath, content] of Object.entries(allCode)) {
    try {
      // 1. 경로 정규화 및 탈출 검사
      const normalized = path.normalize(filePath);
      if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
        errors.push(`Path traversal detected: ${filePath}`);
        continue;
      }

      // 2. allowed_globs 검증
      const isAllowed = allowedGlobs.some(glob => minimatch(normalized, glob));
      if (!isAllowed) {
        errors.push(`File not in allowed globs: ${filePath}`);
        continue;
      }

      // 3. 파일 저장
      const fullPath = path.join(workspaceDir, normalized);
      const dir = path.dirname(fullPath);

      // 디렉터리 생성
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 파일 쓰기 (Atomic: 임시 파일 → rename)
      const tmpPath = fullPath + ".tmp";
      fs.writeFileSync(tmpPath, content, "utf-8");
      fs.renameSync(tmpPath, fullPath);

      savedFiles.push(normalized);
      console.log(`[SaveGeneratedCode] Saved: ${normalized}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to save ${filePath}: ${msg}`);
    }
  }

  // 4. 필수 파일 검증 (경로 정규화 후 비교)
  const normalizedRequired = requiredFiles.map(f => path.normalize(f));
  const missingFiles = normalizedRequired.filter(f => !savedFiles.includes(f));
  if (missingFiles.length > 0) {
    errors.push(`Missing required files: ${missingFiles.join(", ")}`);
  }

  return { savedFiles, errors };
}

/**
 * Workspace에서 파일 읽기 (검증용)
 */
export function readGeneratedFile(workspaceDir: string, filePath: string): string | null {
  try {
    const normalized = path.normalize(filePath);
    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
      return null;
    }
    const fullPath = path.join(workspaceDir, normalized);
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Workspace 생성 및 초기화
 */
export function initializeWorkspace(workspaceDir: string): void {
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }

  // package.json 기본 템플릿 (필요시)
  const packageJsonPath = path.join(workspaceDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    const template = {
      name: "generated-component",
      version: "0.1.0",
      type: "module",
      scripts: {
        build: "tsc --noEmit",
        test: "vitest run",
        lint: "eslint src/",
      },
      dependencies: {
        react: "^18.0.0",
        typescript: "^5.0.0",
      },
      devDependencies: {
        vitest: "^1.0.0",
        "@testing-library/react": "^14.0.0",
        "@testing-library/user-event": "^14.0.0",
        tailwindcss: "^3.0.0",
        "@types/node": "^20.0.0",
      },
    };
    fs.writeFileSync(packageJsonPath, JSON.stringify(template, null, 2), "utf-8");
  }

  // tsconfig.json 기본 템플릿 (필요시)
  const tsconfigPath = path.join(workspaceDir, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    const tsconfig = {
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        lib: ["ES2020", "DOM"],
        jsx: "react-jsx",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        moduleResolution: "node",
        noEmit: true,
      },
      include: ["src/**/*"],
      exclude: ["node_modules", "**/*.test.tsx"],
    };
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2), "utf-8");
  }
}
