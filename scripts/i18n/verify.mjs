#!/usr/bin/env node
/**
 * Site-side translation gate. Modelled on the app's scripts/verify-translations.mjs, with
 * one check the app does not need: catalog values here contain inline HTML, so tag
 * integrity is asserted per string.
 *
 *   node scripts/i18n/verify.mjs [locale ...]      # default: every catalog on disk
 *
 * Exit 1 on any hard failure. Advisory signals are printed but do not fail the run.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../', import.meta.url).pathname);
const I18N = path.join(ROOT, 'i18n');

const flat = (o, p = '', acc = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const K = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object') flat(v, K, acc); else acc[K] = v;
  }
  return acc;
};
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const en = flat(read(path.join(I18N, 'en.json')));
const enKeys = Object.keys(en);
const dnt = read(path.join(I18N, 'glossary.json')).doNotTranslate || [];
const expected = read(path.join(I18N, 'locales.json')).locales
  .filter((l) => l.code !== 'en').map((l) => l.code);

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const locales = wanted.length ? wanted
  : expected.filter((c) => fs.existsSync(path.join(I18N, `${c}.json`)));

const tagBag = (s) => [...String(s).matchAll(/<\/?([a-z][a-z0-9]*)\b/gi)].map((m) => m[1].toLowerCase()).sort().join(',');
const phBag = (s) => [...String(s).matchAll(/\{([A-Za-z0-9_][\w.-]*)\}/g)].map((m) => m[1]).sort().join(',');
const wordRe = (t) => new RegExp(`(?<![A-Za-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`);

let hardFail = 0;
console.log(`en.json: ${enKeys.length} keys · checking ${locales.length} locale(s)\n`);

for (const code of locales) {
  const p = path.join(I18N, `${code}.json`);
  if (!fs.existsSync(p)) { console.log(`${code.padEnd(8)} MISSING catalog`); hardFail++; continue; }
  const t = flat(read(p));

  const missing = enKeys.filter((k) => typeof t[k] !== 'string' || t[k] === '');
  const extra = Object.keys(t).filter((k) => !(k in en));
  const tagDrift = enKeys.filter((k) => typeof t[k] === 'string' && t[k] !== '' && tagBag(en[k]) !== tagBag(t[k]));
  const phDrift = enKeys.filter((k) => typeof t[k] === 'string' && t[k] !== '' && phBag(en[k]) !== phBag(t[k]));
  const dntLost = enKeys.filter((k) => typeof t[k] === 'string' && t[k] !== '' &&
    dnt.some((term) => wordRe(term).test(en[k]) && !wordRe(term).test(t[k])));
  const identical = enKeys.filter((k) => typeof t[k] === 'string' && t[k] === en[k] && en[k].split(/\s+/).length > 3);

  const bad = missing.length || extra.length || tagDrift.length || phDrift.length || dntLost.length;
  if (bad) hardFail++;

  console.log(`${code.padEnd(8)} ${bad ? 'FAIL' : 'PASS'}  ` +
    `${enKeys.length - missing.length}/${enKeys.length} translated · ` +
    `missing ${missing.length} · extra ${extra.length} · tag-drift ${tagDrift.length} · ` +
    `placeholder-drift ${phDrift.length} · DNT-lost ${dntLost.length} · identical-to-en ${identical.length}`);

  const show = (label, arr) => arr.slice(0, 5).forEach((k) => console.log(`           ${label}: ${k}`));
  show('missing', missing); show('extra', extra); show('tag-drift', tagDrift);
  show('placeholder-drift', phDrift); show('DNT-lost', dntLost);
}

const absent = expected.filter((c) => !fs.existsSync(path.join(I18N, `${c}.json`)));
if (absent.length) console.log(`\nnot yet generated: ${absent.join(' ')}`);

console.log(hardFail ? `\nFAIL — ${hardFail} locale(s) have hard failures.` : '\nPASS — all checked locales are complete and intact.');
process.exit(hardFail ? 1 : 0);
