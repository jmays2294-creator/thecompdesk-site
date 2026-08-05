# The Comp Desk — Changelog

All deployments to **thecompdesk.com** via Vercel (auto-deploy from `main` branch).
Repository: `github.com/jmays2294-creator/thecompdesk-site`

---

## 2026-08-05 (compliance sweep)

### Every surface naming the operator, swept against the policy — and the guard that had not run since July

`SILENT_OWNER_POLICY.md` protects one thing: the neutrality of the free
round-robin attorney connection service. It lists **carve-outs** — the surfaces
permitted to name the operator or the firm — and its own contributor rule says a
naming surface must either fall inside one or not be on the site. Nobody had
checked the list against the site.

**The list was incomplete, not the pages.** Sweeping every served page for the
canonical forbidden strings (taken from the enforcement test, not guessed) found
them in **53 HTML files across 8 base surfaces**. Six were outside every
carve-out. Four turned out to be legitimate and simply unlisted — added as
carve-outs 7–9 and 11–12:

| Surface | Why it names the operator |
|---|---|
| `legal/terms.html` +9 | §1.3 and §2.4 **are** the founder-firm disclosure |
| `contributor-agreement.html` | §8.2 — naming is what makes the fee-sharing clause operative |
| `calculators/radiculopathy.html` +9 | a **non-rendered** source comment recording who verified the impairment table |
| `worker.html` +9 | founder signature on the injured-worker page |
| `index.html` +9 | a "Joel Mays, Esq. · Founder" credit |

**The one that mattered: `/attorneys`.** A first-person attorney bio naming
Shulman & Hill, PLLC, plus an FAQ credential claim — with **no Attorney
Advertising label and no disclaimer of any kind**. It now carries both (measured
8.36:1 and 11.73:1 contrast, comfortably past WCAG AA) and is carve-out 10, on the
directory's terms. `/worker`, `/` and `/webinars` got the same treatment;
carve-out 4 was amended to require the label it had never imposed.

---

### The enforcement claim was false for two weeks

The policy states the exclusion is *"enforced in code, not merely in policy, by
`tests/directory-exclusion.test.js`, which runs on every push and pull request to
`main`."*

**It ran and crashed on every one.** `package.json` declares `"type": "module"`
(added in `b17c900`, an i18n commit), so `const fs = require('fs')` threw
`ReferenceError` before a single check executed. The Directory Neutrality workflow
failed **32 of its last 40 runs**, in 14 seconds each. Last green: **2026-07-21**.

Three constructs needed converting, not the two that were obvious — both
`require()` calls **and `__dirname`**, which does not exist in ESM either. The
filename was deliberately left alone: the policy names that exact path, and
renaming to `.cjs` would have meant chasing it through the policy and the
workflow.

Proven in both directions rather than trusted: injecting a Shulman & Hill record
into `data/attorneys.json` exits 1 naming both strings; removing it exits 0.
Before the fix it exited non-zero for everyone, always, for reasons having nothing
to do with neutrality — which is the worst kind of red, because it looks like a
working guard right up until someone reads the log.

**No live exposure in the window** — the roster is empty and `/directory` 404s, so
there was nothing to guard. The guard would simply have been just as dead on the
day a real listing landed.

Worth noting how it hid: the first time this session ran that test, it passed.
The working tree still held a concurrent session's uncommitted ESM rewrite. Only
once that moved into its own worktree did `main`'s true state show. A green result
read off someone else's uncommitted fix is not a green result.

---

### "Attorney Advertising" stays in English — and that is now enforced

Initially the label shipped translated into all nine locales (*Publicidad de
abogados*, *변호사 광고*, *Реклама юридических услуг*, …), on the reasoning that a
disclosure the reader cannot read discloses nothing. Joel's call reversed it: the
label is the statutory phrase from NY RPC 7.1(f), and a translation of it is not
that phrase.

Rather than overwrite nine values and hope, **"Attorney Advertising" was added to
`i18n/glossary.json` `doNotTranslate`**, so `verify.mjs` now fails the build via
its DNT-lost check if any locale renders it in the target language. Proven:
re-translating it in `es` reports `DNT-lost: shared.attorney-advertising` and
exits 1. Without the glossary entry this was a convention the next translation
pass would quietly have undone.

The **surrounding legal line stays translated** — explanatory prose, not a fixed
legal term. Its wording is recomposed from sentences already shipped and reviewed
in those catalogs (`worker.important-the-comp-desk-is`,
`worker.no-attorney-matching-is-mechanical`), so 18 translations introduced no new
legal copy beyond the two-word label.

Full i18n cycle: 2 new keys, 0 removed, zh-Hant derived via OpenCC, 297 locale
pages rebuilt. `i18n:verify` **PASS 1996/1996** across all nine with `DNT-lost 0`;
`build --check` 0; `check:refs` green.

---

### Where it stands

All **12 carve-outs** are listed, every surface naming the operator is accounted
for, and all four advertising surfaces (`/attorneys`, `/`, `/worker`,
`/webinars`) carry a label and a disclaimer. The three carve-outs without labels —
a non-rendered source comment, a contract, and the legal terms — are not
advertising.

The two rules most likely to erode are now **machine-enforced rather than
documented**: the connection-service exclusion (`directory-neutrality.yml`, green
again) and the English label (`doNotTranslate`).

Interlocking work from the concurrent attorney-directory session landed on `main`
alongside this and is **not** described here — `90f8912` took the ESM repair above
and extended the guard to the paid directory with dated per-slug exemptions and an
explicit vacuous-run warning; `eeca20b` and `848710f` re-scoped the disclosure and
added the directory schema. Those are that session's to write up.

Still open, and recorded in the policy rather than silently permitted:
`/directory` 404s, so the whole "Permitted: disclosed attorney advertising"
section grants permissions on a surface that does not exist yet; and carve-out 2
describes disclaimer copy on `find-attorney.html`, which 301s to
`/connect-with-attorney` and is never served.

---

## 2026-08-05 (repo-doctor)

### The pre-flight gate hard-failed inside every git worktree

`467a7fe` · deploy `dpl_4wc6W6JY…` READY · no site content changed

Check 2 of `skills/repo-doctor/scripts/check.sh` tested for a `.git/` **directory**.
In a linked worktree `.git` is a **file** holding one line — `gitdir: <path>` — so
the check reported *"No `.git/` directory … this is not a git repository"* and the
run exited 1 / **DO NOT PROCEED**. CLAUDE.md makes the doctor a hard gate before any
edit, commit, or push, so a healthy worktree was blocked from doing any work at all.
A false positive on a gate is worse than a missing check: it trains you to bypass the
gate, and the gate exists because of the May 3 incident.

**The lock check was the sharper half of the bug.** A worktree's index and its
`index.lock` live in `<main-clone>/.git/worktrees/<name>/`, not beside the working
copy. The old code tested `.git/index.lock` relative to the working tree — a path
that can never exist in a worktree. Had the directory test somehow passed, the
crashed-git-operation check would have been silently vacuous rather than wrong,
which is the harder failure to notice.

**Fixed** by resolving the pointer before testing anything: `.git` as a directory is
used as-is; `.git` as a file matching `^gitdir: ` has its target resolved (absolute,
or relative to the working copy — git writes relative pointers under
`--relative-paths`), normalised through `pwd -P`, and the `index.lock` and
`git status` checks run against *that* path. Submodules come along for free, since
their `.git` is the same kind of pointer file; only worktrees were tested.

A `.git` file still fails when it should, with remediation matched to the fault
rather than the old generic "cd to the actual clone": no `gitdir:` line is
**malformed**; a pointer to a directory that no longer exists is an **orphaned
worktree** whose main clone was moved or deleted, remediated with `git worktree
prune`. Checks 1 and 3–7 are untouched — they already behaved correctly in a
worktree. `SKILL.md`'s check list was one line out of date once the behaviour
changed and was updated with it.

**Verified** across seven cases: a real worktree, the main clone (unchanged — still
reports `✓ .git/ present`), a non-repo directory, a malformed `.git` file, a dangling
pointer, a planted `index.lock` inside a worktree's own gitdir (correctly caught),
and a hand-written relative pointer. Then end-to-end against merged `main`: a fresh
`git worktree add` now yields `6 passed · 1 warning · 0 failures`.

**Two things found while doing it, neither fixed:**

- **Check 1 only tests the working-copy path.** A worktree in a safe location whose
  *main clone* sits in iCloud would pass the cloud-sync check, because the real
  `.git` lives with the main clone and is never examined. Pre-existing, and out of
  scope here; the resolved gitdir is now available to that check should it ever be
  worth closing.
- **Check 4 can cry wolf on a cold index.** The pre-merge run reported 33 modified
  files in the main clone (`calculators/*.html`, `coming-soon.html`, …); one minute
  later `git status` was clean and `git diff HEAD` empty. They were stat-only mtime
  differences that git resolved on first content comparison — nothing was modified
  and nothing was at risk in the merge. Worth knowing before the warning gets
  ignored on the day it means something.

**Merged to `main` directly, bypassing branch protection.** GitHub reported
*"Bypassed rule violations for refs/heads/main: Changes must be made through a pull
request"* — Joel's admin privileges let the push through rather than rejecting it.
Deliberate and requested, recorded here because the rule exists.

---

## 2026-08-05 (record correction)

### What commit 48e8fae actually contained

`48e8fae` is titled for the Polish register change, and it also carries a full
rewrite of **`SILENT_OWNER_POLICY.md`** (90 → 161 lines). That file was not part of
the Polish work and is not described by that commit message.

It belongs to a **concurrent session** building the attorney directory, working out
of `.claude/worktrees/attorney-directory` (branch `worktree-attorney-directory`).
That session wrote the policy into the main working tree at 18:23:19; a `git add -A`
here swept it into a commit 36 seconds later. Staging by name — which every other
commit in this session used — would not have picked it up. The content is finished
and correct, so it stays; this entry exists so the history is not misleading, and so
the directory session knows its policy amendment is already on `main` and does not
need committing again. No other commit in this session contains work it does not
name.

**Its companion is not on `main`.** The amended policy describes enforcement across
two surfaces — the neutral connection service *and* the paid directory, with dated
per-slug exemptions. The committed `tests/directory-exclusion.test.js` still scans
only `data/attorneys.json`; the two-surface version is the directory session's work
and has since moved into its worktree. So `main` currently carries the amended
policy with the older, single-surface guard. Not a live exposure — there is no
directory to guard yet — but the policy is ahead of its enforcement until that
session lands.

**What the policy now says.** It was a blanket founder-anonymity rule; it is now
scoped to the interest it was actually protecting — the neutrality of the free
round-robin attorney connection service. The operator and their firm remain
permanently excluded from that service. Founder anonymity is no longer claimed:
the operator may be named, pictured, and biographied on the (unbuilt) paid
`/directory` and on `webinars.html`, subject to Attorney Advertising labelling and
paid-placement disclosure. The amendment note gives the reason plainly — the old
rule had not described actual practice since `webinars.html` shipped in July, and
a compliance document the project knowingly does not meet is worse than none.

**Verified while documenting it,** since the policy makes an enforcement claim:

- Every artifact it names exists — `tests/directory-exclusion.test.js`,
  `.github/workflows/directory-neutrality.yml`,
  `tests/find-attorney-map-sort.test.js`, `data/attorneys.json`, `back-burner/`.
- `node tests/directory-exclusion.test.js` exits **0**, as the policy requires —
  but it prints **"VACUOUS RUN … not evidence of neutrality"**, because the
  connection-service roster is empty and `data/directory-listings.json` does not
  exist. The structural checks pass; nothing was asserted about live listings.
  The guard is honest about its own reach, which is the right design — it simply
  has nothing to guard yet. It starts doing real work when the roster is populated
  or `/directory` is generated.
- **`/directory` returns 404** — it is not built. The whole "Permitted: disclosed
  attorney advertising" section therefore grants permissions on a surface that does
  not yet exist. Policy ahead of product, which is the safe order.
- **`/find-attorney` 301s to `/connect-with-attorney`.** Carve-out 2 describes
  disclaimer copy on `find-attorney.html`, a file that is never served. The live
  disclosure obligation sits on `/connect-with-attorney`, which carve-out 1 covers,
  so nothing is undisclosed — but that carve-out documents an unreachable page.

---

## 2026-08-05 (pl register)

### Polish switched to formal address — it was the only locale using informal

Joel's call on review of the segment-picker translations. Checking it against the
other locales showed Polish was genuinely the outlier, not the new copy: for the
identical string "Choose your path", es ships *Elija su camino* (usted), fr
*Choisissez votre parcours* (vous), ru *Выберите свой путь* (вы) and zh-Hans
*选择您的方向* (您) — all formal — while pl shipped *Wybierz swoją ścieżkę*,
informal. ht has no T-V distinction and ko is nominal, so neither takes a side.

The seven segment strings now use **Państwo** for direct address (the Polish
equivalent of usted/vous/вы, and gender-neutral, which matters when the reader's
gender is unknown) and **"proszę" + infinitive** for imperatives — the standard
formal imperative; the Państwo form (*niech Państwo zaczną*) is unnatural in UI
copy.

Fixed three more in the same pass, because they render on the **same screen** and
would otherwise have put both registers in one view: `home.choose-your-path`,
`home.choose-your-audience.label` and the home `og-description`. The Polish home
page now reads in one register throughout.

**Still outstanding, and bigger than this pass:** roughly 229 other Polish strings
across the rest of the site still use informal forms (*Dowiedz się*, *Sprawdź*,
*Zobacz*, *możesz*, *Twój*). This changed only what shares a screen with the
picker. Converting the remainder is a real translation pass, not a find-and-replace
— Polish imperatives change shape rather than taking a prefix.

---

## 2026-08-05 (i18n green)

### The translation gate is green for the first time in this session

`npm run i18n:verify`: **PASS — all checked locales are complete and intact**,
1994/1994 in all nine, every counter zero. It had been red on `main` since before
this session started.

**72 translations written**, covering the seven segment-picker strings from the
home-page work and the nav string that was superseded when `/webinars` shipped.
Each locale uses the "workers' comp" rendering it *already* ships — `compensación
laboral` (es), `工伤赔偿` (zh-Hans), `산재보상` (ko), `odszkodowania pracownicze`
(pl), `indemnisation des accidents du travail` (fr) — taken from
`home.meta.og-title` so the new copy agrees with the 1,986 strings already in
place rather than inventing a second vocabulary. The `<span class="cd-segment-*">`
wrappers and their indentation are copied byte-for-byte; only the text moves.
zh-Hant was **derived** from zh-Hans via `npm run i18n:derive-zh-hant` (OpenCC
twp), not hand-written, because that is this repo's flow.

**Two fixes that fell out of the same pass.** The `tag-drift` on
`worker.learn-find-a-doctor-calculators` was the same `/webinars` link, missing
from all nine locale navs — added, reusing each locale's shipped link wording. The
orphaned `calculators.worker-attorneys-learn-contact` (the pre-webinars nav) is
deleted.

**A gap in P4's key rename, caught by the gate.** P4 propagated
`extension.the-full-pro-attorney-workspace` →
`…-pro-workspace-browser` to only three catalogs — the three whose *value*
contained that literal English string. Six others (ru, fr, ko, pl, bn, ht)
carry the same key with the product name **translated**
(`Полное рабочее пространство Pro для адвокатов`, `Espas Travay Avoka Pro`…), so a
grep for the English phrase never saw them. Renamed in all six, with the
"attorney" qualifier dropped from each value. Their existing choice to translate
the product name where three locales keep it in English is pre-existing and left
alone — unifying that is a copy decision, not a rename.

**The extra-key check now exempts two keys, narrowly.**
`shared.machineTranslationNotice` and `shared.reviewedTranslationNotice` are the
translation-provenance notices `build-locales.mjs` stamps on every locale page.
English is the SOURCE, so it has nothing to disclose and can never carry them —
the check flagged all nine locales, permanently, for something nobody could fix. A
gate that reports an unfixable failure is one people learn to ignore, so the
exemption is a named two-item set rather than a loosened check. Proven still
sharp: injecting a genuine orphan key fails with `extra 1` and exits 1; removing
it exits 0.

---

## 2026-08-05 (P4 follow-up)

### Stale i18n slots fixed — and the rebuild exposed that P0's locale fix was never going to survive

