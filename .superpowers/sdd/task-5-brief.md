### Task 5: Visibility & proof-chain helpers (adapt from onepiece)

**Files:**
- Create: `packages/timestreams/src/visibility.ts`
- Create: `packages/timestreams/src/proofChain.ts`
- Test: `packages/timestreams/src/visibility.test.ts`
- Test: `packages/timestreams/src/proofChain.test.ts`

**Interfaces:**
- Consumes: `TimestreamsState`, `CardVisibilityState`, `CryptographicProof` from `./types`.
- Produces:
  - `visibility.ts`: `initializeCardVisibility(state, cardIds, initial?)`, `transitionCardVisibility(state, cardId, to, initiatedBy, action, data?)`, `getCardVisibility(state, cardId)`, `isCardVisibleTo(visibility, viewerIsOwner)`, `isValidTransition(from, to)`.
  - `proofChain.ts`: `createProof(action, data, previousProofHash)`, `appendProof(state, proof)`, `getLatestProofHash(state)`, `verifyProofChain(state)`.

Adapt from `packages/onepiece/src/visibility.ts` and `packages/onepiece/src/proofChain.ts` with these exact changes:
1. Replace `OnePieceState` with `TimestreamsState` throughout.
2. Reduce `CardVisibilityState` to `"encrypted" | "owner-known" | "public"`; allowed transitions: `encrypted → owner-known`, `encrypted → public`, `owner-known → public`. Drop `secret`/`opponent-known`/`all-known` branches.
3. Keep `createProof`/`appendProof`/`getLatestProofHash`/`verifyProofChain` signatures identical (they only touch `state.proofChain` and pure hashing).

- [ ] **Step 1: Write the failing tests**

`packages/timestreams/src/visibility.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  initializeCardVisibility, transitionCardVisibility, getCardVisibility,
  isCardVisibleTo, isValidTransition,
} from "./visibility";

function blankState(): any {
  return { cardVisibility: {}, proofChain: [] };
}

describe("visibility state machine", () => {
  it("initializes cards as encrypted", () => {
    const s = blankState();
    initializeCardVisibility(s, ["a", "b"]);
    expect(getCardVisibility(s, "a")).toBe("encrypted");
  });
  it("allows encrypted -> owner-known -> public", () => {
    expect(isValidTransition("encrypted", "owner-known")).toBe(true);
    expect(isValidTransition("owner-known", "public")).toBe(true);
    expect(isValidTransition("public", "encrypted")).toBe(false);
  });
  it("transitions and records visibility", () => {
    const s = blankState();
    initializeCardVisibility(s, ["a"]);
    transitionCardVisibility(s, "a", "owner-known", "0", "draw");
    expect(getCardVisibility(s, "a")).toBe("owner-known");
  });
  it("computes viewer visibility", () => {
    expect(isCardVisibleTo("public", false)).toBe(true);
    expect(isCardVisibleTo("owner-known", true)).toBe(true);
    expect(isCardVisibleTo("owner-known", false)).toBe(false);
    expect(isCardVisibleTo("encrypted", true)).toBe(false);
  });
});
```

`packages/timestreams/src/proofChain.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createProof, appendProof, getLatestProofHash, verifyProofChain } from "./proofChain";

describe("proof chain", () => {
  it("links proofs by previous hash and verifies", () => {
    const s: any = { proofChain: [] };
    const p1 = createProof("draw", { card: "a" }, null);
    appendProof(s, p1);
    const p2 = createProof("play", { card: "b" }, getLatestProofHash(s));
    appendProof(s, p2);
    expect(s.proofChain).toHaveLength(2);
    expect(p2.previousProofHash).toBe(p1.hash);
    expect(verifyProofChain(s).valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @manamesh/timestreams test src/visibility.test.ts src/proofChain.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/visibility.ts` and `src/proofChain.ts`**

Copy the two onepiece files and apply the three adaptation changes above. Ensure `verifyProofChain` returns an object with a `valid: boolean` field (match onepiece's `ProofChainVerification` shape).

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @manamesh/timestreams test src/visibility.test.ts src/proofChain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/visibility.ts packages/timestreams/src/proofChain.ts packages/timestreams/src/visibility.test.ts packages/timestreams/src/proofChain.test.ts
git commit -m "feat(timestreams): visibility state machine and proof chain"
```

---

