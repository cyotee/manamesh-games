# Timestreams Rules Engine — Gap Closure Implementation Plan

**Date:** 2026-07-10  
**Gap report:** [RULES_ENGINE_GAP_REPORT.md](./RULES_ENGINE_GAP_REPORT.md)  
**Normative:** [RULES_ENGINE_PRD.md](./RULES_ENGINE_PRD.md), [RULES.md](./RULES.md)  
**Supersedes for this workstream:** “done” checkboxes in [TAG_TEST_IMPLEMENTATION_PLAN.md](./TAG_TEST_IMPLEMENTATION_PLAN.md) that relied on non-throwing smokes

---

## 1. Goal

Close every **P0/P1 engine gap** in the gap report and establish **behavioral test gates** so silent no-ops and wrong scores cannot re-enter CI.

**Non-goals (this plan):**
- New card content or rebalancing
- AI/solver play
- Full Playwright multiplayer matrix (optional L5 at end)
- Rewriting working Nanotech/QC paths unless a fix requires it

---

## 2. Principles

1. **Tag-first, card-second.** Implement shapes; golden-path tests may use real pack tags but must not hardcode card ids in production.
2. **Assert mutations, not phases.** Prefer `expect(scores)`, stack contents, discard piles, prompts, not only `phase === gameOver`.
3. **Real manifest tags.** Golden paths load the same tag arrays as pack manifests (copy from manifest or hydrate from pack).
4. **TDD for gaps.** For each P0 item: write failing assertive test → implement → confirm green.
5. **Promote smoke.** Keep smokes if useful, but rename/relabel so they never satisfy DoD alone.
6. **No silent defer.** Any remaining unevaluated pack tag must be allowlisted with reason + owner + issue link.

---

## 3. Definition of Done (global)

A gap is closed only when **all** apply:

- [ ] Production code evaluates the tags (not only prefix-known).
- [ ] **L1** unit test asserts correct `G` mutation for the shape.
- [ ] **L2** integration uses full pack-shaped tags (or hydrated pack card).
- [ ] **L3** board/prompt coverage only if the player must choose (optional per item; required when new prompt kinds appear).
- [ ] Gap report matrix row updated to Closed.
- [ ] No new card-id branches in production (subtype/name-other-card tags OK).

**CI gates (Phase 0 deliverable):**
- Pack tag → production consumer check (stricter than prefix).
- No pack tag only covered by `*.smoke` without a behavioral peer (or allowlist entry).

---

## 4. Phased plan

### Phase 0 — Process & tooling (foundation)

**Why first:** Without gates, implementation work will regress into smoke theater again.

| # | Task | Deliverable |
| --- | --- | --- |
| 0.1 | Introduce `scripts/tag_consumer_audit.py` (or extend `tag_test_gap_report.py`) | Reports: pack tags with no production consumer; tags only in smoke tests |
| 0.2 | Split tests: move non-assertive tables to `*.smoke.test.ts` or mark `describe.skip` for coverage counting | Clear separation |
| 0.3 | Add `tagBehavioralCoverage.test.ts` (or harden `tagCoverage`) | Fail if allowlisted-unimplemented list drifts without reason |
| 0.4 | Create `src/effects/conditions.ts` (shared condition evaluator) | Single place for `condition:*` used by score/bonus/react |
| 0.5 | Fix docs: remove `requires:stone-age-cloth` example from `types.ts` | Shape-correct docs |

**Exit:** CI can list remaining unevaluated pack tags; new PRs cannot add tags without consumer or allowlist.

**Estimate:** 0.5–1 day

---

### Phase 1 — Score condition & bonus shapes (P0 S-01, S-02, S-03, S-10)

**Files:** `src/effects/executors/score.ts`, new `conditions.ts`, `scoring.ts` (if awards path needs next-inventor helpers)

| # | Task | Tags / cards | Assertive tests |
| --- | --- | --- | --- |
| 1.1 | Implement condition evaluator | `odd-scoring-slot`, `in-last-scoring-slot`, `in-scoring-slot`, `subtype:*`, `scope:same-era`, `first-score`, `higher-value-invention` (react later), `today-modern-or-future` already in turn | Table-driven unit tests |
| 1.2 | Wire evaluator into bonus path | Poetry, Immortality, Brain Taping, Space Travel first-score | Golden paths with stack positions |
| 1.3 | Fix Cloning additional | `bonus-points:additional:N` via `tagNumber`/`tagsWithPrefix`; gate with `additional:condition:target-deck:*` | Cloning + Future above / non-Future above / no above |
| 1.4 | Digital Secretary refund | After next-inventor penalty, apply `bonus-points:to:next-inventor` + `printed-value:their-invention` (tag-driven, no DS name) | −5 then +printed to next owner |
| 1.5 | Multiplicity | `count:duplicates:own-inventions` | Two own Fire + one unique → count 2 (or per printed rule) |

