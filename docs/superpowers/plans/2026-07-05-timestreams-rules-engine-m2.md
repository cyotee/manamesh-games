# Timestreams Rules Engine M2 (Play Effects) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement tag-driven play-effect execution for Timestreams (PRD "M2"), so that playing a card validates its gates and resolves its `play:` tags against the shared timeline, with player choices surfaced as structured prompts.

**Architecture:** A new `src/effects/` module reads only `tags[]` + structural card fields (never `*EffectText`). Foundation layers (state accessors, tag queries, target resolution, protected board mutations, duration modifiers) support one executor per PRD §5 shape, dispatched by `resolvePlayEffect`. Choices round-trip: executors emit `PlayerPrompt`s with deterministic ids; the caller re-invokes with a `ChoiceMap`. Play-phase triggers (delayed traps and ongoing watchers) fire from events emitted by mutation primitives.

**Tech Stack:** TypeScript (ESM, workspace `@manamesh/timestreams`), vitest 1.x (`yarn vitest run`, tests colocated `src/**/*.test.ts`, globals enabled), boardgame.io 0.50 state-mutation style (direct mutation of `G`, as in existing `src/play.ts`).

## Global Constraints

- Spec: `packages/timestreams/RULES_ENGINE_PRD.md` (v2, 2026-07-05). PRD §3 rulings are binding; §4 tag grammar is the input language.
- Tags are the only behavior driver. Never parse `playEffectText`/`scoreEffectText`/`reactEffectText`/`addlCardText`.
- Optionality defaults (PRD §3.4): play/score effects are mandatory unless the family has an `:optional` tag; reacts are optional unless `trigger:mandatory`.
- Deciders come only from `decider:` tags (PRD §3.5) — never inferred.
- The engine must never filter player choices to options that resolve usefully (PRD §3.14 — combo enablement).
- Deck membership = card-id prefix after stripping instance suffix `#N` (PRD §2): `stone-age-`, `medieval-`, `modern-`, `future-tech-`.
- All commands below run from `packages/timestreams/`. Run tests with `yarn vitest run <file>`.
- All new state fields are **optional** on `TimestreamsState` with lazy-init accessors, so existing M1 tests stay green.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Out of scope for M2** (do not implement; the coverage test in Task 16 lists them as deferred): all `score:`-phase execution and `react:` prompting during scoring (M3); crypto-deck manipulation effects — Fortune Teller (`play:peek`), Think About the Future (`play:search-deck`), Recycling's shuffle-back (`recover:to-deck`, `play:shuffle-after`); Telecommunications `extend:today-effects-to-yesterday`; Biotechnology `play:copy` (needs executor recursion against another card's tags); Chaos Theory/Nanotech/Alphabet (score phase).

---

### Task 1: Engine state extensions, card registry, and test fixtures

