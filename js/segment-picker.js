/* ============================================================================
 * segment-picker.js — homepage five-card segment picker (Phase 8, web parity).
 * ----------------------------------------------------------------------------
 * The markup lives statically in index.html (crawlable links, works without
 * JS); this file only wires analytics so the web picker lands in the SAME
 * funnel as the app's v2 onboarding picker (www/js/onboarding/segments.js):
 * same event names, same dwell semantics, distinguished by surface='web'.
 *
 *   onboarding.segment.view            — once, when the picker first becomes
 *                                        visible (the cover page renders it
 *                                        below the fold, so "rendered" is not
 *                                        "seen"; view must mean seen or web
 *                                        view counts would dwarf app ones)
 *   onboarding.segment.card_impression — per-card visible-dwell, flushed once
 *                                        on select OR page-leave. The app can
 *                                        only flush on select (single-page
 *                                        flow); on the web most visitors
 *                                        leave without selecting, and losing
 *                                        their dwell would break the
 *                                        long-dwell/low-select copy signal
 *                                        the picker exists to measure.
 *   onboarding.segment.select          — on card click; navigation proceeds
 *                                        normally (supa-lite's keepalive
 *                                        insert survives the unload, and the
 *                                        queue's localStorage backlog covers
 *                                        the rest on a return visit).
 *
 * Audience skin on arrival is handled by the destination pages' own
 * ROUTE_HINTS in js/audience-switcher.js — no audience writes here.
 * ==========================================================================*/
(function () {
  'use strict';

  var root = document.querySelector('[data-cd-segment-picker]');
  if (!root) return;

  var cards = Array.prototype.slice.call(root.querySelectorAll('[data-segment]'));
  if (!cards.length) return;

  function track(name, props) {
    try { if (window.CD && typeof window.CD.track === 'function') window.CD.track(name, props); }
    catch (e) { /* analytics must never break the page */ }
  }

  var _dwell = {};         // { [segment]: accumulatedMs }
  var _visibleSince = {};  // { [segment]: timestamp | null }
  var _viewSent = false;
  var _flushed = false;
  var _observer = null;

  cards.forEach(function (el) {
    var seg = el.getAttribute('data-segment');
    _dwell[seg] = 0; _visibleSince[seg] = null;
  });

  function flushImpressions() {
    if (_flushed) return;
    _flushed = true;
    var now = Date.now();
    cards.forEach(function (el) {
      var seg = el.getAttribute('data-segment');
      if (_visibleSince[seg]) {
        _dwell[seg] = (_dwell[seg] || 0) + (now - _visibleSince[seg]);
        _visibleSince[seg] = null;
      }
      track('onboarding.segment.card_impression', { segment: seg, dwell_ms: _dwell[seg] || 0 });
    });
    if (_observer) { try { _observer.disconnect(); } catch (e) {} _observer = null; }
  }

  if ('IntersectionObserver' in window) {
    try {
      _observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var seg = entry.target.getAttribute('data-segment');
          if (!seg) return;
          if (entry.isIntersecting) {
            if (!_viewSent) {
              _viewSent = true;
              track('onboarding.segment.view', { cards_shown: cards.length });
            }
            if (!_visibleSince[seg]) _visibleSince[seg] = Date.now();
          } else if (_visibleSince[seg]) {
            _dwell[seg] = (_dwell[seg] || 0) + (Date.now() - _visibleSince[seg]);
            _visibleSince[seg] = null;
          }
        });
      }, { threshold: 0.5 });
      cards.forEach(function (el) { _observer.observe(el); });
    } catch (e) { _observer = null; }
  }

  cards.forEach(function (el) {
    el.addEventListener('click', function () {
      var seg = el.getAttribute('data-segment');
      flushImpressions();
      track('onboarding.segment.select', { segment: seg });
      // Persisted + keepalive-flushed; let the navigation happen normally.
      try {
        if (window.CD && window.CD.Analytics && window.CD.Analytics.Queue) {
          window.CD.Analytics.Queue.flush();
        }
      } catch (e) { /* no-op */ }
    });
  });

  // Leaving without selecting still reports dwell (see header comment).
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && _viewSent) flushImpressions();
    });
    window.addEventListener('pagehide', function () {
      if (_viewSent) flushImpressions();
    });
  } catch (e) { /* no-op */ }
})();
