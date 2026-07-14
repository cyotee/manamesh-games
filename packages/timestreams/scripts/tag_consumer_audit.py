#!/usr/bin/env python3
"""Audit pack tags for production consumers (gap-closure plan Phase 0.1).

Usage (from packages/timestreams):
  python3 scripts/tag_consumer_audit.py
  python3 scripts/tag_consumer_audit.py --json
"""
from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets" / "packs" / "timestreams"
SRC = ROOT / "src"

# Families known to be parsed via prefix helpers (not full-string literals).
PREFIX_CONSUMERS = [
    "play:",
    "score:",
    "move:",
    "move-source:",
    "move-destination:",
    "swap:",
    "attach:",
    "modify:",
    "discard:",
    "draw:",
    "opponents-draw:",
    "recover:",
    "prevent:",
    "duration:",
    "requires:",
    "rule:",
    "protect:",
    "target:",
    "decider:",
    "option-a:",
    "option-b:",
    "forced:",
    "trigger:",
    "ongoing:",
    "skip:",
    "skip-turn:",
    "allow:",
    "extra-turn:",
    "cost:",
    "condition:",
    "additional:",
    "peek:",
    "to-hand:",
    "return:",
    "return-order:",
    "react:",
    "penalty:",
    "bonus-points:",
    "count:",
    "copy:",
    "perform:",
    "cancel:",
    "if-true:",
    "if-false:",
    "branch:",
    "delayed:",
    "suppress:",
    "steal:",
    "retaliate:",
    "redirect:",
    "replace:",
    "guess:",
    "set-value:",
    "slots:",
    "limit:",
    "mutual-discard:",
    "extend:",
    "government",
]


def pack_tags() -> dict[str, set[str]]:
    out: dict[str, set[str]] = defaultdict(set)
    for manifest_path in PACK.rglob("manifest.json"):
        data = json.loads(manifest_path.read_text())
        for card in data.get("cards") or []:
            cid = card.get("id", "?")
            for t in (card.get("metadata") or {}).get("tags") or []:
                out[t].add(cid)
    return out


def prod_text() -> str:
    parts: list[str] = []
    for p in SRC.rglob("*.ts"):
        if p.name.endswith(".test.ts") or "testFixtures" in p.name:
            continue
        if p.suffix == ".tsx" and ".test." in p.name:
            continue
        parts.append(p.read_text(errors="ignore"))
    return "\n".join(parts)


def smoke_text() -> str:
    parts: list[str] = []
    for p in SRC.rglob("*.ts"):
        name = p.name
        if "smoke" in name or "p1Families" in name or name == "tagCoverage.test.ts":
            parts.append(p.read_text(errors="ignore"))
    return "\n".join(parts)


def non_smoke_test_text() -> str:
    parts: list[str] = []
    for p in list(SRC.rglob("*.test.ts")) + list(SRC.rglob("*.test.tsx")):
        name = p.name
        if "smoke" in name or "p1Families" in name or name == "tagCoverage.test.ts":
            continue
        parts.append(p.read_text(errors="ignore"))
    return "\n".join(parts)


def has_consumer(tag: str, text: str) -> bool:
    if tag in text:
        return True
    # prefix family consumers
    for pref in PREFIX_CONSUMERS:
        if tag == pref or tag.startswith(pref):
            # require the prefix itself or a parent path appear
            root = pref.rstrip(":")
            if root and root in text:
                return True
            if pref in text:
                return True
    # colon segments used with startsWith
    segs = tag.split(":")
    for i in range(1, len(segs)):
        prefix = ":".join(segs[:i]) + ":"
        if f'startsWith("{prefix}")' in text or f"startsWith('{prefix}')" in text:
            return True
        if f'"{prefix}"' in text or f"'{prefix}'" in text:
            return True
    return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    tags = pack_tags()
    prod = prod_text()
    smoke = smoke_text()
    behavioral = non_smoke_test_text()

    no_prod: list[str] = []
    only_smoke: list[str] = []
    for t in sorted(tags):
        in_prod = has_consumer(t, prod)
        in_beh = t in behavioral
        in_sm = t in smoke
        if not in_prod:
            no_prod.append(t)
        if in_sm and not in_beh:
            only_smoke.append(t)

    if args.json:
        print(
            json.dumps(
                {
                    "pack_tags": len(tags),
                    "no_production_consumer_heuristic": no_prod,
                    "only_smoke_tests": only_smoke,
                },
                indent=2,
            )
        )
    else:
        print(f"pack_tags={len(tags)}")
        print(f"no_production_consumer_heuristic={len(no_prod)}")
        for t in no_prod[:40]:
            print(f"  {t}  <- {sorted(tags[t])[:3]}")
        if len(no_prod) > 40:
            print(f"  … +{len(no_prod) - 40} more")
        print(f"only_in_smoke_tests={len(only_smoke)}")
        for t in only_smoke[:20]:
            print(f"  {t}")


if __name__ == "__main__":
    main()
