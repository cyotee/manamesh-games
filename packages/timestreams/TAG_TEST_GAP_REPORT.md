# Timestreams Tag Test Gap Report

**Date:** 2026-07-08  
**Sources:** pack manifests (`assets/packs/timestreams/**/manifest.json`), `assets/packs/tag_definitions.md`, tests under `src/**/*.test.ts(x)`.

Related plan: [TAG_TEST_IMPLEMENTATION_PLAN.md](./TAG_TEST_IMPLEMENTATION_PLAN.md) (includes **board transition / UI display** testing, not engine-only)

---

## Why this matters

`src/effects/tagCoverage.test.ts` only asserts that every pack tag starts with a **handled** or **deferred** prefix. It does **not** require a behavioral test. Deferred families and missing executors can pass CI while doing nothing in play (e.g. `play:search-deck` / Think About The Future before it was fixed).

## Summary

| Metric | Count |
| --- | ---: |
| Unique tags in pack manifests | 293 |
| Unique tags in tag inventory | 293 |
| Tags analyzed | 293 |
| Tags mentioned in any test | 140 |
| Tags with **no** test mention | 153 |
| **P0** — on cards, no test, no clear impl (silent no-op risk) | 47 |
| **P1** — on cards, impl hook present, no test | 106 |
| **P2** — inventory only (0 pack cards) | 0 |

### Coverage method

- **Tested:** full tag string appears in `src/**/*.test.ts(x)` (string presence, not full behavioral proof).
- **Implemented (heuristic):** tag/family appears in effects/play/scoring via `hasTag` / `tagValue` / `tagNumber` / string literals.

---

## P0 — Untested + no implementation hook

Highest risk: "I played the card and nothing happened."

| Tag | # cards | Example card ids |
| --- | ---: | --- |
| `score:discard` | 5 | `medieval-guillotine`, `medieval-longbow`, `medieval-the-art-of-war`, `modern-liquid-nitrogen` |
| `score:move` | 4 | `future-tech-cybertechnology`, `modern-space-travel`, `stone-age-pottery`, `stone-age-shipbuilding` |
| `score:choice` | 3 | `era-future`, `future-tech-quantum-computing`, `modern-chaos-theory` |
| `branch:target:next-invention` | 2 | `modern-quantum-theory`, `stone-age-domesticated-animals` |
| `if-false:penalty:to:target-owner` | 2 | `future-tech-corporate-government`, `modern-quantum-theory` |
| `limit:once-per-game` | 2 | `era-medieval`, `era-stone` |
| `additional:condition:target-deck:future-tech` | 1 | `future-tech-cloning` |
| `attach:to:played-invention` | 1 | `medieval-coronation` |
| `branch:target:next-scoring-invention` | 1 | `future-tech-corporate-government` |
| `cancel:target-filter:unscored` | 1 | `modern-chaos-theory` |
| `delayed:condition:still-in-play` | 1 | `stone-age-pottery` |
| `delayed:even-non-scoring` | 1 | `stone-age-pottery` |
| `delayed:in-addition-to-slot-scoring` | 1 | `stone-age-pottery` |
| `discard:count:2` | 1 | `modern-tactical-nuclear-weapons` |
| `discard:opponent-deck-card` | 1 | `medieval-fortune-teller` |
| `extend:today-effects-to-yesterday` | 1 | `modern-telecommunications` |
| `guess:by:left-neighbor` | 1 | `stone-age-mysticism` |
| `guess:correct:penalty:-3` | 1 | `stone-age-mysticism` |
| `guess:range:1-4` | 1 | `stone-age-mysticism` |
| `guess:wrong:bonus-points:chosen-number` | 1 | `stone-age-mysticism` |
| `if-false:discard:target` | 1 | `stone-age-domesticated-animals` |
| `if-false:penalty:amount:-2` | 1 | `future-tech-corporate-government` |
| `if-false:penalty:printed-value:target` | 1 | `modern-quantum-theory` |
| `if-true:bonus-points:printed-value:target` | 1 | `modern-quantum-theory` |
| `if-true:bonus-points:to:self` | 1 | `modern-quantum-theory` |
| `mutual-discard:subtype:slow-time` | 1 | `medieval-fast-time` |
| `peek:opponent-deck:3` | 1 | `medieval-fortune-teller` |
| `peek:own-deck:3` | 1 | `medieval-fortune-teller` |
| `play:copy` | 1 | `future-tech-biotechnology` |
| `play:peek` | 1 | `medieval-fortune-teller` |
| `play:play-invention` | 1 | `medieval-coronation` |
| `recover:to-deck` | 1 | `modern-recycling` |
| `redirect:decider:owner` | 1 | `stone-age-cloth` |
| `redirect:on-immovable:fizzle` | 1 | `stone-age-cloth` |
| `redirect:target-filter:any` | 1 | `stone-age-cloth` |
| `return-order:decider:self` | 1 | `medieval-fortune-teller` |
| `return:remainder:top-of-deck` | 1 | `medieval-fortune-teller` |
| `score:delayed` | 1 | `stone-age-pottery` |
| `score:guess` | 1 | `stone-age-mysticism` |
| `score:set-value` | 1 | `medieval-zero` |
| `set-value:amount:0` | 1 | `medieval-zero` |
| `slots:scope:today` | 1 | `future-tech-quantum-computing` |
| `steal:bonus-points` | 1 | `era-medieval` |
| `steal:even-non-scoring` | 1 | `future-tech-nanotech` |
| `steal:target-to:own-score-pile` | 1 | `future-tech-nanotech` |
| `suppress:original-bonus-points` | 1 | `era-medieval` |
| `to-hand:choose:1` | 1 | `medieval-fortune-teller` |

