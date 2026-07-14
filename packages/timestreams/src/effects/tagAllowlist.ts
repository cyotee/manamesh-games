/**
 * Temporary allowlist for pack tags not yet fully consumed by production code.
 * Gap-closure plan Phase 0.3 — prefer empty.
 *
 * Entries older than removeBy should be treated as CI debt.
 */
export const UNIMPLEMENTED_PACK_TAGS: Array<{
  tagPrefix: string;
  reason: string;
  owner: string;
  removeBy: string;
}> = [
  // Crop Rotation adjacent swap is wired (triggers + submitPlayChoice + board).
];
