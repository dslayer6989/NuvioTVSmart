#!/usr/bin/env python3
"""Fetch a GitHub Actions run log (reused from NuvioDesktop)."""
from __future__ import annotations

import argparse
import os
import sys
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, help="owner/repo")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--out", default="run.log")
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token:
        print("GITHUB_TOKEN or GH_TOKEN is required", file=sys.stderr)
        return 1

    url = f"https://api.github.com/repos/{args.repo}/actions/runs/{args.run_id}/logs"
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(request) as response:
            payload = response.read()
    except Exception as error:  # noqa: BLE001
        print(f"failed to fetch run log: {error}", file=sys.stderr)
        return 1

    with open(args.out, "wb") as handle:
        handle.write(payload)
    print(f"wrote {len(payload)} bytes to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
