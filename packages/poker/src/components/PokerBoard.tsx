/**
 * Poker Board Component
 *
 * Texas Hold'em game board with betting controls.
 * Uses wallet-derived keys for cryptographic fairness when available.
 * Loads card images from IPFS asset packs with text fallback.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { BoardProps } from 'boardgame.io/react';
import type { PokerState, PokerCard, PokerPhase, CryptoPokerPhase, PokerHandResult, DecryptRequest, DecryptNotification } from '../types';
import type { CryptoPokerState, CryptoPokerPlayerState } from '../types';
import { CryptoTransparencyPanel } from '@manamesh/frontend/src/components/CryptoTransparencyPanel';
import type { CryptoPluginState } from '@manamesh/crypto/plugin/crypto-plugin';
import { generateKeyPair } from '@manamesh/crypto/mental-poker';
import type { CryptoKeyPair } from '@manamesh/crypto/mental-poker/types';
import { useGameKeys } from '@manamesh/frontend/src/blockchain/wallet';
import { useAssetPack } from '@manamesh/frontend/src/hooks/useAssetPack';
import { useCardImage } from '@manamesh/frontend/src/hooks/useCardImage';
import { useCardSettings } from '@manamesh/frontend/src/hooks/useCardSettings';
import { CARD_BACK_ID } from '@manamesh/frontend/src/assets/packs/standard-cards';
import type { IPFSZipSource } from '@manamesh/frontend/src/assets/loader/types';
import { CardSettingsPanel } from '@manamesh/frontend/src/components/CardSettingsPanel';

interface PokerBoardProps extends BoardProps<PokerState> {
  /**
   * Callback when player wants to start a new hand.
   * Called with the hand result for blockchain settlement.
   * Parent component should settle the pot and create a new game instance.
   */
  onNewHand?: (handResult: PokerHandResult) => void;
}

const SUIT_SYMBOLS: Record<string, string> = {
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
  spades: '\u2660',
};

const SUIT_COLORS: Record<string, string> = {
  hearts: '#e74c3c',
  diamonds: '#e74c3c',
  clubs: '#2c3e50',
  spades: '#2c3e50',
};

/**
 * CardDisplay component that renders card images from IPFS asset pack.
 * Falls back to text rendering if images are not yet loaded or useImages is false.
 */
const CardDisplay: React.FC<{
  card: PokerCard;
  faceDown?: boolean;
  small?: boolean;
  packId: string | null;
  useImages?: boolean;
}> = ({ card, faceDown, small, packId, useImages = true }) => {
  const width = small ? 50 : 70;
  const height = small ? 70 : 100;

  // Load card image from asset pack (only if images are enabled)
  // For face-down cards, load the shared back image
  // For face-up cards, load the card's front image using its ID (e.g., 'clubs-A')
  const cardId = faceDown ? CARD_BACK_ID : card?.id ?? null;
  const { url, isLoading } = useCardImage(useImages ? packId : null, cardId, 'front');

  // Face down card
  if (faceDown) {
    if (useImages && url) {
      return (
        <img
          src={url}
          alt="Card back"
          style={{
            width,
            height,
            borderRadius: '8px',
            margin: '4px',
            objectFit: 'cover',
          }}
        />
      );
    }

    // Fallback: pattern background for face-down cards
    return (
      <div style={{
        width,
        height,
        backgroundColor: '#1a365d',
        border: '2px solid #3182ce',
        borderRadius: '8px',
        margin: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundImage: 'repeating-linear-gradient(45deg, #2a4365, #2a4365 10px, #1a365d 10px, #1a365d 20px)',
      }}>
        <span style={{ fontSize: small ? '16px' : '24px', color: '#63b3ed' }}>🂠</span>
      </div>
    );
  }

  // Face up card with image
  if (useImages && url) {
    return (
      <img
        src={url}
        alt={`${card.rank} of ${card.suit}`}
        style={{
          width,
          height,
          borderRadius: '8px',
          margin: '4px',
          objectFit: 'cover',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        }}
      />
    );
  }

  // Fallback: text-based card rendering (loading or no image available)
  return (
    <div style={{
      width,
      height,
      backgroundColor: '#fff',
      border: '2px solid #ccc',
      borderRadius: '8px',
      margin: '4px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      position: 'relative',
    }}>
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: 2,
          right: 2,
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: '#4a9eff',
        }} />
      )}
      <span style={{
        fontSize: small ? '18px' : '24px',
        fontWeight: 'bold',
        color: SUIT_COLORS[card.suit],
      }}>
        {card.rank}
      </span>
      <span style={{
        fontSize: small ? '20px' : '28px',
        color: SUIT_COLORS[card.suit],
      }}>
        {SUIT_SYMBOLS[card.suit]}
      </span>
    </div>
  );
};

