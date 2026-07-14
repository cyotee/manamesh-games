# Timestreams Rules Engine — Full Gap Report

**Date:** 2026-07-10  
**Branch context:** `feat/manamesh-crypto-and-poker-contracts`  
**Sources reviewed:**
- [RULES.md](./RULES.md), [RULES_ENGINE_PRD.md](./RULES_ENGINE_PRD.md)
- Pack manifests under `assets/packs/timestreams/**/manifest.json`
- Production engine under `src/effects/**`, `src/scoring.ts`, `src/play.ts`, `src/scoringSlots.ts`
- Tests under `src/**/*.test.ts(x)` (59 files)

**Related (superseded for engine correctness):**
- [TAG_TEST_GAP_REPORT.md](./TAG_TEST_GAP_REPORT.md) — 2026-07-08 tag-string inventory; phases marked complete but many “tests” are non-throwing smokes
- [TAG_TEST_IMPLEMENTATION_PLAN.md](./TAG_TEST_IMPLEMENTATION_PLAN.md) — prior plan; DoD was satisfied by smoke, not behavioral proof

**Companion plan:** [RULES_ENGINE_GAP_CLOSURE_PLAN.md](./RULES_ENGINE_GAP_CLOSURE_PLAN.md)

**Implementation status (2026-07-10):** Gap-closure Phases 0–6 largely landed. See matrix §6 **Status** column and plan progress log. Remaining: Crop Rotation interactive swap UI, multi-Cloth owner choice, full era-card E2E.

---

## 1. Executive summary

The rules engine remains **architecturally tag-shaped** (dispatch by tags to shared executors; little hardcoding of card ids/names). That is the correct design per the PRD.

However, **completeness and proof are inadequate**:

1. **Many pack tags are never fully evaluated** — cards appear to “work” (no crash) while printed effects are wrong or silent no-ops.
2. **The coverage gate is soft** — `tagCoverage.test.ts` only requires a handled/deferred *prefix*; score/react families are still listed as deferred.
3. **Parameterized “P1 full family smoke” creates false confidence** — every tag string now appears in a test file (295/295 exact string hits), but most smokes only assert `phase === "gameOver"` or “does not throw,” **not** correct mutations, scores, or board state.
4. **Board-level reacts and several score shapes are stubs** — `applyReactsForEvent` logs reactors without applying Dot Com / Crop Rotation / era abilities.

**Bottom line:** Prior iterations closed many structural gaps (Nanotech chains, QC slots, hand reacts, mutual discard) but left a class of failures that **smoke tests cannot catch**. Closing gaps requires (a) implementing missing shape evaluation and (b) replacing smoke-as-coverage with **assertive behavioral tests**.

---

## 2. Inventory snapshot

| Metric | Value |
| --- | ---: |
| Unique tags in pack manifests | **295** |
| Pack cards (deck + era + aids) | **108** |
| Test files | **59** |
| Tags with exact string in *any* test | **295** (100%) |
| Tags with **behavioral** proof (mutation/score asserted) | **≪ 295** (see §5) |
| Card ids/names appearing in non-smoke tests | **~77 / 108** |
| Card ids/names absent from non-smoke tests | **~31** (see §5.4) |
| Critical tags present in tests but **absent from production evaluation** | **≥ 20** (see §3) |

### 2.1 What “tested” currently means (and why it failed us)

| Layer | What existing tests often prove | What they fail to prove |
| --- | --- | --- |
| `tagCoverage.test.ts` | Tag has a known prefix | Tag is consumed; effect is correct |
| `p1Families.full.test.ts` | Scoring/play with tags does not throw | Correct bonus, discard target, condition gate, react fire |
| `score.p0.test.ts` / scoring.* | Some high-value shapes (Nanotech, QT branch, Mysticism) | Poetry/Immortality/Longbow/Pottery delayed/Deforestation |
| Executor unit tests | Happy paths for play shapes | Full pack tag combinations; score-time variants |
| Board tests | UI shell, some prompts | Board reacts, delayed score UI, recover-to-deck |

**Key anti-pattern found:**

```ts
// p1Families.full.test.ts — example pattern
it.each([ ... tags ... ])("%s scores without throwing", (_name, tags) => {
  scoreWith([...tags]); // only expects G.phase === "gameOver"
});
```

This is why Poetry’s `condition:odd-scoring-slot` can be “in tests” while production never reads the tag and always awards +2.

---

## 3. Engine correctness gaps (by severity)

### 3.1 P0 — Printed rules wrong or silent no-op

