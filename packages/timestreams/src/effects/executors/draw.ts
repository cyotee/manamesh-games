import { requestDraws } from '../../crypto';
import { tagNumber } from '../tags';
import { done, type Executor } from '../types';
import { playOnce } from '../playOnce';

export const drawExecutor: Executor = ({ G, playerId, card }) => {
  const log: string[] = [];
  const n = tagNumber(card, 'play:draw');
  if (n !== undefined) {
    log.push(
      ...playOnce(G, card.id, `draw:self:${playerId}:${n}`, () => {
        requestDraws(G, playerId, n);
        return [
          `${card.name || card.id}: P${playerId} draws ${n} card(s) into hand`,
        ];
      }),
    );
  }
  const opp = tagNumber(card, 'opponents-draw');
  if (opp !== undefined) {
    log.push(
      ...playOnce(G, card.id, `draw:opponents:${opp}`, () => {
        for (const pid of G.playerOrder) {
          if (pid === playerId) continue;
          requestDraws(G, pid, opp);
        }
        return [
          `${card.name || card.id}: each opponent draws ${opp} card(s)`,
        ];
      }),
    );
  }
  return done(log);
};
