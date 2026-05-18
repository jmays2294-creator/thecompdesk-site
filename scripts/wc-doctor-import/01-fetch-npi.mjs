#!/usr/bin/env node
// Phase 1: Fetch WC-relevant doctors from NPI Registry across the five boroughs.
// Output: scripts/wc-doctor-import/data/npi-raw.json (one entry per unique NPI).
//
// Run: node scripts/wc-doctor-import/01-fetch-npi.mjs
// Re-runnable. Polite ~150ms delay between API calls. NPI API has no auth.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'data');
const OUT_FILE = path.join(OUT_DIR, 'npi-raw.json');

// WC-relevant taxonomy descriptions (NUCC). The API does case-insensitive match.
const TAXONOMIES = [
  'Orthopaedic Surgery',
  'Orthopaedic Surgery of the Spine',
  'Hand Surgery',
  'Neurology',
  'Neurological Surgery',
  'Pain Medicine',
  'Physical Medicine & Rehabilitation',
  'Physical Therapist',
  'Chiropractor',
  'Occupational Medicine',
  'Podiatrist',
  'Pulmonary Disease',
  'Internal Medicine',
  'Family Medicine',
  'Psychiatry',
  'Anesthesiology',
];

// NYC five boroughs. For Queens we use postal-code prefixes because the NPI
// "city" field uses neighborhood names (Astoria, Flushing, etc.) not "Queens".
const REGIONS = [
  { borough: 'Manhattan',     city: 'NEW YORK' },
  { borough: 'Brooklyn',      city: 'BROOKLYN' },
  { borough: 'Bronx',         city: 'BRONX' },
  { borough: 'Staten Island', city: 'STATEN ISLAND' },
  // Queens — paginated by postal prefix since neighborhood city names vary.
  { borough: 'Queens', postal_code: '110*' },
  { borough: 'Queens', postal_code: '111*' },
  { borough: 'Queens', postal_code: '113*' },
  { borough: 'Queens', postal_code: '114*' },
  { borough: 'Queens', postal_code: '116*' },
];

const API = 'https://npiregistry.cms.hhs.gov/api/?version=2.1';
const PAGE_SIZE = 200;       // API max
const SKIP_MAX = 1000;       // API max — beyond this we'd need to subdivide further
const REQ_DELAY_MS = 150;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage({ taxonomy, region, skip }) {
  const params = new URLSearchParams({
    version: '2.1',
    state: 'NY',
    taxonomy_description: taxonomy,
    limit: String(PAGE_SIZE),
    skip: String(skip),
  });
  if (region.city) params.set('city', region.city);
  if (region.postal_code) params.set('postal_code', region.postal_code);

  const url = `https://npiregistry.cms.hhs.gov/api/?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NPI HTTP ${res.status}`);
  const json = await res.json();
  return json.results || [];
}

async function fetchAll({ taxonomy, region }) {
  const all = [];
  for (let skip = 0; skip <= SKIP_MAX; skip += PAGE_SIZE) {
    const page = await fetchPage({ taxonomy, region, skip });
    all.push(...page);
    process.stdout.write(`  ${taxonomy} / ${region.borough}${region.postal_code ? ' ' + region.postal_code : ''} skip=${skip} → ${page.length}\n`);
    if (page.length < PAGE_SIZE) break;
    await sleep(REQ_DELAY_MS);
  }
  return all;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const byNpi = new Map();
  const startedAt = Date.now();

  for (const tax of TAXONOMIES) {
    for (const region of REGIONS) {
      try {
        const rows = await fetchAll({ taxonomy: tax, region });
        for (const r of rows) {
          const npi = r.number;
          if (!npi) continue;
          // Merge: keep first occurrence, but accumulate the borough tag.
          if (!byNpi.has(npi)) {
            byNpi.set(npi, { ...r, _boroughs: new Set([region.borough]), _taxonomies_matched: new Set([tax]) });
          } else {
            const existing = byNpi.get(npi);
            existing._boroughs.add(region.borough);
            existing._taxonomies_matched.add(tax);
          }
        }
        await sleep(REQ_DELAY_MS);
      } catch (err) {
        console.error(`  ! error on ${tax}/${region.borough}: ${err.message}`);
      }
    }
  }

  // Convert Sets to arrays for JSON.
  const out = [...byNpi.values()].map(r => ({
    ...r,
    _boroughs: [...r._boroughs],
    _taxonomies_matched: [...r._taxonomies_matched],
  }));

  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
  const dt = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n✅ Wrote ${out.length} unique NPIs to ${path.relative(process.cwd(), OUT_FILE)} in ${dt}s`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
