import { describe, expect, it } from 'vitest';
import { mistbornCardSchema } from './cardSchema';
import { MistbornModule } from './game';

const valid = { id: 'funding', name: 'Funding', cost: 0, cardType: 'funding' as const };

describe('Mistborn card schema', () => {
  it('preserves a complete card and is used by the public module', () => {
    const card = { ...valid, metal: 'steel' as const, pairing: ['steel', 'iron'] as ['steel', 'iron'], tags: ['coin'] };
    expect(MistbornModule.cardSchema).toBe(mistbornCardSchema);
    expect(mistbornCardSchema.create(card)).toEqual(card);
    expect(mistbornCardSchema.create(card)).not.toBe(card);
  });

  it.each([
    null, [], {}, { ...valid, id: '' }, { ...valid, name: 42 },
    { ...valid, cost: undefined }, { ...valid, cost: -1 },
    { ...valid, cost: NaN }, { ...valid, cost: Infinity }, { ...valid, cost: 1.5 },
    { ...valid, cardType: undefined }, { ...valid, cardType: 'unknown' },
    { ...valid, metal: 'gold' }, { ...valid, metal: [] },
    { ...valid, additionalMetals: [42] }, { ...valid, pairing: ['steel'] },
    { ...valid, defense: -1 }, { ...valid, tags: [1] }, { ...valid, imageCid: {} },
  ])('rejects invalid card data %#', card => {
    expect(mistbornCardSchema.validate(card)).toBe(false);
  });

  it('rejects incomplete factory inputs instead of inventing game values', () => {
    expect(() => mistbornCardSchema.create({ id: 'x', name: 'Unknown' })).toThrow('Invalid Mistborn card');
  });
});