#### S-01 · Conditional bonus points incomplete
**Where:** `src/effects/executors/score.ts` bonus branch  
**Implemented conditions (partial):** `scored-in-era:future`, `in-era:future`, `attached-to-first-invention-of-era`  
**Missing conditions (still on packs):**

| Tag(s) | Card | Observed / expected |
| --- | --- | --- |
| `condition:odd-scoring-slot` | Poetry | Always +2; should only odd slots |
| `condition:in-last-scoring-slot` (+ `in-era:future`) | Immortality | +10 whenever in Future; should last slot only |
| `condition:subtype:thought-police` + `in-scoring-slot` + `scope:same-era` | Brain Taping | Always +2; should need Thought Police in slot |
| `condition:first-score` on **bonus+move** path | Space Travel | Only partially handled under `score:branch`; Space Travel uses bonus+move, not branch |

#### S-02 · Cloning additional bonus never applies
Tags: `bonus-points:additional:2`, `additional:condition:target-deck:future-tech`  
Code uses `hasTag(card, 'bonus-points:additional')` which is **exact match** and fails for `bonus-points:additional:2`. Deck condition is unread.  
**Result:** Cloning never adds +2 for Future Tech cards above it (and may never add additional at all).

#### S-03 · Digital Secretary half-implemented
Tags: `score:penalty:next-inventor` (−5) **and**  
`bonus-points:to:next-inventor` + `bonus-points:printed-value:their-invention`  
No `score:bonus-points` and no branch for “refund printed value to next inventor.”  
**Result:** Only −5; missing “then score bonus equal to their invention’s printed value.”

#### S-04 · Deforestation not implemented
Tags: `score:penalty`, `score:to:all-players`, `penalty:per:1`, `count:own-inventions`, `count:scope:this-era`  
Penalty path does not implement `penalty:per` + count filters.  
**Result:** Silent no-op or wrong scores.

#### S-05 · Score discard target resolution incomplete
`score:discard` handles bottom-of-era + generic choice/auto first candidate. Missing:

| Tag | Card | Bug |
| --- | --- | --- |
| `discard:target:offset-below:3` | Longbow | Wrong target (not 3 below) |
| `discard:target:offset-below:1` | Liquid Nitrogen | Same |
| `discard:target:art` + any-era | Art of War | Art filter / scope not applied |
| `cost:discard-self` + `discard:count:2` | Tactical Nukes | Self-cost + multi-target missing |

#### S-06 · Pottery delayed double-score broken
On move, delayed trigger stores `sourceCardId = moved card`, but delayed tags live on **Pottery**.  
`completeEra` looks for `score:delayed` / `delayed:even-non-scoring` on the *source* card (the moved invention).  
**Result:** “After destination era scores, score that card again even if non-slot” does not match PRD §3.1 / §3.3.

#### S-07 · Hibernation does not suppress host score effects
Attachment has `suppress:score-effects-on-target`, not `protect:score-effects`.  
`isProtected(..., 'score-effects')` only checks `protect:score-effects` on attachments.  
**Result:** Host still runs score abilities; only move/discard protection works. Printed: “Do not process score effects on that Invention.”

#### S-08 · Recycling recover-to-deck is a no-op
`recover.ts`:
```ts
if (!toHand) return done([`${card.id}: recover deferred (non-hand destination)`]);
```
`recover:to-deck` + shuffle never runs.

#### S-09 · Board react pipeline stubs
`applyReactsForEvent` discovers reactors and **only logs** them. Not applied:

| Card / era | Tags | Missing behavior |
| --- | --- | --- |
| Dot Com | `react:invention-played`, `react:move`, `trigger:mandatory`, `condition:higher-value-invention`, `discard:self` | Mandatory self-discard when higher-value invention enters era |
| Crop Rotation | `ongoing:trigger:invention-played`, swap adjacent | Never registered on play (only Waylay registers via attach) |
| Era-Stone | `react:cancel`, `limit:once-per-game`, `protect:target:era-invention` | Once-per-game cancel |
| Era-Medieval | `react:bonus-points`, `steal:bonus-points` | Helper exists; not wired into full scoring award path for era card |
| Era-Modern | `react:era-begin`, recover from discard | Era-begin not fired/handled |
| International Diplomacy | retaliate on move / value-change | Partial discard path only |
| Chainmail | in-play cancel with cost | Not fully integrated as board reactor |

`registerStaticTriggers` only registers `ongoing:trigger:discarded-from-play` (Taxes). Crop Rotation’s ongoing invention-played is never registered.

#### S-10 · Multiplicity count shape missing
`count:duplicates:own-inventions` — not implemented in `countForOwner`. Multiplicity scores wrong (likely 0 extra).

---