**Exit:** Poetry odd/even, Immortality last slot, Brain Taping with/without TP, Cloning additional, DS refund, Multiplicity all green.

**Estimate:** 1–2 days

---

### Phase 2 — Score discard, penalty-per, set-value hygiene (P0 S-04, S-05)

| # | Task | Cards | Tests |
| --- | --- | --- | --- |
| 2.1 | Offset discard targets | Longbow `offset-below:3`, Liquid Nitrogen `offset-below:1` | Stack layout; exact discarded id |
| 2.2 | Art + any-era discard | Art of War | Only art candidates; cross-era |
| 2.3 | Multi-discard + cost-self | Tactical Nukes | Optional; self + 2 others; cost required |
| 2.4 | No auto-pick when >1 candidate | Policy | Prompt or fizzle; never wrong card |
| 2.5 | Deforestation shape | `score:penalty` + `penalty:per` + `count:own-inventions` + `score:to:all-players` | Each player −count of own inventions in era |

**Exit:** All five discard/penalty cards match printed text in L1/L2 tests.

**Estimate:** 1 day

---

### Phase 3 — Delayed score, Space Travel, Hibernation suppress (P0 S-06, S-07 + Space Travel move)

| # | Task | Detail | Tests |
| --- | --- | --- | --- |
| 3.1 | Fix Pottery delayed trigger model | Trigger should carry: moved card id, pottery’s delayed tags / re-score instruction, destination era; fire after destination era cleanup window per PRD | E2E: move to Future → Future scores → moved card scores again (slot + non-slot cases) |
| 3.2 | `delayed:in-addition-to-slot-scoring` | If already scored as slot, delayed still runs ability/points per ruling §3.3 | Double-score regression |
| 3.3 | Space Travel | `condition:first-score` gates bonus **and** move; second score no hop | Two-era walk |
| 3.4 | Hibernation | When scoring host, if attachment has `suppress:score-effects-on-target`, skip host score abilities (keep modified printed value) | Host with score:bonus-points + Hibernation → no bonus |
| 3.5 | Revisit Chaos mode tags | Prefer explicit perform/cancel modes; stop overloading Hibernation suppress if feasible without breaking packs | Chaos perform vs cancel still pass |

**Exit:** Pottery double-score E2E green; Space Travel hops once; Hibernation blocks score effects.

**Estimate:** 1.5–2 days

---

### Phase 4 — Play recover, move destinations (P0 S-08, P1 P-04)

| # | Task | Cards | Tests |
| --- | --- | --- | --- |
| 4.1 | `recover:to-deck` + `play:shuffle-after` + draw | Recycling | Discard → deck membership; draw fires |
| 4.2 | `move-destination:any-position-same-era` | Internet | Prompt era position; stack order |
| 4.3 | `move:target:action` + `different-invention` | Advertising | Actions from attachments map; re-host |
| 4.4 | Gate requires still work with Internet | Existing gates test | No regression |

**Exit:** Recycling and Internet/Advertising golden paths green.

**Estimate:** 1 day

---

### Phase 5 — Board reacts & era abilities (P0 S-09, P1 P-02, P-03)

**Files:** `react.ts`, `triggers.ts`, `play.ts`, `scoring.ts` (bonus steal), era hydration if needed

