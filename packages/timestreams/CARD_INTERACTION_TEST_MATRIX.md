# Timestreams — Card Interaction Test Matrix

**Status:** Matrix debt closed + rules-complete (2026-07-14)  
**Purpose:** Map every pack interaction we must exercise, coverage, and **Playwright** scenarios (rules ON + rules OFF).  
**Rulings / assumptions:** [CARD_INTERACTION_RULINGS_REPORT.md](./CARD_INTERACTION_RULINGS_REPORT.md)

**Sources:** `assets/packs/timestreams/**/manifest.json`, `assets/packs/tag_definitions.md`, unit tests under `src/**/*.test.ts*`, [RULES_OFF_PRD.md](./RULES_OFF_PRD.md), [RULES_ENGINE_GAP_REPORT.md](./RULES_ENGINE_GAP_REPORT.md).

### Verification snapshot

| Suite | Result |
|---|---|
| Vitest unit | **529 passed** (81 files) — includes `matrixDebtClosure` 17 goldens |
| Playwright e2e | **47 passed** (`e2e/specs/*`, incl. debt closure PW-P1 block) |
| Matrix unit modules | `matrixShapes`, `matrixChains`, `matrixFreeTools`, `missingCards`, `matrixDebtClosure`, `freeTools`, `debugSeed`, `debugE2E`, `eraAbilities`, `multiCloth`, plain-draw |
| Playwright modules | free-tools, rules-policy, reconnect, rules-on.p0, matrix-free-tools, matrix-rules-on, matrix-remaining (assertive P0/P1 + era polish + debt closure) |
| Harness | `?e2e=1` → plaintext + `debugSeed`; `window.__tsE2E` seed/freeTool/play/`debugAct` API |
| Engine | Rules-complete for play/score/react + all four ability-bearing era cards |
| Debt report | [CARD_INTERACTION_RULINGS_REPORT.md](./CARD_INTERACTION_RULINGS_REPORT.md) (A1–A12, R1–R20, coverage map) |

---

## 1. Coverage reality check

| Metric | Count | Notes |
|---:|---:|---|
| Deck cards (stone/medieval/modern/future) | **100** | + 6 era cards |
| Unique tags | **~295** | Tag → cards in `tag_definitions.md` |
| Shape tests (§2.1) | **35** | `matrixShapes.behavioral.test.ts` |
| Chain tests (§2.2) | **13** | `matrixChains.behavioral.test.ts` |
| Free-tools matrix (§2.3) | **unit + e2e** | `matrixFreeTools` + `matrix-free-tools.spec` |
| Playwright scenarios | **47** | Assertive golden paths (not seed-only smoke) |
| Era abilities | **4/4** | Stone cancel (play+score), Medieval steal, Modern begin recover, Future slots |

---

## 2. Interaction taxonomy (what “interaction” means)

An interaction is a **player-visible chain**: setup board → action → UI prompt(s) → state mutation → activity log / score / zones.

### 2.1 Rules ON — engine shapes

