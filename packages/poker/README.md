# @manamesh/poker

Texas Hold'em poker module for ManaMesh.

This package houses:

- **Solidity contracts** (`contracts/`) — `PokerHandSettler` Diamond per ERC20
  token, `BettingConfigOracle` Diamond, Level-1 best-5-of-7 verifier facet.
  Built on the Crane framework (ERC2535 Diamond + DFPkg). See the locked PRD
  at `../../manamesh/PRD_CONTRACTS.md` for the full settlement protocol.
- **Foundry tests** (`tests/foundry/`).
- **TypeScript game module** (`src/`) — boardgame.io game definition, betting
  logic, hand evaluation, and the cooperative-decryption flow for mental poker.
- **EIP-712 signing helpers** (`src/signing.ts`, `src/handId.ts`) — pair with
  the on-chain contracts.
- **React board** (`src/components/PokerBoard.tsx`) — depends on
  `@manamesh/frontend` for asset/hook/wallet infrastructure.

## Layout

```
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
