#!/usr/bin/env node
/**
 * legal-triage.mjs — identify the LEGALLY LOAD-BEARING subset of the site catalog.
 *
 * WHY THIS EXISTS
 * All ten shipped locales are machine-translated and unreviewed. Having a human review
 * 1,982 keys × 3 languages is not a task anyone will fund or finish. Having one review
 * the strings where a mistranslation could cause a worker to miss a deadline, forgo a
 * benefit, or waive a right is a task that fits in a day. This script draws that line,
 * and draws it the same way every time so the result can be argued with.
 *
 * TWO PASSES, because a purely mechanical pass is not honest here.
 *   1. INCLUDE by pattern — deadlines, obligations, filing/notice requirements,
 *      eligibility conditions, waivable rights, statutory citations.
 *   2. EXCLUDE by rule, each with a stated reason. A pattern match is a candidate, not a
 *      finding. "within 48 hours" matches the deadline pattern and is a service promise
 *      about a callback, not a limitations period.
 * Both passes are printed. Anyone who disagrees with a cut can see exactly what was cut
 * and why, which is the difference between a filter and a black box.
 *
 *   node scripts/i18n/legal-triage.mjs            # summary
 *   node scripts/i18n/legal-triage.mjs --report   # write i18n/LEGAL_REVIEW.md
 *   node scripts/i18n/legal-triage.mjs --excluded # show what was cut, with reasons
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const I18N = path.join(ROOT, 'i18n');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const flat = (o, p = '', acc = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const K = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, K, acc); else acc[K] = v;
  }
  return acc;
};
const strip = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

const EN = flat(read(path.join(I18N, 'en.json')));

/* ── PASS 1: include ─────────────────────────────────────────────────────── */
const INCLUDE = {
  deadline: [/\bwithin\s+(?:\d+|one|two|three|six|ten|thirty|ninety)\b/i, /\bno later than\b/i,
             /\bdeadlines?\b/i, /\bstatute of limitations\b/i, /\bexpire/i, /\buntimely\b/i,
             /\byou have (?:two|three|\d+)\s+(?:year|day|month)/i],
  obligation: [/\bmust\b/i, /\brequired to\b/i, /\bshall\b/i, /\bfailure to\b/i,
               /\brequired by\b/i, /\bhas to be\b/i],
  filing: [/\bfile (?:a|the|your|an)\b/i, /\bfiling\b/i, /\bnotify\b/i, /\bgive notice\b/i,
           /\bserve a copy\b/i, /\bsubmit (?:a|the|your)\b/i],
  eligibility: [/\beligib/i, /\bqualif/i, /\bentitled\b/i, /\bonly if\b/i, /\bunless\b/i,
                /\bnot covered\b/i, /\bdoes not (?:apply|cover)\b/i],
  waiver: [/\bwaive/i, /\bforfeit/i, /\blose (?:your|the) right\b/i, /\bbarred\b/i,
           /\bclose[sd]? (?:out )?(?:your )?(?:medical|the case)\b/i],
  citation: [/§/, /\bWCL\b/, /\bSection\s+\d/, /\bWCB\b/, /\b(?:C|OC|RB|WC)-\d+(?:\.\d+)?\b/],
};

/* A sentence asserting a legal EFFECT is never excluded, whatever else it contains. */
const LEGAL_EFFECT = new RegExp([
  '§', '\\bmust\\b', '\\bwithin\\b', '\\bentitled\\b',
  '\\bopens? your\\b', '\\bthe form that\\b', '\\bdeadlines? (?:are|is)\\b',
  '\\breimburse', '\\bsuspend', '\\bdenied\\b', '\\brequired\\b',
  '\\byou (?:have|are owed|can claim)\\b', '\\bapproved by\\b',
  '\\bno record of\\b', '\\buntil it', '\\bwaive',
].join('|'), 'i');

