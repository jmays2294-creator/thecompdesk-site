---
name: repo-doctor
description: Pre-flight diagnostic for any git repository work session. Verifies the working copy is in a safe location (NOT inside iCloud Drive, Dropbox, OneDrive, Google Drive, or any cloud-synced filesystem), is in sync with origin, has a clean working tree, and contains no sync-conflict zombie files (the iCloud "<name> 2.<ext>" pattern) or evicted-file placeholders. Use this skill at the START of every code editing or deploy session — before touching any file, before running git commands, before suggesting changes. Triggers when the user says "let's update the site", "push this fix", "commit and deploy", "edit the repo", "ship this change", "git status", "is this clone safe to edit", "any drift on origin", "run the prep on the repo". Also triggers on explicit invocations: "/repo doctor", "run repo doctor", "check the repo", "doctor this clone", "pre-flight the repo". Use it as a guard EVEN WHEN the user doesn't ask, because the failure modes (stale clones, iCloud sync conflicts, evicted files, untracked critical-path files) are silent at edit time and only surface when production breaks. One minute of pre-flight saves hours of recovery. Always use this skill at the start of any work session that may end in a git commit or push.
---

# Repo Doctor

Pre-flight check for git repositories before editing, committing, or pushing. Catches the silent failure modes that wreck production deploys.

## Why this matters

Cloud-synced filesystems and stale local clones produce failure modes that are invisible at edit time and only surface when production breaks:

- **iCloud Drive** evicts dormant files and replaces them with `.icloud` placeholders. Git sees missing files mid-operation, the index corrupts, status lies. iCloud also generates ` 2.<ext>` sync-conflict files that ride along into commits unnoticed — and once they're in `main`, they're hard to spot in code review because they look like real files.
- **Dropbox / OneDrive / Google Drive** have the same conflict-file problem under different naming conventions (`<name> (Conflicted copy).<ext>`, `<name>-<computer>.<ext>`).
- **Stale local clones** drift behind `origin/main`. Edits made on the stale copy get committed against an old base. The next push silently overwrites collaborators' work — or in solo workflows ends up "lost" when the user works on a different machine and pulls.
- **Untracked files in critical paths** (e.g., `js/workspace/`, `supabase/functions/`) ship locally as if they're part of the repo but never make it to production. Classic "works on my machine" deploy failure. This is exactly what bit thecompdesk-site on May 3, 2026 — the entire `js/workspace/` directory was untracked in the iCloud working copy, and v1.1 edits never reached origin.
- **Dirty working trees** at session start usually mean an aborted prior session. Committing without reviewing can fold half-finished work into a feature commit and leak it to production.

The cost asymmetry is brutal: ~10 seconds of pre-flight checking vs. hours of forensic recovery and emergency rollback when something silently breaks.

## How to use this skill

The first action of any work session is to run the bundled check script:

```bash
bash skills/repo-doctor/scripts/check.sh [repo-path]
```

Without arguments, it checks the current directory. The script runs seven diagnostics and prints a markdown report. Exit codes:

- `0` — PASS, safe to proceed
- `1` — FAIL, do not proceed without resolving issues
- `2` — WARN only, proceed with caution

**Read the full report and act on every failure.** Do not bypass the script's recommendation silently. If the user explicitly tells you to proceed despite a FAIL, surface the override in the conversation: "The doctor failed with `<reason>` but you've asked me to proceed anyway — confirming."

## What it checks

1. **Path safety** — the repo is NOT inside `~/Library/Mobile Documents/`, `~/Library/CloudStorage/`, `~/Dropbox/`, `~/OneDrive/`, `~/Google Drive/`, or `~/Box/`. See `references/cloud-sync-paths.md` for the full pattern list.
2. **Git repo sanity** — a git directory exists, no `index.lock`, `git status` exits cleanly. Linked worktrees and submodules are supported: there `.git` is a *file* holding `gitdir: <path>`, and the lockfile check runs against that resolved path. A `.git` file with a missing or dangling pointer still fails, with an orphaned-worktree remediation.
3. **Origin freshness** — `git fetch origin` succeeds; current branch is in sync with `origin/<branch>`. Lists missing commits if behind.
4. **Working tree cleanliness** — no uncommitted changes, or lists them for review.
5. **Sync-conflict zombies** — no files matching the iCloud `<name> 2.<ext>` pattern or Dropbox `<name> (Conflicted copy).<ext>` pattern.
6. **iCloud placeholders** — no `.icloud` eviction stubs (file present but contents not on disk).
7. **Critical-path untracked files** — for repos with `package.json` or `vercel.json`, scans `js/`, `supabase/functions/`, `supabase/migrations/` for untracked files. Customize per project.

## Customizing critical paths

If your project has different high-stakes directories, edit `scripts/check.sh` — the section labeled "Check 7: critical-path untracked files" lists them. Add or remove paths as needed.

## When to skip

The only legitimate reason to skip is if the user explicitly says "I'm just reading, don't run the doctor." For any session that may end in an edit, commit, or push: run the doctor first. Even read-only sessions benefit from the warning — a stale clone you read can mislead you into giving wrong advice.

## Output format

The report is markdown. Show it to the user verbatim — don't summarize. The user has invested effort into building these checks because the *specific* failure mode matters for the *specific* remediation. A summary like "doctor flagged some issues" is useless; the actual report tells them what to fix.
