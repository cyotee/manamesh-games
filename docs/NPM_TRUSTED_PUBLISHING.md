# npm publishing from GitHub (what actually works)

**`manamesh-games` does not publish.** Only the five package repos do.

## The constraint (why token + “just push” failed)

| Method | Result we hit |
|--------|----------------|
| `NPM_TOKEN` in shell / `~/.zshenv` + `npm publish` | **403** — registry rejects that token for **direct publish** (npm 12 + GAT “bypass 2FA” policy noise) |
| Same token as GitHub Actions `secrets.NPM_TOKEN` | **Same 403** after build (provenance may still be signed; package does not appear) |
| OIDC Trusted Publisher alone on a **new** name | **Impossible** — npm only lets you configure Trusted Publisher **after the package already exists** |

So: **GitHub Actions OIDC is the right long-term path**, but **first version of each package cannot be created by OIDC**.  
And **the write token we have is not a working bootstrap**.

Do **not** rely on “put NPM_TOKEN in GitHub and push.” That path already failed.

---

## Working setup (two phases)

### Phase A — Bootstrap (once per package, **on your machine**, interactive)

This is the only reliable first-publish path when long-lived write tokens fail.

1. **Use browser login** (creates a session credential, not the broken GAT-in-env):

   ```bash
   npm logout   # clear the failing token from this shell’s view of ~/.npmrc if needed
   npm login    # default auth-type is "web" — opens browser, log in as cyotee
   npm whoami   # must print: cyotee
   ```

2. **Publish the first version** of each package (from a clean clone of that package repo, or the monorepo path if you prefer). Example for one package:

   ```bash
   cd /path/to/boardgameio-crypto   # or packages/boardgameio-crypto in monorepo
   npm install
   npm test
   npm run build || true
   # ensure package.json has no private:true, no workspace:/portal: deps
   npm publish --access public
   ```

   Repeat for:

   | Package | Repo |
   |---------|------|
   | `@cyotee/boardgame.io` | https://github.com/cyotee/boardgame.io |
   | `@cyotee/boardgameio-p2p` | https://github.com/cyotee/boardgameIO-p2p |
   | `@cyotee/boardgameio-crypto` | https://github.com/cyotee/boardgameio-crypto |
   | `@cyotee/manamesh` | https://github.com/cyotee/manamesh (`packages/frontend`) |
   | `@cyotee/manamesh-asset-pack-builder` | https://github.com/cyotee/manamesh-asset-pack-builder |

3. Confirm:

   ```bash
   npm view @cyotee/boardgameio-crypto version
   ```

If `npm login` + `npm publish` still fails, fix **account** settings on npmjs.com (2FA / “require 2FA for write”) before anything on GitHub can work. No CI config can bypass that.

---

### Phase B — Ongoing publish from GitHub (OIDC) — **after** Phase A

Workflows already exist: `.github/workflows/publish-npm.yml` on each package repo  
(triggers: successful path on `main` / `master`, and `latest` for p2p).

**For each package that now exists on the registry:**

1. Open  
   `https://www.npmjs.com/package/<full-package-name>/access`  
   (package → access / trusted publishing settings)
2. **Trusted Publisher** → **GitHub Actions**
3. Set **exactly**:

   | Field | Value |
   |-------|--------|
   | Organization or user | `cyotee` |
   | Repository | that package’s repo only (e.g. `boardgameio-crypto`) — **not** `manamesh-games` |
   | Workflow filename | `publish-npm.yml` |
   | Environment | leave empty |
   | Allowed actions | **npm publish** |

4. **Remove** `NPM_TOKEN` from that GitHub repo secrets when OIDC works (optional hygiene). Do **not** expect `NPM_TOKEN` to be the primary path.

5. Day-to-day:

   - Bump `version` in that package’s `package.json`
   - Push to that package repo’s release branch
   - Workflow runs test → build → `npm publish` via **OIDC** (no token)
   - Skips if that version is already published

Manual re-run:

```bash
gh workflow run publish-npm.yml -R cyotee/boardgameio-crypto
```

---

## What is already done on GitHub

- Per-package `publish-npm.yml` with `id-token: write`
- Publish only if version not already on registry
- **Not** publishing from `manamesh-games`

## What is not done (and blocks “push → live package”)

- No package has a successful registry publish yet  
- Trusted Publisher cannot be saved on npm until each name exists  
- `NPM_TOKEN` is not a working bootstrap for this account/token type  

---

## Checklist

- [ ] `npm login` (web) on your machine → `npm whoami` = `cyotee`
- [ ] First `npm publish --access public` for each of the five packages
- [ ] `npm view <name> version` succeeds for each
- [ ] Trusted Publisher on each package → matching repo + `publish-npm.yml`
- [ ] Push a version bump → Actions publish succeeds without relying on `NPM_TOKEN`
