import type { TimestreamsState, TimestreamsCard } from '../types';

export interface PlayerPrompt {
  id: string;
  deciderId: string;
  kind: 'choose-card' | 'choose-option' | 'choose-position' | 'confirm';
  options: string[];
  min: number;
  max: number;
  reason: string;
}

export type ChoiceMap = Record<string, string | string[]>;

export interface EffectResult { ok: boolean; prompts: PlayerPrompt[]; log: string[]; }

export interface ExecCtx {
  G: TimestreamsState;
  playerId: string;
  card: TimestreamsCard;
  choices: ChoiceMap;
}

export type Executor = (ctx: ExecCtx) => EffectResult;

export const OK: EffectResult = { ok: true, prompts: [], log: [] };

export function done(log: string[]): EffectResult {
  return { ok: true, prompts: [], log };
}

export function needs(prompt: PlayerPrompt): EffectResult {
  return { ok: true, prompts: [prompt], log: [] };
}

export function merge(...results: EffectResult[]): EffectResult {
  return {
    ok: results.every(r => r.ok),
    prompts: results.flatMap(r => r.prompts),
    log: results.flatMap(r => r.log),
  };
}
