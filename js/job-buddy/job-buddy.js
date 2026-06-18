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

  JB._buildPacketPdf = function (ledger, vr, profile) {
    var P = global.PDFLib, rgb = P.rgb;
    return P.PDFDocument.create().then(function (doc) {
      return doc.embedFont(P.StandardFonts.Helvetica).then(function (font) {
        return doc.embedFont(P.StandardFonts.HelveticaBold).then(function (bold) {
          // ── Reproduces the official NYS WCB Form C-258.1 (7-17) "Claimant's Record of
          //    Independent Job Search Efforts" layout + exact field labels. The official PDF is an
          //    XFA (Adobe LiveCycle) form that pdf-lib cannot fill or render, so we redraw it. ──
          var stats = JB.computeStats(ledger);
          var rows = ledger || [];
          var PAGE_W = 612, PAGE_H = 792, M = 46, RX = M + 286; // RX = right-column x
          var ink = rgb(0.09, 0.11, 0.16), gray = rgb(0.42, 0.45, 0.5), line = rgb(0.78, 0.80, 0.84);
          var page, y;

          function rawText(p, s, x, yy, size, f, color) {
            var opts = { x: x, y: yy, size: size || 10, font: f || font, color: color || ink };
            try { p.drawText(String(s == null ? '' : s), opts); }
            catch (e) { try { p.drawText(String(s == null ? '' : s).replace(/[^\x20-\x7E]/g, '?'), opts); } catch (e2) {} }
          }
          function text(s, x, yy, size, f, color) { rawText(page, s, x, yy, size, f, color); }
          function hr(yy, x0, x1) { page.drawLine({ start: { x: x0 || M, y: yy }, end: { x: x1 || (PAGE_W - M), y: yy }, thickness: 0.6, color: line }); }
          function trunc(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
          // label (gray) + value (ink) on one baseline
          function lv(label, value, x, yy, maxChars) {
            text(label, x, yy, 8, font, gray);
            var lw = font.widthOfTextAtSize(label + ' ', 8);
            text(value == null || value === '' ? '—' : trunc(value, maxChars || 60), x + lw, yy, 9, font, ink);
          }
          function methodCode(m) {
            return m === 'in_person' ? 'P (in person)' : m === 'phone' ? 'T (telephone)'
              : m === 'mail' ? 'M (mail)' : (m === 'email' || m === 'online') ? 'O (online/email)' : (m || '—');
          }
          function resultStr(r) {
            var b = [r.response_received ? ('Response received' + (r.response_date ? (' ' + _dateStr(r.response_date)) : '')) : 'No response yet'];
            if (r.notes) b.push(String(r.notes));
            return b.join(' — ');
          }

          // Claimant name split into the form's Last / First / MI fields.
          var fullName = String(profile.full_name || profile.display_name || '').trim();
          var np = fullName ? fullName.split(/\s+/) : [];
          var nLast = np.length ? np[np.length - 1] : '', nFirst = np.length > 1 ? np[0] : (np[0] || ''), nMI = np.length > 2 ? np[1].charAt(0) : '';
          if (np.length === 1) { nLast = np[0]; nFirst = ''; }
          var caseNo = profile.wcb_case_number || '';

          function newPage(full) {
            page = doc.addPage([PAGE_W, PAGE_H]);
            y = PAGE_H - M;
            // Title
            text('Claimant’s Record of Independent Job Search Efforts', M, y, 13.5, bold);
            text('Form C-258.1 (7-17)', PAGE_W - M - 96, y + 1, 8.5, font, gray); y -= 17;
            text('New York State Workers’ Compensation Board · www.wcb.ny.gov', M, y, 8.5, font, gray); y -= 14;
            hr(y); y -= 16;
            // Claimant identity row
            lv('Last Name:', nLast || '____________', M, y, 26);
            lv('First Name:', nFirst || '__________', M + 188, y, 18);
            lv('MI:', nMI || '__', M + 360, y, 3);
            lv('WCB Case #:', caseNo || '____________', M + 420, y, 14); y -= 16;
            var periodStr = stats.firstDate ? (_dateStr(stats.firstDate) + '   to:   ' + _dateStr(stats.lastDate)) : '__________   to:   __________';
            lv('For the Period:', periodStr, M, y, 60); y -= 15;
            // Method legend (verbatim from the form)
            text('* Method of Contact:  P = in person   ·   T = telephone   ·   M = mail   ·   O = online or email', M, y, 8, font, gray);
            y -= 8; hr(y); y -= 16;
          }

          newPage(true);

          // ── Job-search entries (one labeled block per contact) ──
          var ENTRY_H = 92;
          if (!rows.length) { text('No job search efforts logged for this period.', M, y, 9.5, font, gray); y -= 16; }
          rows.forEach(function (r, i) {
            if (y - ENTRY_H < M + 40) newPage(false);
            text('Job Search Effort #' + (i + 1), M, y, 8.5, bold, gray); y -= 14;
            lv('Date of Contact:', _dateStr(r.date_applied), M, y, 14);
            lv('Method of Contact*:', methodCode(r.apply_method), M + 168, y, 18);
            lv('Position Applied For:', r.job_title, M + 350, y, 24); y -= 14;
            lv('Employer Name:', r.employer_name, M, y, 36);
            lv('Daytime Phone #:', r.contact_phone, RX, y, 18); y -= 14;
            lv('Mailing Address:', r.employer_address, M, y, 92); y -= 14;
            lv('Name & Title of Person Contacted:', r.contact_name, M, y, 30);
            lv('Employer Website:', '', RX, y, 22); y -= 14;
            lv('Confirmation #:', '', M, y, 18);
            lv('Result:', resultStr(r), M + 168, y, 60); y -= 10;
            hr(y); y -= 14;
          });

          // ── Supplemental summary (not part of C-258.1; aids the hearing exhibit) ──
          if (y - 70 < M + 24) newPage(false);
          y -= 6;
          text('Summary of Job Search', M, y, 10, bold); y -= 14;
          var summary = stats.total + ' independent job search effort' + (stats.total === 1 ? '' : 's') +
            (stats.days ? (' over ' + stats.days + ' day' + (stats.days === 1 ? '' : 's')) : '') +
            ' · ' + stats.responses + ' response' + (stats.responses === 1 ? '' : 's');
          text(summary, M, y, 9.5, font); y -= 13;
          var vrLabel = vr && vr.status ? vr.status.replace(/_/g, ' ') : 'not enrolled';
          text('ACCES-VR (NYS vocational rehabilitation): ' + vrLabel, M, y, 9, font, gray); y -= 20;
          text('Claimant signature: ______________________________', M, y, 9.5, font);
          text('Date: ____________', PAGE_W - M - 132, y, 9.5, font); y -= 18;
          text(DISCLAIMER, M, y, 7.5, font, gray);

          // ── Page footers (Page X of Y) on every page ──
          var pages = doc.getPages(), N = pages.length;
          for (var pi = 0; pi < N; pi++) {
            rawText(pages[pi], 'C-258.1 (7-17)', M, 30, 7.5, font, gray);
            rawText(pages[pi], 'Page ' + (pi + 1) + ' of ' + N, PAGE_W / 2 - 26, 30, 7.5, font, gray);
            rawText(pages[pi], 'www.wcb.ny.gov', PAGE_W - M - 70, 30, 7.5, font, gray);
          }

          return doc.save();
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
