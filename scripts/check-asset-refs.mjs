#!/usr/bin/env node
/**
 * check-asset-refs.mjs — dangling asset reference guard.
 *
 * Why this exists
 * ───────────────
 * Twice now we have shipped HTML that references a file which is not in the
 * repository:
 *
 *   • 2026-08-04 — four `<script src>` tags on /dashboard pointing at scripts
 *     that were never here. Each one 404'd; the page half-worked.
 *   • 2026-08-05 — `dashboard/my-cases.html` statically imported
 *     `../js/calc-history-sync.js`, which had never existed. Because a failed
 *     ESM specifier kills the ENTIRE module, the page hung on its "Verifying
 *     your subscription…" overlay forever, for every visitor, at every tier.
 *
 * A missing `<script src>` degrades one feature. A missing ESM import
 * specifier takes down the whole page. Both are invisible in code review and
 * both are trivially detectable on disk, which is what this script does.
 *
 * What it checks, per .html file:
 *   1. <script src="…">        (root-absolute and relative)
 *   2. <link href="…">         (root-absolute and relative)
 *   3. <img src="…">           (root-absolute and relative)
 *   4. ESM `import`/`export … from '…'` specifiers inside
 *      <script type="module">, plus dynamic `import('…')`
 *
 * ...and, per .js file reachable as a module from the above, the same ESM
 * specifier check, recursively — a dangling import two hops deep kills the
 * entry module just as dead as one at the top.
 *
 * Deliberately NOT checked: absolute http(s):// URLs (CDN, third-party),
 * protocol-relative //, data:, blob:, mailto:, tel:, #fragments, and Vercel's
 * synthetic /_vercel/* endpoints, which exist only at runtime.
 *
 * Usage:  node scripts/check-asset-refs.mjs [--json]
 * Exit:   0 = all references resolve · 1 = at least one dangling reference
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.vercel', 'dist', 'build', '.next', 'coverage',
]);

/** Reference targets we intentionally do not resolve against the filesystem. */
function isExternal(spec) {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(spec) ||   // http:, https:, data:, mailto:, tel:, blob:
    spec.startsWith('//') ||                // protocol-relative
    spec.startsWith('#') ||                 // in-page fragment
    spec.startsWith('{{') ||                // template placeholder
    spec.includes('${') ||                  // JS template literal, not a static ref
    spec.trim() === ''
  );
}

/**
 * A *module* specifier that is neither relative nor root-absolute is a "bare"
 * specifier — `import 'three'` — resolved by <script type="importmap">, not by
 * the filesystem. Flagging those would make the guard cry wolf, and a guard
 * that cries wolf gets ignored, which is how we got here in the first place.
 *
 * This applies ONLY to ESM specifiers. In HTML, src="js/foo.js" with no leading
 * "./" is an ordinary relative path and must still be checked.
 */
function isBareModuleSpecifier(spec) {
  return !/^[./]/.test(spec);
}

/** Vercel injects these at request time; they are never on disk. */
function isRuntimeSynthetic(spec) {
  return spec.startsWith('/_vercel/');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Resolve a reference to an on-disk path.
 * Root-absolute ("/js/x.js") resolves against the repo root, matching how
 * Vercel serves this static site. Relative resolves against the referrer.
 */
function resolveRef(spec, fromFile) {
  const clean = spec.split('?')[0].split('#')[0];
  if (!clean) return null;
  return clean.startsWith('/')
    ? join(ROOT, clean)
    : resolve(dirname(fromFile), clean);
}

/**
 * A path "exists" if the file is there, or — for extensionless/trailing-slash
 * URLs — if it resolves to a directory index.html, which is how the static
 * host serves /calculators/ and friends.
 */
function refExists(abs, spec) {
  if (existsSync(abs)) {
    try {
      if (statSync(abs).isDirectory()) return existsSync(join(abs, 'index.html'));
    } catch { return false; }
    return true;
  }
  // "/foo" with no extension may be served as /foo.html or /foo/index.html
  if (!extname(spec.split('?')[0])) {
    return existsSync(`${abs}.html`) || existsSync(join(abs, 'index.html'));
  }
  return false;
}

// ── Extractors ──────────────────────────────────────────────────────────

const RE_SCRIPT_SRC = /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
const RE_LINK_HREF  = /<link\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi;
const RE_IMG_SRC    = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
const RE_MODULE_BLOCK = /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>([\s\S]*?)<\/script>/gi;

/** `import … from 'x'`, bare `import 'x'`, `export … from 'x'`, `import('x')`. */
const RE_ESM_FROM    = /(?:^|[\s;}])(?:import|export)\s[\s\S]*?\sfrom\s*["']([^"']+)["']/g;
const RE_ESM_BARE    = /(?:^|[\s;}])import\s*["']([^"']+)["']/g;
const RE_ESM_DYNAMIC = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Strip HTML comments before scanning. Commented-out markup is not shipped, and
 * prose inside a comment can legitimately contain things that look like tags —
 * a comment explaining a module script would otherwise be parsed as one.
 */
