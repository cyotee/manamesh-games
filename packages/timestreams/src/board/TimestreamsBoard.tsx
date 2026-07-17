/**
 * TimestreamsBoard
 *
 * Interactive board for Timestreams P2P play.
 * Renders the six-era timeline, stacks, scoring slots, day, hand, and controls.
 * Auto-drives mental-poker crypto phases when playMode === "mental-poker".
 */

import React from 'react';
import type { BoardProps } from 'boardgame.io/react';
import type { TimestreamsState, EraId, TimestreamsCard } from '../types';
import { ERA_ORDER, composeCardText, formatCardCaption } from '../types';
import {
  hashSeedCommit,
  peelDecryptShare,
  prepareEncryptionLayer,
  prepareDeckOpReencryptLayer,
  resolveCardIdFromPoint,
} from '../crypto';
import { generateKeyPair } from '@manamesh/boardgameio-crypto/mental-poker';
import { canPlayCard } from '../effects/gates';
import { describeChoiceOption } from '../effects/executors/choice';
import {
  computeScoringSlotsForEra,
  scoringSlotModifierNotes,
  isCardProcessedForUi,
  scorePileInventory,
} from '../scoring';
import { effectiveScoreValue } from '../effects/boardOps';
import { getCard as getLiveCard } from '../effects/state';
import { HandPanel } from './HandPanel';
import {
  canPlayerUseFreeTool,
  canUseFreeTools,
  previewEraCleanup,
  type FreeToolId,
  type EraCleanupMode,
} from '../freeTools';

/**
 * Prompt ids are `${playedCardId}:${suffix}` (card ids never contain ':').
 * Suffixes include attach-host, search-deck, option-a-hand, etc.
 */
export function playedCardIdFromPromptId(promptId: string): string {
  const idx = promptId.indexOf(':');
  return idx >= 0 ? promptId.slice(0, idx) : promptId;
}

const ERA_LABELS: Record<EraId, string> = {
  stone: 'Stone Age',
  medieval: 'Medieval',
  renaissance: 'Renaissance',
  industrial: 'Industrial',
  modern: 'Modern',
  future: 'Future',
};

interface TimestreamsBoardProps extends BoardProps<TimestreamsState> {}

