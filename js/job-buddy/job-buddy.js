/* ============================================================================
 * job-buddy.js — Comp Buddy "Job Buddy" work-search screen (CD.renderJobBuddy)
 * ----------------------------------------------------------------------------
 * Read-only work search + C-258.1 Labor Market Attachment log for injured
 * workers. Dependency-free IIFE on window.CD (no ESM). Matches the appointments
 * module conventions: Supabase via CD.supa with graceful degradation.
 *
 * Backend (Phases 0-2):
 *   - restriction_profiles      (owner r/w)         — the worker's WCB work restrictions
 *   - job_buddy_listing_tags    (owner read)        — pre-computed feed (daily refresh)
 *   - job_listings              (public-read fresh) — the cached listings
 *   - lma_ledger                (owner r/w)         — the C-258.1 application log
 *   - access_vr_enrollments     (owner r/w)         — ACCES-VR status (feeds the packet)
 *   - edge fn job-buddy         — live restriction-match + RE math (on-demand)
 *   - edge fn restriction-extract — IME/C-4.3 PDF -> restriction fields (confirm before save)
 *
 * NOTHING here auto-applies the user to anything. "Apply on employer site" and
 * the Indeed/LinkedIn buttons open the SYSTEM browser; the user applies themselves.
 *
 * Public API:
 *   CD.renderJobBuddy()  -> DOM node (the screen)
 *   CD.JobBuddy.*        -> data helpers (used by the screen + tests)
 * ==========================================================================*/
