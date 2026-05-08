# The Comp Desk — Changelog

All deployments to **thecompdesk.com** via Vercel (auto-deploy from `main` branch).
Repository: `github.com/jmays2294-creator/thecompdesk-site`

---

## 2026-05-08

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
