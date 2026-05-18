#!/usr/bin/env node
// Phase 2: Geocode the practice addresses extracted from NPI raw data.
// Uses the US Census Geocoder (free, no auth, US-only — perfect for NYC).
// Caches results by normalized address so we don't re-geocode shared buildings.
//
// Reads:  scripts/wc-doctor-import/data/npi-raw.json
// Writes: scripts/wc-doctor-import/data/doctors-geocoded.json
//         scripts/wc-doctor-import/data/geocode-cache.json
//
// Re-runnable. Loads existing cache on start so a re-run is incremental.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const NPI_FILE = path.join(DATA_DIR, 'npi-raw.json');
const OUT_FILE = path.join(DATA_DIR, 'doctors-geocoded.json');
const CACHE_FILE = path.join(DATA_DIR, 'geocode-cache.json');

const CENSUS_API = 'https://geocoding.geo.census.gov/geocoder/locations/address';
const REQ_DELAY_MS = 30;          // Census API is generous; small polite delay
const CONCURRENCY = 5;            // 5 in-flight at once
const BATCH_SAVE_EVERY = 500;     // checkpoint cache every N geocodes

// NYC borough lookup by ZIP prefix — used to normalize the NPI "city" field.
function boroughFromZip(zip) {
  if (!zip) return null;
  const z = parseInt(String(zip).slice(0, 5), 10);
  if (!Number.isFinite(z)) return null;
  if (z >= 10001 && z <= 10282) return 'Manhattan';
  if (z >= 10301 && z <= 10314) return 'Staten Island';
  if (z >= 10451 && z <= 10475) return 'Bronx';
  if (z >= 11004 && z <= 11109) return 'Queens';     // Bayside, Bellerose, LIC, etc.
  if (z >= 11201 && z <= 11256) return 'Brooklyn';
  if (z >= 11351 && z <= 11697) return 'Queens';     // Flushing, Rockaway, etc.
  if (z === 11697) return 'Queens';
  return null;
}

function normalizeAddress(addr) {
  // Pick the LOCATION address; fall back to MAILING.
  const list = (addr || []).filter(a => a.country_code === 'US' && a.state === 'NY');
  const loc = list.find(a => a.address_purpose === 'LOCATION') || list[0];
  if (!loc) return null;
  const street = (loc.address_1 || '').trim();
  const zip5 = (loc.postal_code || '').slice(0, 5);
  if (!street || !zip5) return null;
  return {
    street,
    address_line: [loc.address_1, loc.address_2].filter(Boolean).join(' ').trim(),
    city: (loc.city || '').trim(),
    state: 'NY',
    zip: zip5,
    phone: (loc.telephone_number || '').replace(/[^\d]/g, '').slice(0, 11),
    cache_key: `${street.toUpperCase()}|${zip5}`,
  };
}

function nameFromNpi(r) {
  const b = r.basic || {};
  if (r.enumeration_type === 'NPI-2') {
    return (b.organization_name || '').trim();
  }
  const first = b.first_name || '';
  const last = b.last_name || '';
  const cred = b.credential ? `, ${b.credential.replace(/\./g, '')}` : '';
  return `${first} ${last}${cred}`.replace(/\s+/g, ' ').trim();
}

function primaryTaxonomyDesc(r) {
  const t = (r.taxonomies || []).find(x => x.primary) || (r.taxonomies || [])[0];
  return t ? t.desc : null;
}

function languagesFromNpi(r) {
  // NPI doesn't include languages reliably — leave default and rely on table default.
  return null;
}

