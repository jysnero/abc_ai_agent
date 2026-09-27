/**
 * architecture-check 연결 검증: 플랫폼 checker가 Run 계약으로 생성 workspace를 검사하는지
 * (API 호출 없음, npm install 없음)
 */

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { buildArchitectureCheckCommand } from "../../src/workflow/workflow-runner.js";
import { initializeWorkspace } from "../../src/workflow/save-generated-code.js";
import { buildExecutionPlan } from "../../src/builders/plan-builder.js";

const contractText = fs.readFileSync(path.resolve("contracts/examples/ox-quiz-browser-contract.json"), "utf-8");
const plan = buildExecutionPlan(JSON.parse(contractText));
const runId = "run-00000000-0000-4000-8000-000000000001";

let root: string;
let prevRunDir: string | undefined;

function makeWorkspace(name: string, appSource: string): string {
  const ws = path.join(root, "workspace", name);
  initializeWorkspace(ws, "browser_component");
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
    fs.writeFileSync(path.join(ws, rel), content);
  };
  write("src/types.ts", "export interface Question { text: string; answer: boolean }\n");
  write("src/App.tsx", appSource);
  write("tests/Quiz.test.tsx", "import { it } from \"vitest\";\nit(\"ok\", () => {});\n");
  // 빌드·설치 산출물(외부 URL 포함)은 검사 대상이 아님
  write("demo/dist/app.js", "// https://react.dev\n");
  write("package-lock.json", "{\"resolved\": \"https://registry.npmjs.org/react\"}\n");
  return ws;
}

function runChecker(ws: string) {
  const { command, args } = buildArchitectureCheckCommand(runId, ws, plan.platform_files || []);
  // 다른 cwd에서 실행해도 결과가 같아야 함 (모든 경로가 절대경로)
  const r = spawnSync(command, args, { cwd: os.tmpdir(), encoding: "utf-8", shell: false });
  return { command, args, status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

describe("architecture-check wiring (platform checker → run contract → generated workspace)", () => {
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "arch-check-"));
    prevRunDir = process.env.TEST_RUN_DIR;
    process.env.TEST_RUN_DIR = path.join(root, "runs");
    fs.mkdirSync(path.join(root, "runs", runId), { recursive: true });
    fs.writeFileSync(path.join(root, "runs", runId, "architecture-contract.v1.json"), contractText);
  });
  after(() => {
    if (prevRunDir === undefined) delete process.env.TEST_RUN_DIR;
    else process.env.TEST_RUN_DIR = prevRunDir;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("command uses node executable + absolute platform checker, run contract, workspace", () => {
    const ws = makeWorkspace("probe", "export default function App() { return null; }\n");
    const { command, args } = buildArchitectureCheckCommand(runId, ws, []);
    assert.equal(command, process.execPath);
    assert.ok(path.isAbsolute(args[0]) && args[0].endsWith(path.join("scripts", "check-architecture.mjs")));
    assert.ok(fs.existsSync(args[0]));
    assert.equal(args[1], path.join(root, "runs", runId, "architecture-contract.v1.json"));
    assert.deepEqual(args.slice(2, 4), ["--workspace", ws]);
  });

  it("A: valid workspace passes and generated files are the scanned target", () => {
    const ws = makeWorkspace("valid", "export default function App() { return <div>OX</div>; }\n");
    const r = runChecker(ws);
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes(`Workspace: ${ws}`), r.out);
    for (const f of ["src/App.tsx", "src/types.ts", "tests/Quiz.test.tsx"]) {
      assert.ok(r.out.includes(f), `${f} should be scanned\n${r.out}`);
    }
  });

  it("B: forbidden pattern in generated App.tsx fails", () => {
    const ws = makeWorkspace(
      "violation",
      "export default function App() { fetch(\"https://example.com/score\"); return null; }\n"
    );
    const r = runChecker(ws);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('forbidden pattern "no-external-api" in src/App.tsx'), r.out);
  });

  it("B': missing required file in workspace fails", () => {
    const ws = makeWorkspace("missing", "export default function App() { return null; }\n");
    fs.rmSync(path.join(ws, "src/types.ts"));
    const r = runChecker(ws);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes("required file missing: src/types.ts"), r.out);
  });
});