/* ── PASS 2: exclude, with reasons ───────────────────────────────────────── */
const EXCLUDE = [
  { why: 'SEO metadata — search-result copy describing the page, making no claim a worker acts on',
    test: (k) => /\.meta\./.test(k) },
  { why: 'service-level promise about our own response time, not a legal time limit',
    test: (k, t) => /\b(?:reply|respond|contact you|reach out|response|removal is processed)\b/i.test(t)
                 && /\bwithin\s+(?:\d+|one)\s+(?:hours?|business day)/i.test(t) },
  { why: 'expired sign-in link — session UI, no legal content',
    test: (k) => /this-link-has-expired/.test(k) },
  /* Product/feature description. The guard below is deliberately wide, and it is wide
   * because the first version of this rule was WRONG in the dangerous direction: it cut
   * "The C-3 is what opens your WCB case — and the deadlines are strict" and "the WCB
   * Form C-3 — the form that opens your New York workers' compensation case" purely
   * because both sentences also mention Comp Buddy. A string does not stop being
   * load-bearing because marketing copy shares the paragraph. Anything asserting a legal
   * EFFECT — what a form does, what gets reimbursed, what happens if you miss something —
   * stays in, no matter what else it says. */
  { why: 'product/feature description; names a legal artifact but states no rule, deadline or entitlement',
    test: (k, t) => (/^(coming-soon|extension)\./.test(k)
                 || /\b(Comp Buddy|Job Buddy|Pro Workspace|walks you through|step-by-step wizard|see everything)\b/i.test(t))
                 && !LEGAL_EFFECT.test(t) },
  { why: 'navigation label or button — under six words, no rule stated',
    test: (k, t) => strip(t).split(/\s+/).length < 6
                 && !/§|\bmust\b|\bWCL\b|\bapproved by\b/i.test(t) },
  { why: 'cross-link to another calculator; the legal content lives on the target page',
    test: (k, t) => /^(?:Not sure of your wage|Start with the free|Use the SLU calculator above)/i.test(strip(t)) },
  { why: 'audience/marketing statement, no operative rule',
    test: (k, t) => /^(pricing\.new-york-state|pricing\.everything|worker\.short-honest|calculators\.free-cited)/.test(k) },
];

const findings = [];
const excluded = [];
for (const [k, v] of Object.entries(EN)) {
  if (typeof v !== 'string' || !v.trim()) continue;
  const t = strip(v);
  const cats = Object.entries(INCLUDE).filter(([, ps]) => ps.some((p) => p.test(t))).map(([c]) => c);
  if (!cats.length) continue;
  const cut = EXCLUDE.find((e) => e.test(k, t));
  if (cut) excluded.push({ k, t, cats, why: cut.why });
  else findings.push({ k, t, cats, words: t.split(/\s+/).length });
}

/* Attorney-facing commerce is a different audience and a different risk: those readers
   are lawyers, they read English, and the pages are about credits and refunds rather than
   about a claimant's benefits. Split out so it cannot inflate the claimant-facing number. */
const isAttorney = (k) => /^(connect-with-attorney\.(how-it-works|purchase|yes-any|jsonld\.yes-any)|legal\.terms\.6-)/.test(k);
const claimant = findings.filter((f) => !isAttorney(f.k));
const attorney = findings.filter((f) => isAttorney(f.k));

const page = (k) => k.split('.').slice(0, /^(calculators|tools|legal)\./.test(k) ? 2 : 1).join('.');
const group = (list) => {
  const m = new Map();
  for (const f of list) { const p = page(f.k); if (!m.has(p)) m.set(p, []); m.get(p).push(f); }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
};

