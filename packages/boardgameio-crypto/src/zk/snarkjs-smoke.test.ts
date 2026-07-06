import { describe, expect, it } from "vitest";

import { verifyGroth16Proof } from "./verify";

describe("zk/snarkjs", () => {
  it("loads verifier wrapper", async () => {
    expect(typeof verifyGroth16Proof).toBe("function");
  });
});
