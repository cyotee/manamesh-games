import {
  recoverTypedDataAddress,
  type Hex,
  type LocalAccount,
  type TypedDataDomain,
} from "viem";
import type { HandInit } from "./handId";

export type { HandInit } from "./handId";

/**
 * Off-chain `HandOutcome` mirroring `contracts/types/HandOutcome.sol`.
 * `holeCards` is parallel to `HandInit.players`; each card is `(rank<<4)|suit`.
 */
export interface HandOutcome {
  handId: Hex;
  pot: bigint;
  winners: Hex[];
  payouts: bigint[];
  finalStacks: bigint[];
  finalStateHash: Hex;
  holeCards: readonly [number, number][];
  communityCards: readonly [number, number, number, number, number];
}

/** Off-chain `RoundStateTransition` mirroring the on-chain struct. */
export interface RoundStateTransition {
  handId: Hex;
  roundNumber: number;
  currentPot: bigint;
  playerStacks: bigint[];
  actionHash: Hex;
}

// EIP-712 type definitions — field order/types match the Solidity TYPEHASH strings.
const HAND_INIT_TYPES = {
  HandInit: [
    { name: "players", type: "address[]" },
    { name: "buyIns", type: "uint256[]" },
    { name: "vault", type: "address" },
    { name: "smallBlind", type: "uint256" },
    { name: "bigBlind", type: "uint256" },
    { name: "timeoutSeconds", type: "uint256" },
    { name: "otherConfig", type: "bytes32" },
    { name: "playerHandNonces", type: "uint256[]" },
  ],
} as const;

const HAND_OUTCOME_TYPES = {
  HandOutcome: [
    { name: "handId", type: "bytes32" },
    { name: "pot", type: "uint256" },
    { name: "winners", type: "address[]" },
    { name: "payouts", type: "uint256[]" },
    { name: "finalStacks", type: "uint256[]" },
    { name: "finalStateHash", type: "bytes32" },
    { name: "holeCards", type: "uint8[2][]" },
    { name: "communityCards", type: "uint8[5]" },
  ],
} as const;

const ROUND_STATE_TRANSITION_TYPES = {
  RoundStateTransition: [
    { name: "handId", type: "bytes32" },
    { name: "roundNumber", type: "uint8" },
    { name: "currentPot", type: "uint256" },
    { name: "playerStacks", type: "uint256[]" },
    { name: "actionHash", type: "bytes32" },
  ],
} as const;

/**
 * Builds the settler's EIP-712 domain. Must match the on-chain
 * `PokerSettlementHashLib.domainSeparator()`:
 * `{ name: 'PokerHandSettler', version: '1', chainId, verifyingContract }`.
 */
export function settlerDomain(chainId: number, verifyingContract: Hex): TypedDataDomain {
  return { name: "PokerHandSettler", version: "1", chainId, verifyingContract };
}

export function signHandInit(account: LocalAccount, domain: TypedDataDomain, init: HandInit): Promise<Hex> {
  return account.signTypedData({ domain, types: HAND_INIT_TYPES, primaryType: "HandInit", message: init });
}

export function recoverHandInitSigner(
  domain: TypedDataDomain,
  init: HandInit,
  signature: Hex,
): Promise<Hex> {
  return recoverTypedDataAddress({
    domain,
    types: HAND_INIT_TYPES,
    primaryType: "HandInit",
    message: init,
    signature,
  });
}

export function signHandOutcome(
  account: LocalAccount,
  domain: TypedDataDomain,
  outcome: HandOutcome,
): Promise<Hex> {
  return account.signTypedData({
    domain,
    types: HAND_OUTCOME_TYPES,
    primaryType: "HandOutcome",
    message: outcome,
  });
}

export function recoverHandOutcomeSigner(
  domain: TypedDataDomain,
  outcome: HandOutcome,
  signature: Hex,
): Promise<Hex> {
  return recoverTypedDataAddress({
    domain,
    types: HAND_OUTCOME_TYPES,
    primaryType: "HandOutcome",
    message: outcome,
    signature,
  });
}

export function signRoundStateTransition(
  account: LocalAccount,
  domain: TypedDataDomain,
  state: RoundStateTransition,
): Promise<Hex> {
  return account.signTypedData({
    domain,
    types: ROUND_STATE_TRANSITION_TYPES,
    primaryType: "RoundStateTransition",
    message: state,
  });
}

export function recoverRoundStateTransitionSigner(
  domain: TypedDataDomain,
  state: RoundStateTransition,
  signature: Hex,
): Promise<Hex> {
  return recoverTypedDataAddress({
    domain,
    types: ROUND_STATE_TRANSITION_TYPES,
    primaryType: "RoundStateTransition",
    message: state,
    signature,
  });
}
