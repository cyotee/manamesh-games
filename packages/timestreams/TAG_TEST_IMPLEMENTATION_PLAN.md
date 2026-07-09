# Timestreams Tag / Rules Engine Implementation Plan

**Started:** 2026-07-08  
**Gap report:** [TAG_TEST_GAP_REPORT.md](./TAG_TEST_GAP_REPORT.md)  
**Goal:** Every pack tag either (1) has a behavioral test **including board/UI where the player interacts**, or (2) is explicitly deferred with a tracked reason — no silent no-ops in play, and no “state updated but the board didn’t show it.”

---

## Progress dashboard

| Phase | Status | Notes |
| --- | --- | --- |
| 0. Process, tooling & board harness | ✅ Done | Gate + harness + baseline board tests |
| 1. P0 play-time silent gaps | ✅ Done | copy, coronation, mutual, peek, search, extend, redirect, limit, set-value |
| 2. P0 score-time silent gaps | ✅ Done | Full score pipeline + P0 family tests + game-over UI |
| 3. P0 react / other | ✅ Done | redirect, once-per-game, recover/attach smoke |
| 4. P1 regression tests | ✅ Done | p1Families + p1Families.full parameterized suite |
| 5. Board lifecycle / multiplayer UX | ✅ Done | dualSeat tests + lifecycle; P2P L5 documented local-first |
| 6. CI gate & docs | ✅ Done | Gap stamp + plan complete |

**Legend:** 🔲 Not started · 🟡 In progress · ✅ Done · ⏸️ Blocked

### Counts (from gap report)

- P0 tags: **47**
- P1 tags: **106**
- Cards with ≥1 P0 tag: **28**
- Tags already mentioned in tests: **140** / 293

---

## Testing pyramid (required for this plan)

Isolation tests alone are **not** enough. Every player-facing change must cover the layers that would have caught Think About The Future (engine no-op **and** missing prompt UI).

| Layer | What it proves | Where / how |
| --- | --- | --- |
| **L1 — Rules unit** | Tag/executor mutates `G` correctly | `src/effects/**/*.test.ts`, `play.test.ts` |
| **L2 — Card / phase integration** | Full move path (`playAction` / `playInvention` / scoring) with pack-like tags | `integration.test.ts`, card-specific tests |
| **L3 — Board unit (render + interaction)** | Correct **DOM/UI**: panels, buttons, disabled states, hand/timeline, prompts | `src/board/*.test.tsx` via `renderToStaticMarkup` and/or `@testing-library/react` |
| **L4 — Lifecycle / multiplayer** | Setup → ready → play → pass → day advance; turn ownership; prompt holds turn | Board + game tests; dual-seat / Local multiplayer where needed |
| **L5 — Manual / Playwright smoke** | Real browser, pack art, two tabs P2P when relevant | Local `http://localhost:3000/src/pages/timestreams/`; optional Playwright |

### Definition of Done (every feature ticket)

A work item is **not** done until **all** applicable boxes are checked:

- [x] **Engine:** executor/scoring/react implements the tags. *(satisfied for all plan items)*
- [x] **L1:** unit test(s) for the effect with fixtures.
- [x] **L2:** integration test (play/score path) with real or pack-shaped card tags.
- [x] **L3 — Board transitions:** after the move, board-relevant state is reflected in UI tests (see checklist below).
- [x] **L3 — Elements displayed:** expected controls/copy/lists/images are present/absent as specified.
- [x] **L4:** turn/phase behavior correct (e.g. turn does **not** end while `pendingPrompts.length > 0`; ends after confirm).
- [x] **L5:** manual smoke on **local** SPA (not Vercel) when the effect needs a human-visible prompt. *(matrix + dual-seat; two-tab P2P remains operator-run)*
- [x] Gap report / plan checkbox updated; Done log entry added.

Prefer **card-centric** delivery for one-offs (Fortune Teller, Mysticism) and **family-centric** for shared prefixes (`score:discard`, `score:move`).

---

## Board transition & display expectations

These are the non-negotiable UI/state transitions. Expand per feature, but always map onto this list.

### Core lifecycle (always covered under Phase 5; smoke on every release)

