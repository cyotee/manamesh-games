import { describe, it, expect } from "vitest";
import { generateKeyPair } from "../mental-poker/sra";
import {
  createKeychain,
  keychainAdd,
  keychainGet,
  keychainHas,
  keychainSize,
  keychainRemove,
  keychainFromRecord,
  keychainToRecord,
  isValidSecp256k1PublicKey,
  normalizeSecp256k1PublicKey,
  publicKeysEqual,
  privateKeyMatchesPublicKey,
  requirePrivateKeyMatchesPublished,
  publicKeyFingerprint,
  MENTAL_POKER_KEYCHAIN_POLICY,
  PERMISSIVE_KEYCHAIN_POLICY,
  STRICT_KEYCHAIN_POLICY,
} from "./index";

describe("isValidSecp256k1PublicKey / normalize", () => {
  it("accepts keys from generateKeyPair", () => {
    const kp = generateKeyPair();
    expect(isValidSecp256k1PublicKey(kp.publicKey)).toBe(true);
    const n = normalizeSecp256k1PublicKey(kp.publicKey);
    expect(n).not.toBeNull();
    expect(n!.length).toBeGreaterThan(0);
  });

  it("rejects empty, garbage, and infinity", () => {
    expect(isValidSecp256k1PublicKey("")).toBe(false);
    expect(isValidSecp256k1PublicKey("not-a-point")).toBe(false);
    expect(isValidSecp256k1PublicKey("deadbeef")).toBe(false);
    expect(isValidSecp256k1PublicKey("00")).toBe(false);
    expect(isValidSecp256k1PublicKey("0x00")).toBe(false);
  });

  it("publicKeysEqual is true for same point different encoding if normalize works", () => {
    const kp = generateKeyPair();
    const n = normalizeSecp256k1PublicKey(kp.publicKey)!;
    expect(publicKeysEqual(kp.publicKey, n)).toBe(true);
  });

  it("privateKeyMatchesPublicKey for generateKeyPair", () => {
    const kp = generateKeyPair();
    expect(privateKeyMatchesPublicKey(kp.privateKey, kp.publicKey)).toBe(true);
    const other = generateKeyPair();
    expect(privateKeyMatchesPublicKey(kp.privateKey, other.publicKey)).toBe(
      false,
    );
  });

  it("requirePrivateKeyMatchesPublished rejects missing or mismatched keys", () => {
    const kp = generateKeyPair();
    const other = generateKeyPair();
    expect(requirePrivateKeyMatchesPublished(kp.privateKey, kp.publicKey)).toBe(
      true,
    );
    expect(
      requirePrivateKeyMatchesPublished(kp.privateKey, other.publicKey),
    ).toBe(false);
    expect(requirePrivateKeyMatchesPublished(null, kp.publicKey)).toBe(false);
    expect(requirePrivateKeyMatchesPublished(kp.privateKey, null)).toBe(false);
    expect(requirePrivateKeyMatchesPublished("", kp.publicKey)).toBe(false);
  });
});

describe("keychainAdd — MENTAL_POKER / STRICT policy", () => {
  it("admits distinct valid keys for different owners", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    let kc = createKeychain();
    const r0 = keychainAdd(kc, "0", a.publicKey, MENTAL_POKER_KEYCHAIN_POLICY);
    expect(r0.ok).toBe(true);
    if (!r0.ok) return;
    kc = r0.keychain;
    const r1 = keychainAdd(kc, "1", b.publicKey, MENTAL_POKER_KEYCHAIN_POLICY);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(keychainSize(r1.keychain)).toBe(2);
    expect(keychainGet(r1.keychain, "0")?.publicKey).toBe(
      normalizeSecp256k1PublicKey(a.publicKey),
    );
  });

  it("rejects invalid curve material", () => {
    const kc = createKeychain();
    for (const bad of ["", "not-a-point", "deadbeef", "02" + "00".repeat(31)]) {
      const r = keychainAdd(kc, "0", bad, STRICT_KEYCHAIN_POLICY);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(["invalid_curve", "empty_key", "infinity"]).toContain(r.reason);
      expect(keychainSize(r.keychain)).toBe(0);
    }
  });

  it("rejects infinity with reason infinity", () => {
    const r = keychainAdd(createKeychain(), "0", "00", STRICT_KEYCHAIN_POLICY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("infinity");
  });

  it("rejects duplicate id without replace", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    let kc = createKeychain();
    kc = (keychainAdd(kc, "0", a.publicKey) as { ok: true; keychain: typeof kc })
      .keychain;
    const r = keychainAdd(kc, "0", b.publicKey, STRICT_KEYCHAIN_POLICY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("duplicate_id");
    expect(keychainGet(kc, "0")?.publicKey).toBe(
      normalizeSecp256k1PublicKey(a.publicKey),
    );
  });

  it("rejects duplicate public key across owners", () => {
    const a = generateKeyPair();
    let kc = createKeychain();
    kc = (keychainAdd(kc, "0", a.publicKey) as { ok: true; keychain: typeof kc })
      .keychain;
    const r = keychainAdd(kc, "1", a.publicKey, MENTAL_POKER_KEYCHAIN_POLICY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("duplicate_key");
    expect(keychainHas(r.keychain, "1")).toBe(false);
  });

  it("does not mutate input state on failure or success", () => {
    const a = generateKeyPair();
    const kc = createKeychain();
    const before = JSON.stringify(kc);
    keychainAdd(kc, "0", a.publicKey);
    expect(JSON.stringify(kc)).toBe(before);
    keychainAdd(kc, "0", "not-a-point");
    expect(JSON.stringify(kc)).toBe(before);
  });
});

describe("keychainAdd — PERMISSIVE policy", () => {
  it("allows same public key for two owners", () => {
    const a = generateKeyPair();
    let kc = createKeychain();
    const r0 = keychainAdd(kc, "0", a.publicKey, PERMISSIVE_KEYCHAIN_POLICY);
    expect(r0.ok).toBe(true);
    if (!r0.ok) return;
    const r1 = keychainAdd(
      r0.keychain,
      "1",
      a.publicKey,
      PERMISSIVE_KEYCHAIN_POLICY,
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(keychainSize(r1.keychain)).toBe(2);
  });

  it("allows replace for same id", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    let kc = createKeychain();
    kc = (
      keychainAdd(kc, "0", a.publicKey, PERMISSIVE_KEYCHAIN_POLICY) as {
        ok: true;
        keychain: typeof kc;
      }
    ).keychain;
    const r = keychainAdd(kc, "0", b.publicKey, PERMISSIVE_KEYCHAIN_POLICY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.replaced).toBe(true);
    expect(r.entry.publicKey).toBe(normalizeSecp256k1PublicKey(b.publicKey));
  });
});

describe("keychain record helpers", () => {
  it("fromRecord / toRecord / remove", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const kc = keychainFromRecord(
      { "0": a.publicKey, "1": b.publicKey },
      MENTAL_POKER_KEYCHAIN_POLICY,
    );
    expect(keychainSize(kc)).toBe(2);
    const rec = keychainToRecord(kc);
    expect(Object.keys(rec).sort()).toEqual(["0", "1"]);
    const smaller = keychainRemove(kc, "0");
    expect(keychainHas(smaller, "0")).toBe(false);
    expect(keychainHas(kc, "0")).toBe(true); // original intact
  });

  it("fingerprints differ for distinct keys", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const fa = publicKeyFingerprint(a.publicKey)!;
    const fb = publicKeyFingerprint(b.publicKey)!;
    expect(fa).not.toBe(fb);
    expect(fa.length).toBe(64);
  });
});
