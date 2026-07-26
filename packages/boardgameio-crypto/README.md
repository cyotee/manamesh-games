# @cyotee/boardgameio-crypto

Cryptographic primitives for [boardgame.io](https://boardgame.io/) games — mental poker (SRA), keychain admission, Merkle commitments, threshold ElGamal/DKG, ECDSA, Shamir secret sharing, and optional ZK helpers.

**Package name on npm:** `@cyotee/boardgameio-crypto`  
**Status:** `0.2.x` — Node ESM-ready leaf library. Read [SECURITY.md](./SECURITY.md) before shipping adversarial P2P fairness.

## Install

```bash
npm install @cyotee/boardgameio-crypto
# or
yarn add @cyotee/boardgameio-crypto
```

**Node:** `>=18`  
**Peer (optional):** `boardgame.io` — only required if you use the `/plugin` integration.

### Dependencies (published on npm)

| Dependency | Role | Required when |
|------------|------|----------------|
| [`@noble/curves`](https://www.npmjs.com/package/@noble/curves) | secp256k1 EC ops (SRA, ECDSA, DKG, ECIES) | Always (runtime dep) |
| [`snarkjs`](https://www.npmjs.com/package/snarkjs) | Groth16 verify / range wrappers | Importing `/zk` or `/snarkjs-range` |
| [`boardgame.io`](https://www.npmjs.com/package/boardgame.io) | Game engine types + plugin host | Using `/plugin` only (optional peer) |

All of these are ordinary npm packages — no monorepo-only portals in the published tarball.

## Quick start

```ts
import {
  generateKeyPair,
  encrypt,
  decrypt,
  getCardPoint,
  createKeychain,
  keychainAdd,
  MENTAL_POKER_KEYCHAIN_POLICY,
} from "@cyotee/boardgameio-crypto";

const alice = generateKeyPair();
const bob = generateKeyPair();

// Admit public keys (never private keys) into shared state
let chain = createKeychain();
chain = keychainAdd(chain, "0", alice.publicKey, MENTAL_POKER_KEYCHAIN_POLICY).keychain!;
chain = keychainAdd(chain, "1", bob.publicKey, MENTAL_POKER_KEYCHAIN_POLICY).keychain!;

const cardId = "ace-of-spades";
const layer1 = encrypt(cardId, alice.privateKey); // keep sk client-local
const layer2 = encrypt(layer1, bob.privateKey);

const peelBob = decrypt(layer2, bob.privateKey);
const plain = decrypt(peelBob, alice.privateKey);
console.log(plain.layers === 0, plain.ciphertext === (await getCardPoint(cardId)));
```

## Entry points

| Import | Contents |
|--------|----------|
| `@cyotee/boardgameio-crypto` | Barrel: mental poker, keychain, plugin, hashing, threshold primitives, ECDSA, ZK helpers |
| `@cyotee/boardgameio-crypto/mental-poker` | SRA, commitments, shuffle proofs |
| `@cyotee/boardgameio-crypto/keychain` | Public-key registry + admission policies |
| `@cyotee/boardgameio-crypto/plugin` | boardgame.io crypto plugin |
| `@cyotee/boardgameio-crypto/merkle` | Merkle tree commitments |
| `@cyotee/boardgameio-crypto/secp256k1` | Point/scalar helpers |
| `@cyotee/boardgameio-crypto/ec-elgamal-exp`, `/feldman-dkg`, `/dleq` | Threshold tally primitives |
| `@cyotee/boardgameio-crypto/ecdsa`, `/sha256`, `/stable-json` | Signing + hashing |
| `@cyotee/boardgameio-crypto/shamirs` | Shamir secret sharing + ECIES share wrap |
| `@cyotee/boardgameio-crypto/paillier` | **Demo-only** Paillier HE (insecure parameters) |
| `@cyotee/boardgameio-crypto/zk`, `/snarkjs-range` | snarkjs helpers (artifacts not shipped) |

## Security highlights

1. **Never** put private keys in shared `G` or multiplayer move args — submit ciphertexts / peels only.  
2. Admit public keys via **keychain** (`MENTAL_POKER_KEYCHAIN_POLICY` for multi-party SRA).  
3. Bind encrypt `sk` → published `pk` on the client (`requirePrivateKeyMatchesPublished`).  
4. Shuffle proofs are **commit-and-reveal**, not ZK — see [SECURITY.md](./SECURITY.md).  
5. **`/paillier` is educational only** (128-bit modulus). Do not use for real secrecy.

## Scripts

```bash
yarn workspace @cyotee/boardgameio-crypto test
yarn workspace @cyotee/boardgameio-crypto typecheck
yarn workspace @cyotee/boardgameio-crypto build
yarn workspace @cyotee/boardgameio-crypto pack:check
```

## Publishing (maintainers)

Dependencies are already on the public npm registry. This package publishes as `@cyotee/boardgameio-crypto`.

```bash
# From packages/boardgameio-crypto (or CI workflow)
npm run prepublishOnly   # typecheck + test + build
npm publish --access public
```

CI: `.github/workflows/publish-npm.yml` — tests on push, publishes when the version on npm is new (OIDC provenance preferred).

Version policy: bump `package.json` `version` before publish; see [CHANGELOG.md](./CHANGELOG.md).

## License

MIT — see [LICENSE](./LICENSE).
