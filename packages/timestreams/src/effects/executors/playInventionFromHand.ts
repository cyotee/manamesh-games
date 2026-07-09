/**
 * play:play-invention — play an invention from hand (Coronation), then optionally attach.
 * Coronation: play:play-invention, play:attach, attach:to:played-invention
 */
import { hasTag } from "../tags";
import { done, needs, type Executor } from "../types";
import { registerCard } from "../state";
import { attachTo } from "../boardOps";
import { eraForDay, appendToEra } from "../../timeline";
import { ERA_ORDER } from "../../types";
import { transitionCardVisibility } from "../../visibility";
import { resolveNested } from "../nestedResolve";

export const playInventionFromHandExecutor: Executor = ({ G, playerId, card, choices }) => {
  if (!hasTag(card, "play:play-invention")) return done([]);

  const promptId = `${card.id}:play-invention`;
  const player = G.players[playerId];
  if (!player) return done([`${card.id}: no player`]);

  let inventId: string | undefined;
  if (choices[promptId] !== undefined) {
    const raw = choices[promptId];
    inventId = Array.isArray(raw) ? raw[0] : raw;
  } else {
    const options = player.hand
      .filter((c) => c.cardType === "invention" && c.id !== card.id)
      .map((c) => c.id);
    if (options.length === 0) {
      return done([`${card.id}: play-invention fizzles (no invention in hand)`]);
    }
    return needs({
      id: promptId,
      deciderId: playerId,
      kind: "choose-card",
      options,
      min: 1,
      max: 1,
      reason: "play:play-invention",
    });
  }

  const idx = player.hand.findIndex((c) => c.id === inventId);
  if (idx === -1) return done([`${card.id}: invention not in hand`]);
  const [invention] = player.hand.splice(idx, 1);
  registerCard(G, invention);
  const day = Math.min(G.currentDay, ERA_ORDER.length);
  const era = eraForDay(day);
  appendToEra(G.timeline, era, invention.id);
  transitionCardVisibility(G, invention.id, "public", playerId, "playInvention", { era });

  const log = [`${card.id}: played invention ${invention.id} into ${era}`];

  // attach:to:played-invention — host is the invention just played
  if (hasTag(card, "play:attach") || hasTag(card, "attach:to:played-invention")) {
    attachTo(G, card.id, invention.id);
    log.push(`${card.id}: attached to ${invention.id}`);
  }

  // Resolve the invention's own play effect (if any)
  const nested = resolveNested(G, playerId, invention.id, choices);
  if (nested.prompts.length) {
    return {
      ok: true,
      prompts: nested.prompts,
      log: [...log, ...nested.log],
    };
  }
  return done([...log, ...nested.log]);
};
