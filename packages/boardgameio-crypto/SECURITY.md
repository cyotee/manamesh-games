# Security Policy

## Current protocol caveat — 2026-09-05

Primitive correctness does not establish mental-poker privacy. Ordered SRA
encryption passes followed by permutations of unchanged ciphertexts allow
keyless card tracking through the transcript. Completing a private peek in
shared state also exposes its plaintext to the host. Use a reviewed verifiable
rerandomized shuffle, private final decryption and independent rule/proof
verification before claiming malicious-host protection. See the monorepo
[production-readiness investigation](../../docs/production-readiness.md).

The signing serializer now preserves own `__proto__` fields instead of silently
omitting them. Ordinary JSON encodings are unchanged; do not accept old signatures
over messages that relied on that omission.

## Threat model (summary)

`@cyotee/boardgameio-crypto` provides **browser-oriented** cryptographic building blocks for peer-to-peer board/card games. It is **not** a general-purpose hardened cryptography product (e.g. TLS, wallet core, or HSM).

| Component | Status | Notes |
|-----------|--------|--------|
| SRA / mental poker (secp256k1) | **Production-oriented** for honest-but-curious card secrecy | Uses `@noble/curves`. Never put private keys in shared game state. |
| Keychain admission | **Production-oriented** | Validates/normalizes secp256k1 public keys; uniqueness policies. |
| ECDSA (secp256k1) | **Production-oriented** | Compact low-s signatures via `@noble/curves`. |
| Merkle commitments | **Production-oriented** for binding boards | Depends on correct use of leaf encoding by the game. |
| Feldman DKG + EC ElGamal exp + DLEQ | **Production-oriented** for demo thresholds | For small integers (e.g. tally games); not general encryption. |
| Shuffle proofs | **Commit-and-reveal only** | **Not** zero-knowledge. Permutation is revealed post-game. Insufficient alone against fully malicious shufflers without additional protocol checks. |
| Paillier (`/paillier`) | **DEMO ONLY** | Tiny modulus (128-bit). **Do not use for real security.** |
| snarkjs range helpers | **Experimental / incomplete circuit** | Range circuit does not strictly enforce `value ≤ maxValue`. Artifacts (wasm/zkey) are **not** shipped in this package. |
| Shamir SSS + ECIES share wrap | **Usable** with caveats | Field prime and ECIES KDF are fixed wire formats; review before high-value secrets. |

### Hard rules for game authors

1. **Never** put private keys, decryption scalars, or full permutations in shared `G` or multiplayer move args during play.
2. Submit only **ciphertexts**, **peels**, **commitments**, and **public keys** on the wire.
3. Admit public keys via **keychain** (`MENTAL_POKER_KEYCHAIN_POLICY` for multi-party SRA).
4. Bind encrypt `sk` → published `pk` **on the client** before encrypting (`requirePrivateKeyMatchesPublished` / `prepareEncryptionLayer` patterns).
5. `client: false` only selects host execution. Authenticate the sender in moves;
   peers must independently verify rules and cryptographic evidence to protect
   against a malicious host.

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes |
| 0.1.x   | Security fixes only if critical; upgrade to 0.2+ (Node ESM + `@noble/curves`) |

## Reporting a vulnerability

Please open a **private** security advisory on the repository, or email the maintainer listed on npm (`@cyotee/boardgameio-crypto`), with:

- Affected module (e.g. `mental-poker/sra`, `shamirs`, `paillier`)
- Impact (secrecy, integrity, DoS, key recovery)
- Minimal reproduction if possible

Do **not** open a public issue for key-recovery or decryption-bypass bugs until a fix is available.

## Dependencies

- **`@noble/curves`** — primary EC backend (replaces the unmaintained `elliptic` package).
- **`snarkjs`** — optional ZK helpers; only needed if you import `/zk` or `/snarkjs-range`.
- **`boardgame.io`** — **optional peer**; required only for `/plugin` and game-integration helpers.

Keep dependencies updated; pin versions in applications that ship real money or high-stakes fairness guarantees.
