# Timestreams — Rules Engine OFF (Manual / Structural Mode) PRD

**Status:** Draft v1.1 (2026-07-11) — product decisions locked (§2.1, §6.5, §9, §15)  
**Package:** `@manamesh/timestreams`  
**Audience:** Product + implementers of free-form board tools when `config.rulesEnabled === false`

**Related docs:**
- [PRD.md](./PRD.md) — overall game and platform shape
- [RULES.md](./RULES.md) — printed rules (players enforce text by hand in this mode)
- [RULES_ENGINE_PRD.md](./RULES_ENGINE_PRD.md) — tag-driven automatic effect execution when rules are **ON**
- [RULES_ENGINE_GAP_REPORT.md](./RULES_ENGINE_GAP_REPORT.md) — known engine incompleteness (motivation for a strong rules-off path)

---

## 1. Goals

When the rules engine is **off**, Timestreams becomes a **shared digital table**:

1. **Structural fidelity.** Players can place, attach, move, discard, recover, and score-tally any board state the printed cards require — without the software interpreting card text.
2. **Human authority.** Card text, legality (e.g. one Government per era), and effect order are enforced by players. The app only prevents impossible zone mutations (e.g. card in two places at once).
3. **Parity of visibility.** Same private/public zone model as rules-on (own hand private, timeline public, own discard viewable by owner, etc.).
4. **Graceful fallback.** Rules-off remains usable if the rules engine is buggy, incomplete, or deliberately disabled for teaching / freeform play.
5. **Shared multiplayer.** Free tools are **moves** (or concurrent multiplayer moves) so both P2P seats see the same board after each mutation. Prefer logging every free action to the activity feed.

### Non-goals

- Re-implementing tag executors under another name.
- Auto-resolving Play/Score/React text.
- Auto-legal Government / Art / “you may” enforcement.
- Perfect physical-table simulation of secret notes (e.g. Mysticism secret numbers stay social / honor system unless a simple note field is added later).
- AI suggestions for what a card “should” do.

---

## 2. Mode contract

| Flag | Behavior |
|---|---|
| `G.config.rulesEnabled === true` (**default at game start**) | Full tag engine: gates, play effects, reacts, scoring walk with automatic ability resolution. |
| `G.config.rulesEnabled === false` | **No** effect execution. Structural place/play/pass/day may still run. **Free tools** (§4–6) available. Scoring does **not** auto-apply score tags; players use manual tallies + free tools. |

There is **one** shared flag on game state: `G.config.rulesEnabled`. Both seats always see the same value (authoritative host/master state in P2P).

### 2.1 Rules engine on/off — multiplayer policy (normative)

**Default: engine ON.** It is easier to start enabled and let players **disable** if they want free tools / manual resolution.

#### Game start / lobby

1. **Session defaults to rules ON** for every seat (menu/lobby defaults should match).
2. **On match start**, if any peer would have started with engine enabled, **force all players to enabled** (`G.config.rulesEnabled = true`).  
   Practically: only the **host’s** setup value is written into `setupData` / `G.config`; guest UI must not fork a private “engine off” setting.  
   If host starts with OFF, both play OFF; if host starts with ON, both play ON.
3. **Confirm match of intent before connect (recommended UX):** lobby shows a single shared line:  
   `Rules engine: ON (recommended)` / `OFF (manual free tools)` — host controls; guest sees host’s choice and cannot start a mismatched private toggle.

#### Mid-game disable (ON → OFF)

1. Any player may request disable (or only current player — impl may allow either seat to open the dialog; the **move** still mutates shared `G.config`).
2. **Warning dialog (blocking confirm)** before applying:

   > **Disable rules engine for everyone?**  
   > Card text will no longer resolve automatically. You will use free tools to move cards and tally scores by hand.  
   > **You cannot re-enable the rules engine for the rest of this match.**  
   > Both players will be switched to Rules OFF.

3. On confirm: set `G.config.rulesEnabled = false` once in shared state → **both clients** update (single source of truth).
4. Side effects of disable:
   - Clear engine-only `pendingPrompts` (effect choices).
   - Keep timeline, hands, discards, attachments, score piles.
   - Log: `Rules engine DISABLED for all players (manual mode). Cannot re-enable this match.`