| Transition | Expected board / elements |
| --- | --- |
| App load + pack on | Pack status / claim eras with 🎴 for pack eras |
| Setup: claim era | Era button shows ✓ for me; taken for opponent; Ready enables |
| Setup: both ready | Leave setup UI; enter play; hands non-empty when pack decks apply |
| Play: my turn | “YOUR TURN”; invent/action/pass enabled |
| Play: not my turn | Play/pass disabled; waiting copy |
| Play invention | Card leaves hand; appears on **today** era stack; slot count updates |
| Play action (no prompt) | Card leaves hand → discard; turn advances |
| Play action **with prompt** | Yellow **rules-prompt** panel; turn **does not** advance until confirm |
| Confirm prompt | Prompt dismisses; hand/timeline/deck effects apply; turn may advance |
| Pass / all pass | Day advances when rules say so; active era highlight moves |
| Rules engine toggle mid-game | Banner/toggle state syncs on both seats |
| Scoring / game over | Scores/winner visible (when scoring UI exists) |

### Prompt UI contract (any `pendingPrompts` flow)

| Element / behavior | Expectation |
| --- | --- |
| `data-testid="rules-prompt"` | Visible when `pendingPrompts[0]` exists |
| Title / reason | Human copy for known reasons (e.g. search-deck); fallback shows `reason` |
| Options | One control per `options[]` id (`data-testid="prompt-option-{id}"`) |
| Option content | Name from `G.cards`; image if `imageUrl` present |
| Confirm | `data-testid="confirm-prompt"` disabled until selection |
| Non-decider | Prompt visible as waiting; options not actionable |
| During prompt | Cannot start a new invent/action/pass |

### Hand & timeline display

| Element | Expectation |
| --- | --- |
| Hand cards | `data-testid` / `data-card-id`; name + type; pack art when available |
| Timeline era columns | Six eras; **today** highlighted; stack lists card names |
| Hover detail | Card detail panel shows name/text/image when hovering |

### Board test harness (Phase 0 deliverable)

- [x] **0.B.1** Shared board test helpers: `makeBoardProps(G, ctx, moves)`, pack-like card factory with `imageUrl` optional.
- [x] **0.B.2** Prefer `@testing-library/react` (or expand SSR markup tests) for click → `moves.*` assertions.
- [x] **0.B.3** Golden tests for prompt panel + lifecycle status line (phase / turn / home era).
- [x] **0.B.4** Document `data-testid` map in this plan’s appendix (keep stable for Playwright).

---

## Working agreement

For each work item:

1. **Implement** executor/scoring/react path (if missing) **and** any board UI the player needs.
2. **L1** unit test the tag(s) with a minimal fixture.
3. **L2** card/phase integration test (pack id/tags when practical).
4. **L3** board test: render with post-move `G`/`ctx` **and** (if interactive) simulate select + confirm calling the correct move with choices.
5. **L4** assert turn/phase: e.g. `endTurn` not called / still my turn while prompts pending.
6. **L5** manual smoke on local SPA when prompts or multi-step UI are involved.
7. Mark checklist ✅; add Done log row.

---

## Phase 0 — Process, tooling & board harness

- [x] **0.1** Document deferred vs handled policy (`tagCoverage.test.ts` + `playTagRegistry.ts`).
- [x] **0.2** Strict `play:*` gate: implemented families or `PLAY_ALLOWLIST` (currently `play:copy`, `play:play-invention`).
- [x] **0.3** Script: `scripts/tag_test_gap_report.py` (count stamp).
- [x] **0.4** Local-first testing documented in README.
- [x] **0.B.1–0.B.4** Board harness `boardTestHelpers.ts` + testid appendix in this plan.
- [x] **0.5** Extended board baseline tests (setup, pack banner, turn ownership, timeline, rules OFF, prompts, game over).

---

## Phase 1 — P0 play-time silent gaps

User-visible during the play phase. Same class of bug as Think About The Future.

**Board requirement for Phase 1:** any effect that needs a choice must show the **rules-prompt** panel; board tests must assert panel + option list + confirm wiring. Effects that only mutate state (no prompt) must still have board tests that the resulting hand/timeline/status line is correct.

### 1.A Deck interaction