### 3.2 P1 — Shape purity / partial implementations

#### P-01 · Chaos Theory vs Hibernation tag collision
Chaos Theory reuses `suppress:score-effects-on-target` for “cancel target’s score effects” choice mode, while Hibernation uses the same tag for attach suppress. Detection:

```ts
hasTag(card, 'suppress:score-effects-on-target') || hasTag(card, 'score:choice')
```

inside `score:perform-other`. Works for current packs only; ambiguous for future cards. PRD prefers named modes (`perform:` / `cancel:`) as choice branches.

#### P-02 · `isProtected` over-protects reactors
```ts
if (hasTag(target, 'protect:scope:same-era')) return true; // move/discard
if (hasTag(target, 'protect:target:own-inventions') && mutationType === 'move') return true;
```
Cloth/Chainmail carry these as **protect-others / redirect** tags. Applied to the target itself they incorrectly hard-protect the reactor card.

#### P-03 · Multi-Cloth redirect incomplete
Tags `redirect:decider:owner`, `redirect:target-filter:any`, `redirect:on-immovable:fizzle` (PRD §3.13–3.14) are only partially realized; multi-Cloth choice and intentional fizzle combos need explicit tests + full path.

#### P-04 · Play move destinations incomplete
`move.ts` `parseDestination` lacks:

| Destination | Card |
| --- | --- |
| `any-position-same-era` | The Internet |
| `different-invention` + `move:target:action` | Advertising (attachments vs stack) |

#### P-05 · Era-Future score choice shape incomplete
Tags: `score:choice` + `score:add-scoring-slots:2` without `option-a`/`option-b`.  
Prompt collection and `slotDeltaFromScoreChoice` expect option-a/b. Optional +2 at score time is not fully general.

#### P-06 · Score discard auto-pick
When mandatory and multiple candidates, first candidate is auto-selected — violates “engine never guesses” (PRD §1 / §8).

#### P-07 · Coverage gate still defers score/react
`tagCoverage.test.ts` `DEFERRED_PREFIXES` includes `score:`, `react:`, `bonus-points:`, `count:`, `delayed:`, etc. Contradicts PRD §12 spirit for post-M3 engine.

#### P-08 · Docs anti-example
`types.ts` still documents `requires:stone-age-cloth` as a tag example — card-id gating, not the subtype/shape model.

---

### 3.3 Acceptable card-specific references (not gaps)

These name other cards by design (subtype / mutual-discard):

- `requires:subtype:nanotech` / `quantum-computing` / `telecommunications`
- `mutual-discard:subtype:slow-time`
- `target:subtype:nanotech` / `quantum-computing`
- `condition:subtype:thought-police` (once condition evaluator exists)

Production code does **not** switch on card display names for evaluation. Comments naming Nanotech/Alphabet/etc. are fine.

---

## 4. Architecture health (what is *not* broken)

| Area | Assessment |
| --- | --- |
| Play executor registry | Sound — tag-keyed, extensible |
| Steal vs perform-other | Tag-driven (`steal:target-to:own-score-pile`) |
| Mutual discard | Subtype-driven, not Fast-Time-id-driven |
| Hand reacts (Herbalism, Big Rock) | Tag-shaped + tested |
| Deck membership | Prefix-based, consistent with PRD |
| Telecom extend today→yesterday | Tag-driven |
| QC slot stacking | Running counter (good), not per-card lock |
| Nanotech nested perform | Relatively well-tested |

The design goal is intact; **completeness and proof** are the failure modes.

---

## 5. Test coverage gaps (why these bugs survived)

### 5.1 Three false signals of “done”

1. **Prefix allowlist** — “tag is known” ≠ “tag is evaluated.”
2. **Exact string presence** — 295/295 tags appear in tests after P1 smoke tables were added.
3. **Prior plan checkboxes** — `TAG_TEST_IMPLEMENTATION_PLAN.md` marked Phases 0–6 ✅ with smoke-level DoD.

### 5.2 Behavioral coverage holes by family

