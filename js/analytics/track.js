/* ============================================================================
 * track.js — CD.track(name, props): the one call sites use.
 * ----------------------------------------------------------------------------
 * FAILURE MODE IS SILENT. This is the ONE place in this codebase that
 * deliberately inverts the fail-loud rule in ops/dev/CLAUDE.md's Database
 * Operations Playbook ("any DB read whose error path silently degrades the
 * user experience MUST also surface the error"). That rule protects users
 * from silently losing access to something they're entitled to. Analytics is
 * the opposite shape: nobody is entitled to a working funnel chart, but every
 * user is entitled to a screen that doesn't break because a background
 * tracking call threw. So: everything past name/registration validation is
 * wrapped and swallowed, unconditionally, dev or prod. Do not "fix" this by
 * adding error surfacing later — that would be the correct instinct for
 * every other read/write in this app and the wrong one here.
 *
 * The ONE exception is the registration check itself: an unregistered event
 * name throws, but ONLY when CD.track() is running outside a native
 * Capacitor build (i.e. a plain browser preview during development) — see
 * isDev() below. On a real device/TestFlight/App Store build it is always a
 * silent no-op, same as every other analytics failure. This is a developer
 * aid for catching typos in CD.Analytics.EVENTS (events.js), not a
 * production behavior.
 *
 * Transport: direct PostgREST batch insert via the existing Supabase client
 * (window.CD.supa / window.supa, same fallback chain as usage-log.js). No
 * edge function — an invocation per batch is pure cost for zero benefit, and
 * RLS on analytics_events (098) already enforces insert-only for anon/
 * authenticated.
 * ==========================================================================*/
(function () {
  'use strict';
  window.CD = window.CD || {};

  var ANON_ID_KEY    = 'cd_analytics_anon_id';
  var SESSION_KEY    = 'cd_analytics_session_id';
  var SESSION_TS_KEY = 'cd_analytics_session_ts';
  var SESSION_IDLE_MS = 30 * 60 * 1000; // rotate session_id after 30 min idle

  var _anonId = null;
  var _sessionId = null;
  var _appVersion = null;

  function _prefs() {
    try {
      return (window.Capacitor && window.Capacitor.Plugins &&
              window.Capacitor.Plugins.Preferences) || null;
    } catch (e) { return null; }
  }

  function uuid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (e) { /* fall through to manual v4 below */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // anon_id survives logout by design — it identifies the DEVICE/browser
  // profile across the pre-account funnel and after sign-out, not the user.
  function getAnonId() {
    if (_anonId) return _anonId;
    try {
      var stored = window.localStorage && window.localStorage.getItem(ANON_ID_KEY);
      if (stored) { _anonId = stored; return _anonId; }
    } catch (e) { /* no-op */ }
    _anonId = uuid();
    try { window.localStorage.setItem(ANON_ID_KEY, _anonId); } catch (e) { /* no-op */ }
    var P = _prefs();
    if (P) { try { P.set({ key: ANON_ID_KEY, value: _anonId }); } catch (e) { /* no-op */ } }
    return _anonId;
  }

  // Best-effort backfill from Capacitor Preferences (survives a localStorage
  // clear) — same shape as CD.Experience's _restoreAsync. Runs once; if it
  // resolves after the first getAnonId() already generated a fresh id, the
  // fresh id wins (already persisted) rather than being clobbered mid-session.
  (function backfillAnonId() {
    var P = _prefs();
    if (!P) return;
    try {
      P.get({ key: ANON_ID_KEY }).then(function (res) {
        var v = res && res.value;
        if (!v) return;
        try {
          if (!window.localStorage.getItem(ANON_ID_KEY)) {
            window.localStorage.setItem(ANON_ID_KEY, v);
          }
        } catch (e) { /* no-op */ }
      }).catch(function () { /* no-op */ });
    } catch (e) { /* no-op */ }
  })();

  function getSessionId() {
    var now = Date.now();
    try {
      var lastTs = parseInt(window.localStorage.getItem(SESSION_TS_KEY), 10);
      var stored = window.localStorage.getItem(SESSION_KEY);
      if (stored && lastTs && (now - lastTs) < SESSION_IDLE_MS) {
        _sessionId = stored;
      } else {
        _sessionId = uuid();
        window.localStorage.setItem(SESSION_KEY, _sessionId);
      }
      window.localStorage.setItem(SESSION_TS_KEY, String(now));
    } catch (e) {
      if (!_sessionId) _sessionId = uuid();
    }
    return _sessionId;
  }

  function getSurface() {
    try {
      if (window.Capacitor && typeof window.Capacitor.getPlatform === 'function') {
        var p = window.Capacitor.getPlatform();
        if (p === 'ios') return 'app_ios';
        if (p === 'android') return 'app_android';
      }
    } catch (e) { /* no-op */ }
    return 'web';
  }

  (function loadAppVersion() {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App &&
          typeof window.Capacitor.Plugins.App.getInfo === 'function') {
        window.Capacitor.Plugins.App.getInfo().then(function (info) {
          _appVersion = (info && info.version) || null;
        }).catch(function () { /* no-op */ });
      }
    } catch (e) { /* no-op */ }
  })();

  // Native build (device/simulator/TestFlight/App Store) => always prod,
  // never throws. Anything else (plain browser preview, no Capacitor
  // runtime) => dev, so typo'd event names surface during development.
  function isDev() {
    try {
      if (window.CD && window.CD.DEBUG === true) return true;
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') {
        return !window.Capacitor.isNativePlatform();
      }
    } catch (e) { /* no-op */ }
    return true;
  }

  function buildRow(name, props) {
    var p = (props && typeof props === 'object') ? props : {};
    return {
      event_id: uuid(),
      anon_id: getAnonId(),
      user_id: (window.CD && window.CD.currentUser && window.CD.currentUser.id) || null,
      session_id: getSessionId(),
      surface: getSurface(),
      app_version: _appVersion,
      locale: (window.CD && window.CD.I18N && typeof window.CD.I18N.getLocale === 'function')
        ? window.CD.I18N.getLocale() : null,
      name: name,
      step: (p.step !== undefined && p.step !== null) ? String(p.step) : null,
      segment: (window.CD && window.CD.Onboarding && window.CD.Onboarding.segment) || null,
      props: p,
      ts: new Date().toISOString()
    };
  }

  function transport(batch) {
    var supa = (window.CD && window.CD.supa) || window.supa || null;
    if (!supa || !batch || !batch.length) return Promise.resolve(false);
    return supa.from('analytics_events').insert(batch).then(function (res) {
      return !(res && res.error);
    }, function () { return false; });
  }

  function track(name, props) {
    if (!window.CD.Analytics || !window.CD.Analytics.isRegisteredEvent(name)) {
      if (isDev()) {
        throw new Error('[CD.track] "' + name + '" is not a registered event. ' +
          'Add it to CD.Analytics.EVENTS in www/js/analytics/events.js.');
      }
      return; // prod: unregistered/typo'd names are a silent no-op
    }
    try {
      var row = buildRow(name, props);
      window.CD.Analytics.Queue.push(row);
    } catch (e) {
      // FAILURE MODE IS SILENT — see header comment.
    }
  }

  window.CD.Analytics = window.CD.Analytics || {};
  window.CD.Analytics.Queue.init({ transport: transport });
  window.CD.track = track;
})();

