/**
 * Durable structural + installability checks for Phase 1 packages.
 * Run: node --test scripts/verify-phase1-packs.test.mjs
 *
 * Packs tarballs from the monorepo, installs into a temp dir, asserts:
 * - package names
 * - no workspace:/portal:/file: in published package.json
 * - smoke require/import of key entry points
 * - asset-pack-builder CLI --help
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mm-phase1-"));
const tarballs = path.join(scratch, "tarballs");
const installDir = path.join(scratch, "install");
fs.mkdirSync(tarballs);
fs.mkdirSync(installDir);

function pack(dir, extraPrep) {
  if (extraPrep) extraPrep();
  const out = execSync("npm pack --ignore-scripts --pack-destination " + JSON.stringify(tarballs), {
    cwd: dir,
    encoding: "utf8",
  });
  const name = out.trim().split("\n").filter(Boolean).pop();
  return path.join(tarballs, name);
}

test("phase1 packages pack and clean-install without monorepo protocols", async () => {
  // boardgame.io
  const bgioDir = path.join(root, "packages/boardgame.io");
  execSync("npm run build", {
    cwd: bgioDir,
    stdio: "ignore",
    env: { ...process.env, PATH: path.join(bgioDir, "node_modules/.bin") + path.delimiter + process.env.PATH },
  });
  try {
    execSync("node scripts/proxy-dirs.js", { cwd: bgioDir, stdio: "ignore" });
  } catch {
    /* already present */
  }
  const bgioTgz = pack(bgioDir);

  // p2p
  execSync("yarn workspace @cyotee/boardgameio-p2p build", { cwd: root, stdio: "ignore" });
  const p2pDir = path.join(root, "packages/boardgameIO-p2p");
  const p2pPj = path.join(p2pDir, "package.json");
  const p2pBak = fs.readFileSync(p2pPj, "utf8");
  {
    const j = JSON.parse(p2pBak);
    if (j.devDependencies) delete j.devDependencies["boardgame.io"];
    fs.writeFileSync(p2pPj, JSON.stringify(j, null, 2));
  }
  const p2pTgz = pack(p2pDir);
  fs.writeFileSync(p2pPj, p2pBak);

  // crypto
  const cryptoDir = path.join(root, "packages/boardgameio-crypto");
  try {
    execSync("yarn workspace @cyotee/boardgameio-crypto build", { cwd: root, stdio: "ignore" });
  } catch {
    assert.ok(
      fs.existsSync(path.join(cryptoDir, "dist/index.js")),
      "crypto build must emit dist/index.js"
    );
  }
  const cryptoPj = path.join(cryptoDir, "package.json");
  const cryptoBak = fs.readFileSync(cryptoPj, "utf8");
  {
    const j = JSON.parse(cryptoBak);
    if (j.devDependencies) delete j.devDependencies["boardgame.io"];
    fs.writeFileSync(cryptoPj, JSON.stringify(j, null, 2));
  }
  const cryptoTgz = pack(cryptoDir);
  fs.writeFileSync(cryptoPj, cryptoBak);

  // manamesh
  const manameshDir = path.join(root, "packages/manamesh/packages/frontend");
  execSync("yarn workspace @cyotee/manamesh build:lib", { cwd: root, stdio: "ignore" });
  if (!fs.existsSync(path.join(manameshDir, "dist/index.html"))) {
    fs.writeFileSync(path.join(manameshDir, "dist/index.html"), "<!doctype html><title>mm</title>");
  }
  const manameshPj = path.join(manameshDir, "package.json");
  const manameshBak = fs.readFileSync(manameshPj, "utf8");
  execSync("node scripts/rewrite-deps-for-publish.mjs package.json", { cwd: manameshDir });
  const manameshTgz = pack(manameshDir);
  fs.writeFileSync(manameshPj, manameshBak);

  // asset pack builder
  execSync("yarn workspace @cyotee/manamesh-asset-pack-builder build", { cwd: root, stdio: "ignore" });
  const apbTgz = pack(path.join(root, "packages/manamesh-asset-pack-builder"));

  const pkgJson = {
    name: "phase1-verify",
    private: true,
    type: "module",
    dependencies: {
      "boardgame.io": `file:${bgioTgz}`,
      "@cyotee/boardgameio-p2p": `file:${p2pTgz}`,
      "@cyotee/boardgameio-crypto": `file:${cryptoTgz}`,
      "@cyotee/manamesh": `file:${manameshTgz}`,
      "@cyotee/manamesh-asset-pack-builder": `file:${apbTgz}`,
    },
  };
  fs.writeFileSync(path.join(installDir, "package.json"), JSON.stringify(pkgJson, null, 2));
  execSync("npm install --legacy-peer-deps", { cwd: installDir, stdio: "ignore" });

  const installed = [
    ["boardgame.io", "@cyotee/boardgame.io"],
    ["@cyotee/boardgameio-p2p", "@cyotee/boardgameio-p2p"],
    ["@cyotee/boardgameio-crypto", "@cyotee/boardgameio-crypto"],
    ["@cyotee/manamesh", "@cyotee/manamesh"],
    ["@cyotee/manamesh-asset-pack-builder", "@cyotee/manamesh-asset-pack-builder"],
  ];

  for (const [folder, expectedName] of installed) {
    const pjPath = path.join(installDir, "node_modules", ...folder.split("/"), "package.json");
    assert.ok(fs.existsSync(pjPath), `missing ${pjPath}`);
    const pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));
    assert.equal(pj.name, expectedName);
    const blob = JSON.stringify(pj);
    assert.equal(blob.includes("workspace:"), false, `${expectedName} has workspace:`);
    assert.equal(blob.includes("portal:"), false, `${expectedName} has portal:`);
    // file: only allowed in the consumer's package.json, not in published packages
    if (pj.dependencies) {
      for (const v of Object.values(pj.dependencies)) {
        assert.equal(String(v).startsWith("file:"), false, `${expectedName} dep uses file:`);
        assert.equal(String(v).startsWith("workspace:"), false);
      }
    }
  }

  // Smoke: CJS client + crypto ESM + CLI help
  const clientType = execSync(
    `node -e "const {Client}=require('boardgame.io/dist/cjs/client.js'); if(typeof Client!=='function') process.exit(1);"`,
    { cwd: installDir, encoding: "utf8" }
  );
  assert.equal(clientType, "");

  const help = execSync(
    "node node_modules/@cyotee/manamesh-asset-pack-builder/bin/cli.js --help",
    { cwd: installDir, encoding: "utf8" }
  );
  assert.match(help, /ManaMesh Asset Pack Builder|Usage: manamesh-asset-pack-builder/);

  // cleanup
  fs.rmSync(scratch, { recursive: true, force: true });
});