| Shape ID | Phase | Player-visible interaction | Representative cards |
|---|---|---|---|
| `search-deck` | Play | Multi-step decrypt/reveal → pick card → shuffle | Think About The Future |
| `peek-deck` | Play | Peek own/opponent tops → choose order / discard | Fortune Teller |
| `copy-play` | Play | Choose invention → run its play tags as yours | Biotechnology |
| `play-invention-attach` | Play | Play invention + attach action / attach host pick | Coronation, Hibernation, Inflation |
| `mutual-discard` | Play | Fast Time vs Slow Time mutual discard | Fast Time, Slow Time |
| `play-choice` | Play | Option A/B (draw/discard/hand) | Diplomacy, Surgical Strike, High-powered Laser |
| `play-draw` | Play | Draw N (gate + mental-poker peel) | Fermented Fruit, World Government, AI |
| `play-discard` | Play | Choose target in scope → discard | Fire, Napalm, Trebuchet, Hunting Party |
| `play-move` | Play | Choose card + destination (up/down/era) | Wheel, Music, Horse Riding, Vortex, Air Cars |
| `play-swap` | Play | Pick 1–2 inventions → swap positions | Shell Game, Time Jump, Organ Transplant |
| `play-recover` | Play | Pick from discard → hand/deck | Grave Robbing, Water Wheel, Thermodynamics, Recycling |
| `play-prevent` | Play | Duration flag: block actions / move future / past | Smoke Signals, Sundial, Digital Secretary (play) |
| `play-turn` | Play | Extra turn / skip / Navigation scope | Androids, Inflation, Philosophy, Navigation |
| `play-delayed-trigger` | Play | Arm trigger → later invention/action fires | Taxes, Television, Media Scandal, Hunting Party, Waylay, Crop Rotation |
| `hand-react` | Play (any seat) | Opponent action/move → hand cancel yes/no | Herbalism, Big Rock, Cloth (related), Chainmail |
| `board-react` | Play/Score | On-board trigger: mandatory/optional react | Dot Com, Thought Police, Crusades, Int’l Diplomacy, Combo Drug Therapy |
| `score-guess` | Score | Left neighbor picks 1–4; apply correct/wrong | Mysticism |
| `score-perform` | Score | Nested “perform other” ability (Nanotech loop) | Nanotech, Chaos Theory, Alphabet |
| `score-choice` | Score | Slot ± / cancel unscored / era-future | QC, Chaos, Era-Future |
| `score-branch` | Score | Next invention deck check → if-true/false | Domesticated Animals, Quantum Theory, Corporate Gov |
| `score-bonus` | Score | Bonus ledger (conditions, copy value) | Poetry, Coinage, Mass Marketing, Immortality, Cloning, DS |
| `score-penalty` | Score | Penalty ledger | Cave Paintings, Deforestation, Television, Cloth |
| `score-discard` | Score | Discard offset/bottom/art/count | Guillotine, Longbow, Art of War, Liquid N2, Tactical Nukes |
| `score-move` | Score | Move self/others mid-scoring (Wonky) | Pottery, Shipbuilding, Space Travel, Cybertech |
| `score-count` | Score | Per-count printed points | Irrigation, Math, Monarchy, Yoke, Cold Fusion, Multiplicity |
| `score-slots` | Score | Add/remove scoring capacity | Slow/Fast Time, QC options, Irrigation visibility |
| `score-set-value` | Score | Zero printed value on target | Zero |
| `score-swap` | Score | Swap during score | Telescope, Virtual Reality |
| `score-delayed` | Score | Re-score when later era finishes | Pottery |
| `protect` | Both | Block move/discard/value-change | Anarchy, Damascus, Moon Base, Hibernation host |
| `redirect` | Play | Retarget discard/move | Cloth, Thought Police |
| `suppress-score` | Score | Skip abilities on host | Hibernation, Chaos |
| `modify-attached` | Score | ± printed on host | Hibernation (+1), Inflation (−1) |
| `government-rule` | Play | One government per era | Anarchy, Monarchy, World Gov, Corporate Gov |
| `once-per-game` | React | Era stone/medieval once-per-game | Era-Stone, Era-Medieval |
| `era-begin-react` | Score start | Modern era begin | Era-Modern |

### 2.2 Cross-card / multi-seat chains (highest value)

These are **not** single-card unit tests; they need dual-seat or Playwright.