/* ============================================================================
 * CD.FLAGS.v2Onboarding — feature flag for the v2 onboarding flow.
 * ----------------------------------------------------------------------------
 * Lives in this file (rather than its own www/js/flags.js) so the branch
 * stays within the hard 4-line index.html budget — 1 CSS link
 * (tokens-v2.css) + 3 script tags (events.js, queue.js, track.js) already
 * account for every new line index.html is allowed. This IIFE is otherwise
 * fully independent of CD.track/CD.Analytics above it.
 *
 * Resolution order: localStorage override -> notify_config remote row
 * (098/100's public.notify_config, name='v2_onboarding_enabled') -> default
 * false. An override always wins and skips the remote fetch entirely, so a
 * developer/QA device can force the flag without waiting on a network
 * round-trip. With no override, CD.FLAGS.v2Onboarding reads false
 * synchronously until the remote fetch resolves (or fails — the branch must
 * merge and boot dark if the flag row is ever unreachable), then flips to
 * whatever the row says. Await CD.FLAGS.ready if a caller needs the
 * resolved value rather than the safe-default placeholder.
 * ==========================================================================*/
(function () {
  'use strict';
  window.CD = window.CD || {};

  var OVERRIDE_KEY = 'cd_flag_v2_onboarding';

  function readOverride() {
    try {
      var v = window.localStorage && window.localStorage.getItem(OVERRIDE_KEY);
      if (v === 'true') return true;
      if (v === 'false') return false;
    } catch (e) { /* no-op */ }
    return null;
  }

  function setOverride(value) {
    try {
      if (value === null) {
        window.localStorage.removeItem(OVERRIDE_KEY);
      } else {
        window.localStorage.setItem(OVERRIDE_KEY, value ? 'true' : 'false');
      }
    } catch (e) { /* no-op */ }
    FLAGS.v2Onboarding = resolveSync();
  }

  function resolveSync() {
    var o = readOverride();
    return o === null ? false : o;
  }

  function fetchRemote() {
    var override = readOverride();
    if (override !== null) return Promise.resolve(override);

    var supa = (window.CD && window.CD.supa) || window.supa || null;
    if (!supa) return Promise.resolve(false);

    return supa
      .from('notify_config')
      .select('value')
      .eq('name', 'v2_onboarding_enabled')
      .maybeSingle()
      .then(function (res) {
        return !!(res && res.data && res.data.value === 'true');
      }, function () { return false; });
  }

  var FLAGS = { v2Onboarding: resolveSync(), setOverride: setOverride };

  FLAGS.ready = fetchRemote()
    .then(function (resolved) { FLAGS.v2Onboarding = resolved; return resolved; })
    .catch(function () { return false; }); // unreachable flag row -> stays false, never breaks boot

  window.CD.FLAGS = FLAGS;
})();
