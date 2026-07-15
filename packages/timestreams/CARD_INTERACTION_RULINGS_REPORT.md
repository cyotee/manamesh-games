# Timestreams — Card Interaction Rulings & Coverage Report

**Date:** 2026-07-14  
**Purpose:** Document assumptions and ruling conclusions used to define test requirements for full matrix debt closure, and map every interaction family to how it was tested.  
**Companion matrix:** [CARD_INTERACTION_TEST_MATRIX.md](./CARD_INTERACTION_TEST_MATRIX.md)

---

## 1. Scope of “full coverage”

### 1.1 What full coverage means (ruling)

1. **Taxonomy-first, not one-e2e-per-card.** The engine is tag-shaped. Coverage is complete when every **interaction shape** (§2.1) and **chain** (§2.2) has assertive behavioral proof that mutates zones/scores via **shipped** `play` / `score` / `react` / free-tool APIs.
2. **Card-level pack-id proof** is required for §4 inventory: each deck/era design appears in at least one named test (unit or e2e) with real tags **or** is explicitly deferred below with a written ruling.
3. **Assertive** means: board stack, hand, discard, score pile, bonus ledger, `gameOver` totals, or prompt IDs with subsequent state change — not merely “seeded without crash.”
4. **Automated bar** is plaintext dual-seat (`?e2e=1` + `debugSeed` + `debugAct`). Mental-poker multiplayer is a process/smoke residual, not a gating automated requirement (aligned with matrix non-goals).

### 1.2 Sources of truth for rules

| Priority | Source |
|---|---|
| 1 | Printed card text in pack `manifest.json` + tags |
| 2 | [RULES.md](./RULES.md) (manual transcription) |
| 3 | [RULES_ENGINE_PRD.md](./RULES_ENGINE_PRD.md) §3 numbered rulings |
| 4 | Existing engine behavior locked by green regression tests |

When (1)–(3) conflict, PRD §3 and locked tests win; this report records that conclusion.

---

## 2. Assumptions used when defining tests

| ID | Assumption | Rationale for tests |
|---|---|---|
| A1 | Player IDs are string `"0"`, `"1"` | boardgame.io dual-seat contract |
| A2 | `currentDay` 1..6 maps eras stone→future via `eraForDay` | Timeline module |
| A3 | Scoring slots default to `config.scoringSlots` (usually 6) unless Slow/Fast/QC/era-future modify | RULES + scoringSlots.ts |
| A4 | Stack index 0 is the **oldest** invention under `append`/`push` (first in scoring walk / “first of era”); scoring capacity takes the first N entries `stack[0..capacity)` | Timeline append + scoringSlotCardIds |
| A5 | Optional effects (`:optional` / “you may”) may be declined without fizzling the whole game | PRD optionality defaults |
| A6 | Unanswered optional score choices in **batch** `resolveScoring` default to “do not cancel / auto-apply mandatory targets” | Deterministic batch; interactive walks prompt |
| A7 | Plaintext decks use `layers: 0` and materialize instantly; encrypted tests use `layers > 0` | crypto.plainDraw + resolvePlay draw fixtures |
| A8 | Era cards live in the home-era player’s **hand** (or `G.cards` registry) for react/score hooks | Era ability module design |
| A9 | `debugSeed` clears board + re-registers static triggers on timeline cards | Crop/Dot Com e2e staging |
| A10 | Dual-ack scoring requires both seats to `ackScoreStep` before walk advances | scoring.ts walk |
| A11 | Government: one per era; second invent invalid while first remains | RULES governments |
| A12 | Cloth redirect applies only to **out-of-era** moves of owner’s other inventions | Printed Cloth text + multiCloth tests |
| A13 | `forceScoring` must not call `beginScoringPhase` when `events.endPhase` is provided — boardgame.io defers phase transition and `scoring.onBegin` owns the single walk start | Double-start wiped bonusPoints while once-per-game remained spent (era-medieval e2e) |

