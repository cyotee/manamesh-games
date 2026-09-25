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
if (!process.argv[2]) throw new Error('Usage: yarn node experiments/poker-shuffle/wasm/browser-check.mjs <candidate.wasm>');
const wasm = readFileSync(process.argv[2]);
const worker = `
onmessage = async ({ data: seats }) => {
  try {
    const module = await WebAssembly.compile(await (await fetch('/candidate.wasm')).arrayBuffer());
    if (WebAssembly.Module.imports(module).length) throw new Error('Unexpected WASM imports');
    const instance = await WebAssembly.instantiate(module);
    const seed = crypto.getRandomValues(new Uint32Array(8));
    const start = performance.now();
    const cards = instance.exports.run_checks(seats, ...seed);
    seed.fill(0);
    postMessage({ seats, cards, elapsedMs: Math.round(performance.now() - start), memoryBytes: instance.exports.memory.buffer.byteLength });
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
    const result = await page.evaluate(seats => new Promise((resolve, reject) => {
      const worker = new Worker('/worker.js');
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Candidate worker timeout')); }, 300000);
      const finish = () => { clearTimeout(timer); worker.terminate(); };
      worker.onerror = event => { finish(); reject(new Error(event.message)); };
      worker.onmessage = ({ data }) => { finish(); data.error ? reject(new Error(data.error)) : resolve(data); };
      worker.postMessage(seats);
    }), seats);
    if (result.cards !== 52) throw new Error('Incomplete candidate checks');
    console.log(JSON.stringify(result));
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
