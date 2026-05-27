import { encodeAbiParameters, keccak256, type Hex } from "viem";

/**
 * Off-chain `HandInit` mirroring the on-chain `HandInit` struct
 * (`contracts/types/HandInit.sol`). `players` MUST be sorted ascending and
 * `buyIns` / `playerHandNonces` are parallel to `players`.
 */
export interface HandInit {
  players: Hex[];
  buyIns: bigint[];
  vault: Hex;
  smallBlind: bigint;
  bigBlind: bigint;
  timeoutSeconds: bigint;
  /** bytes32 */
  otherConfig: Hex;
  playerHandNonces: bigint[];
}

/**
 * Computes the deterministic hand identifier exactly as
 * `HandIdLib.handIdOf` does on-chain: `keccak256(abi.encode(fields...))`.
 *
 * Cross-stack parity is locked by `tests/foundry/lib/HandIdLib_parity.t.sol`
 * and `handId.test.ts`, which share one canonical vector.
 */
export function deriveHandId(init: HandInit): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address[]" },
        { type: "uint256[]" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256[]" },
      ],
      [
        init.players,
        init.buyIns,
        init.vault,
        init.smallBlind,
        init.bigBlind,
        init.timeoutSeconds,
        init.otherConfig,
        init.playerHandNonces,
      ],
    ),
  );
}
