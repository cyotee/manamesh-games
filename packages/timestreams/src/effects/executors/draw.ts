import { requestDraws } from '../../crypto';
import { tagNumber } from '../tags';
import { done, type Executor } from '../types';

export const drawExecutor: Executor = ({ G, playerId, card }) => {
  const log: string[] = [];
  const n = tagNumber(card, 'play:draw');
  if (n !== undefined) {
    requestDraws(G, playerId, n);
    log.push(`${card.id}: play:draw:${n}`);
  }
  const opp = tagNumber(card, 'opponents-draw');
  if (opp !== undefined) {
    for (const pid of G.playerOrder) {
      if (pid === playerId) continue;
      requestDraws(G, pid, opp);
    }
    log.push(`${card.id}: opponents-draw:${opp}`);
  }
  return done(log);
};