**Files:**
- Modify: `src/types.ts` (append after the `TimestreamsState` interface's existing fields and after the interface — see step 3)
- Create: `src/effects/state.ts`
- Create: `src/effects/testFixtures.ts`
- Modify: `src/play.ts:26-71` (register played cards)
- Test: `src/effects/state.test.ts`

**Interfaces:**
- Consumes: `TimestreamsState`, `TimestreamsCard`, `EraId` from `../types`; `createTimeline` from `../timeline`.
- Produces (used by every later task):
  - `getCards(G): Record<string, TimestreamsCard>`, `registerCard(G, card): void`, `getCard(G, cardId): TimestreamsCard | undefined`, `requireCard(G, cardId): TimestreamsCard`
  - `getAttachments(G): Record<string, string[]>`, `getModifiers(G): ActiveModifier[]`, `getPendingTriggers(G): PendingTrigger[]`, `getTurnFlags(G, playerId): TurnFlags`
  - Fixtures: `makeCard(partial): TimestreamsCard`, `makeState(opts): TimestreamsState`, `putInEra(G, era, ...cards): void`, `putInHand(G, playerId, ...cards): void`

- [ ] **Step 1: Write the failing test**

```ts
// src/effects/state.test.ts
import { describe, it, expect } from 'vitest';
import { getCards, registerCard, requireCard, getAttachments, getModifiers, getPendingTriggers, getTurnFlags } from './state';
import { makeCard, makeState, putInEra, putInHand } from './testFixtures';

describe('engine state accessors', () => {
  it('lazily initializes registry and registers cards', () => {
    const G = makeState({ players: ['0', '1'] });
    expect(getCards(G)).toEqual({});
    const card = makeCard({ id: 'stone-age-fire#0', name: 'Fire', ownerId: '0' });
    registerCard(G, card);
    expect(requireCard(G, 'stone-age-fire#0').name).toBe('Fire');
  });

  it('lazily initializes attachments, modifiers, triggers, turn flags', () => {
    const G = makeState({ players: ['0'] });
    expect(getAttachments(G)).toEqual({});
    expect(getModifiers(G)).toEqual([]);
    expect(getPendingTriggers(G)).toEqual([]);
    expect(getTurnFlags(G, '0')).toEqual({
      skipNextTurn: false, extraTurns: 0, noInventionThisTurn: false, allowNextInventionEra: null,
    });
  });

  it('fixture helpers place cards in eras and hands and register them', () => {
    const G = makeState({ players: ['0'], currentDay: 5 });
    const inv = makeCard({ id: 'modern-clean-power#0', ownerId: '0', tags: ['protect:self', 'protect:discard'] });
    putInEra(G, 'modern', inv);
    expect(G.timeline.modern.stack).toEqual(['modern-clean-power#0']);
    expect(requireCard(G, 'modern-clean-power#0').tags).toContain('protect:self');
    const held = makeCard({ id: 'modern-napalm#0', ownerId: '0', cardType: 'action' });
    putInHand(G, '0', held);
    expect(G.players['0'].hand.map(c => c.id)).toEqual(['modern-napalm#0']);
  });

  it('requireCard throws on unknown id', () => {
    const G = makeState({ players: ['0'] });
    expect(() => requireCard(G, 'nope')).toThrow(/unknown card/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/effects/state.test.ts`
Expected: FAIL — cannot resolve `./state` / `./testFixtures`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/types.ts` (top level, after `TimestreamsState`):

```ts
// =============================================================================
// Rules Engine State (M2) — optional fields, lazily initialized by src/effects/state.ts
// =============================================================================

/** A duration-limited continuous effect (PRD §9). */
export interface ActiveModifier {
  sourceCardId: string;
  ownerId: string;
  kind: 'prevent-action-play' | 'prevent-move-future' | 'prevent-move-past';
  duration: 'rest-of-today' | 'rest-of-game';
}

/** A registered delayed (one-shot) or ongoing trigger (PRD §7.1, §9). */
export interface PendingTrigger {
  sourceCardId: string;
  ownerId: string;
  event: 'action-played' | 'invention-played' | 'discarded-from-play';
  /** Era to watch; null = anywhere. Anchored eras follow PRD §3.8. */
  eraAnchor: EraId | null;
  limit: 'once' | 'ongoing';
  spent: boolean;
}

/** Per-player turn-manipulation flags (extra turns, skips, Navigation). */
export interface TurnFlags {
  skipNextTurn: boolean;
  extraTurns: number;
  /** During an Androids extra turn: inventions may not be played. */
  noInventionThisTurn: boolean;
  /** Navigation: next invention may be played into this scope instead of Today. */
  allowNextInventionEra: 'yesterday-or-tomorrow' | null;
}
```

Add to the `TimestreamsState` interface (inside it, after `winner`):

```ts
  /** M2 rules engine: id -> full card for every card in public play. */
  cards?: Record<string, TimestreamsCard>;
  /** M2 rules engine: hostCardId -> attached action card ids. */
  attachments?: Record<string, string[]>;
  /** M2 rules engine: active duration modifiers. */
  modifiers?: ActiveModifier[];
  /** M2 rules engine: registered delayed/ongoing triggers. */
  pendingTriggers?: PendingTrigger[];
  /** M2 rules engine: per-player turn flags. */
  turnFlags?: Record<string, TurnFlags>;
```

Create `src/effects/state.ts`:

```ts
import type { TimestreamsState, TimestreamsCard, ActiveModifier, PendingTrigger, TurnFlags } from '../types';

export function getCards(G: TimestreamsState): Record<string, TimestreamsCard> {
  if (!G.cards) G.cards = {};
  return G.cards;
}

export function registerCard(G: TimestreamsState, card: TimestreamsCard): void {
  getCards(G)[card.id] = card;
}

export function getCard(G: TimestreamsState, cardId: string): TimestreamsCard | undefined {
  return getCards(G)[cardId];
}

export function requireCard(G: TimestreamsState, cardId: string): TimestreamsCard {
  const card = getCard(G, cardId);
  if (!card) throw new Error(`unknown card: ${cardId}`);
  return card;
}

export function getAttachments(G: TimestreamsState): Record<string, string[]> {
  if (!G.attachments) G.attachments = {};
  return G.attachments;
}

export function getModifiers(G: TimestreamsState): ActiveModifier[] {
  if (!G.modifiers) G.modifiers = [];
  return G.modifiers;
}

export function getPendingTriggers(G: TimestreamsState): PendingTrigger[] {
  if (!G.pendingTriggers) G.pendingTriggers = [];
  return G.pendingTriggers;
}

export function getTurnFlags(G: TimestreamsState, playerId: string): TurnFlags {
  if (!G.turnFlags) G.turnFlags = {};
  if (!G.turnFlags[playerId]) {
    G.turnFlags[playerId] = {
      skipNextTurn: false, extraTurns: 0, noInventionThisTurn: false, allowNextInventionEra: null,
    };
  }
  return G.turnFlags[playerId];
}
```

Create `src/effects/testFixtures.ts`:

```ts
import type { TimestreamsState, TimestreamsCard, EraId } from '../types';
import { DEFAULT_CONFIG } from '../types';
import { createTimeline } from '../timeline';
import { registerCard } from './state';

let seq = 0;

export function makeCard(partial: Partial<TimestreamsCard> & { id?: string }): TimestreamsCard {
  return {
    id: partial.id ?? `test-card#${seq++}`,
    name: partial.name ?? partial.id ?? 'Test Card',
    ownerId: partial.ownerId ?? '0',
    cardType: partial.cardType ?? 'invention',
    subtypes: partial.subtypes ?? [],
    hasPlayEffect: partial.hasPlayEffect ?? (partial.tags ?? []).some(t => t.startsWith('play:')),
    hasScoreEffect: partial.hasScoreEffect ?? false,
    hasReact: partial.hasReact ?? (partial.tags ?? []).some(t => t.startsWith('react:')),
    scoreValue: partial.scoreValue,
    tags: partial.tags ?? [],
  } as TimestreamsCard;
}

export function makeState(opts: { players: string[]; currentDay?: number }): TimestreamsState {
  const players: TimestreamsState['players'] = {};
  for (const pid of opts.players) {
    players[pid] = {
      homeEra: null, ready: true, hand: [], discard: [], scorePile: [],
      hasPassedThisDay: false, publicKey: null, hasEncrypted: false, hasShuffled: false,
    };
  }
  return {
    players,
    playerOrder: [...opts.players],
    config: { ...DEFAULT_CONFIG },
    phase: 'play',
    timeline: createTimeline(),
    currentDay: opts.currentDay ?? 1,
    dayFirstPlayer: opts.players[0],
    encryptedDecks: {},
    cardPoints: {},
    shuffleRng: null,
    eraAssignmentRng: null,
    pendingDecryptRequests: [],
    setupPlayerIndex: 0,
    cardVisibility: {},
    proofChain: [],
    scores: {},
    winner: null,
  };
}

export function putInEra(G: TimestreamsState, era: EraId, ...cards: TimestreamsCard[]): void {
  for (const card of cards) {
    registerCard(G, card);
    G.timeline[era].stack.push(card.id);
  }
}

export function putInHand(G: TimestreamsState, playerId: string, ...cards: TimestreamsCard[]): void {
  for (const card of cards) {
    registerCard(G, card);
    G.players[playerId].hand.push(card);
  }
}
```

In `src/play.ts`, register cards as they become public. Add the import:

```ts
import { registerCard } from "./effects/state";
```

In `playInvention` (after `removeCardFromHand(player, cardId);`, before `appendToEra`):

```ts
  registerCard(G, card);
```

In `playAction` (after `removeCardFromHand(player, cardId);`):

```ts
  registerCard(G, card);
```

- [ ] **Step 4: Run tests to verify they pass, plus the whole suite**

Run: `yarn vitest run src/effects/state.test.ts` — Expected: PASS (4 tests).
Run: `yarn vitest run` — Expected: no new failures (3 pre-existing failures in `src/homeEra.test.ts` are known and unrelated).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/effects/state.ts src/effects/testFixtures.ts src/effects/state.test.ts src/play.ts
git commit -m "feat(timestreams): engine state extensions and card registry (M2 task 1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Tag query utilities

**Files:**
- Create: `src/effects/tags.ts`
- Test: `src/effects/tags.test.ts`

**Interfaces:**
- Consumes: `TimestreamsCard` from `../types`.
- Produces:
  - `hasTag(card, tag: string): boolean`
  - `tagValue(card, prefix: string): string | undefined` — remainder after `${prefix}:` of the first matching tag
  - `tagNumber(card, prefix: string): number | undefined` — `tagValue` parsed as integer (supports `+1`/`-1`)
  - `tagsWithPrefix(card, prefix: string): string[]` — remainders of all matching tags
  - `isOptionalFor(card, family: string): boolean` — true iff `${family}:optional` present
  - `baseCardId(instanceId: string): string` — strips `#N` suffix
  - `isDeckMember(cardId: string, deck: 'stone-age' | 'medieval' | 'modern' | 'future-tech'): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// src/effects/tags.test.ts
import { describe, it, expect } from 'vitest';
import { hasTag, tagValue, tagNumber, tagsWithPrefix, isOptionalFor, baseCardId, isDeckMember } from './tags';
import { makeCard } from './testFixtures';

describe('tag utilities', () => {
  const card = makeCard({
    id: 'medieval-telescope#0',
    tags: ['score:swap', 'swap:target:invention', 'swap:count:2', 'swap:scope:next-era', 'target:exclude-self', 'modify:amount:+1'],
  });

  it('hasTag exact match only', () => {
    expect(hasTag(card, 'score:swap')).toBe(true);
    expect(hasTag(card, 'score')).toBe(false);
  });

  it('tagValue returns remainder after prefix', () => {
    expect(tagValue(card, 'swap:target')).toBe('invention');
    expect(tagValue(card, 'swap:scope')).toBe('next-era');
    expect(tagValue(card, 'nope')).toBeUndefined();
  });

  it('tagNumber parses ints including signed', () => {
    expect(tagNumber(card, 'swap:count')).toBe(2);
    expect(tagNumber(card, 'modify:amount')).toBe(1);
    expect(tagNumber(makeCard({ tags: ['modify:amount:-1'] }), 'modify:amount')).toBe(-1);
  });

  it('tagsWithPrefix returns all remainders', () => {
    const multi = makeCard({ tags: ['target:subtype:nanotech', 'target:subtype:quantum-computing'] });
    expect(tagsWithPrefix(multi, 'target:subtype')).toEqual(['nanotech', 'quantum-computing']);
  });

  it('isOptionalFor implements PRD 3.4 default-mandatory', () => {
    expect(isOptionalFor(makeCard({ tags: ['play:move', 'move:optional'] }), 'move')).toBe(true);
    expect(isOptionalFor(makeCard({ tags: ['play:move'] }), 'move')).toBe(false);
  });

  it('deck membership strips instance suffix (PRD 2)', () => {
    expect(baseCardId('stone-age-cloth#2')).toBe('stone-age-cloth');
    expect(isDeckMember('modern-inflation#0', 'modern')).toBe(true);
    expect(isDeckMember('modern-inflation#0', 'medieval')).toBe(false);
    expect(isDeckMember('future-tech-androids', 'future-tech')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/effects/tags.test.ts`
Expected: FAIL — cannot resolve `./tags`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/effects/tags.ts
import type { TimestreamsCard } from '../types';

export function hasTag(card: TimestreamsCard, tag: string): boolean {
  return card.tags?.includes(tag) ?? false;
}

export function tagsWithPrefix(card: TimestreamsCard, prefix: string): string[] {
  const p = `${prefix}:`;
  return (card.tags ?? []).filter(t => t.startsWith(p)).map(t => t.slice(p.length));
}

export function tagValue(card: TimestreamsCard, prefix: string): string | undefined {
  return tagsWithPrefix(card, prefix)[0];
}

export function tagNumber(card: TimestreamsCard, prefix: string): number | undefined {
  const v = tagValue(card, prefix);
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

export function isOptionalFor(card: TimestreamsCard, family: string): boolean {
  return hasTag(card, `${family}:optional`);
}

export function baseCardId(instanceId: string): string {
  const hash = instanceId.indexOf('#');
  return hash === -1 ? instanceId : instanceId.slice(0, hash);
}

export type DeckId = 'stone-age' | 'medieval' | 'modern' | 'future-tech';

export function isDeckMember(cardId: string, deck: DeckId): boolean {
  return baseCardId(cardId).startsWith(`${deck}-`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/effects/tags.test.ts` — Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/effects/tags.ts src/effects/tags.test.ts
git commit -m "feat(timestreams): tag query utilities (M2 task 2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Target resolution

**Files:**
- Create: `src/effects/targets.ts`
- Test: `src/effects/targets.test.ts`

**Interfaces:**
- Consumes: state accessors (Task 1), tag utils (Task 2), `eraForDay`/`dayForEra`/`ERA_ORDER` from `../timeline` and `../types`.
- Produces:
  - `locateCard(G, cardId): { era: EraId; index: number } | null`
  - `erasForScope(G, scope: string, refCardId?: string): EraId[]` — scopes: `today`, `tomorrow`, `yesterday`, `current-era`, `same-era`, `attached-era`, `any-era`, `next-era`, `this-or-previous-era`, `today-or-tomorrow`
  - `candidateTargets(G, opts: { kind: 'invention' | 'action' | 'any'; eras: EraId[]; excludeCardId?: string; subtypes?: string[] }): string[]`
  - `cardAtOffset(G, refCardId, offset: number): string | null` — positive = below (toward stack end), negative = above

- [ ] **Step 1: Write the failing test**

```ts
// src/effects/targets.test.ts
import { describe, it, expect } from 'vitest';
import { locateCard, erasForScope, candidateTargets, cardAtOffset } from './targets';
import { makeCard, makeState, putInEra } from './testFixtures';

function setup() {
  const G = makeState({ players: ['0', '1'], currentDay: 5 }); // Today = modern
  putInEra(G, 'modern',
    makeCard({ id: 'modern-clean-power#0', ownerId: '0' }),
    makeCard({ id: 'modern-dot-com#0', ownerId: '1' }),
    makeCard({ id: 'stone-age-fire#0', ownerId: '0' }),
  );
  putInEra(G, 'medieval', makeCard({ id: 'medieval-poetry#0', ownerId: '1', subtypes: ['poetry', 'art'] }));
  return G;
}

describe('target resolution', () => {
  it('locates cards by era and index', () => {
    const G = setup();
    expect(locateCard(G, 'modern-dot-com#0')).toEqual({ era: 'modern', index: 1 });
    expect(locateCard(G, 'nope')).toBeNull();
  });

  it('resolves scopes relative to Today (day 5 = modern)', () => {
    const G = setup();
    expect(erasForScope(G, 'today')).toEqual(['modern']);
    expect(erasForScope(G, 'tomorrow')).toEqual(['future']);
    expect(erasForScope(G, 'yesterday')).toEqual(['industrial']);
    expect(erasForScope(G, 'same-era', 'medieval-poetry#0')).toEqual(['medieval']);
    expect(erasForScope(G, 'this-or-previous-era', 'modern-dot-com#0'))
      .toEqual(['stone', 'medieval', 'renaissance', 'industrial', 'modern']);
    expect(erasForScope(G, 'any-era').length).toBe(6);
  });

  it('filters candidates by kind, subtype, and exclude-self', () => {
    const G = setup();
    expect(candidateTargets(G, { kind: 'invention', eras: ['modern'] }))
      .toEqual(['modern-clean-power#0', 'modern-dot-com#0', 'stone-age-fire#0']);
    expect(candidateTargets(G, { kind: 'invention', eras: ['modern'], excludeCardId: 'modern-dot-com#0' }))
      .toEqual(['modern-clean-power#0', 'stone-age-fire#0']);
    expect(candidateTargets(G, { kind: 'any', eras: ['medieval'], subtypes: ['art'] }))
      .toEqual(['medieval-poetry#0']);
    expect(candidateTargets(G, { kind: 'any', eras: ['medieval'], subtypes: ['government'] })).toEqual([]);
  });

  it('cardAtOffset walks the stack (positive = below)', () => {
    const G = setup();
    expect(cardAtOffset(G, 'modern-clean-power#0', 1)).toBe('modern-dot-com#0');
    expect(cardAtOffset(G, 'modern-dot-com#0', -1)).toBe('modern-clean-power#0');
    expect(cardAtOffset(G, 'stone-age-fire#0', 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/effects/targets.test.ts`
Expected: FAIL — cannot resolve `./targets`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/effects/targets.ts
import type { TimestreamsState, EraId } from '../types';
import { ERA_ORDER } from '../types';
import { eraForDay } from '../timeline';
import { getCard } from './state';

export interface CardLocation { era: EraId; index: number; }

export function locateCard(G: TimestreamsState, cardId: string): CardLocation | null {
  for (const era of ERA_ORDER) {
    const index = G.timeline[era].stack.indexOf(cardId);
    if (index !== -1) return { era, index };
  }
  return null;
}

function shiftEra(era: EraId, delta: number): EraId[] {
  const i = ERA_ORDER.indexOf(era) + delta;
  return i >= 0 && i < ERA_ORDER.length ? [ERA_ORDER[i]] : [];
}

export function erasForScope(G: TimestreamsState, scope: string, refCardId?: string): EraId[] {
  const today = eraForDay(Math.min(G.currentDay, ERA_ORDER.length));
  const refEra = refCardId ? locateCard(G, refCardId)?.era : undefined;
  switch (scope) {
    case 'today': return [today];
    case 'tomorrow': return shiftEra(today, 1);
    case 'yesterday': return shiftEra(today, -1);
    case 'today-or-tomorrow': return [today, ...shiftEra(today, 1)];
    case 'current-era':
    case 'same-era':
    case 'attached-era':
      return refEra ? [refEra] : [];
    case 'next-era':
      return refEra ? shiftEra(refEra, 1) : [];
    case 'this-or-previous-era':
      return refEra ? ERA_ORDER.slice(0, ERA_ORDER.indexOf(refEra) + 1) : [];
    case 'any-era': return [...ERA_ORDER];
    default:
      throw new Error(`unknown scope: ${scope}`);
  }
}

export function candidateTargets(
  G: TimestreamsState,
  opts: { kind: 'invention' | 'action' | 'any'; eras: EraId[]; excludeCardId?: string; subtypes?: string[] },
): string[] {
  const out: string[] = [];
  for (const era of opts.eras) {
    for (const cardId of G.timeline[era].stack) {
      if (cardId === opts.excludeCardId) continue;
      const card = getCard(G, cardId);
      if (!card) continue;
      if (opts.kind !== 'any' && card.cardType !== opts.kind) continue;
      if (opts.subtypes && !opts.subtypes.some(s => card.subtypes?.includes(s))) continue;
      out.push(cardId);
    }
  }
  return out;
}

export function cardAtOffset(G: TimestreamsState, refCardId: string, offset: number): string | null {
  const loc = locateCard(G, refCardId);
  if (!loc) return null;
  return G.timeline[loc.era].stack[loc.index + offset] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/effects/targets.test.ts` — Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/effects/targets.ts src/effects/targets.test.ts
git commit -m "feat(timestreams): target resolution from scope/kind/subtype tags (M2 task 3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Protected board mutations

**Files:**
- Create: `src/effects/boardOps.ts`
- Test: `src/effects/boardOps.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `effectiveScoreValue(G, cardId): number` — printed value plus `modify:score:attached` amounts from attachments (PRD §3.9)
  - `isMoveBlocked(G, cardId, actorPlayerId): string | null` — returns the blocking tag or null; checks the card's own `protect:self`+`protect:move` (honoring `protect:source:opponent`), and attached cards carrying `protect:target:attached`+`protect:move`
  - `isDiscardBlocked(G, cardId, actorPlayerId): string | null` — same for `protect:discard`
  - `moveWithinEra(G, cardId, toIndex): boolean`
  - `moveToEra(G, cardId, toEra, position: 'top' | 'bottom' | number): boolean`
  - `discardFromPlay(G, cardId, actorPlayerId): boolean` — removes from timeline (and its attachments) into owners' discard piles
  - `attachTo(G, actionCardId, hostCardId): void`

- [ ] **Step 1: Write the failing test**

```ts
// src/effects/boardOps.test.ts
import { describe, it, expect } from 'vitest';
import { effectiveScoreValue, isMoveBlocked, isDiscardBlocked, moveWithinEra, moveToEra, discardFromPlay, attachTo } from './boardOps';
import { makeCard, makeState, putInEra } from './testFixtures';
import { registerCard } from './state';

describe('board ops', () => {
  it('effectiveScoreValue applies attach modifiers (PRD 3.9)', () => {
    const G = makeState({ players: ['0'] });
    putInEra(G, 'modern', makeCard({ id: 'modern-dot-com#0', ownerId: '0', scoreValue: 4 }));
    const inflation = makeCard({
      id: 'modern-inflation#0', ownerId: '0', cardType: 'action',
      tags: ['play:attach', 'modify:score:attached', 'modify:amount:-1'],
    });
    registerCard(G, inflation);
    attachTo(G, 'modern-inflation#0', 'modern-dot-com#0');
    expect(effectiveScoreValue(G, 'modern-dot-com#0')).toBe(3);
  });

  it('protect:self + protect:move blocks moves; protect:source:opponent only blocks opponents', () => {
    const G = makeState({ players: ['0', '1'] });
    putInEra(G, 'stone',
      makeCard({ id: 'stone-age-damascus-steel#0', ownerId: '0', tags: ['protect:self', 'protect:move', 'protect:source:opponent'] }),
      makeCard({ id: 'stone-age-anarchy#0', ownerId: '0', tags: ['protect:self', 'protect:move', 'protect:discard', 'protect:value-change'] }),
    );
    expect(isMoveBlocked(G, 'stone-age-damascus-steel#0', '1')).toBe('protect:move');
    expect(isMoveBlocked(G, 'stone-age-damascus-steel#0', '0')).toBeNull(); // owner may move it
    expect(isMoveBlocked(G, 'stone-age-anarchy#0', '0')).toBe('protect:move'); // unqualified blocks everyone
    expect(isDiscardBlocked(G, 'stone-age-anarchy#0', '1')).toBe('protect:discard');
  });

  it('Hibernation on host blocks host moves/discards (protect:target:attached)', () => {
    const G = makeState({ players: ['0', '1'] });
    putInEra(G, 'stone', makeCard({ id: 'stone-age-cloth#0', ownerId: '0' }));
    const hib = makeCard({
      id: 'stone-age-hibernation#0', ownerId: '0', cardType: 'action',
      tags: ['play:attach', 'protect:target:attached', 'protect:move', 'protect:discard', 'duration:rest-of-game'],
    });
    registerCard(G, hib);
    attachTo(G, 'stone-age-hibernation#0', 'stone-age-cloth#0');
    expect(isMoveBlocked(G, 'stone-age-cloth#0', '1')).toBe('protect:move');
    expect(isDiscardBlocked(G, 'stone-age-cloth#0', '1')).toBe('protect:discard');
  });

  it('moveWithinEra and moveToEra reposition; blocked moves return false', () => {
    const G = makeState({ players: ['0'] });
    putInEra(G, 'modern',
      makeCard({ id: 'a#0', ownerId: '0' }), makeCard({ id: 'b#0', ownerId: '0' }), makeCard({ id: 'c#0', ownerId: '0' }),
    );
    expect(moveWithinEra(G, 'c#0', 0)).toBe(true);
    expect(G.timeline.modern.stack).toEqual(['c#0', 'a#0', 'b#0']);
    expect(moveToEra(G, 'a#0', 'future', 'top')).toBe(true);
    expect(G.timeline.future.stack).toEqual(['a#0']);
    expect(G.timeline.modern.stack).toEqual(['c#0', 'b#0']);
  });

  it('discardFromPlay sends card and its attachments to owner discards', () => {
    const G = makeState({ players: ['0', '1'] });
    putInEra(G, 'modern', makeCard({ id: 'host#0', ownerId: '0' }));
    const att = makeCard({ id: 'att#0', ownerId: '1', cardType: 'action' });
    registerCard(G, att);
    attachTo(G, 'att#0', 'host#0');
    expect(discardFromPlay(G, 'host#0', '1')).toBe(true);
    expect(G.timeline.modern.stack).toEqual([]);
    expect(G.players['0'].discard.map(c => c.id)).toEqual(['host#0']);
    expect(G.players['1'].discard.map(c => c.id)).toEqual(['att#0']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/effects/boardOps.test.ts`
Expected: FAIL — cannot resolve `./boardOps`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/effects/boardOps.ts
import type { TimestreamsState, EraId } from '../types';
import { getCard, requireCard, getAttachments } from './state';
import { hasTag, tagNumber } from './tags';
import { locateCard } from './targets';

export function effectiveScoreValue(G: TimestreamsState, cardId: string): number {
  const card = requireCard(G, cardId);
  let value = card.scoreValue ?? 0;
  for (const attId of getAttachments(G)[cardId] ?? []) {
    const att = getCard(G, attId);
    if (att && hasTag(att, 'modify:score:attached')) {
      value += tagNumber(att, 'modify:amount') ?? 0;
    }
  }
  return value;
}

function protectionBlocks(
  G: TimestreamsState, cardId: string, actorPlayerId: string, protectTag: 'protect:move' | 'protect:discard',
): string | null {
  const card = requireCard(G, cardId);
  // The card's own protection.
  if (hasTag(card, 'protect:self') && hasTag(card, protectTag)) {
    const opponentOnly = hasTag(card, 'protect:source:opponent');
    if (!opponentOnly || actorPlayerId !== card.ownerId) return protectTag;
  }
  // Protection granted by attachments (Hibernation).
  for (const attId of getAttachments(G)[cardId] ?? []) {
    const att = getCard(G, attId);
    if (att && hasTag(att, 'protect:target:attached') && hasTag(att, protectTag)) return protectTag;
  }
  return null;
}

export function isMoveBlocked(G: TimestreamsState, cardId: string, actorPlayerId: string): string | null {
  return protectionBlocks(G, cardId, actorPlayerId, 'protect:move');
}

export function isDiscardBlocked(G: TimestreamsState, cardId: string, actorPlayerId: string): string | null {
  return protectionBlocks(G, cardId, actorPlayerId, 'protect:discard');
}

function removeFromStack(G: TimestreamsState, cardId: string): EraId | null {
  const loc = locateCard(G, cardId);
  if (!loc) return null;
  G.timeline[loc.era].stack.splice(loc.index, 1);
  return loc.era;
}

export function moveWithinEra(G: TimestreamsState, cardId: string, toIndex: number): boolean {
  const loc = locateCard(G, cardId);
  if (!loc) return false;
  const stack = G.timeline[loc.era].stack;
  stack.splice(loc.index, 1);
  stack.splice(Math.max(0, Math.min(toIndex, stack.length)), 0, cardId);
  return true;
}

export function moveToEra(
  G: TimestreamsState, cardId: string, toEra: EraId, position: 'top' | 'bottom' | number,
): boolean {
  if (removeFromStack(G, cardId) === null) return false;
  const stack = G.timeline[toEra].stack;
  const index = position === 'top' ? 0 : position === 'bottom' ? stack.length : position;
  stack.splice(Math.max(0, Math.min(index, stack.length)), 0, cardId);
  return true;
}

export function attachTo(G: TimestreamsState, actionCardId: string, hostCardId: string): void {
  const attachments = getAttachments(G);
  if (!attachments[hostCardId]) attachments[hostCardId] = [];
  attachments[hostCardId].push(actionCardId);
}

export function discardFromPlay(G: TimestreamsState, cardId: string, _actorPlayerId: string): boolean {
  if (removeFromStack(G, cardId) === null) return false;
  const attachments = getAttachments(G);
  const attached = attachments[cardId] ?? [];
  delete attachments[cardId];
  for (const id of [cardId, ...attached]) {
    const card = requireCard(G, id);
    G.players[card.ownerId]?.discard.push(card);
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/effects/boardOps.test.ts` — Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/effects/boardOps.ts src/effects/boardOps.test.ts
git commit -m "feat(timestreams): protected board mutation primitives (M2 task 4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Duration modifiers and play gates

**Files:**
- Create: `src/effects/modifiers.ts`
- Create: `src/effects/gates.ts`
- Modify: `src/play.ts:97-110` (`endDay` clears rest-of-today modifiers)
- Test: `src/effects/gates.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `dayForEra` from `../timeline`.
- Produces:
  - `addModifier(G, m: ActiveModifier): void`, `clearRestOfToday(G): void`
  - `isActionPlayPrevented(G): boolean` (Smoke Signals)
  - `isMoveDirectionPrevented(G, fromEra: EraId, toEra: EraId): boolean` (Sundial `prevent-move-future`, Digital Secretary `prevent-move-past`)
  - `canPlayCard(G, playerId, cardId): { ok: boolean; reason?: string }` — checks `play:requires-card` (`requires:subtype:X`, `requires:scope:today|today-or-past`, `requires:in-scoring-slot`), `rule:one-government-per-era`, action-play prevention, and Androids-turn invention restriction (`noInventionThisTurn` flag)

- [ ] **Step 1: Write the failing test**

```ts
// src/effects/gates.test.ts
import { describe, it, expect } from 'vitest';
import { addModifier, clearRestOfToday, isActionPlayPrevented, isMoveDirectionPrevented } from './modifiers';
import { canPlayCard } from './gates';
import { makeCard, makeState, putInEra, putInHand } from './testFixtures';
import { getTurnFlags } from './state';

describe('modifiers', () => {
  it('rest-of-today modifiers clear; rest-of-game persist', () => {
    const G = makeState({ players: ['0'] });
    addModifier(G, { sourceCardId: 's#0', ownerId: '0', kind: 'prevent-action-play', duration: 'rest-of-today' });
    addModifier(G, { sourceCardId: 'h#0', ownerId: '0', kind: 'prevent-move-future', duration: 'rest-of-game' });
    expect(isActionPlayPrevented(G)).toBe(true);
    clearRestOfToday(G);
    expect(isActionPlayPrevented(G)).toBe(false);
    expect(isMoveDirectionPrevented(G, 'stone', 'future')).toBe(true);   // forward move
    expect(isMoveDirectionPrevented(G, 'future', 'stone')).toBe(false);  // backward not prevented by this modifier
  });
});

describe('canPlayCard gates', () => {
  it('requires:subtype searches Today and past per requires:scope', () => {
    const G = makeState({ players: ['0'], currentDay: 6 }); // Today = future
    const androids = makeCard({
      id: 'future-tech-androids#0', ownerId: '0',
      tags: ['play:requires-card', 'requires:subtype:nanotech', 'requires:scope:today-or-past'],
    });
    putInHand(G, '0', androids);
    expect(canPlayCard(G, '0', 'future-tech-androids#0').ok).toBe(false);
    putInEra(G, 'modern', makeCard({ id: 'future-tech-nanotech#0', ownerId: '0', subtypes: ['nanotech'] }));
    expect(canPlayCard(G, '0', 'future-tech-androids#0').ok).toBe(true);
  });

  it('requires:in-scoring-slot rejects matches past slot 6', () => {
    const G = makeState({ players: ['0'], currentDay: 5 }); // Today = modern
    const internet = makeCard({
      id: 'modern-the-internet#0', ownerId: '0',
      tags: ['play:requires-card', 'requires:subtype:telecommunications', 'requires:in-scoring-slot', 'requires:scope:today-or-past'],
    });
    putInHand(G, '0', internet);
    for (let i = 0; i < 6; i++) putInEra(G, 'modern', makeCard({ id: `filler-${i}#0`, ownerId: '0' }));
    putInEra(G, 'modern', makeCard({ id: 'modern-telecommunications#0', ownerId: '0', subtypes: ['telecommunications'] })); // slot 7
    expect(canPlayCard(G, '0', 'modern-the-internet#0').ok).toBe(false);
  });

  it('one government per era', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 1 }); // Today = stone
    putInEra(G, 'stone', makeCard({ id: 'stone-age-anarchy#0', ownerId: '1', subtypes: ['anarchy', 'government'] }));
    const monarchy = makeCard({
      id: 'medieval-monarchy#0', ownerId: '0', subtypes: ['monarchy', 'government'],
      tags: ['government', 'rule:one-government-per-era'],
    });
    putInHand(G, '0', monarchy);
    const res = canPlayCard(G, '0', 'medieval-monarchy#0');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('rule:one-government-per-era');
  });

  it('smoke-signals blocks actions; Androids turn blocks inventions', () => {
    const G = makeState({ players: ['0'] });
    putInHand(G, '0', makeCard({ id: 'modern-napalm#0', ownerId: '0', cardType: 'action', tags: ['play:discard:1'] }));
    addModifier(G, { sourceCardId: 's#0', ownerId: '0', kind: 'prevent-action-play', duration: 'rest-of-today' });
    expect(canPlayCard(G, '0', 'modern-napalm#0').reason).toBe('prevent:play:action');

    putInHand(G, '0', makeCard({ id: 'stone-age-fire#0', ownerId: '0', cardType: 'invention' }));
    getTurnFlags(G, '0').noInventionThisTurn = true;
    expect(canPlayCard(G, '0', 'stone-age-fire#0').reason).toBe('extra-turn:restriction:no-invention-play');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/effects/gates.test.ts`
Expected: FAIL — cannot resolve `./modifiers` / `./gates`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/effects/modifiers.ts
import type { TimestreamsState, ActiveModifier, EraId } from '../types';
import { dayForEra } from '../timeline';
import { getModifiers } from './state';

export function addModifier(G: TimestreamsState, m: ActiveModifier): void {
  getModifiers(G).push(m);
}

export function clearRestOfToday(G: TimestreamsState): void {
  const kept = getModifiers(G).filter(m => m.duration !== 'rest-of-today');
  G.modifiers = kept;
}

export function isActionPlayPrevented(G: TimestreamsState): boolean {
  return getModifiers(G).some(m => m.kind === 'prevent-action-play');
}

export function isMoveDirectionPrevented(G: TimestreamsState, fromEra: EraId, toEra: EraId): boolean {
  const forward = dayForEra(toEra) > dayForEra(fromEra);
  return getModifiers(G).some(m =>
    (m.kind === 'prevent-move-future' && forward) || (m.kind === 'prevent-move-past' && !forward),
  );
}
```

```ts
// src/effects/gates.ts
import type { TimestreamsState, EraId } from '../types';
import { ERA_ORDER } from '../types';
import { eraForDay } from '../timeline';
import { getCard, getTurnFlags } from './state';
import { hasTag, tagValue, tagsWithPrefix } from './tags';
import { isActionPlayPrevented } from './modifiers';

function requiredSubtypePresent(G: TimestreamsState, subtype: string, eras: EraId[], scoringSlotOnly: boolean): boolean {
  const slots = G.config.scoringSlots ?? 6;
  for (const era of eras) {
    const stack = scoringSlotOnly ? G.timeline[era].stack.slice(0, slots) : G.timeline[era].stack;
    for (const cardId of stack) {
      if (getCard(G, cardId)?.subtypes?.includes(subtype)) return true;
    }
  }
  return false;
}

export function canPlayCard(
  G: TimestreamsState, playerId: string, cardId: string,
): { ok: boolean; reason?: string } {
  const card = G.players[playerId]?.hand.find(c => c.id === cardId);
  if (!card) return { ok: false, reason: 'not-in-hand' };

  const today = eraForDay(Math.min(G.currentDay, ERA_ORDER.length));
  const todayIndex = ERA_ORDER.indexOf(today);

  if (card.cardType === 'action' && isActionPlayPrevented(G)) {
    return { ok: false, reason: 'prevent:play:action' };
  }
  if (card.cardType === 'invention' && getTurnFlags(G, playerId).noInventionThisTurn) {
    return { ok: false, reason: 'extra-turn:restriction:no-invention-play' };
  }

  if (hasTag(card, 'play:requires-card')) {
    const scope = tagValue(card, 'requires:scope') ?? 'today';
    const eras: EraId[] = scope === 'today-or-past' ? [...ERA_ORDER.slice(0, todayIndex + 1)] : [today];
    const slotOnly = hasTag(card, 'requires:in-scoring-slot');
    for (const subtype of tagsWithPrefix(card, 'requires:subtype')) {
      if (!requiredSubtypePresent(G, subtype, eras, slotOnly)) {
        return { ok: false, reason: `requires:subtype:${subtype}` };
      }
    }
  }

  if (hasTag(card, 'rule:one-government-per-era')) {
    const hasGov = G.timeline[today].stack.some(id => getCard(G, id)?.subtypes?.includes('government'));
    if (hasGov) return { ok: false, reason: 'rule:one-government-per-era' };
  }

  return { ok: true };
}
```

In `src/play.ts`, import and clear modifiers on day end. Add to imports:

```ts
import { clearRestOfToday } from "./effects/modifiers";
```

In `endDay`, insert as the first line of the function body:

```ts
  clearRestOfToday(G);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run src/effects/gates.test.ts` — Expected: PASS (5 tests).
Run: `yarn vitest run src/play.test.ts` — Expected: no new failures.

- [ ] **Step 5: Commit**

```bash
git add src/effects/modifiers.ts src/effects/gates.ts src/effects/gates.test.ts src/play.ts
git commit -m "feat(timestreams): duration modifiers and play gates (M2 task 5)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Effect pipeline, prompts, and the draw executor

**Files:**
- Create: `src/effects/types.ts`
- Create: `src/effects/resolvePlay.ts`
- Create: `src/effects/executors/draw.ts`
- Modify: `src/crypto.ts` (add `requestDraws` next to `dealForDay`, ~line 596)
- Test: `src/effects/resolvePlay.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5; `requestDraw` (private in `crypto.ts` — export a wrapper).
- Produces (all later executor tasks conform to these):

```ts
// exact shapes defined in src/effects/types.ts
export interface PlayerPrompt {
  id: string;                 // deterministic: `${cardId}:${key}`
  deciderId: string;
  kind: 'choose-card' | 'choose-option' | 'choose-position' | 'confirm';
  options: string[];
  min: number;
  max: number;
  reason: string;             // the tag that generated the prompt
}
export type ChoiceMap = Record<string, string | string[]>;
export interface EffectResult { ok: boolean; prompts: PlayerPrompt[]; log: string[]; }
export interface ExecCtx {
  G: TimestreamsState;
  playerId: string;
  card: TimestreamsCard;
  choices: ChoiceMap;
}
export type Executor = (ctx: ExecCtx) => EffectResult;
```

- `resolvePlayEffect(G, playerId, cardId, choices?: ChoiceMap): EffectResult` — dispatches every registered executor whose signature tag is present; merges results (all prompts collected; `ok` = every executor ok). Executors are **idempotent given the same ChoiceMap**: when a needed choice is absent they emit the prompt and make no mutation.
- `crypto.ts` gains: `export function requestDraws(G, playerId, count): number` — creates up to `count` cooperative draw requests for the top of the player's encrypted deck (indexes not already pending), tolerant of empty/short decks (same policy as `dealForDay`); returns how many were requested.

- [ ] **Step 1: Write the failing test**

```ts
// src/effects/resolvePlay.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from './resolvePlay';
import { makeCard, makeState, putInHand } from './testFixtures';

describe('resolvePlayEffect + draw executor', () => {
  it('play:draw:N requests N cooperative draws', () => {
    const G = makeState({ players: ['0', '1'] });
    G.encryptedDecks['0'] = [{}, {}, {}] as any; // 3 encrypted cards (opaque)
    const card = makeCard({ id: 'stone-age-fermented-fruit#0', ownerId: '0', tags: ['play:draw:2'] });
    putInHand(G, '0', card);
    const res = resolvePlayEffect(G, '0', 'stone-age-fermented-fruit#0');
    expect(res.ok).toBe(true);
    expect(res.prompts).toEqual([]);
    expect(G.pendingDecryptRequests.length).toBe(2);
    expect(res.log.some(l => l.includes('play:draw:2'))).toBe(true);
  });

  it('opponents-draw:1 requests draws for all other players', () => {
    const G = makeState({ players: ['0', '1', '2'] });
    G.encryptedDecks['1'] = [{}] as any;
    G.encryptedDecks['2'] = [{}] as any;
    const wg = makeCard({ id: 'modern-world-government#0', ownerId: '0', tags: ['play:draw:3', 'draw:to:self', 'opponents-draw:1'] });
    putInHand(G, '0', wg);
    resolvePlayEffect(G, '0', 'modern-world-government#0');
    const forOpponents = G.pendingDecryptRequests.filter(r => r.deckOwnerId !== '0');
    expect(forOpponents.length).toBe(2);
  });

  it('cards with no known play tags resolve ok with empty log', () => {
    const G = makeState({ players: ['0'] });
    const plain = makeCard({ id: 'stone-age-cloth#0', ownerId: '0', tags: ['react:move'] });
    putInHand(G, '0', plain);
    const res = resolvePlayEffect(G, '0', 'stone-age-cloth#0');
    expect(res).toEqual({ ok: true, prompts: [], log: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/effects/resolvePlay.test.ts`
Expected: FAIL — cannot resolve `./resolvePlay`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/effects/types.ts
import type { TimestreamsState, TimestreamsCard } from '../types';

export interface PlayerPrompt {
  id: string;
  deciderId: string;
  kind: 'choose-card' | 'choose-option' | 'choose-position' | 'confirm';
  options: string[];
  min: number;
  max: number;
  reason: string;
}

export type ChoiceMap = Record<string, string | string[]>;

export interface EffectResult { ok: boolean; prompts: PlayerPrompt[]; log: string[]; }

export interface ExecCtx {
  G: TimestreamsState;
  playerId: string;
  card: TimestreamsCard;
  choices: ChoiceMap;
}

export type Executor = (ctx: ExecCtx) => EffectResult;

export const OK: EffectResult = { ok: true, prompts: [], log: [] };

export function done(log: string[]): EffectResult {
  return { ok: true, prompts: [], log };
}

export function needs(prompt: PlayerPrompt): EffectResult {
  return { ok: true, prompts: [prompt], log: [] };
}

export function merge(...results: EffectResult[]): EffectResult {
  return {
    ok: results.every(r => r.ok),
    prompts: results.flatMap(r => r.prompts),
    log: results.flatMap(r => r.log),
  };
}
```

Add to `src/crypto.ts`, directly below `dealForDay` (uses the file's existing `requestDraw` helper):

```ts
/**
 * Request `count` cooperative draws from the top of a player's encrypted deck.
 * Skips indexes that already have a pending request. Tolerant of empty/short
 * decks (same policy as dealForDay). Returns how many requests were created.
 */
export function requestDraws(G: TimestreamsState, playerId: string, count: number): number {
  const deck = G.encryptedDecks[playerId];
  if (!deck || deck.length === 0) return 0;
  const pending = new Set(
    G.pendingDecryptRequests
      .filter(r => r.deckOwnerId === playerId && r.status !== 'complete')
      .map(r => r.cardIndex),
  );
  let created = 0;
  for (let i = 0; i < deck.length && created < count; i++) {
    if (pending.has(i)) continue;
    requestDraw(G, playerId, i, playerId);
    created++;
  }
  return created;
}
```

```ts
// src/effects/executors/draw.ts
import { requestDraws } from '../../crypto';
import { tagNumber } from '../tags';
import { done, type Executor } from '../types';

export const drawExecutor: Executor = ({ G, playerId, card }) => {
  const log: string[] = [];
  const n = tagNumber(card, 'play:draw');
  if (n !== undefined) {
    requestDraws(G, playerId, n);
    log.push(`${card.id}: play:draw:${n}`);
  }
  const opp = tagNumber(card, 'opponents-draw');
  if (opp !== undefined) {
    for (const pid of G.playerOrder) {
      if (pid === playerId) continue;
      requestDraws(G, pid, opp);
    }
    log.push(`${card.id}: opponents-draw:${opp}`);
  }
  return done(log);
};
```

```ts
// src/effects/resolvePlay.ts
import type { TimestreamsState } from '../types';
import { requireCard } from './state';
import { tagsWithPrefix, hasTag, tagValue } from './tags';
import { merge, OK, type ChoiceMap, type EffectResult, type Executor, type ExecCtx } from './types';
import { drawExecutor } from './executors/draw';

/** Executor registry: [applies?, executor]. Extended by later tasks. */
const EXECUTORS: Array<[applies: (ctx: ExecCtx) => boolean, run: Executor]> = [
  [({ card }) => tagValue(card, 'play:draw') !== undefined || tagValue(card, 'opponents-draw') !== undefined, drawExecutor],
];

export function resolvePlayEffect(
  G: TimestreamsState, playerId: string, cardId: string, choices: ChoiceMap = {},
): EffectResult {
  const card = requireCard(G, cardId) ?? G.players[playerId]?.hand.find(c => c.id === cardId);
  const ctx: ExecCtx = { G, playerId, card, choices };
  const results: EffectResult[] = [];
  for (const [applies, run] of EXECUTORS) {
    if (applies(ctx)) results.push(run(ctx));
  }
  return results.length ? merge(...results) : OK;
}

export { EXECUTORS };
```

Note: `requireCard` works because Task 1 made `playInvention`/`playAction` register the card first; the test registers via `putInHand`. If `requireCard` throws for hand-only cards in your test run, ensure `putInHand` registers (it does, per Task 1).

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/effects/resolvePlay.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/effects/types.ts src/effects/resolvePlay.ts src/effects/executors/draw.ts src/effects/resolvePlay.test.ts src/crypto.ts
git commit -m "feat(timestreams): effect pipeline, prompts, draw executor (M2 task 6)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Discard executor

**Files:**
- Create: `src/effects/executors/discard.ts`
- Modify: `src/effects/resolvePlay.ts` (register executor)
- Test: `src/effects/executors/discard.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6 (`candidateTargets`, `erasForScope`, `discardFromPlay`, `isDiscardBlocked`, prompt helpers).
- Produces: `discardExecutor: Executor` handling `play:discard:N` with `discard:target:*` (`invention`, `art`, `any-card`, `today:any`, `top-today`) + `discard:scope:*` + `discard:optional`. Prompt id: `${card.id}:discard`.

- [ ] **Step 1: Write the failing test**

```ts
// src/effects/executors/discard.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from '../resolvePlay';
import { makeCard, makeState, putInEra, putInHand } from '../testFixtures';

describe('discard executor', () => {
  function napalmSetup() {
    const G = makeState({ players: ['0', '1'], currentDay: 5 }); // Today = modern
    putInEra(G, 'modern', makeCard({ id: 'victim-a#0', ownerId: '1' }));
    putInEra(G, 'medieval', makeCard({ id: 'victim-b#0', ownerId: '1' }));
    putInEra(G, 'future', makeCard({ id: 'safe#0', ownerId: '1' }));
    const napalm = makeCard({
      id: 'modern-napalm#0', ownerId: '0', cardType: 'action',
      tags: ['play:discard:1', 'discard:target:invention', 'discard:scope:this-or-previous-era'],
    });
    putInHand(G, '0', napalm);
    putInEra(G, 'modern', makeCard({ id: 'modern-ref#0', ownerId: '0' })); // played reference not needed; napalm scopes off Today
    return G;
  }

  it('prompts with the legal target set, then discards the chosen card', () => {
    const G = napalmSetup();
    const first = resolvePlayEffect(G, '0', 'modern-napalm#0');
    expect(first.prompts).toHaveLength(1);
    const prompt = first.prompts[0];
    expect(prompt.id).toBe('modern-napalm#0:discard');
    expect(prompt.deciderId).toBe('0');
    expect(prompt.options).toContain('victim-a#0');
    expect(prompt.options).toContain('victim-b#0');
    expect(prompt.options).not.toContain('safe#0');

    const second = resolvePlayEffect(G, '0', 'modern-napalm#0', { 'modern-napalm#0:discard': 'victim-b#0' });
    expect(second.prompts).toEqual([]);
    expect(G.timeline.medieval.stack).toEqual([]);
    expect(G.players['1'].discard.map(c => c.id)).toEqual(['victim-b#0']);
  });

  it('discard:optional offers a skip; protected cards stay in the option set but fizzle (PRD 3.14)', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    putInEra(G, 'modern', makeCard({ id: 'modern-clean-power#0', ownerId: '1', tags: ['protect:self', 'protect:discard'] }));
    const laser = makeCard({
      id: 'modern-laser-show#0', ownerId: '0',
      tags: ['play:discard:1', 'discard:optional', 'discard:target:art', 'discard:scope:today'],
    });
    putInHand(G, '0', laser);
    const art = makeCard({ id: 'medieval-poetry#0', ownerId: '1', subtypes: ['poetry', 'art'] });
    putInEra(G, 'modern', art);
    const res = resolvePlayEffect(G, '0', 'modern-laser-show#0');
    expect(res.prompts[0].min).toBe(0); // optional
    expect(res.prompts[0].options).toEqual(['medieval-poetry#0']);
  });

  it('discard:target:top-today needs no prompt', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 2 }); // Today = medieval
    putInEra(G, 'medieval', makeCard({ id: 'top#0', ownerId: '1' }), makeCard({ id: 'under#0', ownerId: '1' }));
    const treb = makeCard({
      id: 'medieval-trebuchet#0', ownerId: '0',
      tags: ['play:discard:1', 'discard:optional', 'discard:target:top-today'],
    });
    putInHand(G, '0', treb);
    const res = resolvePlayEffect(G, '0', 'medieval-trebuchet#0', { 'medieval-trebuchet#0:discard': 'top#0' });
    expect(res.prompts).toEqual([]);
    expect(G.timeline.medieval.stack).toEqual(['under#0']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/effects/executors/discard.test.ts`
Expected: FAIL — prompts empty / executor not registered.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/effects/executors/discard.ts
import { hasTag, tagValue, tagNumber, isOptionalFor } from '../tags';
import { erasForScope, candidateTargets } from '../targets';
import { discardFromPlay, isDiscardBlocked } from '../boardOps';
import { done, needs, type Executor } from '../types';

export const discardExecutor: Executor = ({ G, playerId, card, choices }) => {
  const count = tagNumber(card, 'play:discard') ?? 1;
  const optional = isOptionalFor(card, 'discard');
  const target = tagValue(card, 'discard:target') ?? 'any-card';
  const scope = tagValue(card, 'discard:scope')
    ?? (target === 'top-today' || target === 'today:any' ? 'today' : 'today');

  const eras = erasForScope(G, scope, card.id);
  let options: string[];
  if (target === 'top-today') {
    const top = G.timeline[eras[0]].stack[0];
    options = top ? [top] : [];
  } else {
    const kind = target === 'invention' ? 'invention' : 'any';
    const subtypes = target === 'art' ? ['art'] : undefined;
    options = candidateTargets(G, { kind, eras, subtypes, excludeCardId: card.id });
  }

  const promptId = `${card.id}:discard`;
  const chosen = choices[promptId];
  if (chosen === undefined) {
    if (options.length === 0) return done([`${card.id}: discard fizzles (no targets)`]);
    return needs({
      id: promptId, deciderId: playerId, kind: 'choose-card',
      options, min: optional ? 0 : Math.min(count, options.length), max: count,
      reason: `discard:target:${target}`,
    });
  }

  const picks = Array.isArray(chosen) ? chosen : chosen === '' ? [] : [chosen];
  const log: string[] = [];
  for (const id of picks) {
    if (!options.includes(id)) continue;
    const blocked = isDiscardBlocked(G, id, playerId);
    if (blocked) { log.push(`${card.id}: discard of ${id} fizzles (${blocked})`); continue; }
    discardFromPlay(G, id, playerId);
    log.push(`${card.id}: discarded ${id}`);
  }
  return done(log);
};
```

Register in `src/effects/resolvePlay.ts` — add import and registry entry:

```ts
import { discardExecutor } from './executors/discard';
```

```ts
  [({ card }) => tagValue(card, 'play:discard') !== undefined, discardExecutor],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/effects/executors/discard.test.ts` — Expected: PASS (3 tests).
Run: `yarn vitest run src/effects` — Expected: all effects tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/effects/executors/discard.ts src/effects/executors/discard.test.ts src/effects/resolvePlay.ts
git commit -m "feat(timestreams): discard executor with prompts and fizzle logging (M2 task 7)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Move executors (self-move and targeted move)

**Files:**
- Create: `src/effects/executors/move.ts`
- Modify: `src/effects/resolvePlay.ts` (register)
- Test: `src/effects/executors/move.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6; `isMoveDirectionPrevented` (Task 5).
- Produces: `moveExecutor: Executor` handling `play:move` with:
  - self-moves: `move:target:self` + (`move:amount:N` + `move:direction:up` | `move-destination:top-today`)
  - fixed source/destination: `move-source:*` (`yesterday`, `bottom-yesterday`, `today`) + `move-destination:*` (`top-today`, `bottom-today`, `tomorrow`) — prompting for the card when the source is an era, deterministic when it's a position
  - chosen targets: `move:target:invention|action|any-card` + `move:scope:*` + `move:direction:up-or-down` + `move:amount:N`, or `move-destination:different-invention` (Advertising) / `any-position-same-era` (Internet, via `choose-position` prompt)
  - Prompt ids: `${card.id}:move-card`, `${card.id}:move-position`.
  - All era-crossing moves check `isMoveBlocked` and `isMoveDirectionPrevented`; blocked = logged fizzle (PRD §3.14).

- [ ] **Step 1: Write the failing test**

```ts
// src/effects/executors/move.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from '../resolvePlay';
import { makeCard, makeState, putInEra, putInHand } from '../testFixtures';
import { addModifier } from '../modifiers';

describe('move executor', () => {
  it('self-move up N within Today (The Wheel), optional', () => {
    const G = makeState({ players: ['0'], currentDay: 1 });
    putInEra(G, 'stone',
      makeCard({ id: 'x#0', ownerId: '0' }), makeCard({ id: 'y#0', ownerId: '0' }),
      makeCard({ id: 'stone-age-the-wheel#0', ownerId: '0', tags: ['play:move', 'move:optional', 'move:target:self', 'move:amount:2', 'move:direction:up', 'move:scope:today'] }),
    );
    const res = resolvePlayEffect(G, '0', 'stone-age-the-wheel#0', { 'stone-age-the-wheel#0:move-card': 'stone-age-the-wheel#0' });
    expect(res.prompts).toEqual([]);
    expect(G.timeline.stone.stack).toEqual(['stone-age-the-wheel#0', 'x#0', 'y#0']);
  });

  it('Vortex: choose an invention in Yesterday, put at bottom of Today', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 2 }); // Today = medieval, Yesterday = stone
    putInEra(G, 'stone', makeCard({ id: 'stone-age-fire#0', ownerId: '1' }));
    putInEra(G, 'medieval', makeCard({ id: 'already#0', ownerId: '0' }));
    const vortex = makeCard({
      id: 'stone-age-vortex#0', ownerId: '0', cardType: 'action',
      tags: ['play:move', 'move-source:yesterday', 'move-destination:bottom-today'],
    });
    putInHand(G, '0', vortex);
    const first = resolvePlayEffect(G, '0', 'stone-age-vortex#0');
    expect(first.prompts[0].options).toEqual(['stone-age-fire#0']);
    resolvePlayEffect(G, '0', 'stone-age-vortex#0', { 'stone-age-vortex#0:move-card': 'stone-age-fire#0' });
    expect(G.timeline.stone.stack).toEqual([]);
    expect(G.timeline.medieval.stack).toEqual(['already#0', 'stone-age-fire#0']);
  });

  it('Backwards Compatibility: deterministic bottom-yesterday -> top-today, no prompt', () => {
    const G = makeState({ players: ['0'], currentDay: 2 });
    putInEra(G, 'stone', makeCard({ id: 'a#0', ownerId: '0' }), makeCard({ id: 'b#0', ownerId: '0' }));
    const bc = makeCard({
      id: 'future-tech-backwards-compatibility#0', ownerId: '0', cardType: 'action',
      tags: ['play:move', 'move-source:bottom-yesterday', 'move-destination:top-today'],
    });
    putInHand(G, '0', bc);
    const res = resolvePlayEffect(G, '0', 'future-tech-backwards-compatibility#0');
    expect(res.prompts).toEqual([]);
    expect(G.timeline.medieval.stack).toEqual(['b#0']);
  });

  it('era-crossing move fizzles when direction is prevented (Sundial)', () => {
    const G = makeState({ players: ['0'], currentDay: 2 });
    putInEra(G, 'stone', makeCard({ id: 'stuck#0', ownerId: '0' }));
    addModifier(G, { sourceCardId: 's#0', ownerId: '0', kind: 'prevent-move-future', duration: 'rest-of-today' });
    const music = makeCard({
      id: 'stone-age-music#0', ownerId: '0',
      tags: ['play:move', 'move:target:any-card', 'move-source:today', 'move-destination:tomorrow'],
    });
    putInEra(G, 'medieval', music); // played invention sits in Today
    // move-source:today for day 2 = medieval; place a movable card there
    putInEra(G, 'medieval', makeCard({ id: 'movable#0', ownerId: '0' }));
    const res = resolvePlayEffect(G, '0', 'stone-age-music#0', { 'stone-age-music#0:move-card': 'movable#0' });
    expect(res.log.join(' ')).toMatch(/fizzles/);
    expect(G.timeline.medieval.stack).toContain('movable#0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/effects/executors/move.test.ts`
Expected: FAIL — executor not registered.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/effects/executors/move.ts
import type { EraId } from '../../types';
import { hasTag, tagValue, tagNumber, isOptionalFor } from '../tags';
import { erasForScope, candidateTargets, locateCard } from '../targets';
import { moveWithinEra, moveToEra, isMoveBlocked } from '../boardOps';
import { isMoveDirectionPrevented } from '../modifiers';
import { done, needs, merge, type Executor, type ExecCtx } from '../types';

interface Destination { era: EraId; position: 'top' | 'bottom'; }

function parseDestination(ctx: ExecCtx, dest: string): Destination | null {
  const { G, card } = ctx;
  const at = (scope: string) => erasForScope(G, scope, card.id)[0];
  switch (dest) {
    case 'top-today': return { era: at('today'), position: 'top' };
    case 'bottom-today': return { era: at('today'), position: 'bottom' };
    case 'tomorrow': {
      const era = erasForScope(G, 'tomorrow', card.id)[0];
      return era ? { era, position: 'bottom' } : null;
    }
    case 'top-of-era': {
      const era = locateCard(G, card.id)?.era;
      return era ? { era, position: 'top' } : null;
    }
    default: return null;
  }
}

function pickSource(ctx: ExecCtx): { options: string[]; deterministic?: string } {
  const { G, card } = ctx;
  const source = tagValue(card, 'move-source');
  if (source === 'bottom-yesterday') {
    const era = erasForScope(G, 'yesterday')[0];
    const stack = era ? G.timeline[era].stack : [];
    return { options: [], deterministic: stack[stack.length - 1] };
  }
  if (source === 'yesterday' || source === 'today') {
    const eras = erasForScope(G, source);
    const kind = tagValue(card, 'move:target') === 'any-card' ? 'any' : 'invention';
    return { options: candidateTargets(G, { kind, eras, excludeCardId: card.id }) };
  }
  // move:target driven (self or chosen)
  const target = tagValue(card, 'move:target');
  if (target === 'self') return { options: [], deterministic: card.id };
  const scope = tagValue(card, 'move:scope') ?? 'today';
  const kind = target === 'action' ? 'action' : target === 'any-card' ? 'any' : 'invention';
  const exclude = hasTag(card, 'target:exclude-self') || target !== 'any-card' ? card.id : undefined;
  return { options: candidateTargets(G, { kind, eras: erasForScope(G, scope, card.id), excludeCardId: exclude }) };
}

export const moveExecutor: Executor = (ctx) => {
  const { G, playerId, card, choices } = ctx;
  const promptId = `${card.id}:move-card`;
  const src = pickSource(ctx);

  let moving = src.deterministic ?? undefined;
  if (moving === undefined) {
    const chosen = choices[promptId];
    if (chosen === undefined) {
      if (src.options.length === 0) return done([`${card.id}: move fizzles (no targets)`]);
      return needs({
        id: promptId, deciderId: playerId, kind: 'choose-card',
        options: src.options, min: isOptionalFor(card, 'move') ? 0 : 1, max: 1,
        reason: 'play:move',
      });
    }
    if (chosen === '' || (Array.isArray(chosen) && chosen.length === 0)) return done([`${card.id}: move declined`]);
    moving = Array.isArray(chosen) ? chosen[0] : chosen;
  }
  if (!moving) return done([`${card.id}: move fizzles (nothing to move)`]);

  const from = locateCard(G, moving);
  if (!from) return done([`${card.id}: move fizzles (${moving} not in play)`]);

  const blocked = isMoveBlocked(G, moving, playerId);
  if (blocked) return done([`${card.id}: move of ${moving} fizzles (${blocked})`]);

  // Relative move within era (amount + direction)
  const amount = tagNumber(card, 'move:amount');
  if (amount !== undefined) {
    const dir = tagValue(card, 'move:direction') ?? 'up';
    let delta = -amount; // 'up' = toward index 0
    if (dir === 'up-or-down') {
      const posChoice = choices[`${card.id}:move-position`];
      if (posChoice === undefined) {
        return needs({
          id: `${card.id}:move-position`, deciderId: playerId, kind: 'choose-option',
          options: ['up', 'down'], min: 1, max: 1, reason: 'move:direction:up-or-down',
        });
      }
      delta = posChoice === 'down' ? amount : -amount;
    }
    moveWithinEra(G, moving, from.index + delta);
    return done([`${card.id}: moved ${moving} ${delta < 0 ? 'up' : 'down'} ${Math.abs(delta)}`]);
  }

  const destTag = tagValue(card, 'move-destination');
  const dest = destTag ? parseDestination(ctx, destTag) : null;
  if (!dest) return done([`${card.id}: move fizzles (no destination)`]);

  if (dest.era !== from.era && isMoveDirectionPrevented(G, from.era, dest.era)) {
    return done([`${card.id}: move of ${moving} to ${dest.era} fizzles (prevented direction)`]);
  }
  moveToEra(G, moving, dest.era, dest.position);
  return done([`${card.id}: moved ${moving} to ${dest.position} of ${dest.era}`]);
};
```

Register in `resolvePlay.ts`:

```ts
import { moveExecutor } from './executors/move';
```

```ts
  [({ card }) => hasTag(card, 'play:move'), moveExecutor],
```

(add `hasTag` to the existing `./tags` import in `resolvePlay.ts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/effects/executors/move.test.ts` — Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/effects/executors/move.ts src/effects/executors/move.test.ts src/effects/resolvePlay.ts
git commit -m "feat(timestreams): move executor for self, sourced, and chosen moves (M2 task 8)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Swap executors

**Files:**
- Create: `src/effects/executors/swap.ts`
- Modify: `src/effects/resolvePlay.ts` (register)
- Test: `src/effects/executors/swap.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: `swapExecutor: Executor` for `play:swap` (`score:swap` reuses it in M3):
  - two-card shape: `swap:target:invention` + `swap:count:2` + `swap:scope:*` (+ `target:exclude-self`) — one prompt selecting exactly 2 cards (`${card.id}:swap-pair`)
  - self shape: `swap:target:self` + `swap:with:invention|art` + `swap:scope:today|adjacent` — one prompt selecting the partner (`${card.id}:swap-with`)
  - A swap is two positional moves: both cards must pass `isMoveBlocked`; if either is blocked the whole swap fizzles (logged).

- [ ] **Step 1: Write the failing test**

```ts
// src/effects/executors/swap.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from '../resolvePlay';
import { makeCard, makeState, putInEra, putInHand } from '../testFixtures';

describe('swap executor', () => {
  it('Shell Game swaps any two inventions in Today', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 1 });
    putInEra(G, 'stone',
      makeCard({ id: 'a#0', ownerId: '0' }), makeCard({ id: 'b#0', ownerId: '1' }), makeCard({ id: 'c#0', ownerId: '0' }),
    );
    const sg = makeCard({
      id: 'stone-age-shell-game#0', ownerId: '0', cardType: 'action',
      tags: ['play:swap', 'swap:target:invention', 'swap:count:2', 'swap:scope:today'],
    });
    putInHand(G, '0', sg);
    const first = resolvePlayEffect(G, '0', 'stone-age-shell-game#0');
    expect(first.prompts[0]).toMatchObject({ id: 'stone-age-shell-game#0:swap-pair', min: 2, max: 2 });
    resolvePlayEffect(G, '0', 'stone-age-shell-game#0', { 'stone-age-shell-game#0:swap-pair': ['a#0', 'c#0'] });
    expect(G.timeline.stone.stack).toEqual(['c#0', 'b#0', 'a#0']);
  });

  it('Organ Transplant swaps itself with a chosen invention in Today', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    const ot = makeCard({
      id: 'modern-organ-transplant#0', ownerId: '0',
      tags: ['play:swap', 'swap:optional', 'swap:target:self', 'swap:with:invention', 'swap:scope:today'],
    });
    putInEra(G, 'modern', makeCard({ id: 'other#0', ownerId: '1' }), ot);
    resolvePlayEffect(G, '0', 'modern-organ-transplant#0', { 'modern-organ-transplant#0:swap-with': 'other#0' });
    expect(G.timeline.modern.stack).toEqual(['modern-organ-transplant#0', 'other#0']);
  });

  it('swap fizzles if either side is move-protected', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    const ot = makeCard({
      id: 'modern-organ-transplant#0', ownerId: '0',
      tags: ['play:swap', 'swap:target:self', 'swap:with:invention', 'swap:scope:today'],
    });
    putInEra(G, 'modern',
      makeCard({ id: 'stone-age-anarchy#0', ownerId: '1', tags: ['protect:self', 'protect:move'] }), ot,
    );
    const res = resolvePlayEffect(G, '0', 'modern-organ-transplant#0', { 'modern-organ-transplant#0:swap-with': 'stone-age-anarchy#0' });
    expect(res.log.join(' ')).toMatch(/fizzles/);
    expect(G.timeline.modern.stack).toEqual(['stone-age-anarchy#0', 'modern-organ-transplant#0']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/effects/executors/swap.test.ts`
Expected: FAIL — executor not registered.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/effects/executors/swap.ts
import { hasTag, tagValue, isOptionalFor } from '../tags';
import { erasForScope, candidateTargets, locateCard, cardAtOffset } from '../targets';
import { isMoveBlocked } from '../boardOps';
import { done, needs, type Executor } from '../types';

function swapPositions(G: any, aId: string, bId: string): void {
  const a = locateCard(G, aId)!; const b = locateCard(G, bId)!;
  G.timeline[a.era].stack[a.index] = bId;
  G.timeline[b.era].stack[b.index] = aId;
}

export const swapExecutor: Executor = ({ G, playerId, card, choices }) => {
  const optional = isOptionalFor(card, 'swap');
  const scope = tagValue(card, 'swap:scope') ?? 'today';

  const performSwap = (aId: string, bId: string) => {
    for (const id of [aId, bId]) {
      const blocked = isMoveBlocked(G, id, playerId);
      if (blocked) return done([`${card.id}: swap fizzles (${id} ${blocked})`]);
    }
    swapPositions(G, aId, bId);
    return done([`${card.id}: swapped ${aId} <-> ${bId}`]);
  };

  if (tagValue(card, 'swap:target') === 'self') {
    const withKind = tagValue(card, 'swap:with') ?? 'invention';
    let options: string[];
    if (scope === 'adjacent') {
      options = [cardAtOffset(G, card.id, -1), cardAtOffset(G, card.id, 1)].filter((x): x is string => !!x);
    } else {
      options = candidateTargets(G, {
        kind: withKind === 'art' ? 'any' : 'invention',
        eras: erasForScope(G, scope, card.id),
        excludeCardId: card.id,
        subtypes: withKind === 'art' ? ['art'] : undefined,
      });
    }
    const promptId = `${card.id}:swap-with`;
    const chosen = choices[promptId];
    if (chosen === undefined) {
      if (options.length === 0) return done([`${card.id}: swap fizzles (no partner)`]);
      return needs({ id: promptId, deciderId: playerId, kind: 'choose-card', options, min: optional ? 0 : 1, max: 1, reason: 'swap:target:self' });
    }
    if (chosen === '' || (Array.isArray(chosen) && chosen.length === 0)) return done([`${card.id}: swap declined`]);
    return performSwap(card.id, Array.isArray(chosen) ? chosen[0] : chosen);
  }

  // two-card shape
  const exclude = hasTag(card, 'target:exclude-self') ? card.id : undefined;
  const options = candidateTargets(G, { kind: 'invention', eras: erasForScope(G, scope, card.id), excludeCardId: exclude });
  const promptId = `${card.id}:swap-pair`;
  const chosen = choices[promptId];
  if (chosen === undefined) {
    if (options.length < 2) return done([`${card.id}: swap fizzles (fewer than 2 targets)`]);
    return needs({ id: promptId, deciderId: playerId, kind: 'choose-card', options, min: optional ? 0 : 2, max: 2, reason: 'swap:count:2' });
  }
  const pair = Array.isArray(chosen) ? chosen : [chosen];
  if (pair.length < 2) return done([`${card.id}: swap declined`]);
  return performSwap(pair[0], pair[1]);
};
```

Register in `resolvePlay.ts`:

```ts
import { swapExecutor } from './executors/swap';
```

```ts
  [({ card }) => hasTag(card, 'play:swap'), swapExecutor],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/effects/executors/swap.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/effects/executors/swap.ts src/effects/executors/swap.test.ts src/effects/resolvePlay.ts
git commit -m "feat(timestreams): swap executor for two-card and self-swap shapes (M2 task 9)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Attach executor (Inflation, Hibernation, Waylay, Coronation)

**Files:**
- Create: `src/effects/executors/attach.ts`
- Modify: `src/effects/resolvePlay.ts` (register)
- Test: `src/effects/executors/attach.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6 (`attachTo`, `effectiveScoreValue`, trigger registration comes in Task 12 — this task only attaches and registers Waylay's `PendingTrigger`).
- Produces: `attachExecutor: Executor` for `play:attach`:
  - host selection: `attach:scope:today` prompt `${card.id}:attach-host` over inventions in scope; Coronation (`attach:to:played-invention`) expects the host id supplied by the caller via choice key `${card.id}:attach-host` (the invention just played).
  - after attaching: if the card carries `ongoing:trigger:invention-played`, register a `PendingTrigger` anchored to the host's era (`trigger:scope:attached-era` per PRD §3.8).

- [ ] **Step 1: Write the failing test**

```ts
// src/effects/executors/attach.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from '../resolvePlay';
import { makeCard, makeState, putInEra, putInHand } from '../testFixtures';
import { getAttachments, getPendingTriggers } from '../state';
import { effectiveScoreValue } from '../boardOps';

describe('attach executor', () => {
  it('Inflation attaches to a chosen invention in Today and modifies its value', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    putInEra(G, 'modern', makeCard({ id: 'host#0', ownerId: '1', scoreValue: 4 }));
    const infl = makeCard({
      id: 'modern-inflation#0', ownerId: '0', cardType: 'action',
      tags: ['play:attach', 'attach:scope:today', 'modify:score:attached', 'modify:amount:-1', 'play:extra-turn', 'extra-turn:optional', 'condition:today-modern-or-future'],
    });
    putInHand(G, '0', infl);
    const first = resolvePlayEffect(G, '0', 'modern-inflation#0');
    expect(first.prompts.map(p => p.id)).toContain('modern-inflation#0:attach-host');
    resolvePlayEffect(G, '0', 'modern-inflation#0', { 'modern-inflation#0:attach-host': 'host#0' });
    expect(getAttachments(G)['host#0']).toContain('modern-inflation#0');
    expect(effectiveScoreValue(G, 'host#0')).toBe(3);
  });

  it('Waylay registers an era-anchored ongoing trigger on attach', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 3 }); // Today = renaissance
    putInEra(G, 'renaissance', makeCard({ id: 'host#0', ownerId: '1' }));
    const waylay = makeCard({
      id: 'medieval-waylay#0', ownerId: '0', cardType: 'action',
      tags: ['react:invention-played', 'play:attach', 'ongoing:trigger:invention-played', 'trigger:scope:attached-era', 'trigger:persists:after-today-advances', 'move:target:attached', 'move:destination:end-of-era'],
    });
    putInHand(G, '0', waylay);
    resolvePlayEffect(G, '0', 'medieval-waylay#0', { 'medieval-waylay#0:attach-host': 'host#0' });
    const trig = getPendingTriggers(G)[0];
    expect(trig).toMatchObject({
      sourceCardId: 'medieval-waylay#0', event: 'invention-played', eraAnchor: 'renaissance', limit: 'ongoing', spent: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/effects/executors/attach.test.ts`
Expected: FAIL — executor not registered.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/effects/executors/attach.ts
import { hasTag, tagValue } from '../tags';
import { erasForScope, candidateTargets, locateCard } from '../targets';
import { attachTo } from '../boardOps';
import { getPendingTriggers } from '../state';
import { done, needs, type Executor } from '../types';

export const attachExecutor: Executor = ({ G, playerId, card, choices }) => {
  const promptId = `${card.id}:attach-host`;
  const chosen = choices[promptId];
  if (chosen === undefined) {
    const scope = tagValue(card, 'attach:scope') ?? 'today';
    const options = candidateTargets(G, { kind: 'invention', eras: erasForScope(G, scope, card.id), excludeCardId: card.id });
    if (options.length === 0) return done([`${card.id}: attach fizzles (no host)`]);
    return needs({ id: promptId, deciderId: playerId, kind: 'choose-card', options, min: 1, max: 1, reason: 'play:attach' });
  }

  const hostId = Array.isArray(chosen) ? chosen[0] : chosen;
  attachTo(G, card.id, hostId);
  const log = [`${card.id}: attached to ${hostId}`];

  if (hasTag(card, 'ongoing:trigger:invention-played')) {
    const anchor = tagValue(card, 'trigger:scope') === 'attached-era' ? locateCard(G, hostId)?.era ?? null : null;
    getPendingTriggers(G).push({
      sourceCardId: card.id, ownerId: playerId,
      event: 'invention-played', eraAnchor: anchor, limit: 'ongoing', spent: false,
    });
    log.push(`${card.id}: registered ongoing invention-played trigger on ${anchor}`);
  }
  return done(log);
};
```

Register in `resolvePlay.ts`:

```ts
import { attachExecutor } from './executors/attach';
```

```ts
  [({ card }) => hasTag(card, 'play:attach'), attachExecutor],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/effects/executors/attach.test.ts` — Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/effects/executors/attach.ts src/effects/executors/attach.test.ts src/effects/resolvePlay.ts
git commit -m "feat(timestreams): attach executor with host prompts and Waylay trigger registration (M2 task 10)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Prevent and recover executors

**Files:**
- Create: `src/effects/executors/prevent.ts`
- Create: `src/effects/executors/recover.ts`
- Modify: `src/effects/resolvePlay.ts` (register both)
- Test: `src/effects/executors/preventRecover.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6 (`addModifier`).
- Produces:
  - `preventExecutor: Executor` — `play:prevent` + `prevent:play:action` → `prevent-action-play`; `prevent:move:future` → `prevent-move-future`; `prevent:move:past` → `prevent-move-past`; duration from `duration:rest-of-today|rest-of-game`.
  - `recoverExecutor: Executor` — `play:recover` + `recover:from-discard:N` (+ `recover:optional`, `recover:to-hand`, `recover:target:top-of-discard`, `cost:discard-from-hand:1`). Prompt ids: `${card.id}:recover` (discard picks), `${card.id}:recover-cost` (hand card to pay). Deferred variants (`recover:to-deck`) are ignored here and listed in Task 16's deferred set.

- [ ] **Step 1: Write the failing test**

```ts
// src/effects/executors/preventRecover.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from '../resolvePlay';
import { makeCard, makeState, putInHand } from '../testFixtures';
import { isActionPlayPrevented, isMoveDirectionPrevented } from '../modifiers';

describe('prevent executor', () => {
  it('Smoke Signals registers rest-of-today action prevention', () => {
    const G = makeState({ players: ['0'] });
    const ss = makeCard({
      id: 'stone-age-smoke-signals#0', ownerId: '0',
      tags: ['play:prevent', 'prevent:play:action', 'duration:rest-of-today'],
    });
    putInHand(G, '0', ss);
    resolvePlayEffect(G, '0', 'stone-age-smoke-signals#0');
    expect(isActionPlayPrevented(G)).toBe(true);
  });

  it('Sundial prevents forward moves', () => {
    const G = makeState({ players: ['0'] });
    const sd = makeCard({
      id: 'stone-age-sundial#0', ownerId: '0',
      tags: ['play:prevent', 'prevent:move:future', 'duration:rest-of-today'],
    });
    putInHand(G, '0', sd);
    resolvePlayEffect(G, '0', 'stone-age-sundial#0');
    expect(isMoveDirectionPrevented(G, 'stone', 'medieval')).toBe(true);
    expect(isMoveDirectionPrevented(G, 'medieval', 'stone')).toBe(false);
  });
});

describe('recover executor', () => {
  it('Water Wheel: pay a hand card to recover any discard card to hand', () => {
    const G = makeState({ players: ['0'] });
    const ww = makeCard({
      id: 'medieval-water-wheel#0', ownerId: '0',
      tags: ['play:recover', 'recover:optional', 'recover:from-discard:1', 'recover:to-hand', 'cost:discard-from-hand:1'],
    });
    putInHand(G, '0', ww);
    putInHand(G, '0', makeCard({ id: 'payment#0', ownerId: '0' }));
    G.players['0'].discard.push(makeCard({ id: 'buried#0', ownerId: '0' }));
    const first = resolvePlayEffect(G, '0', 'medieval-water-wheel#0');
    expect(first.prompts.map(p => p.id).sort()).toEqual(['medieval-water-wheel#0:recover', 'medieval-water-wheel#0:recover-cost']);
    resolvePlayEffect(G, '0', 'medieval-water-wheel#0', {
      'medieval-water-wheel#0:recover': 'buried#0',
      'medieval-water-wheel#0:recover-cost': 'payment#0',
    });
    expect(G.players['0'].hand.map(c => c.id)).toContain('buried#0');
    expect(G.players['0'].hand.map(c => c.id)).not.toContain('payment#0');
    expect(G.players['0'].discard.map(c => c.id)).toEqual(['payment#0']);
  });

  it('Thermodynamics: top of discard, no prompt needed', () => {
    const G = makeState({ players: ['0'] });
    const td = makeCard({
      id: 'modern-thermodynamics#0', ownerId: '0',
      tags: ['play:recover', 'recover:from-discard:1', 'recover:target:top-of-discard', 'recover:to-hand'],
    });
    putInHand(G, '0', td);
    G.players['0'].discard.push(makeCard({ id: 'older#0', ownerId: '0' }), makeCard({ id: 'newest#0', ownerId: '0' }));
    const res = resolvePlayEffect(G, '0', 'modern-thermodynamics#0');
    expect(res.prompts).toEqual([]);
    expect(G.players['0'].hand.map(c => c.id)).toContain('newest#0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/effects/executors/preventRecover.test.ts`
Expected: FAIL — executors not registered.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/effects/executors/prevent.ts
import type { ActiveModifier } from '../../types';
import { hasTag, tagValue } from '../tags';
import { addModifier } from '../modifiers';
import { done, type Executor } from '../types';

export const preventExecutor: Executor = ({ G, playerId, card }) => {
  const duration = (tagValue(card, 'duration') ?? 'rest-of-today') as ActiveModifier['duration'];
  const log: string[] = [];
  const kinds: Array<[string, ActiveModifier['kind']]> = [
    ['prevent:play:action', 'prevent-action-play'],
    ['prevent:move:future', 'prevent-move-future'],
    ['prevent:move:past', 'prevent-move-past'],
  ];
  for (const [tag, kind] of kinds) {
    if (hasTag(card, tag)) {
      addModifier(G, { sourceCardId: card.id, ownerId: playerId, kind, duration });
      log.push(`${card.id}: ${tag} (${duration})`);
    }
  }
  return done(log);
};
```

```ts
// src/effects/executors/recover.ts
import { hasTag, tagValue, tagNumber, isOptionalFor } from '../tags';
import { done, needs, merge, type Executor, type PlayerPrompt } from '../types';

export const recoverExecutor: Executor = ({ G, playerId, card, choices }) => {
  const player = G.players[playerId];
  const count = tagNumber(card, 'recover:from-discard') ?? 1;
  const toHand = hasTag(card, 'recover:to-hand');
  if (!toHand) return done([`${card.id}: recover deferred (non-hand destination)`]);

  const prompts: PlayerPrompt[] = [];
  const recoverId = `${card.id}:recover`;
  const costId = `${card.id}:recover-cost`;
  const needsCost = hasTag(card, 'cost:discard-from-hand:1');

  let picks: string[];
  if (hasTag(card, 'recover:target:top-of-discard')) {
    const top = player.discard[player.discard.length - 1];
    picks = top ? [top.id] : [];
  } else if (choices[recoverId] !== undefined) {
    const c = choices[recoverId];
    picks = Array.isArray(c) ? c : c === '' ? [] : [c];
  } else {
    const options = player.discard.map(c => c.id);
    if (options.length === 0) return done([`${card.id}: recover fizzles (empty discard)`]);
    prompts.push({
      id: recoverId, deciderId: playerId, kind: 'choose-card',
      options, min: isOptionalFor(card, 'recover') ? 0 : Math.min(count, options.length), max: count,
      reason: 'recover:from-discard',
    });
    picks = [];
  }

  let costPick: string | null = null;
  if (needsCost) {
    if (choices[costId] !== undefined) {
      const c = choices[costId];
      costPick = Array.isArray(c) ? c[0] ?? null : c || null;
    } else {
      const options = player.hand.filter(c => c.id !== card.id).map(c => c.id);
      if (options.length === 0) return done([`${card.id}: recover fizzles (no card to pay)`]);
      prompts.push({ id: costId, deciderId: playerId, kind: 'choose-card', options, min: 1, max: 1, reason: 'cost:discard-from-hand:1' });
    }
  }

  if (prompts.length) return { ok: true, prompts, log: [] };
  if (picks.length === 0) return done([`${card.id}: recover declined`]);

  const log: string[] = [];
  if (needsCost && costPick) {
    const idx = player.hand.findIndex(c => c.id === costPick);
    if (idx !== -1) {
      const [paid] = player.hand.splice(idx, 1);
      player.discard.push(paid);
      log.push(`${card.id}: paid ${costPick} from hand`);
    }
  }
  for (const id of picks.slice(0, count)) {
    const idx = player.discard.findIndex(c => c.id === id);
    if (idx === -1) continue;
    const [recovered] = player.discard.splice(idx, 1);
    player.hand.push(recovered);
    log.push(`${card.id}: recovered ${id} to hand`);
  }
  return done(log);
};
```

Register in `resolvePlay.ts`:

```ts
import { preventExecutor } from './executors/prevent';
import { recoverExecutor } from './executors/recover';
```

```ts
  [({ card }) => hasTag(card, 'play:prevent'), preventExecutor],
  [({ card }) => hasTag(card, 'play:recover'), recoverExecutor],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/effects/executors/preventRecover.test.ts` — Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/effects/executors/prevent.ts src/effects/executors/recover.ts src/effects/executors/preventRecover.test.ts src/effects/resolvePlay.ts
git commit -m "feat(timestreams): prevent and recover executors (M2 task 11)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Play-phase triggers (delayed traps and ongoing watchers)

**Files:**
- Create: `src/effects/triggers.ts`
- Create: `src/effects/executors/delayedTrigger.ts`
- Modify: `src/effects/resolvePlay.ts` (register `delayedTriggerExecutor`)
- Modify: `src/play.ts` (emit `invention-played` / `action-played` from `playInvention`/`playAction`)
- Modify: `src/effects/boardOps.ts` (`discardFromPlay` emits `discarded-from-play`)
- Test: `src/effects/triggers.test.ts`

**Interfaces:**
- Consumes: Tasks 1–11.
- Produces:
  - `PlayEvent = { type: 'invention-played' | 'action-played' | 'discarded-from-play'; cardId: string; eraId: EraId | null; actorPlayerId: string }`
  - `fireEvent(G, ev: PlayEvent): { prompts: PlayerPrompt[]; log: string[] }` — walks `getPendingTriggers(G)` (unspent, event matches, era anchor matches or null) and applies each trigger's effect by reading the **source card's tags**:
    - `discard:hand:3` + `discard:by:triggering-action-player` + `discard:whole-hand-if-fewer` (Media Scandal) — auto-discards from the triggering player's hand end (their choice of *which* cards is a `choose-card` prompt when hand > 3)
    - `skip-turn:target:triggering-player` + `draw:to:triggering-player` (Television) — sets `getTurnFlags(G, actor).skipNextTurn = true` and `requestDraws(G, actor, 1)`
    - `discard:triggering-invention` + `discard:self` (Hunting Party) — discards the sixth invention and the trap (`trigger:sixth-invention-in-era` matches only when the era's invention count reaches 6)
    - `move:target:attached` + `move:destination:end-of-era` (Waylay) — moves the host to the end of the anchored era
    - `draw:to:discarder` (Taxes, on `discarded-from-play` of itself) — `requestDraws` for the actor
    - `once` triggers set `spent = true` after firing.
  - `delayedTriggerExecutor: Executor` — registers `PendingTrigger`s at play time from `play:delayed-trigger` (+ `trigger:next-action-in-today` → event `action-played`, era anchor Today; `trigger:next-invention-played` → `invention-played`, anchor null; `trigger:sixth-invention-in-era` → `invention-played`, anchor = era the trap was played on via `play:scope:tomorrow`). Dot Com's watcher and Taxes' `ongoing:trigger:discarded-from-play` register at *invention play* time: extend `playInvention` to call a new `registerStaticTriggers(G, card)` from `triggers.ts` that reads `ongoing:trigger:*` / `react:invention-played`+`discard:self` (Dot Com's mandatory self-discard fires inside `fireEvent` via `condition:higher-value-invention` compared with `effectiveScoreValue`).

- [ ] **Step 1: Write the failing test**

```ts
// src/effects/triggers.test.ts
import { describe, it, expect } from 'vitest';
import { fireEvent, registerStaticTriggers } from './triggers';
import { resolvePlayEffect } from './resolvePlay';
import { makeCard, makeState, putInEra, putInHand } from './testFixtures';
import { getPendingTriggers, getTurnFlags, registerCard } from './state';

describe('play-phase triggers', () => {
  it('Media Scandal punishes the next action played in Today, once', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    const ms = makeCard({
      id: 'modern-media-scandal#0', ownerId: '0',
      tags: ['play:delayed-trigger', 'trigger:next-action-in-today', 'trigger:limit:once', 'discard:hand:3', 'discard:by:triggering-action-player', 'discard:whole-hand-if-fewer'],
    });
    putInEra(G, 'modern', ms);
    resolvePlayEffect(G, '0', 'modern-media-scandal#0');
    expect(getPendingTriggers(G)).toHaveLength(1);

    // player 1 has only 2 cards -> whole hand discards, no prompt
    putInHand(G, '1', makeCard({ id: 'h1#0', ownerId: '1' }), makeCard({ id: 'h2#0', ownerId: '1' }));
    const out = fireEvent(G, { type: 'action-played', cardId: 'any-action#0', eraId: 'modern', actorPlayerId: '1' });
    expect(out.prompts).toEqual([]);
    expect(G.players['1'].hand).toEqual([]);
    expect(getPendingTriggers(G)[0].spent).toBe(true);

    // second action: trigger is spent, nothing happens
    putInHand(G, '1', makeCard({ id: 'h3#0', ownerId: '1' }));
    fireEvent(G, { type: 'action-played', cardId: 'other#0', eraId: 'modern', actorPlayerId: '1' });
    expect(G.players['1'].hand).toHaveLength(1);
  });

  it('Waylay moves its host to the end of the anchored era on invention-played there', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 3 });
    putInEra(G, 'renaissance', makeCard({ id: 'host#0', ownerId: '1' }), makeCard({ id: 'later#0', ownerId: '1' }));
    const waylay = makeCard({
      id: 'medieval-waylay#0', ownerId: '0', cardType: 'action',
      tags: ['play:attach', 'ongoing:trigger:invention-played', 'trigger:scope:attached-era', 'move:target:attached', 'move:destination:end-of-era'],
    });
    putInHand(G, '0', waylay);
    resolvePlayEffect(G, '0', 'medieval-waylay#0', { 'medieval-waylay#0:attach-host': 'host#0' });

    fireEvent(G, { type: 'invention-played', cardId: 'new#0', eraId: 'renaissance', actorPlayerId: '1' });
    expect(G.timeline.renaissance.stack[G.timeline.renaissance.stack.length - 1]).toBe('host#0');

    // events in other eras do not fire it
    const before = [...G.timeline.renaissance.stack];
    fireEvent(G, { type: 'invention-played', cardId: 'x#0', eraId: 'modern', actorPlayerId: '1' });
    expect(G.timeline.renaissance.stack).toEqual(before);
  });

  it('Taxes rewards its discarder', () => {
    const G = makeState({ players: ['0', '1'] });
    G.encryptedDecks['1'] = [{}, {}] as any;
    const taxes = makeCard({
      id: 'medieval-taxes#0', ownerId: '0', scoreValue: 6,
      tags: ['ongoing:trigger:discarded-from-play', 'trigger:target:self', 'draw:2', 'draw:to:discarder'],
    });
    putInEra(G, 'medieval', taxes);
    registerStaticTriggers(G, taxes);
    fireEvent(G, { type: 'discarded-from-play', cardId: 'medieval-taxes#0', eraId: 'medieval', actorPlayerId: '1' });
    expect(G.pendingDecryptRequests).toHaveLength(2);
  });

  it('Television sets skip flag and draws for the next inventor', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    G.encryptedDecks['1'] = [{}] as any;
    const tv = makeCard({
      id: 'modern-television#0', ownerId: '0',
      tags: ['play:delayed-trigger', 'trigger:next-invention-played', 'trigger:limit:once', 'skip-turn:target:triggering-player', 'draw:1', 'draw:to:triggering-player'],
    });
    putInEra(G, 'modern', tv);
    resolvePlayEffect(G, '0', 'modern-television#0');
    fireEvent(G, { type: 'invention-played', cardId: 'inv#0', eraId: 'modern', actorPlayerId: '1' });
    expect(getTurnFlags(G, '1').skipNextTurn).toBe(true);
    expect(G.pendingDecryptRequests).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/effects/triggers.test.ts`
Expected: FAIL — cannot resolve `./triggers`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/effects/triggers.ts
import type { TimestreamsState, TimestreamsCard, EraId, PendingTrigger } from '../types';
import { requestDraws } from '../crypto';
import { getCard, getPendingTriggers, getTurnFlags, getAttachments } from './state';
import { hasTag, tagValue, tagNumber } from './tags';
import { locateCard } from './targets';
import { moveToEra, discardFromPlay } from './boardOps';
import type { PlayerPrompt } from './types';

export interface PlayEvent {
  type: 'invention-played' | 'action-played' | 'discarded-from-play';
  cardId: string;
  eraId: EraId | null;
  actorPlayerId: string;
}

/** Register standing watchers carried by a card entering play (Taxes, Dot Com — Dot Com deferred to M3 value checks if desired, see coverage list). */
export function registerStaticTriggers(G: TimestreamsState, card: TimestreamsCard): void {
  if (hasTag(card, 'ongoing:trigger:discarded-from-play')) {
    getPendingTriggers(G).push({
      sourceCardId: card.id, ownerId: card.ownerId,
      event: 'discarded-from-play', eraAnchor: null, limit: 'ongoing', spent: false,
    });
  }
}

function findAttachedHost(G: TimestreamsState, attachedId: string): string | null {
  for (const [host, atts] of Object.entries(getAttachments(G))) {
    if (atts.includes(attachedId)) return host;
  }
  return null;
}

function applyTriggerEffect(
  G: TimestreamsState, trigger: PendingTrigger, source: TimestreamsCard, ev: PlayEvent, log: string[],
): void {
  // Media Scandal
  if (hasTag(source, 'discard:by:triggering-action-player')) {
    const n = tagNumber(source, 'discard:hand') ?? 3;
    const hand = G.players[ev.actorPlayerId].hand;
    if (hand.length <= n && hasTag(source, 'discard:whole-hand-if-fewer')) {
      G.players[ev.actorPlayerId].discard.push(...hand.splice(0, hand.length));
      log.push(`${source.id}: ${ev.actorPlayerId} discarded whole hand`);
    } else {
      // deterministic policy for M2: discard from the end of hand; refine to a prompt in M3 if desired
      const removed = hand.splice(Math.max(0, hand.length - n), n);
      G.players[ev.actorPlayerId].discard.push(...removed);
      log.push(`${source.id}: ${ev.actorPlayerId} discarded ${removed.length}`);
    }
  }
  // Television
  if (hasTag(source, 'skip-turn:target:triggering-player')) {
    getTurnFlags(G, ev.actorPlayerId).skipNextTurn = true;
    log.push(`${source.id}: ${ev.actorPlayerId} skips next turn`);
  }
  if (hasTag(source, 'draw:to:triggering-player')) {
    requestDraws(G, ev.actorPlayerId, tagNumber(source, 'draw') ?? 1);
  }
  // Waylay
  if (hasTag(source, 'move:target:attached') && tagValue(source, 'move:destination') === 'end-of-era') {
    const host = findAttachedHost(G, source.id);
    const era = trigger.eraAnchor ?? (host ? locateCard(G, host)?.era ?? null : null);
    if (host && era) {
      moveToEra(G, host, era, 'bottom');
      log.push(`${source.id}: moved ${host} to end of ${era}`);
    }
  }
  // Hunting Party
  if (hasTag(source, 'discard:triggering-invention')) {
    discardFromPlay(G, ev.cardId, source.ownerId);
    log.push(`${source.id}: discarded triggering invention ${ev.cardId}`);
    if (hasTag(source, 'discard:self')) {
      discardFromPlay(G, source.id, source.ownerId);
    }
  }
  // Taxes
  if (hasTag(source, 'draw:to:discarder')) {
    requestDraws(G, ev.actorPlayerId, tagNumber(source, 'draw') ?? 2);
    log.push(`${source.id}: discarder ${ev.actorPlayerId} draws`);
  }
}

export function fireEvent(G: TimestreamsState, ev: PlayEvent): { prompts: PlayerPrompt[]; log: string[] } {
  const log: string[] = [];
  for (const trigger of getPendingTriggers(G)) {
    if (trigger.spent || trigger.event !== ev.type) continue;
    if (trigger.eraAnchor && trigger.eraAnchor !== ev.eraId) continue;
    const source = getCard(G, trigger.sourceCardId);
    if (!source) continue;
    if (hasTag(source, 'trigger:target:self') && ev.cardId !== source.id) continue;
    if (hasTag(source, 'trigger:sixth-invention-in-era')) {
      const era = trigger.eraAnchor;
      const count = era ? G.timeline[era].stack.filter(id => getCard(G, id)?.cardType === 'invention').length : 0;
      if (count !== 6) continue;
    }
    applyTriggerEffect(G, trigger, source, ev, log);
    if (trigger.limit === 'once') trigger.spent = true;
  }
  return { prompts: [], log };
}
```

```ts
// src/effects/executors/delayedTrigger.ts
import { hasTag } from '../tags';
import { erasForScope } from '../targets';
import { getPendingTriggers } from '../state';
import { done, type Executor } from '../types';

export const delayedTriggerExecutor: Executor = ({ G, playerId, card }) => {
  const triggers = getPendingTriggers(G);
  if (hasTag(card, 'trigger:next-action-in-today')) {
    triggers.push({ sourceCardId: card.id, ownerId: playerId, event: 'action-played', eraAnchor: erasForScope(G, 'today')[0], limit: 'once', spent: false });
  } else if (hasTag(card, 'trigger:next-invention-played')) {
    triggers.push({ sourceCardId: card.id, ownerId: playerId, event: 'invention-played', eraAnchor: null, limit: 'once', spent: false });
  } else if (hasTag(card, 'trigger:sixth-invention-in-era')) {
    const anchor = hasTag(card, 'play:scope:tomorrow') ? erasForScope(G, 'tomorrow')[0] ?? null : erasForScope(G, 'today')[0];
    triggers.push({ sourceCardId: card.id, ownerId: playerId, event: 'invention-played', eraAnchor: anchor, limit: 'once', spent: false });
  }
  return done([`${card.id}: delayed trigger registered`]);
};
```

Register in `resolvePlay.ts`:

```ts
import { delayedTriggerExecutor } from './executors/delayedTrigger';
```

```ts
  [({ card }) => hasTag(card, 'play:delayed-trigger'), delayedTriggerExecutor],
```

Wire events in `src/play.ts`. Add imports:

```ts
import { fireEvent, registerStaticTriggers } from "./effects/triggers";
import { eraForDay as eraForDayFn } from "./timeline";
```

In `playInvention`, after `appendToEra(G.timeline, era, cardId);` add:

```ts
  registerStaticTriggers(G, card);
  fireEvent(G, { type: "invention-played", cardId, eraId: era, actorPlayerId: playerId });
```

In `playAction`, after `player.discard.push(card);` add:

```ts
  fireEvent(G, { type: "action-played", cardId, eraId: eraForDay(G.currentDay), actorPlayerId: playerId });
```

In `src/effects/boardOps.ts` `discardFromPlay`, before returning `true`, fire the event via a lazy import to avoid a cycle:

```ts
  // fire discard trigger (lazy import avoids boardOps <-> triggers cycle)
  const { fireEvent } = require('./triggers') as typeof import('./triggers');
  fireEvent(G, { type: 'discarded-from-play', cardId, eraId: null, actorPlayerId: _actorPlayerId });
```

and rename the parameter `_actorPlayerId` to `actorPlayerId`. If `require` is unavailable under ESM tests, instead move the `fireEvent` call into `discardExecutor` and `applyTriggerEffect` call sites (both import `triggers.ts` without cycles) — the test only exercises `fireEvent` directly for Taxes, so either wiring passes.

- [ ] **Step 4: Run tests**

Run: `yarn vitest run src/effects/triggers.test.ts` — Expected: PASS (4 tests).
Run: `yarn vitest run` — Expected: no new failures across the suite.

- [ ] **Step 5: Commit**

```bash
git add src/effects/triggers.ts src/effects/executors/delayedTrigger.ts src/effects/triggers.test.ts src/effects/resolvePlay.ts src/play.ts src/effects/boardOps.ts
git commit -m "feat(timestreams): play-phase delayed and ongoing triggers (M2 task 12)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Choice executor (option-a/option-b with deciders)

**Files:**
- Create: `src/effects/executors/choice.ts`
- Modify: `src/effects/resolvePlay.ts` (register)
- Test: `src/effects/executors/choice.test.ts`

**Interfaces:**
- Consumes: Tasks 1–12.
- Produces: `choiceExecutor: Executor` for `play:choice`:
  1. Resolve the decider: `decider:self` → acting player; `decider:chosen-opponent` → needs prior prompt `${card.id}:choose-opponent` (from `target:choose:opponent`); `decider:target-owner` → owner of the card chosen via `${card.id}:choose-target` (from `target:choose:invention` + `target:scope:*`).
  2. Prompt the decider with `${card.id}:option` over `['option-a','option-b']`; apply `forced:option-a:if-hand-under-3` before prompting (auto-picks when the decider's hand < 3).
  3. Apply the chosen branch by interpreting `option-X:*` sub-tags: `draw:N`(+`draw:to:self` = acting player), `discard:hand:N` (+`discard:by:*` = decider), `discard:target` (discard the chosen target card), `discard:1`+`discard:target:any-card`+`discard:scope:*` (chosen-card prompt `${card.id}:option-discard`), `add-scoring-slots:N`/`remove-scoring-slots:N` are score-phase (skip; M3).

- [ ] **Step 1: Write the failing test**

```ts
// src/effects/executors/choice.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from '../resolvePlay';
import { makeCard, makeState, putInEra, putInHand } from '../testFixtures';

const SURGICAL = ['play:choice', 'target:choose:invention', 'target:scope:today', 'decider:target-owner',
  'option-a:discard:target', 'option-b:discard:hand:3', 'option-b:discard:by:target-owner', 'forced:option-a:if-hand-under-3'];

describe('choice executor', () => {
  it('Surgical Strike: target owner picks option-b and discards 3 from hand', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    putInEra(G, 'modern', makeCard({ id: 'victim#0', ownerId: '1' }));
    for (let i = 0; i < 4; i++) putInHand(G, '1', makeCard({ id: `h${i}#0`, ownerId: '1' }));
    const ss = makeCard({ id: 'modern-surgical-strike#0', ownerId: '0', cardType: 'action', tags: SURGICAL });
    putInHand(G, '0', ss);

    const p1 = resolvePlayEffect(G, '0', 'modern-surgical-strike#0');
    expect(p1.prompts[0]).toMatchObject({ id: 'modern-surgical-strike#0:choose-target', deciderId: '0' });

    const p2 = resolvePlayEffect(G, '0', 'modern-surgical-strike#0', { 'modern-surgical-strike#0:choose-target': 'victim#0' });
    expect(p2.prompts[0]).toMatchObject({ id: 'modern-surgical-strike#0:option', deciderId: '1', options: ['option-a', 'option-b'] });

    resolvePlayEffect(G, '0', 'modern-surgical-strike#0', {
      'modern-surgical-strike#0:choose-target': 'victim#0',
      'modern-surgical-strike#0:option': 'option-b',
      'modern-surgical-strike#0:option-b-hand': ['h0#0', 'h1#0', 'h2#0'],
    });
    expect(G.players['1'].hand).toHaveLength(1);
    expect(G.timeline.modern.stack).toContain('victim#0'); // invention survived
  });

  it('forced:option-a when hand under 3 — invention is discarded without an option prompt', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    putInEra(G, 'modern', makeCard({ id: 'victim#0', ownerId: '1' }));
    putInHand(G, '1', makeCard({ id: 'only#0', ownerId: '1' }));
    const ss = makeCard({ id: 'modern-surgical-strike#0', ownerId: '0', cardType: 'action', tags: SURGICAL });
    putInHand(G, '0', ss);
    const res = resolvePlayEffect(G, '0', 'modern-surgical-strike#0', { 'modern-surgical-strike#0:choose-target': 'victim#0' });
    expect(res.prompts).toEqual([]);
    expect(G.timeline.modern.stack).toEqual([]);
    expect(G.players['1'].discard.map(c => c.id)).toContain('victim#0');
  });

  it('Diplomacy: chosen opponent decides; option-b lets the acting player draw 2', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 2 });
    G.encryptedDecks['0'] = [{}, {}] as any;
    const dip = makeCard({
      id: 'medieval-diplomacy#0', ownerId: '0',
      tags: ['play:choice', 'target:choose:opponent', 'decider:chosen-opponent',
        'option-a:discard:hand:2', 'option-a:discard:by:chosen-opponent', 'option-b:draw:2', 'option-b:draw:to:self'],
    });
    putInEra(G, 'medieval', dip);
    resolvePlayEffect(G, '0', 'medieval-diplomacy#0', {
      'medieval-diplomacy#0:choose-opponent': '1',
      'medieval-diplomacy#0:option': 'option-b',
    });
    expect(G.pendingDecryptRequests).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/effects/executors/choice.test.ts`
Expected: FAIL — executor not registered.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/effects/executors/choice.ts
import { requestDraws } from '../../crypto';
import { hasTag, tagValue, tagsWithPrefix } from '../tags';
import { erasForScope, candidateTargets } from '../targets';
import { discardFromPlay, isDiscardBlocked } from '../boardOps';
import { requireCard } from '../state';
import { done, needs, type Executor, type ExecCtx } from '../types';

function parseBranch(card: { tags?: string[] }, key: 'option-a' | 'option-b'): string[] {
  const prefix = `${key}:`;
  return (card.tags ?? []).filter(t => t.startsWith(prefix)).map(t => t.slice(prefix.length));
}

function branchNumber(branch: string[], prefix: string): number | undefined {
  const hit = branch.find(t => t.startsWith(`${prefix}:`));
  if (!hit) return undefined;
  const n = Number.parseInt(hit.slice(prefix.length + 1), 10);
  return Number.isNaN(n) ? undefined : n;
}

export const choiceExecutor: Executor = (ctx: ExecCtx) => {
  const { G, playerId, card, choices } = ctx;

  // 1. Establish the decider and (optionally) the target card.
  let deciderId = playerId;
  let targetCardId: string | null = null;

  if (hasTag(card, 'target:choose:opponent')) {
    const pid = choices[`${card.id}:choose-opponent`];
    if (pid === undefined) {
      const opponents = G.playerOrder.filter(p => p !== playerId);
      return needs({ id: `${card.id}:choose-opponent`, deciderId: playerId, kind: 'choose-option', options: opponents, min: 1, max: 1, reason: 'target:choose:opponent' });
    }
    deciderId = Array.isArray(pid) ? pid[0] : pid;
  }

  if (hasTag(card, 'target:choose:invention')) {
    const chosen = choices[`${card.id}:choose-target`];
    if (chosen === undefined) {
      const scope = tagValue(card, 'target:scope') ?? 'today';
      const options = candidateTargets(G, { kind: 'invention', eras: erasForScope(G, scope, card.id), excludeCardId: card.id });
      if (options.length === 0) return done([`${card.id}: choice fizzles (no target)`]);
      return needs({ id: `${card.id}:choose-target`, deciderId: playerId, kind: 'choose-card', options, min: 1, max: 1, reason: 'target:choose:invention' });
    }
    targetCardId = Array.isArray(chosen) ? chosen[0] : chosen;
    if (tagValue(card, 'decider') === 'target-owner') deciderId = requireCard(G, targetCardId).ownerId;
  }

  // 2. Option selection (with forced fallback).
  let option = choices[`${card.id}:option`] as string | undefined;
  const forced = (card.tags ?? []).find(t => t.startsWith('forced:'));
  if (forced === 'forced:option-a:if-hand-under-3' && G.players[deciderId].hand.length < 3) option = 'option-a';
  if (option === undefined) {
    return needs({ id: `${card.id}:option`, deciderId, kind: 'choose-option', options: ['option-a', 'option-b'], min: 1, max: 1, reason: 'play:choice' });
  }

  // 3. Apply the chosen branch.
  const branch = parseBranch(card, option as 'option-a' | 'option-b');
  const log: string[] = [];

  const drawN = branchNumber(branch, 'draw');
  if (drawN !== undefined) {
    const to = branch.includes('draw:to:self') ? playerId : deciderId;
    requestDraws(G, to, drawN);
    log.push(`${card.id}: ${option} -> ${to} draws ${drawN}`);
  }

  if (branch.includes('discard:target') && targetCardId) {
    const blocked = isDiscardBlocked(G, targetCardId, playerId);
    if (blocked) log.push(`${card.id}: ${option} discard fizzles (${blocked})`);
    else { discardFromPlay(G, targetCardId, playerId); log.push(`${card.id}: ${option} -> discarded ${targetCardId}`); }
  }

  const handN = branchNumber(branch, 'discard:hand');
  if (handN !== undefined) {
    const who = deciderId;
    const pickKey = `${card.id}:${option}-hand`;
    const picks = choices[pickKey];
    const hand = G.players[who].hand;
    if (picks === undefined && hand.length > handN) {
      return needs({ id: pickKey, deciderId: who, kind: 'choose-card', options: hand.map(c => c.id), min: handN, max: handN, reason: `${option}:discard:hand:${handN}` });
    }
    const ids = picks === undefined ? hand.map(c => c.id) : (Array.isArray(picks) ? picks : [picks]);
    for (const id of ids.slice(0, Math.max(handN, ids.length === hand.length ? ids.length : handN))) {
      const idx = hand.findIndex(c => c.id === id);
      if (idx !== -1) G.players[who].discard.push(...hand.splice(idx, 1));
    }
    log.push(`${card.id}: ${option} -> ${who} discarded from hand`);
  }

  return done(log);
};
```

Register in `resolvePlay.ts`:

```ts
import { choiceExecutor } from './executors/choice';
```

```ts
  [({ card }) => hasTag(card, 'play:choice'), choiceExecutor],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/effects/executors/choice.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/effects/executors/choice.ts src/effects/executors/choice.test.ts src/effects/resolvePlay.ts
git commit -m "feat(timestreams): choice executor with deciders and forced options (M2 task 13)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Turn-manipulation executor (extra turn, skip turn, Navigation, cost:discard-self)

**Files:**
- Create: `src/effects/executors/turn.ts`
- Modify: `src/effects/resolvePlay.ts` (register)
- Test: `src/effects/executors/turn.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: `turnExecutor: Executor` handling:
  - `play:extra-turn` (+ `extra-turn:optional` → `confirm` prompt `${card.id}:extra-turn`; + `extra-turn:restriction:no-invention-play` sets `noInventionThisTurn` when the extra turn begins — flagged via `TurnFlags.extraTurns` increment and a paired restriction marker) and `condition:today-modern-or-future` gate.
  - `play:skip-turn` + `skip:target:self` (Philosophy) → `skipNextTurn`.
  - `play:allow-next-invention` + `allow:scope:yesterday-or-tomorrow` (Navigation) → `allowNextInventionEra`.
  - `cost:discard-self` on actions/inventions in play as part of a play effect (Semiconductor's play mode: `play:choice` + `cost:discard-self` + `discard:opponents-hand:2` + `discard:whole-hand-if-fewer`) — implemented here as: optional confirm `${card.id}:pay-self`; if confirmed, discard self from play and each opponent discards 2 (whole hand if ≤ 2, end-of-hand policy as Task 12).
  - The turn layer (boardgame.io `game.ts`) consumes `TurnFlags` in M3/M4; M2 only records intent. Document with a comment.

- [ ] **Step 1: Write the failing test**

```ts
// src/effects/executors/turn.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from '../resolvePlay';
import { makeCard, makeState, putInEra, putInHand } from '../testFixtures';
import { getTurnFlags } from '../state';

describe('turn executor', () => {
  it('Inflation extra turn only when Today is modern or future', () => {
    const early = makeState({ players: ['0'], currentDay: 2 });
    const inflEarly = makeCard({ id: 'modern-inflation#0', ownerId: '0', cardType: 'action', tags: ['play:extra-turn', 'extra-turn:optional', 'condition:today-modern-or-future'] });
    putInHand(early, '0', inflEarly);
    const resEarly = resolvePlayEffect(early, '0', 'modern-inflation#0');
    expect(resEarly.prompts).toEqual([]); // condition failed: no prompt, no flag
    expect(getTurnFlags(early, '0').extraTurns).toBe(0);

    const late = makeState({ players: ['0'], currentDay: 5 });
    const inflLate = makeCard({ id: 'modern-inflation#1', ownerId: '0', cardType: 'action', tags: ['play:extra-turn', 'extra-turn:optional', 'condition:today-modern-or-future'] });
    putInHand(late, '0', inflLate);
    const p = resolvePlayEffect(late, '0', 'modern-inflation#1');
    expect(p.prompts[0]).toMatchObject({ id: 'modern-inflation#1:extra-turn', kind: 'confirm' });
    resolvePlayEffect(late, '0', 'modern-inflation#1', { 'modern-inflation#1:extra-turn': 'yes' });
    expect(getTurnFlags(late, '0').extraTurns).toBe(1);
  });

  it('Androids extra turn carries the no-invention restriction', () => {
    const G = makeState({ players: ['0'], currentDay: 6 });
    const a = makeCard({ id: 'future-tech-androids#0', ownerId: '0', tags: ['play:extra-turn', 'extra-turn:optional', 'extra-turn:restriction:no-invention-play'] });
    putInHand(G, '0', a);
    resolvePlayEffect(G, '0', 'future-tech-androids#0', { 'future-tech-androids#0:extra-turn': 'yes' });
    expect(getTurnFlags(G, '0').extraTurns).toBe(1);
    expect(getTurnFlags(G, '0').noInventionThisTurn).toBe(true);
  });

  it('Philosophy skips own next turn; Navigation allows era override', () => {
    const G = makeState({ players: ['0'], currentDay: 2 });
    const ph = makeCard({ id: 'medieval-philosophy#0', ownerId: '0', tags: ['play:skip-turn', 'skip:target:self', 'rule:not-passing'] });
    const nav = makeCard({ id: 'medieval-navigation#0', ownerId: '0', tags: ['play:allow-next-invention', 'allow:scope:yesterday-or-tomorrow'] });
    putInHand(G, '0', ph, nav);
    resolvePlayEffect(G, '0', 'medieval-philosophy#0');
    resolvePlayEffect(G, '0', 'medieval-navigation#0');
    expect(getTurnFlags(G, '0').skipNextTurn).toBe(true);
    expect(getTurnFlags(G, '0').allowNextInventionEra).toBe('yesterday-or-tomorrow');
  });

  it('Semiconductor pay-self: opponents discard 2 (whole hand if fewer)', () => {
    const G = makeState({ players: ['0', '1', '2'], currentDay: 5 });
    const semi = makeCard({
      id: 'modern-semiconductor#0', ownerId: '0',
      tags: ['play:choice', 'cost:discard-self', 'discard:opponents-hand:2', 'discard:whole-hand-if-fewer'],
    });
    putInEra(G, 'modern', semi);
    putInHand(G, '1', makeCard({ id: 'x#0', ownerId: '1' }), makeCard({ id: 'y#0', ownerId: '1' }), makeCard({ id: 'z#0', ownerId: '1' }));
    putInHand(G, '2', makeCard({ id: 'w#0', ownerId: '2' }));
    resolvePlayEffect(G, '0', 'modern-semiconductor#0', { 'modern-semiconductor#0:pay-self': 'yes' });
    expect(G.timeline.modern.stack).toEqual([]);           // paid itself
    expect(G.players['1'].hand).toHaveLength(1);           // discarded 2 of 3
    expect(G.players['2'].hand).toHaveLength(0);           // whole hand
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/effects/executors/turn.test.ts`
Expected: FAIL — executor not registered.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/effects/executors/turn.ts
import { ERA_ORDER } from '../../types';
import { eraForDay } from '../../timeline';
import { hasTag, tagValue, tagNumber } from '../tags';
import { getTurnFlags } from '../state';
import { discardFromPlay } from '../boardOps';
import { locateCard } from '../targets';
import { done, needs, type Executor } from '../types';

export const turnExecutor: Executor = ({ G, playerId, card, choices }) => {
  const log: string[] = [];

  if (hasTag(card, 'play:extra-turn')) {
    const today = eraForDay(Math.min(G.currentDay, ERA_ORDER.length));
    const conditionOk = !hasTag(card, 'condition:today-modern-or-future') || today === 'modern' || today === 'future';
    if (conditionOk) {
      const promptId = `${card.id}:extra-turn`;
      const optional = hasTag(card, 'extra-turn:optional');
      const answer = choices[promptId];
      if (optional && answer === undefined) {
        return needs({ id: promptId, deciderId: playerId, kind: 'confirm', options: ['yes', 'no'], min: 1, max: 1, reason: 'play:extra-turn' });
      }
      if (!optional || answer === 'yes') {
        const flags = getTurnFlags(G, playerId);
        flags.extraTurns += 1;
        if (hasTag(card, 'extra-turn:restriction:no-invention-play')) flags.noInventionThisTurn = true;
        log.push(`${card.id}: extra turn granted`);
      }
    }
  }

  if (hasTag(card, 'play:skip-turn') && tagValue(card, 'skip:target') === 'self') {
    getTurnFlags(G, playerId).skipNextTurn = true;
    log.push(`${card.id}: skip next turn (not passing)`);
  }

  if (hasTag(card, 'play:allow-next-invention')) {
    const scope = tagValue(card, 'allow:scope');
    if (scope === 'yesterday-or-tomorrow') {
      getTurnFlags(G, playerId).allowNextInventionEra = 'yesterday-or-tomorrow';
      log.push(`${card.id}: next invention may go to yesterday or tomorrow`);
    }
  }

  if (hasTag(card, 'cost:discard-self') && tagNumber(card, 'discard:opponents-hand') !== undefined) {
    const promptId = `${card.id}:pay-self`;
    const answer = choices[promptId];
    if (answer === undefined) {
      if (!locateCard(G, card.id)) return done(log); // not in play: nothing to pay
      return needs({ id: promptId, deciderId: playerId, kind: 'confirm', options: ['yes', 'no'], min: 1, max: 1, reason: 'cost:discard-self' });
    }
    if (answer === 'yes') {
      discardFromPlay(G, card.id, playerId);
      const n = tagNumber(card, 'discard:opponents-hand') ?? 2;
      for (const pid of G.playerOrder) {
        if (pid === playerId) continue;
        const hand = G.players[pid].hand;
        const removeAll = hand.length <= n && hasTag(card, 'discard:whole-hand-if-fewer');
        const removed = removeAll ? hand.splice(0, hand.length) : hand.splice(Math.max(0, hand.length - n), n);
        G.players[pid].discard.push(...removed);
      }
      log.push(`${card.id}: paid self; opponents discarded ${n}`);
    }
  }

  return done(log);
};
```

Register in `resolvePlay.ts` (turn executor also covers Semiconductor's `play:choice`+`cost:discard-self` — register it *before* `choiceExecutor` and make `choiceExecutor`'s `applies` skip cards with `cost:discard-self`):

```ts
import { turnExecutor } from './executors/turn';
```

```ts
  [({ card }) => hasTag(card, 'play:extra-turn') || hasTag(card, 'play:skip-turn') || hasTag(card, 'play:allow-next-invention') || (hasTag(card, 'cost:discard-self') && hasTag(card, 'play:choice')), turnExecutor],
```

and change the choice entry to:

```ts
  [({ card }) => hasTag(card, 'play:choice') && !hasTag(card, 'cost:discard-self'), choiceExecutor],
```

- [ ] **Step 4: Run tests**

Run: `yarn vitest run src/effects/executors/turn.test.ts` — Expected: PASS (4 tests).
Run: `yarn vitest run src/effects` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/effects/executors/turn.ts src/effects/executors/turn.test.ts src/effects/resolvePlay.ts
git commit -m "feat(timestreams): turn-manipulation executor (M2 task 14)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: Wire the pipeline into playInvention/playAction

**Files:**
- Modify: `src/play.ts:26-71`
- Modify: `src/index.ts` (export the effects API)
- Test: `src/effects/integration.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `playInvention(G, ctx, playerId, cardId, choices?: ChoiceMap)` and `playAction(G, ctx, playerId, cardId, choices?: ChoiceMap)` gain an optional trailing `choices` parameter; both (1) call `canPlayCard` and return `INVALID_MOVE` on failure, (2) place/register the card as today, (3) call `resolvePlayEffect(G, playerId, cardId, choices)` and stash unresolved prompts on a new state field `G.pendingPrompts` (declare in `types.ts` as `pendingPrompts?: PlayerPrompt[]` — the UI answers them by re-submitting the move with a fuller `ChoiceMap`; on a complete resolution the field is cleared).
  - `src/index.ts` re-exports: `resolvePlayEffect`, `canPlayCard`, `fireEvent`, and the types from `./effects/types`.

- [ ] **Step 1: Write the failing test**

```ts
// src/effects/integration.test.ts
import { describe, it, expect } from 'vitest';
import { playInvention, playAction, INVALID_MOVE } from '../play';
import { makeCard, makeState, putInEra, putInHand } from './testFixtures';

const ctxFor = (pid: string) => ({ currentPlayer: pid } as any);

describe('play integration', () => {
  it('gated card is INVALID_MOVE (government rule)', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 1 });
    putInEra(G, 'stone', makeCard({ id: 'stone-age-anarchy#0', ownerId: '1', subtypes: ['government'] }));
    putInHand(G, '0', makeCard({
      id: 'medieval-monarchy#0', ownerId: '0', subtypes: ['monarchy', 'government'],
      tags: ['government', 'rule:one-government-per-era'],
    }));
    expect(playInvention(G, ctxFor('0'), '0', 'medieval-monarchy#0')).toBe(INVALID_MOVE);
  });

  it('play effect with prompt stashes pendingPrompts; re-submission resolves', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 1 });
    putInEra(G, 'stone', makeCard({ id: 'victim#0', ownerId: '1' }));
    putInHand(G, '0', makeCard({
      id: 'stone-age-fire#0', ownerId: '0',
      tags: ['play:discard:1', 'discard:target:today:any'],
    }));
    playInvention(G, ctxFor('0'), '0', 'stone-age-fire#0');
    expect(G.pendingPrompts?.length).toBe(1);

    // answer the prompt by re-invoking with choices (card already in play; effect re-resolves idempotently)
    playInvention(G, ctxFor('0'), '0', 'stone-age-fire#0', { 'stone-age-fire#0:discard': 'victim#0' });
    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.players['1'].discard.map(c => c.id)).toEqual(['victim#0']);
  });

  it('playing an action fires next-action traps (Media Scandal end-to-end)', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    const ms = makeCard({
      id: 'modern-media-scandal#0', ownerId: '0',
      tags: ['play:delayed-trigger', 'trigger:next-action-in-today', 'trigger:limit:once', 'discard:hand:3', 'discard:by:triggering-action-player', 'discard:whole-hand-if-fewer'],
    });
    putInHand(G, '0', ms);
    playInvention(G, ctxFor('0'), '0', 'modern-media-scandal#0');

    putInHand(G, '1', makeCard({ id: 'a#0', ownerId: '1', cardType: 'action' }), makeCard({ id: 'b#0', ownerId: '1' }));
    playAction(G, ctxFor('1'), '1', 'a#0');
    expect(G.players['1'].hand).toEqual([]); // whole hand (had 1 left after playing)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/effects/integration.test.ts`
Expected: FAIL — `INVALID_MOVE` not returned / `pendingPrompts` undefined.

- [ ] **Step 3: Write minimal implementation**

Add to `TimestreamsState` in `src/types.ts` (next to the other M2 fields; type it loosely to avoid importing effect types into the base module):

```ts
  /** M2 rules engine: prompts awaiting UI answers for the last played card. */
  pendingPrompts?: Array<{ id: string; deciderId: string; kind: string; options: string[]; min: number; max: number; reason: string }>;
```

Rework `src/play.ts` `playInvention`/`playAction`. New imports:

```ts
import { canPlayCard } from "./effects/gates";
import { resolvePlayEffect } from "./effects/resolvePlay";
import type { ChoiceMap } from "./effects/types";
```

`playInvention` becomes (replacing the existing body after the phase/turn checks — the re-submission path is detected by the card already being registered and out of hand):

```ts
export function playInvention(
  G: TimestreamsState,
  ctx: Ctx,
  playerId: string,
  cardId: string,
  choices: ChoiceMap = {},
): TimestreamsState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (ctx.currentPlayer !== playerId) return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  const inHand = player.hand.find((c: TimestreamsCard) => c.id === cardId);
  const resubmission = !inHand && G.cards?.[cardId] !== undefined && (G.pendingPrompts?.length ?? 0) > 0;
  if (!resubmission) {
    if (!inHand || !isInvention(inHand)) return INVALID_MOVE;
    if (!canPlayCard(G, playerId, cardId).ok) return INVALID_MOVE;
    removeCardFromHand(player, cardId);
    registerCard(G, inHand);
    const era = eraForDay(G.currentDay);
    appendToEra(G.timeline, era, cardId);
    transitionCardVisibility(G, cardId, "public", playerId, "playInvention", { era });
    player.hasPassedThisDay = false;
    registerStaticTriggers(G, inHand);
    fireEvent(G, { type: "invention-played", cardId, eraId: era, actorPlayerId: playerId });
  }

  const result = resolvePlayEffect(G, playerId, cardId, choices);
  G.pendingPrompts = result.prompts.length ? result.prompts : [];
  return G;
}
```

`playAction` gets the same shape (action goes to discard as today; `resubmission` check identical; event type `action-played` with `eraId: eraForDay(G.currentDay)`).

Add to `src/index.ts`:

```ts
export { resolvePlayEffect } from "./effects/resolvePlay";
export { canPlayCard } from "./effects/gates";
export { fireEvent, registerStaticTriggers } from "./effects/triggers";
export type { EffectResult, PlayerPrompt, ChoiceMap } from "./effects/types";
```

- [ ] **Step 4: Run the whole suite**

Run: `yarn vitest run` — Expected: all effects + integration tests pass; only the 3 known pre-existing `homeEra.test.ts` failures remain. If `play.test.ts` asserts old `playInvention` arity, update those call sites to the new optional parameter (no assertion changes needed).

- [ ] **Step 5: Commit**

```bash
git add src/play.ts src/types.ts src/index.ts src/effects/integration.test.ts
git commit -m "feat(timestreams): wire effect pipeline into play moves (M2 task 15)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 16: Tag coverage gate

**Files:**
- Create: `src/effects/tagCoverage.test.ts`

**Interfaces:**
- Consumes: the five pack manifests under `assets/packs/timestreams/*/manifest.json`; the executor registry.
- Produces: a CI test that fails when a manifest introduces a play-phase tag the engine neither handles nor explicitly defers (PRD §12).

- [ ] **Step 1: Write the test (it should pass immediately if Tasks 6–15 covered everything; any failure is a real gap — fix the executor or move the tag to DEFERRED with justification)**

```ts
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
```

- [ ] **Step 2: Run it and resolve any gaps**

Run: `yarn vitest run src/effects/tagCoverage.test.ts`
Expected: PASS. If it fails, the message lists the exact tags — either the tag belongs to an executor you built (extend that executor and its tests) or it is genuinely M3/deferred (add its family to `DEFERRED_PREFIXES` with a comment naming the milestone).

- [ ] **Step 3: Run the full suite one last time**

Run: `yarn vitest run`
Expected: everything green except the 3 known pre-existing `homeEra.test.ts` failures.

- [ ] **Step 4: Commit**

```bash
git add src/effects/tagCoverage.test.ts
git commit -m "test(timestreams): manifest tag coverage gate (M2 task 16)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** PRD §7.1 (gates → placement → events → executors → prompts) is Tasks 5/6/12/15; §5 play-phase shapes each have a task (draw 6, discard 7, moves 8, swaps 9, attach-modifier 10, prevent/recover 11, delayed/ongoing triggers 12, choices 13, turn manipulation 14); §8 prompting is Task 6's types + per-executor prompts; §12's coverage gate is Task 16. Score/react shapes (§7.2–7.3) are M3 by design — write a follow-up plan when M2 lands.
- **Known simplifications (documented, intentional):** Media Scandal / Semiconductor hand-discard uses end-of-hand policy instead of a victim prompt when no choice is supplied (upgrade path noted in Task 12); Dot Com's value-comparison watcher is deferred with the score-value dependencies (listed via `react:` in the deferred prefixes); `TurnFlags` are recorded but boardgame.io turn-order consumption is M3/M4.
- **Type consistency:** all executors use `ExecCtx`/`Executor`/`EffectResult` from Task 6; prompt ids follow `${card.id}:<key>`; state access only through Task 1 accessors.
