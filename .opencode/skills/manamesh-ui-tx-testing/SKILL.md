---
name: manamesh-ui-tx-testing
description: >
  Runs ManaMesh/Poker frontend money-path checks with Playwright injected
  EIP-1193 wallets (not MetaMask) and verifies provider + signing behavior.
  Use when the user asks to "test UI txs", "injected wallet e2e", "Playwright
  connect wallet", "verify settlement UI", "Anvil poker e2e", "programmatic
  wallet", or after wallet/settlement wiring changes. DO NOT use for Foundry
  contract tests alone (crane-testing / forge-testing) or pure P2P crypto tests.
---

# ManaMesh UI transaction testing

Prove the **Vite SPA builds and uses a real wallet provider** by driving the
poker page with an **injected EIP-1193 wallet**, then asserting **connect +
sign** (and later on-chain settle when settler is deployed).

Methodology mirrored from `skill:indexedex-ui-tx-testing`.

## When / when not

| Use | Skip |
|-----|------|
| After wallet / settlement / EIP-712 wiring | Solidity unit tests only |
| Anvil local (31337) connect + personal_sign | Visual-only QA |
| Preparing live `assertHand` / `settleHand` UI | Mental-poker unit tests |

## Default target

| Item | Value |
|------|--------|
| App | `@cyotee/manamesh` Vite SPA |
| Page | `/src/pages/poker/` |
| Port | **3000** |
| Chain id | **31337** (Foundry Anvil) |
| RPC | `http://127.0.0.1:8545` |
| Wallet | Anvil **#0** inject |

## Hard rules

1. **No MetaMask automation** — use `e2e/wallet/injectWallet.ts`.
2. **Pass = provider + address + sign** (and RPC receipt when live settle exists).
3. **E2e toolbar** — `data-testid="e2e-connect-wallet"` / `e2e-wallet-address` (not RainbowKit modal).
4. **Vite env** — webServer sets `VITE_E2E=1` so Anvil chain + toolbar appear.
5. **Do not invent deployed settler addresses** — use env when live settle is ready.

## Quick start

```bash
# Optional: local chain for balance / live settle later
anvil --chain-id 31337

# Install browser once
yarn workspace @cyotee/manamesh test:e2e:install

# Smoke: inject → connect → show address → personal_sign
yarn workspace @cyotee/manamesh test:e2e
# or from monorepo root:
yarn test:e2e:poker
```

Reuse a running dev server:

```bash
VITE_E2E=1 yarn workspace @cyotee/manamesh dev:poker
E2E_SKIP_WEBSERVER=1 yarn workspace @cyotee/manamesh test:e2e
```

## Key files

| Path | Role |
|------|------|
| `packages/manamesh/packages/frontend/e2e/wallet/injectWallet.ts` | EIP-1193 inject (Anvil #0) |
| `packages/manamesh/packages/frontend/e2e/wallet/fixture.ts` | Playwright fixture |
| `packages/manamesh/packages/frontend/e2e/connected-wallet.spec.ts` | Connect + sign smoke |
| `packages/manamesh/packages/frontend/e2e/helpers/connect.ts` | Poker page + connect helpers |
| `packages/manamesh/packages/frontend/e2e/helpers/rpc.ts` | RPC balance / receipt helpers |
| `src/wallet/components/E2eWalletToolbar.tsx` | Programmatic connect UI |
| `src/blockchain/liveFromInjected.ts` | Live settlement from `window.ethereum` |
| `src/wallet/config.ts` | Anvil chain when `VITE_E2E=1` |

## Agent verification loop

```text
1. yarn test:e2e:poker:install (once)
2. yarn test:e2e:poker  (connect smoke — no Anvil required for pure inject)
3. Optional: anvil + cast chain-id
4. Optional live: set VITE_POKER_SETTLER_ADDRESS + VITE_POKER_CHAIN_ID, then
   call tryInstallLiveFromInjected() from page / future live specs
5. Fix UI → re-run → only then claim wallet path done
```

## Env vars

| Var | Purpose |
|-----|---------|
| `VITE_E2E=1` | Enable e2e wallet toolbar + Anvil chain preference |
| `VITE_E2E_CHAIN_ID` / `E2E_CHAIN_ID` | Default 31337 |
| `VITE_E2E_RPC_URL` / `E2E_RPC_URL` | Default http://127.0.0.1:8545 |
| `VITE_POKER_SETTLEMENT_MODE=live` | Live settler mode |
| `VITE_POKER_SETTLER_ADDRESS` | Diamond address |
| `VITE_POKER_CHAIN_ID` | Settler domain chain id |
| `E2E_SKIP_WEBSERVER=1` | Reuse running Vite |

## See also

- `skill:indexedex-ui-tx-testing` — full DTF money-path pattern (bond/swap)
- `skill:ethskills-wallets` — wallet concepts
- `skill:forge-signing` — EIP-712 Foundry signing for contract tests
- `@manamesh/poker` `settlementClient` — assert/settle builders
