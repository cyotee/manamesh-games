### Task 2: Migrate game packages off `@cyotee/manamesh/src/...`

**Files:**
- Modify (all deep-import hits from Task 1 inventory), at least:
  - `packages/onepiece/src/deckResolver.ts`
  - `packages/onepiece/src/deckResolver.test.ts`
  - `packages/onepiece/src/{game,crypto,types,zones}.ts`
  - `packages/poker/src/{game,crypto,types,crypto.test,crypto.adversarial,mentalPoker.harness}.ts`
  - `packages/poker/src/components/PokerBoard.tsx`
  - `packages/timestreams/src/{game,crypto,types,zones,deck,deckResolver}.ts`
  - `packages/mistborn-deckbuilder/src/{game,types,assets}.ts`
  - `packages/mistborn-deckbuilder/src/board/MistbornBoard.tsx`
- Test:  
  `yarn workspace @manamesh/onepiece test`  
  `yarn workspace @manamesh/poker test`  
  `yarn workspace @manamesh/timestreams test`  
  `yarn workspace @manamesh/mistborn-deckbuilder test`

**Interfaces:**
- Consumes: Task 1 export map
- Produces: zero remaining `@cyotee/manamesh/src/` imports under `packages/{poker,timestreams,onepiece,mistborn-deckbuilder}`

- [ ] **Step 1: Write a failing grep gate (document expected before/after)**

```bash
rg -n "from ['\"]@cyotee/manamesh/src/" packages --glob '**/*.{ts,tsx}' | wc -l
```

Expected before migration: count > 0. After Task 2: count `0` for the four game packages (frontend may still use relative imports internally).

- [ ] **Step 2: Apply mechanical renames**

Use these replacement rules (exact strings):

| Old | New |
|-----|-----|
| `@cyotee/manamesh/src/game/modules/types` | `@cyotee/manamesh/game/modules` |
| `@cyotee/manamesh/src/deck/types` | `@cyotee/manamesh/deck` |
| `@cyotee/manamesh/src/assets/manifest/types` | `@cyotee/manamesh/assets/manifest` |
| `@cyotee/manamesh/src/assets/loader/loader` | `@cyotee/manamesh/assets/loader` |
| `@cyotee/manamesh/src/assets/loader/local-loader` | `@cyotee/manamesh/assets/loader` |
| `@cyotee/manamesh/src/assets/loader/cache` | `@cyotee/manamesh/assets/loader` |
| `@cyotee/manamesh/src/assets/loader/types` | `@cyotee/manamesh/assets/loader` |
| `@cyotee/manamesh/src/hooks/useAssetPack` | `@cyotee/manamesh/hooks/useAssetPack` |
| `@cyotee/manamesh/src/hooks/useCardImage` | `@cyotee/manamesh/hooks/useCardImage` |
| `@cyotee/manamesh/src/hooks/useCardSettings` | `@cyotee/manamesh/hooks/useCardSettings` |
| `@cyotee/manamesh/src/components/CryptoTransparencyPanel` | `@cyotee/manamesh/components/CryptoTransparencyPanel` |
| `@cyotee/manamesh/src/components/CardSettingsPanel` | `@cyotee/manamesh/components/CardSettingsPanel` |
| `@cyotee/manamesh/src/blockchain/wallet` | `@cyotee/manamesh/blockchain/wallet` |
| `@cyotee/manamesh/src/assets/packs/standard-cards` | `@cyotee/manamesh/assets/packs/standard-cards` |

Example (One Piece deckResolver):

```ts
// before
import type { EnrichedCard } from "@cyotee/manamesh/src/deck/types";
import { enrichCard } from "@cyotee/manamesh/src/deck/types";
import type { DeckList } from "@cyotee/manamesh/src/deck/types";
import { getLoadedPack, getAllLoadedPacks } from "@cyotee/manamesh/src/assets/loader/loader";

// after
import type { EnrichedCard, DeckList } from "@cyotee/manamesh/deck";
import { enrichCard } from "@cyotee/manamesh/deck";
import { getLoadedPack, getAllLoadedPacks } from "@cyotee/manamesh/assets/loader";
```

- [ ] **Step 3: Run One Piece tests (primary oracle for deckResolver)**

```bash
yarn workspace @manamesh/onepiece test
```

Expected: `deckResolver.test.ts` loads (no `Missing "./src/deck/types" specifier`); crypto suite still passes. Fix any missed export by returning to Task 1.

- [ ] **Step 4: Run the other three game packages**

```bash
yarn workspace @manamesh/poker test
yarn workspace @manamesh/timestreams test
yarn workspace @manamesh/mistborn-deckbuilder test
```

Expected: no resolution errors on manamesh imports. Mistborn may still have rules assertion failures until Task 3.

- [ ] **Step 5: Grep gate must be zero in game packages**

```bash
rg -n "from ['\"]@cyotee/manamesh/src/" \
  packages/poker packages/timestreams packages/onepiece packages/mistborn-deckbuilder \
  --glob '**/*.{ts,tsx}'
```

Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add packages/poker packages/timestreams packages/onepiece packages/mistborn-deckbuilder
git commit -m "refactor(games): use stable @cyotee/manamesh subpath imports"
```

---

