/**
 * Mental Poker Module
 *
 * Cryptographic primitives for fair P2P card games.
 */

// Types
export type {
  CryptoContext,
  CryptoKeyPair,
  DeckCommitment,
  EncryptedCard,
  EncryptedDeck,
  MentalPokerConfig,
  MentalPokerMessage,
  MentalPokerState,
  ProtocolEventHandler,
  RevealResult,
  ShuffleProof,
} from './types';

// SRA Commutative Encryption
export {
  buildCardPointLookup,
  decrypt,
  decryptDeck,
  decryptToCardId,
  encrypt,
  encryptDeck,
  generateKeyPair,
  getCardPoint,
  reencryptDeck,
  verifyCommutative,
} from './sra';

// Commitments
export {
  batchVerifyCommitments,
  computeCommitmentHash,
  createCommitment,
  createCommitmentMessage,
  generateNonce,
  hashDeck,
  hashToHex,
  hexToHash,
  serializeDeck,
  serializeEncryptedDeck,
  verifyCommitment,
  verifySelfCommitment,
} from './commitment';

// Shuffle Proofs
export {
  applyPermutation,
  commitPermutation,
  createShuffleProof,
  deserializePermutation,
  generatePermutation,
  invertPermutation,
  isValidPermutation,
  quickShuffle,
  serializePermutation,
  shuffleWithProof,
  verifyPermutationCommitment,
  verifyShuffleProof,
} from './shuffle-proof';

export type { Permutation } from './shuffle-proof';
