import { bytesToHex, concatBytes, hexToBytes, sha256 } from "./sha256";

export type MerkleSide = "left" | "right";

export interface MerkleProofStep {
  side: MerkleSide;
  hashHex: string;
}

function hashPair(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concatBytes(left, right));
}

export function merkleRoot(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0) {
    // Conventional empty tree root: SHA-256(empty)
    return sha256(new Uint8Array());
  }

  let level = leaves.slice();
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(hashPair(left, right));
    }
    level = next;
  }
  return level[0];
}

export function merkleRootHex(leaves: Uint8Array[]): string {
  return bytesToHex(merkleRoot(leaves));
}

export function merkleProof(
  leaves: Uint8Array[],
  leafIndex: number,
): MerkleProofStep[] {
  if (leafIndex < 0 || leafIndex >= leaves.length) {
    throw new Error("leafIndex out of range");
  }
  if (leaves.length === 0) return [];

  let index = leafIndex;
  let level = leaves.slice();
  const proof: MerkleProofStep[] = [];

  while (level.length > 1) {
    const isRight = index % 2 === 1;
    const siblingIndex = isRight ? index - 1 : index + 1;
    const sibling =
      siblingIndex < level.length ? level[siblingIndex] : level[index];
    proof.push({
      side: isRight ? "left" : "right",
      hashHex: bytesToHex(sibling),
    });

    // build next level
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(hashPair(left, right));
    }

    level = next;
    index = Math.floor(index / 2);
  }

  return proof;
}

export function verifyMerkleProof(
  leaf: Uint8Array,
  proof: MerkleProofStep[],
  rootHex: string,
): boolean {
  let acc = leaf;
  for (const step of proof) {
    const sibling = hexToBytes(step.hashHex);
    acc =
      step.side === "left" ? hashPair(sibling, acc) : hashPair(acc, sibling);
  }
  return bytesToHex(acc) === rootHex.toLowerCase();
}
