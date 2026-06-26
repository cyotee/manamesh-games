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

  it("detects a tampered hash on the first (and only) proof", () => {
    const s: any = { proofChain: [] };
    const p1 = createProof("draw", { card: "a" }, null);
    appendProof(s, p1);
    // Tamper the first proof's hash field directly.
    // With a single-proof chain the loop (i >= 1) never runs, so without an
    // explicit check at index 0 this tampering goes undetected.
    s.proofChain[0].hash = "deadbeef";
    expect(verifyProofChain(s).valid).toBe(false);
  });
});
