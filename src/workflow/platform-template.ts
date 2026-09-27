/**
 * Platform Template
 *
 * pattern_type별로 플랫폼이 workspace에 제공하는 고정 파일 (templates/<pattern_type>/).
 * 이 파일들은 Developer Agent 생성 대상에서 제외된다.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

// src/workflow (tsx) 또는 dist/src/workflow (빌드) 양쪽에서 플랫폼 루트 기준 경로 탐색
function findPlatformPath(rel: string): string | null {
  for (const up of ["../..", "../../.."]) {
    const candidate = path.resolve(moduleDir, up, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findTemplatesRoot(): string | null {
  return findPlatformPath("templates");
}

export function resolveArchitectureChecker(): string {
  const checker = findPlatformPath("scripts/check-architecture.mjs");
  if (!checker) throw new Error("Platform architecture checker not found: scripts/check-architecture.mjs");
  return checker;
}

function getTemplateDir(patternType: string | undefined): string | null {
  if (!patternType || !/^[a-z0-9_-]+$/i.test(patternType)) return null;
  const root = findTemplatesRoot();
  if (!root) return null;
  const dir = path.join(root, patternType);
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : null;
}

function walk(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, base));
    } else {
      out.push(path.relative(base, full).replace(/\\/g, "/"));
    }
  }
  return out;
}

export interface DesignContext {
  designTokensRef: string;
  designTokens: string;
  uiGuideRef: string | null;
  uiGuide: string | null;
}

/**
 * 계약의 design_tokens_ref(플랫폼 루트 기준)와 토큰 파일의 $meta.guide를 읽어 생성 프롬프트용 디자인 자료를 만든다.
 */
export function loadDesignContext(designTokensRef: string | undefined): DesignContext | null {
  if (!designTokensRef || designTokensRef.includes("..") || path.isAbsolute(designTokensRef)) return null;
  const tokensPath = findPlatformPath(designTokensRef);
  if (!tokensPath) return null;
  const designTokens = fs.readFileSync(tokensPath, "utf-8");
  const guideRef: unknown = JSON.parse(designTokens)?.$meta?.guide;
  let uiGuide: string | null = null;
  if (typeof guideRef === "string" && !guideRef.includes("..") && !path.isAbsolute(guideRef)) {
    const guidePath = findPlatformPath(guideRef);
    if (guidePath) uiGuide = fs.readFileSync(guidePath, "utf-8");
  }
  return {
    designTokensRef,
    designTokens,
    uiGuideRef: typeof guideRef === "string" ? guideRef : null,
    uiGuide,
  };
}

type TokenEntry = { value: string | number };

/**
 * design tokens → CSS 변수 + Tailwind 테마 (demo/index.html의 자리표시자에 삽입)
 */
export function renderDesignTokens(designTokens: string): { css: string; tailwindConfig: string } {
  const t = JSON.parse(designTokens);
  const vars: string[] = [];
  const colors: Record<string, string> = {};
  for (const [name, entry] of Object.entries<TokenEntry>(t.color || {})) {
    vars.push(`--color-${name}: ${entry.value};`);
    colors[name] = `var(--color-${name})`;
  }
  const radius: Record<string, string> = {};
  for (const [name, entry] of Object.entries<TokenEntry>(t.radius || {})) {
    vars.push(`--radius-${name}: ${entry.value}px;`);
    radius[name] = `var(--radius-${name})`;
  }
  for (const [name, entry] of Object.entries<TokenEntry>(t.space || {})) {
    vars.push(`--space-${name}: ${entry.value}px;`);
  }
  const fontFamily = t.typography?.["font-family"]?.value;
  if (fontFamily) vars.push(`--font-sans: ${fontFamily};`);
  const config = {
    theme: {
      extend: {
        colors,
        borderRadius: radius,
        ...(fontFamily ? { fontFamily: { sans: ["var(--font-sans)"] } } : {}),
      },
    },
  };
  return { css: `:root { ${vars.join(" ")} }`, tailwindConfig: JSON.stringify(config) };
}

export function applyDesignTokensToWorkspace(workspaceDir: string, designTokens: string): boolean {
  const demo = path.join(workspaceDir, "demo", "index.html");
  if (!fs.existsSync(demo)) return false;
  const html = fs.readFileSync(demo, "utf-8");
  if (!html.includes("/*__DESIGN_TOKENS_CSS__*/")) return false;
  const { css, tailwindConfig } = renderDesignTokens(designTokens);
  fs.writeFileSync(
    demo,
    html.replace("/*__DESIGN_TOKENS_CSS__*/", css).replace("/*__TAILWIND_CONFIG__*/{}", tailwindConfig)
  );
  return true;
}

export function listPlatformFiles(patternType: string | undefined): string[] {
  const dir = getTemplateDir(patternType);
  return dir ? walk(dir, dir).sort() : [];
}

export function copyPlatformTemplate(patternType: string | undefined, workspaceDir: string): string[] {
  const dir = getTemplateDir(patternType);
  if (!dir) return [];
  const files = walk(dir, dir);
  for (const rel of files) {
    const dest = path.join(workspaceDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(dir, rel), dest);
  }
  return files.sort();
}