### P0 by phase bucket

- **play-time:** 29 tags
- **score-time:** 14 tags
- **react-time:** 0 tags
- **other:** 4 tags

### Cards that use ≥1 P0 tag

| Card id | P0 tags on card |
| --- | --- |
| `era-future` | `score:choice` |
| `era-medieval` | `limit:once-per-game`, `steal:bonus-points`, `suppress:original-bonus-points` |
| `era-stone` | `limit:once-per-game` |
| `future-tech-biotechnology` | `play:copy` |
| `future-tech-cloning` | `additional:condition:target-deck:future-tech` |
| `future-tech-corporate-government` | `branch:target:next-scoring-invention`, `if-false:penalty:amount:-2`, `if-false:penalty:to:target-owner` |
| `future-tech-cybertechnology` | `score:move` |
| `future-tech-nanotech` | `steal:even-non-scoring`, `steal:target-to:own-score-pile` |
| `future-tech-quantum-computing` | `score:choice`, `slots:scope:today` |
| `medieval-coronation` | `attach:to:played-invention`, `play:play-invention` |
| `medieval-fast-time` | `mutual-discard:subtype:slow-time` |
| `medieval-fortune-teller` | `discard:opponent-deck-card`, `peek:opponent-deck:3`, `peek:own-deck:3`, `play:peek`, `return-order:decider:self`, `return:remainder:top-of-deck`, `to-hand:choose:1` |
| `medieval-guillotine` | `score:discard` |
| `medieval-longbow` | `score:discard` |
| `medieval-the-art-of-war` | `score:discard` |
| `medieval-zero` | `score:set-value`, `set-value:amount:0` |
| `modern-chaos-theory` | `cancel:target-filter:unscored`, `score:choice` |
| `modern-liquid-nitrogen` | `score:discard` |
| `modern-quantum-theory` | `branch:target:next-invention`, `if-false:penalty:printed-value:target`, `if-false:penalty:to:target-owner`, `if-true:bonus-points:printed-value:target`, `if-true:bonus-points:to:self` |
| `modern-recycling` | `recover:to-deck` |
| `modern-space-travel` | `score:move` |
| `modern-tactical-nuclear-weapons` | `discard:count:2`, `score:discard` |
| `modern-telecommunications` | `extend:today-effects-to-yesterday` |
| `stone-age-cloth` | `redirect:decider:owner`, `redirect:on-immovable:fizzle`, `redirect:target-filter:any` |
| `stone-age-domesticated-animals` | `branch:target:next-invention`, `if-false:discard:target` |
| `stone-age-mysticism` | `guess:by:left-neighbor`, `guess:correct:penalty:-3`, `guess:range:1-4`, `guess:wrong:bonus-points:chosen-number`, `score:guess` |
| `stone-age-pottery` | `delayed:condition:still-in-play`, `delayed:even-non-scoring`, `delayed:in-addition-to-slot-scoring`, `score:delayed`, `score:move` |
| `stone-age-shipbuilding` | `score:move` |