| # | Task | Detail | Tests |
| --- | --- | --- | --- |
| 5.1 | Register ongoing invention-played from play | Crop Rotation (not only attach/Waylay) | Invention played in era → optional adjacent swap prompt or apply |
| 5.2 | Implement Dot Com | On invention-played/move into same era, if higher effective value → mandatory discard self | Higher / lower / equal value cases |
| 5.3 | Fix `isProtected` | Protector tags on reactor do not self-protect; scan protectors for *other* targets | Cloth/Chainmail unit tests |
| 5.4 | Multi-Cloth redirect | Owner chooses among mandatory redirects; immovable fizzle combo | Two Cloths; Cloth+Hibernation fizzle |
| 5.5 | Era-Stone once-per-game cancel | Wire era card react | One cancel then spent |
| 5.6 | Era-Medieval steal bonus | Ensure bonus awards path consults era steal | Steal once; second bonus unaffected |
| 5.7 | Era-Modern era-begin recover | Fire `era-begin` when Modern day starts; recover prompt | Day advance → recover |
| 5.8 | Era-Future +2 slots choice | Complete score:choice shape without option-a/b if needed | Optional +2 capacity |
| 5.9 | International Diplomacy / Chainmail | Retaliate and cost-cancel paths | At least one L2 each |
| 5.10 | Stop stub-only `applyReactsForEvent` | Either fully apply or call shared apply helpers used by executors | No “log only” for mandatory reacts |

**Exit:** Dot Com, Crop Rotation, three era abilities, Cloth multi-redirect all assertive green.

**Estimate:** 2–3 days

---

### Phase 6 — Golden pack-card suite & gate harden

| # | Task | Detail |
| --- | --- | --- |
| 6.1 | `src/effects/packGoldenPaths.test.ts` (or per-deck files) | One describe per high-risk card from gap §5.4 P0 list; hydrate tags from manifest JSON |
| 6.2 | Manifest load helper | `loadPackCardTags(cardId)` for tests — single source of truth |
| 6.3 | Consumer audit in CI | Fail on new unevaluated pack tags |
| 6.4 | Update gap report matrix | Mark Closed with PR links |
| 6.5 | Deprecate false “done” in old TAG plan | Banner at top: superseded by this plan for correctness |

**Exit:** `vitest` full package green; consumer audit clean or only intentional allowlist; gap report §6 matrix all Closed or explicitly deferred.

**Estimate:** 1 day

---

### Phase 7 — Optional hardening (P2 / M4 alignment)

| # | Task |
| --- | --- |
| 7.1 | Telecommunications scope E2E with real play discard/move |
| 7.2 | Fuzz: random legal plays + scoring with pack decks (choice provider) |
| 7.3 | Board L3 for new prompts (Internet position, Crop swap, era recover) |
| 7.4 | Playwright smoke for one score-interactive + one hand-react path |

**Estimate:** as capacity allows

---

## 5. Workstream graph (dependencies)

```
Phase 0 (gates + conditions.ts)
    │
    ├─► Phase 1 (bonus/conditions/count) ──┐
    ├─► Phase 2 (discard/penalty) ─────────┼─► Phase 6 (golden + CI)
    ├─► Phase 3 (Pottery/Hibernation/ST) ──┤
    ├─► Phase 4 (recover/moves) ───────────┤
    └─► Phase 5 (reacts/eras) ─────────────┘
                                              └─► Phase 7 (optional)
```

Phases 1–5 can proceed in **parallel** after 0.1–0.4 if agents are split; merge order should land Phase 0 first.

---

## 6. Suggested file changes (implementation map)

| Area | Primary files |
| --- | --- |
| Conditions | **new** `src/effects/conditions.ts` + tests |
| Score effects | `src/effects/executors/score.ts` |
| Scoring walk / delayed | `src/scoring.ts` |
| Slot notes | `src/scoringSlots.ts` (only if needed) |
| Recover | `src/effects/executors/recover.ts` |
| Move | `src/effects/executors/move.ts` |
| React / protect | `src/effects/react.ts` |
| Triggers / register | `src/effects/triggers.ts`, `src/play.ts` |
| Coverage gates | `src/effects/tagCoverage.test.ts`, **new** consumer audit script |
| Golden paths | **new** `src/effects/packGoldenPaths.test.ts` |
| Docs | `types.ts`, this plan + gap report status |

---

## 7. Test writing standards (mandatory for this plan)

### 7.1 Assertive example (good)

```ts
it("Poetry awards +2 only in odd scoring slots", () => {
  // stack positions 0,1,2 → slots 1,2,3 (1-based odd: 1 and 3)
  // assert bonus ledger / scores: only odd-slot Poetry gets +2
});
```

### 7.2 Smoke example (not sufficient alone)

```ts
it("condition:odd-scoring-slot scores without throwing", () => {
  resolveScoring(G);
  expect(G.phase).toBe("gameOver"); // insufficient
});
```

### 7.3 Required assertion types by shape

