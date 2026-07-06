/**
 * Browser-native scraper engine.
 * Initially focused on MTG via Scryfall (public API, good CORS).
 * Designed to stream results into a chosen output target (FSA or in-memory for zip).
 */

import type { ScrapeProgress } from './types';

const SCRYFALL_SEARCH = 'https://api.scryfall.com/cards/search';
const USER_AGENT = 'ManaMesh-AssetPackBuilder/0.1 (+https://github.com/cyotee/manamesh-games)';

export interface ScrapeOptions {
  game: 'mtg' | 'onepiece';
  sets: string[];           // e.g. ['MKM', 'LCI']
  imageSize?: 'small' | 'normal' | 'large' | 'png';
  concurrency?: number;
  onProgress?: (p: ScrapeProgress) => void;
}

export interface ScrapedCard {
  id: string;
  name: string;
  set: string;
  imageUrl: string;
  collectorNumber?: string;
}

export async function scrapeSets(options: ScrapeOptions): Promise<ScrapedCard[]> {
  const { sets, imageSize = 'normal', onProgress } = options;
  const allCards: ScrapedCard[] = [];

  const update = (patch: Partial<ScrapeProgress>) => {
    onProgress?.({
      phase: 'fetching',
      message: '',
      setsTotal: sets.length,
      setsDone: 0,
      cardsTotal: 0,
      cardsDone: 0,
      imagesDownloaded: 0,
      imagesFailed: 0,
      ...patch,
    });
  };

  for (let s = 0; s < sets.length; s++) {
    const setCode = sets[s].toLowerCase();
    update({ phase: 'fetching', currentSet: setCode.toUpperCase(), setsDone: s });

    let pageUrl = `${SCRYFALL_SEARCH}?q=set%3A${encodeURIComponent(setCode)}&unique=prints&order=set`;

    const setCards: ScrapedCard[] = [];

    while (pageUrl) {
      const resp = await fetch(pageUrl, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!resp.ok) {
        throw new Error(`Scryfall error for set ${setCode}: ${resp.status}`);
      }
      const data = await resp.json();

      for (const card of data.data || []) {
        const url = extractImageUrl(card, imageSize);
        if (!url) continue;

        const collector = card.collector_number || card.id?.slice(0, 8);
        const entryId = collector ? `${setCode.toUpperCase()}-${collector}` : card.id;

        setCards.push({
          id: entryId,
          name: card.name,
          set: setCode.toUpperCase(),
          imageUrl: url,
          collectorNumber: collector,
        });
      }

      pageUrl = data.next_page || null;

      // Be polite
      await sleep(120);
    }

    allCards.push(...setCards);
    update({ setsDone: s + 1, cardsTotal: allCards.length });
  }

  return allCards;
}

function extractImageUrl(card: any, size: string): string | null {
  if (card.image_uris) {
    return card.image_uris[size] || card.image_uris.normal || null;
  }
  if (card.card_faces?.[0]?.image_uris) {
    const face = card.card_faces[0].image_uris;
    return face[size] || face.normal || null;
  }
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Download a list of cards' images and write them using the provided writer.
 * Returns counts.
 */
export async function downloadImages(
  cards: ScrapedCard[],
  writer: {
    writeImage: (setId: string, fileName: string, blob: Blob) => Promise<void>;
  },
  options: { concurrency?: number; onProgress?: (p: ScrapeProgress) => void } = {}
) {
  const concurrency = options.concurrency ?? 5;
  void concurrency; // used for worker count
  let done = 0;
  let failed = 0;

  const queue = [...cards];

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const card = queue.shift()!;
      try {
        const resp = await fetch(card.imageUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();

        const ext = card.imageUrl.split('.').pop()?.split('?')[0] || 'jpg';
        const fileBase = card.collectorNumber
          ? `${card.set}-${card.collectorNumber}`
          : card.id;

        await writer.writeImage(card.set, `${fileBase}.${ext}`, blob);

        done++;
        options.onProgress?.({
          phase: 'downloading',
          message: `Downloaded ${done}/${cards.length}`,
          imagesDownloaded: done,
          imagesFailed: failed,
        });
      } catch (e) {
        failed++;
        console.warn('Image download failed for', card.name, e);
        options.onProgress?.({
          phase: 'downloading',
          message: `Downloaded ${done}`,
          imagesDownloaded: done,
          imagesFailed: failed,
        });
      }
    }
  });

  await Promise.all(workers);

  return { downloaded: done, failed };
}
