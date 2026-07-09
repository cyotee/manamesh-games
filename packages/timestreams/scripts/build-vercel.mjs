#!/usr/bin/env node
/**
 * Build a static Timestreams site for Vercel:
 *   - SPA (single-file HTML when possible)
 *   - Asset pack at /timestreams-pack/
 *   - vercel.json for static hosting
 *
 * Usage (from monorepo root):
 *   node packages/timestreams/scripts/build-vercel.mjs
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const outDir = path.join(repoRoot, "deploy/timestreams");
const packSrc = path.join(
  repoRoot,
  "packages/timestreams/assets/packs/timestreams",
);
const frontendDir = path.join(repoRoot, "packages/manamesh/packages/frontend");

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function cpRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function findHtmlFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) findHtmlFiles(full, acc);
    else if (name.endsWith(".html")) acc.push(full);
  }
  return acc;
}

console.log("[build-vercel] outDir =", outDir);
rmrf(outDir);
fs.mkdirSync(outDir, { recursive: true });

console.log("[build-vercel] vite build…");
execSync("yarn build", {
  cwd: frontendDir,
  stdio: "inherit",
  env: {
    ...process.env,
    TIMESTREAMS_VERCEL_OUT: outDir,
  },
});

// Flatten SPA entry to /index.html
const htmls = findHtmlFiles(outDir);
const preferred =
  htmls.find((h) => h.includes(`${path.sep}timestreams${path.sep}`)) ||
  htmls.find((h) => path.basename(h) === "index.html") ||
  htmls[0];

if (!preferred) {
  console.error("[build-vercel] No HTML output from vite build");
  process.exit(1);
}

const indexDest = path.join(outDir, "index.html");
if (path.resolve(preferred) !== path.resolve(indexDest)) {
  fs.copyFileSync(preferred, indexDest);
  console.log("[build-vercel] wrote index.html from", path.relative(outDir, preferred));
} else {
  console.log("[build-vercel] index.html already at root");
}

// Copy asset pack
const packDest = path.join(outDir, "timestreams-pack");
if (!fs.existsSync(packSrc)) {
  console.error("[build-vercel] pack missing at", packSrc);
  process.exit(1);
}
console.log("[build-vercel] copying asset pack…");
cpRecursive(packSrc, packDest);

// vercel.json — pure static
const vercelJson = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  buildCommand: null,
  outputDirectory: ".",
  framework: null,
  rewrites: [
    // SPA fallback (assets and pack are real files and take precedence)
    { source: "/((?!timestreams-pack|assets|.*\\..*).*)", destination: "/index.html" },
  ],
  headers: [
    {
      source: "/timestreams-pack/(.*)",
      headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ],
    },
  ],
};
fs.writeFileSync(
  path.join(outDir, "vercel.json"),
  JSON.stringify(vercelJson, null, 2) + "\n",
);

// .vercelignore not needed for prebuilt deploy folder

const size = execSync(`du -sh ${JSON.stringify(outDir)}`).toString().trim();
console.log("[build-vercel] done:", size);
console.log("[build-vercel] contents:", fs.readdirSync(outDir).join(", "));
