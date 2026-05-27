// Generator for cross-stack parity vectors. Logs viem-produced signatures over
// canonical HandInit / HandOutcome payloads (fixed pk + domain) to bake into
// tests/foundry/integration/CrossStackParity.t.sol. Not a behavioral test.
import { describe, it, expect } from "vitest";
import { getAddress, pad, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  settlerDomain,
  signHandInit,
  signHandOutcome,
  recoverHandInitSigner,
  recoverHandOutcomeSigner,
  type HandOutcome,
} from "./signing";
import type { HandInit } from "./handId";

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const VERIFYING = pad("0xdead", { size: 20 }) as Hex;
const CHAIN_ID = 31337;

const init: HandInit = {
  players: [pad("0xaaa", { size: 20 }) as Hex, pad("0xbbb", { size: 20 }) as Hex],
  buyIns: [100n, 100n],
  vault: pad("0xccc", { size: 20 }) as Hex,
  smallBlind: 1n,
  bigBlind: 2n,
  timeoutSeconds: 300n,
  otherConfig: pad("0x2a", { size: 32 }) as Hex,
  playerHandNonces: [1n, 1n],
};

const outcome: HandOutcome = {
  handId: pad("0x01", { size: 32 }) as Hex,
  pot: 200n,
  winners: [pad("0xaaa", { size: 20 }) as Hex],
  payouts: [195n],
  finalStacks: [195n, 0n],
  finalStateHash: pad("0x02", { size: 32 }) as Hex,
  holeCards: [
    [0xe2, 0xd2],
    [0x23, 0x73],
  ],
  communityCards: [0xc2, 0xb2, 0xa2, 0x20, 0x31],
};

describe("cross-stack parity vectors", () => {
  // Asserts the canonical vectors round-trip in viem; the SAME signatures are
  // baked into tests/foundry/integration/CrossStackParity.t.sol and recovered
  // on-chain, proving the EIP-712 hashing agrees across the stack. To re-bake
  // after changing the vector, temporarily console.log the signatures below.
  it("HandInit + HandOutcome signatures recover the signer", async () => {
    const account = privateKeyToAccount(PK);
    const domain = settlerDomain(CHAIN_ID, VERIFYING);

    const initSig = await signHandInit(account, domain, init);
    expect(await recoverHandInitSigner(domain, init, initSig)).toBe(getAddress(account.address));

    const outcomeSig = await signHandOutcome(account, domain, outcome);
    expect(await recoverHandOutcomeSigner(domain, outcome, outcomeSig)).toBe(getAddress(account.address));
  });
});
