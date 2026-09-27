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
