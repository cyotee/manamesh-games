# @manamesh/poker

Texas Hold'em poker module for ManaMesh.

**Current canonical design docs (as of 2026-06):**
- `docs/DESIGN_DOCUMENTS_MAP.md` — single index of all poker design docs
- `docs/PREPAREDNESS_REPORT.md`
- `docs/PRD_Deployment.md`
- `docs/TASK.md`
- `docs/GAME_FLOW_AND_SECURITY.md` — mental poker game flow + security
- `docs/ADVERSARIAL_TESTS.md` — threat IDs → attack tests (settlement + crypto)
- See also: `../manamesh/PRD_CONTRACTS.md` (locked contracts spec)

**Maintaining alignment:**
- When updating contracts or game flow, update these docs + `PRD_CONTRACTS.md` in the same change.
- Primary sources of truth: this package's docs + `PRD_CONTRACTS.md`.
- Historical/old design references should be annotated with dates and links to current docs.

This package houses:

- **Solidity contracts** (`contracts/`) — `PokerHandSettler` Diamond per ERC20
  token, `BettingConfigOracle` Diamond, Level-1 best-5-of-7 verifier facet.
  Built on the Crane framework (ERC2535 Diamond + DFPkg). See the locked PRD
  at `../manamesh/PRD_CONTRACTS.md` for the full settlement protocol.
- **Foundry tests** (`tests/foundry/`).
- **TypeScript game module** (`src/`) — boardgame.io game definition, betting
  logic, hand evaluation, and the cooperative-decryption flow for mental poker.
- **EIP-712 signing helpers** (`src/signing.ts`, `src/handId.ts`) — pair with
  the on-chain contracts.
- **React board** (`src/components/PokerBoard.tsx`) — depends on
  `@manamesh/frontend` for asset/hook/wallet infrastructure.

## Layout

```
docs/           Design documents (PREPAREDNESS, PRD_Deployment, TASK, GAME_FLOW, historical/)
contracts/      Solidity sources
tests/foundry/  Foundry tests
src/            TypeScript: game module + signing helpers + board
script/         Foundry deployment scripts
lib/            forge-installed dependencies (forge-std, openzeppelin, crane)
```

## Quickstart

```bash
# JavaScript / TypeScript
yarn install                 # at the manamesh-games root
yarn workspace @manamesh/poker test

# Solidity (Crane Diamond + Foundry; solc 0.8.30 / prague)
cd packages/poker
forge build
forge test
```

### Foundry test layout (Crane-aligned)

| Path | Role |
|------|------|
| `tests/foundry/base/TestBase_PokerSystem.sol` | `CraneTest` + production deploy via `PokerDeployLib` |
| `tests/foundry/adversarial/*` | Multi-step attack suite (A1–A14) + deposit/withdraw invariants |
| `tests/foundry/facets/PokerFacets_IFacet.t.sol` | LR-7 `Behavior_IFacet` declaration tests |
| `tests/foundry/settler/*` | Unit harness + edge cases (sorted players, force-timeout) |
| `tests/foundry/integration/*` | Diamond E2E deposit→assert→settle / force-timeout / deploy |
| `tests/foundry/oracle/*` | BettingConfigOracle diamond tests |
| `tests/foundry/verifier/*` | Level-1 hand evaluator + facet |

Run `forge test` from `packages/poker`. Off-chain crypto adversarial: `src/crypto.adversarial.test.ts` (C1–C4). Mental-poker workflow/privacy for **2–5 player tables**: `src/mentalPoker.workflow.test.ts`, `src/mentalPoker.privacy.adversarial.test.ts` (M1–M12).
