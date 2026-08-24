#!/usr/bin/env node
/**
 * workspace-sweep.mjs — Stage 1 of the Pro-workspace improvement loop.
 *
 * Walks the whole signed-in Pro surface in a real browser, as a real signed-in
 * attorney, and records what is broken, blank, noisy, or incoherent. Writes
 * findings to Supabase workspace_improvements as status='proposed' and opens a
 * row in workspace_e2e_runs.
 *
 * REPORT-ONLY. It never edits site code, never commits, never deploys. The only
 * writes it performs are the two telemetry-adjacent tables above.
 *
 * ─── "DID NOT RUN" IS NOT "PASS" ───────────────────────────────────────────
 * Every tier records its own execution state. If sign-in fails, if Playwright's
 * browsers are missing, if the service-role key is absent — that tier reports
 * did_not_run and the whole run downgrades to WARN. It never reports green for
 * a check that did not execute. This project has been burned five separate
 * times by a check that measured a proxy and printed PASS; this file is written
 * to not be the sixth.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * USAGE
 *   node scripts/workspace-sweep.mjs                  # local repo, both personas
 *   node scripts/workspace-sweep.mjs --url https://thecompdesk.com
 *   node scripts/workspace-sweep.mjs --persona pro    # one persona
 *   node scripts/workspace-sweep.mjs --no-persist     # print, do not write to Supabase
 *   node scripts/workspace-sweep.mjs --headed         # watch it work
 *
 * CREDENTIALS
 * Read from .env.sweep at the repo root (gitignored). Never hardcode them here
 * and never echo them: this script's output goes into a report Joel may paste.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './lib/static-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGV = process.argv.slice(2);
const flag = (name) => ARGV.includes(name);
const opt = (name, dflt = null) => {
  const i = ARGV.indexOf(name);
  return i === -1 ? dflt : ARGV[i + 1];
};

const LIVE_ORIGIN = opt('--url');
const PERSONA_FILTER = opt('--persona');
const PERSIST = !flag('--no-persist');
const HEADED = flag('--headed');
const OUT_DIR = path.join(ROOT, 'tests', 'workspace-sweep', 'reports');
const SHOT_DIR = path.join(OUT_DIR, 'screens');

// ── env ─────────────────────────────────────────────────────────────────────
function loadEnv() {
  const f = path.join(ROOT, '.env.sweep');
  const env = { ...process.env };
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  }
  return env;
}
const ENV = loadEnv();
const SUPABASE_URL = ENV.SUPABASE_URL || 'https://ltibymvlytodkemdeeox.supabase.co';
const SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY || '';

const PERSONAS = [
  { id: 'pro',  label: 'Pro attorney',  email: ENV.SWEEP_PRO_EMAIL,  password: ENV.SWEEP_PRO_PASSWORD },
  { id: 'firm', label: 'Firm admin',    email: ENV.SWEEP_FIRM_EMAIL, password: ENV.SWEEP_FIRM_PASSWORD },
  // Opt-in only (--persona anon). Two uses: it is how a first-time visitor
  // meets the workspace demo, and it is the only way to exercise this harness
  // somewhere without network access to Supabase — which is how it gets tested
  // before it is trusted.
  { id: 'anon', label: 'Anonymous visitor', anonymous: true },
].filter((p) => PERSONA_FILTER ? p.id === PERSONA_FILTER : !p.anonymous);

/**
 * Routes. Chosen to cover the whole signed-in Pro surface Joel scoped: the
 * workspace canvas, every Pro calculator, the dashboard, the account/billing
 * page, and the upgrade path a free user meets. Add a route when a new SURFACE
 * appears, not when a new page does — one page per distinct layout is what
 * finds layout bugs.
 */
