# @manamesh/poker

Texas Hold'em poker module for ManaMesh.

**Current canonical design docs (as of 2026-06):**
- `docs/DESIGN_DOCUMENTS_MAP.md` — single index of all poker design docs
- `docs/PREPAREDNESS_REPORT.md`
- `docs/PRD_Deployment.md`
- `docs/TASK.md`
- `docs/GAME_FLOW_AND_SECURITY.md` — mental poker game flow + security
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

# Solidity
cd packages/poker
forge build
forge test
```