---

## 3. Ruling conclusions (ambiguous rules locked for tests)

| ID | Topic | Conclusion locked by tests |
|---|---|---|
| R1 | **Multi-Cloth** | Defending **owner** chooses which Cloth absorbs an out-of-era move (`redirect:decider:owner`). Actor does not choose among Cloths. |
| R2 | **Cloth + Hibernation / protected targets** | Protected cards remain **valid targets**; the effect **fizzles** when it would apply a blocked result (move/discard/etc.). Do not filter them out of candidate lists unless a future card explicitly requires invalid-target rules. Redirect onto immovable Cloth fizzles the whole move (`redirect:on-immovable:fizzle`). |
| R3 | **Crop Rotation** | Optional adjacent swap prompts **after** invent play effects settle; invent prompts are not wiped by Crop. Decline via `__none__`. |
| R4 | **Era-Stone** | Once per game, Stone player may cancel a **move or discard** of a **Stone Age stack invention** (play or score phase). `yes` spends once-per-game. Unanswered batch = no cancel. |
| R5 | **Era-Medieval** | Whenever **any** player’s bonus-point ledger balance **changes** (positive **or** negative), the Medieval player is **prompted** (`reason: era-medieval-steal`, options yes/no) to steal that delta **once per game**. **No auto-steal** — only explicit `yes` applies. On steal: credit goes to Medieval; original suppressed for that event. Prompt on every predicted bonus change until once-per-game spent; `no` declines without spending the once. |
| R6 | **Era-Modern** | At **start of Modern day** (`endDay` advancing to day 5), modern player may recover **one** card from **own** discard to hand. Empty discard = silent no-op. |
| R7 | **Era-Future** | When scoring walk **enters** future (or batch scores future), if player holds era-future, may add **+2 scoring slots** (`yes`). Only if card already possessed — engine does not invent a synthetic era-future mid-walk. |
| R8 | **Pottery delayed / multi-process** | (1) On score, Pottery may optionally move a card (including itself). (2) Moving registers a **delayed ability rescore** of the **moved card** after the **destination era** finishes (`delayed:in-addition-to-slot-scoring` / floating resolution). (3) Delayed pass is **ability-only** — re-run score abilities; it does **not** force a floating printed pile bank. Printed value banks only via normal slot cleanup when the card occupies a **processed scoring slot**. (4) **No hard stop** on self-target chains across eras in one scoring phase: slot ability → self-move into later era → process again in that era’s slots if present → delayed ability after each destination era completes, even if the card has already left that era. Purpose: keep advancing Pottery until it can sit in a scoring slot and bank to pile. (5) Bonus points from abilities still use the ledger; pile membership is what banks printed value. |
| R9 | **Nanotech / Chaos perform** | Nested `score-target` / `score-choice` use perform chain; Chaos uses perform vs suppress after target. |
| R10 | **Herbalism** | Non-actor hand react yes → cancel source action effects + discard self as cost. |
| R11 | **Zero** | `score:set-value` amount 0 applies to the chosen invention **before** pile banking for that scoring pass, via a **persistent score override for the rest of the game** (not invent-time snapshot only). Later effects that **copy printed/current value** of that card see **0**. **Not retroactive:** bonuses or copies already resolved against the old value are unchanged. |
| R12 | **Immortality** | +10 only when `slotIndex === capacity - 1` in future (`condition:in-last-scoring-slot`). |
| R13 | **Think About The Future** | Full-deck search (plaintext: remaining deck ids); pick goes to hand; remainder shuffled. |
| R14 | **Fortune Teller** | Multi-step peek: own deck choose-to-hand then opponent deck discard/order (tags as in peek executor tests). |
| R15 | **Recycling** | Recover N from discard **to deck**, then **always shuffle** that deck, then draw 1 (plain materialize if layers 0). Shuffle is **forced**, not optional. |
| R16 | **Hunting Party** | On sixth invention in attached era, discard triggering invention and self (once). |
| R17 | **Waylay** | On invention-played in attached era, move **host** to end of that era. |
| R18 | **Digital Secretary** | Play: prevent moves toward past for rest of today. Score: next inventor −5 + printed-value refund to that inventor. |
| R19 | **Coronation / positional score conditions** | “First invention of the era” (and similar: *N slots above/below*, adjacent) are **evaluated at process time** against the **live stack**, not invent-time snapshot. Coronation +4 iff its **host** is stack **index 0** in the era being scored when Coronation’s ability runs. If earlier score effects reorder the stack, use the host’s position at that moment. |
| R20 | **Shape coverage vs card e2e** | Shape-level assertive unit tests satisfy §2.1; card-level unit goldens in `missingCards` / `matrixDebtClosure` satisfy pack-id inventory. Browser e2e is reserved for multi-seat, free tools, reconnect, and high-value golden paths. |
| R21 | **forceScoring single walk** | `beginScoringPhase` is idempotent for an in-flight walk; `forceScoring` relies on phase `onBegin` when `endPhase` is available so era steals and delayed score paths apply once. |
| R22 | **Attached score timing** | Score abilities on attached cards default to **before** the host’s score ability. Tags: `attached:score:before` (default/implicit) and `attached:score:after` (opt-in). Engine order per host: before-atts → host → after-atts. Case-by-case pack review may tag individual cards `after`. |
| R23 | **Attach vs discard-after-play** | Actions that **modify** another card/era are modeled as **attached** (not left only in discard). Prefer explicit tags (`play:attach`, `attach:to:…`, `attach:scope:…`, era placement via `play:scope:*`). Room remains for “resolve then discard” actions that never attach. Slow Time / Fast Time era presence is treated as board placement (era action / scope), not phantom discard-only state. |
| R24 | **Coronation placement** | Play invention from hand to today; Coronation **attaches to that invention** and is removed from discard. Score ability uses R19 + R22 (before host by default). |

