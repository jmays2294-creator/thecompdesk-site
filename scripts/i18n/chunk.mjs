#!/usr/bin/env node
/**
 * Emit the next N untranslated keys for a locale as a flat JSON object.
 *
 * Companion to merge.mjs. Together they let a Claude Code session act as the translator
 * (running on a Claude subscription) instead of scripts/generate-translations.mjs, which
 * calls the Anthropic API and therefore needs API credit.
 *
 *   node scripts/i18n/chunk.mjs --locale es [--size 60] [--out /tmp/chunk.json]
 *
 * Prints a progress line to stderr and the chunk to stdout (or --out).
 * Exits 3 when nothing is left, so a shell loop can stop cleanly.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../', import.meta.url).pathname);
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const locale = arg('locale');
const size = parseInt(arg('size', '60'), 10);
const out = arg('out');
if (!locale) { console.error('usage: chunk.mjs --locale <code> [--size N] [--out FILE]'); process.exit(1); }

const flat = (o, p = '', acc = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const K = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object') flat(v, K, acc); else acc[K] = v;
  }
  return acc;
};

const en = flat(JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/en.json'), 'utf8')));
const tgtPath = path.join(ROOT, 'i18n', `${locale}.json`);
const tgt = fs.existsSync(tgtPath) ? flat(JSON.parse(fs.readFileSync(tgtPath, 'utf8'))) : {};

const missing = Object.keys(en).filter((k) => typeof tgt[k] !== 'string' || tgt[k] === '');
const chunk = {};
for (const k of missing.slice(0, size)) chunk[k] = en[k];

const done = Object.keys(en).length - missing.length;
console.error(`${locale}: ${done}/${Object.keys(en).length} done · ${missing.length} remaining · emitting ${Object.keys(chunk).length}`);
if (!missing.length) process.exit(3);

const json = JSON.stringify(chunk, null, 2) + '\n';
if (out) { fs.writeFileSync(out, json); console.error(`wrote ${out}`); }
else process.stdout.write(json);