(function (global) {
  'use strict';
  var CD = global.CD = global.CD || {};
  var h = CD.h || function () { /* h() comes from ui-components.js; guarded below */ };

  var DISCLAIMER = 'This tool is for informational purposes only and does not constitute legal advice.';

  // ─── helpers ──────────────────────────────────────────────────────────────
  function _loggedIn() { return !!(CD.currentUser && CD.supa); }
  function _hh() { return CD.h || global.h; } // late-bind h() (load order safe)

  function _toast(msg) {
    try { if (CD.Contact && CD.Contact.showErrorToast) CD.Contact.showErrorToast(msg); }
    catch (e) { /* never throw */ }
  }

  function _money(n) {
    if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '—';
    return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function _dateStr(d) {
    if (!d) return '';
    try { return new Date(d + (String(d).length <= 10 ? 'T00:00:00' : '')).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (e) { return String(d); }
  }
  function _todayISO() { return new Date().toISOString().slice(0, 10); }

  function _openExternal(url) {
    if (!url) return;
    try { global.open(url, '_blank'); } catch (e) { try { global.open(url, '_system'); } catch (e2) {} }
  }

  // Worker's pre-injury AWW + the statutory PPD max for their DOA (from calc-core).
  function _awwAndPpd() {
    var p = CD.currentProfile || {};
    var aww = parseFloat(p.current_aww);
    var ppd = (CD.Calc && p.doa) ? CD.Calc.maxRateForDOA(p.doa) : 0;
    return { aww: (aww > 0 ? aww : null), ppd: (ppd > 0 ? ppd : null), doa: p.doa || null };
  }

  // Authenticated edge-function POST (mirrors advisor-module.js).
  function _callFn(name, payload) {
    var supa = CD.supa;
    if (!supa) return Promise.reject(new Error('Not signed in'));
    return supa.auth.getSession().then(function (r) {
      var token = r && r.data && r.data.session && r.data.session.access_token;
      if (!token) throw new Error('Not signed in');
      var base = (supa.supabaseUrl || CD.SUPABASE_URL || '').replace(/\/$/, '');
      return fetch(base + '/functions/v1/' + name, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
          'apikey': CD.SUPABASE_ANON_KEY || (supa.supabaseKey || '')
        },
        body: JSON.stringify(payload)
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) throw new Error(body.error || ('Request failed (' + res.status + ')'));
          return body;
        });
      });
    });
  }

  // ─── data API ─────────────────────────────────────────────────────────────
  var JB = CD.JobBuddy = CD.JobBuddy || {};

  JB.getRestriction = function () {
    if (!_loggedIn()) return Promise.resolve(null);
    return CD.supa.from('restriction_profiles').select('*').eq('user_id', CD.currentUser.id).maybeSingle()
      .then(function (r) { return r.data || null; });
  };

  JB.saveRestriction = function (fields) {
    if (!_loggedIn()) return Promise.reject(new Error('Sign in to save your restrictions.'));
    var row = Object.assign({ user_id: CD.currentUser.id, updated_at: new Date().toISOString() }, fields);
    return CD.supa.from('restriction_profiles').upsert(row, { onConflict: 'user_id' }).select().maybeSingle()
      .then(function (r) {
        if (r.error) throw r.error;
        // Confirming restrictions opts the worker into Job Buddy (gates the daily match + live feed).
        if (fields && fields.confirmed_by_user) {
          CD.supa.from('profiles').update({ job_buddy_enabled: true }).eq('id', CD.currentUser.id)
            .then(function () { if (CD.currentProfile) CD.currentProfile.job_buddy_enabled = true; });
        }
        return r.data;
      });
  };

  // Send an IME/C-4.3 PDF (base64) to the extractor; returns proposed fields for the user to CONFIRM.
  JB.extractFromPdf = function (base64, filename) {
    return _callFn('restriction-extract', { pdf_base64: base64, filename: filename || 'document.pdf' });
  };

  JB.getEnrollment = function () {
    if (!_loggedIn()) return Promise.resolve(null);
    return CD.supa.from('access_vr_enrollments').select('*').eq('user_id', CD.currentUser.id).maybeSingle()
      .then(function (r) { return r.data || null; });
  };
  JB.saveEnrollment = function (status, notes) {
    if (!_loggedIn()) return Promise.reject(new Error('Sign in first.'));
    var row = { user_id: CD.currentUser.id, status: status, notes: notes || null, updated_at: new Date().toISOString() };
    if (status === 'enrolled' || status === 'active') row.enrolled_at = new Date().toISOString();
    return CD.supa.from('access_vr_enrollments').upsert(row, { onConflict: 'user_id' }).select().maybeSingle()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  };

  // Pre-computed feed: tags (restriction_match != 'no') joined to their listing.
  JB.getFeed = function () {
    if (!_loggedIn()) return Promise.resolve([]);
    return CD.supa.from('job_buddy_listing_tags')
      .select('restriction_match, re_estimate, restriction_aww_fit_score, red_flags, tagged_at, job_listings(*)')
      .neq('restriction_match', 'no')
      .order('tagged_at', { ascending: false })
      .limit(50)
      .then(function (r) {
        if (r.error) { return []; }
        return (r.data || []).filter(function (t) { return t.job_listings; });
      });
  };

  // On-demand live match against the freshest cached listings (when the feed is empty).
  JB.matchNow = function () {
    if (!_loggedIn()) return Promise.reject(new Error('Sign in first.'));
    var ap = _awwAndPpd();
    if (!ap.aww || !ap.ppd) return Promise.reject(new Error('Add your AWW and date of accident in your profile first.'));
    return Promise.all([
      JB.getRestriction(),
      CD.supa.from('job_listings').select('*').order('fetched_at', { ascending: false }).limit(8)
    ]).then(function (res) {
      var rp = res[0], listings = (res[1].data || []);
      if (!rp || !rp.confirmed_by_user) throw new Error('Confirm your restrictions first.');
      if (!listings.length) return { results: [] };
      var p = CD.currentProfile || {};
      return _callFn('job-buddy', {
        restriction_profile: rp,
        aww: ap.aww, ppd_max_for_doa: ap.ppd, doa: ap.doa,
        target: { role: p.occupation || null, geography: p.home_city || null },
        listings: listings.map(function (l) {
          return {
            external_id: l.external_id, source: l.source, title: l.title,
            employer: l.employer, location: l.location,
            salary_min: l.salary_min, salary_max: l.salary_max,
            salary_is_predicted: l.salary_is_predicted, description: l.description
          };
        })
      });
    });
  };

  // ─── C-258.1 ledger ─────────────────────────────────────────────────────
  JB.listLedger = function () {
    if (!_loggedIn()) return Promise.resolve([]);
    return CD.supa.from('lma_ledger').select('*').order('date_applied', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
      .then(function (r) { return r.error ? [] : (r.data || []); });
  };
  JB.addLedger = function (row) {
    if (!_loggedIn()) return Promise.reject(new Error('Sign in first.'));
    var rec = Object.assign({ user_id: CD.currentUser.id }, row);
    return CD.supa.from('lma_ledger').insert(rec).select().maybeSingle()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  };
  JB.updateLedger = function (id, patch) {
    if (!_loggedIn()) return Promise.reject(new Error('Sign in first.'));
    return CD.supa.from('lma_ledger').update(patch).eq('id', id).select().maybeSingle()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  };
  JB.removeLedger = function (id) {
    if (!_loggedIn()) return Promise.resolve(false);
    return CD.supa.from('lma_ledger').delete().eq('id', id).then(function (r) { return !r.error; });
  };
  // Log an application straight from a feed listing (pre-fills C-258.1 fields).
  JB.logFromListing = function (listing) {
    return JB.addLedger({
      listing_id: listing.id || null,
      date_applied: _todayISO(),
      employer_name: listing.employer || null,
      job_title: listing.title || null,
      apply_method: 'online',
      response_received: false,
      notes: listing.location ? ('Location: ' + listing.location) : null
    });
  };

  // ─── LMA packet stats (pure; also unit-tested) ────────────────────────────
  JB.computeStats = function (ledger) {
    var rows = ledger || [];
    var n = rows.length;
    var responses = rows.filter(function (r) { return r.response_received; }).length;
    var dates = rows.map(function (r) { return r.date_applied; }).filter(Boolean).sort();
    var first = dates[0] || null, last = dates[dates.length - 1] || null;
    var days = (first && last) ? (Math.round((new Date(last) - new Date(first)) / 86400000) + 1) : 0;
    return { total: n, responses: responses, firstDate: first, lastDate: last, days: days };
  };

  // ─── LMA Packet Generator (the headline) ──────────────────────────────────
  // One-click WCB hearing-exhibit PDF: C-258.1 log table + summary stats + ACCES-VR status.
  JB.generateLMAPacket = function () {
    if (!global.PDFLib) return Promise.reject(new Error('PDF engine not loaded.'));
    return Promise.all([JB.listLedger(), JB.getEnrollment()]).then(function (res) {
      var ledger = res[0], vr = res[1];
      return JB._buildPacketPdf(ledger, vr, CD.currentProfile || {});
    }).then(function (bytes) {
      // Open in the system viewer (native) / browser (web). User can save/share from there.
      var blob = new Blob([bytes], { type: 'application/pdf' });
      var url = URL.createObjectURL(blob);
      _openExternal(url);
      return url;
    });
  };

  // Base64 JPEG of the NYS Workers' Compensation Board header logo, extracted from the
  // official Form C-258.1 XFA template (downscaled for size). Embedded so the generated
  // packet IS the genuine government form, not a lookalike.
  JB._C258_LOGO_JPG = '/9j/4AAQSkZJRgABAQEAbgBuAAD/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJST/2wBDAQYGBgkICREJCREkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCT/wgARCADeAxsDAREAAhEBAxEB/8QAGwABAAMBAQEBAAAAAAAAAAAAAAYHBQQDAgH/xAAWAQEBAQAAAAAAAAAAAAAAAAAAAQL/2gAMAwEAAhADEAAAAbUAAAAAAAAAAAMpIofKfR8qPKyWy7SgAAAAAAQ5JioAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEQTjJseqgDJTEJioAAAAAAEFSdKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIQncSlQABnJym2oAAAAAAEFSdKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABlJFSfqAAK0Zl65ie6x04CSmCWUV0WAQEstQABBUnSiOp3mmscTYOtYokhOpQAAK+Z3SSNAAAAAAYKaZ1qAAAAAAAAAAAAAAAAAAIUnOTtfoAAFMs/ayBO0iiytJatVEiSCtTpnkWx1AAEFSdKK/TjLLKSJySUptbtT3XmToX9PkJ8rVySZJe14J7r+J4HQo+TzT2X5PFOgqomZIlAAAAAAAAAAAAAAAAAAFZpKyQqAABTLO6RpZwkUWSJMlhpDDVTKWyySqAAIKk6UYKVgWkVOSA3yNlpFSH0eBbK1ceabyZyyZM5eAnxVZ+myS8qpdRJwV2dxIDTJOv6AAAAAAAAAAAAAAAAAACCpKTRUAACmWbTKwWWEUOskZsFSlolYF2nsoAAgqTpR8JSRup3LFzUJKdpBS4VqpJCRRZskpWqk+kzFt8hJiEmSvFtZK2W6FzEqBZuktO5QAAAAAAAAAAAAAAAAAAPIrxJ8dSgAAeCe6+afp4Hyep7rzJ0Hie6gAAQVJ0oFXJGVtpK/MZblTLICXEtUJJiJLOCTlVJ7pgLbhFDAJweR1JW63MvwmaQ0xi4FAAAAAAAAAAAAAAHymEZB8nQSE7D8MciBKSRKAAB4pUaWctYpNlhB+kzOZImv6WeVVZbMtW2WzL0qBBUnSgRNIEXMQgjhbq+aVaZ50lqLWCTUka1gkkTmWKlmlYHwmwsxK6LfXEStD8SULP1AAAAAAAAAAAAAAFbMyNdk+jnIueSfq6pJD2UAAACHJBSbEbJsd5VhKk4VxiwSsTUJuSZQBBUnSgAAAAfh+gAAAAH4foAAAAAAAAAAAAAAAAAAIIm+bigAAAAAAAfCUeXeVYTA7ysiUJHl5i3yl03l0iwFAEFSdKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI4nMSxQAAAAAAAPxKgS3lxCv0E2XiT1XEJEkJLVWqyyjTUCCpOlAhaRY/SwTbUAAAAAAAAAAAAAAAYCfa7hViWId6gAAAAAAAZSQssRfUAAAAAAAA8EzDROc8gd55n0fhxoOhfI+E6161EFSdKI0lbFrnsdS+KRs6ySrkJ5JmLtmYfhKVwU+DPJKdi5CYZvGksYZ915iVLzpGT2JOZJimqa5Vh6ljENSbr+EaOgk65ScpnGwbKgAAfhEU4Scr6AAAAAAAABKaJCdaeywo1ydFcHaTIg6cqzUgpuJJ1kaiCpOlFeJzllqPkphJUR8lJwLipuEPWeJB1tBIQep1mKWWVSTMg5bxTSz5IeWARY+zVJoQdOta/LbK/PUsUpstxaxSRGMb58LHEkREi7VAAAijIlbQAAAAAAAAAqBPMmRMVqhJovWlbnMW6RxMcsdqmU6CzDSUQVJ0or5OEs9RnpTReiwtMI7V+0lyVIt3lRJN1h5J0ka0qWGkHXeSPFnLVC3oVaSUJBTbLCIEeKR1bXIkdKz8o1LTWpy8kipFjZXmSbrTZekftAACOMxc6FAAH4AAAD7JeaSgCOp4JWi3kVUTRY0mEnmsuOtMgsdqmUspNdfVRBUnSjDSqSyD1NEqIsoihonmv2kuSpFu8qJJqsRNVNBYIWYVsWccBvLShehVpI06DtKzJgkDW1yry0SLngTwp0tsqgsMjp7HQvMk3Wmy8k+1AAABCgAAAAAeZXSTk0FAgaZZISXrCUkJECengRA3zgJatepyG0kzaEFSdKBHkjB+kzOYiZ1k4WPJ9G0Qsn6wlOsih+nWS03ViKYRqkwWBJYSxBPw9TAO4nJDTPO01TtIWS4jhNV4EiB0k4MQ8SRLXqSlJA0AAAAAAAAAABH05iUqAIQk3UAAAAAAAQVJ0oAAAAAAAAqlJOkvaAAAAAAAAAAAAAAAAAAAAAAAAAAAAhCeJPF/QV5c2HNAAAAAAACCpOlH4cSead7X2AAAAACLJpmsuCnmSJQAAAAAAAAAAAAAAAAAAAAAAAAAAMFImTA9yDJZjQ8kyDUPdf0AAAAEFSdKImV0bKZRbRpqAAAAAAK/TwWxwAAAAAAAAAAAAAAAAAAAAAAAAAAAfJBkxLOiOs/V+E5DCW1zWUAAAAQVJ0oiRCy3ymUsU0ivjnJmb61ynCSgmBVx6EpOYihzG8tjgAAAAAAAAAAAAAAAAAAAAAAAAAAAEaSPpIVzDjT8WSG6fagAAAAQVJ0oiRXZqJmFrELO0kxVJdZinOlaLdaUg1cCdBTJcBDQtjgAAAAAAAAAAAAAAAAAAAAAAAAAAAEOTONY3ztUAAAAAACCpOlESIWXCQBMs8iVEmKQW0Er0khDlu5mkGrvTxKYLyIEeC2OAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACCpOlESK9JUkaJsfpDjTOcm5WhIiKrbzNPtXenstNpsGYdZaygAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACCpOlHmmQeJoGioyU5zbPtcdPQ+DRMw2F/TnTHNE5jYUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQVJ0oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEFSdKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABFGZW0AAAAAAAAAAAAAAAAAAAAAAAAAB//EADEQAAICAQICCAYCAwEBAAAAAAQDBQIBBgAVERMUEDQSNTYgMzBAUDEyFmAhJSMiJP/aAAgBAQABBQL6cyTHCxbUJLLcfOxvOoDN8eP3xmTvvJsxTcVIcQR88gl2J7+lysz0OQILLdrVRVfZK1taP01nHVvnk+o/6VLybMti4WonvkE3IDiA7BCfPJ9R/wBJPkVALgkMeZ7jZg1RcTIdfHnTyA7QZrzFSEsYk3jMjuHNMK2ucNo5rsLQLOF5KNf1UUKWPIM9xPqPsNm0hOBkFSFNlzg4jhSaGJ2zUQy2DEVKT75iTKHNgy3FjfNfNCDtFKUYr7NIzd+lEg2vZWuKV90j3+PMsCVqS2L50x8KW8xBmg0CDuoSmXR0B7jfFp/8bmjOkjdNo8ZPuJ9R9mpkcmadf0Zmc4rghvTv0y7mmQf1YOtc3uhWEp576yjnjOM9mbVxvNq1xRtGbn/MtNd0/G8EJtnebYrvBCbZ7MXrndnLpnebYrvBCbZ3NB2QVAKyuP8AsxgBgJEIWwsT3yPf5EDmBd92K0x8KW8xDgUEiij1ERqZH+emt0JAnRxrHWZWAR0QHuJ9R9k2jp48V3QESxHRR1aWvuAd0chqV/hTCI6eQc2qFHSTzr1iDbLFNIBYGVUweYz/ALJKzD6xAJY0hPeZaa7pPSfizCRvWmnGVBGaQTIuIjShKQ0oxTpr/Eapt0szFnsoGy4EO8p5reCn+GAoXV7YOjzsYxXH2bUb7+IAOoQ/vke/BVxePkgsgk6Y+FLeYonCh1REuQaVMo6ePrXNrSYv+opTLLpXhSvcT6j7L1xer15S443p42BE6dSb5GJmiesnaaR4U6hZ4I+KVV0hueVhUjpm/NEv5lp2uMAbn/Mg5LqUcCJY4lKaIXqe+fFDloCeVOBEDVzytM/5iga4sZuSHsSDjN0sG1LsU1Blfs7G0TSdMFLwLnNhvflKrW/G7rozdaVpiw4+c9VGzuiFLzvokVt+d4QqufeT6j7dQI6I/cKnoY6YT0EhuPR1YPUC/HHxjsIP3OPw+Q00vkPL+Zad8u3P+ZARuD45TWCPBNocjU6884hIxBPAAd8FjekmscoyP79u96rqwQOQrKwlBExTrJP+utbFMPnAk7tqdfP+T15L1Ki2xThzMZvWu+kryfMhoxWps8xUCErPvcvpV2uTHl4kFZB6UmQLkT+FjUqZJMcOZHWhZaxWdSNZTYoRJu1lFx7UFdbAQ5vWDTKBD1uVIlDJ6ujtJ9R9uoRbPHQG5zaVxSuoxL3tHAteXti6todDEC3wWZWocUSZYZFBky6G8QgV3WBudS3J+nV3WLORXS7ji2gkEjLkBSowoO3Xjs4iY8vJkxSzI6OQ3r25cVpYfgMCswgszELENq766S8ZksPACK3UIamOqD4yyMDbsmBaptNOkN3/ABlnNOnBaYSmiF/J1AB0qus36rp4HwUm2ZvJQKarj5NOHgx98rN1P+YOQQDWRLwaXGJsiJTnFWykhk98HH4GH9hPqP5fL5PLt5e/l9gno6lcQtr3jvob4xaucf8ARdcVXOKyuRgCKsBlSKjgxy8tO1P+Q47Jg4DFpLbnGR0fHmo3qjYCS8OfYT6j+/TjR+pactfIX0OfxmNM6av6ykZiQX1GQDZYWRMvERHUd6hGc/enhnD0loltCYrrPUUxxeHkIoSl8UWO2PY9g3aT6j7ZDUGFWvMnXzSaOpmJNYeN9gkZekfeNlKSPYycO6QB1iBPoTZIcKscFaXIWqiafQtetFeMgc0kpIw2QFTfiwO+LA7S9ZFHloG2klJGHkpGxxYHfFgdpOGIteSDXbiwO0FoJ7SfUfZPF5GEHRYlwkWMJR8cKRhCaDrKMSHW2pUYyPqAR1sZ57OlEgWRMivXbUo+LByQ5tSNQipsPqEVt/zsyZHCc+cETWupkZyMWkumzJQYLf8AJk8w5Mc7d74XTGoxM2KnRRrJ1GNe1bYtgglQtL6lHxlOohGZperKlS4gmc6mTzEmRS7PdUdMucs98PIrj7BGUOS0uH6UWy7jklJEpfUo+Mo1CI3OLYtg6STH7RNiOrbUo+Mgyo53yM5xXEjPLXWPhMv2tdFU+iOKuYTTTTLLi4cgQ42AsUUaLkIgGEucPGA8PHliutHQBXQGSsZmRrIxFo9UcBmQbGwlgSZHv42n7kIiorMdbsJ9R9mprf8AfTdPEb2WtilTSrmEBaeq1EnHZj26cMtfGpu8xsfaQbIwNBhqeLxK0yvoyE5HdBty2OnvMomIxIVkoLAqIsuwhkkX1MNCmGkt01TCVNuO1rOmj9j6bplRouQydOtywHUDrMPiYlR626ZxtKsJVfTrGFW00nwXrlTA84PjZkJQJENHqPsIIsJLfixeeUdIGWNJAgMPRKRuY9mnDLZzqf8AeOBtIPPgKDijNygj36jtnAUPGjVG+kkQGhPHkyhdx8/h99zvmUB5bLFdUCixetmkKsGWGRgobUvdNNd73I9/VJHKXGsY4LsJ9R9mp6f9dOtws7skP8A1/bH41N8HT+f9jqbvOmPjSnl4/wAfcx5lp7y6e8y013QzGMib1FnPURXNHfxeU3lLrZHxnEJun6T/AJnpnuszD3KvmhIVxtQFJyktbxi9QkMtQuYthtrXZC+W6l73pj99t+KL/iF2r/CtS9zgs/7PU/76a75Jdwr+2Px7p0dhAY8lIoTxeV3xiU3xiU3xiU3xiU3xiU3xmU3xmU3xmU3xmU3xmU3xmU3xmU3xmU3jUJSshHpOX7KzITmFR8Y5eOfjrz8M75lAeW6jK6QkbJidk9ZZnTZW9S90013vcj3+NenAFGrv2k+o+yYCyaJS10sE1AOyj9QBqwOQuTDauyGgzYzETcjQ1umh85bqbvOmPjSnl4/x9zHmWnbY6hPeZQMiOMqVmR+rCIySTNDZIACJyGTSYBvS+oRumL7pun6T/memc46sRPqHL4rHvoblOSo5d8wNc8rUmQsqJZhxEJbGY3U1f/pgC0isEOSdRvxY3HijCE2GfHTQ9hpySoZbTY+bE6n/AH013yS7hX9q5xnH0zF0bWTi+G7j35JD7StN5zb+PG846BqMzcnCvLLjRLhBt0+W56VYQo0bBYwUGWKXLgsPRDxTgHbLgSnk/wAcM3FQ7wyewn1H2nwqDc300TjNNNEZzHgVj0yEQk/dtNlYyPpq3NKaIXLRN5BkTFWj7Fp6wOrTjaN3JQTSSYmHuCye8yAiMyA2NNlc46JVH9h2n1kX/jZfMXTdaWcvpU/xlvOuOWJWFYY+LhGBvPgKEszpsvmPprPiouqqHad6RitNPzkvTmM4iIu0fuSjqSCs6bL5xUbw9bNNtswRHVhpCKSfi+micZRpq/NCFjKlou0jmKiLx7Xqw9NtNk+MeJwlP086qzY+ALowT2ZLfaf+gJ9R/RT3mWmu6fePzszT3/uHlsKxjOLY7A/UP0BPqPsznluxwtN4kg87oyrMfMPg8GkRwGI9O5OVxHbjZfEgz7udDjm75nwdwZYc3B56wFB1IkJPsY1aq8bB8fWU43i2LY+UT6j7NSdyUqz2XgzqUQQ4VkcZ14X52p/iaZ7394tXFsSsKtKyZLrMcLNuHG6ecI30E7nfBXW2TSIUtIzSLRYlgg/lE+o+zUvconzG2cVweyjTIBNlAHGrBS+fMbmk0fTMXM1NyQ7A6H6hKZnEyfjMZO5IYzPhXx47xEzxbrQRzjFyk51ZnGT85MPcdjTPe/vOoG+CPBhUOR1yMj631NTfFZV+6RJ8gxEGGndaVpj5ZPqPs1L3JVLsYwCR8NLdA2Nklnr1C/LDdPArbuTAUSKpmUt/8uUsSNj9yLACg6WzW7fgbACSgW1FhD5zm9gAFCj6jQtTtM97+8zccSY1em322nTg1N0CGXX55PqPs1L3KJ8x3qZdMW0/bOJGcxyktNWxkMi2KD7kirgxYo7DiSNO5QjH5Z8DY/wD8cwq55WpnFq6n+Jpnvf9MJ9R9mpe5DvsM7+TP5FFuNbAR1071BH2dgE9sew6ccYqJj7mETgtiQhiLiPJ1A4lP65HLoaDsf4FseLBwdwiA59wqj5BsjeEMoGX/TCfUfYxVG1vCg33wEDaY4UfPY+KDItSDBpmlKrrt8SGRYeMEFy+JDJYtK1L4MB4sYxjG3DqIrwEDngAaqURAY7P6YT6j/sZPqP+xvEvac+6/wD/xAAjEQABBAEEAwADAAAAAAAAAAABEQAQIDBBQFBgMQIhElFw/9oACAEDAQE/Ad0u0PZD2Q9SFBmPAryPrGsCRjOyD1qt1gcj6sNID+sZDQ5g9bmqwnI+rEjMcAxB6zqzQ8/8hMBuIEG4es61PFK1yJCV1oRCCpyfLjzX5BZn5wiNNkILL1ofFz1QSWXrT28XPVlfyNaHxCsUPU1hWrWqtWrVq1k5V4VeKWn2h2Y2x2Z87dMOr1oJOb2kQHqzRR+3+Q4I70oxGr1lQ1k5vafWBJ2A545jUcEnHnZh69QNFa9TXIeyGwxHqh2B8VTn02B2B8QGeonYHxA6kaJVGkpKXTpp7If41//EABcRAQEBAQAAAAAAAAAAAAAAAAFggLD/2gAIAQIBAT8B1Y0jSPB8/8QAQBAAAQMBAwcGDQQCAgMAAAAAAQIDABESITFBURMiBBBxcmGBMkJSIzTBMyCRQBSxMJKjUKFic2CC0UPhU5Oi/9oACAEBAAY/AvZ/CKqrujGeA2YU9cv2ZP0mXbKn1GeLJ+kyidmv5BmmU2uyP2XQqKbK0mh9gaaDirFOrk/pmg2bWdynNNPtpJJvsf7llCQkZh6LwQaGzHRZvtXnP7Az0f0v3LZa2sFEfCB57We/RPpuNN0tKEsOUtk1NPYGej+lVUaryJzxe2OI1TWh5/TcQh2iUqoBSVV5xNyhG0srs2ga3RzTKtFJuujraHqJSbhQTzx+kR8OLrROqSMsGkcqmt4pFO5Am1EaRwFClUIpHHcqRdG29Lco4WfTZ6N5aUhxShmilN2hZxB3FopWpQxpA83Wyc+4pCHFUNKxLyK2VZ/kKaadspAGSLU8q0QqlfnFtSlWk40E0jRqnD8Odn2MWl4Wv9TTbco8mt5gSkUAyem/yzEudnBQ5ps6kmoKTSP8RH+VGml2rSRQ6sS631VR0ZCbQib9Y+D3bOAfO6xi3jggU9Nno3tP5xZMLeRxMJOSOOntKrHWu6bUdczC6BIxJpENjBIpuppm65rUuO68gSpIAmotKuBi+AjnL3WQ6gnNa3XmkoHWyeVvuUJRTiAcxO6pIEoHWz/luU6pSPCKqAMYm12ja/DuvMVDeNsHASrt6kmlc/yH+WZs+1oGCAFxttWDdaR/iI/yo26pxwFQrdEsorROeNP/AOJgZ7IVamzP0vUTWNpOCBQQKyuG16bPRvczo1o273VVjigesLI6YaDAVMCcixZjbPeNTEZka0U4vqpFYbSiEZECaQMGn6yraiM6ThEvJy/pH+MDLYUtKPUILbakJANcxi+AjnLh2Ro3DrnyTTODwSP1MU6eAGcyhKlqOCRLbrRCc8Sw6oqbVcK9mO9HxgW2aKE0xZWqt+N8Dj4NUitD+kq4oqJwEtaA+uLDmkS2kdVWeHaHHCpBvsSgw/DtbMDRKrzEtJ4k5z8h/lmMpUKgtiFvsm9J5o/xEf5US0gN2UigqJonQilmtwjgyp1hAkYmFsf8SQR0RKBio0iGxgkU9Nno3lJwN0W2eyaTZGq3jrdF02lR7SdGIhWVCoqhqlOqI48e0bIlO8oCMoVhWu5VntAKjyO6qsf5UrnWdy+AjiEedWq7m54GgedR5oltsUSmMIyXmKcerhQUEca19ZNMICI4eYfGMA3i2NzrSOsRdAeqtB9UptDX+SJaZWFc2b8QVuKCUjKY0WV2lJJBujRViUCvyKltBOem6i0pVxEolISOaWlNNk5ymeZa+kSqG0J4DdaCGwrPTdaDaAc9PkM9HoW8jgrubzq1o6MhNrc03mF8J7igYy4rCu5dm8JFmOud5VI/yp/mdy+AjhT51K9WBaapWgwOJxyjMYw5kvTNFtOUat9L51FfVNH28bNu+O9HxjHLG4qUQEjEmW1JQ5+4QvsrNkYpVGSntKsn2+qiAOeec0h/ZNXZ1dJnix+qeEaWnhfPAuBXNll5AlbQh8KFqGRMqo2WQegRKrJURnPyFIqRaFKiUK1WkHPjPe66tmv/AFLlqtOKz4Rtho2naYqvpzwgFbquOEBXbbzEGaB/zmRWeMhC1JBrWhiiyLVnG+WQtaCnFJmnFxKT0GN+EX1hlhdX0DOZQLUVrOfCJbtFVnKfQZ6PQQttJUpByZolAaXec2ECRgLo282hSrrJoI2C2qwDVRpuUhQqlQoYShJcbyETRB10Du1nUKEZVKiWkYJjx0a6E3GkotJSbRx3KUG1lJAvpF20KTVWUT3llOv2gMsqEqIPWTLCq0VeOaXtkjIpM0eme4Vje0KQpKUmpKssdShJUbrhxjPgl3LFbtxba61a0zzB5o80srW67zRO0PpsBPVScfb/AHZT1lFaDMLpr1dPPKBhr6ZXQt/TNbZ2+gUmk2FyzzVoRLW0bRRXrnjIpwnhCtw+qBttISkZPle8oGsjrc4nu1dS1anvSxeq5PCO17N0QoYrvMdSe7URlQ74jHTHdMoi1Sl0W8kUBwlFChKSqIJwChK/8abkiB40LjgrwHos9H59e2BZtEjVjRWa4+xEHCU54lKRQARz91FQN11m7iI4Sb1CyIykd6sY6Y+4g6zeCc8Qp5AUit9YumFkxvlCaVseCX+hnujpuPUPk9Fno/PrbdXRR6oyxQV1QrV9jp7u5jmglxsuJwMqlt0HvImu28s/uhddoXT+kZLTal0rWke0rakWqUrC4w0pba79XIYtl9pSSkUSTliK7O5coZIppwVSqEJaWoA3KSIn3hsocFxrl9Bno9At7MAsjtnCefI4Tz5PGFxxASQaXZfwIQW1LURWLCW1IKc+40dAAOFmNOr6yhf7Frr1siRjHNp2mtivr5oENpCUjIPYrTq0oHPKe8D1SrTiV8DChx9CVDJPGUTxlEttLC05xBpnUornlWXErAzQF5wIBzzxlE8ZRLDTyVqzCFCn0BQuInjKIdC4ldMab2ejfZSaKcu6IlpGKjKBsKVlUqUWyjiBQwNtpspEtPLs+WarThllVpo/uwl0SlwKJVfdFuVKAjG1NVpwjPCW1XjFJxEsoCneThLKwprnOG7RLCyrLQRJtFZUK0TL2XBLbK7Q+G6y4uqu6nGeZcpKNq1u6cYpZwSKmUsujnpLAq4r9sotC2+eAg1Blt5YSJqtOKlFhbfEQKSag4GWVLtK7qb55hyBAJQs5FRbqsEisS42FABNL46XAo2qYTSt1pWl8NdlUb8QIhTIo2RqiW3lhI+M1WnFSi7TXKwlQagxOltEqwpFqqpARjamq04oSygkL7qvkVJoIW9lNtzvZBPeNtKta+zn4wIQkJSMg9jUtRy0SM0CjtCQTkpNI5SwkYg4xbweCbWSkUyVWqZYHg8E1yUhbK7VTWsWodVOqJoydV27pjdHLBREuF0LqaYRTYWEUFZplOhV1KATaOWYh0PpFsVpSOKLlu1mG9no3spzJrFK7qN5UcBfFOqOOAzCBx9agVX0TkgTW0lWBitmWa2b0xrkeWFAXZSm8xTzTijZxCpRBoVXTwjyrf7cItpWKTSItdnVjnARTi3ClINKDGF5lalBOIVEKrqk0Vwi3R1sE8YlFarWcTDo3VFwDLgYlxBopJi3Bgpon9NwLzqrZ7uSLZJrZywpPYVQQoPVQKCKW46RQ0spngX/AKhEtjBIpFkupDRNa5ZqvOWueFJxSaRvTC1bTRXPEoarQprfHQ7a1aUpNE3WmN8XxMY5EU4Tq9kZhA6+tSbV4CYNa0hWBitlUailpM2fgZowqyAKkxTrTiiUCpCssbcTilXyAAcVXxraCi04oVqcnsqqpOjJ1VSjbps5jeIGn0hCjgoYbnOA+ERxMWodY6qYhBFUi9UUjAoVdG3R2hG+XHORu2jlmJQ26oJGF0aW71yL97PRvZXnBEsntppvfp3DBuZ5UTyTGuR5Y9yRH+QY3yhuf4wcoxzgI5y49XCwdzPOryQOMdcYXVnVP/rhJaXf+2UOOhPw3J4RzgPhHeX5Jp2OvS9OeXhxlXqnhaOp58Z7wk6lK8IQxRtHC+W06YjkRSl9Ym+M8D8Y3yPLNo4DcviYkj/wncimaN8vyRrp+E2fgY5yPLNo/jMHyPBi0UmtIlpGz6qbvNmeLfbM8W+2Z4v9szxf7Zni/wBszxf7Zni/2zPF/tmeL/bM8X+2Z4v9szxf7Zni/wBszxf7ZnhtmH6iWmzflScR6K2VmlDTWwMK6tt3dZCoAnGt0FcY5wHwiOJiWBg3jxlvZw6LWVKZpdoDlcLShF7MeUmN8uOcjc/yzGAXGwbGeUQtKuB3s9G8hPXTrJgUnVWkwac6JeW66ahLp5hCpNwUCkjNFNquUk0idM4G3AKGsSlrzaMueObQRcBZEa5Hlj3JEf5BjfKG5/jKVvtGOcBFtPLsEqqCYtphdtaxS7JG2h2jFBIqpGsIh4CtnJLWnSOYxKEBSgTQqzR7kK+G5PCOcB8I6K32/JFMqbUUpuKhnms6imZQjh2cUardHx3rVIDjAvTBP7csccTgpRMaocK/GNKyFEd0ywi0BSsUpo9U0vi+JjIzoi2lYpMSl5wIcSKGuWJbZNUIvrnMU/TVQKdM2fgY5yPLNo/jMEBB9nKVpCgchg2nZ3VAWukRp1WJF/oFWzujkqlPB8bUDr6gtYwAwG5TzakUOeBlRBUK4RS1ON6xqTEtpwSKRbJ7QuiHdI3RJ9YiUNlIINb4tx1SLxS7c64kt0UokXzFr1zSuLTSmCTjvZ6PQt+bczjLNRxtX6TXdbSOa+FtKiqpqSZa6jneE1XGiJV94UzIgbbTZSMkQtDgTZFL4tS3Aq0KXRxqtLYpWJUXkUBrhuU804nWxCoXXHAVUpRMc4CKcQ4EqCqUMvW0Bxlqttw9rcXGFaJRxGSddr1wK2hy1Tspi28LSSJ59FOEAmnaWmpxCoHnXBUdlMU60vRrVea4TrtHpldodFMyIEIFEi4CFzZlhNeyrCeFdQkc18T7quhGNvLFqcXVSsgwlkmypPVVOu164oFdpS8Yoh9FCc0bZrWwKVlVargwUJquNqE8O8AMyIG2k2UiNlLgTYrjFOLcSqopQRbRNAsUlEuNlOeJb0yzTN7Quz2TagZrrt5PR0SXFaMGlnJh7Cz0exucBHOX+aU5srljLZh2fa1kUOqVfCVBqN7le8r2Fno33zW2hof5Txlr6pVKgoc3zS9pignJSFsLt1Na7kDRlZVzxTeiKCBXH8wVUsOd4Tvs/wDz/wBSgNhzuGW11JNwAyz3ttGjTaqTk32nFpSOcyzpuml0rpUfVKg1Hy2ejej+TyGJbQKqVhLWjB5gZaaWUkRLtKHAjn+exwMc/j8v5migCDnitp2dWjs3lMbZd1nkq63NEbO00FKGUzVSpI5NJ11/UJpNu2pKBzqrLLanXF94Sy02pcS0s1Vieb5bPRvR/J5DGOVKk0EeW31Sq6C1dbNqaRfQM81FBoZgJ56vETROCw7+hi3SCQkVoJ4Oy0PXK6dXqgZ2gAKOChFKGQSukHCzPBq0SeaOaa+x2oWdnAKxio5JXTn1RGmpVGWOfx+X80U99QEa2h5+iSKlMo2pv/C8w2NnUeJlWmLjhREt7YsoHP8A6l7ekP75RIAHN8xno3o/k8hiUtVtnCk12niPXAVNhVnsrmqLC04pmjyNiL2hxIVZNE1i9RIWkVSYlxOKTWXiqVCX6JJzrMdo4ypQTVNDfEqGIMXydyEhCb03mmMdU0gIABVdKm8mISEC1TWNMY0pCAkqBrSOfx+X802pnWSBSmaDSvpHML54RS3P0llLDYHD2Bno3o/k8hjHK3MrAFs1BiQMCk1jvPT4RacoXHFHAJO5sIuWQEVzXQNg6yspi3feK2Ek0s7lcnc3yRH+QYDARlEY4GOfx+X+ms9G9H8nkMQ6mlUmt88y3WW3TU5IdpdFkkUSINpbFSm5Q5oVN0IOKTlmiCA2k488SojwSDVR8k1BVSDapEuo6yYWQ0lNsUOWX5Ip1AIuIodzfJEIOWKbULuyc4gaUgOBOEC1pACcAJVYNFizd/TWejfZcSFDMRPMAcDPNn6pVthIOffaWyK5xdK6GvEyyhISBkG60trWzi6Wm2Razm+aRxrWy0NKzRoSAjNK+7p9coMN1l1AWOeV0R+owshlFg4iaRDWtkqa0/prPR/ZGej+yMvVTZp+W//EACsQAQACAQIEBQQDAQEAAAAAAAERACExUUFhcfChEIGxkcHhINEwQFDxYP/aAAgBAQABPyH+v0suenWJ3F+FEZ3o1BgPNLLp2fO6TdDVpIDI4DpYBoJNOv8AQB4YEOUjw/8AGTziYHPSc7Caqxy9VDn+gR+Ot4Hpx8K0ED8R/Q8N7H/xevVeJS8FxB4Rr9z839EQnrT5Beu/oeG9j/4qK5tNz9lguSEMKeHj+ZmGoHShIBjXvRFFCgvjXUwhYVtcboXhRNO85WfZzgkUsCGedJzZry7wUfIkHALdF5LLfhYlUYwRHH8/Dex84K4LAjNKGRAc+UTZcJBfHtI8s8SACPelYQkDD/A0BwANriR+gGIP5nnkiThso82ojP8AjgyckSc7Cnnpy5uo8KeE0A0Pz7pvcyJdRQ/FiOJi9i28nwM3BLNzxlJJFg090Xl4v0+xRlJqXVsJ6B+7GDQur+fhvY+cCGt6GSzO6D1M/uuVAJa+uGqU3Ijo/wDLuKp1OCkvJh1oL4doCVipTjyE0WQTc8sL1RvPPC4ock7k3se17rkVQSsF5RdCfIqSG7eXeATZulRhDyaFY9AjZHSlQzdYs8ZsCyNbSGW0cypwicdP8eUQTFHEiukz/wDgu6b3VyGG0Ya4UwHyeF7Ft5PONOIRXsRYdTYBGst4n1qkzI9URdPEu66e1Rv6uX62aTI9Gh7fn4b2PnjBoH018JqGcL0Us+dw6XWN6UWanL9Wv0sLufTizlNd+mnjFV6JSqUqzMH7uhzyEkvS4QZ3TqXBaHJu4lRkVjH4LnPfExJvc/wXgfXN7nte65F5WZcWl1wfapAylQHUu2OhSm0RGPiu9PImXD0rVin2KqVkiXdGJk+ca2Sh41tcLNp8DocgqXwAZ97h/qyx0TUFxkPCdqYABgDh/jri0m4LMFycP7R/B3zen0GI8SKupesq7Vt5Pq2KGfeqMlSiiw0SXxfaaCEpBTg5ewOU0iZALoIk+n5+G9j5gbIquqs/xuuAH2FMbiQ66/SpXA19GkuIn1PGxmz6QVofHff6UBJzjeCfp5PIgc69lVnQB6n2vdcisQZkO+li9j2sh/CsFQeJyeHE2JrIC5R0erime3jSN7EJrCePhWaQiJVzJfBSbElHr5cZADdGaTZASTUUYHzx/Q1BBNdD6P8AI1ggJdZOgGKd0M9UfwR7PiK0AQYKFBNiby8oIrtc1BLTTP0oyWuqZXOtOUgBNwIwl5ZZGfOfx8N7H8JgGD69Hyjqar9dPCLC5EJ65uV53CORepy1zexPrWwgxXaSPrRkmpSApnLWu4YMeh973XIvY9PLse1CwHS3wYa2OjH2biP0XOoI661UTH0gv/f2AQcIS4dKRjQB4L3/AH8iLrKMFKhkw+fkqeahqM7NahwBuOP760i1VBZUFsCfHSgyZyS8JL32uO9DCqlA10D0vjGN2ROM3HOMZpet75aoOLWJ07L0pjH5yfJJEJXZfHqB+m9A04z91iTQwFH2FmlaI2DddQlGcP0szg7O+pZRCCdr+7GqMEE6WRniGNWoKFyfFGFzIOBXJmc097mUdPCKR4WSgfq6ZtC8q/h4b2P4Zcvwyy7Lh6AWeG9wGiC5Xiy0cT60jcKGAHlIWANy8JD3KHMuB2xko2JTCg+9F+CjrzvG24OHFJvjQIY8o3gAcOKP5FMUkFYM4dN360/jFHqfusYgCpCuDUMXcOT7UgzBwKbpAmG0wA4BLosswsU8Z8kXMEjEDhZmN6kTQBCcZJNQtkag78v78rGxJzFHEb14+CxhjopADd4Xjo3keFHu5npDZEqbS/muAdU/3Q3qqHhdDEQ/iiOE4HZFDWo9uzm+nhupJogfikVnW3zFHcYXKTNUzMHy3w/00JYSAmda1GMB1gsp0NPCa50IL61qFPvq6mIhnkfj4b2P8kNj+GEzB5w2Py1oDQP8A+kBhhdK5BYC7Tj+kJgoRGhLgwpYAADhWZMEH0+1PYmeQWRpqBo7rTX4V0Mt8H9NbDjYO/CjsUBwc/SsCFRJ0vct6muPEfFYfclwfxeG9j/vgCnkdSaYs6Us+r+lqWQ3TZ80QDtSsGr/AGaxXemX2oLYiUD5uQB4xoa+DnBmNK4TjBidbpygCd4uWEeCk0sfOQunXewlBHTndXrjp5376WD+HhvY+elw/wAnQdN7JnliFm3QkbnAD6MNf8HSfisFhQEUUma6U84AAIsPGXD+kiiY8UqjDPA6voKQQYOB/S50JcWD3FHtYA7rXV6EnS/9G/8ARufKRzLyIQWtZ4gM9KuSIHiv/Rv/AEbE1CeRVNrIdG/9G+01nn4b2Pnluee3FQu0xypHgopWo/RgepR/aMLDaHQ49BY4PuwUFKOI91ACpHRKeKoB4XGb+GNdrGOjxYcJzghUbI1fqUVJubQgkZGwScngqfIIFk67WCFbkNjY4hx6jyWkbJP2X30ks0sOU4rWJnQKSiFiR/dcobU0nrR5p48lBsCRON2/HPHpYUduwURIuMh4UC55DRKwhuoyKPBDeS6bGDiejZi85FlUq+toQ8gicJsFDMjXRyoKYBPzYpMsEQXZBW/QWEFbsFJzTxHuKRNkCcbGRMwM6VWlBh16b2M7sYKiiROk+n8DgQarZPNiB/1seg4G55q0EQBAf0lgmvaSXACkgqYTPmyxKo4rSlzmU4xTKojAjUpntJKelQGaxEWak/AlgYRfqoASHUmZo4rHIVcRnpPG4AViBrex70fiM2mjDRDQjz8N7HzZ4Vfk/aiuTNHVTzYGAlVVQvaCmr6EWHO4OdMcelwvXPtxPLkWTT6/BUZecTJys5ZwFiZsDmzgIVehWk419SqZOxe07XASNcm5R5a6N6CkGLgq/egFFqyWbqtbpaGElYhPFPRjfXyxtxMRisiaxuOFWNZ+lrUuwg6kt4SxhPVr0UCck3tdJ9n0r/FnVlwiz0SGGCVdoeo3LiIZTZj6XVW7OeLW5gVLGs3jhXJKt7lvQW6AqGMooR7bhsHOaOi18Z6NjJmTw3L3nlYTuQYuGfyMONeJAP8AAuACAcbvgovoP6iSRZwiHgJYqDXF/jGoP08u+7L3veyOg/Ub7Vii722eI3mBPJ43ueTe65nl2PejEuAHB8WUvVEifPw3sfNTg/hX71S0Tjrr5pTqx/F8RQADSKSfjL2rBHGX48uds38idu3pfDPY8p9p2va8ikOpP8U1vRLPypyTN6DbyxPUqXKghQSjrq8vDL2HZe15Lic4GY9FmIXjmiguKhHypyI0p2azYWVo5KycfmdHtZLZjMjN7Zuvf817zzrpe5b1uqBD4fIANAY+KSTj+6oQcYvyvceV7nkvadr48uh+ecslGqVdSMJR85r5e/L+X/la8jXka8jXka8jXka8jXkanMXjhfGm4vEvxDImAm819lAPCnUFHSwm992Xve9kjinqfazsFRMZLly4hLr3uz9L3XJvdczy7PvSxgSJkqMmOBPn4b2PmAcv1OVVpkjcSl0DuK6Vjy7EfLZBUg1VOXJLASIePmVFll6jVgZluuvfPy52zfyJ27el8M9ipjEJidL2na4EgRhxUFc10B1oATCPTjZyRAOWvhcpQzuONMfAqUeGsMFd+3eXhl7DsuFGpHouRIgZ9FlZ71+mbJiMNHUzIeUfZoMEBmN6uMLKMOUWeyOzstDQUBNsqhtB8P3sbhKaMf8AawZJAIb3Lem3pC0w4hdedJcrhYcanycrF1oJ3X2veeV7nkvadrh1KPBE1H+CP5xLFCGtUwBAfVv1Wu080khoggs7PrTalMo1RZN+flHn4Q0SCsLxTozUp5ZL7RcdxhYdDUPB4NiW5kLzDS9Vq/xXACONePlkq+nML0v/AEv6sfQRyPV5+G9j+CUq2un1FwBuc/RfmlCvWh9FzFTIC16l64EqfSwu6Cy+rQ0DgFVL4Y1zW8ZQGlU2deRY5Z4KceXGTeFFc8IdL1vadrhimuHFfDfEn6UhwKFGhseQwciGW/S6DDvL9XNVpgg+bkDVO0kU1/PSm8jCKrGAMLTZsVWoaLJxqdUQCU/SgwFvL9UgSOvG9WndLA4FCaPLxnJovduaqkAIK+U2OU8cEUHNUwTFFEc3l+rl7gwICLLGBypqIY3BE0FISPqt71JxUfaqLxKEr6tMZwNeFgQNZj9XEZePOu6RacJothiUfiK3lHKoP7ELFQgbGti+JpXEXX8ReaEOjJ8f6PhvY/0+07XteR/soBEkbJmiZeDya6k5C5mmBJojr5weMw/0fDex8wEoDdrsIbQqkHwLzIop/lNZEHLp610OXRHkmkxSIBFPGR+Qk/7GuD9fqcaQzneq/agt2Ln03ps1N2U9gkeg4nN84UHxiqIjlxk8VRCMdFGaSEmiP8fhvY+bSJjCk1bQJ1rrC6jWimdk35JQ8BKH8/d+V7bk/wBlfiogkalzijHptSMaRsG/WzGVMzx2KZi7Ye/yhPNcsjxqHu11xZOrkaXNDHJiXA/j8N7Hz8G8h15gyroXUI7DjzqMWSB24VfndD1dU7FlPy2VT5SbC3BiPBrrFLUa+jwMEvlvwNIj2uO9OMLs19YIl235UXRM6BJ9WjzmgIRM1cCbpFtX4tgj2uUUkARM3tuT/aihJ9B1+lkAVgHHekfCcDJ606NoTKFwNY740F6030Glj1NxT4aWJdaAj+Tw3sfPwahVJIKhmy3J00ysLJYepW3gD5nK5jxSObn9UnBpCQdVuZxSmZOFeSDCxBLJjxEqK8ZhqfNAGtAQTashAEuSc3t5NbJLSUlSrBDEsVgymXm1MmCXJXFr0omIvbcn+0XhlJie9Eg5wGFXFbZYeFPCHLQAgP5/Dex8/BvMcejCOIRF0OF6IrueBHwuEUrxC64pPx5JhDXyHwuqvlfxpEDRwTB1uh1vj/t5d+2qAO8sgcGap0gJe78r23J/43w3sfPwagFqMNFViHuluwPgMBsWXuWOsb1LZ4GruumUOkp3wl2WnQgNzS6aCDicbBGJx9rkNxCrO1RhCKyNEBTOAh5d+2oipBDWaZzQIX0NYQ2pENgOk71ArC7FT/xvhvY+fUx6KtKjnFCVn5KpYW0RL8vmsk+uq+KWyTfaM0BBAeT8otVy+LAV6ofN1gGpPUiiSogOl3E6o+JpoIBAeXL/AKNL7EYKUtwzX1oLCZTeh/43w3sf/SeG9j/6Q06zHHA/63//2gAMAwEAAgADAAAAEJJJJJJJJJJJIV0lHJJJJJJJNJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJrJJ/JJJJJJJNJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJnJJJ7JJJJJJJNJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJCpJJP3tUlnpJJNJzIZrJJJP5JJJJJJjJJJJJJJJJJJJJJJJJJIsJJJPW9iuOJJJNIkT3KKICMwYfIKITlJJJJJJJJJJJJJJJJJJIvJJJP097/8A+SSTSHt/M/eRPPJv9DJ5YSSSSSSSSSSSSSSSSSSSaySSTtrd+52SSTSU/ZPkfyjP1Z1gOUySSSSSSSSSSSSSSSSSSSIySSTAEmhWCCSTSRzoemfiTI9apqHYySSSSSSSSSSSSSSFtJ7taSSSX15ZdJA0yTSS+5SvcWyNLP7abdSSSSSSSSSSSSSSSN3tdsySSSRlr5PVZqSTSSSSSSSSSSCSSSSCSSSSSSSSSSSSSSSJySSSSSSSS4v5tZf6STSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSbSSSSSSSSS+/wDvS+u0k0k//kkkkkkkkkkkkkkkkMCskkkkkkkkukkkkkkkkkruSLvbSZk0lPMO8Ld7CasOIaMrter0eLWBXskkkCUkkkkkkkkhW+OSO41+k0jUg66l80eSNqZjr+5er81jT0Lckkk/kkkkkkkkkgW0mbTdlZk0n8lorHxL++LO/gAQZXI4lktcQikkkb7SS22+23kk3pmbS5lak0joT++nxL+euOUgByfvxdNPT0QlkkkgskkkkkgGMgy0T162ibk0k6dDcuyiUSs7wQNS53TP6B6Jw7kkkkkkkkkkkhUkmkkkkkkkk0kkkkkkkkm8kkkkkkkkkkkkkkkkkkkkkkkkkkkg2Elkkkkkkkk0kbEkkkkki09kkkkkkkkkkkkkkkkkkkkkkkkkkknTbkLIkkkkk0gHvkkkkkkk4kkkkkkkkkkkkkkkkkkkkkkkkkkkkmv6fZkkkkk0kk6qcHaTeV4kkkkkkkkkkkkkkkkkkkkkkkkkkkkj+b2skkkkk0kG+/RqZ02q4kkkkkkkkkkkkkkkkkkkkkkkkkkkkiRAkkkkkkk0kktfMWc0i94kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk0kiKfWVw0EaJkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk0hWMixmrJkKakkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk0kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk0kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkckkkkkkkkkkkkkkkkkkkkkkkkkk/8QAJxEAAgICAgEEAwADAQAAAAAAAQARMSEQQVEgYTBAUIFgkXGx8PH/2gAIAQMBAT8Q+PPTKT6o7EMp/wAuJso6+B2/TJf8IAGo2UX8Cn6WYhvzIlHwKfpRKOvPISUdNmEXDk/lJ6YxhJxLkZScJx503JQdSUHUnhBn2IlByR72VBBn6eZR7FE1IQuWqJHCMvR9EiUZh586b5TYSYQ0U00itSPCWXki/wCNSNEww8JGpYMoRhHf0+OUXHsUcAiBJeWqJZlCHljMouUBHnTZ7QwlJS2UpMMclkMTWoYAKTLyRb8NlOUmHAQZa0hkdMtac4en1BR7FEMIPDy1QIZT2kwJahJgSgQPOmyikWnKchKcvKU6DzqNcmDJPQQNJcJJIpNMyAWmi25QfqeZRXsQDoxygAU4cMajSDOp8aeA60O3o1oWmg8+HJFk5QdDbD6JEABpomGAachPzyYZcuWSgpAWWFyz1qOz7BEhAcBnCQ5R04Dg25GE8EkCggA0kyEQBICU9CBHhTwOMpPSGik8aIlnt7Sz0gMszoYJbC0ki05Z7YsnNaFjRCTyRALfzweWO2GDBp/wHLBQI9qmMtnQBpKcDTlDwUZJHaM58affgQUfCNM4aIQ5CHIRqTlOQmsNqLho+NPvyiz8IsiIRSewkOUHgxynEnlBjD3CckAkSwOCl4U8MlhhH0M50UZEo+ET18QmNAQUgGPr/Cx9f4UGUmEGUmGP/Asf+BQBSDH/AIFEt02c4SYYY0SyWTzozw9C5ZZZ1PTPTlnjU9OUHRJHDM0yeUFJcslBlnpyz2konlJIoIM2xP8A6hJZLJ50Z4bQXLPfszLHXwyYygcskhglyKQe3PCBZKO02meEFMEJJmAieUM9ETZ3TYtNgbKHJQeC0dFpPq5Qh5M5IchPaS0HKRIQZGsoKEWySYcoEIBAgOUNoQJooEIrQclB7aOi5TXsFgEZz8UGMPoZIvQeUpqAikFNE00HHgpvmE8bPqlDynXLT+f7TSE8f1DyRZIgGE0jhMc63qorxMgpgsRTLB5cDlAgQEPOxWxTynRvYrzDIKAOCx6v5fy/l/L+WR2yO2R2yO2fVn1Z9WR2g+rPiT2GRwU0hDyi2SywFNFNPymmgwWUAaO6bPbbMMlvCMhGMI7bOuWn8/2mkNP7/tFvJiCSnOA0ThOWWT4yyWQhPKWYQgQh5SY0KSJEIpGMPqnJ0b2Dj2Y9/lHhkMnpu9VoSEBITJSMywZnUs+iRJ3Twjpk9MlASOmS5QmUTZQlk6AIpjMvJkzDJY71TJ6cnUnwiGS5LDkUyXIYzLHLJY5cjRHIZLlAhMoknOpKfkCgxj41Ph8kW+6M9NVXhnHwaeBBj70EUgZnRmgiefuIitA8JPCRwdyyw9yniCkSEe/z92cIGWuUsAtUiWQj26eVECCUljstsmksP5chOASw5RjDk6Aj7ssyiOHLI7QOmO2Pcp4khOUHhDykRlNNhxRSBwmm/QgiU4DSA5R93Rc9MFh8CnlylCLKaabgJMOdX6qEZCRhFPP6dTxz2gQ2WmJyGCbScwnGUuedX6qNA9sHjRx+m02ROkerGz0bZY16EBhhEMbIlj1Y/TlP2Sn7ITOPtv/EACERAAEDBQADAQEAAAAAAAAAAAEAERAgQTAhMUBQYFFw/9oACAECAQE/EPIaCE30w8EfJhHwB8kdRaCmi+MS2fiOZvUNh6iysjJgYRUVZDEUeUtW0FH1BwdIp9MrIrUvpWTo1igQ0jCUeSJ6hW/qBh6oKeBLYBSYuj+QEJtQVakIIdQge/fAKzBgVlWgy8BD0rLS1LFMU2NzD0FWQ2twDuHpFLS1G5ag8ENDLcBCdrfonTp/CMBBWoHUah8neCiggrQIHax78I+KEyIN4tQOyaBS6f0TeM3itDJimMNACYpimTJimkUBPRqhlpMmTSy1k1LSyMEJ4allrG/iGdFEJhdFGNJggFqGC1I8Io4DSaDugw6PYNYwWR14zyUaCrK1YzCTBVkO0MUxRxbm0ntdpOAp87YSjARiytLGyIkZhJgxzKZZHsWk9rtLeiOJ5FD4hPYKt4+sOk49ePDKt7oeMKGTZz71k1LJsgpaD86KijW8Dvw75RSyFAqHaX+PGIJqR2LodQ78gKdVNSOiD2Cn+PFDp08unl06ep06f40fSD+Nf//EACwQAQACAQMDAwMFAQEBAQAAAAERACExUUFhgXGRofCxwRAw0SBAUOFg8YD/2gAIAQEAAT8Q/rsyYJgr24OrZYLffmAUhFGoI+rYpvgb7X7B0EkFaLR2WySOxxNV1HmvMULlYkHR26f0I1bJZEzoWef/ABaxQ4EWzcdT6a2rOY82tPQ77UldwGD0sGxYNiwbFimZnJmJKInqEr1i3ZIg7Q+v/m407ILMv0HXL/25qYn2Bv1em/8AM96pcDgpPEglCRRKAsATzAH/AJqMhMPOW/Tc1FwOZjZ8BCev8zPHxxDiVFaDdRgJeCbP1G53QkASNDvSCJ0KEVmIOKz6MwhBiWVAFI8lkDHBI8xoE+OlEwgNgMBBIxPNhTDGcISLAhBUEGEJNd7GqNWAvA9UqdWSha0YnQeaafoxgmnAERJCufSqCDJAkkcLI59K1lvh5CDErlhK8EhAEIMIlUCWlMWDVDEk5FVjrRApkzt+g1PwxlCqpNaKg5mRDAb/AKy7KG45Cce1ASxSqBqI+f8AHWKDnPi8hN3/ALVirGeC4nQ9qcaRsAaAfoDYk4N3xONzCf8AavZqpEUN+K3X3D6FdTTRIbM5qYKSyMKInkbg8xI4z+slkebZucs+oetcGhJHZoiSSGxSeo9LCyy1PngfX9KNo1Io5X0F9LjyUBem9qIAojwBLWoXI+BcHpFySAPRh9/dTDY+cRqlfAUd0wUOAGjoBNTABlVgKCaeXtppFy0SR/DoudAyaoCyUwO7W5fqNPRvxm38bOBBlXAVSDYVR2GbJE1CW6rAVAUsLo7DQJI1QSsFSA2oKl146gPAtCChHMlXifCHq1QFsKqPgbAkROlRG7FO6CA41q/EVdZwD3ie/wDja01s9ZRklZE0xriq1TYZMCL1hjt+iMjOlprCdnR6RtQZTi1EHsEx5vxW6+4fQp1hPRLtJUCqOQKq928Jbw37lJwRE6h9BYmiCLUUz7L1slZQ9H9o7FxvPJM/8Eu/6UaRSab+GVIrElHIcnpNwZmo66Mdy0VtP6DAvuXDIq7Ie8O9xDoI24J7vtSlIMPE/uPRZosP0ODrZI1SQXEhq6tGTKUANxs+03Q4eew6m77l3ByZRwnhpYYYFmDQLMSIRoUylCffauTUTigQJGFhi/ObfxtKHNC+0djnrjhpJkdB48ngYX0pZtc4k0PHL0LFD/J8WgHX1qn2glW6DJilxOzJcQXk4jrXFEZDDTmm+YfvW4ATEFzkZek1GydkIuWdNTxN1metIuKicoSZk9srMGYgSpAOUS4p5lrMkjk9EUD6gEANAP8AHiNM5jCC7ET3KzYWh1tfsOgfofF7qAhPpEIlCySTzceTRvwW6+4fQrPAkRA3aTqi1pCayuM1onoDWc2PQrKgyOVYK/CQhsBo+YRxqrBR4CFNgH2/SjQtBO4kNElG09SVskSOup8ktnntQaIWppI465D2aFZdjIxlep9LhFCr531X2qR47cJ+oU2bJGkqLQERxQglI3SL3Zd69C9LJhv2Sx3SMjMAFhfjNtPK/GbM+XB18V8QaxKT3HOOrR8Cm+ruus2OVnzeQPv618snzUpLpgju2MDMOJGWu8VKi4NRHFdrVDvUu52gSOKGKSEg2wA7xHem6ZUSqSR2SpMIQiR68XZpYyMw+Usn0/yC4/MYFFvHCMwZlCcnvX5CB1EZ/QNPiQQfKTTAgEAEBdspAfe9OYMehXVXLVOqmb71y+1DE0JKbKFAEgjw1sn8H64mo9SCE1ErdWZRl3CyTEk/hBqh+jGlrDLxH9ge9luGI+7zRgALxmXvNWUqp7rSx75xGq0fVVY2yrHFP7AGm9ChEIiSJzZoZqkWT6FTtW4CBufvL0vsltD8D4zbVDKLiMz0njZ72C4FCERhDZ0St2c2yRk8bO1eAkjNsB9/SvwZceB5G5Ppfmv3urhWQBzlMWQ6BeCnymymlX+iIAcrcCFREfW7NiSlEgQEETlMJRVgecPkO+s+T++QEpEA6rURLtfqj3WMcTVPQH613y6IiopPyoX0faiCGXHyFnvUAWeDKilFSwwUyETJxsEBDzNWh1yI6OpFz9LEh5zpuXR20oAAACAP5gK0opZqJo2c1dlCZFzkPrcGAyzw092irSIhwV4DQPpXJLIEGGTVWYP2pctlwnWWKGBXlI6kT0a/emMEWomzXrV2eVhFhMa0bCOKUswZcrDZhBWL0VjudrI02RoEQfJioCEHKZE81/ADPy2g+/Sz6m4HOYHAPpQm8KHkmXrxx+hGUaAVgcsBOEqZdjYEYUpgKLUCNgILFJJkjGRjTXKohqEVKKkZiO9KTZgeQhrriqtsRZE30unxwDBsGodLKasnA5gcrxcLZy6rVXVZaoKCQBhkYhpqEb0UQw8Y/BEw3jAkEIrkiHR6kTqVnxcaUOIcOdzxYGPlc78bOP8AtIVerDTA5EnI9S5epKPnDJldGLCDkMCNp1qYMPJ0ZAcsz4ozJkaQjAdKvhgyIJVjBTS5qV9QmreY1xipjkIH3GGjJI+ihzcCW5jho4HXM/329pX8MExIKv1uvF2H2we80INcH7dMnOgn+lkmc19wQpYjdpdYdSN8+bqY2nqSS5957qPFMHNV9rl70dKwXB+71/SzNhDkl17vZdqNFEhPOEeOfN0eVHuO5x4OtRjIedAL9VopSDeYIHYKokaJo4J6WDcFdQBPRb8BvWGxotEtNNSkjLVAIl6tlaBawCntFAkgnABWpWRTty+r+xYOWJgPkKer/wA/oxpWc28fo7pbx+QWQneP5IYIPm6GvB/gKfRwURIdTB1o5qLZUs9hH9IA6wSImSgCAXDpNAw10ADAVig4uRA+6uZIcZkeAynazr0Fk8YOkz2svh8YknoN+Q3qCmyJARUneMKIvw8k8Y8uqGsuA0CTiKRNBEUfGo0yUDDZek5PTi6hVkeRdHjri6/+DjCFlnEpUOJwrimtJhOEEHdfX+kVA1RuXNWGeE9nvUIQgE7V9mpJhHXpLzxc/LEgp549GppvAg+YBWMDGZ8oHleWkHNU9LDBnigQVmcAlhzyVTQTkkdAzE5PPSyl6UhciDmTTPEbUrlJkAArw96GiRbrgdRyWakpgkZBGRqGJ6DRpE0nkef5xlAqwGrVgwqy3MD3aea52uNPQpIn5OvqT6NUEXNwhgOmsa8f4MPxaMiUyss4eKgA6lCWieNqoScF0zshQ9RfeyFyxYJ6H9JBzUqTxjg6tygIEG2HgNuli8sSAf0ku0FD4nWszlmJF9WFQkesCPJqWPOs9Mic42b/APXftf8A679rktKbJDUroVyi0bhrW+5LLLqcVyGlYlsX/wCu/a//AF37V+gLRmGr7lfnNBIMI4v/ANd+1hzkMs5aT6P8o0j6JGsEs9jvZtRJtByvQBe1g38gX866HQrVSkAvAgaNQYzuqq6q80LIjnboZatGeaftLUkxILLwWO8FHoaUSJuVO3R7EolVOa3cwQllBBZWHBmpyJiUz4JrCojesbJ1GtYOBBLonPYiounAZJ1Rx6UyYEiaJXAlASFyZU42oJ+kkEkzQXTWkVPmi7SUuQMRQ2yZH8Y2DOJeeO5rheufpP3sAQYFG4aJ1Fr5ohBKArjwVqAGAHWCVwQrIT7KYnxNRYMQh+YZDtQ7MekDojUslQsl7AyvisQHrfaWoV1EY/Kl9qA6jMo0S6JMyA2XQ7tSE11GvabhjpmHYFF6TcoLnqQ4OrSNBAgrJwu9n6jMiUplN7h9RQBI2XcpWXEySyhHnpRvDB0kjiy0BgOU2DK1OE9b7S0JGoAPcjHcpaMF5A6I2PEEPhCVVA1LGaSkyYCCyxprWZhzT9pbLR4AU5YKJ+gNSZXAG60QPLjrDy2jFNUabE3JqTtr9KYf4jh4/pEy0CaeMsXDYAPq0ZTZwpNMs+l1lYAGEANSNWelHeeeSgaj0rAuUQwOneygL+RKNZr1GsESBEdrktXT3+7L3q5wALgGX9TvXyYy4AOB1wWAEI9DCzl6WeGI8OBGPNJl0hyhlV0ib8lvoJCCFkaTNIl/EAFcy9f5RnlpLzC/RRxSDeAPpP5M4urwBK1QxIjibB296Il5wkJJIyxxxW+13SMMKNzHrVdQWUpOPAKJ5b7n9VB4YslGhuOvijisKRLCwCEmbNZUOgIXZmok0xgLGkJL7XSMGRBw9zNCE6SVTHoIdr8xtuGo8GEMy4DJw0+CggiUQQNNos4cT5SJfEyeKsUYhOmgPbL2rBxzFHO6glsE6AYA0gJJ8sUMCG0hHI9OEo9wCbSMe/4DRHGExpkZ9qVVBAROCo4YafFQPDAHZWqL2diCeVfYrCKGsOByDhmDHFiE5DIOUYZ6RU1VldUES0qjKGFLsSTEzXjod5vUAY72awgeiRh8lEmipRJKZN2VUXmRDBhjTFOZhzyUpw7Fg/njMG72L8duqNQkuxmtLBucC4A66vVrugAgrooOUzFP0awgTXqZM8zV/KSsxcHTM+t+T3vMLxkooYOWUqoJCQHhAQhLzcBgG6k5O5J3oiCc/wA0/wDAaTMPegBE0ZPYI31oB+rP8iZaJFMQWJLGQXhJiGn8QdI2B07RScudztBHl5bqfjB8nvvfFq0p7EvakJISTDxPlg70xLInsMLtDX7MCThwPUb7N+ab5LfRAPewNAaXZTZBkgp1If5RoCOacCD8dKBMSZiQg9huv4e5C8NddIm6Jn1sWsAEbV8UiZvGv6FTlA0OTL6hfc/qvw26/GbX4HbdFMUr4LcvzG2++WgbgZbTqgpw1hKgk7tmECANJQ+hb8H+1YCZFqrO1Cn0FBwI1vyWx+RnAbD2NJorSYxnYoPBAij4TUprOgCA6DnyNm8i8USh1ENmtKHB91ZCdg70KKIEKNyuXN0JuZOM8fhh7bT5ve9Txfjt1dxHg4SL8HEBcNoRVrCJDwy/Qoe0gA5Jvtfm979zr8LvvwW99gfzYx1DnQMHMUL51SBuzfk/cqeoPhvfhH3vwj73ofh1vzr734l978C+9+Bfe/Dvvfh33vyb735N97F8b3oT5JXuoBDwRL1Nuv8ABYJalNJXDiRyBM6xQUQiQMawYfSuZWAgys4oAOR3sZ/GD5PfcksMNHP7Q9WilAIATvDia0pgKW7EwFxH4wPofq9b7L+ab5bfQfgh0jRFr8QSpA8D/KMJuGOWDPee8UVE2SFtu2lbmIJI90DB0dLwIEd3AMeJoxxdsohH1n0rt0Q6jqfWl8kBgwiTkdY1oskgxMaUHgAjvTCJ60UMPAFe5/Vfht1+M2vwO26PxKBpqjlKIkvzG2hzngRIIk0cc1iGEK4pK4mJIN605Rg0nK7EtXSArKBAdzcsq5onEHotVM0lJVskfShq+qGWJBy+heJYb8lsfgYDq1cxqR2rXThyOQLUNNaGhXLD4QzXwaJIRBMDkJmOlGFjHRIAx5aG9DT0A6XBxKlLHAZ7YoDCAUMhJpDcEyrQdq3jIL1Wfoo1lMUlMnmkN9jA8MbJkvx26ifJvEiVxCufDjwSG5p6xBEAepxrNXwUAg2MDwE561Ww5xjgniXqX5Pe/c6/C76xKwBlfNEnxAInn9FFiwWCwWLFgsFgsWLFiq9tKANMuErCMpA1MRk9aWhGxIkqnui/k20EhrPDAXsDM9yqmD2n0n2rNQlG0S5RxpdClA4VQDgZ0rKwsmSmM0R9nTyz/wAJpT+RQETULTApjz2GKEJDb3Qg3F15c1DIRIMa7WWCkxoZZDatAsMCSCSfh8SPoVSKYkGMT/ONomqQpvzeSGtjhq29JfWmt0PskB718hCITAMBoQG9ZIIAMODmjs12cST9yX1sLUsoPQgI9GwHpJp16vWsYknpkZk87UetB4AVmXztQfAqJEmsWd/1MUhjPimLknJIJgGEGTHMVue5JIoqkJcHF+Q21pSg2KDqZHOzSfJxV2IUwrGONh4N+WpJDWgAomXIGeyTpXGJ8OLRDECnTdZTwFiLiHORKOk1IATyMTx/25VmKW8FnMv8MIEB4NGsWMIsgSkN3EbV8IZZ2runvXROMQ8eLz3oEz0REHalEqBgOKmNQ5gnMAwdIuah8pOkgWcQGkPaDD0iKYBxzQmdUFe1YU4TITInI/YqCU8MceKQscGJGA5dXNjAcxALOhSQNEaDmK2UYEWNhw9+tZnFe6xL6058ZQBtAB6NPIUA1XlXld60/gtDJMmnZXqksSMGVfG110gdAJJV0iaNOsme9dHTIyqsGYM/2DB3QSqfQK9qPUgVlxBuZj+JVHEIZhpOWdaaf4cb5jbffP8AZjLAhEkSsTkASckFoOzpYA/FrtVZITE9afSZlgbifmZtBAjVh+000/pxlxFqkBX5zyn9JuSG7h9b0Lxx6n6q0QSThGGFeZoBiwEBLt+CvPECQGWHe5PKoxAjQZyf7EirMh1el9XWwueoh6OvwzSMoYIl1cPGelTDLVoJ14OtGcUmQAJHUNQ34pp+HWsQh97NUTBGesIpOvkCDczSrZIyJ0T9aNO5IWHUpowx4l5cVYkEgvtz2m4ijBQh4CdGxXMpmTUR0cPf9f43e/dv9lD4UEBsjX8Bmrnq9VnTTxZMGqsJAHchTtNi7MLKKQInE70GDmIL1zuhRnp/evw3q3jmAe9M/dHknrhDwUM4ME6eTod7hkZEkXoH1n9eNs9i+jRFepgG6tiPkTQJ0eXPetdB5DMBd4nvVBWZvwT7vFemKwQHUFnxFNo8ynnppNOSqQ8Jrlkel4q40HBRrig+6EegWSWdZX0NMWEN2MOF4SwyZ+0kFLHmZTLt9J96wY4SpdUH0MfWjxNoohkYwpHvVFJqu2HKc8Fis3WH9FSLlU4o1DE44i+7f7Sx0UE5gyxzo9a5SWKWERNwQE4qsQQzL1Gr5aeCBzi8SA470Y7Rl9lJ3owxjIh2wO6LBI9r9EeymdDyg7H9CNszQfiOhsI1Cpn0Fs226Mm0g9qdCMJZhobn0UrLBJYDk+YfRW0QloAgPOSO9eAkHCE5GoxEVJyLNxmgXIWjKD2apCVgiXQ4HirPvopKHLMRHM1GSSOEZK5Tl/fXWk5R8EKq8dKWOeoFMx2KtgqaqMvvUQ1hFpLLtOhVhR4RqChicub7t/tLWEIoRVc8JBjOKXaDQlyEwFCotQL2y964GJCZneUlooAGANCx/SjbPZvo1ClOdoBzh3iUmzAwD0SPcKdMHWxB9RotZEhrEJfR9KyUK3QViaisEzPAdY91DqqnMASp1anyjRFGBlGl9uvzO+ut+B2XWeY/XS0oa7NN0ojkSS/G737t/wCRY2wk7hFT1hK4hDCU9J+9kVixaVoFRgZ7AaKjiYINpsbuvzIkBzEs9HpTgEJGI000ThsItiWY4nEHaugIBiLIN152LH20qUhAG8M9q46ZAyIiKNkUrK1HoBCDqMc1fHYKETUSw6myDkdNTOtdb8DtsnBC3EhsRqSTDOEd4w9bNQJczROZCsLcgQomTqsG1CUliKyFNsUZ/wDHxkDflBNvDU7Vs/oMVmS9jPe8cSk/EiUIqTrRT2lC1uyB72WBkkV3JhorOgPwAqTVS7LTW7oXrFMC2iPhKY7V2VeezAofOtgX7jQ6+ZqnLZj9ke1B+UDQDQ/GZXSSpbjqPiqaH8zM+9PIoDx6LqXrNODPkA3CwPXX/wDCsaMJMA2umPEcnP8Arf/Z';
  JB._c258LogoBytes = function () {
    var b = JB._C258_LOGO_JPG, raw;
    try { raw = (global.atob ? global.atob(b) : Buffer.from(b, 'base64').toString('binary')); }
    catch (e) { return null; }
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  };

  // ── Reproduces the official NYS WCB Form C-258.1 (7-17) "Claimant's Record of Independent
  //    Job Search Efforts". The official PDF is a dynamic Adobe XFA (LiveCycle) form that no
  //    non-Adobe engine can render, so the layout below is rebuilt 1:1 from the government's
  //    own XFA template geometry (page/field coordinates, captions, rule lines) and the data
  //    is stamped onto it. 4 job-search blocks per sheet; the claimant header repeats on each
  //    sheet ("Use additional sheets as needed"). ──
  JB._buildPacketPdf = function (ledger, vr, profile) {
    var P = global.PDFLib, rgb = P.rgb;
    return P.PDFDocument.create().then(function (doc) {
      return doc.embedFont(P.StandardFonts.Helvetica).then(function (font) {
        return doc.embedFont(P.StandardFonts.HelveticaBold).then(function (bold) {
          var logoBytes = JB._c258LogoBytes();
          var logoP = logoBytes ? doc.embedJpg(logoBytes).catch(function () { return null; }) : Promise.resolve(null);
          return logoP.then(function (logo) {
            var MM = 2.834645669, PAGE_W = 612, PAGE_H = 792, X0 = 18, TOPOFF = 18;
            var CW = 203.4 * MM; // content width (mm 203.4)
            function yTop(mm) { return PAGE_H - TOPOFF - mm * MM; } // pdf-y of a point 'mm' below content top
            var ink = rgb(0.09, 0.11, 0.16), gray = rgb(0.42, 0.45, 0.5),
                boxc = rgb(0.62, 0.64, 0.68), hard = rgb(0.32, 0.35, 0.4);
            function san(s) {
              return String(s == null ? '' : s)
                .replace(/ /g, ' ').replace(/[‘’]/g, "'")
                .replace(/[“”]/g, '"').replace(/[–—]/g, '-');
            }
            function dtext(pg, s, x, topY, size, f, color) {
              s = san(s);
              var o = { x: x, y: topY - size * 0.80, size: size, font: f || font, color: color || ink };
              try { pg.drawText(s, o); }
              catch (e) { try { pg.drawText(s.replace(/[^\x20-\x7E]/g, '?'), o); } catch (e2) {} }
            }
            function dline(pg, x0, y, x1, thick, color) {
              pg.drawLine({ start: { x: x0, y: y }, end: { x: x1, y: y }, thickness: thick || 0.7, color: color || boxc });
            }
            function vline(pg, x, y0, y1, thick, color) {
              pg.drawLine({ start: { x: x, y: y0 }, end: { x: x, y: y1 }, thickness: thick || 0.5, color: color || boxc });
            }
            function drect(pg, x, topY, w, hpt, color, thick) {
              pg.drawRectangle({ x: x, y: topY - hpt, width: w, height: hpt, borderColor: color || hard, borderWidth: thick || 0.9 });
            }
            function fit(s, maxW, size, f) {
              f = f || font; s = san(s); if (maxW <= 0) return '';
              if (f.widthOfTextAtSize(s, size) <= maxW || s.length <= 1) return s;
              while (s.length > 1 && f.widthOfTextAtSize(s + '…', size) > maxW) s = s.slice(0, -1);
              return s + '…';
            }
            function wrap(s, maxW, size, f) {
              f = f || font; s = san(s); var w = s.split(/\s+/), lines = [], cur = '';
              for (var i = 0; i < w.length; i++) {
                var t = cur ? cur + ' ' + w[i] : w[i];
                if (f.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = w[i]; } else cur = t;
              }
              if (cur) lines.push(cur); return lines;
            }
            function methodLetter(m) {
              // The form defines single-letter codes in its legend (P/T/M/O); the cell is narrow.
              return m === 'in_person' ? 'P' : m === 'phone' ? 'T'
                : m === 'mail' ? 'M' : (m === 'email' || m === 'online') ? 'O'
                : (m ? String(m).charAt(0).toUpperCase() : '');
            }
            function resultStr(r) {
              var b = [r.response_received ? ('Response received' + (r.response_date ? (' ' + _dateStr(r.response_date)) : '')) : 'No response yet'];
              if (r.notes) b.push(String(r.notes));
              return b.join(' — ');
            }

            // Claimant identity (split into the form's Last / First / MI fields)
            var fullName = String((profile && (profile.full_name || profile.display_name)) || '').trim();
            var np = fullName ? fullName.split(/\s+/) : [];
            var nLast = np.length ? np[np.length - 1] : '', nFirst = np.length > 1 ? np[0] : '', nMI = np.length > 2 ? np[1].charAt(0) : '';
            if (np.length === 1) { nLast = np[0]; nFirst = ''; }
            var caseNo = (profile && profile.wcb_case_number) || '';
            var stats = JB.computeStats(ledger);
            var rows = ledger || [];
            var periodStart = stats.firstDate ? _dateStr(stats.firstDate) : '';
            var periodEnd = stats.lastDate ? _dateStr(stats.lastDate) : '';

            // Field geometry pulled verbatim from the XFA template (mm, relative to each band).
            var BX = X0 + 4.03 * MM, BTOP = 20.15;
            var CLAIMANT = [
              ['Last Name:', 0, 1.953, 68.094, 5.842, function () { return nLast; }],
              ['First Name:', 68.872, 1.953, 68.497, 5.842, function () { return nFirst; }],
              ['MI:', 138.115, 1.953, 9.525, 5.842, function () { return nMI; }],
              ['WCB Case #:', 152.441, 1.953, 50.759, 5.842, function () { return caseNo; }],
              ['For the Period:', 0, 8.637, 56.961, 5.842, function () { return periodStart; }],
              ['to:', 57.741, 8.637, 38.997, 5.842, function () { return periodEnd; }]
            ];
            var ROWF = [
              ['DateContact', 'Date of Contact:', 0, 0, 69.848, 6.35],
              ['MethodContact', 'Method of Contact*:', 70.818, 0, 40.516, 6.35],
              ['PositionAppliedFor', 'Position Applied For:', 113.03, 0, 90.376, 6.35],
              ['EmployerName', 'Employer Name:', 0, 6.352, 203.192, 6.35],
              ['EmployerAddr1', 'Mailing Address:', 0, 12.92, 203.192, 6.35],
              ['ContactName', 'Name and Title of Person Contacted:', 0, 19.42, 141.636, 6.35],
              ['ContactDaytimePhone', 'Daytime Phone #:', 142.13, 19.42, 60.954, 6.35],
              ['EmployerWebsite', 'Employer Website:', 0, 25.708, 120.201, 6.35],
              ['ConfirmationNo', 'Confirmation #:', 120.664, 25.708, 82.42, 6.35],
              ['Result', 'Result:', 0, 32.168, 203.084, 13.07]
            ];
            var ROW_TOP0 = 55.701, ROW_H = 49.048, RPP = 4;
            function rowVal(name, r) {
              switch (name) {
                case 'DateContact': return _dateStr(r.date_applied);
                case 'MethodContact': return methodLetter(r.apply_method);
                case 'PositionAppliedFor': return r.job_title;
                case 'EmployerName': return r.employer_name;
                case 'EmployerAddr1': return r.employer_address;
                case 'ContactName': return r.contact_name;
                case 'ContactDaytimePhone': return r.contact_phone;
                case 'EmployerWebsite': return r.employer_website || '';
                case 'ConfirmationNo': return r.confirmation_no || r.confirmation || '';
                case 'Result': return resultStr(r);
              }
              return '';
            }

            function drawChrome(pg) {
              // Title band: logo + right-aligned title + heavy rule
              if (logo) {
                var lw = 45.086 * MM, lh = 12.709 * MM;
                pg.drawImage(logo, { x: X0 + 0.15 * MM, y: yTop(0.369) - lh, width: lw, height: lh });
              }
              var tt = "CLAIMANT'S RECORD OF INDEPENDENT JOB SEARCH EFFORTS";
              var tw = bold.widthOfTextAtSize(tt, 12), tRight = X0 + (45.687 + 157.323) * MM;
              dtext(pg, tt, tRight - tw, yTop(11.2), 12, bold, ink);
              dline(pg, X0, yTop(14.172), X0 + 203.201 * MM, 1.1, ink);
              // Claimant band
              for (var c = 0; c < CLAIMANT.length; c++) {
                var f = CLAIMANT[c], x = BX + f[1] * MM, topY = yTop(BTOP + f[2]), cap = f[0], fw = f[3] * MM, fh = f[4] * MM;
                dtext(pg, cap, x, topY + 1, 9, font, gray);
                var cw = font.widthOfTextAtSize(san(cap), 9);
                dline(pg, x + cw + 4, topY - fh + 2, x + fw - 2, 0.6, boxc);
                var v = f[5]();
                if (v) dtext(pg, fit(v, fw - cw - 9, 9, font), x + cw + 6, topY + 0.5, 9, font, ink);
              }
              // Instructions (verbatim) + method legend
              var instr = 'Use this form to record all of your independent job search efforts. In the space provided above you should indicate the period of time covered by this form. Use additional sheets as needed. You may be asked to present documentation to support your work search efforts at a hearing. Attach copies of resumes, inquiry letters, email communications and applications completed in connection with these job search efforts.';
              var il = wrap(instr, CW, 9, font);
              for (var k = 0; k < il.length; k++) dtext(pg, il[k], BX, yTop(BTOP + 15.4) - k * 11, 9, font, ink);
              dtext(pg, '* Method of Contact: P for in person; T for telephone; M for mail; or O for online or email.', BX, yTop(BTOP + 29.953), 9, font, ink);
              // 4 blank job-search blocks
              for (var i = 0; i < RPP; i++) {
                var rtop = ROW_TOP0 + i * ROW_H;
                drect(pg, X0, yTop(rtop) + 1.2 * MM, CW, 46.6 * MM, hard, 0.9);
                for (var j = 0; j < ROWF.length; j++) {
                  var rf = ROWF[j], rx = X0 + rf[2] * MM, ry = yTop(rtop + rf[3]);
                  dtext(pg, rf[1], rx + 2, ry + 1, 8.5, font, gray);
                  if (rf[3] > 0) dline(pg, rx, ry, rx + rf[4] * MM, 0.5, boxc);
                }
                vline(pg, X0 + 70.818 * MM, yTop(rtop) - 6.35 * MM, yTop(rtop), 0.5, boxc);
                vline(pg, X0 + 113.03 * MM, yTop(rtop) - 6.35 * MM, yTop(rtop), 0.5, boxc);
              }
              // Footer
              dtext(pg, 'C-258.1 (7-17)', X0, yTop(266.7), 8, font, gray);
              dtext(pg, 'www.wcb.ny.gov', X0 + CW - font.widthOfTextAtSize('www.wcb.ny.gov', 8), yTop(266.7), 8, font, gray);
            }

            function fillRow(pg, i, r) {
              var rtop = ROW_TOP0 + i * ROW_H;
              for (var j = 0; j < ROWF.length; j++) {
                var rf = ROWF[j], name = rf[0], cap = rf[1];
                var rx = X0 + rf[2] * MM, ry = yTop(rtop + rf[3]), fw = rf[4] * MM;
                var cw = font.widthOfTextAtSize(san(cap), 8.5);
                var vx = rx + 2 + cw + 6, vmax = (rx + fw) - vx - 2;
                var val = rowVal(name, r);
                if (!val) continue;
                if (name === 'Result') {
                  var ls = wrap(val, vmax, 8.5, font).slice(0, 3);
                  for (var li = 0; li < ls.length; li++) dtext(pg, ls[li], vx, ry + 0.5 - li * 10, 8.5, font, ink);
                } else {
                  dtext(pg, fit(val, vmax, 9, font), vx, ry, 9, font, ink);
                }
              }
            }

            var N = Math.max(1, Math.ceil(rows.length / RPP));
            for (var pi = 0; pi < N; pi++) {
              var page = doc.addPage([PAGE_W, PAGE_H]);
              drawChrome(page);
              for (var ri = 0; ri < RPP; ri++) {
                var idx = pi * RPP + ri;
                if (idx >= rows.length) break;
                fillRow(page, ri, rows[idx]);
              }
              var pn = 'Page ' + (pi + 1) + ' of ' + N;
              dtext(page, pn, X0 + CW / 2 - font.widthOfTextAtSize(pn, 8) / 2, yTop(266.7), 8, font, gray);
            }
            return doc.save();
          });
        });
      });
    });
  };

  // ════════════════════════════════════════════════════════════════════════
  // SCREEN
  // ════════════════════════════════════════════════════════════════════════
  function renderJobBuddy() {
    var H = _hh();
    var root = H('div', { className: 'cd-jb' });
    var state = { tab: 'restrictions' };

    root.appendChild(H('header', { className: 'cd-jb-hd' }, [
      H('div', { className: 'cd-jb-eyebrow' }, 'Free Beta · The Comp Desk'),
      H('h1', { className: 'cd-jb-title' }, ['Job Buddy ', H('span', { className: 'cd-jb-beta' }, 'BETA')]),
      H('p', { className: 'cd-jb-sub' },
        'Find work within your medical restrictions and keep a hearing-ready record of your job search. You apply on the employer’s site — we never apply for you.')
    ]));

    var tabs = H('div', { className: 'cd-jb-tabs' });
    var TABS = [
      { k: 'restrictions', label: 'My Restrictions' },
      { k: 'feed', label: 'Job Feed' },
      { k: 'log', label: 'Search Log (C-258.1)' }
    ];
    var body = H('div', { className: 'cd-jb-body' });
    function setTab(k) { state.tab = k; paintTabs(); paintBody(); }
    function paintTabs() {
      tabs.innerHTML = '';
      TABS.forEach(function (t) {
        tabs.appendChild(H('button', {
          className: 'cd-jb-tab' + (state.tab === t.k ? ' is-active' : ''),
          onclick: function () { setTab(t.k); }
        }, t.label));
      });
    }
    function paintBody() {
      body.innerHTML = '';
      if (state.tab === 'restrictions') renderRestrictions(body);
      else if (state.tab === 'feed') renderFeed(body);
      else renderLog(body);
    }
    paintTabs(); root.appendChild(tabs); root.appendChild(body); paintBody();
    root.appendChild(H('p', { className: 'cd-jb-disclaimer' }, DISCLAIMER));
    return root;
  }

  // ─── Restrictions tab ─────────────────────────────────────────────────────
  function renderRestrictions(mount) {
    var H = _hh();
    var loading = H('div', { className: 'cd-jb-loading' }, 'Loading your restrictions…');
    mount.appendChild(loading);

    JB.getRestriction().then(function (rp) {
      mount.innerHTML = '';
      var draft = {
        lifting_limit_lbs: rp ? rp.lifting_limit_lbs : '',
        stand_minutes: rp ? rp.stand_minutes : '',
        sit_minutes: rp ? rp.sit_minutes : '',
        bend_twist: rp ? rp.bend_twist : '',
        overhead_reach: rp ? rp.overhead_reach : '',
        can_drive: rp ? rp.can_drive : null,
        other_restrictions: rp ? rp.other_restrictions : '',
        source: rp ? rp.source : 'manual',
        confirmed_by_user: false
      };

      var card = H('section', { className: 'cd-jb-card' });
      card.appendChild(H('h2', { className: 'cd-jb-card-hd' }, 'Your work restrictions'));
      card.appendChild(H('p', { className: 'cd-jb-help' },
        'These come from your IME or C-4.3. We use them to match jobs you can safely do. Review and confirm before saving — we never match against unconfirmed restrictions.'));

      // PDF ingest affordance
      var upWrap = H('div', { className: 'cd-jb-upload' });
      var fileIn = H('input', { type: 'file', accept: 'application/pdf', style: { display: 'none' } });
      var upBtn = H('button', { className: 'cd-jb-btn ghost', onclick: function () { fileIn.click(); } }, '📄 Upload IME / C-4.3 to auto-fill');
      var upStatus = H('span', { className: 'cd-jb-upstatus' }, '');
      fileIn.onchange = function () {
        var f = fileIn.files && fileIn.files[0]; if (!f) return;
        upStatus.textContent = 'Reading ' + f.name + '…';
        var reader = new FileReader();
        reader.onload = function () {
          var b64 = String(reader.result).split(',')[1] || '';
          JB.extractFromPdf(b64, f.name).then(function (resp) {
            var ex = resp && resp.fields ? resp.fields : {};
            ['lifting_limit_lbs', 'stand_minutes', 'sit_minutes', 'bend_twist', 'overhead_reach', 'other_restrictions'].forEach(function (k) {
              if (ex[k] !== undefined && ex[k] !== null) draft[k] = ex[k];
            });
            if (ex.can_drive !== undefined) draft.can_drive = ex.can_drive;
            draft.source = (resp && resp.source) || 'ime';
            upStatus.textContent = 'Extracted — please review every field, then confirm.';
            rebuildForm();
          }).catch(function (e) {
            upStatus.textContent = 'Couldn’t read that PDF. Enter your restrictions manually below.';
          });
        };
        reader.readAsDataURL(f);
      };
      upWrap.appendChild(upBtn); upWrap.appendChild(fileIn); upWrap.appendChild(upStatus);
      card.appendChild(upWrap);

      var formWrap = H('div', { className: 'cd-jb-form' });
      card.appendChild(formWrap);
      mount.appendChild(card);

      function num(v) { var n = parseInt(v, 10); return isNaN(n) ? null : n; }
      function field(label, key, suffix, ph) {
        var inp = H('input', { className: 'cd-jb-input', type: 'number', value: (draft[key] == null ? '' : draft[key]), placeholder: ph || '' });
        inp.oninput = function () { draft[key] = num(inp.value); draft.confirmed_by_user = false; syncSave(); };
        return H('label', { className: 'cd-jb-fld' }, [H('span', { className: 'cd-jb-fld-lbl' }, label), H('div', { className: 'cd-jb-fld-in' }, [inp, suffix ? H('span', { className: 'cd-jb-fld-suf' }, suffix) : null])]);
      }
      function selectFld(label, key, opts) {
        var sel = H('select', { className: 'cd-jb-input' });
        opts.forEach(function (o) {
          var op = H('option', { value: o.v }, o.l); if (String(draft[key]) === String(o.v)) op.selected = true; sel.appendChild(op);
        });
        sel.onchange = function () { draft[key] = sel.value || null; draft.confirmed_by_user = false; syncSave(); };
        return H('label', { className: 'cd-jb-fld' }, [H('span', { className: 'cd-jb-fld-lbl' }, label), sel]);
      }

      var confirmBox, saveBtn, saveMsg;
      function rebuildForm() {
        formWrap.innerHTML = '';
        var grid = H('div', { className: 'cd-jb-grid' });
        grid.appendChild(field('Lifting limit', 'lifting_limit_lbs', 'lbs', 'e.g. 10'));
        grid.appendChild(field('Standing tolerance', 'stand_minutes', 'min', 'e.g. 20'));
        grid.appendChild(field('Sitting tolerance', 'sit_minutes', 'min', 'e.g. 60'));
        var freq = [{ v: '', l: '—' }, { v: 'none', l: 'None' }, { v: 'occasional', l: 'Occasional' }, { v: 'frequent', l: 'Frequent' }, { v: 'unrestricted', l: 'Unrestricted' }];
        grid.appendChild(selectFld('Bend / twist', 'bend_twist', freq));
        grid.appendChild(selectFld('Overhead reach', 'overhead_reach', freq));
        grid.appendChild(selectFld('Can drive?', 'can_drive', [{ v: '', l: '—' }, { v: 'true', l: 'Yes' }, { v: 'false', l: 'No' }]));
        formWrap.appendChild(grid);

        var other = H('textarea', { className: 'cd-jb-input cd-jb-ta', placeholder: 'Anything else your doctor restricted (e.g. no repetitive bending, no ladders)…' });
        other.value = draft.other_restrictions || '';
        other.oninput = function () { draft.other_restrictions = other.value; draft.confirmed_by_user = false; syncSave(); };
        formWrap.appendChild(H('label', { className: 'cd-jb-fld' }, [H('span', { className: 'cd-jb-fld-lbl' }, 'Other restrictions'), other]));

        var cbId = 'cd-jb-confirm';
        confirmBox = H('input', { type: 'checkbox', id: cbId });
        confirmBox.checked = !!draft.confirmed_by_user;
        confirmBox.onchange = function () { draft.confirmed_by_user = confirmBox.checked; syncSave(); };
        formWrap.appendChild(H('label', { className: 'cd-jb-confirm', htmlFor: cbId }, [confirmBox, H('span', {}, 'I confirm these are my current medical work restrictions.')]));

        saveBtn = H('button', { className: 'cd-jb-btn primary' }, 'Save restrictions');
        saveMsg = H('span', { className: 'cd-jb-savemsg' }, '');
        saveBtn.onclick = function () {
          // Cast can_drive string -> bool/null
          var cd = draft.can_drive; if (cd === 'true') cd = true; else if (cd === 'false') cd = false; else if (cd !== true && cd !== false) cd = null;
          var payload = {
            lifting_limit_lbs: draft.lifting_limit_lbs, stand_minutes: draft.stand_minutes, sit_minutes: draft.sit_minutes,
            bend_twist: draft.bend_twist || null, overhead_reach: draft.overhead_reach || null, can_drive: cd,
            other_restrictions: draft.other_restrictions || null, source: draft.source || 'manual',
            confirmed_by_user: !!draft.confirmed_by_user
          };
          saveBtn.disabled = true; saveMsg.textContent = 'Saving…';
          JB.saveRestriction(payload).then(function () {
            saveMsg.textContent = draft.confirmed_by_user ? 'Saved & confirmed. Your Job Feed is ready.' : 'Saved (not yet confirmed).';
            saveBtn.disabled = false;
          }).catch(function (e) { saveMsg.textContent = (e && e.message) || 'Save failed.'; saveBtn.disabled = false; });
        };
        var actions = H('div', { className: 'cd-jb-actions' }, [saveBtn, saveMsg]);
        formWrap.appendChild(actions);
        syncSave();
      }
      function syncSave() {
        if (saveBtn) saveBtn.disabled = false;
      }
      rebuildForm();
    }).catch(function () {
      mount.innerHTML = '';
      mount.appendChild(_hh()('p', { className: 'cd-jb-help' }, 'Sign in to set up your work restrictions.'));
    });
  }

  // ─── Feed tab ─────────────────────────────────────────────────────────────
  function renderFeed(mount) {
    var H = _hh();
    mount.appendChild(H('div', { className: 'cd-jb-loading' }, 'Loading your job feed…'));
    JB.getFeed().then(function (tags) {
      mount.innerHTML = '';
      var bar = H('div', { className: 'cd-jb-feedbar' });
      var refreshBtn = H('button', { className: 'cd-jb-btn ghost' }, '↻ Refresh feed');
      var status = H('span', { className: 'cd-jb-upstatus' }, '');
      refreshBtn.onclick = function () {
        status.textContent = 'Matching the newest listings…';
        JB.matchNow().then(function () { renderFeedReload(mount); })
          .catch(function (e) { status.textContent = (e && e.message) || 'Nothing new to match yet.'; });
      };
      bar.appendChild(refreshBtn); bar.appendChild(status);
      // External search (deep-link only — we display nothing scraped from these)
      var ext = H('div', { className: 'cd-jb-ext' }, [
        H('span', { className: 'cd-jb-ext-lbl' }, 'Also search:'),
        H('button', { className: 'cd-jb-chip', onclick: function () { _searchExternal('indeed'); } }, 'Indeed'),
        H('button', { className: 'cd-jb-chip', onclick: function () { _searchExternal('linkedin'); } }, 'LinkedIn')
      ]);
      bar.appendChild(ext);
      mount.appendChild(bar);

      if (!tags.length) {
        mount.appendChild(H('div', { className: 'cd-jb-empty' }, [
          H('div', { className: 'cd-jb-empty-icon' }, '🎯'),
          H('h3', {}, 'Your matched feed is being built'),
          H('p', {}, 'Confirm your restrictions, then we surface jobs within your limits each morning. Tap “Refresh feed” to match the newest listings now, or search Indeed / LinkedIn directly.')
        ]));
        return;
      }
      tags.forEach(function (t) { mount.appendChild(_feedCard(t)); });
    });
  }
  function renderFeedReload(mount) { mount.innerHTML = ''; renderFeed(mount); }

  function _searchExternal(which) {
    var p = CD.currentProfile || {};
    var q = encodeURIComponent((p.occupation || 'jobs') + ' ' + (p.home_city || 'New York NY'));
    if (which === 'linkedin') _openExternal('https://www.linkedin.com/jobs/search/?keywords=' + q);
    else _openExternal('https://www.indeed.com/jobs?q=' + q);
  }

  function _feedCard(t) {
    var H = _hh();
    var l = t.job_listings || {};
    var re = t.re_estimate || {};
    var fit = t.restriction_aww_fit_score || {};
    var flags = Array.isArray(t.red_flags) ? t.red_flags : [];
    var card = H('div', { className: 'cd-jb-job' });

    var head = H('div', { className: 'cd-jb-job-head' }, [
      H('div', {}, [
        H('div', { className: 'cd-jb-job-title' }, l.title || 'Position'),
        H('div', { className: 'cd-jb-job-meta' }, [l.employer, l.location].filter(Boolean).join(' · ') || '')
      ]),
      H('span', { className: 'cd-jb-fit cd-jb-fit-' + (fit.score || 'unknown') }, (fit.label || 'Restriction + AWW Fit') + ': ' + (fit.score || 'unknown'))
    ]);
    card.appendChild(head);
    if (fit.rationale) card.appendChild(H('div', { className: 'cd-jb-job-rat' }, fit.rationale));

    // Transparent RE estimate
    var reLine = H('div', { className: 'cd-jb-re' });
    if (re.est_re_benefit_weekly != null) {
      reLine.appendChild(H('span', {}, [H('strong', {}, _money(re.est_re_benefit_weekly) + '/wk'), ' est. reduced-earnings benefit']));
      reLine.appendChild(H('span', { className: 'cd-jb-re-calc' }, '⅔ × (AWW ' + _money(re.aww) + ' − est. pay ' + _money(re.job_weekly_earnings) + '/wk)' + (re.salary_is_predicted ? ' · pay estimated' : '')));
    } else {
      reLine.appendChild(H('span', { className: 'cd-jb-re-calc' }, 'Pay not stated — reduced-earnings benefit can’t be estimated for this listing.'));
    }
    card.appendChild(reLine);

    if (flags.length) {
      var fl = H('ul', { className: 'cd-jb-flags' });
      flags.forEach(function (f) { fl.appendChild(H('li', {}, f)); });
      card.appendChild(fl);
    }

    var actions = H('div', { className: 'cd-jb-job-actions' });
    var apply = H('button', { className: 'cd-jb-btn primary', onclick: function () { _openExternal(l.apply_url); } }, 'Apply on employer site ↗');
    if (!l.apply_url) apply.disabled = true;
    var logged = H('button', { className: 'cd-jb-btn', onclick: function () {
      logged.disabled = true; logged.textContent = 'Logging…';
      JB.logFromListing(l).then(function () { logged.textContent = '✓ Added to your C-258.1 log'; })
        .catch(function (e) { logged.textContent = (e && e.message) || 'Failed'; logged.disabled = false; });
    } }, 'I applied to this');
    actions.appendChild(apply); actions.appendChild(logged);
    card.appendChild(actions);
    return card;
  }

  // ─── Search Log tab (C-258.1) ─────────────────────────────────────────────
  function renderLog(mount) {
    var H = _hh();
    mount.appendChild(H('div', { className: 'cd-jb-loading' }, 'Loading your search log…'));
    JB.listLedger().then(function (rows) {
      mount.innerHTML = '';
      var stats = JB.computeStats(rows);

      var statsBar = H('div', { className: 'cd-jb-stats' }, [
        _stat(stats.total, 'applications'),
        _stat(stats.responses, 'responses'),
        _stat(stats.days || '—', 'days of search')
      ]);
      mount.appendChild(statsBar);

      var packetBtn = H('button', { className: 'cd-jb-btn primary cd-jb-packet' }, '📄 Generate LMA Packet (hearing exhibit)');
      packetBtn.onclick = function () {
        packetBtn.disabled = true; var old = packetBtn.textContent; packetBtn.textContent = 'Building PDF…';
        JB.generateLMAPacket().then(function () { packetBtn.textContent = old; packetBtn.disabled = false; })
          .catch(function (e) { _toast((e && e.message) || 'PDF failed'); packetBtn.textContent = old; packetBtn.disabled = false; });
      };
      mount.appendChild(packetBtn);

      // ACCES-VR status (feeds the packet)
      mount.appendChild(_vrRow());

      // Add manual (off-platform) application
      mount.appendChild(_addLedgerForm(function () { renderLogReload(mount); }));

      // Existing rows
      if (!rows.length) {
        mount.appendChild(H('div', { className: 'cd-jb-empty' }, [
          H('div', { className: 'cd-jb-empty-icon' }, '📝'),
          H('h3', {}, 'No applications logged yet'),
          H('p', {}, 'Log every job you apply to — from the feed (“I applied to this”) or by hand above. This becomes your hearing-ready C-258.1 record.')
        ]));
      } else {
        var list = H('div', { className: 'cd-jb-ledger' });
        rows.forEach(function (r) { list.appendChild(_ledgerRow(r, function () { renderLogReload(mount); })); });
        mount.appendChild(list);
      }
    });
  }
  function renderLogReload(mount) { mount.innerHTML = ''; renderLog(mount); }
  function _stat(n, label) { var H = _hh(); return H('div', { className: 'cd-jb-stat' }, [H('div', { className: 'cd-jb-stat-n' }, String(n)), H('div', { className: 'cd-jb-stat-l' }, label)]); }

  function _vrRow() {
    var H = _hh();
    var wrap = H('div', { className: 'cd-jb-vr' });
    var sel = H('select', { className: 'cd-jb-input' });
    [['not_enrolled', 'Not enrolled'], ['referred', 'Referred'], ['applied', 'Applied'], ['enrolled', 'Enrolled'], ['active', 'Active'], ['completed', 'Completed'], ['closed', 'Closed']]
      .forEach(function (o) { sel.appendChild(H('option', { value: o[0] }, o[1])); });
    var msg = H('span', { className: 'cd-jb-savemsg' }, '');
    JB.getEnrollment().then(function (e) { if (e && e.status) sel.value = e.status; });
    sel.onchange = function () { msg.textContent = 'Saving…'; JB.saveEnrollment(sel.value).then(function () { msg.textContent = 'Saved'; }).catch(function () { msg.textContent = 'Failed'; }); };
    wrap.appendChild(H('span', { className: 'cd-jb-fld-lbl' }, 'ACCES-VR (vocational rehab) status'));
    wrap.appendChild(sel); wrap.appendChild(msg);
    return wrap;
  }

  function _addLedgerForm(onAdd) {
    var H = _hh();
    var d = { date_applied: _todayISO(), employer_name: '', employer_address: '', contact_name: '', contact_phone: '', job_title: '', apply_method: 'online', notes: '' };
    var det = H('details', { className: 'cd-jb-addform' });
    det.appendChild(H('summary', {}, '+ Add an application you made off-platform'));
    function inp(key, ph, type) { var i = H('input', { className: 'cd-jb-input', type: type || 'text', value: d[key], placeholder: ph }); i.oninput = function () { d[key] = i.value; }; return i; }
    var method = H('select', { className: 'cd-jb-input' });
    [['online', 'Online'], ['in_person', 'In person'], ['phone', 'Phone'], ['email', 'Email']].forEach(function (o) { method.appendChild(H('option', { value: o[0] }, o[1])); });
    method.onchange = function () { d.apply_method = method.value; };
    var grid = H('div', { className: 'cd-jb-grid' }, [
      H('label', { className: 'cd-jb-fld' }, [H('span', { className: 'cd-jb-fld-lbl' }, 'Date applied'), inp('date_applied', '', 'date')]),
      H('label', { className: 'cd-jb-fld' }, [H('span', { className: 'cd-jb-fld-lbl' }, 'Employer'), inp('employer_name', 'Employer name')]),
      H('label', { className: 'cd-jb-fld' }, [H('span', { className: 'cd-jb-fld-lbl' }, 'Position'), inp('job_title', 'Job title')]),
      H('label', { className: 'cd-jb-fld' }, [H('span', { className: 'cd-jb-fld-lbl' }, 'Method'), method]),
      H('label', { className: 'cd-jb-fld' }, [H('span', { className: 'cd-jb-fld-lbl' }, 'Contact'), inp('contact_name', 'Contact name')]),
      H('label', { className: 'cd-jb-fld' }, [H('span', { className: 'cd-jb-fld-lbl' }, 'Phone'), inp('contact_phone', 'Contact phone')])
    ]);
    det.appendChild(grid);
    det.appendChild(H('label', { className: 'cd-jb-fld' }, [H('span', { className: 'cd-jb-fld-lbl' }, 'Address / notes'), inp('employer_address', 'Employer address')]));
    var btn = H('button', { className: 'cd-jb-btn primary' }, 'Add to log');
    var msg = H('span', { className: 'cd-jb-savemsg' }, '');
    btn.onclick = function () {
      if (!d.employer_name && !d.job_title) { msg.textContent = 'Enter at least an employer or position.'; return; }
      btn.disabled = true; msg.textContent = 'Adding…';
      JB.addLedger({ date_applied: d.date_applied || null, employer_name: d.employer_name || null, employer_address: d.employer_address || null, contact_name: d.contact_name || null, contact_phone: d.contact_phone || null, job_title: d.job_title || null, apply_method: d.apply_method, response_received: false, notes: d.notes || null })
        .then(function () { if (onAdd) onAdd(); }).catch(function (e) { msg.textContent = (e && e.message) || 'Failed'; btn.disabled = false; });
    };
    det.appendChild(H('div', { className: 'cd-jb-actions' }, [btn, msg]));
    return det;
  }

  function _ledgerRow(r, onChange) {
    var H = _hh();
    var row = H('div', { className: 'cd-jb-lrow' });
    row.appendChild(H('div', { className: 'cd-jb-lrow-main' }, [
      H('div', { className: 'cd-jb-lrow-top' }, [
        H('strong', {}, r.job_title || r.employer_name || 'Application'),
        H('span', { className: 'cd-jb-lrow-date' }, _dateStr(r.date_applied))
      ]),
      H('div', { className: 'cd-jb-lrow-sub' }, [r.employer_name, r.apply_method].filter(Boolean).join(' · '))
    ]));
    var respWrap = H('label', { className: 'cd-jb-resp' });
    var resp = H('input', { type: 'checkbox' }); resp.checked = !!r.response_received;
    resp.onchange = function () { JB.updateLedger(r.id, { response_received: resp.checked, response_date: resp.checked ? _todayISO() : null }); };
    respWrap.appendChild(resp); respWrap.appendChild(H('span', {}, 'Response'));
    row.appendChild(respWrap);
    var del = H('button', { className: 'cd-jb-del', title: 'Remove', onclick: function () { JB.removeLedger(r.id).then(function () { if (onChange) onChange(); }); } }, '×');
    row.appendChild(del);
    return row;
  }

  CD.renderJobBuddy = renderJobBuddy;
})(typeof window !== 'undefined' ? window : this);
