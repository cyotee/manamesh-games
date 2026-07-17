/**
 * Settlement client helpers for PokerHandSettler (assert + settle).
 *
 * Pure builders + a thin live adapter that accepts injected viem-like ports so
 * unit tests can mock RPC without a real network. No optimistic local balance
 * mutation: balances are only re-read after a confirmed write (or left unset
 * on failure).
 *
 * S9 / US-PD.1.1 — production residual: real wallet connect, deployed addresses,
 * and App.tsx wiring remain outside this module.
 */

import { getAddress, type Abi, type Hex, type TypedDataDomain } from "viem";
import { deriveHandId, type HandInit } from "./handId";
import {
  buildSettlement,
  type BuildHandOutcomeOptions,
  type BuiltSettlement,
  type SettleableHandState,
} from "./handOutcome";
import { settlerDomain, type HandOutcome } from "./signing";

// ---------------------------------------------------------------------------
// Minimal settler ABI (assert / settle / balanceOf)
// ---------------------------------------------------------------------------

const handInitComponents = [
  { name: "players", type: "address[]" },
  { name: "buyIns", type: "uint256[]" },
  { name: "vault", type: "address" },
  { name: "smallBlind", type: "uint256" },
  { name: "bigBlind", type: "uint256" },
  { name: "timeoutSeconds", type: "uint256" },
  { name: "otherConfig", type: "bytes32" },
  { name: "playerHandNonces", type: "uint256[]" },
] as const;

const handOutcomeComponents = [
  { name: "handId", type: "bytes32" },
  { name: "pot", type: "uint256" },
  { name: "winners", type: "address[]" },
  { name: "payouts", type: "uint256[]" },
  { name: "finalStacks", type: "uint256[]" },
  { name: "finalStateHash", type: "bytes32" },
  { name: "holeCards", type: "uint8[2][]" },
  { name: "communityCards", type: "uint8[5]" },
] as const;