5. **Re-enable mid-game is forbidden** after a match has entered play with free-tool history, and specifically **forbidden after any ON→OFF transition**. UI: hide or permanently disable “enable rules” for the rest of the match once OFF.

#### Mid-game enable (OFF → ON)

- **Not allowed** for the remainder of the match once disabled (or once the match started OFF — product: if host *started* OFF, stay OFF; no toggle to ON mid-game either, to avoid half-applied engine state).
- **Rationale:** board history was not produced by the engine; re-enabling would not retroactively run effects and would desync expectations.

#### Summary

| Event | Behavior |
|---|---|
| Default start | Engine **ON** for all |
| Host chose OFF at start | Engine **OFF** for all from setup |
| Any seat disables mid-game | Shared OFF + warning that re-enable is impossible this match |
| Attempt re-enable mid-game | Blocked |

### Turn structure still exists

Rules-off does **not** remove:

- Home-era claim / ready / deck materialize  
- Day / today era highlight  
- Turn order, pass, day advance  
- Mental-poker draw (or plaintext draw) for hands  

It removes **automatic** interpretation of card text after structural place.

---

## 3. Design principles

1. **Moves, not effects.** Buttons describe board mutations: *Attach*, *Discard*, *To era…*, not *Resolve Fire*.
2. **Select → action → destination.** One consistent free-tool flow reduces UI sprawl.
3. **Attachments are structural glue.** When a host moves or discards, attachments follow or discard with it (table rules) — no tag reading required.
4. **Logged by default.** Every free tool application appends an activity line: `P0 free: attach Hibernation → Cloth (stone)`.
5. **Destructive confirms.** Discard host-with-attachments, bulk era cleanup, empty hand → discard: confirm once.
6. **Undo (MVP+).** One-step undo of the last free tool (optional stack of 5 later). Not required for first ship if log + re-place is acceptable.
7. **No silent guessing.** Free tools never auto-pick among multiple legal destinations without a prompt.

---

## 4. Zone model (unchanged topology)

| Zone | Contents | Visibility (rules-off) |
|---|---|---|
| Hand | Per player | Owner only |
| Deck (encrypted or plaintext) | Per player | Count public; contents private unless peek/search tool reveals |
| Discard | Per player | Owner may expand list (existing discard panel); others see **count only** |
| Timeline stack | Inventions per era, ordered | Public |
| Era actions | Era-level attachments (Slow/Fast Time, Hunting Party, …) | Public |
| Attachments map | Action → host invention | Public (render under host) |
| Score pile | Per player | Public list + sum (recommended) |
| Bonus ledger | Per player integer | Public |
| Scoring slot capacity | Per era integer (base 6 ± manual) | Public |
| Processed flags | Per card during scoring | Public |

---

## 5. Free tools — Play phase (MVP)

### 5.1 Always-available structural tools

Exposed when `rulesEnabled === false` (sticky **Free tools** bar or context menu on selection).

| Tool ID | Action | Sources | Destinations / notes |
|---|---|---|---|
| `free:attach` | Attach card to invention or era | Hand, era-action zone, already-attached (re-host) | Invention host **or** era-level action zone |
| `free:detach` | Detach without discarding | Attached action | **Always returns to the attachment owner’s hand** |
| `free:discard` | Send to **owner’s** discard | Hand, timeline, attachment, era action, score pile | Owner derived from card.ownerId |
| `free:to-era` | Place/move card onto an era stack | Hand, other era, discard, score pile, attachment | Choose era + position: top / bottom / index |
| `free:reorder` | Change order within same era stack | Timeline invention | New index in same era |
| `free:swap` | Swap two inventions | Two timeline inventions | Same or different eras |
| `free:to-score-pile` | Move card into a player’s score pile | Timeline, discard, hand (rare) | Choose pile owner (default card owner) |
| `free:from-score-pile` | Return card from score pile | Score pile | Hand, discard, or era (mistake recovery) |

### 5.2 Deck & hand economy (MVP)

| Tool ID | Action | Notes |
|---|---|---|
| `free:draw` | Draw N for self (or choose player) | Uses existing crypto/plaintext draw pipeline when possible |
| `free:discard-hand` | Discard selected hand card(s) | To owner discard |
| `free:recover-hand` | Move 1..N from own discard → hand | Choice UI over discard list |
| `free:empty-hand-to-discard` | Discard entire hand | Used at scoring start; confirm |

