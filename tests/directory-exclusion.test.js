#!/usr/bin/env node
/**
 * directory-exclusion.test.js
 *
 * Hard-fails the build if the site owner's firm or the site owner personally
 * appears anywhere in the Find an Attorney directory data file.
 *
 * The Comp Desk is operated by a practicing NYS Workers' Compensation attorney
 * (Joel Mays, of Shulman and Hill PLLC). Because of that conflict of interest,
 * his firm and he personally are PERMANENTLY EXCLUDED from /find-attorney.html.
 * The exclusion is enforced here in code, not just in policy. If this test ever
 * fails, do NOT "fix" it by editing the forbidden list — fix it by removing the
 * forbidden entity from data/attorneys.json.
 *
 * Run: `node tests/directory-exclusion.test.js`
 * Exits 0 on pass, 1 on fail. Wired into .github/workflows/directory-neutrality.yml.
 *
 * CARVE-OUT (2026-04-06): find-attorney.html is an approved carve-out where
 * Shulman & Hill PLLC may appear as a participating firm per SILENT_OWNER_POLICY.md.
 * This test scans ONLY data/attorneys.json (not HTML), so the carve-out does not
 * affect this test. The personal name "Joel Mays" remains forbidden everywhere,
 * including find-attorney.html. See SILENT_OWNER_POLICY.md §Permitted carve-outs.
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'attorneys.json');

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

function fail(msg) {
    console.error('\u001b[31m\u2717 directory-exclusion FAILED:\u001b[0m ' + msg);
    process.exit(1);
}
function pass(msg) {
    console.log('\u001b[32m\u2713 directory-exclusion PASSED:\u001b[0m ' + msg);
}

if (!fs.existsSync(DATA_FILE)) {
    fail('data/attorneys.json not found at ' + DATA_FILE);
}

const raw = fs.readFileSync(DATA_FILE, 'utf8');

// Schema-doc fields are allowed to MENTION the forbidden names for the purpose
// of documenting the exclusion. We strip the documentation field before scanning.
let parsed;
try {
    parsed = JSON.parse(raw);
} catch (e) {
    fail('data/attorneys.json is not valid JSON: ' + e.message);
}

const scanTarget = JSON.stringify({
    regions: parsed.regions || [],
    attorneys: parsed.attorneys || [],
}).toLowerCase();

const hits = FORBIDDEN.filter(s => scanTarget.includes(s));

if (hits.length) {
    fail(
        'Forbidden owner/firm strings found in directory data: ' +
        hits.join(', ') +
        '\n  The site owner (Joel Mays) and his firm (Shulman and Hill PLLC) are' +
        '\n  permanently excluded from /find-attorney.html. Remove the listing.'
    );
}

// Sanity: attorneys must be an array.
if (!Array.isArray(parsed.attorneys)) {
    fail('data/attorneys.json: "attorneys" must be an array.');
}

// Sanity: every attorney must have a name + region.
for (const a of parsed.attorneys) {
    if (!a || typeof a !== 'object') fail('Non-object entry in attorneys array.');
    if (!a.name || !a.region) fail('Attorney entry missing required field name/region: ' + JSON.stringify(a));
}

pass(
    'No forbidden strings in directory data. ' +
    parsed.attorneys.length + ' attorney(s) listed across ' +
    (parsed.regions || []).length + ' region(s).'
);