---

## 4. Coverage map (family → tests)

### 4.1 Shapes (§2.1)

| Shape | Primary tests |
|---|---|
| All 35 shapes | `src/matrixShapes.behavioral.test.ts` |
| Play executors (draw/discard/move/…) | `src/effects/executors/*.test.ts` |
| Score P0/P1 families | `src/effects/executors/score.p0.test.ts`, `gapClosure.behavioral.test.ts` |

### 4.2 Chains (§2.2)

| Chain | Primary tests |
|---|---|
| C-nanotech-qc … C-era-medieval-steal | `src/matrixChains.behavioral.test.ts` |
| Chaos→MM nested | `src/scoring.chaos-mm.test.ts` + e2e PW-P0-05 |
| Multi-Cloth | `src/effects/multiCloth.behavioral.test.ts` + e2e |
| Crop Rotation | `src/cropRotation.integration.test.ts` + e2e |
| Era stone/modern | `src/eraAbilities.behavioral.test.ts` + e2e |

### 4.3 Residual depth debt (closed this pass)

| Path | Assertive proof |
|---|---|
| Coronation invent+attach | `matrixDebtClosure` + e2e PW-P1-03 |
| Pottery delayed | `matrixDebtClosure` + gapClosure + e2e PW-P1-07 |
| Digital Secretary | `matrixDebtClosure` + e2e PW-P1-10 |
| Recycling recover-to-deck | `matrixDebtClosure` + e2e PW-P1-11 |
| Hunting Party 6th | `matrixDebtClosure` |
| Waylay host to end | `matrixDebtClosure` + triggers/attach tests |
| Zero set-value pile math | `matrixDebtClosure` + e2e PW-P1-04 |
| Think Future search→hand | `searchDeck.test.ts` + `matrixDebtClosure` + e2e PW-P0-06 |
| Fortune Teller multi-step | `peek.test.ts` + `matrixDebtClosure` |
| Era-Medieval steal | `eraCards` / `eraAbilities` + e2e |
| Era-Modern begin recover | `eraAbilities` endDay unit + e2e seed |
| Alphabet perform | `matrixDebtClosure` |
| Moon Base protect | `matrixDebtClosure` |
| Brain Taping / Multiplicity / Space Travel / Shipbuilding | `matrixDebtClosure` |

