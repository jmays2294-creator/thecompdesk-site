# The Comp Desk — Changelog

All deployments to **thecompdesk.com** via Vercel (auto-deploy from `main` branch).
Repository: `github.com/jmays2294-creator/thecompdesk-site`

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
- `calculators/spine-brain.html` deleted. Removed from index, homepage, Pro tier list, sitemap.
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
