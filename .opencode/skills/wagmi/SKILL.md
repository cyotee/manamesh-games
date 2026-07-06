---
name: wagmi
description: wagmi, wagmi Core, createConfig, useConfig, useAccount, useConnect, useDisconnect, useBalance, useReadContract, useWriteContract, useSendTransaction, useSignMessage, useSignTypedData, useWaitForTransactionReceipt, useWatchContractEvent, getClient, getConnectorClient, readContract, writeContract, connectors, metaMask, injected, walletConnect, viem, Ethereum wallet integration, React hooks. Triggers: "wagmi", "wagmi Core", "createConfig", "useConfig", "useAccount", "useConnect", "useDisconnect", "useBalance", "useReadContract", "useWriteContract", "useSendTransaction", "useSignMessage", "useSignTypedData", "useWaitForTransactionReceipt", "useWatchContractEvent", "getClient", "wagmi connector", "metaMask", "walletConnect", "viem integration"
triggers:
  - wagmi
  - wagmi Core
  - createConfig
  - useConfig
  - useAccount
  - useConnect
  - useDisconnect
  - useBalance
  - useReadContract
  - useWriteContract
  - useSendTransaction
  - useSignMessage
  - useSignTypedData
  - useWaitForTransactionReceipt
  - useWatchContractEvent
  - getClient
  - getConnectorClient
  - readContract
  - writeContract
  - connectors
  - metaMask connector
  - injected connector
  - walletConnect
  - Ethereum wallet
  - wagmi React hooks
---

# wagmi — React Hooks for Ethereum

wagmi is a React hooks library for Ethereum, built on top of **viem**. It provides typed React hooks for wallet connections, contract interactions, transactions, and ENS resolution.

**Two packages:**

- `@wagmi/core` — Core API (vanilla JS, no React)
- `@wagmi/react` — React hooks (built on `@wagmi/core`)

## Quick Start

### 1. Install

```sh
npm install wagmi viem @wagmi/core @wagmi/react
```

### 2. Create Config

```typescript
import { createConfig, http } from "@wagmi/core";
import { mainnet, sepolia } from "@wagmi/core/chains";

export const config = createConfig({
  chains: [mainnet, sepolia],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
});
```

### 3. Use in React

```tsx
import { useAccount, useConnect, useDisconnect } from "@wagmi/react";
import { config } from "./config";

function App() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    return (
      <div>
        Connected: {address}
        <button onClick={() => disconnect()}>Disconnect</button>
      </div>
    );
  }

  return (
    <div>
      {connectors.map((c) => (
        <button key={c.uid} onClick={() => connect({ connector: c })}>
          Connect {c.name}
        </button>
      ))}
    </div>
  );
}
```

### 4. Wrap with Provider

```tsx
import { WagmiProvider } from "@wagmi/react";
import { config } from "./config";

function App() {
  return (
    <WagmiProvider config={config}>
      <YourApp />
    </WagmiProvider>
  );
}
```

---

## Core API (`@wagmi/core`)

### createConfig

```typescript
import { createConfig, http } from "@wagmi/core";
import { mainnet, sepolia } from "@wagmi/core/chains";

export const config = createConfig({
  // Chains (required)
  chains: [mainnet, sepolia],

  // Transports (required — one per chain)
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http("https://sepolia.rpc.example.com"),
  },

  // Optional:
  multiInjectedProviderDiscovery: true, // EIP-6963 mipd discovery
  ssr: false, // SSR mode
  storage: createStorage({ storage: window.localStorage }),
  syncConnectedChain: true, // sync chainId with connection
  batch: { multicall: true }, // viem multicall batching
  pollingInterval: 4_000, // ms
  cacheTime: 4_000,
});
```

### Config State

```typescript
config.state          // { chainId, connections, current, status }
config.setState(...)  // update state
config.subscribe(selector, listener)  // watch state changes
config.getClient()    // get viem Client for current chain
```

### Core Actions

```typescript
import {
  getClient,
  getConnectorClient,
  readContract,
  writeContract,
} from "@wagmi/core";
import { config } from "./config";

// Get viem Client for current chain
const client = getClient(config);
const clientForChain = getClient(config, { chainId: mainnet.id });

// Get viem Client bound to a connector/account
const walletClient = await getConnectorClient(config, {
  account: "0x...",
  chainId: mainnet.id,
  connector: someConnector,
});

// Read contract (view/pure)
const totalSupply = await readContract(config, {
  address: "0xFBA3912Ca04dd458c843e2EE08967fC04f3579c2",
  abi: wagmiAbi,
  functionName: "totalSupply",
});

// Write contract
const hash = await writeContract(config, {
  address: "0x...",
  abi: wagmiAbi,
  functionName: "mint",
  args: [69420n],
});
```

