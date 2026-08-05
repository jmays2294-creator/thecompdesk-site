#!/usr/bin/env node
/**
 * directory-exclusion.test.js
 *
 * Enforces SILENT_OWNER_POLICY.md in code, on two distinct surfaces:
 *
 *   (A) THE NEUTRAL CONNECTION SERVICE  — data/attorneys.json
 *       The site operator (Joel Mays, of Shulman and Hill PLLC) and his firm are
 *       PERMANENTLY EXCLUDED from the free round-robin attorney connection service.
 *       Nothing may relax this. If this half of the test fails, do NOT "fix" it by
 *       editing the forbidden list — fix it by removing the forbidden entity from
 *       data/attorneys.json.
 *
 *   (B) THE PAID ATTORNEY DIRECTORY     — data/directory-listings.json
 *       A separate, disclosed attorney-advertising product in which the operator IS
 *       permitted to participate (SILENT_OWNER_POLICY.md, amended 2026-08-05). A
 *       listing bearing a forbidden string is allowed ONLY if its slug appears in
 *       DIRECTORY_EXEMPTIONS below, with a date and a reason. Any other occurrence
 *       fails the build.
 *
 * Why (B) exists: before 2026-08-05 this test scanned only data/attorneys.json. A
 * directory-backed page naming the operator would not have tripped it — the guard
 * would have gone green while looking at the wrong file. That is a proxy-pass, and
 * it is the exact failure this half is here to prevent.
 *
 * VACUITY: a guard that scans an empty dataset is not a passing guard, it is an
 * un-run one. This test reports scanned-record counts and explicitly declares a
 * vacuous run rather than printing a confident PASS over nothing.
 *
 * Run: `node tests/directory-exclusion.test.js`
 * Exits 0 on pass, 1 on fail. Wired into .github/workflows/directory-neutrality.yml.
 */

// NOTE: package.json sets "type": "module". This file must be ESM. It was CommonJS
// until 2026-08-05, which meant `node tests/directory-exclusion.test.js` threw
// "require is not defined" on every CI run from 2026-07-21 onward — the guard was
// not passing vacuously, it was not executing at all. Do not reintroduce require().
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ATTORNEYS_FILE = path.join(__dirname, '..', 'data', 'attorneys.json');
const DIRECTORY_FILE = path.join(__dirname, '..', 'data', 'directory-listings.json');

// Forbidden substrings (case-insensitive). Intentionally broad to catch typos
// and variants. Add to this list, never remove from it.
const FORBIDDEN = [
    'shulman and hill',
    'shulman & hill',
    'shulmanandhill',
    'shulmanhill',
    'joel mays',
    'jmays',
    'joelmays',
    '@shulmanandhill',
    'shulmanandhill.com',
];

/**
 * Slugs permitted to carry a forbidden string in the PAID DIRECTORY only.
 * Each entry requires an approval date and a reason. Adding an entry here is a
 * policy act: it must be accompanied by a matching carve-out in
 * SILENT_OWNER_POLICY.md. It grants nothing on the connection service.
 */
const DIRECTORY_EXEMPTIONS = [
    {
        slug: 'joel-george-mays',
        approved: '2026-08-05',
        approvedBy: 'Joel Mays (site owner)',
        reason:
            'Disclosed paid attorney-advertising listing in /directory. Permitted by ' +
            'SILENT_OWNER_POLICY.md as amended 2026-08-05 (§"Permitted: disclosed ' +
            'attorney advertising"). Confers no connection-service eligibility.',
    },
];

let failures = 0;
let meaningfulAssertions = 0;

function fail(msg) {
    console.error('[31m✗ directory-exclusion FAILED:[0m ' + msg);
    failures++;
}
function note(msg) {
    console.log('  • ' + msg);
}
function warn(msg) {
    console.log('[33m⚠ ' + msg + '[0m');
}

function hitsIn(str) {
    const lower = String(str).toLowerCase();
    return FORBIDDEN.filter(s => lower.includes(s));
}