---

## P1 — Untested but implementation present

Regression risk: code paths exist without dedicated tests.

| Tag | # cards | Example card ids |
| --- | ---: | --- |
| `score:count` | 7 | `future-tech-cold-fusion`, `future-tech-multiplicity`, `medieval-mathematics` |
| `score:per:1` | 7 | `future-tech-cold-fusion`, `future-tech-multiplicity`, `medieval-mathematics` |
| `target:scope:current-era` | 6 | `medieval-coinage`, `medieval-zero`, `modern-chaos-theory` |
| `count:scope:current-era` | 4 | `medieval-mathematics`, `medieval-monarchy`, `medieval-yoke` |
| `play:scope:today` | 4 | `future-tech-multiplicity`, `future-tech-slow-time`, `medieval-fast-time` |
| `trigger:source:opponent` | 4 | `medieval-chainmail`, `medieval-crusades`, `modern-international-diplomacy` |
| `bonus-points:amount:2` | 3 | `future-tech-brain-taping`, `medieval-poetry`, `modern-space-travel` |
| `copy:target:invention` | 3 | `future-tech-biotechnology`, `medieval-coinage`, `modern-mass-marketing` |
| `count:include-self` | 3 | `future-tech-cold-fusion`, `medieval-monarchy`, `modern-semiconductor` |
| `count:own-inventions` | 3 | `medieval-yoke`, `modern-deforestation`, `stone-age-irrigation` |
| `count:scope:today` | 3 | `future-tech-cold-fusion`, `future-tech-multiplicity`, `stone-age-irrigation` |
| `move:target:invention` | 3 | `future-tech-cybertechnology`, `modern-the-internet`, `stone-age-horse-riding` |
| `score:penalty:next-inventor` | 3 | `future-tech-digital-secretary`, `modern-television`, `stone-age-cloth` |
| `cancel:all-effects-of-source` | 2 | `stone-age-big-rock`, `stone-age-herbalism` |
| `copy:value:printed` | 2 | `medieval-coinage`, `modern-mass-marketing` |
| `count:cardtype:invention` | 2 | `future-tech-cold-fusion`, `medieval-mathematics` |
| `count:in-scoring-slot` | 2 | `future-tech-cold-fusion`, `stone-age-irrigation` |
| `decider:self` | 2 | `future-tech-high-powered-laser`, `future-tech-quantum-computing` |
| `discard:scope:current-era` | 2 | `medieval-guillotine`, `medieval-longbow` |
| `discard:self` | 2 | `medieval-hunting-party`, `modern-dot-com` |
| `penalty:amount:-2` | 2 | `modern-television`, `stone-age-cloth` |
| `play:scope:tomorrow` | 2 | `medieval-hunting-party`, `modern-deforestation` |
| `protect:scope:same-era` | 2 | `medieval-chainmail`, `stone-age-cloth` |
| `protect:target:own-inventions` | 2 | `medieval-chainmail`, `stone-age-cloth` |
| `recover:from-discard:2` | 2 | `modern-recycling`, `stone-age-grave-robbing` |
| `score:penalty` | 2 | `modern-deforestation`, `stone-age-cave-paintings` |
| `suppress:score-effects-on-target` | 2 | `modern-chaos-theory`, `stone-age-hibernation` |
| `trigger:mandatory` | 2 | `modern-dot-com`, `stone-age-cloth` |
| `trigger:scope:same-era` | 2 | `medieval-crop-rotation`, `modern-dot-com` |
| `bonus-points:additional:2` | 1 | `future-tech-cloning` |
| `bonus-points:printed-value:their-invention` | 1 | `future-tech-digital-secretary` |
| `bonus-points:to:next-inventor` | 1 | `future-tech-digital-secretary` |
| `condition:attached-to-first-invention-of-era` | 1 | `medieval-coronation` |
| `condition:higher-value-invention` | 1 | `modern-dot-com` |
| `condition:in-era:future` | 1 | `future-tech-immortality` |
| `condition:in-last-scoring-slot` | 1 | `future-tech-immortality` |
| `condition:in-scoring-slot` | 1 | `future-tech-brain-taping` |
| `condition:in-today` | 1 | `modern-telecommunications` |
| `condition:odd-scoring-slot` | 1 | `medieval-poetry` |
| `condition:scope:same-era` | 1 | `future-tech-brain-taping` |
| `condition:scored-in-era:future` | 1 | `future-tech-corporate-government` |
| `condition:subtype:thought-police` | 1 | `future-tech-brain-taping` |
| `condition:target-deck:future-tech` | 1 | `future-tech-corporate-government` |
| `condition:target-deck:modern` | 1 | `modern-quantum-theory` |
| `condition:target-deck:stone-age` | 1 | `stone-age-domesticated-animals` |
| `copy:as-if-own` | 1 | `future-tech-biotechnology` |
| `copy:play-ability` | 1 | `future-tech-biotechnology` |
| `copy:target:any-card` | 1 | `future-tech-genetic-modification` |
| `count:condition:printed-value-under-3` | 1 | `medieval-yoke` |
| `count:duplicates:own-inventions` | 1 | `future-tech-multiplicity` |
| `count:owner:opponents` | 1 | `medieval-mathematics` |
| `count:scope:this-era` | 1 | `modern-deforestation` |
| `count:target-deck:future-tech` | 1 | `future-tech-cold-fusion` |
| `count:target-deck:medieval` | 1 | `medieval-monarchy` |
| `count:target-deck:modern` | 1 | `modern-semiconductor` |
| `discard:scope:any-era` | 1 | `medieval-the-art-of-war` |
| `discard:scope:same-era` | 1 | `medieval-crusades` |
| `discard:target:any-card` | 1 | `modern-tactical-nuclear-weapons` |
| `discard:target:bottom-of-era` | 1 | `medieval-guillotine` |
| `discard:target:offset-below:1` | 1 | `modern-liquid-nitrogen` |
| `discard:target:offset-below:3` | 1 | `medieval-longbow` |
| `discard:target:their-invention` | 1 | `medieval-crusades` |
| `discard:triggering-invention` | 1 | `medieval-hunting-party` |
| `move-destination:any-future-era` | 1 | `stone-age-pottery` |
| `move-destination:any-position-same-era` | 1 | `modern-the-internet` |
| `move-destination:different-invention` | 1 | `medieval-advertising` |
| `move-destination:top-future` | 1 | `future-tech-cybertechnology` |
| `move-destination:top-next-era` | 1 | `modern-space-travel` |
| `move:direction:up-or-down` | 1 | `stone-age-horse-riding` |
| `move:scope:any-era` | 1 | `modern-the-internet` |
| `move:scope:same-era` | 1 | `medieval-advertising` |
| `move:target:action` | 1 | `medieval-advertising` |
| `move:target:offset-below:1` | 1 | `stone-age-shipbuilding` |
| `option-a:add-scoring-slots:1` | 1 | `future-tech-quantum-computing` |
| `option-a:draw:2` | 1 | `future-tech-high-powered-laser` |
| `option-b:discard:1` | 1 | `future-tech-high-powered-laser` |
| `option-b:discard:scope:today-or-tomorrow` | 1 | `future-tech-high-powered-laser` |
| `option-b:discard:target:any-card` | 1 | `future-tech-high-powered-laser` |
| `option-b:remove-scoring-slots:1` | 1 | `future-tech-quantum-computing` |
| `penalty:amount:-3` | 1 | `stone-age-cave-paintings` |
| `penalty:amount:-5` | 1 | `future-tech-digital-secretary` |
| `penalty:optional` | 1 | `stone-age-cave-paintings` |
| `penalty:per:1` | 1 | `modern-deforestation` |
| `penalty:target:art` | 1 | `stone-age-cave-paintings` |
| `penalty:to:target-owner` | 1 | `stone-age-cave-paintings` |
| `prevent:move:past` | 1 | `future-tech-digital-secretary` |
| `protect:score-effects` | 1 | `medieval-blacksmithing` |
| `protect:target:era-invention` | 1 | `era-stone` |
| `react:action` | 1 | `stone-age-herbalism` |
| `react:bonus-points` | 1 | `era-medieval` |
| `react:era-begin` | 1 | `era-modern` |
| `react:point-value-changed` | 1 | `modern-international-diplomacy` |
| `react:targeted` | 1 | `future-tech-thought-police` |
| `redirect:target-to:self` | 1 | `stone-age-cloth` |
| `requires:subtype:quantum-computing` | 1 | `future-tech-artificial-intelligence` |
| `score:remove-scoring-slots:2` | 1 | `medieval-fast-time` |
| `swap:scope:adjacent` | 1 | `medieval-crop-rotation` |
| `swap:scope:different-eras` | 1 | `future-tech-time-jump` |
| `swap:with:art` | 1 | `future-tech-holograms` |
| `trigger:move-out-of-era` | 1 | `stone-age-cloth` |
| `trigger:phase:play` | 1 | `modern-international-diplomacy` |
| `trigger:phase:score` | 1 | `modern-international-diplomacy` |
| `trigger:sixth-invention-in-era` | 1 | `medieval-hunting-party` |
| `trigger:source:action` | 1 | `stone-age-cloth` |
| `trigger:target:own-cards` | 1 | `stone-age-big-rock` |
| `trigger:target:own-inventions` | 1 | `medieval-crusades` |

