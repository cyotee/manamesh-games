import { describe, it, expect } from "vitest";
import { pad, type Hex } from "viem";
import { deriveHandId, type HandInit } from "./handId";

// Canonical vector shared with tests/foundry/lib/HandIdLib_parity.t.sol.
const CANONICAL: HandInit = {
  players: [
    pad("0xaaa", { size: 20 }) as Hex,
    pad("0xbbb", { size: 20 }) as Hex,
  ],
  buyIns: [100_000000000000000000n, 100_000000000000000000n],
  vault: pad("0xccc", { size: 20 }) as Hex,
  smallBlind: 1_000000000000000000n,
  bigBlind: 2_000000000000000000n,
  timeoutSeconds: 300n,
  otherConfig: pad("0x2a", { size: 32 }) as Hex,
  playerHandNonces: [1n, 1n],
};

// Baked from the Foundry parity test (HandIdLib.handIdOf).
const EXPECTED = "0x1a678d2ac546cb070239d0fc94c9234eaa97e58ddfcce1b7c61bc9b371d37fed";

describe("deriveHandId", () => {
  it("matches the Solidity HandIdLib canonical snapshot", () => {
    expect(deriveHandId(CANONICAL)).toBe(EXPECTED);
  });

  it("is deterministic", () => {
    expect(deriveHandId(CANONICAL)).toBe(deriveHandId(CANONICAL));
  });

  it("changes when a buy-in changes", () => {
    const altered: HandInit = { ...CANONICAL, buyIns: [200_000000000000000000n, 100_000000000000000000n] };
    expect(deriveHandId(altered)).not.toBe(EXPECTED);
  });

  it("changes when a player changes", () => {
    const altered: HandInit = { ...CANONICAL, players: [pad("0xdead", { size: 20 }) as Hex, CANONICAL.players[1]] };
    expect(deriveHandId(altered)).not.toBe(EXPECTED);
  });
});
