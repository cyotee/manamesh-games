/** Stage only built registry artifacts; never mutate the workspace manifest. */
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontend = join(root, 'packages/manamesh/packages/frontend');
if (!process.argv[2]) throw new Error('Usage: node scripts/stage-manamesh-release.mjs <new-output-directory>');
const output = resolve(process.argv[2]);
// Exclusive creation prevents mixing stale artifacts into a release.
mkdirSync(output);
mkdirSync(join(output, 'dist'));
for (const file of ['package.json', 'README.md', 'LICENSE', 'bin']) {
  cpSync(join(frontend, file), join(output, file), { recursive: true });
}
for (const file of ['public-api.js', 'public-api.d.ts', 'channel-transport.d.ts', 'channel.d.ts', 'extension-messages.d.ts']) {
  cpSync(join(frontend, 'dist', file), join(output, 'dist', file));
}
cpSync(join(root, 'dist/src/pages/timestreams/index.html'), join(output, 'dist/index.html'));
cpSync(join(root, 'packages/boardgameIO-p2p/LICENSE'), join(output, 'TRANSPORT-LICENSE'));
execFileSync(process.execPath, [join(frontend, 'scripts/rewrite-deps-for-publish.mjs'), join(output, 'package.json')], { stdio: 'inherit' });
const manifestPath = join(output, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
execFileSync(process.execPath, [join(frontend, 'scripts/validate-publish.mjs'), output], { stdio: 'inherit' });
console.log(`Staged ${manifest.name}@${manifest.version} in ${output}`);
