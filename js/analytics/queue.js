/* ============================================================================
 * queue.js — CD.Analytics.Queue: batching + offline buffer for CD.track().
 * ----------------------------------------------------------------------------
 * Injured workers on the subway are a real cohort — losing their funnel data
 * to a dead connection is losing the funnel. Every pushed event is persisted
 * (Capacitor Preferences on native, localStorage fallback on web) before this
 * module ever tries to send it, and a failed flush leaves the batch queued
 * for the next trigger rather than dropping it.
 *
 * This module knows nothing about analytics_events or Supabase — it is handed
 * a transport function by whoever calls init() (track.js) and just decides
 * WHEN to call it: at 20 queued events, every 5 seconds, on a screen change,
 * when the tab/app goes to background, and once more on reconnect.
 *
 * Flush triggers:
 *   - queue reaches 20 events
 *   - a 5-second timer, whenever the queue is non-empty
 *   - explicit notifyScreenChange() (see note below — this app has no
 *     hash/URL router to hook automatically, so this is exposed for a future
 *     caller to invoke; hashchange/popstate are wired defensively in case
 *     that ever changes, but neither is expected to fire today)
 *   - visibilitychange -> 'hidden'
 *   - Capacitor App 'appStateChange' -> background
 *   - the 'online' event (drains whatever survived the outage)
 * ==========================================================================*/
(function () {
  'use strict';
  window.CD = window.CD || {};

  var STORAGE_KEY = 'cd_analytics_queue';
  var MAX_BATCH = 20;
  var MAX_WAIT_MS = 5000;

  var _queue = [];
  var _transport = null;   // async function(events) -> boolean success, set by init()
  var _flushing = false;
  var _timer = null;
  var _loaded = false;     // becomes true once the persisted backlog has been read in

  function _prefs() {
    try {
      return (window.Capacitor && window.Capacitor.Plugins &&
              window.Capacitor.Plugins.Preferences) || null;
    } catch (e) { return null; }
  }

  function _readLocalStorage() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function _writeLocalStorage(items) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (e) { /* no-op */ }
  }

  function _persist() {
    _writeLocalStorage(_queue);
    var P = _prefs();
    if (P) {
      try { P.set({ key: STORAGE_KEY, value: JSON.stringify(_queue) }); } catch (e) { /* no-op */ }
    }
  }

  // Authoritative backlog load: prefer Capacitor Preferences on native
  // (survives a localStorage clear), merge with whatever localStorage has,
  // de-duped by event_id. Runs once, best-effort, never blocks push().
  function _loadBacklog() {
    function merge(remote) {
      var seen = Object.create(null);
      var merged = [];
      (remote || []).concat(_readLocalStorage()).concat(_queue).forEach(function (evt) {
        if (evt && evt.event_id && !seen[evt.event_id]) {
          seen[evt.event_id] = true;
          merged.push(evt);
        }
      });
      _queue = merged;
      _loaded = true;
      _persist();
      _maybeFlush();
    }

    var P = _prefs();
    if (!P) { merge([]); return; }
    try {
      P.get({ key: STORAGE_KEY }).then(function (res) {
        var parsed = [];
        try { parsed = res && res.value ? JSON.parse(res.value) : []; } catch (e) { parsed = []; }
        merge(Array.isArray(parsed) ? parsed : []);
      }).catch(function () { merge([]); });
    } catch (e) { merge([]); }
  }

  function _maybeFlush() {
    if (_queue.length >= MAX_BATCH) flush();
  }

  function flush() {
    if (_flushing || _queue.length === 0 || typeof _transport !== 'function') {
      return Promise.resolve(false);
    }
    _flushing = true;
    var batch = _queue.slice(0, MAX_BATCH);

    return Promise.resolve()
      .then(function () { return _transport(batch); })
      .then(function (ok) {
        if (ok) {
          var sent = Object.create(null);
          batch.forEach(function (evt) { if (evt && evt.event_id) sent[evt.event_id] = true; });
          _queue = _queue.filter(function (evt) { return !(evt && evt.event_id && sent[evt.event_id]); });
          _persist();
        }
        _flushing = false;
        return !!ok;
      })
      .catch(function () {
        // Transport failed (offline, RLS abuse-guard rejection, whatever) —
        // leave the batch queued. The 5s timer / next trigger retries it.
        _flushing = false;
        return false;
      });
  }

  function push(event) {
    _queue.push(event);
    _persist();
    _maybeFlush();
  }

  function notifyScreenChange() { flush(); }

  function init(opts) {
    var o = opts || {};
    _transport = o.transport || null;

    if (!_loaded) _loadBacklog();

    if (_timer) clearInterval(_timer);
    _timer = setInterval(function () {
      if (_queue.length > 0) flush();
    }, MAX_WAIT_MS);

    try {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flush();
      });
    } catch (e) { /* no-op */ }

    // Defensive — this app does not use hash/URL routing today, so these
    // rarely fire, but wiring them costs nothing and covers the app if that
    // ever changes without needing to revisit this file.
    try {
      window.addEventListener('hashchange', notifyScreenChange);
      window.addEventListener('popstate', notifyScreenChange);
    } catch (e) { /* no-op */ }

    try { window.addEventListener('online', flush); } catch (e) { /* no-op */ }

    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
        window.Capacitor.Plugins.App.addListener('appStateChange', function (state) {
          if (state && !state.isActive) flush();
        });
      }
    } catch (e) { /* no-op */ }
  }

  window.CD.Analytics = window.CD.Analytics || {};
  window.CD.Analytics.Queue = {
    init: init,
    push: push,
    flush: flush,
    notifyScreenChange: notifyScreenChange
  };
})();