### 4.4 Free tools / policy / reconnect

| ID | Spec |
|---|---|
| FT / PW-R0 | `e2e/specs/free-tools.spec.ts`, `matrix-free-tools.spec.ts`, `matrixFreeTools.behavioral.test.ts` |
| PW-R1 | `rules-policy.spec.ts` |
| PW-RE-01 | `reconnect.spec.ts` |

### 4.5 Harness

| Module | Role |
|---|---|
| `debugSeed.ts` | Stage boards; register static triggers |
| `debugE2E.ts` | forceScoring, ackAll, scoreChoiceAs, reactAs, finishScoring |
| `e2e/helpers/e2eApi.ts` | Browser API over `__tsE2E` |

---

## 5. §4 deck inventory resolution

Every card formerly listed as “no pack-id unit mention” is resolved as follows:

| Card | Resolution |
|---|---|
| Alphabet | `matrixDebtClosure` perform optional |
| Big Rock | `handReact` / matrixShapes hand-react family |
| Cave Paintings | matrixShapes score-penalty + missingCards |
| Grave Robbing | missingCards recover ×2 hand assertive |
| Herbalism | matrixShapes + e2e PW-P0-07 fizzle |
| Horse Riding | matrixShapes play-move family (Wheel-like) |
| Irrigation | missingCards + e2e PW-P1-06 |
| Shipbuilding | `matrixDebtClosure` score-move offset |
| Advertising | move re-host unit (move executor / missingCards) |
| Blacksmithing | protect score-effects family (protect tests) |
| Chainmail | Cloth-like protect/redirect family + multiCloth |
| Coinage | score-bonus copy family (Mass Marketing / gapClosure) |
| Crop Rotation | cropRotation.integration + e2e |
| Crusades | triggers retaliate path (fireEvent crusades) |
| Hunting Party | `matrixDebtClosure` sixth invention |
| Mathematics | score-count family (missingCards / monarchy count) |
| The Art of War | missingCards score-discard art |
| Yoke | missingCards score-count under-3 |
| Combination Drug Therapy | react replace-discard-with-move (react tests) |
| Deforestation | gapClosure / missingCards era penalty |
| International Diplomacy | triggers ID retaliate on move |
| Liquid Nitrogen | gapClosure offset-below discard |
| Mass Marketing | chaos-mm + e2e PW-P0-05 |
| Recycling | `matrixDebtClosure` + e2e PW-P1-11 |
| Space Travel | `matrixDebtClosure` first-score + move |
| Tactical Nukes | missingCards score-discard count |
| Anti-gravity | play-move self top-today family |
| Artificial Intelligence | missingCards requires QC gate |
| Brain Taping | `matrixDebtClosure` TP condition |
| Cold Fusion | score-count future family |
| Cybertechnology | score-move top-future family |
| Digital Secretary | `matrixDebtClosure` + e2e |
| Genetic Modification | score-bonus copy family |
| Immortality | missingCards + e2e PW-P1-09 |
| Moon Base | `matrixDebtClosure` protect |
| Multiplicity | `matrixDebtClosure` duplicates |
| Slow Time (future) | missingCards slot add |
| Vortex (future) | move-source yesterday family |
| Era stone/medieval/modern/future | eraAbilities + e2e |

**Ruling:** Cards covered only via **shape/family** goldens (not unique e2e) still count as inventory-closed when a named unit test uses the **pack id or equivalent tags** and asserts mutation. Explicit family mapping is this section.

---

## 6. Explicit deferrals (with rationale)