const PlayerPanel: React.FC<{
  playerId: string;
  player: PokerState['players'][string];
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isActive: boolean;
  isCurrentUser: boolean;
  showCards: boolean;
  encryptedCardCount?: number;
  peekedCards?: PokerCard[];
  packId: string | null;
  useImages?: boolean;
}> = ({ playerId, player, isDealer, isSmallBlind, isBigBlind, isActive, isCurrentUser, showCards, encryptedCardCount = 0, peekedCards, packId, useImages = true }) => {
  return (
    <div style={{
      padding: '16px',
      backgroundColor: isActive ? '#1e4d2b' : isCurrentUser ? '#1e2a45' : '#16213e',
      borderRadius: '12px',
      border: isActive ? '2px solid #4CAF50' : '1px solid #3a3a5c',
      margin: '8px',
      minWidth: '180px',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 'bold', color: '#e4e4e4' }}>
            Player {playerId} {isCurrentUser && '(You)'}
          </span>
          {player.folded && (
            <span style={{
              fontSize: '10px',
              padding: '2px 6px',
              backgroundColor: '#7f1d1d',
              color: '#fca5a5',
              borderRadius: '4px',
            }}>
              FOLDED
            </span>
          )}
          {player.isAllIn && (
            <span style={{
              fontSize: '10px',
              padding: '2px 6px',
              backgroundColor: '#7c3aed',
              color: '#c4b5fd',
              borderRadius: '4px',
            }}>
              ALL-IN
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {isDealer && (
            <span style={{
              fontSize: '10px',
              padding: '2px 6px',
              backgroundColor: '#f59e0b',
              color: '#1f2937',
              borderRadius: '4px',
              fontWeight: 'bold',
            }}>D</span>
          )}
          {isSmallBlind && (
            <span style={{
              fontSize: '10px',
              padding: '2px 6px',
              backgroundColor: '#3b82f6',
              color: '#fff',
              borderRadius: '4px',
            }}>SB</span>
          )}
          {isBigBlind && (
            <span style={{
              fontSize: '10px',
              padding: '2px 6px',
              backgroundColor: '#ef4444',
              color: '#fff',
              borderRadius: '4px',
            }}>BB</span>
          )}
        </div>
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '12px',
        color: '#a0a0a0',
        fontSize: '14px',
      }}>
        <span>Chips: <strong style={{ color: '#fbbf24' }}>{player.chips}</strong></span>
        {player.bet > 0 && (
          <span>Bet: <strong style={{ color: '#4ade80' }}>{player.bet}</strong></span>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        {/* Show peeked cards if available (decrypted hole cards) */}
        {peekedCards && peekedCards.length > 0 ? (
          peekedCards.map(card => (
            <CardDisplay key={card.id} card={card} small packId={packId} useImages={useImages} />
          ))
        ) : player.hand.length > 0 ? (
          showCards ? (
            player.hand.map(card => (
              <CardDisplay key={card.id} card={card} small packId={packId} useImages={useImages} />
            ))
          ) : (
            player.hand.map((_, i) => (
              <CardDisplay key={i} card={{} as PokerCard} faceDown small packId={packId} useImages={useImages} />
            ))
          )
        ) : encryptedCardCount > 0 ? (
          /* Show encrypted cards as face-down */
          Array.from({ length: encryptedCardCount }).map((_, i) => (
            <CardDisplay key={i} card={{} as PokerCard} faceDown small packId={packId} useImages={useImages} />
          ))
        ) : (
          <span style={{ color: '#6a6a8a', fontSize: '12px' }}>No cards</span>
        )}
      </div>
    </div>
  );
};

// Support both standard and crypto poker phases
const PHASE_LABELS: Record<PokerPhase | CryptoPokerPhase, string> = {
  // Standard phases
  waiting: 'Waiting to Start',
  preflop: 'Pre-Flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
  gameOver: 'Hand Complete',
  // Crypto setup phases
  keyExchange: '🔐 Key Exchange',
  encrypt: '🔐 Encrypting Deck',
  shuffle: '🔐 Shuffling Deck',
  voided: '⚠️ Game Voided',
};

export const PokerBoard: React.FC<PokerBoardProps> = ({
  G,
  ctx,
  moves,
  playerID,
  onNewHand,
}) => {
  // Card rendering settings (HTML text vs IPFS images)
  const { useImages, effectiveCid } = useCardSettings();

  // Create dynamic asset source based on settings
  const assetSource: IPFSZipSource | null = useImages
    ? { type: 'ipfs-zip', cid: effectiveCid }
    : null;

  // Load card asset pack from IPFS (only if images are enabled)
  const { packId, isLoading: packLoading, progress: packProgress, error: packError } = useAssetPack(assetSource);

  // Debug: Expose full state to window
  useEffect(() => {
    (window as any).__POKER_G__ = G;
    (window as any).__POKER_CTX__ = ctx;
    console.log('[PokerBoard] G.phase:', G.phase, 'ctx.phase:', ctx.phase);
    console.log('[PokerBoard] Asset pack:', packId, 'loading:', packLoading, 'progress:', packProgress);
  }, [G, ctx, packId, packLoading, packProgress]);

  const [betAmount, setBetAmount] = useState<number>(G.bigBlindAmount);
  const currentPlayerID = playerID || '0';
  const myPlayer = G.players[currentPlayerID];
  const isMyTurn = G.bettingRound.activePlayer === currentPlayerID;
  const canAct = isMyTurn && !myPlayer?.folded && !myPlayer?.isAllIn;

  const callAmount = G.bettingRound.currentBet - (myPlayer?.bet || 0);
  const minBet = G.bigBlindAmount;
  const minRaise = G.bettingRound.currentBet + G.bettingRound.minRaise;

  // Crypto key pair - use ref for synchronous access, state for re-renders
  const cryptoKeyPairRef = useRef<CryptoKeyPair | null>(null);
  const [cryptoKeyPair, setCryptoKeyPair] = useState<CryptoKeyPair | null>(null);
  const cryptoSetupInProgress = useRef<Set<string>>(new Set());

  // Cast to crypto state for checking crypto-specific properties
  const cryptoG = G as unknown as CryptoPokerState;
  const myCryptoPlayer = cryptoG.players?.[currentPlayerID] as CryptoPokerPlayerState | undefined;

  // Get wallet-derived keys for this game (if available)
  // Falls back to random keys if wallet not connected
  const gameId = cryptoG.handId || null;
  const walletDerivedKeys = useGameKeys(gameId);

  // Apply wallet-derived keys when they become available
  useEffect(() => {
    if (walletDerivedKeys && !cryptoKeyPairRef.current) {
      const keyPair: CryptoKeyPair = {
        privateKey: walletDerivedKeys.privateKey,
        publicKey: walletDerivedKeys.publicKey,
      };
      cryptoKeyPairRef.current = keyPair;
      setCryptoKeyPair(keyPair);
      console.log('[Crypto] Using wallet-derived keys for player', currentPlayerID, 'from wallet', walletDerivedKeys.walletAddress);
    }
  }, [walletDerivedKeys, currentPlayerID]);

  // Automatic crypto setup - generates keys and submits them when in setup phases
  useEffect(() => {
    // Only run for crypto poker games (ones with crypto state)
    if (!cryptoG.crypto) {
      return;
    }

    const phase = cryptoG.phase;
    const actionKey = `${phase}-${currentPlayerID}`;

    // Debug logging
    console.log('[Crypto] G.phase:', phase, 'ctx.phase:', ctx.phase, 'Player:', currentPlayerID, 'Available moves:', Object.keys(moves || {}));

    // Prevent duplicate setup attempts for this phase
    if (cryptoSetupInProgress.current.has(actionKey)) return;

    // Get or create key pair (use ref for synchronous access)
    // Prefers wallet-derived keys if available, falls back to random
    const getOrCreateKeyPair = (): CryptoKeyPair => {
      if (cryptoKeyPairRef.current) {
        return cryptoKeyPairRef.current;
      }
      // Generate random keys as fallback (will be replaced by wallet keys when available)
      const newKeyPair = generateKeyPair();
      cryptoKeyPairRef.current = newKeyPair;
      setCryptoKeyPair(newKeyPair);
      console.log('[Crypto] Generated random key pair for player', currentPlayerID, '(wallet keys not yet available)');
      return newKeyPair;
    };

    // Key Exchange Phase - generate and submit public key
    if (phase === 'keyExchange' && !myCryptoPlayer?.publicKey) {
      cryptoSetupInProgress.current.add(actionKey);
      const keyPair = getOrCreateKeyPair();

      console.log('[Crypto] Submitting public key for player', currentPlayerID, 'moves:', Object.keys(moves));
      setTimeout(() => {
        try {
          if (moves.submitPublicKey) {
            console.log('[Crypto] Calling moves.submitPublicKey for', currentPlayerID);
            const result = moves.submitPublicKey(currentPlayerID, keyPair.publicKey);
            console.log('[Crypto] submitPublicKey result:', result);
          } else {
            console.error('[Crypto] moves.submitPublicKey is not defined!');
          }
        } catch (err) {
          console.error('[Crypto] Error calling submitPublicKey:', err);
        }
      }, 100); // Small delay to ensure state is ready

      return;
    }

    // Encrypt Phase - encrypt deck when it's our turn
    if (phase === 'encrypt' && !myCryptoPlayer?.hasEncrypted) {
      const keyPair = cryptoKeyPairRef.current || getOrCreateKeyPair();
      if (!keyPair) return;

      // Check if it's our turn to encrypt (based on setupPlayerIndex)
      const setupPlayerIndex = cryptoG.setupPlayerIndex || 0;
      const currentSetupPlayer = cryptoG.playerOrder?.[setupPlayerIndex];

      if (currentSetupPlayer === currentPlayerID) {
        cryptoSetupInProgress.current.add(actionKey);
        console.log('[Crypto] Encrypting deck for player', currentPlayerID);

        setTimeout(() => {
          if (moves.encryptDeck) {
            moves.encryptDeck(currentPlayerID, keyPair.privateKey);
          }
        }, 100);
      }

      return;
    }

    // Shuffle Phase - shuffle deck when it's our turn
    if (phase === 'shuffle' && !myCryptoPlayer?.hasShuffled) {
      const keyPair = cryptoKeyPairRef.current || getOrCreateKeyPair();
      if (!keyPair) return;

      // Check if it's our turn to shuffle
      const setupPlayerIndex = cryptoG.setupPlayerIndex || 0;
      const currentSetupPlayer = cryptoG.playerOrder?.[setupPlayerIndex];

      if (currentSetupPlayer === currentPlayerID) {
        cryptoSetupInProgress.current.add(actionKey);
        console.log('[Crypto] Shuffling deck for player', currentPlayerID);

        setTimeout(() => {
          if (moves.shuffleDeck) {
            moves.shuffleDeck(currentPlayerID, keyPair.privateKey);
          }
        }, 100);
      }

      return;
    }
  }, [G.phase, cryptoG, currentPlayerID, myCryptoPlayer, moves]);

  // Reset betAmount to the current minimum whenever the betting situation changes
  // This ensures the slider always starts at the correct minimum for the current action
  useEffect(() => {
    const currentMin = G.bettingRound.currentBet === 0 ? minBet : minRaise;
    setBetAmount(currentMin);
  }, [G.phase, G.bettingRound.currentBet, minBet, minRaise]);

  const handleNewHand = () => {
    // Get hand result from game over state
    const handResult = ctx.gameover?.handResult as PokerHandResult | undefined;
    if (!handResult) {
      console.error('[PokerBoard] No hand result available for settlement');
      return;
    }

    console.log('[PokerBoard] Starting new hand with result:', handResult);

    // Call the parent callback to settle and create new game
    if (onNewHand) {
      onNewHand(handResult);
    } else {
      console.warn('[PokerBoard] No onNewHand callback provided - cannot start new hand');
    }
  };

  const handleFold = () => {
    moves.fold(currentPlayerID);
  };

  const handleCheck = () => {
    moves.check(currentPlayerID);
  };

  const handleCall = () => {
    moves.call(currentPlayerID);
  };

  const handleBet = () => {
    moves.bet(betAmount, currentPlayerID);
  };

  const handleRaise = () => {
    moves.raise(betAmount, currentPlayerID);
  };

  const handleAllIn = () => {
    moves.allIn(currentPlayerID);
  };

  // Determine which actions are available
  const canCheck = canAct && G.bettingRound.currentBet === (myPlayer?.bet || 0);
  const canCall = canAct && callAmount > 0 && callAmount < (myPlayer?.chips || 0);
  const canBet = canAct && G.bettingRound.currentBet === 0 && (myPlayer?.chips || 0) >= minBet;
  const canRaise = canAct && G.bettingRound.currentBet > 0 && (myPlayer?.chips || 0) >= minRaise - (myPlayer?.bet || 0);

  // Check if we're in a crypto setup phase
  const cryptoSetupPhases = ['keyExchange', 'encrypt', 'shuffle'];
  const isInCryptoSetup = cryptoSetupPhases.includes(G.phase);
  const cryptoState = (G as unknown as { crypto?: CryptoPluginState }).crypto;

  // Game over screen - show hand result and option to continue or end
  if (ctx.gameover) {
    const handResult = ctx.gameover.handResult as PokerHandResult | undefined;
    const isVoided = ctx.gameover.reason === 'voided';
    const winners = ctx.gameover.winners as string[] | undefined;

    // Check if any player is busted (for tournament mode)
    const playersWithChips = Object.entries(G.players).filter(([_, p]) => p.chips > 0);
    const isTournamentOver = playersWithChips.length <= 1;

    if (isTournamentOver && playersWithChips.length === 1) {
      // Tournament is over - one player has all the chips
      return (
        <div style={{
          padding: '40px',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          color: '#e4e4e4',
        }}>
          <h1>Tournament Over!</h1>
          <p style={{ fontSize: '24px' }}>
            Player {playersWithChips[0][0]} wins the tournament!
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 24px',
              fontSize: '16px',
              cursor: 'pointer',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              marginTop: '20px',
            }}
          >
            Play Again
          </button>
        </div>
      );
    }

    // Hand complete - show result and offer to continue
    return (
      <div style={{
        padding: '40px',
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
        color: '#e4e4e4',
        backgroundColor: '#16213e',
        borderRadius: '12px',
        maxWidth: '600px',
        margin: '40px auto',
      }}>
        <h2 style={{ color: '#fbbf24', marginBottom: '20px' }}>
          {isVoided ? 'Hand Voided' : 'Hand Complete!'}
        </h2>

        {winners && winners.length > 0 && (
          <p style={{ fontSize: '20px', marginBottom: '16px' }}>
            {winners.length === 1
              ? `Player ${winners[0]} wins the pot!`
              : `Split pot: Players ${winners.join(', ')}`}
          </p>
        )}

        {handResult && (
          <div style={{
            backgroundColor: '#0f172a',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '20px',
            textAlign: 'left',
          }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#94a3b8' }}>Settlement Details</h4>
            <div style={{ display: 'grid', gap: '8px', fontSize: '14px', color: '#cbd5e1' }}>
              <div>Pot: <strong style={{ color: '#fbbf24' }}>{handResult.totalPot}</strong></div>
              {Object.entries(handResult.payouts).map(([playerId, amount]) => (
                <div key={playerId}>
                  Player {playerId}: {amount > 0 ? (
                    <span style={{ color: '#4ade80' }}>+{amount}</span>
                  ) : (
                    <span style={{ color: '#6b7280' }}>0</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Show current chip counts */}
        <div style={{
          backgroundColor: '#1e293b',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '24px',
        }}>
          <h4 style={{ margin: '0 0 12px 0', color: '#94a3b8' }}>Chip Counts</h4>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '24px' }}>
            {Object.entries(G.players).map(([playerId, player]) => (
              <div key={playerId} style={{ textAlign: 'center' }}>
                <div style={{ color: '#9ca3af', fontSize: '12px' }}>Player {playerId}</div>
                <div style={{ color: player.chips > 0 ? '#fbbf24' : '#ef4444', fontSize: '18px', fontWeight: 'bold' }}>
                  {player.chips}
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={handleNewHand}
          disabled={!onNewHand}
          style={{
            padding: '16px 32px',
            fontSize: '18px',
            cursor: onNewHand ? 'pointer' : 'not-allowed',
            backgroundColor: onNewHand ? '#4CAF50' : '#374151',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            opacity: onNewHand ? 1 : 0.6,
          }}
        >
          Deal Next Hand
        </button>

        {!onNewHand && (
          <p style={{ color: '#6b7280', fontSize: '12px', marginTop: '8px' }}>
            New hand callback not configured
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{
      padding: '20px',
      maxWidth: '1000px',
      margin: '0 auto',
      fontFamily: 'system-ui, sans-serif',
      color: '#e4e4e4',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        padding: '12px 20px',
        backgroundColor: '#16213e',
        borderRadius: '8px',
        border: '1px solid #3a3a5c',
      }}>
        <h2 style={{ margin: 0 }}>Texas Hold'em</h2>
        <div style={{ display: 'flex', gap: '24px', color: '#a0a0a0' }}>
          <span>Phase: <strong style={{ color: '#4ade80' }}>{PHASE_LABELS[G.phase]}</strong></span>
          <span>Blinds: <strong>{G.smallBlindAmount}/{G.bigBlindAmount}</strong></span>
        </div>
      </div>

      {/* Card Settings Panel */}
      <CardSettingsPanel />

      {/* Asset loading indicator (only shown when loading IPFS images) */}
      {useImages && packLoading && (
        <div style={{
          padding: '12px 16px',
          backgroundColor: '#1e3a5f',
          borderRadius: '8px',
          border: '1px solid #3b82f6',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          <div style={{
            width: '16px',
            height: '16px',
            border: '2px solid #3b82f6',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          <span style={{ color: '#93c5fd', fontSize: '14px' }}>
            Loading card images... {packProgress}%
          </span>
          <div style={{
            flex: 1,
            height: '4px',
            backgroundColor: '#1e293b',
            borderRadius: '2px',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${packProgress}%`,
              height: '100%',
              backgroundColor: '#3b82f6',
              transition: 'width 0.2s',
            }} />
          </div>
        </div>
      )}

      {/* Asset loading error */}
      {useImages && packError && (
        <div style={{
          padding: '12px 16px',
          backgroundColor: '#7f1d1d',
          borderRadius: '8px',
          border: '1px solid #ef4444',
          marginBottom: '16px',
          color: '#fca5a5',
          fontSize: '14px',
        }}>
          Failed to load card images: {packError.message}. Using text fallback.
        </div>
      )}

      {/* Waiting/Game Over state */}
      {(G.phase === 'waiting' || G.phase === 'gameOver') && (
        <div style={{
          textAlign: 'center',
          padding: '40px',
          backgroundColor: '#16213e',
          borderRadius: '12px',
          marginBottom: '20px',
        }}>
          {G.phase === 'gameOver' && G.winners.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ color: '#fbbf24' }}>
                {G.winners.length === 1
                  ? `Player ${G.winners[0]} wins the hand!`
                  : `Split pot: ${G.winners.join(', ')}`}
              </h3>
            </div>
          )}
          <button
            onClick={handleNewHand}
            style={{
              padding: '16px 32px',
              fontSize: '18px',
              cursor: 'pointer',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
            }}
          >
            {G.phase === 'waiting' ? 'Start Hand' : 'Deal Next Hand'}
          </button>
        </div>
      )}

      {/* Crypto Setup Phase Progress */}
      {isInCryptoSetup && (
        <div style={{
          backgroundColor: '#1a2d4a',
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '20px',
          border: '1px solid #3b82f6',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '16px',
          }}>
            <span style={{ fontSize: '24px' }}>🔐</span>
            <div>
              <h3 style={{ margin: 0, color: '#60a5fa' }}>Cryptographic Setup</h3>
              <p style={{ margin: '4px 0 0 0', color: '#94a3b8', fontSize: '14px' }}>
                Establishing secure P2P card encryption
              </p>
            </div>
          </div>

          {/* Progress Steps */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            {cryptoSetupPhases.map((phase, index) => {
              const currentPhaseIndex = cryptoSetupPhases.indexOf(G.phase);
              const isComplete = index < currentPhaseIndex;
              const isCurrent = phase === G.phase;

              return (
                <div
                  key={phase}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: isComplete ? '#166534' : isCurrent ? '#1e3a5f' : '#1f2937',
                    border: `2px solid ${isComplete ? '#22c55e' : isCurrent ? '#3b82f6' : '#374151'}`,
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '16px', marginBottom: '4px' }}>
                    {isComplete ? '✓' : isCurrent ? '⏳' : '○'}
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: isComplete ? '#86efac' : isCurrent ? '#93c5fd' : '#6b7280',
                  }}>
                    {phase === 'keyExchange' && 'Keys'}
                    {phase === 'encrypt' && 'Encrypt'}
                    {phase === 'shuffle' && 'Shuffle'}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{
            padding: '16px',
            backgroundColor: '#0f172a',
            borderRadius: '8px',
            color: '#94a3b8',
            fontSize: '14px',
          }}>
            {cryptoG.phase === 'keyExchange' && (
              <>
                <strong style={{ color: '#60a5fa' }}>Key Exchange:</strong> Players are exchanging public keys for secure card encryption.
                {cryptoState && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {Object.keys(G.players).map(pid => {
                        const hasKey = cryptoState.publicKeys?.[pid];
                        return (
                          <span key={pid} style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            backgroundColor: hasKey ? '#166534' : '#374151',
                            color: hasKey ? '#86efac' : '#9ca3af',
                            fontSize: '12px',
                          }}>
                            Player {pid}: {hasKey ? '✓ Key submitted' : '⏳ Waiting...'}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
            {cryptoG.phase === 'encrypt' && (
              <>
                <strong style={{ color: '#60a5fa' }}>Encryption:</strong> Each player encrypts the deck in turn.
                <div style={{ marginTop: '8px' }}>
                  {(() => {
                    const setupPlayerIndex = cryptoG.setupPlayerIndex || 0;
                    const currentSetupPlayer = cryptoG.playerOrder?.[setupPlayerIndex];
                    return (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {Object.entries(cryptoG.players || {}).map(([pid, player]) => {
                          const p = player as CryptoPokerPlayerState;
                          const isTurn = currentSetupPlayer === pid && !p.hasEncrypted;
                          return (
                            <span key={pid} style={{
                              padding: '4px 8px',
                              borderRadius: '4px',
                              backgroundColor: p.hasEncrypted ? '#166534' : isTurn ? '#1e3a5f' : '#374151',
                              color: p.hasEncrypted ? '#86efac' : isTurn ? '#93c5fd' : '#9ca3af',
                              fontSize: '12px',
                              border: isTurn ? '1px solid #3b82f6' : 'none',
                            }}>
                              Player {pid}: {p.hasEncrypted ? '✓ Encrypted' : isTurn ? '🔄 Encrypting...' : '⏳ Waiting'}
                            </span>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </>
            )}
            {cryptoG.phase === 'shuffle' && (
              <>
                <strong style={{ color: '#60a5fa' }}>Shuffle:</strong> Each player shuffles the encrypted deck in turn.
                <div style={{ marginTop: '8px' }}>
                  {(() => {
                    const setupPlayerIndex = cryptoG.setupPlayerIndex || 0;
                    const currentSetupPlayer = cryptoG.playerOrder?.[setupPlayerIndex];
                    return (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {Object.entries(cryptoG.players || {}).map(([pid, player]) => {
                          const p = player as CryptoPokerPlayerState;
                          const isTurn = currentSetupPlayer === pid && !p.hasShuffled;
                          return (
                            <span key={pid} style={{
                              padding: '4px 8px',
                              borderRadius: '4px',
                              backgroundColor: p.hasShuffled ? '#166534' : isTurn ? '#1e3a5f' : '#374151',
                              color: p.hasShuffled ? '#86efac' : isTurn ? '#93c5fd' : '#9ca3af',
                              fontSize: '12px',
                              border: isTurn ? '1px solid #3b82f6' : 'none',
                            }}>
                              Player {pid}: {p.hasShuffled ? '✓ Shuffled' : isTurn ? '🔄 Shuffling...' : '⏳ Waiting'}
                            </span>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </>
            )}
          </div>

          {/* Console log hint */}
          <div style={{
            marginTop: '12px',
            padding: '8px 12px',
            backgroundColor: '#1e293b',
            borderRadius: '4px',
            fontSize: '12px',
            color: '#64748b',
          }}>
            💡 Check browser console (F12) for crypto operation logs
          </div>
        </div>
      )}

      {/* Community Cards */}
      {G.phase !== 'waiting' && !isInCryptoSetup && (
        <div style={{
          backgroundColor: '#0f3460',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '20px',
          textAlign: 'center',
        }}>
          <div style={{ marginBottom: '16px' }}>
            <span style={{
              padding: '8px 24px',
              backgroundColor: '#16213e',
              borderRadius: '20px',
              color: '#fbbf24',
              fontWeight: 'bold',
              fontSize: '18px',
            }}>
              Pot: {G.pot}
            </span>
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            minHeight: '108px',
            alignItems: 'center',
          }}>
            {G.community.length > 0 ? (
              G.community.map(card => (
                <CardDisplay key={card.id} card={card} packId={packId} useImages={useImages} />
              ))
            ) : (
              <span style={{ color: '#6a6a8a' }}>Community cards will appear here</span>
            )}
          </div>
        </div>
      )}

      {/* Players */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginBottom: '20px',
      }}>
        {Object.entries(G.players).map(([pid, player]) => {
          // Get encrypted card count for this player
          const encryptedHandZone = cryptoG.crypto?.encryptedZones?.[`hand:${pid}`];
          const encryptedCardCount = encryptedHandZone?.length || 0;

          // Get peeked cards if available (will be stored in player state after peek)
          const cryptoPlayer = cryptoG.players?.[pid] as CryptoPokerPlayerState | undefined;
          const peekedCards = cryptoPlayer?.peekedCards as PokerCard[] | undefined;

          return (
            <PlayerPanel
              key={pid}
              playerId={pid}
              player={player}
              isDealer={G.dealer === pid}
              isSmallBlind={G.smallBlind === pid}
              isBigBlind={G.bigBlind === pid}
              isActive={G.bettingRound.activePlayer === pid}
              isCurrentUser={pid === currentPlayerID}
              showCards={pid === currentPlayerID || G.phase === 'showdown'}
              encryptedCardCount={encryptedCardCount}
              peekedCards={pid === currentPlayerID ? peekedCards : undefined}
              packId={packId}
              useImages={useImages}
            />
          );
        })}
      </div>

      {/* Turn indicator */}
      {G.phase !== 'waiting' && G.phase !== 'gameOver' && G.phase !== 'showdown' && !isInCryptoSetup && (
        <div style={{
          padding: '12px',
          backgroundColor: isMyTurn ? '#1a4a3a' : '#3d2a1a',
          borderRadius: '8px',
          marginBottom: '20px',
          textAlign: 'center',
          border: '1px solid #3a3a5c',
        }}>
          {isMyTurn ? (
            <span style={{ color: '#6fcf6f', fontWeight: 'bold' }}>
              Your turn! {callAmount > 0 ? `${callAmount} to call.` : 'Check or bet.'}
            </span>
          ) : (
            <span style={{ color: '#ff9800' }}>
              Waiting for Player {G.bettingRound.activePlayer}...
            </span>
          )}
        </div>
      )}

      {/* Cooperative Decryption Notifications */}
      {cryptoG.decryptRequests && cryptoG.decryptRequests.length > 0 && !isInCryptoSetup && (
        <div style={{
          marginBottom: '20px',
          backgroundColor: '#1a2d4a',
          borderRadius: '12px',
          padding: '16px',
          border: '2px solid #f59e0b',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '12px',
          }}>
            <span style={{ fontSize: '20px' }}>🔓</span>
            <h3 style={{ margin: 0, color: '#f59e0b' }}>Cooperative Card Reveal</h3>
          </div>

          {cryptoG.decryptRequests.filter(r => r.status === 'pending').map((request: DecryptRequest) => {
            const isMyRequest = request.requestingPlayer === currentPlayerID;
            const haveIApproved = request.approvals[currentPlayerID];
            const approvalCount = Object.values(request.approvals).filter(Boolean).length;
            const totalPlayers = cryptoG.playerOrder.length;

            return (
              <div key={request.id} style={{
                backgroundColor: '#0f172a',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '8px',
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}>
                  <span style={{ color: '#e2e8f0' }}>
                    {isMyRequest
                      ? '🙋 You requested to reveal your cards'
                      : `🔔 Player ${request.requestingPlayer} wants to reveal their cards`
                    }
                  </span>
                  <span style={{
                    padding: '4px 8px',
                    backgroundColor: approvalCount === totalPlayers ? '#166534' : '#374151',
                    color: approvalCount === totalPlayers ? '#86efac' : '#9ca3af',
                    borderRadius: '4px',
                    fontSize: '12px',
                  }}>
                    {approvalCount}/{totalPlayers} approved
                  </span>
                </div>

                {/* Approval status for each player */}
                <div style={{
                  display: 'flex',
                  gap: '8px',
                  flexWrap: 'wrap',
                  marginBottom: '12px',
                }}>
                  {cryptoG.playerOrder.map((pid: string) => (
                    <span key={pid} style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      backgroundColor: request.approvals[pid] ? '#166534' : '#374151',
                      color: request.approvals[pid] ? '#86efac' : '#9ca3af',
                    }}>
                      Player {pid}: {request.approvals[pid] ? '✓' : '⏳'}
                    </span>
                  ))}
                </div>

                {/* Approve button if not yet approved and not my request */}
                {!haveIApproved && !isMyRequest && (
                  <button
                    onClick={() => {
                      const keyPair = cryptoKeyPairRef.current;
                      if (keyPair && moves.approveDecrypt) {
                        console.log('[PokerBoard] Approving decrypt request:', request.id);
                        moves.approveDecrypt(currentPlayerID, request.id, keyPair.privateKey);
                      }
                    }}
                    style={{
                      padding: '10px 20px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      backgroundColor: '#4CAF50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      width: '100%',
                    }}
                  >
                    ✓ Approve & Share Decryption Key
                  </button>
                )}

                {haveIApproved && !isMyRequest && (
                  <div style={{
                    textAlign: 'center',
                    color: '#86efac',
                    fontSize: '14px',
                  }}>
                    ✓ You approved this request
                  </div>
                )}

                {isMyRequest && (
                  <div style={{
                    textAlign: 'center',
                    color: '#fbbf24',
                    fontSize: '14px',
                  }}>
                    ⏳ Waiting for other players to approve...
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Card Reveal buttons - only for crypto games when player hasn't peeked */}
      {cryptoG.crypto && !myCryptoPlayer?.hasPeeked && !myCryptoPlayer?.folded && !isInCryptoSetup && (
        cryptoG.crypto.encryptedZones?.[`hand:${currentPlayerID}`]?.length > 0
      ) && (
        <div style={{
          marginBottom: '20px',
          textAlign: 'center',
          backgroundColor: '#16213e',
          borderRadius: '12px',
          padding: '20px',
          border: '1px solid #3a3a5c',
        }}>
          <h3 style={{ margin: '0 0 16px 0', color: '#e2e8f0' }}>Reveal Your Cards</h3>

          {/* Check if there's already a pending request from this player */}
          {!cryptoG.decryptRequests?.some((r: DecryptRequest) => r.requestingPlayer === currentPlayerID && r.status === 'pending') && (
            <>
              {/* Cooperative reveal button */}
              <button
                onClick={() => {
                  const keyPair = cryptoKeyPairRef.current;
                  if (keyPair && moves.requestDecrypt) {
                    const zoneId = `hand:${currentPlayerID}`;
                    const cardIndices = [0, 1]; // Both hole cards
                    console.log('[PokerBoard] Requesting cooperative decrypt for', zoneId);
                    moves.requestDecrypt(currentPlayerID, zoneId, cardIndices);
                  }
                }}
                style={{
                  padding: '16px 32px',
                  fontSize: '18px',
                  cursor: 'pointer',
                  backgroundColor: '#8b5cf6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px rgba(139, 92, 246, 0.3)',
                  marginBottom: '12px',
                }}
              >
                🤝 Request Cooperative Reveal
              </button>
              <p style={{ color: '#a0a0a0', fontSize: '12px', marginBottom: '16px' }}>
                All players must approve to decrypt your cards (secure)
              </p>

              <div style={{
                borderTop: '1px solid #3a3a5c',
                paddingTop: '16px',
                marginTop: '8px',
              }}>
                <button
                  onClick={() => {
                    const keyPair = cryptoKeyPairRef.current;
                    if (keyPair && moves.peekHoleCards) {
                      console.log('[PokerBoard] Instant peek at hole cards');
                      moves.peekHoleCards(currentPlayerID, keyPair.privateKey);
                    }
                  }}
                  style={{
                    padding: '10px 20px',
                    fontSize: '14px',
                    cursor: 'pointer',
                    backgroundColor: '#374151',
                    color: '#9ca3af',
                    border: '1px solid #4b5563',
                    borderRadius: '8px',
                  }}
                >
                  👁️ Instant Peek (Demo Mode)
                </button>
                <p style={{ color: '#6b7280', fontSize: '11px', marginTop: '8px' }}>
                  Uses stored keys - less secure, for demo only
                </p>
              </div>
            </>
          )}

          {cryptoG.decryptRequests?.some((r: DecryptRequest) => r.requestingPlayer === currentPlayerID && r.status === 'pending') && (
            <div style={{ color: '#fbbf24' }}>
              ⏳ Waiting for approval from other players...
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      {canAct && G.phase !== 'waiting' && G.phase !== 'gameOver' && G.phase !== 'showdown' && !isInCryptoSetup && (
        <div style={{
          backgroundColor: '#16213e',
          borderRadius: '12px',
          padding: '20px',
          border: '1px solid #3a3a5c',
        }}>
          <div style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginBottom: '16px',
          }}>
            <button
              onClick={handleFold}
              style={{
                padding: '12px 24px',
                fontSize: '16px',
                cursor: 'pointer',
                backgroundColor: '#dc2626',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
              }}
            >
              Fold
            </button>

            {canCheck && (
              <button
                onClick={handleCheck}
                style={{
                  padding: '12px 24px',
                  fontSize: '16px',
                  cursor: 'pointer',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                }}
              >
                Check
              </button>
            )}

            {canCall && (
              <button
                onClick={handleCall}
                style={{
                  padding: '12px 24px',
                  fontSize: '16px',
                  cursor: 'pointer',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                }}
              >
                Call {callAmount}
              </button>
            )}

            <button
              onClick={handleAllIn}
              style={{
                padding: '12px 24px',
                fontSize: '16px',
                cursor: 'pointer',
                backgroundColor: '#7c3aed',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
              }}
            >
              All-In ({myPlayer?.chips})
            </button>
          </div>

          {(canBet || canRaise) && (
            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'center',
              alignItems: 'center',
            }}>
              <input
                type="range"
                min={canBet ? minBet : minRaise}
                max={myPlayer?.chips || 0}
                value={betAmount}
                onChange={(e) => setBetAmount(Number(e.target.value))}
                style={{ width: '200px' }}
              />
              <input
                type="number"
                min={canBet ? minBet : minRaise}
                max={myPlayer?.chips || 0}
                value={betAmount}
                onChange={(e) => setBetAmount(Number(e.target.value))}
                style={{
                  width: '80px',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #3a3a5c',
                  backgroundColor: '#0f3460',
                  color: '#e4e4e4',
                }}
              />
              <button
                onClick={canBet ? handleBet : handleRaise}
                style={{
                  padding: '12px 24px',
                  fontSize: '16px',
                  cursor: 'pointer',
                  backgroundColor: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                }}
              >
                {canBet ? 'Bet' : 'Raise to'} {betAmount}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Crypto Transparency Panel - shows encryption state for verification */}
      <CryptoTransparencyPanel
        crypto={(G as unknown as { crypto?: CryptoPluginState }).crypto}
        numPlayers={Object.keys(G.players).length}
        currentPlayerId={currentPlayerID}
      />
    </div>
  );
};
