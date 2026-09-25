#!/usr/bin/env python3
"""Build the isolated Poker candidate from pinned source; never publishes artifacts."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile
import tomllib
import urllib.request

COMMIT = 'f24f38e6049d43336517079d4abb36e465ea2512'
SOURCE_SHA256 = '6725a9c26853c1c0de29b84cff73235e9a6ddc47cf776f4da1c152b5385ee7de'
RUST_VERSION = 'rustc 1.96.0 (ac68faa20 2026-05-25)'
TARGET = 'wasm32-unknown-unknown'
MODULE = 'manamesh_shuffle_peer_check.wasm'
MAX_ARCHIVE = 10 * 1024 * 1024
ROOT = Path(__file__).resolve().parent.parent


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New artifact directory')
    parser.add_argument('--source-archive', type=Path, help='Use a local archive; its digest is still verified')
    parser.add_argument('--toolchain', default='1.96.0', help='Installed rustup toolchain; exact compiler version is checked')
    parser.add_argument('--offline', action='store_true', help='Require cached Cargo dependencies and a local archive')
    parser.add_argument('--expected-module-sha256', help='Fail if the built artifact differs from this reviewed digest')
    args = parser.parse_args()
    if args.offline and not args.source_archive:
        parser.error('--offline requires --source-archive')
    output = args.output.resolve()
    if output.exists():
        parser.error('--output must not already exist')
    rustc = run(['rustup', 'which', '--toolchain', args.toolchain, 'rustc'], capture_output=True, text=True).stdout.strip()
    version = run([rustc, '--version'], capture_output=True, text=True).stdout.strip()
    if version != RUST_VERSION:
        raise RuntimeError(f'Expected {RUST_VERSION}; found {version}')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='poker-shuffle-build-', dir=output.parent) as temporary:
        staging = Path(temporary)
        if args.source_archive:
            if args.source_archive.stat().st_size > MAX_ARCHIVE:
                raise RuntimeError('Source archive too large')
            archive_bytes = args.source_archive.read_bytes()
        else:
            url = f'https://codeload.github.com/v26-solutions/ziffle/tar.gz/{COMMIT}'
            with urllib.request.urlopen(url, timeout=60) as response:
                archive_bytes = response.read(MAX_ARCHIVE + 1)
        if len(archive_bytes) > MAX_ARCHIVE or hashlib.sha256(archive_bytes).hexdigest() != SOURCE_SHA256:
            raise RuntimeError('Pinned source archive digest mismatch')
        archive_path = staging / 'source.tar.gz'
        archive_path.write_bytes(archive_bytes)
        with tarfile.open(archive_path, 'r:gz') as archive:
            total = 0
            for member in archive.getmembers():
                path = PurePosixPath(member.name)
                if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != f'ziffle-{COMMIT}':
                    raise RuntimeError('Unexpected archive path')
                if not (member.isfile() or member.isdir()):
                    raise RuntimeError('Unexpected archive entry type')
                total += member.size
                if total > 50 * 1024 * 1024:
                    raise RuntimeError('Expanded archive too large')
            archive.extractall(staging, filter='data')
        crate = staging / 'peers'
        (crate / 'src').mkdir(parents=True)
        source = ROOT / 'experiments/poker-shuffle'
        for name in ['Cargo.toml', 'Cargo.lock']:
            shutil.copyfile(source / 'wasm/peers' / name, crate / name)
        packages = tomllib.loads((crate / 'Cargo.lock').read_text())['package']
        identities = [(package['name'], package['version']) for package in packages]
        if len(set(identities)) != len(identities):
            raise RuntimeError('Metadata policy requires unique package name/version pairs')
        shutil.copyfile(source / 'wasm/peer-check.rs', crate / 'src/lib.rs')
        shutil.copyfile(source / 'wire-codec.rs', crate / 'src/wire-codec.rs')
        env = os.environ.copy()
        cargo_home = Path(env.get('CARGO_HOME', str(staging / 'cargo'))).resolve()
        env.update(CARGO_HOME=str(cargo_home), CARGO_TARGET_DIR=str(staging / 'target'), RUSTC=rustc)
        env.pop('RUSTFLAGS', None)
        env.pop('RUSTC_WORKSPACE_WRAPPER', None)
        # Cargo hashes rustflags into crate metadata. Supplying random staging
        # paths there changes symbol identities even after path remapping. A
        # compiler wrapper applies the remaps after Cargo chooses its metadata.
        wrapper = staging / 'rustc-wrapper.py'
        wrapper.write_text("""#!/usr/bin/env python3
import os, sys
args = sys.argv[2:]
filtered = []
i = 0
while i < len(args):
    if args[i] == '-C' and i + 1 < len(args) and args[i + 1].startswith('metadata='):
        i += 2
    elif args[i].startswith('-Cmetadata='):
        i += 1
    else:
        filtered.append(args[i]); i += 1
metadata = 'manamesh-shuffle-' + os.environ.get('CARGO_PKG_NAME', 'probe') + '-' + os.environ.get('CARGO_PKG_VERSION', '0')
os.execv(sys.argv[1], [sys.argv[1], *filtered, '-Cmetadata=' + metadata,
    '--remap-path-prefix=' + os.environ['POKER_BUILD_ROOT'] + '=/manamesh-shuffle-build',
    '--remap-path-prefix=' + os.environ['POKER_CARGO_ROOT'] + '=/cargo'])
""")
        wrapper.chmod(0o755)
        env.update(RUSTC_WRAPPER=str(wrapper), POKER_BUILD_ROOT=str(staging), POKER_CARGO_ROOT=str(cargo_home))
        env['CARGO_ENCODED_RUSTFLAGS'] = '\x1f'.join(['-Cstrip=symbols', '-Cmetadata=manamesh-poker-shuffle-context-v2'])
        command = ['rustup', 'run', args.toolchain, 'cargo', 'build', '--locked', '--release', '--target', TARGET,
                   '--manifest-path', str(crate / 'Cargo.toml')]
        if args.offline:
            command.append('--offline')
        run(command, env=env)
        module = (staging / 'target' / TARGET / 'release' / MODULE).read_bytes()
        module_hash = hashlib.sha256(module).hexdigest()
        if args.expected_module_sha256 and module_hash != args.expected_module_sha256:
            raise RuntimeError(f'Module digest mismatch: {module_hash}')
        metadata = {'candidateCommit': COMMIT, 'sourceSha256': SOURCE_SHA256, 'rustc': version,
                    'target': TARGET, 'cargoLockSha256': hashlib.sha256((crate / 'Cargo.lock').read_bytes()).hexdigest(),
                    'moduleSha256': module_hash, 'moduleBytes': len(module),
                    'metadataPolicy': 'package-name-and-version', 'strip': 'symbols',
                    'compilerWrapperSha256': hashlib.sha256(wrapper.read_bytes()).hexdigest(),
                    'inputs': {name: hashlib.sha256((source / name).read_bytes()).hexdigest()
                               for name in ['wasm/peer-check.rs', 'wire-codec.rs', 'wasm/peers/Cargo.toml']}}
        output.mkdir()
        (output / MODULE).write_bytes(module)
        for license_name in ['LICENSE-MIT', 'LICENSE-APACHE']:
            shutil.copyfile(staging / f'ziffle-{COMMIT}' / license_name, output / f'ziffle-{license_name}')
        (output / 'build.json').write_text(json.dumps(metadata, indent=2) + '\n')
        print(json.dumps(metadata), flush=True)


if __name__ == '__main__':
    main()
