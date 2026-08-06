#!/usr/bin/env node
/**
 * a11y-audit.mjs — WCAG 2.1 AA gate, axe-core driven, running in a real browser.
 *
 * WHY A BROWSER AND NOT jsdom
 * Every accessibility defect found in this repo by hand needed COMPUTED styles to see:
 *   - a filled <a> whose label inherited the sitewide link colour and rendered
 *     orange-on-orange, invisible, because `.dir-cta` (0,1,0) lost to
 *     `body.tcd-skinned a` (0,1,1);
 *   - primary buttons pairing the accent fill with navy rather than white;
 *   - text over semi-transparent fills, where contrast depends on what composites
 *     underneath.
 * jsdom computes none of that and would have reported all three clean. Playwright is a
 * devDependency for exactly this reason.
 *
 * WHY A BASELINE
 * A gate that is red on the day it lands gets ignored — this repo has already lost two
 * weeks to a CI check nobody read. So the audit fails on NEW violations only, and
 * records existing debt explicitly in a11y/baseline.json where it can be burned down
 * deliberately. `npm run a11y:baseline` re-records; the diff shows exactly what was
 * accepted, so accepting debt is a reviewable act rather than a silent one.
 *
 * DEPLOY SAFETY
 * playwright and axe-core are devDependencies. vercel.json sets installCommand to a
 * no-op and declares no buildCommand, and nothing served at deploy time imports
 * node_modules, so this cannot affect a production deploy.
 *
 * WHAT THIS DOES NOT CATCH — verified, not assumed
 * axe covers roughly a third of real accessibility defects, and this gate inherits that
 * limit. Demonstrated blind spot: an <input> with only a placeholder and no label is NOT
 * flagged, under the WCAG tags or by the label-family rules directly, because placeholder
 * maps to an accessible name per accname. WCAG 3.3.2 still wants a persistent label.
 * Removing aria-label from the chat input was red-teamed and passed clean.
 * Treat a green run as "no regression in the automatable class", not as "accessible".
 *
 *   node scripts/a11y-audit.mjs                 audit, compare to baseline
 *   node scripts/a11y-audit.mjs --update        rewrite the baseline
 *   node scripts/a11y-audit.mjs --url <origin>  audit a live origin instead of local
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'a11y', 'baseline.json');
const UPDATE = process.argv.includes('--update');
const urlFlag = process.argv.indexOf('--url');
const LIVE_ORIGIN = urlFlag !== -1 ? process.argv[urlFlag + 1] : null;

/**
 * Coverage is chosen by SKIN and by accent family, not by traffic — a contrast bug
 * lives in a token, so one page per palette catches it. Add a page here when a new
 * palette appears, not when a new page does.
 */
const TARGETS = [
  { path: '/',                          note: 'cover dark skin + --ac alias' },
  { path: '/attorneys',                 note: 'attorney dark skin' },
  { path: '/learn',                     note: 'attorney dark skin, content-heavy' },
  { path: '/directory',                 note: 'light skin, directory index' },
  { path: '/directory/joel-george-mays', note: 'light skin, listing + intake widget', widget: true },
  { path: '/connect-with-attorney',     note: 'light skin, --ac aliases --skin-accent' },
  { path: '/pricing',                   note: '--ac #4f8ff7 family' },
  { path: '/auth/login',                note: '--ac + JS-injected disclaimer button' },
  { path: '/settlement-calculator',     note: '--ac + alpha-composited surfaces' },
  { path: '/webinars',                  note: 'light skin, owner-named surface' },
];

// Rules we hold the line on. Everything axe reports is recorded, but only these fail
// the build — they are the ones tied to the WCAG 2.1 AA criteria this site is claiming.
const GATING_IMPACTS = new Set(['serious', 'critical']);

