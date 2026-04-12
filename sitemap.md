# The Comp Desk — Sitemap

**Domain**: https://thecompdesk.com
**Last updated**: 2026-04-10 (Phase B: Settlement Calculator SEO landing page deployed)

---

## Live Pages

| Page | URL | Purpose | Auth Required |
|------|-----|---------|---------------|
| Landing Page | `/` (`index.html`) | Main entry point. Hero section, feature overview, CTA for sign-up. SEO landing for all target keywords. | No |
| Sign In / Sign Up | `/auth.html` | User authentication — login and account creation via Supabase. | No |
| Account Dashboard | `/account.html` | User profile, subscription status, access to Pro tools. | Yes |
| Connect with Attorney | `/connect-with-attorney.html` | Attorney directory for injured workers seeking NYS WC representation. | No |
| Privacy Policy | `/privacy.html` | Privacy policy, cookie disclosures, data handling practices. | No |
| Subscription | `/subscribe/` | Plan selection, Stripe checkout, billing management. | Partial |
| Coming Soon | `/coming-soon.html` | Comp Buddy features overview, email signup, development roadmap. | No |

## Calculator Pages (All Live)

| Page | URL | Access | Status |
|------|-----|--------|--------|
| Calculator Hub | `/calculators/` | Free | LIVE |
| SLU Calculator | `/calculators/slu.html` | Free | LIVE |
| AWW Calculator | `/calculators/aww.html` | Free | LIVE (v2 multi-step wizard) |
| LWEC Calculator | `/calculators/lwec.html` | Free | LIVE |
| Award Calculator | `/calculators/ccp-award.html` | Free | LIVE |
| Rate Lookup | `/calculators/rates.html` | Free | LIVE |
| Benefit Rate Lookup | `/calculators/benefit-rate` | Free | LIVE |
| Radiculopathy Calculator | `/calculators/radiculopathy.html` | Free | LIVE |
| Spine & Brain Calculator | `/calculators/spine-brain.html` | Free | LIVE |
| Pro Calculator Suite | `/calculators/pro.html` | Pro | LIVE (noindex) |

## Phase B SEO Landing Pages

| Page | URL | Access | Status |
|------|-----|--------|--------|
| Settlement Calculator | `/settlement-calculator.html` | Free | LIVE (deployed 2026-04-10) |
| Learn Hub | `/learn/` | Free | LIVE (12 articles, 4 categories, RSS feed) |
| Connect with Attorney | `/connect-with-attorney` | Free | PLANNED — spec in site_health_report_2026-04-09.md |

## Auth & Account Pages (All Live, noindex)

| Page | URL | Purpose | Status |
|------|-----|---------|--------|
| Auth V2 | `/auth_v2.html` | Sign-in / sign-up (Supabase) | LIVE |
| Account Dashboard | `/account.html` | Profile, subscription status | LIVE |
| Subscribe | `/subscribe/` | Plan selection, Stripe checkout | LIVE |
| Delete Account | `/delete-account.html` | Account deletion | LIVE |

## Planned — Glossary Pages (V2, May launch)

| Page | URL | Access | Status |
|------|-----|--------|--------|
| Glossary Index | `/glossary/` | Free | Architecture spec complete (April 2). Content from tooltip_content.json. |
| Individual Terms | `/glossary/{term-slug}` | Free | ~20 terms planned. See glossary_architecture.md. |

## Planned — Comp Buddy Feature Pages (2026-2027)

| Page | URL | Access | Phase |
|------|-----|--------|-------|
| Find a Doctor Map | `/comp-buddy/find-doctor` | Free/Comp Buddy | Phase C |
| IME Reminders | `/comp-buddy/ime-reminders` | Comp Buddy | Phase C |
| UTDM Monitoring | `/comp-buddy/utdm` | Comp Buddy | Phase D |
| Learning Portal | `/learn/` | Free/Comp Buddy | ✅ LIVE |
| M&T Auto-Tracking | `/comp-buddy/mileage` | Comp Buddy | Phase D |
| Work Search AI | `/comp-buddy/work-search` | Comp Buddy | Phase E |
| Claim Filing Wizard | `/comp-buddy/file-claim` | Comp Buddy | Phase F |
| Settlement Calculator | `/settlement-calculator` | Free | ✅ LIVE (SEO landing) |
| Comp Buddy Signup | `/comp-buddy/signup` | — | Phase D |

## Not Yet Built (Roadmap)

- `/404.html` — Custom error page
- `/blog/` — Blog/resources section (coordinate with Marketing)
- `/connect-with-attorney` — Phase B attorney referral SEO landing page

---

## SEO Notes

- **Google indexing**: Sitemap re-submitted 2026-04-11 (22 pages discovered, Success). As of 2026-04-11: homepage, find-attorney, and privacy are indexed. Auth.html and /subscribe/ submitted for indexing via URL Inspection. 23 total indexed pages per GSC Overview.
- **Calculator SEO**: Full keyword mapping in `keyword_mapping.md`. 18+ target keywords across 9 calculator pages + glossary.
- **Structured data**: JSON-LD deployed on all calculator pages (WebApplication) + settlement-calculator (WebApplication + FAQPage). Templates in `json_ld_templates.md`.
- **Meta descriptions**: Defined per page. All public pages have full OG + Twitter Card tags as of April 6 SEO overhaul.
- **Canonical URLs**: Set on all pages. www → non-www 301 redirect configured in vercel.json.
- **robots.txt**: Deployed 2026-04-06. Auth-gated pages blocked.
- **sitemap.xml**: 22 public URLs covering core pages, calculators, landing pages, and tools. Fixed 2026-04-11 — corrected `/subscription/` (404) to `/subscribe/`, removed auth-gated pages, merged into single authoritative root sitemap.

## Infrastructure Notes

- **GitHub push from Cowork**: Configured 2026-04-10. Token + usage in project CLAUDE.md.
- **Vercel MCP**: Connected. Can list deployments, check status, and verify builds.
- **Network allowlist gap**: `thecompdesk.com` and `search.google.com` not on Cowork allowlist — cannot do live page fetches or automated GSC checks yet.