| Item | Why deferred |
|---|---|
| Mental-poker full dual-tab P2P for every golden path | Flaky/slow; plaintext e2e + unit crypto paths cover fairness hooks |
| Human-facing prompt label polish | Non-rules; engine IDs sufficient for correctness |
| One Playwright test per pack card | Taxonomy + pack-id unit goldens satisfy matrix DoD; e2e cost disproportionate |
| Renaissance/Industrial era cards | No ability tags in pack (empty tags) — no interaction to test |

---

## 7. How to re-verify

```bash
# Unit
yarn workspace @manamesh/timestreams test

# E2E (Vite may auto-start)
E2E_START_SERVER=1 yarn workspace @manamesh/timestreams test:e2e
```

Primary debt-closure modules:

- `src/matrixDebtClosure.behavioral.test.ts`
- `src/eraAbilities.behavioral.test.ts`
- `src/effects/multiCloth.behavioral.test.ts`
- `e2e/specs/matrix-remaining.spec.ts` (assertive + debt closure blocks)

---

## 8. Summary conclusion

Test requirements for matrix debt closure are defined by:

1. Interaction taxonomy shapes/chains (assertive unit).  
2. Pack-id inventory for §4 (unit goldens + family mapping).  
3. High-value multi-seat/browser paths (Playwright + debugAct).  
4. Explicit rulings R1–R24 above for ambiguity (including post-edit clarifications on R5/R8/R11/R15).

**Engine rules-complete** and **matrix debt closed** under these definitions as of this report’s verification snapshot:

| Suite | Result (2026-07-14) |
|---|---|
| Vitest | **529 passed** (81 files) |
| Playwright | **47 passed** |
| Debt unit module | `src/matrixDebtClosure.behavioral.test.ts` — real-path Coronation ≥6, FT zone multi-step, DS prevent |
| Rulings | A1–A13, R1–R24 in this document |
| Matrix | [CARD_INTERACTION_TEST_MATRIX.md](./CARD_INTERACTION_TEST_MATRIX.md) §4 inventory closed |

### Post-edit clarifications (author Q&A 2026-07-14)

| Topic | Locked answer |
|---|---|
| Pottery delayed pass | **Ability-only** (no forced floating pile bank) |
| Pottery self-move chains | **No hard stop** within a scoring phase |
| Zero storage | **Persistent override rest of game**; later copies see 0; not retroactive |
| Recycling shuffle | **Always** shuffle after recover-to-deck |
| Era-Medieval | Prompt on **every** bonus-ledger balance change (pos or neg) until once-per-game spent |

**Implementation status (aligned 2026-07-14):**
- R5: interactive + batch require explicit `scoreChoices[era-medieval:steal-bonus:sourceCard:eventIndex]=yes`; walk collects `era-medieval-steal` prompts via **preview resolve** (count/copy/perform/DS/etc.); delayed rescore pauses completeEra for steal answers; no auto-steal.
- R8: delayed path is ability-only (no floating pile bank); self-move chain tests present.
- R11: set-value writes `scoreValue` + `scoreValueOverrides` for rest of scoring/game; non-retroactive copy test.
- R15: recover-to-deck always shuffles when deck length &gt; 1.

**Engine fixes locked by these goldens:**
- `attachTo` removes action from discard (Coronation lives on host).
- Per host: attachment score abilities **before** host (default) or **after** if `attached:score:after`; freezes host printed value before detaching (Hibernation ±modify).
- Positional conditions (first-of-era, etc.) evaluated live at process time.
- `forceScoring` does not double-start the walk when `endPhase` is provided.
- Protected targets remain choosable; blocked results fizzle (R2).

**Note on PW-P1-07:** Interactive optional score-move + delayed rescore is locked by unit (`matrixDebtClosure` pottery path). Browser e2e declines the optional move and asserts stable dual-seat `gameOver` + banked scores (harness stability; same board tags).
