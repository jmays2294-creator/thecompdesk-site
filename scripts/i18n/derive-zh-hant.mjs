#!/usr/bin/env node
/**
 * Derive i18n/zh-Hant.json from i18n/zh-Hans.json via OpenCC.
 *
 * zh-Hant is never translated directly — it is mechanically converted from the
 * already-translated Simplified catalog. Target must be 'twp' (Simplified -> Taiwan
 * Standard, with phrase substitution for Taiwan usage), never 't' (character-only
 * conversion), which produces stilted or unrenderable phrasing for a Taiwan audience.
 *
 *   node scripts/i18n/derive-zh-hant.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { Converter } from 'opencc-js';

const ROOT = path.resolve(new URL('../../', import.meta.url).pathname);
const I18N = path.join(ROOT, 'i18n');
const SRC = path.join(I18N, 'zh-Hans.json');
const OUT = path.join(I18N, 'zh-Hant.json');

const convert = Converter({ from: 'cn', to: 'twp' });

const convertDeep = (node) => {
  if (typeof node === 'string') return convert(node);
  if (Array.isArray(node)) return node.map(convertDeep);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = convertDeep(v);
    return out;
  }
  return node;
};

const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const out = convertDeep(src);

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

const countKeys = (node) => {
  let n = 0;
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) n += countKeys(v);
    else n += 1;
  }
  return n;
};

console.log(`derived zh-Hant.json from zh-Hans.json — ${countKeys(out)} keys`);
