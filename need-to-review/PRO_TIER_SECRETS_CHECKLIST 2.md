# Pro Tier — Env Var Checklist

Complete this checklist tonight before flipping `PRO_ENABLED = true`.

---

## 1. Stripe secrets (set via Supabase dashboard → Edge Functions → Secrets)

| Variable | Value | Status |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` (test mode) | ⬜ pending |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from Stripe dashboard | ⬜ pending |
| `STRIPE_PRO_PRICE_ID` | `price_...` from test product Joel creates | ⬜ pending |

### How to set:
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_... \
  --project-ref ltibymvlytodkemdeeox

supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_... \
  --project-ref ltibymvlytodkemdeeox

supabase secrets set STRIPE_PRO_PRICE_ID=price_... \
  --project-ref ltibymvlytodkemdeeox
```

---

## 2. Stripe dashboard setup

- [ ] Create product: **The Comp Desk Pro** in TEST mode
- [ ] Create price: `$19.00 / month`, recurring, with 14-day trial
- [ ] Copy the `price_...` ID → set as `STRIPE_PRO_PRICE_ID` above
- [ ] Create webhook endpoint pointing to:
  ```
  https://ltibymvlytodkemdeeox.supabase.co/functions/v1/user-stripe-webhook
  ```
- [ ] Select events to listen for:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- [ ] Copy the `whsec_...` signing secret → set as `STRIPE_WEBHOOK_SECRET` above

---

## 3. Flip the paywall on

In `js/featureFlags.js`, change:
```js
export const PRO_ENABLED = false;
```
to:
```js
export const PRO_ENABLED = true;
```

Commit and push — the pricing page will immediately show live CTAs and `requirePro()` will gate free users.

---

## 4. Stripe Customer Portal

- [ ] Enable Customer Portal in Stripe dashboard (Billing → Customer portal)
- [ ] Set return URL to `https://thecompdesk.com/account`
- [ ] Wire `openPortal()` in `account/index.html` to call your backend endpoint that creates a portal session

---

## 5. Apply migration + deploy edge function

The migration SQL and edge function are committed. Apply them via either path:

**Option A — GitHub Actions (recommended)**
Add two secrets to the repo (Settings → Secrets → Actions):
```
SUPABASE_ACCESS_TOKEN   = sbp_...   (from supabase.com/dashboard/account/tokens)
SUPABASE_PROJECT_ID     = ltibymvlytodkemdeeox
```
The workflow `.github/workflows/supabase-deploy.yml` will then run automatically on every push to `main` that touches `supabase/`.

**Option B — Manual (one-time)**
```bash
# Install CLI if needed: https://supabase.com/docs/guides/cli
supabase login
supabase db push --project-ref ltibymvlytodkemdeeox
supabase functions deploy user-stripe-webhook --project-ref ltibymvlytodkemdeeox --no-verify-jwt
```

**Option C — Supabase Dashboard SQL editor**
Paste the contents of `supabase/migrations/20260407000000_pro_tier_subscriptions.sql`
into the SQL editor at: https://supabase.com/dashboard/project/ltibymvlytodkemdeeox/sql

---

## 6. Verification checklist

- [ ] `requirePro()` throws 402 for a free user (unit test in `js/entitlements.js`)
- [ ] Magic-link email arrives and `/auth/callback` redirects to `/account`
- [ ] `/account` shows `tier: free` for new signup
- [ ] Stripe test checkout → `/account` shows `tier: pro`
- [ ] `customer.subscription.deleted` → `/account` shows `tier: free`
- [ ] `/pricing` shows "Start 14-day free trial" CTA (not "Coming soon")
- [ ] Zero Stripe keys in git: `git grep sk_test` should return nothing

---

## Edge function endpoint

```
https://ltibymvlytodkemdeeox.supabase.co/functions/v1/user-stripe-webhook
```

Will return `500 STRIPE_WEBHOOK_SECRET not configured` until the secret is set — this is expected and acceptable until tonight.
