#!/usr/bin/env python3
"""Regenerate assets/packs/tag_definitions.md from the pack manifests.

Usage: python3 scripts/generate_tag_inventory.py
Tag semantics are documented in RULES_ENGINE_PRD.md (sections 4-5); this
inventory only records which tags exist and which cards carry them.
"""
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKS = ROOT / "assets" / "packs" / "timestreams"
OUT = ROOT / "assets" / "packs" / "tag_definitions.md"

usage = defaultdict(list)
for manifest in sorted(PACKS.glob("*/manifest.json")):
    deck = manifest.parent.name
    if deck == "aids":
        continue
    for card in json.loads(manifest.read_text())["cards"]:
        for tag in card["metadata"].get("tags", []):
            usage[tag].append(card["id"])

families = defaultdict(list)
for tag in sorted(usage):
    families[tag.split(":", 1)[0]].append(tag)

lines = [
    "# Tag Inventory (generated)",
    "",
    "<!-- GENERATED FILE - do not hand-edit. Regenerate with:",
    "     python3 scripts/generate_tag_inventory.py -->",
    "",
    "This file is a generated index of every tag used in the pack manifests.",
    "**Tag semantics, grammar, and executor shapes are specified in"
    " [RULES_ENGINE_PRD.md](../../RULES_ENGINE_PRD.md) (sections 4-5).**"
    " The manifests themselves are the source of truth; the hand-written tag"
    " definitions formerly in this file are superseded.",
    "",
    f"{len(usage)} unique tags across {len(families)} families.",
    "",
]
for family in sorted(families):
    lines.append(f"## `{family}:`")
    lines.append("")
    lines.append("| Tag | Uses | Cards |")
    lines.append("|---|---|---|")
    for tag in families[family]:
        cards = usage[tag]
        shown = ", ".join(f"`{c}`" for c in cards[:6])
        if len(cards) > 6:
            shown += f", … ({len(cards)} total)"
        lines.append(f"| `{tag}` | {len(cards)} | {shown} |")
    lines.append("")

OUT.write_text("\n".join(lines) + "\n")
print(f"wrote {OUT.relative_to(ROOT)}: {len(usage)} tags, {len(families)} families")
