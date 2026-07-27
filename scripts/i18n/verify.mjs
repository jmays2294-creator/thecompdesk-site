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
const glossary = read(path.join(I18N, 'glossary.json'));
const dnt = glossary.doNotTranslate || [];
const GTERMS = glossary.terms || [];
const expected = read(path.join(I18N, 'locales.json')).locales
  .filter((l) => l.code !== 'en').map((l) => l.code);

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const locales = wanted.length ? wanted
  : expected.filter((c) => fs.existsSync(path.join(I18N, `${c}.json`)));

const tagBag = (s) => [...String(s).matchAll(/<\/?([a-z][a-z0-9]*)\b/gi)].map((m) => m[1].toLowerCase()).sort().join(',');
const phBag = (s) => [...String(s).matchAll(/\{([A-Za-z0-9_][\w.-]*)\}/g)].map((m) => m[1]).sort().join(',');

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whitespace-TOLERANT do-not-translate matcher.
 *
 * The literal-space version could never fire for the `§ 15(3)` family: the glossary
 * writes a space after §, the English copy writes none, so the guard never engaged and
 * the term was silently exempt from checking. Collapsing runs of whitespace to \s* fixes
 * that whole class.
 */
const wordRe = (t) => new RegExp(`(?<![A-Za-z0-9])${esc(t).replace(/\\?\s+/g, '\\s*')}(?![A-Za-z0-9])`);

/**
 * Statutory citations need an ABSENCE check, not just a presence check.
 *
 * The presence check asks "English had this token, did the target keep it?" — which is
 * blind whenever the target rewrote the citation into its own language. `WCL §15(3)(w)`
 * becoming `Sección 15(3)(w) de la WCL` keeps the token `WCL`, so nothing fired, even
 * though `Section`/`§` was translated. That is exactly the failure this catches.
 *
 * Cores come from the glossary itself (`Section 32`, `§ 15(3)`, …) so the rule cannot
 * drift from the DNT list.
 */
const CITE_PREFIX = '(?:Section|Sec\\.|§)\\s*';
function citationCores(dntList) {
  const cores = new Set();
  for (const t of dntList) {
    const m = t.match(/^(?:Section|§)\s*(.+)$/);
    if (m) cores.add(m[1].trim());
  }
  return [...cores];
}
const citeRe = (core) => new RegExp(`(?<![A-Za-z])${CITE_PREFIX}${esc(core)}`);
/** The bare number, so we can tell "citation was rewritten" from "citation absent". */
const bareCoreRe = (core) => new RegExp(`(?<![A-Za-z0-9])${esc(core)}`);

const CORES = citationCores(dnt);

// A DNT entry that matches nothing in en.json can never fire. That is not necessarily a
// bug — some form numbers simply do not appear on this site — but a citation entry that
// is inert because of a formatting mismatch IS one, and it is invisible without this.
{
  const enVals = enKeys.map((k) => en[k]);
  const inert = dnt.filter((term) => !enVals.some((v) => wordRe(term).test(v)));
  if (inert.length) {
    console.log(`note: ${inert.length}/${dnt.length} do-not-translate entries match nothing in en.json, so they never fire:`);
    console.log(`      ${inert.join(' · ')}\n`);
  }
}


/**
 * TERMINOLOGY CONSISTENCY.
 *
 * A glossary concept must render ONE way in a catalog. This is not pedantry: LWEC shipped
 * with four different Spanish renderings across 18 occurrences, which reads to a worker
 * like four different legal concepts.
 *
 * Anchored on the abbreviation rather than on fuzzy string similarity, because the
 * glossary's own register rule produces a reliable shape on first use —
 * `target phrase (English Term, ABBR)` — so the phrase immediately preceding the
 * parenthetical IS the locale's rendering of that concept. Fullwidth parens are matched
 * too, since the CJK catalogs use them.
 *
 * Advisory by default: the locked slots are still unreviewed model output (see the
 * provenance work), so failing the build on them would enforce wording nobody has signed
 * off. Pass --strict-terms to make it blocking once terms are ruled on.
 */
const STRICT_TERMS = process.argv.includes('--strict-terms');