| Family / shape | Unit smoke | Assertive behavioral test | Status |
| --- | --- | --- | --- |
| `score:bonus-points` + amount | Yes | Partial (flat amounts) | **Conditions untested assertively** |
| `condition:odd-scoring-slot` | Smoke only | **None** | Gap |
| `condition:in-last-scoring-slot` | Smoke only | **None** | Gap |
| `condition:subtype:thought-police` | Smoke only | **None** | Gap |
| `additional:condition:target-deck:*` | Smoke only | **None** | Gap |
| `bonus-points:to:next-inventor` + printed refund | Smoke (wrong tag shape) | **None** | Gap |
| `penalty:per` + count (Deforestation) | Smoke only | **None** | Gap |
| `score:discard` offset-below | Smoke only | **None** (Guillotine only weak) | Gap |
| `score:discard` art / multi / cost-self | Smoke only | **None** | Gap |
| Pottery delayed + in-addition | Partial move prompts | **No E2E double-score assert** | Gap |
| Hibernation suppress score effects | Attach/protect move | **No score-suppress assert** | Gap |
| `recover:to-deck` | Smoke playAction | **No deck/hand assert** | Gap |
| Dot Com mandatory discard | Tag smoke | **None** | Gap |
| Crop Rotation ongoing swap | **None** | **None** | Gap |
| Era stone/medieval/modern abilities | Partial helpers | **No era-card E2E** | Gap |
| Multiplicity duplicates count | Smoke only | **None** | Gap |
| Internet any-position move | Gate requires only | **No position prompt test** | Gap |
| Advertising re-host action | Smoke tags | **None** | Gap |
| Space Travel first-score + hop | Weak branch test | **No full card path** | Gap |
| Multi-Cloth redirect fizzle | Partial Cloth | **No multi + Hibernation combo** | Gap |
| `count:duplicates:own-inventions` | Smoke | **None** | Gap |

### 5.3 Existing strong tests (keep; do not regress)

These are the model for “real” coverage:

- Nanotech steal / nested / QC slot interactions (`scoring.hybrid`, `scoring.reprocess`, `scoring.slot-stack`, `scoring.perform`)
- Alphabet → Pottery prompt ownership (`scoring.perform`, `scoring.prompts`)
- Mysticism interactive prompts (`scoring.interactive`)
- Quantum Theory branch true/false (`score.p0`)
- Domesticated Animals discard branch (`score.p0`)
- Thought Police optional redirect (`discard.test`)
- Mutual Fast/Slow discard (`mutualDiscard.test`)
- Hand reacts cancel (`handReact.test`)
- Irrigation per-player count (`scoring.irrigation-slots`)

### 5.4 Pack cards with weak or no non-smoke identity coverage

Card id/name **not** found in non-smoke tests (approx.; aids/empty eras excluded from priority):

| Priority | Cards |
| --- | --- |
| **P0 implement+test** | Brain Taping, Immortality, Multiplicity, Deforestation, Liquid Nitrogen, Recycling, Space Travel, Tactical Nukes, Crop Rotation, Advertising, Art of War, era-medieval, era-modern |
| **P1 test** | Cold Fusion, Mathematics, Yoke, Coinage, Mass Marketing, Chainmail, Crusades, Hunting Party, International Diplomacy, Blacksmithing, Grave Robbing, Horse Riding, AI, Anti-gravity |
| **Low** | Empty era cards (Renaissance, Industrial), player aids |

### 5.5 Process gaps

| Gap | Impact |
| --- | --- |
| No “tag must be read by production code” gate | Tags can ship unevaluated |
| No “pack card golden path” suite | Cards can be wrong while families look covered |
| Smoke tables use incomplete tag subsets | Digital Secretary smokes with `score:bonus-points` which the real card lacks |
| Assertions on `phase` / non-throw only | Silent wrong scores pass CI |
| Deferred prefix list never tightened post-M3 | Score/react treated as forever-optional |
| Gap report not re-run after “big fix” iterations | Drift undetected |

---

## 6. Gap matrix (engine × test)

| ID | Gap | Engine | Assertive test | Severity | Status (2026-07-10 impl) |
| --- | --- | --- | --- | --- | --- |
| S-01 | Bonus conditions | Missing | Missing | P0 | **Closed** |
| S-02 | Cloning additional | Bug (hasTag exact) | Missing | P0 | **Closed** |
| S-03 | Digital Secretary refund | Missing | Missing | P0 | **Closed** |
| S-04 | Deforestation | Missing | Missing | P0 | **Closed** |
| S-05 | Score discard targets | Incomplete | Missing | P0 | **Closed** |
| S-06 | Pottery delayed | Wrong wiring | Missing E2E | P0 | **Closed** |
| S-07 | Hibernation suppress score | Missing | Missing | P0 | **Closed** |
| S-08 | Recover to deck | Explicit defer | Missing | P0 | **Closed** |
| S-09 | Board reacts / era | Stub | Missing | P0 | **Partial** (Dot Com; Crop/eras polish open) |
| S-10 | Multiplicity duplicates | Missing | Missing | P0 | **Closed** |
| P-01 | Chaos/Hibernation tag collision | Shape smell | Weak | P1 | Partial |
| P-02 | isProtected over-protect | Bug | Weak | P1 | **Closed** |
| P-03 | Multi-Cloth redirect | Partial | Partial | P1 | Open |
| P-04 | Internet / Advertising moves | Incomplete | Missing | P1 | **Closed** |
| P-05 | Era-Future choice | Incomplete | Missing | P1 | **Closed** |
| P-06 | Auto-pick targets | Policy bug | Missing | P1 | Softened |
| P-07 | Coverage gate soft | Process | Process | P1 | **Closed** |
| P-08 | Docs card-id example | Docs | n/a | P2 | **Closed** |

