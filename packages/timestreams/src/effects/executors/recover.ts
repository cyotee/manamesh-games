import { hasTag, tagNumber, isOptionalFor } from '../tags';
import { done, needs, type Executor } from '../types';

function needsHandCost(card: { tags?: string[] }): boolean {
  return (card.tags ?? []).some(
    (t) => t === 'cost:discard-from-hand:1' || t.startsWith('cost:discard-from-hand:'),
  );
}

export const recoverExecutor: Executor = ({ G, playerId, card, choices }) => {
  const player = G.players[playerId];
  if (!player) return done([`${card.id}: no player`]);

  const count = tagNumber(card, 'recover:from-discard') ?? 1;
  const toHand = hasTag(card, 'recover:to-hand');
  const toDeck = hasTag(card, 'recover:to-deck');
  if (!toHand && !toDeck) {
    return done([`${card.id}: recover fizzles (no destination)`]);
  }

  const optional = isOptionalFor(card, 'recover') || hasTag(card, 'recover:optional');
  const recoverId = `${card.id}:recover`;
  const costId = `${card.id}:recover-cost`;
  const payCost = needsHandCost(card);

  // 1. Resolve / prompt which discard card(s) to recover.
  let picks: string[];
  if (hasTag(card, 'recover:target:top-of-discard')) {
    const top = player.discard[player.discard.length - 1];
    picks = top ? [top.id] : [];
    if (picks.length === 0) {
      return done([`${card.id}: recover fizzles (empty discard)`]);
    }
  } else if (choices[recoverId] !== undefined) {
    const c = choices[recoverId];
    picks = Array.isArray(c) ? c : c === '' || c === '__none__' ? [] : [c];
  } else {
    const options = player.discard.map((c) => c.id);
    if (options.length === 0) {
      // Optional with empty discard — quiet no-op; mandatory fizzles the same way.
      return done([`${card.id}: recover fizzles (empty discard)`]);
    }
    // Optional: allow skip via min=0 (confirm with nothing selected) and explicit None.
    const opts = optional ? ['__none__', ...options] : options;
    return needs({
      id: recoverId,
      deciderId: playerId,
      kind: 'choose-card',
      options: opts,
      min: optional ? 0 : Math.min(count, options.length),
      max: Math.min(count, options.length),
      reason: toDeck ? 'recover:to-deck' : 'recover:from-discard',
    });
  }

  // Declined optional recover — do not charge cost.
  if (picks.length === 0) {
    return done([`${card.id}: recover declined`]);
  }

  // 2. Cost: discard a hand card (Water Wheel). Only after recover is chosen.
  let costPick: string | null = null;
  if (payCost) {
    if (choices[costId] !== undefined) {
      const c = choices[costId];
      costPick = Array.isArray(c) ? c[0] ?? null : c === '' || c === '__none__' ? null : c;
      if (!costPick) {
        return done([`${card.id}: recover fizzles (no cost paid)`]);
      }
    } else {
      const options = player.hand
        .filter((c) => c.id !== card.id)
        .map((c) => c.id);
      if (options.length === 0) {
        return done([`${card.id}: recover fizzles (no card to pay)`]);
      }
      return needs({
        id: costId,
        deciderId: playerId,
        kind: 'choose-card',
        options,
        min: 1,
        max: 1,
        reason: 'cost:discard-from-hand:1',
      });
    }
  }

  // 3. Apply cost then recover.
  const log: string[] = [];
  if (payCost && costPick) {
    const idx = player.hand.findIndex((c) => c.id === costPick);
    if (idx === -1) {
      return done([`${card.id}: recover fizzles (cost card missing)`]);
    }
    const [paid] = player.hand.splice(idx, 1);
    player.discard.push(paid);
    log.push(`${card.id}: paid ${costPick} from hand`);
  }

  const recovered: typeof player.discard = [];
  for (const id of picks.slice(0, count)) {
    if (id === '__none__') continue;
    const idx = player.discard.findIndex((c) => c.id === id);
    if (idx === -1) continue;
    const [cardRec] = player.discard.splice(idx, 1);
    recovered.push(cardRec);
  }

  if (recovered.length === 0) {
    return done([`${card.id}: recover fizzles (picks not in discard)`]);
  }

  if (toDeck) {
    if (!G.encryptedDecks) G.encryptedDecks = {};
    if (!G.encryptedDecks[playerId]) G.encryptedDecks[playerId] = [];
    for (const c of recovered) {
      G.encryptedDecks[playerId].push({ ciphertext: c.id, layers: 0 } as any);
      log.push(`${card.id}: recovered ${c.id} to deck`);
    }
    // R15: always shuffle after recover-to-deck (play:shuffle-after is redundant).
    const deck = G.encryptedDecks[playerId];
    if (deck.length > 1) {
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      log.push(`${card.id}: shuffled deck after recover`);
    }
  } else {
    for (const c of recovered) {
      player.hand.push(c);
      log.push(`${card.id}: recovered ${c.id} to hand`);
    }
  }

  return done(log);
};