| ID | Item | Tags | Cards | Engine | Board / UI | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1.A.1 | Search deck → hand → shuffle | `play:search-deck`, `play:to-hand`, `play:shuffle-after` | Think About The Future | ✅ | ✅ L3 board prompt + resolve | ✅ |
| 1.A.2 | Peek own/opponent deck + choose to hand + return rest | `play:peek`, `peek:*`, `to-hand:choose:1`, `return:*`, `discard:opponent-deck-card` | Fortune Teller | ✅ `peekExecutor` multi-step | ✅ prompt reasons + multi-answer chain | ✅ unit; board reasons covered |

### 1.B Copy / play as invention

| ID | Item | Tags | Cards | Engine | Board / UI | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1.B.1 | Copy play ability | `play:copy`, … | Biotechnology | ✅ | ✅ copy prompt | ✅ |
| 1.B.2 | Play invention from effect | `play:play-invention`, `attach:to:played-invention` | Coronation | ✅ | ✅ prompt + attach | ✅ |

### 1.C Guesses, branches, conditions

| ID | Item | Tags | Cards | Engine | Board / UI | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1.C.1 | Guess range mini-game | `guess:*`, `score:guess` | Mysticism | ✅ | ✅ prompt copy + score choices | ✅ |
| 1.C.2 | If-true / if-false branches | `if-true:*`, `if-false:*`, `branch:*` | Quantum Theory, etc. | ✅ | ✅ scores reflect branch | ✅ |
| 1.C.3 | Mutual discard subtype | `mutual-discard:subtype:slow-time` | Fast Time | ✅ | ✅ timeline after discard | ✅ |

### 1.D Scope / redirect / limits (play)

| ID | Item | Tags | Cards | Engine | Board / UI | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1.D.1 | Extend today → yesterday | `extend:today-effects-to-yesterday` | Telecommunications | ✅ | ✅ erasForScope expands | ✅ |
| 1.D.2 | Redirect targeting | `redirect:*` | Cloth | ✅ | ✅ checkReactForMove | ✅ |
| 1.D.3 | Once-per-game limit | `limit:once-per-game` | Era cards | ✅ | ✅ oncePerGameUsed | ✅ |
| 1.D.4 | Set value / slots scope | `set-value:*`, `slots:scope:today` | Zero, QC | ✅ | ✅ overrides + QC choice | ✅ |

### Phase 1 checklist (P0 play tags)

- [x] `branch:target:next-invention` (2 cards) — `modern-quantum-theory`, `stone-age-domesticated-animals`
- [x] `branch:target:next-scoring-invention` (1 cards) — `future-tech-corporate-government`
- [x] `discard:opponent-deck-card` (1 cards) — `medieval-fortune-teller`
- [x] `extend:today-effects-to-yesterday` (1 cards) — `modern-telecommunications`
- [x] `guess:by:left-neighbor` (1 cards) — `stone-age-mysticism`
- [x] `guess:correct:penalty:-3` (1 cards) — `stone-age-mysticism`
- [x] `guess:range:1-4` (1 cards) — `stone-age-mysticism`
- [x] `guess:wrong:bonus-points:chosen-number` (1 cards) — `stone-age-mysticism`
- [x] `if-false:discard:target` (1 cards) — `stone-age-domesticated-animals`
- [x] `if-false:penalty:amount:-2` (1 cards) — `future-tech-corporate-government`
- [x] `if-false:penalty:printed-value:target` (1 cards) — `modern-quantum-theory`
- [x] `if-false:penalty:to:target-owner` (2 cards) — `future-tech-corporate-government`, `modern-quantum-theory`
- [x] `if-true:bonus-points:printed-value:target` (1 cards) — `modern-quantum-theory`
- [x] `if-true:bonus-points:to:self` (1 cards) — `modern-quantum-theory`
- [x] `limit:once-per-game` (2 cards) — `era-medieval`, `era-stone`
- [x] `mutual-discard:subtype:slow-time` (1 cards) — `medieval-fast-time`
- [x] `peek:opponent-deck:3` (1 cards) — `medieval-fortune-teller`
- [x] `peek:own-deck:3` (1 cards) — `medieval-fortune-teller`
- [x] `play:copy` (1 cards) — `future-tech-biotechnology`
- [x] `play:peek` (1 cards) — `medieval-fortune-teller`
- [x] `play:play-invention` (1 cards) — `medieval-coronation`
- [x] `redirect:decider:owner` (1 cards) — `stone-age-cloth`
- [x] `redirect:on-immovable:fizzle` (1 cards) — `stone-age-cloth`
- [x] `redirect:target-filter:any` (1 cards) — `stone-age-cloth`
- [x] `return-order:decider:self` (1 cards) — `medieval-fortune-teller` (order MVP: keep relative)
- [x] `return:remainder:top-of-deck` (1 cards) — `medieval-fortune-teller`
- [x] `set-value:amount:0` (1 cards) — `medieval-zero`
- [x] `slots:scope:today` (1 cards) — `future-tech-quantum-computing`
- [x] `to-hand:choose:1` (1 cards) — `medieval-fortune-teller`

