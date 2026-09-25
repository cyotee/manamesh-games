/** Isolated candidate evaluation. No application integration or persistent keys. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { once } from 'node:events';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(resolve(root, 'packages/manamesh/packages/frontend/package.json'));
const { chromium } = require('@playwright/test');
if (!process.argv[2]) throw new Error('Usage: yarn node experiments/poker-shuffle/wasm/peer-browser-check.mjs <peer.wasm>');
const wasm = readFileSync(process.argv[2]);
const worker = `
let instance;
onmessage = async ({ data }) => {
  try {
    if (!instance) {
      const module = await WebAssembly.compile(await (await fetch('/candidate.wasm')).arrayBuffer());
      if (WebAssembly.Module.imports(module).length) throw new Error('Unexpected WASM imports');
      instance = await WebAssembly.instantiate(module);
    }
    const api = instance.exports;
    let status;
    if (data.op === 'initialize') {
      const session = new Uint8Array(data.session || []);
      if (session.length !== 32) throw new Error('Invalid session');
      new Uint8Array(api.memory.buffer, api.input_ptr(), session.length).set(session);
      const seed = crypto.getRandomValues(new Uint32Array(8));
      status = api.initialize(data.seats, data.seat, data.dealer, session.length, ...seed); seed.fill(0);
    } else {
      const allowed = ['admit', 'make_shuffle', 'receive_shuffle', 'make_token', 'receive_token', 'review_token', 'open_private_card', 'checkpoint_digest', 'authorize_street', 'authorize_showdown', 'make_public_token', 'receive_public_token', 'open_public_card'];
      if (!allowed.includes(data.op)) throw new Error('Unknown operation');
      const bytes = new Uint8Array(data.bytes || []);
      if (bytes.length > 10000) throw new Error('Oversized input');
      new Uint8Array(api.memory.buffer, api.input_ptr(), bytes.length).set(bytes);
      status = ['receive_token', 'review_token', 'receive_public_token'].includes(data.op) ? api[data.op](data.position, data.index, bytes.length)
        : ['make_token', 'open_private_card', 'make_public_token', 'open_public_card'].includes(data.op) ? api[data.op](data.position)
        : ['authorize_street', 'authorize_showdown'].includes(data.op) ? api[data.op](data.index ?? 0, bytes.length)
        : ['admit', 'receive_shuffle'].includes(data.op) ? api[data.op](data.index, bytes.length) : api[data.op]();
    }
    const bytes = status === 0 ? [...new Uint8Array(api.memory.buffer, api.output_ptr(), api.output_len())] : [];
    postMessage({ status, bytes });
  } catch (error) { postMessage({ error: String(error) }); }
};`;
const server = http.createServer((req, res) => {
  if (req.url === '/candidate.wasm') { res.setHeader('Content-Type', 'application/wasm'); res.end(wasm); }
  else if (req.url === '/worker.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(worker); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Shuffle evaluation</title>'); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  console.log(JSON.stringify({ browser: browser.version(), wasmBytes: wasm.length }));
  for (const seats of [2, 3, 4, 5]) {
    const result = await page.evaluate(async seats => {
      const workers = Array.from({ length: seats + 2 }, () => new Worker('/worker.js'));
      const dealer = seats - 1;
      const start = performance.now();
      const call = (seat, op, extra = {}) => new Promise((resolve, reject) => {
        const worker = workers[seat];
        const timer = setTimeout(() => reject(new Error('Peer timeout')), 120000);
        worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
        worker.onmessage = ({ data }) => { clearTimeout(timer); data.error ? reject(new Error(data.error)) : resolve(data); };
        worker.postMessage({ op, dealer, position: 0, ...extra });
      });
      const accept = result => { if (result.status !== 0) throw new Error('Expected accepted operation'); return result.bytes; };
      const refuse = result => { if (result.status !== 1 || result.bytes.length) throw new Error('Expected rejected operation'); };
      try {
        const session = [...crypto.getRandomValues(new Uint8Array(32))];
        const announcements = await Promise.all(workers.slice(0, seats).map((_, seat) => call(seat, 'initialize', { seats, seat, session }).then(accept)));
        const otherSession = session.slice(); otherSession[0] ^= 1;
        refuse(await call(seats, 'initialize', { seats, seat: 0, session: Array(32).fill(0) }));
        const foreign = accept(await call(seats, 'initialize', { seats, seat: 0, session: otherSession }));
        refuse(await call(1, 'admit', { index: 0, bytes: foreign }));
        refuse(await call(seats + 1, 'initialize', { seats, seat: 0, dealer: seats, session }));
        const wrongDealer = accept(await call(seats + 1, 'initialize', { seats, seat: 0, dealer: 0, session }));
        refuse(await call(1, 'admit', { index: 0, bytes: wrongDealer }));
        refuse(await call(0, 'initialize', { seats, seat: 0, session: otherSession }));
        for (let seat = 0; seat < seats; seat++) {
          for (let author = 0; author < seats; author++) accept(await call(seat, 'admit', { index: author, bytes: announcements[author] }));
          refuse(await call(seat, 'make_token'));
        }
        const agreedDigest = async () => {
          const digests = await Promise.all(workers.slice(0, seats).map((_, seat) => call(seat, 'checkpoint_digest').then(accept)));
          if (digests.some(digest => digest.length !== 32 || digest.join(',') !== digests[0].join(','))) throw new Error('Divergent transcript');
          return digests[0].join(',');
        };
        let head = await agreedDigest();
        let previous;
        for (let author = 0; author < seats; author++) {
          const bytes = accept(await call(author, 'make_shuffle'));
          // Equality tracking must fail after each rerandomizing shuffle.
          if (previous) for (let i = 0; i < 52; i++) {
            const card = bytes.slice(i * 66, (i + 1) * 66).join(',');
            if (Array.from({ length: 52 }, (_, j) => previous.slice(j * 66, (j + 1) * 66).join(',')).includes(card)) throw new Error('Trackable ciphertext');
          }
          for (let seat = 0; seat < seats; seat++) if (seat !== author) {
            const duplicate = bytes.slice(); duplicate.splice(66, 66, ...bytes.slice(0, 66));
            refuse(await call(seat, 'receive_shuffle', { index: author, bytes: duplicate }));
            accept(await call(seat, 'receive_shuffle', { index: author, bytes }));
            refuse(await call(seat, 'receive_shuffle', { index: author, bytes }));
          }
          const nextHead = await agreedDigest();
          if (nextHead === head) throw new Error('Transcript did not advance');
          head = nextHead;
          previous = bytes;
        }
        const openedCards = [];
        for (let position = 0; position < 2 * seats; position++) {
          const owner = (dealer + 1 + position % seats) % seats;
          refuse(await call(owner, 'make_token', { position }));
          refuse(await call(owner, 'open_private_card', { position }));
          for (let seat = 0; seat < seats; seat++) if (seat !== owner) {
            const bytes = accept(await call(seat, 'make_token', { position }));
            const otherHole = (position + seats) % (2 * seats);
            refuse(await call(owner, 'receive_token', { position: otherHole, index: seat, bytes }));
            refuse(await call(seat, 'receive_token', { position, index: owner, bytes }));
            if (seats > 2) {
              const wrong = Array.from({ length: seats }, (_, i) => i).find(i => i !== owner && i !== seat);
              refuse(await call(owner, 'receive_token', { position, index: wrong, bytes }));
            }
            for (let reviewer = 0; reviewer < seats; reviewer++) {
              if (accept(await call(reviewer, 'review_token', { position, index: seat, bytes })).length !== 0) throw new Error('review_exposed_output');
              // Review alone never populates an opening cache, even for the owner.
              refuse(await call(reviewer, 'open_private_card', { position }));
              refuse(await call(reviewer, 'review_token', { position: otherHole, index: seat, bytes }));
              refuse(await call(reviewer, 'review_token', { position, index: owner, bytes }));
              const changed = [...bytes]; changed[changed.length - 1] ^= 1;
              refuse(await call(reviewer, 'review_token', { position, index: seat, bytes: changed }));
            }
            accept(await call(owner, 'receive_token', { position, index: seat, bytes }));
            refuse(await call(owner, 'receive_token', { position, index: seat, bytes }));
            refuse(await call(seat, 'open_private_card', { position }));
            const remaining = Array.from({ length: seats }, (_, i) => i).some(i => i > seat && i !== owner);
            if (remaining) refuse(await call(owner, 'open_private_card', { position }));
          }
          const opened = accept(await call(owner, 'open_private_card', { position }));
          if (opened.length !== 1 || opened[0] >= 52 || openedCards.includes(opened[0])) throw new Error('Invalid or duplicate private card');
          openedCards.push(opened[0]); // Test oracle only; never sent to another worker.
        }
        for (let seat = 0; seat < seats; seat++) for (const position of [2 * seats, 2 * seats + 1, 51, 52, 0xffffffff]) {
          refuse(await call(seat, 'make_token', { position }));
          refuse(await call(seat, 'open_private_card', { position }));
          refuse(await call(seat, 'receive_token', { position, index: 0, bytes: [] }));
          refuse(await call(seat, 'review_token', { position, index: 0, bytes: [] }));
        }
        const flopHead = [...crypto.getRandomValues(new Uint8Array(32))];
        for (let seat = 0; seat < seats; seat++) {
          refuse(await call(seat, 'make_public_token', { position: 2 * seats + 1 }));
          refuse(await call(seat, 'authorize_street', { index: 2, bytes: flopHead }));
          refuse(await call(seat, 'authorize_street', { bytes: Array(32).fill(0) }));
          const localHead = flopHead.slice();
          if (seats === 2 && seat === 1) localHead[0] ^= 1; // Deliberately divergent checkpoint.
          accept(await call(seat, 'authorize_street', { bytes: localHead }));
          const premature = localHead.slice(); premature[0] ^= 255;
          refuse(await call(seat, 'authorize_street', { index: 1, bytes: premature }));
          refuse(await call(seat, 'authorize_street', { bytes: localHead }));
          for (const position of [0, 2 * seats, 2 * seats + 4, 2 * seats + 5, 51]) {
            refuse(await call(seat, 'make_public_token', { position }));
            refuse(await call(seat, 'open_public_card', { position }));
          }
        }
        let previousPublic;
        for (let index = 0; index < 3; index++) {
          const position = 2 * seats + 1 + index;
          const contributions = await Promise.all(workers.slice(0, seats).map((_, seat) => call(seat, 'make_public_token', { position }).then(accept)));
          previousPublic = contributions;
          for (let seat = 0; seat < seats; seat++) {
            refuse(await call(seat, 'open_public_card', { position }));
            for (let author = 0; author < seats; author++) if (author !== seat) {
              const bytes = contributions[author];
              refuse(await call(seat, 'receive_public_token', { position: 2 * seats + 1 + (index + 1) % 3, index: author, bytes }));
              const result = await call(seat, 'receive_public_token', { position, index: author, bytes });
              if (seats === 2) refuse(result); else accept(result);
              refuse(await call(seat, 'receive_public_token', { position, index: author, bytes }));
            }
          }
          if (seats === 2) {
            for (let seat = 0; seat < seats; seat++) refuse(await call(seat, 'open_public_card', { position }));
          } else {
            const cards = await Promise.all(workers.slice(0, seats).map((_, seat) => call(seat, 'open_public_card', { position }).then(accept)));
            if (cards.some(card => card.length !== 1 || card[0] !== cards[0][0] || card[0] >= 52 || openedCards.includes(card[0]))) throw new Error('Invalid public card');
            openedCards.push(cards[0][0]);
          }
        }
        if (seats === 2) {
          for (let seat = 0; seat < seats; seat++) refuse(await call(seat, 'authorize_street', { index: 1, bytes: flopHead }));
        } else for (let stage = 1; stage <= 2; stage++) {
          const position = 2 * seats + (stage === 1 ? 5 : 7);
          const checkpoint = [...crypto.getRandomValues(new Uint8Array(32))];
          for (let seat = 0; seat < seats; seat++) {
            refuse(await call(seat, 'make_public_token', { position }));
            accept(await call(seat, 'authorize_street', { index: stage, bytes: checkpoint }));
            refuse(await call(seat, 'authorize_street', { index: stage, bytes: checkpoint }));
            for (const forbidden of [0, 2 * seats, 2 * seats + 1, 2 * seats + 4, 2 * seats + 6]) {
              refuse(await call(seat, 'make_public_token', { position: forbidden }));
            }
          }
          const contributions = await Promise.all(workers.slice(0, seats).map((_, seat) => call(seat, 'make_public_token', { position }).then(accept)));
          for (let seat = 0; seat < seats; seat++) {
            refuse(await call(seat, 'open_public_card', { position }));
            for (let author = 0; author < seats; author++) if (author !== seat) {
              refuse(await call(seat, 'receive_public_token', { position, index: author, bytes: previousPublic[author] }));
              accept(await call(seat, 'receive_public_token', { position, index: author, bytes: contributions[author] }));
              refuse(await call(seat, 'receive_public_token', { position, index: author, bytes: contributions[author] }));
            }
          }
          const cards = await Promise.all(workers.slice(0, seats).map((_, seat) => call(seat, 'open_public_card', { position }).then(accept)));
          if (cards.some(card => card.length !== 1 || card[0] !== cards[0][0] || card[0] >= 52 || openedCards.includes(card[0]))) throw new Error('Invalid later-street card');
          openedCards.push(cards[0][0]); previousPublic = contributions;
        }
        let showdownCardsOpened = 0;
        const showdownHead = [...crypto.getRandomValues(new Uint8Array(32))];
        const mask = seats === 2 ? 3 : (1 << (seats - 1)) - 1; // Last seat folded; its hole cards must stay private.
        for (let seat = 0; seat < seats; seat++) {
          for (const invalid of [0, 1, 1 << seats]) refuse(await call(seat, 'authorize_showdown', { index: invalid, bytes: showdownHead }));
          const authorization = await call(seat, 'authorize_showdown', { index: mask, bytes: showdownHead });
          if (seats === 2) refuse(authorization); else accept(authorization);
          refuse(await call(seat, 'authorize_showdown', { index: mask, bytes: showdownHead }));
        }
        if (seats > 2) for (let position = 0; position < 2 * seats; position++) {
          const owner = (dealer + 1 + position % seats) % seats;
          if (owner === seats - 1) {
            for (let seat = 0; seat < seats; seat++) {
              refuse(await call(seat, 'make_public_token', { position }));
              refuse(await call(seat, 'open_public_card', { position }));
            }
            continue;
          }
          const tokens = await Promise.all(workers.slice(0, seats).map((_, seat) => call(seat, 'make_public_token', { position }).then(accept)));
          for (let seat = 0; seat < seats; seat++) {
            refuse(await call(seat, 'open_public_card', { position }));
            for (let author = 0; author < seats; author++) if (author !== seat) {
              refuse(await call(seat, 'receive_public_token', { position, index: author, bytes: previousPublic[author] }));
              accept(await call(seat, 'receive_public_token', { position, index: author, bytes: tokens[author] }));
            }
          }
          const cards = await Promise.all(workers.slice(0, seats).map((_, seat) => call(seat, 'open_public_card', { position }).then(accept)));
          if (cards.some(card => card.length !== 1 || card[0] !== openedCards[position])) throw new Error('Showdown differs from private card');
          showdownCardsOpened++;
        }
        return { seats, dealer, privateCardsOpened: 2 * seats, privateReviewDoesNotOpen: true, showdownCardsOpened, publicCardsOpened: seats === 2 ? 0 : 5, divergentFlopRejected: seats === 2, isolatedWorkers: seats, crossDealerRejected: true, crossSessionRejected: true, transcriptAgreement: true, elapsedMs: Math.round(performance.now() - start) };
      } finally { workers.forEach(worker => worker.terminate()); }
    }, seats);
    console.log(JSON.stringify(result));
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
