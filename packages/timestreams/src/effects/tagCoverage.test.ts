// src/effects/tagCoverage.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PACKS = join(__dirname, '..', '..', 'assets', 'packs', 'timestreams');

/** Tag prefixes the M2 play pipeline consumes. */
const HANDLED_PREFIXES = [
  'play:', 'move:', 'move-source:', 'move-destination:', 'swap:', 'attach:', 'modify:',
  'discard:', 'draw:', 'opponents-draw:', 'recover:', 'prevent:', 'duration:',
  'requires:', 'rule:', 'government', 'protect:', 'target:', 'decider:', 'option-a:', 'option-b:',
  'forced:', 'trigger:', 'ongoing:', 'skip:', 'skip-turn:', 'allow:', 'extra-turn:', 'cost:',
  'condition:',
];

/** Score/react-phase families and named M2 deferrals (PRD: M3 + crypto-deck effects). */
const DEFERRED_PREFIXES = [
  'score:', 'react:', 'penalty:', 'bonus-points:', 'count:', 'copy:', 'perform:', 'cancel:',
  'if-true:', 'if-false:', 'branch:', 'delayed:', 'suppress:', 'steal:', 'retaliate:', 'redirect:',
  'replace:', 'guess:', 'set-value:', 'slots:', 'limit:', 'mutual-discard:', 'additional:',
  'extend:', 'peek:', 'to-hand:', 'return:', 'return-order:',
];

function allTags(): Set<string> {
  const tags = new Set<string>();
  for (const deck of readdirSync(PACKS)) {
    const file = join(PACKS, deck, 'manifest.json');
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    for (const card of manifest.cards ?? []) {
      for (const t of card.metadata?.tags ?? []) tags.add(t);
    }
  }
  return tags;
}

describe('tag coverage gate (PRD 12)', () => {
  it('every manifest tag is handled or explicitly deferred', () => {
    const unknown: string[] = [];
    for (const tag of allTags()) {
      const known = [...HANDLED_PREFIXES, ...DEFERRED_PREFIXES].some(p => tag === p || tag.startsWith(p));
      if (!known) unknown.push(tag);
    }
    expect(unknown, `unhandled tags: ${unknown.join(', ')}`).toEqual([]);
  });
});
