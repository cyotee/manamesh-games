---
name: manamesh-crypto
description: >
  ManaMesh cryptographic primitives overview. Prefer skill boardgameio-crypto for
  current package paths, keychain, and P2P-safe multiplayer patterns. Triggers:
  "ManaMesh crypto", "cryptographic primitives", "SRA", "mental poker", "Merkle",
  "threshold HE", "Shamir", "boardgameio-crypto".
---

# ManaMesh Crypto (index)

**Canonical implementation lives in `@manamesh/boardgameio-crypto`**  
(`packages/boardgameio-crypto/`), **not** under `packages/frontend/src/crypto/` or nested manamesh frontend paths.

## Use this skill first for day-to-day work

→ **`skill:boardgameio-crypto`** (also at `.grok/skills/boardgameio-crypto/SKILL.md`)

That skill covers:

- Keychain + admission policies  
- **Never send private keys in multiplayer moves**  
- Mental-poker encrypt / peel flows  
- Consumer patterns (Poker, Timestreams, Mistborn)  
- Agent anti-patterns  

## Quick map (current)

| Concern | Package / import |
|---------|------------------|
| SRA mental poker | `@manamesh/boardgameio-crypto/mental-poker` |
| Keychain (public keys) | `@manamesh/boardgameio-crypto/keychain` |
| boardgame.io plugin | `@manamesh/boardgameio-crypto/plugin/crypto-plugin` |
| Shamir escrow | `@manamesh/boardgameio-crypto/shamirs` |
| Merkle / Paillier / DKG / DLEQ | same package root / subpaths |

## Tests

```bash
yarn workspace @manamesh/boardgameio-crypto test
```

## See also

- `skill:boardgameio-crypto` — **required reading** for crypto changes  
- `skill:manamesh-game-modules` — game module integration  
- Root `CLAUDE.md` — monorepo layout  
