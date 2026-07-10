# Timestreams — Rules Engine PRD

**Status:** Draft v2 (2026-07-05) for M2/M3 (effect execution). Builds on the M1 rules-free structural baseline (tagged `timestreams-m1-rules-free`). Supersedes the 2026-07-02 draft: the tag vocabulary below reflects the full card-by-card accuracy review and cross-deck conformance pass of all five pack manifests (stone_age, medieval, modern, future_tech, era).

**Related docs:**
- [PRD.md](./PRD.md) — overall game and metadata shape
- [assets/packs/tag_definitions.md](./assets/packs/tag_definitions.md) — **generated** per-tag inventory (tag → cards); regenerate with `python3 scripts/generate_tag_inventory.py`. Semantics live in §4–5 of this doc.
- [RULES.md](./RULES.md) — transcribed manual (especially the "Wonky" scoring movement rule)

## 1. Goals

- **Shape-driven evaluation.** Cards with the same tag shape are evaluated by the same executor. The engine implements *shapes* (about two dozen), not cards (~106). A new card that reuses an existing shape requires zero engine changes — only manifest edits.
- **Declarative and card-agnostic.** All behavior beyond pure structure is driven by `cardType`, `subtypes`, `scoreValue`, and `tags[]`. Human-readable `*EffectText` fields are for the UI only; tags alone drive state changes.
- **Correct and faithful.** Reproduces the printed behaviors, including the rulings recorded in §3 (scored-card lifecycle, cancel-vs-copy asymmetry, double scoring, redirects, ongoing triggers).
- **Choice-surfacing.** The engine never guesses on player decisions: it returns structured prompts identifying the decider, the options, and the legal target sets.

## 2. Card Metadata Contract

Deck-card metadata shape (see manifests for examples):

| Field | Engine use |
|---|---|
| `cardType` | `invention` (occupies timeline positions, scores) or `action` (resolves from hand; may attach or sit on an era) |
| `subtypes` | First entry is always the **name slug** (`name.toLowerCase()`, spaces → dashes), enabling cross-deck reference by name (`requires:subtype:nanotech`, `mutual-discard:subtype:slow-time`, `target:subtype:quantum-computing`). Semantic subtypes (`government`, `art`) follow. |
| `scoreValue` | Printed point value. `null` = action with no printed value. **Absent** = attach-modifier action whose printed number modifies its host, carried by `modify:` tags instead (Inflation −1, Hibernation +1). Never duplicate a host modifier into `scoreValue`. |
| `tags` | The behavior program (§4). |
| `*EffectText`, `addlCardText`, `flavorText` | Display only. When tag order is ambiguous, printed text is authoritative for sequencing. |

**Deck membership** (`target-deck:` / `count:target-deck:`) is derived from the card-id prefix (`stone-age-`, `medieval-`, `modern-`, `future-tech-`), consistent with `deckResolver.ts`. Instance ids (`id#0`) must be normalized before the prefix test. Deck membership travels with the card — a Modern Day invention moved into the Stone Age era row is still `target-deck:modern`.

**Era cards** use the era metadata shape (`assetType: "era"`, no subtypes) but carry the same tag vocabulary; four of six have abilities (stone: protect/cancel once per game; medieval: steal bonus points once per game; modern: recover from discard at era begin; future: add two scoring slots on score).

## 3. Normative Rulings

These were settled during manifest review and are binding on the engine:

1. **Scored-card lifecycle (hybrid model).** Each scoring slot processes the topmost *unscored* card (Wonky rule). The card is marked scored and its **score ability** runs while it remains on the era (movable/targetable by later effects). **Printed invention points** are not banked until the card is in a **score pile**. **Bonus/penalty points** apply immediately to a separate bonus ledger (Digital Secretary, Poetry, etc.). Default: after an era’s slot abilities (and delayed window), non-slot inventions discard and slot inventions go to **inventors’** score piles. **Exception — steal:** only cards with `steal:target-to:own-score-pile` (Nanotech) remove a target mid-walk into the **stealer’s** pile, and only **after** that target’s score ability is fully processed. Bare `score:perform-other` (Alphabet, Chaos) copies/runs abilities only — no ownership change. Final score = Σ printed values of cards in each player’s score pile + bonus ledger.
2. **Cancel vs copy asymmetry.** Cancelling a score effect is only coherent against *unscored* targets (`cancel:target-filter:unscored`). Copy/perform effects (`score:perform-other`, `perform:target-filter:any`) may target already-scored cards — the copy re-executes on the acting card and never consumes or suppresses the original.
3. **Double scoring is legal.** Pottery's delayed score is `delayed:in-addition-to-slot-scoring`: a moved card in a scoring slot scores normally *and* again via the delayed instruction. There is no global "score once" rule.
4. **Optionality defaults.** Play/score effects are **mandatory** unless tagged `:optional` (printed "you may"). Reacts are **optional** unless tagged `trigger:mandatory` (printed "must" — Cloth, Dot Com).
5. **Deciders are explicit.** Any effect where more than one player could plausibly choose carries a `decider:` tag (`self`, `owner`, `target-owner`, `chosen-opponent`). Absence of a `decider:` tag on a choice-bearing effect is a manifest bug, not an engine default.
6. **Deck vs era-row.** "Modern Day Invention" style wording is deck membership (`target-deck:`), never era-row position. Era-row references use `in-era:` / `scored-in-era:` (Immortality, Corporate Government).
7. **Printed vs current value.** Value-copy effects declare their basis: `copy:value:printed` (immune to Inflation/Zero modifiers) vs `copy:value:current`.
8. **Ongoing triggers outlive Today.** `trigger:persists:after-today-advances` (Waylay, Crop Rotation) means the watcher fires on late plays into its era (e.g. via Navigation) even after Today has moved on. `trigger:scope:attached-era` anchors to the host's era, not Today.
9. **Attach modifiers.** `modify:score:attached` + `modify:amount:±N` adjust the host's effective score while attached. `suppress:score-effects-on-target` blocks the host's score *effects* but not its (modified) point value.
10. **Fast Time / Slow Time.** `mutual-discard:subtype:slow-time` lives only on Fast Time (the card that prints the rule); "mutual" semantics cover both directions. Do not mirror onto Slow Time.
11. **Government exclusivity.** `rule:one-government-per-era` is a placement/movement invariant checked whenever a `government` card would enter an era.
12. **Redirect vs cancel vs replace.** Three distinct protection mechanisms: `react:cancel` (effect voided, optionally `cancel:all-effects-of-source`), `redirect:target-to:*` (effect resolves against a different card — Cloth to self, Thought Police to adjacent), `replace:discard-with-move` (Combination Drug Therapy substitutes a different outcome).
13. **Multiple redirect claimants.** When more than one card claims a mandatory redirect (e.g. two Cloths owned by the same player in one era), the **defending owner** chooses which copy absorbs the effect (`redirect:decider:owner`). The acting player does not pick among them.
14. **Redirect into an immovable card fizzles — by design.** The owner may choose a redirect target that is itself protected from the incoming effect (e.g. a Hibernated Cloth); eligibility is not filtered to movable copies (`redirect:target-filter:any`), and the redirected effect then fizzles entirely (`redirect:on-immovable:fizzle`). This protection-stacking combo is an intended strategy: the engine must **enable** effect combinations like this, never "helpfully" restrict choices to ones that resolve.

## 4. Tag Grammar

~290 unique tags across five manifests, all following `family[:qualifier]*[:value]` with these cross-cutting conventions:

