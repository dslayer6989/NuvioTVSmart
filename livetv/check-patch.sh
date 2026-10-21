#!/usr/bin/env bash
# Applies the Live TV patch to a clean copy of NuvioMedia/NuvioTVSmart at the
# pinned commit and checks that the result matches this branch exactly.
# Usage: livetv/check-patch.sh [work-dir]   (default: a temporary folder)
set -euo pipefail
repo="$(git rev-parse --show-toplevel)"
pin="$(tr -d '[:space:]' < "$repo/livetv/UPSTREAM_COMMIT")"
work="${1:-$(mktemp -d)}"
rm -rf "$work/upstream"
git clone --quiet https://github.com/NuvioMedia/NuvioTVSmart.git "$work/upstream"
git -C "$work/upstream" checkout --quiet "$pin"
git -C "$work/upstream" apply --whitespace=nowarn --binary "$repo/livetv/nuvio-livetv-smarttv.patch"
git -C "$work/upstream" add -A
upstream_tree="$(git -C "$work/upstream" write-tree)"
index="$(mktemp)"
trap 'rm -f "$index"' EXIT
cp "$(git -C "$repo" rev-parse --git-path index)" "$index"
(cd "$repo" && GIT_INDEX_FILE="$index" git add -A -- . && GIT_INDEX_FILE="$index" git rm -r -q --cached --ignore-unmatch livetv .github)
branch_tree="$(cd "$repo" && GIT_INDEX_FILE="$index" git write-tree)"
upstream_ls="$(git -C "$work/upstream" ls-tree -r "$upstream_tree" | grep -v $'\t.github/' || true)"
branch_ls="$(git -C "$repo" ls-tree -r "$branch_tree")"
if [ "$(printf '%s\n' "$upstream_ls" | grep -v $'\t\\.github/')" != "$(printf '%s\n' "$branch_ls")" ]; then
  echo "The patch does not reproduce this branch. Run livetv/make-patch.sh and commit the result." >&2
  diff <(printf '%s\n' "$upstream_ls") <(printf '%s\n' "$branch_ls") | head -40 >&2 || true
  exit 1
fi
echo "Patch applies cleanly to NuvioMedia/NuvioTVSmart@$pin and matches this branch."
echo "Patched source: $work/upstream"
