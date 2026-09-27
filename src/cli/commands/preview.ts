/**
 * preview command: Start localhost server for generated artifacts
 *
 * Usage: orchestrate preview --run-id <run-id> [--port 3000]
 */

import http from "http";
import fs from "fs";
import path from "path";
import { ExitCode } from "../cli-errors.js";
import { JsonFormatter } from "../output/formatter.js";

export interface PreviewCommandOptions {
  "run-id": string;
  port?: number;
  json?: boolean;
}

/**
 * Simple HTTP server to serve generated artifacts
 */
function createPreviewServer(workspaceDir: string, port: number): http.Server {
  return http.createServer((req, res) => {
    // Security: path normalization
    const normalizedPath = path.normalize(path.join(workspaceDir, req.url || ""));
    const relativePath = path.relative(workspaceDir, normalizedPath);

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden" }));
      return;
    }

    try {
      if (req.url === "/" || req.url === "") {
        // Serve index.html if exists
        const indexPath = path.join(workspaceDir, "index.html");
        if (fs.existsSync(indexPath)) {
          const content = fs.readFileSync(indexPath, "utf-8");
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(content);
          return;
        }

        // Generate directory listing
        const files = fs.readdirSync(workspaceDir);
        const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Generated Artifacts Preview</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 20px; }
    h1 { color: #333; }
    ul { list-style: none; padding: 0; }
    li { margin: 10px 0; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>📦 Generated Artifacts Preview</h1>
  <p>Run ID: <code>${process.env.PREVIEW_RUN_ID || "unknown"}</code></p>
  <h2>Files</h2>
  <ul>
    ${files
      .map(
        f =>
          `<li><a href="/${f}">${f}</a></li>`
      )
      .join("")}
  </ul>
  <hr>
  <p style="color: #999; font-size: 0.9em;">
    Press Ctrl+C to stop the server
  </p>
</body>
</html>
`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
      }

      const filePath = path.join(workspaceDir, req.url!);

      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        // Redirect to directory listing
        res.writeHead(301, { Location: "/" });
        res.end();
        return;
      }

      // Serve file with appropriate content type
      const ext = path.extname(filePath).toLowerCase();
      let contentType = "application/octet-stream";

      const typeMap: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".jsx": "text/javascript",
        ".ts": "text/typescript",
        ".tsx": "text/typescript",
        ".css": "text/css",
        ".json": "application/json",
        ".md": "text/markdown",
        ".txt": "text/plain",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
      };

      contentType = typeMap[ext] || contentType;

      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": content.length,
      });
      res.end(content);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
}

export async function previewCommand(
  opts: PreviewCommandOptions
): Promise<{ output: string; exitCode: number }> {
  try {
    if (!opts["run-id"]) {
      return {
        output: JsonFormatter.formatError(
          "Missing required option: --run-id <id>",
          ExitCode.CLI_ARGS_ERROR
        ),
        exitCode: ExitCode.CLI_ARGS_ERROR,
      };
    }

    // Find workspace directory
    const baseDir = process.env.TEST_RUN_DIR || path.resolve(".blueprint/runs");
    const workspaceDir = path.join(
      path.dirname(baseDir),
      "workspace",
      opts["run-id"]
    );

    if (!fs.existsSync(workspaceDir)) {
      return {
        output: JsonFormatter.formatError(
          `Workspace not found: ${workspaceDir}`,
          ExitCode.RUN_NOT_FOUND_ERROR
        ),
        exitCode: ExitCode.RUN_NOT_FOUND_ERROR,
      };
    }

    const port = opts.port || 3000;

    // Start server
    const server = createPreviewServer(workspaceDir, port);

    server.listen(port, () => {
      const output = {
        ok: true,
        message: `Preview server started at http://localhost:${port}`,
        run_id: opts["run-id"],
        workspace: workspaceDir,
        url: `http://localhost:${port}`,
        port,
        status: "running",
        stop_command: "Ctrl+C",
      };

      console.log(JSON.stringify(output, null, 2));
    });

    server.on("error", (err: any) => {
      const output = {
        ok: false,
        error: `Server error: ${err.message}`,
        port,
      };
      console.error(JSON.stringify(output, null, 2));
      process.exit(1);
    });

    // Keep server running
    return {
      output: "",
      exitCode: ExitCode.SUCCESS,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      output: JsonFormatter.formatError(msg, ExitCode.WORKFLOW_ERROR),
      exitCode: ExitCode.WORKFLOW_ERROR,
    };
  }
}