### 5.3 Deck tools (Phase 2 — still required for full card coverage)

| Tool ID | Action | Cards that need it |
|---|---|---|
| `free:recover-deck` | Discard → deck + optional shuffle | Recycling |
| `free:search-deck` | Reveal deck (decrypt if needed) → pick 1 to hand → shuffle | Think About The Future |
| `free:peek-deck` | Show top N, reorder / discard one | Fortune Teller |
| `free:shuffle-deck` | Shuffle remaining deck | After search/recover |

MVP may ship without Phase 2 if players accept workarounds (log-only for Fortune Teller); Phase 2 is **required** for faithful freeform with full packs.

### 5.4 Turn / day flags (small toggles)

| Tool ID | Action |
|---|---|
| `free:flag-extra-turn` | Grant self +1 extra turn counter |
| `free:flag-skip-turn` | Mark player skips next turn |
| `free:flag-nav-scope` | Next invention may be placed in yesterday/tomorrow (one-shot, clear after place) |
| `free:once-per-game` | Toggle spent on era card or named charge id |

Players still use normal **Pass** / day advance.

### 5.5 Automatic structural glue (not free tools; always on in rules-off)

| Rule | Behavior |
|---|---|
| Attach-follow | Host moves → attachments keep host id (move with host visually) |
| Attach-discard | Host discarded → attachments to their owners’ discards |
| Single zone | Card leaves prior zone when placed elsewhere |
| Ownership | `ownerId` does not change except explicit steal-to-pile / give tools |

---

## 6. Free tools — Scoring phase (MVP)

When rules-off enters scoring:

- Do **not** auto-run score tags or interactive score prompts.
- Provide a **manual scoring desk** overlaid on the timeline.

### 6.1 Scoring desk state

| Field | Type | Purpose |
|---|---|---|
| `manualBonus[playerId]` | number | Running bonus/penalty ledger (editable ±1 or custom Δ) |
| `manualSlotCap[eraId]` | number | Capacity (default `config.scoringSlots`, usually 6) |
| `manualProcessed[cardId]` | boolean | “Already scored this era” for Wonky walk |
| `manualCurrentCardId` | string \| null | Shared pointer for “we’re resolving this card” |
| Score piles | existing `players[pid].scorePile` | **Public list of cards** for every player + **sum of printed scores** (respect `manualPrintedOverride` if present) |
| Display total | pile sum + `manualBonus` | Public; read-only derived |

Optional: `manualPrintedOverride[cardId]` for Zero / display-only Inflation without attach.

### 6.2 Scoring actions

| Tool ID | Action |
|---|---|
| `free:score-move` | Move invention between/within eras (same as play free move) |
| `free:score-discard` | Discard from timeline |
| `free:score-claim-pile` | Claim selected invention(s) into score pile (owner or chosen stealer) |
| `free:score-mark-processed` | Mark / unmark processed |
| `free:score-set-current` | Set current card pointer |
| `free:score-bonus-delta` | Apply ±N to a player’s bonus ledger with optional note |
| `free:score-slot-cap` | ±1 or set capacity for an era |
| `free:score-era-cleanup` | Bulk end-of-era resolution — **confirm dialog** with explicit mode (§6.5) |
| `free:score-discard-all-hands` | All hands → each owner’s discard (scoring start) |
| `free:score-ack` | Dual-ack “next” without applying engine effects (shared attention only) |

### 6.3 Wonky rule (manual)

UI helps; does not enforce:

- Show stack order, capacity, processed marks, current pointer.
- Hint: “Next unscored from top of stack (if players follow Wonky).”
- Players still move cards and re-mark as needed.

### 6.4 End of game

- Button **Finalize scores**: `total[pid] = sum(printed in scorePile) + manualBonus[pid]` (respect printed overrides if any).
- Set `G.winner`, `G.phase = gameOver`.
- No automatic finalization on empty prompts.

### 6.5 Era cleanup — what “outside capacity” vs “unprocessed only” means

After an era’s score abilities are done (manually), the printed rules say roughly:

1. Inventions that **did not make a scoring slot** are discarded (never enter the timeline permanently).  
2. Inventions that **did score (slots)** go to their inventors’ **score piles**.  
3. Attachments / era actions usually leave with their hosts or are discarded.