| Chain ID | Setup | Expected interaction |
|---|---|---|
| `C-nanotech-qc` | Nanotech + QC in today | Nested perform + slot choice + dual-ack |
| `C-chaos-mm` | Chaos performs Mass Marketing | Nested score-target; no false skip after |
| `C-hibernation-cloth` | Hibernation on host; Cloth in era | Protect + suppress + Cloth redirect |
| `C-fast-slow` | Both Fast + Slow in play | Mutual discard pair |
| `C-thought-police-redirect` | TP targeted by discard | Owner optional redirect |
| `C-herbalism-window` | Opponent plays action; Herbalism in hand | Non-current seat yes/no cancel |
| `C-dot-com-mandatory` | Dot Com + higher-value invention enters | Mandatory discard self |
| `C-coronation-attach` | Coronation + invent from hand | Place + attach + score bonus if first |
| `C-pottery-delayed` | Pottery moves card to future | After future era scored, delayed rescore |
| `C-government-block` | Monarchy already in today | Second government invent invalid |
| `C-wonky-reprocess` | Score move opens new slot | Card processes again (no double bank printed) |
| `C-era-stone-cancel` | Once-per-game stone cancel move/discard | Era owner cancels |
| `C-era-medieval-steal-bonus` | Bonus scored; medieval reacts | Steal bonus once |

### 2.3 Rules OFF — free tools (card-text by hand)

Engine tags **do not run**. Interactions to test are **structural**, using any public cards:

| Tool | Sources | Dest / assert |
|---|---|---|
| `free:attach` | Hand action | Host invention; host move keeps attach; host discard dumps attach |
| `free:detach` | Attachment | Always **owner hand** |
| `free:discard` | Timeline/hand/attach | Owner discard |
| `free:to-era` | Hand/discard/timeline | Chosen era top/bottom |
| `free:swap` | Two inventions | Positions swapped |
| `free:to-score-pile` / claim | Timeline | Public pile list + sum |
| `free:draw` / `recover-hand` | Deck / discard | Hand size |
| `free:score-bonus-delta` | Scoring | Totals update |
| `free:score-slot-cap` | Scoring | Capacity shading |
| `free:score-mark-processed` | Scoring | ✓ mark |
| `free:score-era-cleanup` A/B | Scoring | Preview counts → pile/discard |
| `free:score-finalize` | Scoring | Winner = piles + bonus |
| Rules ON→OFF mid-game | Any | Confirm; free tools; no re-enable |
| Play invention rules OFF | Invention with play tags | **No** auto draw/discard/etc. |

---

## 3. Shape × cards (inventory summary)

Unit-test column = pack id appears in `src/**/*.test.ts*` (not proof of correctness).

| Shape | # cards | Id in unit tests | Examples |
|---|---:|---:|---|
| `board-react` | 14 | 5/14 | Cloth, Chainmail, Dot Com, Thought Police, Crusades… |
| `play-move` | 12 | 7/12 | Wheel, Music, Horse Riding, Vortex, Anti-gravity… |
| `score-bonus` | 11 | 4/11 | Poetry, Coinage, Mass Marketing, Immortality, Cloning… |
| `protect` | 10 | 5/10 | Anarchy, Damascus, Moon Base, Blacksmithing… |
| `score-slots` | 10 | 5/10 | Slow/Fast Time, QC, Irrigation, Immortality slot… |
| `play-discard` | 8 | 7/8 | Fire, Napalm, Trebuchet, Hunting Party… |
| `score-count` | 8 | 2/8 | Irrigation, Math, Yoke, Cold Fusion, Multiplicity… |
| `hand-react` | 7 | 2/7 | Herbalism, Big Rock, Chainmail… |
| `play-delayed-trigger` | 6 | 4/6 | Taxes, TV, Media Scandal, Hunting Party, Waylay… |
| `score-penalty` | 5 | 2/5 | Cave Paintings, Deforestation… |
| `play-draw` | 5 | 3/5 | Fermented Fruit, Recycling, AI… |
| `play-swap` | 5 | 4/5 | Shell Game, Time Jump… |
| `score-discard` | 5 | 2/5 | Guillotine, Longbow, Art of War, Liquid N2, Tactical Nukes |
| `play-turn` | 5 | 5/5 | Androids, Inflation, Philosophy, Navigation |
| `government-rule` | 4 | 4/4 | All four governments |
| `play-recover` | 4 | 2/4 | Grave Robbing, Recycling… |
| `score-move` | 4 | 1/4 | Pottery, Shipbuilding, Space Travel, Cybertech |
| `play-choice` | 4 | 4/4 | Diplomacy, Surgical Strike, Laser, Semiconductor |
| `score-perform` | 3 | 2/3 | Nanotech, Chaos, **Alphabet (no id test)** |
| `score-branch` | 3 | 3/3 | Domesticated Animals, Quantum Theory, Corp Gov |
| `score-choice` | 3 | 2/3 | QC, Chaos, Era-Future |
| Singleton shapes | 1 each | mostly yes | Mysticism, Pottery delayed, Fortune Teller, Biotech, Think Future, Zero, Fast mutual |

