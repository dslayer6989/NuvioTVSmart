#!/usr/bin/env bash
# Regenerates livetv/nuvio-livetv-smarttv.patch: every Live TV change on this
# branch compared with NuvioMedia/NuvioTVSmart at the pinned commit.
# It includes uncommitted and new (untracked, not ignored) files, so run it
# right before committing. livetv/ and .github/ are not part of the app and
# stay out of the patch.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
pin="$(tr -d '[:space:]' < livetv/UPSTREAM_COMMIT)"
git cat-file -e "${pin}^{commit}" 2>/dev/null || {
  echo "Pinned commit $pin is missing. Fetch it first: git fetch upstream" >&2
  exit 1
}
index="$(mktemp)"
trap 'rm -f "$index"' EXIT
cp "$(git rev-parse --git-path index)" "$index"
GIT_INDEX_FILE="$index" git add -A -- .
GIT_INDEX_FILE="$index" git diff --cached --binary --full-index --no-renames "$pin" -- . \
  ':(exclude)livetv' ':(exclude).github' > livetv/nuvio-livetv-smarttv.patch
echo "Wrote livetv/nuvio-livetv-smarttv.patch ($(wc -c < livetv/nuvio-livetv-smarttv.patch) bytes) against $pin"
