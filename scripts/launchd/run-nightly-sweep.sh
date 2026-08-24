#!/bin/bash
# Nightly Pro-workspace sweep. Invoked by launchd; see the .plist beside this file.
#
# WHY A WRAPPER AND NOT THE NODE BINARY DIRECTLY
# launchd gives a job a minimal PATH — typically /usr/bin:/bin:/usr/sbin:/sbin —
# which contains no node, no npm, and no npx. A plist that calls `npm` directly
# fails silently at 2am and the only symptom is that the improvement loop quietly
# has nothing to plan on Monday. So: set PATH explicitly, log everything, and
# make the failure visible in the log rather than in an empty backlog.

set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

REPO="$HOME/Code/thecompdesk-site"
LOG="$HOME/Library/Logs/compdesk-sweep.log"

mkdir -p "$(dirname "$LOG")"

{
  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo "nightly workspace sweep — $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "════════════════════════════════════════════════════════════════"

  if [ ! -d "$REPO" ]; then
    echo "FATAL: repo not found at $REPO"
    exit 1
  fi

  cd "$REPO" || exit 1

  if ! command -v node >/dev/null 2>&1; then
    echo "FATAL: node not on PATH. PATH=$PATH"
    exit 1
  fi
  echo "node $(node --version) · repo $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

  # Sweep MAIN, not whatever branch happens to be checked out. The nightly run is
  # meant to describe the site as it stands; sweeping a half-finished feature
  # branch would file findings about work in progress. Read-only: never checks
  # out, never stashes, never touches the working tree.
  BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  if [ "$BRANCH" != "main" ]; then
    echo "NOTE: working tree is on '$BRANCH', not main. Sweeping it as-is —"
    echo "      findings may describe unfinished work rather than the live site."
  fi

  node scripts/workspace-sweep.mjs
  CODE=$?
  echo "exit $CODE"
  exit $CODE
} >> "$LOG" 2>&1