Full tag→card map: [assets/packs/tag_definitions.md](./assets/packs/tag_definitions.md).

---

## 4. Deck inventory (formerly “no pack-id unit mention”) — **CLOSED**

All rows below are inventory-closed under the rulings report: either a **named pack-id golden** (`missingCards`, `matrixDebtClosure`, shape/chain/era suites) and/or an assertive Playwright path. See [CARD_INTERACTION_RULINGS_REPORT.md §5](./CARD_INTERACTION_RULINGS_REPORT.md) for full resolution mapping.

| Era | Card | Shape | Proof |
|---|---|---|---|
| stone | Alphabet | `score-perform` | `matrixDebtClosure` |
| stone | Big Rock | `hand-react` | matrixShapes hand-react family |
| stone | Cave Paintings | `score-penalty` | matrixShapes + missingCards |
| stone | Grave Robbing | `play-recover` ×2 | missingCards assertive |
| stone | Herbalism | `hand-react` cancel | matrixShapes + e2e PW-P0-07 |
| stone | Horse Riding | `play-move` | matrixShapes play-move family |
| stone | Irrigation | `score-count` | missingCards + e2e PW-P1-06 |
| stone | Shipbuilding | `score-move` | `matrixDebtClosure` |
| medieval | Advertising | re-host move | move executor / missingCards |
| medieval | Blacksmithing | `protect` | protect score-effects family |
| medieval | Chainmail | protect/redirect | multiCloth / protect family |
| medieval | Coinage | `score-bonus` copy | gapClosure / MM family |
| medieval | Crop Rotation | delayed invent swap | cropRotation.integration + e2e |
| medieval | Crusades | `board-react` | triggers retaliate |
| medieval | Hunting Party | delayed 6th | `matrixDebtClosure` |
| medieval | Mathematics | `score-count` | score-count family |
| medieval | The Art of War | `score-discard` art | missingCards |
| medieval | Yoke | `score-count` &lt;3 | missingCards |
| modern | Combination Drug Therapy | react replace | react tests |
| modern | Deforestation | era penalty | gapClosure / missingCards |
| modern | International Diplomacy | retaliate move | triggers ID |
| modern | Liquid Nitrogen | discard offset | gapClosure |
| modern | Mass Marketing | bonus copy nested | chaos-mm + e2e PW-P0-05 |
| modern | Recycling | recover-to-deck + draw | `matrixDebtClosure` + e2e PW-P1-11 |
| modern | Space Travel | first-score + move | `matrixDebtClosure` + e2e |
| modern | Tactical Nuclear Weapons | score discard count | missingCards |
| future | Anti-gravity | move self top today | play-move family |
| future | Artificial Intelligence | requires QC + draw | missingCards gate |
| future | Brain Taping | TP condition bonus | `matrixDebtClosure` |
| future | Cold Fusion | count future | score-count family |
| future | Cybertechnology | score-move top future | score-move family |
| future | Digital Secretary | prevent + refund | `matrixDebtClosure` + e2e PW-P1-10 |
| future | Genetic Modification | bonus copy | score-bonus family |
| future | Immortality | +10 last slot | missingCards + e2e PW-P1-09 |
| future | Moon Base | protect self | `matrixDebtClosure` |
| future | Multiplicity | count duplicates | `matrixDebtClosure` |
| future | Slow Time (future) | +2 slots | missingCards |
| future | Vortex (future) | yesterday→today | move family |
| era | Stone / Medieval / Modern / Future | once / begin / slots | `eraAbilities` + e2e |