In rules-**on** mode the engine does this automatically. In rules-**off**, a bulk **Era cleanup** button needs a clear rule for *which* stack cards become pile vs discard. Two common interpretations:

#### Mode A — **Outside capacity** (position-based; matches default printed cleanup)

Use the era’s **scoring capacity** `C` (usually 6, or `manualSlotCap[era]`).

- Look at the era stack in order: indices `0 .. C-1` = **in scoring slots**.  
- Indices `C .. end` = **outside capacity** (overflow / “didn’t make the cut”).

| Stack position | Default cleanup |
|---|---|
| In slot range `[0, C)` | → each card’s **owner’s score pile** (bank printed value) |
| Outside capacity `[C, ∞)` | → each card’s **owner’s discard** |

**Does not look at** “did we mark this processed?” A card that sat in slot 3 the whole time goes to the pile even if players forgot to mark it. A card that was moved into slot range late still counts as in-slot by **final position**.

**When players want this:** Normal manual play following the rulebook: “first six score; the rest are discarded,” after all mid-score movement is finished.

#### Mode B — **Unprocessed only** (mark-based; Wonky / interrupted walk)

Use **manual processed flags** instead of (or in addition to) position:

| Card state | Cleanup |
|---|---|
| **Processed** (marked scored this era) | → owner’s **score pile** (or stealer’s pile if players already moved it there) |
| **Unprocessed** | → owner’s **discard** |

Position / capacity is ignored for the split. A card sitting in slot 1 that never got marked is discarded; a card that was processed then moved out of the top six can still go to the pile.

**When players want this:** They walked the era with “mark scored” as the source of truth (Wonky moves, Nanotech-style steals already claimed to piles, partial cleanup). Safer if the stack order no longer matches “who actually scored.”

#### Hybrid (optional third radio)

1. **Processed** → score pile (if not already in a pile).  
2. Of the **unprocessed**, those **outside capacity** → discard.  
3. Unprocessed still **inside capacity** → leave on board or prompt (players finish marking).  

Useful if someone hit cleanup early by mistake; not required for MVP.

#### MVP product decision (locked for implementers)

- Cleanup dialog **must** choose mode explicitly (no silent default without showing the choice).  
- **Default selected radio: Mode A — Outside capacity** (matches RULES.md end-of-era language).  
- Mode B available as alternate.  
- Always **confirm** with a preview count: e.g. “3 → score piles, 2 → discard, 1 era-action → discard.”  
- Cards **already in a score pile** are left alone.  
- **Attachments** on discarded hosts: discard with host (structural glue). Attachments on pile-bound hosts: discard with host’s departure from timeline (attachments are not inventions in the score pile unless players free-tool them).

#### Example

Medieval stack (top→bottom), capacity 6:

| Index | Card | Processed? |
|---|---|---|
| 0 | Fire | yes |
| 1 | Cloth | yes |
| 2 | Poetry | yes |
| 3 | Taxes | yes |
| 4 | Zero | no |
| 5 | Longbow | yes |
| 6 | Extra invention | no |
| 7 | Another | no |

- **Mode A (outside capacity):** indices 0–5 → piles; 6–7 → discard. Zero goes to **pile** even though unprocessed.  
- **Mode B (unprocessed only):** Fire, Cloth, Poetry, Taxes, Longbow → piles; Zero + both extras → discard. Zero is **discarded** despite being in a slot.

That is the difference the dialog must make obvious.

---

## 7. UI surface

### 7.1 Rules-off chrome

When rules off:

- Banner: **Rules engine OFF — free tools (manual card text)**.
- Sticky **Free tools** bar (play) or **Scoring desk** (scoring).
- Normal invent/action/pass still place cards structurally when players use them; free tools cover everything else.

### 7.2 Selection model

1. Click card (hand / timeline / discard / score pile) → selection ring.  
2. Free tools enable based on selection.  
3. Multi-select for swap (exactly 2) and bulk claim/discard.  
4. Clear selection after successful tool or Escape.

### 7.3 Prompts for free tools

Reuse existing prompt kinds where possible:

| Kind | Use |
|---|---|
| `choose-card` | Attach host, discard target, recover picks |
| `choose-option` | Era, top/bottom, yes/no confirms |
| `choose-number` | Bonus Δ, draw N, slot cap |
| Multi card | Swap pair, bulk discard |

