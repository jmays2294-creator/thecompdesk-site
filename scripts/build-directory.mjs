#!/usr/bin/env node
/**
 * build-directory.mjs — renders /directory and /directory/<slug> as static HTML.
 *
 * These pages exist to rank, so they are generated at build time and COMMITTED, never
 * rendered client-side from a ?slug= query.
 *
 * Deliberately NOT wired to a vercel.json buildCommand. The site currently deploys with
 * no build step at all (installCommand is a documented no-op); adding one converts a
 * zero-build static deploy into a build-gated one where a script error can fail the
 * entire site. Adding an attorney is therefore: one DB row + `npm run build:directory`
 * + commit + push. TODO: revisit a Supabase -> Vercel deploy hook once the flow has
 * proven itself.
 *
 * Reads with the ANON key on purpose. The published-only RLS policy is the same thing
 * the public sees, so the build cannot accidentally publish a draft.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ltibymvlytodkemdeeox.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0aWJ5bXZseXRvZGtlbWRlZW94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjA1NjYsImV4cCI6MjA5MDM5NjU2Nn0.b5oQqQIdgJRc0DEP2k7kMVdCRzfyfnuAwjVNZlbVyak';
const ORIGIN = 'https://thecompdesk.com';

// ── RPC 7.1 / 7.4(c): banned in all rendered copy. Build fails rather than ships. ──
const BANNED = /\b(expert|specialist|specializes?|best|leading|top-rated|top |aggressive|guarantee[ds]?|winningest|#1|no\.\s*1)\b/i;

const DISCLAIMER =
  'The Comp Desk is a software platform, not a law firm, and does not provide legal ' +
  'services or legal advice. Listings in this directory are paid advertising. The Comp ' +
  'Desk does not recommend, endorse, rank, or vouch for any attorney listed. Contacting ' +
  'an attorney through this directory does not create an attorney-client relationship. ' +
  'Prior results do not guarantee a similar outcome.';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Minimal markdown: paragraphs, **bold**, *italic*. Bios are prose, not documents. */
function md(src) {
  return String(src ?? '').trim().split(/\n{2,}/).map((p) => {
    const body = esc(p.trim())
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\n/g, ' ');
    return `<p>${body}</p>`;
  }).join('\n          ');
}