**Debt-closure unit module:** `src/matrixDebtClosure.behavioral.test.ts` (Coronation, Pottery delayed, DS, Recycling, Hunting Party, Waylay, Zero, Think Future, Fortune Teller, Alphabet, Moon Base, Brain Taping, Multiplicity, Space Travel, Shipbuilding, …).

---

## 5. Playwright scenario matrix

### 5.1 Harness assumptions

| Item | Choice |
|---|---|
| App | `http://localhost:3000/src/pages/timestreams/` (Vite) or built SPA |
| Mode | **Local 2-Seat** for rules/UI; two-tab P2P for reconnect only |
| Pack | Asset pack ON (real art + tags) |
| Crypto | Mental-poker dual-seat works but slow; prefer **plaintext** setupData when harness supports it for effect tests |
| Seed / control | Prefer fixture moves via `page.evaluate` on Client state **or** seed short decks once harness exists; until then use free tools (rules OFF) to stage boards, then enable is **forbidden** mid-match — so stage with **rules ON** using invent/pass + fixed home eras |

**Practical Playwright strategy:**

1. **Stage with free tools is only valid for rules-OFF scenarios.**  
2. **Rules-ON golden paths** need either:  
   - scripted dual-seat Client in-process (preferred for CI), or  
   - long dual-seat mental-poker + invent from dealt hands (flaky without deck control).  
3. **Near-term:** add a **debug/test seed hook** (dev-only move `debugSeedBoard`) to place cards by id for Playwright — track as harness task H1.

### 5.2 P0 Playwright scenarios (ship first)

| ID | Mode | Steps (abbrev) | Assert |
|---|---|---|---|
| PW-R0-01 | OFF | Dual-seat rules OFF → claim → play → free:to-era / discard / attach / detach | Log lines; zones; detach → owner hand |
| PW-R0-02 | OFF | Score desk: bonus ±, cap ±, mark, claim, cleanup A preview, finalize | Totals; winner; no score tags auto |
| PW-R0-03 | OFF | Invent card that has `play:draw` tags | Hand/deck **unchanged by tags**; structural place only |
| PW-R1-01 | ON→OFF | Rules ON dual → invent → disable with confirm | Free tools appear; re-enable disabled; log DISABLED |
| PW-R1-02 | ON | Free tools bar **absent** | `free-tools-bar` count 0 |
| PW-RE-01 | P2P | Host/guest join codes → setup → refresh → Resume UI | Session keys; resume banner; re-handshake |
| PW-P0-01 | ON* | Fire play discard → choose target | Target in discard; log |
| PW-P0-02 | ON* | Hibernation attach → host protected | Move/discard blocked or UI |
| PW-P0-03 | ON* | Mysticism score → number picker 1–4 | Bonus/penalty ledger |
| PW-P0-04 | ON* | Nanotech score perform → nested prompt | Second card process; dual-ack advances |
| PW-P0-05 | ON* | Chaos → Mass Marketing nested | Nested prompt; scores; no stuck walk |
| PW-P0-06 | ON* | Think About The Future search | Prompt options; card to hand |
| PW-P0-07 | ON* | Herbalism in P1 hand; P0 plays action | P1 prompt; cancel yes → action fizzles |
| PW-P0-08 | ON* | Government twice same era | Second invent disabled/invalid |
| PW-P0-09 | ON* | Cloth redirect on move-out | Prompt or retarget |
| PW-P0-10 | ON* | Slow Time + Fast Time same day | Mutual discard pair |

\*Requires H1 seed hook or deterministic deck.

### 5.3 P1 Playwright scenarios (next wave)