`scripts/i18n/extract.mjs` re-run, then `build-locales.mjs`. The blocker
(*"confirmed.html changed since extraction"*, caused by P0's supabase-js pin
shifting byte offsets) is gone: `build-locales.mjs --check` now exits 0.

**The rebuild reverted P0's locale import fix, and the guard caught it.** P0
rewrote `../js/auth.js` → `/js/auth.js` in 162 places across the *generated*
locale pages. Those pages are emitted from the English sources, which still said
`../js/auth.js` — correct at English's depth, wrong once copied into
`/bn/calculators/`. So the first rebuild dutifully re-broke all nine locales, and
`npm run check:refs` went from 0 dangling refs to 162 in one command. **P0's fix
was applied to the output, not the source; it was always going to be overwritten
by the next build.** Fixed properly this time: 24 specifiers made root-absolute in
the 11 English sources, so every generated copy inherits a path that is correct at
any depth. Verified `/bn/calculators/slu.html` now emits `/js/auth.js` straight
from the build.

That is the second time this session a guard earned its place. The first run of
`check:refs` found the original 162; this run caught them coming back.

**The extractor renamed the catalog key — unavoidably.** Keys are slugs derived
from the English text, so changing the value regenerated
`extension.the-full-pro-attorney-workspace` →
`extension.the-full-pro-workspace-browser`. P4 deliberately avoided a key rename,
but that is not achievable through this pipeline: the extractor owns key naming.
Left half-done it was a live regression — `en.json` had the new key, the three
translated catalogs still had the old one, and es/zh-Hans/zh-Hant were rendering
the **English** string. The rename was propagated to all three catalogs (values
preserved), rebuilt, and each locale page confirmed to render its own translation
again.

**Nothing else moved.** The extractor strips the generated hreflang/font blocks
from all 33 English sources and `build-locales.mjs` re-adds them, so those pages
end byte-identical to HEAD; hreflang was verified present afterwards, since
stopping between the two steps would have shipped 33 pages with no hreflang.
`en.json` still holds exactly 1994 keys, and the `i18n:verify` gate reports
numbers byte-identical to a pristine `git archive HEAD` checkout — still red for
the pre-existing untranslated `home.*` segment-picker keys, still not this
change's doing.

The uncommitted `index.html` / `calculators/index.html` work and its 12 locale
copies were snapshotted before the run and byte-compared after: untouched.

---

## 2026-08-05 (P4)

### "Pro Attorney Workspace" → "Pro Workspace"

The product is for WC professionals, not only attorneys, and the name said
otherwise on every surface that carried it.

**A second variant nobody listed.** Alongside 20 instances of "Pro Attorney
Workspace" there were 2 of **"Pro Attorney *Calculator* Workspace"** —
`js/workspace/app.js` line 1 and the tooltip on line 367. A naive
find-and-replace of the shorter string would have left "Pro Calculator
Workspace" behind in a user-visible tooltip, so the longer variant is replaced
first.

Renamed across the live surfaces: `workspace.html` (title, meta description,
in-development banner, H2), `dashboard/my-cases.html` (title),
`extension.html` + its es/zh-Hans/zh-Hant mirrors, the three `js/workspace/*`
files, and `sitemap.md`. **12 replacements, zero remaining on any live surface.**

**i18n.** The catalog KEY (`extension.the-full-pro-attorney-workspace`) is
deliberately unchanged — renaming it would cascade through all 12 catalogs and
the verification gates. Only the values moved. Worth knowing: the phrase is a
**do-not-translate product name held verbatim in English by every locale**
(`El Pro Workspace completo…`, `基于浏览器的完整 Pro Workspace`), so this was a
token swap, not translation work, and each locale page was asserted equal to its
catalog value afterwards.

**Two corrections to the plan, both load-bearing:**

- `scripts/generate-translations.mjs` and `verify-translations.mjs` **do not
  exist in this repo** — that is the app repo's flow. Here it is
  `scripts/i18n/{extract,build-locales,verify}.mjs`, and there is no
  source-hash file.
- **The locale rebuild was deliberately NOT run.** `build-locales.mjs` is
  all-or-nothing across 33 pages × 12 locales and `extract.mjs` rewrites the
  English sources *and* `en.json` in place. Both would have churned the
  uncommitted `index.html` / `calculators/index.html` work currently in the tree.
  The three locale `extension.html` files were updated surgically instead, to
  exactly the bytes a rebuild would emit from the updated catalogs.

**A regression from P0, found and reported here.** Pinning supabase-js touched
three English i18n sources (`confirmed.html`, `job-buddy.html`,
`share-your-story/index.html`), which shifts byte offsets and staleness
`i18n/.slots.json` — so `build-locales.mjs` now refuses to run with
*"confirmed.html changed since extraction."* Nothing user-facing is broken (the
locale pages are committed and Vercel runs no build, and the locale copies were
pinned directly at the same time), but **`scripts/i18n/extract.mjs` must be
re-run before the next locale build.** Left for a session where the tree is clean,
because the extractor rewrites English sources in place.

**The i18n verify gate is red, and was already red.** Run against a pristine
`git archive HEAD` checkout it reports byte-identical numbers — es/zh-Hans/zh-Hant
`missing 8 · extra 3 · tag-drift 1`, 9 locales failing — driven by untranslated
`home.*` segment-picker keys already committed to `main`. This rename adds
nothing to it. The pack's "i18n gates green" acceptance criterion was not
achievable and is reported rather than claimed.

**Retired pages removed.** `attorneys-legacy.html` and `home-legacy.html` are
deleted: zero inbound links, absent from `sitemap.xml`, and — the actual problem
— **no `noindex`**, so they were crawlable duplicate content. The now-dangling
`/home-legacy.html → /home-legacy` redirect went with them. `for-attorneys.html`
and `calculators/pro.html` keep the old string but are 301-shadowed
(`→ /attorneys`, `→ /workspace/`) and never served, so they were left alone
rather than maintained. `sitemap.xml` needed no change — the hits there were
comments documenting a previous removal, not live `<loc>` entries.

**Cross-repo parity: nothing to do.** The pack expected the string in
`~/TheCompDesk/www/`; the app's shipping code (`www/`, `ios/`, `android/`) has
**zero** occurrences. It survives there only in 2026-05-22 Lighthouse report
artifacts, which are dated audit snapshots of the *website*. The Chrome extension
repo is not present on this machine and remains outstanding.

`changelog.md` and `seo/seo_audit_2026-05-08.md` keep the old name on purpose —
they are records of what the product was called on those dates.

Re-request indexing in Search Console for `/workspace` and `/dashboard/my-cases`;
both titles changed.

---

## 2026-08-05 (P3)

### One Pro dashboard, role-based default tiles — and four tiles that didn't exist

`profession` (shipped hours earlier) now sets the *starting* layout of the
professional dashboard. It does not restrict capability: every tile is reachable
by any Pro user, and unknown or NULL profession falls back to the attorney set,
never an empty dashboard.

**The proposed paralegal set was mostly tiles with no page behind them.** Before
building anything, every destination was resolved against the filesystem and then
against production. Of the roles proposed for paralegals — Forms & Filings,
C-257 Medical & Travel, Deadlines/Reminders — only one had a real page. There is
no `/tools/forms`, no `/tools/filings`, no `/tools/deadlines`. Shipping that set
verbatim would have reproduced the 2026-08-04 defect four times over on the exact
surface it happened on. The real equivalents are `/tools/medical-travel` (a
genuine 44KB C-257 page) and `/tools/ime-reminders`.

Three more findings from the same sweep:

- **`/tools/mileage`, `/tools/utdm` and `/tools/work-search` are live but carry a
  "Coming soon" badge.** Excluded from every default set — a tile that opens a
  placeholder isn't a dead click, but it isn't a feature either.
- **"Fee App (OC-400.1)" has no standalone destination.** It is generated inside
  the Pro Workspace from the active tile, and appears as a modal on the SLU and
  CCP/Award calculators. Rather than a second name for a door already on the
  board, the Workspace tile names it in its description.
- **`getProfile()` selects an explicit column list and did not include
  `profession`.** Left alone, every professional would have silently received the
  fallback layout with nothing in the console to explain why. Added.

**`dashboard_config` cannot hold per-user layouts.** The pack's rule "persist the
user's own arrangement in dashboard_config and let it win" is not implementable
as written: the table is a **singleton** (`id integer default 1`, no `user_id`),
holding one global manifest row — currently `{}`, never populated. Per-user
arrangement needs its own table plus a rearrange UI; `resolve()` is structured so
a saved order can win when that exists, but it is NOT in this pass.

**Two guards, because one is not enough.** `js/dashboard-tiles.js` drops any tile
id with no route before it reaches the DOM and logs loudly;
`scripts/check-tile-routes.mjs` (`npm run check:tiles`) asserts at build time that
every destination resolves on disk, that no default set is empty, that no set
names an undefined id, and warns when a destination is a "Coming soon" page. The
guard was proven to go red on all three failure modes and green when restored —
a gate that cannot fail is not a gate.

Verified: all seven professions plus NULL and a bogus value resolve to a
non-empty, correct set; all 12 distinct destinations return 200 **in production**;
every rendered tile is keyboard-reachable with a working handler; and the worker
dashboard is untouched (one section, no tools block).

**Copy.** The audience is now "WC professionals": the shared nav dropdown reads
"For Professionals — Attorneys, paralegals & WC pros" and /dashboard's nav item
reads "Professionals". **URLs deliberately unchanged** — `/for-attorneys` and
`/attorneys` keep their SEO equity and inbound Google Ads traffic. Both strings
were safe to edit directly: `js/nav.js` carries zero `data-i18n` and neither
string appears in any catalog, and `/dashboard` has no locale mirror. The
remaining "attorney"-as-audience copy on the home and extension pages **does**
live in the i18n catalogs and is deliberately left for a proper i18n-sync pass
(`scripts/generate-translations.mjs` + `verify-translations.mjs`) — hand-editing
those desyncs all 12 locales.

---

## 2026-08-05 (later still)

### "Attorney" becomes "professional": profiles.profession + intake

Paralegals, legal assistants, settlement coordinators and case managers all work
in comp, and the signup form only offered them "Attorney."

**`designation` stays a binary router** — `'worker'` vs `'attorney'`. Nothing that
gates on `designation === 'attorney'` changes behaviour, and the diff contains no
change to any designation comparison. Which *kind* of professional someone is now
lives in a new, purely descriptive `profiles.profession`. Widening `designation`
was rejected: a single missed gate would route a paralegal into the injured-worker
dashboard, and those gates are spread across the website, the app, the workspace
and the Chrome extension. A column no gate reads cannot break a gate.

**Migration 109** adds `profession` (CHECK: attorney · paralegal ·
settlement_coordinator · legal_assistant · case_manager · adjuster · other) plus
`profession_other` free text, constrained to be non-NULL only when
profession='other' so the long tail is observable instead of vanishing into an
unlabelled bucket. 19 existing `designation='attorney'` rows backfilled to
'attorney'; the 18 workers left NULL. Preflight passed all four lints, and three
things were checked by hand that the lints don't cover: no existing row can
violate either constraint, neither column name already existed, and — the one
that would have silently broken the picker — `profiles` carries **table-level**
grants (`pg_attribute.attacl` is NULL on all 92 columns), so the new columns
inherit UPDATE. A column-level grant regime would have left every save failing.

**Migration 110** teaches `handle_new_user()` about it. This trigger fires inside
the signup transaction, so anything that raises here fails the *account
creation*, not just the profile write — and `raw_user_meta_data` is
client-supplied. A payload of `profession: 'wizard'` would have hit
check_violation and taken signup down for that user. Unknown values now collapse
to NULL instead. Two smaller hardenings in the same spirit: `user_type` goes
through `NULLIF(...,'')` so an empty string yields 'worker' rather than writing
`''` into designation (matching neither side of every gate), and
`profession_other` is cleared unless profession='other'. Smoke-tested against six
payloads inside a forced rollback — including the bogus value, which correctly
wrote NULL rather than raising — leaving zero test users behind.

**Intake, in three places.** Signup step 1 relabels to "I work in workers' comp" /
"I'm an injured worker" while writing the identical `'attorney'` value; step 2
becomes "Your Practice" with a required role picker; the post-OAuth completion
step from P1 shows the same picker on the professional branch only; and
`/account` gains an editable "Your Role" card so the 19 backfilled accounts can
self-correct without a support round-trip. The values live in one file,
`js/professions.js` — machine-checked this run to match the CHECK constraint
exactly — rather than being retyped on three surfaces and drifting.

**Data fix.** Two accounts had `designation='worker'` on a paid Pro tier.
`jmays2294@gmail.com` (1 workspace, 5 attorney cases, 21 calculations — and, as it
happens, the only OAuth user on the platform, carrying google+apple+email
identities linked into a single user) is now attorney/attorney.
`fuzzy.rb@gmail.com` was **deliberately left alone** and is reported instead: 0
workspaces, 0 attorney cases, 0 calculations since 2026-06-22 despite Stripe-paid
Pro. Nothing in the data says which side they belong on, and flipping a paying
user's designation silently moves their dashboard.

`get_my_entitlement()` verified untouched — it references neither column and is
still STABLE SECURITY DEFINER.

---

## 2026-08-05 (later)

### Sign in with Google and Apple on the website

The website had no social sign-in at all. Native iOS shipped it back in Phase 4
(`594a571`), but that proves nothing about the web: native uses
`signInWithIdToken`, which validates against the provider's *Client IDs* list
alone — which is why iOS shipped with an empty Apple secret. The web uses the
OAuth redirect flow, which **does** require the signed client secret on the
Supabase provider.

**Provider state, probed rather than assumed.** Hitting
`/auth/v1/authorize?provider=…` directly:

- **Google** — 302s to Google with the correct web client ID and
  `redirect_uri=…/auth/v1/callback`. Wired.
- **Apple** — `400 {"code":400,"error_code":"validation_failed","msg":"Unsupported
  provider: missing OAuth secret"}`. The Supabase field wants a **JWT** signed
  from the `.p8`, not the `.p8` itself.

**The flow is implicit, not PKCE — this changes the callback.** `signInWithOAuth`
on this project emits an authorize URL with **no `code_challenge`**, and stashes
no code verifier. Tokens therefore come back in the URL **fragment** and
`detectSessionInUrl` consumes them; `exchangeCodeForSession` is *not* the path
here. `auth/callback.html` keeps a `?code=` branch purely as a no-op safety net
in case `flowType` is ever switched to `'pkce'`.

**The trap: OAuth users have no `designation`.** `public.handle_new_user()` builds
the profiles row as:

```sql
COALESCE(NEW.raw_user_meta_data->>'user_type', 'worker')   -- user_type AND designation
```

Email signup sets `user_type` explicitly. OAuth does not — Google and Apple
supply only their own claims (`name`, `email`, `avatar_url`, `full_name`, `sub`).
So **every** Google/Apple signup would silently file as `designation='worker'`,
attorneys included. New `auth/complete-profile.html` asks the question once,
before the user reaches any dashboard, and writes both `designation` and
`user_type`.

Note the detection subtlety: you *cannot* test `designation IS NULL`, because the
COALESCE above means it never is. The real signal is whether the user ever
**declared** anything, which lives in `user_metadata.user_type` — absent for
OAuth, present for every email signup. Existing users are therefore never
re-prompted. `designation` stays a binary router; the UI just calls that side
"I work in workers' comp". The profession picker from P2 has a marked seam in
that file.

**Three live sign-in surfaces, not one.** `auth_v2.html` (password + MFA) is the
main page, but `/account` sends users to `auth/login.html` + `auth/signup.html`,
which are **magic-link** — a method `auth_v2` does not offer, so 301'ing them
would have deleted passwordless sign-in. All three got the buttons. `auth.html`
was a genuine dead duplicate of `auth_v2` reached only from `account.html`; it is
now 301'd and that hard redirect points at `auth_v2` carrying `?redirect=`.

`js/social-auth.js` is a **classic script, not a module** — deliberately, one day
after a dangling ESM import took `/dashboard/my-cases` down. If it fails to load
we lose two buttons; the email/password form underneath is untouched.

Verified: both buttons render above the form in all three `auth_v2` modes and on
both magic-link pages, re-bound correctly across mode switches; `?redirect=` and
`?next=` survive the whole round trip into `/auth/callback`; the eight routing
cases (new Google, new Apple with Hide My Email, returning social, email users
with and without metadata, null/malformed sessions) all resolve correctly and
none throw; the completion form gates Continue on a choice and escapes the
provider-supplied name; and every existing handler on `auth_v2` — password login,
MFA challenge, recovery, worker signup, attorney signup — is intact.