async function fetchListings() {
  const url = `${SUPABASE_URL}/rest/v1/directory_profiles`
    + `?status=eq.published&order=sort_rank.asc&select=*`;
  const res = await fetch(url, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── shared chrome ────────────────────────────────────────────────────────────
const NAV = `<nav class="tcd-nav" aria-label="Primary">
  <div class="tcd-nav-inner">
    <a class="tcd-wordmark" href="/?replay=1" aria-label="The Comp Desk">The <span class="accent">Comp</span> Desk</a>
    <div class="tcd-nav-links">
      <a href="/worker">Worker</a>
      <a href="/attorneys">Attorneys</a>
      <a href="/calculators">Calculators</a>
      <a href="/learn">Learn</a>
      <a href="/directory" aria-current="page">Directory</a>
    </div>
  </div>
</nav>`;

const FOOTER = `<footer class="tcd-footer">
  <div class="wrap">
    <p class="dir-disclaimer">${DISCLAIMER}</p>
    <p>&copy; 2026 NJJ Document Services, Inc. d/b/a The Comp Desk. All rights reserved.</p>
    <p><a href="/privacy">Privacy</a> <a href="/legal/terms.html">Terms</a> <a href="/contact">Contact</a></p>
  </div>
</footer>`;

const STYLE = `<style>
  .dir-wrap{max-width:960px;margin:0 auto;padding:0 20px}
  .dir-adlabel{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.10em;
    text-transform:uppercase;color:var(--skin-text-muted);border:1px solid var(--skin-divider);
    border-radius:999px;padding:5px 12px;background:var(--skin-surface-elev)}
  .dir-head{padding:40px 0 8px}
  .dir-head h1{font-family:var(--font-display);font-weight:var(--display-weight);
    letter-spacing:var(--display-tracking);line-height:var(--display-leading);
    font-size:clamp(30px,6vw,44px);margin:16px 0 10px;color:var(--skin-text)}
  .dir-head .dir-sub{font-size:17px;line-height:var(--body-leading);color:var(--skin-text-soft);max-width:62ch;margin:0}
  .dir-grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));padding:26px 0 8px}
  .dir-card{background:var(--skin-surface-elev);border:1px solid var(--skin-divider);
    border-radius:var(--skin-card-radius);box-shadow:var(--skin-card-shadow);padding:22px;
    display:flex;flex-direction:column;gap:12px}
  .dir-card img{width:76px;height:76px;border-radius:14px;object-fit:cover;border:1px solid #E7DECB}
  .dir-card h2{font-family:var(--font-display);font-size:20px;margin:0;color:var(--skin-text)}
  .dir-card .dir-firm{font-size:14px;color:var(--skin-text-muted);margin:2px 0 0}
  .dir-card .dir-headline{font-size:15px;line-height:1.6;color:var(--skin-text-soft);margin:0}
  .dir-meta{font-size:13px;color:var(--skin-text-muted);margin:0}
  .dir-cta{align-self:flex-start;background:var(--skin-accent);color:#fff;text-decoration:none;
    font-weight:600;font-size:15px;padding:11px 18px;border-radius:10px;min-height:44px;
    display:inline-flex;align-items:center}
  .dir-cta:hover{background:var(--skin-accent-deep)}
  .dir-alt{background:var(--skin-surface-warm);border:1px solid var(--skin-divider);
    border-radius:14px;padding:18px 20px;margin:22px 0 44px;font-size:15px;line-height:1.65;color:var(--skin-text-soft)}
  .dir-alt a{color:var(--skin-accent-deep);font-weight:600}
  .dir-hero{display:flex;gap:26px;align-items:flex-start;flex-wrap:wrap;padding:34px 0 10px}
  .dir-hero img{width:150px;height:150px;border-radius:18px;object-fit:cover;border:1px solid #E7DECB}
  .dir-hero h1{font-family:var(--font-display);font-size:clamp(27px,5.4vw,38px);margin:14px 0 6px;
    line-height:var(--display-leading);color:var(--skin-text)}
  .dir-hero .dir-firm{font-size:16px;color:var(--skin-text-soft);margin:0 0 4px}
  .dir-hero .dir-founder{font-size:14px;color:var(--skin-accent-deep);font-weight:600;margin:0}
  .dir-sec{background:var(--skin-surface-elev);border:1px solid var(--skin-divider);
    border-radius:var(--skin-card-radius);box-shadow:var(--skin-card-shadow);padding:24px;margin:20px 0}
  .dir-sec h2{font-family:var(--font-display);font-size:21px;margin:0 0 12px;color:var(--skin-text)}
  .dir-sec p{font-size:16px;line-height:1.75;color:var(--skin-text-soft);margin:0 0 13px}
  .dir-sec p:last-child{margin-bottom:0}
  .dir-list{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px}
  .dir-list li{background:var(--skin-surface-warm);border-radius:999px;padding:7px 14px;
    font-size:14px;color:var(--skin-text-soft)}
  .dir-creds{list-style:none;padding:0;margin:0}
  .dir-creds li{display:flex;gap:12px;padding:9px 0;border-bottom:1px solid var(--skin-divider);
    font-size:15px;line-height:1.6;flex-wrap:wrap}
  .dir-creds li:last-child{border-bottom:0}
  .dir-creds .k{color:var(--skin-text-muted);min-width:132px;flex:0 0 auto}
  .dir-creds .v{color:var(--skin-text-soft);flex:1 1 220px}
  .dir-contact a{display:inline-flex;align-items:center;min-height:44px;gap:8px;
    font-size:16px;color:var(--skin-accent-deep);font-weight:600;text-decoration:none}
  .dir-contact div{padding:6px 0}
  .dir-disclaimer{font-size:12px;line-height:1.65;color:var(--skin-text-muted);
    max-width:78ch;margin:0 auto 14px}
  @media (max-width:520px){ .dir-hero img{width:104px;height:104px} }
</style>`;

function head({ title, description, canonical, image, extraJsonLd }) {
  return `<!DOCTYPE html>
<html lang="en" data-audience="worker">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">

<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="The Comp Desk">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">

<link rel="canonical" href="${esc(canonical)}">
<link rel="stylesheet" href="/css/skins.css">
${STYLE}
${extraJsonLd ?? ''}
</head>
<body class="tcd-skinned">

<div class="web-wash" aria-hidden="true"></div>

${NAV}`;
}

// ── index ────────────────────────────────────────────────────────────────────
function renderIndex(rows) {
  const cards = rows.map((r) => `
        <article class="dir-card">
          ${r.photo_url ? `<img src="${esc(r.photo_url)}" alt="${esc(r.photo_alt || r.display_name)}" width="76" height="76">` : ''}
          <div>
            <h2>${esc(r.display_name)}</h2>
            ${r.firm_name ? `<p class="dir-firm">${esc(r.firm_name)}</p>` : ''}
          </div>
          ${r.headline ? `<p class="dir-headline">${esc(r.headline)}</p>` : ''}
          ${(r.counties || []).length ? `<p class="dir-meta">Serves: ${esc((r.counties || []).join(', '))}</p>` : ''}
          ${(r.languages || []).length ? `<p class="dir-meta">Languages: ${esc((r.languages || []).join(', '))}</p>` : ''}
          <a class="dir-cta" href="/directory/${esc(r.slug)}">View profile &rarr;</a>
        </article>`).join('\n');

  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Attorney Directory — The Comp Desk',
    description: 'Paid directory listings for New York workers’ compensation attorneys. Attorney Advertising.',
    url: `${ORIGIN}/directory`,
    hasPart: rows.map((r) => ({ '@type': 'Attorney', name: r.display_name, url: `${ORIGIN}/directory/${r.slug}` })),
  })}</script>`;

  return `${head({
    // Kept under ~60 chars so Google does not truncate it in results.
    title: 'NY Workers’ Comp Attorney Directory | The Comp Desk',
    description: 'A small, curated directory of New York workers’ compensation attorneys. Listings are paid advertising. Attorney Advertising.',
    canonical: `${ORIGIN}/directory`,
    image: `${ORIGIN}/assets/webinars/joel-headshot.jpg`,
    extraJsonLd: jsonLd,
  })}