| ID | Card / chain | Assert |
|---|---|---|
| PW-P1-01 | Fortune Teller peek multi-step | UI steps + deck order |
| PW-P1-02 | Biotechnology copy | Runs copied play ability |
| PW-P1-03 | Coronation | Invent + attach + first-of-era bonus at score |
| PW-P1-04 | Zero | Target printed → 0 in pile math |
| PW-P1-05 | Guillotine / Longbow / LN / Tactical Nukes | Score discard targets |
| PW-P1-06 | Irrigation / Math / Yoke / Cold Fusion / Multiplicity | Count scoring matches RULES |
| PW-P1-07 | Pottery delayed | After future era, delayed apply |
| PW-P1-08 | Space Travel first-score | Bonus once + move next era |
| PW-P1-09 | Immortality last slot future | +10 only if condition |
| PW-P1-10 | Digital Secretary | Next inventor printed refund path |
| PW-P1-11 | Recycling recover-to-deck | Deck + shuffle + draw |
| PW-P1-12 | Crop Rotation / Waylay / Hunting Party | Delayed / ongoing triggers |
| PW-P1-13 | Era-Stone / Era-Medieval once-per-game | React UI once |
| PW-P1-14 | Dual-ack scoring walk all eras | Both seats OK; no stuck |

### 5.4 Free-tools structural matrix (Playwright, rules OFF)

| ID | Interaction | Pass criteria |
|---|---|---|
| FT-01 | Attach action → invention | Attachment under host on both seats |
| FT-02 | Move host to other era | Attachment follows host id |
| FT-03 | Discard host | Attachments to owners’ discards |
| FT-04 | Detach | Owner hand only |
| FT-05 | Swap two inventions | Positions exchanged |
| FT-06 | To-score-pile | Public list + sum both seats |
| FT-07 | Recover from discard UI | Card in hand |
| FT-08 | Cleanup mode A vs B | Preview counts differ; confirm empties era correctly |
| FT-09 | Finalize | `gameOver` + winner from piles+bonus |

---

## 6. Unit vs Playwright division of labor

| Layer | Owns |
|---|---|
| **Unit (vitest)** | Pure zone math, tag executors, scoring walk edges, freeTools mutations, frozen-G safety |
| **Board RTL** | Prompt panels, free tools bar visibility, number picker, dual-seat props |
| **Playwright** | Full browser: crypto setup (smoke), free tools UX, rules toggle policy, dual-ack, multi-seat reacts, reconnect, golden paths that need real clicks |

Do **not** replace assertive unit tests with Playwright for Nanotech loops — keep unit for determinism; Playwright for “humans can finish the game.”

---

## 7. Implementation plan (Playwright)

### H1 — Dev seed hook (blocking for reliable rules-ON e2e)

Add optional move only when `config.playMode === 'plaintext' && config.debugSeed === true`:

```ts
// sketch
debugSeedBoard({ timeline, hands, discard, phase })
```

Wire from Playwright `page.evaluate` or a hidden test panel (`data-testid="debug-seed"`).

### H2 — Suite layout

```
packages/timestreams/e2e/
  playwright.config.ts
  helpers/spa.ts          # goto, local dual, claim eras, wait play
  helpers/freeTools.ts
  helpers/prompts.ts
  specs/
    free-tools.spec.ts          # PW-R0-*, FT-*
    rules-policy.spec.ts        # PW-R1-*
    reconnect.spec.ts           # PW-RE-01
    rules-on.p0.spec.ts         # PW-P0-* (needs H1)
    rules-on.p1.spec.ts         # PW-P1-*
```

Scripts:

```json
"test:e2e": "playwright test -c e2e/playwright.config.ts",
"test:e2e:ui": "playwright test --ui"
```

### H3 — CI

- Nightly full P0+P1  
- PR: free-tools + rules-policy only (fast, no seed flakiness)

---

## 8. Acceptance for “full interaction coverage”

