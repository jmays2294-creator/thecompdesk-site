/* ============================================================================
 * firm-job-buddy.js — Firm Tier read-only "Client Work Search" dashboard
 * ----------------------------------------------------------------------------
 * Phase 4. A firm attorney sees each represented client's C-258.1 work-search
 * log in real time (RLS: firm_reps_claimant helper grants SELECT on the client's
 * lma_ledger / restriction_profiles / access_vr_enrollments / job_buddy_listing_tags).
 * READ-ONLY — the firm never edits a client's search. Surfaces red-flag alerts
 * and one-click generates / attaches the LMA packet to the next hearing.
 *
 * Reuses CD.JobBuddy.computeStats + CD.JobBuddy._buildPacketPdf (Phase 3).
 *
 * Public: CD.renderFirmJobBuddy() -> DOM node ; CD.FirmJobBuddy.* data helpers
 * ==========================================================================*/
(function (global) {
  'use strict';
  var CD = global.CD = global.CD || {};
  function _hh() { return CD.h || global.h; }
  var DISCLAIMER = 'This tool is for informational purposes only and does not constitute legal advice.';

  function _money(n) { if (n == null || isNaN(Number(n))) return '—'; return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function _dateStr(d) { if (!d) return ''; try { return new Date(String(d).length <= 10 ? d + 'T00:00:00' : d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return String(d); } }
  function _daysAgo(d) { if (!d) return Infinity; return Math.floor((Date.now() - new Date(String(d).length <= 10 ? d + 'T00:00:00' : d)) / 86400000); }
  function _loggedIn() { return !!(CD.currentUser && CD.supa); }
  function _openExternal(url) { try { global.open(url, '_blank'); } catch (e) {} }

  var FB = CD.FirmJobBuddy = CD.FirmJobBuddy || {};

  // Load every represented client + their work-search summary in a few RLS-scoped reads.
  FB.loadClients = function () {
    if (!_loggedIn()) return Promise.resolve([]);
    var sb = CD.supa;
    return Promise.all([
      sb.from('firm_cases').select('id, claimant_profile_id, claimant_name, wcb_case_number, date_of_injury').not('claimant_profile_id', 'is', null),
      sb.from('lma_ledger').select('user_id, date_applied, response_received, created_at'),
      sb.from('access_vr_enrollments').select('user_id, status'),
      sb.from('restriction_profiles').select('user_id, confirmed_by_user'),
      sb.from('job_buddy_listing_tags').select('user_id, restriction_match')
    ]).then(function (res) {
      var cases = (res[0].data || []);
      var ledger = (res[1].data || []);
      var vr = (res[2].data || []);
      var rp = (res[3].data || []);
      var tags = (res[4].data || []);

      var byUser = {};
      function bucket(uid) { return byUser[uid] || (byUser[uid] = { apps: 0, responses: 0, lastApplied: null, vrStatus: null, confirmed: null, mismatch: 0 }); }
      ledger.forEach(function (r) { var b = bucket(r.user_id); b.apps++; if (r.response_received) b.responses++; var d = r.date_applied || r.created_at; if (!b.lastApplied || d > b.lastApplied) b.lastApplied = d; });
      vr.forEach(function (r) { bucket(r.user_id).vrStatus = r.status; });
      rp.forEach(function (r) { bucket(r.user_id).confirmed = !!r.confirmed_by_user; });
      tags.forEach(function (r) { if (r.restriction_match === 'no') bucket(r.user_id).mismatch++; });

      // One row per case that names a represented claimant.
      return cases.map(function (c) {
        var b = byUser[c.claimant_profile_id] || { apps: 0, responses: 0, lastApplied: null, vrStatus: null, confirmed: null, mismatch: 0 };
        return {
          caseId: c.id, userId: c.claimant_profile_id, name: c.claimant_name || 'Claimant',
          wcb: c.wcb_case_number || '', doi: c.date_of_injury || null,
          apps: b.apps, responses: b.responses, lastApplied: b.lastApplied,
          vrStatus: b.vrStatus, confirmed: b.confirmed, mismatch: b.mismatch,
          flags: FB.redFlags(b)
        };
      }).sort(function (a, b) { return b.flags.length - a.flags.length; }); // most-at-risk first
    });
  };

  // Red-flag rules (all firm-readable). Pure -> unit-testable.
  FB.redFlags = function (b) {
    var flags = [];
    if (!b.apps || _daysAgo(b.lastApplied) > 14) flags.push('No applications in 14 days');
    if (!b.vrStatus || b.vrStatus === 'not_enrolled') flags.push('No ACCES-VR enrollment');
    if (b.confirmed !== true) flags.push('Restrictions not confirmed');
    if (b.mismatch > 0) flags.push(b.mismatch + ' application(s) flagged out-of-restriction');
    return flags;
  };

  FB.getClientLedger = function (userId) {
    if (!_loggedIn()) return Promise.resolve([]);
    return CD.supa.from('lma_ledger').select('*').eq('user_id', userId)
      .order('date_applied', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
      .then(function (r) { return r.error ? [] : (r.data || []); });
  };
  FB.getClientVr = function (userId) {
    return CD.supa.from('access_vr_enrollments').select('*').eq('user_id', userId).maybeSingle().then(function (r) { return r.data || null; });
  };

  // Generate the LMA packet PDF for a specific client (reuses the Phase 3 builder).
  FB.generatePacket = function (client) {
    if (!CD.JobBuddy || !CD.JobBuddy._buildPacketPdf) return Promise.reject(new Error('PDF engine not loaded.'));
    return Promise.all([FB.getClientLedger(client.userId), FB.getClientVr(client.userId)]).then(function (res) {
      var profileLike = { full_name: client.name, wcb_case_number: client.wcb, doa: client.doi };
      return CD.JobBuddy._buildPacketPdf(res[0], res[1], profileLike);
    }).then(function (bytes) {
      var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      _openExternal(url);
      return url;
    });
  };

  // One-click: generate the packet + record a firm_case_event noting it's attached to the next hearing.
  FB.attachToNextHearing = function (client) {
    var sb = CD.supa;
    return sb.from('firm_hearings').select('id, hearing_date, owner_id').eq('case_id', client.caseId)
      .gte('hearing_date', new Date().toISOString().slice(0, 10)).order('hearing_date', { ascending: true }).limit(1)
      .then(function (r) {
        var hearing = (r.data && r.data[0]) || null;
        return FB.generatePacket(client).then(function () {
          // Best-effort audit event; never blocks the packet.
          return FB.getClientLedger(client.userId).then(function (ledger) {
            var stats = CD.JobBuddy.computeStats(ledger);
            var ev = {
              case_id: client.caseId,
              owner_id: (hearing && hearing.owner_id) || CD.currentUser.id,
              event_type: 'lma_packet',
              event_date: (hearing && hearing.hearing_date) || new Date().toISOString().slice(0, 10),
              title: 'LMA work-search packet prepared',
              description: stats.total + ' applications, ' + stats.responses + ' responses' + (hearing ? (' — for hearing ' + _dateStr(hearing.hearing_date)) : ''),
              source: 'job_buddy',
              metadata: { total: stats.total, responses: stats.responses, days: stats.days, hearing_id: hearing ? hearing.id : null }
            };
            return sb.from('firm_case_events').insert(ev).then(function (ir) {
              return { hearing: hearing, logged: !ir.error };
            });
          });
        });
      });
  };

  // ─── realtime: a client's new applications appear without a manual refresh ──
  var _channel = null;
  FB.subscribe = function (onChange) {
    try {
      if (_channel) { CD.supa.removeChannel(_channel); _channel = null; }
      _channel = CD.supa.channel('jb-firm-ledger')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'lma_ledger' }, function () { if (onChange) onChange(); })
        .subscribe();
    } catch (e) { /* realtime is a nicety; never fatal */ }
  };
  FB.unsubscribe = function () { try { if (_channel) { CD.supa.removeChannel(_channel); _channel = null; } } catch (e) {} };

  // ════════════════════════════════════════════════════════════════════════
  function renderFirmJobBuddy() {
    var H = _hh();
    var root = H('div', { className: 'cd-jb cd-fjb' });
    root.appendChild(H('header', { className: 'cd-jb-hd' }, [
      H('div', { className: 'cd-jb-eyebrow' }, 'Firm · The Comp Desk'),
      H('h1', { className: 'cd-jb-title' }, 'Client Work Search'),
      H('p', { className: 'cd-jb-sub' }, 'A real-time, read-only view of each client’s C-258.1 labor-market-attachment record. Spot risks early and attach a hearing-ready packet in one click.')
    ]));
    var body = H('div', { className: 'cd-jb-body' });
    root.appendChild(body);
    root.appendChild(H('p', { className: 'cd-jb-disclaimer' }, DISCLAIMER));

    function paintList() {
      body.innerHTML = '';
      body.appendChild(H('div', { className: 'cd-jb-loading' }, 'Loading your clients…'));
      FB.loadClients().then(function (clients) {
        body.innerHTML = '';
        if (!clients.length) {
          body.appendChild(H('div', { className: 'cd-jb-empty' }, [
            H('div', { className: 'cd-jb-empty-icon' }, '🗂️'),
            H('h3', {}, 'No client work-search records yet'),
            H('p', {}, 'When a represented client (a claimant linked to one of your cases) starts logging their job search in Job Buddy, they’ll appear here with live red-flag alerts.')
          ]));
          return;
        }
        var alertCount = clients.filter(function (c) { return c.flags.length; }).length;
        body.appendChild(H('div', { className: 'cd-fjb-summary' }, clients.length + ' client' + (clients.length === 1 ? '' : 's') + ' · ' + alertCount + ' with red-flag alerts'));
        clients.forEach(function (c) { body.appendChild(_clientRow(c, paintDetail)); });
      }).catch(function (e) {
        body.innerHTML = '';
        body.appendChild(H('p', { className: 'cd-jb-help' }, (e && e.message) || 'Could not load clients.'));
      });
    }

    function paintDetail(client) {
      body.innerHTML = '';
      var back = H('button', { className: 'cd-jb-btn ghost', onclick: paintList }, '← All clients');
      body.appendChild(back);
      body.appendChild(H('div', { className: 'cd-fjb-chead' }, [
        H('h2', { className: 'cd-jb-card-hd' }, client.name),
        H('div', { className: 'cd-jb-job-meta' }, [client.wcb ? ('WCB# ' + client.wcb) : '', client.doi ? ('DOI ' + _dateStr(client.doi)) : ''].filter(Boolean).join(' · '))
      ]));

      if (client.flags.length) {
        var fl = H('div', { className: 'cd-fjb-alerts' });
        client.flags.forEach(function (f) { fl.appendChild(H('span', { className: 'cd-fjb-alert' }, '⚠ ' + f)); });
        body.appendChild(fl);
      }

      var actions = H('div', { className: 'cd-jb-actions' });
      var pkt = H('button', { className: 'cd-jb-btn primary' }, '📄 Generate LMA Packet');
      pkt.onclick = function () { pkt.disabled = true; var o = pkt.textContent; pkt.textContent = 'Building…'; FB.generatePacket(client).then(function () { pkt.textContent = o; pkt.disabled = false; }).catch(function () { pkt.textContent = 'Failed'; pkt.disabled = false; }); };
      var att = H('button', { className: 'cd-jb-btn' }, '📎 Attach to next hearing');
      var attMsg = H('span', { className: 'cd-jb-savemsg' }, '');
      att.onclick = function () { att.disabled = true; attMsg.textContent = 'Preparing…'; FB.attachToNextHearing(client).then(function (r) { attMsg.textContent = r.hearing ? ('Packet ready for hearing ' + _dateStr(r.hearing.hearing_date) + (r.logged ? ' (logged to case)' : '')) : 'Packet ready (no upcoming hearing found)'; att.disabled = false; }).catch(function (e) { attMsg.textContent = (e && e.message) || 'Failed'; att.disabled = false; }); };
      actions.appendChild(pkt); actions.appendChild(att); actions.appendChild(attMsg);
      body.appendChild(actions);

      var ledgerMount = H('div', { className: 'cd-fjb-ledger' });
      body.appendChild(ledgerMount);
      ledgerMount.appendChild(H('div', { className: 'cd-jb-loading' }, 'Loading the C-258.1 log…'));
      FB.getClientLedger(client.userId).then(function (rows) {
        ledgerMount.innerHTML = '';
        var stats = CD.JobBuddy.computeStats(rows);
        ledgerMount.appendChild(H('div', { className: 'cd-jb-stats' }, [
          _stat(stats.total, 'applications'), _stat(stats.responses, 'responses'), _stat(stats.days || '—', 'days of search')
        ]));
        if (!rows.length) { ledgerMount.appendChild(H('p', { className: 'cd-jb-help' }, 'No applications logged yet.')); return; }
        var list = H('div', { className: 'cd-jb-ledger' });
        rows.forEach(function (r) { list.appendChild(_roRow(r)); });
        ledgerMount.appendChild(list);
      });
    }

    function _stat(n, l) { return H('div', { className: 'cd-jb-stat' }, [H('div', { className: 'cd-jb-stat-n' }, String(n)), H('div', { className: 'cd-jb-stat-l' }, l)]); }
    function _roRow(r) {
      return H('div', { className: 'cd-jb-lrow' }, [
        H('div', { className: 'cd-jb-lrow-main' }, [
          H('div', { className: 'cd-jb-lrow-top' }, [H('strong', {}, r.job_title || r.employer_name || 'Application'), H('span', { className: 'cd-jb-lrow-date' }, _dateStr(r.date_applied))]),
          H('div', { className: 'cd-jb-lrow-sub' }, [r.employer_name, r.apply_method, r.response_received ? 'responded' : null].filter(Boolean).join(' · '))
        ])
      ]);
    }

    paintList();
    // Live updates: refresh the list when any readable ledger row changes.
    FB.subscribe(function () { if (body.querySelector('.cd-fjb-summary') || body.querySelector('.cd-jb-empty')) paintList(); });
    return root;
  }

  // expose row builder for the list
  function _clientRow(c, onOpen) {
    var H = _hh();
    var row = H('div', { className: 'cd-fjb-row' + (c.flags.length ? ' has-alert' : ''), onclick: function () { onOpen(c); } });
    row.appendChild(H('div', { className: 'cd-fjb-row-main' }, [
      H('div', { className: 'cd-fjb-row-name' }, c.name),
      H('div', { className: 'cd-jb-lrow-sub' }, [c.wcb ? ('WCB# ' + c.wcb) : '', c.apps + ' app' + (c.apps === 1 ? '' : 's'), c.responses + ' resp', c.lastApplied ? ('last ' + _dateStr(c.lastApplied)) : 'none logged'].filter(Boolean).join(' · '))
    ]));
    if (c.flags.length) row.appendChild(H('span', { className: 'cd-fjb-badge' }, c.flags.length + ' ⚠'));
    row.appendChild(H('span', { className: 'cd-jb-quick-arrow' }, '→'));
    return row;
  }

  CD.renderFirmJobBuddy = renderFirmJobBuddy;
})(typeof window !== 'undefined' ? window : this);
