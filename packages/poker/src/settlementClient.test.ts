/**
 * S9: Live settlement client with mocked viem-like ports.
 *
 * Covers: assert call shape, settle payload, RPC/user reject (no optimistic
 * credit), missing address map, mock vs live mode switch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAddress, pad, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  LiveSettlementClient,
  buildAssertHandCall,
  buildSettleHandCall,
  prepareSettlementPayload,
  requirePlayerAddresses,
  buildHandInit,
  pokerHandSettlerAbi,
  type SettlementWriteClient,
  type SettlementReadClient,
  type SettlementTableConfig,
} from "./settlementClient";
import { deriveHandId } from "./handId";
import { buildSettlement, type SettleableHandState } from "./handOutcome";
import { settlerDomain, signHandOutcome } from "./signing";
import type { PokerCard } from "./types";

const alice = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const ALICE = getAddress(alice.address);
const BOB = pad("0x01", { size: 20 }) as Hex; // sorts before ALICE
const SETTLER = pad("0xdead", { size: 20 }) as Hex;

function card(rank: string, suit: string): PokerCard {
  return {
    rank,
    suit,
    id: `${suit}-${rank}`,
    name: `${rank} of ${suit}`,
  } as PokerCard;
}

const state: SettleableHandState = {
  players: {
    "0": {
      chips: 200,
      folded: false,
      hand: [card("A", "hearts"), card("K", "hearts")],
    },
    "1": {
      chips: 0,
      folded: true,
      hand: [card("2", "clubs"), card("3", "diamonds")],
    },
  },
  startingChips: { "0": 100, "1": 100 },
  winners: ["0"],
  community: [
    card("Q", "hearts"),
    card("J", "hearts"),
    card("10", "hearts"),
    card("2", "spades"),
    card("3", "spades"),
  ],
};

const table: SettlementTableConfig = {
  chainId: 31337,
  settlerAddress: SETTLER,
  vault: SETTLER,
  smallBlind: 1n,
  bigBlind: 2n,
  timeoutSeconds: 300n,
  otherConfig: pad("0x2a", { size: 32 }) as Hex,
  scale: 1n,
  rakeBps: 250,
};

const addresses = { "0": ALICE, "1": BOB };
const nonces = { "0": 1n, "1": 1n };

describe("requirePlayerAddresses", () => {
  it("returns checksummed addresses when complete", () => {
    const out = requirePlayerAddresses(["0", "1"], addresses);
    expect(out["0"]).toBe(ALICE);
    expect(out["1"]).toBe(getAddress(BOB));
  });

  it("throws a clear error listing missing playerIDs", () => {
    expect(() => requirePlayerAddresses(["0", "1", "2"], addresses)).toThrow(
      /Missing playerID → address mapping for: 2/,
    );
  });

  it("throws when a seat maps to empty string", () => {
    expect(() =>
      requirePlayerAddresses(["0"], { "0": "" as Hex }),
    ).toThrow(/Missing playerID → address mapping for: 0/);
  });
});

describe("prepareSettlementPayload / buildAssertHandCall", () => {
  it("builds assert call with sorted players, matching handId, and settler domain", () => {
    const prepared = prepareSettlementPayload({
      state,
      addresses,
      table,
      playerHandNonces: nonces,
    });

    expect(prepared.handInit.players).toEqual([getAddress(BOB), ALICE]);
    expect(prepared.handInit.buyIns).toEqual([100n, 100n]);
    expect(prepared.handInit.vault).toBe(getAddress(SETTLER));
    expect(prepared.handId).toBe(deriveHandId(prepared.handInit));
    expect(prepared.settlement.outcome.handId).toBe(prepared.handId);
    expect(prepared.domain).toEqual(settlerDomain(31337, SETTLER));
    expect(prepared.domain.name).toBe("PokerHandSettler");
    expect(prepared.domain.chainId).toBe(31337);
    expect(prepared.domain.verifyingContract).toBe(SETTLER);

    const sigs = ["0xaa", "0xbb"] as Hex[];
    const call = buildAssertHandCall(prepared.handInit, sigs, table);
    expect(call.functionName).toBe("assertHandMembership");
    expect(call.address).toBe(getAddress(SETTLER));
    expect(call.abi).toBe(pokerHandSettlerAbi);
    expect(call.args[0]).toBe(prepared.handInit);
    expect(call.args[1]).toEqual(sigs);
    expect(call.handId).toBe(prepared.handId);
  });

  it("rejects assert when signature count mismatches players", () => {
    const prepared = prepareSettlementPayload({
      state,
      addresses,
      table,
      playerHandNonces: nonces,
    });
    expect(() => buildAssertHandCall(prepared.handInit, ["0xaa"] as Hex[], table)).toThrow(
      /signatures length/,
    );
  });
});

describe("buildSettleHandCall uses settlement payload", () => {
  it("wires settleHand args from buildSettlement + HandInit + EIP-712 domain", async () => {
    const prepared = prepareSettlementPayload({
      state,
      addresses,
      table,
      playerHandNonces: nonces,
    });

    // Alice is the only winner — produce a real EIP-712 sig for shape confidence
    const winSig = await signHandOutcome(alice, prepared.domain, prepared.settlement.outcome);
    const call = buildSettleHandCall({
      handInit: prepared.handInit,
      settlement: prepared.settlement,
      winnerSignatures: [winSig],
      table,
    });

    expect(call.functionName).toBe("settleHand");
    expect(call.args[0]).toEqual(prepared.handInit);
    expect(call.args[1]).toEqual(prepared.settlement.outcome);
    expect(call.args[2]).toEqual([winSig]);
    expect(call.settlement.outcome.winners).toEqual([ALICE]);
    expect(call.domain.verifyingContract).toBe(SETTLER);
    expect(call.domain.chainId).toBe(31337);

    // Conservation still holds in the payload
    const o = call.settlement.outcome;
    const rake = (o.pot * 250n) / 10_000n;
    expect(o.finalStacks.reduce((a, b) => a + b, 0n) + rake).toBe(o.pot);
  });

  it("rejects settle when outcome.handId does not match init", () => {
    const prepared = prepareSettlementPayload({
      state,
      addresses,
      table,
      playerHandNonces: nonces,
    });
    const bad = {
      ...prepared.settlement,
      outcome: {
        ...prepared.settlement.outcome,
        handId: pad("0xff", { size: 32 }) as Hex,
      },
    };
    expect(() =>
      buildSettleHandCall({
        handInit: prepared.handInit,
        settlement: bad,
        winnerSignatures: ["0x01"] as Hex[],
        table,
      }),
    ).toThrow(/outcome.handId/);
  });
});

describe("LiveSettlementClient with mocked viem ports", () => {
  let write: SettlementWriteClient;
  let read: SettlementReadClient;
  let writeMock: ReturnType<typeof vi.fn>;
  let readMock: ReturnType<typeof vi.fn>;
  let client: LiveSettlementClient;

  // On-chain vault ledger simulation (address → balance)
  let chainBalances: Map<string, bigint>;

  beforeEach(() => {
    chainBalances = new Map([
      [ALICE.toLowerCase(), 1000n],
      [getAddress(BOB).toLowerCase(), 1000n],
    ]);

    writeMock = vi.fn(async (args: { functionName: string; args: readonly unknown[] }) => {
      if (args.functionName === "assertHandMembership") {
        return pad("0xassert", { size: 32 }) as Hex;
      }
      if (args.functionName === "settleHand") {
        // Simulate vault credit only when write succeeds
        const outcome = args.args[1] as { finalStacks: bigint[] };
        const init = args.args[0] as { players: Hex[]; buyIns: bigint[] };
        for (let i = 0; i < init.players.length; i++) {
          const key = getAddress(init.players[i]).toLowerCase();
          const prev = chainBalances.get(key) ?? 0n;
          // simplified: set free balance to prior - buyIn + finalStack relative to fixture
          chainBalances.set(key, prev - init.buyIns[i] + outcome.finalStacks[i]);
        }
        return pad("0xsettle", { size: 32 }) as Hex;
      }
      throw new Error(`unexpected write ${args.functionName}`);
    });

    readMock = vi.fn(async (args: { functionName: string; args: readonly unknown[] }) => {
      if (args.functionName === "balanceOf") {
        const addr = getAddress(args.args[0] as Hex).toLowerCase();
        return chainBalances.get(addr) ?? 0n;
      }
      throw new Error(`unexpected read ${args.functionName}`);
    });

    write = { writeContract: writeMock };
    read = { readContract: readMock };

    client = new LiveSettlementClient({
      write,
      read,
      table,
      playerAddresses: addresses,
    });
  });

  it("assertHandMembership builds correct flow / calls writeContract", async () => {
    const prepared = client.prepareFromState(state, nonces);
    const sigs = ["0x11", "0x22"] as Hex[];
    const result = await client.assertHandMembership(prepared.handInit, sigs);

    expect(result.success).toBe(true);
    expect(result.txHash).toBeDefined();
    expect(writeMock).toHaveBeenCalledTimes(1);
    const call = writeMock.mock.calls[0][0];
    expect(call.functionName).toBe("assertHandMembership");
    expect(call.address).toBe(getAddress(SETTLER));
    expect(call.abi).toBe(pokerHandSettlerAbi);
    expect(call.args[0].players).toEqual([getAddress(BOB), ALICE]);
    expect(call.args[1]).toEqual(sigs);
  });

  it("settleFromState uses settlement payload and updates confirmed balances only after success", async () => {
    const prepared = client.prepareFromState(state, nonces);
    const winSig = await signHandOutcome(alice, client.domain, prepared.settlement.outcome);

    expect(client.getConfirmedBalances()).toBeNull();

    const result = await client.settleFromState({
      state,
      playerHandNonces: nonces,
      winnerSignatures: [winSig],
    });

    expect(result.success).toBe(true);
    expect(result.txHash).toBeDefined();
    expect(result.settlement?.outcome.winners).toEqual([ALICE]);

    const settleCall = writeMock.mock.calls.find(
      (c) => c[0].functionName === "settleHand",
    );
    expect(settleCall).toBeDefined();
    expect(settleCall![0].args[1].handId).toBe(prepared.handId);
    expect(settleCall![0].args[1].finalStacks).toEqual(
      prepared.settlement.outcome.finalStacks,
    );

    const confirmed = client.getConfirmedBalances();
    expect(confirmed).not.toBeNull();
    // After settle: alice 1000-100+195=1095, bob 1000-100+0=900
    expect(confirmed!["0"]).toBe(1095);
    expect(confirmed!["1"]).toBe(900);
  });

  it("RPC / user reject does not mutate confirmed balances (no double-credit)", async () => {
    // Seed a prior confirmed snapshot
    (client as unknown as { confirmedBalances: Record<string, number> }).confirmedBalances = {
      "0": 500,
      "1": 500,
    };

    writeMock.mockRejectedValueOnce(new Error("User rejected the request"));

    const prepared = client.prepareFromState(state, nonces);
    const result = await client.settleHand(prepared.handInit, prepared.settlement, [
      "0xdead" as Hex,
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/User rejected/);
    expect(result.txHash).toBeUndefined();

    // Prior balances retained — no optimistic credit
    expect(client.getConfirmedBalances()).toEqual({ "0": 500, "1": 500 });

    // Chain ledger unchanged (write never applied)
    expect(chainBalances.get(ALICE.toLowerCase())).toBe(1000n);
  });

  it("assert RPC failure returns error without success flag", async () => {
    writeMock.mockRejectedValueOnce(new Error("network down"));
    const prepared = client.prepareFromState(state, nonces);
    const result = await client.assertHandMembership(prepared.handInit, [
      "0x11",
      "0x22",
    ] as Hex[]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/network down/);
    expect(client.getConfirmedBalances()).toBeNull();
  });

  it("missing address map errors clearly on prepare and getPlayerAddress", () => {
    const incomplete = new LiveSettlementClient({
      write,
      read,
      table,
      playerAddresses: { "0": ALICE },
    });
    expect(() => incomplete.prepareFromState(state, nonces)).toThrow(
      /Missing playerID → address mapping for: 1/,
    );
    expect(() => incomplete.getPlayerAddress("1")).toThrow(
      /Missing playerID → address mapping for: 1/,
    );
  });

  it("getBalance reads via injected public client", async () => {
    const bal = await client.getBalance(ALICE);
    expect(bal).toBe(1000n);
    expect(readMock).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "balanceOf",
        args: [ALICE],
      }),
    );
  });

  it("mode is live", () => {
    expect(client.mode).toBe("live");
  });
});

describe("mock vs live mode switch — no double-credit", () => {
  /**
   * Lightweight dual-path harness mirroring frontend factory behavior:
   * mock mutates local ledger; live only mutates after successful write.
   */
  it("switching to live does not re-apply mock credits, and live reject leaves mock ledger alone", async () => {
    // --- mock path ---
    const mockBalances: Record<string, number> = { "0": 1000, "1": 1000 };
    const mockSettle = (payouts: Record<string, number>, contributions: Record<string, number>) => {
      for (const [id, c] of Object.entries(contributions)) {
        mockBalances[id] = (mockBalances[id] ?? 0) - c;
      }
      for (const [id, p] of Object.entries(payouts)) {
        mockBalances[id] = (mockBalances[id] ?? 0) + p;
      }
    };

    mockSettle({ "0": 200, "1": 0 }, { "0": 100, "1": 100 });
    expect(mockBalances).toEqual({ "0": 1100, "1": 900 });

    // --- switch to live with separate chain ledger ---
    const chainBalances = new Map([
      [ALICE.toLowerCase(), 1000n],
      [getAddress(BOB).toLowerCase(), 1000n],
    ]);

    const writeMock = vi.fn(async () => {
      throw new Error("User rejected the request");
    });
    const readMock = vi.fn(async (args: { args: readonly unknown[] }) => {
      const addr = getAddress(args.args[0] as Hex).toLowerCase();
      return chainBalances.get(addr) ?? 0n;
    });

    const live = new LiveSettlementClient({
      write: { writeContract: writeMock },
      read: { readContract: readMock },
      table,
      playerAddresses: addresses,
    });

    const prepared = live.prepareFromState(state, nonces);
    const liveResult = await live.settleHand(prepared.handInit, prepared.settlement, [
      "0x00" as Hex,
    ]);

    expect(liveResult.success).toBe(false);
    // Live reject must not touch mock ledger
    expect(mockBalances).toEqual({ "0": 1100, "1": 900 });
    // Chain unchanged
    expect(chainBalances.get(ALICE.toLowerCase())).toBe(1000n);
    expect(live.getConfirmedBalances()).toBeNull();

    // Successful live settle credits chain only once
    writeMock.mockImplementationOnce(async (args: { args: readonly unknown[] }) => {
      const outcome = args.args[1] as { finalStacks: bigint[] };
      const init = args.args[0] as { players: Hex[]; buyIns: bigint[] };
      for (let i = 0; i < init.players.length; i++) {
        const key = getAddress(init.players[i]).toLowerCase();
        const prev = chainBalances.get(key) ?? 0n;
        chainBalances.set(key, prev - init.buyIns[i] + outcome.finalStacks[i]);
      }
      return pad("0xok", { size: 32 }) as Hex;
    });

    const ok = await live.settleHand(prepared.handInit, prepared.settlement, [
      "0x01" as Hex,
    ]);
    expect(ok.success).toBe(true);
    // Mock ledger still the mock-settled values (no double-apply of live)
    expect(mockBalances).toEqual({ "0": 1100, "1": 900 });
    expect(live.getConfirmedBalances()?.["0"]).toBe(1095);
  });
});

describe("buildHandInit", () => {
  it("validates parallel array lengths", () => {
    expect(() =>
      buildHandInit({
        players: [ALICE],
        buyIns: [1n, 2n],
        vault: SETTLER,
        smallBlind: 1n,
        bigBlind: 2n,
        timeoutSeconds: 1n,
        playerHandNonces: [1n],
      }),
    ).toThrow(/buyIns length/);
  });
});

describe("buildSettlement integration (addresses required)", () => {
  it("prepareSettlementPayload fails without full address map before chain call", () => {
    expect(() =>
      prepareSettlementPayload({
        state,
        addresses: { "0": ALICE },
        table,
        playerHandNonces: nonces,
      }),
    ).toThrow(/Missing playerID → address mapping/);
  });

  it("matches buildSettlement sorted players for the same state", () => {
    const prepared = prepareSettlementPayload({
      state,
      addresses,
      table,
      playerHandNonces: nonces,
    });
    const direct = buildSettlement(state, {
      addresses,
      handId: prepared.handId,
      rakeBps: table.rakeBps,
      scale: table.scale,
    });
    expect(prepared.settlement.players).toEqual(direct.players);
    expect(prepared.settlement.outcome.finalStacks).toEqual(direct.outcome.finalStacks);
  });
});
