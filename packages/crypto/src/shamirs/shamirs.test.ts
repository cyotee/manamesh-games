/**
 * Shamir's Secret Sharing Tests
 */

import { describe, it, expect } from 'vitest';
import {
  splitSecret,
  reconstructSecret,
  createKeyShares,
  reconstructKeyFromShares,
  canReconstruct,
  validateShare,
} from './index';
import type { SecretShare, KeyShare, ShamirConfig } from './types';
import { PRIME, ReconstructionError } from './types';

// Helper to normalize hex values for comparison
function normalizeHex(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  // Remove leading zeros but keep at least one digit
  const trimmed = clean.replace(/^0+/, '') || '0';
  return trimmed.toLowerCase();
}

describe('splitSecret', () => {
  it('should split a secret into shares', () => {
    const secret = '0x1234567890abcdef';
    const config: ShamirConfig = {
      threshold: 2,
      totalShares: 3,
    };

    const result = splitSecret(secret, config);

    expect(result.shares).toHaveLength(3);
    expect(result.threshold).toBe(2);
    expect(result.totalShares).toBe(3);
  });

  it('should create shares with unique indices', () => {
    const secret = '0xdeadbeef';
    const config: ShamirConfig = {
      threshold: 3,
      totalShares: 5,
    };

    const result = splitSecret(secret, config);
    const indices = result.shares.map((s) => s.index);
    const uniqueIndices = new Set(indices);

    expect(uniqueIndices.size).toBe(5);
  });

  it('should throw on invalid threshold', () => {
    const secret = '0x1234';
    const config: ShamirConfig = {
      threshold: 0, // Invalid
      totalShares: 3,
    };

    expect(() => splitSecret(secret, config)).toThrow();
  });

  it('should throw when threshold > totalShares', () => {
    const secret = '0x1234';
    const config: ShamirConfig = {
      threshold: 5,
      totalShares: 3, // Less than threshold
    };

    expect(() => splitSecret(secret, config)).toThrow();
  });
});

describe('reconstructSecret', () => {
  it('should reconstruct secret from threshold shares', () => {
    const secret = '0x1234567890abcdef';
    const config: ShamirConfig = {
      threshold: 2,
      totalShares: 3,
    };

    const result = splitSecret(secret, config);

    // Use only threshold number of shares
    const shares = result.shares.slice(0, 2);
    const reconstructed = reconstructSecret(shares, 2);

    // Compare normalized hex values
    expect(normalizeHex(reconstructed)).toBe(normalizeHex(secret));
  });

  it('should reconstruct with any combination of threshold shares', () => {
    const secret = '0xdeadbeefcafe';
    const config: ShamirConfig = {
      threshold: 3,
      totalShares: 5,
    };

    const result = splitSecret(secret, config);

    // Try different combinations
    const combo1 = [result.shares[0], result.shares[1], result.shares[2]];
    const combo2 = [result.shares[0], result.shares[2], result.shares[4]];
    const combo3 = [result.shares[1], result.shares[3], result.shares[4]];

    expect(normalizeHex(reconstructSecret(combo1, 3))).toBe(normalizeHex(secret));
    expect(normalizeHex(reconstructSecret(combo2, 3))).toBe(normalizeHex(secret));
    expect(normalizeHex(reconstructSecret(combo3, 3))).toBe(normalizeHex(secret));
  });

  it('should work with all shares', () => {
    const secret = '0x42';
    const config: ShamirConfig = {
      threshold: 2,
      totalShares: 4,
    };

    const result = splitSecret(secret, config);
    const reconstructed = reconstructSecret(result.shares, 2);

    expect(normalizeHex(reconstructed)).toBe(normalizeHex(secret));
  });

  it('should throw with insufficient shares', () => {
    const secret = '0x1234';
    const config: ShamirConfig = {
      threshold: 3,
      totalShares: 5,
    };

    const result = splitSecret(secret, config);

    // Only provide 2 shares when threshold is 3
    const insufficientShares = result.shares.slice(0, 2);

    expect(() => reconstructSecret(insufficientShares, 3)).toThrow();
  });
});

describe('createKeyShares', () => {
  it('should create shares for distribution to other players', () => {
    const privateKey = '0x0123456789abcdef0123456789abcdef';
    const fromPlayer = 'alice';
    const otherPlayers = ['bob', 'carol', 'dave'];

    const shares = createKeyShares(privateKey, fromPlayer, otherPlayers);

    expect(shares).toHaveLength(3);
    expect(shares.every((s) => s.fromPlayer === 'alice')).toBe(true);
    expect(shares.map((s) => s.forPlayer)).toEqual(['bob', 'carol', 'dave']);
  });

  it('should use default threshold of N-1', () => {
    const privateKey = '0xabcd';
    const fromPlayer = 'alice';
    const otherPlayers = ['bob', 'carol', 'dave'];

    const shares = createKeyShares(privateKey, fromPlayer, otherPlayers);

    // With 3 other players, threshold should be 2 (n-1)
    // This means any 2 shares can reconstruct
    expect(shares).toHaveLength(3);
  });

  it('should use custom threshold when provided', () => {
    const privateKey = '0xabcd';
    const fromPlayer = 'alice';
    const otherPlayers = ['bob', 'carol', 'dave', 'eve'];
    const threshold = 3;

    const shares = createKeyShares(privateKey, fromPlayer, otherPlayers, threshold);

    expect(shares).toHaveLength(4);
  });
});