| # | Criterion | Status (2026-07-14) |
|---|---|---|
| 1 | Every **shape** in §2.1 has ≥1 assertive unit **or** Playwright golden path | ✅ |
| 2 | Every **chain** in §2.2 has ≥1 dual-seat/unit chain test | ✅ unit (`matrixChains`) |
| 3 | Every card in §4 has unit with real tags and/or PW scenario | ✅ `missingCards` + assertive e2e |
| 4 | Free-tools FT-01…09 green in Playwright | ✅ |
| 5 | Reconnect PW-RE-01 green | ✅ |
| 6 | Tag consumer audit clean (no silent no-op tags without allowlist) | ✅ process closed |
| 7 | **Rules-complete** era abilities (stone/medieval/modern/future) | ✅ |
| 8 | Multi-Cloth owner choice + Hibernation fizzle | ✅ |
| 9 | Crop Rotation interactive adjacent swap | ✅ unit + e2e |
| 10 | Matrix debt closed: assertive residual goldens + rulings report | ✅ `matrixDebtClosure` + [RULINGS_REPORT](./CARD_INTERACTION_RULINGS_REPORT.md) |

**Residual (non-blocking / explicit deferrals):** polished UI copy on era prompts; full dual-seat mental-poker smoke for every golden path; one Playwright test per pack card (taxonomy + pack-id unit goldens satisfy DoD — see rulings report §6).

---

## 9. Related docs

| Doc | Role |
|---|---|
| [CARD_INTERACTION_RULINGS_REPORT.md](./CARD_INTERACTION_RULINGS_REPORT.md) | Assumptions A1–A12, rulings R1–R20, coverage map, §4 resolution |
| [TAG_TEST_GAP_REPORT.md](./TAG_TEST_GAP_REPORT.md) | Historical tag string inventory |
| [TAG_TEST_IMPLEMENTATION_PLAN.md](./TAG_TEST_IMPLEMENTATION_PLAN.md) | Old L1–L5 + manual P0 matrix |
| [RULES_ENGINE_GAP_REPORT.md](./RULES_ENGINE_GAP_REPORT.md) §6 | Engine gap status (historical; era/Cloth rows closed in code) |
| [RULES_OFF_PRD.md](./RULES_OFF_PRD.md) §12 | Free-tools acceptance |
| [assets/packs/tag_definitions.md](./assets/packs/tag_definitions.md) | Tag → cards |

---

## 10. Completion checklist (matrix → tests)

### §2.1 shapes → unit (`matrixShapes.behavioral.test.ts`)

| Shape | Test |
|---|---|
| search-deck … era-begin-react | ✅ one `it()` each in matrixShapes |

### §2.2 chains → unit (`matrixChains.behavioral.test.ts`)

| Chain | Test |
|---|---|
| C-nanotech-qc … C-era-medieval-steal-bonus | ✅ 13 chains |

### §2.3 free tools → unit + Playwright

| Tool / policy | Unit | Playwright |
|---|---|---|
| attach/detach/follow/discard | ✅ | ✅ FT-01..04 |
| to-era/swap/pile/draw/recover | ✅ | ✅ FT-05..07 |
| bonus/cap/mark/cleanup/finalize | ✅ | ✅ FT-08..09 |
| invent rules OFF no auto tags | ✅ | ✅ |
| disable one-way | ✅ | ✅ PW-R1-01 |

### §5.2–5.3 Playwright IDs (assertive)

