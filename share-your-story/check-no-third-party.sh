#!/usr/bin/env bash
# Hard-coded compliance check: customer-story intake must NOT POST/fetch to
# any third-party law-firm endpoint. Run from repo root.
set -e
DIR="$(dirname "$0")"
PATTERN='lawfirm|law-firm|attorney-api|leadgen|lead-gen|martindale|avvo|justia|nolo|findlaw|legalmatch'
if grep -rEi --exclude="check-no-third-party.sh" "$PATTERN" "$DIR" >/dev/null; then
  echo "FAIL: third-party law firm reference found in $DIR" >&2
  grep -rEni --exclude="check-no-third-party.sh" "$PATTERN" "$DIR" >&2
  exit 1
fi
# Also confirm only the trusted Supabase project is referenced for network calls.
if grep -rEo 'https?://[a-zA-Z0-9.-]+' "$DIR" \
  | grep -vE 'fonts\.googleapis\.com|cdn\.jsdelivr\.net|ltibymvlytodkemdeeox\.supabase\.co|thecompdesk\.com' >/dev/null; then
  echo "FAIL: unexpected outbound host in $DIR" >&2
  grep -rEno 'https?://[a-zA-Z0-9.-]+' "$DIR" \
    | grep -vE 'fonts\.googleapis\.com|cdn\.jsdelivr\.net|ltibymvlytodkemdeeox\.supabase\.co|thecompdesk\.com' >&2
  exit 1
fi
echo "OK: no third-party law-firm endpoints; only trusted hosts referenced."