const ROUTES = [
  { path: '/workspace',              surface: 'workspace',   critical: true,  note: 'the canvas — the product' },
  { path: '/dashboard',              surface: 'dashboard',   critical: true },
  { path: '/dashboard/my-cases',     surface: 'dashboard',   critical: true,  note: 'the 2026-08-05 hang lived here' },
  { path: '/calculators',            surface: 'calculators' },
  { path: '/calculators/pro',        surface: 'calculators', critical: true },
  { path: '/calculators/slu',        surface: 'calculators', critical: true },
  { path: '/calculators/lwec',       surface: 'calculators' },
  { path: '/calculators/ccp-award',  surface: 'calculators', critical: true },
  { path: '/calculators/aww',        surface: 'calculators' },
  { path: '/calculators/rates',      surface: 'calculators' },
  { path: '/calculators/radiculopathy', surface: 'calculators' },
  { path: '/calculators/spine-brain',   surface: 'calculators' },
  { path: '/settlement-calculator',  surface: 'calculators' },
  { path: '/account',                surface: 'account',     critical: true },
  { path: '/for-attorneys',          surface: 'upgrade' },
  { path: '/pricing',                surface: 'upgrade' },
];

// Tiles the workspace advertises. Each is opened and asserted to render
// something other than the error boundary.
const TILE_TYPES = [
  'CCP', 'LWEC', 'RateLookup', 'Burns', 'Settlement', 'MTG', 'DateCalc',
  'SLU', 'Radiculopathy', 'SLURom', 'NonSchedule', 'Apportionment',
];

// Console noise that is known, understood, and not worth a finding every night.
// Add to this ONLY with a reason — an ignore list is how a real error goes
// unnoticed for a month.
const CONSOLE_ALLOW = [
  /Download the React DevTools/i,
  /\[vercel\/analytics\]/i,
  /Failed to load resource.*favicon/i,
  /google.*gtag/i,
];

const tiers = {};          // name -> 'ran' | 'did_not_run'
const findings = [];
const notes = [];

function tier(name, state, why) {
  tiers[name] = { state, why: why || null };
  if (state === 'did_not_run') notes.push(`tier ${name}: DID NOT RUN — ${why}`);
}

function finding(f) {
  // risk_class is the tiered-approval contract. Anything that could change what
  // a calculator OUTPUTS, what a tier can REACH, or what gets PERSISTED is
  // 'guarded' and waits for Joel. Everything else is auto-approvable polish.
  const guardedSurface = /calc|fee|tier|paywall|persist|sync|auth|billing/i;
  const guardedCategory = /correctness|security|billing|persistence/i;
  const risk_class =
    (f.risk_class) ? f.risk_class
      : (guardedCategory.test(f.category || '') || guardedSurface.test(f.title || '')) ? 'guarded'
        : (f.category === 'copy' || f.category === 'a11y' || f.category === 'cohesion') ? 'safe'
          : 'guarded';
  findings.push({ ...f, risk_class });
}

// ── Supabase writes (service_role; RLS is bypassed deliberately) ────────────
async function sb(pathname, method, body, extraHeaders = {}) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      Prefer: 'return=representation',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${pathname} -> ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ── page checks ─────────────────────────────────────────────────────────────
async function auditPage(page, route, persona, origin) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  const onConsole = (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (CONSOLE_ALLOW.some((re) => re.test(t))) return;
    consoleErrors.push(t.slice(0, 300));
  };
  const onPageError = (e) => pageErrors.push(String(e).slice(0, 300));
  const onFailed = (req) => {
    const u = req.url();
    if (/favicon|analytics|gtag|doubleclick/i.test(u)) return;
    failedRequests.push(`${req.method()} ${u.slice(0, 160)}`);
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onFailed);

  const started = Date.now();
  let status = null;
  try {
    const resp = await page.goto(origin + route.path, { waitUntil: 'load', timeout: 45000 });
    status = resp ? resp.status() : null;
  } catch (e) {
    page.off('console', onConsole); page.off('pageerror', onPageError); page.off('requestfailed', onFailed);
    return { route, persona, error: String(e).slice(0, 200), consoleErrors, pageErrors, failedRequests };
  }

  // Same determinism discipline as the a11y gate: fonts, then network quiet,
  // then settle. Anything less and "blank screen" reports are coin flips.
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(700);

  const probe = await page.evaluate(() => {
    const vis = (el) => {
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.01;
    };
    const text = (document.body.innerText || '').trim();
    const headings = [...document.querySelectorAll('h1,h2,h3')].map((h) => h.tagName + ':' + (h.innerText || '').trim().slice(0, 60));
    const h1s = document.querySelectorAll('h1').length;
    const spinners = [...document.querySelectorAll('[class*="spinner"],[class*="loading"],[class*="skeleton"]')].filter(vis).length;
    const stuckText = /verifying|loading|please wait/i.test(text.slice(0, 400));
    const buttons = [...document.querySelectorAll('button,a[role="button"],.btn')].filter(vis);
    const tinyTargets = buttons.filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.width < 44 || r.height < 44); }).length;
    const overflowX = document.documentElement.scrollWidth > window.innerWidth + 2;
    const emptyLinks = [...document.querySelectorAll('a[href="#"],a:not([href])')].filter(vis).length;
    return {
      textLen: text.length, headings, h1s, spinners, stuckText,
      buttons: buttons.length, tinyTargets, overflowX, emptyLinks,
      title: document.title || '',
      firstText: text.slice(0, 160),
    };
  });

  const ms = Date.now() - started;
  const shot = path.join(SHOT_DIR, `${persona.id}__${route.path.replace(/\W+/g, '_') || 'root'}.png`);
  await page.screenshot({ path: shot, fullPage: false }).catch(() => {});

  page.off('console', onConsole); page.off('pageerror', onPageError); page.off('requestfailed', onFailed);
  return { route, persona, status, ms, probe, consoleErrors, pageErrors, failedRequests, shot };
}