---

## Untested tags by family

### `additional` (1 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `additional:condition:target-deck:future-tech` | 1 | **no** |

### `attach` (1 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `attach:to:played-invention` | 1 | **no** |

### `bonus-points` (4 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `bonus-points:amount:2` | 3 | yes |
| `bonus-points:additional:2` | 1 | yes |
| `bonus-points:printed-value:their-invention` | 1 | yes |
| `bonus-points:to:next-inventor` | 1 | yes |

### `branch` (2 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `branch:target:next-invention` | 2 | **no** |
| `branch:target:next-scoring-invention` | 1 | **no** |

### `cancel` (2 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `cancel:all-effects-of-source` | 2 | yes |
| `cancel:target-filter:unscored` | 1 | **no** |

### `condition` (13 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `condition:attached-to-first-invention-of-era` | 1 | yes |
| `condition:higher-value-invention` | 1 | yes |
| `condition:in-era:future` | 1 | yes |
| `condition:in-last-scoring-slot` | 1 | yes |
| `condition:in-scoring-slot` | 1 | yes |
| `condition:in-today` | 1 | yes |
| `condition:odd-scoring-slot` | 1 | yes |
| `condition:scope:same-era` | 1 | yes |
| `condition:scored-in-era:future` | 1 | yes |
| `condition:subtype:thought-police` | 1 | yes |
| `condition:target-deck:future-tech` | 1 | yes |
| `condition:target-deck:modern` | 1 | yes |
| `condition:target-deck:stone-age` | 1 | yes |

