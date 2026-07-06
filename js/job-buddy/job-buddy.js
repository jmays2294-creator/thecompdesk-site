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

  // Base URL of this script's own folder — used to fetch bundled form-template assets so they
  // resolve correctly whether the module loads at the app root or under the website /dashboard/ mount.
  var _ASSET_BASE = (function () {
    try { var s = document.currentScript && document.currentScript.src; if (s) return s.replace(/[?#].*$/, '').replace(/[^/]*$/, ''); }
    catch (e) {}
    return 'js/job-buddy/';
  })();

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

  // ─── Anonymous (device-local) store ─────────────────────────────────────────
  // Job Buddy is FREE and usable without an account. A guest's data lives ONLY on
  // this device (localStorage) and is never persisted server-side; signing in
  // switches every JB.* helper back to the RLS-backed account tables. Restrictions
  // share the wizard's device record (jb_voc_profile_v1) so the Restrictions tab
  // and the Work-Profile wizard stay in sync; the C-258.1 log and ACCES-VR status
  // get their own local keys.
  var _LS = { ledger: 'cd_jb_ledger_v1', enroll: 'cd_jb_enroll_v1', wizard: 'jb_voc_profile_v1' };
  function _lsGet(k, dflt) { try { var v = global.localStorage.getItem(k); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; } }
  function _lsSet(k, v) { try { global.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function _localId() { return 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function _localWizProfile() {
    try { if (CD.JobBuddyWizard && CD.JobBuddyWizard.loadLocal) return CD.JobBuddyWizard.loadLocal() || _lsGet(_LS.wizard, null); }
    catch (e) {}
    return _lsGet(_LS.wizard, null);
  }
  function _localRestriction() {
    var l = _localWizProfile();
    if (!l || !l.rest) return null;
    // confirmed_by_user is stored in the local record (the wizard/tab only write it
    // after the user confirms); never assume confirmation.
    return Object.assign({ source: 'manual' }, l.rest, { confirmed_by_user: l.rest.confirmed_by_user === true, user_id: null });
  }
  function _saveLocalRestriction(fields) {
    var l = _localWizProfile() || {};
    l.rest = Object.assign({}, l.rest, fields);
    l.saved_at = new Date().toISOString();
    _lsSet(_LS.wizard, l);
    return _localRestriction();
  }

  // Persistent "sign in to save" banner shown on guest surfaces. Returns null when
  // signed in (nothing to prompt).
  function _anonBanner(msg) {
    if (_loggedIn()) return null;
    var H = _hh();
    var b = H('div', { className: 'cd-jb-anonbar', style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', justifyContent: 'space-between', margin: '0 0 14px', padding: '10px 14px', borderRadius: '12px', background: 'var(--skin-accent-soft,rgba(37,99,235,.08))', color: 'var(--skin-text,#1b2330)', fontSize: '13px', lineHeight: '1.4' } }, [
      H('span', {}, msg || 'You’re not signed in — everything here stays on this device only.'),
      H('button', { className: 'cd-jb-btn ghost', type: 'button', style: { flex: '0 0 auto' }, onclick: function () { try { if (CD.showAuth) CD.showAuth('Create a free account to save your Job Buddy data'); } catch (e) {} } }, 'Sign in to save')
    ]);
    return b;
  }

  // Worker's pre-injury AWW + the statutory PPD max for their DOA (from calc-core).
  // `override` lets the Feed tab supply AWW/DOA inline (entered there, not saved to the
  // profile) so a worker isn't forced into the profile editor just to estimate benefits.
  function _awwAndPpd(override) {
    var p = CD.currentProfile || {};
    var awwSrc = (override && override.aww != null && override.aww !== '') ? override.aww : p.current_aww;
    var doaSrc = (override && override.doa) ? override.doa : p.doa;
    var aww = parseFloat(awwSrc);
    var ppd = (CD.Calc && doaSrc) ? CD.Calc.maxRateForDOA(doaSrc) : 0;
    return { aww: (aww > 0 ? aww : null), ppd: (ppd > 0 ? ppd : null), doa: doaSrc || null };
  }

  // Edge-function POST (mirrors advisor-module.js). Signed-in callers send their
  // user access token; when opts.allowAnon is set (live matching) a guest posts
  // with the public anon key instead, and the function runs in anonymous mode.
  function _callFn(name, payload, opts) {
    opts = opts || {};
    var supa = CD.supa;
    var base = ((supa && supa.supabaseUrl) || CD.SUPABASE_URL || '').replace(/\/$/, '');
    var anonKey = CD.SUPABASE_ANON_KEY || (supa && supa.supabaseKey) || '';
    function post(bearer) {
      return fetch(base + '/functions/v1/' + name, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (bearer || anonKey),
          'apikey': anonKey
        },
        body: JSON.stringify(payload)
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) throw new Error(body.error || ('Request failed (' + res.status + ')'));
          return body;
        });
      });
    }
    if (supa && CD.currentUser) {
      return supa.auth.getSession().then(function (r) {
        var token = r && r.data && r.data.session && r.data.session.access_token;
        if (token) return post(token);
        if (opts.allowAnon && base) return post(null);
        throw new Error('Not signed in');
      });
    }
    if (opts.allowAnon && base) return post(null);
    return Promise.reject(new Error('Not signed in'));
  }

  // ─── data API ─────────────────────────────────────────────────────────────
  var JB = CD.JobBuddy = CD.JobBuddy || {};
  var _jbMigrated = false; // guest→account local-data migration runs at most once per session

  JB.getRestriction = function () {
    if (!_loggedIn()) return Promise.resolve(_localRestriction());
    return CD.supa.from('restriction_profiles').select('*').eq('user_id', CD.currentUser.id).maybeSingle()
      .then(function (r) { return r.data || null; });
  };

  JB.saveRestriction = function (fields) {
    if (!_loggedIn()) return Promise.resolve(_saveLocalRestriction(fields));
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
  // Auto-fill from a PDF is a signed-in feature (it calls a protected edge fn); guests type manually.
  JB.extractFromPdf = function (base64, filename) {
    if (!_loggedIn()) return Promise.reject(new Error('Sign in to auto-fill from your IME / C-4.3 — or enter your restrictions manually below.'));
    return _callFn('restriction-extract', { pdf_base64: base64, filename: filename || 'document.pdf' });
  };

  JB.getEnrollment = function () {
    if (!_loggedIn()) return Promise.resolve(_lsGet(_LS.enroll, null));
    return CD.supa.from('access_vr_enrollments').select('*').eq('user_id', CD.currentUser.id).maybeSingle()
      .then(function (r) { return r.data || null; });
  };
  JB.saveEnrollment = function (status, notes) {
    if (!_loggedIn()) { var loc = { status: status, notes: notes || null, updated_at: new Date().toISOString() }; _lsSet(_LS.enroll, loc); return Promise.resolve(loc); }
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
  // `override` (optional) = { aww, doa } entered inline on the Feed tab.
  JB.matchNow = function (override) {
    // FREE + guest-capable: signed-in callers match against their saved restrictions;
    // guests match against their device-local restrictions via the anon edge-fn path.
    var ap = _awwAndPpd(override);
    // AWW + date of accident are OPTIONAL. When present we also estimate reduced-earnings; when
    // absent we still match listings to the worker's medical restrictions (no early reject).
    return Promise.all([
      JB.getRestriction(),
      CD.supa.from('job_listings').select('*').order('fetched_at', { ascending: false }).limit(8)
    ]).then(function (res) {
      var rp = res[0], listings = (res[1].data || []);
      if (!rp || !rp.confirmed_by_user) throw new Error('Set and confirm your work restrictions first — then tap Refresh.');
      if (!listings.length) return { results: [], tags: [] };
      var p = CD.currentProfile || {};
      var byExt = {};
      listings.forEach(function (l) { byExt[l.external_id] = l; });

      // The edge fn rejects any batch over CHUNK listings ("listings batch too large").
      // Split the feed into CHUNK-sized batches, call the fn once per batch, and merge the
      // per-batch results (in order) so any feed size works. A failed batch doesn't sink the
      // whole feed — we still render the batches that succeeded.
      var CHUNK = 4;
      var target = { role: p.occupation || null, geography: p.home_city || null };
      function callChunk(chunk) {
        return _callFn('job-buddy', {
          restriction_profile: rp,
          aww: ap.aww, ppd_max_for_doa: ap.ppd, doa: ap.doa,
          target: target,
          listings: chunk.map(function (l) {
            return {
              external_id: l.external_id, source: l.source, title: l.title,
              employer: l.employer, location: l.location,
              salary_min: l.salary_min, salary_max: l.salary_max,
              salary_is_predicted: l.salary_is_predicted, description: l.description
            };
          })
        }, { allowAnon: true }).then(
          function (resp) { return { ok: true, results: (resp && resp.results) || [] }; },
          function (err) { return { ok: false, results: [], error: err }; }
        );
      }

      var chunks = [];
      for (var i = 0; i < listings.length; i += CHUNK) chunks.push(listings.slice(i, i + CHUNK));

      return Promise.all(chunks.map(callChunk)).then(function (parts) {
        // Merge each batch's judgments back in feed order.
        var results = [], failed = 0;
        parts.forEach(function (part) {
          if (!part.ok) failed++;
          results = results.concat(part.results);
        });
        // The live match returns judgments only; join them back to the listing rows and shape
        // into feed "tags" so the UI renders them with the same card as the daily precomputed feed.
        var tags = results.filter(function (r) { return r.restriction_match !== 'no'; })
          .map(function (r) {
            return {
              restriction_match: r.restriction_match,
              re_estimate: r.re_estimate,
              restriction_aww_fit_score: r.restriction_aww_fit_score,
              red_flags: r.red_flags,
              tagged_at: new Date().toISOString(),
              job_listings: byExt[r.external_id] || null
            };
          }).filter(function (t) { return t.job_listings; });
        var out = { results: results, tags: tags };
        if (failed) {
          // Every batch failed → treat as a hard error so the caller shows the failure, not "no matches".
          if (failed === chunks.length) throw new Error('Couldn’t match your feed right now — please try again.');
          out.partialError = 'Some listings couldn’t be matched (' + failed + ' of ' + chunks.length + ' batches) — showing the rest.';
        }
        return out;
      });
    });
  };

  // ─── C-258.1 ledger ─────────────────────────────────────────────────────
  JB.listLedger = function () {
    if (!_loggedIn()) {
      var list = _lsGet(_LS.ledger, []);
      // newest first (date_applied desc, then created_at desc) — mirrors the server order.
      return Promise.resolve(list.slice().sort(function (a, b) {
        return String(b.date_applied || '').localeCompare(String(a.date_applied || '')) ||
               String(b.created_at || '').localeCompare(String(a.created_at || ''));
      }));
    }
    return CD.supa.from('lma_ledger').select('*').order('date_applied', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
      .then(function (r) { return r.error ? [] : (r.data || []); });
  };
  JB.addLedger = function (row) {
    if (!_loggedIn()) {
      var list = _lsGet(_LS.ledger, []);
      var rec = Object.assign({ id: _localId(), created_at: new Date().toISOString(), response_received: false }, row);
      list.push(rec); _lsSet(_LS.ledger, list);
      return Promise.resolve(rec);
    }
    var srv = Object.assign({ user_id: CD.currentUser.id }, row);
    return CD.supa.from('lma_ledger').insert(srv).select().maybeSingle()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  };
  JB.updateLedger = function (id, patch) {
    if (!_loggedIn()) {
      var list = _lsGet(_LS.ledger, []);
      for (var i = 0; i < list.length; i++) { if (list[i].id === id) { list[i] = Object.assign({}, list[i], patch); break; } }
      _lsSet(_LS.ledger, list);
      return Promise.resolve(true);
    }
    return CD.supa.from('lma_ledger').update(patch).eq('id', id).select().maybeSingle()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  };
  JB.removeLedger = function (id) {
    if (!_loggedIn()) {
      _lsSet(_LS.ledger, _lsGet(_LS.ledger, []).filter(function (x) { return x.id !== id; }));
      return Promise.resolve(true);
    }
    return CD.supa.from('lma_ledger').delete().eq('id', id).then(function (r) { return !r.error; });
  };
  // One-shot: when a former guest signs in, carry their device-local Job Buddy data
  // (restrictions + vocational via the wizard, the C-258.1 log, ACCES-VR status) up
  // into their account, then clear it locally. Best-effort and idempotent — each
  // piece clears its own local key only on a successful write.
  JB.migrateLocalToAccount = function () {
    if (!_loggedIn()) return Promise.resolve(false);
    var jobs = [];
    try {
      if (CD.JobBuddyWizard && CD.JobBuddyWizard.hasLocalProfile && CD.JobBuddyWizard.hasLocalProfile() && CD.JobBuddyWizard.syncLocalToSupabase) {
        jobs.push(CD.JobBuddyWizard.syncLocalToSupabase(CD.supa, CD.currentUser.id).catch(function () {}));
      }
    } catch (e) {}
    var ledger = _lsGet(_LS.ledger, []);
    if (ledger.length) {
      var rows = ledger.map(function (r) {
        var c = Object.assign({}, r); delete c.id; delete c.created_at; // let the DB assign fresh ids
        c.user_id = CD.currentUser.id; return c;
      });
      jobs.push(Promise.resolve(CD.supa.from('lma_ledger').insert(rows)).then(function (res) {
        if (res && res.error) throw res.error;
        try { global.localStorage.removeItem(_LS.ledger); } catch (e) {}
      }).catch(function () {}));
    }
    var enr = _lsGet(_LS.enroll, null);
    if (enr && enr.status) {
      jobs.push(JB.saveEnrollment(enr.status, enr.notes).then(function () {
        try { global.localStorage.removeItem(_LS.enroll); } catch (e) {}
      }).catch(function () {}));
    }
    return Promise.all(jobs).then(function () { return jobs.length > 0; });
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
      var ledger = res[0], vr = res[1], profile = CD.currentProfile || {};
      // Packet = genuine fillable Form C-258 (cover / labor-market-attachment summary)
      //          followed by Form C-258.1 (the detailed independent job-search log).
      return JB.fillC258(profile, ledger, vr).then(function (c258) {
        return JB._buildPacketPdf(ledger, vr, profile).then(function (c2581) {
          return JB._mergePdfs([c258, c2581]);
        });
      });
    }).then(function (bytes) {
      // Open in the system viewer (native) / browser (web). User can save/share from there.
      var blob = new Blob([bytes], { type: 'application/pdf' });
      var url = URL.createObjectURL(blob);
      _openExternal(url);
      return url;
    });
  };

  // Concatenate several PDFs (as Uint8Arrays) into one document.
  JB._mergePdfs = function (byteArrays) {
    var P = global.PDFLib;
    return P.PDFDocument.create().then(function (out) {
      var chain = Promise.resolve();
      (byteArrays || []).forEach(function (b) {
        if (!b) return;
        chain = chain.then(function () {
          return P.PDFDocument.load(b).then(function (src) {
            return out.copyPages(src, src.getPageIndices()).then(function (pages) {
              pages.forEach(function (pg) { out.addPage(pg); });
            });
          });
        });
      });
      return chain.then(function () { return out.save(); });
    });
  };

  // Lazily fetch + cache the bundled genuine WCB Form C-258 (fillable AcroForm) template.
  JB._c258TemplateBytes = null;
  JB._loadC258Template = function () {
    if (JB._c258TemplateBytes) return Promise.resolve(JB._c258TemplateBytes);
    return fetch(_ASSET_BASE + 'c258-form.pdf').then(function (r) {
      if (!r.ok) throw new Error('Could not load the C-258 form template (' + r.status + ').');
      return r.arrayBuffer();
    }).then(function (buf) { JB._c258TemplateBytes = new Uint8Array(buf); return JB._c258TemplateBytes; });
  };

  // Fills the genuine NYS WCB Form C-258 "Claimant's Record of Job Search Efforts/Contacts"
  // (a real fillable AcroForm) with the worker's labor-market-attachment data, flattens it, and
  // returns the PDF bytes. The detailed independent job-search log lives on Form C-258.1
  // (see _buildPacketPdf) — C-258 §2 defers to it.
  JB.fillC258 = function (profile, ledger, vr) {
    var P = global.PDFLib;
    if (!P) return Promise.reject(new Error('PDF engine not loaded.'));
    profile = profile || {};
    return JB._loadC258Template().then(function (bytes) {
      return P.PDFDocument.load(bytes);
    }).then(function (doc) {
      var form = doc.getForm();
      function setT(name, val) {
        if (val == null || val === '') return;
        try { var f = form.getTextField(name); f.setText(String(val)); } catch (e) {}
      }
      function check(name) { try { form.getCheckBox(name).check(); } catch (e) {} }

      // ── Header ──
      var fullName = String(profile.full_name || profile.display_name || '').trim();
      var np = fullName ? fullName.split(/\s+/) : [];
      var last = np.length ? np[np.length - 1] : '', first = np.length > 1 ? np[0] : '', mi = np.length > 2 ? np[1].charAt(0) : '';
      if (np.length === 1) { last = np[0]; first = ''; }
      setT('Last Name', last);
      setT('First Name', first);
      setT('Middle Initial', mi);
      setT('WCB Case#', profile.wcb_case_number || '');
      var stats = JB.computeStats(ledger);
      setT('Date To', stats.firstDate ? _dateStr(stats.firstDate) : '');     // "For the Period:" (start)
      setT('Date From 2', stats.lastDate ? _dateStr(stats.lastDate) : '');    // "to:" (end)

      // ── §2 Independent job search (detail on the attached C-258.1) ──
      if ((ledger || []).length) check('Check Box 2');

      // ── §3 ACCES-VR / vocational rehab, when enrolled ──
      if (vr && vr.status && vr.status !== 'not_enrolled') {
        check('Check Box 3');
        setT('Name of Career Center or Program', 'ACCES-VR (NYS Adult Career & Continuing Education Services – Vocational Rehabilitation)');
        var vd = vr.enrolled_at || vr.created_at || vr.updated_at;
        if (vd) setT('Dates of Contact', _dateStr(vd));
        setT('Result', 'Enrollment status: ' + String(vr.status).replace(/_/g, ' '));
      }

      try { form.flatten(); } catch (e) {}
      return doc.save();
    });
  };

  // Lazily fetch + cache the bundled GENUINE WCB Form C-258.1 (flattened official PDF —
  // page 1 = the fillable job-search form, page 2 = instructions). Fetched relative to this
  // script's own URL so it resolves at the app root and the website /dashboard/ mount alike.
  JB._c2581TemplateBytes = null;
  JB._loadC2581Template = function () {
    if (JB._c2581TemplateBytes) return Promise.resolve(JB._c2581TemplateBytes);
    return fetch(_ASSET_BASE + 'c258-1-form.pdf').then(function (r) {
      if (!r.ok) throw new Error('Could not load the C-258.1 form template (' + r.status + ').');
      return r.arrayBuffer();
    }).then(function (buf) { JB._c2581TemplateBytes = new Uint8Array(buf); return JB._c2581TemplateBytes; });
  };

  // Builds the claimant's independent job-search record by stamping the ledger onto the GENUINE
  // NYS WCB Form C-258.1. The official form is used verbatim as the page background (it is a
  // flattened vector PDF — pixel-identical to the government form, incl. the scanner barcode);
  // we only overlay the worker's values onto the blanks. 4 job-search blocks per sheet; extra
  // entries add another copy of the form sheet ("Use additional sheets as needed"); the official
  // instructions page is appended once at the end. Field coordinates were measured directly from
  // the form's underline vectors.
  JB._buildPacketPdf = function (ledger, vr, profile) {
    var P = global.PDFLib, rgb = P.rgb;
    profile = profile || {};
    return JB._loadC2581Template().then(function (tpl) {
      return P.PDFDocument.load(tpl);
    }).then(function (real) {
      return P.PDFDocument.create().then(function (out) {
        return out.embedFont(P.StandardFonts.Helvetica).then(function (font) {
          var ink = rgb(0.07, 0.09, 0.15), rows = ledger || [], H = 792;
          function san(s) {
            return String(s == null ? '' : s).replace(/ /g, ' ')
              .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
          }
          // pdf-lib baseline (bottom-origin) for a value sitting just above an underline whose
          // distance-from-top (matching the measured PDF) is `yu`.
          function by(yu) { return H - yu + 1.8; }
          function draw(pg, s, x, yu, size, opts) {
            s = san(s); if (!s) return; opts = opts || {};
            if (opts.max) { while (s.length > 1 && font.widthOfTextAtSize(s, size) > opts.max) s = s.slice(0, -1); }
            var xx = opts.center ? (x - font.widthOfTextAtSize(s, size) / 2) : x;
            var o = { x: xx, y: by(yu), size: size, font: font, color: ink };
            try { pg.drawText(s, o); } catch (e) { try { pg.drawText(s.replace(/[^\x20-\x7E]/g, '?'), o); } catch (e2) {} }
          }
          function wrapDraw(pg, s, x, yu, size, maxW, maxLines) {
            s = san(s); if (!s) return;
            var words = s.split(/\s+/), lines = [], cur = '';
            for (var i = 0; i < words.length; i++) {
              var t = cur ? cur + ' ' + words[i] : words[i];
              if (font.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = words[i]; } else cur = t;
            }
            if (cur) lines.push(cur);
            lines = lines.slice(0, maxLines || 2);
            for (var li = 0; li < lines.length; li++) draw(pg, lines[li], x, yu + li * 10, size);
          }
          function methodLetter(m) {
            return m === 'in_person' ? 'P' : m === 'phone' ? 'T' : m === 'mail' ? 'M'
              : (m === 'email' || m === 'online') ? 'O' : (m ? String(m).charAt(0).toUpperCase() : '');
          }
          function resultStr(r) {
            var b = [r.response_received ? ('Response received' + (r.response_date ? (' ' + _dateStr(r.response_date)) : '')) : 'No response yet'];
            if (r.notes) b.push(String(r.notes));
            return b.join(' - ');
          }

          // Claimant identity (split into the form's Last / First / MI fields).
          var fullName = String(profile.full_name || profile.display_name || '').trim();
          var np = fullName ? fullName.split(/\s+/) : [];
          var nLast = np.length ? np[np.length - 1] : '', nFirst = np.length > 1 ? np[0] : '', nMI = np.length > 2 ? np[1].charAt(0) : '';
          if (np.length === 1) { nLast = np[0]; nFirst = ''; }
          var caseNo = profile.wcb_case_number || '';
          var stats = JB.computeStats(ledger);
          var pStart = stats.firstDate ? _dateStr(stats.firstDate) : '', pEnd = stats.lastDate ? _dateStr(stats.lastDate) : '';

          var PITCH = 139.03;  // vertical pitch between the 4 job-search blocks (measured)
          var FIELDS = [
            { k: 'date', x: 134, y: 179.3, max: 78 },
            { k: 'method', x: 316.8, y: 179.3, center: true },
            { k: 'position', x: 428, y: 179.3, max: 162 },
            { k: 'employer', x: 92, y: 197.3, max: 497 },
            { k: 'address', x: 92, y: 215.9, max: 497 },
            { k: 'contact', x: 171, y: 234.4, max: 244 },
            { k: 'phone', x: 500, y: 234.4, max: 90 },
            { k: 'website', x: 100, y: 252.2, max: 254 },
            { k: 'confirm', x: 428, y: 252.2, max: 162 }
          ];
          function val(k, r) {
            switch (k) {
              case 'date': return _dateStr(r.date_applied);
              case 'method': return methodLetter(r.apply_method);
              case 'position': return r.job_title;
              case 'employer': return r.employer_name;
              case 'address': return r.employer_address;
              case 'contact': return r.contact_name;
              case 'phone': return r.contact_phone;
              case 'website': return r.employer_website || '';
              case 'confirm': return r.confirmation_no || r.confirmation || '';
            }
            return '';
          }
          function fillForm(pg) {
            draw(pg, nLast, 68, 79.8, 9, { max: 142 });
            draw(pg, nFirst, 264, 79.8, 9, { max: 142 });
            draw(pg, nMI, 429.8, 79.8, 9, { center: true });
            draw(pg, caseNo, 509, 79.8, 9, { max: 84 });
            draw(pg, pStart, 82, 98.6, 9, { max: 96 });
            draw(pg, pEnd, 195, 98.6, 9, { max: 96 });
          }
          function fillBlock(pg, i, r) {
            var b = i * PITCH;
            for (var f = 0; f < FIELDS.length; f++) {
              var fd = FIELDS[f];
              draw(pg, val(fd.k, r), fd.x, fd.y + b, 9, { center: fd.center, max: fd.max });
            }
            wrapDraw(pg, resultStr(r), 88, 268.0 + b, 8.5, 500, 2);
          }

          var nSheets = Math.max(1, Math.ceil(rows.length / 4));
          var chain = Promise.resolve();
          for (var s = 0; s < nSheets; s++) {
            (function (s) {
              chain = chain.then(function () {
                return out.copyPages(real, [0]).then(function (cp) {
                  var pg = cp[0]; out.addPage(pg);
                  fillForm(pg);
                  for (var ri = 0; ri < 4; ri++) { var idx = s * 4 + ri; if (idx >= rows.length) break; fillBlock(pg, ri, rows[idx]); }
                });
              });
            })(s);
          }
          // Append the official instructions page (template page 2) once.
          chain = chain.then(function () {
            if (real.getPageCount() > 1) return out.copyPages(real, [1]).then(function (cp) { out.addPage(cp[0]); });
          });
          return chain.then(function () { return out.save(); });
        });
      });
    });
  };

  // ─── First-run Work Profile wizard (vocational + restrictions, one front door) ──
  // The wizard module (CD.JobBuddyWizard) is loaded alongside this screen. It writes
  // vocational_profiles + restriction_profiles under RLS and flips job_buddy_onboarded.
  function _wizardOpts(extra) {
    var o = { calc: CD.Calc || null };
    if (CD.supa) o.supabase = CD.supa;
    if (CD.currentUser && CD.currentUser.id) o.user = { id: CD.currentUser.id };
    if (CD.currentProfile) o.profile = CD.currentProfile;
    return Object.assign(o, extra || {});
  }
  function _onWizardDone(onDone) {
    return function (data) {
      if (CD.currentProfile) CD.currentProfile.job_buddy_onboarded = true;  // don't reopen this session
      if (typeof onDone === 'function') onDone(data);
    };
  }
  function _openWizard(onDone) {
    if (!CD.JobBuddyWizard) { _toast('The work-profile wizard isn’t available right now.'); return; }
    CD.JobBuddyWizard.open(_wizardOpts({ onComplete: _onWizardDone(onDone) }));
  }
  function _maybeAutoOpenWizard(onDone) {
    if (!CD.JobBuddyWizard || !_loggedIn()) return;            // anon app shell has no first-run gate
    try { CD.JobBuddyWizard.maybeAutoOpen(_wizardOpts({ onComplete: _onWizardDone(onDone) })); } catch (e) {}
  }

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
        'Find work within your medical restrictions and keep a hearing-ready record of your job search. You apply on the employer’s site — we never apply for you.'),
      H('div', { className: 'cd-jb-hd-actions' }, [
        H('button', { className: 'jbw-launcher', type: 'button', onclick: function () { _openWizard(function () { paintBody(); }); } }, '✎ Edit my work profile')
      ])
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

    // Former guest just signed in → migrate their device-local data into the account
    // once, then repaint so the freshly-synced restrictions/log show up.
    if (!_jbMigrated && _loggedIn()) {
      _jbMigrated = true;
      JB.migrateLocalToAccount().then(function (did) { if (did) paintBody(); }).catch(function () {});
    }

    // First-run: open the Work Profile wizard once (logged-in & job_buddy_onboarded === false).
    // Deferred a tick so the caller can attach the screen first; the wizard mounts on <body>.
    global.setTimeout(function () { _maybeAutoOpenWizard(function () { paintBody(); }); }, 0);
    return root;
  }

  // ─── Restrictions tab ─────────────────────────────────────────────────────
  function renderRestrictions(mount) {
    var H = _hh();
    var loading = H('div', { className: 'cd-jb-loading' }, 'Loading your restrictions…');
    mount.appendChild(loading);

    JB.getRestriction().then(function (rp) {
      mount.innerHTML = '';
      var _ab = _anonBanner('You’re not signed in — your restrictions stay on this device only.'); if (_ab) mount.appendChild(_ab);
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
            upStatus.textContent = (e && e.message) || 'Couldn’t read that PDF. Enter your restrictions manually below.';
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
      mount.appendChild(_hh()('p', { className: 'cd-jb-help' }, 'Couldn’t load your restrictions right now — please try again.'));
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

      // AWW/DOA are OPTIONAL. If they're on the profile we also estimate reduced-earnings; if not,
      // the worker can type them here (not saved) — but the feed still loads jobs without them.
      var override = {};
      var ap0 = _awwAndPpd();
      if (!ap0.aww || !ap0.ppd) {
        var awwIn = H('input', { className: 'cd-jb-input cd-jb-input-sm', type: 'number', placeholder: 'AWW $ (optional)' });
        awwIn.oninput = function () { override.aww = awwIn.value; reMatchSoon(); };
        var doaIn = H('input', { className: 'cd-jb-input cd-jb-input-sm', type: 'date', title: 'Date of accident (optional)' });
        doaIn.oninput = function () { override.doa = doaIn.value; reMatchSoon(); };
        bar.appendChild(H('span', { className: 'cd-jb-fld-lbl' }, 'Estimate benefits (optional):'));
        bar.appendChild(awwIn); bar.appendChild(doaIn);
      }

      function doMatch() {
        status.textContent = 'Finding jobs within your restrictions…';
        return JB.matchNow(override).then(function (r) {
          // A partial batch failure still paints what matched — just flag the gap.
          status.textContent = (r && r.partialError) || '';
          paint((r && r.tags) || []);
        }).catch(function (e) {
          status.textContent = (e && e.message) || 'Nothing to match yet.';
          paint([]);
        });
      }
      // Debounced auto re-match when the worker fills AWW/DOA inline — no manual Refresh needed.
      var reTimer = null;
      function reMatchSoon() {
        if (reTimer) clearTimeout(reTimer);
        reTimer = setTimeout(function () { if (override.aww || override.doa) doMatch(); }, 900);
      }

      refreshBtn.onclick = function () { doMatch(); };
      bar.appendChild(refreshBtn); bar.appendChild(status);
      // External search (deep-link only — we display nothing scraped from these)
      var ext = H('div', { className: 'cd-jb-ext' }, [
        H('span', { className: 'cd-jb-ext-lbl' }, 'Also search:'),
        H('button', { className: 'cd-jb-chip', onclick: function () { _searchExternal('indeed'); } }, 'Indeed'),
        H('button', { className: 'cd-jb-chip', onclick: function () { _searchExternal('linkedin'); } }, 'LinkedIn')
      ]);
      bar.appendChild(ext);
      mount.appendChild(bar);

      var listWrap = H('div', { className: 'cd-jb-feedlist' });
      mount.appendChild(listWrap);

      function paint(items) {
        listWrap.innerHTML = '';
        if (!items || !items.length) {
          listWrap.appendChild(H('div', { className: 'cd-jb-empty' }, [
            H('div', { className: 'cd-jb-empty-icon' }, '🎯'),
            H('h3', {}, 'No matches yet'),
            H('p', {}, 'Confirm your work restrictions and we’ll surface jobs within your limits. Tap “Refresh feed” to match the newest listings now, or search Indeed / LinkedIn directly.')
          ]));
          return;
        }
        items.forEach(function (t) { listWrap.appendChild(_feedCard(t)); });
      }

      if (tags.length) {
        paint(tags);   // precomputed daily feed
      } else {
        doMatch();     // auto-match the freshest listings on open — no manual Refresh needed
      }
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
      var _ab = _anonBanner('You’re not signed in — your C-258.1 log stays on this device only.'); if (_ab) mount.appendChild(_ab);
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