function judge(r) {
  const where = `${r.route.path} (${r.persona.label})`;
  let failed = false;

  if (r.error) {
    finding({ title: `Route fails to load: ${r.route.path}`, surface: r.route.surface, route: r.route.path,
      category: 'correctness', severity: 'P0', risk_class: 'guarded',
      problem: `Navigating to ${where} threw before the page settled.`,
      evidence: r.error, proposal: 'Reproduce locally and fix the load failure before anything else in this batch.' });
    return true;
  }
  if (r.status && r.status >= 400) {
    finding({ title: `HTTP ${r.status} on ${r.route.path}`, surface: r.route.surface, route: r.route.path,
      category: 'correctness', severity: 'P0', risk_class: 'guarded',
      problem: `${where} returned HTTP ${r.status}.`, evidence: `status=${r.status}`,
      proposal: 'Fix the route or remove the link that points at it.' });
    return true;
  }

  const p = r.probe || {};
  // Blank screen: the failure class that shipped to the App Store twice.
  if (p.textLen < 120) {
    finding({ title: `Near-blank render: ${r.route.path}`, surface: r.route.surface, route: r.route.path,
      category: 'correctness', severity: 'P0', risk_class: 'guarded',
      problem: `${where} rendered ${p.textLen} characters of visible text. That is a blank screen to a user.`,
      evidence: `first text: ${JSON.stringify(p.firstText)}; console: ${r.consoleErrors.slice(0, 2).join(' | ')}`,
      proposal: 'Find the throw that stopped the render. Guard the dispatch so a failing component degrades to a message rather than nothing.' });
    failed = true;
  }
  if (p.stuckText && p.spinners > 0) {
    finding({ title: `Stuck loading state: ${r.route.path}`, surface: r.route.surface, route: r.route.path,
      category: 'correctness', severity: 'P0', risk_class: 'guarded',
      problem: `${where} still shows a spinner and loading copy after network idle + 700ms.`,
      evidence: `spinners=${p.spinners}; text starts ${JSON.stringify(p.firstText)}`,
      proposal: 'This is the shape of the 2026-08-05 "Verifying your subscription…" hang. Check for a dangling import or an await that never resolves.' });
    failed = true;
  }
  if (r.pageErrors.length) {
    finding({ title: `Uncaught error on ${r.route.path}`, surface: r.route.surface, route: r.route.path,
      category: 'correctness', severity: 'P1', risk_class: 'guarded',
      problem: `${where} threw ${r.pageErrors.length} uncaught error(s).`,
      evidence: r.pageErrors.slice(0, 3).join(' | '),
      proposal: 'Fix the throw. An uncaught error is a render the user did not get.' });
    failed = true;
  }
  if (r.consoleErrors.length) {
    finding({ title: `Console errors on ${r.route.path}`, surface: r.route.surface, route: r.route.path,
      category: 'correctness', severity: 'P2',
      problem: `${where} logged ${r.consoleErrors.length} console error(s).`,
      evidence: r.consoleErrors.slice(0, 3).join(' | '),
      proposal: 'Fix or explicitly allow-list with a reason. Console noise is how a real error hides.' });
  }
  if (r.failedRequests.length) {
    finding({ title: `Failed requests on ${r.route.path}`, surface: r.route.surface, route: r.route.path,
      category: 'correctness', severity: 'P2',
      problem: `${r.failedRequests.length} request(s) failed on ${where}.`,
      evidence: r.failedRequests.slice(0, 3).join(' | '),
      proposal: 'Broken asset or endpoint. Fix the reference.' });
  }
  if (p.h1s === 0) {
    finding({ title: `No <h1> on ${r.route.path}`, surface: r.route.surface, route: r.route.path,
      category: 'a11y', severity: 'P3', risk_class: 'safe',
      problem: `${where} has no level-1 heading, so screen readers and search engines cannot tell what the page is.`,
      evidence: `headings: ${(p.headings || []).slice(0, 4).join(', ') || 'none'}`,
      proposal: 'Add a single descriptive <h1> naming the page.' });
  } else if (p.h1s > 1) {
    finding({ title: `${p.h1s} <h1> elements on ${r.route.path}`, surface: r.route.surface, route: r.route.path,
      category: 'a11y', severity: 'P3', risk_class: 'safe',
      problem: `${where} has ${p.h1s} level-1 headings; the document outline is ambiguous.`,
      evidence: (p.headings || []).slice(0, 5).join(', '),
      proposal: 'Keep one <h1>; demote the rest to <h2>.' });
  }
  if (p.overflowX) {
    finding({ title: `Horizontal overflow on ${r.route.path}`, surface: r.route.surface, route: r.route.path,
      category: 'cohesion', severity: 'P2', risk_class: 'safe',
      problem: `${where} scrolls sideways at 1280px — something is wider than the viewport.`,
      evidence: 'documentElement.scrollWidth > innerWidth',
      proposal: 'Find the overflowing element and give it max-width:100% or its own overflow-x:auto container.' });
  }
  if (p.tinyTargets > 0) {
    finding({ title: `${p.tinyTargets} sub-44px targets on ${r.route.path}`, surface: r.route.surface, route: r.route.path,
      category: 'a11y', severity: 'P3', risk_class: 'safe',
      problem: `${where} has ${p.tinyTargets} interactive element(s) under the 44×44 touch target minimum.`,
      evidence: `buttons scanned: ${p.buttons}`,
      proposal: 'Pad the controls to 44×44 minimum. Attorneys use this on tablets in hearing rooms.' });
  }
  if (!p.title || p.title.length < 8) {
    finding({ title: `Weak <title> on ${r.route.path}`, surface: r.route.surface, route: r.route.path,
      category: 'copy', severity: 'P3', risk_class: 'safe',
      problem: `${where} has the title ${JSON.stringify(p.title)}.`,
      evidence: `length ${(p.title || '').length}`,
      proposal: 'Write a specific page title — it is the tab label and the search result headline.' });
  }
  if (r.ms > 6000 && r.route.critical) {
    finding({ title: `Slow settle on ${r.route.path} (${(r.ms / 1000).toFixed(1)}s)`, surface: r.route.surface, route: r.route.path,
      category: 'performance', severity: 'P2',
      problem: `${where} took ${(r.ms / 1000).toFixed(1)}s to reach a settled state on a local server with no network latency.`,
      evidence: `ms=${r.ms}`,
      proposal: 'Profile the boot path. On a real connection this is materially worse than it looks here.' });
  }
  return failed;
}

