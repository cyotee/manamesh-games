import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getLocalAssetUrl, PLAYER_TRAINING_TRACK_PATH, TrainingTrack } from './index';
import * as assets from './assets';
import * as data from './data';

describe('Mistborn public entry', () => {
  it('renders its exported React component with package dependencies', () => {
    const html = renderToStaticMarkup(React.createElement(TrainingTrack, { position: 0 }));
    expect(html).toContain('alt="Training Track"');
    expect(html).toContain('/assets/board/Player Training Track.png');
  });
  it('exports the same asset helpers through both supported paths', () => {
    expect(getLocalAssetUrl).toBe(assets.getLocalAssetUrl);
    expect(data.getLocalAssetUrl).toBe(getLocalAssetUrl);
    expect(PLAYER_TRAINING_TRACK_PATH).toBe(data.PLAYER_TRAINING_TRACK_PATH);
    expect(getLocalAssetUrl(PLAYER_TRAINING_TRACK_PATH)).toBe('/assets/board/Player Training Track.png');
  });
});
