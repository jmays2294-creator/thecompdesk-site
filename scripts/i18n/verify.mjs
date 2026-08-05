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

/* ── LOCALE-REGISTRY RECONCILIATION ────────────────────────────────────────────
 * Four lists have to agree about which locales exist, and none of them can be derived
 * from the others at run time:
 *
 *   i18n/locales.json        the registry — source of truth
 *   js/i18n-locale.js        LOCALES, inline because the picker renders on first paint
 *   <prefix>/ on disk        the generated pages
 *   locales.json .fonts      the Google Fonts families build-locales.mjs requests
 *
 * The app shipped this exact defect twice in Phase 4B: two hand-maintained font maps with
 * "keep in lockstep" comments and nothing enforcing it, so adding ar/ur half-landed and
 * the no-tofu gate blamed the fonts for a missing map entry. A comment is not a gate.
 * Divergence here is a hard FAIL, and the message names the CONSEQUENCE rather than the
 * mismatch, because the consequence is what makes someone act on it.
 */
function reconcileRegistry() {
  const problems = [];
  const reg = read(path.join(I18N, 'locales.json')).locales;

  const src = fs.readFileSync(path.join(ROOT, 'js/i18n-locale.js'), 'utf8');
  const m = src.match(/var LOCALES\s*=\s*\[([\s\S]*?)\n\s*\];/);
  if (!m) {
    // A check that silently stops running is the failure this gate exists to prevent.
    problems.push('could not find `var LOCALES = [...]` in js/i18n-locale.js — the picker '
                + 'reconciliation did NOT run. Fix the parser; do not delete the check.');
  } else {
    const js = [...m[1].matchAll(/code:\s*'([^']+)'[^}]*?endonym:\s*'([^']+)'[^}]*?english:\s*'([^']+)'([^}]*)/g)]
      .map((x) => ({ code: x[1], endonym: x[2], english: x[3], draft: /draft:\s*true/.test(x[4]) }));
    const R = new Map(reg.map((l) => [l.code, l]));
    const J = new Map(js.map((l) => [l.code, l]));
    for (const c of [...R.keys()].filter((c) => !J.has(c))) {
      problems.push(`'${c}' is in i18n/locales.json but NOT in js/i18n-locale.js LOCALES — `
                  + 'it would never appear in the language picker, so no visitor could reach it');
    }
    for (const c of [...J.keys()].filter((c) => !R.has(c))) {
      problems.push(`'${c}' is in js/i18n-locale.js LOCALES but NOT in the registry — the picker `
                  + `would link to /${c}/, which the generator never wrote (404)`);
    }
    for (const c of [...R.keys()].filter((c) => J.has(c))) {
      for (const k of ['endonym', 'english']) {
        if (R.get(c)[k] !== J.get(c)[k]) {
          problems.push(`'${c}'.${k}: registry ${JSON.stringify(R.get(c)[k])} != picker ${JSON.stringify(J.get(c)[k])}`);
        }
      }
      // `draft` has to agree in BOTH directions and each disagreement fails differently:
      // draft in the registry but not the picker offers a visitor a language whose pages
      // are still English; draft in the picker but not the registry advertises those pages
      // to Google in hreflang and the sitemap while hiding them from the humans who could
      // have reported the problem.
      if (!!R.get(c).draft !== !!J.get(c).draft) {
        problems.push(`'${c}'.draft: registry ${!!R.get(c).draft} != picker ${!!J.get(c).draft} — `
          + (R.get(c).draft
              ? 'the picker would offer a language whose pages still carry English copy'
              : 'hreflang and sitemap would advertise pages the picker hides'));
      }
    }
    const rc = reg.map((l) => l.code).join(','), jc = js.map((l) => l.code).join(',');
    if (rc !== jc && R.size === J.size && [...R.keys()].every((c) => J.has(c))) {
      problems.push(`same locales, DIFFERENT ORDER — hreflang blocks and the picker both render `
                  + `in array order, so this is user-visible and crawler-visible\n      registry: ${rc}\n      picker  : ${jc}`);
    }
  }

  for (const l of reg) {
    if (!Array.isArray(l.fonts) || !l.fonts.length) {
      problems.push(`'${l.code}' has no "fonts" in the registry — build-locales.mjs refuses to `
                  + 'guess a font stack, because guessing renders the page from an OS fallback');
    }
    const dirExists = l.prefix && fs.existsSync(path.join(ROOT, l.prefix.slice(1)));
    if (l.prefix && !l.draft && !dirExists) {
      problems.push(`'${l.code}' is in the registry but ${l.prefix}/ does not exist on disk — `
                  + 'run scripts/i18n/build-locales.mjs');
    }
    // The inverse matters more: a draft locale with pages on disk is a half-translated
    // locale published to the open web. Unlinked is not unreachable — a crawler that has
    // seen /es/ and /fr/ will try /ar/, and find an English page declaring lang="ar".
    if (l.prefix && l.draft && dirExists) {
      problems.push(`'${l.code}' is draft but ${l.prefix}/ EXISTS on disk — those pages are `
                  + 'crawlable regardless of hreflang, sitemap or internal links. Delete the '
                  + 'directory, or drop "draft" if the catalog has landed.');
    }
    if (!['ltr', 'rtl'].includes(l.dir)) {
      problems.push(`'${l.code}'.dir is ${JSON.stringify(l.dir)} — must be 'ltr' or 'rtl'; a wrong `
                  + 'value lays the entire page out backwards');
    }
  }
  return problems;
}