- **Trigger phase prefixes:** `play:`, `score:`, `react:` name when an effect fires. `ongoing:trigger:*` marks standing watchers; `play:delayed-trigger` + `trigger:*` marks one-shot traps (`trigger:limit:once`).
- **Targets:** `X:target:` names what is acted on (`self`, `invention`, `action`, `any-card`, `attached`, `offset-below:N`, `offset-above:N`, subtype names). `target:choose:*` marks a free choice; `target:exclude-self` encodes printed "other"; `target:subtype:*` tags OR-combine into one target set.
- **Scopes:** `X:scope:` bounds the search space (`today`, `tomorrow`, `current-era`, `same-era`, `attached-era`, `next-era`, `any-era`, `different-eras`, `adjacent`, `this-or-previous-era`, `today-or-past`).
- **Sources/destinations (moves):** `move-source:*` / `move-destination:*` (hyphenated forms are canonical).
- **Recipients:** `X:to:Y` (`draw:to:discarder`, `penalty:to:target-owner`, `bonus-points:to:next-inventor`, `score:to:all-players`).
- **Choices:** `play:choice`/`score:choice` + `option-a:*`/`option-b:*` branch tags + `decider:*` (+ `forced:option-X:if-*` for compulsory fallbacks). Chaos Theory uses named modes (`perform:`/`cancel:`) instead of `option-a/b` — treat named modes as choice branches.
- **Conditional branches:** `score:branch` + `branch:target:*` + `condition:*` + `if-true:*`/`if-false:*` (exactly one branch resolves).
- **Trigger refinement (reacts):** `trigger:target:*` (whose card trips it), `trigger:source:*` (`opponent`, `action`), `trigger:scope:*`, `trigger:phase:play|score`, `trigger:mandatory`, `limit:once-per-game`.
- **Costs:** `cost:discard-self`, `cost:discard-from-hand:N` — paid to activate; distinct from `discard:self` as an effect outcome.
- **Counting:** `score:count` + `score:per:N` + `count:` filters (`target-deck:*`, `cardtype:*`, `own-inventions`, `owner:opponents`, `duplicates:own-inventions`, `in-scoring-slot`, `include-self`, `condition:*`, `scope:*`).

## 5. Executor Shapes

The engine implements one executor per shape; the manifests map cards onto them. Current census (cards sharing an executor differ only in parameter tags):

| Shape | Signature tags | Cards |
|---|---|---|
| Draw | `play:draw:N` (+`opponents-draw:N`) | Fermented Fruit, AI, World Government, … |
| Discard N | `play:discard:N` / `score:discard` + target/scope/optional | Fire, Trebuchet, Napalm, Laser Show, Guillotine, Longbow, Liquid Nitrogen, Art of War, Tactical Nukes |
| Self-move | `move:target:self` + amount/direction or destination | Air Cars, The Wheel, Anti-Gravity, Space Travel |
| Targeted move | `play:move`/`score:move` + `move:target:*` + source/destination/scope | Vortex, Backwards Compat, Music, Pottery, Cybertech, Shipbuilding, Horse Riding, Advertising, The Internet |
| Two-card swap | `swap:target:invention` + `swap:count:2` + scope | Telescope, Shell Game, Virtual Reality, Time Jump |
| Self-swap | `swap:target:self` + `swap:with:*` + scope | Organ Transplant, Crop Rotation, Holograms |
| Attach modifier | `play:attach` + `modify:score:attached` + `modify:amount:±N` | Inflation, Hibernation |
| Attach other | `play:attach` (+`play:play-invention`) | Coronation, Waylay |
| Bonus points (flat) | `score:bonus-points` + `bonus-points:amount:N` + `condition:*` | Poetry, Coronation, Brain Taping, Immortality, Corporate Gov, Space Travel |
| Bonus points (copy) | `bonus-points:copy` + `copy:target/value/scope` | Coinage, Mass Marketing, Genetic Mod, Cloning |
| Penalty | `score:penalty[...]` + `penalty:amount/-to/-target` | Cave Paintings, Cloth, Digital Secretary, Television |
| Count scoring | `score:count` + `count:*` + `score:per:N` (+`score:to:all-players`) | Semiconductor, Cold Fusion, Monarchy, Mathematics, Multiplicity, Irrigation, Yoke, Deforestation |
| Conditional branch | `score:branch` + `if-true:`/`if-false:` | Quantum Theory, Domesticated Animals, Corporate Gov |
| Perform-other | `score:perform-other` + `perform:target-filter` + decider (+steal) | Alphabet, Chaos Theory, Nanotech |
| Player choice | `play:choice`/`score:choice` + options + decider | Diplomacy, Surgical Strike, High-Powered Laser, Quantum Computing, Semiconductor |
| Scoring slots ± | `score:add-scoring-slots:N` / `score:remove-scoring-slots:N` | Slow Time ×2, Fast Time, Quantum Computing, Era-Future |
| Prevent (duration) | `play:prevent` + `prevent:*` + `duration:*` | Smoke Signals, Sundial, Digital Secretary |
| Static protect | `protect:self` + `protect:move/discard/value-change/score-effects` (+source) | Anarchy, Moon Base, Clean Power, Blacksmithing, Damascus Steel |
| React cancel | `react:*` + `react:cancel` (+cost, +cancel:all-effects-of-source) | Big Rock, Herbalism, Chainmail, Era-Stone |
| React redirect/replace | `redirect:target-to:*` / `replace:*` | Cloth, Thought Police, Combination Drug Therapy |
| React retaliate | `retaliate:discard` + trigger tags | Crusades, International Diplomacy |
| Delayed trigger (trap) | `play:delayed-trigger` + `trigger:*` + `trigger:limit:once` | Media Scandal, Television, Hunting Party |
| Ongoing trigger | `ongoing:trigger:*` + persistence tags | Waylay, Crop Rotation, Taxes, Dot Com |
| Recover | `play:recover` + from/to/cost | Grave Robbing, Water Wheel, Thermodynamics, Recycling, Era-Modern |
| Requires (gate) | `play:requires-card` + `requires:subtype/scope/in-scoring-slot` | Androids, AI, The Internet |
| Bespoke | Mysticism (guess), Fortune Teller (peek), Navigation, Philosophy, Telecommunications (extend), Zero (set-value), Era-Medieval (steal bonus) | one-offs; still tag-driven |