### `copy` (5 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `copy:target:invention` | 3 | yes |
| `copy:value:printed` | 2 | yes |
| `copy:as-if-own` | 1 | yes |
| `copy:play-ability` | 1 | yes |
| `copy:target:any-card` | 1 | yes |

### `count` (13 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `count:scope:current-era` | 4 | yes |
| `count:include-self` | 3 | yes |
| `count:own-inventions` | 3 | yes |
| `count:scope:today` | 3 | yes |
| `count:cardtype:invention` | 2 | yes |
| `count:in-scoring-slot` | 2 | yes |
| `count:condition:printed-value-under-3` | 1 | yes |
| `count:duplicates:own-inventions` | 1 | yes |
| `count:owner:opponents` | 1 | yes |
| `count:scope:this-era` | 1 | yes |
| `count:target-deck:future-tech` | 1 | yes |
| `count:target-deck:medieval` | 1 | yes |
| `count:target-deck:modern` | 1 | yes |

### `decider` (1 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `decider:self` | 2 | yes |

### `delayed` (3 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `delayed:condition:still-in-play` | 1 | **no** |
| `delayed:even-non-scoring` | 1 | **no** |
| `delayed:in-addition-to-slot-scoring` | 1 | **no** |

### `discard` (12 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `discard:scope:current-era` | 2 | yes |
| `discard:self` | 2 | yes |
| `discard:count:2` | 1 | **no** |
| `discard:opponent-deck-card` | 1 | **no** |
| `discard:scope:any-era` | 1 | yes |
| `discard:scope:same-era` | 1 | yes |
| `discard:target:any-card` | 1 | yes |
| `discard:target:bottom-of-era` | 1 | yes |
| `discard:target:offset-below:1` | 1 | yes |
| `discard:target:offset-below:3` | 1 | yes |
| `discard:target:their-invention` | 1 | yes |
| `discard:triggering-invention` | 1 | yes |

