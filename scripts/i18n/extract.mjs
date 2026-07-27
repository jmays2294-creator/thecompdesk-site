/**
 * Phase 3B extractor for thecompdesk-site.
 *
 * Pass 1  collect every translatable unit from the routed pages (no writes)
 * Pass 2  assign final keys, collapsing strings that repeat across pages into shared.*
 * Pass 3  annotate the ENGLISH sources in place and emit i18n/en.json + i18n/.slots.json
 *
 * Annotation splices into the original bytes using parse5 source locations; the document
 * is never re-serialized, so English formatting is preserved byte-for-byte outside the
 * attributes actually added.
 *
 * Two outputs, two consumers:
 *   i18n/en.json      the catalog the generator translates
 *   i18n/.slots.json  byte ranges in each ANNOTATED English file + that file's sha256,
 *                     so scripts/i18n/build-locales.mjs can substitute by offset without
 *                     needing an HTML parser (the repo stays dependency-free), and refuses
 *                     to run against a source that changed since extraction.
 *
 * The data-i18n attributes are not used by the static build — they exist for the
 * cookie-only pages (auth, 404), which have no locale URL and must translate client-side.
 *
 *   node extract.mjs [--dry]
 */
import { parse } from 'parse5';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = '/Users/joel/Code/thecompdesk-site';
const DRY = process.argv.includes('--dry');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/pages.json'), 'utf8'));

const INLINE = new Set(['a', 'b', 'strong', 'em', 'i', 'span', 'br', 'small', 'sup', 'sub',
  'u', 'mark', 'abbr', 'time', 'wbr', 'code', 'kbd', 'q', 'cite', 'bdi', 'bdo', 'del', 'ins']);
const SKIP = new Set(['script', 'style', 'svg', 'noscript', 'template', 'head', 'html',
  'pre', 'textarea', 'iframe', 'canvas', 'video', 'audio', 'source', 'track', 'math']);
const ATTRS = ['alt', 'placeholder', 'aria-label', 'title', 'aria-placeholder'];

const isProse = (s) => {
  const t = s.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
  if (t.length < 2 || !/[A-Za-z]/.test(t)) return false;
  if (/^\d[\d\s.,$%/§-]*$/.test(t)) return false;
  if (/^[A-Za-z]$/.test(t)) return false;
  return true;
};