**Not yet working, and why.** Apple stays broken until the ES256 client secret
JWT is pasted into the Supabase Apple provider — the button is live, so it will
land on that raw 400 until then. Two other things cannot be verified from
outside: whether Google's client secret is the current one (it only fails at
token exchange, after real user consent), and whether
`https://thecompdesk.com/auth/callback` is in Supabase's Redirect URLs allowlist
— validation happens on the return leg only, and a missing entry silently sends
users to SITE_URL instead. Both need a real sign-in to confirm.

**Apple JWT expiry: Apple caps it at 6 months.** Whoever mints it must record the
expiry date here and set a calendar reminder — when Apple sign-in starts throwing
"missing OAuth secret" again, an expired secret is the first thing to check.

---

## 2026-08-05

### /dashboard/my-cases — an import of a file that was never written, and the 162 more it led us to

**Every visitor to My Cases, at every tier, sat on "Verifying your subscription…"
forever.** Not a tier bug — `get_my_entitlement()`, `getEffectiveTier()` and the
paywall gate were all correct and are untouched.

`my-cases.html:635` statically imported `../js/calc-history-sync.js`. That file
had never existed, in any branch, since the import was added on May 8. Because a
**static ESM specifier that fails to resolve aborts the entire module**, the
whole `<script type="module">` block never ran — and that block is the only thing
that hides `#verify-overlay`, which rendered visible by default. The page had no
way to recover: the code that would have unstuck it was inside the thing that
died.

Same class as the 2026-08-04 dead `<script>` tags, one order of magnitude worse.
A missing `<script src>` costs you one feature. A missing ESM specifier costs you
the page.

**The module is now written, not stubbed.** `js/calc-history-sync.js` does the
cross-surface sync that was promised: a Realtime `postgres_changes` subscription
on `calculation_history`, so a save on the iOS app repaints an open browser tab.
Two things worth knowing before touching it:

- The table is already in the `supabase_realtime` publication — verified, no
  migration needed.
- It has **REPLICA IDENTITY DEFAULT**, so a delete's `old_record` carries only the
  primary key. `user_id` is not in the payload, so the obvious
  `filter: user_id=eq.<id>` on DELETE can *never* match — it would connect
  cleanly, look right, and silently drop every cross-surface delete forever.
  DELETE is therefore subscribed unfiltered; we still receive those events
  because RLS is not applied to deletes, and the refetch they trigger re-reads
  through RLS, so it costs one redundant scoped query and discloses nothing.
  INSERT and UPDATE are filtered normally.

**Three safety nets, because the page had none.** `#verify-overlay` now renders
hidden and is shown by JS; init is wrapped in try/catch/**finally** that drops the
overlay on every path; and a watchdog armed before the first `await` fails open at
8s with a non-blocking toast. All three fail *open* — the data is RLS-protected,
so the worst case is a free user seeing an empty shell rather than a paying
attorney locked out. Note the ordering: only the markup change survives a dead
module, which is exactly the failure we had.

**Two independent causes, both closed.** `auth.js`, `entitlements.js` and
`attorney-signup.js` each built their own `createClient()` — three GoTrueClients
sharing one `localStorage` key and one `navigator.locks` lock, able to deadlock
`getSession()` and produce this same hang by a different route. They now share
`js/supabase-client.js`, which also survives being loaded under both `/js/…` and
`../js/…` specifiers. And every `supabase-js` reference sitewide is pinned to
`@2.112.1` — 25 of them resolved a fully unpinned major (`…/supabase-js/+esm`),
one upstream v3 publish away from breaking every authenticated page on the site
with no deploy on our side; the rest were major-pinned `@2` but floated on patch.

**The guard found 162 more.** `scripts/check-asset-refs.mjs` (`npm run
check:refs`) walks every HTML file plus the module graph behind it and asserts
each local reference exists on disk. First run: **163 dangling refs across 73
files**. The one we knew about, and 162 we did not — every locale calculator and
learning page imports `../js/auth.js`, which from `/bn/calculators/` resolves to
`/bn/js/auth.js`. There is no `js/` directory under any locale. Confirmed 404 in
production, meaning auth and nav had been dead on all nine non-English locales'
calculator pages. Rewritten to root-absolute `/js/…`; the guard is green.

Proven, not assumed: with the import deliberately broken in a scratch copy the
overlay stays hidden and the spinner never appears (fail-open holds even when the
module is entirely dead); the guard flags that same break and exits 1; the shared
client is one instance across every import path with no "Multiple GoTrueClient"
warning; the Realtime channel reaches `joined`; and `startCalcHistorySync` /
`stopCalcHistorySync` were fired at eleven malformed-argument cases without
throwing — a sync failure must never be able to take the page down again.

Still to confirm signed in as a Pro user: that live sync actually repaints on a
cross-surface save. Everything above was verified without a Pro session.

---

## 2026-08-04

### /dashboard — two tiles that did nothing, and four scripts that were never here

Found while checking whether a fix from the app repo needed porting here. It
didn't — the code being fixed had never been deployed to this repo at all. What
was here instead: `dashboard/index.html` loaded four scripts that do not exist
(`js/uploads/evidence-uploader.js`, `js/mt/mt-tracker.js`, `js/mt/c257-pdf.js`,
`js/evidence/accident-notice.js`), all **404 on every page load** in production.

The tiles they back were the real defect. `showScreen()` in `dashboard-host.js`
routes neither `mt` nor `accident-notice`, and `SCREEN_URLS` has no entry for
either, so both clicks fell through and returned silently — no navigation, no
error, no feedback:

- **🚗 Mileage & Travel** — tier `free`, so *every* visitor to /dashboard/ saw it
- **🧾 Accident & Notice Evidence** — tier `comp_buddy`, dead for subscribers

Both flows are app-only; they also need `js/native-mail.js`, absent here with no
`ops/website` copy. Shipping the four files alone would not have helped — with no
routes the tiles stay dead either way.

**Fixed in the web-only glue, deliberately not at source.**
`js/dashboard/worker-dashboard.js` is generated by `ops/website/sync-dashboard.sh`
("never hand-edit them; this script overwrites them verbatim"), and both tiles
work correctly in the native app — so editing there would be wiped on the next
sync *and* wrong. `dashboard-host.js` and `dashboard/index.html` are authored
directly and survive it.

The dead `<script>` tags are gone, replaced by a comment naming what a real
launch would have to restore. A targeted DOM pass hides the two tiles by title
plus the `.wd-docs-an` "Open Accident & Notice →" link — a second entry point
that only un-hides once app-captured evidence exists, so the tile pass alone
would have missed it. It runs after the V2 wrap so it sees the final composed
DOM, and fail-softs exactly like the rail's missing-section handling: an unknown
title matches nothing and the pass is a no-op. `showScreen()` also gained a
backstop for both ids so a deep link can't reproduce the silent fall-through.

Verified by mounting the real `dashboard-host.js` against a stub emitting the
genuine `.wd-fcard` markup — both tiles hidden, docs link hidden, IME and C-3
untouched, no navigation, zero console errors. The same harness fails 3 of 7
against the pre-change file, so it can go red. Production now serves zero
requests for the four removed paths.

---

## 2026-08-03 (later)

### /dashboard — desktop tile layer: the design's actual big-screen layouts

Joel's read on the first shell deploy was right: the vendored phone-column
dashboards inside a desktop window still read as "an app on a phone." This adds
`js/dashboard-web-v2.js` + `css/dashboard-web-v2.css` (web-only, never synced) —
the render layer that produces what the P6–P10 / P11 design pages actually
specify, on real data:

- **Worker** — the launcher grid: a true-state hero across 4 of 6 columns (the
  weekly estimate from `profiles.current_aww`, ⅔ capped at the DOA-period max
  via calc-core/MAX_RATES; an honest CTA hero when no wage is on file) plus
  nine feature tiles sized so every grid row fills exactly, opening the same
  screens as before. The vendored launcher sections hide via
  `[data-dashv2-hidden]`; the functional cards (tracker + gauge, case snapshot,
  appointments, documents, upgrade) keep rendering below, untouched.
- **Attorney** — P11's 48-hour clock: most-urgent open lead as the hero with a
  live countdown ring, Call / Accept / Decline through the same
  `respond_to_lead` RPC, a click-to-promote open queue, stats derived from the
  real lead list, and the design's empty states with the vendored module's
  honest copy. The command center below keeps Upcoming / This Month / Quick
  Calc / Tools / Skills.

Two defects caught in review, worth remembering:

1. **`*/` inside a CSS comment.** The stylesheet header said `.wd-*/.cc-*` —
   that `*/` terminates the comment, and the parser's error recovery silently
   swallowed the first rule of the file (the hide rule, so nothing hid). Glob
   pairs in CSS comments must be written spaced or spelled out.
2. **Async repaint race.** The vendored attorney module's own fetch triggers a
   full `CD.render()` while the v2 leads fetch is in flight; a completion
   callback captured by the old block painted into a detached node and the new
   block stuck on "Checking your leads…". Completion now notifies whatever
   block is current (module-level `_notify`), and the shell re-tags rail
   anchors after every async repaint via `CD.dashShellDecorate`.

---

## 2026-08-03

### /dashboard — V2 web shell: window panel, persistent side rail, deep links

Implements the shell-level scope of the "P6–P10 Web Dashboards" and "P11 Attorney Leads
Web" pages from the Claude Design project (the-comp-desk-design-system). The vendored
dashboards (`.wd-*` worker, `.cc-*` attorney — synced from `www/`, may not fork) are
untouched; everything landed in the web-only shell around them:

- **`css/tokens-v2.css`** — the V2 semantic token baseline (`--v2-*`), values verbatim
  from the design system's `tokens/v2.css` plus the `--tcd-*` brand spine it builds on.
  New components reference only `--v2-*` names — never `--bg`/`--skin-*` — so the
  eventual restyle is a token swap, not a rewrite.
- **`css/dashboard-shell-v2.css`** — the `.dash-win` glass panel and `.dash-rail`:
  76px rail at desktop, 60px at 768, a horizontal strip below 560 (never a drawer — on
  web you still have a pointer). Focus-visible rings, deep-link focus styling, the 1040
  width cap, and the inert `.wg` tile-grid contract ready for when the V2 tiles vendor
  down. Deliberately **no `backdrop-filter` on the panel**: it is as tall as the whole
  dashboard, and blurring a 4000px+ element blows GPU texture limits — content below
  the fold silently stops painting. The page behind it is a flat skin colour, so the
  translucent tint alone reads as glass.
- **`js/dashboard-host.js`** (web-only adapter, not synced) — populates the rail per
  designation (worker: Home/Dates/Docs/Buddy/Doctor/Calc/Learn; attorney:
  Home/Leads/Cases/Calc/Tools/Skills/Firm), tags sections in the rendered DOM by stable
  class/card-title, and wires `/dashboard#dash-…` deep links that scroll to **and
  focus** a section. Scroll-spy drives `aria-current`; a stall fallback hard-jumps if
  the engine drops the smooth scroll. Fail-soft throughout: a section that didn't
  render (e.g. Firm Management on non-firm tiers) hides its rail item; a wizard
  rendered in place makes the rail double as the way back (re-render, then scroll).

Verified in a local harness with both designations before push: rail nav, deep links,
Firm hiding on the pro tier, the mobile strip at 375px, zero console errors.

---

## 2026-07-30

### Workspace autosave — stop a silent anon-degrade from killing saves (and lying about it)

A rejected Supabase refresh token (`POST /auth/v1/token → 400`) leaves supabase-js
answering every request with **no Authorization header** — all PostgREST calls silently run
as the `anon` role. Under RLS that is not an error: reads return `200 []`, and the guarded
UPDATE matches 0 rows. `persistence.js` read that empty result as "first-time user," fired
an INSERT that 401'd, and autosave was dead for the rest of the session while the header
still showed a green "Pro · synced." Same failure shape as the Apr 27 RLS incident: a
permission failure wearing an empty-result costume.

Fix, per the fail-loud playbook (`js/workspace/persistence.js`, `js/workspace/app.js`,
`workspace.html`):

- **`_liveSession()` gate before every read/write** — verify the session exists, refresh it
  when within 30s of expiry, and assert it belongs to `window.workspaceUserId`. No live
  session → emit `workspace:auth-expired` and write nothing.
- **Never INSERT over a row we've already seen** — a `_rowKnown` flag turns "row invisible"
  into `WORKSPACE_ROW_INVISIBLE` instead of an INSERT that could clobber a real workspace.
- **Fail loud on load** — `loadWorkspace()` throws `WORKSPACE_LOAD_AUTH_EXPIRED` instead of
  returning null, so a dead session can't render an empty workspace that the next save
  would persist over real work.
- **Self-heal the frozen-remote version deadlock** — if the remote version hasn't moved
  across 3 conflicting attempts there is no competing writer; adopt it and retry once
  (`WORKSPACE_SAVE_VERSION_RESYNC`). A moving remote version still surfaces a real conflict.