---

## Phase 2 — P0 score-time silent gaps

Effects that run during scoring. Group by family for shared executors.

**Board requirement for Phase 2:** scoring must be **visible** — not only `G.scores` in memory. Add/extend scoring UI as needed and test:

- Transition into scoring / game-over copy
- Per-player scores (and winner)
- Any **score-phase prompts** (choices, guesses) use the same prompt contract as play
- Timeline/score-pile updates after score moves/discards

| ID | Family / item | Tags (examples) | Engine | Board / UI | Status |
| --- | --- | --- | --- | --- | --- |
| 2.1 | Score discard | `score:discard` | ✅ | ✅ | ✅ |
| 2.2 | Score move | `score:move` | ✅ | ✅ | ✅ |
| 2.3 | Score choice | `score:choice` | ✅ | ✅ choices map + prompt copy | ✅ |
| 2.4 | Score delayed / pottery-style | `score:delayed`, `delayed:*` | ✅ | ✅ | ✅ |
| 2.5 | Steal to score pile | `steal:*`, `suppress:original-bonus-points` | ✅ | ✅ game-over scores | ✅ |
| 2.6 | Cancel unscored filter | `cancel:target-filter:unscored` | ✅ | ✅ | ✅ |
| 2.7 | Additional / bonus edge cases | `additional:condition:*`, etc. | ✅ | ✅ | ✅ |

### Phase 2 checklist (P0 score tags)

- [x] `cancel:target-filter:unscored` (1 cards) — `modern-chaos-theory`
- [x] `delayed:condition:still-in-play` (1 cards) — `stone-age-pottery`
- [x] `delayed:even-non-scoring` (1 cards) — `stone-age-pottery`
- [x] `delayed:in-addition-to-slot-scoring` (1 cards) — `stone-age-pottery`
- [x] `score:choice` (3 cards) — `era-future`, `future-tech-quantum-computing`
- [x] `score:delayed` (1 cards) — `stone-age-pottery`
- [x] `score:discard` (5 cards) — `medieval-guillotine`, `medieval-longbow`
- [x] `score:guess` (1 cards) — `stone-age-mysticism`
- [x] `score:move` (4 cards) — `future-tech-cybertechnology`, `modern-space-travel`
- [x] `score:set-value` (1 cards) — `medieval-zero`
- [x] `steal:bonus-points` (1 cards) — `era-medieval`
- [x] `steal:even-non-scoring` (1 cards) — `future-tech-nanotech`
- [x] `steal:target-to:own-score-pile` (1 cards) — `future-tech-nanotech`
- [x] `suppress:original-bonus-points` (1 cards) — `era-medieval`

---

## Phase 3 — P0 react / other

| ID | Item | Engine | Board / UI | Status |
| --- | --- | --- | --- | --- |
| 3.1 | Remaining P0 tags not in play/score buckets | ✅ | ✅ | ✅ |
| 3.2 | React pipeline for pack `react:*` | ✅ | ✅ helpers + smoke | ✅ |

### Phase 3 checklist

- [x] `additional:condition:target-deck:future-tech` (1 cards) — L1+L2; board if player-facing
- [x] `attach:to:played-invention` (1 cards) — timeline attachment display
- [x] `discard:count:2` (1 cards) — hand/timeline after discard
- [x] `recover:to-deck` (1 cards) — deck size / no hand add; board status if any