### `extend` (1 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `extend:today-effects-to-yesterday` | 1 | **no** |

### `guess` (4 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `guess:by:left-neighbor` | 1 | **no** |
| `guess:correct:penalty:-3` | 1 | **no** |
| `guess:range:1-4` | 1 | **no** |
| `guess:wrong:bonus-points:chosen-number` | 1 | **no** |

### `if-false` (4 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `if-false:penalty:to:target-owner` | 2 | **no** |
| `if-false:discard:target` | 1 | **no** |
| `if-false:penalty:amount:-2` | 1 | **no** |
| `if-false:penalty:printed-value:target` | 1 | **no** |

### `if-true` (2 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `if-true:bonus-points:printed-value:target` | 1 | **no** |
| `if-true:bonus-points:to:self` | 1 | **no** |

### `limit` (1 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `limit:once-per-game` | 2 | **no** |

### `move` (6 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `move:target:invention` | 3 | yes |
| `move:direction:up-or-down` | 1 | yes |
| `move:scope:any-era` | 1 | yes |
| `move:scope:same-era` | 1 | yes |
| `move:target:action` | 1 | yes |
| `move:target:offset-below:1` | 1 | yes |

### `move-destination` (5 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `move-destination:any-future-era` | 1 | yes |
| `move-destination:any-position-same-era` | 1 | yes |
| `move-destination:different-invention` | 1 | yes |
| `move-destination:top-future` | 1 | yes |
| `move-destination:top-next-era` | 1 | yes |

### `mutual-discard` (1 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `mutual-discard:subtype:slow-time` | 1 | **no** |

### `option-a` (2 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `option-a:add-scoring-slots:1` | 1 | yes |
| `option-a:draw:2` | 1 | yes |

### `option-b` (4 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `option-b:discard:1` | 1 | yes |
| `option-b:discard:scope:today-or-tomorrow` | 1 | yes |
| `option-b:discard:target:any-card` | 1 | yes |
| `option-b:remove-scoring-slots:1` | 1 | yes |

### `peek` (2 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `peek:opponent-deck:3` | 1 | **no** |
| `peek:own-deck:3` | 1 | **no** |

### `penalty` (7 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `penalty:amount:-2` | 2 | yes |
| `penalty:amount:-3` | 1 | yes |
| `penalty:amount:-5` | 1 | yes |
| `penalty:optional` | 1 | yes |
| `penalty:per:1` | 1 | yes |
| `penalty:target:art` | 1 | yes |
| `penalty:to:target-owner` | 1 | yes |

### `play` (5 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `play:scope:today` | 4 | yes |
| `play:scope:tomorrow` | 2 | yes |
| `play:copy` | 1 | **no** |
| `play:peek` | 1 | **no** |
| `play:play-invention` | 1 | **no** |

### `prevent` (1 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `prevent:move:past` | 1 | yes |

### `protect` (4 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `protect:scope:same-era` | 2 | yes |
| `protect:target:own-inventions` | 2 | yes |
| `protect:score-effects` | 1 | yes |
| `protect:target:era-invention` | 1 | yes |

### `react` (5 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `react:action` | 1 | yes |
| `react:bonus-points` | 1 | yes |
| `react:era-begin` | 1 | yes |
| `react:point-value-changed` | 1 | yes |
| `react:targeted` | 1 | yes |

### `recover` (2 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `recover:from-discard:2` | 2 | yes |
| `recover:to-deck` | 1 | **no** |

### `redirect` (4 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `redirect:decider:owner` | 1 | **no** |
| `redirect:on-immovable:fizzle` | 1 | **no** |
| `redirect:target-filter:any` | 1 | **no** |
| `redirect:target-to:self` | 1 | yes |

