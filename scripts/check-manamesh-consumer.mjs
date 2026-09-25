/** Run inside an isolated npm consumer after installing the staged tarball. */
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

if (!process.argv[2]) throw new Error('Usage: node scripts/check-manamesh-consumer.mjs <consumer-directory>');
const consumer = resolve(process.argv[2]);
const require = createRequire(join(consumer, 'package.json'));
const entry = require.resolve('@cyotee/manamesh');
const api = await import(pathToFileURL(entry).href);
for (const name of ['P2PMultiplayer', 'P2PTransport', 'BrowserStorage']) {
  assert.equal(typeof api[name], 'function', `Missing runtime export: ${name}`);
}
const packageRoot = dirname(require.resolve('@cyotee/manamesh/package.json'));
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
assert.deepEqual(manifest.scripts, { start: 'node ./bin/cli.js' });
assert.match(execFileSync(process.execPath, [join(packageRoot, 'bin/cli.js'), '--help'], { encoding: 'utf8' }), /Usage: manamesh/);
assert.match(readFileSync(join(packageRoot, 'dist/index.html'), 'utf8'), /id=["']root["']/);
const sent = [];
const channel = {
  events: { onMessage() {}, onConnectionStateChange() {} },
  send(data) { sent.push(JSON.parse(data)); },
  isConnected() { return true; },
};
const transport = new api.P2PTransport({
  game: {
    name: 'registry-security-check',
    setup: () => ({ tick: 0, secret: 'host-only' }),
    playerView: ({ G }) => ({ tick: G.tick }),
    moves: { bump: ({ G }) => { G.tick++; } },
  },
  connection: channel, role: 'host', playerID: '0', numPlayers: 2, matchID: 'registry-check',
});
try {
  transport.connect();
  await transport.master.waitForInit();
  await Promise.resolve();
  channel.events.onMessage(JSON.stringify({
    type: 'action', args: [{ type: 'MAKE_MOVE', payload: { type: 'bump', args: [], playerID: '0' } }, 0, 'registry-check', '0'],
  }));
  await Promise.resolve();
  assert.equal((await transport.master.getState()).G.tick, 0, 'Installed transport accepted a forged host seat');
  assert.ok(sent.some(message => message.type === 'error'), 'Forged seat was not rejected');
  await transport.master.onSync('registry-check', '1');
  const sync = sent.find(message => message.type === 'sync');
  assert.ok(sync, 'Missing guest sync');
  assert.equal(JSON.stringify(sync).includes('host-only'), false, 'Installed transport leaked host state');
} finally {
  transport.disconnect();
}
console.log('Installed registry consumer: exports, CLI, SPA, sender binding and filtered sync passed');
writeFileSync(join(consumer, 'consumer.ts'), `
import { P2PMultiplayer, P2PTransport, BrowserStorage, type P2PChannel, type P2PTransportOpts, type P2PRole } from '@cyotee/manamesh';
const role: P2PRole = 'host';
declare const channel: P2PChannel;
declare const opts: P2PTransportOpts;
const transport: P2PTransport = new P2PTransport({ ...opts, role, connection: channel });
const storage: BrowserStorage = new BrowserStorage();
P2PMultiplayer({ ...opts, role, connection: channel });
void transport; void storage;
`);