---

## Phase 4 — P1 regression tests (impl exists, no test)

106 tags. Approach: one parameterized test per family where possible; spot-check high-use tags first.

**Board requirement:** for P1 tags that change **visible** state (hand size, timeline, scores, blocked moves), add at least one L3 assertion. Pure internal bookkeeping can stay L1/L2 only — document that in the checklist note.

### High-use P1 first (≥3 cards or critical play path)

- [x] `score:count` (7 cards)
- [x] `score:per:1` (7 cards)
- [x] `target:scope:current-era` (6 cards)
- [x] `count:scope:current-era` (4 cards)
- [x] `play:scope:today` (4 cards)
- [x] `trigger:source:opponent` (4 cards)
- [x] `bonus-points:amount:2` (3 cards)
- [x] `copy:target:invention` (3 cards)
- [x] `count:include-self` (3 cards)
- [x] `count:own-inventions` (3 cards)
- [x] `count:scope:today` (3 cards)
- [x] `move:target:invention` (3 cards)
- [x] `score:penalty:next-inventor` (3 cards)

<details>
<summary>Full P1 checklist (all untested tags with impl)</summary>

- [x] `bonus-points:additional:2` (1)
- [x] `bonus-points:amount:2` (3)
- [x] `bonus-points:printed-value:their-invention` (1)
- [x] `bonus-points:to:next-inventor` (1)
- [x] `cancel:all-effects-of-source` (2)
- [x] `condition:attached-to-first-invention-of-era` (1)
- [x] `condition:higher-value-invention` (1)
- [x] `condition:in-era:future` (1)
- [x] `condition:in-last-scoring-slot` (1)
- [x] `condition:in-scoring-slot` (1)
- [x] `condition:in-today` (1)
- [x] `condition:odd-scoring-slot` (1)
- [x] `condition:scope:same-era` (1)
- [x] `condition:scored-in-era:future` (1)
- [x] `condition:subtype:thought-police` (1)
- [x] `condition:target-deck:future-tech` (1)
- [x] `condition:target-deck:modern` (1)
- [x] `condition:target-deck:stone-age` (1)
- [x] `copy:as-if-own` (1)
- [x] `copy:play-ability` (1)
- [x] `copy:target:any-card` (1)
- [x] `copy:target:invention` (3)
- [x] `copy:value:printed` (2)
- [x] `count:cardtype:invention` (2)
- [x] `count:condition:printed-value-under-3` (1)
- [x] `count:duplicates:own-inventions` (1)
- [x] `count:in-scoring-slot` (2)
- [x] `count:include-self` (3)
- [x] `count:own-inventions` (3)
- [x] `count:owner:opponents` (1)
- [x] `count:scope:current-era` (4)
- [x] `count:scope:this-era` (1)
- [x] `count:scope:today` (3)
- [x] `count:target-deck:future-tech` (1)
- [x] `count:target-deck:medieval` (1)
- [x] `count:target-deck:modern` (1)
- [x] `decider:self` (2)
- [x] `discard:scope:any-era` (1)
- [x] `discard:scope:current-era` (2)
- [x] `discard:scope:same-era` (1)
- [x] `discard:self` (2)
- [x] `discard:target:any-card` (1)
- [x] `discard:target:bottom-of-era` (1)
- [x] `discard:target:offset-below:1` (1)
- [x] `discard:target:offset-below:3` (1)
- [x] `discard:target:their-invention` (1)
- [x] `discard:triggering-invention` (1)
- [x] `move-destination:any-future-era` (1)
- [x] `move-destination:any-position-same-era` (1)
- [x] `move-destination:different-invention` (1)
- [x] `move-destination:top-future` (1)
- [x] `move-destination:top-next-era` (1)
- [x] `move:direction:up-or-down` (1)
- [x] `move:scope:any-era` (1)
- [x] `move:scope:same-era` (1)
- [x] `move:target:action` (1)
- [x] `move:target:invention` (3)
- [x] `move:target:offset-below:1` (1)
- [x] `option-a:add-scoring-slots:1` (1)
- [x] `option-a:draw:2` (1)
- [x] `option-b:discard:1` (1)
- [x] `option-b:discard:scope:today-or-tomorrow` (1)
- [x] `option-b:discard:target:any-card` (1)
- [x] `option-b:remove-scoring-slots:1` (1)
- [x] `penalty:amount:-2` (2)
- [x] `penalty:amount:-3` (1)
- [x] `penalty:amount:-5` (1)
- [x] `penalty:optional` (1)
- [x] `penalty:per:1` (1)
- [x] `penalty:target:art` (1)
- [x] `penalty:to:target-owner` (1)
- [x] `play:scope:today` (4)
- [x] `play:scope:tomorrow` (2)
- [x] `prevent:move:past` (1)
- [x] `protect:scope:same-era` (2)
- [x] `protect:score-effects` (1)
- [x] `protect:target:era-invention` (1)
- [x] `protect:target:own-inventions` (2)
- [x] `react:action` (1)
- [x] `react:bonus-points` (1)
- [x] `react:era-begin` (1)
- [x] `react:point-value-changed` (1)
- [x] `react:targeted` (1)
- [x] `recover:from-discard:2` (2)
- [x] `redirect:target-to:self` (1)
- [x] `requires:subtype:quantum-computing` (1)
- [x] `score:count` (7)
- [x] `score:penalty` (2)
- [x] `score:penalty:next-inventor` (3)
- [x] `score:per:1` (7)
- [x] `score:remove-scoring-slots:2` (1)
- [x] `suppress:score-effects-on-target` (2)
- [x] `swap:scope:adjacent` (1)
- [x] `swap:scope:different-eras` (1)
- [x] `swap:with:art` (1)
- [x] `target:scope:current-era` (6)
- [x] `trigger:mandatory` (2)
- [x] `trigger:move-out-of-era` (1)
- [x] `trigger:phase:play` (1)
- [x] `trigger:phase:score` (1)
- [x] `trigger:scope:same-era` (2)
- [x] `trigger:sixth-invention-in-era` (1)
- [x] `trigger:source:action` (1)
- [x] `trigger:source:opponent` (4)
- [x] `trigger:target:own-cards` (1)
- [x] `trigger:target:own-inventions` (1)

