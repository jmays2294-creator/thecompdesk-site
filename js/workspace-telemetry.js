/**
 * workspace-telemetry.js — what attorneys actually DO in the Pro workspace.
 *
 * WHY THIS EXISTS
 * The improvement loop can see what is BROKEN by sweeping the surface with a
 * headless browser. It cannot see what is SLOW, confusing, or out of order for
 * a real attorney with a real caseload — which tiles they reach for together,
 * which field they always fill last, where a session dies without producing
 * anything. That signal is the difference between polishing buttons and
 * shipping the workflow shortcut somebody actually wanted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE: THIS FILE NEVER SEES CASE DATA.
 *
 * Attorneys type claimant names, WCB case numbers, dates of injury and exact
 * wages into these tiles. All of it is privileged. So this module records
 * STRUCTURE (which tile, which order, which field NAME was filled, where the
 * session ended) and BUCKETED SHAPE (an AWW band, a DOI year, a percentage
 * band) — never a value a person could be identified from.
 *
 * There are two independent enforcement layers, on purpose:
 *   1. here — the emitter only ever reads field NAMES off the DOM, never
 *      `input.value`. Grep this file for `.value`: there is exactly one use,
 *      and it reads `.length` to decide filled-vs-empty.
 *   2. the database — tg_workspace_telemetry_guard RAISES on anything that
 *      looks like an identifier, a full date, an email, or free prose.
 *
 * Layer 2 exists because this file is a static asset anyone can fork, and
 * because a privilege leak is not the class of bug you discover later. If you
 * add an emit call and the row bounces with check_violation, the guard is
 * working — bucket the value, do not widen the guard.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * FAILURE POSTURE
 * Telemetry is never allowed to interrupt an attorney mid-calculation. Every
 * path here is wrapped, the transport is fire-and-forget, and a rejected batch
 * is dropped rather than retried forever. A dropped event costs one data point;
 * a thrown exception inside a fee calculation costs a client's fee application.
 *
 * TRANSPORT
 * Plain fetch against PostgREST rather than the supabase-js client, because
 * this loads on both the module pages (/calculators/*) and the Babel-transformed
 * plain-script workspace bundle, and because it must not add a second
 * GoTrueClient to any page (see js/supabase-client.js for why that hurts).
 * The user's JWT is read from the same localStorage key the shared client uses.
 *
 * OPT OUT
 *   localStorage.setItem('tcd_no_telemetry', '1')   // per browser
 *   navigator.doNotTrack === '1'                    // honoured
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://ltibymvlytodkemdeeox.supabase.co';
  var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0aWJ5bXZseXRvZGtlbWRlZW94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjA1NjYsImV4cCI6MjA5MDM5NjU2Nn0.b5oQqQIdgJRc0DEP2k7kMVdCRzfyfnuAwjVNZlbVyak';
  var AUTH_STORAGE_KEY = 'sb-ltibymvlytodkemdeeox-auth-token';
  var ENDPOINT = SUPABASE_URL + '/rest/v1/workspace_telemetry';

  var FLUSH_MS = 4000;
  var MAX_BATCH = 25;
  var MAX_EVENTS_PER_SESSION = 400;   // a runaway loop costs bandwidth, not money

  // ── opt-out ───────────────────────────────────────────────────────────────
  function optedOut() {
    try {
      if (localStorage.getItem('tcd_no_telemetry') === '1') return true;
      if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return true;
    } catch (e) { /* private mode: fall through, we simply won't persist ids */ }
    return false;
  }

  if (optedOut()) {
    window.wsTelemetry = noop();
    return;
  }

  // ── identity ──────────────────────────────────────────────────────────────
  function uuid() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
    });
  }

  function store(key, make) {
    try {
      var v = sessionStorage.getItem(key);
      if (!v) { v = make(); sessionStorage.setItem(key, v); }
      return v;
    } catch (e) { return make(); }
  }

  var sessionId = store('tcd_ws_session', uuid);
  var anonId = (function () {
    try {
      var v = localStorage.getItem('tcd_anon_id');
      if (!v) { v = uuid(); localStorage.setItem('tcd_anon_id', v); }
      return v;
    } catch (e) { return null; }
  })();

  function accessToken() {
    try {
      var raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return (parsed && parsed.access_token) || null;
    } catch (e) { return null; }
  }

  function userId() {
    if (window.workspaceUserId) return window.workspaceUserId;
    try {
      var raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      return (p && p.user && p.user.id) || null;
    } catch (e) { return null; }
  }

  // ── bucketing ─────────────────────────────────────────────────────────────
  // Every one of these returns a SHORT LABEL, never the number it was given.
  // They are the only sanctioned way a number reaches the database.
  function bucketMoney(n) {
    n = Number(n);
    if (!isFinite(n) || n <= 0) return 'none';
    var edges = [250, 500, 750, 1000, 1500, 2000, 3000, 5000];
    for (var i = 0; i < edges.length; i++) {
      if (n < edges[i]) return (i === 0 ? '0' : String(edges[i - 1])) + '-' + edges[i];
    }
    return '5000+';
  }

  function bucketPct(n) {
    n = Number(n);
    if (!isFinite(n) || n <= 0) return 'none';
    if (n < 10) return '1-9';
    if (n < 25) return '10-24';
    if (n < 50) return '25-49';
    if (n < 75) return '50-74';
    if (n < 100) return '75-99';
    return '100';
  }

  // A date of injury is client data. Its YEAR is a product signal — it tells us
  // whether people are working current claims or reconstructing old ones, which
  // changes which rate tables matter. Anything finer than a year is refused.
  function bucketYear(d) {
    try {
      var y = (d instanceof Date) ? d.getFullYear() : new Date(String(d)).getFullYear();
      if (!y || !isFinite(y)) return 'unknown';
      var now = new Date().getFullYear();
      if (y > now + 1 || y < 1970) return 'unknown';
      if (y < now - 10) return 'pre-' + (now - 10);
      return String(y);
    } catch (e) { return 'unknown'; }
  }

  function bucketCount(n) {
    n = Number(n);
    if (!isFinite(n) || n <= 0) return '0';
    if (n === 1) return '1';
    if (n <= 3) return '2-3';
    if (n <= 6) return '4-6';
    if (n <= 12) return '7-12';
    return '13+';
  }

  function bucketMs(ms) {
    ms = Number(ms);
    if (!isFinite(ms) || ms < 0) return 'unknown';
    var s = ms / 1000;
    if (s < 5) return '0-5s';
    if (s < 30) return '5-30s';
    if (s < 120) return '30s-2m';
    if (s < 600) return '2-10m';
    if (s < 1800) return '10-30m';
    return '30m+';
  }

  /**
   * Reduce an arbitrary DOM-derived string to a field IDENTIFIER.
   *
   * Deliberately lossy: lowercased, digits stripped, punctuation collapsed,
   * and — critically — TRUNCATED TO THE FIRST FOUR TOKENS.
   *
   * The token cap is not cosmetic. A first version stripped digits and
   * truncated at 40 characters, and the privacy test caught it turning
   * "Claimant Name (WCB #G2845571) — Maria Rodriguez" into
   * "claimant_name_wcb_g_maria_rodriguez". The case number was gone; the
   * claimant's NAME was not. Nothing downstream would have flagged that: it has
   * no digits, no '@', no date, and it is under the length limit, so the
   * database guard would have accepted it. A person's name would have sat in a
   * telemetry table indefinitely.
   *
   * Real field labels are one to four words — "Average Weekly Wage", "Date of
   * Injury", "Percentage". Interpolated case data is what makes a label long.
   * So: four tokens, and anything that arrives as prose is refused outright
   * rather than trimmed, because trimming prose still keeps its first four
   * words.
   */
  // Five, not eight. Eight was the first guess and the privacy test showed it
  // still let "Claimant Name (WCB #G2845571) — Maria Rodriguez" through as
  // "claimant_name_wcb_maria": seven words squeaked under the prose gate, and
  // the four-token cap then kept the first name. The longest legitimate label
  // on this surface is "Loss of Wage Earning Capacity" — five words. So the
  // limit is five, which refuses that string outright.
  var MAX_LABEL_WORDS = 5;
  var MAX_SLUG_TOKENS = 4;

  function slugField(s) {
    if (!s) return null;
    var raw = String(s);
    // Prose is where names live. Do not attempt to salvage it.
    if (raw.split(/\s+/).length > MAX_LABEL_WORDS) return 'long_label';
    var tokens = raw
      .toLowerCase()
      .replace(/[0-9]+/g, ' ')
      .replace(/[^a-z]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(function (t) { return t.length > 1; });   // drops stray initials
    if (!tokens.length) return null;
    return tokens.slice(0, MAX_SLUG_TOKENS).join('_').slice(0, 40) || null;
  }

  // ── queue + transport ─────────────────────────────────────────────────────
  var queue = [];
  var seq = 0;
  var emitted = 0;
  var sessionStart = Date.now();
  var lastAt = sessionStart;
  var timer = null;
  var stopped = false;

  function currentTier() {
    return window.currentTier || (window.__tcdTier) || null;
  }

  function post(rows, keepalive) {
    if (!rows.length) return;
    var token = accessToken();
    var headers = {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': 'Bearer ' + (token || ANON_KEY),
      'Prefer': 'return=minimal',
    };
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(rows),
        keepalive: !!keepalive,
        mode: 'cors',
      }).then(function (r) {
        // A 4xx here is almost always the database guard rejecting a value that
        // should have been bucketed. Say so once, loudly, in dev — silence is
        // how a broken emitter ships. Never throw.
        if (!r.ok && !post._warned) {
          post._warned = true;
          r.text().then(function (t) {
            console.warn('[ws-telemetry] batch rejected (' + r.status + ') — bucket the value, do not widen the guard:', String(t).slice(0, 300));
          }).catch(function () {});
        }
      }).catch(function () { /* offline; drop it */ });
    } catch (e) { /* never let telemetry surface to the user */ }
  }

  function flush(keepalive) {
    if (!queue.length) return;
    var batch = queue.splice(0, MAX_BATCH);
    post(batch, keepalive);
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; flush(false); }, FLUSH_MS);
  }

  /**
   * The single entry point. Everything else is sugar over this.
   * @param {string} action   one of the enumerated actions (DB CHECK enforces)
   * @param {object} detail   { surface, route, tile_type, tile_ref, fields,
   *                            buckets, error_code, props }
   */
  function emit(action, detail) {
    try {
      if (stopped || !action) return;
      if (emitted >= MAX_EVENTS_PER_SESSION) return;
      emitted++;
      detail = detail || {};
      var now = Date.now();
      var row = {
        event_id: uuid(),
        session_id: sessionId,
        user_id: userId(),
        anon_id: anonId,
        tier_at_use: detail.tier || currentTier(),
        designation_at_use: detail.designation || window.currentDesignation || null,
        surface: detail.surface || inferSurface(),
        route: detail.route || location.pathname,
        tile_type: detail.tile_type || null,
        tile_ref: detail.tile_ref || null,
        action: action,
        seq: ++seq,
        ms_since_session_start: now - sessionStart,
        ms_since_prev: now - lastAt,
        fields_filled: (detail.fields || []).map(slugField).filter(Boolean).slice(0, 20),
        buckets: detail.buckets || {},
        error_code: detail.error_code ? String(detail.error_code).slice(0, 60) : null,
        props: detail.props || {},
        ts: new Date().toISOString(),
      };
      lastAt = now;
      queue.push(row);
      if (queue.length >= MAX_BATCH) flush(false); else schedule();
    } catch (e) { /* swallow */ }
  }

  function inferSurface() {
    var p = location.pathname;
    if (p.indexOf('/workspace') === 0) return 'workspace';
    if (p.indexOf('/calculators') === 0) return 'calculators';
    if (p.indexOf('/dashboard') === 0) return 'dashboard';
    if (p.indexOf('/account') === 0) return 'account';
    if (p.indexOf('/pricing') === 0 || p.indexOf('/for-attorneys') === 0) return 'upgrade';
    return 'workspace';
  }

  // ── auto-instrumentation ──────────────────────────────────────────────────
  // These give the loop useful signal on day one without threading emit() calls
  // through 4,600 lines of tiles.js. Explicit calls (addTile, save, fee app)
  // are still worth adding — they carry intent this cannot infer.

  // 1. field_filled, by delegation. Reads the field's NAME, never its value;
  //    `.value.length` below is the only read of a value in this file, and it
  //    only decides filled-vs-empty.
  function onChange(e) {
    try {
      var el = e.target;
      if (!el || !el.tagName) return;
      var tag = el.tagName.toLowerCase();
      if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return;
      if (el.type === 'password') return;                       // never, under any circumstance
      var filled = (el.type === 'checkbox' || el.type === 'radio')
        ? el.checked
        : !!(el.value && String(el.value).length);
      // Attribute order is a privacy decision, not a convenience one.
      // data-field / name / id are authored by us and are structural.
      // aria-label and placeholder are user-facing copy and are the two most
      // likely to have a case detail interpolated into them, so they are last
      // resorts rather than first choices.
      var name = slugField(
        el.getAttribute('data-field') || el.getAttribute('name') || el.id ||
        el.getAttribute('aria-label') || el.getAttribute('placeholder')
      );
      if (!name) return;
      emit(filled ? 'field_filled' : 'field_cleared', {
        tile_type: tileTypeOf(el),
        tile_ref: tileRefOf(el),
        fields: [name],
      });
    } catch (err) { /* swallow */ }
  }

  // Walks up for a tile marker. app.js renders <Tile> without a type attribute
  // today, so this returns null until the wiring below is in place — it is
  // written to degrade to null rather than guess wrong.
  function tileTypeOf(el) {
    try {
      var n = el.closest && el.closest('[data-tile-type]');
      return n ? String(n.getAttribute('data-tile-type')).slice(0, 40) : null;
    } catch (e) { return null; }
  }
  function tileRefOf(el) {
    try {
      var n = el.closest && el.closest('[data-tile-ref]');
      return n ? String(n.getAttribute('data-tile-ref')).slice(0, 24) : null;
    } catch (e) { return null; }
  }

  // 2. uncaught errors — a JS error in a tile is a P0 the sweep may not reach
  function onError(e) {
    emit('error', {
      error_code: (e && e.message ? String(e.message) : 'unknown').slice(0, 60),
      props: { kind: 'window_error' },
    });
  }

  // 3. session close — the last thing that happened is the drop-off point
  function onHide() {
    if (stopped) return;
    emit('session_end', { buckets: { duration: bucketMs(Date.now() - sessionStart) } });
    stopped = true;
    flush(true);
  }

  // ── public surface ────────────────────────────────────────────────────────
  function noop() {
    var f = function () {};
    return {
      event: f, tile: f, field: f, calc: f, error: f, flush: f,
      bucketMoney: function () { return 'none'; }, bucketPct: function () { return 'none'; },
      bucketYear: function () { return 'unknown'; }, bucketCount: function () { return '0'; },
      bucketMs: function () { return 'unknown'; },
      sessionId: null, enabled: false,
    };
  }

  var api = {
    enabled: true,
    sessionId: sessionId,
    event: emit,
    /** tile('tile_add', 'SLU', { tile_ref: 't3' }) */
    tile: function (action, tileType, detail) {
      detail = detail || {};
      detail.tile_type = tileType;
      emit(action, detail);
    },
    /** field('SLU', ['aww','doi'], { aww_band: '1000-1500' }) */
    field: function (tileType, fields, buckets) {
      emit('field_filled', { tile_type: tileType, fields: fields || [], buckets: buckets || {} });
    },
    /** calc('SLU', { pct_band: '25-49' }) */
    calc: function (tileType, buckets) {
      emit('calc_run', { tile_type: tileType, buckets: buckets || {} });
    },
    error: function (code, detail) {
      detail = detail || {}; detail.error_code = code;
      emit('calc_error', detail);
    },
    flush: function () { flush(false); },
    bucketMoney: bucketMoney,
    bucketPct: bucketPct,
    bucketYear: bucketYear,
    bucketCount: bucketCount,
    bucketMs: bucketMs,
    slugField: slugField,
  };

  window.wsTelemetry = api;

  // Boot. Deliberately last, so a failure while attaching listeners still
  // leaves window.wsTelemetry defined and callable.
  try {
    document.addEventListener('change', onChange, true);
    window.addEventListener('error', onError);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush(true);
    });
    emit('session_start', {
      props: {
        vw: String(window.innerWidth || 0).slice(0, 5),
        ref: document.referrer ? 'internal' : 'direct',
      },
    });
  } catch (e) { /* swallow */ }
})();