const nsFor = (route) => route === '/' ? 'home'
  : route.replace(/^\//, '').replace(/\/$/, '').replace(/[^A-Za-z0-9/]+/g, '-').split('/').join('.');

const slugFor = (text) => {
  const t = text.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ')
    .replace(/[^A-Za-z0-9\s]/g, ' ').trim().split(/\s+/).slice(0, 5).join('-').toLowerCase();
  return t.slice(0, 44) || 'text';
};

const attrOf = (node, name) => (node.attrs || []).find((a) => a.name === name)?.value;

function* walk(node) {
  for (const c of node.childNodes || []) if (c.tagName) { yield c; yield* walk(c); }
}

function isInlineOnly(node) {
  if (!node.childNodes || !node.childNodes.length) return false;
  let sawText = false;
  for (const c of node.childNodes) {
    if (c.nodeName === '#text') { if (c.value.trim()) sawText = true; continue; }
    if (c.nodeName === '#comment') continue;
    if (!c.tagName || !INLINE.has(c.tagName)) return false;
    if ((c.childNodes || []).some((g) => g.tagName && !INLINE.has(g.tagName))) return false;
    if ((c.childNodes || []).some((g) => g.nodeName === '#text' && g.value.trim())) sawText = true;
  }
  return sawText;
}

const innerRange = (node) => {
  const l = node.sourceCodeLocation;
  if (!l || !l.startTag || !l.endTag) return null;
  return [l.startTag.endOffset, l.endTag.startOffset];
};

/**
 * parse5's attribute location spans `name="value"`, not the value. Narrow it to just the
 * value so a substitution replaces the text and not the attribute name with it.
 */
const attrValueRange = (src, loc) => {
  const seg = src.slice(loc.startOffset, loc.endOffset);
  const eq = seg.indexOf('=');
  if (eq === -1) return null;
  const q = seg[eq + 1];
  if (q !== '"' && q !== "'") return null;                // unquoted attribute: skip
  return [loc.startOffset + eq + 2, loc.startOffset + seg.lastIndexOf(q)];
};

// ── PASS 1: collect ────────────────────────────────────────────────────────

/** units: {file, ns, kind, value, slugBase, tagInsertAt, range?, attr?, jsonPtr?} */
const units = [];

/**
 * IDEMPOTENCE. Re-running the extractor on already-annotated files used to annotate them
 * a second time — 2258 duplicate data-i18n attributes shipped that way on 2026-07-27
 * (harmless, since every duplicate carried an identical value, but invalid HTML).
 * Stripping prior annotations before parsing makes a re-run produce the same output as a
 * first run.
 */
// Exactly ONE leading space, never \s+: annotations are always inserted with a single
// space, and \s+ would swallow the newline in a multi-line start tag — which silently
// reformatted 182 lines of one page before this was caught.
const ANNOT_RE = / (?:data-i18n(?:-attr)?="[^"]*"|data-i18n-jsonld)/g;

/**
 * Slot offsets are measured against the STRIPPED source — generated blocks removed — so
 * that changing the size of a generated block cannot invalidate the whole table.
 * scripts/i18n/build-locales.mjs strips before substituting and re-injects afterwards, so
 * the convention has to live here too or the two disagree and every offset is wrong.
 */
const GENERATED = [
  /[ \t]*<!-- i18n:hreflang[\s\S]*?<!-- \/i18n:hreflang -->\n?/g,
  /[ \t]*<!-- i18n:fonts[\s\S]*?<!-- \/i18n:fonts -->\n?/g,
  /[ \t]*<script src="\/js\/i18n-locale\.js" defer><\/script>\n?/g,
];
const stripGenerated = (h) => GENERATED.reduce((a, re) => a.replace(re, ''), h);
const deannotate = (h) => stripGenerated(h).replace(ANNOT_RE, '');

for (const page of manifest.pages) {
  const src = deannotate(fs.readFileSync(path.join(ROOT, page.file), 'utf8'));
  const doc = parse(src, { sourceCodeLocationInfo: true });
  const ns = nsFor(page.route);

  for (const el of walk(doc)) {
    const tag = el.tagName;
    const loc = el.sourceCodeLocation;
    if (!loc || !loc.startTag) continue;
    const insertAt = loc.startTag.endOffset - (src[loc.startTag.endOffset - 2] === '/' ? 2 : 1);

    if (tag === 'title') {
      const r = innerRange(el);
      if (r) {
        const v = src.slice(r[0], r[1]).trim();
        if (isProse(v)) units.push({ file: page.file, ns, kind: 'text', value: v, slugBase: 'meta.title', tag: 'title', insertAt, range: r });
      }
      continue;
    }

    if (tag === 'meta') {
      const name = (attrOf(el, 'name') || attrOf(el, 'property') || '').toLowerCase();
      const content = attrOf(el, 'content');
      if (content && isProse(content) &&
          /^(description|og:title|og:description|og:image:alt|twitter:title|twitter:description)$/.test(name)) {
        const a = loc.startTag.attrs?.content;
        const vr = a && attrValueRange(src, a);
        // raw source slice, not parse5's decoded value: `&amp;` must stay `&amp;`
        if (vr) units.push({ file: page.file, ns, kind: 'attr', attr: 'content', value: src.slice(vr[0], vr[1]),
          slugBase: `meta.${name.replace(':', '-')}`, insertAt, attrLoc: vr });
      }
      continue;
    }

    if (SKIP.has(tag)) continue;

    for (const a of ATTRS) {
      const v = attrOf(el, a);
      const al = loc.startTag.attrs?.[a];
      const vr = al && attrValueRange(src, al);
      if (v && vr && isProse(v)) {
        units.push({ file: page.file, ns, kind: 'attr', attr: a, value: src.slice(vr[0], vr[1]),
          slugBase: `${slugFor(v)}.${a.replace('aria-', '')}`, insertAt, attrLoc: vr });
      }
    }

    if (isInlineOnly(el)) {
      const r = innerRange(el);
      if (r) {
        const raw = src.slice(r[0], r[1]);
        const v = raw.trim();
        if (isProse(v)) {
          const lead = raw.length - raw.trimStart().length;
          units.push({ file: page.file, ns, kind: 'text', value: v, slugBase: slugFor(v),
            tag, insertAt, range: [r[0] + lead, r[0] + lead + v.length] });
        }
      }
    }
  }

  for (const el of walk(doc)) {
    if (el.tagName !== 'script') continue;
    if ((attrOf(el, 'type') || '').toLowerCase() !== 'application/ld+json') continue;
    const r = innerRange(el);
    if (!r) continue;
    let data; try { data = JSON.parse(src.slice(r[0], r[1])); } catch { continue; }
    const FIELDS = /^(name|description|headline|alternateName|text|about|caption)$/i;
    const visit = (o, ptr) => {
      if (Array.isArray(o)) return o.forEach((v, i) => visit(v, `${ptr}/${i}`));
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        const p = `${ptr}/${k}`;
        if (typeof v === 'string') {
          if (FIELDS.test(k) && isProse(v) && /\s/.test(v)) {
            units.push({ file: page.file, ns, kind: 'jsonld', value: v, slugBase: `jsonld.${slugFor(v)}`,
              insertAt: el.sourceCodeLocation.startTag.endOffset - 1, jsonPtr: p, blockRange: r });
          }
        } else visit(v, p);
      }
    };
    visit(data, '');
  }
}