<main>
  <div class="dir-wrap">
    <header class="dir-head">
      <span class="dir-adlabel">Attorney Advertising</span>
      <h1>Attorney Directory</h1>
      <p class="dir-sub">A short, hand-built list of New York workers&rsquo; compensation attorneys who
        work directly with injured workers. Every listing here is paid advertising, and we keep it
        small on purpose &mdash; you should be able to read all of it.</p>
    </header>

    <div class="dir-grid">${cards}
    </div>

    <aside class="dir-alt">
      Looking to be matched automatically instead? Our free connection service assigns attorneys by
      neutral rotation &mdash; no paid placement, no referral fees, and the owner&rsquo;s firm is
      permanently excluded from it. <a href="/connect-with-attorney">Use the free connection service &rarr;</a>
    </aside>
  </div>
</main>

${FOOTER}
</body>
</html>
`;
}

// ── listing ──────────────────────────────────────────────────────────────────
function renderListing(r) {
  const first = String(r.display_name).split(/[\s,]+/)[0];
  const seo = r.seo || {};
  const title = seo.title || `${r.display_name} — New York Workers’ Compensation Attorney`;
  const description = seo.description
    || `${r.display_name}${r.firm_name ? `, ${r.firm_name}` : ''}. New York workers’ compensation, claimant-side. Attorney Advertising.`;

  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Attorney',
    name: r.display_name,
    url: `${ORIGIN}/directory/${r.slug}`,
    image: r.photo_url ? `${ORIGIN}${r.photo_url}` : undefined,
    telephone: r.public_phone_e164 || undefined,
    email: r.public_email || undefined,
    address: r.office_address ? { '@type': 'PostalAddress', addressLocality: r.office_address } : undefined,
    worksFor: r.firm_name ? { '@type': 'Organization', name: r.firm_name } : undefined,
    alumniOf: (r.credentials || [])
      .filter((c) => /law school|undergraduate/i.test(c.label))
      .map((c) => ({ '@type': 'EducationalOrganization', name: c.value })),
    knowsLanguage: r.languages || [],
    areaServed: (r.counties || []).map((c) => ({ '@type': 'AdministrativeArea', name: c })),
    knowsAbout: r.practice_areas || [],
  }, (_k, v) => (v === undefined ? undefined : v))}</script>`;

  const creds = (r.credentials || []).map((c) =>
    `<li><span class="k">${esc(c.label)}</span><span class="v">${esc(c.value)}</span></li>`).join('\n            ');

  return `${head({ title, description, canonical: `${ORIGIN}/directory/${r.slug}`,
    image: r.photo_url ? `${ORIGIN}${r.photo_url}` : `${ORIGIN}/assets/webinars/joel-headshot.jpg`,
    extraJsonLd: jsonLd })}

<main>
  <div class="dir-wrap">
    <header class="dir-hero">
      ${r.photo_url ? `<img src="${esc(r.photo_url)}" alt="${esc(r.photo_alt || r.display_name)}" width="150" height="150">` : ''}
      <div style="flex:1 1 300px">
        <span class="dir-adlabel">Attorney Advertising</span>
        <h1>${esc(r.display_name)}</h1>
        ${r.firm_name ? `<p class="dir-firm">${esc(r.firm_name)}</p>` : ''}
        ${r.is_founder ? '<p class="dir-founder">Founder of The Comp Desk</p>' : ''}
      </div>
    </header>

    ${r.bio_md ? `<section class="dir-sec">
      <h2>About ${esc(first)}</h2>
          ${md(r.bio_md)}
    </section>` : ''}

    ${(r.practice_areas || []).length ? `<section class="dir-sec">
      <h2>Practice focus</h2>
      <ul class="dir-list">
        ${(r.practice_areas || []).map((p) => `<li>${esc(p)}</li>`).join('\n        ')}
      </ul>
    </section>` : ''}

    ${(r.credentials || []).length ? `<section class="dir-sec">
      <h2>Credentials</h2>
      <ul class="dir-creds">
            ${creds}
      </ul>
    </section>` : ''}

    ${r.show_webinars_cta ? `<section class="dir-sec">
      <h2>Free webinars for union members</h2>
      <p>${esc(first)} runs free, plain-language workers&rsquo; compensation sessions for New York union
        members &mdash; 15, 30, or 60 minutes, virtual, no cost and nothing to sign. If you are a union
        rep and your members keep asking the same questions, this is built for exactly that.</p>
      <p><a class="dir-cta" href="/webinars">Book a session &rarr;</a></p>
    </section>` : ''}

    <section class="dir-sec dir-contact">
      <h2>Contact</h2>
      ${r.public_phone_display ? `<div><a href="tel:${esc(r.public_phone_e164)}">${esc(r.public_phone_display)}</a></div>` : ''}
      ${r.public_email ? `<div><a href="mailto:${esc(r.public_email)}">${esc(r.public_email)}</a></div>` : ''}
      ${r.office_address ? `<div style="color:var(--skin-text-muted);font-size:15px">${esc(r.office_address)}</div>` : ''}
    </section>

    <aside class="dir-alt">
      Prefer not to choose? Our free connection service assigns a New York workers&rsquo; compensation
      attorney by neutral rotation, with no paid placement and no referral fees &mdash; and it is
      independent of this directory. <a href="/connect-with-attorney">Use the free connection service &rarr;</a>
    </aside>
  </div>
</main>

${FOOTER}
<script>window.CD_DIRECTORY_SLUG=${JSON.stringify(r.slug)};</script>
<script src="/js/directory-chat.js" defer></script>
</body>
</html>
`;
}

