#!/usr/bin/env python3
"""Regenerate TAG_TEST_GAP_REPORT.md baseline numbers (plan 0.3).

Usage (from packages/timestreams):
  python3 scripts/tag_test_gap_report.py
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets" / "packs" / "timestreams"
SRC = ROOT / "src"
OUT = ROOT / "TAG_TEST_GAP_REPORT.md"


def main() -> None:
    tags_from_pack: dict[str, set[str]] = defaultdict(set)
    for manifest_path in PACK.rglob("manifest.json"):
        data = json.loads(manifest_path.read_text())
        for card in data.get("cards") or []:
            cid = card.get("id", "?")
            for t in (card.get("metadata") or {}).get("tags") or []:
                tags_from_pack[t].add(cid)

    test_text = "\n".join(p.read_text() for p in SRC.rglob("*.test.ts")) + "\n".join(
        p.read_text() for p in SRC.rglob("*.test.tsx")
    )
    tested = sum(1 for t in tags_from_pack if t in test_text)
    untested = len(tags_from_pack) - tested

    print(f"pack_tags={len(tags_from_pack)} tested={tested} untested={untested}")
    print(f"Full narrative report is maintained in {OUT.name}; this script prints counts.")
    print(f"Date={date.today().isoformat()}")
    # Append a stamp to the report
    stamp = (
        f"\n\n---\n\n_Last count scan: {date.today().isoformat()} — "
        f"{len(tags_from_pack)} pack tags, {tested} mentioned in tests, {untested} not mentioned._\n"
    )
    if OUT.exists():
        text = OUT.read_text()
        text = re.sub(r"\n---\n\n_Last count scan:.*", "", text, flags=re.S)
        OUT.write_text(text.rstrip() + stamp)
        print(f"Updated stamp on {OUT}")


if __name__ == "__main__":
    main()