/** Minimal ABI for PokerHandSettler assert/settle/balance paths. */
export const pokerHandSettlerAbi = [
  {
    type: "function",
    name: "assertHandMembership",
    stateMutability: "nonpayable",
    inputs: [
      { name: "init", type: "tuple", components: [...handInitComponents] },
      { name: "signatures", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settleHand",
    stateMutability: "nonpayable",
    inputs: [
      { name: "init", type: "tuple", components: [...handInitComponents] },
      { name: "outcome", type: "tuple", components: [...handOutcomeComponents] },
      { name: "winnerSignatures", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const satisfies Abi;

// ---------------------------------------------------------------------------
// Injected ports (viem-compatible shape)
// ---------------------------------------------------------------------------

export interface SettlementWriteArgs {
  address: Hex;
  abi: typeof pokerHandSettlerAbi;
  functionName: "assertHandMembership" | "settleHand";
  args: readonly unknown[];
  account?: Hex;
}

/** Write port — typically viem `WalletClient.writeContract`. */
export interface SettlementWriteClient {
  writeContract(args: SettlementWriteArgs): Promise<Hex>;
}

export interface SettlementReadArgs {
  address: Hex;
  abi: typeof pokerHandSettlerAbi;
  functionName: "balanceOf";
  args: readonly unknown[];
}

/** Read port — typically viem `PublicClient.readContract`. */
export interface SettlementReadClient {
  readContract(args: SettlementReadArgs): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Config + results
// ---------------------------------------------------------------------------

export type SettlementClientMode = "mock" | "live";

export interface SettlementTableConfig {
  /** EIP-712 chain id (must match settler domain). */
  chainId: number;
  /** PokerHandSettler verifying contract / diamond address. */
  settlerAddress: Hex;
  /** HandInit.vault — usually the settler address. */
  vault: Hex;
  smallBlind: bigint;
  bigBlind: bigint;
  timeoutSeconds: bigint;
  /** Opaque HandInit.otherConfig (defaults to zero). */
  otherConfig?: Hex;
  /** Game chips → token base units (default 1n). */
  scale?: bigint;
  /** Rake bps for buildSettlement (must match oracle at settle time for conservation). */
  rakeBps: number;
}

export interface TxCallResult {
  success: boolean;
  txHash?: Hex;
  error?: string;
  /** On-chain vault balances (address → amount) only after confirmed success. */
  balancesByAddress?: Record<Hex, bigint>;
}

export interface AssertHandCall {
  functionName: "assertHandMembership";
  address: Hex;
  abi: typeof pokerHandSettlerAbi;
  args: readonly [HandInit, readonly Hex[]];
  domain: TypedDataDomain;
  handId: Hex;
}

export interface SettleHandCall {
  functionName: "settleHand";
  address: Hex;
  abi: typeof pokerHandSettlerAbi;
  args: readonly [HandInit, HandOutcome, readonly Hex[]];
  domain: TypedDataDomain;
  handId: Hex;
  settlement: BuiltSettlement;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const ZERO_BYTES32 = ("0x" + "00".repeat(32)) as Hex;

/**
 * Require a complete playerID → address map. Throws a clear error listing
 * missing seat IDs (S9 case: missing address map).
 */
export function requirePlayerAddresses(
  playerIds: readonly string[],
  addresses: Record<string, Hex>,
): Record<string, Hex> {
  const missing = playerIds.filter((id) => {
    const a = addresses[id];
    return a === undefined || a === null || a === ("" as Hex);
  });
  if (missing.length > 0) {
    throw new Error(
      `Missing playerID → address mapping for: ${missing.join(", ")}. ` +
        `Provide addresses for all seats before assert/settle.`,
    );
  }
  const normalized: Record<string, Hex> = {};
  for (const id of playerIds) {
    normalized[id] = getAddress(addresses[id]!);
  }
  return normalized;
}

/**
 * Build HandInit from sorted players/buyIns (e.g. from BuiltSettlement) plus
 * table config and per-player nonces (parallel to sorted players).
 */
export function buildHandInit(params: {
  players: readonly Hex[];
  buyIns: readonly bigint[];
  vault: Hex;
  smallBlind: bigint;
  bigBlind: bigint;
  timeoutSeconds: bigint;
  otherConfig?: Hex;
  playerHandNonces: readonly bigint[];
}): HandInit {
  if (params.players.length !== params.buyIns.length) {
    throw new Error(
      `HandInit players/buyIns length mismatch: ${params.players.length} vs ${params.buyIns.length}`,
    );
  }
  if (params.players.length !== params.playerHandNonces.length) {
    throw new Error(
      `HandInit players/playerHandNonces length mismatch: ${params.players.length} vs ${params.playerHandNonces.length}`,
    );
  }
  return {
    players: params.players.map((p) => getAddress(p)),
    buyIns: [...params.buyIns],
    vault: getAddress(params.vault),
    smallBlind: params.smallBlind,
    bigBlind: params.bigBlind,
    timeoutSeconds: params.timeoutSeconds,
    otherConfig: params.otherConfig ?? ZERO_BYTES32,
    playerHandNonces: [...params.playerHandNonces],
  };
}

/**
 * Map seat nonces (playerID-keyed) onto address-sorted players.
 */
export function noncesForSortedPlayers(
  sortedPlayers: readonly Hex[],
  playerIds: readonly string[],
  addresses: Record<string, Hex>,
  noncesByPlayerId: Record<string, bigint>,
): bigint[] {
  const addrToId = new Map<string, string>();
  for (const id of playerIds) {
    addrToId.set(getAddress(addresses[id]!).toLowerCase(), id);
  }
  return sortedPlayers.map((addr) => {
    const id = addrToId.get(getAddress(addr).toLowerCase());
    if (!id) {
      throw new Error(`No playerID for sorted address ${addr}`);
    }
    const n = noncesByPlayerId[id];
    if (n === undefined) {
      throw new Error(`Missing hand nonce for player "${id}"`);
    }
    return n;
  });
}

/**
 * Build settlement + matching HandInit + EIP-712 domain from finished game state.
 */
export function prepareSettlementPayload(params: {
  state: SettleableHandState;
  addresses: Record<string, Hex>;
  table: SettlementTableConfig;
  playerHandNonces: Record<string, bigint>;
  /** Override handId (must match deriveHandId(init)); if omitted, derived from init. */
  handId?: Hex;
  finalStateHash?: Hex;
}): {
  settlement: BuiltSettlement;
  handInit: HandInit;
  handId: Hex;
  domain: TypedDataDomain;
  addresses: Record<string, Hex>;
} {
  const playerIds = Object.keys(params.state.players);
  const addresses = requirePlayerAddresses(playerIds, params.addresses);

  // First pass: build settlement with a provisional handId if needed so we get
  // sorted players/buyIns; then build init and re-run with derived handId when
  // caller did not supply one (handId enters finalStateHash commitment).
  const provisionalHandId =
    params.handId ?? (("0x" + "11".repeat(32)) as Hex);

  const buildOpts: BuildHandOutcomeOptions = {
    addresses,
    handId: provisionalHandId,
    rakeBps: params.table.rakeBps,
    scale: params.table.scale,
    finalStateHash: params.finalStateHash,
  };

  let settlement = buildSettlement(params.state, buildOpts);
  const playerHandNonces = noncesForSortedPlayers(
    settlement.players,
    playerIds,
    addresses,
    params.playerHandNonces,
  );

  const handInit = buildHandInit({
    players: settlement.players,
    buyIns: settlement.buyIns,
    vault: params.table.vault,
    smallBlind: params.table.smallBlind,
    bigBlind: params.table.bigBlind,
    timeoutSeconds: params.table.timeoutSeconds,
    otherConfig: params.table.otherConfig,
    playerHandNonces,
  });

  const handId = params.handId ?? deriveHandId(handInit);

  // Rebuild with the real handId so outcome.handId + finalStateHash match chain.
  if (handId !== provisionalHandId || !params.finalStateHash) {
    settlement = buildSettlement(params.state, {
      ...buildOpts,
      handId,
      finalStateHash: params.finalStateHash,
    });
  }

  const domain = settlerDomain(params.table.chainId, params.table.settlerAddress);

  return { settlement, handInit, handId, domain, addresses };
}

/** Build assertHandMembership write args (does not send). */
export function buildAssertHandCall(
  handInit: HandInit,
  signatures: readonly Hex[],
  table: SettlementTableConfig,
): AssertHandCall {
  if (signatures.length !== handInit.players.length) {
    throw new Error(
      `assertHandMembership: signatures length ${signatures.length} != players ${handInit.players.length}`,
    );
  }
  const handId = deriveHandId(handInit);
  return {
    functionName: "assertHandMembership",
    address: getAddress(table.settlerAddress),
    abi: pokerHandSettlerAbi,
    args: [handInit, signatures],
    domain: settlerDomain(table.chainId, table.settlerAddress),
    handId,
  };
}

/** Build settleHand write args from pre-built settlement + init (does not send). */
export function buildSettleHandCall(params: {
  handInit: HandInit;
  settlement: BuiltSettlement;
  winnerSignatures: readonly Hex[];
  table: SettlementTableConfig;
}): SettleHandCall {
  const { handInit, settlement, winnerSignatures, table } = params;
  if (winnerSignatures.length !== settlement.outcome.winners.length) {
    throw new Error(
      `settleHand: winnerSignatures length ${winnerSignatures.length} != winners ${settlement.outcome.winners.length}`,
    );
  }
  const handId = deriveHandId(handInit);
  if (settlement.outcome.handId.toLowerCase() !== handId.toLowerCase()) {
    throw new Error(
      `settleHand: outcome.handId ${settlement.outcome.handId} != deriveHandId(init) ${handId}`,
    );
  }
  return {
    functionName: "settleHand",
    address: getAddress(table.settlerAddress),
    abi: pokerHandSettlerAbi,
    args: [handInit, settlement.outcome, winnerSignatures],
    domain: settlerDomain(table.chainId, table.settlerAddress),
    handId,
    settlement,
  };
}

// ---------------------------------------------------------------------------
// Live settlement client (injected clients)
// ---------------------------------------------------------------------------

export interface LiveSettlementClientOptions {
  write: SettlementWriteClient;
  read: SettlementReadClient;
  table: SettlementTableConfig;
  /**
   * playerID → address map. Required for seat-keyed balance reads and
   * prepareSettlement / settleFromState.
   */
  playerAddresses: Record<string, Hex>;
  /** Optional account for writeContract. */
  account?: Hex;
}

/**
 * Live on-chain settlement adapter. Uses injected write/read clients so tests
 * mock viem without RPC. Never credits local mock state.
 */
export class LiveSettlementClient {
  readonly mode: SettlementClientMode = "live";

  private readonly write: SettlementWriteClient;
  private readonly read: SettlementReadClient;
  private readonly table: SettlementTableConfig;
  private playerAddresses: Record<string, Hex>;
  private readonly account?: Hex;

  /** Optional cache of last *confirmed* balances by playerId — only set after success. */
  private confirmedBalances: Record<string, number> | null = null;

  constructor(opts: LiveSettlementClientOptions) {
    this.write = opts.write;
    this.read = opts.read;
    this.table = opts.table;
    this.playerAddresses = { ...opts.playerAddresses };
    this.account = opts.account;
  }

  get domain(): TypedDataDomain {
    return settlerDomain(this.table.chainId, this.table.settlerAddress);
  }

  getTableConfig(): SettlementTableConfig {
    return this.table;
  }

  setPlayerAddresses(addresses: Record<string, Hex>): void {
    this.playerAddresses = { ...addresses };
  }

  getPlayerAddress(playerId: string): Hex {
    const addr = this.playerAddresses[playerId];
    if (!addr) {
      throw new Error(
        `Missing playerID → address mapping for: ${playerId}. ` +
          `Provide addresses for all seats before assert/settle.`,
      );
    }
    return getAddress(addr);
  }

  /** Last confirmed chip balances after a successful settle (game-unit if scale applied). */
  getConfirmedBalances(): Record<string, number> | null {
    return this.confirmedBalances ? { ...this.confirmedBalances } : null;
  }

  prepareFromState(
    state: SettleableHandState,
    playerHandNonces: Record<string, bigint>,
    handId?: Hex,
  ) {
    return prepareSettlementPayload({
      state,
      addresses: this.playerAddresses,
      table: this.table,
      playerHandNonces,
      handId,
    });
  }

  /**
   * Submit assertHandMembership. On RPC/user reject, does not update
   * confirmedBalances.
   */
  async assertHandMembership(
    handInit: HandInit,
    signatures: readonly Hex[],
  ): Promise<TxCallResult> {
    let call: AssertHandCall;
    try {
      call = buildAssertHandCall(handInit, signatures, this.table);
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }

    try {
      const txHash = await this.write.writeContract({
        address: call.address,
        abi: call.abi,
        functionName: "assertHandMembership",
        args: call.args,
        account: this.account,
      });
      return { success: true, txHash };
    } catch (e) {
      // User reject / RPC failure — no local credit
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * Submit settleHand with a pre-built outcome. On failure, confirmedBalances
   * is left unchanged (no optimistic double-credit).
   */
  async settleHand(
    handInit: HandInit,
    settlement: BuiltSettlement,
    winnerSignatures: readonly Hex[],
  ): Promise<TxCallResult> {
    const prior = this.confirmedBalances;
    let call: SettleHandCall;
    try {
      call = buildSettleHandCall({
        handInit,
        settlement,
        winnerSignatures,
        table: this.table,
      });
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }

    try {
      const txHash = await this.write.writeContract({
        address: call.address,
        abi: call.abi,
        functionName: "settleHand",
        args: call.args,
        account: this.account,
      });

      const balancesByAddress = await this.readBalancesForInit(handInit);
      this.confirmedBalances = this.mapBalancesToPlayerIds(balancesByAddress);

      return {
        success: true,
        txHash,
        balancesByAddress,
      };
    } catch (e) {
      // Restore prior confirmed snapshot explicitly (never leave optimistic values)
      this.confirmedBalances = prior;
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * Build settlement from game state then settle on-chain.
   */
  async settleFromState(params: {
    state: SettleableHandState;
    playerHandNonces: Record<string, bigint>;
    winnerSignatures: readonly Hex[];
    handId?: Hex;
  }): Promise<TxCallResult & { settlement?: BuiltSettlement; handInit?: HandInit }> {
    let prepared: ReturnType<typeof prepareSettlementPayload>;
    try {
      prepared = this.prepareFromState(
        params.state,
        params.playerHandNonces,
        params.handId,
      );
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    const result = await this.settleHand(
      prepared.handInit,
      prepared.settlement,
      params.winnerSignatures,
    );
    return {
      ...result,
      settlement: prepared.settlement,
      handInit: prepared.handInit,
    };
  }

  async getBalance(address: Hex): Promise<bigint> {
    const raw = await this.read.readContract({
      address: getAddress(this.table.settlerAddress),
      abi: pokerHandSettlerAbi,
      functionName: "balanceOf",
      args: [getAddress(address)],
    });
    return BigInt(raw as bigint | number | string);
  }

  async getBalancesByPlayerIds(playerIds: string[]): Promise<Record<string, number>> {
    const scale = this.table.scale ?? 1n;
    const out: Record<string, number> = {};
    for (const id of playerIds) {
      const addr = this.getPlayerAddress(id);
      const bal = await this.getBalance(addr);
      out[id] = Number(bal / scale);
    }
    return out;
  }

  private async readBalancesForInit(handInit: HandInit): Promise<Record<Hex, bigint>> {
    const out: Record<Hex, bigint> = {};
    for (const addr of handInit.players) {
      out[getAddress(addr)] = await this.getBalance(addr);
    }
    return out;
  }

  private mapBalancesToPlayerIds(
    balancesByAddress: Record<Hex, bigint>,
  ): Record<string, number> {
    const scale = this.table.scale ?? 1n;
    const out: Record<string, number> = {};
    for (const [id, addr] of Object.entries(this.playerAddresses)) {
      const key = getAddress(addr);
      const bal = balancesByAddress[key];
      if (bal !== undefined) {
        out[id] = Number(bal / scale);
      }
    }
    return out;
  }
}
