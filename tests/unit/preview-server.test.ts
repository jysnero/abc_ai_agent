/**
 * Preview 서버: 쿼리 문자열(?scenario=)과 경로 처리 회귀 테스트 (로컬 HTTP, API 호출 없음)
 */

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { createPreviewServer } from "../../src/cli/commands/preview.js";

const DEMO_HTML = "<!doctype html><title>demo</title><div id=\"root\"></div>";

let root: string;
let workspace: string;
let server: http.Server;
let base: string;

// fetch는 '..'을 정규화하므로 원시 경로를 그대로 보내려면 http.request를 쓴다
async function get(rawPath: string): Promise<{ status: number; location?: string; body: string }> {
  const { request } = await import("node:http");
  return new Promise((resolve, reject) => {
    const req = request(`${base}/`, { path: rawPath }, (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, location: res.headers.location, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("Preview server: query string and path handling", () => {
  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "preview-"));
    workspace = path.join(root, "workspace");
    fs.mkdirSync(path.join(workspace, "demo"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "demo", "index.html"), DEMO_HTML);
    fs.writeFileSync(path.join(workspace, "demo", "파일 이름.txt"), "encoded-name");
    fs.writeFileSync(path.join(root, "outside.txt"), "SECRET-OUTSIDE");
    server = createPreviewServer(workspace, 0);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("serves the demo file when the URL has a scenario query", async () => {
    for (const q of ["?scenario=closed", "?scenario=error&x=1", "?", "#hash"]) {
      const res = await get(`/demo/index.html${q}`);
      assert.equal(res.status, 200, q);
      assert.equal(res.body, DEMO_HTML, q);
    }
  });

  it("root redirect keeps the scenario query for the demo entry", async () => {
    const res = await get("/?scenario=closed");
    assert.equal(res.status, 302);
    assert.equal(res.location, "/demo/index.html?scenario=closed");
    const plain = await get("/");
    assert.equal(plain.location, "/demo/index.html");
  });

  it("percent-encoded file names resolve, missing files are 404", async () => {
    assert.equal((await get(`/demo/${encodeURIComponent("파일 이름.txt")}?v=1`)).body, "encoded-name");
    assert.equal((await get("/demo/missing.html?scenario=closed")).status, 404);
  });

  it("query text never becomes part of the file path", async () => {
    const res = await get("/demo/index.html?/../../outside.txt");
    assert.equal(res.status, 200);
    assert.equal(res.body, DEMO_HTML);
  });

  it("encoded traversal outside the workspace is rejected", async () => {
    for (const p of ["/..%2foutside.txt", "/demo/..%2f..%2foutside.txt", "/%2e%2e/outside.txt", "/..%5coutside.txt"]) {
      const res = await get(p);
      assert.ok(res.status === 403 || res.status === 404, `${p} -> ${res.status}`);
      assert.ok(!res.body.includes("SECRET-OUTSIDE"), p);
    }
  });

  it("malformed percent-encoding is a 400, not a server error", async () => {
    const res = await get("/demo/%E0%A4%A.html?scenario=closed");
    assert.equal(res.status, 400);
  });
});
