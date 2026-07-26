# Publishing `@cyotee/boardgameio-crypto`

## Dependencies (already on npm)

This package does **not** vendor cryptography. Runtime dependencies are public npm packages:

| Package | Purpose |
|---------|---------|
| [`@noble/curves`](https://www.npmjs.com/package/@noble/curves) | secp256k1 (SRA, ECDSA, DKG, ECIES) |
| [`snarkjs`](https://www.npmjs.com/package/snarkjs) | Optional ZK helpers |

Optional peer:

| Package | Purpose |
|---------|---------|
| [`boardgame.io`](https://www.npmjs.com/package/boardgame.io) | Only for `/plugin` |

You do **not** need to publish these yourself. Consumers resolve them from the registry when they `npm install @cyotee/boardgameio-crypto`.

## Release checklist

1. Update `CHANGELOG.md` and bump `package.json` `version` (semver).
2. From monorepo root (or package dir with npm):

   ```bash
   yarn workspace @cyotee/boardgameio-crypto typecheck
   yarn workspace @cyotee/boardgameio-crypto test
   yarn workspace @cyotee/boardgameio-crypto build
   ```

3. Verify Node ESM:

   ```bash
   yarn workspace @cyotee/boardgameio-crypto node --input-type=module -e \
     "import { generateKeyPair } from './dist/index.js'; console.log(!!generateKeyPair())"
   ```

4. Dry-run pack:

   ```bash
   yarn workspace @cyotee/boardgameio-crypto pack:check
   ```

5. Publish (requires npm auth + rights on `@cyotee` scope):

   ```bash
   cd packages/boardgameio-crypto
   # Remove portal peer for a clean publish (CI does this automatically)
   npm publish --access public
   ```

   Or push to `main` / run the `Publish npm` workflow (OIDC provenance preferred; `NPM_TOKEN` fallback).

6. Verify:

   ```bash
   npm view @cyotee/boardgameio-crypto version
   npm install @cyotee/boardgameio-crypto@<version>
   ```

## Monorepo consumers

In-repo packages depend on `workspace:*`. After a publish they keep using the workspace copy until you intentionally pin a registry version.

## Separate git repo

`package.json` `repository` points at `github.com/cyotee/boardgameio-crypto`. If this tree lives only inside `manamesh-games`, either:

- sync/publish from a dedicated repo, or  
- update `repository` / `homepage` / `bugs` to the monorepo path before the next release.