// ── PASS 1b: keep only the OUTERMOST prose block ───────────────────────────
//
// `<div><span class="eyebrow">For Injured Workers</span><span>I was hurt at work.</span></div>`
// matches isInlineOnly at the div AND at each span. Annotating all three would nest a
// data-i18n attribute inside its own parent's substitution range, so the parent's stored
// English would no longer match the bytes on disk — and the whole block would be
// substituted twice. Keep the outermost: it also gives the translator a full sentence
// with its inline markup instead of disconnected fragments.
{
  const before = units.length;
  const kept = [];
  const byFile = new Map();
  for (const u of units) {
    if (u.kind !== 'text') { kept.push(u); continue; }
    if (!byFile.has(u.file)) byFile.set(u.file, []);
    byFile.get(u.file).push(u);
  }
  for (const [, list] of byFile) {
    list.sort((a, b) => a.range[0] - b.range[0] || b.range[1] - a.range[1]);
    const outer = [];
    for (const u of list) {
      if (outer.some((o) => u.range[0] >= o.range[0] && u.range[1] <= o.range[1])) continue;
      outer.push(u);
    }
    kept.push(...outer);
  }
  units.length = 0;
  units.push(...kept);
  console.log(`dropped ${before - units.length} nested prose block(s); kept the outermost`);

  // An attribute on an element INSIDE a kept prose block cannot have its own slot: the
  // block substitution rewrites that whole range and would clobber it. Its text already
  // travels inside the block's string (`<a title="...">` is part of the value), so the
  // translator still sees it.
  const ranges = new Map();
  for (const u of units) {
    if (u.kind !== 'text') continue;
    if (!ranges.has(u.file)) ranges.set(u.file, []);
    ranges.get(u.file).push(u.range);
  }
  const n0 = units.length;
  const survivors = units.filter((u) => {
    if (u.kind !== 'attr') return true;
    const rs = ranges.get(u.file) || [];
    return !rs.some((r) => u.attrLoc[0] > r[0] && u.attrLoc[1] < r[1]);
  });
  units.length = 0;
  units.push(...survivors);
  console.log(`dropped ${n0 - units.length} attribute slot(s) nested inside a prose block`);
}

// ── PASS 2: assign keys, collapsing repeats into shared.* ──────────────────

const byValue = new Map();
for (const u of units) {
  if (!byValue.has(u.value)) byValue.set(u.value, []);
  byValue.get(u.value).push(u);
}

const catalog = {};
const used = new Set();
const uniqKey = (base) => {
  let k = base, i = 2;
  while (used.has(k)) k = `${base}-${i++}`;
  used.add(k);
  return k;
};

for (const [value, group] of byValue) {
  const pages = new Set(group.map((u) => u.file));
  // A string that appears on more than one page is site chrome or boilerplate: one key,
  // one translation, guaranteed-consistent wording, and it is paid for once.
  const key = pages.size > 1
    ? uniqKey(`shared.${slugFor(value)}`)
    : uniqKey(`${group[0].ns}.${group[0].slugBase}`);
  catalog[key] = value;
  for (const u of group) u.key = key;
}

/**
 * The catalog nests on dots, so no key may be a strict PREFIX of another — `a.b` as a
 * string and `a.b.c` as an object cannot coexist. Rename the shorter one rather than the
 * longer, so the more specific key keeps the more readable name.
 */
{
  const keys = new Set(Object.keys(catalog));
  const prefixes = new Set();
  for (const k of keys) {
    const parts = k.split('.');
    for (let i = 1; i < parts.length; i++) prefixes.add(parts.slice(0, i).join('.'));
  }
  const collisions = [...keys].filter((k) => prefixes.has(k));
  for (const k of collisions) {
    let nk = `${k}.text`, i = 2;
    while (keys.has(nk) || prefixes.has(nk)) nk = `${k}.text-${i++}`;
    keys.delete(k); keys.add(nk);
    catalog[nk] = catalog[k];
    delete catalog[k];
    for (const u of units) if (u.key === k) u.key = nk;
  }
  if (collisions.length) console.log(`resolved ${collisions.length} scalar/object key collision(s)`);
}

