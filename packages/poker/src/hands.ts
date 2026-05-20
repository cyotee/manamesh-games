/**
 * Poker Hand Evaluation
 *
 * Evaluates and compares poker hands for Texas Hold'em.
 * Finds the best 5-card hand from 7 available cards (2 hole + 5 community).
 */

import {
  PokerCard,
  HandRank,
  EvaluatedHand,
  HandComparisonResult,
  RANK_VALUES,
  SUIT_VALUES,
  HAND_RANK_NAMES,
} from './types';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get numeric value of a card's rank (Ace = 14 by default)
 */
function getRankValue(rank: string, aceLow: boolean = false): number {
  if (aceLow && rank === 'A') return 1;
  return RANK_VALUES[rank] ?? 0;
}

/**
 * Sort cards by rank value (descending)
 */
function sortByRank(cards: PokerCard[], aceLow: boolean = false): PokerCard[] {
  return [...cards].sort((a, b) => getRankValue(b.rank, aceLow) - getRankValue(a.rank, aceLow));
}

/**
 * Group cards by rank
 */
function groupByRank(cards: PokerCard[]): Map<string, PokerCard[]> {
  const groups = new Map<string, PokerCard[]>();
  for (const card of cards) {
    const existing = groups.get(card.rank) ?? [];
    existing.push(card);
    groups.set(card.rank, existing);
  }
  return groups;
}

/**
 * Group cards by suit
 */
function groupBySuit(cards: PokerCard[]): Map<string, PokerCard[]> {
  const groups = new Map<string, PokerCard[]>();
  for (const card of cards) {
    const existing = groups.get(card.suit) ?? [];
    existing.push(card);
    groups.set(card.suit, existing);
  }
  return groups;
}

/**
 * Check if cards form a straight and return the high card value
 * Returns null if not a straight
 */
function getStraightHighCard(cards: PokerCard[]): number | null {
  if (cards.length < 5) return null;

  // Get unique rank values, sorted descending
  const values = [...new Set(cards.map((c) => getRankValue(c.rank)))].sort((a, b) => b - a);

  // Check for standard straight (5 consecutive values)
  for (let i = 0; i <= values.length - 5; i++) {
    const slice = values.slice(i, i + 5);
    if (slice[0] - slice[4] === 4) {
      return slice[0];
    }
  }

  // Check for wheel (A-2-3-4-5)
  if (values.includes(14) && values.includes(2) && values.includes(3) && values.includes(4) && values.includes(5)) {
    return 5; // 5-high straight
  }

  return null;
}

/**
 * Get cards that form a straight (if any)
 */
function getStraightCards(cards: PokerCard[], highCard: number): PokerCard[] {
  const sorted = sortByRank(cards);

  // For wheel (5-high), we need A-2-3-4-5
  if (highCard === 5) {
    const result: PokerCard[] = [];
    const needed = [5, 4, 3, 2, 14]; // 5 is high, A is treated as 1

    for (const targetValue of needed) {
      const card = sorted.find(
        (c) => getRankValue(c.rank) === targetValue && !result.includes(c)
      );
      if (card) result.push(card);
    }

    return result;
  }

  // Standard straight
  const result: PokerCard[] = [];
  for (let v = highCard; v > highCard - 5; v--) {
    const card = sorted.find((c) => getRankValue(c.rank) === v && !result.includes(c));
    if (card) result.push(card);
  }

  return result;
}

// ============================================================================
// Hand Detection Functions
// ============================================================================

/**
 * Check for Royal Flush (A-K-Q-J-10 of same suit)
 */
