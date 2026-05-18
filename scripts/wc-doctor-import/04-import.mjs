#!/usr/bin/env node
// Phase 3b: Stream the geocoded doctors into Supabase via the temporary
// wc_doctors_import_batch RPC (SECURITY DEFINER, granted to anon).
//
// Reads: scripts/wc-doctor-import/data/doctors-geocoded.json
// Writes: scripts/wc-doctor-import/data/04-import.log

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN_FILE = path.join(__dirname, 'data', 'doctors-geocoded.json');

const SUPABASE_URL  = 'https://ltibymvlytodkemdeeox.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0aWJ5bXZseXRvZGtlbWRlZW94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjA1NjYsImV4cCI6MjA5MDM5NjU2Nn0.b5oQqQIdgJRc0DEP2k7kMVdCRzfyfnuAwjVNZlbVyak';
const BATCH = 500;
const CONCURRENCY = 4;

async function postBatch(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/wc_doctors_import_batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`,
    },
    body: JSON.stringify({ payload: rows }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 400)}`);
  }
  return await res.json();
}

async function main() {
  const all = JSON.parse(await fs.readFile(IN_FILE, 'utf-8'));
  console.log(`Loaded ${all.length} doctors. Batch size ${BATCH}, concurrency ${CONCURRENCY}.`);

  const batches = [];
  for (let i = 0; i < all.length; i += BATCH) batches.push(all.slice(i, i + BATCH));
  console.log(`${batches.length} batches.`);

  const startedAt = Date.now();
  let done = 0, totalInserted = 0, errors = 0;
  const queue = batches.map((b, i) => ({ b, i }));

  const workers = Array.from({ length: CONCURRENCY }, async (_, w) => {
    while (queue.length) {
      const job = queue.shift();
      if (!job) break;
      try {
        const inserted = await postBatch(job.b);
        totalInserted += (inserted || 0);
        done++;
        if (done % 5 === 0 || done === batches.length) {
          const pct = ((done / batches.length) * 100).toFixed(1);
          process.stdout.write(`  [w${w}] batch ${job.i} ok (+${inserted}) — ${done}/${batches.length} (${pct}%) total_inserted=${totalInserted}\n`);
        }
      } catch (e) {
        errors++;
        process.stdout.write(`  [w${w}] batch ${job.i} ERR ${e.message}\n`);
      }
    }
  });
  await Promise.all(workers);

  const dt = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n✅ Done. ${totalInserted} rows inserted, ${errors} batch errors. ${dt}s`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
