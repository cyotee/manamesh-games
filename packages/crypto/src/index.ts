/**
 * Crypto Module
 *
 * Cryptographic primitives and plugins for fair P2P card games.
 */

// Mental Poker primitives
export * from "./mental-poker";

// boardgame.io plugin
export * from "./plugin";

// General utilities (sync; used by game logic)
export * from "./sha256";
export * from "./merkle";
export * from "./stable-json";

// Threshold-tally (browser-feasible) primitives
export * from "./secp256k1";
export * from "./ec-elgamal-exp";
export * from "./feldman-dkg";
export * from "./dleq";
export * from "./ecdsa";

// ZK helpers (snarkjs wrapper; circuits live under src/circuits)
export * from "./zk";

// Range proof snarkjs wrappers
export * from "./snarkjs-range";
export { RANGE_PROOF_VKEY } from "./range-proof-vkey";