// ── zero-dependency static server mimicking vercel cleanUrls ────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const candidates = clean.endsWith('/')
    ? [path.join(clean, 'index.html')]
    : [clean, clean + '.html', path.join(clean, 'index.html')];
  for (const c of candidates) {
    const abs = path.join(ROOT, c);
    if (abs.startsWith(ROOT) && fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = resolveFile(req.url === '/' ? '/index.html' : req.url);
      if (!file) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ── audit ───────────────────────────────────────────────────────────────────
const { chromium } = await import('playwright');
// Resolve through Node rather than assuming node_modules sits beside this file — it
// does not when the repo is checked out as a git worktree, where resolution walks up
// to the parent clone.
const { default: axe } = await import('axe-core');
const axeSource = axe.source;

let server = null, origin = LIVE_ORIGIN;
if (!origin) { const s = await startServer(); server = s.server; origin = `http://127.0.0.1:${s.port}`; }

const browser = await chromium.launch();
const results = {};
let hardError = null;

try {
  for (const t of TARGETS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const url = origin + t.path;
    try {
      const resp = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      if (resp && resp.status() >= 400) {
        results[t.path] = { error: `HTTP ${resp.status()}` };
        await page.close(); continue;
      }
      // DETERMINISM. A first pass used waitUntil:'domcontentloaded' and node counts
      // drifted between runs (/attorneys 11 vs 16, /learn 45 vs 54) because webfonts and
      // late CSS had not applied yet, and axe measures RENDERED text. A gate that fails
      // intermittently is worse than no gate — this repo has already lost two weeks to a
      // CI check people learned to ignore. So: wait for load, for fonts, for the
      // network to go quiet, then settle.
      await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      // The intake widget is injected ~1200ms after load and is a major interactive
      // surface; auditing the page before it exists would miss it entirely.
      if (t.widget) {
        await page.waitForSelector('.cdc-panel, .cdc-bubble', { timeout: 8000 }).catch(() => {});
      }
      await page.waitForTimeout(900);
      await page.addScriptTag({ content: axeSource });
      const r = await page.evaluate(async () =>
        await window.axe.run(document, {
          resultTypes: ['violations'],
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        }));
      results[t.path] = {
        note: t.note,
        violations: r.violations.map((v) => ({
          id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
          sample: v.nodes.slice(0, 2).map((n) => (n.target || []).join(' ')),
        })),
      };
    } catch (e) {
      results[t.path] = { error: String(e).slice(0, 200) };
    }
    await page.close();
  }
} catch (e) {
  hardError = e;
} finally {
  await browser.close();
  if (server) server.close();
}
if (hardError) { console.error('audit aborted:', hardError); process.exit(2); }

// ── compare against baseline ────────────────────────────────────────────────
const key = (p, v) => `${p} :: ${v.id}`;
const current = {};
for (const [p, r] of Object.entries(results)) {
  for (const v of (r.violations || [])) current[key(p, v)] = v.nodes;
}

if (UPDATE) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify({
    _comment: 'Accepted a11y debt. The gate fails on NEW violations and on any increase '
      + 'in node count. Burn entries down; do not add without saying why in the commit.',
    recorded: new Date().toISOString().slice(0, 10),
    accepted: current,
  }, null, 2) + '\n');
  console.log(`baseline written: ${Object.keys(current).length} accepted violation type(s)`);
}

const baseline = fs.existsSync(BASELINE)
  ? (JSON.parse(fs.readFileSync(BASELINE, 'utf8')).accepted || {}) : {};

const brandNew = [], worsened = [], fixed = [];
for (const [k, nodes] of Object.entries(current)) {
  if (!(k in baseline)) brandNew.push([k, nodes]);
  else if (nodes > baseline[k]) worsened.push([k, baseline[k], nodes]);
}
for (const k of Object.keys(baseline)) if (!(k in current)) fixed.push(k);

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\naxe-core WCAG 2.1 AA — ${TARGETS.length} page(s) via ${origin}\n`);
for (const [p, r] of Object.entries(results)) {
  if (r.error) { console.log(`  ${p}\n     ERROR ${r.error}`); continue; }
  const g = (r.violations || []).filter((v) => GATING_IMPACTS.has(v.impact));
  console.log(`  ${p.padEnd(30)} ${String((r.violations || []).length).padStart(2)} violation type(s)`
    + `  (${g.length} serious/critical)   ${r.note}`);
  for (const v of (r.violations || [])) {
    console.log(`      ${(v.impact || 'n/a').padEnd(8)} ${v.id.padEnd(28)} ${v.nodes} node(s)  ${v.help}`);
  }
}

if (fixed.length) {
  console.log(`\n  ${fixed.length} baseline entr(ies) no longer reproduce — rerun with --update to drop them:`);
  fixed.slice(0, 10).forEach((k) => console.log(`      fixed: ${k}`));
}

const gatingNew = brandNew.filter(([k]) => {
  const [p, id] = k.split(' :: ');
  const v = (results[p].violations || []).find((x) => x.id === id);
  return v && GATING_IMPACTS.has(v.impact);
});

if (gatingNew.length || worsened.length) {
  console.log('\nFAIL — new or worsened accessibility violations:');
  gatingNew.forEach(([k, n]) => console.log(`  ✗ NEW       ${k}  (${n} node(s))`));
  worsened.forEach(([k, was, now]) => console.log(`  ✗ WORSENED  ${k}  ${was} -> ${now} node(s)`));
  console.log('\nFix them, or if the change is deliberate run `npm run a11y:baseline` and');
  console.log('explain the acceptance in the commit message.');
  process.exit(1);
}

const nonGating = brandNew.length - gatingNew.length;
console.log(`\nPASS — no new serious/critical violations.`
  + (nonGating > 0 ? `  (${nonGating} new minor/moderate recorded, not gating)` : ''));
process.exit(0);
