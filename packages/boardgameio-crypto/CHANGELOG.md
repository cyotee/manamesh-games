# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-07-22

### Breaking

- **Node ESM is now fixed and required**: published `dist/` uses explicit `.js` file paths. Native `import '@cyotee/boardgameio-crypto'` works under Node without a bundler.
- **Removed `elliptic` dependency** in favor of **`@noble/curves`** (secp256k1).
- Removed the elliptic-style `secp256k1` EC instance export. Use named helpers (`secpPointMulHex`, `secpPublicKeyFromPrivateHex`, …) or `nobleSecp256k1` / `SecpProjectivePoint`.
- **`hashToPoint(cardId)`** now returns a **compressed point hex string** (not an elliptic Point object). Use `getCardPoint` for the async form, or `secpPointNormalizeHex` if you already have hex.
- **SRA / ECDSA public keys** from key generators are **compressed** hex (still accepted when callers pass uncompressed keys into normalize/encrypt paths).
- Private keys from generators are always **32-byte (64 hex char)** padded.

### Added

- `SECURITY.md` threat model and reporting guidance.
- `CHANGELOG.md`, package `keywords`, `engines`, `sideEffects`, optional `boardgame.io` peer metadata.
- Strict TypeScript build (`noEmitOnError`, `strict`) and `typecheck` script.
- Node-native ESM verification as part of publish readiness.

### Fixed

- Main and subpath entry points no longer throw `ERR_UNSUPPORTED_DIR_IMPORT` under Node ESM.
- Build no longer succeeds when `tsc` fails (`|| test -f dist` removed).
- LICENSE copyright corrected to package authors (was incorrectly attributed to boardgame.io).

### Security

- Migrated EC operations off the unmaintained `elliptic` package to `@noble/curves`.
- Documented demo-only Paillier and non-ZK shuffle proofs (see `SECURITY.md`).

### Notes for monorepo consumers

- Wire formats for SRA ciphertexts, card hash-to-point, ECDSA compact signatures, and Shamir ECIES envelopes remain **compatible** with 0.1.x for the same scalars/points.
- If you called `hashToPoint(...).encode(...)`, switch to the hex string return value.

## [0.1.0] — 2026-07-18

### Added

- Initial public extract: mental poker (SRA), keychain, crypto plugin, Merkle, threshold tally primitives, Paillier demo, Shamir SSS, snarkjs helpers.