const regProblems = reconcileRegistry();
if (regProblems.length) {
  console.log('✗ LOCALE REGISTRY RECONCILIATION FAILED\n');
  for (const p of regProblems) console.log(`  · ${p}`);
  console.log('\nSOURCE OF TRUTH: i18n/locales.json');
  process.exit(1);
}
console.log(`✓ registry reconciled: ${read(path.join(I18N, 'locales.json')).locales.length} locales — `
          + 'picker, on-disk directories and font stacks all agree\n');

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

/**
 * ORDER / ARTICLE VARIANTS of a canonical term.
 *
 * terminologyVariants() only sees a phrase when it sits immediately before an "(… ABBR)"
 * parenthetical, so a term used in bare prose is invisible to it — which is how es shipped
 * "pérdida permanente del uso" (30x), "pérdida permanente de uso" (5x) and
 * "pérdida de uso permanente" (3x) as three spellings of one term.
 *
 * This scans the whole catalog for word-windows built from the canonical term's content
 * words. Windows whose content-word SET is identical but whose surface text differs are
 * the same term reordered or re-articled; that is reported separately from a genuinely
 * different rendering, because the fix is different (normalise vs decide).
 */
const STOP = new Set(['de','del','la','el','los','las','un','una','y','o','a','en',
  'the','of','a','an','for','to','и','в','на','le','la','les','du','des','w','z','na','i']);
const words = (s) => normTerm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const contentWords = (s) => words(s).filter((w) => !STOP.has(w) && w.length > 2);

