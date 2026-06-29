# Mistborn: The Deck Building Game — Rules Transcription

**Source:** *Mistborn: The Deck Building Game Manual* (19 pages)

This document provides a clean, structured transcription of the rules for reference during implementation of the Manamesh version in `packages/mistborn-deckbuilder`.

---

## Components

- **4 Character Cards**: Kelsier (The Survivor), Vin (The Warrior), Marsh, and others.
- **4 Player Training Tracks** + matching colored tracking cubes.
- **4 sets of 8 Metal Tokens** (32 total): Pewter, Tin, Bronze, Copper, Zinc, Brass, Iron, Steel.
- **4 Health Dials** + 4 matching tracking cubes.
- **4 Starter Decks** (10 cards each = 40 total): 4 character-specific Training cards + 6 Funding cards per player.
- **82 Market Cards**.
- **36 Lord Ruler Challenge Cards** (Adversaries + Edicts for solo/co-op).
- **Lord Ruler Card** + **Dominance Track Card**.
- **8 Mission Cards** (play with 3).
- **16 Atium Tokens**.
- **14 Boxing Tokens** (coins).
- **Target Standee** (for 3-4 player games).
- **Lord Ruler Health Dial** + 8 tracking cubes.

---

## Setup (4-Player)

1. **Individual Player Setup** (give each player):
   - One randomly selected Character Card.
   - One Training Track + tracking cube (place on first step).
   - One set of 8 metal tokens (place on marked spaces above the track).
   - The 4 starting "Training" cards specific to their character + 6 Funding cards, shuffled together as starting deck.
   - Health dial set to 36.
   - Draw 5 cards for starting hand.

2. If fewer than 4 players: remove unused player components (extra starter cards, funding cards, etc.).

3. Shuffle the Market deck and place it centrally. Reveal the top **6 cards** as the Market row.

4. Place all Boxing and Atium tokens near the Market.

