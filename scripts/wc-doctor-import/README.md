# WC Doctor Directory — Import Pipeline

Populates `public.wc_doctors` with workers'-comp-relevant medical providers across the five boroughs of NYC, sourced from the CMS NPI Registry and geocoded with the US Census Geocoder.

Ran once on 2026-05-18 — landed 32,424 rows in ~30 minutes end-to-end (fetch + geocode + insert).

## Pipeline

```
01-fetch-npi.mjs   → data/npi-raw.json            (~76MB, 37,034 unique NPIs)
02-geocode.mjs     → data/doctors-geocoded.json   (~15MB, 32,424 with lat/lng)
                  → data/geocode-cache.json       (~2MB, address → coords cache)
03-build-sql.py    → data/sql-batches/batch-NNN.sql  (unused — kept for reference)
04-import.mjs      → POST → public.wc_doctors_import_batch RPC
```

The `data/` folder is gitignored — re-running the pipeline regenerates it. Geocode cache makes phase 2 resumable.

## Re-running

To refresh the directory (e.g., quarterly):

1. `node scripts/wc-doctor-import/01-fetch-npi.mjs`  — ~90s
2. `node scripts/wc-doctor-import/02-geocode.mjs`    — ~5–10 min (resumable via geocode-cache.json)
3. Recreate the RPC (see "Inserts" below), then:
   `node scripts/wc-doctor-import/04-import.mjs`     — ~15s
4. Drop the RPC.

## Inserts — the SECURITY DEFINER RPC trick

Service-role keys live only in the Supabase dashboard. To avoid exposing them (or burning hundreds of MCP `execute_sql` round-trips), the importer uses a *temporary* SECURITY DEFINER function granted to `anon`. The function accepts a JSON array, runs the INSERT internally with elevated privileges, and is dropped immediately after the import.

Apply migration `wc_doctors_import_rpc_temp` to create it; apply `wc_doctors_import_rpc_drop` (`DROP FUNCTION public.wc_doctors_import_batch(jsonb)`) when done. Both are in `supabase/migrations/`.

## Known limitations

- **NPI Registry skip cap**: high-volume specialties (Internal Medicine, Family Medicine, Physical Therapist) hit the API's `skip=1000` cap per (specialty × borough). The directory shows the first ~1,000 from each combination. To get full coverage we'd subdivide by ZIP prefix.
- **Suite numbers**: ~17% of NPI addresses failed the Census Geocoder (mostly "STE 310" / "FL 4" style strings that confuse the parser). These rows are dropped — they have no map pin to place. Future improvement: strip suite suffixes and retry.
- **WC experience not verified**: NPI data tells us "every NYC doctor in WC-relevant specialties," not "every doctor experienced with WC cases." The page UI now makes this clear (post-CRRP legislation banner says any licensed NY MD can treat WC patients). Curated rows can be added with `source='curated'` to surface specific recommendations later.
- **Specialty filter mismatch**: NPI returns 253 distinct specialty strings (e.g., "Orthopaedic Surgery, Sports Medicine"). The page filter dropdown has only the top-level 10. Filter logic could be loosened to use `specialty ILIKE '%Orthopaedic%'` for better matching.
