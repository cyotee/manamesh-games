#!/usr/bin/env python3
"""Expose existing root skills to Codex without copying their contents."""

import argparse
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--write', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source = root / '.opencode/skills'
    destination = root / '.agents/skills'
    skills = sorted(source.glob('*/SKILL.md'))
    if not skills:
        parser.error(f'No source skills found in {source}')

    # Inspect every destination before creating anything. Never overwrite a
    # custom skill, conflicting link, or existing user configuration.
    pending, errors = [], []
    for skill in skills:
        link = destination / skill.parent.name
        if link.is_symlink():
            if link.resolve() != skill.parent.resolve():
                errors.append(f'Conflicting link: {link.relative_to(root)}')
        elif link.exists():
            errors.append(f'Existing non-link: {link.relative_to(root)}')
        else:
            pending.append((link, skill.parent))
        text = skill.read_text()
        if not text.startswith('---\n') or '\n---' not in text[4:]:
            errors.append(f'Missing skill frontmatter: {skill.relative_to(root)}')
    expected = {skill.parent.name for skill in skills}
    if destination.exists():
        for link in destination.iterdir():
            if link.is_symlink() and not link.exists():
                errors.append(f'Broken link: {link.relative_to(root)}')
            if link.is_symlink() and link.name not in expected:
                errors.append(f'Unmapped link (review manually): {link.relative_to(root)}')
    if errors:
        for error in errors:
            print(error)
        return 1
    if args.write:
        destination.mkdir(parents=True, exist_ok=True)
        for link, target in pending:
            link.symlink_to(os.path.relpath(target, link.parent), target_is_directory=True)
        print(f'Created {len(pending)} links; {len(skills)} skills available.')
    elif pending:
        print('Missing skill links: ' + ', '.join(link.name for link, _ in pending))
        print('Run python3 scripts/sync-agent-skills.py --write')
        return 1
    else:
        print(f'OK: {len(skills)} skill links resolve to their source directories.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
