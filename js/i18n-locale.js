/**
 * The Comp Desk — locale runtime (Phase 3A scaffold).
 *
 * Responsibilities:
 *   - report the locale the user is ACTUALLY on (from the URL — the URL is the truth)
 *   - persist a chosen locale to a cookie + localStorage so return visits skip the picker
 *   - pre-select a match for navigator.language on first visit, WITHOUT ever redirecting
 *
 * Deliberately NOT a redirector. The English root carries the organic footprint; bouncing
 * a visitor (or a crawler) off it on the strength of an Accept-Language guess would move
 * that footprint. The picker is always visible and the URL always says what it serves.
 *
 * The per-locale URL table is read from the page's own <link rel="alternate" hreflang>
 * block, which scripts/i18n/build-locales.mjs generates. That means the runtime can never
 * drift from the routing: a locale with no alternate on this page has no page here, and
 * the picker falls back to that locale's home.
 */
(function () {
  'use strict';

  var COOKIE = 'lang';
  var LS_KEY = 'cd_locale';
  var YEAR = 60 * 60 * 24 * 365;

  // Keep in lockstep with i18n/locales.json and the app's www/js/i18n.js LOCALES.
  var LOCALES = [
    { code: 'en',      endonym: 'English',        english: 'English' },
    { code: 'es',      endonym: 'Español',   english: 'Spanish' },
    { code: 'zh-Hans', endonym: '简体中文', english: 'Chinese (Simplified)' },
    { code: 'zh-Hant', endonym: '繁體中文', english: 'Chinese (Traditional)' },
    { code: 'ru',      endonym: 'Русский', english: 'Russian' },
    { code: 'bn',      endonym: 'বাংলা', english: 'Bengali' },
    { code: 'ht',      endonym: 'Kreyòl Ayisyen', english: 'Haitian Creole' },
    { code: 'ko',      endonym: '한국어', english: 'Korean' },
    { code: 'fr',      endonym: 'Français',  english: 'French' },
    { code: 'pl',      endonym: 'Polski',         english: 'Polish' }
  ];
  var CODES = LOCALES.map(function (l) { return l.code; });
  var PREFIXED = CODES.filter(function (c) { return c !== 'en'; });

  /**
   * Resolve a BCP-47 tag to a supported locale. Mirrors the app's _matchTag semantics
   * exactly — including the Chinese script rules, which are the ones that bite:
   *   zh-Hant / zh-TW / zh-HK / zh-MO -> zh-Hant  (fall back to zh-Hans, then en)
   *   zh-Hans / zh-CN / zh-SG / zh    -> zh-Hans  (fall back to en)
   * Anything unrecognized -> null (caller treats as English).
   */
  function matchTag(tag) {
    if (!tag) return null;
    var t = String(tag).replace('_', '-');
    var lower = t.toLowerCase();

    if (lower.indexOf('zh') === 0) {
      if (/hant|-tw|-hk|-mo/.test(lower)) {
        return has('zh-Hant') ? 'zh-Hant' : (has('zh-Hans') ? 'zh-Hans' : null);
      }
      return has('zh-Hans') ? 'zh-Hans' : null;
    }
    for (var i = 0; i < CODES.length; i++) {
      if (CODES[i].toLowerCase() === lower) return CODES[i];
    }
    var base = lower.split('-')[0];
    for (var j = 0; j < CODES.length; j++) {
      if (CODES[j].toLowerCase().split('-')[0] === base) return CODES[j];
    }
    return null;
  }
  function has(c) { return CODES.indexOf(c) !== -1; }

  /** The locale actually being served, taken from the URL path prefix. */
  function fromUrl() {
    var seg = location.pathname.split('/')[1];
    return PREFIXED.indexOf(seg) !== -1 ? seg : 'en';
  }

  function readCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function writeCookie(name, val) {
    document.cookie = name + '=' + encodeURIComponent(val) +
      '; path=/; max-age=' + YEAR + '; SameSite=Lax' +
      (location.protocol === 'https:' ? '; Secure' : '');
  }

  /** The locale the user has explicitly chosen before, if any. */
  function saved() {
    var v = readCookie(COOKIE);
    if (!v) { try { v = localStorage.getItem(LS_KEY); } catch (e) { /* private mode */ } }
    return v && has(v) ? v : null;
  }

  /** First-visit guess from the browser. Never acted on automatically. */
  function detected() {
    var langs = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language];
    for (var i = 0; i < langs.length; i++) {
      var m = matchTag(langs[i]);
      if (m) return m;
    }
    return null;
  }

  /**
   * URL for this same page in another locale, read from the generated hreflang block.
   * Returns null when this page has no copy in that locale — the caller then sends the
   * user to that locale's home rather than to a 404.
   *
   * The hreflang hrefs are absolute production URLs (they have to be, for SEO), so the
   * path is re-hosted onto the CURRENT origin. Without this, the picker on a Vercel
   * preview deploy or a local server would throw the user over to production.
   */
  function urlFor(code) {
    var link = document.querySelector('link[rel="alternate"][hreflang="' + code + '"]');
    if (!link || !link.getAttribute('href')) return null;
    try {
      var u = new URL(link.getAttribute('href'), location.href);
      return location.origin + u.pathname + u.search + u.hash;
    } catch (e) {
      return null;
    }
  }

  function homeFor(code) {
    return location.origin + (code === 'en' ? '/' : '/' + code + '/');
  }

  /** Persist a choice. Does not navigate — callers decide that. */
  function remember(code) {
    if (!has(code)) return;
    writeCookie(COOKIE, code);
    try { localStorage.setItem(LS_KEY, code); } catch (e) { /* private mode */ }
  }

  /** Persist and go. The only path that changes the URL, and only on a real click. */
  function set(code) {
    if (!has(code)) return;
    remember(code);
    if (code === fromUrl()) return;
    location.href = urlFor(code) || homeFor(code);
  }

  var CD = (window.CD = window.CD || {});
  CD.Locale = {
    LOCALES: LOCALES,
    codes: CODES,
    current: fromUrl,
    saved: saved,
    detected: detected,
    matchTag: matchTag,
    urlFor: urlFor,
    homeFor: homeFor,
    remember: remember,
    set: set,
    /**
     * What the picker should show as pre-selected: an explicit past choice wins, then
     * the URL we are on, then the browser guess. `suggested` is true only when the
     * browser guess differs from what is being served and the user has never chosen —
     * that is the one case where the picker should draw attention to itself.
     */
    preselect: function () {
      var url = fromUrl(), sv = saved(), det = detected();
      if (sv) return { code: sv, suggested: false, reason: 'saved' };
      if (url !== 'en') return { code: url, suggested: false, reason: 'url' };
      if (det && det !== 'en') return { code: det, suggested: true, reason: 'navigator' };
      return { code: 'en', suggested: false, reason: 'default' };
    }
  };

  /**
   * Minimal picker — Stage 3A scaffold, so persistence and pre-selection are provable.
   * Renders into any [data-cd-locale-picker] mount. Stage 3C replaces this with the
   * designed globe control + the inline row under the video; the API above does not change.
   */
  function renderPickers() {
    var mounts = document.querySelectorAll('[data-cd-locale-picker]');
    if (!mounts.length) return;
    var pre = CD.Locale.preselect();

    Array.prototype.forEach.call(mounts, function (mount) {
      mount.textContent = '';
      var nav = document.createElement('nav');
      nav.className = 'cd-locale-picker';
      nav.setAttribute('aria-label', 'Choose your language');

      LOCALES.forEach(function (l) {
        var a = document.createElement('a');
        a.href = urlFor(l.code) || homeFor(l.code);
        a.lang = l.code;
        a.className = 'cd-locale-opt';
        a.textContent = l.endonym;
        a.title = l.english;
        if (l.code === pre.code) {
          a.setAttribute('aria-current', 'true');
          a.className += ' is-current';
        }
        // A plain link, so it works without JS and a crawler sees a real href.
        // The handler exists only to persist the choice before navigating.
        a.addEventListener('click', function () { remember(l.code); });
        nav.appendChild(a);
      });

      mount.appendChild(nav);
      // Always reset: renderPickers() can run more than once (Stage 3C re-renders on
      // interaction), and a left-over attribute would drive a stale "we think you want
      // Chinese" prompt at a visitor whose browser says otherwise.
      if (pre.suggested) mount.setAttribute('data-cd-locale-suggested', pre.code);
      else mount.removeAttribute('data-cd-locale-suggested');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPickers);
  } else {
    renderPickers();
  }
  CD.Locale.renderPickers = renderPickers;
})();
