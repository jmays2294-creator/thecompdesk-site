# The Comp Desk — Analytics Privacy & Isolation Audit

**Last updated:** 2026-04-06
**Owner:** Joel Mays
**Scope:** All product analytics fired from any page on `thecompdesk.com`.

## 1. Tool selection

The Comp Desk uses **PostHog, self-hosted**, as its sole product analytics
platform. PostHog was selected over Plausible at Joel's direction so that the
firm can run funnel analysis on calculator usage without sharing data with a
third-party SaaS vendor.

No other analytics, advertising, or attribution tool is loaded on the site:

- **No Google Analytics / GA4 / Tag Manager.**
- **No Meta (Facebook) Pixel.**
- **No TikTok Pixel.**
- **No LinkedIn Insight Tag.**
- **No Microsoft Clarity, Hotjar, FullStory, Mixpanel, Segment, Amplitude.**
- **No advertising remarketing pixels of any kind.**

A grep of the repository for known pixel hostnames and snippet patterns
(`googletagmanager`, `google-analytics`, `connect.facebook.net`,
`fbq(`, `gtag(`, `analytics.tiktok.com`, `linkedin.com/insight`,
`clarity.ms`, `hotjar`) returns zero matches outside of this audit document.

## 2. Account / instance isolation from any law firm property

This is the load-bearing requirement for the entire analytics rollout:
**no data path may exist between Comp Desk users and any law firm property
operated by Joel Mays or his firm.**

| Surface                  | Comp Desk                              | Law firm properties |
|--------------------------|----------------------------------------|---------------------|
| Analytics platform       | PostHog (self-hosted)                  | Whatever the firm's vendor uses — explicitly **NOT this PostHog instance** |
| PostHog host             | `https://ph.thecompdesk.com` (self-hosted) | n/a |
| PostHog project key      | `phc_compdesk_*` — Comp Desk project only | n/a |
| Google Analytics account | None                                   | Separate firm account, not referenced here |
| Meta Pixel ID            | None                                   | Separate firm pixel, not referenced here |
| TikTok Pixel ID          | None                                   | Separate firm pixel, not referenced here |
| Google Ads / Tag Manager | None                                   | Separate firm accounts, not referenced here |
| Shared cookies / domains | None — `thecompdesk.com` does not set or read cookies on any law firm domain, and no law firm domain sets or reads cookies on `thecompdesk.com`. | n/a |
| Shared identifiers       | None — PostHog `distinct_id` is generated locally and never linked to any firm CRM, intake form, or matter ID. | n/a |

### Confirmation

I confirm that, as of the date above, **no Meta, Google, TikTok, LinkedIn,
or other advertising/analytics pixel installed on `thecompdesk.com` shares
an account ID, pixel ID, container ID, measurement ID, project key, or
cookie namespace with any law firm property.** The PostHog project used by
The Comp Desk is a dedicated project on a self-hosted instance and is not
accessible to, nor referenced from, any firm-side property.

### Self-hosted instance status

> **TODO (infra):** The self-hosted PostHog instance at
> `https://ph.thecompdesk.com` has **not yet been provisioned** as part of
> this commit. The client SDK and event taxonomy are wired up and will
> queue events locally (in memory only) until the host responds.
> Provisioning steps:
>
> 1. Stand up PostHog OSS via Docker Compose on a dedicated VM (no shared
>    infrastructure with any firm property).
> 2. Point `ph.thecompdesk.com` DNS at the new instance.
> 3. Create a single project named "The Comp Desk — Production".
> 4. Replace `phc_compdesk_public_placeholder` in `js/analytics.js` (or
>    set `window.__CD_POSTHOG_KEY` from a build-time env var) with the
>    real public project key.
> 5. Re-run the end-to-end browser test in §6 below.
>
> Until step 4 is complete, **no events leave the user's browser.** This
> is by design — we'd rather drop data than risk sending it to the wrong
> place.

## 3. Event taxonomy

Only the following six events are emitted by `js/analytics.js`. Any
attempt to call `CDAnalytics.track()` with an event name outside this set
is silently dropped with a `console.warn`:

| Event                  | Fires when                                                                 | Properties (post-scrub) |
|------------------------|----------------------------------------------------------------------------|-------------------------|
| `page_view`            | On `DOMContentLoaded` for every page that loads `nav.js`.                  | `$current_url` (path + scrubbed query), `page_title` |
| `calculator_started`   | First `input`/`change` on a `<input>`, `<select>`, or `<textarea>` inside `/calculators/*`. | `calculator` (slug from URL) |
| `calculator_completed` | Click on a button whose label matches `/calculate\|compute\|estimate\|results?/i` inside `/calculators/*`. | `calculator` |
| `share_link_generated` | Click on any element matching `[data-share-link]`, `[data-cd-share]`, `.share-link`, or `.copy-share`. | `surface` (scrubbed path) |
| `email_signup`         | Form submit where the form contains an `input[type="email"]` and is **not** a story-submission form. | `surface` |
| `story_submitted`      | Form submit on `/share-your-story/*` or any `[data-cd-form="story"]` form. | `surface` |

