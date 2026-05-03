# Cloud-sync paths to detect

These directories indicate the working copy is on a cloud-synced filesystem, which is dangerous for git repos. The check script's path-safety check uses this list.

## macOS

### Apple iCloud

- `~/Library/Mobile Documents/com~apple~CloudDocs/` — classic iCloud Drive mount
- `~/Library/CloudStorage/iCloud Drive/` — newer File Provider mount (macOS 12+)
- `~/Library/Mobile Documents/iCloud~*/` — third-party iCloud-syncing apps

### Dropbox

- `~/Dropbox/` — classic Dropbox sync folder
- `~/Library/CloudStorage/Dropbox*/` — newer File Provider mount

### Microsoft OneDrive

- `~/OneDrive/`
- `~/OneDrive - <org>/` — work/school accounts
- `~/Library/CloudStorage/OneDrive*/`

### Google Drive

- `~/Google Drive/`
- `~/Library/CloudStorage/GoogleDrive*/`

### Box

- `~/Box/`
- `~/Library/CloudStorage/Box*/`

## Windows

- `%USERPROFILE%\OneDrive\`
- `%USERPROFILE%\Dropbox\`
- `%USERPROFILE%\Google Drive\`
- `%USERPROFILE%\iCloudDrive\`
- Any path under `%LOCALAPPDATA%\Microsoft\OneDrive\`

## Linux

Most cloud-sync clients on Linux mount under `~/CloudDrive/`, `~/<service>/`, or via FUSE — check the user's mount points if unsure.

## Pattern matching used by check.sh

The script uses a single grep regex against the absolute repo path:

```
(Mobile Documents|com~apple~CloudDocs|Library/CloudStorage|/Dropbox/|/OneDrive/|/Google Drive/|/Box/)
```

Add new patterns to this regex if your team uses a service not listed above. The grep is case-sensitive — keep the casing accurate to the actual mount point name.

## Why these paths fail

| Service | Failure mode |
|---|---|
| iCloud Drive | "Optimize Mac Storage" evicts dormant files. Replaces them with `.icloud` placeholders. Git sees missing files and the index corrupts. |
| iCloud Drive | Generates `<name> 2.<ext>` sync-conflict files when two devices write to the same file. These ride along into commits silently. |
| Dropbox | Generates `<name> (Conflicted copy YYYY-MM-DD).<ext>` files. Same conflict-contamination problem. |
| Dropbox | Smart Sync (now Smart Storage) can evict files to cloud-only, breaking git operations. |
| OneDrive | Files On-Demand evicts to cloud-only. Same problem as iCloud's optimize-storage. |
| Google Drive | Stream mode (vs. Mirror mode) keeps files on cloud-only by default. Same problem. |
| All of them | None of these sync `.git/` reliably or atomically. A `git rebase` is hundreds of small writes; sync interleaving produces a half-state repo. |

## The fix is structural, not configurational

You cannot configure your way out of this. Cloud sync clients are designed for documents that have document-level atomicity, not for filesystems with hundreds of small interrelated files updating in microseconds. The right approach is to keep code repos OUT of cloud sync entirely and use git itself for cross-device sync (push from one machine, pull on another).

Cloud sync is fine for ops/notes/docs/screenshots — content that doesn't have atomicity requirements and benefits from cross-device availability. It's wrong for code.
