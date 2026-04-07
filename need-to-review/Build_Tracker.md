# Comp Desk / Comp Buddy — Build Tracker

**Maintained by:** Secretary
**Source of truth for:** every Code-agent prompt in flight, who owns it, status, commit SHA, blockers
**Updated:** April 7, 2026 — morning

When Joel asks "what's in flight", pull from this file.

---

## Active / Queued

| # | Title | Team | Sent | Status | Commit | Blockers |
|---|---|---|---|---|---|---|
| 1 | Benefit Rate Lookup Tool | Dev (primary) + Website (copy/SEO) | 2026-04-07 AM | DONE | 5f431b3 | None |
| 2 | Learn Hub + 12 Articles | Website | 2026-04-07 AM | DONE | d0dd87e | None |
| 3 | Pro Tier Paywall Scaffolding | Dev | 2026-04-07 AM | RUNNING — session `local_9456205d-d3bb-4b2d-8253-09ad74c460d1` | — | Stripe keys wired by Joel tonight; scaffolding ships dark |
| 5 | Case Document Vault (Pro feature #1) | Dev | staged | QUEUED — fires after #3 lands | — | Depends on #3 entitlement helper |
| 6 | Comp Buddy Q&A Chatbot | Dev | staged | QUEUED — fires after #2 + #3 land | — | Depends on #2 (Learn corpus) + #3 (gating) |
| 8 | Public API + Embeddable Widget | Dev (primary) + Website (partner page) | staged | QUEUED — fires after #1 lands | — | Depends on #1 (and eventually SLU) |
| 2b | SLU Estimator (short brief) | Dev | staged | QUEUED — fires after #1 lands | — | Mirrors #1 pattern |
| 7 | Conversion Optimization Pass (short brief) | Website + Dev | staged | QUEUED — fires after #1, #2, #2b land | — | Needs calculators + Learn live |

## Done (recent)

| # | Title | Commit | Date |
|---|---|---|---|
| Prior-1 | Silent-owner site sweep | 7618e62 | — |
| Prior-2 | Universal disclaimer + legal pages | 2d7d356 | — |
| Prior-3 | AWW Calculator v2 | 7ab2f8a | — |
| Prior-4 | Mascot hero animation slot (placeholder Lottie) | bbf698a | — |
| Prior-5 | Email capture + welcome sequence | c6f3b29 | — |
| Prior-6 | Customer story intake | 3b090fb | — |
| Prior-7 | Find Attorney lead-gen page | 7c44537 | — |
| Prior-8 | Conflict-safe PostHog analytics | 135a454 | — |
| Prior-9 | CI directory-neutrality workflow | f619d50 | — |

## Pending External (not Code-agent work)

- Mascot animation production (real Lottie/Rive)
- PostHog self-hosted at ph.thecompdesk.com (provisioning)
- Outside-counsel review of disclaimer/terms/privacy
- Find Attorney launch wiring (Stripe test + Resend + Turnstile + secrets) — Joel tonight at iMac

---

## Prompt #1 — Benefit Rate Lookup Tool

**Team assignment:** Dev primary, Website secondary.
**Why:** This is mostly engineering (shared rate-table module extraction, calculator logic, tests) with a thin SEO/copy layer on top. One Dev agent owns it end-to-end; Website lead reviews the meta/copy at PR time.

### Full Code-agent prompt (copyable)

```
TASK: Build the Benefit Rate Lookup Tool for The Comp Desk.

REPO: thecompdesk-site (cwd: /Users/joelmays/TheCompDesk/thecompdesk-site)
BRANCH: feat/benefit-rate-calculator → push direct to main when green
POSTURE: Silent-owner. No founder name, photo, bio, or law firm reference anywhere. See SILENT_OWNER_POLICY.md.

CONTEXT:
The AWW Calculator v2 (commit 7ab2f8a) ships with a DOI-year rate lookup table. We need a second free calculator that exposes that table directly: user enters a NY workers' comp date of injury, gets back the statutory weekly comp max/min for that DOI year, the formula, and a Comp Buddy explainer. This tool is the second SEO landing page and the second top-of-funnel for Find Attorney lead capture.

DELIVERABLES:
1. Extract the DOI rate table from calculators/aww/ into a shared module at calculators/_shared/nyRateTable.ts. AWW v2 must be refactored to import from the new location with zero behavior change. Add unit tests covering every DOI year 2018–2026 against fixture values.
2. New route /calculators/benefit-rate
   - File: calculators/benefit-rate/index.html (or .tsx if calculators are React; match AWW v2's stack exactly)
   - Inputs: date of injury (date picker, validates not in future, warn if >10 years old)
   - Outputs: statutory weekly max, statutory weekly min, effective date range for that DOI year, plain-language formula explainer in Comp Buddy voice, citation to WCL §25(3)
   - Mascot illustration slot (use existing Marketing-Materials/CompBuddy_*.svg)
3. CTA block at the bottom of the results screen: "Want to know what your specific case might be worth? Talk to a NY workers' comp attorney." → links to /find-attorney?utm_source=benefit-rate&utm_medium=tool_cta
4. PostHog event taxonomy (use the existing analytics helper from commit 135a454):
   - benefit_rate_started
   - benefit_rate_completed { doi_year }
   - benefit_rate_to_find_attorney_click
5. SEO: <title>NY Workers' Comp Benefit Rate Lookup | The Comp Desk</title>, meta description, JSON-LD HowTo schema, OpenGraph tags. Add to sitemap.xml.
6. Universal footer disclaimer must render (existing component from commit 2d7d356).
7. Add a card link to /calculators/benefit-rate from the calculators index page and from the AWW v2 results screen ("Also useful: look up your DOI year's max/min rate").

ACCEPTANCE CRITERIA:
- AWW v2 still passes all existing tests after the rate-table refactor
- New benefit-rate unit tests pass for every DOI year 2018–2026
- Lighthouse mobile score ≥ 90 (perf, a11y, best-practices, SEO)
- Disclaimer present
- PostHog events fire in dev
- A click on the Find Attorney CTA round-trips utm_source=benefit-rate into a Supabase attorney_leads row (manual test)
- Zero references to any individual person or law firm

OUT OF SCOPE: SLU calculator (separate ticket #2), AWW changes beyond the import path refactor.

WHEN DONE: push to main, paste commit SHA into Build_Tracker.md row #1 and flip status to DONE.
```

---

## Prompt #2 — Learn Hub + 12 Articles

**Team assignment:** Website (sole owner).
**Why:** This is content production + routing + SEO infrastructure. No backend, no calculator math, no auth. Pure Website team work — fastest to ship as a single owner with no Dev coordination.

### Full Code-agent prompt (copyable)

```
TASK: Stand up the /learn content hub and ship the first 12 articles for The Comp Desk.

REPO: thecompdesk-site (cwd: /Users/joelmays/TheCompDesk/thecompdesk-site)
BRANCH: feat/learn-hub → push direct to main when green
POSTURE: Silent-owner. Author byline is "The Comp Desk Editorial Team" — never an individual name. No firm references. Disclaimer footer required on every article. See SILENT_OWNER_POLICY.md.

CONTEXT:
This is the SEO content engine. Every Learn article funnels traffic to (a) a calculator and (b) the Find Attorney lead-gen page. Articles are written in Comp Buddy's voice — warm, plain-language, empathetic, never "legal advice." Every article ends with a soft CTA to a calculator and a hard CTA to /find-attorney.

DELIVERABLES:
1. /learn index page with 4 category sections:
   - Benefits (TT, TPD, SLU, AWW, max/min rates)
   - Process (filing C-3, hearings, IMEs, settlements)
   - Injuries (back, knee, shoulder, occupational disease, repetitive trauma)
   - Your Rights (retaliation, light duty, choosing an attorney, statute of limitations)
2. /learn/[category]/ landing pages, one per category
3. /learn/[category]/[slug] article pages with the 12 articles below
4. Article writing — 1,200–1,800 words each, Comp Buddy voice, structured with H2/H3, bullet lists where helpful, real plain language. Topics:
   1. "What is your Average Weekly Wage and why does it matter?" → Benefits
   2. "Temporary Total vs Temporary Partial Disability: what's the difference?" → Benefits
   3. "Schedule Loss of Use awards explained" → Benefits
   4. "How to file a C-3 form in New York" → Process
   5. "Surviving an Independent Medical Exam" → Process
   6. "Section 32 settlements: what to know before you sign" → Process
   7. "What happens at a workers' comp hearing?" → Process
   8. "Back injuries and workers' comp" → Injuries
   9. "Knee injuries and workers' comp" → Injuries
   10. "Can my employer fire me for filing a comp claim?" → Your Rights
   11. "How long do I have to file a workers' comp claim in NY?" → Your Rights
   12. "How to choose a NY workers' comp attorney" → Your Rights (this one funnels HARD into /find-attorney)
5. Each article has:
   - <article> wrapper with schema.org Article JSON-LD
   - "By The Comp Desk Editorial Team" byline component (build the component once, reuse)
   - Mascot illustration slot at the top
   - Estimated read time
   - Internal links: ≥2 to other Learn articles + 1 to a calculator + 1 to /find-attorney with utm_source=learn&utm_content=[slug]
   - Footer disclaimer component
6. Auto-generated sitemap.xml inclusion for /learn and all child routes
7. RSS feed at /learn/feed.xml
8. Update top nav to include "Learn" link

ACCEPTANCE CRITERIA:
- All 12 articles render at their routes with disclaimer
- Lighthouse SEO ≥ 95 on a randomly chosen article
- Sitemap includes every new route
- Internal-link audit script (write it as scripts/audit-learn-links.ts) confirms every article has ≥4 outbound internal links
- Zero references to any individual person or law firm in any article body
- Byline component used everywhere; no hardcoded author names
- Mobile typography is comfortable (line-height ≥ 1.6, max-width ≤ 70ch)

WHEN DONE: push to main, paste commit SHA into Build_Tracker.md row #2 and flip status to DONE.
```

---

## Prompt #3 — Pro Tier Paywall Scaffolding (Test-Mode Ready)

**Team assignment:** Dev (sole owner).
**Why:** Pure backend + auth + entitlement plumbing. No content, no marketing copy. Single Dev agent owns Supabase migration, edge function, account flow, and gating helper. Ships dark behind a feature flag so it can land without breaking anything.

### Full Code-agent prompt (copyable)

```
TASK: Build complete Pro Tier paywall scaffolding for The Comp Desk. Stripe wiring is OUT OF SCOPE — Joel will paste secrets tonight. Everything else ships today.

REPO: thecompdesk-site (cwd: /Users/joelmays/TheCompDesk/thecompdesk-site) + Supabase project ltibymvlytodkemdeeox
BRANCH: feat/pro-tier-scaffolding → push direct to main when green
POSTURE: Silent-owner. No founder/firm references in account UI, pricing copy, or webhook handlers.

CONTEXT:
This unblocks the $500K/year platform play. We need: subscriptions table, entitlements table, account flow (magic-link auth), entitlement-gating helper, /pricing page, and a deployed-but-dormant Stripe webhook function. The flag PRO_ENABLED ships OFF; flipping it on later activates the paywall. Stripe will be in TEST mode at launch — Joel creates the test product/price himself.

DELIVERABLES:
1. Supabase migration (apply via Supabase MCP to project ltibymvlytodkemdeeox):
   - Table `subscriptions`:
     id uuid pk default gen_random_uuid()
     user_id uuid not null references auth.users(id) on delete cascade
     stripe_customer_id text
     stripe_subscription_id text unique
     status text not null check (status in ('trialing','active','past_due','canceled','incomplete'))
     price_id text
     current_period_end timestamptz
     created_at timestamptz default now()
     updated_at timestamptz default now()
   - Table `entitlements`:
     user_id uuid pk references auth.users(id) on delete cascade
     tier text not null default 'free' check (tier in ('free','pro'))
     features jsonb not null default '{}'::jsonb
     updated_at timestamptz default now()
   - RLS: users can SELECT their own row in both tables; only service role can INSERT/UPDATE/DELETE
   - Trigger: on auth.users insert → create entitlements row with tier='free'
2. Edge function `stripe-webhook` deployed to project ltibymvlytodkemdeeox:
   - Verifies Stripe signature using STRIPE_WEBHOOK_SECRET (env var, may be unset at deploy)
   - Handles checkout.session.completed (insert subscriptions row, upsert entitlements tier='pro')
   - Handles customer.subscription.updated (update status + period_end)
   - Handles customer.subscription.deleted (entitlements tier back to 'free')
   - Logs all events to a `webhook_events` table for debugging
   - Returns 500 with clear error if STRIPE_WEBHOOK_SECRET unset (acceptable until tonight)
3. Magic-link auth flow:
   - /auth/signup and /auth/login pages using Supabase Auth (email magic link via existing Resend integration from commit c6f3b29)
   - /auth/callback handler
   - /account dashboard showing tier, billing status, manage-subscription link (Stripe Customer Portal — placeholder if PRO_ENABLED off)
4. Entitlement helper `lib/entitlements.ts`:
   - `getEntitlement(userId)` → returns tier + features
   - `requirePro(userId)` → throws 402 if tier !== 'pro' AND PRO_ENABLED is true; no-op otherwise
   - Server-side and client-side variants
5. /pricing page:
   - Two-column matrix: Free vs Pro
   - Free features: AWW, Benefit Rate, SLU calculators, 12 Learn articles, Find Attorney
   - Pro features (placeholders for now): unlimited Comp Buddy chat, document vault, claim timeline, priority support
   - Pro CTA: "Start 14-day free trial" → /auth/signup?next=/account/upgrade
   - Tier price displayed as "$19/mo" (placeholder; final price set when Joel creates Stripe product tonight)
6. Feature flag `PRO_ENABLED` in lib/featureFlags.ts, default false. When false: /pricing renders with "Coming soon" badge, upgrade buttons disabled, requirePro() is a no-op.
7. Generate updated TypeScript types from Supabase and commit them.
8. Document env-var checklist for Joel in need-to-review/PRO_TIER_SECRETS_CHECKLIST.md:
   - STRIPE_SECRET_KEY (test mode)
   - STRIPE_WEBHOOK_SECRET (from Stripe dashboard webhook endpoint)
   - STRIPE_PRO_PRICE_ID (from test product Joel creates)
   - PRO_ENABLED=true (flip when ready)

ACCEPTANCE CRITERIA:
- Migration applied to project ltibymvlytodkemdeeox; tables visible via Supabase MCP list_tables
- RLS verified: a test user cannot read another user's subscription/entitlements row
- Stripe-webhook edge function deployed and ACTIVE (will 500 on missing secrets — that's expected)
- Magic-link signup → email arrives → click → /account dashboard shows tier='free'
- /pricing page renders with PRO_ENABLED=false and shows "Coming soon"
- requirePro() returns no-op when PRO_ENABLED=false; throws 402 when forced true in a unit test
- Zero Stripe keys committed to the repo
- Generated Supabase types committed
- Secrets checklist file exists

WHEN DONE: push to main, paste commit SHA into Build_Tracker.md row #3 and flip status to DONE. Notify Secretary that scaffolding is dark and ready for Joel to wire secrets tonight.
```

---

---

## Prompt #5 — Case Document Vault (first Pro-tier feature)

**Team:** Dev sole owner.
**Why expanded:** This is the stickiness mechanism behind the paywall. RLS, storage, OCR stub, and entitlement gating all need to be locked in version one. Touches user data — getting it wrong is expensive.

### Full Code-agent prompt (copyable)

```
TASK: Build the Case Document Vault — the first real Pro-tier feature for The Comp Desk.

REPO: thecompdesk-site (cwd: /Users/joelmays/TheCompDesk/thecompdesk-site) + Supabase project ltibymvlytodkemdeeox
BRANCH: feat/document-vault → push direct to main when green
DEPENDS ON: prompt #3 (Pro Tier Paywall Scaffolding) — entitlement helper lib/entitlements.ts must exist
POSTURE: Silent-owner. Per-user data, never seen by anyone but the owning user. No founder/firm references in UI.

CONTEXT:
This is the first thing behind the Pro paywall. Authenticated users upload claim documents (C-3, C-4 medicals, hearing notices, decisions, IME reports, correspondence), tag them, search them, view them on a timeline. Free tier gets 3 lifetime uploads. Pro is unlimited and adds OCR (stubbed in v1, real later).

DELIVERABLES:
1. Supabase migration on project ltibymvlytodkemdeeox:
   - Storage bucket `case_documents`, private, RLS enforced
   - Table `documents`:
     id uuid pk default gen_random_uuid()
     user_id uuid not null references auth.users(id) on delete cascade
     storage_path text not null unique
     filename text not null
     mime_type text not null
     size_bytes bigint not null
     uploaded_at timestamptz default now()
     document_date date  -- user-provided or extracted
     ocr_text text  -- nullable, populated by OCR stub later
     ocr_status text default 'pending' check (ocr_status in ('pending','processing','done','failed','skipped'))
   - Table `document_tags`:
     document_id uuid references documents(id) on delete cascade
     tag text check (tag in ('medical','legal','employer','decision','correspondence','other'))
     primary key (document_id, tag)
   - Table `case_timeline_events`:
     id uuid pk default gen_random_uuid()
     user_id uuid not null references auth.users(id) on delete cascade
     event_date date not null
     event_type text not null
     title text not null
     description text
     document_id uuid references documents(id) on delete set null
     created_at timestamptz default now()
   - RLS on all three: user can SELECT/INSERT/UPDATE/DELETE only WHERE user_id = auth.uid(). Service role full access.
   - Storage bucket policy: object owner = auth.uid(); read/write only by owner.
2. Edge function `upload-document`:
   - Auth required (verify Supabase JWT)
   - Calls requirePro() from lib/entitlements.ts. If free tier and user already has 3 documents → return 402 with upgrade CTA payload.
   - Accepts multipart upload, validates mime type (pdf, jpeg, png, heic, docx), max 25 MB
   - Writes to storage at path `${user_id}/${uuid}/${filename}`
   - Inserts row into `documents` with ocr_status='pending'
   - Returns document row
3. Edge function `delete-document`:
   - Auth required, RLS enforces ownership
   - Deletes storage object + documents row (cascade handles tags + timeline link)
4. UI at /account/documents:
   - Drag-drop upload zone (react-dropzone or equivalent already in repo)
   - Document grid with thumbnail (PDF first-page render via pdf.js, image preview, generic icon for docx)
   - Click to open in a side-panel viewer
   - Tag editor (multi-select chips)
   - Search box (filename + tag filter; ocr_text search stubbed for v1, returns empty)
   - "Upload limit: 2 of 3" indicator on free tier with upgrade CTA when at cap
5. UI at /account/timeline:
   - Auto-built chronological view of all case_timeline_events for the user
   - "Add event" button → modal with date/type/title/description + optional document link
   - Documents with a document_date auto-create a timeline event on upload (event_type='document_added')
6. Free-tier gate: requirePro() called in upload-document edge function AND in the UI before the upload dialog opens. Free user sees upgrade modal at attempt #4.
7. OCR stub: ocr_status starts 'pending'; a placeholder background job (just a manifest entry in scripts/TODO_ocr.md) is created so the real OCR worker can be added later. Do NOT integrate Textract/Tesseract in this prompt — too much scope.
8. Update /pricing matrix: add "Case Document Vault (3 docs free / unlimited Pro)" + "Claim Timeline" rows.
9. PostHog events: document_uploaded, document_deleted, document_upload_blocked_free_cap, timeline_event_added.

ACCEPTANCE CRITERIA:
- Migration applied; tables and bucket visible via Supabase MCP
- RLS verified by writing a test that authenticates as user A and tries to read user B's document → must fail
- Free user blocked at upload #4 with proper 402 + UI modal
- Pro user (manually entitled in dev) uploads unlimited
- Drag-drop works on Chrome/Safari/Firefox + mobile Safari
- Timeline auto-builds chronologically and links back to source documents
- All copy is silent-owner-safe
- Disclaimer footer present on /account/documents and /account/timeline
- Generated Supabase types committed

WHEN DONE: push to main, message Secretary with commit SHA so row #5 flips to DONE in Build_Tracker.md.
```

---

## Prompt #6 — Comp Buddy Q&A Chatbot

**Team:** Dev sole owner.
**Why expanded:** Highest-ceiling product on the platform. The system prompt, refusal rules, retrieval logic, and rate-limit gating are all load-bearing — getting the guardrails wrong creates legal exposure for a silent-owned WC brand. Worth the full treatment.

### Full Code-agent prompt (copyable)

```
TASK: Build the Comp Buddy Q&A Chatbot — retrieval-augmented WC information assistant in Comp Buddy's voice.

REPO: thecompdesk-site (cwd: /Users/joelmays/TheCompDesk/thecompdesk-site) + Supabase project ltibymvlytodkemdeeox
BRANCH: feat/comp-buddy-chat → push direct to main when green
DEPENDS ON: prompt #2 (Learn Hub corpus) and prompt #3 (entitlement gating)
POSTURE: Silent-owner. Comp Buddy is the speaker, never an attorney. Hard refusal rules. Disclaimer + Find Attorney CTA mandatory on every response.

CONTEXT:
This is the killer onboarding experience and a massive lead generator. Free tier gets 10 questions/day, Pro is unlimited. The bot is trained ONLY on the 12 Learn articles + the calculator explainer text. It refuses legal advice, refuses case-specific predictions, and ends every answer with the disclaimer + a Find Attorney CTA.

DELIVERABLES:
1. Supabase migration:
   - Enable pgvector extension if not enabled
   - Table `kb_chunks`:
     id uuid pk default gen_random_uuid()
     source_type text check (source_type in ('learn_article','calculator_explainer'))
     source_slug text not null
     chunk_index int not null
     content text not null
     embedding vector(1536)
     created_at timestamptz default now()
   - Index: ivfflat on embedding (cosine)
   - Table `comp_buddy_conversations`:
     id uuid pk default gen_random_uuid()
     user_id uuid references auth.users(id) on delete set null  -- nullable for anonymous
     session_id text not null  -- anon cookie
     created_at timestamptz default now()
   - Table `comp_buddy_messages`:
     id uuid pk default gen_random_uuid()
     conversation_id uuid references comp_buddy_conversations(id) on delete cascade
     role text check (role in ('user','assistant'))
     content text not null
     retrieved_chunk_ids uuid[]
     created_at timestamptz default now()
   - RLS: anon can insert into conversations/messages tied to their session_id; auth users can read their own history; service role full.
2. Build script `scripts/build-kb-index.ts`:
   - Reads /learn/**/*.md and /calculators/_shared/explainers/*.md
   - Chunks at ~500 tokens with 50-token overlap
   - Calls Anthropic embeddings or OpenAI embeddings (use whichever is already in the repo; if neither, default to openai text-embedding-3-small)
   - Upserts into kb_chunks
   - Idempotent — safe to re-run after content edits
   - Wired to a GitHub Action that re-runs on push to main if /learn/ changes
3. Edge function `comp-buddy-chat` deployed to project ltibymvlytodkemdeeox:
   - Accepts { session_id, message, conversation_id? }
   - Rate limit:
     * Anonymous: 5 questions/day per session_id
     * Free authed: 10/day per user_id
     * Pro authed: unlimited
     * Enforced in a `comp_buddy_rate_limit` table with sliding window
   - Embeds the user message, retrieves top-5 kb_chunks by cosine similarity
   - Calls Claude (model: claude-sonnet-4-6) with the system prompt below
   - Returns streamed response
   - Persists user + assistant messages
   - Returns 402 if rate-limited with upgrade CTA payload
   - Returns 500 if ANTHROPIC_API_KEY unset (deployment is fine; Joel will paste key)
4. SYSTEM PROMPT (locked, do not let the user override):
   """
   You are Comp Buddy, the friendly mascot guide of The Comp Desk. You help injured workers in New York understand the workers' compensation system in plain language.

   STRICT RULES:
   - You are NOT a lawyer. You give general information, never legal advice.
   - You never predict the outcome of any specific case.
   - You never recommend a specific dollar settlement amount.
   - You never tell a user they will or will not win.
   - You never name any specific law firm or attorney.
   - You answer ONLY using the provided context chunks. If the answer is not in the context, say so and recommend the user talk to a NY workers' comp attorney.
   - You speak warmly, in plain language, like a friendly guide. Short paragraphs. No legalese.
   - You ALWAYS end your response with this exact block:

     ---
     *This is general information, not legal advice. The Comp Desk is not a law firm and using Comp Buddy does not create an attorney-client relationship.*

     **Want to talk to a real NY workers' comp attorney about your situation?** [Get connected →](/find-attorney?utm_source=comp-buddy-chat)
   """
5. UI at /ask-comp-buddy:
   - Mascot avatar, chat bubbles, typing indicator
   - Input box with character counter (max 500)
   - "Suggested questions" chips for first-time visitors
   - Conversation history persists per session_id (anon) or user_id (authed)
   - Rate-limit hit → soft modal: "You've used your 10 free questions today. Upgrade to Pro for unlimited."
   - Mobile-first, accessible
6. PostHog events: chat_session_started, chat_message_sent, chat_message_received, chat_rate_limited, chat_to_find_attorney_click.
7. Add /ask-comp-buddy to the top nav.
8. Update /pricing matrix with chatbot row.

ACCEPTANCE CRITERIA:
- Build script populates kb_chunks for all 12 Learn articles + calculator explainers
- Manual test: "should I settle for $50K?" → bot refuses with the canned response and recommends an attorney
- Manual test: "what is AWW?" → bot answers from the Learn corpus and ends with the disclaimer + CTA block
- Anon user blocked at message #6
- Free authed user blocked at message #11 with upgrade modal
- Edge function deployed ACTIVE (will 500 until ANTHROPIC_API_KEY set — fine)
- All UI is silent-owner-safe
- Generated Supabase types committed

WHEN DONE: push to main, message Secretary with commit SHA so row #6 flips to DONE in Build_Tracker.md.
```

---

## Prompt #8 — Public API + Embeddable Calculator Widget

**Team:** Dev primary, Website secondary (partner self-serve page + docs).
**Why expanded:** Distribution play. Partner key model, attribution flow, and embed security need to be locked in version one because every embed becomes a permanent piece of public surface. High blast radius if done wrong.

### Full Code-agent prompt (copyable)

```
TASK: Build the public calculator API and the embeddable widget that turns Comp Desk into infrastructure other sites can drop in.

REPO: thecompdesk-site (cwd: /Users/joelmays/TheCompDesk/thecompdesk-site) + Supabase project ltibymvlytodkemdeeox
BRANCH: feat/public-api-widget → push direct to main when green
DEPENDS ON: prompt #1 (Benefit Rate) and ideally #2b (SLU). At minimum AWW v2 must be live (already done).
POSTURE: Silent-owner. Every embed includes a "Powered by The Comp Desk — Find an attorney" footer. No firm name or founder name in any embedded surface.

CONTEXT:
The Comp Desk stops being a website and becomes a category by living on union sites, PT clinics, injured-worker blogs, and disability advocacy pages across NY. Every embed is a permanent free traffic source. Every lead from an embed is attributed to the partner so we can prove value back to them.

DELIVERABLES:
1. Supabase migration:
   - Table `partners`:
     id uuid pk default gen_random_uuid()
     name text not null
     contact_email text not null
     embed_key text not null unique  -- generated, prefix `cdwk_`
     active boolean default true
     approved boolean default false
     created_at timestamptz default now()
     approved_at timestamptz
     daily_rate_limit int default 5000
   - Add `partner_id uuid references partners(id)` column to `attorney_leads` (nullable)
   - RLS: anon cannot read; service role only
2. Edge function `public-calc-api` deployed to project ltibymvlytodkemdeeox:
   - Routes:
     * POST /aww — runs AWW calculation server-side from the shared module
     * POST /benefit-rate — runs benefit rate lookup
     * POST /slu — runs SLU estimate (skip if #2b not yet shipped; gate behind feature flag)
   - Auth: requires `X-Comp-Desk-Key: cdwk_…` header
   - Validates partner is active+approved, rate-limits per partner per day, logs every call
   - CORS: open (Access-Control-Allow-Origin: *) — these are public read endpoints
3. Embeddable widget bundle:
   - Source at `embed/widget.ts`, builds to `embed/dist/widget.js` (single self-contained file, no external deps at runtime)
   - Hostable at /embed/widget.js (CDN-friendly headers; embed.thecompdesk.com DNS is a Joel task, NOT in this prompt)
   - Usage:
     <div data-comp-desk-widget="aww" data-key="cdwk_xxx"></div>
     <script src="https://thecompdesk.com/embed/widget.js" async></script>
   - Renders the calculator inside a shadow DOM (style isolation)
   - Calls public-calc-api with the partner key
   - Shows results inline
   - Bottom of every widget: "Powered by The Comp Desk — Find a NY workers' comp attorney →" linking to /find-attorney?utm_source=embed&partner_id={id}&utm_medium=widget
   - Supports `data-comp-desk-widget="aww" | "benefit-rate" | "slu"`
4. Self-serve partner intake at /partners:
   - Marketing page explaining the embed program (free, attribution included, brand-safe)
   - Form: organization name, contact email, website URL, intended use
   - Submit → inserts into `partners` table with approved=false, generates embed_key, emails Joel for approval
   - Success page: "We'll review and email your embed key within 1 business day"
5. Partner approval flow:
   - Edge function `approve-partner` (admin-only, called from a future admin UI; ship the function now, UI later)
   - Sets approved=true, approved_at, sends partner an email with their embed key + docs link
6. Documentation at /partners/docs:
   - Quickstart, full data-attribute reference, theming options, attribution explanation, API reference for direct (non-widget) integrations
   - Code samples for HTML, WordPress, React
7. Lead attribution:
   - Find Attorney page reads `partner_id` from query string
   - Persists into `attorney_leads.partner_id` on submission
   - Edge function lead-router includes partner attribution in the email to intake@thecompdesk.com
8. PostHog events: widget_loaded, widget_calc_completed, widget_cta_click, partner_signup_submitted.
9. Security:
   - Rate limit per partner key (daily and per-minute)
   - Reject requests where the Origin header doesn't match the partner's registered website (warn-only in v1, log violations)
   - Embed key revocation flow (set active=false; widget gets a friendly "this embed is no longer active" state)

ACCEPTANCE CRITERIA:
- Standalone test page at /embed/test.html drops the widget in and renders all three calculators (or two if #2b not yet shipped)
- POST to /public-calc-api/aww with a valid key returns the right calculation
- POST without a key returns 401
- POST with an inactive key returns 403
- Lead from a widget submission lands in attorney_leads with partner_id populated
- /partners and /partners/docs render and pass Lighthouse mobile ≥ 90
- Widget bundle is < 50 KB gzipped
- All silent-owner-safe (no founder/firm in widget, docs, or partner emails)

WHEN DONE: push to main, message Secretary with commit SHA so row #8 flips to DONE in Build_Tracker.md.
```

---

## Prompt #2b — SLU Estimator (short brief)

**Team:** Dev. **Mirrors #1 — agent should copy the Benefit Rate pattern.**

Build /calculators/slu using the shared rate module from prompt #1. Inputs: body part, severity %, DOI. Lookup table: WCL §15(3) statutory weeks per body part. Pulls AWW from sessionStorage if user already ran it. Results show estimated SLU range with prominent "estimate only — final SLU requires medical opinion" disclaimer + Find Attorney CTA (utm_source=slu-estimator). PostHog events parallel to #1. Acceptance: unit-tested for every body part, Lighthouse mobile ≥ 90, disclaimer + medical caveat prominent. Push direct to main, message Secretary with SHA.

---

## Prompt #7 — Conversion Optimization Pass (short brief)

**Team:** Website + Dev. **Tactical instrumentation pass — minimal architectural decisions.**

Build three reusable components: `<MascotExitIntent>` (web exit-intent modal driving to /find-attorney), `<PostCalculatorMicroSurvey>` (1-question "did this answer your question?" branching to Find Attorney on "no"), and `<FindAttorneyStickyCTA>` (sticky bottom-bar on calculator results pages). Drop all three into AWW, Benefit Rate, and SLU result screens. Build a PostHog funnel `tool_started → tool_completed → cta_click → find_attorney_view → find_attorney_step3 → find_attorney_submit`, export the dashboard JSON to `posthog/dashboards/conversion-funnel.json`. Add a PostHog feature-flag-driven A/B harness for two CTA copy variants on the Find Attorney hero (50/50 split). Acceptance: components live on all three calculators, funnel populates after end-to-end test, A/B variants serving, dashboard JSON imports cleanly. Push direct to main, message Secretary with SHA.

---

## Check-in cadence

Secretary will check in on each running prompt every ~2 hours, update status column, and surface blockers proactively. When a prompt lands, the commit SHA gets pasted in and status flips to DONE.

## Dispatch note

`start_code_task` is not currently exposed in this Cowork session's tool surface. Joel can either (a) copy each fenced prompt block above into his Code-agent launcher manually, or (b) tell Secretary the correct dispatcher tool name and Secretary will fan them out. Until then, all three are QUEUED, not RUNNING.
