/**
 * Crypto Module
 *
 * Cryptographic primitives and plugins for fair P2P card games.
 */

// Mental Poker primitives
export * from "./mental-poker/index.js";

// Keychain — GPG-style public-key registry + admission policy
export * from "./keychain/index.js";

// boardgame.io plugin
export * from "./plugin/index.js";

// General utilities (sync; used by game logic)
export * from "./sha256.js";
export * from "./merkle.js";
export * from "./stable-json.js";

// Threshold-tally (browser-feasible) primitives
export * from "./secp256k1.js";
export { validateEncryptedCard, validatePlayerIdentity } from "./secp256k1.js";
export * from "./ec-elgamal-exp.js";
export * from "./feldman-dkg.js";
export * from "./dleq.js";
export * from "./ecdsa.js";

// ZK helpers (snarkjs wrapper; circuits live under src/circuits)
export * from "./zk/index.js";

// Range proof snarkjs wrappers (omit Groth16* types re-exported from ./zk)
export {
  generateRangeProof,
  verifyRangeProof,
  verifyRangeProofFull,
  serializeRangeProof,
  deserializeRangeProof,
  type RangeProofInput,
  type RangeProofPublicSignals,
  type RangeProof,
} from "./snarkjs-range.js";
export { RANGE_PROOF_VKEY } from "./range-proof-vkey.js";

// boardgame.io setup-flow helpers (absorbed from former @cyotee/boardgameio-crypto)
export * from "./integration/setup-utils.js";
