#!/usr/bin/env node
/**
 * telemetry-privacy.test.mjs — proves js/workspace-telemetry.js cannot leak case data.
 *
 * WHY THIS EXISTS AS A COMMITTED TEST RATHER THAN A CODE REVIEW
 * The privacy posture of the telemetry emitter rests on two claims:
 *   1. it never sends a field VALUE, only a field NAME
 *   2. every number it sends has been reduced to a bucket label
 * Both are easy to break with one well-meaning edit — someone adds
 * `props: { aww: value }` to debug something and never takes it out. A comment
 * asking people not to do that has a half-life of about a month. A test that
 * fails does not.
 *
 * The trigger `tg_workspace_telemetry_guard` in the database is the second
 * layer and would reject such a row. This is the first layer, and it runs
 * before anything reaches the network — which matters, because the database
 * only sees what the browser already decided to send.
 *
 *   node tests/telemetry-privacy.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'js', 'workspace-telemetry.js');
const src = fs.readFileSync(SRC, 'utf8');

let failures = 0;
const ok = (name, cond, detail) => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// ── 1. static: the emitter must not read input values ───────────────────────
// Exactly one sanctioned read exists, and it takes .length to decide
// filled-vs-empty. Comments are stripped first — an earlier version of this
// check flagged the file's own header prose and cried wolf, and a check that
// cries wolf is a check people learn to skip.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*)/.test(l))
  .join('\n');

const offenders = code.split('\n')
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => /\.value\b/.test(line))
  .filter(({ line }) => !/String\(el\.value\)\.length/.test(line));

ok('reads no input values beyond the length check',
  offenders.length === 0,
  offenders.length === 0
    ? 'one sanctioned read'
    : `unsanctioned: ${offenders.map((o) => `line ${o.n}: ${o.line.trim().slice(0, 60)}`).join(' | ')}`);

ok('never touches a password field',
  /el\.type === 'password'/.test(src) || /type\s*===\s*"password"/.test(src));

ok('honours Do Not Track', /doNotTrack/.test(src));
ok('honours a local opt-out', /tcd_no_telemetry/.test(src));

// ── 2. behavioural: load the module and exercise the real functions ─────────
const store = new Map();
const fakeStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const sent = [];
const sandbox = {
  console,
  crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
  localStorage: fakeStorage,
  sessionStorage: { getItem: () => null, setItem: () => {} },
  navigator: { doNotTrack: '0' },
  location: { pathname: '/workspace' },
  document: {
    addEventListener: () => {},
    referrer: '',
    visibilityState: 'visible',
    title: 'Workspace',
  },
  fetch: (url, opts) => {
    try { JSON.parse(opts.body).forEach((r) => sent.push(r)); } catch (e) {}
    return Promise.resolve({ ok: true, text: () => Promise.resolve('') });
  },
  setTimeout: (fn) => { fn(); return 1; },
  clearTimeout: () => {},
  Date, JSON, Math, Number, String, Array, Object, isFinite, parseInt, parseFloat,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.addEventListener = () => {};
sandbox.window.innerWidth = 1280;

vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'workspace-telemetry.js' });

const t = sandbox.window.wsTelemetry;
ok('module exposes window.wsTelemetry', !!t && t.enabled === true);

if (t && t.enabled) {
  // Buckets must return LABELS, never the input.
  ok('bucketMoney returns a band, not the amount',
    t.bucketMoney(1487.63) === '1000-1500', `got ${t.bucketMoney(1487.63)}`);
  ok('bucketMoney caps the top end',
    t.bucketMoney(12000) === '5000+', `got ${t.bucketMoney(12000)}`);
  ok('bucketPct returns a band',
    t.bucketPct(37.5) === '25-49', `got ${t.bucketPct(37.5)}`);
  ok('bucketYear reduces a date of injury to its year',
    t.bucketYear('2024-03-29') === '2024', `got ${t.bucketYear('2024-03-29')}`);
  ok('bucketYear buckets old claims rather than dating them',
    /^pre-/.test(t.bucketYear('1998-06-01')), `got ${t.bucketYear('1998-06-01')}`);
  ok('bucketCount returns a band', t.bucketCount(9) === '7-12', `got ${t.bucketCount(9)}`);

  // slugField is the chokepoint for anything DOM-derived. These cases are the
  // ones that actually matter — a label with a case number and a person's name
  // interpolated into it is not hypothetical on a surface where every field
  // sits next to a claimant record.
  const nasty = 'Claimant Name (WCB #G2845571) — Maria Rodriguez';
  const slug = t.slugField(nasty);
  ok('slugField strips digits from a label', !/[0-9]/.test(slug), `got "${slug}"`);
  ok('slugField truncates', String(slug).length <= 40, `length ${String(slug).length}`);
  ok('slugField drops punctuation', /^[a-z_]+$/.test(slug), `got "${slug}"`);
  ok('slugField does NOT carry a claimant name through',
    !/maria|rodriguez/i.test(slug), `got "${slug}"`);
  ok('slugField does NOT carry a WCB number through',
    !/2845571|g284/i.test(slug), `got "${slug}"`);
  ok('slugField refuses prose outright',
    t.slugField('Enter the claimant full legal name exactly as it appears on the C-3 form') === 'long_label',
    `got "${t.slugField('Enter the claimant full legal name exactly as it appears on the C-3 form')}"`);
  ok('slugField still passes ordinary field labels intact',
    t.slugField('Average Weekly Wage') === 'average_weekly_wage',
    `got "${t.slugField('Average Weekly Wage')}"`);
  ok('slugField caps at four tokens',
    t.slugField('one two three four five') === 'one_two_three_four',
    `got "${t.slugField('one two three four five')}"`);
  // The longest real label on this surface must still survive intact —
  // a privacy gate that eats legitimate field names produces useless data.
  ok('slugField keeps the longest legitimate label',
    t.slugField('Loss of Wage Earning Capacity') === 'loss_of_wage_earning',
    `got "${t.slugField('Loss of Wage Earning Capacity')}"`);

  // End to end: emit something and inspect what would go over the wire.
  sent.length = 0;
  t.field('SLU', ['Average Weekly Wage', 'Date of Injury 03/29/2024'], {
    aww_band: t.bucketMoney(1487.63),
    doi_year: t.bucketYear('2024-03-29'),
  });
  t.flush();
  const row = sent[sent.length - 1];
  ok('an emitted row exists', !!row);
  if (row) {
    const blob = JSON.stringify(row);
    ok('the wire payload carries no exact amount', !blob.includes('1487'), blob.slice(0, 200));
    ok('the wire payload carries no full date', !/\d{4}-\d{2}-\d{2}/.test(
      JSON.stringify({ ...row, ts: '', received_at: '' })), 'ts excluded from the check');
    ok('the wire payload carries no claimant name', !/maria|rodriguez/i.test(blob));
    ok('field names survive as identifiers',
      Array.isArray(row.fields_filled) && row.fields_filled.every((f) => /^[a-z_]+$/.test(f)),
      JSON.stringify(row.fields_filled));
  }
}

console.log(failures
  ? `\n  FAIL — ${failures} privacy assertion(s) broke. Do NOT ship this.\n`
  : '\n  PASS — the emitter sends structure and buckets, not case data.\n'
    + '  (This is layer 1. tg_workspace_telemetry_guard in the database is layer 2.)\n');
process.exit(failures ? 1 : 0);
