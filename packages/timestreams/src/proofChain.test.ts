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
