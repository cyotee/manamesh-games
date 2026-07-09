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
import { ERA_ORDER, composeCardText } from '../types';
import {
  hashSeedCommit,
  peelDecryptShare,
  buildEncryptionLayer,
  buildDeckOpReencryptLayer,
} from '../crypto';
import { generateKeyPair } from '@manamesh/boardgameio-crypto/mental-poker';
import { canPlayCard } from '../effects/gates';
import { describeChoiceOption } from '../effects/executors/choice';
import {
  computeScoringSlotsForEra,
  scoringSlotModifierNotes,
} from '../scoring';

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
  const keyPairRef = React.useRef<{ publicKey: string; privateKey: string } | null>(null);
  const shuffleSeedRef = React.useRef<string | null>(null);
  const deckOpSeedRef = React.useRef<string | null>(null);
  const encryptBusyRef = React.useRef(false);
  const deckOpBusyRef = React.useRef(false);

  const currentPlayer = ctx.currentPlayer;
  const isMyTurn = currentPlayer === playerID;
  const activeEraIndex = Math.max(0, Math.min((G.currentDay || 1) - 1, ERA_ORDER.length - 1));
  const activeEra = ERA_ORDER[activeEraIndex];
  const myPlayer = playerID ? G.players[playerID] : undefined;
  const myHand = myPlayer?.hand ?? [];
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
  const isMyPrompt = !!activePrompt && activePrompt.deciderId === playerID;
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
          const preEncrypted = buildEncryptionLayer(G, kp.privateKey);
          await yieldToMain();
          // Preferred: pre-encrypted decks (null privateKey). Master stays responsive.
          moves.encryptDeck(null, preEncrypted);
        } catch (err) {
          console.error('[TimestreamsBoard] encrypt failed, retrying with privateKey', err);
          try {
            moves.encryptDeck(kp.privateKey, null);
          } catch (err2) {
            console.error('[TimestreamsBoard] encrypt fallback failed', err2);
            setupAttemptRef.current.delete(actionKey);
          }
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

    // --- Automatic cooperative decrypt during play (draws + deck search) ---
    if ((phase === 'play' || phase === 'scoring') && moves.submitDecryptionShare) {
      if (isCryptoSetupPhase) {
        /* keep setup status */
      } else if (!G.activeDeckOp) {
        setCryptoStatus(null);
      }
      const pending = (G.pendingDecryptRequests ?? []).filter((r) => !r.materialized);
      for (const req of pending) {
        const next = req.requiredLayers[req.currentLayer];
        if (next !== playerID) continue;
        const peelKey = `peel:${req.id}:${req.currentLayer}:${playerID}`;
        if (setupAttemptRef.current.has(peelKey)) continue;
        setupAttemptRef.current.add(peelKey);
        const card = G.encryptedDecks[req.deckOwnerId]?.[req.cardIndex];
        if (!card || card.layers === 0) continue;
        const kp = getKeys();
        if (!kp) {
          setupAttemptRef.current.delete(peelKey);
          continue;
        }
        try {
          const share = peelDecryptShare(card, kp.privateKey);
          setTimeout(() => {
            try {
              moves.submitDecryptionShare(req.id, share);
            } catch (err) {
              console.error('[TimestreamsBoard] submitDecryptionShare failed', err);
              setupAttemptRef.current.delete(peelKey);
            }
          }, 10);
        } catch (err) {
          console.error('[TimestreamsBoard] decrypt peel failed', err);
          setupAttemptRef.current.delete(peelKey);
        }
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
                const layer = buildDeckOpReencryptLayer(G, kp.privateKey);
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
    G.encryptedDecks,
    G.activeDeckOp,
    playerID,
    moves,
    isCryptoSetupPhase,
    isActive,
    ctx.activePlayers,
    ctx.currentPlayer,
  ]);

  const showHand = teachingMode || myHand.length > 0 || isPlayPhase;

  const handleCardHover = (card: TimestreamsCard | null) => {
    setHoveredCard(card);
  };

  const handlePlayInvention = (cardId: string) => {
    // Block new plays while a rules prompt is open.
    if (activePrompt) return;
    if (isMyTurn && moves.playInvention) moves.playInvention(cardId);
  };

  const handlePlayAction = (cardId: string) => {
    if (activePrompt) return;
    if (isMyTurn && moves.playAction) moves.playAction(cardId);
  };

  const handlePass = () => {
    if (isMyTurn && moves.pass && !activePrompt) moves.pass();
  };

  const isScorePhasePrompt =
    G.phase === 'scoring' ||
    ctx.phase === 'scoring' ||
    activePrompt?.reason === 'score:guess' ||
    activePrompt?.reason === 'score:guess-secret' ||
    activePrompt?.reason === 'score:choice' ||
    activePrompt?.reason === 'score:swap' ||
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
    // play:move can be on inventions (Air Cars) or actions — prefer cardType.
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

      {/* Non-blocking activity log (decrypt notices, deals, system) */}
      {(G.activityLog?.length ?? 0) > 0 && (
        <div
          data-testid="activity-log"
          style={{
            marginBottom: 10,
            padding: '6px 10px',
            maxHeight: 88,
            overflowY: 'auto',
            background: '#0b1220',
            border: '1px solid #1e2937',
            borderRadius: 6,
            fontSize: 11,
            color: '#94a3b8',
            lineHeight: 1.45,
          }}
        >
          <div style={{ fontWeight: 700, color: '#64748b', marginBottom: 4, fontSize: 10, letterSpacing: 0.4 }}>
            ACTIVITY
          </div>
          {(G.activityLog ?? []).slice(-12).map((entry) => (
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
                        : '#94a3b8',
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
              ? 'Scoring — all eras (step by step)'
              : 'Game over'}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
            {(G.playerOrder || []).map((pid) => (
              <div key={pid} data-testid={`score-player-${pid}`}>
                P{pid}
                {pid === playerID ? ' (you)' : ''}:{' '}
                {G.phase === 'scoring' || ctx.phase === 'scoring' ? (
                  <strong data-testid={`score-pending-${pid}`} style={{ opacity: 0.7 }}>
                    pending
                  </strong>
                ) : (
                  <strong>{G.scores?.[pid] ?? 0}</strong>
                )}
                {G.winner === pid ? ' — winner' : ''}
              </div>
            ))}
          </div>

          {G.scoringWalk && (G.phase === 'scoring' || ctx.phase === 'scoring') && (
            <div data-testid="scoring-walk-banner" style={{ fontSize: 13 }}>
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
              {G.scoringWalk.stepPhase === 'ack' && (
                <div
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
                    Acks:{' '}
                    {(G.playerOrder || []).map((pid) => (
                      <span key={pid} style={{ marginRight: 8 }}>
                        P{pid}
                        {G.scoringWalk!.acks[pid] ? '✓' : '…'}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 11, opacity: 0.75 }}>
                Green = processed · Gold = current · Both players OK each card.
                Final totals only after every card (later effects can change remaining
                slots — Wonky rule). Stone → Future.
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
        Mid-game rules toggle — fixed corner, out of document flow.
        A mid-page checkbox was re-scrolled into view on every board re-render.
      */}
      <div
        data-testid="rules-midgame-toggle"
        style={{
          position: 'fixed',
          right: 12,
          // Offset dual-seat second board so toggles don't stack exactly.
          bottom: 12 + (Number(playerID) || 0) * 76,
          zIndex: 40,
          maxWidth: 280,
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
          disabled={!moves?.setRulesEnabled}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (!moves?.setRulesEnabled) return;
            // Toggle: if currently disabled (false), re-enable; else disable.
            moves.setRulesEnabled(G.config?.rulesEnabled === false);
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
            cursor: moves?.setRulesEnabled ? 'pointer' : 'not-allowed',
            textAlign: 'left',
            font: 'inherit',
          }}
          title="Toggle rules engine mid-game"
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
            ? 'Structural play only. Click to re-enable full rules.'
            : 'Full rules. Click to disable if the engine errors.'}
        </span>
      </div>

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
          const isScoringEra =
            (G.phase === 'scoring' || ctx.phase === 'scoring') &&
            walk?.currentCardId &&
            walk.steps[walk.stepIndex]?.eraId === era;

          return (
            <div
              key={era}
              className="ts-era-column"
              data-era={era}
              data-scoring-slots={slots}
              data-scoring-active={isScoringEra ? 'true' : 'false'}
              style={{
                minWidth: '140px',
                border: isScoringEra
                  ? '3px solid #eab308'
                  : isActive
                    ? '3px solid #38bdf8'
                    : '1px solid #334155',
                borderRadius: '6px',
                padding: '6px',
                background: isScoringEra
                  ? '#422006'
                  : isActive
                    ? '#0c4a6e'
                    : '#1e2937',
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
                    ? `Base ${baseSlots}; ${slotNotes.join(', ')}`
                    : `Base scoring slots: ${baseSlots}`
                }
              >
                Slots: {Math.min(slots, stack.length)} / {slots}
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
                    const card = G.cards?.[cardId] as TimestreamsCard | undefined;
                    const label = card?.name || cardId.split('#')[0] || cardId;
                    const inScoringSlot = i < slots;
                    const processed =
                      G.scoringWalk?.processedCardIds?.includes(cardId) ?? false;
                    const isCurrent =
                      G.scoringWalk?.currentCardId === cardId;
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
                        style={{
                          padding: '2px 4px',
                          borderBottom: '1px solid #1e2937',
                          opacity: inScoringSlot || isCurrent || processed ? 1 : 0.55,
                          borderRadius: 4,
                          background: isCurrent
                            ? '#854d0e'
                            : processed
                              ? '#14532d'
                              : 'transparent',
                          outline: isCurrent
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
                        >
                          {i + 1}. {label}
                          {processed ? ' ✓' : ''}
                          {isCurrent ? ' ◀' : ''}
                          {!inScoringSlot && !processed && !isCurrent ? ' (past slots)' : ''}
                        </div>
                        {attachedIds.map((attId) => {
                          const att = G.cards?.[attId] as TimestreamsCard | undefined;
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
                          return (
                            <div
                              key={attId}
                              data-testid={`timeline-attachment-${attId}`}
                              data-host={cardId}
                              style={{
                                paddingLeft: 14,
                                color: '#a5b4fc',
                                fontSize: 10,
                                cursor: 'pointer',
                              }}
                              onMouseEnter={() => handleCardHover(attCard)}
                              onMouseLeave={() => handleCardHover(null)}
                            >
                              - {attLabel}
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

      {/* Hand and Controls */}
      {showHand && (
        <div
          data-testid="player-hand"
          style={{ marginTop: '8px', padding: '8px', border: '1px solid #334155', borderRadius: '4px', background: '#1e2937' }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>
            Your Hand (P{playerID}) — {myHand.length} cards
            {isMyTurn && isPlayPhase ? ' — Your turn' : ''}
            {!isMyTurn && isPlayPhase ? ` — Waiting for P${currentPlayer}` : ''}
          </div>

          {myHand.length === 0 ? (
            <div style={{ color: '#94a3b8', fontSize: '12px' }}>
              {isSetupPhase || isCryptoPhase ? 'Cards deal after setup completes.' : 'No cards in hand'}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {myHand.map((card: TimestreamsCard, idx: number) => (
                <div
                  key={`${card.id}-${idx}`}
                  data-card-id={card.id}
                  style={{
                    border: '1px solid #64748b',
                    padding: '6px',
                    fontSize: '11px',
                    background: '#0f172a',
                    borderRadius: 4,
                    width: card.imageUrl ? 120 : 110,
                  }}
                  onMouseEnter={() => handleCardHover(card)}
                  onMouseLeave={() => handleCardHover(null)}
                >
                  {card.imageUrl ? (
                    <div
                      style={{
                        width: '100%',
                        height: 168,
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
                        alt={card.name || card.id}
                        style={{
                          maxWidth: '100%',
                          maxHeight: '100%',
                          width: 'auto',
                          height: 'auto',
                          objectFit: 'contain',
                          objectPosition: 'center',
                          display: 'block',
                        }}
                        loading="lazy"
                      />
                    </div>
                  ) : null}
                  <div style={{ fontWeight: 600 }}>{card.name || card.id}</div>
                  <div style={{ color: '#94a3b8', fontSize: 10 }}>{card.cardType}</div>
                  <div style={{ marginTop: '4px' }}>
                    {card.cardType === 'invention' && (
                      <button
                        data-testid={`play-invention-${card.id}`}
                        onClick={() => handlePlayInvention(card.id)}
                        disabled={
                          !isMyTurn ||
                          !isPlayPhase ||
                          !!activePrompt ||
                          (G.config?.rulesEnabled !== false &&
                            !canPlayCard(G, playerID || '', card.id).ok)
                        }
                        style={{ fontSize: '10px', marginRight: '4px' }}
                      >
                        Play Invention
                      </button>
                    )}
                    {card.cardType === 'action' && (
                      <button
                        data-testid={`play-action-${card.id}`}
                        onClick={() => handlePlayAction(card.id)}
                        disabled={
                          !isMyTurn ||
                          !isPlayPhase ||
                          !!activePrompt ||
                          (G.config?.rulesEnabled !== false &&
                            !canPlayCard(G, playerID || '', card.id).ok)
                        }
                        title={
                          G.config?.rulesEnabled !== false &&
                          playerID &&
                          !canPlayCard(G, playerID, card.id).ok
                            ? canPlayCard(G, playerID, card.id).reason
                            : undefined
                        }
                        style={{ fontSize: '10px' }}
                      >
                        Play Action
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: '10px' }}>
            <button
              data-testid="pass-turn"
              onClick={handlePass}
              disabled={!isMyTurn || !isPlayPhase}
              style={{ padding: '6px 12px', marginRight: '8px' }}
            >
              Pass
            </button>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              Play one invention, one action, or pass each turn.
            </span>
          </div>
        </div>
      )}

      {/* Rules prompts — options only for the decider (private decks / choices). */}
      {activePrompt && (
        <div
          data-testid="rules-prompt"
          style={{
            marginTop: 12,
            padding: 12,
            border: '2px solid #eab308',
            borderRadius: 8,
            background: isMyPrompt ? '#422006' : '#1e2937',
            color: '#fef3c7',
          }}
        >
          {!isMyPrompt ? (
            <div style={{ fontWeight: 700 }} data-testid="prompt-waiting">
              Waiting for P{activePrompt.deciderId} to complete a card choice…
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
                        : activePrompt.reason === 'play:choice'
                          ? 'Choose one effect'
                        : activePrompt.reason === 'play:choice-discard'
                          ? 'Choose a card to discard'
                        : activePrompt.reason === 'swap:count:2'
                          ? 'Choose two inventions to swap'
                        : activePrompt.reason === 'swap:different-eras'
                          ? 'Time Jump — choose two inventions in different eras'
                        : activePrompt.reason === 'swap:target:self'
                          ? 'Choose an invention to swap with'
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
            activePrompt.reason !== 'score:guess-secret' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
              {activePrompt.options.map((optId: string) => {
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
                    activePrompt.id?.endsWith(':use-react') ||
                    activePrompt.kind === 'confirm') &&
                  (optId === 'yes' || optId === 'no');
                // Prefer the ability source (copied card) so option labels
                // re-read that card's tags, not Biotechnology's empty options.
                const sourceCard = isBranchOpt
                  ? (G.cards?.[
                      activePrompt.labelCardId ||
                        playedCardIdFromPromptId(activePrompt.id)
                    ] as TimestreamsCard | undefined)
                  : undefined;
                const card = (G.cards?.[optId] || {}) as TimestreamsCard;
                const selected = promptSelection.includes(optId);
                const pickOrder = selected
                  ? promptSelection.indexOf(optId) + 1
                  : 0;
                const label = isNone
                  ? 'None'
                  : isPlayerOpt
                    ? `Player ${optId}`
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
                          : activePrompt.reason === 'react:from:hand' ||
                              activePrompt.id?.endsWith(':use-react')
                            ? optId === 'yes'
                              ? 'Yes — cancel that Action'
                              : 'No — let it resolve'
                            : optId === 'yes'
                              ? 'Yes'
                              : 'No'
                      : card.name || optId;
                const hoverCard =
                  !isNone &&
                  !isPlayerOpt &&
                  !isBranchOpt &&
                  !isMoveOpt &&
                  !isYesNoOpt &&
                  card?.id
                    ? card
                    : null;
                return (
                  <button
                    key={optId || '__empty__'}
                    type="button"
                    data-testid={`prompt-option-${optId || 'none'}`}
                    data-selected={selected ? 'true' : 'false'}
                    data-pick-order={pickOrder || undefined}
                    onClick={() => togglePromptOption(optId)}
                    onMouseEnter={() => hoverCard && handleCardHover(hoverCard)}
                    onMouseLeave={() => handleCardHover(null)}
                    onFocus={() => hoverCard && handleCardHover(hoverCard)}
                    onBlur={() => handleCardHover(null)}
                    style={{
                      width:
                        isPlayerOpt || isNone || isBranchOpt || isMoveOpt || isYesNoOpt
                          ? isBranchOpt || isYesNoOpt
                            ? 200
                            : 140
                          : 110,
                      minHeight: isBranchOpt || isMoveOpt || isYesNoOpt ? 56 : undefined,
                      padding: 6,
                      borderRadius: 6,
                      border: selected ? '2px solid #22c55e' : '1px solid #64748b',
                      background: selected ? '#14532d' : '#0f172a',
                      color: '#e2e8f0',
                      cursor: 'pointer',
                      textAlign: 'left',
                      position: 'relative',
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
                    {!isNone && !isPlayerOpt && !isBranchOpt && !isMoveOpt && !isYesNoOpt && card.imageUrl ? (
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
                    <div style={{ fontSize: isBranchOpt || isMoveOpt || isYesNoOpt ? 13 : 11, fontWeight: 600 }}>{label}</div>
                    {!isNone && !isPlayerOpt && !isBranchOpt && !isMoveOpt && !isYesNoOpt && (
                      <div style={{ fontSize: 10, color: '#94a3b8' }}>{card.cardType || ''}</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
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
                <span style={{ fontSize: 12 }} data-testid="prompt-selection-label">
                  Selected:{' '}
                  {promptSelection
                    .map(
                      (id) =>
                        (G.cards?.[id] as TimestreamsCard | undefined)?.name || id,
                    )
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
