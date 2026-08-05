#!/usr/bin/env bash
# repo-doctor: pre-flight diagnostic for git repository work sessions.
#
# Usage: bash check.sh [repo-path]
#   With no args, checks the current directory.
#
# Exit codes:
#   0 = PASS (safe to proceed)
#   1 = FAIL (do not proceed)
#   2 = WARN only (proceed with caution)

set -u

REPO="${1:-$PWD}"
cd "$REPO" 2>/dev/null || { echo "ERROR: cannot cd into $REPO"; exit 1; }

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
PASSES=()
FAILURES=()
WARNINGS=()

pass() { PASSES+=("$1"); PASS_COUNT=$((PASS_COUNT+1)); }
fail() { FAILURES+=("$1"); FAIL_COUNT=$((FAIL_COUNT+1)); }
warn() { WARNINGS+=("$1"); WARN_COUNT=$((WARN_COUNT+1)); }

ABS_PATH="$(pwd -P)"

# ====================================================================
# Check 1: Path safety
# ====================================================================
# Is the repo inside a cloud-sync filesystem? See references/cloud-sync-paths.md
# for the full pattern list. Cloud sync paths corrupt git through:
#   - File eviction (.icloud placeholders replace actual content)
#   - Sync conflicts that fire mid-git-operation (e.g., during rebase)
#   - Non-atomic writes (sync interleaving with .git/index updates)
CLOUD_PATTERNS='(Mobile Documents|com~apple~CloudDocs|Library/CloudStorage|/Dropbox/|/OneDrive/|/Google Drive/|/Box/)'
if echo "$ABS_PATH" | grep -qE "$CLOUD_PATTERNS"; then
  fail "Working copy is inside a cloud-sync path: \`$ABS_PATH\`
  Cloud sync (iCloud, Dropbox, OneDrive, Google Drive) corrupts git operations through file eviction, sync conflicts, and non-atomic writes.
  **Remediation:** clone fresh to \`~/Code/$(basename "$ABS_PATH")\`, then delete this copy. Never put a git repo in a cloud-synced filesystem."
else
  pass "Working copy is in a safe (non-cloud-synced) location"
fi

# ====================================================================
# Check 2: Git repo sanity
# ====================================================================
# `.git` is a DIRECTORY in a normal clone, but a FILE in a linked worktree
# (`git worktree add`) or a submodule — one line, `gitdir: <path>`, pointing at
# the real git directory (e.g. `<main-clone>/.git/worktrees/<name>`). That git
# directory holds this working copy's own index and index.lock, so the lockfile
# and health checks below run against the RESOLVED path. Testing only for a
# directory here hard-failed every worktree with "not a git repository".
GIT_DIR=""
GIT_DIR_LABEL="\`.git/\`"
GITFILE_BROKEN=""
if [ -d .git ]; then
  GIT_DIR=".git"
elif [ -f .git ]; then
  GITDIR_PTR=$(sed -n 's/^gitdir: *//p' .git 2>/dev/null | head -1 | tr -d '\r' | sed 's/[[:space:]]*$//')
  if [ -z "$GITDIR_PTR" ]; then
    GITFILE_BROKEN="malformed"
  else
    # A gitdir pointer may be absolute or relative to the working copy.
    case "$GITDIR_PTR" in
      /*) RESOLVED_GITDIR="$GITDIR_PTR" ;;
      *)  RESOLVED_GITDIR="$ABS_PATH/$GITDIR_PTR" ;;
    esac
    if [ -d "$RESOLVED_GITDIR" ]; then
      GIT_DIR="$(cd "$RESOLVED_GITDIR" && pwd -P)"
      GIT_DIR_LABEL="linked git directory \`$GIT_DIR\`"
    else
      GITFILE_BROKEN="dangling"
    fi
  fi
fi

if [ "$GITFILE_BROKEN" = "malformed" ]; then
  fail "\`.git\` at \`$ABS_PATH\` is a file but contains no \`gitdir:\` pointer — this is not a usable git repository.
  **Remediation:** \`cd\` to the actual clone. If this was a worktree, re-create it with \`git worktree add\` from the main clone."
elif [ "$GITFILE_BROKEN" = "dangling" ]; then
  fail "\`.git\` at \`$ABS_PATH\` points to \`$GITDIR_PTR\`, which does not exist — orphaned worktree or submodule.
  The main clone it was created from has been moved or deleted.
  **Remediation:** run \`git worktree prune\` in the main clone and re-create this worktree, or \`cd\` to the main clone instead."
elif [ -z "$GIT_DIR" ]; then
  fail "No \`.git/\` directory or \`.git\` gitdir file at \`$ABS_PATH\` — this is not a git repository.
  **Remediation:** \`cd\` to the actual clone, or run \`git clone <url>\` first."
elif [ -f "$GIT_DIR/index.lock" ]; then
  fail "\`$GIT_DIR/index.lock\` is present — a git operation crashed or another process is holding the lock.
  **Remediation:** if no other git process is running (\`ps aux | grep git\`), \`rm $GIT_DIR/index.lock\` and retry."
elif ! git status >/dev/null 2>&1; then
  fail "\`git status\` failed — repo is corrupted or partially initialized.
  **Remediation:** back up the working tree, then \`git fsck --full\` to investigate."
else
  pass "Git repository is healthy ($GIT_DIR_LABEL present, no lockfile, status clean)"
fi

# ====================================================================
# Check 3: Origin freshness
# ====================================================================
BRANCH="$(git branch --show-current 2>/dev/null || echo "")"
if [ -z "$BRANCH" ]; then
  warn "Detached HEAD or branchless state — no origin comparison possible."
elif ! git remote get-url origin >/dev/null 2>&1; then
  warn "No \`origin\` remote configured — cannot compare to upstream."
else
  if git fetch origin --quiet --tags 2>/dev/null; then
    if git rev-parse --verify "origin/$BRANCH" >/dev/null 2>&1; then
      AHEAD=$(git rev-list --count "origin/$BRANCH..HEAD" 2>/dev/null || echo 0)
      BEHIND=$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo 0)
      if [ "$BEHIND" -gt 0 ] && [ "$AHEAD" -gt 0 ]; then
        DIVERGED_LOG=$(git log --oneline "HEAD..origin/$BRANCH" 2>/dev/null | head -5)
        fail "Branch \`$BRANCH\` has DIVERGED from origin: $AHEAD commit(s) ahead, $BEHIND commit(s) behind.
  Missing commits from origin:
\`\`\`
$DIVERGED_LOG
\`\`\`
  **Remediation:** \`git pull --rebase origin $BRANCH\` (resolve any conflicts), then continue."
      elif [ "$BEHIND" -gt 0 ]; then
        BEHIND_LOG=$(git log --oneline "HEAD..origin/$BRANCH" 2>/dev/null | head -5)
        fail "Branch \`$BRANCH\` is $BEHIND commit(s) BEHIND \`origin/$BRANCH\`.
  Missing commits:
\`\`\`
$BEHIND_LOG
\`\`\`
  **Remediation:** \`git pull origin $BRANCH\` before editing. Editing a stale clone produces commits against the wrong base."
      elif [ "$AHEAD" -gt 0 ]; then
        AHEAD_LOG=$(git log --oneline "origin/$BRANCH..HEAD" 2>/dev/null | head -5)
        warn "Branch \`$BRANCH\` is $AHEAD commit(s) ahead of \`origin/$BRANCH\` (unpushed work):
\`\`\`
$AHEAD_LOG
\`\`\`
  Push when ready: \`git push origin $BRANCH\`."
      else
        pass "Branch \`$BRANCH\` is in sync with \`origin/$BRANCH\`"
      fi
    else
      warn "Branch \`$BRANCH\` has no upstream on origin (new local branch?). Push with \`git push -u origin $BRANCH\` when ready."
    fi
  else
    warn "\`git fetch origin\` failed — network issue, auth issue, or origin unreachable. Origin freshness unknown."
  fi
fi

# ====================================================================
# Check 4: Working tree cleanliness
# ====================================================================
DIRTY=$(git status --porcelain 2>/dev/null)
if [ -n "$DIRTY" ]; then
  COUNT=$(echo "$DIRTY" | wc -l | tr -d ' ')
  warn "Working tree has $COUNT modified/untracked file(s):
\`\`\`
$(echo "$DIRTY" | head -10)
\`\`\`
  Review uncommitted changes; \`git stash\` for a clean slate, or commit them deliberately."
else
  pass "Working tree is clean"
fi

# ====================================================================
# Check 5: Sync-conflict zombie files
# ====================================================================
# iCloud's conflict pattern is "<name> N.<ext>" where N is an integer.
# Dropbox uses "<name> (Conflicted copy YYYY-MM-DD).<ext>".
# OneDrive uses "<name>-<computer>.<ext>" but is harder to detect generically.
ICLOUD_CONFLICTS=$(find . -type f \
  -not -path './.git/*' \
  -not -path './node_modules/*' \
  -not -path './.next/*' \
  -not -path './dist/*' \
  -not -path './build/*' \
  -regex '.* [0-9]+\.[a-zA-Z0-9]+' 2>/dev/null)
DROPBOX_CONFLICTS=$(find . -type f \
  -not -path './.git/*' \
  -not -path './node_modules/*' \
  -name '*Conflicted copy*' 2>/dev/null)
ALL_CONFLICTS="$ICLOUD_CONFLICTS
$DROPBOX_CONFLICTS"
ALL_CONFLICTS=$(echo "$ALL_CONFLICTS" | sed '/^$/d')
if [ -n "$ALL_CONFLICTS" ]; then
  COUNT=$(echo "$ALL_CONFLICTS" | wc -l | tr -d ' ')
  fail "$COUNT cloud-sync conflict file(s) detected (e.g., \`index 2.html\`):
\`\`\`
$(echo "$ALL_CONFLICTS" | head -15)
\`\`\`
  These are sync-conflict artifacts and indicate this repo has been (or is currently) on a cloud-synced filesystem.
  **Remediation:** review each (some may be intentional v2 files), then \`git rm\` or \`rm\` the rest. Move the repo out of cloud sync entirely."
else
  pass "No cloud-sync conflict files"
fi

# ====================================================================
# Check 6: iCloud placeholder (.icloud) files
# ====================================================================
# When iCloud evicts a file, it leaves a small ".<name>.icloud" placeholder.
# Their presence means iCloud has evicted real file content — git operations
# will fail or corrupt because git sees the placeholder, not the file.
ICLOUD_PLACEHOLDERS=$(find . -name '*.icloud' -not -path './.git/*' 2>/dev/null)
if [ -n "$ICLOUD_PLACEHOLDERS" ]; then
  COUNT=$(echo "$ICLOUD_PLACEHOLDERS" | wc -l | tr -d ' ')
  fail "$COUNT iCloud placeholder file(s) detected (evicted file stubs):
\`\`\`
$(echo "$ICLOUD_PLACEHOLDERS" | head -10)
\`\`\`
  iCloud has offloaded the real file contents — git operations will fail.
  **Remediation:** download the real files (open them once, or right-click → Download Now in Finder), OR move the repo out of iCloud entirely (preferred)."
else
  pass "No iCloud placeholder files"
fi

# ====================================================================
# Check 7: Critical-path untracked files
# ====================================================================
# Repos with web/JS/Supabase paths frequently have untracked files in directories
# that ship to production. Catch this BEFORE the deploy that exposes it.
# Edit the path list below for project-specific high-stakes directories.
CRITICAL_PATHS=("js/workspace" "js" "supabase/functions" "supabase/migrations" "src" "app" "pages")
CRITICAL_FAIL=0
CRITICAL_FAIL_DETAIL=""
if [ -f "package.json" ] || [ -f "vercel.json" ] || [ -f "supabase/config.toml" ]; then
  for path in "${CRITICAL_PATHS[@]}"; do
    if [ -d "$path" ]; then
      UNTRACKED=$(git ls-files --others --exclude-standard "$path" 2>/dev/null | head -10)
      if [ -n "$UNTRACKED" ]; then
        CRITICAL_FAIL=1
        CRITICAL_FAIL_DETAIL+="
  In \`$path/\`:
\`\`\`
$UNTRACKED
\`\`\`"
      fi
    fi
  done
  if [ "$CRITICAL_FAIL" -eq 1 ]; then
    fail "Untracked files in critical paths (these directories contain code that ships to production):$CRITICAL_FAIL_DETAIL
  **Remediation:** \`git add\` or \`git rm\` each file deliberately. Untracked files in production paths are the #1 cause of works-on-my-machine deploy failures."
  else
    pass "No untracked files in critical paths (\`js/\`, \`supabase/\`, \`src/\`, etc.)"
  fi
fi

# ====================================================================
# Output report
# ====================================================================
echo "# Repo Doctor Report"
echo ""
echo "**Path:** \`$ABS_PATH\`"
[ -n "$BRANCH" ] && echo "**Branch:** \`$BRANCH\`"
echo "**Date:** $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo ""
echo "**Summary:** $PASS_COUNT passed · $WARN_COUNT warning(s) · $FAIL_COUNT failure(s)"
echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "## Failures ($FAIL_COUNT)"
  echo ""
  for f in "${FAILURES[@]}"; do
    echo "### ✗ $f"
    echo ""
  done
fi

if [ "$WARN_COUNT" -gt 0 ]; then
  echo "## Warnings ($WARN_COUNT)"
  echo ""
  for w in "${WARNINGS[@]}"; do
    echo "### ⚠ $w"
    echo ""
  done
fi

if [ "$PASS_COUNT" -gt 0 ]; then
  echo "## Passed ($PASS_COUNT)"
  echo ""
  for p in "${PASSES[@]}"; do
    echo "- ✓ $p"
  done
  echo ""
fi

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "## Verdict: ❌ DO NOT PROCEED"
  echo ""
  echo "Resolve the failures above before editing, committing, or pushing."
  exit 1
elif [ "$WARN_COUNT" -gt 0 ]; then
  echo "## Verdict: ⚠ PROCEED WITH CAUTION"
  echo ""
  echo "No fatal issues, but review warnings before substantive changes."
  exit 2
else
  echo "## Verdict: ✅ SAFE TO PROCEED"
  echo ""
  exit 0
fi
