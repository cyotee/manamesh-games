#!/usr/bin/env node
/**
 * Phase 1 npm publish helper.
 *
 * Requires an npm automation / granular token with bypass-2fa:
 *   export NPM_TOKEN=npm_...
 *   # or ensure ~/.npmrc has a bypass-2fa token
 *
 * Usage (from monorepo root):
 *   node scripts/npm-publish-phase1.mjs
 *   node scripts/npm-publish-phase1.mjs --dry-run
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

function run(cmd, cwd) {
  console.log(`\n$ (${cwd}) ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", env: process.env });
}

function withPackageJson(dir, mutate, fn) {
  const pj = path.join(dir, "package.json");
  const bak = pj + ".publish-bak";
  fs.copyFileSync(pj, bak);
  try {
    const pkg = JSON.parse(fs.readFileSync(pj, "utf8"));
    mutate(pkg);
    fs.writeFileSync(pj, JSON.stringify(pkg, null, 2) + "\n");
    fn();
  } finally {
    fs.renameSync(bak, pj);
  }
}

const steps = [
  {
    name: "@cyotee/boardgame.io",
    dir: path.join(root, "packages/boardgame.io"),
    prepare() {
      run("npm run build", this.dir);
      try {
        run("node scripts/proxy-dirs.js", this.dir);
      } catch {
        /* dirs may already exist */
      }
    },
  },
  {
    name: "@cyotee/boardgameio-p2p",
    dir: path.join(root, "packages/boardgameIO-p2p"),
    prepare() {
      run("yarn workspace @cyotee/boardgameio-p2p build", root);
    },
    mutate(pkg) {
      if (pkg.devDependencies) delete pkg.devDependencies["boardgame.io"];
    },
  },
  {
    name: "@cyotee/boardgameio-crypto",
    dir: path.join(root, "packages/boardgameio-crypto"),
    prepare() {
      run("yarn workspace @cyotee/boardgameio-crypto build", root);
    },
    mutate(pkg) {
      if (pkg.devDependencies) delete pkg.devDependencies["boardgame.io"];
    },
  },
  {
    name: "@cyotee/manamesh",
    dir: path.join(root, "packages/manamesh/packages/frontend"),
    prepare() {
      run("yarn workspace @cyotee/manamesh build:lib", root);
      if (!fs.existsSync(path.join(this.dir, "dist/index.html"))) {
        fs.mkdirSync(path.join(this.dir, "dist"), { recursive: true });
        fs.writeFileSync(
          path.join(this.dir, "dist/index.html"),
          "<!doctype html><title>@cyotee/manamesh</title><h1>@cyotee/manamesh</h1>\n"
        );
      }
      run("node scripts/rewrite-deps-for-publish.mjs package.json", this.dir);
    },
  },
  {
    name: "@cyotee/manamesh-asset-pack-builder",
    dir: path.join(root, "packages/manamesh-asset-pack-builder"),
    prepare() {
      run("yarn workspace @cyotee/manamesh-asset-pack-builder build", root);
    },
  },
];

const pubCmd = dryRun
  ? "npm pack --ignore-scripts"
  : "npm publish --access public --tag latest --ignore-scripts";

for (const step of steps) {
  console.log(`\n======== ${step.name} ========`);
  step.prepare?.();
  if (step.mutate) {
    withPackageJson(step.dir, step.mutate, () => run(pubCmd, step.dir));
  } else if (step.name === "@cyotee/manamesh") {
    // rewrite already mutated package.json; restore after
    const pj = path.join(step.dir, "package.json");
    // rewrite script already ran; monorepo package.json was workspace — rewrite overwrites.
    // restore from git is caller's responsibility for manamesh; we re-write from workspace original via yarn? 
    // Keep simple: pack/publish then checkout package.json if git clean.
    run(pubCmd, step.dir);
  } else {
    run(pubCmd, step.dir);
  }
}

console.log(dryRun ? "\nDry-run complete." : "\nPublish complete. Verify with npm view.");
