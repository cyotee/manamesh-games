import React from 'react';
import { PLAYER_TRAINING_TRACK_PATH, getLocalAssetUrl } from '../assets';
import { getBurnLimit } from '../types';

interface TrainingTrackProps {
  position: number; // 0-based
  playerColor?: string; // e.g. 'red'
  playerId?: string;
  onAdvance?: () => void; // for rules-free demo
  burnLimit?: number;
}

const NUM_POSITIONS = 12; // approximate based on typical track length for burn 1->4 + unlocks

// Approximate positions (percentages) for the cube on the track image.
// Adjust these after visual inspection of the 3071x945 image.
// The track runs roughly horizontally.
const CUBE_POSITIONS = Array.from({ length: NUM_POSITIONS }, (_, i) => ({
  left: 8 + (i * (78 / (NUM_POSITIONS - 1))), // 8% to 86%
  top: 42, // vertical position on the track line (tune %)
}));

export function TrainingTrack({ position, playerColor = '#e74c3c', playerId, onAdvance, burnLimit }: TrainingTrackProps) {
  const safePos = Math.min(Math.max(position || 0, 0), NUM_POSITIONS - 1);
  const pos = CUBE_POSITIONS[safePos] || CUBE_POSITIONS[0];
  const currentBurn = burnLimit ?? getBurnLimit(safePos);

  const trackSrc = getLocalAssetUrl(PLAYER_TRAINING_TRACK_PATH);

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 600, margin: '0 auto' }}>
      <img
        src={trackSrc}
        alt="Training Track"
        style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 4 }}
      />

      {/* Cube overlay */}
      <div
        style={{
          position: 'absolute',
          left: `${pos.left}%`,
          top: `${pos.top}%`,
          width: 18,
          height: 18,
          backgroundColor: playerColor,
          border: '2px solid #222',
          borderRadius: 3,
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 0 0 2px rgba(255,255,255,0.6)',
          zIndex: 10,
          cursor: onAdvance ? 'pointer' : 'default',
        }}
        title={`Position ${safePos} (Burn limit ${currentBurn})`}
        onClick={onAdvance}
      />

      {/* Labels */}
      <div style={{ position: 'absolute', bottom: -22, left: 0, right: 0, fontSize: 11, textAlign: 'center', color: '#333' }}>
        Training Position: {safePos} | Burn Limit: {currentBurn}
        {playerId && ` | Player ${playerId}`}
      </div>

      {onAdvance && (
        <button
          onClick={onAdvance}
          style={{ position: 'absolute', top: -5, right: 5, fontSize: 10, padding: '1px 4px' }}
        >
          + Advance
        </button>
      )}
    </div>
  );
}

export default TrainingTrack;