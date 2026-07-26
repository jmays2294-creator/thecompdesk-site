#!/usr/bin/env node
/**
 * Merge a translated chunk back into a locale catalog — but only after it passes the
 * checks that matter. Anything that fails is REJECTED and left untranslated, so the next
 * chunk.mjs call hands it back out. A bad translation never reaches disk.
 *
 *   node scripts/i18n/merge.mjs --locale es --in /tmp/chunk.es.json
 *
 * Rejects a string when it:
 *   - is not present in en.json (invented key)
 *   - is empty, or byte-identical to English for anything longer than a couple of words
 *   - loses or gains an inline HTML tag (the multiset must match exactly)
 *   - drops a {placeholder}
 *   - drops a do-not-translate token that English carried (word-bounded, so "Pro" inside
 *     "Profile" is not a false positive — that one cost the app project a debug cycle)
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../', import.meta.url).pathname);
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const locale = arg('locale');
const inFile = arg('in');
if (!locale || !inFile) { console.error('usage: merge.mjs --locale <code> --in <file.json>'); process.exit(1); }

const flat = (o, p = '', acc = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const K = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object') flat(v, K, acc); else acc[K] = v;
  }
  return acc;
};
const nest = (flatObj) => {
  const out = {};
  for (const [k, v] of Object.entries(flatObj)) {
    const parts = k.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) cur = (cur[parts[i]] ||= {});
    cur[parts[parts.length - 1]] = v;
  }
  return out;
};

const en = flat(JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/en.json'), 'utf8')));
const tgtPath = path.join(ROOT, 'i18n', `${locale}.json`);
const tgt = fs.existsSync(tgtPath) ? flat(JSON.parse(fs.readFileSync(tgtPath, 'utf8'))) : {};
const incoming = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const dnt = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/glossary.json'), 'utf8')).doNotTranslate || [];

const tagBag = (s) => [...String(s).matchAll(/<\/?([a-z][a-z0-9]*)\b/gi)].map((m) => m[1].toLowerCase()).sort().join(',');
const phBag = (s) => [...String(s).matchAll(/\{([A-Za-z0-9_][\w.-]*)\}/g)].map((m) => m[1]).sort().join(',');
const wordRe = (t) => new RegExp(`(?<![A-Za-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`);

let ok = 0;
const rejected = [];

for (const [k, v] of Object.entries(incoming)) {
  const src = en[k];
  if (typeof src !== 'string') { rejected.push([k, 'key not in en.json']); continue; }
  if (typeof v !== 'string' || v.trim() === '') { rejected.push([k, 'empty']); continue; }
  if (tagBag(src) !== tagBag(v)) { rejected.push([k, `inline HTML changed (${tagBag(src) || 'none'} -> ${tagBag(v) || 'none'})`]); continue; }
  if (phBag(src) !== phBag(v)) { rejected.push([k, 'placeholder set changed']); continue; }
  const lost = dnt.filter((t) => wordRe(t).test(src) && !wordRe(t).test(v));
  if (lost.length) { rejected.push([k, `do-not-translate token lost: ${lost.join(', ')}`]); continue; }
  if (v === src && src.split(/\s+/).length > 3) { rejected.push([k, 'identical to English']); continue; }
  tgt[k] = v;
  ok++;
}

fs.writeFileSync(tgtPath, JSON.stringify(nest(tgt), null, 2) + '\n');

const total = Object.keys(en).length;
const done = Object.keys(en).filter((k) => typeof tgt[k] === 'string' && tgt[k] !== '').length;
console.log(`merged ${ok} · rejected ${rejected.length} · ${locale} now ${done}/${total}`);
for (const [k, why] of rejected.slice(0, 20)) console.log(`  REJECTED ${k} — ${why}`);
if (rejected.length > 20) console.log(`  …and ${rejected.length - 20} more`);