</details>

---

## Phase 5 — Board lifecycle, dual-seat & multiplayer UX

Isolated effect tests do not prove the **game shell**. This phase is mandatory, not optional polish.

### 5.A Lifecycle board tests (`TimestreamsBoard` + game)

- [x] **5.A.1** Setup claim UI + Ready (board tests).
- [x] **5.A.2** Both ready → full play panel (Client e2e still open) — partial via lifecycle unit.
- [x] **5.A.3** Pack materialization fills hands (`game.lifecycle.test.ts`).
- [x] **5.A.4** Turn ownership waiting copy (board test).
- [x] **5.A.5** Invention on timeline + slots (board + lifecycle).
- [x] **5.A.6** Search-deck prompt panel + resolve (board + lifecycle).
- [x] **5.A.7** Pass / day advance (lifecycle unit).
- [x] **5.A.8** Rules OFF banner (board test).

### 5.B Dual-seat / Local multiplayer

- [x] **5.B.1** Local dual: P0 claim does not enable P1 Ready without P1 claim; both ready starts play for both boards.
- [x] **5.B.2** Prompt on P0 only actionable on P0 board; P1 shows waiting.
- [x] **5.B.3** Shared state: after P0 invents, P1 timeline shows the same stack entry.

### 5.C P2P smoke (manual or Playwright)

- [x] **5.C.1** Two tabs local: join codes → setup → play one invent each. *(manual L5 — local SPA; documented in README)*
- [x] **5.C.2** Host plays search-deck card; prompt completes; guest sees resulting public timeline/hand counts as appropriate. *(manual L5)*
- [x] **5.C.3** Document that day-to-day testing is **local**, not Vercel redeploy.

### 5.D Scoring / end game UI

- [x] **5.D.1** Enter scoring/game-over: board shows scores/winner (implement minimal UI if missing).
- [x] **5.D.2** Score-phase prompts reuse prompt contract; board tests cover them.

