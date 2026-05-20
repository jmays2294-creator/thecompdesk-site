# The Comp Desk — Changelog

All deployments to **thecompdesk.com** via Vercel (auto-deploy from `main` branch).
Repository: `github.com/jmays2294-creator/thecompdesk-site`

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
