import React, { useState, useEffect } from 'react';
import { useAssetPack } from '@manamesh/frontend/src/hooks/useAssetPack';
import { useCardImage } from '@manamesh/frontend/src/hooks/useCardImage';
import { DEFAULT_MISTBORN_PACK_SOURCE, getEnrichedCardsForSet, MISTBORN_SETS, getLocalAssetUrl } from '../assets';
import { TrainingTrack } from './TrainingTrack';
import { computeCoins } from '../game';

interface MistbornBoardProps {
  // For full integration pass G/ctx/moves; for standalone test/demo mode, omit
  G?: any;
  ctx?: any;
  moves?: any;
  // Optional: override the asset pack source (IPFS CID, local path, etc.)
  packSource?: any;
}

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6'];

// Simple demo state for rules-free testing (no boardgame.io required)
interface DemoPlayer {
  id: string;
  hand: any[];
  play: any[];
  discard: any[];
  trainingPosition: number;
  burnLimit: number;
  health: number;
}

interface DemoState {
  players: Record<string, DemoPlayer>;
  market: any[];
  missions: any[];
  currentPlayer: string;
  targetHolder: string;
}

export function MistbornBoard({
  G,
  ctx,
  moves,
  packSource = DEFAULT_MISTBORN_PACK_SOURCE,
}: MistbornBoardProps & { packSource?: any }) {
  const [customSource, setCustomSource] = useState<any>(null);
  const effectiveSource = customSource || packSource;

  const { pack, isLoading, error } = useAssetPack(effectiveSource);
  const [demoState, setDemoState] = useState<DemoState | null>(null);

  if (isLoading) return <div>Loading Mistborn assets...</div>;
  if (error) return <div>Error loading pack: {error.message}</div>;
  if (!pack) return <div>No pack loaded. Check asset source.</div>;

  // Precompute some images for character (to avoid hook issues in map)
  const charCards = getEnrichedCardsForSet(pack.cards || [], 'character' as any);
  const characterForDemo = charCards[0]; // e.g. Vin

  // Simple source switcher for testing IPFS vs local (only in demo mode)
  const handleSetIPFSSource = () => {
    const cid = prompt('Enter IPFS CID for the Mistborn pack root (e.g. bafy...)');
    if (cid) {
      setCustomSource({ type: 'ipfs', cid: cid.trim() });
    }
  };
  const handleUseLocal = () => setCustomSource(null);

  const useDemo = !G; // if no G passed, run in standalone demo mode for easy testing

  // Initialize demo state once pack is ready
  useEffect(() => {
    if (!useDemo || demoState) return;

    const marketBase = getEnrichedCardsForSet(pack.cards || [], 'market' as any);
    const starters = getEnrichedCardsForSet(pack.cards || [], 'starters' as any);
    const missionsBase = getEnrichedCardsForSet(pack.cards || [], 'missions' as any);

    const initPlayers: Record<string, DemoPlayer> = {
      p1: {
        id: 'p1',
        hand: starters.slice(0, 5),
        play: [],
        discard: [],
        trainingPosition: 0,
        burnLimit: 1,
        health: 38,
      },
      p2: {
        id: 'p2',
        hand: starters.slice(5, 10),
        play: [],
        discard: [],
        trainingPosition: 1,
        burnLimit: 1,
        health: 36,
      },
    };

    setDemoState({
      players: initPlayers,
      market: marketBase.slice(0, 6),
      missions: missionsBase,
      currentPlayer: 'p1',
      targetHolder: 'p2',
    });
  }, [pack, useDemo]);

  if (useDemo && !demoState) {
    return <div>Initializing demo state from pack...</div>;
  }

  const isDemo = useDemo;
  const realPlayers = G?.players || {};
  const playerIds = isDemo ? Object.keys(demoState!.players) : Object.keys(realPlayers).length > 0 ? Object.keys(realPlayers) : ['p1', 'p2'];
  const currentPid = isDemo ? demoState!.currentPlayer : (ctx?.currentPlayer || playerIds[0]);
  const targetHolder = isDemo ? demoState!.targetHolder : null;

  // In demo mode, show current effective source type
  const currentSourceType = effectiveSource?.type || 'local-directory';

  // Precompute character images to avoid hook issues in render
  const charImages: Record<string, string | undefined> = {};
  const chars = getEnrichedCardsForSet(pack.cards || [], 'character' as any);
  chars.forEach((ch: any) => {
    // Note: can't call hook here easily, use path for now
    const p = ch.front ? getLocalAssetUrl('packs/mistborn/' + ch.front) : undefined;
    charImages[ch.name] = p;
  });

  // Helper to get card data from pack by id (for real G mode). Accepts id string or card-like.
  const getCardFromPack = (idOrCard: string | any) => {
    const id = typeof idOrCard === 'string' ? idOrCard : (idOrCard?.id || idOrCard);
    const found = (pack.cards || []).find((c: any) => c.id === id) ||
                  getEnrichedCardsForSet(pack.cards || [], 'market' as any).find((c: any) => c.id === id);
    if (found) return { ...found, ... (typeof idOrCard === 'object' ? idOrCard : {}) };
    return { id, name: (typeof idOrCard === 'object' ? idOrCard.name : id) || id, front: '' };
  };

  const switchPlayer = (pid: string) => {
    if (isDemo) {
      setDemoState((prev: DemoState | null) => prev ? { ...prev, currentPlayer: pid } : prev);
    }
  };
  const marketCards = isDemo 
    ? demoState!.market 
    : (G?.market || []).map((id: string) => getCardFromPack(id)).slice(0, 6);

  // Demo interaction helpers (rules-free)
  const playCard = (pid: string, card: any, sideways = false) => {
    if (!isDemo) {
      moves?.playCard?.(card.id, sideways);
      return;
    }
    setDemoState((prev: DemoState | null) => {
      if (!prev) return prev;
      const p = { ...prev.players[pid] };
      p.hand = p.hand.filter((c: any) => c.id !== card.id);
      p.play = [...p.play, { ...card, _sideways: sideways }];
      return {
        ...prev,
        players: { ...prev.players, [pid]: p },
      };
    });
  };

  const buyFromMarket = (card: any) => {
    const cost = card.metadata?.cost ?? 0;
    if (!isDemo) {
      const currentCoins = computeCoins((G || { zones: {} }) as any, currentPid);
      if (cost > currentCoins) {
        // Engine will also reject; early return for UX
        return;
      }
      moves?.buyCard?.(card.id);
      return;
    }
    setDemoState((prev: DemoState | null) => {
      if (!prev) return prev;
      const newMarket = prev.market.filter((c: any) => c.id !== card.id);
      const more = getEnrichedCardsForSet(pack.cards || [], 'market' as any);
      const refill = more.find((c: any) => !newMarket.some((m: any) => m.id === c.id));
      const updatedMarket = refill ? [...newMarket, refill] : newMarket;

      const pid = prev.currentPlayer;
      const p = { ...prev.players[pid] };
      p.hand = [...p.hand, { ...card }];

      return {
        ...prev,
        market: updatedMarket,
        players: { ...prev.players, [pid]: p },
      };
    });
  };

  const eliminateCard = (pid: string, from: 'hand' | 'play' | 'discard', cardId: string) => {
    if (!isDemo) {
      moves?.eliminateCard?.(cardId, from);
      return;
    }
    setDemoState((prev: DemoState | null) => {
      if (!prev) return prev;
      const p = { ...prev.players[pid] };
      if (from === 'hand') p.hand = p.hand.filter((c: any) => c.id !== cardId);
      if (from === 'play') p.play = p.play.filter((c: any) => c.id !== cardId);
      if (from === 'discard') p.discard = p.discard.filter((c: any) => c.id !== cardId);
      return { ...prev, players: { ...prev.players, [pid]: p } };
    });
  };

  const advance = (pid: string) => {
    if (!isDemo) {
      moves?.advanceTraining?.();
      return;
    }
    setDemoState((prev: DemoState | null) => {
      if (!prev) return prev;
      const p = { ...prev.players[pid] };
      p.trainingPosition = (p.trainingPosition || 0) + 1;
      p.burnLimit = Math.min(4, 1 + Math.floor(p.trainingPosition / 3));
      return { ...prev, players: { ...prev.players, [pid]: p } };
    });
  };

  const cleanupAndDraw = (pid: string) => {
    if (!isDemo) {
      moves?.cleanupAndDraw?.();
      return;
    }
    setDemoState((prev: DemoState | null) => {
      if (!prev) return prev;
      const p = { ...prev.players[pid] };
      p.discard = [...p.discard, ...p.play, ...p.hand];
      p.play = [];
      p.hand = [];
      const more = getEnrichedCardsForSet(pack.cards || [], 'market' as any).slice(0, 5);
      p.hand = [...p.hand, ...more];
      return { ...prev, players: { ...prev.players, [pid]: p } };
    });
  };

  const simulateCombat = (pid: string, amount: number) => {
    if (!isDemo) return;
    setDemoState((prev: DemoState | null) => {
      if (!prev) return prev;
      const otherPid = Object.keys(prev.players).find(p => p !== pid)!;
      const p = { ...prev.players[pid] };
      const target = { ...prev.players[otherPid] };
      target.health = Math.max(0, target.health - amount);
      return {
        ...prev,
        players: { ...prev.players, [otherPid]: target },
      };
    });
  };

  const passTarget = () => {
    if (!isDemo) return;
    setDemoState((prev: DemoState | null) => {
      if (!prev) return prev;
      const pids = Object.keys(prev.players);
      const currentIdx = pids.indexOf(prev.targetHolder);
      const next = pids[(currentIdx + 1) % pids.length];
      return { ...prev, targetHolder: next };
    });
  };

  const resetDemo = () => {
    if (!isDemo || !pack) return;
    const marketBase = getEnrichedCardsForSet(pack.cards || [], 'market' as any);
    const starters = getEnrichedCardsForSet(pack.cards || [], 'starters' as any);
    const missionsBase = getEnrichedCardsForSet(pack.cards || [], 'missions' as any);

    setDemoState({
      players: {
        p1: { id: 'p1', hand: starters.slice(0, 5), play: [], discard: [], trainingPosition: 0, burnLimit: 1, health: 38 },
        p2: { id: 'p2', hand: starters.slice(5, 10), play: [], discard: [], trainingPosition: 1, burnLimit: 1, health: 36 },
      },
      market: marketBase.slice(0, 6),
      missions: missionsBase,
      currentPlayer: 'p1',
      targetHolder: 'p2',
    } as DemoState);
  };

  // Unified getters for demo (local state) + integrated real G/ctx (from zones + players)
  // These enable full real-G rendering without demo fallback for the board.
  const getPlayerData = (pid: string) => {
    if (isDemo) {
      return demoState!.players[pid] || { trainingPosition: 0, burnLimit: 1, health: 36, character: 'vin' };
    }
    const p = (G?.players && G.players[pid]) || {};
    return {
      character: p.character || 'vin',
      trainingPosition: p.trainingPosition ?? 0,
      burnLimit: p.burnLimit ?? 1,
      health: p.health ?? 36,
      metals: p.metals || [],
      missionPoints: p.missionPoints ?? 0,
      hasTarget: p.hasTarget || (targetHolder === pid),
    };
  };

  const getPlayerHand = (pid: string) => {
    if (isDemo) {
      return demoState!.players[pid]?.hand || [];
    }
    const zoneCards = (G?.zones?.hand?.[pid] || []) as any[];
    return zoneCards.map((c: any) => {
      const enriched = getCardFromPack(c?.id || c);
      return { ...enriched, ...c }; // preserve any runtime flags
    });
  };

  const getPlayerPlay = (pid: string) => {
    if (isDemo) {
      return demoState!.players[pid]?.play || [];
    }
    const zoneCards = (G?.zones?.play?.[pid] || []) as any[];
    return zoneCards.map((c: any) => {
      const enriched = getCardFromPack(c?.id || c);
      return { ...enriched, _sideways: c?._sideways || false, ...c };
    });
  };

  const getPlayerDiscard = (pid: string) => {
    if (isDemo) {
      return demoState!.players[pid]?.discard || [];
    }
    const zoneCards = (G?.zones?.discard?.[pid] || []) as any[];
    return zoneCards.map((c: any) => getCardFromPack(c?.id || c));
  };

  const getPlayerAllies = (pid: string) => {
    if (isDemo) return [];
    const zoneCards = (G?.zones?.allies?.[pid] || []) as any[];
    return zoneCards.map((c: any) => getCardFromPack(c?.id || c));
  };

  // Also improve non-demo pass target to delegate properly
  const doPassTarget = () => {
    if (!isDemo && moves?.passTarget) {
      moves.passTarget();
      return;
    }
    if (isDemo) {
      passTarget(); // local demo mutator
    }
  };

  return (
    <div className="mistborn-board" style={{ padding: 20, fontFamily: 'sans-serif', background: '#f5f5f5' }}>
      <h1>Mistborn Deck Builder (Phase 1 - Rules Free + Rules Engine Start)</h1>
      <p style={{ color: '#666' }}>
        {isDemo ? 'Standalone Demo Mode (local state, no server needed for testing)' : 'Integrated Mode'}
      </p>

      {isDemo && (
        <div style={{ marginBottom: 12, fontSize: 12 }}>
          <strong>Asset Source:</strong> {effectiveSource.type || 'default'} &nbsp;
          <button onClick={handleSetIPFSSource} style={{ fontSize: 11 }}>Load from IPFS CID</button>
          <button onClick={handleUseLocal} style={{ fontSize: 11, marginLeft: 4 }}>Use bundled/local</button>
        </div>
      )}

      {/* Shared Market */}
      <div style={{ marginBottom: 24, background: 'white', padding: 12, borderRadius: 8 }}>
        <h2>Market (click to buy - adds to current player's hand)</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {marketCards.map((card: any, idx: number) => (
            <MarketCard
              key={idx}
              packId={pack.id}
              card={card}
              onBuy={() => buyFromMarket(card)}
            />
          ))}
        </div>
      </div>

      {/* Missions (from pack) */}
      <div style={{ marginBottom: 24, background: 'white', padding: 12, borderRadius: 8 }}>
        <h2>Missions (click to spend point on current player)</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          {(isDemo ? demoState!.missions : []).slice(0, 3).map((mission: any, idx: number) => (
            <div key={idx} style={{ border: '1px solid #ccc', padding: 6, width: 140, fontSize: 11 }} onClick={() => {
              if (isDemo) {
                const pid = demoState!.currentPlayer;
                setDemoState((prev: DemoState | null) => {
                  if (!prev) return prev;
                  const p = { ...prev.players[pid] };
                  p.trainingPosition = (p.trainingPosition || 0) + 1; // simulate mission advance
                  return { ...prev, players: { ...prev.players, [pid]: p } };
                });
              }
            }}>
              <div style={{ fontWeight: 'bold' }}>{mission.name}</div>
              <div style={{ fontSize: 9 }}>{mission.metadata?.effectText || 'Mission track'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Target (rules-free sim) */}
      <div style={{ marginBottom: 12 }}>
        <strong>Target Holder:</strong> {isDemo ? demoState!.targetHolder : (G?.targetHolder || targetHolder || 'p1')} <button onClick={doPassTarget} style={{ fontSize: 11 }}>Pass Target</button>
      </div>

      {/* Boxings and Atium supplies (for buying and special) */}
      <div style={{ marginBottom: 12, fontSize: 11 }}>
        <strong>Boxings:</strong> 14 | <strong>Atium:</strong> 16 (from track/missions)
        <button onClick={() => { if (isDemo) { /* sim buy boxing */ } }} style={{ fontSize: 10, marginLeft: 8 }}>Buy Boxing (2 coins)</button>
      </div>

      {/* Boxings/Atium (sim) */}
      <div style={{ marginBottom: 12, fontSize: 11 }}>
        <strong>Boxings:</strong> available in supplies (buy for 2 coins, spend for 1) | <strong>Atium:</strong> from track/missions
      </div>

      {/* Per-player areas */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(playerIds.length, 2)}, 1fr)`, gap: 16 }}>
        {playerIds.map((pid: string, idx: number) => {
          const player = getPlayerData(pid);
          const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
          const isCurrent = pid === currentPid;
          const hand = getPlayerHand(pid);
          const play = getPlayerPlay(pid);
          const discard = getPlayerDiscard(pid);
          const availableCoins = isDemo ? 4 : computeCoins((G || { zones: {}, boxingsAvailable: 0 }) as any, pid);

          return (
            <div key={pid} style={{ background: 'white', padding: 12, borderRadius: 8, border: isCurrent ? '2px solid #333' : '1px solid #ddd' }}>
              <h3 style={{ color, marginTop: 0 }}>
                Player {pid} {isCurrent && '(Current)'} — Burn Limit: {player.burnLimit} (burned: {(player.metals || []).filter((m: any) => m.burned).length})
              </h3>

              {/* Training */}
              <TrainingTrack
                position={player.trainingPosition || 0}
                playerColor={color}
                playerId={pid}
                burnLimit={player.burnLimit}
                onAdvance={() => advance(pid)}
              />

              {/* Health */}
              <div style={{ marginTop: 8, fontSize: 12 }}>
                Health: {player.health || 36} {pid === targetHolder && '(Target Holder)'}
              </div>

              {/* Coins (computed from play area via pack metadata in rules engine) */}
              <div style={{ fontSize: 11, marginTop: 2, color: '#2c3' }}>Coins: {availableCoins}</div>

              {/* Character from pack */}
              <div style={{ marginTop: 8, fontSize: 11 }}>
                <strong>Character:</strong> {player.character || 'Vin'}
                {player.character && charImages[player.character] && <img src={charImages[player.character] as string} alt={player.character} style={{width: 50, marginLeft: 8, verticalAlign: 'middle'}} />}
              </div>

              {/* Hand */}
              <div style={{ marginTop: 8 }}>
                <h4>Hand (click to play / right-click to eliminate)</h4>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {hand.length > 0 ? (
                    hand.map((card: any, i: number) => (
                      <MiniCard
                        key={i}
                        packId={pack.id}
                        card={card}
                        onClick={() => playCard(pid, card)}
                        onContextMenu={(e: any) => { e.preventDefault(); eliminateCard(pid, 'hand', card.id); }}
                      />
                    ))
                  ) : (
                    <span style={{ fontSize: 12, color: '#888' }}>Empty</span>
                  )}
                </div>
              </div>

              {/* Play Area */}
              <div style={{ marginTop: 8 }}>
                <h4>Play Area (click to toggle sideways)</h4>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {play.length > 0 ? (
                    play.map((card: any, i: number) => (
                      <MiniCard
                        key={i}
                        packId={pack.id}
                        card={card}
                        sideways={!!card._sideways}
                        onClick={() => {
                          if (isDemo) {
                            setDemoState((prev: DemoState | null) => {
                              if (!prev) return prev;
                              const p = { ...prev.players[pid] };
                              p.play = p.play.map((c: any, j: number) =>
                                j === i ? { ...c, _sideways: !c._sideways } : c
                              );
                              return { ...prev, players: { ...prev.players, [pid]: p } };
                            });
                          } else if (moves?.useAsMetal) {
                            // For integrated, call a move to use as metal (sideways)
                            moves.useAsMetal(card.id);
                          }
                        }}
                      />
                    ))
                  ) : (
                    <span style={{ fontSize: 12, color: '#888' }}>Empty</span>
                  )}
                </div>
              </div>

              {/* Discard */}
              <div style={{ marginTop: 8 }}>
                <h4>Discard ({discard.length || 0})</h4>
                <div style={{ fontSize: 10, color: '#888' }}>
                  {discard.length ? discard.map((c: any) => c.name).join(', ') : 'Empty'}
                </div>
              </div>

              {/* Allies (simple) */}
              <div style={{ marginTop: 8, fontSize: 11 }}>
                <strong>Allies:</strong> {getPlayerAllies(pid).length ? getPlayerAllies(pid).map((c: any) => c.name).join(', ') : 'None'}
              </div>

              {/* Quick actions (rules-free manual) */}
              {isCurrent && moves && (
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button onClick={() => cleanupAndDraw(pid)} style={{ fontSize: 11 }}>Cleanup + Draw</button>
                  <button onClick={() => advance(pid)} style={{ fontSize: 11 }}>Advance Training</button>
                  <button onClick={() => simulateCombat(pid, 5)} style={{ fontSize: 11 }}>Simulate 5 Combat</button>
                  <button onClick={doPassTarget} style={{ fontSize: 11 }}>Pass Target</button>
                  <button onClick={() => moves?.endTurn?.()} style={{ fontSize: 11 }}>End Turn</button>
                  <button onClick={() => moves?.endMainPhase?.()} style={{ fontSize: 11 }}>End Main Phase</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isDemo && (
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button onClick={() => switchPlayer('p1')}>Switch to P1</button>
          <button onClick={() => switchPlayer('p2')}>Switch to P2</button>
          <button onClick={resetDemo} style={{ marginLeft: 12 }}>Reset Demo</button>
        </div>
      )}

      <div style={{ marginTop: 20, color: '#666', fontSize: 13 }}>
        <p>Loaded pack: {pack.manifest?.name} (source: {currentSourceType})</p>
        <p>Using sets: {Object.values(MISTBORN_SETS).join(', ')}</p>
        <p><strong>Rules-free + early engine:</strong> Click market to buy (validates cost via metadata), click hand to play, click play to toggle (useAsMetal). Right-click eliminate. Buttons call moves (validate enforced for burns/coins). Auto training on turn. Cleanup/Draw/EndTurn available. Pass Target syncs in integrated mode.</p>
        <p>Supports IPFS CID or local FS via the buttons above. For Vercel we bundle assets locally.</p>
      </div>
    </div>
  );
}

function MarketCard({ packId, card: cardData, onBuy }: { packId: string; card: any; onBuy?: () => void }) {
  const { url, isLoading } = useCardImage(packId, cardData.id, 'front');
  const meta = cardData.metadata || {};

  return (
    <div
      style={{
        width: 120,
        border: '1px solid #333',
        padding: 4,
        textAlign: 'center',
        cursor: onBuy ? 'pointer' : 'default',
        fontSize: 10,
      }}
      onClick={onBuy}
    >
      {isLoading || !url ? (
        <div style={{ height: 140, background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          Loading...
        </div>
      ) : (
        <img src={url} alt={cardData.name} style={{ width: '100%', height: 'auto' }} />
      )}
      <div style={{ marginTop: 2, fontWeight: 'bold' }}>{cardData.name}</div>
      {meta.cost !== undefined && <div>Cost: {meta.cost}</div>}
      {meta.metal && <div>Metal: {meta.metal}</div>}
    </div>
  );
}

function MiniCard({ packId, card: cardData, sideways, onClick, onContextMenu }: { packId: string; card: any; sideways?: boolean; onClick?: () => void; onContextMenu?: (e: any) => void }) {
  const { url, isLoading } = useCardImage(packId, cardData.id, 'front');
  const meta = cardData.metadata || {};

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{
        width: 70,
        border: '1px solid #555',
        padding: 2,
        textAlign: 'center',
        cursor: 'pointer',
        fontSize: 9,
        transform: sideways ? 'rotate(90deg)' : 'none',
        transformOrigin: 'center',
      }}
    >
      {isLoading || !url ? (
        <div style={{ height: 80, background: '#eee' }} />
      ) : (
        <img src={url} alt={cardData.name} style={{ width: '100%', height: 'auto' }} />
      )}
      <div>{cardData.name}</div>
      {meta.metal && <div>{meta.metal}</div>}
    </div>
  );
}

export default MistbornBoard;