// ── workspace-specific: does every advertised tile actually render? ─────────
async function sweepTiles(page, persona, origin) {
  const results = [];
  try {
    await page.goto(origin + '/workspace', { waitUntil: 'load', timeout: 45000 });
    await page.waitForSelector('#root .canvas, #root', { timeout: 25000 });
    await page.waitForTimeout(2500); // React bundle is Babel-transformed in-browser
  } catch (e) {
    tier('workspace_tiles', 'did_not_run', `workspace canvas never appeared: ${String(e).slice(0, 120)}`);
    return results;
  }

  for (const type of TILE_TYPES) {
    let r = { type, opened: false, rendered: false, paywalled: false, error: null };
    try {
      // The palette items are buttons/draggables labelled with the spec name.
      // Click by the data attribute when present, else by accessible name.
      const clicked = await page.evaluate((t) => {
        const byData = document.querySelector(`[data-palette-type="${t}"]`);
        if (byData) { byData.click(); return true; }
        const specs = window.TILE_SPECS || {};
        const name = specs[t] && specs[t].name;
        if (!name) return false;
        const el = [...document.querySelectorAll('.palette-item, [draggable="true"], button')]
          .find((n) => (n.innerText || '').trim().toLowerCase().includes(String(name).toLowerCase()));
        if (el) { el.click(); return true; }
        return false;
      }, type);
      r.opened = clicked;
      if (!clicked) { r.error = 'palette entry not found'; results.push(r); continue; }

      await page.waitForTimeout(600);
      const state = await page.evaluate((t) => {
        const tile = document.querySelector(`[data-tile-type="${t}"]`);
        const paywall = document.querySelector('.paywall, [class*="paywall"]');
        if (!tile) return { rendered: false, paywalled: !!paywall, text: 0, boundary: false };
        const txt = (tile.innerText || '').trim();
        return {
          rendered: txt.length > 40,
          paywalled: !!paywall,
          text: txt.length,
          boundary: /unavailable|something went wrong|could not render|error/i.test(txt.slice(0, 200)),
        };
      }, type);
      r.rendered = state.rendered && !state.boundary;
      r.paywalled = state.paywalled;
      r.textLen = state.text;
      r.boundary = state.boundary;

      // Clean up so tiles do not accumulate and skew the next check.
      await page.evaluate((t) => {
        const tile = document.querySelector(`[data-tile-type="${t}"]`);
        const close = tile && tile.querySelector('.tile-close');
        if (close) close.click();
        const pw = document.querySelector('.paywall button, [class*="paywall"] button');
        if (pw) pw.click();
      }, type).catch(() => {});
      await page.waitForTimeout(250);
    } catch (e) {
      r.error = String(e).slice(0, 160);
    }
    results.push(r);
  }

  tier('workspace_tiles', 'ran');

  for (const r of results) {
    if (r.paywalled) continue; // a Pro gate firing is correct behaviour, not a defect
    if (!r.opened) {
      finding({ title: `Palette entry missing for ${r.type}`, surface: 'workspace', route: '/workspace',
        category: 'discoverability', severity: 'P1', risk_class: 'guarded',
        problem: `The ${r.type} tile is declared in TILE_SPECS but the sweep could not find a way to add it from the palette as ${persona.label}.`,
        evidence: r.error || 'no matching palette element',
        proposal: 'Either surface it in the palette or remove it from TILE_SPECS. A tile that exists but cannot be reached is worse than no tile.' });
    } else if (r.boundary) {
      finding({ title: `${r.type} tile renders its error boundary`, surface: 'workspace', route: '/workspace',
        category: 'correctness', severity: 'P0', risk_class: 'guarded',
        problem: `Adding ${r.type} as ${persona.label} produced the error-boundary state instead of the calculator.`,
        evidence: `text length ${r.textLen}`,
        proposal: 'Fix the throw inside the tile component. This is a paid feature returning nothing.' });
    } else if (!r.rendered) {
      finding({ title: `${r.type} tile renders empty`, surface: 'workspace', route: '/workspace',
        category: 'correctness', severity: 'P1', risk_class: 'guarded',
        problem: `${r.type} mounted as ${persona.label} but produced ${r.textLen || 0} characters — effectively an empty box.`,
        evidence: `rendered=${r.rendered} textLen=${r.textLen}`,
        proposal: 'Check the component returns markup for its default (empty-input) state.' });
    }
  }
  return results;
}