// ── main ─────────────────────────────────────────────────────────────────────
const rows = await fetchListings();
if (!rows.length) {
  console.error('No published listings — refusing to write an empty directory.');
  process.exit(1);
}

fs.mkdirSync(path.join(ROOT, 'directory'), { recursive: true });

const written = [];
const violations = [];

/**
 * Check VISIBLE TEXT only. Checking raw HTML gave a false positive on the CSS custom
 * properties --display-leading / --body-leading, and a rule that cries wolf on a token
 * name is a rule people start ignoring. Strip script, style, and all tags first, so
 * this asserts what a reader (or a grievance committee) actually sees.
 */
function visibleText(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ');
  // The required disclaimer necessarily contains "guarantee" ("Prior results do not
  // guarantee a similar outcome"). The rule targets CLAIMS; the disclaimer is the
  // opposite of a claim, so exempt exactly that sentence and nothing else.
  return text.replace(DISCLAIMER.replace(/\s+/g, ' '), ' ');
}

function write(rel, html) {
  const banned = visibleText(html).match(BANNED);
  if (banned) violations.push(`${rel}: banned term "${banned[0]}" in visible copy`);
  fs.writeFileSync(path.join(ROOT, rel), html);
  written.push(rel);
}

const RESERVED = new Set(['index', 'thread']);
for (const r of rows) {
  if (RESERVED.has(r.slug)) {
    console.error(`Refusing to build: slug "${r.slug}" would overwrite directory/${r.slug}.html.`);
    process.exit(1);
  }
}