if (process.argv.includes('--excluded')) {
  const byWhy = new Map();
  for (const e of excluded) { if (!byWhy.has(e.why)) byWhy.set(e.why, []); byWhy.get(e.why).push(e); }
  for (const [why, list] of [...byWhy].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n── ${list.length} × ${why}`);
    for (const e of list.slice(0, 6)) console.log(`   ${e.k}\n      "${e.t.slice(0, 110)}"`);
    if (list.length > 6) console.log(`   …and ${list.length - 6} more`);
  }
  process.exit(0);
}

const words = (l) => l.reduce((n, f) => n + f.words, 0);
console.log(`catalog keys                    ${Object.keys(EN).length}`);
console.log(`pattern candidates              ${findings.length + excluded.length}`);
console.log(`  excluded, with reason         ${excluded.length}`);
console.log(`LEGALLY LOAD-BEARING            ${findings.length}   (${(100 * findings.length / Object.keys(EN).length).toFixed(1)}% of catalog)`);
console.log(`  claimant-facing               ${claimant.length}  (${words(claimant).toLocaleString()} English words)`);
console.log(`  attorney-facing commerce      ${attorney.length}  (${words(attorney).toLocaleString()} words)`);
console.log(`\nreview cost, claimant subset × es + zh-Hans + ru: ${(words(claimant) * 3).toLocaleString()} words`);
console.log(`(the full catalog in those three: ${(24740 * 3).toLocaleString()} words)`);
console.log('\nclaimant-facing by page:');
for (const [p, l] of group(claimant)) console.log(`  ${p.padEnd(28)} ${String(l.length).padStart(3)}  ${words(l).toLocaleString().padStart(6)} words`);

if (process.argv.includes('--report')) {
  const L = [];
  L.push('# Legal-risk review set — machine-translated site content', '');
  L.push('**Generated by `scripts/i18n/legal-triage.mjs`. Do not hand-edit — re-run it.**', '');
  L.push('All ten shipped locales are machine-translated and carry `translationsReviewed: false`.');
  L.push('Reviewing all 1,982 keys in every language is not a task that finishes. This is the');
  L.push('subset where a mistranslation could cause a worker to miss a deadline, forgo a benefit,');
  L.push('or waive a right — and it is small enough to actually review.', '');
  L.push(`| | keys | English words |`, `|---|---:|---:|`);
  L.push(`| full catalog | ${Object.keys(EN).length} | 24,740 |`);
  L.push(`| **claimant-facing, load-bearing** | **${claimant.length}** | **${words(claimant).toLocaleString()}** |`);
  L.push(`| attorney-facing commerce (lower priority) | ${attorney.length} | ${words(attorney).toLocaleString()} |`, '');
  L.push('## Review order');
  L.push('Ranked by New York workers\' compensation claimant population, not by locale count:', '');
  L.push('1. **es** — Spanish. Largest claimant population by a wide margin.');
  L.push('2. **zh-Hans** — Chinese (Simplified).');
  L.push('3. **ru** — Russian.', '');
  L.push('`zh-Hant` is derived from `zh-Hans` by OpenCC and needs no separate review — fixing');
  L.push('a Simplified string fixes the Traditional one. `bn`, `ht`, `ko`, `fr`, `pl` follow later.');
  L.push('`ar` and `ur` are not built and not listed; they are on hold pending this review.', '');
  L.push(`Reviewing this subset in the top three languages is ~${(words(claimant) * 3).toLocaleString()} words,`);
  L.push(`against ~${(24740 * 3).toLocaleString()} for the full catalog.`, '');
  L.push('## Categories', '');
  L.push('`deadline` time limit · `obligation` must-do · `filing` filing/notice requirement ·');
  L.push('`eligibility` condition on a benefit · `waiver` right that can be lost · `citation` statute or form', '');
  for (const [p, list] of group(claimant)) {
    L.push(`## ${p}  — ${list.length} keys`, '');
    for (const f of list.sort((a, b) => a.k.localeCompare(b.k))) {
      L.push(`- \`${f.k}\`  *(${f.cats.join(', ')})*`);
      L.push(`  > ${f.t.length > 300 ? f.t.slice(0, 300) + '…' : f.t}`);
    }
    L.push('');
  }
  if (attorney.length) {
    L.push('## Attorney-facing commerce — lower priority', '');
    L.push('Different audience and different risk: these readers are lawyers, they read English,');
    L.push('and the pages concern lead credits and refunds rather than a claimant\'s benefits.', '');
    for (const f of attorney.sort((a, b) => a.k.localeCompare(b.k))) {
      L.push(`- \`${f.k}\`  *(${f.cats.join(', ')})*`);
      L.push(`  > ${f.t.slice(0, 240)}`);
    }
    L.push('');
  }
  L.push('## What was excluded, and why', '');
  L.push('A pattern match is a candidate, not a finding. These matched an include pattern and');
  L.push('were cut; run `--excluded` for the full list with examples.', '');
  const byWhy = new Map();
  for (const e of excluded) byWhy.set(e.why, (byWhy.get(e.why) || 0) + 1);
  for (const [why, n] of [...byWhy].sort((a, b) => b[1] - a[1])) L.push(`- **${n}** — ${why}`);
  fs.writeFileSync(path.join(I18N, 'LEGAL_REVIEW.md'), L.join('\n') + '\n');
  console.log('\nwrote i18n/LEGAL_REVIEW.md');
}
