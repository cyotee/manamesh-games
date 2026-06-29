/**
 * Mistborn: The Deck Building Game — ManaMesh Module
 *
 * Phase 1: Rules-free board + card management with full mental-poker crypto.
 * Follows GameModule contract from @manamesh/frontend.
 */

export * from './types';
export * from './zones';
export * from './game';
export * from './crypto';
export * from './assets';
export {
  DEFAULT_MISTBORN_PACK_SOURCE,
  IPFS_MISTBORN_PACK_SOURCE,
  createLocalMistbornSource,
} from './assets';

// Data exports
export * from './data';

// Board / UI (Phase 1 wiring)
export { MistbornBoard } from './board/MistbornBoard';
export { TrainingTrack } from './board/TrainingTrack';
export { getBurnLimit } from './types';