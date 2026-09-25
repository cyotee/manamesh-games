# Registry artifact validation

Run from the manamesh-games root with Yarn 4. The frontend submodule cannot
install or build the complete application independently: its game dependencies
are workspaces in this repository.

```sh
yarn install --immutable
yarn workspace @cyotee/boardgameio-p2p build
yarn build
node scripts/stage-manamesh-release.mjs /tmp/manamesh-release
mkdir /tmp/manamesh-artifacts
npm pack --ignore-scripts --pack-destination /tmp/manamesh-artifacts /tmp/manamesh-release
```

The staging directory must not exist. Staging copies the Timestreams single-file
SPA from root `dist/src/pages/timestreams/index.html`, the frontend library build,
its declarations, CLI and licenses. It rewrites only the staged manifest and
removes repository build hooks. Staging does not rebuild or certify the freshness
of existing outputs; the build steps above are required for release evidence.

The library bundles the checked-out channel transport. Re-exporting the registry
transport at version 0.5.0 reinstated a host-state disclosure that was already
fixed in the workspace. The bundled transport's MIT license is retained as
`TRANSPORT-LICENSE`; generated declarations travel with the implementation.

Install the tarball in a separate directory outside the workspace, then run:

```sh
node scripts/check-manamesh-consumer.mjs /tmp/manamesh-consumer
yarn workspace @cyotee/manamesh exec tsc --noEmit --strict --skipLibCheck --module NodeNext --target ES2022 /tmp/manamesh-consumer/consumer.ts
```

The consumer check imports the installed public API, invokes CLI help, checks
that the SPA is present, rejects a forged host seat and checks guest sync for
host-only data. It writes the TypeScript consumer fixture for the second command.
It does not test browser rendering, asset availability, HTTP serving, or the full
multiplayer protocol. `skipLibCheck` skips third-party declaration internals; the
consumer's exported types and constructor calls are still checked.

The CLI HTTP suite runs the production executable in an isolated package layout:

```sh
node --test packages/manamesh/packages/frontend/scripts/tests/cli.test.mjs
```

Its nine HTTP cases cover literal and encoded traversal, symlink escape,
malformed encoding, missing assets, HTML navigation, MIME types, HEAD and method
rejection. The server binds only to loopback. `--port 0` selects an available port
and prints it. The fixture uses harmless canary files outside `dist`; it does not
read host secrets. This suite validates serving behavior, not SPA rendering.

The root quality workflow performs these steps in a fresh checkout and retains
the tarball only after validation. No registry publication is triggered by that
workflow. The manual release workflow below consumes that artifact; a successful
local consumer check is not evidence of a successful remote release.

## Manual release workflow

`.github/workflows/release-manamesh.yml` replaces the submodule publisher.
Dispatch it on the monorepo's default branch with the exact stable version
already committed in the frontend manifest. It runs the reusable quality
workflow and downloads that run's validated tarball. The publish job checks the
package name, internal version, provenance repository and lifecycle scripts,
then publishes the same tarball with scripts disabled. It does not rebuild,
automatically bump a version, or treat registry errors as successful releases.
Concurrent releases are serialized. The submodule workflow is now a manual
migration notice and no longer publishes on pushes.

External configuration still required and not verified in this session:

- `SUBMODULES_READ_TOKEN` must allow read access to the private submodules.
- The npm package must trust `cyotee/manamesh-games` and the exact workflow file
  `release-manamesh.yml` for publishing. The workflow uses GitHub OIDC and Node
  24; it has no long-lived npm-token fallback. See
  [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
- Package repository metadata must match the publishing repository for
  [npm provenance](https://docs.npmjs.com/generating-provenance-statements/).
  Staging now sets it to the monorepo with the frontend directory recorded.

Local validation: workflow YAML parsed; a real staged tarball passed the identity
check. A wrong requested version and a renamed tarball with a different internal
version both failed. No GitHub workflow was dispatched and no package was
published. These checks do not establish that external OIDC configuration,
repository visibility, registry access or remote CI is working.