function checkRoyalFlush(cards: PokerCard[]): EvaluatedHand | null {
  const bySuit = groupBySuit(cards);

  for (const [suit, suitCards] of bySuit) {
    if (suitCards.length >= 5) {
      const values = new Set(suitCards.map((c) => getRankValue(c.rank)));
      if (values.has(14) && values.has(13) && values.has(12) && values.has(11) && values.has(10)) {
        const handCards = suitCards.filter((c) =>
          [14, 13, 12, 11, 10].includes(getRankValue(c.rank))
        );
        return {
          rank: HandRank.ROYAL_FLUSH,
          values: [14, 13, 12, 11, 10],
          cards: sortByRank(handCards).slice(0, 5),
          description: `Royal Flush (${suit})`,
        };
      }
    }
  }

  return null;
}

/**
 * Check for Straight Flush
 */
function checkStraightFlush(cards: PokerCard[]): EvaluatedHand | null {
  const bySuit = groupBySuit(cards);

  for (const [suit, suitCards] of bySuit) {
    if (suitCards.length >= 5) {
      const highCard = getStraightHighCard(suitCards);
      if (highCard !== null) {
        const straightCards = getStraightCards(suitCards, highCard);
        if (straightCards.length === 5) {
          return {
            rank: HandRank.STRAIGHT_FLUSH,
            values: straightCards.map((c) => getRankValue(c.rank, highCard === 5)),
            cards: straightCards,
            description: `Straight Flush, ${highCard === 14 ? 'Ace' : highCard}-high (${suit})`,
          };
        }
      }
    }
  }

  return null;
}

/**
 * Check for Four of a Kind
 */
function checkFourOfAKind(cards: PokerCard[]): EvaluatedHand | null {
  const byRank = groupByRank(cards);

  for (const [rank, rankCards] of byRank) {
    if (rankCards.length === 4) {
      const kicker = sortByRank(cards.filter((c) => c.rank !== rank))[0];
      const handCards = [...rankCards, kicker];
      const quadValue = getRankValue(rank);
      return {
        rank: HandRank.FOUR_OF_A_KIND,
        values: [quadValue, quadValue, quadValue, quadValue, getRankValue(kicker.rank)],
        cards: handCards,
        description: `Four of a Kind, ${rank}s`,
      };
    }
  }

  return null;
}

/**
 * Check for Full House
 */
function checkFullHouse(cards: PokerCard[]): EvaluatedHand | null {
  const byRank = groupByRank(cards);
  const trips: [string, PokerCard[]][] = [];
  const pairs: [string, PokerCard[]][] = [];

  for (const [rank, rankCards] of byRank) {
    if (rankCards.length >= 3) trips.push([rank, rankCards]);
    if (rankCards.length >= 2) pairs.push([rank, rankCards]);
  }

  if (trips.length === 0) return null;

  // Sort trips by rank value (descending)
  trips.sort((a, b) => getRankValue(b[0]) - getRankValue(a[0]));
  const [tripRank, tripCards] = trips[0];

  // Find best pair (excluding the trips rank)
  const validPairs = pairs.filter(([r]) => r !== tripRank);
  if (validPairs.length === 0) {
    // Check if we have two trips (use second trip as pair)
    if (trips.length >= 2) {
      const [pairRank, pairCards] = trips[1];
      const handCards = [...tripCards.slice(0, 3), ...pairCards.slice(0, 2)];
      const tripValue = getRankValue(tripRank);
      const pairValue = getRankValue(pairRank);
      return {
        rank: HandRank.FULL_HOUSE,
        values: [tripValue, tripValue, tripValue, pairValue, pairValue],
        cards: handCards,
        description: `Full House, ${tripRank}s full of ${pairRank}s`,
      };
    }
    return null;
  }

  validPairs.sort((a, b) => getRankValue(b[0]) - getRankValue(a[0]));
  const [pairRank, pairCards] = validPairs[0];

  const handCards = [...tripCards.slice(0, 3), ...pairCards.slice(0, 2)];
  const tripValue = getRankValue(tripRank);
  const pairValue = getRankValue(pairRank);

  return {
    rank: HandRank.FULL_HOUSE,
    values: [tripValue, tripValue, tripValue, pairValue, pairValue],
    cards: handCards,
    description: `Full House, ${tripRank}s full of ${pairRank}s`,
  };
}

