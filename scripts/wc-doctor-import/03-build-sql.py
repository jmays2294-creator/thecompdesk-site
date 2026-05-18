#!/usr/bin/env python3
"""
Phase 3a: Convert doctors-geocoded.json into batched SQL INSERT files.
ON CONFLICT (npi) DO NOTHING — idempotent if re-run.
"""
import json, os, sys, pathlib

HERE = pathlib.Path(__file__).parent
DATA = HERE / 'data'
IN_FILE = DATA / 'doctors-geocoded.json'
OUT_DIR = DATA / 'sql-batches'
BATCH_SIZE = 100

def esc(s):
    """Postgres single-quote escape."""
    if s is None:
        return 'NULL'
    return "'" + str(s).replace("'", "''") + "'"

def num(x):
    return 'NULL' if x is None else str(x)

def main():
    doctors = json.load(open(IN_FILE))
    OUT_DIR.mkdir(exist_ok=True)
    # wipe old batches
    for f in OUT_DIR.glob('batch-*.sql'):
        f.unlink()

    cols = "(npi, name, specialty, borough, address, city, state, zip, lat, lng, phone, source, notes)"
    n_batches = 0
    for i in range(0, len(doctors), BATCH_SIZE):
        batch = doctors[i:i+BATCH_SIZE]
        values = []
        for d in batch:
            values.append(
                "(" +
                ", ".join([
                    esc(d.get('npi')),
                    esc(d.get('name')),
                    esc(d.get('specialty')),
                    esc(d.get('borough')),
                    esc(d.get('address')),
                    esc(d.get('city')),
                    esc(d.get('state') or 'NY'),
                    esc(d.get('zip')),
                    num(d.get('lat')),
                    num(d.get('lng')),
                    esc(d.get('phone')),
                    esc(d.get('source') or 'npi_registry'),
                    esc(d.get('notes')),
                ]) +
                ")"
            )
        sql = (
            f"INSERT INTO public.wc_doctors {cols} VALUES\n"
            + ",\n".join(values)
            + "\nON CONFLICT (npi) WHERE npi IS NOT NULL DO NOTHING;"
        )
        out_file = OUT_DIR / f"batch-{n_batches:03d}.sql"
        out_file.write_text(sql)
        n_batches += 1

    print(f"Wrote {n_batches} batch files to {OUT_DIR}")
    print(f"Total rows: {len(doctors)}")

if __name__ == '__main__':
    main()