function orderVariants(catalog, terms, code) {
  const report = [];
  for (const t of terms) {
    const canon = t.translations && t.translations[code];
    if (!canon) continue;
    const core = contentWords(canon.replace(/[（(][^)）]*[)）]/g, ''));
    if (core.length < 2) continue;
    const need = new Set(core);

    // Group by the CONTENT-WORD SEQUENCE, not the raw surface. Otherwise "salario semanal
    // promedio", "su salario semanal promedio" and "del salario semanal promedio" read as
    // three renderings when they are one term in three grammatical positions — the
    // articles and pronouns belong to the sentence, not to the term.
    const seqs = new Map();          // "a|b|c" -> {count, sample}
    for (const v of Object.values(catalog)) {
      if (typeof v !== 'string') continue;
      const cw = contentWords(v.replace(/<[^>]*>/g, ' '));
      for (let a = 0; a < cw.length; a++) {
        for (let len = Math.min(2, core.length); len <= core.length && a + len <= cw.length; len++) {
          const win = cw.slice(a, a + len);
          if (!win.every((w) => need.has(w))) continue;
          if (new Set(win).size !== win.length) continue;     // no repeats inside a term
          if (len < core.length && len < 3) continue;         // 2-word windows only for 2-word terms
          const seq = win.join('|');
          if (!seqs.has(seq)) seqs.set(seq, { count: 0, sample: win.join(' ') });
          seqs.get(seq).count++;
        }
      }
    }

    // Same word SET, different sequence == the term reordered or re-articled.
    const bySet = new Map();
    for (const [seq, info] of seqs) {
      const set = seq.split('|').sort().join('|');
      if (!bySet.has(set)) bySet.set(set, []);
      bySet.get(set).push([info.sample, info.count]);
    }
    const groups = [...bySet.values()].filter((g) => g.length > 1);
    if (groups.length) report.push({ term: t.term, abbr: t.abbr || t.term, groups });
  }
  return report;
}

let hardFail = 0;
/**
 * Keys that live in the locale catalogs and NOWHERE in en.json, by design.
 *
 * These two are the translation-provenance notices that build-locales.mjs
 * stamps onto every generated locale page ("machine translated, not yet
 * reviewed by a person" / "…reviewed by a person"). English is the SOURCE, so
 * it has nothing to disclose and needs no such string — meaning en.json can
 * never contain them, and the extra-key check flagged all nine locales forever.
 *
 * A gate that reports a failure nobody can ever fix is a gate people learn to
 * ignore, so the exemption is narrow and named rather than the check being
 * loosened. Anything else appearing in a locale but not in en.json is still a
 * real orphan and still fails.
 */
const LOCALE_ONLY_KEYS = new Set([
  'shared.machineTranslationNotice',
  'shared.reviewedTranslationNotice',
]);

let termWarnings = 0;
let orderWarnings = 0;
console.log(`en.json: ${enKeys.length} keys · checking ${locales.length} locale(s)\n`);

for (const code of locales) {
  const p = path.join(I18N, `${code}.json`);
  if (!fs.existsSync(p)) { console.log(`${code.padEnd(8)} MISSING catalog`); hardFail++; continue; }
  const t = flat(read(p));

  const missing = enKeys.filter((k) => typeof t[k] !== 'string' || t[k] === '');
  const extra = Object.keys(t).filter((k) => !(k in en) && !LOCALE_ONLY_KEYS.has(k));
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

  const ordVars = orderVariants(t, GTERMS, code);
  if (ordVars.length) {
    orderWarnings += ordVars.length;
    if (STRICT_TERMS) hardFail++;
    console.log(`           ${STRICT_TERMS ? 'ORDER-VARIANT' : 'order-variant (advisory)'}: ${ordVars.length} term(s) spelled more than one way`);
    for (const v of ordVars) {
      for (const g of v.groups.slice(0, 3)) {
        console.log(`             ${v.abbr}: ` + g.sort((a, b) => b[1] - a[1])
          .map(([s2, n]) => `${n}x "${s2}"`).join('  ·  '));
      }
    }
  }

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

if (orderWarnings && !STRICT_TERMS) {
  console.log(`\nadvisory: ${orderWarnings} order/article-variant group(s) — same words, different spelling.`);
}
if (termWarnings && !STRICT_TERMS) {
  console.log(`\nadvisory: ${termWarnings} terminology inconsistency group(s). Not blocking — the glossary's`);
  console.log('locked translations are still unreviewed. Re-run with --strict-terms to enforce.');
}
console.log(hardFail ? `\nFAIL — ${hardFail} locale(s) have hard failures.` : '\nPASS — all checked locales are complete and intact.');
process.exit(hardFail ? 1 : 0);
