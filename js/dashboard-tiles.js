/**
 * dashboard-tiles.js — per-profession default tile layouts for the ONE Pro
 * dashboard (web-only; never synced from the app).
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ────────────────────────────────────
 * On 2026-08-04 /dashboard shipped two tiles whose ids no route handled. They
 * rendered, invited a click, and did nothing — no navigation, no error, no
 * feedback. Every tile below therefore carries a REAL, verified destination,
 * and resolve() drops any tile whose destination is not in ROUTES before it can
 * reach the DOM. `npm run check:tiles` re-checks the same table against the
 * filesystem at build time, so a tile can never quietly outlive its page.
 *
 * profession sets the STARTING layout, it does not restrict capability: every
 * Pro user can still reach every Pro tool. Unknown or NULL profession falls back
 * to the attorney set — never an empty dashboard.
 *
 * A note on what was NOT built, and why:
 *   · "Forms & Filings" and "Deadlines" (proposed for the paralegal set) have no
 *     page in this repo. /tools/medical-travel (the real C-257 surface) and
 *     /tools/ime-reminders stand in for them.
 *   · "Fee App (OC-400.1)" has no standalone destination — it is generated
 *     inside the Pro Workspace from the active tile, and appears as a modal on
 *     the SLU and CCP/Award calculators. A separate tile pointing at /workspace
 *     would be a second name for a door already on the board, so the Workspace
 *     tile names it in its description instead.
 *   · /tools/mileage, /tools/utdm and /tools/work-search are live but carry a
 *     "Coming soon" badge, so they are deliberately not default tiles.
 */
(function (window) {
  'use strict';

  /**
   * The tile vocabulary. `href` is the destination; every one of these was
   * verified to resolve to a real, non-placeholder page.
   *
   * Keep in sync with scripts/check-tile-routes.mjs, which asserts each href
   * exists on disk and fails the build if not.
   */
  var ROUTES = {
    workspace:      { g: 'PW',  label: 'Pro Workspace',    desc: 'Your case tiles — and where the OC-400.1 fee app is generated', href: '/workspace' },
    my_cases:       { g: 'MC',  label: 'My Cases',         desc: 'Every saved calculation, organised by case',                    href: '/dashboard/my-cases' },
    slu:            { g: 'SLU', label: 'SLU Calculator',   desc: 'Schedule loss of use, by body part',                            href: '/calculators/slu' },
    lwec:           { g: 'LW',  label: 'LWEC Calculator',  desc: 'Loss of wage-earning capacity',                                 href: '/calculators/lwec' },
    aww:            { g: '$',   label: 'AWW Calculator',   desc: 'Average weekly wage — the number benefits build on',            href: '/calculators/aww' },
    ccp_award:      { g: 'CCP', label: 'CCP / Award',      desc: 'Continuing payments and award periods',                         href: '/calculators/ccp-award' },
    rates:          { g: 'RT',  label: 'Rate Lookup',      desc: 'Statutory max and min rates by date of accident',               href: '/calculators/rates' },
    settlement:     { g: 'ST',  label: 'Settlement',       desc: 'Compare Section 32 outcomes side by side',                      href: '/tools/settlement' },
    medical_travel: { g: '257', label: 'C-257 Medical & Travel', desc: 'Reimbursement for medical travel and expenses',           href: '/tools/medical-travel' },
    reminders:      { g: '!',   label: 'IME & Deadlines',  desc: 'IME dates and reminders in one place',                          href: '/tools/ime-reminders' },
    calculators:    { g: '÷',   label: 'All Calculators',  desc: 'Every calculator in one place',                                 href: '/calculators' },
    find_doctor:    { g: 'Rx',  label: 'Find a Doctor',    desc: 'Board-authorised providers, by county',                         href: '/tools/find-doctor' }
  };

  /**
   * profession → ordered default tiles.
   *
   * Ordering is deliberate: the first tile is what that role opens most days.
   * An attorney starts in the workspace; a paralegal starts in the case list.
   */
  var DEFAULTS = {
    attorney:               ['workspace', 'my_cases', 'slu', 'lwec', 'settlement', 'ccp_award', 'rates'],
    paralegal:              ['my_cases', 'medical_travel', 'reminders', 'workspace', 'aww', 'rates', 'calculators'],
    legal_assistant:        ['my_cases', 'medical_travel', 'reminders', 'workspace', 'aww', 'rates', 'calculators'],
    settlement_coordinator: ['settlement', 'slu', 'my_cases', 'ccp_award', 'rates', 'workspace'],
    case_manager:           ['my_cases', 'reminders', 'medical_travel', 'workspace', 'rates', 'calculators'],
    adjuster:               ['my_cases', 'rates', 'slu', 'lwec', 'settlement', 'workspace'],
    other:                  ['workspace', 'my_cases', 'slu', 'lwec', 'settlement', 'ccp_award', 'rates']
  };

  var FALLBACK = 'attorney';

  /**
   * Resolve a profession to renderable tile specs.
   *
   * Drops — loudly — any id with no entry in ROUTES. That is the render-time
   * half of the no-dead-tiles guarantee; scripts/check-tile-routes.mjs is the
   * build-time half.
   *
   * @param {string|null} profession  profiles.profession (NULL for workers)
   * @returns {Array<{id,g,label,desc,href}>} never empty
   */
  function resolve(profession) {
    var key = (profession && DEFAULTS[profession]) ? profession : FALLBACK;
    var ids = DEFAULTS[key] || DEFAULTS[FALLBACK];
    var out = [];
    var dropped = [];

    ids.forEach(function (id) {
      var r = ROUTES[id];
      if (!r || !r.href) { dropped.push(id); return; }
      out.push({ id: id, g: r.g, label: r.label, desc: r.desc, href: r.href });
    });

    if (dropped.length) {
      // Fail loud: a tile silently vanishing is how the 08-04 bug hid.
      console.error('[dashboard-tiles] DROPPED unrouted tile id(s):', dropped.join(', '),
                    '— fix the manifest or add the route.');
    }
    // Never hand back an empty dashboard, whatever happened above.
    if (!out.length && key !== FALLBACK) return resolve(FALLBACK);
    return out;
  }

  window.TCDProTiles = {
    ROUTES: ROUTES,
    DEFAULTS: DEFAULTS,
    FALLBACK: FALLBACK,
    resolve: resolve
  };
})(window);