/**
 * Check for Flush
 */
function checkFlush(cards: PokerCard[]): EvaluatedHand | null {
  const bySuit = groupBySuit(cards);

  for (const [suit, suitCards] of bySuit) {
    if (suitCards.length >= 5) {
      const sorted = sortByRank(suitCards).slice(0, 5);
      return {
        rank: HandRank.FLUSH,
        values: sorted.map((c) => getRankValue(c.rank)),
        cards: sorted,
        description: `Flush, ${sorted[0].rank}-high (${suit})`,
      };
    }
  }

  return null;
}

/**
 * Check for Straight
 */
function checkStraight(cards: PokerCard[]): EvaluatedHand | null {
  const highCard = getStraightHighCard(cards);
  if (highCard === null) return null;

  const straightCards = getStraightCards(cards, highCard);
  if (straightCards.length !== 5) return null;

  return {
    rank: HandRank.STRAIGHT,
    values: straightCards.map((c) => getRankValue(c.rank, highCard === 5)),
    cards: straightCards,
    description: `Straight, ${highCard === 14 ? 'Ace' : highCard}-high`,
  };
}

/**
 * Check for Three of a Kind
 */
function checkThreeOfAKind(cards: PokerCard[]): EvaluatedHand | null {
  const byRank = groupByRank(cards);

  const trips: [string, PokerCard[]][] = [];
  for (const [rank, rankCards] of byRank) {
    if (rankCards.length >= 3) trips.push([rank, rankCards]);
  }

  if (trips.length === 0) return null;

  trips.sort((a, b) => getRankValue(b[0]) - getRankValue(a[0]));
  const [tripRank, tripCards] = trips[0];

  const kickers = sortByRank(cards.filter((c) => c.rank !== tripRank)).slice(0, 2);
  const handCards = [...tripCards.slice(0, 3), ...kickers];
  const tripValue = getRankValue(tripRank);

  return {
    rank: HandRank.THREE_OF_A_KIND,
    values: [tripValue, tripValue, tripValue, ...kickers.map((c) => getRankValue(c.rank))],
    cards: handCards,
    description: `Three of a Kind, ${tripRank}s`,
  };
}

/**
 * Check for Two Pair
 */
function checkTwoPair(cards: PokerCard[]): EvaluatedHand | null {
  const byRank = groupByRank(cards);

  const pairs: [string, PokerCard[]][] = [];
  for (const [rank, rankCards] of byRank) {
    if (rankCards.length >= 2) pairs.push([rank, rankCards]);
  }

  if (pairs.length < 2) return null;

  pairs.sort((a, b) => getRankValue(b[0]) - getRankValue(a[0]));
  const [highPairRank, highPairCards] = pairs[0];
  const [lowPairRank, lowPairCards] = pairs[1];

  const kicker = sortByRank(
    cards.filter((c) => c.rank !== highPairRank && c.rank !== lowPairRank)
  )[0];

  const handCards = [...highPairCards.slice(0, 2), ...lowPairCards.slice(0, 2), kicker];
  const highValue = getRankValue(highPairRank);
  const lowValue = getRankValue(lowPairRank);

  return {
    rank: HandRank.TWO_PAIR,
    values: [highValue, highValue, lowValue, lowValue, getRankValue(kicker.rank)],
    cards: handCards,
    description: `Two Pair, ${highPairRank}s and ${lowPairRank}s`,
  };
}

/**
 * Check for Pair
 */
function checkPair(cards: PokerCard[]): EvaluatedHand | null {
  const byRank = groupByRank(cards);

  const pairs: [string, PokerCard[]][] = [];
  for (const [rank, rankCards] of byRank) {
    if (rankCards.length >= 2) pairs.push([rank, rankCards]);
  }

  if (pairs.length === 0) return null;

  pairs.sort((a, b) => getRankValue(b[0]) - getRankValue(a[0]));
  const [pairRank, pairCards] = pairs[0];

  const kickers = sortByRank(cards.filter((c) => c.rank !== pairRank)).slice(0, 3);
  const handCards = [...pairCards.slice(0, 2), ...kickers];
  const pairValue = getRankValue(pairRank);

  return {
    rank: HandRank.PAIR,
    values: [pairValue, pairValue, ...kickers.map((c) => getRankValue(c.rank))],
    cards: handCards,
    description: `Pair of ${pairRank}s`,
  };
}