| Shape | Must assert |
| --- | --- |
| Bonus / penalty / count | `G.bonusPoints` or final `G.scores` deltas |
| Discard / move / swap | Stack order, discard pile membership, locations |
| Perform / steal | Score pile ownership, nested log or second effects |
| React | Target surviving/discarded, once-per-game spent |
| Recover | Hand/deck/discard lengths and card ids |
| Delayed | Second score application after era complete |

---

## 8. Allowlist policy (temporary only)

If a pack tag must remain unimplemented briefly:

```ts
// tagAllowlist.ts
export const UNIMPLEMENTED_PACK_TAGS: Array<{
  tag: string;
  reason: string;
  owner: string;
  removeBy: string; // ISO date or phase
}> = [];
```

- CI fails if allowlist entry’s tag disappears from packs without cleanup.
- CI fails if allowlist is empty of dates older than 14 days without re-approval.
- Prefer empty allowlist by end of Phase 6.

---

## 9. Execution checklist (copy into PR descriptions)

**Per phase PR:**
- [ ] Failing tests merged first or same PR with clear commits
- [ ] No card-id hardcoding in production
- [ ] Manifest tags used in golden tests
- [ ] Gap report matrix rows updated
- [ ] Consumer audit clean for touched tags
- [ ] Manual smoke only if new prompt UX (note in PR)

**Suggested PR stack:**
1. `fix(timestreams): tag consumer audit + conditions module`
2. `fix(timestreams): score conditions, cloning, DS, multiplicity`
3. `fix(timestreams): score discard offsets + deforestation`
4. `fix(timestreams): pottery delayed + hibernation suppress + space travel`
5. `fix(timestreams): recover-to-deck + internet/advertising moves`
6. `fix(timestreams): board reacts + era abilities`
7. `test(timestreams): pack golden paths + harden coverage gate`

---

## 10. Effort summary

| Phase | Estimate | Parallelizable |
| --- | --- | --- |
| 0 Process & tooling | 0.5–1 d | — |
| 1 Conditions & bonuses | 1–2 d | with 2 after 0 |
| 2 Discard & Deforestation | 1 d | yes |
| 3 Pottery / Hibernation / ST | 1.5–2 d | yes |
| 4 Recover & moves | 1 d | yes |
| 5 Reacts & eras | 2–3 d | yes |
| 6 Golden + CI | 1 d | after 1–5 |
| 7 Optional | TBD | after 6 |
| **Total (1–6)** | **~8–12 engineer-days** | less wall-clock if parallel |

---

## 11. Progress log

| Date | Phase | Note |
| --- | --- | --- |
| 2026-07-10 | — | Plan written from gap report; implementation not started |
| 2026-07-10 | 0–6 | Implemented: `conditions.ts`, consumer audit script, score conditions/bonus/count/discard/penalty/DS/cloning/multiplicity, Pottery delayed rescore, Hibernation suppress, Space Travel first-score, recover-to-deck, Internet/Advertising moves, Dot Com react, `isProtected` fix, Cloth redirect via `tagValue`, hardened `tagCoverage`, behavioral suite `gapClosure.behavioral.test.ts`. Full package: **353 tests passed**. Remaining polish: Crop Rotation interactive swap UI, multi-Cloth owner choice, full era-card E2E (stone cancel / modern begin). |

Update this table as work lands.

---

## 12. Acceptance demo scenarios (manual or automated)

After Phase 6, these scenarios must pass:

1. **Poetry** in slots 1 and 2 of Medieval — only slot 1 gets +2 bonus.
2. **Immortality** in last Future slot — +10; one earlier — no +10.
3. **Brain Taping** with/without Thought Police in a scoring slot.
4. **Cloning** under Future invention vs under Modern — additional +2 only for Future.
5. **Digital Secretary** then next invention — owner of next gets −5 + printed.
6. **Longbow** discards exactly the card three below.
7. **Pottery** moves a card to Future; after Future scores, that card scores again (including non-slot).
8. **Hibernation** on a bonus invention — host printed (modified) banks if in slot, ability does not fire.
9. **Recycling** returns two discards to deck and draws.
10. **Dot Com** discards itself when a higher-value invention enters its era.
11. **Crop Rotation** offers/applies adjacent swap when a new invention is played in its era.
12. **Two Cloths** — defending owner chooses which absorbs a move; Hibernated Cloth can fizzle the effect.

---

**End of plan.** Implement against [RULES_ENGINE_GAP_REPORT.md](./RULES_ENGINE_GAP_REPORT.md); do not mark complete on smoke-only green.
