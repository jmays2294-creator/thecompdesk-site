# The Comp Desk — Changelog

All deployments to **thecompdesk.com** via Vercel (auto-deploy from `main` branch).
Repository: `github.com/jmays2294-creator/thecompdesk-site`

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

## Pending / Not Yet Deployed

- [x] ~~Confirm `auth_v2.html` is live on Vercel~~ (confirmed live)
- [x] ~~Submit sitemap.xml to Google Search Console~~ (submitted 2026-04-06, re-submitted 2026-04-11 with 22 pages)
- [x] ~~Set up robots.txt~~ (deployed 2026-04-06)
- [x] ~~Check Google Search Console for first indexed pages~~ (confirmed 2026-04-11: 23 indexed, 3 not indexed)
- [x] ~~Submit priority URLs to GSC via URL Inspection~~ (5 URLs submitted 2026-04-11)
- [x] ~~Fix sitemap /subscription/ → /subscribe/ 404~~ (fixed and deployed 2026-04-11)
- [ ] Configure custom 404 page
- [ ] Add `thecompdesk.com` to Cowork network allowlist for automated uptime monitoring
- [ ] Submit `/settlement-calculator` to GSC via URL Inspection → Request Indexing
- [ ] Draft `/connect-with-attorney` Phase B landing page (spec in site_health_report_2026-04-09.md)