/**
 * Get High Card hand
 */
function getHighCard(cards: PokerCard[]): EvaluatedHand {
  const sorted = sortByRank(cards).slice(0, 5);
  return {
    rank: HandRank.HIGH_CARD,
    values: sorted.map((c) => getRankValue(c.rank)),
    cards: sorted,
    description: `High Card, ${sorted[0].rank}`,
  };
}

// ============================================================================
// Main Evaluation Functions
// ============================================================================

/**
 * Evaluate the best 5-card hand from a set of cards
 *
 * @param cards - Array of cards (typically 7 for Texas Hold'em)
 * @returns The best possible hand evaluation
 */
export function evaluateHand(cards: PokerCard[]): EvaluatedHand {
  if (cards.length < 5) {
    throw new Error('Need at least 5 cards to evaluate a hand');
  }

  // Check hands in order of strength (highest first)
  return (
    checkRoyalFlush(cards) ??
    checkStraightFlush(cards) ??
    checkFourOfAKind(cards) ??
    checkFullHouse(cards) ??
    checkFlush(cards) ??
    checkStraight(cards) ??
    checkThreeOfAKind(cards) ??
    checkTwoPair(cards) ??
    checkPair(cards) ??
    getHighCard(cards)
  );
}

/**
 * Compare two evaluated hands
 *
 * @returns -1 if hand1 loses, 0 if tie, 1 if hand1 wins
 */
export function compareHands(hand1: EvaluatedHand, hand2: EvaluatedHand): HandComparisonResult {
  // Compare by rank first
  if (hand1.rank > hand2.rank) return 1;
  if (hand1.rank < hand2.rank) return -1;

  // Same rank, compare by values (kickers)
  for (let i = 0; i < Math.min(hand1.values.length, hand2.values.length); i++) {
    if (hand1.values[i] > hand2.values[i]) return 1;
    if (hand1.values[i] < hand2.values[i]) return -1;
  }

  // Exact tie
  return 0;
}

/**
 * Find the best hand from hole cards and community cards
 *
 * @param holeCards - Player's 2 hole cards
 * @param communityCards - The 5 community cards (flop, turn, river)
 * @returns The best possible hand
 */
export function findBestHand(holeCards: PokerCard[], communityCards: PokerCard[]): EvaluatedHand {
  const allCards = [...holeCards, ...communityCards];
  return evaluateHand(allCards);
}

/**
 * Determine winners from a list of players and their hands
 *
 * @param playerHands - Map of player ID to their evaluated hand
 * @returns Array of winner player IDs (multiple if tie)
 */
export function determineWinners(playerHands: Map<string, EvaluatedHand>): string[] {
  if (playerHands.size === 0) return [];
  if (playerHands.size === 1) {
    const firstKey = playerHands.keys().next().value;
    return firstKey ? [firstKey] : [];
  }

  const entries = [...playerHands.entries()];
  let winners = [entries[0][0]];
  let bestHand = entries[0][1];

  for (let i = 1; i < entries.length; i++) {
    const [playerId, hand] = entries[i];
    const comparison = compareHands(hand, bestHand);

    if (comparison > 0) {
      // New best hand
      winners = [playerId];
      bestHand = hand;
    } else if (comparison === 0) {
      // Tie
      winners.push(playerId);
    }
  }

  return winners;
}

/**
 * Get a human-readable description of a hand rank
 */
export function getHandRankName(rank: HandRank): string {
  return HAND_RANK_NAMES[rank];
}