describe('reconstructKeyFromShares', () => {
  it('should reconstruct key from distributed shares', () => {
    const privateKey = '0xfedcba9876543210';
    const fromPlayer = 'alice';
    const otherPlayers = ['bob', 'carol', 'dave'];

    const shares = createKeyShares(privateKey, fromPlayer, otherPlayers, 2);

    // Use only 2 shares to reconstruct
    const reconstructed = reconstructKeyFromShares(shares.slice(0, 2), 2);

    expect(reconstructed).not.toBeNull();
    expect(normalizeHex(reconstructed!)).toBe(normalizeHex(privateKey));
  });

  it('should return null with insufficient shares', () => {
    const privateKey = '0xabcd1234';
    const fromPlayer = 'alice';
    const otherPlayers = ['bob', 'carol', 'dave'];

    const shares = createKeyShares(privateKey, fromPlayer, otherPlayers, 3);

    // Only provide 2 shares when threshold is 3
    const reconstructed = reconstructKeyFromShares(shares.slice(0, 2), 3);

    expect(reconstructed).toBeNull();
  });
});

describe('canReconstruct', () => {
  it('should return true when threshold is met', () => {
    const result = splitSecret('0x1234', { threshold: 2, totalShares: 3 });
    expect(canReconstruct(result.shares, 2)).toBe(true);
    expect(canReconstruct(result.shares.slice(0, 2), 2)).toBe(true);
  });

  it('should return false when threshold is not met', () => {
    const result = splitSecret('0x1234', { threshold: 3, totalShares: 4 });
    expect(canReconstruct(result.shares.slice(0, 2), 3)).toBe(false);
    expect(canReconstruct([], 1)).toBe(false);
  });
});

describe('validateShare', () => {
  it('should validate proper share format', () => {
    const share: SecretShare = {
      index: 1,
      value: '0x1234',
    };

    expect(validateShare(share)).toBe(true);
  });

  it('should reject invalid index', () => {
    const share: SecretShare = {
      index: 0, // Invalid - must be >= 1
      value: '0x1234',
    };

    expect(validateShare(share)).toBe(false);
  });

  it('should reject negative index', () => {
    const share: SecretShare = {
      index: -1,
      value: '0x1234',
    };

    expect(validateShare(share)).toBe(false);
  });

  it('should reject empty value', () => {
    const share: SecretShare = {
      index: 1,
      value: '',
    };

    expect(validateShare(share)).toBe(false);
  });
});

describe('edge cases', () => {
  it('should handle small secrets', () => {
    const secret = '0x1';
    const config: ShamirConfig = {
      threshold: 2,
      totalShares: 3,
    };

    const result = splitSecret(secret, config);
    const reconstructed = reconstructSecret(result.shares.slice(0, 2), 2);

    expect(normalizeHex(reconstructed)).toBe(normalizeHex(secret));
  });

  it('should handle threshold equals totalShares', () => {
    const secret = '0xabcd';
    const config: ShamirConfig = {
      threshold: 3,
      totalShares: 3, // Need all shares
    };

    const result = splitSecret(secret, config);

    // All shares needed
    const reconstructed = reconstructSecret(result.shares, 3);
    expect(normalizeHex(reconstructed)).toBe(normalizeHex(secret));

    // Missing one share should fail
    expect(() => reconstructSecret(result.shares.slice(0, 2), 3)).toThrow();
  });

  it('should handle 2-of-2 scheme', () => {
    const secret = '0x42';
    const config: ShamirConfig = {
      threshold: 2,
      totalShares: 2,
    };

    const result = splitSecret(secret, config);
    const reconstructed = reconstructSecret(result.shares, 2);

    expect(normalizeHex(reconstructed)).toBe(normalizeHex(secret));
  });

  it('should produce different shares each time (randomness)', () => {
    const secret = '0x1234';
    const config: ShamirConfig = {
      threshold: 2,
      totalShares: 3,
    };

    const result1 = splitSecret(secret, config);
    const result2 = splitSecret(secret, config);

    // Shares should be different (random coefficients)
    const shareValues1 = result1.shares.map((s) => s.value);
    const shareValues2 = result2.shares.map((s) => s.value);

    // At least one share should differ (extremely unlikely to be the same)
    const allSame = shareValues1.every((v, i) => v === shareValues2[i]);
    expect(allSame).toBe(false);

    // But both should still reconstruct the same secret
    expect(normalizeHex(reconstructSecret(result1.shares.slice(0, 2), 2))).toBe(normalizeHex(secret));
    expect(normalizeHex(reconstructSecret(result2.shares.slice(0, 2), 2))).toBe(normalizeHex(secret));
  });
});