// ── sign-in ─────────────────────────────────────────────────────────────────
/**
 * Signs in through the site's OWN login form, so the sweep exercises the door
 * as well as the rooms. Records HOW it got in — a token-injection fallback is
 * still a valid session for the rest of the sweep, but it means the login form
 * itself did not work, which is a P0 finding in its own right.
 */
async function signIn(page, persona, origin) {
  if (persona.anonymous) return { ok: true, via: 'anonymous' };
  if (!persona.email || !persona.password) {
    return { ok: false, via: 'none', why: 'credentials missing from .env.sweep' };
  }
  try {
    await page.goto(origin + '/auth/login', { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(800);
    const emailSel = 'input[type="email"], input[name="email"], #email';
    const passSel = 'input[type="password"], input[name="password"], #password';
    await page.waitForSelector(emailSel, { timeout: 10000 });
    await page.fill(emailSel, persona.email);
    await page.fill(passSel, persona.password);
    await Promise.all([
      page.waitForTimeout(3500),
      page.click('button[type="submit"], form button').catch(() => {}),
    ]);
    const signedIn = await page.evaluate((key) => {
      try { return !!localStorage.getItem(key); } catch (e) { return false; }
    }, 'sb-ltibymvlytodkemdeeox-auth-token');
    if (signedIn) return { ok: true, via: 'login_form' };
  } catch (e) {
    // fall through to the API path
  }

  // Fallback: mint a session via the auth API and plant it in localStorage.
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ENV.SUPABASE_ANON_KEY || ANON_FALLBACK },
      body: JSON.stringify({ email: persona.email, password: persona.password }),
    });
    if (!r.ok) return { ok: false, via: 'none', why: `auth API ${r.status}` };
    const session = await r.json();
    await page.goto(origin + '/', { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(([key, s]) => {
      localStorage.setItem(key, JSON.stringify(s));
    }, ['sb-ltibymvlytodkemdeeox-auth-token', session]);
    return { ok: true, via: 'api_fallback' };
  } catch (e) {
    return { ok: false, via: 'none', why: String(e).slice(0, 160) };
  }
}

