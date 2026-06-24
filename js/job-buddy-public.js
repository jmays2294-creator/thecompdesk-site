/* ============================================================================
 * job-buddy-public.js — Public, no-account "Job Buddy" work-search page.
 * ----------------------------------------------------------------------------
 * Standalone IIFE (window.JobBuddyPublic). Powers /job-buddy for logged-out
 * visitors (the free public beta). Reads the anon-readable public.job_listings
 * table directly (no edge function, no login), takes restrictions + AWW + DOA +
 * home location INLINE (nothing is saved anywhere), and renders a List view and
 * a Mapbox Map view of openings that fit the worker's medical restrictions.
 *
 * Parity notes (single sources of truth this mirrors):
 *   - Reduced-Earnings math  → supabase/functions/_shared/job-buddy/re_math.ts
 *       weekly RE = ⅔ × (AWW − est. weekly earnings), floored at $0,
 *       capped at the statutory PPD max for the Date of Accident.
 *   - PPD cap                → window.CD.Calc.maxRateForDOA(doa)  (calc-core.js)
 *   - SGA red-flag wording    → re_math.ts sgaRedFlag()
 *   - Restriction FIT here is a transparent client-side heuristic. The logged-in
 *     dashboard version asks Claude (matcher.ts); we deliberately do NOT call the
 *     model for anonymous traffic (cost/abuse). The math shown is identical.
 *
 * NOTHING here applies the user to anything. "Apply" opens the employer site in
 * a new tab; the worker applies themselves.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var JBP = global.JobBuddyPublic = global.JobBuddyPublic || {};

  // ─── tiny DOM helper ────────────────────────────────────────────────────
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null) return;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v;
      else n.setAttribute(k, v);
    });
    (Array.isArray(kids) ? kids : (kids == null ? [] : [kids])).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return n;
  }

  // ─── formatting + math helpers ──────────────────────────────────────────
  function money(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '—';
    return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function intOrNull(v) { var n = parseInt(v, 10); return isNaN(n) ? null : n; }
  function round2(n) { return Math.round(n * 100) / 100; }

  // RE math — mirrors re_math.ts exactly.
  var RE_FRACTION = 2 / 3, WEEKS_PER_YEAR = 52, MONTHS_PER_YEAR = 12, SGA_MONTHLY_NONBLIND_2026 = 1620;
  function annualFromSalary(min, max) {
    var lo = (typeof min === 'number' && isFinite(min)) ? min : null;
    var hi = (typeof max === 'number' && isFinite(max)) ? max : null;
    if (lo !== null && hi !== null) return (lo + hi) / 2;
    if (lo !== null) return lo;
    if (hi !== null) return hi;
    return null;
  }
  function weeklyFromAnnual(annual) { return annual == null ? null : round2(annual / WEEKS_PER_YEAR); }
  function computeRE(aww, ppdMax, salMin, salMax) {
    var weekly = weeklyFromAnnual(annualFromSalary(salMin, salMax));
    var est = null;
    if (weekly !== null && aww && ppdMax) {
      est = round2(Math.min(Math.max(0, RE_FRACTION * (aww - weekly)), ppdMax));
    }
    return { job_weekly_earnings: weekly, est_re_benefit_weekly: est };
  }
  function sgaRedFlag(weekly) {
    if (weekly == null) return null;
    var monthly = weekly * WEEKS_PER_YEAR / MONTHS_PER_YEAR;
    if (monthly <= SGA_MONTHLY_NONBLIND_2026) return null;
    return 'Estimated earnings ($' + round2(monthly) + '/mo) would exceed SSDI SGA ($' + SGA_MONTHLY_NONBLIND_2026 + '/mo, non-blind 2026)';
  }

  // Haversine distance in miles.
  function milesBetween(a, b) {
    if (!a || !b) return null;
    var R = 3958.8, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return round2(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
  }

  // ─── restriction FIT heuristic (transparent) ────────────────────────────
  var HEAVY_RX = /\b(lift|lifting|load(?:ing|er)?|warehouse|construction|mover|moving|carry|haul|stock(?:er|ing)?|laborer|freight|pallet|heavy|manual labor|landscap|roofing|demolition|mason|warehouseman|forklift)\b/i;
  var DRIVE_RX = /\b(driver|delivery|cdl|chauffeur|courier|truck driver|route driver|rideshare)\b/i;
  var STAND_RX = /\b(cashier|retail associate|server|waiter|waitress|cook|line cook|barista|stocker|warehouse|host|sales floor|food service)\b/i;
  var SEDENTARY_RX = /\b(receptionist|clerk|dispatch(?:er)?|customer service|data entry|administrative|admin assistant|scheduler|call center|coordinator|analyst|desk|remote|work from home|telephone|virtual assistant|monitor)\b/i;

  // Returns { score:'good'|'maybe'|'poor', label, rationale:[..] }
  function fitFor(listing, r) {
    var hay = ((listing.title || '') + ' ' + (listing.description || '')).toLowerCase();
    var reasons = [], demerits = 0;

    var lift = r.lifting_limit_lbs;
    if (lift != null && lift <= 25 && HEAVY_RX.test(hay)) {
      demerits += 2; reasons.push('Listing suggests heavy lifting/material handling, but your limit is ' + lift + ' lbs.');
    } else if (lift != null && lift <= 25 && SEDENTARY_RX.test(hay)) {
      reasons.push('Looks seated/light-duty — within your ' + lift + ' lb lifting limit.');
    }

    if (r.can_drive === false && DRIVE_RX.test(hay)) {
      demerits += 2; reasons.push('Role appears to require driving, which your restrictions exclude.');
    }

    var stand = r.stand_minutes;
    if (stand != null && stand <= 30 && STAND_RX.test(hay)) {
      demerits += 1; reasons.push('Likely prolonged standing; your standing tolerance is about ' + stand + ' min.');
    }

    if (r.overhead_reach === 'none' && /\b(stock|shelv|overhead|warehouse|ladder|paint)\b/i.test(hay)) {
      demerits += 1; reasons.push('May need overhead reaching, which your restrictions limit.');
    }

    if (SEDENTARY_RX.test(hay) && demerits === 0) reasons.push('Sedentary/administrative role — generally restriction-friendly.');

    var score = demerits >= 2 ? 'poor' : (demerits === 1 ? 'maybe' : 'good');
    var label = score === 'good' ? 'Good fit' : (score === 'maybe' ? 'Possible fit' : 'Likely too demanding');
    if (!reasons.length) reasons.push('No obvious conflict with your stated restrictions — review the listing to be sure.');
    return { score: score, label: label, rationale: reasons };
  }

  // ─── Mapbox geocoding (memoized in localStorage) ────────────────────────
  var GEO_CACHE_KEY = 'jbp_geocache_v1';
  function loadGeoCache() {
    try { return JSON.parse(global.localStorage.getItem(GEO_CACHE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveGeoCache(c) {
    try { global.localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(c)); } catch (e) {}
  }
  function normLoc(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

  // fetch() with a hard timeout so a stalled request can never hang the page.
  function fetchTimeout(url, opts, ms) {
    opts = opts || {};
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    if (ctrl) opts.signal = ctrl.signal;
    var to = global.setTimeout(function () { try { if (ctrl) ctrl.abort(); } catch (e) {} }, ms || 7000);
    return fetch(url, opts).then(function (r) { global.clearTimeout(to); return r; },
                               function (e) { global.clearTimeout(to); throw e; });
  }

  // Geocode one query string → {lat,lng} | null. Successful lookups (incl. "no match")
  // are cached; transient failures/timeouts return null WITHOUT caching (so they retry later)
  // and never throw — geocoding can only refine results, never block them.
  function geocodeOne(token, query, cache) {
    var key = normLoc(query);
    if (!key) return Promise.resolve(null);
    if (Object.prototype.hasOwnProperty.call(cache, key)) return Promise.resolve(cache[key]);
    var url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/' +
      encodeURIComponent(query) + '.json?limit=1&country=us&access_token=' + encodeURIComponent(token);
    return fetchTimeout(url, {}, 7000).then(function (r) {
      if (!r.ok) return null;            // 4xx/5xx (e.g. token restriction) → don't cache, just skip
      return r.json().then(function (j) {
        var f = j && j.features && j.features[0];
        var pt = (f && f.center && f.center.length === 2) ? { lat: f.center[1], lng: f.center[0] } : null;
        cache[key] = pt; saveGeoCache(cache);   // cache resolved lookups (point or genuine no-match)
        return pt;
      });
    }).catch(function () { return null; });
  }

  // Bounded-concurrency async map — never serial, never unbounded.
  function mapLimit(items, limit, fn) {
    return new Promise(function (resolve) {
      var i = 0, done = 0, active = 0, out = [];
      if (!items.length) return resolve(out);
      function pump() {
        while (active < limit && i < items.length) {
          (function (idx) {
            active++;
            Promise.resolve(fn(items[idx], idx)).then(function (r) { out[idx] = r; }, function () { out[idx] = null; })
              .then(function () { active--; done++; (done === items.length) ? resolve(out) : pump(); });
          })(i++);
        }
      }
      pump();
    });
  }

  // Geocode many UNIQUE strings (dedup so "New York, NY" hits the API once), in parallel with a
  // concurrency cap and a hard cap on total lookups so this is fast and bounded.
  function geocodeUnique(token, queries, cache) {
    var uniq = {}; queries.forEach(function (q) { var k = normLoc(q); if (k) uniq[k] = q; });
    var keys = Object.keys(uniq).slice(0, 40);
    return mapLimit(keys, 6, function (k) {
      return geocodeOne(token, uniq[k], cache).then(function (pt) { return { k: k, pt: pt }; });
    }).then(function (arr) {
      var byLoc = {}; arr.forEach(function (x) { if (x) byLoc[x.k] = x.pt; }); return byLoc;
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // CONTROLLER
  // ════════════════════════════════════════════════════════════════════════
  JBP.init = function (opts) {
    var supa = opts.supabase, mount = opts.mount;
    var calc = opts.calc, mapboxToken = opts.mapboxToken;
    var wizardOpts = opts.wizardOpts || {};
    if (!mount) return;

    // refs to the restriction inputs so the wizard can keep the quick-search form in sync.
    var refs = {};
    var REST_KEYS = ['lifting_limit_lbs', 'stand_minutes', 'sit_minutes', 'bend_twist', 'overhead_reach', 'can_drive', 'other_restrictions'];

    // Background motion (slow Ken Burns "boomerang": zoom in → reverse out → loop) is pure CSS
    // on .jb-bg-img — no JS needed, and it honors prefers-reduced-motion.

    var state = {
      r: { lifting_limit_lbs: null, stand_minutes: null, sit_minutes: null, bend_twist: null, overhead_reach: null, can_drive: null, other_restrictions: '' },
      aww: null, doa: null, home: '', homePt: null, maxMiles: 30,
      view: 'list', results: [], rawCount: 0
    };
    var geoCache = loadGeoCache();

    // Prefill restrictions from a saved Work Profile (wizard → localStorage), if present, so the
    // quick-search form reflects what the worker already entered in the wizard. Nothing server-side.
    try {
      var _wp = (global.JobBuddyWizard && global.JobBuddyWizard.loadLocal) ? global.JobBuddyWizard.loadLocal() : null;
      if (_wp && _wp.rest) REST_KEYS.forEach(function (k) { if (_wp.rest[k] != null) state.r[k] = _wp.rest[k]; });
    } catch (e) {}

    // When the wizard saves, mirror its restrictions into the live quick-search inputs.
    function applyRestrictions(rest) {
      if (!rest) return;
      REST_KEYS.forEach(function (k) {
        state.r[k] = rest[k];
        var ref = refs[k]; if (!ref) return;
        if (k === 'can_drive') ref.value = rest[k] === true ? 'true' : (rest[k] === false ? 'false' : '');
        else ref.value = (rest[k] == null ? '' : rest[k]);
      });
    }
    global.addEventListener('jobbuddy:profile-updated', function (ev) {
      try { applyRestrictions(ev && ev.detail && ev.detail.rest); } catch (e) {}
    });
    function openWizard() { try { if (global.JobBuddyWizard) global.JobBuddyWizard.open(wizardOpts); } catch (e) {} }

    mount.innerHTML = '';
    var wrap = el('div', { class: 'jb-wrap' });
    mount.appendChild(wrap);

    // ── Hero ──
    wrap.appendChild(el('header', { class: 'jb-hero jb-box' }, [
      el('div', { class: 'jb-eyebrow' }, 'Free Beta · The Comp Desk'),
      el('h1', { class: 'jb-title' }, ['Job Buddy ', el('span', { class: 'jb-beta' }, 'BETA')]),
      el('p', { class: 'jb-sub' },
        'Find real openings that fit your medical work restrictions, near you — with a clear reduced-earnings benefit estimate. No account needed. You apply on the employer’s site; we never apply for you.'),
      el('div', { class: 'jb-hero-actions' }, [
        el('button', { class: 'jbw-launcher', type: 'button', onclick: openWizard }, '✎ Edit my work profile')
      ])
    ]));

    // ── Form ──
    var form = el('section', { class: 'jb-panel jb-box' });
    wrap.appendChild(form);
    form.appendChild(el('h2', { class: 'jb-h2' }, 'Your work restrictions'));
    form.appendChild(el('p', { class: 'jb-help' }, 'Enter the limits from your IME or C-4.3. Nothing is saved — this stays on your device.'));

    function field(label, key, suffix, ph) {
      var inp = el('input', { class: 'jb-input', type: 'number', inputmode: 'numeric', placeholder: ph || '', value: state.r[key] == null ? '' : state.r[key] });
      inp.addEventListener('input', function () { state.r[key] = intOrNull(inp.value); });
      refs[key] = inp;
      return el('label', { class: 'jb-fld' }, [el('span', { class: 'jb-lbl' }, label),
        el('div', { class: 'jb-in-suf' }, [inp, suffix ? el('span', { class: 'jb-suf' }, suffix) : null])]);
    }
    function select(label, key, optsArr) {
      var sel = el('select', { class: 'jb-input' });
      optsArr.forEach(function (o) { var op = el('option', { value: o.v }, o.l); if (String(state.r[key]) === String(o.v)) op.selected = true; sel.appendChild(op); });
      sel.addEventListener('change', function () { state.r[key] = sel.value || null; });
      refs[key] = sel;
      return el('label', { class: 'jb-fld' }, [el('span', { class: 'jb-lbl' }, label), sel]);
    }
    var freq = [{ v: '', l: '—' }, { v: 'none', l: 'None' }, { v: 'occasional', l: 'Occasional' }, { v: 'frequent', l: 'Frequent' }, { v: 'unrestricted', l: 'Unrestricted' }];

    var grid = el('div', { class: 'jb-grid' }, [
      field('Lifting limit', 'lifting_limit_lbs', 'lbs', 'e.g. 10'),
      field('Standing tolerance', 'stand_minutes', 'min', 'e.g. 20'),
      field('Sitting tolerance', 'sit_minutes', 'min', 'e.g. 60'),
      select('Bend / twist', 'bend_twist', freq),
      select('Overhead reach', 'overhead_reach', freq),
      select('Can drive?', 'can_drive', [{ v: '', l: '—' }, { v: 'true', l: 'Yes' }, { v: 'false', l: 'No' }])
    ]);
    form.appendChild(grid);

    var other = el('textarea', { class: 'jb-input jb-ta', placeholder: 'Anything else your doctor restricted (e.g. no repetitive bending, no ladders)…' });
    other.addEventListener('input', function () { state.r.other_restrictions = other.value; });
    form.appendChild(el('label', { class: 'jb-fld' }, [el('span', { class: 'jb-lbl' }, 'Other restrictions'), other]));

    // Benefit + location row
    form.appendChild(el('h2', { class: 'jb-h2 jb-h2-mt' }, 'Benefit estimate & location'));
    form.appendChild(el('p', { class: 'jb-help' }, 'Optional, but adding your AWW and date of accident lets us estimate the reduced-earnings benefit for each job. Add a ZIP or city to sort by distance.'));

    var awwInp = el('input', { class: 'jb-input', type: 'number', inputmode: 'decimal', placeholder: 'e.g. 1100' });
    awwInp.addEventListener('input', function () { state.aww = num(awwInp.value); });
    var doaInp = el('input', { class: 'jb-input', type: 'date' });
    doaInp.setAttribute('max', new Date().toISOString().slice(0, 10));
    doaInp.addEventListener('input', function () { state.doa = doaInp.value || null; });
    var homeInp = el('input', { class: 'jb-input', type: 'text', placeholder: 'ZIP or City, State (e.g. 11201 or Brooklyn, NY)' });
    homeInp.addEventListener('input', function () { state.home = homeInp.value; state.homePt = null; });

    var distVal = el('span', { class: 'jb-dist-val' }, '30 mi');
    var dist = el('input', { class: 'jb-range', type: 'range', min: '10', max: '60', step: '5', value: '30' });
    dist.addEventListener('input', function () { state.maxMiles = intOrNull(dist.value) || 30; distVal.textContent = state.maxMiles + ' mi'; });

    form.appendChild(el('div', { class: 'jb-grid' }, [
      el('label', { class: 'jb-fld' }, [el('span', { class: 'jb-lbl' }, 'Pre-injury AWW'),
        el('div', { class: 'jb-in-suf' }, [el('span', { class: 'jb-suf jb-suf-pre' }, '$'), awwInp])]),
      el('label', { class: 'jb-fld' }, [el('span', { class: 'jb-lbl' }, 'Date of accident'), doaInp]),
      el('label', { class: 'jb-fld jb-fld-wide' }, [el('span', { class: 'jb-lbl' }, 'Your location'), homeInp]),
      el('label', { class: 'jb-fld' }, [el('span', { class: 'jb-lbl' }, ['Max travel distance ', distVal]), dist])
    ]));

    var findBtn = el('button', { class: 'jb-btn jb-btn-primary' }, 'Find jobs within my restrictions');
    var formMsg = el('span', { class: 'jb-msg' }, '');
    findBtn.addEventListener('click', function () { runSearch(findBtn, formMsg); });
    form.appendChild(el('div', { class: 'jb-actions' }, [findBtn, formMsg]));

    // ── Results ──
    var results = el('section', { class: 'jb-results' });
    wrap.appendChild(results);
    var resultsBar = el('div', { class: 'jb-resultsbar jb-box', style: { display: 'none' } });
    var countLbl = el('span', { class: 'jb-count' }, '');
    var toggle = el('div', { class: 'jb-toggle' }, [
      el('button', { class: 'jb-tg is-active', 'data-view': 'list' }, 'List'),
      el('button', { class: 'jb-tg', 'data-view': 'map' }, 'Map')
    ]);
    toggle.addEventListener('click', function (e) {
      var b = e.target.closest('[data-view]'); if (!b) return;
      setView(b.getAttribute('data-view'));
    });
    resultsBar.appendChild(countLbl); resultsBar.appendChild(toggle);
    results.appendChild(resultsBar);

    var listEl = el('div', { id: 'jb-list', class: 'jb-list' });
    var mapEl = el('div', { id: 'jb-map', class: 'jb-map', style: { display: 'none' } });
    results.appendChild(listEl); results.appendChild(mapEl);

    wrap.appendChild(el('p', { class: 'jb-disclaimer jb-box' },
      'Job Buddy is for informational purposes only and does not constitute legal advice. Benefit estimates are illustrative; actual rates are set by the Workers’ Compensation Board.'));

    var mapObj = null, mapMarkers = [];

    function setView(v) {
      state.view = v;
      Array.prototype.forEach.call(toggle.children, function (b) { b.classList.toggle('is-active', b.getAttribute('data-view') === v); });
      listEl.style.display = v === 'list' ? '' : 'none';
      mapEl.style.display = v === 'map' ? '' : 'none';
      if (v === 'map') ensureMap();
    }

    // Sort by fit (good→maybe→poor), then by distance when known.
    function sortResults(arr) {
      var rank = { good: 0, maybe: 1, poor: 2 };
      arr.sort(function (a, b) {
        if (rank[a.fit.score] !== rank[b.fit.score]) return rank[a.fit.score] - rank[b.fit.score];
        var am = a.miles == null ? 1e9 : a.miles, bm = b.miles == null ? 1e9 : b.miles;
        return am - bm;
      });
      return arr;
    }

    // Read the freshest listings (anon). Hard timeout + error surfaced — never a silent hang.
    function fetchListings() {
      var q = supa.from('job_listings')
        .select('id, source, external_id, title, employer, location, salary_min, salary_max, salary_is_predicted, apply_url, description, geo')
        .order('fetched_at', { ascending: false })
        .limit(80)
        .then(function (res) {
          if (res && res.error) throw new Error(res.error.message || 'database error');
          return (res && res.data) || [];
        });
      var timeout = new Promise(function (_, rej) {
        global.setTimeout(function () { rej(new Error('timed out — please try again')); }, 15000);
      });
      return Promise.race([q, timeout]);
    }

    // ── search pipeline ──
    // PHASE 1 (always): read listings → render jobs immediately (no distance gate).
    // PHASE 2 (only if a location was entered, non-blocking): geocode + distance-filter + map.
    // Geocoding can ONLY refine results; it can never block or hide the job list.
    function runSearch(btn, msg) {
      btn.disabled = true; msg.textContent = 'Searching the freshest listings…';
      state.homePt = null;
      var ppdMax = (calc && state.doa) ? calc.maxRateForDOA(state.doa) : 0;

      fetchListings().then(function (rows) {
        state.rawCount = rows.length;
        btn.disabled = false;
        if (!rows.length) { msg.textContent = 'No fresh job listings are cached right now — please check back soon.'; finish([], ppdMax); return; }

        // Phase 1 — show every job now, using only coords that ship with the listing (Adzuna).
        var base = rows.map(function (r) {
          return {
            row: r,
            pt: (r.geo && typeof r.geo.lat === 'number') ? r.geo : null,
            re: computeRE(state.aww, ppdMax, r.salary_min, r.salary_max),
            fit: fitFor(r, state.r),
            miles: null, ppdMax: ppdMax
          };
        });
        sortResults(base);
        msg.textContent = '';
        finish(base, ppdMax);

        // Phase 2 — distance + map, only when a location is given and Mapbox is available.
        if (!normLoc(state.home) || !mapboxToken) return;
        msg.textContent = 'Sorting by distance from you…';
        geocodeOne(mapboxToken, state.home, geoCache).then(function (homePt) {
          if (!homePt) { msg.textContent = 'Couldn’t locate that ZIP/city — showing all matches.'; return; }
          state.homePt = homePt;
          var locs = base.filter(function (j) { return !j.pt; }).map(function (j) { return j.row.location; });
          return geocodeUnique(mapboxToken, locs, geoCache).then(function (byLoc) {
            base.forEach(function (j) {
              if (!j.pt) j.pt = byLoc[normLoc(j.row.location)] || null;
              j.miles = j.pt ? milesBetween(homePt, j.pt) : null;
            });
            // Keep unknown-distance jobs (don't hide a job just because its city wouldn't geocode).
            var within = base.filter(function (j) { return j.miles == null || j.miles <= state.maxMiles; });
            sortResults(within);
            msg.textContent = '';
            finish(within, ppdMax);
          });
        }).catch(function () { msg.textContent = ''; /* distance is best-effort */ });
      }).catch(function (e) {
        btn.disabled = false;
        msg.textContent = 'Couldn’t load listings (' + ((e && e.message) || 'network error') + '). Please check your connection and try again.';
      });
    }

    function finish(enriched, ppdMax) {
      state.results = enriched;
      resultsBar.style.display = '';
      var n = enriched.length;
      countLbl.textContent = n + (n === 1 ? ' opening' : ' openings') +
        (state.homePt ? ' within ' + state.maxMiles + ' mi' : '') + ' · matched from ' + state.rawCount + ' fresh listings';
      renderList();
      // Rebuild the map markers if the map is already live (or being shown now).
      if (state.view === 'map') ensureMap();
      else if (mapObj) renderMap();
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderList() {
      listEl.innerHTML = '';
      if (!state.results.length) {
        listEl.appendChild(el('div', { class: 'jb-empty jb-box' }, [
          el('div', { class: 'jb-empty-i' }, '🔍'),
          el('h3', {}, 'No matching openings yet'),
          el('p', {}, 'Try widening your travel distance or clearing your location to see everything currently cached.')
        ]));
        return;
      }
      state.results.forEach(function (j) { listEl.appendChild(card(j)); });
    }

    function card(j) {
      var l = j.row, re = j.re, fit = j.fit;
      var c = el('article', { class: 'jb-card jb-box' });
      c.appendChild(el('div', { class: 'jb-card-head' }, [
        el('div', {}, [
          el('div', { class: 'jb-card-title' }, l.title || 'Position'),
          el('div', { class: 'jb-card-meta' }, [l.employer, l.location].filter(Boolean).join(' · ') || '')
        ]),
        el('span', { class: 'jb-fit jb-fit-' + fit.score }, fit.label)
      ]));
      c.appendChild(el('div', { class: 'jb-card-rat' }, fit.rationale[0]));

      if (j.miles != null) c.appendChild(el('div', { class: 'jb-card-dist' }, '📍 about ' + j.miles + ' mi from you'));

      var reLine = el('div', { class: 'jb-re' });
      if (re.est_re_benefit_weekly != null) {
        reLine.appendChild(el('span', {}, [el('strong', {}, money(re.est_re_benefit_weekly) + '/wk'), ' est. reduced-earnings benefit']));
        reLine.appendChild(el('span', { class: 'jb-re-calc' },
          '⅔ × (AWW ' + money(state.aww) + ' − est. pay ' + money(re.job_weekly_earnings) + '/wk)' + (l.salary_is_predicted ? ' · pay estimated' : '')));
      } else if (!state.aww || !state.doa) {
        reLine.appendChild(el('span', { class: 'jb-re-calc' }, 'Add your AWW + date of accident above to estimate the reduced-earnings benefit.'));
      } else {
        reLine.appendChild(el('span', { class: 'jb-re-calc' }, 'Pay not stated — reduced-earnings benefit can’t be estimated for this listing.'));
      }
      c.appendChild(reLine);

      var sga = sgaRedFlag(re.job_weekly_earnings);
      if (sga) c.appendChild(el('ul', { class: 'jb-flags' }, [el('li', {}, sga)]));

      var apply = el('a', { class: 'jb-btn jb-btn-primary jb-btn-sm', href: l.apply_url || '#', target: '_blank', rel: 'noopener' }, 'Apply on employer site ↗');
      if (!l.apply_url) { apply.classList.add('is-disabled'); apply.setAttribute('aria-disabled', 'true'); apply.removeAttribute('href'); }
      c.appendChild(el('div', { class: 'jb-card-actions' }, [apply]));
      return c;
    }

    function ensureMap() {
      if (mapObj || !global.mapboxgl || !mapboxToken) { renderMap(); return; }
      try {
        global.mapboxgl.accessToken = mapboxToken;
        mapObj = new global.mapboxgl.Map({
          container: 'jb-map',
          style: 'mapbox://styles/mapbox/light-v11',
          center: [-73.94, 40.73], zoom: 9
        });
        mapObj.addControl(new global.mapboxgl.NavigationControl(), 'top-right');
        mapObj.on('load', renderMap);
      } catch (e) { mapObj = null; }
    }

    function renderMap() {
      if (!mapObj) return;
      mapMarkers.forEach(function (m) { m.remove(); }); mapMarkers = [];
      var bounds = global.mapboxgl ? new global.mapboxgl.LngLatBounds() : null, any = false;

      if (state.homePt) {
        var hm = new global.mapboxgl.Marker({ color: '#1B2A4A' })
          .setLngLat([state.homePt.lng, state.homePt.lat])
          .setPopup(new global.mapboxgl.Popup({ offset: 18 }).setText('Your location'))
          .addTo(mapObj);
        mapMarkers.push(hm); if (bounds) { bounds.extend([state.homePt.lng, state.homePt.lat]); any = true; }
      }

      state.results.forEach(function (j) {
        if (!j.pt) return;
        var l = j.row;
        var html = '<strong>' + esc(l.title || 'Position') + '</strong><br>' +
          esc([l.employer, l.location].filter(Boolean).join(' · ')) +
          (j.re.est_re_benefit_weekly != null ? '<br>' + money(j.re.est_re_benefit_weekly) + '/wk est. RE benefit' : '') +
          (l.apply_url ? '<br><a href="' + esc(l.apply_url) + '" target="_blank" rel="noopener">Apply ↗</a>' : '');
        var color = j.fit.score === 'good' ? '#2E7D32' : (j.fit.score === 'maybe' ? '#E87722' : '#9aa0ab');
        var mk = new global.mapboxgl.Marker({ color: color })
          .setLngLat([j.pt.lng, j.pt.lat])
          .setPopup(new global.mapboxgl.Popup({ offset: 18 }).setHTML(html))
          .addTo(mapObj);
        mapMarkers.push(mk); if (bounds) { bounds.extend([j.pt.lng, j.pt.lat]); any = true; }
      });

      if (any && bounds) { try { mapObj.fitBounds(bounds, { padding: 56, maxZoom: 12, duration: 400 }); } catch (e) {} }
      setTimeout(function () { try { mapObj.resize(); } catch (e) {} }, 60);
    }

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  };

})(typeof window !== 'undefined' ? window : this);