function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

function matchAll(re, text) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

function esmSpecifiers(code) {
  return [
    ...matchAll(RE_ESM_FROM, code),
    ...matchAll(RE_ESM_BARE, code),
    ...matchAll(RE_ESM_DYNAMIC, code),
  ];
}

/** Line number of the first occurrence of a specifier, for a clickable report. */
function lineOf(text, spec) {
  const idx = text.indexOf(spec);
  if (idx === -1) return 1;
  return text.slice(0, idx).split('\n').length;
}

// ── Scan ────────────────────────────────────────────────────────────────

const findings = [];
const jsToScan = new Map();   // absolute .js path → referrer (for reporting)
const jsScanned = new Set();

function record(kind, file, spec, line, note) {
  findings.push({
    kind,
    file: relative(ROOT, file),
    spec,
    line,
    ...(note ? { note } : {}),
  });
}

function checkSpec(kind, file, text, spec, { isModule }) {
  if (isExternal(spec) || isRuntimeSynthetic(spec)) return;
  if (isModule && isBareModuleSpecifier(spec)) return;
  const abs = resolveRef(spec, file);
  if (!abs) return;

  if (!refExists(abs, spec)) {
    record(
      kind, file, spec, lineOf(text, spec),
      isModule ? 'ESM import — a failed specifier kills the entire module' : undefined,
    );
    return;
  }
  // Follow local module graph so a dangling import two hops deep is caught.
  if (isModule && abs.endsWith('.js') && !jsToScan.has(abs)) {
    jsToScan.set(abs, relative(ROOT, file));
  }
}

const allFiles = walk(ROOT);
const htmlFiles = allFiles.filter(f => f.endsWith('.html'));

for (const file of htmlFiles) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  // Comments are blanked (newlines preserved) so reported line numbers stay true.
  text = stripHtmlComments(text);

  for (const spec of matchAll(RE_SCRIPT_SRC, text)) checkSpec('script src', file, text, spec, { isModule: false });
  for (const spec of matchAll(RE_LINK_HREF, text))  checkSpec('link href',  file, text, spec, { isModule: false });
  for (const spec of matchAll(RE_IMG_SRC, text))    checkSpec('img src',    file, text, spec, { isModule: false });

  // <script type="module" src="…"> targets are module graph roots too.
  RE_MODULE_BLOCK.lastIndex = 0;
  let block;
  while ((block = RE_MODULE_BLOCK.exec(text)) !== null) {
    for (const spec of esmSpecifiers(block[1])) {
      checkSpec('esm import', file, text, spec, { isModule: true });
    }
  }
  // Module scripts loaded via src= — queue their graph.
  const modSrcRe = /<script\b(?=[^>]*\btype\s*=\s*["']module["'])[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
  for (const spec of matchAll(modSrcRe, text)) {
    if (isExternal(spec) || isRuntimeSynthetic(spec)) continue;
    const abs = resolveRef(spec, file);
    if (abs && abs.endsWith('.js') && existsSync(abs) && !jsToScan.has(abs)) {
      jsToScan.set(abs, relative(ROOT, file));
    }
  }
}

// Recursively walk the reachable local module graph.
while (jsToScan.size > jsScanned.size) {
  for (const [jsFile] of [...jsToScan]) {
    if (jsScanned.has(jsFile)) continue;
    jsScanned.add(jsFile);
    let code;
    try { code = readFileSync(jsFile, 'utf8'); } catch { continue; }
    for (const spec of esmSpecifiers(code)) {
      checkSpec('esm import', jsFile, code, spec, { isModule: true });
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: findings.length === 0, findings }, null, 2));
  process.exit(findings.length ? 1 : 0);
}

const scanned = `${htmlFiles.length} HTML file(s), ${jsScanned.size} reachable JS module(s)`;

if (findings.length === 0) {
  console.log(`✓ check:refs — every reference resolves (${scanned}).`);
  process.exit(0);
}

// Group by file so the report reads like a punch list.
const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

console.error(`✗ check:refs — ${findings.length} dangling reference(s) across ${byFile.size} file(s). Scanned ${scanned}.\n`);

const fatal = findings.filter(f => f.kind === 'esm import');
if (fatal.length) {
  console.error(`  ⚠ ${fatal.length} of these are ESM imports. Each one prevents its ENTIRE`);
  console.error(`    <script type="module"> block from executing — not just one feature.\n`);
}

for (const [file, list] of [...byFile].sort()) {
  console.error(`  ${file}`);
  for (const f of list.sort((a, b) => a.line - b.line)) {
    console.error(`    ${String(f.line).padStart(5)}  [${f.kind}] ${f.spec}`);
    if (f.note) console.error(`           ↳ ${f.note}`);
  }
  console.error('');
}

process.exit(1);
