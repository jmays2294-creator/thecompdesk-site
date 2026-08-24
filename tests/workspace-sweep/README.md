# Pro-workspace sweep — Stage 1 of the improvement loop

Nightly, unattended, report-only. Walks the whole signed-in Pro surface in a
real browser as a real signed-in attorney and files what it finds to Supabase
`workspace_improvements` as `status='proposed'`.

```
npm run sweep                 # local repo, Pro + Firm personas, persists
npm run sweep:selftest        # no browser, no network — asserts judge() still works
npm run sweep:live            # against https://thecompdesk.com
node scripts/workspace-sweep.mjs --persona anon --no-persist --headed
```

## First run, on a fresh machine

```
npm install
npx playwright install chromium
cp .env.sweep .env.sweep.bak   # if it already exists
# fill SUPABASE_SERVICE_ROLE_KEY in .env.sweep — without it nothing persists
npm run sweep
```

## What "green" does and does not mean

The run prints a per-tier execution record. A tier that could not execute says
`DID NOT RUN` and downgrades the whole run to `WARN`. **A WARN is not a pass with
an asterisk — it means part of the surface went unmeasured.** The most common
causes, in order:

| symptom | cause | fix |
|---|---|---|
| `browser: DID NOT RUN` | Chromium not installed | `npx playwright install chromium` |
| `auth_pro: DID NOT RUN` | sweep account changed or `.env.sweep` missing | re-seed the account (see the `workspace-e2e-sweep` skill) |
| `persist: DID NOT RUN` | no `SUPABASE_SERVICE_ROLE_KEY` | add it to `.env.sweep`; until then the planner sees nothing |
| `auth via api_fallback` | the **login form** did not work | this is a real P0 — real users have no fallback |

`npm run sweep:selftest` exercises the finding generator and the risk gate with
synthetic probes. It passes with no browser and no network — which is exactly
why it proves nothing about the browser tiers. Read its last line.

## The risk gate

Every finding carries a `risk_class`:

- **safe** — copy, spacing, contrast, headings, empty states, touch targets.
  Auto-approves into a branch at Stage 3.
- **guarded** — anything that could change what a calculator outputs, what a
  tier can reach, or what gets persisted. Waits for Joel's explicit approval.

The default is `guarded`. If you are unsure which a new check produces, you do
not need to decide — leaving it out of the safe list is the correct answer.

## Test accounts

`jmays2294+sweep-pro@` and `jmays2294+sweep-firm@` are synthetic and hold no
real client data. Wipe and re-seed them freely. They exist so the harness never
signs in as a practising attorney with live cases on screen.