| ID | Spec / proof |
|---|---|
| PW-R0-01..03 | free-tools.spec.ts |
| PW-R1-01..02 | rules-policy.spec.ts |
| PW-RE-01 | reconnect.spec.ts |
| PW-P0-01 Fire discard | matrix-rules-on (victim in discard) |
| PW-P0-02 Hibernation attach | matrix-rules-on |
| PW-P0-03 Mysticism guess | matrix-remaining (bonus + score) |
| PW-P0-04 Nanotech+QC | matrix-remaining (pile + scores) |
| PW-P0-05 Chaos→MM | matrix-remaining (nested score) |
| PW-P0-06 Think Future | matrix-rules-on |
| PW-P0-07 Herbalism cancel | matrix-remaining (fizzle + cost) |
| PW-P0-08 Government gate | matrix-rules-on (second blocked) |
| PW-P0-09 Cloth | matrix-remaining + multiCloth unit |
| PW-P0-10 Fast/Slow | matrix-rules-on |
| PW-P1-01 Fortune Teller | matrix-remaining (peek prompt) + matrixDebtClosure |
| PW-P1-02 Biotech copy | matrix-remaining |
| PW-P1-03 Coronation | matrix-remaining debt block + matrixDebtClosure |
| PW-P1-04 Zero | matrix-remaining + matrixDebtClosure |
| PW-P1-05 Guillotine | matrix-remaining (bottom discarded) |
| PW-P1-06 Irrigation count | matrix-remaining |
| PW-P1-07 Pottery delayed | matrix-remaining debt block + matrixDebtClosure |
| PW-P1-08 Space Travel | matrix-remaining + matrixDebtClosure |
| PW-P1-09 Immortality | matrix-remaining (last-slot +10) |
| PW-P1-10 Digital Secretary | matrix-remaining debt block + matrixDebtClosure |
| PW-P1-11 Recycling | matrix-remaining debt block + matrixDebtClosure |
| PW-P1-12 Crop / Waylay / Hunting | matrixDebtClosure + Crop e2e polish |
| PW-P1-13 era hands | matrix-remaining |
| PW-P1-14 dual-ack walk | matrix-remaining |
| Crop Rotation | matrix-remaining polish |
| Multi-Cloth | multiCloth unit + e2e |
| Era-Stone / Medieval / Modern | eraAbilities unit + e2e (incl. debt medieval steal) |

### Rules-complete era module (`eraAbilities.ts` + tests)

| Ability | Unit | E2E |
|---|---|---|
| Era-Stone cancel (play discard/move) | ✅ | ✅ |
| Era-Stone cancel (score discard/move) | ✅ | ✅ |
| Era-Medieval steal bonus | ✅ | seed |
| Era-Modern begin recover | ✅ | seed + unit endDay |
| Era-Future +2 slots | ✅ | unit batch/walk |

### Harness additions (2026-07-14)

| Piece | Role |
|---|---|
| `debugE2E` / `debugAct` | Multi-seat forceScoring, ackAll, scoreChoiceAs, reactAs, finishScoring |
| `debugSeed` registers static triggers | Crop/Dot Com watchers on seeded boards |
| Plain-draw unit tests | `layers:0` instant materialize vs encrypted queue |

---

## 11. Changelog

| Date | Note |
|---|---|
| 2026-07-11 | Initial matrix from pack manifests + unit-test id scan; Playwright plan; fixed `stone_age` manifest JSON typo (missing comma on Smoke Signals). |
| 2026-07-11 | Unit: `missingCards.behavioral.test.ts` (~34 tests). E2E: `e2e/` Playwright (free-tools, rules-policy, reconnect, rules-on P0). `debugSeed` + `?e2e=1` plaintext dual-seat. |
| 2026-07-11 | Full matrix implementation: shapes/chains/freeTools unit modules; `window.__tsE2E`; **456** unit + **38** Playwright green. |
| 2026-07-14 | Fixed draw/copy/recover unit regressions (encrypted fixture layers; copy `labelCardId`; sequential Water Wheel cost). |
| 2026-07-14 | Assertive PW golden paths (Mysticism, Nanotech, Chaos, Herbalism, Guillotine, Immortality, dual-ack). `debugAct` multi-seat harness. |
| 2026-07-14 | Multi-Cloth redirect + Hibernation fizzle; Crop Rotation e2e; plain-draw unit coverage. |
| 2026-07-14 | **Rules-complete era cards:** Stone cancel (play+score), Medieval steal, Modern begin recover, Future slots. **512** unit + **40** Playwright green. |