5. Shuffle the 8 Mission cards and reveal **3**. Set the rest aside. For each revealed Mission, place one tracking cube (in each player's color) on the image area on the right side of the card (starting area, not on the track yet).

6. Choose a first player randomly.
   - Second player (clockwise): +2 health.
   - Third player: +4 health.
   - Fourth player: +4 health + 1 Boxing.
   - If >2 players: the last player (clockwise from first) receives the **Target** standee.

7. Players draw their starting hand of 5 cards.

**Health Dials**: Player dials show 0–40 (max health 40). Lord Ruler dial shows 0–48 (or 0–6 on some faces?).

---

## Game Overview & Major Concepts (Deckbuilding)

Mistborn is a deckbuilder: start with a weak deck and improve it by buying powerful cards and eliminating weak ones.

### Core Rules
- Each player has: **5-card hand**, **facedown deck**, **face-up discard pile**, and **cards in play**.
- You may look through your own hand and discard pile at any time (not your deck).
- Play cards from hand in **any order**.
- Gained cards go to your **discard pile** immediately (unless a card says otherwise).
- **End of turn**: Move all cards in play (except Allies) + any unplayed cards in hand to the discard pile.
- Draw a new hand of **5 cards**.
- If you need to draw but have no cards in deck (at any time): shuffle your discard pile into a new deck.
- **Eliminated** cards go to a shared eliminated pile (visible to all).

**Strategy Note**: Decks can be "lean" (small, consistent), diverse, metal-focused, combat-focused, mission-focused, Atium-focused, etc. Your character and the current Market influence the best approach.

---

## Metals

Allomancy is powered by **Burning** metals.

### The 8 Metals (Paired)
- Pewter / Tin
- Bronze / Copper
- Zinc / Brass
- Iron / Steel

Each player has **one physical token** of each metal.

### Burning
- At game start you may Burn **1 metal per turn**.
- Training track (and some cards/Missions) permanently increase this (up to **4**).
- To Burn: remove the token from your track and place it on the card (or empty play space if no direct effect).
- Return tokens to track at end of turn.
- You may only power a card using a metal (or card) that matches the **required metal(s)** shown.
- **Action cards** can be played **sideways** as metals for their pairing (the vial on the right side). This does **not** count against your Burn limit. No limit on cards used as metals.
- You may Burn a metal for "no effect" (place in empty space) to enable Savant abilities, Ally triggers, etc.

### Flaring
- If you want to Burn **more metals than your current limit**, you must **Flare**.
- Flip an unused metal token to its dark-bordered side and place it as a Burn.
- Flared metals act as normal Burns for all effects.
- At end of turn, **keep them flipped** on the track — they cannot be used again (Burn or Flare) until **refreshed**.
- You may Flare as many as you want (subject to having unflared tokens left).

### Refreshing
- **Discard a card** from hand whose metal vial matches the pair of the Flared token → flip one matching Flared token back to usable side.
- Certain cards and Mission rewards have a **Refresh symbol** (curved arrows) that let you refresh any Flared metal without discarding a specific card.
- You may refresh a metal you Flared this turn and use it again this turn (but each metal only once per turn total; you cannot Flare → refresh → Flare again).

### Atium
- Gained from Training track and certain Missions (single-use tokens).
- **Wild**: can substitute for **any** other metal. When used as a substitute (e.g., for a Pewter card), it counts as **both** Atium **and** that metal for Ally/character effects.
- Powers Atium cards.
- Atium Action cards (when played sideways) can power **any** card.
- Discarding an Atium card (sideways) **refreshes any one Flared metal**.
- **Cannot be Flared**.
- Return used Atium to the supply at end of turn (unlimited supply; use placeholders if needed).

### Metal Effects Summary (High Level)
- **Pewter**: Combat + Healing. Many Defender allies.
- **Tin**: Mission points + Coins. **Sense** abilities interfere with opponents' Mission progress.
- **Bronze**: Mission points. **Seek** — use top effect of a Market Action card (pay its cost).
- **Copper**: Varied (healing, blocking). **Cloud** — reduce or block incoming damage to player/allies.
- **Zinc**: Coins. **Riot** — activate an Ally's top effect without Burning its metal.
- **Brass**: Mission + Coins. **Soothe** — eliminate one of your own cards (hand/discard/play) to thin deck.
- **Iron**: Combat. **Pull** — move a card from discard to top of deck.
- **Steel**: Combat + Coins. **Push** (or Rush) — eliminate a Market card (replace immediately).
- **Atium**: Strong Mission points + Combat. Flexible powering/refresh.

**Savant abilities** trigger only when the card is used **as a metal** (not for its primary effect or refresh discard).

---

## Cards

Two main types in the Market deck:

### Action Cards (Vertical)
1. Name
2. Cost (in coins)
3. Primary metal required + primary effect (activates on Burn; once per turn regardless of multiple Burns of that metal)
4. Optional additional metal costs (must activate top ability first; you may need Atium or cards-as-metals)
5. Metal pairing vial (right side): use the card sideways to power matching-metal cards, or discard to refresh a Flared metal of that pair.
6. Secondary/tertiary effects (require extra Burns of listed metals)
7. Savant ability (only when used as metal)
8. Off-turn abilities (vertical bar on left): discard at the right moment (no metal Burn needed) for reactive effects (e.g., Cloud damage reduction).

**Strategy Tip**: Soothe (and some Missions) let you eliminate cards from hand, discard, or even already-played cards this turn. Eliminated cards go to the shared elimination pile (also used by Steel "Push" and character level II abilities).

### Ally Cards (Horizontal)
- Played **above** your character card.
- Stay in play (providing ongoing benefit) until **defeated** by an opponent (then move to **owner's** discard pile).
- Cannot be used as metals or to refresh.
- **Defense** value: must take damage ≥ Defense in one attack to kill (no partial damage).
- **Associated metal** (if any): If you are Burning that metal **anywhere** this turn (token or card), gain the listed benefit (once per turn, even if you Burn the metal multiple times).
- Some have additional-metal effects.
- Some have **Ongoing** effects (always active, no metal required).

### Funding Cards
- Only in starting decks (6 per player).
- Provide **Coins** for buying.
- Have **no metal cost** or associated metal.
- Not available in the Market after setup.

---

## Characters & Training Track

Every player has a **Character Card** and **Training Track**.

### Training Track
- At the **start of your turn**, move your cube **one space** right/up the track (you also receive any reward instantly).
- Cards or Missions may move you additional spaces (symbol: upward arrow with bar).
- Four reward types:
  1. **Burn an extra metal** (permanent increase to your per-turn Burn limit: 1 → 2 → 3 → 4).
  2. **Unlock character ability** (permanent).
  3. Gain **1 Atium** token.
  4. **Continuous Atium** (at end of track): every time you would gain a Mission point advance (including start-of-turn), gain +1 extra Atium.

### Character Card Abilities
Unlocked progressively via the track:

- **Signature Metal Effect**: Like an Ally passive. Whenever you Burn your character's signature metal (anywhere), gain the effect (once per turn).
- **Level II Ability** (common to all characters): Once per turn, when you buy an Action card from the Market, you may immediately **eliminate** it and resolve its **top effect** without Burning any metal.
- **Atium Effect** (common): Whenever you Burn Atium (as Atium or as a substitute), gain the listed benefit.

**Health**: Tracked on dial. Start 36–40. Max 40. Damage reduces; healing increases. 0 health = eliminated from game.

---

## Missions

Each game uses **3 out of 8** Mission cards.

- Players advance by gaining **Mission points** (symbol: stacked bars or similar).
- Points gained in one turn can be split across tracks or all spent on one.
- Cubes start on the **image area** on the right of each Mission (not considered "on the track").
- First step onto the actual track requires moving up from the starting area.

**Mission Card Anatomy**:
1. Name.
2. Starting area (right-side image).
3. Track (usually requires 12 points to reach top?).
4. Mid-track rewards (one-time, gained when reached).
5. Mid-track **first-player rewards** (only the first player to reach that spot gets them).
6. Placement spots at top (record finishing order left-to-right).
7. Top **first-player reward** (one-time even if the main top reward is permanent).
8. Top reward (one-time or **permanent**).

**Strategy Notes**:
- The first player to finish a Mission track is **permanently the highest** on that track.
- A lone cube actually on the track is both highest and (if no one else has started) lowest.
- Ties for highest/lowest count when 3+ cubes are on track.
- Cubes still on the starting image don't count for "highest/lowest on track".
- You can advance Missions at any point during your turn (may enable other actions).

**Winning via Missions**: First to reach the **top of all three** current Missions wins immediately.

---

## Combat & Health

Another win condition: be the **last player alive**.

- Damage is represented by **Combat points** (symbol: crossed swords or similar).
- You may only **use** combat at the **end of your turn**.
- Split combat freely between Allies and the Target holder (or opponent in 2p).
- **Allies**: Take no partial damage. Damage ≥ Defense kills instantly (move to owner's discard). Can be attacked regardless of Target.
- **Defender** allies (many Pewter): While alive, opponents **may not target you or your non-Defender allies**. Must kill all your Defenders before targeting anything else. If attacker lacks enough damage to kill the Defender, they cannot use damage on you at all.
- **Cloud** (off-turn Copper ability): Reduce incoming damage to a player or their allies.
- **Heal** symbol restores health (max 40).

### Target Mechanic (3–4 Players)
- Last player clockwise from first player starts with the **Target**.
- At end of turn (after using combat on any Allies), you **must** direct your remaining damage at the **current Target holder**.
- After a Target holder receives any damage to health, they **may pass** the Target to any other player (happens after all damage is assigned that turn).
- If the Target holder is eliminated, the attacker may redirect any remaining damage to a chosen player.
- If only 2 players remain, the Target is removed from the game.
- Allies are **never** protected by the Target; you can kill anyone's Allies freely.
- If you hold the Target: after Allies, your combat hits **every other player** (Defender allies of a target absorb first).

### 2-Player Games
- At end of turn you **may** (but don't have to) direct all combat at your single opponent + their Allies.
- Reducing them to 0 or below eliminates them and you win.

**Strategy**: You do not have to use all (or any) combat. Holding the Target too long makes you a target. Killing Defenders or using Cloud can be key.

---

## Market, Buying, Boxings

### Buying
- At **any time** during your turn, buy any visible Market card you can afford.
- Total coins = coins from: played Funding/Action effects + Savant abilities + Ally effects + character abilities + Mission rewards + spent Boxings.
- Pay the cost, place the bought card directly into your **discard pile**, then immediately replace it from the Market deck.
- You may buy any number of cards (and Boxings). Unspent coins do **not** carry over.

### Boxings
- Buy from supply for **2 coins**.
- At any future time, spend 1 Boxing to gain **1 coin**.
- Unlimited supply (use placeholders).

---

## Turn Structure (Competitive)

A player's turn:

1. **Train**: Move 1 space on Training track (gain reward immediately).
2. **Main phase** (any order, any number of times):
   - Play cards from hand.
   - Burn or Flare metals on cards.
   - Use a card sideways as a metal.
   - Discard a card to refresh a Flared metal.
   - Activate Ally and character abilities (that trigger on Burn or ongoing).
   - Move up on Mission tracks (spend Mission points).
   - Buy cards and/or Boxings from the Market.
3. **Combat**: Deal damage (Allies first if desired, then to Target holder or as per rules). Target holder may pass after damage.
4. **Cleanup**:
   - Move all cards in play (except Allies) and remaining unplayed hand cards to discard pile.
5. **Draw**: Draw 5 cards from deck (shuffle discard if needed).

**Icons quick reference** (common effects):
- Train (advance Training track)
- Combat (damage)
- Mission (advance a Mission track)
- Heal
- Coin
- Burn extra metal
- Draw a card
- Refresh a metal
- Eliminate a card
- Dominance Up (Lord Ruler)

---

## End of Game (Competitive)

The game ends immediately when **any** of the following occur:

1. A player reaches the **top of all three** active Mission tracks.
2. Only **one player remains** (all others eliminated via health = 0).
3. A player plays **4 Atium** on the **CONFRONTATION** card (from the Market).

---

## Solo & Co-op Play

Play as a team (or alone) against the **Lord Ruler**.

### Setup Differences
- **No Target standee**.
- No starting health/Boxing bonuses.
- Place **Dominance track** + Lord Ruler card on it (only title bar visible at start). Set LR health to **48**.
- LR has his own **36-card deck** (Adversaries + Edicts) placed nearby.
- Reveal 3 Missions as normal (cubes placed normally).

### Dominance
- Starts at **1**.
- Increases to max **6** via Edicts.
- **X** on cards = current highest Dominance value shown (not cumulative; use only the current max).
- Some Edict moves only trigger if <4 players.

### Gameplay
- Players **do not attack each other** or each other's Allies. They may use protective effects (Cloud, etc.) on teammates.
- Turns are like competitive, except combat is directed at the Lord Ruler and/or his Adversaries.
- **After each player's turn** (after they draw their new hand), draw and resolve the top card of the **Lord Ruler's deck**:

#### Adversaries
- Place the drawn Adversary **in front of the player** who drew it.
- Adversaries have:
  - Name.
  - Effect (permanent or "at end of your turn" before draw).
  - **1–3 Shields**. Shields must be destroyed left-to-right. Damage ≥ shield value destroys it (place black cube). "X" shield = damage equal to current Dominance.
  - Any player can attack any Adversary (even one not in front of them).
  - "Kill an Ally" effects (e.g. Assassinate) can remove **one shield** from any Adversary.
  - Once all shields gone, move to LR's discard pile.

#### Edicts
Resolve in order:
- **Dominance Up** (1–2 steps; slide LR card down, reveal and apply new effect immediately). Flip the track card when required.
- Additional (usually negative) effect.
- **Lord Ruler Healing**: For each **incomplete** Mission, LR heals **10** (max 48). A Mission is complete if **at least one player** has reached its top reward.
- **Market Clearing**: Eliminate the two cards indicated on the bottom of the LR card; replace them from the Market deck.

If a player is eliminated by LR/Adversary damage: they are out. Skip their turns and do not draw LR cards for them. Player count for "X" or conditional effects uses remaining players.

### Winning / Losing (Solo/Co-op)
- **Players win** if LR health reaches **0**.
- **Players win** by playing 4 Atium on **CONFRONTATION**.
- **Players lose** if the LR deck runs out of cards (time runs out).
- (All players eliminated also loses, implicitly.)

**Notes**:
- **Sense** abilities have no effect on the Lord Ruler.
- **Solo specifics** for highest/lowest on Missions: A solo player is lowest only if on the track but before first reward. Highest if they have received the highest reward before the final one. They get first-player rewards appropriately.
- **Collective** damage (on some Edicts): players may split the damage among themselves however they choose (solo player takes it all).

---

## Additional Notes for Implementation

- Many effects are "once per turn" even if the triggering metal is Burned multiple times.
- "Permanent" rewards on Missions/Training stay for the rest of the game.
- Eliminating your own cards (Soothe, character abilities, etc.) is a core thinning strategy.
- The Market is always 6 cards; instantly refilled after purchase or elimination.
- Off-turn abilities are discarded when used and provide no other benefit.
- Atium is powerful but limited by how much you can generate and the 4-Atium Confrontation win condition.

---

*This transcription prioritizes clarity and completeness for software implementation. Refer to the original PDF for exact card text, images, and edge-case wording.*

**Next steps per user request**: Review this RULES.md together, then proceed to writing the PRD for development in the Manamesh framework.
