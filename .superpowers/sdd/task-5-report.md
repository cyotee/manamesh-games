# Task 5 Report: Visibility State Machine + Proof Chain

## What Was Adapted and How

### `packages/timestreams/src/visibility.ts`
- Copied from `packages/onepiece/src/visibility.ts`.
- **Change 1**: Replaced `OnePieceState` import/usage with `TimestreamsState` from `./types`.
- **Change 2**: Reduced `VALID_TRANSITIONS` map from 6 states to 3 (`encrypted`, `owner-known`, `public`). Allowed transitions: `encrypted→owner-known`, `encrypted→public`, `owner-known→public`. Removed `secret`, `opponent-known`, `all-known` entries entirely.
- **Change 3**: `isCardVisibleTo` switch reduced to 3 cases; removed `secret`, `opponent-known`, `all-known` branches.
- **Change 4**: `CardStateTransition` type is not in `timestreams/src/types.ts`, so defined it locally in `visibility.ts` (same shape as onepiece's version but referencing the 3-state `CardVisibilityState`).
- **Change 5**: Removed `batchTransitionVisibility` (not required by the brief's export list, kept code minimal).
- **Imports**: `CardVisibilityState` and `CryptographicProof` imported from `./types` (already defined there); no redefinition.

### `packages/timestreams/src/proofChain.ts`
- Copied from `packages/onepiece/src/proofChain.ts`.
- **Change 1**: Replaced `OnePieceState` with `Pick<TimestreamsState, "proofChain">` throughout — using a structural pick instead of the full state for flexibility (tests use plain `{ proofChain: [] }` objects typed as `any`).
- **Change 2**: `verifyProofChain` in onepiece took a raw `CryptographicProof[]` array; adapted to take `state: Pick<TimestreamsState, "proofChain">` and delegate to internal `verifyChainArray(state.proofChain)`. This matches the test's call `verifyProofChain(s)` and returns `{ valid: boolean, errors: ProofChainError[] }` (the `ProofChainVerification` shape).
- **Change 3**: All state-consuming helpers (`appendProof`, `getLatestProof`, `getLatestProofHash`, `getProofsForCard`) updated to use `Pick<TimestreamsState, "proofChain">`.
- **Kept identical**: `createProof`, `hashProofData`, `signProof`, `verifyProofHash`, `verifyProofSignature`, `verifyProofSignatures`, all type definitions.
- `CryptographicProof` imported from `./types`; not redefined.

## TDD Evidence

### RED Phase
```
yarn workspace @manamesh/timestreams test src/visibility.test.ts src/proofChain.test.ts

 FAIL  src/proofChain.test.ts [ src/proofChain.test.ts ]
Error: Failed to load url ./proofChain ...

 FAIL  src/visibility.test.ts [ src/visibility.test.ts ]
Error: Failed to load url ./visibility ...

 Test Files  2 failed (2)
      Tests  no tests
```

### GREEN Phase
```
yarn workspace @manamesh/timestreams test src/visibility.test.ts src/proofChain.test.ts

 ✓ src/visibility.test.ts  (4 tests) 20ms
 ✓ src/proofChain.test.ts  (1 test) 26ms

 Test Files  2 passed (2)
      Tests  5 passed (5)
   Duration  3.70s
```

## Files Changed

- `packages/timestreams/src/visibility.ts` — created (170 lines)
- `packages/timestreams/src/proofChain.ts` — created (288 lines)
- `packages/timestreams/src/visibility.test.ts` — created (34 lines, verbatim from brief)
- `packages/timestreams/src/proofChain.test.ts` — created (15 lines, verbatim from brief)

## git show --stat HEAD

```
commit 74cad6d9b6dfad5d873ccab5be7db93101a3771a
Author: cyotee <not_cyotee@proton.me>
Date:   Fri Jun 26 10:09:56 2026 -0700

    feat(timestreams): visibility state machine and proof chain

    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

 packages/timestreams/src/proofChain.test.ts |  15 ++
 packages/timestreams/src/proofChain.ts      | 288 ++++++++++++++++++++++++++++
 packages/timestreams/src/visibility.test.ts |  34 ++++
 packages/timestreams/src/visibility.ts      | 170 ++++++++++++++++
 4 files changed, 507 insertions(+)
```

## Self-Review: Onepiece Deviations

1. **`batchTransitionVisibility` removed**: The brief's export list does not include it, so it was omitted to keep the module lean. Can be added if needed.

2. **`verifyProofChain` signature change**: Onepiece takes a raw array (`chain: CryptographicProof[]`); timestreams takes a state-like object (`{ proofChain: ... }`). This is the most significant behavioral deviation — intentional per the brief (tests call `verifyProofChain(s)` with a state object).

3. **`CardStateTransition` defined locally**: Not present in `timestreams/src/types.ts`. Defined in `visibility.ts` rather than polluting `types.ts` (which is a committed file from Tasks 0-4).

4. **`Pick<TimestreamsState, "proofChain">` instead of full state**: State-consuming functions accept the minimal structural type. This keeps them usable with test stubs (`{ proofChain: [] }`) and avoids coupling to the full `TimestreamsState` shape.

## Concerns

None. All 5 tests pass, commit is clean (4 files only), no unrelated files touched.

---

## Fix: first-proof hash verification

### Bug Summary

`verifyChainArray` in `packages/timestreams/src/proofChain.ts` only verified `hash` integrity for proofs at `i >= 1` (the `for` loop). For a single-proof chain, no loop iterations run, so a tampered `hash` on `chain[0]` was never caught by `verifyProofHash`. The only check on `chain[0]` was that `previousProofHash === null`.

### RED Evidence (new test failing before fix)

Command:
```
yarn workspace @manamesh/timestreams test src/proofChain.test.ts
```

Output:
```
 RUN  v1.6.1 /Users/cyotee/Development/github-cyotee/manamesh-games/packages/timestreams

 ❯ src/proofChain.test.ts  (2 tests | 1 failed) 30ms
   ❯ src/proofChain.test.ts > proof chain > detects a tampered hash on the first (and only) proof
     → expected true to be false // Object.is equality

 FAIL  src/proofChain.test.ts > proof chain > detects a tampered hash on the first (and only) proof
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ src/proofChain.test.ts:24:39
     22|     // explicit check at index 0 this tampering goes undetected.
     23|     s.proofChain[0].hash = "deadbeef";
     24|     expect(verifyProofChain(s).valid).toBe(false);
       |                                       ^
     25|   });
     26| });

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
   Duration  2.38s
```

### GREEN Evidence (all tests passing after fix)

Command:
```
yarn workspace @manamesh/timestreams test src/proofChain.test.ts
```

Output:
```
 RUN  v1.6.1 /Users/cyotee/Development/github-cyotee/manamesh-games/packages/timestreams

 ✓ src/proofChain.test.ts  (2 tests) 19ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  10:17:17
   Duration  2.70s
```

### Diff Summary

`packages/timestreams/src/proofChain.ts` — added 9 lines after the existing `previousProofHash !== null` check in `verifyChainArray`:
```ts
// Verify the first proof's own hash integrity
if (!verifyProofHash(chain[0])) {
  errors.push({
    index: 0,
    transitionId: chain[0].transitionId,
    error: "Invalid proof hash at index 0",
  });
}
```

`packages/timestreams/src/proofChain.test.ts` — added new test "detects a tampered hash on the first (and only) proof": builds a single-proof chain, sets `s.proofChain[0].hash = "deadbeef"`, asserts `verifyProofChain(s).valid === false`.

### git show --stat HEAD

```
commit 5449dfc645360d008bc7242f582efeecd23b0501
Author: cyotee <not_cyotee@proton.me>
Date:   Fri Jun 26 10:17:41 2026 -0700

    fix(timestreams): verify first proof hash in proof chain

    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

 packages/timestreams/src/proofChain.test.ts | 11 +++++++++++
 packages/timestreams/src/proofChain.ts      |  9 +++++++++
 2 files changed, 20 insertions(+)
```