---

## React Hooks (`@wagmi/react`)

### useAccount

```tsx
import { useAccount } from "@wagmi/react";

const { address, isConnected, isConnecting, status } = useAccount();
// status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting'
```

### useConnect

```tsx
import { useConnect } from '@wagmi/react'

const { connect, connectors, isPending, error } = useConnect()

<button
  onClick={() => connect({ connector: connectors[0] })}
  disabled={isPending}
>
  Connect Wallet
</button>
```

### useDisconnect

```tsx
import { useDisconnect } from '@wagmi/react'

const { disconnect, isPending } = useDisconnect()

<button onClick={() => disconnect()} disabled={isPending}>
  Disconnect
</button>
```

### useBalance

```tsx
import { useBalance } from "@wagmi/react";

const { data: balance, isLoading } = useBalance({
  address: "0x...",
  // or: account: '0x...'  (uses connected account if omitted)
  // chainId: 1,
});
// balance: { value: 1000000000000000000n, decimals: 18, symbol: 'ETH', formatted: '1.0' }
```

### useReadContract

```tsx
import { useReadContract } from "@wagmi/react";

const { data, isLoading, isError } = useReadContract({
  address: "0xFBA3912Ca04dd458c843e2EE08967fC04f3579c2",
  abi: wagmiAbi,
  functionName: "totalSupply",
});
// data is typed based on functionName — no need to cast
```

With args:

```tsx
useReadContract({
  address: "0x...",
  abi: wagmiAbi,
  functionName: "balanceOf",
  args: ["0xd2135CfB216b74109775236E36d4b433F1DF507B"],
});
```

Watch for changes:

```tsx
useReadContract(
  {
    address: "0x...",
    abi: wagmiAbi,
    functionName: "totalSupply",
  },
  {
    watch: true, // re-fetches on new blocks
  },
);
```

### useWriteContract

```tsx
import { useWriteContract } from '@wagmi/react'

const { writeContract, isPending } = useWriteContract()

<button
  onClick={() => writeContract({
    address: '0x...',
    abi: wagmiAbi,
    functionName: 'mint',
    args: [69420n],
  })}
  disabled={isPending}
>
  Mint
</button>
```

Async version (with error handling):

```tsx
const { writeContractAsync, isPending } = useWriteContract()

try {
  const hash = await writeContractAsync({ ... })
} catch (err) {
  // handle error
}
```

### useSendTransaction

```tsx
import { useSendTransaction } from '@wagmi/react'

const { sendTransaction, isPending } = useSendTransaction()

<button
  onClick={() => sendTransaction({
    to: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    value: parseEther('0.01'),
  })}
  disabled={isPending}
>
  Send ETH
</button>
```

### useWaitForTransactionReceipt

```tsx
import { useWaitForTransactionReceipt } from "@wagmi/react";

const {
  isLoading: isConfirming,
  isSuccess,
  receipt,
} = useWaitForTransactionReceipt({
  hash: "0x...", // from writeContract result
});

{
  isConfirming && <p>Confirming...</p>;
}
{
  isSuccess && <p>Confirmed at block {receipt.blockNumber}</p>;
}
```

### useSignMessage

```tsx
import { useSignMessage } from '@wagmi/react'

const { signMessage, isPending } = useSignMessage()

<button
  onClick={() => signMessage({ message: 'hello world' })}
  disabled={isPending}
>
  Sign Message
</button>
```

### useSignTypedData

```tsx
import { useSignTypedData } from "@wagmi/react";

const { signTypedData, isPending } = useSignTypedData();

signTypedData({
  domain: {
    name: "Ether Mail",
    version: "1",
    chainId: 1,
    verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
  },
  types: {
    Person: [
      { name: "name", type: "string" },
      { name: "wallet", type: "address" },
    ],
    Mail: [
      { name: "from", type: "Person" },
      { name: "to", type: "Person" },
      { name: "contents", type: "string" },
    ],
  },
  primaryType: "Mail",
  message: {
    from: { name: "Cow", wallet: "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826" },
    to: { name: "Bob", wallet: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB" },
    contents: "Hello, Bob!",
  },
});
```

### useWatchContractEvent

```tsx
import { useWatchContractEvent } from "@wagmi/react";

useWatchContractEvent({
  address: "0x...",
  abi: wagmiAbi,
  eventName: "Transfer",
  args: { from: "0x...", to: "0x..." }, // optional filter
  onLogs(logs) {
    console.log(logs[0].args.from, logs[0].args.to, logs[0].args.value);
  },
});
```

### useWatchPendingTransactions

