# npm Trusted Publishing (GitHub Actions)

Automated publish runs on **successful builds** of `main` / `master` (and `latest` for `boardgameIO-p2p`).

## Repos and workflows

| npm package | GitHub repo | Workflow file | Default branch |
|-------------|-------------|---------------|----------------|
| `@cyotee/boardgame.io` | [cyotee/boardgame.io](https://github.com/cyotee/boardgame.io) | `publish-npm.yml` | `main` |
| `@cyotee/boardgameio-p2p` | [cyotee/boardgameIO-p2p](https://github.com/cyotee/boardgameIO-p2p) | `publish-npm.yml` | `latest` (+ `main`) |
| `@cyotee/boardgameio-crypto` | [cyotee/boardgameio-crypto](https://github.com/cyotee/boardgameio-crypto) | `publish-npm.yml` | `main` |
| `@cyotee/manamesh` | [cyotee/manamesh](https://github.com/cyotee/manamesh) | `publish-npm.yml` | `main` |
| `@cyotee/manamesh-asset-pack-builder` | [cyotee/manamesh-asset-pack-builder](https://github.com/cyotee/manamesh-asset-pack-builder) | `publish-npm.yml` | `main` |
| (all five) | [cyotee/manamesh-games](https://github.com/cyotee/manamesh-games) | `publish-npm.yml` | `main` |

Each workflow:

1. Runs tests (where applicable)
2. Builds the package
3. Publishes **only if** that `name@version` is not already on the registry
4. Uses **OIDC** (`permissions: id-token: write`) and optional `secrets.NPM_TOKEN` fallback

## One-time setup on npmjs.com (required for OIDC)

npm only lets you attach a Trusted Publisher **after the package exists**. Bootstrap once per package (see below), then:

For each package page → **Settings** → **Trusted Publisher**:

| Field | Value |
|-------|--------|
| Provider | GitHub Actions |
| Organization or user | `cyotee` |
| Repository | matching repo name above |
| Workflow filename | `publish-npm.yml` (filename only) |
| Environment | *(leave empty)* |
| Allowed actions | **npm publish** (and optionally stage) |

Use the **package-specific repo** for that package’s trusted publisher, **or** point all five at `manamesh-games` + monorepo `publish-npm.yml` if you prefer a single pipeline.

## Bootstrap (first version)

Today, **first publish** of a new name usually cannot use OIDC until the package exists. Options:

1. **Interactive local publish** once you can authenticate with npm (session login / OTP if required).
2. **`NPM_TOKEN` repo secret** (already set on these repos from your environment). If your token is rejected for direct publish (npm 12 + GAT bypass policy), use option 1 or npm’s staged flow after the package exists.
3. After the first version is on the registry, configure Trusted Publisher and prefer OIDC (you can revoke long-lived write tokens).

## Secrets

| Secret | Where | Purpose |
|--------|--------|---------|
| `NPM_TOKEN` | Each package repo + `manamesh-games` | Fallback auth when OIDC is not configured |

OIDC does **not** need a write token once Trusted Publisher is set.

## Manual re-run

```bash
gh workflow run publish-npm.yml -R cyotee/boardgameio-crypto
gh workflow run "Publish npm packages" -R cyotee/manamesh-games
```

## Verify

```bash
npm view @cyotee/boardgame.io version
npm view @cyotee/boardgameio-p2p version
npm view @cyotee/boardgameio-crypto version
npm view @cyotee/manamesh version
npm view @cyotee/manamesh-asset-pack-builder version
```
