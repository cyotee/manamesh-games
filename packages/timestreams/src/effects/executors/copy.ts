/**
 * play:copy — copy another invention's play ability and resolve it as if on this card.
 * Biotechnology: play:copy, copy:play-ability, copy:target:invention, target:scope:today
 */
import { hasTag, tagValue } from "../tags";
import { erasForScope, candidateTargets } from "../targets";
import { done, needs, type Executor } from "../types";
import { getCard } from "../state";
import { resolveNested } from "../nestedResolve";

export const copyExecutor: Executor = ({ G, playerId, card, choices }) => {
  if (!hasTag(card, "play:copy") && !hasTag(card, "copy:play-ability")) {
    return done([]);
  }

  const promptId = `${card.id}:copy-target`;
  let targetId: string | undefined;
  if (choices[promptId] !== undefined) {
    const raw = choices[promptId];
    targetId = Array.isArray(raw) ? raw[0] : raw;
  } else {
    const scope = tagValue(card, "target:scope") ?? tagValue(card, "copy:scope") ?? "today";
    const eras = erasForScope(G, scope, card.id);
    const options = candidateTargets(G, {
      kind: hasTag(card, "copy:target:invention") ? "invention" : "any",
      eras,
      excludeCardId: card.id,
    });
    if (options.length === 0) {
      return done([`${card.id}: copy fizzles (no target)`]);
    }
    return needs({
      id: promptId,
      deciderId: playerId,
      kind: "choose-card",
      options,
      min: 1,
      max: 1,
      reason: "play:copy",
    });
  }

  const target = getCard(G, targetId!);
  if (!target) return done([`${card.id}: copy fizzles (missing target)`]);

  // Synthetic card: this card's id, but target's play-related tags.
  const playTags = (target.tags ?? []).filter(
    (t) =>
      t.startsWith("play:") ||
      t.startsWith("discard:") ||
      t.startsWith("draw:") ||
      t.startsWith("move:") ||
      t.startsWith("swap:") ||
      t.startsWith("attach:") ||
      t.startsWith("recover:") ||
      t.startsWith("prevent:") ||
      t.startsWith("option-") ||
      t.startsWith("target:") ||
      t.startsWith("decider:") ||
      t.startsWith("opponents-draw"),
  );
  // Avoid infinite recursion
  const safeTags = playTags.filter((t) => t !== "play:copy" && t !== "copy:play-ability");

  const synthetic = {
    ...card,
    tags: safeTags,
    hasPlayEffect: true,
  };
  // Temporarily put synthetic over registry for resolvers that look up by id
  if (!G.cards) G.cards = {};
  const prev = G.cards[card.id];
  G.cards[card.id] = synthetic as any;

  // Choices for nested effect use the same map under the source card id keys —
  // pass through remaining choices.
  const nested = resolveNested(G, playerId, card.id, choices);

  if (prev) G.cards[card.id] = prev;
  else delete G.cards[card.id];

  if (nested.prompts.length) {
    // Always label from the *copied* card (not the copier). Nested choice
    // may set labelCardId to the synthetic/copier id — overwrite so UI reads
    // High-powered Laser tags for option-a/b labels.
    const prompts = nested.prompts.map((p) => ({
      ...p,
      labelCardId: target.id,
    }));
    return {
      ok: true,
      prompts,
      log: [`${card.id}: copy ${target.id} needs input`, ...nested.log],
    };
  }
  return done([`${card.id}: copied play ability of ${target.id}`, ...nested.log]);
};