Bespoke cards get dedicated executors but must still consume only tags + context.

## 6. Evaluation Contexts

```ts
interface BaseContext {
  G: TimestreamsState;
  actingPlayerId: string;           // player whose card/effect is resolving
  card: TimestreamsCard;            // card whose tags are being evaluated
}

interface PlayContext extends BaseContext {
  targetEraId?: EraId;              // "today" default for inventions
}

interface ScoreContext extends BaseContext {
  eraId: EraId;
  slotIndex: number;                // 0-based slot being processed
  scoredCardIds: Set<string>;       // per-card scored flags (ruling §3.1)
  phase: 'slots' | 'delayed' | 'cleanup';
}

type ReactEvent =
  | { type: 'move';            targetCardId: string; fromEraId: EraId; toEraId: EraId; sourceCardId?: string; actorPlayerId: string }
  | { type: 'discard';         targetCardId: string; sourceCardId?: string; actorPlayerId: string }
  | { type: 'point-value-changed'; targetCardId: string; delta: number; actorPlayerId: string }
  | { type: 'invention-played'; cardId: string; eraId: EraId; actorPlayerId: string }
  | { type: 'action-played';    cardId: string; actorPlayerId: string }
  | { type: 'targeted';        targetCardId: string; sourceCardId: string; actorPlayerId: string }
  | { type: 'bonus-points';    amount: number; toPlayerId: string }
  | { type: 'era-begin';       eraId: EraId };

interface ReactContext extends BaseContext { event: ReactEvent; }
```

Required queries: era stacks (ordered), scoring-slot membership (dynamic slot counts), offset/adjacent lookup, deck-membership test, subtype lookup across all zones, per-card scored flags, active duration modifiers, hands/discards/score piles.

## 7. Execution Model

### 7.1 Play resolution
1. Gate: `play:requires-card`, government invariant, prevent-modifiers in force.
2. Placement (invention into Today by default; `play:scope:*` overrides; `play:attach` selects host within `attach:scope`).
3. Fire `invention-played`/`action-played` events → collect reacts/ongoing triggers → resolve (respecting deciders and optionality).
4. Execute play tags; emit prompts for choices; apply duration modifiers; register delayed/ongoing triggers.

