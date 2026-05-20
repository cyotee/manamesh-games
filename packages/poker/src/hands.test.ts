/**
 * Poker Hand Evaluation Tests
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateHand,
  compareHands,
  findBestHand,
  determineWinners,
  getHandRankName,
} from './hands';
import { HandRank, type PokerCard } from './types';

// Helper to create cards
function card(suit: string, rank: string): PokerCard {
  return {
    id: `${suit}-${rank}`,
    name: `${rank} of ${suit}`,
    suit: suit as PokerCard['suit'],
    rank: rank as PokerCard['rank'],
  };
}

describe('evaluateHand', () => {
  describe('High Card', () => {
    it('should identify high card', () => {
      const cards = [
        card('hearts', 'A'),
        card('clubs', 'K'),
        card('diamonds', '10'),
        card('spades', '8'),
        card('hearts', '3'),
      ];
      const result = evaluateHand(cards);
      expect(result.rank).toBe(HandRank.HIGH_CARD);
      expect(result.values[0]).toBe(14); // Ace high
    });
  });

  describe('Pair', () => {
    it('should identify a pair', () => {
      const cards = [
        card('hearts', 'A'),
        card('clubs', 'A'),
        card('diamonds', '10'),
        card('spades', '8'),
        card('hearts', '3'),
      ];
      const result = evaluateHand(cards);
      expect(result.rank).toBe(HandRank.PAIR);
      expect(result.values[0]).toBe(14); // Pair of Aces
    });

    it('should identify pair with proper kickers', () => {
      const cards = [
        card('hearts', '7'),
        card('clubs', '7'),
        card('diamonds', 'K'),
        card('spades', 'Q'),
        card('hearts', '2'),
      ];
      const result = evaluateHand(cards);
      expect(result.rank).toBe(HandRank.PAIR);
      expect(result.values[0]).toBe(7); // Pair rank
      expect(result.values[1]).toBe(7); // Pair rank
      // Kickers follow
    });
  });

  describe('Two Pair', () => {
    it('should identify two pair', () => {
      const cards = [
        card('hearts', 'A'),
        card('clubs', 'A'),
        card('diamonds', 'K'),
        card('spades', 'K'),
        card('hearts', '3'),
      ];
      const result = evaluateHand(cards);
      expect(result.rank).toBe(HandRank.TWO_PAIR);
      // Values should start with higher pair (Aces)
      expect(result.values[0]).toBe(14); // First Ace
      expect(result.values[1]).toBe(14); // Second Ace
      expect(result.values[2]).toBe(13); // First King
      expect(result.values[3]).toBe(13); // Second King
    });
  });

  describe('Three of a Kind', () => {
    it('should identify three of a kind', () => {
      const cards = [
        card('hearts', 'Q'),
        card('clubs', 'Q'),
        card('diamonds', 'Q'),
        card('spades', '8'),
        card('hearts', '3'),
      ];
      const result = evaluateHand(cards);
      expect(result.rank).toBe(HandRank.THREE_OF_A_KIND);
      expect(result.values[0]).toBe(12); // Queens
    });
  });

  describe('Straight', () => {
    it('should identify a straight', () => {
      const cards = [
        card('hearts', '9'),
        card('clubs', '8'),
        card('diamonds', '7'),
        card('spades', '6'),
        card('hearts', '5'),
      ];
      const result = evaluateHand(cards);
      expect(result.rank).toBe(HandRank.STRAIGHT);
      expect(result.values[0]).toBe(9); // 9-high straight
    });

    it('should identify wheel (A-2-3-4-5)', () => {
      const cards = [
        card('hearts', 'A'),
        card('clubs', '2'),
        card('diamonds', '3'),
        card('spades', '4'),
        card('hearts', '5'),
      ];
      const result = evaluateHand(cards);
      expect(result.rank).toBe(HandRank.STRAIGHT);
      expect(result.values[0]).toBe(5); // 5-high straight (wheel)
    });

    it('should identify broadway (T-J-Q-K-A)', () => {
      const cards = [
        card('hearts', 'A'),
        card('clubs', 'K'),
        card('diamonds', 'Q'),
        card('spades', 'J'),
        card('hearts', '10'),
      ];
      const result = evaluateHand(cards);
      expect(result.rank).toBe(HandRank.STRAIGHT);
      expect(result.values[0]).toBe(14); // Ace-high straight
    });
  });

  describe('Flush', () => {
    it('should identify a flush', () => {
      const cards = [
        card('hearts', 'A'),
        card('hearts', 'K'),
        card('hearts', '10'),
        card('hearts', '7'),
        card('hearts', '3'),
      ];
      const result = evaluateHand(cards);
      expect(result.rank).toBe(HandRank.FLUSH);
      expect(result.values[0]).toBe(14); // Ace-high flush
    });
  });

  describe('Full House', () => {
    it('should identify full house', () => {
      const cards = [
        card('hearts', 'K'),
        card('clubs', 'K'),
        card('diamonds', 'K'),
        card('spades', '7'),
        card('hearts', '7'),
      ];
      const result = evaluateHand(cards);
      expect(result.rank).toBe(HandRank.FULL_HOUSE);
      // Values: [tripValue x3, pairValue x2]
      expect(result.values[0]).toBe(13); // First King
      expect(result.values[1]).toBe(13); // Second King
      expect(result.values[2]).toBe(13); // Third King
      expect(result.values[3]).toBe(7); // First 7
      expect(result.values[4]).toBe(7); // Second 7
    });
  });

  describe('Four of a Kind', () => {
    it('should identify four of a kind', () => {
      const cards = [
        card('hearts', '9'),
        card('clubs', '9'),
        card('diamonds', '9'),
        card('spades', '9'),
        card('hearts', 'A'),
      ];
      const result = evaluateHand(cards);
      expect(result.rank).toBe(HandRank.FOUR_OF_A_KIND);
      expect(result.values[0]).toBe(9); // Quad 9s
    });
  });

  describe('Straight Flush', () => {
    it('should identify straight flush', () => {
      const cards = [
        card('clubs', '9'),
        card('clubs', '8'),
        card('clubs', '7'),
        card('clubs', '6'),
        card('clubs', '5'),
      ];
      const result = evaluateHand(cards);
      expect(result.rank).toBe(HandRank.STRAIGHT_FLUSH);
      expect(result.values[0]).toBe(9);
    });

    it('should identify wheel straight flush', () => {
      const cards = [
        card('diamonds', 'A'),
        card('diamonds', '2'),
        card('diamonds', '3'),
        card('diamonds', '4'),
        card('diamonds', '5'),
      ];
      const result = evaluateHand(cards);
      expect(result.rank).toBe(HandRank.STRAIGHT_FLUSH);
      expect(result.values[0]).toBe(5);
    });
  });

  describe('Royal Flush', () => {
    it('should identify royal flush', () => {
      const cards = [
        card('spades', 'A'),
        card('spades', 'K'),
        card('spades', 'Q'),
        card('spades', 'J'),
        card('spades', '10'),
      ];
      const result = evaluateHand(cards);
      expect(result.rank).toBe(HandRank.ROYAL_FLUSH);
    });
  });
});

describe('compareHands', () => {
  it('should compare different ranks correctly', () => {
    const pair = evaluateHand([
      card('hearts', 'A'),
      card('clubs', 'A'),
      card('diamonds', '10'),
      card('spades', '8'),
      card('hearts', '3'),
    ]);

    const twoPair = evaluateHand([
      card('hearts', 'K'),
      card('clubs', 'K'),
      card('diamonds', 'Q'),
      card('spades', 'Q'),
      card('hearts', '3'),
    ]);

    expect(compareHands(twoPair, pair)).toBe(1);
    expect(compareHands(pair, twoPair)).toBe(-1);
  });

  it('should compare same rank by values', () => {
    const pairOfKings = evaluateHand([
      card('hearts', 'K'),
      card('clubs', 'K'),
      card('diamonds', '10'),
      card('spades', '8'),
      card('hearts', '3'),
    ]);

    const pairOfAces = evaluateHand([
      card('hearts', 'A'),
      card('clubs', 'A'),
      card('diamonds', '9'),
      card('spades', '7'),
      card('hearts', '2'),
    ]);

    expect(compareHands(pairOfAces, pairOfKings)).toBe(1);
    expect(compareHands(pairOfKings, pairOfAces)).toBe(-1);
  });

  it('should identify ties', () => {
    const hand1 = evaluateHand([
      card('hearts', 'A'),
      card('clubs', 'K'),
      card('diamonds', 'Q'),
      card('spades', 'J'),
      card('hearts', '9'),
    ]);

    const hand2 = evaluateHand([
      card('diamonds', 'A'),
      card('spades', 'K'),
      card('hearts', 'Q'),
      card('clubs', 'J'),
      card('diamonds', '9'),
    ]);

    expect(compareHands(hand1, hand2)).toBe(0);
  });

  it('should compare by kickers', () => {
    const pairKickerQ = evaluateHand([
      card('hearts', '7'),
      card('clubs', '7'),
      card('diamonds', 'Q'),
      card('spades', '8'),
      card('hearts', '3'),
    ]);

    const pairKickerK = evaluateHand([
      card('hearts', '7'),
      card('clubs', '7'),
      card('diamonds', 'K'),
      card('spades', '6'),
      card('hearts', '2'),
    ]);

    expect(compareHands(pairKickerK, pairKickerQ)).toBe(1);
  });
});

describe('findBestHand', () => {
  it('should find best 5-card hand from 7 cards', () => {
    const holeCards = [card('hearts', 'A'), card('hearts', 'K')];
    const communityCards = [
      card('hearts', 'Q'),
      card('hearts', 'J'),
      card('hearts', '10'),
      card('clubs', '2'),
      card('diamonds', '3'),
    ];

    const result = findBestHand(holeCards, communityCards);
    expect(result.rank).toBe(HandRank.ROYAL_FLUSH);
  });

  it('should find best hand with multiple options', () => {
    const holeCards = [card('hearts', 'A'), card('spades', 'A')];
    const communityCards = [
      card('clubs', 'A'),
      card('diamonds', 'A'),
      card('hearts', 'K'),
      card('clubs', 'K'),
      card('diamonds', 'K'),
    ];

    const result = findBestHand(holeCards, communityCards);
    expect(result.rank).toBe(HandRank.FOUR_OF_A_KIND);
    expect(result.values[0]).toBe(14); // Four Aces beats three kings
  });
});

describe('determineWinners', () => {
  it('should determine single winner', () => {
    const playerHands = new Map([
      ['player1', evaluateHand([
        card('hearts', 'A'),
        card('clubs', 'A'),
        card('diamonds', '10'),
        card('spades', '8'),
        card('hearts', '3'),
      ])],
      ['player2', evaluateHand([
        card('hearts', 'K'),
        card('clubs', 'K'),
        card('diamonds', '10'),
        card('spades', '8'),
        card('hearts', '3'),
      ])],
    ]);

    const winners = determineWinners(playerHands);
    expect(winners).toEqual(['player1']);
  });

  it('should determine ties', () => {
    const playerHands = new Map([
      ['player1', evaluateHand([
        card('hearts', 'A'),
        card('clubs', 'K'),
        card('diamonds', 'Q'),
        card('spades', 'J'),
        card('hearts', '9'),
      ])],
      ['player2', evaluateHand([
        card('diamonds', 'A'),
        card('spades', 'K'),
        card('clubs', 'Q'),
        card('hearts', 'J'),
        card('clubs', '9'),
      ])],
    ]);

    const winners = determineWinners(playerHands);
    expect(winners).toHaveLength(2);
    expect(winners).toContain('player1');
    expect(winners).toContain('player2');
  });

  it('should handle empty map', () => {
    expect(determineWinners(new Map())).toEqual([]);
  });

  it('should handle single player', () => {
    const playerHands = new Map([
      ['player1', evaluateHand([
        card('hearts', 'A'),
        card('clubs', 'K'),
        card('diamonds', 'Q'),
        card('spades', 'J'),
        card('hearts', '9'),
      ])],
    ]);
    expect(determineWinners(playerHands)).toEqual(['player1']);
  });
});

describe('getHandRankName', () => {
  it('should return correct names', () => {
    expect(getHandRankName(HandRank.HIGH_CARD)).toBe('High Card');
    expect(getHandRankName(HandRank.PAIR)).toBe('Pair');
    expect(getHandRankName(HandRank.TWO_PAIR)).toBe('Two Pair');
    expect(getHandRankName(HandRank.THREE_OF_A_KIND)).toBe('Three of a Kind');
    expect(getHandRankName(HandRank.STRAIGHT)).toBe('Straight');
    expect(getHandRankName(HandRank.FLUSH)).toBe('Flush');
    expect(getHandRankName(HandRank.FULL_HOUSE)).toBe('Full House');
    expect(getHandRankName(HandRank.FOUR_OF_A_KIND)).toBe('Four of a Kind');
    expect(getHandRankName(HandRank.STRAIGHT_FLUSH)).toBe('Straight Flush');
    expect(getHandRankName(HandRank.ROYAL_FLUSH)).toBe('Royal Flush');
  });
});
