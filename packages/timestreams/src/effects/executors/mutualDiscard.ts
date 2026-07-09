/**
 * mutual-discard:subtype:X — when a card with this tag shares an era with a
 * card of subtype X, discard **both** (this card and one matching peer).
 *
 * Printed Fast Time wording: "If this card and Slow Time ever exist in the
 * same era, discard both cards."
 * - One pair only: Fast Time + **one** Slow Time (not every Slow Time).
 * - Same era only.
 * - Cards live on era.actions (not invention scoring slots).
 * - Mutual both directions when Slow Time is played later onto Fast Time.
 */
import { tagsWithPrefix } from "../tags";
import { done, type Executor } from "../types";
import { getCard } from "../state";
import { discardFromPlay } from "../boardOps";
import { ERA_ORDER, type TimestreamsState } from "../../types";
import { eraAllCardIds } from "../../timeline";

function mutualDiscardSubtypes(card: { tags?: string[] }): string[] {
  return tagsWithPrefix(card as any, "mutual-discard:subtype");
}

/**
 * Resolve all Fast Time / Slow Time style pairs currently on the board.
 * Safe to call after any play that may place a peer into an era.
 */
export function resolveMutualDiscardPairs(
  G: TimestreamsState,
  actorPlayerId: string,
): string[] {
  const log: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const era of ERA_ORDER) {
      const eraState = G.timeline[era];
      if (!eraState) continue;
      const present = eraAllCardIds(eraState);
      for (const cid of [...present]) {
        const c = getCard(G, cid);
        if (!c) continue;
        const targets = mutualDiscardSubtypes(c);
        if (targets.length === 0) continue;

        const peerId = present.find((otherId) => {
          if (otherId === cid) return false;
          const o = getCard(G, otherId);
          if (!o) return false;
          return (o.subtypes ?? []).some((s) => targets.includes(s));
        });
        if (!peerId) continue;

        if (discardFromPlay(G, peerId, actorPlayerId)) {
          log.push(`${cid}: mutual-discard peer ${peerId}`);
        }
        if (discardFromPlay(G, cid, actorPlayerId)) {
          log.push(`${cid}: mutual-discard self`);
        }
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return log;
}

export const mutualDiscardExecutor: Executor = ({ G, playerId, card }) => {
  if (mutualDiscardSubtypes(card).length === 0) return done([]);
  const log = resolveMutualDiscardPairs(G, playerId);
  return done(
    log.length ? log : [`${card.id}: mutual-discard no same-era peer`],
  );
};
