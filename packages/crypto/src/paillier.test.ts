import { describe, expect, it } from "vitest";

import {
  paillierAdd,
  paillierDecrypt,
  paillierEncrypt,
  paillierGenerateKeypair,
  paillierScalarMul,
} from "./paillier";

describe("paillier (demo)", () => {
  it("encrypt/decrypt roundtrip", () => {
    const { publicKey, privateKey } = paillierGenerateKeypair();
    for (const m of [0n, 1n, 2n, 7n, 42n]) {
      const c = paillierEncrypt(publicKey, m);
      const d = paillierDecrypt(publicKey, privateKey, c);
      expect(d).toBe(m);
    }
  });

  it("homomorphic addition", () => {
    const { publicKey, privateKey } = paillierGenerateKeypair();
    const m1 = 5n;
    const m2 = 9n;
    const c1 = paillierEncrypt(publicKey, m1);
    const c2 = paillierEncrypt(publicKey, m2);
    const c = paillierAdd(publicKey, c1, c2);
    const d = paillierDecrypt(publicKey, privateKey, c);
    expect(d).toBe(m1 + m2);
  });

  it("homomorphic scalar multiplication", () => {
    const { publicKey, privateKey } = paillierGenerateKeypair();
    const m = 7n;
    const k = 11n;
    const c = paillierEncrypt(publicKey, m);
    const ck = paillierScalarMul(publicKey, c, k);
    const d = paillierDecrypt(publicKey, privateKey, ck);
    expect(d).toBe(m * k);
  });
});
