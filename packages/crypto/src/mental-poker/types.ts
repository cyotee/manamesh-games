/**
 * Mental Poker Types
 *
 * Type definitions for cryptographic deck operations using
 * SRA (Shamir-Rivest-Adleman) commutative encryption.
 */

/**
 * Encrypted card representation.
 * The ciphertext is the card identity encrypted with one or more keys.
 */
export interface EncryptedCard {
  /** Ciphertext representing the encrypted card (hex string) */
  ciphertext: string;
  /** Number of encryption layers applied (0 = plaintext) */
  layers: number;
}

/**
 * A deck of encrypted cards with metadata.
 */
export interface EncryptedDeck {
  /** The encrypted cards in order */
  cards: EncryptedCard[];
  /** Commitment to the deck state (for verification) */
  commitment?: Uint8Array;
  /** Proof that the last shuffle was valid */
  shuffleProof?: ShuffleProof;
}

/**
 * Player's cryptographic context for mental poker.
 * Contains keys and state for encryption/decryption.
 */
export interface CryptoContext {
  /** Player identifier */
  playerId: string;
  /** Player's public key (can be shared) */
  publicKey: CryptoKeyPair['publicKey'];
  /** Player's private key (never shared) */
  privateKey: CryptoKeyPair['privateKey'];
  /** Public keys of other players */
  peerPublicKeys: Map<string, CryptoKeyPair['publicKey']>;
  /** Random nonce for this session */
  sessionNonce: Uint8Array;
}

/**
 * SRA key pair for commutative encryption.
 * Uses elliptic curve points for efficient operations.
 */
export interface CryptoKeyPair {
  /** Public key (point on curve) - hex encoded */
  publicKey: string;
  /** Private key (scalar) - hex encoded */
  privateKey: string;
}

/**
 * Zero-knowledge proof that a shuffle is a valid permutation.
 */
export interface ShuffleProof {
  /** Commitment to the permutation */
  commitment: Uint8Array;
  /** The ZK proof data */
  proof: Uint8Array;
  /** Public inputs for verification */
  publicInputs: string[];
  /** Hash of input deck state */
  inputHash: string;
  /** Hash of output deck state */
  outputHash: string;
}

/**
 * Commitment to a deck state.
 * Used to detect tampering after the fact.
 */
export interface DeckCommitment {
  /** The commitment hash */
  hash: Uint8Array;
  /** Random nonce used (revealed later for verification) */
  nonce: Uint8Array;
  /** Timestamp when commitment was created */
  timestamp: number;
}

/**
 * Result of a card reveal operation.
 */
export interface RevealResult {
  /** The revealed card ID */
  cardId: string;
  /** Decryption shares from each player */
  shares: Map<string, string>;
  /** Whether all required shares were provided */
  complete: boolean;
}

/**
 * Configuration for the mental poker protocol.
 */
export interface MentalPokerConfig {
  /** Elliptic curve to use (default: secp256k1) */
  curve?: string;
  /** Number of players */
  numPlayers: number;
  /** Player IDs in order */
  playerIds: string[];
  /** Whether to require shuffle proofs (expensive) */
  requireShuffleProofs?: boolean;
}

/**
 * State of the mental poker protocol for a game.
 */
export interface MentalPokerState {
  /** Current phase of the protocol */
  phase: 'setup' | 'keyExchange' | 'encrypt' | 'shuffle' | 'ready' | 'playing';
  /** All players' public keys */
  publicKeys: Map<string, string>;
  /** Commitments from each player */
  commitments: Map<string, DeckCommitment>;
  /** The current encrypted deck */
  deck: EncryptedDeck;
  /** Cards that have been revealed (cardIndex -> cardId) */
  revealedCards: Map<number, string>;
  /** Pending reveal operations */
  pendingReveals: Map<number, RevealResult>;
}

/**
 * Message types for mental poker protocol.
 */
export type MentalPokerMessage =
  | { type: 'keyExchange'; playerId: string; publicKey: string }
  | { type: 'commitment'; playerId: string; commitment: DeckCommitment }
  | { type: 'encryptedDeck'; playerId: string; deck: EncryptedDeck }
  | { type: 'shuffleProof'; playerId: string; proof: ShuffleProof }
  | { type: 'decryptionShare'; playerId: string; cardIndex: number; share: string }
  | { type: 'revealRequest'; cardIndex: number; requesterId: string }
  | { type: 'error'; playerId: string; message: string };

/**
 * Callback for protocol events.
 */
export type ProtocolEventHandler = (message: MentalPokerMessage) => void;
