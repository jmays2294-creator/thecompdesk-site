#!/usr/bin/env node
/**
 * check-tile-routes.mjs — no dashboard tile may point at a page that isn't here.
 *
 * Why this exists
 * ───────────────
 * On 2026-08-04 /dashboard shipped two tiles whose screen ids no route handled.
 * They rendered, invited a click, and did nothing at all — no navigation, no
 * error, no feedback. The only reason anyone noticed was a manual click.
 *
 * js/dashboard-tiles.js filters unrouted tiles at RENDER time and logs. This is
 * the other half: a BUILD-time assertion that every destination in the manifest
 * resolves to a real file on disk, and that every profession's default set is
 * non-empty and references only ids the manifest defines.
 *
 * It also warns (without failing) when a destination is a live page carrying a
 * "Coming soon" badge — shipping a default tile that opens a placeholder is not
 * a dead click, but it is not a feature either.
 *
 * Usage:  node scripts/check-tile-routes.mjs
 * Exit:   0 = every tile routes · 1 = at least one dangling or empty set
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'js', 'dashboard-tiles.js');

/**
 * Evaluate the manifest in a bare sandbox. It is a classic browser script that
 * assigns to `window`, so a stub window is all it needs — no DOM, no network.
 */
function loadManifest() {
  const src = readFileSync(MANIFEST, 'utf8');
  const win = {};
  // eslint-disable-next-line no-new-func
  new Function('window', src)(win);
  if (!win.TCDProTiles) throw new Error('js/dashboard-tiles.js did not define window.TCDProTiles');
  return win.TCDProTiles;
}

/** Mirror how the static host resolves a URL path to a file. */
function resolvePath(href) {
  const clean = href.split('?')[0].split('#')[0].replace(/\/$/, '');
  const abs = join(ROOT, clean);
  if (existsSync(abs)) {
    try { if (statSync(abs).isDirectory()) return existsSync(join(abs, 'index.html')) ? join(abs, 'index.html') : null; }
    catch { return null; }
    return abs;
  }
  if (existsSync(`${abs}.html`)) return `${abs}.html`;
  if (existsSync(join(abs, 'index.html'))) return join(abs, 'index.html');
  return null;
}

/** A page whose visible copy advertises itself as unfinished. */
function looksLikePlaceholder(file) {
  try {
    const t = readFileSync(file, 'utf8');
    return />\s*Coming soon\s*</i.test(t) || /class="[^"]*\bcoming-soon\b/i.test(t);
  } catch { return false; }
}

const tiles = loadManifest();
const errors = [];
const warnings = [];

// 1. Every route's destination must exist on disk.
const resolved = new Map();
for (const [id, spec] of Object.entries(tiles.ROUTES)) {
  if (!spec || !spec.href) { errors.push(`ROUTES.${id} has no href`); continue; }
  const file = resolvePath(spec.href);
  if (!file) { errors.push(`ROUTES.${id} → ${spec.href} does not resolve to any file`); continue; }
  resolved.set(id, file);
  if (looksLikePlaceholder(file)) {
    warnings.push(`ROUTES.${id} → ${spec.href} is a live page but shows a "Coming soon" badge`);
  }
  for (const field of ['label', 'desc', 'g']) {
    if (!spec[field]) errors.push(`ROUTES.${id} is missing "${field}"`);
  }
}

// 2. Every default set must be non-empty and reference only defined ids.
for (const [profession, ids] of Object.entries(tiles.DEFAULTS)) {
  if (!Array.isArray(ids) || ids.length === 0) {
    errors.push(`DEFAULTS.${profession} is empty — that would render a blank dashboard`);
    continue;
  }
  ids.forEach((id) => {
    if (!tiles.ROUTES[id]) errors.push(`DEFAULTS.${profession} references unknown tile id "${id}"`);
  });
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) warnings.push(`DEFAULTS.${profession} repeats: ${[...new Set(dupes)].join(', ')}`);
}

// 3. The fallback must itself be a defined, non-empty set — it is the last line
//    of defence against an empty dashboard.
if (!tiles.DEFAULTS[tiles.FALLBACK] || !tiles.DEFAULTS[tiles.FALLBACK].length) {
  errors.push(`FALLBACK "${tiles.FALLBACK}" is not a non-empty set in DEFAULTS`);
}

// 4. Every profession in the DB CHECK constraint should have a set, or it will
//    silently inherit the fallback. Warn rather than fail — inheriting is safe.
const DB_PROFESSIONS = [
  'attorney', 'paralegal', 'settlement_coordinator', 'legal_assistant',
  'case_manager', 'adjuster', 'other',
];
DB_PROFESSIONS.forEach((p) => {
  if (!tiles.DEFAULTS[p]) warnings.push(`profession "${p}" has no default set — will fall back to "${tiles.FALLBACK}"`);
});

// ── Report ──────────────────────────────────────────────────────────────
const nRoutes = Object.keys(tiles.ROUTES).length;
const nSets = Object.keys(tiles.DEFAULTS).length;

for (const w of warnings) console.warn(`  ⚠ ${w}`);

if (errors.length) {
  console.error(`\n✗ check:tiles — ${errors.length} problem(s):`);
  for (const e of errors) console.error(`    ${e}`);
  console.error('\n  A tile whose destination does not exist renders, invites a click, and');
  console.error('  does nothing. That is the 2026-08-04 defect. Fix the manifest.\n');
  process.exit(1);
}

console.log(`✓ check:tiles — ${nRoutes} tile route(s) resolve, ${nSets} profession set(s) valid` +
            (warnings.length ? ` (${warnings.length} warning(s))` : ''));
process.exit(0);
