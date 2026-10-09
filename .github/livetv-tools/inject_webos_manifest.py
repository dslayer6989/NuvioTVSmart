#!/usr/bin/env python3
"""Inject Live TV launchPoints into appinfo.json (idempotent)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

LAUNCH_POINTS = [
    {"id": "livetv", "title": "Live TV", "icon": "icon.png", "params": {"route": "livetv"}},
    {"id": "guide", "title": "TV Guide", "icon": "icon.png", "params": {"route": "guide"}},
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    target = Path(args.root).resolve() / "appinfo.json"
    if not target.exists():
        print(f"missing {target}", file=sys.stderr)
        return 1
    data = json.loads(target.read_text(encoding="utf-8"))
    existing = data.get("launchPoints") or []
    ids = {entry.get("id") for entry in existing if isinstance(entry, dict)}
    changed = False
    for point in LAUNCH_POINTS:
        if point["id"] not in ids:
            existing.append(point)
            changed = True
    if not changed:
        print("launchPoints already present; no change")
        return 0
    data["launchPoints"] = existing
    target.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print("injected Live TV launchPoints")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