Behavioral suite: `src/effects/gapClosure.behavioral.test.ts` (14 assertive tests). Package green: **353** tests.

---

## 7. Recommended success criteria (for the closure plan)

The engine is **gap-closed** when:

1. **Every pack tag** is either:
   - consumed by a production evaluator with a **behavioral** test asserting mutations/scores, or
   - explicitly allowlisted with a tracked reason and owner.
2. **Every pack card** with non-empty tags has at least one **golden-path** test using the **real manifest tags** (not a reduced smoke subset).
3. `tagCoverage` (or successor) fails if a pack tag has **no production consumer** (prefix match insufficient).
4. Smoke-only tests are renamed `*.smoke.test.ts` and **do not count** toward coverage DoD.
5. PRD §3 rulings each have a named regression test (already partial; extend to Pottery double-score, Cloth multi-redirect fizzle, Hibernation+Cloth).

---

## 8. Appendix A — Critical tags: in tests vs evaluated in production

Heuristic: exact string presence in non-test `src/**/*.ts` production files (under-counts dynamic prefix parsing, over-counts comments). Cross-checked by code review.

| Tag | In tests | Evaluated in prod (review) | Cards |
| --- | --- | --- | --- |
| `condition:odd-scoring-slot` | yes (smoke) | **no** | Poetry |
| `condition:in-last-scoring-slot` | yes (smoke) | **no** | Immortality |
| `condition:subtype:thought-police` | yes (smoke) | **no** | Brain Taping |
| `additional:condition:target-deck:future-tech` | yes (smoke) | **no** | Cloning |
| `bonus-points:additional:2` | yes (smoke) | **broken** (hasTag exact) | Cloning |
| `bonus-points:to:next-inventor` | yes (smoke) | **no** | Digital Secretary |
| `bonus-points:printed-value:their-invention` | yes (smoke) | **no** | Digital Secretary |
| `penalty:per:1` | yes (smoke) | **no** | Deforestation |
| `discard:target:offset-below:1` | yes (smoke) | **no** | Liquid Nitrogen |
| `discard:target:offset-below:3` | yes (smoke) | **no** | Longbow |
| `discard:count:2` | yes (smoke) | **no** | Tactical Nukes |
| `count:duplicates:own-inventions` | yes (smoke) | **no** | Multiplicity |
| `condition:higher-value-invention` | yes (smoke) | **no** | Dot Com |
| `react:era-begin` | yes (smoke) | **no** | Era-Modern |
| `recover:to-deck` | yes (smoke) | **explicit no-op** | Recycling |
| `delayed:in-addition-to-slot-scoring` | yes | **not correctly wired** | Pottery |
| `move-destination:any-position-same-era` | yes | **no** | Internet |
| `move-destination:different-invention` | yes | **no** | Advertising |
| `suppress:score-effects-on-target` | yes | **partial** (Chaos yes; Hibernation attach no) | Chaos, Hibernation |

---

## 9. Appendix B — Test file map (what they emphasize)

| Cluster | Files | Strength |
| --- | --- | --- |
| Nanotech / QC / slots | `scoring.hybrid`, `reprocess`, `slot-stack`, `qc-*`, `nt-stuck`, `irrigation-slots` | High for those interactions |
| Perform / prompts | `scoring.perform`, `prompts`, `interactive` | High for Alphabet/Pottery prompts, Mysticism UI |
| Score P0 families | `score.p0.test.ts` | Medium — good examples, incomplete set |
| Play executors | `executors/*.test.ts` | Medium — play-time shapes |
| Smoke / false coverage | `p1Families*.test.ts`, `tagCoverage` | Low for correctness |
| Board | `board/*.test.tsx` | Medium for shell; low for react/score edge cases |

---

## 10. Document control

| Version | Date | Notes |
| --- | --- | --- |
| 1.0 | 2026-07-10 | Initial full gap report after engine + pack + test audit |

**Next:** execute [RULES_ENGINE_GAP_CLOSURE_PLAN.md](./RULES_ENGINE_GAP_CLOSURE_PLAN.md).