No event ever carries the contents of any input, including the email
address itself, the user's name, or any calculator parameter values.

## 4. PII handling — hard-coded strip

Every outbound event payload passes through `scrubPayload()` in
`js/analytics.js` before it reaches PostHog. This function:

1. Drops any property whose key matches a denylist of PII keys
   (`email`, `phone`, `name`, `first_name`, `last_name`, `dob`, `ssn`,
   `address`, `zip`, `token`, `auth`, etc.).
2. Runs every string value through a regex that replaces email
   addresses with `[redacted-email]` and phone numbers with
   `[redacted-phone]`.
3. Rewrites `$current_url`, `$referrer`, and any `url` property by
   parsing the URL and redacting any query parameter whose key is on
   the PII denylist.
4. Recursively scrubs nested objects.
5. Drops functions, symbols, and other unserialisable values.

In addition, PostHog itself is initialised with:

- `autocapture: false` — no automatic click/text capture.
- `capture_pageview: false` — page views are fired by us, not by SDK
  defaults that include the raw URL.
- `disable_session_recording: true` — no session replay.
- `ip: false` and `property_denylist: ['$ip']` — IP address is never
  stored.
- `sanitize_properties: scrubPayload` — second-line PII strip applied
  by the SDK before transport.

The `scrubPayload` function is also exposed at
`window.CDAnalytics._scrubPayload` so the audit and unit tests can call
it directly.

## 5. Cookie consent

`js/analytics.js` shows a consent banner to any visitor whose browser
IANA timezone falls in:

- `Europe/*` (covers EU + UK)
- `America/Toronto`, `America/Vancouver`, `America/Edmonton`,
  `America/Winnipeg`, `America/Halifax`, `America/St_Johns`,
  `America/Montreal`, `America/Regina` (covers Canada)

For these visitors, **no PostHog code is loaded and no events are
captured** until the user clicks "Allow analytics". The decision is
stored locally in `localStorage` under `cd_analytics_consent_v1`.
Declining stores `denied` and prevents the SDK from ever loading on
that browser.

For visitors outside those regions, analytics is enabled by default,
consistent with US regulatory norms; they can still opt out via the
forthcoming Privacy Settings link in the footer.

The timezone check is intentionally coarse — it can be circumvented by
a user changing their timezone — but it is used **only to decide
whether to show the banner**, never as a primary identifier. The
combination of self-hosted PostHog, no IP storage, no session replay,
no autocapture, and the PII strip means even a misclassified visitor
has nothing personally identifiable captured.

## 6. End-to-end verification

The following manual test was performed against a local static server
serving the repository root:

1. Open `http://localhost:8123/` in Chrome.
2. Confirm the consent banner does **not** show (US timezone) **OR**
   that it does show (EU/UK/CA timezone) and that no network request
   to the PostHog host occurs until "Allow analytics" is clicked.
3. In DevTools console:
   - `CDAnalytics._taxonomy` returns the six allowed event names.
   - `CDAnalytics._scrubPayload({ email: 'a@b.com', note: 'call me at 555-123-4567' })`
     returns `{ note: 'call me at [redacted-phone]' }` — the `email`
     key is dropped entirely and the phone number is masked.
   - `CDAnalytics.track('page_view', {})` runs without error.
   - `CDAnalytics.track('not_in_taxonomy', {})` logs a warning and
     drops the event.
4. Navigate to `/calculators/slu.html`, type into any input, click the
   "Calculate" button, and confirm `calculator_started` and
   `calculator_completed` events appear in the in-page console (and,
   once the self-hosted PostHog instance is live, in the PostHog
   project).
5. Submit a form on `/subscribe/` with an email address and confirm
   `email_signup` fires with **no email value in the payload**.
6. Submit a form on `/share-your-story/` and confirm `story_submitted`
   fires.

## 7. Internal dashboard

`analytics-dashboard.html` (in the repo root) is a marketing-only view
that links to the relevant PostHog dashboards once the self-hosted
instance is live. It is not linked from the public navigation and is
intended to be reached directly by Joel and the marketing team.

## 8. Change control

Any change to `js/analytics.js` — particularly any change that adds an
event, loosens the PII strip, or changes the PostHog host or project
key — requires updating this document in the same commit.