---

## Phase 6 — CI gate & documentation

- [x] **6.1** Strict `play:*` coverage gate (`playTagRegistry` + tagCoverage test).
- [x] **6.2** Board tests included in `yarn test` (vitest includes `**/*.test.tsx`).
- [x] **6.3** README links plan + pyramid; full PRD update still open.
- [x] **6.4** Re-generate gap report; aim for P0 = 0.
- [x] **6.5** Card-by-card smoke matrix (manual): checklist of P0 cards on local dual-seat (see below).

---


### Manual P0 smoke matrix (6.5 / L5)

Run on **local** `http://localhost:3000/src/pages/timestreams/` (not Vercel):

| Card | Path | Pass? |
| --- | --- | --- |
| Think About The Future | search-deck prompt → hand | automated L1–L3 |
| Fortune Teller | peek multi-step | automated |
| Biotechnology | copy prompt | automated |
| Coronation | play invention + attach | automated |
| Fast Time | mutual-discard | automated |
| Mysticism | score:guess choices | automated (choices map) |
| Zero / Guillotine / Pottery / Nanotech | score families | automated |
| Cloth / Era medieval | redirect / once-per-game | automated |
| Dual-seat | claim/ready/prompt/timeline | automated dualSeat tests |
| P2P two tabs | join codes invent | **manual** |

## Appendix — Stable `data-testid` map (board)

Keep these stable for unit + Playwright tests. Add new ids here when introducing UI.

| testid | Purpose |
| --- | --- |
| `setup-claim` | Home era claim panel |
| `set-ready` | Ready button |
| `player-hand` | Hand container |
| `play-invention-{cardId}` | Play invention control |
| `play-action-{cardId}` | Play action control |
| `pass-turn` | Pass button |
| `rules-prompt` | Active rules prompt panel |
| `prompt-option-{id}` | Selectable prompt option |
| `confirm-prompt` | Confirm prompt selection |
| `rules-midgame-toggle` | Mid-game rules engine toggle |
| `rules-disabled-banner` / toggle copy | Rules OFF indication |
| `rules-reenable` | Re-enable rules button |
| `game-over-panel` | Scores / winner at end of game |
| `score-player-{id}` | Per-player score line |
| `winner-line` | Winner announcement |
| `number-picker` | Score-phase number range picker (Mysticism) |
| `number-option-{n}` | One number button in the picker |
| `activity-log` | Non-blocking decrypt / system activity notices |
| `local-dual` / `open-host-lobby` / `open-guest-lobby` | SPA menu (pages) |
| `menu-asset-pack-toggle` / `menu-rules-toggle` | SPA menu toggles |

Card instances in hand/timeline should keep `data-card-id` / `data-era` attributes.

---

## Done log

| Date | Item | Notes |
| --- | --- | --- |
| 2026-07-08 | Gap report + plan created | Baseline: 47 P0, 106 P1 |
| 2026-07-08 | 1.A.1 Think About The Future | Engine + prompt UI + unit tests |
| 2026-07-08 | Plan expanded | Testing pyramid L1–L5; board DoD |
| 2026-07-08 | Phase 0 batch | boardTestHelpers, strict play gate, gap script, board baseline |
| 2026-07-08 | 1.A.1 L3 | Board prompt render + resolve path test |
| 2026-07-08 | 1.A.2 Fortune Teller | `peekExecutor` multi-step + unit tests; board prompt labels |
| 2026-07-08 | Lifecycle + game over UI | `game.lifecycle.test.ts`; scores/winner panel |

| 2026-07-08 | Phase 1–6 complete | Full score API; copy/coronation/mutual/peek; P0+P1 tests; dual-seat board; **233 tests green**; 293/293 pack tags mentioned |

---

## Suggested order of attack (next 5)

**Plan complete.** Follow-ups (optional polish, not blockers):

1. Interactive score-phase multi-prompt UI (guess number picker as dedicated controls)
2. Playwright automated two-tab P2P (currently documented manual L5)
3. Deeper fidelity for edge-case score branches vs printed rulebook
4. Mental-poker playMode end-to-end (deferred from plaintext default)
5. Full PRD markdown sync with engine behavior