// ---------------------------------------------------------------------------
// (A) Connection service — absolute exclusion, no exemptions possible.
// ---------------------------------------------------------------------------
if (!fs.existsSync(ATTORNEYS_FILE)) {
    fail('data/attorneys.json not found at ' + ATTORNEYS_FILE);
} else {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(ATTORNEYS_FILE, 'utf8'));
    } catch (e) {
        fail('data/attorneys.json is not valid JSON: ' + e.message);
        parsed = null;
    }

    if (parsed) {
        // Schema-doc fields may MENTION the forbidden names to document the
        // exclusion. Scan only the live data arrays.
        const scanTarget = JSON.stringify({
            regions: parsed.regions || [],
            attorneys: parsed.attorneys || [],
        });

        const hits = hitsIn(scanTarget);
        if (hits.length) {
            fail(
                'Forbidden owner/firm strings found in CONNECTION SERVICE data: ' +
                hits.join(', ') +
                '\n  The site operator and his firm are permanently excluded from the' +
                '\n  neutral connection service. This exclusion has NO exemptions.' +
                '\n  Remove the listing from data/attorneys.json.'
            );
        }

        if (!Array.isArray(parsed.attorneys)) {
            fail('data/attorneys.json: "attorneys" must be an array.');
        } else {
            for (const a of parsed.attorneys) {
                if (!a || typeof a !== 'object') fail('Non-object entry in attorneys array.');
                else if (!a.name || !a.region) {
                    fail('Attorney entry missing required field name/region: ' + JSON.stringify(a));
                }
            }
            const n = parsed.attorneys.length;
            note('connection service: scanned ' + n + ' attorney record(s) across ' +
                 (parsed.regions || []).length + ' region(s)');
            if (n > 0) meaningfulAssertions++;
            else warn('connection service roster is EMPTY — this half of the guard ' +
                      'asserted nothing about live listings.');
        }
    }
}

// ---------------------------------------------------------------------------
// (B) Paid directory — exclusion with explicit, dated, slug-scoped exemptions.
// ---------------------------------------------------------------------------
if (!fs.existsSync(DIRECTORY_FILE)) {
    warn('data/directory-listings.json not found — directory guard asserted nothing. ' +
         'Expected once /directory has been generated (npm run build:directory).');
} else {
    let dir;
    try {
        dir = JSON.parse(fs.readFileSync(DIRECTORY_FILE, 'utf8'));
    } catch (e) {
        fail('data/directory-listings.json is not valid JSON: ' + e.message);
        dir = null;
    }

    if (dir) {
        const listings = Array.isArray(dir.listings) ? dir.listings : null;
        if (!listings) {
            fail('data/directory-listings.json: "listings" must be an array.');
        } else {
            const exemptSlugs = new Set(DIRECTORY_EXEMPTIONS.map(e => e.slug));

            for (const l of listings) {
                if (!l || typeof l !== 'object') {
                    fail('Non-object entry in directory listings array.');
                    continue;
                }
                if (!l.slug) {
                    fail('Directory listing missing required field "slug": ' + JSON.stringify(l));
                    continue;
                }

                const hits = hitsIn(JSON.stringify(l));
                if (hits.length && !exemptSlugs.has(l.slug)) {
                    fail(
                        'Forbidden owner/firm strings in directory listing "' + l.slug +
                        '": ' + hits.join(', ') +
                        '\n  A directory listing may carry these strings ONLY with a dated' +
                        '\n  entry in DIRECTORY_EXEMPTIONS in this file, matched by an amended' +
                        '\n  carve-out in SILENT_OWNER_POLICY.md. Add the exemption deliberately' +
                        '\n  or remove the listing — do not edit the FORBIDDEN list.'
                    );
                }
            }

            // An exemption that no longer matches a live listing is stale; an
            // exemption is a standing permission and must not outlive its subject.
            for (const ex of DIRECTORY_EXEMPTIONS) {
                if (!listings.some(l => l && l.slug === ex.slug)) {
                    warn('DIRECTORY_EXEMPTIONS entry "' + ex.slug + '" matches no live ' +
                         'listing — remove it if the listing is gone.');
                }
                if (!/^\d{4}-\d{2}-\d{2}$/.test(ex.approved || '')) {
                    fail('DIRECTORY_EXEMPTIONS entry "' + ex.slug +
                         '" has no valid ISO approval date.');
                }
                if (!ex.reason || ex.reason.length < 20) {
                    fail('DIRECTORY_EXEMPTIONS entry "' + ex.slug +
                         '" has no substantive reason.');
                }
            }

            note('paid directory: scanned ' + listings.length + ' listing(s), ' +
                 exemptSlugs.size + ' exemption(s) on file');
            if (listings.length > 0) meaningfulAssertions++;
            else warn('directory manifest is EMPTY — this half of the guard asserted ' +
                      'nothing about live listings.');
        }
    }
}

// ---------------------------------------------------------------------------
if (failures) {
    console.error('\n[31m' + failures + ' failure(s).[0m');
    process.exit(1);
}

if (meaningfulAssertions === 0) {
    console.log('[33m⚠ directory-exclusion: VACUOUS RUN[0m — no live records ' +
                'were scanned on either surface.\n  Structural checks passed, but this run ' +
                'is not evidence of neutrality.');
} else {
    console.log('[32m✓ directory-exclusion PASSED:[0m no forbidden ' +
                'owner/firm strings outside dated exemptions (' + meaningfulAssertions +
                '/2 surface(s) carried live records).');
}
process.exit(0);
