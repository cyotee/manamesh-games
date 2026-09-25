import type { CardSchema } from '@cyotee/manamesh/game/modules';
import { METALS, type MistbornCard } from './types';

const cardTypes = new Set(['action', 'ally', 'funding', 'character-starter', 'confrontation', 'lord-ruler']);
const metals = new Set<string>(METALS);
const isMetal = (value: unknown): boolean => typeof value === 'string' && metals.has(value);
const isMetalRequirement = (value: unknown): boolean =>
  isMetal(value) || (Array.isArray(value) && value.length > 0 && value.every(isMetal));
const isNonnegativeInteger = (value: unknown): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function isMistbornCard(value: unknown): value is MistbornCard {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const card = value as Record<string, unknown>;
  if (typeof card.id !== 'string' || !card.id.trim() ||
      typeof card.name !== 'string' || !card.name.trim() ||
      !isNonnegativeInteger(card.cost) ||
      typeof card.cardType !== 'string' || !cardTypes.has(card.cardType)) return false;
  for (const field of ['imageCid', 'backImageCid', 'imagePath', 'effectText']) {
    if (card[field] !== undefined && typeof card[field] !== 'string') return false;
  }
  if (card.defense !== undefined && !isNonnegativeInteger(card.defense)) return false;
  if (card.metal !== undefined && !isMetalRequirement(card.metal)) return false;
  if (card.additionalMetals !== undefined &&
      (!Array.isArray(card.additionalMetals) || !card.additionalMetals.every(isMetalRequirement))) return false;
  if (card.pairing !== undefined &&
      (!Array.isArray(card.pairing) || card.pairing.length !== 2 || !card.pairing.every(isMetal))) return false;
  if (card.tags !== undefined &&
      (!Array.isArray(card.tags) || !card.tags.every(tag => typeof tag === 'string'))) return false;
  return true;
}

export const mistbornCardSchema: CardSchema<MistbornCard> = {
  validate: isMistbornCard,
  create(data) {
    const card = { ...data };
    if (!isMistbornCard(card)) throw new Error('Invalid Mistborn card: provide id, name, cost, cardType and valid metadata');
    return card;
  },
  getAssetKey: card => card.id,
};