```tsx
import { useWatchPendingTransactions } from "@wagmi/react";

useWatchPendingTransactions({
  onTransactions({ transactions, account, chainId }) {
    console.log(`New pending tx from ${account}:`, transactions);
  },
});
```

---

## Connectors (`@wagmi/core`)

```typescript
import { createConfig, http } from "@wagmi/core";
import {
  injected,
  metaMask,
  coinbaseWallet,
  walletConnect,
  ledger,
} from "@wagmi/core/connectors";

export const config = createConfig({
  chains: [mainnet, sepolia],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
  connectors: [
    metaMask(),
    injected(),
    coinbaseWallet({ appName: "My App" }),
    walletConnect({ projectId: "..." }),
    ledger(),
  ],
});
```

### Connector Options

| Connector          | Key Options                                          |
| ------------------ | ---------------------------------------------------- |
| `injected()`       | shimDisconnect, shimChainIdChanged                   |
| `metaMask()`       | shimDisconnect, UNSTABLE_shim_onConnectCountRequired |
| `coinbaseWallet()` | appName, appLogoUrl                                  |
| `walletConnect()`  | projectId, metadata, showQrModal                     |
| `ledger()`         | projectId, shimDisconnect                            |

---

## Provider Setup

```tsx
import { WagmiProvider } from "@wagmi/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "./config";

const queryClient = new QueryClient();

function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <YourApp />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

---

## v1 → v2 Migration

| v1 (deprecated)         | v2                                     |
| ----------------------- | -------------------------------------- |
| `useContractRead`       | `useReadContract`                      |
| `useContractWrite`      | `useWriteContract`                     |
| `useWaitForTransaction` | `useWaitForTransactionReceipt`         |
| `useFeeData`            | `useEstimateFeesPerGas`                |
| `useNetwork`            | removed (use `useAccount` for chainId) |
| `useToken`              | use `useReadContract` + ERC20 ABI      |
| `useAccount`            | now an alias of `useConnection`        |

---

## Key Source Files

| File                                                             | Purpose                    |
| ---------------------------------------------------------------- | -------------------------- |
| `@wagmi/core` packages/core/src/config/createConfig.ts           | createConfig               |
| `@wagmi/core` packages/core/src/actions/readContract.ts          | readContract action        |
| `@wagmi/core` packages/core/src/actions/writeContract.ts         | writeContract action       |
| `@wagmi/react` packages/react/src/hooks/useAccount.ts            | useAccount hook            |
| `@wagmi/react` packages/react/src/hooks/useConnect.ts            | useConnect hook            |
| `@wagmi/react` packages/react/src/hooks/useReadContract.ts       | useReadContract hook       |
| `@wagmi/react` packages/react/src/hooks/useWriteContract.ts      | useWriteContract hook      |
| `@wagmi/react` packages/react/src/hooks/useSignTypedData.ts      | useSignTypedData hook      |
| `@wagmi/react` packages/react/src/hooks/useWatchContractEvent.ts | useWatchContractEvent hook |

## Constraints / Gotchas

1. **`config` must be passed explicitly** — unlike viem clients, wagmi React hooks require a config object (from `createConfig`) passed to `<WagmiProvider>` or `useConfig()`.
2. **QueryClient for React Query** — wagmi uses TanStack Query for data fetching. Wrap with `<QueryClientProvider>`.
3. **Return types are query results** — hooks like `useReadContract` return `{ data, isLoading, isError, refetch, ... }` (TanStack Query style), not raw values.
4. **`isLoading` vs `isFetching`** — `isLoading` means no request has fired yet; `isFetching` means a request is in flight (including refetches).
5. **`writeContract` returns a hash** — `useWriteContract` mutation returns the transaction hash immediately (before confirmation). Use `useWaitForTransactionReceipt` to wait.
6. **Connector shims** — `injected()` and `metaMask()` have `shimDisconnect` to handle wallet-disconnect state bridging. May need configuration in SSR apps.
7. **ChainId must exist in config.chains** — using a `chainId` not in your `chains` array will throw.
8. **Connector order matters** — the first connector in the array is the default. EIP-6963 injects discovered wallets in discovery order.

## ManaMesh Usage

ManaMesh uses viem directly for EIP-712 wallet integration (not wagmi). See `skill:viem` for the viem client setup and `skill:manamesh-contracts` for EIP-712 settlement with GameVault. wagmi is identified as a potential future integration for the frontend UI if a richer wallet connection flow is needed.

## See Also

- `skill:viem` — viem is the underlying client library; wagmi wraps viem
- `skill:manamesh-contracts` — EIP-712 settlement using viem
- `skill:manamesh-assets` — Asset loading (separate from wallet)
- https://wagmi.sh — Official docs
- https://github.com/wevm/wagmi — GitHub (commit 434ddf94)