async function geocodeOne({ street, city, zip }) {
  const params = new URLSearchParams({
    street,
    city,
    state: 'NY',
    zip,
    benchmark: 'Public_AR_Current',
    format: 'json',
  });
  const url = `${CENSUS_API}?${params.toString()}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (e) {
    return { error: 'timeout/network' };
  }
  if (!res.ok) return { error: `HTTP ${res.status}` };
  let json;
  try { json = await res.json(); } catch { return { error: 'parse' }; }
  const matches = json?.result?.addressMatches || [];
  if (!matches.length) return { error: 'no_match' };
  const m = matches[0];
  return {
    lat: Number(m.coordinates.y),
    lng: Number(m.coordinates.x),
    matched: m.matchedAddress,
  };
}

async function loadCache() {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

async function saveCache(cache) {
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function main() {
  const raw = JSON.parse(await fs.readFile(NPI_FILE, 'utf-8'));
  console.log(`Loaded ${raw.length} NPI records.`);

  const cache = await loadCache();
  let cacheHits = 0, geocoded = 0, failed = 0;

  // First pass: collect unique addresses.
  const uniqueAddresses = new Map(); // cache_key → {street, city, state, zip}
  const enriched = [];

  for (const r of raw) {
    const addr = normalizeAddress(r.addresses);
    if (!addr) {
      failed++;
      continue;
    }
    const name = nameFromNpi(r);
    if (!name) continue;
    const borough = boroughFromZip(addr.zip);
    if (!borough) continue;            // outside NYC five boroughs — skip
    if (!uniqueAddresses.has(addr.cache_key)) {
      uniqueAddresses.set(addr.cache_key, addr);
    }
    enriched.push({
      npi: r.number,
      name,
      practice_name: r.enumeration_type === 'NPI-2' ? null : ((r.basic||{}).authorized_official_first_name ? null : null),
      specialty: primaryTaxonomyDesc(r),
      borough,
      address: addr.address_line,
      city: addr.city,
      state: 'NY',
      zip: addr.zip,
      phone: addr.phone || null,
      cache_key: addr.cache_key,
      enumeration_type: r.enumeration_type,
      taxonomies_matched: r._taxonomies_matched || [],
    });
  }
  console.log(`Filtered to ${enriched.length} NYC providers across ${uniqueAddresses.size} unique addresses.`);

  // Second pass: geocode each unique address (with simple concurrency).
  const addrList = [...uniqueAddresses.values()];
  const queue = [...addrList];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const addr = queue.shift();
      if (!addr) break;
      if (cache[addr.cache_key]) { cacheHits++; continue; }
      const r = await geocodeOne(addr);
      if (r.error) {
        cache[addr.cache_key] = { error: r.error };
        failed++;
      } else {
        cache[addr.cache_key] = { lat: r.lat, lng: r.lng, matched: r.matched };
        geocoded++;
      }
      if ((geocoded + failed) % BATCH_SAVE_EVERY === 0) {
        await saveCache(cache);
        process.stdout.write(`  geocoded ${geocoded}, failed ${failed}, cache hits ${cacheHits} (${addrList.length - queue.length}/${addrList.length})\n`);
      }
      await new Promise(r => setTimeout(r, REQ_DELAY_MS));
    }
  });
  await Promise.all(workers);
  await saveCache(cache);
  console.log(`\nGeocode pass done: ${geocoded} geocoded, ${cacheHits} cache hits, ${failed} failed.`);

  // Third pass: stitch lat/lng onto each provider.
  const final = [];
  for (const e of enriched) {
    const c = cache[e.cache_key];
    if (!c || c.error || !c.lat || !c.lng) continue;
    final.push({
      npi: e.npi,
      name: e.name,
      specialty: e.specialty,
      borough: e.borough,
      address: e.address,
      city: e.city,
      state: e.state,
      zip: e.zip,
      lat: c.lat,
      lng: c.lng,
      phone: e.phone,
      source: 'npi_registry',
      notes: `Imported from NPI Registry on ${new Date().toISOString().slice(0,10)}. Specialty filters matched: ${(e.taxonomies_matched||[]).join(', ')}.`,
    });
  }

  await fs.writeFile(OUT_FILE, JSON.stringify(final, null, 2));
  console.log(`\n✅ Wrote ${final.length} geocoded doctors to ${path.relative(process.cwd(), OUT_FILE)}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