const normTerm = (s) => s
  .replace(/<[^>]*>/g, ' ')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents so case/accent variants collapse
  .toLowerCase()
  .replace(/[«»"'']/g, '')
  .replace(/\s+/g, ' ')
  .replace(/^(?:el|la|los|las|un|una|de|del|le|la|les|un|une|des|the|a|an)\s+/, '')
  .trim();

function terminologyVariants(catalog, terms, code) {
  const report = [];
  for (const t of terms) {
    if (!t.abbr) continue;
    const re = new RegExp(`([^()（）<>.;:!?]{3,90}?)\\s*[（(][^)）]*\\b${esc(t.abbr)}\\s*[)）]`, 'g');
    const nWords = t.term.trim().split(/\s+/).length;
    const seen = new Map();

    /**
     * Keep only the term-sized TAIL of the capture. The regex necessarily grabs back to
     * the previous punctuation, so "Calculadora gratuita del salario semanal promedio"
     * and "Calculadora del salario semanal promedio" would otherwise look like two
     * different renderings of AWW when the rendering is identical in both.
     */
    const tail = (phrase) => {
      const words = phrase.trim().split(/\s+/);
      if (words.length > 1) return words.slice(-Math.max(2, nWords)).join(' ');
      return phrase.trim().slice(-12);          // CJK has no word breaks
    };

    for (const v of Object.values(catalog)) {
      if (typeof v !== 'string') continue;
      for (const m of v.matchAll(re)) {
        const raw = tail(m[1]);
        const norm = normTerm(raw);
        if (!norm || norm.length < 3) continue;
        if (norm === normTerm(t.term)) continue;   // the English term echoed, not a rendering
        if (!seen.has(norm)) seen.set(norm, { count: 0, sample: raw });
        seen.get(norm).count++;
      }
    }
    // A deliberate short form is NOT an inconsistency. The glossary's legalTerms rule
    // asks for the full term on first use and a shortened form after, so any rendering
    // that is a substring of the locale's canonical term is the same term at a different
    // length. Only renderings that fall OUTSIDE the canonical are genuine variants.
    const canon = t.translations && t.translations[code] ? normTerm(t.translations[code]) : null;
    const genuine = [...seen.entries()].filter(([norm]) => !(canon && canon.indexOf(norm) !== -1));
    if (genuine.length > 1 || (genuine.length === 1 && seen.size > 1 && !canon)) {
      report.push({ term: t.term, abbr: t.abbr, variants: genuine.sort((a, b) => b[1].count - a[1].count) });
    }
  }
  return report;
}

let hardFail = 0;
let termWarnings = 0;
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

  // Citation rewritten into the target language: English cited it in DNT form, the
  // target still carries the number but no longer in DNT form.
  const citeTranslated = enKeys.filter((k) => {
    const tv = t[k];
    if (typeof tv !== 'string' || tv === '') return false;
    return CORES.some((c) => citeRe(c).test(en[k]) && bareCoreRe(c).test(tv) && !citeRe(c).test(tv));
  });

  const identical = enKeys.filter((k) => typeof t[k] === 'string' && t[k] === en[k] && en[k].split(/\s+/).length > 3);

  const bad = missing.length || extra.length || tagDrift.length || phDrift.length ||
    dntLost.length || citeTranslated.length;
  if (bad) hardFail++;

  console.log(`${code.padEnd(8)} ${bad ? 'FAIL' : 'PASS'}  ` +
    `${enKeys.length - missing.length}/${enKeys.length} translated · ` +
    `missing ${missing.length} · extra ${extra.length} · tag-drift ${tagDrift.length} · ` +
    `placeholder-drift ${phDrift.length} · DNT-lost ${dntLost.length} · ` +
    `citation-translated ${citeTranslated.length} · identical-to-en ${identical.length}`);

  const show = (label, arr) => arr.slice(0, 5).forEach((k) => console.log(`           ${label}: ${k}`));
  show('missing', missing); show('extra', extra); show('tag-drift', tagDrift);
  show('placeholder-drift', phDrift); show('DNT-lost', dntLost);
  show('citation-translated', citeTranslated);

  const termVars = terminologyVariants(t, GTERMS, code);
  if (termVars.length) {
    termWarnings += termVars.length;
    if (STRICT_TERMS) hardFail++;
    console.log(`           ${STRICT_TERMS ? 'TERM-INCONSISTENT' : 'term-inconsistent (advisory)'}: ${termVars.length} concept(s) render more than one way`);
    for (const v of termVars) {
      console.log(`             ${v.abbr} (${v.term}):`);
      for (const [, info] of v.variants.slice(0, 5)) {
        console.log(`               ${String(info.count).padStart(3)}x  ${info.sample}`);
      }
      if (v.variants.length > 5) console.log(`               …and ${v.variants.length - 5} more`);
    }
  }
}

const absent = expected.filter((c) => !fs.existsSync(path.join(I18N, `${c}.json`)));
if (absent.length) console.log(`\nnot yet generated: ${absent.join(' ')}`);

if (termWarnings && !STRICT_TERMS) {
  console.log(`\nadvisory: ${termWarnings} terminology inconsistency group(s). Not blocking — the glossary's`);
  console.log('locked translations are still unreviewed. Re-run with --strict-terms to enforce.');
}
console.log(hardFail ? `\nFAIL — ${hardFail} locale(s) have hard failures.` : '\nPASS — all checked locales are complete and intact.');
process.exit(hardFail ? 1 : 0);