// ── Synthetic keys ─────────────────────────────────────────────────────────
//
// Not scraped from any page: injected by build-locales.mjs into the LOCALE copies of the
// legal pages only. English needs no such line — it *is* the governing version. Declared
// here rather than hand-added to en.json so re-running the extractor cannot drop it.
catalog['shared.translationNotice'] =
  'This translation is provided for convenience; the English version governs.';

// ── PASS 3: annotate + emit ────────────────────────────────────────────────

const slots = {};
let annotations = 0;

for (const page of manifest.pages) {
  const abs = path.join(ROOT, page.file);
  const src = deannotate(fs.readFileSync(abs, 'utf8'));
  const mine = units.filter((u) => u.file === page.file);

  // attribute splices (insert into start tags), applied back-to-front
  const attrSplices = [];
  const byInsert = new Map();
  for (const u of mine) {
    if (!byInsert.has(u.insertAt)) byInsert.set(u.insertAt, { text: [], attr: [], jsonld: false });
    const b = byInsert.get(u.insertAt);
    if (u.kind === 'text') b.text.push(u.key);
    else if (u.kind === 'attr') b.attr.push(`${u.attr}:${u.key}`);
    else b.jsonld = true;
  }
  for (const [offset, b] of byInsert) {
    let s = '';
    if (b.text.length) s += ` data-i18n="${b.text[0]}"`;
    if (b.attr.length) s += ` data-i18n-attr="${b.attr.join(',')}"`;
    if (b.jsonld) s += ' data-i18n-jsonld';
    if (s) { attrSplices.push({ offset, text: s }); annotations++; }
  }

  attrSplices.sort((a, b) => b.offset - a.offset);
  let out = src;
  for (const s of attrSplices) out = out.slice(0, s.offset) + s.text + out.slice(s.offset);

  // Recompute substitution ranges against the ANNOTATED bytes: every splice before a
  // range shifts it right by that splice's length.
  const shift = (pos) => attrSplices.reduce((acc, s) => acc + (s.offset <= pos ? s.text.length : 0), 0);
  const fileSlots = [];
  for (const u of mine) {
    if (u.kind === 'text') fileSlots.push({ k: u.key, s: u.range[0] + shift(u.range[0]), e: u.range[1] + shift(u.range[1]), t: u.tag });
    else if (u.kind === 'attr') fileSlots.push({ k: u.key, s: u.attrLoc[0] + shift(u.attrLoc[0]), e: u.attrLoc[1] + shift(u.attrLoc[1]), a: u.attr });
    else fileSlots.push({ k: u.key, s: u.blockRange[0] + shift(u.blockRange[0]), e: u.blockRange[1] + shift(u.blockRange[1]), j: u.jsonPtr });
  }
  fileSlots.sort((a, b) => a.s - b.s);

  if (!DRY) {
    fs.writeFileSync(abs, out);
    slots[page.file] = { sha256: crypto.createHash('sha256').update(out).digest('hex'), slots: fileSlots };
  }
}

const totalKeys = Object.keys(catalog).length;
const sharedKeys = Object.keys(catalog).filter((k) => k.startsWith('shared.')).length;
console.log(`pages ${manifest.pages.length}`);
console.log(`translatable units found: ${units.length}`);
console.log(`catalog keys (deduped):   ${totalKeys}   (${sharedKeys} shared across pages)`);
console.log(`paid-for savings vs per-page keys: ${units.length - totalKeys} strings`);
console.log(`elements annotated: ${annotations}`);

if (!DRY) {
  const nested = {};
  for (const [k, v] of Object.entries(catalog)) {
    const parts = k.split('.');
    let cur = nested;
    for (let i = 0; i < parts.length - 1; i++) cur = (cur[parts[i]] ||= {});
    cur[parts[parts.length - 1]] = v;
  }
  fs.writeFileSync(path.join(ROOT, 'i18n/en.json'), JSON.stringify(nested, null, 2) + '\n');
  fs.writeFileSync(path.join(ROOT, 'i18n/.slots.json'), JSON.stringify(slots, null, 1) + '\n');
  console.log('\nwrote i18n/en.json and i18n/.slots.json');
}
