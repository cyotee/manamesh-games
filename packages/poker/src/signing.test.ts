import { describe, it, expect } from "vitest";
import { getAddress, pad, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  settlerDomain,
  signHandInit,
  recoverHandInitSigner,
  signHandOutcome,
  recoverHandOutcomeSigner,
  signRoundStateTransition,
  recoverRoundStateTransitionSigner,
  type HandOutcome,
  type RoundStateTransition,
} from "./signing";
import type { HandInit } from "./handId";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const domain = settlerDomain(31337, pad("0xdead", { size: 20 }) as Hex);

const init: HandInit = {
  players: [getAddress(account.address), pad("0xbbb", { size: 20 }) as Hex],
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
  winners: [getAddress(account.address)],
  payouts: [195n],
  finalStacks: [195n, 0n],
  finalStateHash: pad("0x02", { size: 32 }) as Hex,
  holeCards: [
    [0xe2, 0xd2],
    [0x23, 0x73],
  ],
  communityCards: [0xc2, 0xb2, 0xa2, 0x20, 0x31],
};

const roundState: RoundStateTransition = {
  handId: pad("0x01", { size: 32 }) as Hex,
  roundNumber: 3,
  currentPot: 200n,
  playerStacks: [100n, 100n],
  actionHash: pad("0x03", { size: 32 }) as Hex,
};

describe("EIP-712 signing helpers", () => {
  it("round-trips a HandInit signature", async () => {
    const sig = await signHandInit(account, domain, init);
    expect(await recoverHandInitSigner(domain, init, sig)).toBe(getAddress(account.address));
  });

  it("round-trips a HandOutcome signature (incl. nested card arrays)", async () => {
    const sig = await signHandOutcome(account, domain, outcome);
    expect(await recoverHandOutcomeSigner(domain, outcome, sig)).toBe(getAddress(account.address));
  });

  it("round-trips a RoundStateTransition signature", async () => {
    const sig = await signRoundStateTransition(account, domain, roundState);
    expect(await recoverRoundStateTransitionSigner(domain, roundState, sig)).toBe(getAddress(account.address));
  });

  it("a tampered HandInit recovers a different signer", async () => {
    const sig = await signHandInit(account, domain, init);
    const tampered: HandInit = { ...init, buyIns: [999n, 100n] };
    expect(await recoverHandInitSigner(domain, tampered, sig)).not.toBe(getAddress(account.address));
  });
});
