#!/usr/bin/env node
/**
 * @cyotee/manamesh-asset-pack-builder
 * Serves the prebuilt static SPA on a local port.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: manamesh-asset-pack-builder [options]

Serve the ManaMesh Asset Pack Builder UI.

Options:
  --port, -p <n>   Port (default: 5174, or PORT env)
  --help, -h       Show this help
`);
  process.exit(0);
}

let port = Number(process.env.PORT) || 5174;
const portIdx = args.findIndex((a) => a === "--port" || a === "-p");
if (portIdx >= 0 && args[portIdx + 1]) {
  port = Number(args[portIdx + 1]) || port;
}

if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, "index.html"))) {
  console.error(
    "Error: prebuilt dist/ not found. Reinstall the package or run the package build."
  );
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let rel = urlPath === "/" ? "/index.html" : urlPath;
    // prevent path traversal
    const filePath = path.normalize(path.join(distDir, rel));
    if (!filePath.startsWith(distDir)) {
      send(res, 403, "Forbidden");
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // SPA fallback
      const index = path.join(distDir, "index.html");
      send(res, 200, fs.readFileSync(index), {
        "Content-Type": "text/html; charset=utf-8",
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    send(res, 200, fs.readFileSync(filePath), { "Content-Type": type });
  } catch (err) {
    send(res, 500, String(err));
  }
});

server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}/`;
  console.log(`ManaMesh Asset Pack Builder listening at ${url}`);
  console.log("Press Ctrl+C to stop.");
});