Decider: **current player** for play-phase free tools; **acting seat** for scoring free tools (§9).

### 7.4 Scoring desk layout (wireframe)

```
┌─ Scoring (manual) ─────────────────────────────────────────┐
│ Era: Medieval · cap [−] 6 [+] · processed 2 · current: Fire │
│ Bonus  P0 [−][+ ] 3    P1 [−][+ ] −1                        │
│ Piles  P0 14  [Fire 1, Cloth 1, …]  P1 9  […public lists] │
│ [Mark scored] [Claim pile] [Discard] [Move…] [Era cleanup]  │
│ [OK — next]  acks: P0✓ P1…                                  │
└────────────────────────────────────────────────────────────┘
 Timeline columns remain interactive for select/move.
```

### 7.5 Visibility

- Free tools that reveal private info (search deck, peek) only show full data to the owner; opponents see log line “P0 searched deck.”
- Discard list remains owner-expandable (existing panel).
- **Score piles are public:** every player sees every pile as a **list of cards** plus the **sum of printed scores** (and the combined total with bonus ledger).

### 7.6 Rules engine control (UI)

- Prefer a single shared control that reflects `G.config.rulesEnabled` (not per-seat local state).
- **Disable** path: modal with the warning in §2.1; on confirm, one move sets OFF for everyone.
- **Enable** path: hidden or disabled after match start once OFF (or always disabled mid-match if started OFF).
- Lobby: host’s rules choice is the only one that enters `setupData`; guest mirrors it.

---

## 8. Activity log

Every free tool logs:

```
P{pid} free:{toolId} · {card labels} · {dest summary} · {optional note}
```

Examples:

- `P0 free:attach · Hibernation → Cloth (stone)`
- `P1 free:score-bonus-delta · P0 −2 · Cloth next inventor`
- `P0 free:to-era · Quantum Computing → future (top)`

Notes field optional on confirm dialogs.

---

## 9. Multiplayer & concurrency

| Policy | Decision |
|---|---|
| Who may use free tools in **play**? | **Current player only** |
| Who may use free tools in **scoring**? | **Any seat** (concurrent), so either player can adjust bonus/piles/cleanup |
| Detach destination | **Owner’s hand** |
| Score piles | **Public card list + printed sum** for all players |
| Rules engine flag | **Single shared** `G.config.rulesEnabled`; see §2.1 |
| P2P free tools | boardgame.io moves; concurrent where dual scoring edits race (`ignoreStaleStateID` as needed) |
| Conflicts | Last write wins on same card; activity log shows both attempts if needed |
| Resume | Host localStorage restore includes free-tool + manual scoring state |

---

## 10. Engine surface (implementation sketch)

New module e.g. `src/freeTools.ts` (names illustrative):

```ts
export type FreeToolId =
  | 'free:attach' | 'free:detach' | 'free:discard' | 'free:to-era'
  | 'free:reorder' | 'free:swap' | 'free:to-score-pile' | 'free:from-score-pile'
  | 'free:draw' | 'free:discard-hand' | 'free:recover-hand' | 'free:empty-hand-to-discard'
  | 'free:score-bonus-delta' | 'free:score-slot-cap' | 'free:score-mark-processed'
  | 'free:score-set-current' | 'free:score-claim-pile' | 'free:score-era-cleanup'
  | 'free:score-discard-all-hands' | 'free:score-ack'
  // Phase 2:
  | 'free:recover-deck' | 'free:search-deck' | 'free:peek-deck' | 'free:shuffle-deck'
  | 'free:flag-extra-turn' | 'free:flag-skip-turn' | 'free:flag-nav-scope'
  | 'free:once-per-game';

export function canUseFreeTools(G: TimestreamsState): boolean;
export function applyFreeTool(G, playerId, toolId, args): EffectResult | 'INVALID_MOVE';
```

State additions (rules-off scoring):

```ts
// on TimestreamsState or nested manualScoring:
manualBonus?: Record<string, number>;
manualSlotCap?: Partial<Record<EraId, number>>;
manualProcessed?: Record<string, boolean>; // or Set serialized as string[]
manualCurrentCardId?: string | null;
manualPrintedOverride?: Record<string, number>;
```

`computeScoringSlotsForEra` when rules-off: prefer `manualSlotCap[era]` if set, else base config (ignore tag-based slot cards unless players set cap by hand).

---