- **Say it plainly** — the save indicator gains a `signed-out` state ("Not saving — sign in
  again"), workspace.html shows a red status line, and `supabase.auth.onAuthStateChange`
  re-bridges `window.workspaceUserId` + fires `workspace:auth-recovered` so signing in on
  any other tab resumes saving **without a reload** — nothing typed while stuck is lost.

Deploy note: the ops drafting copy of `app.js` had drifted behind the deploy repo (it
predated the tile-grid refactor, auto-hide toolbar, and per-tile error boundary), so the
three fix hunks were rebased onto the repo's current `app.js` rather than copied wholesale.
`persistence.js` was current and copied verbatim. The app's ESM copy
(`www/js/workspace/persistence.js`) has the identical hole and is handled separately
(bundle rebuild + native mirror).

---

## 2026-07-26

### Phase 3 i18n — 9 locale scripts, and two deliberate architecture decisions worth remembering

Locale pages for es · zh-Hans · zh-Hant · ru · bn · ht · ko · fr · pl now ship script
coverage. Two calls made here point in opposite directions on the same question — how much
third-party surface the render path may depend on — and both were deliberate.

**Fonts come from the Google Fonts CDN, NOT self-hosted.** DM Sans is Latin + Latin-ext only;
measured against the finished catalogs it leaves 1099 codepoints uncovered in zh-Hans, 1116 in
zh-Hant, 642 in ko, 79 in ru (Cyrillic), 71 in bn — plus 8 on *every* locale including English
(arrows/math, notably U+2192 in "Calculate my AWW →"), a gap that predated this work.

The app self-hosts subsets because a Capacitor bundle must render offline. This site already
loaded DM Sans from that CDN on every page, so same-origin Noto faces were judged consistent
with its existing architecture. **The consequence, stated plainly: the site now has a
third-party dependency on the render path.** If fonts.googleapis.com is unreachable, non-Latin
locales fall back to whatever the OS ships. This is the same class of concern as letting Vercel
run `npm install` on deploy — which was decided the OTHER way in the same phase (see below) —
and the difference is that a font fallback degrades, while a failed install takes the whole
deploy down. If the site ever needs CDN independence, only the `@font-face` sources move.

**By contrast, the deploy path was kept dependency-free.** Phase 3 introduced the repo's first
`package.json` (for the i18n tooling and `opencc-js`). With `framework: null` and no build
command, its mere presence makes Vercel start running `npm install` on a project that
previously had no install step at all — a new failure mode on the repo carrying the organic
footprint. `opencc-js` is now a devDependency (build-time only; zh-Hant is derived locally and
the result committed) and `vercel.json` overrides `installCommand` so deploys stay inert.

### Gate lesson — a check that strips what it is checking is blind to it

The duplicate `data-i18n` bug reached production because the annotation gate strips every
`data-i18n*` occurrence before comparing, so a duplicated attribute stripped exactly as
cleanly as a single one. The gate proved the property it was written for (English
rendering is unchanged) and was structurally incapable of seeing this one.

`scripts/i18n/annotate-gate.mjs` now also asserts the OUTPUT property directly — no
element carries a repeated `data-i18n*` attribute — and that the **extract → build
pipeline** is a byte-level no-op. Pipeline, not extract alone: `extract.mjs` deliberately
writes the page with generated blocks stripped, because that is what slot offsets are
measured against, and `build-locales.mjs` re-injects them.

Adding that assertion immediately caught three more defects in its own supporting
changes, none of which shipped:

1. `extract.mjs` measured offsets against the FULL page while `build-locales.mjs` expects
   the STRIPPED page — every offset was wrong. The convention now lives in `extract.mjs`.
2. The de-annotation regex used `\s+`, which swallows the newline in a multi-line start
   tag and silently reformatted 182 lines of one page. It now removes exactly one leading
   space, matching how annotations are inserted.
3. `extract.mjs` had been committed without declaring its `parse5` dependency, so it could
   not run from a clean checkout at all.

The general lesson: when a check normalises away a class of difference in order to compare,
it can never detect defects **within** that class. Assert the normalised-away property
separately.

### Recommended pattern for the APP's Phase 4a hamburger/CTA collision

The site's pinned globe control landed squarely on the "Contact an attorney" CTA that
`js/header-attorney-cta.js` floats top-right. That is the **same bug against the same
CTA** that the app project has specced for P4a, where the Arabic hamburger collides with
it. The app's spec calls for making that header a flex row so `dir` swaps order
naturally, plus logical properties on the CTA.

**The measure-and-step-down approach used here is the better fix, and P4a should inherit
it rather than solve this twice.** After mount, the control measures its own box against
every `fixed`/`absolute`/`sticky` element on the page and, on any intersection, shifts
its `inset-block-start` below the lowest offender; it re-runs debounced on resize.
See `renderGlobe()` / `avoidCollisions()` in `js/i18n-locale.js`.

Why it beats the flex-row spec:

- **It does not depend on the two controls sharing a parent.** Both the CTA and the globe
  are injected by separate self-bootstrapping scripts onto pages with three different
  header implementations. There is no common flex container to reorder, and creating one
  would mean editing every page.
- **It is direction-agnostic already.** A flex row fixes the collision only for the
  direction you reasoned about; measuring finds it in LTR and RTL alike, which matters
  because the app hits this specifically under RTL.
- **It survives late-injected chrome.** The app's nav and CTA both mount after load; a
  static layout rule is evaluated once, whereas the measurement re-runs.
- **It degrades safely.** Worst case the control sits lower than ideal; it never overlaps
  and never disappears.

Caveat for whoever ports it: it only applies to a control in the fixed fallback position.
A control placed inside a real nav is in normal flow and needs no adjustment — the
implementation skips those via a `data-inline` marker.

### Known debt — CSS tokenization

`css/i18n-fonts.css` cannot rely on redefining the `--font` token alone. Several pages, and
some inline `<style>` blocks in the calculators, hardcode `font-family: 'DM Sans', system-ui, …`
instead of using `var(--font)`. Verified in-browser: with the token override alone, zh-Hant
computed to plain DM Sans and Noto Sans TC never loaded. The stylesheet therefore carries
locale-qualified element selectors to out-specify those rules.

**Logged as debt, deliberately not fixed in this phase.** The correct fix is to route every
`font-family` through the token, which touches calculator pages and is out of scope for a
translation phase. Until then, any NEW page that hardcodes a font family will silently render
non-Latin locales from OS fallbacks.

---

## 2026-07-06

### CCP "% of Rate" fix — divide by the true (uncapped) ⅔ AWW, clamp at 100%

The Pro workspace CCP tile's **% of Rate** read-only field (`js/workspace/tiles.js`, `CCPTile`)
divided the entered CCP amount by the **statutory-capped** TT rate (`global.ttRate`) instead of
the claimant's true weekly rate. This overstated the percentage any time ⅔ × AWW exceeded the DOA
maximum, and broke the round-trip with the TR/TP formula (which applies the percentage to the
uncapped ⅔ AWW per the June 2026 fix, then caps the dollar result).

- **Now divides by the uncapped ⅔ × AWW** (`ccpTrueRate`), matching the TR/TP convention so the
  readout is the true inverse of the rate math. Clamped at 100% so a claimant at/above full TT
  (including the AWW-below-min collapse) never reads over 100%.
- **Example** (DOA 7/1/2026, statutory max $1,281.50, AWW $3,600 → true rate $2,400): a 50% TR
  pays $1,200/wk. Old field read **93.6%** ($1,200 ÷ capped $1,281.50); now reads **50.0%**
  ($1,200 ÷ $2,400). Low earners (⅔ AWW below the max) are unchanged.
- Tooltip updated to describe the uncapped basis. Website-only field (not present in the app
  `www/` or native bundles), so no cross-surface sync needed. Commit `ebb0c8e`.

---

## 2026-06-18

### Job Buddy — public, no-account beta page (`/job-buddy`) with map + list and eggshell theme

New standalone public page so the Job Buddy beta works for logged-out visitors (it previously
lived only inside the auth-gated `/dashboard/` and hard-required AWW + DOA from the user's profile
before showing anything). Website-only; the logged-in dashboard version is unchanged except the
gate relaxation noted below.

**Reliability fix (same day):** searching could hang on "Searching…" and show **no jobs** —
geocoding ran sequentially with no timeout, and `finish()` waited for ALL geocoding before
rendering anything, so one stalled/failed Mapbox call (rate-limit/referrer/transient on prod)
froze the whole search. Reworked into two phases: the job list renders **immediately** after the
~0.8s `job_listings` read (Phase 1), and geocoding → distance filter → map markers run as a
**non-blocking** Phase 2 that can only refine results, never gate them. Geocoding is now parallel
(concurrency 6, hard cap 40 unique lookups), each request has a 7s `AbortController` timeout and
fails to `null` without caching (retries later), and the listings read has a 15s timeout race plus
a clear, retryable error message instead of a silent hang.

- **No account, no profile gate.** New `job-buddy.html` + `js/job-buddy-public.js` read the
  anon-readable `job_listings` table directly (RLS public-read of fresh rows) — no edge function,
  no login. Restrictions, AWW, DOA, and home location are entered **inline** and never saved.
  Jobs render from restrictions alone; AWW/DOA are optional and only add the reduced-earnings
  estimate. Fixes the "add your AWW and DOA to your profile first" blocker for beta users.
- **Reduced-earnings parity.** RE math mirrors `_shared/job-buddy/re_math.ts` exactly
  (⅔ × (AWW − est. weekly pay), floored at $0, capped at the DOA PPD max via
  `CD.Calc.maxRateForDOA`); SGA red-flag wording reused. Restriction *fit* is a transparent
  client-side heuristic (no model call for anonymous traffic).
- **Location + travel distance.** Home ZIP/city geocoded via Mapbox; each listing's location
  geocoded (Adzuna coords used directly, others geocoded by unique string and memoized in
  `localStorage`); results filtered by a 10–60 mi slider via haversine distance.
- **Map ⇄ List.** New Mapbox map view (light-v11) with a colored pin per geocoded job
  (fit-scored) + home pin, popups deep-linking to the employer apply URL; toggles with the list.
- **Eggshell theme + readability.** `css/job-buddy-public.css` puts every text block in a solid
  cream "box" with dark ink over a warm eggshell tint, fixing the faint muted-gray-on-light
  problem. An aerial NYC-dawn still (`assets/animations/job-buddy-bg.jpg`) sits behind the tint
  with a slow CSS Ken Burns "boomerang" (zoom in → reverse out → loop via
  `animation-direction: alternate`, 44s); honors `prefers-reduced-motion`.
- **Dashboard gate relaxed.** `js/job-buddy/job-buddy.js` Feed tab now offers inline AWW + DOA
  inputs (passed to `matchNow(override)`, not saved) instead of bouncing logged-in users to the
  profile editor.
- Nav: "Job Buddy BETA" added to the Tools dropdown (public + app nav); `sitemap.xml` entry added.
- Verified locally: anon search returns matches with no account, RE math floors/caps correctly,
  SGA flag fires, distance filter works, map renders 64 markers, exactly one `job_listings` read
  with deduped/memoized geocoding, responsive at 375px.

---

## 2026-06-12

### Pro Attorney Workspace — CCP rate-formula fix, UI density/chrome overhaul, auto-arrange canvas + MTG modal formatting

Five deploys to `main` (`3b6b5c2`, `c4fa92b`, `5825055`, `7de36be`, `bfb8548`), all READY/production and live-verified in-browser. Website-only (no app/native). Full detail in `SESSION_HANDOFF.md`.

- **CCP/Award TP rate fix (correctness).** TP (and the inline calculator's TR) now apply the percentage to the **uncapped** ⅔×AWW, then `applyRateBounds` caps — was multiplying the already-capped TT, which understated the rate whenever ⅔×AWW exceeded the DOA max. Acceptance: AWW $2,258.12, max $1,171.46, @87.5% → **$1,171.46** (was $1,025.03). TP and TR pct-mode are now identical. Files: `js/workspace/tiles.js` (both compute sites), `calculators/ccp-award.html` (TR via one `trRate()` helper).
- **Amending-award display** shows the full new amended rate + a trailing `$X difference/wk` token (award math unchanged).
- **AWW configure bar** — fixed field overlap (`$`-prefixed inputs were overflowing their grid cells), removed the dead space before the §14 badge (readout is now content-width, not a `1fr` stretch), and relocated the **Configure AWW** button into a cluster paired with the §14 method badge. Second line (Common rates + Today/Term/Deadline) packs left.
- **Top-chrome collapse** — the Comp Desk site menu bar auto-collapses ~4s after load with a Show/Hide toggle; the workspace toolbar condensed to a small title + Save + Full Screen + a ⚙ Settings gear (themes, Tile/Zoom sliders, Formulas, Delete moved into the popover), and the toolbar auto-hides into a drawer handle that reveals on click.
- **Auto-arrange canvas** — tiles flow into a tidy grid that re-flows when Tile Size changes (bigger tiles → fewer per row); new tiles land adjacent (right, wrapping down); dragging reorders within the grid. Workspace Zoom stays a canvas magnify on top.
- **MTG section modal** — added `mtgNormalizeBody()` so PDF-extracted guideline text no longer breaks sentences onto random lines: paragraphs flow, lists and paragraph breaks preserved, hyphenated words rejoined.
- **Earlier in this pass (first versions, since superseded):** initial collapse/fullscreen, Tile/Workspace size sliders (`--tile-scale`/`--workspace-scale`, not persisted), denser AWW bar, CCP-builder grid alignment.

**Files:** `js/workspace/tiles.js`, `js/workspace/app.js`, `js/workspace/workspace.css`, `workspace.html`, `calculators/ccp-award.html`, `SESSION_HANDOFF.md`, `changelog.md`.

---

## 2026-06-11

### CCP/Award Builder — two date fixes (DOI+1 prefill, drop duplicated boundary day) + basic-calc reconciliation

Mirrors the app's two CCP date-handling fixes onto the public site so thecompdesk.com matches the app, and reconciles the basic CCP calculator's day-count engine to the inclusive convention. Full spec + locked decisions: `ops/secretary/calculator_fixes_scope_and_prompts.md`.

- **Fix #1 — first period starts day-after-DOI.** When a DOA/DOI is set, the first CCP period's start now defaults to **DOI + 1** (the date of injury is not a compensable lost-time day), only when the start is empty, once, and never overwriting a manually typed date (one-time autofill guard). Applied to the workspace tile (`js/workspace/app.js`, tile-creation prefill) and the basic calculator (`calculators/ccp-award.html`, `doaDate` change listener).
- **Fix #2 — drop the duplicated boundary day on consecutive periods.** When a period's start exactly equals the prior period's end, that shared calendar day was counted in both periods. The later period now drops one day so the boundary is counted once. **Math-only** — the displayed start stays contiguous (still shows e.g. `4/7`); only the week count changes.
- **Reconciled the basic calculator to inclusive.** `calculators/ccp-award.html` counted days *exclusively* (one short, no boundary double-count); it now counts inclusive of both endpoints (matching the workspace tile) and applies Fix #2. `js/calc-core.js` (`weeksBetween`) likewise reconciled to inclusive and Fix #2 wired into `computeCCP`.

**Canonical helpers** (`inclusiveDays` / `periodWeeks` / `dayAfter`) are byte-identical across `js/workspace/tiles.js`, `js/calc-core.js`, and the inline `calculators/ccp-award.html` script — kept identical to the app/extension copies; do not let them drift.

**Verification:** acceptance fixture DOI 3/29/2026, AWW 1500, rounding none, both periods TT — P1 `3/20–4/7` = 2.7143 wks; P2 `4/7–6/11` (consecutive) = **9.2857 wks** (was 9.4286, one boundary day dropped); total **12.0000 wks** = the true `3/20→6/11` inclusive span. Non-consecutive `4/8` start → no drop. Standalone single period unchanged. `dayAfter(2026-03-29)` = `2026-03-30`. All three surfaces (workspace tile, basic calc, calc-core) produce identical week counts. SEO static pass clean of new issues (calculator page heads/sitemap untouched).

**Files:** `js/workspace/tiles.js`, `js/workspace/app.js`, `js/calc-core.js`, `calculators/ccp-award.html`, `changelog.md`.

---

## 2026-05-29

### Statutory rate update — Max $1,281.50 / Min $384.45 for DOI 7/1/2026 – 6/30/2027 (Subject No. 046-1805)

Per NYS WCB **Subject No. 046-1805** (issued April 16, 2026): the NYS Average Weekly Wage for CY2025 is **$1,922.25**, so for dates of injury from **July 1, 2026 through June 30, 2027** the maximum weekly benefit rate is **$1,281.50** (2/3 NYSAWW) and the minimum is **$384.45** (1/5 NYSAWW). Loaded ahead of the July 1 effective date so every calculator is correct the moment a 2026–27 DOI is entered.

- **MAX_RATES** (every calculator + shared engine): capped the prior open-ended $1,222.42 row at `e:"2026-06-30"` and added a new top row `{ s:"2026-07-01", e:"2099-12-31", l:"Jul 1, 2026+", max:1281.50 }`.
- **MIN_RATES**: set the 2026-07-01 row to `min:384.45` (`"1/5 NYSAWW (2025)"`), capped at `e:"2027-06-30"`; added a new top indexed row `{ s:"2027-07-01", min:null, n:"1/5 NYSAWW (indexed)" }` (the Jul 2027 min re-indexes off the CY2026 NYSAWW, not yet published).
- **Tooltip/source link** added on the Max/Min rate labels → the Subject No. 046-1805 page (opens in a new tab), themed with `var(--ac)`.

**Surfaces:** `js/ny-rate-table.mjs` (shared engine behind benefit-rate.html + aww-share.html — MAX + MIN), `js/aww-engine.mjs` (DOI-unknown fallback $1,222.42 → $1,281.50), `calculators/{rates,slu,lwec,ccp-award,spine-brain,aww}.html` (MAX_RATES table + default input + "current max" hint + empty-field `|| 1222.42` fallback → `1281.50`), `settlement-calculator.html` (default comp-rate input + placeholder), `js/workspace/constants.js` (workspace MAX/MIN tables).

**Verification:** all MAX tables resolve a 7/15/2026 DOI → $1,281.50 and 6/30/2026 → $1,222.42; MIN tables → $384.45 / $325 / indexed (2027). `node --test js/benefit-rate-engine.test.mjs` 26/26 and `js/aww-engine.test.mjs` 42/42 green (the forward-looking 2026-07-01 assertion was updated to the new rates). Figures reconciled against the live WCB Subject No. 046-1805 page.

**Files**: `js/ny-rate-table.mjs`, `js/aww-engine.mjs`, `js/benefit-rate-engine.test.mjs`, `js/workspace/constants.js`, `calculators/rates.html`, `calculators/slu.html`, `calculators/lwec.html`, `calculators/ccp-award.html`, `calculators/spine-brain.html`, `calculators/aww.html`, `settlement-calculator.html`, `changelog.md`.

---

## 2026-05-26

### Workspace — CCP Award Builder → OC-400.1: Increase box now fires alongside Continuation

Bug fix in `tiles.js` CCP case. Previously the OC-400.1 § A "Increase in compensation paid for a prior period" (FeeReason2) checkbox only fired when at least one award period had an end date in the past. A common, valid scenario — single ongoing/future-dated TT (or any award) period plus a non-zero CCP — was checking only the Continuation box (FeeReason1) and leaving Increase blank, which understated what the attorney is doing on the form.

- **New rule (v4)**: when `ccpAmount > $0` **and** `totalAward > $0`, BOTH FeeReason1 (Continuation) and FeeReason2 (Increase) check on the generated OC-400.1.
- **Legacy preserved**: a CCP=$0 fee app with a past-dated period and an award still fires FeeReason2 standalone (simple amending-award workflow unaffected).
- HIA-only / NCLT-only / NME-only "periods" (which compute to $0) plus a CCP do NOT fire FeeReason2 — there's no real compensation award to increase.

#### Follow-up: v4.1 — past-period check now requires a real award (caught by new regression skill)

Smoke-testing the new `feeapp-field-map-regression` skill against current code surfaced 4 edge-case failures where HIA-only / NCLT-only / NME-only past periods (which compute to $0) were silently firing FeeReason2 anyway. The v3-stated intent was always "past-dated period **with an award**" but the original code only checked `endDate < today` without checking `r.amount > 0`. Tightened: the past-period branch now iterates over computed `rows` (not raw `inputs.periods`) and requires `r.amount > 0` before flipping the flag. Same semantic as the v4 rule above — $0-comp designations shouldn't trigger Increase. Regression skill now 14/14 green.

**Files**: `js/workspace/tiles.js`, `changelog.md`.

---

## 2026-05-20

### For-attorneys hero — Higgsfield Batch A3 deployed (A2 tried, reverted)

May 20 operating-calendar deliverable: compress A2/A3/A4 via media-asset-rollout, push A2 to home hero, push A3 to for-attorneys hero. Executed May 22. **Net live state: A3 only.** A2 was pushed in commit `c5b52d7` alongside A3, but Joel viewed the home-page hero on the live deploy and decided it looked wrong → A2 surface reverted in `32dfce5` while A3 was preserved. Home hero is back to pre-session static `comp-desk.png` state.

- **A3 → for-attorneys hero (`for-attorneys.html`) — LIVE**: compressed `Clip A3.mp4` (1920×1080, 24fps, 8s, 7.1MB) → `assets/animations/attorneys_workspace_pullback.mp4` at **1.96MB** (CRF 26, motion-heavy pull-back doesn't compress as aggressively as a near-static composition; still under 2MB web tier). Built **new** `.hero-grid`/`.hero-copy`/`.hero-media`/`.hero-video`/`.hero-fallback` CSS scaffold + `prefers-reduced-motion` block. Restructured the previously single-column centered hero to two-column on `min-width:900px` (copy left, video right) with mobile fallback to stacked single-column. Added preload `<link>` in `<head>`. Inline SVG document-glyph fallback (`stroke=currentColor; color=var(--ac)`) per skill §6 brand-glyph pattern — no PNG bundling needed. iOS-Safari attrs on `<video>` (autoplay muted loop playsinline preload=auto disableremoteplayback aria-hidden).
- **A2 → home hero — REVERTED**: initial push in c5b52d7 swapped the static `comp-desk.png` for a `<video>` with the compressed 763KB `intro_landscape.mp4`, reshaped `.hero-video` from 9:16 vertical to 16:9 landscape, and bumped the desktop grid column 380→480px. After viewing live, Joel decided the home hero "looked wrong" — `32dfce5` reverted the markup and CSS but preserved the new compressed mp4 file alongside the existing one. Iteration decision needed: aspect-ratio mismatch? column width? clip tone? loop seam?
- **A4** (Comp Buddy onboarding + IG/TikTok): compressed to app tier 611KB (111KB over 500KB budget — flagged) + social tier 1.1MB. Not deployed this week; deployment surfaces are separate streams (in-app + social).
- **Tripwire surfaced (for future memory)**: local clone at `~/Code/thecompdesk-site` was 16 commits behind `origin/main` at the start of the session — looked like a 5-day backlog of unshipped work in the changelog diff, but was actually already live (the local checkout was just stale). Fix: always `git fetch origin && git log origin/main..main && git log main..origin/main` before reasoning about divergence between `ops/website/` (drafting space, no git) and `~/Code/thecompdesk-site` (deploy repo).

**Files (final on origin/main)**: `for-attorneys.html`, `assets/animations/attorneys_workspace_pullback.mp4`, `changelog.md`. `index.html` + `intro_landscape.mp4` reverted to pre-session state.

**Next**: re-run Lighthouse on `/for-attorneys` only (the `/` audit numbers from the pre-revert pass stand since the home hero is unchanged). A2 iteration is a separate Engineering Wednesday / Sunday item once Joel locks the "what looked wrong" feedback.

---

### Workspace — full audit fixes: $0-omission, rounding default, hydration coverage

Comprehensive sweep of `js/workspace/*` surfaces three real bugs and applies the across-the-board $0-omission rule for the OC-400.1 fee-app equation.

- **$0-omission rule applied to every fee tile.** SLU, LWEC, CCP, Settlement — every line in `buildEquation()` that computes to $0 (period at $0, prior pay at $0, employer bucket at $0, any fee at $0, net at $0, CCP at $0) is now dropped from both the mono equation text and the plain prose used in the OC-400.1 PDF. HIA, NCLT, NME, and any 0-week period collapse out of the equation entirely.
- **BUG FIX: CCP Round Weeks default was still `'none'` in `constants.js`.** The 5/19/26 v2 changelog claimed `'tenth'` was the new default for new tiles, but the factory in `TILE_INPUT_DEFAULTS.CCP()` still defaulted to `'none'`. Fixed to `'tenth'` — new CCP tiles now boot with Nearest 1/10 wk rounding active.
- **HYDRATION FIX: New CCP period fields backfilled in `TILE_ROW_DEFAULTS.CCP_PERIOD()`.** Saved CCP tiles created before the recent refactors were loading with `undefined` for `rateMode`, `reimbErUnknown`, `reimbErScope`, `reimbErRangeStart`, `reimbErRangeEnd`. The hydration factory now supplies defaults for all of these so reloaded older workspaces don't surprise the attorney with NaN math or `undefined` toggle states. Also added `doiAutofilled: false` to the tile-level CCP defaults.

**Files**: `js/workspace/tiles.js`, `js/workspace/constants.js`, `changelog.md`.

---

## 2026-05-19 (later same day, sixth pass)

### Workspace — CCP/Award Builder: NCLT & NME forced to $0

The NCLT (No Compensable Lost Time) and NME (No Medical Evidence) designation pills are now true $0-comp designations by definition. Previously both still rendered a Manual Rate input where the attorney could type a dollar amount — that input is gone for both.

- **Rate is forced to $0** for NCLT and NME periods. Weeks are still computed from the date range, but the period contributes $0 to the total award.
- **Manual Rate input is hidden** for both designations. The period UI still shows the dates, designation pills, REIMB ER toggles, and Amending Award toggle as usual.
- **Flows through to all surfaces**: the in-tile results panel, the bottom equation card, the Periods summary copy, and the OC-400.1 fee-app prefill (via `window.buildEquation`) all treat NCLT/NME periods as $0.

Backward-compatible: existing saved CCP tiles with a non-zero `manualRate` on an NCLT/NME period will now ignore that stale value and use $0. The `manualRate` field itself is retained on the period schema (still used by TR/TP when in $ mode), it's just no longer read for NCLT/NME.

**Files**: `js/workspace/tiles.js`, `changelog.md`.

---

## 2026-05-19 (later same day, fifth pass)

### Workspace — CCP/Award Builder REIMB ER v5: claim/cap/actual model

Correction to the v4 math. The user-entered $ amount is now interpreted as the employer's CLAIM, not the actual reimbursement. The actual amount flowing into the employer bucket is capped at the gross awards directed by the WCB within the claim's scope, less anything already claimed by prior REIMB ER entries against the same overlapping periods.

- **Per-period award capacity tracking.** Each period starts with `remainingForReimb = period.amount`. REIMB ER claims are processed in carrier order (the period they live on); each claim's available cap is the sum across its overlapping periods of `min(this-claim's overlap amount in that period, period.remainingForReimb)`. After capping, the actual contribution is deducted proportionally from each contributing period's remaining capacity so subsequent claims see the reduced pool.
- **All three scopes get the cap.** `period` → capped at that period's award; `all` → capped at the sum of every non-HIA period's award; `specific` → capped at sum of overlap-amounts across overlapping periods. HIA periods always contribute $0.
- **Inline "Capped at $X (claimed $Y)" banner.** Whenever the user's typed claim exceeds the available cap, an amber banner appears below the amount input on the carrier period explaining the reduction.
- **"Max recoupable" hint now reflects the dynamic cap** (after prior REIMB ER deductions on overlapping periods), shown for all three scopes.
- **Equation card / OC-400.1 prefill mirrors the same math.** When capped, a brief `(claim $Y capped at available)` annotation is appended to the equation line. The dollar amount shown in the line is always the post-cap actual, never the claim.
- **Example.** Two periods totaling $22,000 in awards, REIMB ER on Period 2 with scope = Specific range covering both periods and a claim of $40,000 → employer bucket = $22,000, attorney fee on employer reimb = $3,300, net to employer = $18,700. The banner reads "Capped at $22,000 (claimed $40,000)."

**Files**: `js/workspace/tiles.js`, `js/workspace/workspace.css`, `changelog.md`.

---

## 2026-05-19 (later same day, fourth pass)

### Workspace — CCP/Award Builder REIMB ER v4: RE ER period tags, user-entered amount on specific range, terse equation prose

Three refinements to how scope=Specific date range works in the REIMB ER block:

- **'RE ER' tags on every overlapped period.** When a period has REIMB ER enabled with scope = Specific date range, every CCP period in the same tile whose dates fall inside (or partially inside) the reimbursement window is now tagged with a small **RE ER** badge — both in the per-period footer (next to the period's award amount) and in the Periods summary copy (next to the desg/rate run). The carrier period (where the toggle lives) gets the same tag for uniformity.
- **User-entered amount on specific range.** Previously the dollar amount was auto-calculated and the input was hidden when scope=Specific. Now the $ amount input is shown for **any Known** scope — including specific range. Above the input on specific range, a **'Max recoupable: $X across N period(s)'** hint shows the auto-calculated maximum (Σ overlap weeks × rate across the overlapped periods); the attorney's typed number is what actually flows into the employer bucket math. This matches Joel's framing: "the auto-calculated amount is what can be recouped from that specific period, but the total reimbursement amount will extend across all periods that the reimbursement period encompasses."
- **Terse equation prose for specific range.** The verbose `REIMB ER (specific 1/1/2025 to 6/30/2025): $X → employer bucket` line is gone. The equation card / OC-400.1 prefill now reads **`REIMB ER applies for N periods, total $X`** (or `..., amount TBD` when Unknown). Per-period attribution is handled visually by the RE ER tags in the tile UI rather than restated in the equation prose.

**Files**: `js/workspace/tiles.js`, `js/workspace/workspace.css`, `changelog.md`.

---

## 2026-05-19 (later same day, third pass)

### Workspace — CCP/Award Builder REIMB ER v3: scope toggle, range auto-calc, terse Unknown prose, CCP-only continuation box

Three refinements to the employer-reimbursement experience that landed earlier today:

- **Known / Unknown amount is now a two-state segmented toggle** (Known Amount / Unknown Amount) inside the REIMB ER block — replaces the single Unknown pill so the attorney explicitly picks which mode they're in.
- **New three-state scope toggle** below it: **Just this period · Across all periods · Specific date range.**
  - **Across all periods** is exclusive — clicking it on one period auto-reverts every other period's scope back to "Just this period" so the case-level total has exactly one carrier.
  - **Specific date range** reveals start/end date inputs. The reimbursement amount is **auto-calculated** as Σ(overlap weeks × that period's rate) across every CCP period whose dates overlap the window (HIA periods contribute $0). The computed amount is shown inline as a preview.
  - The two toggles compose: a period can be both "across all periods" + "Unknown Amount" to represent a case-wide reimbursement owed in a TBD amount.
- **Unknown-amount prose is now terse.** The long "fee from that bucket will be calculated once the amount is entered" sentence is gone from both the equation card and the OC-400.1 plain-text prefill. All Unknown-amount surfaces now just say **"amount of Reimbursement TBD"** (period summary copy: `REIMB ER TBD`; equation mono: `Reimb to ER: TBD`).
- **FeeReason1 (continuation box) is now triggered ONLY when CCP Amount > 0.** Future-dated/ongoing award periods and Employer Reimbursement alone never auto-check the continuation box on the OC-400.1. FeeReason2 (back-due award) is unchanged.

**Files**: `js/workspace/tiles.js`, `js/workspace/workspace.css`, `changelog.md`.

---

## 2026-05-19 (later same day)

### Workspace — CCP/Award Builder v2: HIA, employer-reimb bucket, DOI auto-fill, default rounding, intervening-period insert

Five-part CCP overhaul, all in the CCP / Award Builder tile:

- **HIA designation pill** (Held in Abeyance) — added alongside TT/RE/TR/TP/NCLT/NME. An HIA period documents a start–end range for the record but contributes $0 to the total award. Equation card, period summary, and OC-400.1 prefill all surface the date range with the HIA label and no dollar amount.
- **REIMB ER refactor — separate employer bucket, separate 15% fee, "Unknown Amount" toggle.**
  - Reimbursements no longer reduce the total award. They now feed a separate "Moving to Employer (reimb)" bucket.
  - Attorney fee is taken at 15% **from each bucket independently** — the results panel and equation card now show **"Fee from Claimant"** and **"Fee from Employer Reimb"** as two distinct lines.
  - New **Unknown Amount** toggle inside the REIMB ER block: when on, no $ math runs for that period — equation flags **"REIMB ER — TBD"** until the amount is filled in.
  - Both the in-tile results panel and `buildEquation('CCP')` (bottom equation card + OC-400.1 prefill) mirror this split.
- **DOI auto-fill to first period start** — one-shot per CCP tile. The first time `global.doi` transitions from empty → set while a CCP tile is open (and period[0].start is empty), period[0].start is auto-set to the DOI. Won't overwrite a date the attorney already typed; won't re-fire on subsequent DOI changes.
- **Round Weeks default → Nearest 1/10 wk (round down)** — was 'none'. Attorney can still toggle off or to 'whole'. Only affects newly created CCP tiles; existing saved tiles keep their saved value.
- **Intervening "+ Add Period" buttons** — between every adjacent pair of periods, a small dashed-pill `+ Add Period` button appears centered on a divider line. Click inserts a fresh period at that position with start = previous period's end, end = next period's start, so the gap is pre-filled. Bottom "+ Add Period" button is unchanged.

**Files**: `js/workspace/tiles.js`, `js/workspace/workspace.css`, `changelog.md`.

---

## 2026-05-19

### Workspace — TR/TP $/% rate toggle + in-tile OC-400.1 button

Two UX improvements across the Pro Attorney Workspace so common fee-app workflows lose a scroll and lose a math step.

- **CCP / Award Builder — TR & TP rate input mode toggle.** Both TR and TP designations now expose a per-period `$ / %` pill toggle above the rate input (mirrors the MSA $/% pattern in the Settlement tile). Default mode for both is `%`.
  - **TR — %**: existing behavior — `pct × ⅔ × AWW`, then min/max bounded.
  - **TR — $**: attorney types the actual weekly rate directly; bounds still applied.
  - **TP — %**: `pct × bounded TT rate` (simpler mental model than TR — "50% TP" = half the TT rate).
  - **TP — $**: legacy behavior — direct manual weekly rate.
  - NCLT/NME unchanged (still $-only via Manual Rate).
  - Mirrored in `buildEquation('CCP')` so the equation card, OC-400.1 prefill, and tile results all agree.
- **In-tile "Generate OC-400.1" button.** Previously the only way to fire the fee app was scrolling to the bottom equation card. Button now appears in-context on every fee-generating tile:
  - **CCP / Award Builder** — directly under the **Copy** button in the Periods summary, right where the attorney just finalized the calc.
  - **SLU**, **LWEC**, **Section 32 Settlement** — inside the Results panel, immediately below the "Net to Claimant" row.
  - `onFeeApp` is now plumbed Canvas → Tile → tile component so each tile can trigger the same prefilled OC-400.1 flow without scrolling.

**Files**: `js/workspace/tiles.js`, `js/workspace/app.js`, `js/workspace/workspace.css`.

---

## 2026-05-18 (later same day)

### Universal contact rollout — phone (786) 815-4612 + email contact@thecompdesk.com

Site-wide contact channel rollout so every public surface answers "how do I reach you?" with the same number/email and framing.

- **New universal footer block** (`/js/footer-contact.js`) — self-bootstrapping, auto-injects a Contact section ("Questions? Call, text, or email us." + tel/sms/mailto links + UPL disclaimer) into every page's `<footer>`. Idempotent. Suppressed via `<body data-no-contact-footer="true">` on pages that handle contact themselves.
  - Injected into 39 HTML pages across `/`, `/calculators/*`, `/tools/*`, `/learn/*`, `/dashboard/*`, `/for-attorneys*`, `/extension`, `/connect-with-attorney`, `/subscribe`, `/coming-soon`, `/credits/success`, `/hire-attorney`, `/attorneys`, `/settlement-calculator`, `/workspace*`.
  - **Flagged & skipped** (no contact block): `/auth.html`, `/auth_v2.html` (modal-style sign-in), `/legal/privacy.html`, `/legal/terms.html`, `/extension-privacy.html` (formal legal docs).
- **New `/contact.html`** — clean brand-aligned page: three contact-method cards (phone / text / email), business hours (Mon–Fri 9 AM – 6 PM ET, marked TBD per Ops), "what we can help with" list, prominent UPL disclaimer, ContactPage + ContactPoint JSON-LD.
- **Nav** — Contact link added to both authenticated and public nav variants in `js/nav.js`.
- **For-attorneys page** — inline "Talk to us" block added immediately after the pricing tier grid ("Have questions about the Pro or Firm tier? Call, text, or email.").
- **Injured-worker surfaces** — UPL disclaimer banners added prominently after the hero on `index.html` and `hire-attorney.html` (highest-confusion-risk surfaces).
- **Referral form confirmation** (`connect-with-attorney.html`) — added a follow-up contact card on the post-submit thank-you screen so leads have a channel back to us.
- **404 page** (`404.html`, new) — friendly WC-themed copy ("This page took an unscheduled hearing."), three nav CTAs, and a contact card. `noindex`.
- **Schema.org markup** — added an `Organization` + `ContactPoint` JSON-LD block to `index.html` so Google can surface the phone/email in search results.
- **Sitemap** — `/contact.html` added (priority 0.8, monthly).
- **UPL disclaimer wording** (used everywhere): *"The Comp Desk is a software platform, not a law firm. Contacting us does not create an attorney-client relationship with any attorney."*

---

## 2026-05-18

### Launch + iteration: Medical Treatment Guidelines (MTG) tool (commits `a3e6c5e` → `1de9ade`, 11 commits same day)

Brand-new tool surface — `/tools/medical-treatment-guidelines` — that makes the **2021 NYS WCB Medical Treatment Guidelines** searchable from both the marketing site and the Pro Attorney Workspace. Single-session arc: launch → backfill all 16 guidelines → smart search → 3D anatomy upgrade with click-to-filter → polished overlay UX. End-state shipped on commit `1de9ade`.

---

**New page**: `/tools/medical-treatment-guidelines` (`tools/medical-treatment-guidelines.html`). Three search surfaces feed one ranked results panel:
1. **Keyword** input — abbreviation-expanded, smart query parser (see below).
2. **Filters** — guideline / section-letter / specific-section dropdowns.
3. **3D Anatomy** — interactive skeleton, hover-highlight by body region, click to filter results to that region.

**Data layer** (`/data/mtg/`):
- 16 guideline JSONs (`shoulder`, `low-back`, `knee`, `neck`, `elbow`, `hand-wrist-forearm`, `hip-groin`, `ankle-foot`, `crps`, `non-acute-pain`, `tbi`, `ptsd`, `depression`, `asthma`, `eye-disorders`, `lung-disease`), ~642 sections total, each with `id` / `title` / `body_text` / `page` / `citation`.
- `_summary.json` catalog (loaded once at startup so adding new guidelines requires zero frontend code change).
- `abbreviations.json` — ~45 WC medical abbreviations (PT, OT, MRI, EMG, NCS, ROM, IME, SLU, LWEC, NSAID, ESI, TENS, RFA, ACL/PCL/MCL/LCL, CRPS, TBI, PTSD, RCR, MUA, FCE, DOA, MMI, PPD/PTD/TTD/TPD, CTS, MCP/PIP/DIP, AC/SC, SLAP, WCB, SIJ, TMJ, ESWT). Loaded once; "PT" → matches sections containing "physical therapy".
- `pdfs/{slug}.pdf` (~47 MB total, 16 PDFs) — source documents linked from the section overlay via `#page=N` anchors.
- Ingest script lives at `tools/mtg/ingest.py` in the app-monorepo, depends on `pymupdf`. Section-letter-agnostic parser (some MTGs use Section C for diagnoses, others use D); TOC entries are filtered out by alpha-char density rather than the brittle dot-leader heuristic so genuinely short body sections like Knee D.2 "Not Recommended" survive.

**Smart query parser** (`mtg-tool.js` + `tiles.js`, kept in sync):
- Splits a query into three orthogonal axes: **section refs** (`C.2.a` canonical, `D6` bare, `C2a` bare-with-sub), **guideline hints** (matched against each guideline's name + slug, e.g. "low back" → Mid and Low Back Injury), **free-text** (everything else, abbreviation-expanded).
- **Strict guideline filter** — when a hint matches, results are limited to that guideline; e.g. `low back rotator cuff` returns zero hits rather than leaking Shoulder results.
- **Scored ranking**: exact section.id match +1000, parent-of-sub-ref match +800, sub-ref in body_text +400, guideline-hint match +200, free-text token in title +50/ea, free-text density in body +8/occurrence (cap 80). Stable secondary sort by section ID.
- **Excerpt anchoring + highlight**: when the query has a section ref, the result-card excerpt is pulled from around that mention (not the start of the parent body), and clicking to expand the locked overlay auto-scrolls to a yellow `<mark>` wrapped around the matched text via `scrollIntoView({block: 'center'})`.
- Example queries that just work: `low back C.2.a` · `low back C2a` · `shoulder D6` · `knee C.4 ACL` · `PT shoulder` · `CRPS`.

**Section overlay (hover-peek / click-lock)**:
- **Peek** — small translucent (rgba(17,24,39,0.82) + backdrop blur) tooltip anchored to the RIGHT of the hovered result card, line-clamped body with fade mask, `pointer-events: none` so mouseleave on the underlying card cleanly dismisses. Falls back to left-of-card or below-card if the screen edge is in the way.
- **Locked** — moderately larger side panel docked to the right edge of the viewport (480px × 90vh, 5vh top offset). Solid background, dedicated 32×32 X close button (with hover→red), full body scrollable, citation + "View source PDF →" button. Esc, backdrop click, and X all close. Bottom-sheet layout on narrow viewports (<720px).
- **Workspace clipping fix** — the workspace canvas applies CSS `transform` for tile dragging, which creates a "containing block" for `position: fixed` descendants. That's why the original overlay was getting clipped + the close button cut off inside the workspace tile. Solved with `ReactDOM.createPortal(overlay, document.body)` so the overlay escapes the transformed ancestor entirely.

**3D Anatomy picker (iteration trail):**
1. **Procedural Three.js figure first** (commit `a3e6c5e` — initial launch) — ~30 meshes from primitive geometries, hover/click worked but Joel didn't like the geometric aesthetic.
2. **Sketchfab Z-Anatomy iframe** (commit `a2e221c`) — embedded Myology via Sketchfab Viewer API. Pretty, but the API can't deliver hover-highlight on free CC models (PRO-only feature on the model owner's side), and click handling depended on model internals we didn't control.
3. **Three.js + downloadable GLB** (commit `240e6cb`) — switched to **AnatomyTOOL Open3DModel "Skeleton"** (`CC BY-SA 4.0`, 3.4 MB, 144 individually-named anatomical bone meshes). Source files at `https://anatomytool.org/open3dmodel`, attribution credit line below the canvas + `data/mtg/anatomy/ATTRIBUTION.md` committed alongside the GLB.
4. **ESM import map** (commit `7f525f8`) — initial UMD `GLTFLoader.js` from `three@0.147/examples/js/` was unreliable; switched to the modern import-map pattern (`three@0.160.0` ESM) with the module exposing `window.MTGAnatomy3D` via a Promise so the classic-script `mtg-tool.js` can `await` readiness.
5. **DRACOLoader added** (commit `80fa26c`) — the AnatomyTOOL GLB declares `KHR_draco_mesh_compression` in `extensionsRequired` (the reason 144 meshes fit in 3.4 MB). `GLTFLoader` errored "No DRACOLoader instance provided" until I wired one up pointing at `three@0.160.0/examples/jsm/libs/draco/`.
6. **Half-skeleton mirror fix + permissive finger/toe regex** (commit `af66f98`) — the AnatomyTOOL model ships as a half-skeleton (midline bones + right-side bones; the viewer mirrors the right side at render-time). My first mirror code did `clone.scale.x = -1` per mesh, which flips the GEOMETRY around the mesh's local origin but doesn't move its POSITION — so clones ended up overlapping the originals on the right side. Fix: clone the whole `Bones_right` + `Cartilages_right` subtrees with hierarchy intact, wrap them in a parent `THREE.Group` with `scale.x = -1`, add that group as a child of `originalGroup`. Negative-X scale on the parent mirrors all descendant positions AND geometries through the origin in one shot. `material.side = THREE.DoubleSide` on left-side material handles the inverted normal winding. Separately, the finger/toe regex was tightened to `/^.*phalanx of \w+ finger(?! of foot)/i` — `\w+` covers all ordinal variants the model uses (`1st`, `2d`, `3d`, `3rd`, `4th`, `5th`) that the previous narrow regex was missing. Verified: 144/144 meshes now have a `regionId`.
7. **Clickable bones drive the query** — hovering a bone shows a "Left knee" / "Upper back" capsule label top-left of the canvas; clicking sets `state.selectedRegions = [regionId]` (strict filter chip), and the results panel re-renders with sections from that body region's guideline(s).

**Surfaces touched**:
- **Marketing site** (`thecompdesk-site` repo, this changelog covers): `tools/medical-treatment-guidelines.html` (new page), `tools/js/mtg-tool.js` (vanilla DOM, query parser + overlay), `tools/js/mtg-anatomy.js` (ES module — Three.js scene), `data/mtg/*` (16 JSONs + abbreviations + summary + ATTRIBUTION + 16 PDFs + skeleton.glb), `js/workspace/tiles.js` (workspace MTG tile — React/JSX, same parser + overlay via `ReactDOM.createPortal`), `js/workspace/app.js` (palette + Tile component map), `index.html` (home-grid feat-card between IME Reminders and Learn Your Rights), `for-attorneys.html` (calc-grid card between Spine & Brain and "See All"), `js/nav.js` (Tools dropdown in both `renderNav` and `renderPublicNav`).
- **App bundle** (separate, in app-monorepo at `www/`): MTG tab + procedural Three.js figure was added earlier; per Joel's call, the app keeps the procedural figure (battery/perf), the marketing site gets the GLB-based skeleton.

**Preserve audit (all still intact on live URLs)**: AASA header in `vercel.json`, www→apex via Vercel dashboard config (not via `vercel.json` — preserved per the Apr 28 redirect-loop postmortem), Vercel Web Analytics on every public HTML page, PostHog import + global date-input guard in `nav.js`, `/learn/` nav links, every existing `application/ld+json` block.

**Post-deploy smoke (all 200, no redirect loops, ≤2 hops)**:
- `/tools/medical-treatment-guidelines` → 200
- `/data/mtg/_summary.json` → 200 (3.8 KB, 16 guidelines listed)
- `/data/mtg/anatomy/skeleton.glb` → 200 (3.4 MB)
- `/data/mtg/pdfs/shoulder.pdf` → 200 (634 KB)
- `/workspace/` (MTG tile loads same JSON) → 200
- `/` and `/for-attorneys` (control URLs, new feat-cards rendering) → 200

**Final Vercel deploy**: `dpl_DCx9UMGDcjYXgvuVUtnCNBczb9gb` — READY, target=production, SHA=`1de9ade9c060a0219517626a192274c5ffef4614`. (Intermediate deploys: `a3e6c5e`, `eed2e1a`, `6a37ebd`, `a2e221c`, `240e6cb`, `7f525f8`, `841f12c`, `80fa26c`, `af66f98`, `ebfd057`, `1de9ade`.)

**Sitemap updated**: `sitemap.md` adds the new page under a new "Tools" section (this commit pairs with that update — see the file).

**Open follow-ups (non-blocking)**:
- **TBI and Depression came in light on Section C/D detection** — their PDF structure puts the clinical content under a different section letter than the other MTGs. Followup ingest tuning will add per-PDF detection overrides at `tools/mtg/ingest.py`. Until then, those two guidelines surface ~30 sections each instead of the 50-ish other guidelines have.
- **Chart rendering in the overlay** — I attempted full-page PNG rendering during ingest but the output was ~350 MB of static assets (Hip/Groin alone is 949 pages). Pivoted to shipping the source PDFs + a "View source PDF" link with `#page=N` anchor. A future v2 could layer in *selective* chart-page rendering (only pages with >X drawings or with embedded images larger than the standard header logo) — would land somewhere around 10-20 MB if the detector is tight enough.
- **SEO keyword tracking should add**: "NYS workers comp medical treatment guidelines", "WCB MTG search", "Shoulder MTG D.6 rotator cuff", "Mid and Low Back MTG epidural injection", "WC anatomy picker". Not blocking — sweep into next weekly SEO check.

**iCloud resync**: all 7 edited/added files mirrored into `ops/website/` so local edits start from the deployed state (Secretary's standing playbook: clone fresh / apply edits on the repo / resync iCloud at the end).

---

## 2026-05-10

### Launch: `/extension` landing page + "Apps" nav + "Get The Comp Desk Everywhere" rollout (commit `9d05874`)

End-to-end multi-platform rollout. The Comp Desk now has a dedicated landing page and consistent cross-promotion across the site for its three delivery surfaces: iOS app (live), Chrome extension (CWS-in-review, waitlist live), and the public web workspace.

**New page**: `/extension` (`extension.html`). Brand-matched dark-attorney aesthetic. Sections: hero, three-platform grid (iOS / Chrome / Web), four-card "one engine, three contexts" why-row, three-step extension-preview, six-question FAQ, bottom CTA. Includes `SoftwareApplication` JSON-LD, OG/Twitter meta, apex canonical, and a Chrome waitlist form wired through `CompBuddyESP` (`data-capture="extension"`).

**Nav**: "Apps" link added between Tools and Pricing on `index.html`, between Workspace and Compare Plans on `for-attorneys.html`, and in both `renderNav` (dashboard) and `renderPublicNav` (calculators-index) inside `js/nav.js`. Mobile-visibility CSS exception on `index.html` updated so the new link survives <600px: `nav .links a:not(.cta-btn):not([href="/calculators/"]):not([href="/extension"]){display:none;}`.

**`/for-attorneys`**: "Get The Comp Desk everywhere you work." card row inserted before the bottom CTA banner. Three cards — iOS App Store badge, Chrome waitlist form, Web Workspace CTA. Anchor at `#apps` for direct linking.

**`/`**: `#download` section rebuilt as "Available everywhere you work." three-card row (iOS / Chrome waitlist / Web). Replaces the old "Get Comp Buddy / Google Play Coming Soon / Desktop Coming Soon" block. **Injured-worker hero left untouched** per the sacred-hero rule.

**Email-capture infrastructure**: `js/esp-adapter.js` `VALID_SOURCES` set extended with `'extension'` so both Chrome waitlist forms (the one on `/extension` and the one on `/for-attorneys`) post through the existing stub adapter → `/api/subscribe` pipeline. When an ESP is wired in the future, the extension form will pick it up automatically with no further code changes.

**`sitemap.xml`**: `/extension` added at priority 0.85, weekly changefreq. `/extension-privacy.html` was already in the sitemap from the May 8 SEO sweep.

**Correction to yesterday's working brief**: `/extension-privacy` was **not** 404 — verified live via Chrome MCP serving 200 OK with correct `<h1>`, canonical, and content. The file shipped May 7 (commit `9bf787a`, "Add extension-privacy.html for Chrome Web Store submission") and was already covered in the May 8 SEO sweep. CWS submission was not blocked by an infrastructure issue. The actual remaining gap was the `/extension` landing page itself, which this commit ships.

**Preserve audit (all still intact on live URLs)**: AASA header in `vercel.json`, www→apex via Vercel dashboard config (not via `vercel.json` — preserved per the Apr 28 redirect-loop postmortem), Vercel Web Analytics on every public HTML page, PostHog import + global date-input guard in `nav.js`, `/learn/` links in nav.js, every existing `application/ld+json` block on every page, and the injured-worker hero on `index.html` ("Injured at work? You're not alone.").

**Post-deploy redirect smoke (all 200, no loops, ≤1 hop):**
- `/` → 200 (control)
- `/extension` → 200 ✓ new
- `/extension-privacy` → 200 ✓ CWS target
- `/for-attorneys` → 200 ✓ edited
- `/calculators/` → 200 (control)
- `/workspace/` → 200 (control)
- `/extension.html → /extension` → 200 ✓ clean-URL routing intact

**Vercel deploy**: `dpl_5i6yZpyB3bqtnvrwxTJmv2X4pf41` — READY, target=production, SHA=`9d05874d8f9d298a9fc4179096328935b84a7054`.

**Open follow-ups (non-blocking)**:
- `sitemap.md` updated to reflect `/extension` (this commit pairs with that update — see the file).
- Swap the Chrome "Coming Soon" placeholder + waitlist form for the live Chrome Web Store URL once CWS approves the listing. Both surfaces (the `/extension` page and the `/for-attorneys` card) use the same `data-capture="extension"` hook, so the swap is two HTML edits + a possible push to convert the captured emails into a launch-day blast.
- SEO keyword tracking should add: "comp desk chrome extension", "workers comp chrome extension", "NYS workers comp browser tool". Not blocking — sweep into next weekly SEO check.
- Consider an OG image specifically for `/extension` (currently reuses `og-home.png`). Cosmetic only; ranks fine either way.

---

## 2026-05-08

### Site-wide SEO sweep (full pass on every public page)
Comprehensive SEO audit + fix pass triggered by Joel's "ensure relevant parts of the website have are SEO'd" directive. Audit produced `seo/seo_audit_2026-05-08.md` covering 33 public + private pages. Fixes pushed in this commit:

- **Canonical mismatch (CRITICAL)**: `index.html`, `for-attorneys.html`, `attorneys.html`, and `extension-privacy.html` declared canonical + og:url with the `www.` subdomain while the entire rest of the site (sitemap, served domain) uses bare apex. This was splitting link-equity on the homepage. All four converted to `https://thecompdesk.com` (no www). Six occurrences on the homepage alone.
- **`og:site_name` site-wide**: zero pages had it before. Inserted on 33 files via perl across all public + auth pages. Single canonical `<meta property="og:site_name" content="The Comp Desk">` after every existing `og:type` tag.
- **`/attorneys.html` regression repaired**: was missing `og:url`, `og:image`, and the entire `twitter:*` set since some prior edit. Added back, plus upgraded JSON-LD from minimal `WebPage` to `SoftwareApplication` with both Free and $9.99/mo Pro Offers and Organization publisher.
- **Tools pages — thin titles + missing JSON-LD** rewritten: `tools/claim-filing.html`, `tools/mileage.html`, `tools/utdm.html`, `tools/work-search.html` all had ASCII-hyphen, ~30-char "X - The Comp Desk" titles and ~100-char descriptions. Now have keyword-targeted ~60-char titles, ~155-char descriptions, and `WebApplication` JSON-LD with free Offer + Organization publisher. `tools/learning/index.html` got `CollectionPage` JSON-LD.
- **`/tools/utdm.html` title clarity**: opaque "UTDM Monitoring" replaced with "Trial De Novo Motion Tracker (UTDM) — NY Workers' Comp" to spell out what the tool does for first-time visitors.
- **Noindex meta added** to `auth.html`, `auth_v2.html`, `dashboard/my-cases.html` (belt-and-suspenders alongside `robots.txt` Disallow).
- **`calculators/spine-brain.html` retired**: officially retired 2026-04-12 but the file was still indexable and (briefly) in sitemap. Added `<meta name="robots" content="noindex, nofollow">`. Now also disallowed in `robots.txt`. Removed from sitemap.xml.
- **Vercel redirects**: added 301s for `/privacy` → `/legal/privacy.html`, `/privacy.html` → `/legal/privacy.html`, `/terms` → `/legal/terms.html`. Fixes the broken `/privacy` footer link on the homepage and stops legacy `/privacy.html` requests from 404'ing.
- **`robots.txt` to canonical location**: file lived at `/seo/robots.txt`, served as `https://thecompdesk.com/seo/robots.txt` — Google couldn't find it at `/robots.txt`. Mirror written to repo root so it's served at the standard URL. Old `/seo/robots.txt` updated to match for parity.
- **`robots.txt` content**: refreshed last-updated date, added `Disallow: /Website/` (legacy duplicate path), `Disallow: /calculators/spine-brain` (retired).
- **`sitemap.xml` refresh**: removed stale `/privacy.html` entry (now 301'd via Vercel). Added `/hire-attorney.html`, `/legal/privacy.html`, `/legal/terms.html`, `/extension-privacy.html`. Bumped lastmod to 2026-05-08 across the board for files touched in this sweep.
- **Audit doc**: full per-page inventory written to `seo/seo_audit_2026-05-08.md` covering title, meta description, canonical, OG, Twitter Card, JSON-LD, robots meta, H1, image alt, internal links, and gap priority for every public page.

**Coverage moved from** (April 5 baseline → May 8 post-sweep):
- Title: 100% → 100%
- Meta description: 82% → 100%
- Canonical (apex, correct): 53% → 100%
- OG core: 53% → 100%
- `og:site_name`: 0% → 100%
- Twitter Card: 0% → 100%
- JSON-LD: 6% → ~100% on public pages (5 tool pages were the gap; now closed)
- Robots meta on private: 0% → 100% (auth, auth_v2, my-cases now carry noindex)

**Strategic decisions still pending Joel**: `/attorneys.html` vs `/for-attorneys.html` consolidation, `/connect-with-attorney.html` vs `/hire-attorney.html` consolidation, `/learn.html` vs `/tools/learning/index.html` consolidation, `/tools/find-doctor.html` indexable-or-gated decision (currently in `robots.txt` Disallow but built as a public landing), AI-crawler policy (currently full block on GPTBot/ChatGPT-User/CCBot/Google-Extended/anthropic-ai). Captured in the audit doc for follow-up.

### Fix: injured-worker intake wizard not submitting (commit `896ec47`, edge fn v3.3)
- **Symptom**: Step 3 of `/connect-with-attorney` returned `"injuries must be 5-1000 chars"` and blocked submission even with full form data.
- **Root cause**: The `submit-attorney-lead` edge function expected an `injuries` string field, but the web client (since the body-diagram refactor on 2026-05-06) sends `body_parts` (array) + `body_parts_other` (string) and no `injuries` field. Server saw empty `injuries`, failed the `< 5 chars` check, returned `VALIDATION_FAILED`.
- **Fixes** (paired client + server):
  - **Edge function v3.3**: Removed the 5–1000 char limit on `injuries` per directive. Server now derives `injuries` from `body_parts` + `body_parts_other` when the field isn't sent. Validation only requires that something be present (single body part fine).
  - **`connect-with-attorney.html`**: Client now composes `injuries` from selected body regions + freeform "Other body part" text and sends it in the payload. Removed `maxlength="200"` cap on the "Other body part" input. Removed the `.slice(0, 10)` cap on freeform parts. No character ceiling on injuries anywhere in the flow now.
- **Impact**: Wizard submissions that select at least one body region (or type one in the freeform field) now succeed end-to-end. iOS path unchanged but covered by the same server-side derivation when it ships.

---

## 2026-05-07

### Homepage reorientation: injured-worker first (commit `dcbdb40`)
- **Strategic shift**: Home page (`index.html`) is now exclusively a **Comp Buddy / injured-worker** experience. All Pro/Firm attorney content moved off the home page to keep the worker journey clean.
- **Hero** retained ("Injured at work? You're not alone.") but body copy rewritten to lead with Comp Buddy: find a doctor, never miss an IME, understand your rights, connect with an attorney.
- **CTAs**: "Find an Attorney" (green primary) + "Explore Free Tools" (outline). Removed "Explore Free Calculators" as primary CTA (calculators still in features grid).
- **Stats row** rewritten — replaced calculator-count / guidelines technical stats with worker-facing stats: $0 always free, WCB-authorized provider search, 24/7 in your pocket, NY-focused.
- **Features grid** replaced — 6 cards: Find a WCB-Authorized Doctor, IME Reminders, Learn Your Rights, Find an Attorney, Free Benefit Calculators, Case Tracker. Case Tracker tagged "In Development" (the only feature not yet shipped).
- **Pricing section** completely replaced — single "Always Free" Comp Buddy card ($0, "for every injured worker in New York State") with feature checklist; Pro/Firm tier grid removed entirely. Case Tracker line carries "In Dev" sub-tag inside the pricing card too.
- **New "Are you a WC Attorney?" callout banner** added between pricing and About — gold-gradient card pointing attorneys to `/for-attorneys` and `/workspace/`. Keeps attorney funnel visible without crowding the worker journey.
- **About section** rewritten to make the Comp Buddy mission explicit: "we built Comp Buddy" framing, lists Find a Doctor, IME Reminders, learning portal, attorney network as the named pillars. Closes with "Know your comp. Fight for your rights."
- **Download section** reframed "Get Comp Buddy" instead of "Get The Comp Desk".
- **Nav** simplified for workers: Learn / Tools / Pricing / Find Attorney / For Attorneys / Sign In. Removed Calculators from nav (still discoverable via features grid + For Attorneys).

### For Attorneys page — full calculator showcase (commit `dcbdb40`)
- **New `<section class="calcs" id="calculators">`** added between hero and pain points on `for-attorneys.html`. 9-card grid: Pro Workspace (free), CCP & Award (free), AWW (free), SLU (Pro), LWEC (free), Statutory Rates (free), Radiculopathy (Pro), Spine & Brain (Pro), See All Calculators link.
- Every card is a clickable link to its calculator page, with a Free / Pro tier badge.
- **Nav updated**: Calculators anchor now points to `#calculators` (within-page anchor) instead of `/calculators/`. Added Home link as first nav item.

### Find an Attorney modal — Cloudflare Turnstile fix end-to-end (commit `a0f0224`)
- **Site key wired up** — replaced placeholder `0x4AAAAAABcKJ1234567890A` in `connect-with-attorney.html` with real Cloudflare Turnstile site key `0x4AAAAAADLKXPKaU6fJEY7f`. New Cloudflare Turnstile site provisioned in Joel's CF account (Jmays2294@gmail.com) for `thecompdesk.com` + `www.thecompdesk.com`, Managed challenge mode.
- **Verified end-to-end in browser**: widget renders inside the wizard step 3, issues a real validation token (`0.dYuHeo-...`), populates the hidden `cf-turnstile-response` input. Form is no longer blocked at submission.
- **Supabase secret set** — `TURNSTILE_SECRET_KEY` set on project `ltibymvlytodkemdeeox` via `supabase secrets set TURNSTILE_SECRET_KEY=… --project-ref ltibymvlytodkemdeeox`. The deployed `submit-attorney-lead` edge function (v9) reads this secret in `verifyTurnstile()` and now actually validates tokens against `https://challenges.cloudflare.com/turnstile/v0/siteverify` instead of failing open. Bot protection is now real.
- **Bonus error-handling improvements** that had been sitting uncommitted in working copy went live with this commit: `SOFT_FAIL_CODES` set (`NO_ATTORNEY_AVAILABLE`, `REFERRAL_CREATE_FAILED`, `ASSIGN_FAILED`, `ASSIGN_CHAIN_ERROR`) → render the soft-fail confirmation copy instead of an error; explicit `error_code` → user-facing copy mapping for `VALIDATION_FAILED`, `CAPTCHA_FAILED`, `MISSING_CAPTCHA`, `RATE_LIMIT_*`, `INSERT_FAILED`, fallthrough.

### Two commits, both auto-deployed by Vercel
- `dcbdb40` — Reorganize homepage for injured workers (Comp Buddy focus); move attorney/calculator content to For Attorneys
- `a0f0224` — Wire real Cloudflare Turnstile site key + improve attorney-lead error handling

### Open follow-ups (next session)
- **Sitemap.xml** unchanged — same URL set, but home page content is materially different. Consider a forced re-index of `/` and `/for-attorneys` via Search Console URL Inspection given the substantial content shift.
- **OG images** for `/` still reference the old calculator framing — refresh `/images/og-home.png` to a Comp Buddy-themed image when convenient.
- **Case Tracker** is the only "In Dev" feature surfaced on the home page — track in `comp_buddy_tracker.md`.

---

## 2026-04-19

### Sitemap patch (commit `43a01a9`)
- **Sitemap.xml** — added 4 URLs that had been pushed to prod but missed in earlier sitemap commits: `/for-attorneys.html`, `/learn/average-weekly-wage-ny-workers-comp.html`, `/learn/schedule-loss-of-use-ny-workers-comp.html`, `/learn/lwec-loss-wage-earning-capacity.html`. Sitemap grew from 24 URLs → 28. Updated date bumped to 2026-04-19.
- **Google Search Console** — sitemap **resubmitted by Joel** on Apr 19, 2026.
- **URL Inspection / Request Indexing** — all 4 newly added URLs submitted via Search Console URL Inspection on Apr 19, 2026. Each returned "Indexing requested" confirmation:
  - `/learn/average-weekly-wage-ny-workers-comp.html` — status: "URL is unknown to Google" (never crawled). Indexing requested.
  - `/learn/schedule-loss-of-use-ny-workers-comp.html` — status: "Page with redirect" flag (last crawl Apr 20, 2026 by Googlebot smartphone). Indexing requested. **⚠ Follow-up:** redirect flag likely caused by sitemap using `https://thecompdesk.com/...` (no www) while canonical is `www.thecompdesk.com`. Update sitemap to use www-prefixed URLs.
  - `/learn/lwec-loss-wage-earning-capacity.html` — status: "URL is unknown to Google". Indexing requested.
  - `/for-attorneys.html` — status: "Page with redirect" flag (last crawl Apr 21, 2026 by Googlebot smartphone). Indexing requested.

### Legal scaffolds (commit `43a01a9`)
- Created `/legal/terms.html` (8 sections: Service Description, Attorney Participation, Consumer Experience, Disclaimers, Arbitration, Refund Policy, Changes, Contact) and `/legal/privacy.html` (10 sections). Section headers only — content drafting window May 15–30, 2026. Both pages excluded from sitemap until drafted; Privacy scaffold has notice banner pointing to existing `/privacy.html`.

### Attorney Connect Program rename (commit `726052f`)
- Renamed signup-flow "Referral Program" → **Attorney Connect Program** in `auth.html` and `auth_v2.html`. CSS classes (`referral-box`→`connect-box`, `referral-toggle`→`connect-toggle`), JS state variable (`referral`→`connectProgram`), DOM id (`atty-referral`→`atty-connect-program`), all user-facing copy. Description rewritten: "Join our Attorney Connect network to receive leads from injured workers in your area looking for representation."
- DB payload key `referral_enrolled` retained for backwards compatibility — TODO comment added flagging Dev coordination needed for `profiles` column rename to `attorney_connect_enrolled`.
- Carve-out per Joel's decision: "no referral fees / no referral percentages" user-facing phrases on `connect-with-attorney.html`, `find-attorney-how-it-works.html`, and `coming-soon.html` are intentionally **kept** as trust signals (factually accurate, signals trustworthy model).
- Audit catalog at `audit_referral_language.md` updated with Joel's approvals.

### LinkedIn Post 3 (attorney-focused)
- Copy fix in `marketing/linkedin-post-3-attorney.md`: "seven free Workers' Compensation calculators" → **"six"**, dropped Spine & Brain from the calculator list (Spine & Brain was retired April 12 per commit `13fc8c0`). Post is publish-ready; Joel to publish manually on LinkedIn (no LinkedIn MCP connector available).

---

## 2026-04-17

### Phase C — Find a Doctor, IME Reminders & Learn Hub Articles
- **Find a Doctor SEO page** (`tools/find-doctor.html`) — launched publicly. Full landing page with hero, how-it-works, 13 body part/specialty reference, 6-question FAQ with FAQPage JSON-LD schema, WebApplication schema, app download CTAs.
- **IME Reminders SEO page** (`tools/ime-reminders.html`) — updated and promoted in sitemap. 6 feature cards, 3-step process, "What to Bring" checklist, 5-question FAQ, WebApplication schema with aggregate rating.
- **Learn article: "What to Expect at an IME"** (`learn/what-to-expect-ime.html`) — 9-minute comprehensive guide with Article JSON-LD schema. Covers IME process, preparation tips, rights, and links to IME Reminders tool.
- **Learn article: "How to Find a Workers' Comp Doctor in NY"** (`learn/find-workers-comp-doctor-ny.html`) — 8-minute guide with Article schema. Covers WC-authorized providers, search methods, red flags, and links to Find a Doctor tool.
- **Sitemap updated** — 3 new URLs added: `tools/find-doctor.html`, `learn/what-to-expect-ime.html`, `learn/find-workers-comp-doctor-ny.html`. Find a Doctor removed from excluded list. IME Reminders priority bumped to 0.6.
- **Google Search Console** — sitemap resubmitted Apr 17, 2026. Status: Success, 24 discovered pages.

### Coming Soon Page Refresh & Cross-Navigation (`coming-soon.html`)
- **Hero updated** — badge now reads "Now Available + More Coming 2026". Subtitle reflects that some features are live.
- **Feature cards** — Find a Doctor and IME Reminders cards now show green "Available Now" badges with "Try It Free →" links to `/tools/find-doctor.html` and `/tools/ime-reminders.html`. Cards have green border + gradient top accent. Remaining 6 features unchanged (phase labels intact).
- **Roadmap** — Phase C timeline item updated to green dot, "Phase C — Live Now ✓" label, with direct links to both live tools.
- **Comp Buddy CTA banners** added to all 4 Phase C pages: `tools/find-doctor.html`, `tools/ime-reminders.html`, `learn/what-to-expect-ime.html`, `learn/find-workers-comp-doctor-ny.html`. Each banner links back to `/coming-soon.html` with "Explore All Comp Buddy Features →" button. Consistent green/blue gradient design across all pages.

---

## 2026-04-12

### Homepage Redesign (`index.html`)
- **Hero section rewritten** — empathy-first messaging ("Injured at work? You're not alone.") replacing cold calculator pitch. Warmer gradient (blue → green → amber). Tagline "Know your comp. Fight for your rights." retained.
- **Hero animation** — replaced broken mascot Lottie loader with CSS logo fade-in + pulse animation using `comp-desk.png`.
- **Nav bar cleaned up** — removed duplicate Sign In / Login buttons. Single auth button: "Sign In" for logged-out, "My Account" for logged-in. Added "Find Attorney" link to `/connect-with-attorney.html`. Removed "Coming Soon" from nav (moved to footer).
- **About section expanded** — now reflects full Comp Buddy vision: Find a Doctor, IME reminders, learning portal, attorney connection. Mentions Comp Buddy by name.
- **Stats** — calculator count updated 6 → 5 (Spine & Brain retired).
- **Pro tier** — removed Spine & Brain from feature list, updated Radiculopathy description.

### Radiculopathy Calculator — Complete Rebuild (`calculators/radiculopathy.html`)
- **Rebuilt from scratch** using the actual 2012 NYS Impairment Guidelines point system.
- **Table S11.4** — seven scoring categories: Imaging (0/16), EMG (0/6), Muscle Weakness per S11.4(a) (0/6/18/20), Atrophy (0/6), Sensory per S11.4(b) (0/4/6), Reflexes (0/4/6), Tension/Compression Signs (0/4).
- **Tables S11.5 & S11.6** — nerve root caps enforced automatically per nerve root.
- **Tables S11.7(a) & S11.7(b)** — total points map to severity ranking letter (Cervical C–H, Lumbar D–J).
- **Output** — severity ranking letter for use with Table 11.1 or 11.2 to determine final impairment class.
- **Verified** against 2012 Guidelines by Joel Mays, Esq.

### Spine & Brain Calculator — Retired
- `calculators/spine-brain.html` deleted. Removed from index, homepage, Pro tier list, Pro Suite (`pro.html`), sitemap.
- Pro Suite (`calculators/pro.html`): Spine/Brain tab, panel HTML, JS module, and save handler all removed. Calculator count updated 7 → 6 in title, meta descriptions, OG/Twitter tags, and gate overlay. SCI/TBI feature bullet removed from gate feature list.
- Reason: SCI/TBI tables were not sourced from official Guidelines.

---

## [1.0.0] — Initial Launch (Pre-April 2026)

### Landing Page (`index.html`)
- **Deployed**: Pre-2026-04-01
- Hero section with value proposition for NYS workers' compensation tools
- Navigation bar linking to all major pages
- Feature highlights: SLU calculator, AWW calculator, LWEC calculator
- Call-to-action for sign-up / subscription
- Responsive design for mobile and desktop

### Authentication Page (`auth.html`)
- **Deployed**: Pre-2026-04-01
- Sign-in and sign-up forms
- Supabase authentication integration
- Email/password login flow
- Account creation with email verification

### Account Dashboard (`account.html`)
- **Deployed**: Pre-2026-04-01
- User profile management
- Subscription status display
- Access to Pro features when subscribed
- Session management via Supabase auth

### Find an Attorney (`connect-with-attorney.html`)
- **Deployed**: Pre-2026-04-01
- Attorney directory / search functionality
- Designed for injured workers seeking NYS WC representation
- Listing display with contact information

### Privacy Policy (`privacy.html`)
- **Deployed**: Pre-2026-04-01
- Full privacy policy covering data collection, usage, and retention
- Cookie policy disclosures
- Compliance with applicable regulations

### Subscription Pages (`subscription/`)
- **Deployed**: Pre-2026-04-01
- Subscription tier selection (Free / Pro)
- Stripe payment integration
- Plan comparison and feature breakdown
- Billing management

---

## [1.1.0] — Auth V2 (2026-03-31)

### Updated Authentication Page (`auth_v2.html`)
- **Created**: 2026-03-31
- **Deployment status**: ⚠️ Local only — confirm pushed to GitHub
- Complete redesign with DM Sans typography
- Dark theme UI (--bg: #06080f) matching site branding
- Tabbed sign-in / sign-up interface
- Supabase JS v2 SDK integration
- Improved form validation and error handling
- Responsive layout centered on viewport

---

## [1.3.0] — Free Calculator Architecture + Calculator Parity (2026-04-03)

### Free Calculator Architecture (12 files, 1,305 insertions)
- **Deployed**: 2026-04-03 (pushed to Vercel)
- Removed ALL paywall gates from calculators
- All 8 calculators now free (SLU, Spine/Brain, Radiculopathy, etc.)
- Paywall only at "Generate Fee App" (requires Pro $9.99/mo)
- "Save This Calculation" CTA (requires free account — incentive funnel)

### Calculator Parity (9 files, 1,469 insertions)
- **Deployed**: 2026-04-03 (pushed to Vercel)
- Web calculator UI now matches app's visual design language
- Consistent formatting, input styling, and result display

### 🐛 BUG: CCP/Award Calculator (`calculators/ccp-award.html`)
- **Reported**: 2026-04-03
- **Status**: 🟡 FIX IN PROGRESS (Website/Dev)
- **Issues found**:
  1. Missing date range inputs (start/end date for award period)
  2. No attorney fee calculation
  3. No net-to-claimant computation
  4. No full breakdown (gross award → fee → expenses → net)
- **Fix approach**: Mirror the app's CCP/Award formulas (award period dates, fee %, expense deductions, net calculation)
- **Priority**: HIGH — CCP/Award is one of the most-used calculators

---

## [2.0.0] — Phase B: Settlement Calculator SEO Landing + Learn Hub SEO Fix (2026-04-10)

### Settlement Calculator SEO Landing Page (`settlement-calculator.html`) — NEW
- **Deployed**: 2026-04-10 (Vercel deployment `dpl_DD4WPxcNwrftKrwLEc88URdBD6Dv` — READY)
- Full SEO-optimized landing page at `/settlement-calculator`
- Target keywords: "workers comp settlement calculator NY", "SLU calculator New York", "workers compensation settlement estimate"
- Interactive SLU estimator widget (body part selector, % loss, comp rate → instant estimate with attorney fee breakdown)
- SLU Award vs. Section 32 Settlement comparison section
- 4-question FAQ section with FAQPage structured data
- Dual JSON-LD schemas: WebApplication + FAQPage
- Full OG tags + Twitter Card tags + canonical URL
- Cross-links to /calculators/slu.html, /connect-with-attorney.html, /calculators/, and app download
- Uses marketing design system (navy/blue/green theme matching coming-soon.html)

### Learn Hub SEO Enhancement (`learn/index.html`) — UPDATED
- **Deployed**: 2026-04-10
- Added missing `og:image` meta tag
- Added Twitter Card tags: `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`
- Learn hub (12 articles, 4 categories, RSS feed) was already live from prior deploy

### Sitemap Update (`sitemap.xml`) — UPDATED
- **Deployed**: 2026-04-10
- Added `/settlement-calculator.html` entry (priority 0.9, changefreq monthly)

### Infrastructure: GitHub Push from Cowork
- Configured GitHub Personal Access Token for direct git push from Cowork sandbox
- Token + Vercel Team/Project IDs saved to project CLAUDE.md
- Future deploys no longer require manual intervention — Cowork can clone, commit, push, and Vercel auto-deploys

---

## [2.0.1] — Sitemap Fix + GSC Indexing Submissions (2026-04-11)

### Sitemap Fix (`sitemap.xml`) — UPDATED
- **Deployed**: 2026-04-11 (commit `e38a79d`, Vercel auto-deploy)
- Fixed incorrect `/subscription/` path → `/subscribe/` (was returning 404 to Googlebot)
- Merged comprehensive page list from both root and `/seo/sitemap.xml` into single authoritative root `sitemap.xml`
- Removed auth-gated pages that shouldn't be indexed (account.html, auth.html, auth_v2.html)
- Updated lastmod dates to 2026-04-11 for recently touched pages
- Final sitemap: 22 public URLs covering core pages, calculators, landing pages, and tools

### GSC URL Indexing Submissions
- **Submitted**: 2026-04-11 via URL Inspection tool
- `/` — already indexed, re-crawl requested
- `/connect-with-attorney.html` — already indexed, re-crawl requested
- `/subscribe/` — NOT on Google, indexing requested (new to priority crawl queue)
- `/auth.html` — NOT on Google, indexing requested
- `/privacy.html` — already indexed, re-crawl requested
- `/subscription/` — diagnosed as 404 (wrong path), corrected to `/subscribe/`

### GSC Sitemap Re-submission
- Re-submitted `sitemap.xml` in Google Search Console
- Status: Success, 22 discovered pages (cleaned from prior 51 which included stale/duplicate entries)

### Project CLAUDE.md — UPDATED
- Fixed `/subscription/` → `/subscribe/` in Pages live list

---

## [3.0.0] — Connect with Attorney Page Overhaul + Credits Model + Intake Wizard (2026-04-12)

### Rename: `hire-attorney.html` → `connect-with-attorney.html` — BREAKING
- **Deployed**: 2026-04-12 (3 commits to main, Vercel auto-deploy)
- Renamed from `hire-attorney.html` to `connect-with-attorney.html` — ethics compliance sweep flagged "Hire" as implying endorsement
- Old URL `/hire-attorney.html` deleted from repo (returns 404 — consider adding redirect)
- Updated all internal links across 28 files: settlement-calculator.html, learn.html, coming-soon.html, tools/settlement.html, tools/learning/index.html, calculators/benefit-rate.html, all 15 learn/ article CTAs, both XML sitemaps
- Canonical URL, OG tags, Twitter Cards all updated to new path

### New Page Title
- Changed from "Find a Workers' Comp Attorney" to "Connect with a Workers' Compensation Attorney — The Comp Desk"

### Injured Worker Section — Updated 3-Step Flow
- Step 1: "Tell Us About Your Case" — Submit county, injury type, case stage. No account needed.
- Step 2: "We Connect You" — Neutral, mechanical assignment. No recommendation or endorsement.
- Step 3: "The Attorney Contacts You" — 48-hour contact guarantee. Auto-rotate to next attorney if no response.

### Transparency Promise — Updated Cards
- "No Referral Fees" → "Flat Lead Fee Only" — Attorneys pay flat per-lead fee. No referral fees, no percentage, no kickbacks.
- "No Paid Placement" → Clarified: Assignment is by neutral round-robin rotation, not bidding or rankings.
- "Owner Excluded" → Fixed: Joel Mays is "an attorney at Shulman & Hill" (not "a partner at")
- Random Order, No Endorsements, No Tracking cards retained as-is

### Attorney Section — Credits-Based Lead Model (replaces $5.99/mo directory)
- Headline: "Join the Network — Pay Only for Leads You Accept"
- 4 pricing tiers: Single Lead ($99/1 credit), Starter ($249/3 credits, Most Popular), Standard ($449/5 credits), Volume ($799/10 credits)
- How-it-works explainer: purchase credits → get notified → accept lead (1 credit deducted) or decline (no credit used, auto-rotates after 48h)
- CTA: "Apply to Join" (mailto: joel@thecompdesk.com)

### FAQ Section — Rewritten
- Rewrote "How much does it cost" answer for credits model (removed all $5.99/mo references)
- Added new FAQ: "What if I accept a lead but can't reach the worker?" → 3 attempts over 5 business days = full credit refund
- Updated all FAQs to reference "network" instead of "directory" where appropriate
- JSON-LD FAQPage schema updated with all 6 FAQs

### Footer Disclaimer — Updated
- Added: "Attorney assignment is mechanical and does not constitute a recommendation or endorsement by The Comp Desk."

### Intake Wizard Modal — NEW
- **Deployed**: 2026-04-12 (second push)
- 3-step modal wizard triggered from hero CTA, inline CTA, and footer CTA
- Step 1: County (all 62 NY counties), Injury Type (12 categories), Case Stage (6 options), Date of Injury
- Step 2: Employer name, accident description (min 20 chars), body parts injured
- Step 3: First/last name, phone (auto-format), email, preferred contact, TCPA consent, disclaimer acknowledgment
- Cloudflare Turnstile CAPTCHA integration (site key is placeholder — needs real key before live submissions)
- Honeypot field for bot protection
- Submits to existing `submit-attorney-lead` Supabase edge function
- Animated progress dots, per-step validation, error banners, loading spinner
- Confirmation screen with reference ID and 48-hour promise
- ESC key and overlay click to close
- Fully responsive down to 320px

### Sitemaps — Updated
- Root `sitemap.xml`: `/find-attorney.html` → `/connect-with-attorney.html`, lastmod 2026-04-12
- SEO `seo/sitemap.xml`: same update (workspace-only, not in repo)

### Cross-Site Link Cleanup (28 files)
- settlement-calculator.html: 4 links updated
- learn.html: 1 link updated
- coming-soon.html: 2 links updated
- tools/settlement.html: 1 link updated (also changed CTA text "Hire an Attorney" → "Connect with an Attorney")
- tools/learning/index.html: 1 link updated
- calculators/benefit-rate.html: 1 link updated
- learn/ articles (15 files): all CTA links updated from /find-attorney.html to /connect-with-attorney.html

---

## Pending / Not Yet Deployed

- [x] ~~Confirm `auth_v2.html` is live on Vercel~~ (confirmed live)
- [x] ~~Submit sitemap.xml to Google Search Console~~ (submitted 2026-04-06, re-submitted 2026-04-11 with 22 pages)
- [x] ~~Set up robots.txt~~ (deployed 2026-04-06)
- [x] ~~Check Google Search Console for first indexed pages~~ (confirmed 2026-04-11: 23 indexed, 3 not indexed)
- [x] ~~Submit priority URLs to GSC via URL Inspection~~ (5 URLs submitted 2026-04-11)
- [x] ~~Fix sitemap /subscription/ → /subscribe/ 404~~ (fixed and deployed 2026-04-11)
- [x] ~~Draft `/connect-with-attorney` Phase B landing page~~ (deployed 2026-04-12 with credits model + intake wizard)
- [ ] Configure custom 404 page
- [ ] Add `thecompdesk.com` to Cowork network allowlist for automated uptime monitoring
- [ ] Submit `/settlement-calculator` to GSC via URL Inspection → Request Indexing
- [ ] Submit `/connect-with-attorney.html` to GSC via URL Inspection → Request Indexing (new URL, old was indexed as find-attorney)
- [ ] Add 301 redirect: `/hire-attorney.html` → `/connect-with-attorney.html` (in vercel.json)
- [ ] Replace Turnstile placeholder site key with real Cloudflare key for live intake submissions
- [ ] Build Supabase database migration for new fields (county, injury_type, case_stage) in attorney_leads table
