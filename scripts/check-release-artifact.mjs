/** Offline identity check for the artifact produced by this workflow run. */
import { readdirSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const version = process.env.RELEASE_VERSION;
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version || '')) {
  throw new Error('RELEASE_VERSION must be an explicit stable semver');
}
if (!process.argv[2]) throw new Error('Usage: node scripts/check-release-artifact.mjs <artifact-directory>');
const directory = resolve(process.argv[2]);
const files = readdirSync(directory);
const expected = `cyotee-manamesh-${version}.tgz`;
if (files.length !== 1 || files[0] !== expected) throw new Error('Expected exactly the requested ManaMesh tarball');
const tarball = join(directory, expected);
const manifest = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
if (manifest.name !== '@cyotee/manamesh' || manifest.version !== version || manifest.private === true) {
  throw new Error('Tarball package identity differs from the release request');
}
if (manifest.repository?.url !== 'git+https://github.com/cyotee/manamesh-games.git') throw new Error('Incorrect provenance repository');
if (Object.keys(manifest.scripts || {}).some(name => name !== 'start')) throw new Error('Unexpected package lifecycle scripts');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tarball=${tarball}\n`);
console.log(`Validated release artifact: ${manifest.name}@${manifest.version}`);