### 7.2 Score resolution (replaces M1 placeholder)
For each era in order (stone → future):
1. Compute slot count (base 6 ± slot effects, incl. era-future's choice).
2. While slots remain: score the topmost **unscored** card (Wonky rule — restart from top after any movement), resolve its score tags, mark scored. Movement/discard during resolution fires react events.
3. `phase: 'delayed'`: fire `delayed:trigger:after-destination-era-scored` effects targeting this era (still-in-play check here — before cleanup).
4. `phase: 'cleanup'`: discard non-slot inventions, collect slot inventions to owners' score piles.

Every mutation routes through event-emitting primitives so protects/reacts/redirects are consulted uniformly (`wouldMove`, `wouldDiscard`, `wouldChangeValue`).

### 7.3 Reacts pipeline
On each event: (1) static `protect:` check — cancel/permit; (2) redirect/replace reacts — may retarget the event (re-check protects on the new target); (3) optional reacts offered to their owners as prompts (mandatory ones auto-fire); (4) retaliations queue after the triggering effect resolves. `limit:once-per-game` / `trigger:limit:once` consume charges tracked in state.

## 8. Player Choice & Prompting

```ts
interface EffectResult {
  stateChanges?: Partial<TimestreamsState>;
  prompts?: PlayerPrompt[];   // { deciderId, kind, options|targetSet, min, max, context }
  log?: string[];             // which tags fired, for replay/debug
}
```

Prompt kinds required: choose-card (target sets computed from target/scope tags), choose-option (option-a/b), choose-number (Mysticism 1–4), use-react (yes/no), order-cards (Fortune Teller return order), choose-era/position (moves with free destinations). Deciders come from `decider:` tags — never inferred.

## 9. Temporary & Continuous State

- Duration modifiers: `duration:rest-of-today` (cleared on day advance), `duration:rest-of-game`.
- Ongoing/delayed trigger registry: watcher card id, trigger spec, remaining charges, era anchor (`trigger:scope:attached-era` follows the host).
- Once-per-game charges (era cards, Chainmail-style costs are self-consuming instead).
- Per-card scored flags during the score phase; first-score memory (`condition:first-score`, Space Travel).

## 10. Engine Surface (src/effects.ts or src/rules.ts)

```ts
export function canPlayCard(G, playerId, cardId): { ok: boolean; reason?: string };
export function resolvePlayEffect(G, playerId, cardId, choices?): EffectResult;
export function resolveScoring(G, choiceProvider): void;          // replaces placeholder
export function getAvailableReacts(G, event: ReactEvent): ReactOpportunity[];
export function applyReact(G, playerId, cardId, event): EffectResult;
// queries
export function isDeckMember(cardId: string, deck: DeckId): boolean;
export function cardsMatchingTags(G, tagPredicates, scope): TimestreamsCard[];
export function effectiveScoreValue(G, cardId): number;           // printed ± modify: attachments ± set-value
```

Low-level mutation primitives (moveCard, discardCard, changeValue, addScoringSlots…) live in `timeline.ts`/`boardOps.ts` and emit react events.

## 11. Implementation Roadmap

- **M2 — Play effects:** gates/requires, placement/attach, draw/discard/recover, moves & swaps (all four shapes), prevent+duration, extra-turn, copy-play-ability, choice prompts.
- **M3 — Score & reacts:** Wonky slot walker with scored flags, all score shapes, branch/perform/count/copy executors, delayed window, cleanup/collection, full react pipeline (cancel/redirect/replace/retaliate), era-card abilities, once-per-game charges.
- **M4 — Hardening:** exotic interactions (Telecommunications scope extension, Pottery double-score E2E, multi-Cloth redirect choice), tag-fired logging, fuzzed interaction tests.

## 12. Testing Strategy

- Unit tests per executor shape; table-driven "tags + context → mutations/prompts".
- **Tag coverage gate:** every tag in every manifest must be consumed by a registered executor; unknown tags fail CI (catches vocabulary drift — the failure mode the conformance pass fixed).
- Ruling regression tests, one per §3 item (e.g. cancel-after-scored is rejected; Pottery scores twice; Waylay fires after Today advances).
- E2E with real scanned packs over a scripted choice provider.

## 13. Non-Goals

- Generating human text (stays in manifest fields / `composeCardText`).
- UI rendering of prompts (engine only describes them).
- AI/solver play.

---

Resolved items from manifest review: `tag_definitions.md` is generated by `scripts/generate_tag_inventory.py`; Chaos Theory keeps its named modes (`perform:`/`cancel:`), which the engine treats as choice branches; multi-Cloth redirect is ruled (defending owner chooses — §3.13); redirect into an immovable card is ruled (fizzles, as an intended combo — §3.14). No open rulings remain.
