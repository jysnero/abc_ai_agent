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

const DEMO_ENTRY = "demo/index.html";

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
        // Priority 0: 플랫폼 데모 mount (실제 동작 화면)
        if (fs.existsSync(path.join(workspaceDir, DEMO_ENTRY))) {
          res.writeHead(302, { Location: `/${DEMO_ENTRY}` });
          res.end();
          return;
        }

        // Priority 1: Check if src/App.tsx exists (generated React component) - serve this first
        const appTsxPath = path.join(workspaceDir, "src", "App.tsx");
        if (fs.existsSync(appTsxPath)) {
          // Generate wrapper HTML that imports from src/App.tsx using esm.sh
          const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Generated Component Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
  </style>
</head>
<body class="bg-gray-50">
  <div id="root"></div>

  <script type="module">
    import React from 'https://esm.sh/react@18.2.0';
    import ReactDOM from 'https://esm.sh/react-dom@18.2.0/client';

    // Note: This preview loads from /src/App.tsx static file
    // Actual React component mounting requires build step
    // For now, displaying code as documentation
    fetch('/src/App.tsx')
      .then(r => r.text())
      .then(code => {
        const root = document.getElementById('root');
        root.innerHTML = \`
          <div class="max-w-4xl mx-auto p-8">
            <div class="bg-white rounded-lg shadow p-6">
              <h1 class="text-3xl font-bold mb-4">Generated Component: App.tsx</h1>
              <p class="text-gray-600 mb-4">Component source code (live React mount pending build):</p>
              <pre class="bg-gray-100 p-4 rounded overflow-auto"><code>\${code}</code></pre>
              <p class="text-sm text-gray-500 mt-4">
                To run the compiled component, ensure package.json has vite configured and run: npm run preview
              </p>
            </div>
          </div>
        \`;
      })
      .catch(err => {
        document.getElementById('root').innerHTML = \`
          <div class="max-w-4xl mx-auto p-8">
            <div class="bg-white rounded-lg shadow p-6 border-l-4 border-red-500">
              <h1 class="text-2xl font-bold text-red-700 mb-2">Preview Not Ready</h1>
              <p class="text-gray-600">src/App.tsx not found: \${err.message}</p>
              <p class="text-sm text-gray-500 mt-4">Generated files appear here once code generation is complete.</p>
            </div>
          </div>
        \`;
      });
  </script>
</body>
</html>`;
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(html);
          return;
        }

        // Priority 2: Serve index.html if exists
        const indexPath = path.join(workspaceDir, "index.html");
        if (fs.existsSync(indexPath)) {
          const content = fs.readFileSync(indexPath, "utf-8");
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(content);
          return;
        }

        // Priority 3: Generate directory listing
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

    // Store server reference to prevent GC
    const entryPath = fs.existsSync(path.join(workspaceDir, DEMO_ENTRY)) ? `/${DEMO_ENTRY}` : "";
    const serverRunning = () => {
      const output = {
        ok: true,
        message: `Preview server started at http://localhost:${port}${entryPath}`,
        run_id: opts["run-id"],
        workspace: workspaceDir,
        url: `http://localhost:${port}${entryPath}`,
        port,
        status: "running",
        stop_command: "Ctrl+C",
      };

      console.log(JSON.stringify(output, null, 2));
    };

    server.listen(port, serverRunning);

    server.on("error", (err: any) => {
      const output = {
        ok: false,
        error: `Server error: ${err.message}`,
        port,
      };
      console.error(JSON.stringify(output, null, 2));
      process.exit(1);
    });

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      console.log("\n[Preview] Shutting down server...");
      server.close(() => {
        console.log("[Preview] Server stopped");
        process.exit(0);
      });
    });

    // Keep server running - never return from this function
    // Instead, wait indefinitely (server will run until SIGINT)
    return new Promise(() => {
      // Never resolve - keep process alive
    }) as any;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      output: JsonFormatter.formatError(msg, ExitCode.WORKFLOW_ERROR),
      exitCode: ExitCode.WORKFLOW_ERROR,
    };
  }
}