## 11. MVP vs later

### MVP (ship first)

- Free tools §5.1 + §5.2 (except multi-player force-discard if rare).  
- Scoring desk §6.1–6.2 without printed override.  
- Attach-follow glue.  
- Activity log lines.  
- Confirm on bulk discard / era cleanup.  
- UI: free tools bar + selection + scoring desk.  
- Tests: structural mutations only (no tag side effects when rules off).

### Phase 2

- Deck search / peek / recover-to-deck / shuffle.  
- Turn flags + once-per-game markers.  
- Undo stack (1–5).  
- Printed value override.  
- Force discard from opponent hand (with decider = target owner choice).  
- Steal-to-my-score-pile explicit tool.  

### Out of scope

- Auto Wonky walker.  
- Auto react windows.  
- Partial tag execution “just for this card.”

---

## 12. Acceptance criteria

### Play (rules off)

1. Player can attach an action from hand onto any invention; host move carries attachment; host discard discards attachment.  
2. Player can discard any public timeline card to its owner’s discard.  
3. Player can place a card from hand or discard into any era at top/bottom/index.  
4. Player can swap two inventions across eras.  
5. Player can draw and recover from own discard to hand.  
6. Activity log records free actions.  
7. With rules off, playing an invention with play tags does **not** auto-draw/discard/etc.

### Scoring (rules off)

8. Players can adjust bonus ledger and see totals update.  
9. Players can change era capacity and see slot shading match.  
10. Players can mark processed, move cards, claim to score pile, and bulk-clean an era.  
11. Finalize scores uses pile printed sums + bonus ledger.  
12. Dual-ack advances shared “current” pointer without applying score tags.

### Regression & multiplayer rules flag

13. Rules **on** path unchanged when free tools are hidden/disabled.  
14. Toggle off mid-game does not corrupt timeline/hands.  
15. Disabling rules shows the §2.1 warning and sets shared OFF for all seats.  
16. After disable, UI cannot re-enable rules for the rest of the match.  
17. Match start with host ON forces engine ON for the shared `G`; host OFF forces shared OFF.  
18. Detach always deposits the action in the **owner’s hand**.  
19. Score piles UI shows **card list + printed sum** for every player.  
20. Era cleanup preview lists counts for pile vs discard under the selected mode (A or B).

---

## 13. Testing strategy

| Layer | What |
|---|---|
| Unit | Each `applyFreeTool` mutates zones correctly; attach-follow; ownership |
| Integration | rules-off full day: place, attach, discard, pass, day advance |
| Scoring manual | bonus + cap + process + claim + finalize winner |
| Board | Free tools bar visible only when rules off; selection + confirm |
| Negative | Free tools return INVALID when rules on |

---

## 14. Implementation roadmap

| Step | Deliverable |
|---|---|
| R0 | State fields + `freeTools.ts` core (attach/detach/discard/to-era/reorder/swap) |
| R1 | Draw / recover-hand / empty-hand; activity log |
| R2 | Scoring desk state + bonus/cap/processed/claim/cleanup/finalize |
| R3 | Board UI: selection, free tools bar, scoring desk |
| R4 | Phase 2 deck tools + flags |
| R5 | Undo + polish + docs |

---

## 15. Resolved product decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Free tools in **play** phase | **Current player only** |
| 2 | Free tools in **scoring** phase | **Any seat** |
| 3 | Detach | Attachment returns to **owner’s hand** |
| 4 | Era cleanup | Confirm dialog; modes **A outside capacity** (default) vs **B unprocessed only** — see §6.5 |
| 5 | Score piles | **Public lists** of cards + **sum of printed scores** |
| 6 | Rules engine start | Default **ON**; host choice applies to **all**; guest cannot diverge |
| 7 | Rules engine mid-game OFF | Allowed with **warning**; applies to **both** players; **cannot re-enable** this match |
| 8 | Rules engine mid-game ON | **Blocked** after OFF (and not offered if match started OFF) |

---

## 16. Document control

| Version | Date | Notes |
|---|---|---|
| 1.0 | 2026-07-11 | Initial PRD from manual-mode design discussion |
| 1.1 | 2026-07-11 | Locked free-tool auth, detach, score piles, rules multiplayer policy; elaborated era cleanup §6.5 |

**Next:** implementation plan or R0 spike — not started in this document.