function randomHex(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  // Always lowercase so commit/reveal hashes match
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('').toLowerCase();
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export const TimestreamsBoard: React.FC<TimestreamsBoardProps> = ({
  G,
  ctx,
  moves,
  playerID,
  isActive,
}) => {
  const [teachingMode, setTeachingMode] = React.useState(false);
  const [hoveredCard, setHoveredCard] = React.useState<TimestreamsCard | null>(null);
  /** Selected option id(s) for the active rules prompt (multi-select when max > 1). */
  const [promptSelection, setPromptSelection] = React.useState<string[]>([]);
  /** Accumulated multi-step prompt answers for the current effect chain. */
  const [promptAnswers, setPromptAnswers] = React.useState<
    Record<string, string | string[]>
  >({});
  const [cryptoStatus, setCryptoStatus] = React.useState<string | null>(null);
  const setupAttemptRef = React.useRef<Set<string>>(new Set());
  /** peelKey → last attempt ms (allow retries; boardgame INVALID_MOVE does not throw). */
  const peelAttemptAtRef = React.useRef<Map<string, number>>(new Map());
  const keyPairRef = React.useRef<{ publicKey: string; privateKey: string } | null>(null);
  const shuffleSeedRef = React.useRef<string | null>(null);
  const deckOpSeedRef = React.useRef<string | null>(null);
  const encryptBusyRef = React.useRef(false);
  const deckOpBusyRef = React.useRef(false);
  /** Latest G for decrypt peels scheduled via setTimeout (avoid stale closure). */
  const latestGRef = React.useRef(G);
  latestGRef.current = G;

  const currentPlayer = ctx.currentPlayer;
  const isMyTurn = currentPlayer === playerID;
  const activeEraIndex = Math.max(0, Math.min((G.currentDay || 1) - 1, ERA_ORDER.length - 1));
  const activeEra = ERA_ORDER[activeEraIndex];
  const myPlayer = playerID ? G.players[playerID] : undefined;
  const myHand = myPlayer?.hand ?? [];
  const myDiscard = myPlayer?.discard ?? [];
  /** null = auto (open when rules-off + non-empty); boolean = user toggle. */
  const [discardOpenPref, setDiscardOpenPref] = React.useState<boolean | null>(
    null,
  );

  // Playwright / e2e harness: window.__tsE2E on the primary seat (P0) when debugSeed.
  // Use latestGRef so getters stay live across concurrent moves without waiting for effect deps.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!G.config?.debugSeed || playerID !== '0') return;
    const readG = () => latestGRef.current;
    (window as any).__tsE2E = {
      playerID,
      get phase() {
        return readG().phase;
      },
      ctxPhase: ctx.phase,
      rulesEnabled: G.config?.rulesEnabled !== false,
      seed: (args: any) => moves?.debugSeedBoard?.(args),
      freeTool: (toolId: string, args: any = {}) => moves?.freeTool?.(toolId, args),
      setRulesEnabled: (enabled: boolean) => moves?.setRulesEnabled?.(enabled),
      playInvention: (cardId: string, choices?: any) =>
        moves?.playInvention?.(cardId, choices),
      playAction: (cardId: string, choices?: any) =>
        moves?.playAction?.(cardId, choices),
      pass: () => moves?.pass?.(),
      submitScoreChoice: (id: string, value: any) =>
        moves?.submitScoreChoice?.(id, value),
      ackScoreStep: () => moves?.ackScoreStep?.(),
      submitReact: (id: string, value: any) => moves?.submitReact?.(id, value),
      submitPlayChoice: (id: string, value: any) =>
        moves?.submitPlayChoice?.(id, value),
      /** Multi-seat / scoring driver (forceScoring, ackAll, scoreChoice as P1, …). */
      debugAct: (act: any) => moves?.debugE2EAct?.(act),
      getG: () => readG(),
      getStack: (era: string) => readG().timeline?.[era as EraId]?.stack ?? [],
      getHand: (pid: string) =>
        readG().players?.[pid]?.hand?.map((c) => c.id) ?? [],
      getDiscard: (pid: string) =>
        readG().players?.[pid]?.discard?.map((c) => c.id) ?? [],
      getScorePile: (pid: string) =>
        readG().players?.[pid]?.scorePile?.map((c) => c.id) ?? [],
      getScores: () => readG().scores ?? {},
      getBonusPoints: () => readG().bonusPoints ?? {},
      getBonusLedger: () => readG().bonusLedger ?? [],
      getScoringWalk: () => {
        const w = readG().scoringWalk;
        return w
          ? {
              stepPhase: w.stepPhase,
              currentCardId: w.currentCardId,
              acks: w.acks,
              stepIndex: w.stepIndex,
              stepsLen: w.steps?.length ?? 0,
            }
          : null;
      },
      getPrompts: () => readG().pendingPrompts ?? [],
      getAttachments: () => readG().attachments ?? {},
      getPhase: () => readG().phase,
    };
    // Do not delete __tsE2E on every G change — only when this seat unmounts.
    // Deleting mid-update races Playwright getters (forceScoring / getPhase).
    return () => {
      /* keep window.__tsE2E until seat unmounts (empty deps cleanup below) */
    };
  }, [G, ctx.phase, moves, playerID]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (playerID !== "0") return;
    return () => {
      if ((window as any).__tsE2E?.playerID === "0") {
        delete (window as any).__tsE2E;
      }
    };
  }, [playerID]);
  /** Free-tool multi-select (rules-off). */
  const [freeSelected, setFreeSelected] = React.useState<string[]>([]);
  const [freeEraTarget, setFreeEraTarget] = React.useState<EraId>('stone');
  const [cleanupMode, setCleanupMode] = React.useState<EraCleanupMode>('outside-capacity');
  const [cleanupPreviewOpen, setCleanupPreviewOpen] = React.useState(false);
  const rulesOff = canUseFreeTools(G);
  const freeToolsAllowed =
    rulesOff &&
    !!playerID &&
    canPlayerUseFreeTool(G, playerID, currentPlayer);
  // Rules-off: expand discard by default so → Hand is visible without a click.
  const discardOpen =
    discardOpenPref !== null
      ? discardOpenPref
      : rulesOff && myDiscard.length > 0;
  const pendingPrompts = (G as any).pendingPrompts ?? [];
  const activePrompt = pendingPrompts[0] as
    | {
        id: string;
        deciderId: string;
        kind: string;
        options: string[];
        min: number;
        max: number;
        reason: string;
        /** Copied ability source (Biotechnology → High-powered Laser tags). */
        labelCardId?: string;
      }
    | undefined;
  // Coerce both sides — playerIDs and engine deciderIds must match as strings.
  const isMyPrompt =
    !!activePrompt &&
    playerID != null &&
    String(activePrompt.deciderId) === String(playerID);
  const promptMin = activePrompt?.min ?? 1;
  const promptMax = activePrompt?.max ?? 1;
  const isMultiSelectPrompt = promptMax > 1;
  /** Valid pick count: empty only if min=0; for pair prompts require 0 or full max (not 1). */
  const selectionReady = (() => {
    const n = promptSelection.length;
    if (n > promptMax) return false;
    if (n === 0) return promptMin === 0;
    if (promptMax > 1 && n < promptMax && (promptMin === 0 || promptMin === promptMax)) {
      return false; // e.g. Shell Game / VR: must pick both, not one
    }
    return n >= promptMin;
  })();
  const isSetupPhase = G.phase === 'setup' || ctx.phase === 'setup';
  const isCryptoPhase = ['keyExchange', 'encrypt', 'shuffle'].includes(G.phase) ||
    ['keyExchange', 'encrypt', 'shuffle'].includes(ctx.phase || '');
  const isPlayPhase = G.phase === 'play' || ctx.phase === 'play';

  // Clear local selection when the server prompt changes; reset answer chain when prompts clear.
  React.useEffect(() => {
    setPromptSelection([]);
    if (!activePrompt) {
      setPromptAnswers({});
    }
  }, [activePrompt?.id, activePrompt?.options?.join('|'), !activePrompt]);

  // Off-turn chooser (Surgical Strike target-owner, etc.): keep the amber panel
  // in view even if the dual-seat board is long / scrolled to timeline.
  React.useEffect(() => {
    if (!isMyPrompt || !activePrompt) return;
    const id = window.setTimeout(() => {
      const el = document.querySelector(
        '[data-testid="rules-prompt"]',
      ) as HTMLElement | null;
      el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }, 50);
    return () => window.clearTimeout(id);
  }, [isMyPrompt, activePrompt?.id]);

  const togglePromptOption = (optId: string) => {
    if (!isMultiSelectPrompt) {
      setPromptSelection([optId]);
      return;
    }
    setPromptSelection((prev) => {
      if (prev.includes(optId)) return prev.filter((id) => id !== optId);
      if (prev.length >= promptMax) {
        // At capacity: drop the oldest pick and append the new one.
        return [...prev.slice(1), optId];
      }
      return [...prev, optId];
    });
  };

  // Prefer the more advanced of G.phase / ctx.phase (they can desync briefly).
  const effectivePhase = React.useMemo(() => {
    const order = [
      'setup',
      'keyExchange',
      'encrypt',
      'shuffle',
      'play',
      'scoring',
      'gameOver',
    ];
    const g = G.phase || '';
    const c = (ctx.phase as string) || '';
    const gi = order.indexOf(g);
    const ci = order.indexOf(c);
    if (gi < 0 && ci < 0) return g || c || '';
    if (gi < 0) return c;
    if (ci < 0) return g;
    return order[Math.max(gi, ci)];
  }, [G.phase, ctx.phase]);
  const isCryptoSetupPhase = ['keyExchange', 'encrypt', 'shuffle'].includes(effectivePhase);

  // ---- Mental-poker auto-driver (setup + automatic decrypt peels) ----
  React.useEffect(() => {
    if (!playerID || !moves) return;
    if (G.config?.playMode !== 'mental-poker') return;

    const phase = effectivePhase;
    const me = G.players[playerID];
    if (!me) return;

    const getKeys = () => {
      if (!keyPairRef.current) {
        try {
          keyPairRef.current = generateKeyPair();
        } catch (err) {
          console.error('[TimestreamsBoard] generateKeyPair failed', err);
          setCryptoStatus(`Keygen failed: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      }
      return keyPairRef.current;
    };

    const getShuffleSeed = () => {
      if (!shuffleSeedRef.current) shuffleSeedRef.current = randomHex(32);
      return shuffleSeedRef.current;
    };

    const setupPlayer = G.playerOrder?.[G.setupPlayerIndex ?? 0];
    const isMySetupTurn = setupPlayer === playerID;
    const rngPhase = G.shuffleRng?.phase ?? 'commit';
    const actionKey = `${phase}:${playerID}:${G.setupPlayerIndex}:${rngPhase}`;

    // --- key exchange (all players concurrent; retry until acknowledged) ---
    if (phase === 'keyExchange') {
      const missing = (G.playerOrder || []).filter((pid) => !G.players[pid]?.publicKey);
      if (me.publicKey) {
        setCryptoStatus(
          missing.length
            ? `Key submitted (you=P${playerID}) — waiting for P${missing.join(', P')}…`
            : 'All keys in — advancing…',
        );
        return;
      }
      if (!moves?.submitPublicKey) {
        setCryptoStatus(`Waiting for keyExchange moves… (you=P${playerID})`);
        return;
      }
      // Throttle retries. Dual-seat races need ignoreStaleStateID (game.ts CONCURRENT).
      const retryKey = `key-retry:${playerID}`;
      const last = setupAttemptRef.current as Set<string> & { _ts?: Record<string, number> };
      if (!last._ts) last._ts = {};
      const now = Date.now();
      if (last._ts[retryKey] && now - last._ts[retryKey] < 500) return;
      last._ts[retryKey] = now;

      const activeHint =
        isActive === false
          ? ` (seat inactive — activePlayers=${JSON.stringify(ctx.activePlayers)}; current=${ctx.currentPlayer})`
          : '';
      setCryptoStatus(`Exchanging keys… (you=P${playerID}, submitting)${activeHint}`);
      const kp = getKeys();
      if (!kp?.publicKey) {
        setCryptoStatus(`Keygen produced no publicKey (you=P${playerID})`);
        return;
      }
      // Fire immediately + short delayed retry (covers connect/sync lag).
      try {
        moves.submitPublicKey(kp.publicKey);
      } catch (err) {
        console.error('[TimestreamsBoard] submitPublicKey failed', err);
        setCryptoStatus(`submitPublicKey error: ${err instanceof Error ? err.message : String(err)}`);
      }
      setTimeout(() => {
        try {
          moves.submitPublicKey?.(kp.publicKey);
        } catch {
          /* ignore */
        }
      }, 200);
      setTimeout(() => {
        try {
          moves.submitPublicKey?.(kp.publicKey);
        } catch {
          /* ignore */
        }
      }, 1000);
      return;
    }

    // --- encrypt (sequential) — client-side layer then submit ---
    if (
      phase === 'encrypt' &&
      !me.hasEncrypted &&
      isMySetupTurn &&
      moves.encryptDeck &&
      !encryptBusyRef.current
    ) {
      if (setupAttemptRef.current.has(actionKey)) return;
      setupAttemptRef.current.add(actionKey);
      encryptBusyRef.current = true;
      setCryptoStatus(`Encrypting decks (P${playerID})…`);
      const kp = getKeys();
      if (!kp) {
        encryptBusyRef.current = false;
        setupAttemptRef.current.delete(actionKey);
        return;
      }
      // Yield so React can paint status, then encrypt on this client.
      void (async () => {
        try {
          await yieldToMain();
          // sk stays local: bind + encrypt here, submit ciphertexts only.
          const preEncrypted = prepareEncryptionLayer(
            G,
            playerID!,
            kp.privateKey,
          );
          await yieldToMain();
          // First arg null = no private key on the multiplayer wire.
          moves.encryptDeck(null, preEncrypted);
        } catch (err) {
          console.error('[TimestreamsBoard] encrypt failed', err);
          setupAttemptRef.current.delete(actionKey);
        } finally {
          encryptBusyRef.current = false;
        }
      })();
      return;
    }

    // Waiting for another player to encrypt
    if (phase === 'encrypt' && !isMySetupTurn) {
      setCryptoStatus(`Waiting for P${setupPlayer} to encrypt…`);
    }

    // --- shuffle: commit/reveal concurrent; permute sequential ---
    if (phase === 'shuffle' && me) {
      const rng = G.shuffleRng;

      if (
        moves.commitShuffleSeed &&
        (!rng || rng.phase === 'commit') &&
        !rng?.commits?.[playerID]
      ) {
        const k = `${actionKey}:commit`;
        if (setupAttemptRef.current.has(k)) return;
        setupAttemptRef.current.add(k);
        setCryptoStatus('Committing shuffle seed…');
        const seed = getShuffleSeed();
        const commit = hashSeedCommit(seed);
        setTimeout(() => {
          try {
            moves.commitShuffleSeed(commit);
          } catch (err) {
            console.error('[TimestreamsBoard] commitShuffleSeed failed', err);
            setupAttemptRef.current.delete(k);
          }
        }, 30);
        return;
      }

      if (
        moves.revealShuffleSeed &&
        rng?.phase === 'reveal' &&
        !rng?.reveals?.[playerID]
      ) {
        const k = `${actionKey}:reveal`;
        if (setupAttemptRef.current.has(k)) return;
        setupAttemptRef.current.add(k);
        setCryptoStatus('Revealing shuffle seed…');
        const seed = getShuffleSeed();
        setTimeout(() => {
          try {
            moves.revealShuffleSeed(seed);
          } catch (err) {
            console.error('[TimestreamsBoard] revealShuffleSeed failed', err);
            setupAttemptRef.current.delete(k);
          }
        }, 30);
        return;
      }

      if (
        moves.shuffleEncryptedDeck &&
        rng?.finalSeedHex &&
        !me.hasShuffled &&
        isMySetupTurn
      ) {
        const k = `${actionKey}:shuffle`;
        if (setupAttemptRef.current.has(k)) return;
        setupAttemptRef.current.add(k);
        setCryptoStatus(`Shuffling decks (P${playerID})…`);
        setTimeout(() => {
          try {
            moves.shuffleEncryptedDeck();
          } catch (err) {
            console.error('[TimestreamsBoard] shuffleEncryptedDeck failed', err);
            setupAttemptRef.current.delete(k);
          }
        }, 30);
        return;
      }

      if (rng?.finalSeedHex && !isMySetupTurn && !me.hasShuffled) {
        setCryptoStatus(`Waiting for P${setupPlayer} to shuffle…`);
      } else if (rng?.phase === 'reveal' && !rng.finalSeedHex) {
        setCryptoStatus('Waiting for all shuffle reveals…');
      }
    }

    // --- Automatic cooperative decrypt during play (draws + deck search + peek) ---
    if ((phase === 'play' || phase === 'scoring') && moves.submitDecryptionShare) {
      if (isCryptoSetupPhase) {
        /* keep setup status */
      } else if (G.activeDeckOp?.phase === 'decrypt') {
        setCryptoStatus(
          G.activeDeckOp.statusMessage ||
            `Decrypting… ${G.activeDeckOp.decryptDone}/${G.activeDeckOp.decryptTotal}`,
        );
      } else if (!G.activeDeckOp) {
        setCryptoStatus(null);
      }
      const pending = (G.pendingDecryptRequests ?? []).filter((r) => !r.materialized);
      const now = Date.now();
      for (const req of pending) {
        const layerIdx = req.currentLayer ?? 0;
        const next = req.requiredLayers[layerIdx];
        if (next !== playerID) continue;

        const liveCard =
          latestGRef.current.encryptedDecks?.[req.deckOwnerId]?.[req.cardIndex];

        // Already plain — any required seat can finish materialize.
        if (liveCard && (liveCard.layers ?? 0) === 0) {
          const plainKey = `plain-mat:${req.id}:${layerIdx}:${playerID}`;
          const lastPlain = peelAttemptAtRef.current.get(plainKey) ?? 0;
          if (now - lastPlain < 400) continue;
          peelAttemptAtRef.current.set(plainKey, now);
          const cardSnap = { ...liveCard };
          setTimeout(() => {
            try {
              moves.submitDecryptionShare?.(req.id, cardSnap);
            } catch (err) {
              console.error(
                '[TimestreamsBoard] plain decrypt materialize failed',
                err,
              );
              peelAttemptAtRef.current.delete(plainKey);
            }
          }, 10);
          break;
        }

        if (!liveCard || (liveCard.layers ?? 0) === 0) continue;

        // Throttle peels; always re-read card at fire time so we peel after
        // the previous seat's layer landed (stale closure was a common stall).
        const peelKey = `peel:${req.id}:${layerIdx}:${playerID}`;
        const lastPeel = peelAttemptAtRef.current.get(peelKey) ?? 0;
        if (now - lastPeel < 350) continue;
        peelAttemptAtRef.current.set(peelKey, now);

        const kp = getKeys();
        if (!kp) {
          peelAttemptAtRef.current.delete(peelKey);
          setCryptoStatus('Waiting for local keys to peel decrypt layer…');
          continue;
        }

        const reqId = req.id;
        const ownerId = req.deckOwnerId;
        const idx = req.cardIndex;
        setTimeout(() => {
          try {
            const latest =
              latestGRef.current.encryptedDecks?.[ownerId]?.[idx];
            if (!latest) {
              peelAttemptAtRef.current.delete(peelKey);
              return;
            }
            if ((latest.layers ?? 0) === 0) {
              moves.submitDecryptionShare?.(reqId, latest);
              return;
            }
            const share = peelDecryptShare(latest, kp.privateKey);
            moves.submitDecryptionShare?.(reqId, share);
          } catch (err) {
            console.error('[TimestreamsBoard] decrypt peel failed', err);
            peelAttemptAtRef.current.delete(peelKey);
            setCryptoStatus(
              `Decrypt peel failed — retrying… ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }, 15);
        break;
      }
    }

    // --- Mid-game deck op: fair reshuffle commit/reveal + re-encrypt ---
    const op = G.activeDeckOp;
    if (phase === 'play' && op && playerID) {
      if (op.phase === 'decrypt') {
        setCryptoStatus(op.statusMessage || `Decrypting deck… ${op.decryptDone}/${op.decryptTotal}`);
      } else if (op.phase === 'choose') {
        setCryptoStatus(op.statusMessage || 'Choose a card from your deck');
      } else if (op.phase === 'reshuffle-commit' && moves.commitDeckOpSeed) {
        setCryptoStatus(op.statusMessage || 'Fair reshuffle — committing…');
        if (!op.shuffleCommits?.[playerID] && !deckOpBusyRef.current) {
          const k = `deckop-commit:${op.id}:${playerID}`;
          if (!setupAttemptRef.current.has(k)) {
            setupAttemptRef.current.add(k);
            deckOpBusyRef.current = true;
            if (!deckOpSeedRef.current) deckOpSeedRef.current = randomHex(32);
            const seed = deckOpSeedRef.current;
            const commit = hashSeedCommit(seed);
            setTimeout(() => {
              try {
                moves.commitDeckOpSeed(commit);
              } catch (err) {
                console.error('[TimestreamsBoard] commitDeckOpSeed failed', err);
                setupAttemptRef.current.delete(k);
              } finally {
                deckOpBusyRef.current = false;
              }
            }, 30);
          }
        }
      } else if (op.phase === 'reshuffle-reveal' && moves.revealDeckOpSeed) {
        setCryptoStatus(op.statusMessage || 'Fair reshuffle — revealing…');
        if (!op.shuffleReveals?.[playerID] && !deckOpBusyRef.current) {
          const k = `deckop-reveal:${op.id}:${playerID}`;
          if (!setupAttemptRef.current.has(k)) {
            setupAttemptRef.current.add(k);
            deckOpBusyRef.current = true;
            const seed = deckOpSeedRef.current || randomHex(32);
            deckOpSeedRef.current = seed;
            setTimeout(() => {
              try {
                moves.revealDeckOpSeed(seed);
              } catch (err) {
                console.error('[TimestreamsBoard] revealDeckOpSeed failed', err);
                setupAttemptRef.current.delete(k);
              } finally {
                deckOpBusyRef.current = false;
              }
            }, 30);
          }
        }
      } else if (op.phase === 'reencrypt' && moves.submitDeckOpReencrypt) {
        const expected = G.playerOrder[op.reencryptPlayerIndex];
        setCryptoStatus(op.statusMessage || `Re-encrypting… P${expected}`);
        if (expected === playerID && !deckOpBusyRef.current) {
          const k = `deckop-reenc:${op.id}:${op.reencryptPlayerIndex}:${playerID}`;
          if (!setupAttemptRef.current.has(k)) {
            setupAttemptRef.current.add(k);
            deckOpBusyRef.current = true;
            const kp = getKeys();
            void (async () => {
              try {
                await yieldToMain();
                if (!kp) throw new Error('no keys');
                // sk stays local; move carries only preEncrypted layer.
                const layer = prepareDeckOpReencryptLayer(
                  G,
                  playerID!,
                  kp.privateKey,
                );
                await yieldToMain();
                moves.submitDeckOpReencrypt(null, layer);
              } catch (err) {
                console.error('[TimestreamsBoard] reencrypt failed', err);
                setupAttemptRef.current.delete(k);
              } finally {
                deckOpBusyRef.current = false;
              }
            })();
          }
        }
      }
    }
  }, [
    effectivePhase,
    G.phase,
    ctx.phase,
    G.setupPlayerIndex,
    G.shuffleRng,
    G.players,
    G.playerOrder,
    G.config?.playMode,
    G.pendingDecryptRequests,
    // Re-run when layer progress changes (partial peels).
    G.pendingDecryptRequests?.map(
      (r) => `${r.id}:${r.currentLayer}:${r.materialized}`,
    ).join('|'),
    G.encryptedDecks,
    G.activeDeckOp,
    G.activeDeckOp?.decryptDone,
    G.activeDeckOp?.phase,
    playerID,
    moves,
    isCryptoSetupPhase,
    isActive,
    ctx.activePlayers,
    ctx.currentPlayer,
  ]);

  // Kick stalled peels every 800ms while a cooperative decrypt is waiting on us.
  React.useEffect(() => {
    if (!playerID || !moves?.submitDecryptionShare) return;
    if (G.config?.playMode !== 'mental-poker') return;
    const pending = (G.pendingDecryptRequests ?? []).filter((r) => !r.materialized);
    const waitingOnMe = pending.some(
      (r) => r.requiredLayers[r.currentLayer] === playerID,
    );
    if (!waitingOnMe && G.activeDeckOp?.phase !== 'decrypt') return;
    const t = window.setInterval(() => {
      // Force the main auto-driver deps by clearing throttle for our peels
      // older than 300ms so the next render cycle can fire again.
      const now = Date.now();
      for (const [k, at] of peelAttemptAtRef.current) {
        if (now - at > 300 && (k.startsWith('peel:') || k.startsWith('plain-mat:'))) {
          peelAttemptAtRef.current.delete(k);
        }
      }
      // Touch a tiny state-less path: re-run by updating crypto status when stuck
      const req = (latestGRef.current.pendingDecryptRequests ?? []).find(
        (r) =>
          !r.materialized &&
          r.requiredLayers[r.currentLayer] === playerID,
      );
      if (!req) return;
      const card =
        latestGRef.current.encryptedDecks?.[req.deckOwnerId]?.[req.cardIndex];
      if (!card) return;
      const kp = keyPairRef.current;
      if (!kp && (card.layers ?? 0) > 0) return;
      try {
        if ((card.layers ?? 0) === 0) {
          moves.submitDecryptionShare?.(req.id, card);
        } else if (kp) {
          const share = peelDecryptShare(card, kp.privateKey);
          moves.submitDecryptionShare?.(req.id, share);
        }
      } catch (err) {
        console.error('[TimestreamsBoard] peel kick failed', err);
      }
    }, 800);
    return () => window.clearInterval(t);
  }, [
    playerID,
    moves,
    G.config?.playMode,
    G.pendingDecryptRequests,
    G.activeDeckOp?.phase,
    G.activeDeckOp?.decryptDone,
  ]);

  const showHand = teachingMode || myHand.length > 0 || isPlayPhase;

  const handleCardHover = (card: TimestreamsCard | null) => {
    setHoveredCard(card);
  };

  const deckOpBlocking =
    !!G.activeDeckOp &&
    (G.activeDeckOp.phase === 'decrypt' ||
      G.activeDeckOp.phase === 'choose' ||
      G.activeDeckOp.phase === 'reshuffle-commit' ||
      G.activeDeckOp.phase === 'reshuffle-reveal' ||
      G.activeDeckOp.phase === 'reencrypt');

  const handlePlayInvention = (cardId: string) => {
    // Block new plays while a rules prompt or cooperative decrypt is open.
    if (activePrompt) return;
    if (deckOpBlocking) return;
    if (isMyTurn && moves.playInvention) moves.playInvention(cardId);
  };

  const handlePlayAction = (cardId: string) => {
    if (activePrompt) return;
    if (deckOpBlocking) return;
    if (isMyTurn && moves.playAction) moves.playAction(cardId);
  };

  const handlePass = () => {
    if (deckOpBlocking) return;
    if (isMyTurn && moves.pass && !activePrompt) moves.pass();
  };

  const toggleFreeSelect = (cardId: string) => {
    if (!rulesOff) return;
    setFreeSelected((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId],
    );
  };

  const runFreeTool = (toolId: FreeToolId, args: Record<string, unknown> = {}) => {
    if (!moves?.freeTool || !freeToolsAllowed) return;
    moves.freeTool(toolId, args);
    setFreeSelected([]);
  };

  const primarySelected = freeSelected[0];
  const secondSelected = freeSelected[1];

  const isScorePhasePrompt =
    G.phase === 'scoring' ||
    ctx.phase === 'scoring' ||
    activePrompt?.reason === 'score:guess' ||
    activePrompt?.reason === 'score:guess-secret' ||
    activePrompt?.reason === 'score:choice' ||
    activePrompt?.reason === 'score:swap' ||
    activePrompt?.reason === 'score:perform-other' ||
    activePrompt?.reason === 'score:steal-perform' ||
    activePrompt?.reason === 'score:bonus-copy' ||
    activePrompt?.reason === 'score:penalty-target' ||
    activePrompt?.reason === 'score:move-optional' ||
    activePrompt?.reason === 'score:move-target' ||
    activePrompt?.reason === 'score:move-era' ||
    activePrompt?.kind === 'choose-number' ||
    (activePrompt?.id?.includes(':score-') ?? false);

  /** Re-submit the played card with answers for the current rules prompt. */
  const handleConfirmPrompt = () => {
    if (!activePrompt || !isMyPrompt || !selectionReady) return;

    // Single-select: string; multi-select (Shell Game / score:swap): string[]
    // Optional multi with empty selection → [] (decline).
    const choiceValue: string | string[] =
      promptMax <= 1
        ? (promptSelection[0] ?? '')
        : promptSelection;

    // Score-phase prompts use submitScoreChoice (not re-play).
    if (isScorePhasePrompt && moves.submitScoreChoice) {
      moves.submitScoreChoice(activePrompt.id, choiceValue);
      setPromptSelection([]);
      return;
    }

    // Hand reacts (Herbalism): concurrent submitReact — not re-play of the Action.
    if (
      (activePrompt.reason === 'react:from:hand' ||
        activePrompt.id?.endsWith(':use-react')) &&
      moves.submitReact
    ) {
      moves.submitReact(activePrompt.id, choiceValue);
      setPromptSelection([]);
      return;
    }

    // Off-turn + any pending play-effect answer (Surgical Strike target-owner,
    // Thought Police redirect, Diplomacy, etc.). Always prefer submitPlayChoice
    // so non-current seats can resolve prompts without re-playing the card.
    if (
      moves.submitPlayChoice &&
      G.pendingPlayEffect &&
      playerID != null &&
      String(activePrompt.deciderId) === String(playerID)
    ) {
      moves.submitPlayChoice(activePrompt.id, choiceValue);
      setPromptSelection([]);
      setPromptAnswers((prev) => ({
        ...prev,
        [activePrompt.id]: choiceValue,
      }));
      return;
    }
    // Still the decider for a play prompt but pendingPlayEffect missing (edge):
    // try submitPlayChoice alone so we never silently fall through to playAction
    // which only the current player can call.
    if (
      moves.submitPlayChoice &&
      playerID != null &&
      String(activePrompt.deciderId) === String(playerID) &&
      (G.phase === 'play' || ctx.phase === 'play') &&
      !isScorePhasePrompt
    ) {
      moves.submitPlayChoice(activePrompt.id, choiceValue);
      setPromptSelection([]);
      setPromptAnswers((prev) => ({
        ...prev,
        [activePrompt.id]: choiceValue,
      }));
      return;
    }

    // Redirect without pendingPlayEffect (edge)
    if (
      (activePrompt.reason === 'redirect:optional' ||
        activePrompt.id?.endsWith(':redirect-choice')) &&
      moves.submitPlayChoice
    ) {
      moves.submitPlayChoice(activePrompt.id, choiceValue);
      setPromptSelection([]);
      return;
    }

    const playedCardId = playedCardIdFromPromptId(activePrompt.id);

    const choices: Record<string, string | string[]> = {
      ...promptAnswers,
      [activePrompt.id]: choiceValue,
    };
    setPromptAnswers(choices);

    const card = G.cards?.[playedCardId];
    const isAction =
      card?.cardType === 'action' ||
      activePrompt.reason === 'play:search-deck' ||
      activePrompt.reason === 'play:attach' ||
      activePrompt.reason?.startsWith('peek:') ||
      activePrompt.reason === 'target:choose:opponent' ||
      activePrompt.reason === 'discard:opponent-deck-card' ||
      activePrompt.reason === 'play:play-invention' ||
      activePrompt.reason === 'play:swap' ||
      activePrompt.reason?.startsWith('swap:') ||
      activePrompt.reason === 'play:recover';
    // Fallback only when pendingPlayEffect is missing (should be rare).
    if (isAction && moves.playAction) {
      moves.playAction(playedCardId, choices);
    } else if (moves.playInvention) {
      moves.playInvention(playedCardId, choices);
    } else if (moves.playAction) {
      moves.playAction(playedCardId, choices);
    }
    setPromptSelection([]);
  };

  const statusColor = isSetupPhase
    ? '#eab308'
    : isCryptoPhase
      ? '#38bdf8'
      : isMyTurn
        ? '#22c55e'
        : '#94a3b8';

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '10px',
        background: '#0f172a',
        color: '#e2e8f0',
        minHeight: '100vh',
        // Prevent browser scroll-anchoring from yanking the viewport when
        // status banners / logs reflow during re-renders.
        overflowAnchor: 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: '0 0 10px' }}>
          Timestreams — Day {G.currentDay || 1} (Active: {ERA_LABELS[activeEra]})
        </h2>
        <div style={{ fontSize: 12, color: statusColor, fontWeight: 600 }}>
          You: P{playerID} · Phase: {G.phase}/{ctx.phase} · Turn: P{currentPlayer}
          {isMyTurn && isPlayPhase ? ' · YOUR TURN' : ''}
          {myPlayer?.homeEra ? ` · Home: ${ERA_LABELS[myPlayer.homeEra as EraId] || myPlayer.homeEra}` : ''}
        </div>
      </div>

      {/* Crypto setup + mid-game deck-op progress (non-modal) */}
      {(isCryptoSetupPhase || G.activeDeckOp) && (
        <div
          data-testid={G.activeDeckOp ? 'deck-op-progress' : 'crypto-setup-banner'}
          style={{
            marginBottom: 10,
            padding: '10px 12px',
            borderRadius: 6,
            border: '1px solid #38bdf8',
            background: '#0c4a6e',
            color: '#e0f2fe',
            fontSize: 13,
          }}
        >
          <strong>
            {G.activeDeckOp
              ? G.activeDeckOp.phase === 'decrypt'
                ? 'Deck search — decrypting'
                : G.activeDeckOp.phase.startsWith('reshuffle')
                  ? 'Deck reshuffle'
                  : G.activeDeckOp.phase === 'reencrypt'
                    ? 'Re-encrypting deck'
                    : 'Deck operation'
              : 'Mental-poker setup'}
          </strong>
          {G.activeDeckOp?.phase === 'decrypt' && (
            <span style={{ opacity: 0.9 }}>
              {' '}
              — {G.activeDeckOp.decryptDone}/{G.activeDeckOp.decryptTotal}
            </span>
          )}
          {isCryptoSetupPhase && !G.activeDeckOp && (
            <span style={{ opacity: 0.9 }}>
              {' '}
              — phase: {effectivePhase}
              {G.setupPlayerIndex != null ? ` · setup player index: ${G.setupPlayerIndex}` : ''}
            </span>
          )}
          <div style={{ marginTop: 4, fontWeight: 600 }} data-testid="deck-op-status">
            {G.activeDeckOp?.statusMessage || cryptoStatus || 'Working…'}
          </div>
          {effectivePhase === 'keyExchange' && (
            <div style={{ marginTop: 4, fontSize: 11, opacity: 0.9 }} data-testid="key-exchange-status">
              Keys:{' '}
              {(G.playerOrder || []).map((pid) => (
                <span key={pid} style={{ marginRight: 8 }}>
                  P{pid}: {G.players[pid]?.publicKey ? '✓' : '…'}
                </span>
              ))}
              · you=P{playerID}
              {!moves?.submitPublicKey ? ' · move unavailable' : ''}
              {playerID && !G.players[playerID]?.publicKey && moves?.submitPublicKey && (
                <button
                  type="button"
                  data-testid="manual-submit-key"
                  style={{
                    marginLeft: 8,
                    padding: '2px 8px',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    try {
                      if (!keyPairRef.current) keyPairRef.current = generateKeyPair();
                      moves.submitPublicKey(keyPairRef.current.publicKey);
                      setCryptoStatus(`Manual key submit as P${playerID}`);
                    } catch (err) {
                      setCryptoStatus(`Manual key failed: ${err}`);
                    }
                  }}
                >
                  Submit my key now
                </button>
              )}
            </div>
          )}
          {G.activeDeckOp?.phase === 'decrypt' && G.activeDeckOp.decryptTotal > 0 && (
            <div
              style={{
                marginTop: 8,
                height: 8,
                borderRadius: 4,
                background: '#075985',
                overflow: 'hidden',
              }}
            >
              <div
                data-testid="deck-op-progress-bar"
                style={{
                  height: '100%',
                  width: `${Math.min(
                    100,
                    Math.round(
                      (100 * G.activeDeckOp.decryptDone) / G.activeDeckOp.decryptTotal,
                    ),
                  )}%`,
                  background: '#38bdf8',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
          )}
          <div style={{ marginTop: 4, fontSize: 11, opacity: 0.85 }}>
            {G.activeDeckOp
              ? 'Automatic decrypt / fair reshuffle / re-encrypt. No action needed until card choice.'
              : 'Keys → encrypt each deck → mutual shuffle. Hands deal after shuffle.'}
          </div>
        </div>
      )}

      {/* Non-blocking activity log (decrypt, deals, scoring process) */}
      {(G.activityLog?.length ?? 0) > 0 && (
        <div
          data-testid="activity-log"
          style={{
            marginBottom: 10,
            padding: '6px 10px',
            maxHeight:
              G.phase === 'scoring' ||
              ctx.phase === 'scoring' ||
              G.phase === 'gameOver' ||
              ctx.phase === 'gameOver' ||
              G.phase === 'play' ||
              ctx.phase === 'play'
                ? 220
                : 88,
            overflowY: 'auto',
            background: '#0b1220',
            border: '1px solid #1e2937',
            borderRadius: 6,
            fontSize: 11,
            color: '#94a3b8',
            lineHeight: 1.45,
            fontFamily:
              G.phase === 'scoring' ||
              ctx.phase === 'scoring' ||
              G.phase === 'play' ||
              ctx.phase === 'play'
                ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
                : 'inherit',
          }}
        >
          <div style={{ fontWeight: 700, color: '#64748b', marginBottom: 4, fontSize: 10, letterSpacing: 0.4 }}>
            ACTIVITY
            {(G.phase === 'scoring' ||
              ctx.phase === 'scoring' ||
              G.phase === 'gameOver' ||
              G.phase === 'play' ||
              ctx.phase === 'play') && (
              <span style={{ fontWeight: 500, opacity: 0.8 }}>
                {' '}
                · rules engine (play + scoring trail — scroll)
              </span>
            )}
          </div>
          {(G.activityLog ?? [])
            .slice(
              -(G.phase === 'scoring' ||
              ctx.phase === 'scoring' ||
              G.phase === 'gameOver' ||
              ctx.phase === 'gameOver' ||
              G.phase === 'play' ||
              ctx.phase === 'play'
                ? 80
                : 12),
            )
            .map((entry) => (
            <div
              key={entry.id}
              data-testid={`activity-log-entry-${entry.kind || 'info'}`}
              style={{
                color:
                  entry.kind === 'decrypt'
                    ? '#7dd3fc'
                    : entry.kind === 'deal'
                      ? '#86efac'
                      : entry.kind === 'system'
                        ? '#c4b5fd'
                        : entry.kind === 'score'
                          ? '#fde68a'
                          : entry.kind === 'play'
                            ? '#6ee7b7'
                            : '#94a3b8',
                whiteSpace: 'pre-wrap',
              }}
            >
              {entry.message}
            </div>
          ))}
        </div>
      )}

      {(G.phase === 'gameOver' ||
        G.phase === 'scoring' ||
        ctx.phase === 'gameOver' ||
        ctx.phase === 'scoring') && (
        <div
          data-testid={
            G.phase === 'scoring' || ctx.phase === 'scoring'
              ? 'scoring-panel'
              : 'game-over-panel'
          }
          style={{
            marginBottom: 12,
            padding: 14,
            borderRadius: 8,
            border:
              G.phase === 'scoring' || ctx.phase === 'scoring'
                ? '2px solid #eab308'
                : '2px solid #22c55e',
            background:
              G.phase === 'scoring' || ctx.phase === 'scoring'
                ? '#422006'
                : '#14532d',
            color: '#ecfdf5',
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>
            {G.phase === 'scoring' || ctx.phase === 'scoring'
              ? G.config?.rulesEnabled === false
                ? 'Scoring — manual desk (rules OFF)'
                : 'Scoring — all eras (step by step)'
              : 'Game over'}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
            {(G.playerOrder || []).map((pid) => {
              const live =
                G.scoringWalk?.provisionalScores?.[pid] ??
                G.scores?.[pid] ??
                0;
              const bonus = G.bonusPoints?.[pid] ?? G.scoringWalk?.bonusPoints?.[pid] ?? 0;
              const pileSum = (G.players?.[pid]?.scorePile || []).reduce(
                (s, c) => s + effectiveScoreValue(G, c.id),
                0,
              );
              return (
                <div key={pid} data-testid={`score-player-${pid}`}>
                  P{pid}
                  {pid === playerID ? ' (you)' : ''}:{' '}
                  <strong data-testid={`score-total-${pid}`}>{live}</strong>
                  {(G.phase === 'scoring' || ctx.phase === 'scoring') && (
                    <span
                      data-testid={`score-breakdown-${pid}`}
                      style={{ fontSize: 11, opacity: 0.85, marginLeft: 6 }}
                    >
                      (pile {pileSum} + bonus {bonus >= 0 ? '+' : ''}
                      {bonus})
                    </span>
                  )}
                  {G.winner === pid ? ' — winner' : ''}
                </div>
              );
            })}
          </div>

          {/* Score pile + bonus inventory (verify hybrid scoring) */}
          {(G.phase === 'scoring' ||
            ctx.phase === 'scoring' ||
            G.phase === 'gameOver' ||
            ctx.phase === 'gameOver') && (
            <div
              data-testid="score-inventory"
              style={{
                marginBottom: 10,
                padding: 10,
                background: '#0f172a',
                borderRadius: 6,
                border: '1px solid #475569',
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                Score inventory
              </div>
              {(G.playerOrder || []).map((pid) => {
                const pile = scorePileInventory(G)[pid] || [];
                const ledger = (G.bonusLedger || []).filter(
                  (e) => e.playerId === pid,
                );
                const bonus =
                  G.bonusPoints?.[pid] ??
                  G.scoringWalk?.bonusPoints?.[pid] ??
                  0;
                return (
                  <div
                    key={pid}
                    data-testid={`score-inventory-player-${pid}`}
                    style={{ marginBottom: 8 }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>
                      P{pid}
                    </div>
                    <div data-testid={`score-pile-list-${pid}`}>
                      <span style={{ opacity: 0.8 }}>Score pile: </span>
                      {pile.length === 0 ? (
                        <span style={{ opacity: 0.55 }}>(empty)</span>
                      ) : (
                        pile.map((item, idx) => (
                          <span
                            key={item.cardId}
                            data-testid={`score-pile-card-${item.cardId}`}
                            style={{ marginRight: 8 }}
                          >
                            {item.name}{' '}
                            <strong>
                              {item.printed >= 0 ? '+' : ''}
                              {item.printed}
                            </strong>
                            {idx < pile.length - 1 ? ',' : ''}
                          </span>
                        ))
                      )}
                    </div>
                    <div data-testid={`bonus-ledger-${pid}`} style={{ marginTop: 2 }}>
                      <span style={{ opacity: 0.8 }}>
                        Bonus points ({bonus >= 0 ? '+' : ''}
                        {bonus}):{' '}
                      </span>
                      {ledger.length === 0 ? (
                        <span style={{ opacity: 0.55 }}>(none)</span>
                      ) : (
                        ledger.map((e, i) => (
                          <span
                            key={`${e.sourceCardId || 'x'}-${i}`}
                            data-testid={`bonus-entry-${pid}-${i}`}
                            style={{ marginRight: 8 }}
                          >
                            {e.sourceName || e.sourceCardId || 'effect'}{' '}
                            <strong>
                              {e.amount >= 0 ? '+' : ''}
                              {e.amount}
                            </strong>
                            {e.note ? (
                              <span style={{ opacity: 0.65 }}>
                                {' '}
                                ({e.note})
                              </span>
                            ) : null}
                            {i < ledger.length - 1 ? ';' : ''}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {G.scoringWalk && (G.phase === 'scoring' || ctx.phase === 'scoring') && (
            <div
              data-testid="scoring-walk-banner"
              style={{
                fontSize: 13,
                // Sticky so dual-ack / choice UI stays visible without scroll jump
                position: 'sticky',
                top: 0,
                zIndex: 25,
                background: '#422006',
                margin: '0 -4px 8px',
                padding: '10px 8px',
                borderRadius: 8,
                border: '1px solid #854d0e',
                overflowAnchor: 'none',
              }}
            >
              <div style={{ marginBottom: 6, opacity: 0.95 }}>
                Card {G.scoringWalk.stepIndex + 1}
                {G.scoringWalk.activeEraId
                  ? ` · ${G.scoringWalk.activeEraId}`
                  : ''}
                {G.scoringWalk.currentCardId
                  ? ` · ${
                      (
                        G.cards?.[G.scoringWalk.currentCardId] as
                          | TimestreamsCard
                          | undefined
                      )?.name || G.scoringWalk.currentCardId
                    }`
                  : ''}
                {G.scoringWalk.stepPhase === 'choice'
                  ? ' · waiting for choices'
                  : ' · confirm to continue'}
                {G.scoringWalk.remainingSlots > 0 && G.scoringWalk.activeEraId
                  ? ` · ${G.scoringWalk.remainingSlots} slot(s) left in era`
                  : ''}
              </div>
              {G.scoringWalk.lastSummary && (
                <div
                  data-testid="scoring-step-summary"
                  style={{
                    padding: '8px 10px',
                    background: '#0f172a',
                    borderRadius: 6,
                    marginBottom: 8,
                    border: '1px solid #854d0e',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {G.scoringWalk.lastSummary}
                </div>
              )}
              {/* Inline choice notice so lagging clients see who must act */}
              {G.scoringWalk.stepPhase === 'choice' &&
                pendingPrompts.length > 0 &&
                activePrompt &&
                !isMyPrompt && (
                  <div
                    data-testid="scoring-choice-waiting"
                    style={{
                      padding: '8px 10px',
                      background: '#1e2937',
                      borderRadius: 6,
                      marginBottom: 8,
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    Waiting for P{activePrompt.deciderId} to choose (
                    {activePrompt.reason || activePrompt.id})…
                  </div>
                )}
              {G.scoringWalk.stepPhase === 'choice' &&
                !(G.pendingPrompts && G.pendingPrompts.length > 0) && (
                  <div
                    data-testid="scoring-choice-stuck"
                    style={{
                      padding: '8px 10px',
                      background: '#7f1d1d',
                      borderRadius: 6,
                      marginBottom: 8,
                      fontSize: 12,
                    }}
                  >
                    Scoring is waiting for a choice but none is open. Click OK to
                    re-sync / continue.
                    <button
                      type="button"
                      data-testid="ack-score-step-recovery"
                      disabled={!moves?.ackScoreStep || !playerID}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => moves?.ackScoreStep?.()}
                      style={{
                        marginLeft: 10,
                        padding: '6px 12px',
                        background: '#eab308',
                        color: '#0f172a',
                        border: 'none',
                        borderRadius: 4,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      Re-sync / continue
                    </button>
                  </div>
                )}
              {G.scoringWalk.stepPhase === 'ack' && (
                <div
                  data-testid="scoring-ack-inline"
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    type="button"
                    data-testid="ack-score-step"
                    disabled={
                      !moves?.ackScoreStep ||
                      !playerID ||
                      !!G.scoringWalk.acks[playerID]
                    }
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => moves?.ackScoreStep?.()}
                    style={{
                      padding: '8px 16px',
                      background: G.scoringWalk.acks[playerID || '']
                        ? '#475569'
                        : '#eab308',
                      color: '#0f172a',
                      border: 'none',
                      borderRadius: 4,
                      fontWeight: 800,
                      cursor:
                        !playerID || G.scoringWalk.acks[playerID]
                          ? 'default'
                          : 'pointer',
                    }}
                  >
                    {G.scoringWalk.acks[playerID || '']
                      ? 'Waiting for other player…'
                      : 'OK — next card'}
                  </button>
                  <span style={{ fontSize: 11, opacity: 0.85 }}>
                    Both players must OK each card · Acks:{' '}
                    {(G.playerOrder || []).map((pid) => (
                      <span key={pid} style={{ marginRight: 8 }}>
                        P{pid}
                        {G.scoringWalk!.acks[pid] ? '✓' : '…'}
                      </span>
                    ))}
                  </span>
                  {!moves?.ackScoreStep && (
                    <span
                      data-testid="ack-score-move-missing"
                      style={{ fontSize: 11, color: '#fca5a5' }}
                    >
                      (ack move unavailable for this seat — check dual-seat / connection)
                    </span>
                  )}
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 11, opacity: 0.75 }}>
                Green = processed in this era · Gold = current · Cards moved to a
                later era can process again there (printed points bank once in the
                pile). Both players OK each card. Stone → Future.
              </div>
            </div>
          )}

          {G.winner != null && G.phase === 'gameOver' && (
            <div style={{ marginTop: 8 }} data-testid="winner-line">
              Winner: P{G.winner}
            </div>
          )}
        </div>
      )}

      {/*
        Fixed dual-ack bar — scoring OK was easy to miss/clip (dual-seat overflow,
        long boards, activity log). Anyone who has not acked always sees this.
      */}
      {G.scoringWalk &&
        (G.phase === 'scoring' || ctx.phase === 'scoring') &&
        G.scoringWalk.stepPhase === 'ack' &&
        playerID != null &&
        !G.scoringWalk.acks[playerID] && (
          <div
            data-testid="scoring-ack-floating"
            style={{
              position: 'fixed',
              left: '50%',
              transform: 'translateX(-50%)',
              bottom: 16 + (Number(playerID) || 0) * 10,
              zIndex: 95,
              maxWidth: 'min(560px, calc(100vw - 24px))',
              padding: '12px 16px',
              background: 'rgba(180, 83, 9, 0.98)',
              border: '3px solid #fbbf24',
              borderRadius: 12,
              color: '#fffbeb',
              boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              alignItems: 'center',
              overflowAnchor: 'none',
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 14, textAlign: 'center' }}>
              Scoring — you (P{playerID}) must OK to continue
              {G.scoringWalk.currentCardId
                ? ` · ${
                    (
                      G.cards?.[G.scoringWalk.currentCardId] as
                        | TimestreamsCard
                        | undefined
                    )?.name || G.scoringWalk.currentCardId
                  }`
                : ''}
            </div>
            <div style={{ fontSize: 11, opacity: 0.9 }}>
              Acks:{' '}
              {(G.playerOrder || []).map((pid) => (
                <span key={pid} style={{ marginRight: 8 }}>
                  P{pid}
                  {G.scoringWalk!.acks[pid] ? '✓' : '…'}
                </span>
              ))}
            </div>
            <button
              type="button"
              data-testid="ack-score-step-floating"
              disabled={!moves?.ackScoreStep}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => moves?.ackScoreStep?.()}
              style={{
                padding: '12px 28px',
                background: moves?.ackScoreStep ? '#eab308' : '#78716c',
                color: '#0f172a',
                border: 'none',
                borderRadius: 8,
                fontWeight: 900,
                fontSize: 16,
                cursor: moves?.ackScoreStep ? 'pointer' : 'not-allowed',
                minWidth: 200,
              }}
            >
              {moves?.ackScoreStep
                ? 'OK — next card'
                : 'OK unavailable (no move)'}
            </button>
            {!moves?.ackScoreStep && (
              <div
                data-testid="ack-score-move-missing-floating"
                style={{ fontSize: 11, color: '#fecaca', textAlign: 'center' }}
              >
                This seat cannot call ackScoreStep. In dual-seat, use the other
                panel for P{playerID}. In P2P, refresh / rejoin as P{playerID}.
              </div>
            )}
          </div>
        )}

      {/*
        Mid-game rules control — fixed corner, out of document flow.
        One-way OFF only (cannot re-enable this match once disabled).
      */}
      <div
        data-testid="rules-midgame-toggle"
        style={{
          position: 'fixed',
          right: 12,
          bottom: 12 + (Number(playerID) || 0) * 96,
          zIndex: 40,
          maxWidth: 300,
          padding: '8px 10px',
          background:
            G.config?.rulesEnabled === false
              ? 'rgba(120, 53, 15, 0.95)'
              : 'rgba(30, 41, 59, 0.95)',
          border:
            G.config?.rulesEnabled === false
              ? '1px solid #eab308'
              : '1px solid #475569',
          borderRadius: 8,
          fontSize: 12,
          color: G.config?.rulesEnabled === false ? '#fef3c7' : '#e2e8f0',
          boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          overflowAnchor: 'none',
        }}
      >
        <button
          type="button"
          data-testid="rules-engine-toggle-btn"
          disabled={
            !moves?.setRulesEnabled ||
            G.config?.rulesEnabled === false ||
            !!G.config?.rulesLockedOff
          }
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (!moves?.setRulesEnabled) return;
            if (G.config?.rulesEnabled === false || G.config?.rulesLockedOff) return;
            const ok = window.confirm(
              'Disable rules engine for everyone?\n\n' +
                'Card text will no longer resolve automatically. You will use free tools to move cards and tally scores by hand.\n\n' +
                'You cannot re-enable the rules engine for the rest of this match.\n' +
                'Both players will be switched to Rules OFF.',
            );
            if (!ok) return;
            moves.setRulesEnabled(false);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '4px 6px',
            background: 'transparent',
            border: 'none',
            color: 'inherit',
            cursor:
              moves?.setRulesEnabled && G.config?.rulesEnabled !== false
                ? 'pointer'
                : 'not-allowed',
            textAlign: 'left',
            font: 'inherit',
            opacity: G.config?.rulesEnabled === false ? 0.85 : 1,
          }}
          title={
            G.config?.rulesEnabled === false
              ? 'Rules engine locked OFF for this match'
              : 'Disable rules engine for everyone (cannot re-enable)'
          }
        >
          <span
            aria-hidden
            style={{
              width: 16,
              height: 16,
              borderRadius: 3,
              border: '2px solid currentColor',
              background:
                G.config?.rulesEnabled !== false ? '#22c55e' : 'transparent',
              flexShrink: 0,
            }}
          />
          <span>
            <strong>Rules engine</strong>
            {G.config?.rulesEnabled === false ? ' OFF' : ' ON'}
          </span>
        </button>
        <span style={{ opacity: 0.8, fontSize: 10, lineHeight: 1.3, paddingLeft: 2 }}>
          {G.config?.rulesEnabled === false
            ? 'Manual free tools. Cannot re-enable this match.'
            : 'Full rules. Click to disable for everyone (one-way).'}
        </span>
      </div>

      {/* E2E / debug seed panel — only when config.debugSeed */}
      {G.config?.debugSeed && (
        <div
          data-testid="e2e-debug-panel"
          style={{
            marginBottom: 8,
            padding: 8,
            background: '#312e81',
            border: '1px solid #818cf8',
            borderRadius: 6,
            fontSize: 11,
            color: '#e0e7ff',
          }}
        >
          <strong>E2E debugSeed</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            <button
              type="button"
              data-testid="e2e-seed-fire-discard"
              disabled={!moves?.debugSeedBoard}
              onClick={() => {
                moves?.debugSeedBoard?.({
                  phase: 'play',
                  currentDay: 1,
                  currentPlayerHomeEra: { '0': 'stone', '1': 'future' },
                  timeline: {
                    stone: [
                      {
                        id: 'victim#0',
                        name: 'Victim',
                        ownerId: '1',
                        scoreValue: 2,
                      },
                    ],
                  },
                  hands: {
                    '0': [
                      {
                        id: 'stone-age-fire#0',
                        name: 'Fire',
                        ownerId: '0',
                        tags: [
                          'play:discard:1',
                          'discard:target:today:any',
                        ],
                      },
                    ],
                  },
                  rulesEnabled: true,
                });
              }}
            >
              Seed Fire discard
            </button>
            <button
              type="button"
              data-testid="e2e-seed-free-tools"
              disabled={!moves?.debugSeedBoard}
              onClick={() => {
                moves?.debugSeedBoard?.({
                  phase: 'play',
                  currentDay: 1,
                  currentPlayerHomeEra: { '0': 'stone', '1': 'future' },
                  timeline: {
                    stone: [
                      { id: 'host#0', name: 'Host', ownerId: '0', scoreValue: 1 },
                      { id: 'other#0', name: 'Other', ownerId: '1', scoreValue: 2 },
                    ],
                  },
                  hands: {
                    '0': [
                      {
                        id: 'hib#0',
                        name: 'Hibernation',
                        ownerId: '0',
                        cardType: 'action',
                        tags: ['play:attach'],
                      },
                    ],
                  },
                  rulesEnabled: false,
                });
              }}
            >
              Seed free-tools board
            </button>
            <button
              type="button"
              data-testid="e2e-seed-scoring-manual"
              disabled={!moves?.debugSeedBoard}
              onClick={() => {
                // Keep phase=play first so boardgame.io does not endIf mid-seed
                // and wipe dual-seat rendering. Cards land on timeline; scoring
                // desk tools work for free:score-* during play when rules off.
                moves?.debugSeedBoard?.({
                  phase: 'play',
                  currentDay: 1,
                  currentPlayerHomeEra: { '0': 'stone', '1': 'future' },
                  timeline: {
                    stone: [
                      { id: 's0-card', name: 'S0', ownerId: '0', scoreValue: 2 },
                      { id: 's1-card', name: 'S1', ownerId: '0', scoreValue: 1 },
                      { id: 's2-card', name: 'S2', ownerId: '1', scoreValue: 3 },
                    ],
                  },
                  rulesEnabled: false,
                });
              }}
            >
              Seed manual scoring
            </button>
            <button
              type="button"
              data-testid="e2e-enter-scoring"
              disabled={!moves?.debugSeedBoard}
              onClick={() => {
                moves?.debugSeedBoard?.({
                  clearBoard: false,
                  phase: 'scoring',
                  rulesEnabled: false,
                });
              }}
            >
              Enter scoring phase
            </button>
            <span data-testid="e2e-phase-label" style={{ opacity: 0.85 }}>
              G.phase={G.phase} ctx={String(ctx.phase)} rules=
              {G.config?.rulesEnabled === false ? 'OFF' : 'ON'} seed=
              {G.config?.debugSeed ? '1' : '0'}
            </span>
          </div>
        </div>
      )}

      {/* Free tools sticky bar (rules-off) */}
      {rulesOff && (
        <div
          data-testid="free-tools-bar"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 25,
            marginBottom: 10,
            padding: '10px 12px',
            background: 'rgba(120, 53, 15, 0.97)',
            border: '1px solid #eab308',
            borderRadius: 8,
            color: '#fef3c7',
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Rules engine OFF — free tools
            {!freeToolsAllowed && G.phase === 'play'
              ? ' (current player only)'
              : ''}
          </div>
          <div style={{ marginBottom: 6, opacity: 0.9, fontSize: 11 }}>
            Selected: {freeSelected.length ? freeSelected.join(', ') : 'none'} · Era target:{' '}
            <select
              data-testid="free-era-target"
              value={freeEraTarget}
              onChange={(e) => setFreeEraTarget(e.target.value as EraId)}
              style={{ fontSize: 11, marginLeft: 4 }}
            >
              {ERA_ORDER.map((e) => (
                <option key={e} value={e}>
                  {ERA_LABELS[e]}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid="free-clear-selection"
              onClick={() => setFreeSelected([])}
              style={{ marginLeft: 8, fontSize: 11 }}
            >
              Clear
            </button>
            <div style={{ marginTop: 4, opacity: 0.85, lineHeight: 1.35 }}>
              Open <strong>Your discard</strong> below → select cards (or use → Hand on a
              card) · only your discard is available.
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(
              [
                [
                  'Attach',
                  'free:attach',
                  () =>
                    primarySelected &&
                    secondSelected &&
                    runFreeTool('free:attach', {
                      cardId: primarySelected,
                      hostCardId: secondSelected,
                    }),
                  freeSelected.length >= 2,
                ],
                [
                  'Detach→hand',
                  'free:detach',
                  () =>
                    primarySelected &&
                    runFreeTool('free:detach', { cardId: primarySelected }),
                  !!primarySelected,
                ],
                [
                  'Discard',
                  'free:discard',
                  () =>
                    freeSelected.length &&
                    runFreeTool('free:discard', { cardIds: freeSelected }),
                  freeSelected.length > 0,
                ],
                [
                  'To era',
                  'free:to-era',
                  () =>
                    primarySelected &&
                    runFreeTool('free:to-era', {
                      cardId: primarySelected,
                      eraId: freeEraTarget,
                      position: 'top',
                    }),
                  !!primarySelected,
                ],
                [
                  'Swap',
                  'free:swap',
                  () =>
                    freeSelected.length === 2 &&
                    runFreeTool('free:swap', { cardIds: freeSelected }),
                  freeSelected.length === 2,
                ],
                [
                  '→ Score pile',
                  'free:to-score-pile',
                  () =>
                    freeSelected.length &&
                    runFreeTool('free:to-score-pile', {
                      cardIds: freeSelected,
                      pileOwnerId: playerID,
                    }),
                  freeSelected.length > 0,
                ],
                [
                  'Draw 1',
                  'free:draw',
                  () => runFreeTool('free:draw', { amount: 1 }),
                  true,
                ],
                [
                  'Discard → Hand',
                  'free:recover-hand',
                  () =>
                    freeSelected.length &&
                    runFreeTool('free:recover-hand', { cardIds: freeSelected }),
                  freeSelected.length > 0,
                ],
              ] as const
            ).map(([label, testId, onClick, enabled]) => (
              <button
                key={testId}
                type="button"
                data-testid={`free-tool-${testId}`}
                disabled={!freeToolsAllowed || !enabled}
                onClick={() => onClick()}
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  borderRadius: 4,
                  border: '1px solid #ca8a04',
                  background: freeToolsAllowed && enabled ? '#854d0e' : '#44403c',
                  color: '#fef3c7',
                  cursor: freeToolsAllowed && enabled ? 'pointer' : 'not-allowed',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {(G.phase === 'scoring' || ctx.phase === 'scoring') && (
            <div
              data-testid="manual-scoring-desk"
              style={{
                marginTop: 10,
                paddingTop: 8,
                borderTop: '1px solid #a16207',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                Manual scoring desk
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                {(G.playerOrder || []).map((pid) => (
                  <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    P{pid} bonus:
                    <button
                      type="button"
                      data-testid={`free-bonus-dec-${pid}`}
                      disabled={!freeToolsAllowed}
                      onClick={() =>
                        runFreeTool('free:score-bonus-delta', {
                          targetPlayerId: pid,
                          amount: -1,
                        })
                      }
                    >
                      −
                    </button>
                    <strong data-testid={`manual-bonus-${pid}`}>
                      {G.manualBonus?.[pid] ?? G.bonusPoints?.[pid] ?? 0}
                    </strong>
                    <button
                      type="button"
                      data-testid={`free-bonus-inc-${pid}`}
                      disabled={!freeToolsAllowed}
                      onClick={() =>
                        runFreeTool('free:score-bonus-delta', {
                          targetPlayerId: pid,
                          amount: 1,
                        })
                      }
                    >
                      +
                    </button>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Cap {freeEraTarget}:
                  <button
                    type="button"
                    data-testid="free-cap-dec"
                    disabled={!freeToolsAllowed}
                    onClick={() =>
                      runFreeTool('free:score-slot-cap', {
                        eraId: freeEraTarget,
                        amount: -1,
                      })
                    }
                  >
                    −
                  </button>
                  <strong data-testid="manual-cap">
                    {G.manualSlotCap?.[freeEraTarget] ??
                      G.config?.scoringSlots ??
                      6}
                  </strong>
                  <button
                    type="button"
                    data-testid="free-cap-inc"
                    disabled={!freeToolsAllowed}
                    onClick={() =>
                      runFreeTool('free:score-slot-cap', {
                        eraId: freeEraTarget,
                        amount: 1,
                      })
                    }
                  >
                    +
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button
                  type="button"
                  data-testid="free-mark-processed"
                  disabled={!freeToolsAllowed || !primarySelected}
                  onClick={() =>
                    primarySelected &&
                    runFreeTool('free:score-mark-processed', {
                      cardId: primarySelected,
                      processed: true,
                    })
                  }
                >
                  Mark scored
                </button>
                <button
                  type="button"
                  data-testid="free-claim-pile"
                  disabled={!freeToolsAllowed || freeSelected.length === 0}
                  onClick={() =>
                    runFreeTool('free:score-claim-pile', {
                      cardIds: freeSelected,
                      pileOwnerId: playerID,
                    })
                  }
                >
                  Claim pile
                </button>
                <button
                  type="button"
                  data-testid="free-set-current"
                  disabled={!freeToolsAllowed || !primarySelected}
                  onClick={() =>
                    primarySelected &&
                    runFreeTool('free:score-set-current', {
                      cardId: primarySelected,
                    })
                  }
                >
                  Set current
                </button>
                <button
                  type="button"
                  data-testid="free-score-ack"
                  disabled={!freeToolsAllowed}
                  onClick={() => runFreeTool('free:score-ack', {})}
                >
                  OK — next
                </button>
                <button
                  type="button"
                  data-testid="free-era-cleanup-open"
                  disabled={!freeToolsAllowed}
                  onClick={() => setCleanupPreviewOpen(true)}
                >
                  Era cleanup…
                </button>
                <button
                  type="button"
                  data-testid="free-finalize-scores"
                  disabled={!freeToolsAllowed}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Finalize scores now? Uses score piles + bonus ledger.',
                      )
                    ) {
                      runFreeTool('free:score-finalize', {});
                    }
                  }}
                  style={{ fontWeight: 700, background: '#166534', color: '#fff' }}
                >
                  Finalize scores
                </button>
              </div>
              {cleanupPreviewOpen && (
                <div
                  data-testid="era-cleanup-dialog"
                  style={{
                    marginTop: 8,
                    padding: 10,
                    background: '#1c1917',
                    borderRadius: 6,
                    border: '1px solid #a16207',
                  }}
                >
                  <div style={{ marginBottom: 6 }}>
                    Cleanup <strong>{ERA_LABELS[freeEraTarget]}</strong>
                  </div>
                  <label style={{ display: 'block', marginBottom: 4 }}>
                    <input
                      type="radio"
                      name="cleanup-mode"
                      checked={cleanupMode === 'outside-capacity'}
                      onChange={() => setCleanupMode('outside-capacity')}
                    />{' '}
                    Mode A — Outside capacity (default)
                  </label>
                  <label style={{ display: 'block', marginBottom: 6 }}>
                    <input
                      type="radio"
                      name="cleanup-mode"
                      checked={cleanupMode === 'unprocessed'}
                      onChange={() => setCleanupMode('unprocessed')}
                    />{' '}
                    Mode B — Unprocessed only
                  </label>
                  {(() => {
                    const prev = previewEraCleanup(G, freeEraTarget, cleanupMode);
                    return (
                      <div data-testid="cleanup-preview" style={{ fontSize: 11, marginBottom: 8 }}>
                        Preview: {prev.toPile.length} → score piles,{' '}
                        {prev.toDiscard.length} → discard, {prev.eraActions.length}{' '}
                        era-action → discard
                      </div>
                    );
                  })()}
                  <button
                    type="button"
                    data-testid="free-era-cleanup-confirm"
                    onClick={() => {
                      runFreeTool('free:score-era-cleanup', {
                        eraId: freeEraTarget,
                        mode: cleanupMode,
                      });
                      setCleanupPreviewOpen(false);
                    }}
                  >
                    Confirm cleanup
                  </button>
                  <button
                    type="button"
                    style={{ marginLeft: 8 }}
                    onClick={() => setCleanupPreviewOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Opponent status strip */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {G.playerOrder?.map((pid) => {
          const p = G.players[pid];
          return (
            <div
              key={pid}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                background: pid === playerID ? '#1e3a5f' : '#1e2937',
                border: pid === currentPlayer ? '1px solid #22c55e' : '1px solid #334155',
                fontSize: 12,
              }}
            >
              P{pid}{pid === playerID ? ' (you)' : ''}
              {p?.homeEra ? ` · ${ERA_LABELS[p.homeEra as EraId] || p.homeEra}` : ' · no era'}
              {p?.ready ? ' · ready' : ''}
              {` · hand ${p?.hand?.length ?? 0}`}
              {` · discard ${p?.discard?.length ?? 0}`}
            </div>
          );
        })}
      </div>

      {/* Timeline */}
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto' }}>
        {ERA_ORDER.map((era) => {
          const eraState = G.timeline[era];
          const isActive = era === activeEra && isPlayPhase;
          // Per-era slots: Slow Time (+2), Fast Time (−2), etc.
          const slots = computeScoringSlotsForEra(G, era);
          const baseSlots = G.config?.scoringSlots ?? 6;
          const slotNotes = scoringSlotModifierNotes(G, era);
          const stack = eraState?.stack ?? [];
          const walk = G.scoringWalk;
          // Prefer live walk fields (Wonky re-discovery) — not a frozen steps list.
          const isScoringEra =
            (G.phase === 'scoring' || ctx.phase === 'scoring') &&
            !!walk?.currentCardId &&
            (walk.activeEraId === era ||
              walk.steps[walk.stepIndex]?.eraId === era);

          return (
            <div
              key={era}
              className="ts-era-column"
              data-era={era}
              data-scoring-slots={slots}
              data-scoring-active={isScoringEra ? 'true' : 'false'}
              style={{
                minWidth: '140px',
                // Always 3px border so highlighting never reflows layout / scroll.
                border: isScoringEra
                  ? '3px solid #eab308'
                  : isActive
                    ? '3px solid #38bdf8'
                    : '3px solid #334155',
                borderRadius: '6px',
                padding: '6px',
                background: isScoringEra
                  ? '#422006'
                  : isActive
                    ? '#0c4a6e'
                    : '#1e2937',
                overflowAnchor: 'none',
              }}
            >
              <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '4px' }}>
                {ERA_LABELS[era]}
                {isActive && ' (today)'}
              </div>

              <div
                data-testid={`era-slots-${era}`}
                style={{
                  fontSize: '10px',
                  color: slots !== baseSlots ? '#fde68a' : '#94a3b8',
                  marginBottom: '4px',
                  fontWeight: slots !== baseSlots ? 700 : 400,
                }}
                title={
                  slotNotes.length
                    ? `Capacity ${slots} (base ${baseSlots}; ${slotNotes.join(', ')}). Left = inventions that can score; not reduced when cards are stolen.`
                    : `Scoring capacity: ${slots} (base ${baseSlots})`
                }
              >
                {/* Always show capacity on the right. Left is inventions currently
                    filling slots (min of capacity and stack) — do not treat left
                    as capacity (stealing QC shrinks stack, not capacity). */}
                Capacity: {slots}
                {stack.length > 0
                  ? ` · ${Math.min(slots, stack.length)} card(s) in range`
                  : ''}
                {slots !== baseSlots ? ` (base ${baseSlots})` : ''}
              </div>
              {slotNotes.length > 0 && (
                <div
                  data-testid={`era-slot-mods-${era}`}
                  style={{ fontSize: 9, color: '#fbbf24', marginBottom: 4, lineHeight: 1.3 }}
                >
                  {slotNotes.join(' · ')}
                </div>
              )}

              {/* Era-level actions (Slow Time, Fast Time, …) — not scoring slots */}
              {(eraState?.actions?.length ?? 0) > 0 && (
                <div
                  data-testid={`era-actions-${era}`}
                  style={{
                    marginBottom: 6,
                    padding: '4px 6px',
                    borderRadius: 4,
                    background: '#312e81',
                    border: '1px solid #6366f1',
                    fontSize: 10,
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#c7d2fe', marginBottom: 2 }}>
                    On era (actions)
                  </div>
                  {(eraState.actions ?? []).map((actId) => {
                    const act = G.cards?.[actId] as TimestreamsCard | undefined;
                    const actLabel = act?.name || actId.split('#')[0] || actId;
                    const actCard = act || {
                      id: actId,
                      name: actLabel,
                      ownerId: '',
                      cardType: 'action' as const,
                      subtypes: [],
                      hasPlayEffect: false,
                      hasScoreEffect: false,
                      hasReact: false,
                    };
                    return (
                      <div
                        key={actId}
                        data-testid={`era-action-${actId}`}
                        style={{
                          padding: '1px 0',
                          color: '#e0e7ff',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={() => handleCardHover(actCard)}
                        onMouseLeave={() => handleCardHover(null)}
                      >
                        • {actLabel}
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ minHeight: '80px', background: '#0f172a', border: '1px dashed #475569', padding: '4px', fontSize: '11px' }}>
                {stack.length === 0 ? (
                  <span style={{ color: '#64748b' }}>empty</span>
                ) : (
                  stack.map((cardId: string, i: number) => {
                    // Hydrate art/tags from pack catalog (Immortality imageUrl, etc.)
                    const card =
                      (getLiveCard(G, cardId) as TimestreamsCard | undefined) ||
                      (G.cards?.[cardId] as TimestreamsCard | undefined);
                    const label = card?.name || cardId.split('#')[0] || cardId;
                    const inScoringSlot = i < slots;
                    const processed =
                      ((G.phase === 'scoring' || ctx.phase === 'scoring') &&
                        isCardProcessedForUi(G, cardId, era)) ||
                      !!G.manualProcessed?.[cardId];
                    const isCurrent =
                      G.scoringWalk?.currentCardId === cardId ||
                      G.manualCurrentCardId === cardId;
                    const freeSel = freeSelected.includes(cardId);
                    const fullCard = card || {
                      id: cardId,
                      name: label,
                      ownerId: '',
                      cardType: 'invention' as const,
                      subtypes: [],
                      hasPlayEffect: false,
                      hasScoreEffect: false,
                      hasReact: false,
                    };
                    // Actions attached to this invention (Hibernation, Inflation, Waylay, …)
                    const attachedIds = G.attachments?.[cardId] ?? [];
                    return (
                      <div
                        key={`${cardId}-${i}`}
                        data-testid={`timeline-card-${cardId}`}
                        data-in-scoring-slot={inScoringSlot ? 'true' : 'false'}
                        data-scoring-processed={processed ? 'true' : 'false'}
                        data-scoring-current={isCurrent ? 'true' : 'false'}
                        data-free-selected={freeSel ? 'true' : 'false'}
                        style={{
                          padding: '2px 4px',
                          borderBottom: '1px solid #1e2937',
                          opacity: inScoringSlot || isCurrent || processed ? 1 : 0.55,
                          borderRadius: 4,
                          background: freeSel
                            ? '#1e3a5f'
                            : isCurrent
                              ? '#854d0e'
                              : processed
                                ? '#14532d'
                                : 'transparent',
                          outline: freeSel
                            ? '2px solid #38bdf8'
                            : isCurrent
                              ? '2px solid #facc15'
                              : processed
                                ? '1px solid #22c55e'
                                : undefined,
                        }}
                      >
                        <div
                          style={{
                            cursor: 'pointer',
                            color: processed
                              ? '#bbf7d0'
                              : isCurrent
                                ? '#fef9c3'
                                : inScoringSlot
                                  ? undefined
                                  : '#94a3b8',
                            fontWeight: isCurrent || processed ? 700 : 400,
                          }}
                          onMouseEnter={() => handleCardHover(fullCard)}
                          onMouseLeave={() => handleCardHover(null)}
                          onClick={() => {
                            if (rulesOff) toggleFreeSelect(cardId);
                          }}
                        >
                          {i + 1}. {label}
                          {processed ? ' ✓' : ''}
                          {isCurrent ? ' ◀' : ''}
                          {freeSel ? ' ●' : ''}
                          {!inScoringSlot && !processed && !isCurrent ? ' (past slots)' : ''}
                        </div>
                        {attachedIds.map((attId) => {
                          const att =
                            (getLiveCard(G, attId) as TimestreamsCard | undefined) ||
                            (G.cards?.[attId] as TimestreamsCard | undefined);
                          const attLabel =
                            att?.name || attId.split('#')[0] || attId;
                          const attCard = att || {
                            id: attId,
                            name: attLabel,
                            ownerId: '',
                            cardType: 'action' as const,
                            subtypes: [],
                            hasPlayEffect: false,
                            hasScoreEffect: false,
                            hasReact: false,
                          };
                          const attSel = freeSelected.includes(attId);
                          return (
                            <div
                              key={attId}
                              data-testid={`timeline-attachment-${attId}`}
                              data-host={cardId}
                              data-free-selected={attSel ? 'true' : 'false'}
                              style={{
                                paddingLeft: 14,
                                color: attSel ? '#7dd3fc' : '#a5b4fc',
                                fontSize: 10,
                                cursor: 'pointer',
                                outline: attSel ? '1px solid #38bdf8' : undefined,
                              }}
                              onMouseEnter={() => handleCardHover(attCard)}
                              onMouseLeave={() => handleCardHover(null)}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (rulesOff) toggleFreeSelect(attId);
                              }}
                            >
                              - {attLabel}
                              {attSel ? ' ●' : ''}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Setup Phase: Home Era Claims */}
      {isSetupPhase && G.config?.homeEraAssignment === 'selectable' && (
        <div
          data-testid="setup-claim"
          style={{ marginTop: '16px', padding: '12px', border: '2px solid #eab308', borderRadius: '6px', background: '#422006', color: '#fef3c7' }}
        >
          <h3 style={{ margin: 0 }}>Setup: Claim Your Home Era</h3>
          <p style={{ fontSize: '12px' }}>
            Each player claims a unique era, then clicks Ready. When both are ready the game deals and play begins
            ({G.config?.playMode === 'mental-poker' ? 'via mental-poker crypto' : 'plaintext deal — ready for P2P testing'}).
          </p>
          {G.packName && (
            <p style={{ fontSize: 11, color: '#fde68a', margin: '4px 0 8px' }}>
              Pack: {G.packName} — claim Stone / Medieval / Modern / Future for real decks + art.
              Renaissance &amp; Industrial use placeholders if not in the pack.
            </p>
          )}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '8px 0' }}>
            {ERA_ORDER.map((era) => {
              const claimedBy = Object.entries(G.players || {}).find(([, p]) => p.homeEra === era)?.[0];
              const myEra = myPlayer?.homeEra;
              const isMine = myEra === era;
              const taken = !!claimedBy && !isMine;
              const packHas = !!(G.packCatalog && (G.packCatalog[era]?.length ?? 0) > 0);
              return (
                <button
                  key={era}
                  data-era-claim={era}
                  onClick={() => moves.claimHomeEra && moves.claimHomeEra(era)}
                  disabled={taken || !!myEra}
                  style={{
                    padding: '6px 12px',
                    background: isMine ? '#22c55e' : taken ? '#475569' : packHas ? '#ca8a04' : '#57534e',
                    color: 'white',
                    border: packHas ? '1px solid #fbbf24' : 'none',
                    borderRadius: '4px',
                    cursor: isMine || !taken ? 'pointer' : 'not-allowed',
                  }}
                  title={packHas ? 'Has scanned deck in pack' : 'No pack set — placeholders'}
                >
                  {ERA_LABELS[era]}
                  {packHas ? ' 🎴' : ''}
                  {isMine ? ' ✓' : taken ? ` (P${claimedBy})` : ''}
                </button>
              );
            })}
          </div>
          <button
            data-testid="set-ready"
            onClick={() => moves.setReady && moves.setReady(true)}
            disabled={!myPlayer?.homeEra || !!myPlayer?.ready}
            style={{
              padding: '8px 16px',
              background: myPlayer?.ready ? '#166534' : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: myPlayer?.homeEra && !myPlayer?.ready ? 'pointer' : 'not-allowed',
            }}
          >
            {myPlayer?.ready ? 'Ready — waiting for opponent…' : 'Set Ready'}
          </button>
        </div>
      )}

      {/* Crypto status */}
      {isCryptoPhase && (
        <div style={{ marginTop: 12, padding: 10, background: '#0c4a6e', borderRadius: 6, fontSize: 13 }}>
          Mental-poker setup in progress ({G.phase})… keys/encrypt/shuffle auto-run on both peers.
        </div>
      )}

      {/* Teaching Toggle */}
      <div style={{ marginTop: '12px', marginBottom: '8px' }}>
        <label style={{ fontSize: '12px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={teachingMode}
            onChange={(e) => setTeachingMode(e.target.checked)}
            style={{ marginRight: '6px' }}
          />
          Teaching mode: Always show your hand
        </label>
      </div>

      {/* Hand and Controls — local group / sort / drag-reorder */}
      {showHand && (
        <HandPanel
          G={G}
          playerID={playerID ?? null}
          myHand={myHand}
          isMyTurn={!!isMyTurn}
          isPlayPhase={!!isPlayPhase}
          isSetupPhase={!!isSetupPhase}
          isCryptoPhase={!!isCryptoPhase}
          currentPlayer={currentPlayer}
          activePrompt={!!activePrompt}
          onPlayInvention={handlePlayInvention}
          onPlayAction={handlePlayAction}
          onPass={handlePass}
          onCardHover={handleCardHover}
          freeSelectedIds={rulesOff ? freeSelected : undefined}
          onFreeSelect={rulesOff ? toggleFreeSelect : undefined}
        />
      )}

      {/* Own discard pile — private view (only your cards; never opponents') */}
      {playerID && (
        <div
          data-testid="discard-pile"
          style={{
            marginTop: 10,
            padding: 10,
            background: '#1e2937',
            border: rulesOff ? '2px solid #eab308' : '1px solid #475569',
            borderRadius: 8,
            overflowAnchor: 'none',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              data-testid="discard-pile-toggle"
              onClick={() => setDiscardOpenPref((o) => !(o ?? discardOpen))}
              onMouseDown={(e) => e.preventDefault()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flex: 1,
                minWidth: 160,
                background: 'transparent',
                border: 'none',
                color: '#e2e8f0',
                cursor: 'pointer',
                font: 'inherit',
                padding: 0,
                textAlign: 'left',
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 13 }}>
                Your discard ({myDiscard.length})
              </span>
              <span style={{ fontSize: 11, opacity: 0.7 }}>
                {discardOpen ? '▾ hide' : '▸ show'}
              </span>
            </button>
            {rulesOff && myDiscard.length > 0 && (
              <button
                type="button"
                data-testid="discard-recover-selected"
                disabled={
                  !freeToolsAllowed ||
                  !freeSelected.some((id) =>
                    myDiscard.some((c) => c.id === id),
                  )
                }
                onClick={() => {
                  const ids = freeSelected.filter((id) =>
                    myDiscard.some((c) => c.id === id),
                  );
                  if (ids.length) {
                    runFreeTool('free:recover-hand', { cardIds: ids });
                  }
                }}
                title="Move selected cards from your discard to your hand"
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 4,
                  border: '1px solid #ca8a04',
                  background: freeToolsAllowed ? '#854d0e' : '#44403c',
                  color: '#fef3c7',
                  cursor: freeToolsAllowed ? 'pointer' : 'not-allowed',
                }}
              >
                Selected → Hand
              </button>
            )}
          </div>
          {rulesOff && (
            <div
              data-testid="discard-free-hint"
              style={{ fontSize: 11, color: '#fde68a', marginTop: 6, lineHeight: 1.35 }}
            >
              Rules OFF: click a card to select, or press <strong>→ Hand</strong> on a card
              to return it to your hand. You can only recover from <em>your</em> discard.
              {!freeToolsAllowed && G.phase === 'play'
                ? ' (wait for your turn)'
                : ''}
            </div>
          )}
          {discardOpen && (
            <div
              data-testid="discard-pile-list"
              style={{
                marginTop: 10,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                maxHeight: 320,
                overflowY: 'auto',
              }}
            >
              {myDiscard.length === 0 ? (
                <span
                  data-testid="discard-pile-empty"
                  style={{ fontSize: 12, color: '#64748b' }}
                >
                  Empty — discarded cards will appear here.
                </span>
              ) : (
                [...myDiscard].reverse().map((card, i) => {
                  const live =
                    (getLiveCard(G, card.id) as TimestreamsCard | undefined) ||
                    card;
                  const label = live.name || live.id.split('#')[0] || live.id;
                  const freeSel = freeSelected.includes(live.id);
                  return (
                    <div
                      key={`${live.id}-disc-${i}`}
                      data-testid={`discard-card-${live.id}`}
                      data-free-selected={freeSel ? 'true' : 'false'}
                      role="button"
                      tabIndex={0}
                      onMouseEnter={() => handleCardHover(live)}
                      onMouseLeave={() => handleCardHover(null)}
                      onClick={() => {
                        if (rulesOff) toggleFreeSelect(live.id);
                      }}
                      style={{
                        width: 110,
                        padding: 6,
                        borderRadius: 6,
                        border: freeSel
                          ? '2px solid #38bdf8'
                          : '1px solid #475569',
                        background: freeSel ? '#1e3a5f' : '#0f172a',
                        cursor: 'pointer',
                        fontSize: 11,
                      }}
                    >
                      {live.imageUrl ? (
                        <div
                          style={{
                            width: '100%',
                            height: 88,
                            marginBottom: 4,
                            borderRadius: 4,
                            overflow: 'hidden',
                            background: '#0b1220',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <img
                            src={live.imageUrl}
                            alt={label}
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display =
                                'none';
                            }}
                            style={{
                              maxWidth: '100%',
                              maxHeight: '100%',
                              objectFit: 'contain',
                            }}
                          />
                        </div>
                      ) : null}
                      <div style={{ fontWeight: 700, lineHeight: 1.25 }}>
                        {label}
                      </div>
                      <div style={{ color: '#94a3b8', marginTop: 2 }}>
                        {formatCardCaption(live)}
                      </div>
                      {rulesOff && (
                        <button
                          type="button"
                          data-testid={`discard-to-hand-${live.id}`}
                          disabled={!freeToolsAllowed}
                          onClick={(e) => {
                            e.stopPropagation();
                            runFreeTool('free:recover-hand', {
                              cardIds: [live.id],
                            });
                          }}
                          style={{
                            marginTop: 6,
                            width: '100%',
                            padding: '4px 6px',
                            fontSize: 11,
                            fontWeight: 700,
                            borderRadius: 4,
                            border: '1px solid #38bdf8',
                            background: freeToolsAllowed ? '#0c4a6e' : '#334155',
                            color: '#e0f2fe',
                            cursor: freeToolsAllowed ? 'pointer' : 'not-allowed',
                          }}
                        >
                          → Hand
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
          {discardOpen && myDiscard.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 10, color: '#64748b' }}>
              Newest first · only your discard · hover for full detail
            </div>
          )}
        </div>
      )}

      {/* Fixed attention banner when YOU must answer a play prompt off-turn */}
      {activePrompt && isMyPrompt && G.phase === 'play' && (
        <div
          data-testid="play-choice-attention"
          style={{
            position: 'fixed',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            maxWidth: 'min(560px, 94vw)',
            padding: '10px 16px',
            background: 'rgba(180, 83, 9, 0.98)',
            border: '2px solid #fbbf24',
            borderRadius: 10,
            color: '#fffbeb',
            fontWeight: 800,
            fontSize: 14,
            boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          Your decision is required — scroll to the amber panel or use the choices
          below
        </div>
      )}

      {/* Rules prompts — sticky/fixed so chooser always sees options (play + score). */}
      {activePrompt && (
        <div
          data-testid="rules-prompt"
          style={{
            marginTop: 12,
            padding: 12,
            border: isMyPrompt ? '3px solid #fbbf24' : '2px solid #eab308',
            borderRadius: 8,
            background: isMyPrompt ? '#422006' : '#1e2937',
            color: '#fef3c7',
            // Fixed when you must act in play so dual-seat / long boards can't hide it.
            position: isMyPrompt
              ? 'fixed'
              : G.phase === 'scoring' || ctx.phase === 'scoring'
                ? 'sticky'
                : 'relative',
            left: isMyPrompt ? 12 : undefined,
            right: isMyPrompt ? 12 : undefined,
            bottom: isMyPrompt
              ? 12 + (Number(playerID) || 0) * 8
              : G.phase === 'scoring' || ctx.phase === 'scoring'
                ? 8
                : undefined,
            maxWidth: isMyPrompt ? 'min(720px, calc(100vw - 24px))' : undefined,
            marginLeft: isMyPrompt ? 'auto' : undefined,
            marginRight: isMyPrompt ? 'auto' : undefined,
            zIndex: isMyPrompt ? 90 : 26,
            overflowAnchor: 'none',
            boxShadow: isMyPrompt
              ? '0 12px 40px rgba(0,0,0,0.65)'
              : G.phase === 'scoring' || ctx.phase === 'scoring'
                ? '0 8px 24px rgba(0,0,0,0.55)'
                : undefined,
            maxHeight: isMyPrompt ? '70vh' : undefined,
            overflowY: isMyPrompt ? 'auto' : undefined,
          }}
        >
          {!isMyPrompt ? (
            <div style={{ fontWeight: 700 }} data-testid="prompt-waiting">
              Waiting for P{activePrompt.deciderId} to complete a card choice…
              {activePrompt.reason === 'play:choice'
                ? ' (they decide discard invention vs discard from hand)'
                : ''}
            </div>
          ) : (
            <>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            {activePrompt.reason === 'play:search-deck'
              ? 'Search your deck — choose one card to put in your hand'
              : activePrompt.reason === 'play:attach'
                ? 'Choose an invention in Today to attach this card to'
              : activePrompt.reason === 'play:move'
                ? 'Optional move — leave where played, or move up in Today'
              : activePrompt.reason === 'move:direction:up-or-down'
                ? 'Choose move direction'
              : activePrompt.reason === 'peek:own-to-hand'
                ? 'Peek: choose one of these cards for your hand (or None)'
                : activePrompt.reason === 'target:choose:opponent'
                  ? 'Choose an opponent'
                  : activePrompt.reason === 'discard:opponent-deck-card'
                    ? 'Choose one card from opponent deck to discard'
                    : activePrompt.reason === 'play:copy'
                      ? 'Copy play ability — choose an invention in play'
                      : activePrompt.reason === 'play:play-invention'
                        ? 'Coronation — choose an invention from your hand to play'
                        : activePrompt.reason === 'recover:from-discard' ||
                            activePrompt.reason === 'play:recover'
                          ? promptMin === 0
                            ? 'Recover — choose a card from your discard (or None to skip)'
                            : 'Recover — choose a card from your discard pile'
                          : activePrompt.reason === 'recover:to-deck'
                            ? 'Recover — choose card(s) from discard to shuffle into your deck'
                            : activePrompt.reason === 'cost:discard-from-hand:1' ||
                                activePrompt.reason?.startsWith('cost:discard-from-hand')
                              ? 'Pay cost — discard one card from your hand'
                              : activePrompt.reason === 'cost:discard-self'
                                ? 'Discard this card to force opponents to discard 2 from hand?'
                                : activePrompt.reason === 'discard:opponents-hand'
                                  ? 'Semiconductor — discard cards from your hand'
                                  : activePrompt.reason === 'retaliate:discard'
                                    ? 'You may discard another invention in Today (or None)'
                        : activePrompt.reason === 'play:choice'
                          ? (() => {
                              const playedId = playedCardIdFromPromptId(
                                activePrompt.id,
                              );
                              const played = G.cards?.[playedId] as
                                | TimestreamsCard
                                | undefined;
                              const playedName =
                                played?.name || playedId || 'this card';
                              const targetKey = `${playedId}:choose-target`;
                              const targetRaw =
                                G.pendingPlayEffect?.choices?.[targetKey];
                              const targetId = Array.isArray(targetRaw)
                                ? targetRaw[0]
                                : targetRaw;
                              const target = targetId
                                ? (G.cards?.[String(targetId)] as
                                    | TimestreamsCard
                                    | undefined)
                                : activePrompt.labelCardId &&
                                    activePrompt.labelCardId !== playedId
                                  ? (G.cards?.[
                                      activePrompt.labelCardId
                                    ] as TimestreamsCard | undefined)
                                  : undefined;
                              const targetName =
                                target?.name ||
                                (typeof targetId === 'string' ? targetId : null);
                              const offTurn =
                                G.pendingPlayEffect &&
                                G.pendingPlayEffect.actorPlayerId !== playerID;
                              if (targetName) {
                                return offTurn
                                  ? `${playedName} — YOUR invention “${targetName}”: discard it from play, OR discard 3 cards from your hand`
                                  : `${playedName} — choose an effect (for ${targetName})`;
                              }
                              return `${playedName} — choose one effect`;
                            })()
                        : activePrompt.reason === 'play:choice-discard'
                          ? 'Choose a card to discard'
                        : activePrompt.reason === 'swap:count:2'
                          ? 'Choose two inventions to swap'
                        : activePrompt.reason === 'swap:different-eras'
                          ? 'Time Jump — choose two inventions in different eras'
                        : activePrompt.reason === 'swap:target:self'
                          ? 'Choose an invention to swap with'
                        : activePrompt.reason === 'crop-swap'
                          ? 'Crop Rotation — swap with an adjacent invention (or None)'
                        : activePrompt.reason === 'play:extra-turn'
                          ? 'Take an extra turn?'
                        : activePrompt.reason === 'score:swap'
                          ? promptMin === 0
                            ? 'Score — you may swap two inventions'
                            : 'Score — swap two inventions'
                        : activePrompt.reason === 'score:guess-secret'
                          ? 'Mysticism — pick a secret number (keep it private)'
                          : activePrompt.reason === 'score:guess' || activePrompt.reason?.startsWith('guess:')
                            ? 'Mysticism — guess the secret number'
                            : activePrompt.reason === 'score:choice'
                              ? 'Choose a score option'
                              : activePrompt.reason === 'score:perform-other'
                                ? 'Choose an invention in Today to perform its score ability'
                                : activePrompt.reason === 'score:steal-perform'
                                  ? 'Choose Nanotech or Quantum Computing to process, then steal to your score pile'
                                : activePrompt.reason === 'score:bonus-copy'
                                  ? 'Choose a card in Today — score bonus equal to its value'
                                : activePrompt.reason === 'score:penalty-target'
                                  ? 'You may choose another Art card — its inventor scores −3 (or skip)'
                                : activePrompt.reason === 'score:move-optional'
                                  ? 'Use this score move ability?'
                                  : activePrompt.reason === 'score:move-target'
                                    ? 'Choose a card in Today to move'
                                    : activePrompt.reason === 'score:move-era'
                                      ? 'Choose a future era (bottom of that era)'
                              : activePrompt.reason === 'react:from:hand' ||
                                  activePrompt.id?.endsWith(':use-react')
                                ? (() => {
                                    const reactorId =
                                      activePrompt.labelCardId ||
                                      playedCardIdFromPromptId(activePrompt.id);
                                    const reactor = G.cards?.[reactorId] as
                                      | TimestreamsCard
                                      | undefined;
                                    const reactorName =
                                      reactor?.name ||
                                      myHand.find((c) => c.id === reactorId)?.name ||
                                      reactorId;
                                    const srcId = (activePrompt as any).eventCardId as
                                      | string
                                      | undefined;
                                    const src = srcId
                                      ? (G.cards?.[srcId] as TimestreamsCard | undefined)
                                      : undefined;
                                    const srcName = src?.name || srcId || 'that Action';
                                    return `React — play ${reactorName} to cancel ${srcName}?`;
                                  })()
                                : activePrompt.reason === 'redirect:optional' ||
                                    activePrompt.id?.endsWith(':redirect-choice')
                                  ? (() => {
                                      const hostId =
                                        activePrompt.labelCardId ||
                                        playedCardIdFromPromptId(activePrompt.id);
                                      const host = G.cards?.[hostId] as
                                        | TimestreamsCard
                                        | undefined;
                                      const hostName = host?.name || hostId;
                                      return `React — redirect discard from ${hostName}? (or take the hit)`;
                                    })()
                                : `Prompt: ${activePrompt.reason}`}
          </div>
          {(activePrompt.reason === 'react:from:hand' ||
            activePrompt.id?.endsWith(':use-react')) && (
            <p style={{ fontSize: 12, margin: '0 0 10px', opacity: 0.9 }}>
              Yes: play this card from hand, cancel the Action&apos;s effects, then discard it.
              No: let the Action resolve.
            </p>
          )}
          {activePrompt.reason === 'play:search-deck' && (
            <p style={{ fontSize: 12, margin: '0 0 10px', opacity: 0.9 }}>
              Select a card, then confirm. That card goes to your hand and the rest of your deck is shuffled.
            </p>
          )}
          {activePrompt.reason === 'play:attach' && (
            <p style={{ fontSize: 12, margin: '0 0 10px', opacity: 0.9 }}>
              Select an invention in Today, then confirm.
            </p>
          )}
          {activePrompt.reason === 'play:move' && (
            <p style={{ fontSize: 12, margin: '0 0 10px', opacity: 0.9 }}>
              {activePrompt.options.includes('move') && activePrompt.options.includes('stay')
                ? 'You may move this card up in Today, or leave it in the slot where it was played.'
                : 'Choose a card to move, or None to skip.'}
            </p>
          )}
          {activePrompt.reason === 'play:choice' && (
            <p style={{ fontSize: 12, margin: '0 0 10px', opacity: 0.9 }}>
              Pick one of the two effects, then confirm.
            </p>
          )}
          {activePrompt.reason === 'play:choice-discard' && (
            <p style={{ fontSize: 12, margin: '0 0 10px', opacity: 0.9 }}>
              Select a card in Today or Tomorrow to discard.
            </p>
          )}
          {(activePrompt.reason === 'recover:from-discard' ||
            activePrompt.reason === 'recover:to-deck' ||
            activePrompt.reason === 'play:recover') && (
            <p style={{ fontSize: 12, margin: '0 0 10px', opacity: 0.9 }}>
              {promptMin === 0
                ? 'Select a discarded card to return, or None / confirm empty to skip.'
                : `Select ${promptMax > 1 ? `up to ${promptMax} cards` : 'a card'} from your discard pile.`}
            </p>
          )}
          {(activePrompt.reason === 'cost:discard-from-hand:1' ||
            activePrompt.reason?.startsWith('cost:discard-from-hand')) && (
            <p style={{ fontSize: 12, margin: '0 0 10px', opacity: 0.9 }}>
              Discard one card from your hand to pay for the recovery.
            </p>
          )}
          {(activePrompt.reason === 'swap:count:2' ||
            activePrompt.reason === 'swap:different-eras') && (
            <p style={{ fontSize: 12, margin: '0 0 10px', opacity: 0.9 }}>
              {activePrompt.reason === 'swap:different-eras'
                ? 'Select exactly two inventions in different ages, then confirm to swap their positions.'
                : 'Select exactly two inventions, then confirm to swap their positions.'}
              {promptSelection.length > 0
                ? ` (${promptSelection.length}/2 selected)`
                : ''}
            </p>
          )}
          {activePrompt.reason === 'play:extra-turn' && (
            <p style={{ fontSize: 12, margin: '0 0 10px', opacity: 0.9 }}>
              You may take an extra turn immediately. During that turn you cannot play an invention
              (Androids restriction when applicable).
            </p>
          )}
          {activePrompt.reason === 'score:swap' && (
            <p style={{ fontSize: 12, margin: '0 0 10px', opacity: 0.9 }}>
              {promptMin === 0
                ? 'You may select two inventions to swap, or confirm with none selected to skip.'
                : 'Select exactly two inventions to swap positions.'}
              {promptSelection.length > 0
                ? ` (${promptSelection.length}/${promptMax} selected)`
                : ''}
            </p>
          )}
          {(activePrompt.reason === 'score:guess-secret' || activePrompt.reason === 'score:guess') && (
            <p style={{ fontSize: 12, margin: '0 0 10px', opacity: 0.9 }}>
              {activePrompt.reason === 'score:guess-secret'
                ? 'Choose a number. Your opponent will try to guess it. Wrong guess awards you that many points; correct guess penalizes you.'
                : 'Choose which number you think was secretly selected.'}
            </p>
          )}

          {/* Dedicated number picker (Mysticism / choose-number) */}
          {(activePrompt.kind === 'choose-number' ||
            activePrompt.reason === 'score:guess' ||
            activePrompt.reason === 'score:guess-secret') && (
            <div
              data-testid="number-picker"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                justifyContent: 'center',
                margin: '12px 0',
              }}
            >
              {activePrompt.options.map((optId: string) => {
                const selected = promptSelection.includes(optId);
                return (
                  <button
                    key={optId}
                    type="button"
                    data-testid={`number-option-${optId}`}
                    onClick={() => togglePromptOption(optId)}
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 12,
                      fontSize: 28,
                      fontWeight: 800,
                      border: selected ? '3px solid #22c55e' : '2px solid #64748b',
                      background: selected ? '#14532d' : '#0f172a',
                      color: '#fef3c7',
                      cursor: 'pointer',
                      boxShadow: selected ? '0 0 0 2px #22c55e55' : undefined,
                    }}
                  >
                    {optId}
                  </button>
                );
              })}
            </div>
          )}

          {/* Card / option grid for non-number prompts */}
          {activePrompt.kind !== 'choose-number' &&
            activePrompt.reason !== 'score:guess' &&
            activePrompt.reason !== 'score:guess-secret' && (() => {
              const locateOptEra = (id: string): EraId | null => {
                if (!id || id === '__none__' || id === '') return null;
                for (const e of ERA_ORDER) {
                  const era = G.timeline[e];
                  if (!era) continue;
                  if (era.stack?.includes(id) || era.actions?.includes(id)) {
                    return e;
                  }
                }
                return null;
              };
              /** Stack/actions order within an era (timeline order), not option-array order. */
              const sortIdsByEraOrder = (eraId: EraId, ids: string[]): string[] => {
                const era = G.timeline[eraId];
                if (!era) return ids;
                const stack = era.stack ?? [];
                const actions = era.actions ?? [];
                return [...ids].sort((a, b) => {
                  const sa = stack.indexOf(a);
                  const sb = stack.indexOf(b);
                  if (sa >= 0 && sb >= 0) return sa - sb;
                  if (sa >= 0) return -1;
                  if (sb >= 0) return 1;
                  const aa = actions.indexOf(a);
                  const ab = actions.indexOf(b);
                  if (aa >= 0 && ab >= 0) return aa - ab;
                  if (aa >= 0) return -1;
                  if (ab >= 0) return 1;
                  return 0;
                });
              };
              // Group any choose-card prompt whose options sit on the timeline
              // (swap, score targets, laser discard, shell game, etc.) so multi-era
              // picks read top→bottom in era order, matching the board.
              const erasHit = new Set<EraId>();
              for (const id of activePrompt.options) {
                const e = locateOptEra(id);
                if (e) erasHit.add(e);
              }
              const groupOptsByEra =
                activePrompt.kind === 'choose-card' && erasHit.size >= 1;
              const eraRows: { era: EraId | null; ids: string[] }[] = [];
              if (groupOptsByEra) {
                const buckets = new Map<EraId | 'other', string[]>();
                for (const id of activePrompt.options) {
                  const e = locateOptEra(id);
                  const key = e ?? 'other';
                  if (!buckets.has(key)) buckets.set(key, []);
                  buckets.get(key)!.push(id);
                }
                for (const e of ERA_ORDER) {
                  if (buckets.has(e)) {
                    eraRows.push({
                      era: e,
                      ids: sortIdsByEraOrder(e, buckets.get(e)!),
                    });
                  }
                }
                if (buckets.has('other')) {
                  eraRows.push({ era: null, ids: buckets.get('other')! });
                }
              } else {
                eraRows.push({ era: null, ids: activePrompt.options });
              }

              const renderOptButton = (optId: string) => {
                const isNone = optId === '__none__' || optId === '';
                const isPlayerOpt =
                  activePrompt.kind === 'choose-option' &&
                  (G.playerOrder || []).includes(optId);
                const isBranchOpt =
                  (optId === 'option-a' || optId === 'option-b') &&
                  (activePrompt.reason === 'score:choice' ||
                    activePrompt.reason === 'play:choice');
                const isMoveOpt =
                  (activePrompt.reason === 'play:move' ||
                    activePrompt.reason === 'move:direction:up-or-down') &&
                  (optId === 'move' ||
                    optId === 'stay' ||
                    optId === 'up' ||
                    optId === 'down');
                const isYesNoOpt =
                  (activePrompt.reason === 'play:extra-turn' ||
                    activePrompt.reason === 'cost:discard-self' ||
                    activePrompt.reason === 'react:from:hand' ||
                    activePrompt.reason === 'score:move-optional' ||
                    activePrompt.id?.endsWith(':use-react') ||
                    activePrompt.kind === 'confirm') &&
                  (optId === 'yes' || optId === 'no');
                const isRedirectOpt =
                  activePrompt.reason === 'redirect:optional' ||
                  activePrompt.id?.endsWith(':redirect-choice');
                const isRedirectTake = isRedirectOpt && optId === 'take';
                const isEraOpt =
                  activePrompt.reason === 'score:move-era' &&
                  (ERA_ORDER as readonly string[]).includes(optId);
                // Option A/B labels come from the card that carries option-a:/option-b: tags.
                // Surgical Strike sets labelCardId = *target* invention (for title copy);
                // Biotechnology sets labelCardId = *copied* card (Laser tags). Prefer the
                // card that actually has branch tags.
                const sourceCard = isBranchOpt
                  ? (() => {
                      const playedId = playedCardIdFromPromptId(activePrompt.id);
                      const labelId = activePrompt.labelCardId;
                      const played = G.cards?.[playedId] as
                        | TimestreamsCard
                        | undefined;
                      const labeled = labelId
                        ? (G.cards?.[labelId] as TimestreamsCard | undefined)
                        : undefined;
                      const hasBranch = (c?: TimestreamsCard) =>
                        (c?.tags ?? []).some(
                          (t) =>
                            t.startsWith('option-a:') || t.startsWith('option-b:'),
                        );
                      if (hasBranch(labeled)) return labeled;
                      if (hasBranch(played)) return played;
                      return labeled || played;
                    })()
                  : undefined;
                // Resolve mental-poker point ciphertexts → pack card ids for labels
                const resolvedOptId =
                  !isNone && !isPlayerOpt && !isBranchOpt && !isMoveOpt && !isYesNoOpt
                    ? resolveCardIdFromPoint(G, optId) || optId
                    : optId;
                const card = (G.cards?.[resolvedOptId] ||
                  G.cards?.[optId] ||
                  {}) as TimestreamsCard;
                const displayName =
                  (card?.name && card.name !== card.id && card.name !== optId
                    ? card.name
                    : null) ||
                  (resolvedOptId !== optId && !resolvedOptId.startsWith('0')
                    ? resolvedOptId
                        .replace(/^[^#]+-/, '')
                        .replace(/#\d+$/, '')
                        .replace(/-/g, ' ')
                    : null) ||
                  (optId.length > 16 && /^[0-9a-fA-F]+$/.test(optId)
                    ? `Encrypted card…${optId.slice(-6)}`
                    : null);
                const selected = promptSelection.includes(optId);
                const pickOrder = selected
                  ? promptSelection.indexOf(optId) + 1
                  : 0;
                const label = isNone
                  ? 'None'
                  : isPlayerOpt
                    ? `Player ${optId}`
                    : isEraOpt
                      ? ERA_LABELS[optId as EraId] || optId
                    : isBranchOpt
                      ? describeChoiceOption(
                          sourceCard,
                          optId as 'option-a' | 'option-b',
                        )
                      : isMoveOpt
                        ? optId === 'move'
                          ? 'Move up'
                          : optId === 'stay'
                            ? 'Leave where played'
                            : optId === 'up'
                              ? 'Move up'
                              : 'Move down'
                      : isYesNoOpt
                        ? activePrompt.reason === 'play:extra-turn'
                          ? optId === 'yes'
                            ? 'Yes — take extra turn'
                            : 'No — end my turn'
                          : activePrompt.reason === 'score:move-optional'
                            ? optId === 'yes'
                              ? 'Yes — move a card'
                              : 'No — skip move'
                          : activePrompt.reason === 'react:from:hand' ||
                              activePrompt.id?.endsWith(':use-react')
                            ? optId === 'yes'
                              ? 'Yes — cancel that Action'
                              : 'No — let it resolve'
                            : optId === 'yes'
                              ? 'Yes'
                              : 'No'
                      : isRedirectTake
                        ? 'Take the hit (this card is discarded)'
                        : isRedirectOpt && (card?.name || displayName)
                          ? `Redirect to ${card.name || displayName}`
                          : card.name && card.name !== optId
                            ? card.name
                            : displayName ||
                              (optId.length > 20
                                ? `${optId.slice(0, 8)}…`
                                : optId);
                const hoverCard =
                  !isNone &&
                  !isPlayerOpt &&
                  !isBranchOpt &&
                  !isMoveOpt &&
                  !isYesNoOpt &&
                  !isRedirectTake &&
                  !isEraOpt &&
                  (card?.id || card?.imageUrl)
                    ? card?.id
                      ? card
                      : null
                    : null;
                const isPeekCardOpt =
                  activePrompt.reason === 'peek:own-to-hand' ||
                  activePrompt.reason === 'discard:opponent-deck-card' ||
                  activePrompt.reason === 'play:search-deck';
                return (
                  <button
                    key={optId || '__empty__'}
                    type="button"
                    data-testid={`prompt-option-${optId || 'none'}`}
                    data-selected={selected ? 'true' : 'false'}
                    data-pick-order={pickOrder || undefined}
                    data-era={locateOptEra(optId) || undefined}
                    title={
                      isNone || isPlayerOpt || isBranchOpt
                        ? undefined
                        : card.name || resolvedOptId || optId
                    }
                    onClick={() => togglePromptOption(optId)}
                    onMouseEnter={() => hoverCard && handleCardHover(hoverCard)}
                    onMouseLeave={() => handleCardHover(null)}
                    onFocus={() => hoverCard && handleCardHover(hoverCard)}
                    onBlur={() => handleCardHover(null)}
                    style={{
                      width:
                        isPlayerOpt ||
                        isNone ||
                        isBranchOpt ||
                        isMoveOpt ||
                        isYesNoOpt ||
                        isRedirectTake ||
                        isEraOpt
                          ? isBranchOpt || isYesNoOpt || isRedirectTake || isEraOpt
                            ? 220
                            : 140
                          : isPeekCardOpt
                            ? 128
                          : 110,
                      maxWidth: isPeekCardOpt ? 140 : undefined,
                      minHeight:
                        isBranchOpt || isMoveOpt || isYesNoOpt || isRedirectTake || isEraOpt
                          ? 56
                          : isPeekCardOpt
                            ? 72
                          : undefined,
                      padding: 6,
                      borderRadius: 6,
                      border: selected ? '2px solid #22c55e' : '1px solid #64748b',
                      background: selected ? '#14532d' : '#0f172a',
                      color: '#e2e8f0',
                      cursor: 'pointer',
                      textAlign: 'left',
                      position: 'relative',
                      overflow: 'hidden',
                      flexShrink: 0,
                    }}
                  >
                    {isMultiSelectPrompt && selected && (
                      <span
                        style={{
                          position: 'absolute',
                          top: 4,
                          right: 4,
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: '#22c55e',
                          color: '#0f172a',
                          fontSize: 11,
                          fontWeight: 800,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {pickOrder}
                      </span>
                    )}
                    {!isNone &&
                    !isPlayerOpt &&
                    !isBranchOpt &&
                    !isMoveOpt &&
                    !isYesNoOpt &&
                    !isEraOpt &&
                    card.imageUrl ? (
                      <div
                        style={{
                          width: '100%',
                          height: 148,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 4,
                          marginBottom: 4,
                          background: '#0b1220',
                          overflow: 'hidden',
                        }}
                      >
                        <img
                          src={card.imageUrl}
                          alt={label}
                          onError={(e) => {
                            // Hide broken art (wrong path / missing deploy file)
                            (e.currentTarget as HTMLImageElement).style.display =
                              'none';
                          }}
                          style={{
                            maxWidth: '100%',
                            maxHeight: '100%',
                            width: 'auto',
                            height: 'auto',
                            objectFit: 'contain',
                            objectPosition: 'center',
                            display: 'block',
                          }}
                        />
                      </div>
                    ) : null}
                    <div
                      style={{
                        fontSize:
                          isBranchOpt || isMoveOpt || isYesNoOpt || isEraOpt
                            ? 13
                            : 11,
                        fontWeight: 600,
                        wordBreak: 'break-word',
                        lineHeight: 1.25,
                      }}
                    >
                      {label}
                    </div>
                    {!isNone &&
                      !isPlayerOpt &&
                      !isBranchOpt &&
                      !isMoveOpt &&
                      !isYesNoOpt &&
                      !isEraOpt && (
                        <div style={{ fontSize: 10, color: '#94a3b8' }}>
                          {formatCardCaption(card, {
                            eraLabel: locateOptEra(optId)
                              ? ERA_LABELS[locateOptEra(optId)!]
                              : undefined,
                          })}
                        </div>
                      )}
                  </button>
                );
              };

              return (
                <div
                  data-testid="prompt-options-panel"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    maxHeight: 420,
                    overflowY: 'auto',
                  }}
                >
                  {eraRows.map((row) => (
                    <div
                      key={row.era || 'other'}
                      data-testid={
                        row.era
                          ? `prompt-era-row-${row.era}`
                          : 'prompt-era-row-other'
                      }
                    >
                      {groupOptsByEra && (
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#94a3b8',
                            marginBottom: 4,
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                          }}
                        >
                          {row.era ? ERA_LABELS[row.era] : 'Other'}
                          <span style={{ fontWeight: 400, marginLeft: 6 }}>
                            ({row.ids.length})
                          </span>
                        </div>
                      )}
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 8,
                          padding: groupOptsByEra ? '6px 4px' : 0,
                          borderRadius: 6,
                          background: groupOptsByEra ? '#0f172a88' : undefined,
                          border: groupOptsByEra
                            ? '1px solid #334155'
                            : undefined,
                        }}
                      >
                        {row.ids.map((optId) => renderOptButton(optId))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
            <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                data-testid="confirm-prompt"
                disabled={!selectionReady}
                onClick={handleConfirmPrompt}
                style={{
                  padding: '8px 16px',
                  background: selectionReady ? '#22c55e' : '#475569',
                  color: '#0f172a',
                  border: 'none',
                  borderRadius: 4,
                  fontWeight: 700,
                  cursor: selectionReady ? 'pointer' : 'not-allowed',
                }}
              >
                Confirm choice
              </button>
              {promptSelection.length > 0 && (
                <span
                  style={{ fontSize: 12, wordBreak: 'break-word', maxWidth: '70%' }}
                  data-testid="prompt-selection-label"
                >
                  Selected:{' '}
                  {promptSelection
                    .map((id) => {
                      if (id === '__none__' || id === '') return 'None';
                      const resolved = resolveCardIdFromPoint(G, id) || id;
                      const c =
                        (G.cards?.[resolved] as TimestreamsCard | undefined) ||
                        (G.cards?.[id] as TimestreamsCard | undefined);
                      if (c?.name && c.name !== id && c.name !== resolved) return c.name;
                      if (
                        id.length > 16 &&
                        /^[0-9a-fA-F]+$/.test(id)
                      ) {
                        return c?.name || `Card …${id.slice(-6)}`;
                      }
                      return c?.name || resolved;
                    })
                    .join(', ')}
                </span>
              )}
            </div>
            </>
          )}
        </div>
      )}

      {/* Zoomed Card View */}
      <div
        style={{
          marginTop: '20px',
          padding: '12px',
          border: '2px solid #334155',
          borderRadius: '8px',
          background: '#1e2937',
          minHeight: '120px',
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '14px' }}>
          Card detail (hover a card)
        </div>
        {hoveredCard ? (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
            {hoveredCard.imageUrl && (
              <div
                style={{
                  width: 200,
                  height: 280,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  border: '2px solid #475569',
                  background: '#0b1220',
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                <img
                  src={hoveredCard.imageUrl}
                  alt={hoveredCard.name || hoveredCard.id}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                    objectPosition: 'center',
                    display: 'block',
                  }}
                />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 180, whiteSpace: 'pre-wrap' }}>
              <strong>{hoveredCard.name || hoveredCard.id}</strong>
              <div style={{ color: '#94a3b8', marginTop: 4, fontSize: 11 }}>
                {formatCardCaption(hoveredCard)}
              </div>
              <div style={{ color: '#94a3b8', marginTop: 4 }}>{composeCardText(hoveredCard)}</div>
            </div>
          </div>
        ) : (
          <div style={{ color: '#64748b', fontSize: '12px' }}>
            Hover a card in the timeline or your hand.
          </div>
        )}
      </div>

      <div style={{ marginTop: '12px', fontSize: '11px', color: '#64748b' }}>
        Mode: {G.config?.playMode || 'plaintext'} · Rules:{' '}
        {G.config?.rulesEnabled === false ? 'OFF' : 'ON'}
        {G.packName ? ` · Pack: ${G.packName}` : ''} · G.phase: {G.phase} · ctx.phase:{' '}
        {String(ctx.phase)} · current: {currentPlayer}
      </div>
    </div>
  );
};

export default TimestreamsBoard;