### `requires` (1 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `requires:subtype:quantum-computing` | 1 | yes |

### `return` (1 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `return:remainder:top-of-deck` | 1 | **no** |

### `return-order` (1 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `return-order:decider:self` | 1 | **no** |

### `score` (11 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `score:count` | 7 | yes |
| `score:per:1` | 7 | yes |
| `score:discard` | 5 | **no** |
| `score:move` | 4 | **no** |
| `score:choice` | 3 | **no** |
| `score:penalty:next-inventor` | 3 | yes |
| `score:penalty` | 2 | yes |
| `score:delayed` | 1 | **no** |
| `score:guess` | 1 | **no** |
| `score:remove-scoring-slots:2` | 1 | yes |
| `score:set-value` | 1 | **no** |

### `set-value` (1 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `set-value:amount:0` | 1 | **no** |

### `slots` (1 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `slots:scope:today` | 1 | **no** |

### `steal` (3 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `steal:bonus-points` | 1 | **no** |
| `steal:even-non-scoring` | 1 | **no** |
| `steal:target-to:own-score-pile` | 1 | **no** |

### `suppress` (2 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `suppress:score-effects-on-target` | 2 | yes |
| `suppress:original-bonus-points` | 1 | **no** |

### `swap` (3 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `swap:scope:adjacent` | 1 | yes |
| `swap:scope:different-eras` | 1 | yes |
| `swap:with:art` | 1 | yes |

### `target` (1 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `target:scope:current-era` | 6 | yes |

### `to-hand` (1 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `to-hand:choose:1` | 1 | **no** |

### `trigger` (10 untested)

| Tag | Cards | Impl? |
| --- | ---: | --- |
| `trigger:source:opponent` | 4 | yes |
| `trigger:mandatory` | 2 | yes |
| `trigger:scope:same-era` | 2 | yes |
| `trigger:move-out-of-era` | 1 | yes |
| `trigger:phase:play` | 1 | yes |
| `trigger:phase:score` | 1 | yes |
| `trigger:sixth-invention-in-era` | 1 | yes |
| `trigger:source:action` | 1 | yes |
| `trigger:target:own-cards` | 1 | yes |
| `trigger:target:own-inventions` | 1 | yes |

---

## Tags with tests (family rollup)

- `play` — 18 tag(s)
- `discard` — 11 tag(s)
- `move` — 8 tag(s)
- `swap` — 7 tag(s)
- `protect` — 6 tag(s)
- `score` — 6 tag(s)
- `target` — 6 tag(s)
- `trigger` — 6 tag(s)
- `draw` — 5 tag(s)
- `requires` — 5 tag(s)
- `bonus-points` — 4 tag(s)
- `move-destination` — 4 tag(s)
- `option-b` — 4 tag(s)
- `react` — 4 tag(s)
- `recover` — 4 tag(s)
- `copy` — 3 tag(s)
- `decider` — 3 tag(s)
- `modify` — 3 tag(s)
- `move-source` — 3 tag(s)
- `option-a` — 3 tag(s)
- `condition` — 2 tag(s)
- `cost` — 2 tag(s)
- `duration` — 2 tag(s)
- `extra-turn` — 2 tag(s)
- `ongoing` — 2 tag(s)
- `prevent` — 2 tag(s)
- `redirect` — 2 tag(s)
- `rule` — 2 tag(s)
- `allow` — 1 tag(s)
- `attach` — 1 tag(s)
- `delayed` — 1 tag(s)
- `forced` — 1 tag(s)
- `government` — 1 tag(s)
- `opponents-draw` — 1 tag(s)
- `perform` — 1 tag(s)
- `replace` — 1 tag(s)
- `retaliate` — 1 tag(s)
- `skip-turn` — 1 tag(s)
- `skip` — 1 tag(s)

---

## Regeneration

```bash
# From packages/timestreams — regenerate inventory then re-run gap script if added
python3 scripts/generate_tag_inventory.py
```

Progress tracking: [TAG_TEST_IMPLEMENTATION_PLAN.md](./TAG_TEST_IMPLEMENTATION_PLAN.md)

---

_Last count scan: 2026-07-08 — 293 pack tags, 293 mentioned in tests, 0 not mentioned._
