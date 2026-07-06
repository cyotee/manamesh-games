import { useState } from 'react';
import './App.css';
import {
  requestOutputDirectory,
  writeFileInDir,
  readDirectoryContents,
  type WriteTarget,
} from './lib/fs-access';
import { scrapeSets, downloadImages, type ScrapedCard } from './lib/scraper';
import { buildAssetPack, summarizePack } from './lib/pack-builder';
import type { ScrapeProgress, AssetPackManifest } from './lib/types';
import { createZip, downloadBlob } from './lib/zip';

type Tab = 'scrape' | 'build';

export default function App() {
  const [tab, setTab] = useState<Tab>('scrape');

  // Scrape state
  const [game, setGame] = useState<'mtg' | 'onepiece'>('mtg');
  const [setsInput, setSetsInput] = useState('LCI,MKM,WOE');
  const [scrapeProgress, setScrapeProgress] = useState<ScrapeProgress | null>(null);
  const [scrapedCards, setScrapedCards] = useState<ScrapedCard[]>([]);
  const [writeTarget, setWriteTarget] = useState<WriteTarget | null>(null);
  const [scrapeLog, setScrapeLog] = useState<string[]>([]);

  // Build state
  const [buildFiles, setBuildFiles] = useState<Map<string, File> | null>(null);
  const [buildResult, setBuildResult] = useState<{ manifest: AssetPackManifest; zipBlob?: Blob } | null>(null);
  const [buildLog, setBuildLog] = useState<string>('');
  const [isBuilding, setIsBuilding] = useState(false);

  const log = (msg: string) => setScrapeLog((l) => [...l.slice(-18), msg]);

  // ---------------- SCRAPE ----------------
  async function handleChooseOutput() {
    const target = await requestOutputDirectory('manamesh-scrape-output');
    setWriteTarget(target);
    if (target) {
      log(`Output target: ${target.name} (${target.kind})`);
    }
  }

  async function runScrape() {
    setScrapeLog([]);
    setScrapedCards([]);
    setScrapeProgress({ phase: 'discovering', message: 'Starting...' });

    const setList = setsInput
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (setList.length === 0) {
      log('No sets provided.');
      return;
    }

    try {
      log(`Fetching card data for ${setList.join(', ')} via Scryfall...`);

      const cards = await scrapeSets({
        game,
        sets: setList,
        imageSize: 'normal',
        concurrency: 3,
        onProgress: setScrapeProgress,
      });

      setScrapedCards(cards);
      log(`Found ${cards.length} cards across ${setList.length} sets.`);

      if (!writeTarget) {
        log('No output folder selected. Will offer ZIP at the end.');
      }

      // Download images
      setScrapeProgress({ phase: 'downloading', message: 'Downloading images...' });

      let downloaded = 0;
      let failed = 0;

      const writer = {
        writeImage: async (setId: string, fileName: string, blob: Blob) => {
          if (writeTarget?.kind === 'fs-access' && writeTarget.directoryHandle) {
            const dir = writeTarget.directoryHandle;
            // structure: <set>/cards/<file>
            const cardsDir = await (dir as any).getDirectoryHandle(setId, { create: true });
            const finalDir = await cardsDir.getDirectoryHandle('cards', { create: true });
            const fh = await finalDir.getFileHandle(fileName, { create: true });
            const w = await fh.createWritable();
            await w.write(blob);
            await w.close();
          }
          downloaded++;
        },
      };

      await downloadImages(cards, writer, {
        concurrency: 5,
        onProgress: (p) => setScrapeProgress(p),
      });

      // Generate manifests (root + per-set)
      setScrapeProgress({ phase: 'manifests', message: 'Writing manifests...' });

      if (writeTarget?.kind === 'fs-access' && writeTarget.directoryHandle) {
        const dir = writeTarget.directoryHandle;
        // Minimal root manifest
        const root = {
          name: `ManaMesh ${game.toUpperCase()} - Scrape`,
          version: '1.0.0',
          game,
          sets: setList.map((id) => ({ name: id, path: id })),
        };
        await writeFileInDir(dir, 'manifest.json', JSON.stringify(root, null, 2));

        // Per-set manifests (very simplified for now)
        for (const sid of setList) {
          const setCards = cards.filter((c) => c.set === sid);
          const setManifest = {
            name: `${game} - ${sid}`,
            version: '1.0.0',
            game,
            cards: setCards.map((c) => ({ id: c.id, name: c.name, front: `cards/${c.id.split('-').pop() || c.id}.jpg` })),
          };
          await writeFileInDir(dir, `${sid}/manifest.json`, JSON.stringify(setManifest, null, 2));
        }
      }

      setScrapeProgress({ phase: 'complete', message: `Complete. ${downloaded} images written.` });
      log(`Done. ${downloaded} downloaded, ${failed} failed.`);

      // Always offer a ZIP of the scraped cards as fallback / portable option
      if (cards.length > 0) {
        log('Preparing portable ZIP of metadata + images (in memory)...');
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      log('ERROR: ' + msg);
      setScrapeProgress({ phase: 'error', message: msg });
    }
  }

  async function downloadScrapeZip() {
    if (scrapedCards.length === 0) return;

    const entries: { path: string; data: Uint8Array }[] = [];

    // Fetch images again for the zip (simple approach)
    for (const card of scrapedCards.slice(0, 200)) { // safety limit in demo
      try {
        const r = await fetch(card.imageUrl);
        const buf = new Uint8Array(await r.arrayBuffer());
        const fname = `${card.set}/cards/${card.id}.jpg`;
        entries.push({ path: fname, data: buf });
      } catch {}
    }

    // Add manifests
    const rootManifest = JSON.stringify({
      name: 'ManaMesh Scrape (ZIP)',
      version: '1.0.0',
      game,
      sets: [...new Set(scrapedCards.map((c) => c.set))].map((s) => ({ name: s, path: s })),
    });
    entries.push({ path: 'manifest.json', data: new TextEncoder().encode(rootManifest) });

    const zip = await createZip(entries);
    downloadBlob(zip, `manamesh-scrape-${game}-${Date.now()}.zip`);
  }

  // ---------------- BUILD ----------------
  async function handleSelectDirectory() {
    setBuildResult(null);
    setBuildLog('');

    // Try modern FSA first
    if ('showDirectoryPicker' in window) {
      try {
        const dir = await (window as any).showDirectoryPicker({ mode: 'read' });
        const files = await readDirectoryContents(dir);
        setBuildFiles(files);
        setBuildLog(`Loaded ${files.size} files from "${dir.name}".`);
        return;
      } catch (e) {
        // user cancelled or not supported
      }
    }

    // Fallback: webkitdirectory
    const input = document.createElement('input');
    input.type = 'file';
    (input as any).webkitdirectory = true;
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length) {
        const map = await readDirectoryContents(files);
        setBuildFiles(map);
        setBuildLog(`Loaded ${map.size} files via directory picker.`);
      }
    };
    input.click();
  }

  async function handleBuildPack() {
    if (!buildFiles) return;
    setIsBuilding(true);
    setBuildLog('Building pack...');

    try {
      const { manifest, zipBlob } = await buildAssetPack(buildFiles, 'mtg'); // default mtg for now
      setBuildResult({ manifest, zipBlob });
      const summary = summarizePack(manifest);
      setBuildLog(
        `Built pack: ${summary.cardCount} cards in ${summary.sets.length} sets.\n` +
          `You can now download the ZIP or write it directly to disk.`
      );
    } catch (err: any) {
      setBuildLog('Build error: ' + (err?.message || err));
    } finally {
      setIsBuilding(false);
    }
  }

  async function handleExportZip() {
    if (!buildResult?.zipBlob) return;
    downloadBlob(buildResult.zipBlob, `manamesh-pack-${Date.now()}.zip`);
  }

  async function handleWriteToFolder() {
    if (!buildFiles || !buildResult) return;

    const target = await requestOutputDirectory('manamesh-built-pack');
    if (!target || target.kind !== 'fs-access' || !target.directoryHandle) {
      // fallback to zip
      handleExportZip();
      return;
    }

    const dir = target.directoryHandle;
    setBuildLog('Writing files to chosen folder...');

    for (const [rel, file] of buildFiles) {
      const buf = new Uint8Array(await file.arrayBuffer());
      await writeFileInDir(dir, rel, buf);
    }

    // write the generated manifests too
    if (buildResult.manifest) {
      await writeFileInDir(dir, 'manifest.json', JSON.stringify(buildResult.manifest, null, 2));
    }

    setBuildLog(`Successfully wrote pack to: ${target.name}`);
  }

  return (
    <div className="app">
      <header>
        <div>
          <h1>ManaMesh Asset Pack Builder</h1>
          <span className="badge">IPFS Static • Browser Only</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Scrape cards + build valid asset packs • Save to your filesystem
        </div>
      </header>

      <div className="tabs">
        <button className={`tab ${tab === 'scrape' ? 'active' : ''}`} onClick={() => setTab('scrape')}>
          Scrape Images
        </button>
        <button className={`tab ${tab === 'build' ? 'active' : ''}`} onClick={() => setTab('build')}>
          Build &amp; Package from FS
        </button>
      </div>

      {/* SCRAPE TAB */}
      {tab === 'scrape' && (
        <div className="grid">
          <div className="panel">
            <h2>1. Scrape (MTG via Scryfall)</h2>
            <div className="row">
              <select value={game} onChange={(e) => setGame(e.target.value as any)}>
                <option value="mtg">Magic: The Gathering</option>
                <option value="onepiece">One Piece TCG (limited)</option>
              </select>

              <input
                type="text"
                value={setsInput}
                onChange={(e) => setSetsInput(e.target.value)}
                placeholder="Set codes, e.g. LCI,MKM"
              />

              <button className="primary" onClick={runScrape} disabled={scrapeProgress?.phase === 'downloading'}>
                Start Scrape
              </button>
            </div>

            <div className="row">
              <button onClick={handleChooseOutput}>
                {writeTarget ? `Target: ${writeTarget.name}` : 'Choose output folder (writes real files)'}
              </button>
              <span className="status">File System Access (Chromium) or ZIP fallback</span>
            </div>

            {scrapeProgress && (
              <>
                <div className="progress">
                  <div
                    className="progress-bar"
                    style={{ width: `${Math.min(100, ((scrapeProgress.setsDone || 0) / Math.max(1, scrapeProgress.setsTotal || 1)) * 100)}%` }}
                  />
                </div>
                <div className="status">
                  {scrapeProgress.phase} — {scrapeProgress.message}
                </div>
              </>
            )}

            <div className="log">{scrapeLog.join('\n')}</div>

            {scrapedCards.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <button onClick={downloadScrapeZip} className="primary">
                  Download scraped data as ZIP (portable)
                </button>
                <span className="stat" style={{ marginLeft: 12 }}>{scrapedCards.length} cards</span>
              </div>
            )}
          </div>

          <div className="panel">
            <h2>How it works</h2>
            <ul style={{ textAlign: 'left', fontSize: 14, lineHeight: 1.45 }}>
              <li>Uses the public Scryfall API (no key required).</li>
              <li>Downloads card images and writes them using the modern File System Access API when available.</li>
              <li>Always generates a ZIP as a universal portable option.</li>
              <li>For full archives, the original Python <code>card-scraper</code> is still recommended.</li>
            </ul>
            <p className="status" style={{ marginTop: 12 }}>
              Output structure: <code>&lt;set&gt;/cards/&lt;id&gt;.jpg</code> + <code>manifest.json</code>
            </p>
          </div>
        </div>
      )}

      {/* BUILD TAB */}
      {tab === 'build' && (
        <div className="panel">
          <h2>Build Asset Pack from Local Filesystem</h2>
          <p className="status">
            Select a folder containing images (and optionally existing manifests). The tool will generate correct
            root + per-set manifests and let you export a ready-to-use pack.
          </p>

          <div className="row" style={{ marginTop: 16 }}>
            <button onClick={handleSelectDirectory}>Select folder or directory</button>
            <button onClick={handleBuildPack} disabled={!buildFiles || isBuilding} className="primary">
              {isBuilding ? 'Building…' : 'Build / Repair Pack'}
            </button>
          </div>

          {buildFiles && (
            <div style={{ margin: '12px 0' }}>
              Loaded {buildFiles.size} files.
            </div>
          )}

          {buildLog && <div className="log">{buildLog}</div>}

          {buildResult && (
            <div className="row" style={{ marginTop: 16 }}>
              <button onClick={handleExportZip} className="primary">
                Download as ZIP
              </button>
              <button onClick={handleWriteToFolder}>
                Write directly to folder (File System Access)
              </button>
              <span className="stat">
                {buildResult.manifest.cards?.length || 0} cards • {buildResult.manifest.sets?.length || 0} sets
              </span>
            </div>
          )}

          <div style={{ marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>
            Compatible with the main ManaMesh frontend asset loader. Perfect for turning scraper output or custom
            image collections into usable IPFS packs.
          </div>
        </div>
      )}

      <footer>
        Static SPA • Designed to be published to IPFS. All processing happens in your browser. •{' '}
        <a href="https://github.com/cyotee/manamesh-games" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
          Source
        </a>
      </footer>
    </div>
  );
}
