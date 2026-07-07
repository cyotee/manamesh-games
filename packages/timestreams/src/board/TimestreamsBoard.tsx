/**
 * TimestreamsBoard
 *
 * Minimal interactive board for Timestreams.
 * Renders the six-era timeline, stacks, scoring slots, day, hand, and basic controls.
 * Prompts are stubbed for now.
 *
 * Mirrors structure from packages/poker/src/components/PokerBoard.tsx (simplified).
 */

import React from 'react';
import type { BoardProps } from 'boardgame.io/react';
import type { TimestreamsState, EraId, TimestreamsCard } from '../types';
import { ERA_ORDER, composeCardText } from '../types';

const ERA_LABELS: Record<EraId, string> = {
  stone: 'Stone Age',
  medieval: 'Medieval',
  renaissance: 'Renaissance',
  industrial: 'Industrial',
  modern: 'Modern',
  future: 'Future',
};

interface TimestreamsBoardProps extends BoardProps<TimestreamsState> {}

export const TimestreamsBoard: React.FC<TimestreamsBoardProps> = ({
  G,
  ctx,
  moves,
  playerID,
}) => {
  const [teachingMode, setTeachingMode] = React.useState(false);
  const [hoveredCard, setHoveredCard] = React.useState<TimestreamsCard | null>(null);

  const currentPlayer = ctx.currentPlayer;
  const isMyTurn = currentPlayer === playerID;
  const activeEraIndex = Math.max(0, Math.min(G.currentDay - 1, ERA_ORDER.length - 1));
  const activeEra = ERA_ORDER[activeEraIndex];
  const myHand = G.players[playerID]?.hand ?? [];
  const pendingPrompts = (G as any).pendingPrompts ?? [];
  const isSetupPhase = G.phase === 'setup' || ctx.phase === 'setup';

  const showHand = teachingMode || myHand.length > 0 || isSetupPhase; // always show if teaching mode or has cards

  const handleCardHover = (card: TimestreamsCard | null) => {
    setHoveredCard(card);
  };

  const handlePlayInvention = (cardId: string) => {
    if (isMyTurn) {
      moves.playInvention(cardId);
    }
  };

  const handlePlayAction = (cardId: string) => {
    if (isMyTurn) {
      moves.playAction(cardId);
    }
  };

  const handlePass = () => {
    if (isMyTurn) {
      moves.pass();
    }
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '10px' }}>
      <h2 style={{ margin: '0 0 10px' }}>
        Timestreams — Day {G.currentDay} (Active: {ERA_LABELS[activeEra]})
      </h2>

      {/* Timeline */}
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto' }}>
        {ERA_ORDER.map((era, idx) => {
          const eraState = G.timeline[era];
          const isActive = era === activeEra;
          const slots = G.config.scoringSlots ?? 6;
          const stack = eraState?.stack ?? [];

          return (
            <div
              key={era}
              className="ts-era-column"
              style={{
                minWidth: '140px',
                border: isActive ? '3px solid #2b6cb0' : '1px solid #ccc',
                borderRadius: '6px',
                padding: '6px',
                background: isActive ? '#ebf8ff' : '#f7fafc',
              }}
            >
              <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '4px' }}>
                {ERA_LABELS[era]}
                {isActive && ' (active)'}
              </div>

              {/* Scoring slots marker */}
              <div style={{ fontSize: '10px', color: '#4a5568', marginBottom: '4px' }}>
                Slots: {Math.min(slots, stack.length)} / {slots}
              </div>

              {/* Stack */}
              <div style={{ minHeight: '80px', background: '#fff', border: '1px dashed #ccc', padding: '4px', fontSize: '11px' }}>
                {stack.length === 0 ? (
                  <span style={{ color: '#999' }}>empty</span>
                ) : (
                  stack.map((cardId: string, i: number) => {
                    const card = G.cards?.[cardId] as TimestreamsCard | undefined;
                    const label = card?.name || cardId.split('#')[0] || cardId;
                    const fullCard = card || { id: cardId, name: label, ownerId: '', cardType: 'invention' as const, subtypes: [], hasPlayEffect: false, hasScoreEffect: false, hasReact: false };
                    return (
                      <div
                        key={i}
                        style={{ padding: '1px 0', borderBottom: '1px solid #eee', cursor: 'pointer' }}
                        onMouseEnter={() => handleCardHover(fullCard)}
                        onMouseLeave={() => handleCardHover(null)}
                      >
                        {i + 1}. {label}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Setup Phase: Home Era Claims (for selectable mode) */}
      {isSetupPhase && G.config?.homeEraAssignment === 'selectable' && (
        <div style={{ marginTop: '16px', padding: '12px', border: '2px solid #eab308', borderRadius: '6px', background: '#fefce8' }}>
          <h3 style={{ margin: 0, color: '#854d0e' }}>Setup: Claim Your Home Era</h3>
          <p style={{ fontSize: '12px', color: '#713f12' }}>Click an available era. Must be unique. Ready when all claimed.</p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '8px 0' }}>
            {ERA_ORDER.map(era => {
              const claimed = Object.values(G.players || {}).some((p: any) => p.homeEra === era);
              const myEra = G.players?.[playerID]?.homeEra;
              return (
                <button
                  key={era}
                  onClick={() => moves.claimHomeEra && moves.claimHomeEra(era)}
                  disabled={claimed || !!myEra}
                  style={{
                    padding: '6px 12px',
                    background: myEra === era ? '#22c55e' : claimed ? '#64748b' : '#ca8a04',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: myEra === era || !claimed ? 'pointer' : 'not-allowed'
                  }}
                >
                  {ERA_LABELS[era]} {claimed && !myEra ? '(taken)' : ''}
                </button>
              );
            })}
          </div>
          <button onClick={() => moves.setReady && moves.setReady(true)} disabled={!G.players?.[playerID]?.homeEra}>
            Set Ready
          </button>
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
      {(showHand || myHand.length > 0) && (
        <div style={{ marginTop: '8px', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>
            Your Hand ({playerID})
            {teachingMode && ' (Teaching Mode - always visible)'}
            {isMyTurn && !teachingMode ? ' — Your turn' : ''}
          </div>

          {myHand.length === 0 ? (
            <div style={{ color: '#666', fontSize: '12px' }}>No cards in hand</div>
          ) : (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {myHand.map((card: any, idx: number) => {
                const fullCard = card as TimestreamsCard;
                return (
                  <div
                    key={idx}
                    style={{ border: '1px solid #aaa', padding: '4px', fontSize: '11px', background: '#fff', cursor: 'pointer' }}
                    onMouseEnter={() => handleCardHover(fullCard)}
                    onMouseLeave={() => handleCardHover(null)}
                  >
                    {fullCard.name || fullCard.id}
                    <div style={{ marginTop: '4px' }}>
                      {fullCard.cardType === 'invention' && (
                        <button
                          onClick={() => handlePlayInvention(fullCard.id)}
                          disabled={!isMyTurn}
                          style={{ fontSize: '10px', marginRight: '4px' }}
                        >
                          Play Invention
                        </button>
                      )}
                      {fullCard.cardType === 'action' && (
                        <button
                          onClick={() => handlePlayAction(fullCard.id)}
                          disabled={!isMyTurn}
                          style={{ fontSize: '10px' }}
                        >
                          Play Action
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: '10px' }}>
            <button
              onClick={handlePass}
              disabled={!isMyTurn}
              style={{ padding: '4px 10px', marginRight: '8px' }}
            >
              Pass
            </button>
            <span style={{ fontSize: '11px', color: '#666' }}>
              (Some cards require prompts — stubbed for now)
            </span>
          </div>
        </div>
      )}

      {/* Prompt stub */}
      {pendingPrompts.length > 0 && (
        <p className="ts-prompt" style={{ marginTop: '10px', color: '#c53030', fontSize: '13px' }}>
          Pending prompt: {JSON.stringify(pendingPrompts[0])}
        </p>
      )}

      {/* Zoomed Card View for Teaching */}
      <div style={{ 
        marginTop: '20px', 
        padding: '12px', 
        border: '2px solid #2d3748', 
        borderRadius: '8px',
        background: '#f7fafc',
        minHeight: '220px'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '14px' }}>
          🔍 Zoomed Card View (hover any card above)
        </div>
        {hoveredCard ? (
          <div>
            {/* Placeholder zoomed "image" / card visual */}
            <div style={{
              width: '180px',
              height: '240px',
              border: '3px solid #2d3748',
              borderRadius: '8px',
              background: 'linear-gradient(145deg, #ffffff, #e2e8f0)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '10px',
              fontSize: '13px',
              fontWeight: 'bold',
              textAlign: 'center',
              padding: '8px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            }}>
              {hoveredCard.name || hoveredCard.id}
              <br />
              <span style={{ fontSize: '10px', fontWeight: 'normal', opacity: 0.7 }}>
                (Zoomed preview)
              </span>
            </div>

            {/* Composed card text */}
            <div style={{ 
              fontSize: '12px', 
              lineHeight: '1.4', 
              whiteSpace: 'pre-wrap',
              background: 'white',
              padding: '8px',
              border: '1px solid #cbd5e0',
              borderRadius: '4px'
            }}>
              {composeCardText(hoveredCard)}
            </div>
          </div>
        ) : (
          <div style={{ color: '#718096', fontSize: '12px' }}>
            Hover over a card in the timeline or your hand to see a zoomed view with full composed text.
          </div>
        )}
      </div>

      <div style={{ marginTop: '12px', fontSize: '11px', color: '#718096' }}>
        Phase: {G.phase} | Current player: {currentPlayer}
      </div>
    </div>
  );
};

export default TimestreamsBoard;