const ANON_FALLBACK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0aWJ5bXZseXRvZGtlbWRlZW94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjA1NjYsImV4cCI6MjA5MDM5NjU2Nn0.b5oQqQIdgJRc0DEP2k7kMVdCRzfyfnuAwjVNZlbVyak';

// ── self-test ───────────────────────────────────────────────────────────────
/**
 * `--self-test` exercises judge() against synthetic page probes, with no
 * browser and no network. It exists because this harness is written in an
 * environment that cannot launch Chromium, and a finding-generator that has
 * never been run is a finding-generator nobody should trust. It asserts both
 * directions: that each defect shape produces the finding it should, AND that a
 * healthy page produces none.
 */
if (flag('--self-test')) {
  const healthy = {
    route: { path: '/workspace', surface: 'workspace', critical: true },
    persona: { id: 'pro', label: 'Pro attorney' },
    status: 200, ms: 900,
    probe: { textLen: 4200, headings: ['H1:Workspace'], h1s: 1, spinners: 0, stuckText: false,
      buttons: 30, tinyTargets: 0, overflowX: false, emptyLinks: 0, title: 'Pro Workspace — The Comp Desk', firstText: 'Workspace' },
    consoleErrors: [], pageErrors: [], failedRequests: [],
  };
  const cases = [
    ['healthy page yields nothing', healthy, 0],
    ['blank render', { ...healthy, probe: { ...healthy.probe, textLen: 12 } }, 1],
    ['stuck spinner', { ...healthy, probe: { ...healthy.probe, spinners: 2, stuckText: true, firstText: 'Verifying your subscription…' } }, 1],
    ['uncaught error', { ...healthy, pageErrors: ['TypeError: x is not a function'] }, 1],
    ['http 500', { ...healthy, status: 500 }, 1],
    ['no h1', { ...healthy, probe: { ...healthy.probe, h1s: 0 } }, 1],
    ['overflow', { ...healthy, probe: { ...healthy.probe, overflowX: true } }, 1],
    ['nav failure', { route: healthy.route, persona: healthy.persona, error: 'net::ERR_ABORTED', consoleErrors: [], pageErrors: [], failedRequests: [] }, 1],
  ];
  let bad = 0;
  for (const [name, input, expected] of cases) {
    findings.length = 0;
    judge(input);
    const got = findings.length;
    const ok = got === expected;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(28)} expected ${expected} finding(s), got ${got}`
      + (got ? `  [${findings.map((f) => f.severity + '/' + f.risk_class).join(', ')}]` : ''));
  }
  // The tiered gate is the thing that decides what ships without Joel looking.
  // Assert its direction explicitly rather than trusting the heuristic.
  findings.length = 0;
  judge({ ...healthy, probe: { ...healthy.probe, textLen: 10 } });
  const blankRisk = findings[0] && findings[0].risk_class;
  findings.length = 0;
  judge({ ...healthy, probe: { ...healthy.probe, h1s: 0 } });
  const h1Risk = findings[0] && findings[0].risk_class;
  const gateOk = blankRisk === 'guarded' && h1Risk === 'safe';
  if (!gateOk) bad++;
  console.log(`  ${gateOk ? 'ok  ' : 'FAIL'}  risk gate                     blank=${blankRisk} (want guarded), missing-h1=${h1Risk} (want safe)`);
  console.log(bad ? `\n  SELF-TEST FAILED (${bad})\n` : '\n  SELF-TEST PASSED — judge() and the risk gate behave. This says NOTHING about the browser tiers.\n');
  process.exit(bad ? 1 : 0);
}

// ── main ────────────────────────────────────────────────────────────────────
fs.mkdirSync(SHOT_DIR, { recursive: true });

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  tier('browser', 'did_not_run', 'playwright not installed — run: npm i && npx playwright install chromium');
  console.error('\nSWEEP DID NOT RUN — playwright is unavailable.\n' + notes.join('\n'));
  process.exit(2);
}

let server = null;
let origin = LIVE_ORIGIN;
if (!origin) {
  const s = await startServer(ROOT);
  server = s;
  origin = s.origin;
}

let siteSha = '';
try {
  const { execSync } = await import('node:child_process');
  siteSha = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
} catch (e) { siteSha = 'unknown'; }

let browser = null;
let routesTotal = 0, routesPass = 0, routesFail = 0, consoleErrorCount = 0;
const perRoute = [];

try {
  browser = await chromium.launch({ headless: !HEADED });
  tier('browser', 'ran');

  for (const persona of PERSONAS) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    const auth = await signIn(page, persona, origin);
    if (!auth.ok) {
      tier(`auth_${persona.id}`, 'did_not_run', auth.why);
      finding({ title: `Cannot sign in as ${persona.label}`, surface: 'account', route: '/auth/login',
        category: 'correctness', severity: 'P0', risk_class: 'guarded',
        problem: `The sweep could not establish a session for ${persona.label}, so the entire signed-in surface went unchecked for that persona.`,
        evidence: auth.why || 'unknown',
        proposal: 'Fix sign-in or re-seed the sweep account. Until this passes, treat every "no findings" result for this persona as unmeasured, not clean.' });
      await ctx.close();
      continue;
    }
    tier(`auth_${persona.id}`, 'ran', `via ${auth.via}`);
    if (auth.via === 'api_fallback') {
      finding({ title: 'Login form did not complete sign-in', surface: 'account', route: '/auth/login',
        category: 'correctness', severity: 'P0', risk_class: 'guarded',
        problem: `Submitting the login form as ${persona.label} did not produce a session; the sweep had to mint one through the auth API to continue.`,
        evidence: 'no auth token in localStorage after form submit + 3.5s',
        proposal: 'Reproduce by hand. Real users have no API fallback — if this is real, nobody can sign in.' });
    }

    for (const route of ROUTES) {
      routesTotal++;
      const r = await auditPage(page, route, persona, origin);
      perRoute.push(r);
      consoleErrorCount += (r.consoleErrors || []).length;
      const failed = judge(r);
      if (failed) routesFail++; else routesPass++;
    }
    tier(`routes_${persona.id}`, 'ran');

    await sweepTiles(page, persona, origin);

    await ctx.close();
  }
} catch (e) {
  tier('sweep', 'did_not_run', String(e).slice(0, 200));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close().catch(() => {});
}

// ── verdict ─────────────────────────────────────────────────────────────────
const didNotRun = Object.entries(tiers).filter(([, v]) => v.state === 'did_not_run');
const p0 = findings.filter((f) => f.severity === 'P0').length;
const p1 = findings.filter((f) => f.severity === 'P1').length;
const status = p0 > 0 ? 'fail' : (didNotRun.length > 0 ? 'warn' : (p1 > 0 ? 'warn' : 'pass'));

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const reportPath = path.join(OUT_DIR, `sweep_${stamp}.json`);
fs.writeFileSync(reportPath, JSON.stringify({
  origin, siteSha, status, tiers, notes,
  counts: { routesTotal, routesPass, routesFail, consoleErrorCount, findings: findings.length, p0, p1 },
  findings,
  routes: perRoute.map((r) => ({
    path: r.route.path, persona: r.persona.id, status: r.status, ms: r.ms,
    consoleErrors: r.consoleErrors, pageErrors: r.pageErrors, textLen: r.probe && r.probe.textLen,
  })),
}, null, 2) + '\n');

console.log(`\nPro-workspace sweep — ${origin} @ ${siteSha}\n`);
for (const [name, v] of Object.entries(tiers)) {
  console.log(`  ${v.state === 'ran' ? 'ran        ' : 'DID NOT RUN'}  ${name}${v.why ? '  (' + v.why + ')' : ''}`);
}
console.log(`\n  routes ${routesPass}/${routesTotal} clean · ${consoleErrorCount} console error(s) · ${findings.length} finding(s) (${p0} P0, ${p1} P1)`);
for (const f of findings.slice(0, 40)) {
  console.log(`    ${f.severity}  ${f.risk_class.padEnd(7)}  ${f.title}`);
}
console.log(`\n  report: ${path.relative(ROOT, reportPath)}`);

// ── persist ─────────────────────────────────────────────────────────────────
if (!PERSIST) {
  tier('persist', 'did_not_run', '--no-persist requested');
  console.log('\n  (not persisted — --no-persist)');
} else if (!SERVICE_KEY) {
  tier('persist', 'did_not_run', 'SUPABASE_SERVICE_ROLE_KEY absent from .env.sweep');
  console.log('\n  NOT PERSISTED — no service-role key. The planner will see nothing tonight.');
} else {
  try {
    const [run] = await sb('workspace_e2e_runs', 'POST', [{
      kind: 'full_sweep', surface: 'pro_web', origin, site_sha: siteSha,
      runner: LIVE_ORIGIN ? 'chrome_attended' : 'playwright_local',
      browser: 'chromium', started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      status, routes_total: routesTotal, routes_pass: routesPass, routes_fail: routesFail,
      console_errors: consoleErrorCount, tiers, report_path: path.relative(ROOT, reportPath),
      summary: { p0, p1, findings: findings.length, notes },
    }]);
    if (findings.length) {
      await sb('workspace_improvements', 'POST', findings.map((f) => ({
        run_id: run.id, source: 'sweep', title: f.title.slice(0, 200), surface: f.surface,
        route: f.route, category: f.category, severity: f.severity, risk_class: f.risk_class,
        problem: f.problem, evidence: f.evidence, proposal: f.proposal, status: 'proposed',
      })));
    }
    tier('persist', 'ran');
    console.log(`  persisted: run ${run.id} · ${findings.length} proposed improvement(s)`);
  } catch (e) {
    tier('persist', 'did_not_run', String(e).slice(0, 200));
    console.error('  PERSIST FAILED:', String(e).slice(0, 300));
  }
}

const finalDidNotRun = Object.entries(tiers).filter(([, v]) => v.state === 'did_not_run');
if (finalDidNotRun.length) {
  console.log('\n  WARN — one or more tiers did not run. This is not a clean sweep:');
  finalDidNotRun.forEach(([n, v]) => console.log(`    ${n}: ${v.why}`));
}
console.log(`\n  VERDICT: ${status.toUpperCase()}\n`);
process.exit(status === 'fail' ? 1 : 0);