write('directory/index.html', renderIndex(rows));
for (const r of rows) write(`directory/${r.slug}.html`, renderListing(r));

// Manifest the CI neutrality guard scans. It must describe what actually shipped.
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data/directory-listings.json'),
  JSON.stringify({
    generated_from: 'directory_profiles (status=published)',
    listings: rows.map((r) => ({
      slug: r.slug, display_name: r.display_name, firm_name: r.firm_name,
      status: r.status, kind: r.kind, is_founder: r.is_founder,
    })),
  }, null, 2) + '\n');

// ── sitemap ──────────────────────────────────────────────────────────────────
// Maintained here so adding attorney #2 stays "one row + one command". Entries live
// in their OWN marked block, outside <!-- i18n:locale-urls -->, which is regenerated
// wholesale by build-sitemap-locales.mjs and would otherwise clobber them.
//
// No hreflang alternates: /directory ships English-only for v1. Localising the
// directory and the chat is a follow-on project. TODO: add alternates once the locale
// pages exist, or the alternates will point at 404s.
{
  const smPath = path.join(ROOT, 'sitemap.xml');
  let sm = fs.readFileSync(smPath, 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${ORIGIN}/directory`, pri: '0.8', freq: 'weekly' },
    ...rows.map((r) => ({ loc: `${ORIGIN}/directory/${r.slug}`, pri: '0.7', freq: 'monthly' })),
  ];
  const block = '  <!-- directory:urls (generated by scripts/build-directory.mjs) -->\n'
    + urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n`
      + `    <changefreq>${u.freq}</changefreq>\n    <priority>${u.pri}</priority>\n  </url>`).join('\n')
    + '\n  <!-- /directory:urls -->';

  const re = /  <!-- directory:urls[\s\S]*?<!-- \/directory:urls -->/;
  sm = re.test(sm) ? sm.replace(re, block) : sm.replace('</urlset>', block + '\n\n</urlset>');
  fs.writeFileSync(smPath, sm);
  console.log(`sitemap.xml: ${urls.length} directory URL(s), no hreflang (English-only v1)`);
}

if (violations.length) {
  console.error('\nRPC 7.1/7.4 copy check FAILED:');
  violations.forEach((v) => console.error('  ✗ ' + v));
  process.exit(1);
}

console.log(`Wrote ${written.length} file(s):`);
written.forEach((w) => console.log('  ' + w));
console.log('  data/directory-listings.json');
console.log(`RPC 7.1/7.4 copy check: PASS (no banned superlatives in rendered copy)`);
