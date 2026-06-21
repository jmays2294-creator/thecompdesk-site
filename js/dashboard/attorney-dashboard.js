/* ============================================================================
 * attorney-dashboard.js — CD.AttorneyDashboard (Attorney dashboard agent, Wave 2)
 * ----------------------------------------------------------------------------
 * OWNER: Attorney dashboard agent. See ops/dev/APP_REDESIGN_SPEC.md §7.
 * Also owns: www/css/dashboard-attorney.css
 *
 * INTEGRATION CONTRACT (do not change the signature — FOUNDATION wires to it):
 *   window.CD.AttorneyDashboard.render(ctx) -> DOMNode | null
 *
 *   ctx = {
 *     profile, user, tier,            // CD.currentProfile / currentUser / currentTier
 *     supabase,                       // CD.supa — for get_my_leads()/published_skills
 *     h, card, f$,                    // ui-controller DOM helpers
 *     showScreen,                     // (screenId) => void
 *     handleUpgrade,                  // CD.handleUpgrade
 *     openAttorneyIntake,            // () => void
 *     hasAccess,                      // (tier) => bool
 *     goToCalc                        // (tab) => void — deep-link calc tabs
 *   }
 *
 * Renders on the ATTORNEY (dark/navy) skin: Geist display, JetBrains Mono
 * numerics, fast/precise motion on --rhythm-*.
 *
 * TRUE-STATE COMMAND CENTER (2026-06-21):
 *   A) Network Leads — the real Comp Desk Law referral pipeline. Reads the
 *      SECURITY DEFINER RPC get_my_leads() (migration 049), which scopes
 *      referrals to this attorney via attorney_roster.user_id = auth.uid()
 *      (assign-lead v4 writes referrals.assigned_attorney_id = roster.id, which
 *      the base RLS SELECT policy does NOT cover — hence the definer helper, not
 *      a raw cross-table policy join: Apr 27 recursion rule). Shows the 48h
 *      response clock (referrals.response_deadline), county, status + contact
 *      actions; accept/decline go through respond_to_lead(). Roster enrollment
 *      state drives an honest, actionable empty-state. Network co-counsel cases
 *      have no table yet → honest "none yet" empty-state (never fake rows).
 *   B) Tools — Pro Workspace + Pro calculators + C-3 / OC-400.1 generators,
 *      tier-gated honestly.
 *   C) Review new skills — reads the live published_skills catalog (RLS
 *      ps_select=true); "what's new" badge for recently-published skills; honest
 *      empty-state + marketplace link when the catalog is empty.
 *   D) "This Month" gauges remain self-entered (localStorage) w/ a DEMO tag —
 *      there is no per-attorney signed-count source, so they stay explicitly
 *      labeled sample data rather than masquerading as real metrics.
 *
 * Async sections render from module-level state (_net/_sk), fetch once per user
 * via CD.supa, then call CD.render() to repaint. All motion gates on
 * prefers-reduced-motion; gauges sweep on each render.
 * ==========================================================================*/
(function (window, document) {
  'use strict';
  var CD = window.CD = window.CD || {};

  var LS_KEY = 'cd_atty_metrics_v1';
  var MARKETPLACE_URL = 'https://thecompdesk.com/marketplace';

  // ── Async section state (fetched once per signed-in user) ────────────────
  var _net = { phase: 'idle', uid: null, leads: null, roster: null, err: null };
  var _sk  = { phase: 'idle', uid: null, items: null, err: null };

  function _client() { return CD.supa || CD.supabase || null; }

  function prefersReducedMotion() {
    try {
      return window.matchMedia &&
             window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { return false; }
  }

  function firstName(profile, user) {
    var full = (profile && profile.full_name) || '';
    if (full && full.trim()) return full.trim().split(/\s+/)[0];
    var email = (user && user.email) || '';
    if (email) return email.split('@')[0];
    return 'Counselor';
  }

  // ── Persisted self-entered metrics (with demo fallback) ─────────────────
  function loadMetrics() {
    try {
      var raw = window.localStorage.getItem(LS_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') {
          return { leads: num(p.leads), signed: num(p.signed), isDemo: false };
        }
      }
    } catch (e) {}
    // Clean DEMO fallback — a believable month for a solo WC practice.
    return { leads: 28, signed: 11, isDemo: true };
  }
  function saveMetrics(m) {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify({
        leads: num(m.leads), signed: num(m.signed)
      }));
      return true;
    } catch (e) { return false; }
  }
  function num(v) { var n = parseInt(v, 10); return (isNaN(n) || n < 0) ? 0 : n; }

  // ── SVG arc gauge ───────────────────────────────────────────────────────
  // Renders a 270° dial. `value` fills against `max`. Sweeps on render unless
  // reduced-motion is set. Returns { node, animate }.
  function makeGauge(opts) {
    var h = CD.h;
    var SIZE = 168, CX = 84, CY = 84, R = 64, STROKE = 12;
    var START = 135;            // degrees (bottom-left)
    var SWEEP = 270;            // total arc span
    var circ = 2 * Math.PI * R;
    var arcLen = circ * (SWEEP / 360);
    var max = Math.max(1, opts.max || 1);
    var frac = Math.max(0, Math.min(1, (opts.value || 0) / max));

    var ns = 'http://www.w3.org/2000/svg';
    function el(tag, attrs) {
      var n = document.createElementNS(ns, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      return n;
    }

    var svg = el('svg', {
      width: SIZE, height: SIZE, viewBox: '0 0 ' + SIZE + ' ' + SIZE,
      class: 'atty-gauge-svg', role: 'img',
      'aria-label': opts.label + ': ' + (opts.value || 0)
    });

    // Rotate so the gap sits at the bottom.
    var g = el('g', { transform: 'rotate(' + START + ' ' + CX + ' ' + CY + ')' });

    var track = el('circle', {
      cx: CX, cy: CY, r: R, fill: 'none',
      'stroke-width': STROKE, 'stroke-linecap': 'round',
      class: 'atty-gauge-track',
      'stroke-dasharray': arcLen + ' ' + circ
    });
    var fill = el('circle', {
      cx: CX, cy: CY, r: R, fill: 'none',
      'stroke-width': STROKE, 'stroke-linecap': 'round',
      class: 'atty-gauge-fill',
      'stroke-dasharray': arcLen + ' ' + circ,
      'stroke-dashoffset': arcLen   // start empty
    });
    g.appendChild(track);
    g.appendChild(fill);
    svg.appendChild(g);

    // Center readouts (mono numerics).
    var center = h('div', { className: 'atty-gauge-center' });
    var valEl = h('div', { className: 'atty-gauge-value' }, '0');
    var subEl = h('div', { className: 'atty-gauge-sub' }, opts.sub || '');
    center.appendChild(valEl);
    if (opts.sub) center.appendChild(subEl);

    var wrap = h('div', { className: 'atty-gauge' }, [svg, center]);

    var target = frac;
    var targetVal = opts.value || 0;
    var didAnimate = false;

    function animate() {
      if (didAnimate) return;   // idempotent — safe to call from rAF + timeout
      didAnimate = true;
      var reduce = prefersReducedMotion();
      var finalOffset = arcLen * (1 - target);
      if (reduce) {
        fill.style.transition = 'none';
        fill.setAttribute('stroke-dashoffset', finalOffset);
        valEl.textContent = String(targetVal);
        return;
      }
      // Reset to empty, then sweep on next frame.
      fill.style.transition = 'none';
      fill.setAttribute('stroke-dashoffset', arcLen);
      // count-up the numeric readout
      var DUR = 900, t0 = null, settled = false;
      function ease(t) { return 1 - Math.pow(1 - t, 3); }
      function settle() {
        if (settled) return;
        settled = true;
        valEl.textContent = String(targetVal);
        fill.setAttribute('stroke-dashoffset', finalOffset);
      }
      function step(ts) {
        if (settled) return;
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / DUR);
        valEl.textContent = String(Math.round(targetVal * ease(p)));
        if (p < 1) window.requestAnimationFrame(step);
        else settle();
      }
      window.requestAnimationFrame(function () {
        fill.style.transition = 'stroke-dashoffset ' + DUR + 'ms cubic-bezier(0.2,0.8,0.2,1)';
        fill.setAttribute('stroke-dashoffset', finalOffset);
        window.requestAnimationFrame(step);
      });
      // Safety net: rAF is throttled in hidden/backgrounded tabs, which would
      // otherwise leave the gauge frozen mid-sweep. Guarantee the final state.
      window.setTimeout(settle, DUR + 120);
    }

    return { node: wrap, animate: animate, setValueEl: valEl };
  }

  // ── Editable metric pill (tap to edit the self-entered number) ──────────
  function metricEditor(metrics, onChange) {
    var h = CD.h;
    function fieldRow(label, key) {
      var input = h('input', {
        className: 'atty-metric-input',
        type: 'number', min: '0', inputMode: 'numeric',
        value: String(metrics[key]),
        'aria-label': label,
        onchange: function () {
          metrics[key] = num(this.value);
          metrics.isDemo = false;
          saveMetrics(metrics);
          onChange();
        }
      });
      return h('label', { className: 'atty-metric-field' }, [
        h('span', { className: 'atty-metric-field-lbl' }, label),
        input
      ]);
    }
    return h('div', { className: 'atty-metric-editor' }, [
      fieldRow('Leads this month', 'leads'),
      fieldRow('Signed this month', 'signed')
    ]);
  }

  // ── Network pipeline data layer ─────────────────────────────────────────
  // Fetch this attorney's assigned leads + roster enrollment exactly once per
  // signed-in user. On resolve we repaint via CD.render(); the guard on
  // _net.phase keeps the metric-editor re-render (which also calls CD.render)
  // from triggering a refetch loop.
  function _ensureLeads(uid) {
    if (_net.uid !== uid) _net = { phase: 'idle', uid: uid, leads: null, roster: null, err: null };
    if (_net.phase !== 'idle') return;
    var sb = _client();
    if (!sb || !uid) { _net.phase = 'error'; _net.err = 'unavailable'; return; }
    _net.phase = 'loading';
    Promise.all([
      sb.rpc('get_my_leads'),
      sb.from('attorney_roster')
        .select('accepting_leads,lead_credits,service_counties,status,current_month_leads,max_leads_per_month')
        .limit(1).maybeSingle()
    ]).then(function (r) {
      var leadsRes = r[0] || {}, rosterRes = r[1] || {};
      if (leadsRes.error) {
        _net.phase = 'error'; _net.err = leadsRes.error.message || 'lead fetch failed';
        console.error('[atty-dash] LEADS_FETCH_FAILED', leadsRes.error);
      } else {
        _net.phase = 'ready';
        _net.leads = Array.isArray(leadsRes.data) ? leadsRes.data : [];
        // roster read is best-effort; a missing row just means "not enrolled".
        _net.roster = (rosterRes && !rosterRes.error) ? (rosterRes.data || null) : null;
      }
      if (CD.render) CD.render();
    }).catch(function (e) {
      _net.phase = 'error'; _net.err = String(e && e.message || e);
      console.error('[atty-dash] LEADS_FETCH_FAILED', e);
      if (CD.render) CD.render();
    });
  }

  function _ensureSkills(uid) {
    if (_sk.uid !== uid) _sk = { phase: 'idle', uid: uid, items: null, err: null };
    if (_sk.phase !== 'idle') return;
    var sb = _client();
    if (!sb) { _sk.phase = 'error'; _sk.err = 'unavailable'; return; }
    _sk.phase = 'loading';
    sb.from('published_skills')
      .select('slug,name,skill_md,version,published_at')
      .order('published_at', { ascending: false })
      .limit(12)
      .then(function (res) {
        if (res.error) {
          _sk.phase = 'error'; _sk.err = res.error.message || 'skill fetch failed';
          console.error('[atty-dash] SKILLS_FETCH_FAILED', res.error);
        } else {
          _sk.phase = 'ready';
          _sk.items = Array.isArray(res.data) ? res.data : [];
        }
        if (CD.render) CD.render();
      }, function (e) {
        _sk.phase = 'error'; _sk.err = String(e && e.message || e);
        console.error('[atty-dash] SKILLS_FETCH_FAILED', e);
        if (CD.render) CD.render();
      });
  }

  // Owning attorney advances a live lead (accept→contacted / retained / decline).
  function _respond(id, status) {
    var sb = _client();
    if (!sb) return;
    sb.rpc('respond_to_lead', { p_referral_id: id, p_new_status: status }).then(function (res) {
      if (res && res.error) {
        console.error('[atty-dash] RESPOND_FAILED', res.error);
        try { window.alert('Could not update this lead.\n' + (res.error.message || '')); } catch (e) {}
        return;
      }
      _net.phase = 'idle';              // force a refetch on the next paint
      if (CD.render) CD.render();
    });
  }

  // 48h response clock → { text, cls }. Date.now() is fine in app/browser.
  function _clock(deadline) {
    if (!deadline) return null;
    var ms = new Date(deadline).getTime() - Date.now();
    if (isNaN(ms)) return null;
    if (ms <= 0) return { text: 'Response overdue', cls: 'is-overdue' };
    var hrs = ms / 3600000;
    if (hrs < 6)  return { text: Math.max(1, Math.round(hrs)) + 'h left to respond', cls: 'is-urgent' };
    if (hrs < 24) return { text: Math.round(hrs) + 'h left to respond', cls: 'is-soon' };
    return { text: Math.round(hrs / 24) + 'd left to respond', cls: 'is-ok' };
  }

  function _statusMeta(s) {
    switch (s) {
      case 'assigned':  return { label: 'New — awaiting response', cls: 'is-assigned' };
      case 'contacted': return { label: 'Contacted', cls: 'is-contacted' };
      case 'retained':  return { label: 'Retained', cls: 'is-retained' };
      case 'declined':  return { label: 'Declined', cls: 'is-declined' };
      case 'expired':   return { label: 'Expired — reassigned', cls: 'is-expired' };
      default:          return { label: (s || 'pending'), cls: 'is-pending' };
    }
  }

  function _money(v) {
    var n = Number(v);
    if (!v || isNaN(n)) return null;
    try { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
    catch (e) { return '$' + Math.round(n); }
  }

  // First non-frontmatter, non-heading line of a SKILL.md as a 1-line teaser.
  function _skillExcerpt(md) {
    if (!md) return '';
    var lines = String(md).split('\n'), i = 0;
    if (lines[0] && lines[0].trim() === '---') {
      i = 1; while (i < lines.length && lines[i].trim() !== '---') i++; i++;
    }
    for (; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t || t.charAt(0) === '#') continue;
      return t.replace(/[*_`>#\[\]]/g, '').slice(0, 120);
    }
    return '';
  }

  function _isNew(publishedAt) {
    if (!publishedAt) return false;
    var ms = Date.now() - new Date(publishedAt).getTime();
    return !isNaN(ms) && ms >= 0 && ms < 14 * 24 * 3600 * 1000;
  }

  function _sectionHd(title, action) {
    var h = CD.h;
    var kids = [h('span', { className: 'atty-section-title' }, title)];
    if (action) {
      kids.push(h('button', {
        className: 'atty-section-action', onclick: action.onClick
      }, action.label));
    }
    return h('div', { className: 'atty-section-hd' }, kids);
  }

  // ── Section A — Network Leads (real referral pipeline) ───────────────────
  function renderNetworkSection(ctx) {
    var h = ctx.h;
    var wrap = h('div', { className: 'atty-net' });
    wrap.appendChild(_sectionHd('Network Leads'));

    var panel = h('div', { className: 'atty-net-panel' });

    if (_net.phase === 'loading' || _net.phase === 'idle') {
      panel.appendChild(h('div', { className: 'atty-net-skel' }, [
        h('div', { className: 'atty-net-skel-row' }),
        h('div', { className: 'atty-net-skel-row' })
      ]));
      wrap.appendChild(panel);
      return wrap;
    }

    if (_net.phase === 'error') {
      panel.appendChild(h('div', { className: 'atty-net-empty' }, [
        h('div', { className: 'atty-net-empty-ico', 'aria-hidden': 'true' }, '⚠️'),
        h('div', { className: 'atty-net-empty-title' }, 'Couldn’t load your leads'),
        h('div', { className: 'atty-net-empty-sub' },
          'We hit an error reading the referral pipeline. Pull to refresh or try again shortly.'),
        h('button', { className: 'atty-net-retry', onclick: function () { _net.phase = 'idle'; if (CD.render) CD.render(); } }, 'Retry')
      ]));
      wrap.appendChild(panel);
      return wrap;
    }

    var leads = _net.leads || [];
    var roster = _net.roster;

    // Summary chips — true counts from the live data.
    var liveCount = leads.filter(function (l) { return l.status === 'assigned'; }).length;
    var retainedCount = leads.filter(function (l) { return l.status === 'retained'; }).length;
    if (leads.length) {
      var chips = h('div', { className: 'atty-net-chips' });
      chips.appendChild(h('span', { className: 'atty-net-chip is-live' }, liveCount + ' awaiting response'));
      chips.appendChild(h('span', { className: 'atty-net-chip' }, leads.length + ' total'));
      if (retainedCount) chips.appendChild(h('span', { className: 'atty-net-chip is-won' }, retainedCount + ' retained'));
      panel.appendChild(chips);
    }

    if (!leads.length) {
      // Honest, actionable empty-state keyed on roster enrollment.
      var enrolled = roster && roster.status === 'active' && roster.accepting_leads;
      var ico, title, sub, cta = null;
      if (!roster) {
        ico = '🤝'; title = 'You’re not in the referral network yet';
        sub = 'The Comp Desk routes injured-worker leads to enrolled attorneys by county on a neutral round-robin. Join the network to start receiving leads here.';
        cta = { label: 'Join the referral network', onClick: function () { try { window.open(MARKETPLACE_URL.replace('/marketplace', '/attorneys'), '_blank'); } catch (e) {} } };
      } else if (!enrolled) {
        ico = '⏸️'; title = 'Lead intake is paused';
        sub = (roster.status !== 'active')
          ? 'Your roster account isn’t active yet. Once approved, new leads will appear here with a 48-hour response clock.'
          : 'You’ve paused accepting leads. New referrals will resume here when you turn intake back on.';
      } else {
        ico = '📭'; title = 'No leads right now';
        sub = 'You’re enrolled and accepting leads' +
          (roster.service_counties && roster.service_counties.length ? ' in ' + roster.service_counties.slice(0, 3).join(', ') + (roster.service_counties.length > 3 ? '…' : '') : '') +
          '. New referrals appear here the moment they’re assigned, each with a 48-hour response clock.';
      }
      var empty = h('div', { className: 'atty-net-empty' }, [
        h('div', { className: 'atty-net-empty-ico', 'aria-hidden': 'true' }, ico),
        h('div', { className: 'atty-net-empty-title' }, title),
        h('div', { className: 'atty-net-empty-sub' }, sub)
      ]);
      if (roster && enrolled && typeof roster.lead_credits === 'number') {
        empty.appendChild(h('div', { className: 'atty-net-credits' },
          roster.lead_credits + ' lead credit' + (roster.lead_credits === 1 ? '' : 's') + ' remaining'));
      }
      if (cta) empty.appendChild(h('button', { className: 'atty-net-retry', onclick: cta.onClick }, cta.label));
      panel.appendChild(empty);
    } else {
      var list = h('div', { className: 'atty-lead-list' });
      leads.forEach(function (l) { list.appendChild(_leadCard(ctx, l)); });
      panel.appendChild(list);
    }

    wrap.appendChild(panel);

    // Network co-counsel cases — no dedicated table yet. Honest empty-state,
    // never fabricated rows.
    var coc = h('div', { className: 'atty-net-coc' }, [
      h('div', { className: 'atty-net-coc-hd' }, 'Network co-counsel cases'),
      h('div', { className: 'atty-net-coc-sub' },
        'No network co-counsel cases yet. Cases you take on jointly through The Comp Desk will appear here once that program is live.')
    ]);
    wrap.appendChild(coc);

    return wrap;
  }

  function _leadCard(ctx, l) {
    var h = ctx.h;
    var sm = _statusMeta(l.status);
    var card = h('div', { className: 'atty-lead-card ' + sm.cls });

    var top = h('div', { className: 'atty-lead-top' });
    top.appendChild(h('div', { className: 'atty-lead-name' }, l.worker_name || 'New referral'));
    top.appendChild(h('span', { className: 'atty-lead-status ' + sm.cls }, sm.label));
    card.appendChild(top);

    // 48h clock — only meaningful while the lead is live (assigned).
    if (l.status === 'assigned') {
      var clk = _clock(l.response_deadline);
      if (clk) card.appendChild(h('div', { className: 'atty-lead-clock ' + clk.cls }, [
        h('span', { className: 'atty-lead-clock-ico', 'aria-hidden': 'true' }, '⏱'),
        h('span', null, clk.text)
      ]));
    }

    // Meta rows — only render fields that actually exist.
    var meta = h('div', { className: 'atty-lead-meta' });
    function metaRow(label, val) {
      if (!val) return;
      meta.appendChild(h('div', { className: 'atty-lead-meta-row' }, [
        h('span', { className: 'atty-lead-meta-lbl' }, label),
        h('span', { className: 'atty-lead-meta-val' }, val)
      ]));
    }
    metaRow('County', l.worker_county);
    metaRow('Case type', l.case_type || (l.body_part ? 'Workers’ Comp' : null));
    metaRow('Body part', l.body_part);
    metaRow('Est. value', _money(l.estimated_value));
    metaRow('WCB #', l.wcb_case_number);
    if (meta.childNodes.length) card.appendChild(meta);

    // Contact actions — only when the lead is actionable (assigned/contacted).
    if (l.status === 'assigned' || l.status === 'contacted') {
      var actions = h('div', { className: 'atty-lead-actions' });
      if (l.worker_phone) {
        actions.appendChild(h('a', { className: 'atty-lead-btn is-call', href: 'tel:' + l.worker_phone }, '📞 Call'));
      }
      if (l.worker_email) {
        actions.appendChild(h('a', {
          className: 'atty-lead-btn is-email',
          href: 'mailto:' + l.worker_email + '?subject=' + encodeURIComponent('Your Workers’ Compensation claim')
        }, '✉️ Email'));
      }
      if (l.status === 'assigned') {
        actions.appendChild(h('button', { className: 'atty-lead-btn is-accept', onclick: function () { _respond(l.id, 'contacted'); } }, 'Accept'));
        actions.appendChild(h('button', { className: 'atty-lead-btn is-decline', onclick: function () {
          try { if (!window.confirm('Decline this lead? It will be released for reassignment.')) return; } catch (e) {}
          _respond(l.id, 'declined');
        } }, 'Decline'));
      } else { // contacted
        actions.appendChild(h('button', { className: 'atty-lead-btn is-accept', onclick: function () { _respond(l.id, 'retained'); } }, 'Mark retained'));
      }
      card.appendChild(actions);
    }

    return card;
  }

  // ── Section C — Review new skills (live published_skills catalog) ─────────
  function renderSkillsSection(ctx) {
    var h = ctx.h;
    var wrap = h('div', { className: 'atty-skills' });
    wrap.appendChild(_sectionHd('Review New Skills', {
      label: 'Marketplace →',
      onClick: function () { try { window.open(MARKETPLACE_URL, '_blank'); } catch (e) { window.location.href = '/marketplace'; } }
    }));

    if (_sk.phase === 'loading' || _sk.phase === 'idle') {
      wrap.appendChild(h('div', { className: 'atty-skills-grid' }, [
        h('div', { className: 'atty-skill-card atty-skill-skel' }),
        h('div', { className: 'atty-skill-card atty-skill-skel' })
      ]));
      return wrap;
    }

    if (_sk.phase === 'error') {
      wrap.appendChild(h('div', { className: 'atty-skills-empty' }, [
        h('div', { className: 'atty-skills-empty-title' }, 'Couldn’t load the skills catalog'),
        h('button', { className: 'atty-net-retry', onclick: function () { _sk.phase = 'idle'; if (CD.render) CD.render(); } }, 'Retry')
      ]));
      return wrap;
    }

    var items = _sk.items || [];
    if (!items.length) {
      // Catalog table is live but empty — be honest, point to the marketplace.
      wrap.appendChild(h('div', { className: 'atty-skills-empty' }, [
        h('div', { className: 'atty-skills-empty-ico', 'aria-hidden': 'true' }, '✨'),
        h('div', { className: 'atty-skills-empty-title' }, 'No published skills yet'),
        h('div', { className: 'atty-skills-empty-sub' },
          'The Comp Desk skills marketplace is being built. When new attorney skills go live, they’ll show up here with a “New” badge.'),
        h('button', {
          className: 'atty-net-retry',
          onclick: function () { try { window.open(MARKETPLACE_URL, '_blank'); } catch (e) { window.location.href = '/marketplace'; } }
        }, 'Explore the marketplace')
      ]));
      return wrap;
    }

    var grid = h('div', { className: 'atty-skills-grid' });
    items.forEach(function (s) {
      var card = h('div', { className: 'atty-skill-card atty-clickable', onclick: function () {
        var url = MARKETPLACE_URL + '/' + encodeURIComponent(s.slug || '');
        try { window.open(url, '_blank'); } catch (e) { window.location.href = '/marketplace'; }
      } });
      var hd = h('div', { className: 'atty-skill-hd' });
      hd.appendChild(h('div', { className: 'atty-skill-name' }, s.name || s.slug || 'Skill'));
      if (_isNew(s.published_at)) hd.appendChild(h('span', { className: 'atty-skill-new' }, 'New'));
      card.appendChild(hd);
      var ex = _skillExcerpt(s.skill_md);
      if (ex) card.appendChild(h('div', { className: 'atty-skill-desc' }, ex));
      card.appendChild(h('div', { className: 'atty-skill-foot' }, [
        h('span', { className: 'atty-skill-ver' }, 'v' + (s.version || 1)),
        h('span', { className: 'atty-skill-cta' }, 'View →')
      ]));
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  CD.AttorneyDashboard = {
    render: function (ctx) {
      // Defensive: only own the ATTORNEY dashboard. If somehow called for a
      // worker, fall through to the controller fallback.
      if (CD.isWorker && CD.isWorker()) return null;

      var h = ctx.h, showScreen = ctx.showScreen, goToCalc = ctx.goToCalc;
      var hasAccess = ctx.hasAccess, handleUpgrade = ctx.handleUpgrade;
      var tier = ctx.tier;
      // Defensive: adopt the client from ctx if the globals aren't wired yet.
      if (ctx.supabase && !CD.supa && !CD.supabase) CD.supa = ctx.supabase;

      var cont = h('div', { className: 'dash-container atty-dash' });
      var gauges = [];   // collect for sweep-on-render

      // ── 1. Hero greeting ────────────────────────────────────────────────
      var hero = h('div', { className: 'atty-hero' });
      hero.appendChild(h('div', { className: 'atty-hero-eyebrow' }, 'Pro Workspace'));
      hero.appendChild(h('h1', { className: 'atty-hero-title' },
        'Welcome back, ' + firstName(ctx.profile, ctx.user)));
      var badgeRow = h('div', { className: 'atty-hero-badges' });
      badgeRow.appendChild(h('span', { className: 'atty-badge' }, 'Attorney'));
      if (tier === 'firm') badgeRow.appendChild(h('span', { className: 'atty-badge atty-badge-firm' }, 'Firm'));
      else if (tier === 'pro') badgeRow.appendChild(h('span', { className: 'atty-badge atty-badge-pro' }, 'Pro'));
      hero.appendChild(badgeRow);
      cont.appendChild(hero);

      // ── A. Network Leads (real referral pipeline) ───────────────────────
      // Kick the one-time fetches for this user, then render from current state.
      var uid = (ctx.user && ctx.user.id) || null;
      _ensureLeads(uid);
      _ensureSkills(uid);
      cont.appendChild(renderNetworkSection(ctx));

      // ── 2 + 3. Leads & Signed gauges ────────────────────────────────────
      var metrics = loadMetrics();
      var conversion = metrics.leads > 0
        ? Math.round((metrics.signed / metrics.leads) * 100)
        : 0;

      var panel = h('div', { className: 'atty-metrics-panel' });
      var panelHd = h('div', { className: 'atty-section-hd' }, [
        h('span', { className: 'atty-section-title' }, 'This Month'),
        metrics.isDemo
          ? h('span', { className: 'atty-demo-tag', title: 'Sample data — enter your own numbers below' }, 'DEMO')
          : null
      ]);
      panel.appendChild(panelHd);

      var gaugeRow = h('div', { className: 'atty-gauge-row' });

      // Leads gauge — scale max to a sensible ceiling above the value.
      var leadsMax = Math.max(20, Math.ceil((metrics.leads + 1) / 10) * 10);
      var leadsG = makeGauge({ value: metrics.leads, max: leadsMax, label: 'Leads received', sub: 'leads' });
      gauges.push(leadsG);
      var leadsCard = h('div', { className: 'atty-gauge-card' }, [
        h('div', { className: 'atty-gauge-card-title' }, 'Leads Received'),
        leadsG.node
      ]);
      gaugeRow.appendChild(leadsCard);

      // Signed gauge — max = leads (so it reads as "of the leads, this many signed").
      var signedMax = Math.max(leadsMax, metrics.leads || 1);
      var signedG = makeGauge({ value: metrics.signed, max: signedMax, label: 'Clients signed', sub: 'signed' });
      gauges.push(signedG);
      var signedCard = h('div', { className: 'atty-gauge-card' }, [
        h('div', { className: 'atty-gauge-card-title' }, 'Signed'),
        signedG.node,
        h('div', { className: 'atty-conversion' }, [
          h('span', { className: 'atty-conversion-num' }, conversion + '%'),
          h('span', { className: 'atty-conversion-lbl' }, 'conversion')
        ])
      ]);
      gaugeRow.appendChild(signedCard);

      panel.appendChild(gaugeRow);
      panel.appendChild(metricEditor(metrics, function () {
        // Re-render the whole dashboard so gauges + conversion recompute/sweep.
        if (CD.render) CD.render();
      }));
      cont.appendChild(panel);

      // ── 4. Quick links into the revamped calculator ─────────────────────
      cont.appendChild(h('div', { className: 'atty-section-hd' },
        h('span', { className: 'atty-section-title' }, 'Quick Calc')));
      // CCP / SLU Fee / LWEC live inside the `fee` tab (CD.S.sub); AWW is its
      // own top tab; Settlement is its own screen.
      var quick = [
        { label: 'CCP / Award', hint: 'Counsel fee', go: function () { if (CD.S) CD.S.sub = 'ccp'; goToCalc('fee'); } },
        { label: 'SLU Fee', hint: 'Schedule loss', go: function () { if (CD.S) CD.S.sub = 'slu'; goToCalc('fee'); } },
        { label: 'LWEC', hint: 'Wage-earning cap.', go: function () { if (CD.S) CD.S.sub = 'lwec'; goToCalc('fee'); } },
        { label: 'AWW', hint: 'Avg weekly wage', go: function () { goToCalc('aww'); } },
        { label: 'Settlement', hint: 'Section 32 compare', go: function () { showScreen('settlement'); } }
      ];
      var quickList = h('div', { className: 'atty-quick-list' });
      quick.forEach(function (q) {
        var item = h('button', { className: 'atty-quick-item', onclick: q.go });
        item.appendChild(h('span', { className: 'atty-quick-label' }, q.label));
        item.appendChild(h('span', { className: 'atty-quick-hint' }, q.hint));
        item.appendChild(h('span', { className: 'atty-quick-arrow', 'aria-hidden': 'true' }, '→'));
        quickList.appendChild(item);
      });
      cont.appendChild(quickList);

      // ── Free-tier upgrade banner (ported) ───────────────────────────────
      if (tier === 'free') {
        var ban = h('div', { className: 'atty-upgrade-banner' });
        ban.appendChild(h('h3', null, 'Unlock the Pro Workspace'));
        ban.appendChild(h('p', null, 'Saved cases, the OC-400.1 fee app, SLU & Non-Schedule tools, and more.'));
        ban.appendChild(h('button', {
          className: 'atty-upgrade-btn',
          onclick: function () { handleUpgrade && handleUpgrade('pro'); }
        }, 'Upgrade to Pro — $9.99/mo'));
        cont.appendChild(ban);
      }

      // ── 5. Ported attorney feature grid (reskinned) ─────────────────────
      cont.appendChild(h('div', { className: 'atty-section-hd' },
        h('span', { className: 'atty-section-title' }, 'Tools')));
      var features = [
        { icon: '🗂️', title: 'Pro Workspace', desc: 'AWW, CCP, SLU, LWEC & fee tools', tier: 'pro', screen: 'calculator' },
        { icon: '🧾', title: 'OC-400.1 Fee App', desc: 'Generate the counsel fee application', tier: 'pro',
          go: function () { if (CD.S) CD.S.sub = 'ccp'; goToCalc('fee'); } },
        { icon: '📝', title: 'C-3 / C-3.3 Generator', desc: 'Guided claim-filing forms', tier: 'pro', screen: 'c3' },
        { icon: '🧮', title: 'Calculator', desc: 'AWW, Fees, SLU & more', tier: 'free', screen: 'calculator' },
        { icon: '⚖️', title: 'Settlement Comparison', desc: 'Compare settlement values', tier: 'comp_buddy', screen: 'settlement' },
        { icon: '📚', title: 'Learning Portal', desc: 'WC glossary, FAQ, timeline', tier: 'free', screen: 'learning' },
        { icon: '🏥', title: 'Find a Doctor', desc: 'Find WCB-authorized doctors', tier: 'free', screen: 'doctor' },
        { icon: '🔔', title: 'IME Reminders', desc: 'Never miss an IME appointment', tier: 'comp_buddy', screen: 'ime' },
        { icon: '🛠️', title: 'Injury Tools', desc: 'SLU estimator, radiculopathy & more', tier: 'comp_buddy', screen: 'advanced_tools' },
        { icon: '📋', title: 'UTDM Monitoring', desc: 'Track medical updates', tier: 'comp_buddy', screen: null, comingSoon: true },
        { icon: '🎯', title: 'Client Work Search', desc: 'Clients’ C-258.1 logs + LMA packets', tier: 'firm', screen: 'firm_job_buddy' }
      ];
      var grid = h('div', { className: 'atty-feature-grid' });
      features.forEach(function (f) {
        var locked = !f.comingSoon && !hasAccess(f.tier);
        var card = h('div', { className: 'atty-feature-card' + (locked ? ' atty-locked' : '') });
        if (f.comingSoon) card.appendChild(h('div', { className: 'atty-feature-flag' }, 'Soon'));
        else if (locked) card.appendChild(h('div', { className: 'atty-feature-lock', 'aria-hidden': 'true' }, '🔒'));
        card.appendChild(h('div', { className: 'atty-feature-icon', 'aria-hidden': 'true' }, f.icon));
        card.appendChild(h('div', { className: 'atty-feature-title' }, f.title));
        card.appendChild(h('div', { className: 'atty-feature-desc' }, f.desc));
        var tierLabel = ({ free: 'Free', comp_buddy: 'Comp Buddy', pro: 'Pro', firm: 'Firm' })[f.tier] || 'Pro';
        card.appendChild(h('div', { className: 'atty-feature-foot' },
          h('span', { className: 'atty-tier-badge ' + (f.tier === 'free' ? 'is-free' : 'is-paid') }, tierLabel)));
        if (!f.comingSoon && !locked && (f.go || f.screen)) {
          card.classList.add('atty-clickable');
          card.onclick = f.go ? f.go : function () { showScreen(f.screen); };
        } else if (locked) {
          card.classList.add('atty-clickable');
          card.onclick = function () { handleUpgrade && handleUpgrade(f.tier === 'firm' ? 'firm' : (f.tier === 'comp_buddy' ? 'comp_buddy' : 'pro')); };
        }
        grid.appendChild(card);
      });
      cont.appendChild(grid);

      // ── C. Review New Skills (live marketplace catalog) ─────────────────
      cont.appendChild(renderSkillsSection(ctx));

      // ── Firm Management card (firm tier only) ───────────────────────────
      if (tier === 'firm') {
        cont.appendChild(h('div', { className: 'atty-section-hd' },
          h('span', { className: 'atty-section-title' }, 'Firm Management')));
        var firmCard = h('div', {
          className: 'atty-firm-card atty-clickable',
          onclick: function () { showScreen('firm_admin'); }
        });
        firmCard.appendChild(h('div', { className: 'atty-firm-icon', 'aria-hidden': 'true' }, '🏢'));
        firmCard.appendChild(h('div', { className: 'atty-firm-body' }, [
          h('div', { className: 'atty-firm-title' }, 'Manage Firm'),
          h('div', { className: 'atty-firm-desc' }, 'Invite attorneys, manage seats')
        ]));
        firmCard.appendChild(h('span', { className: 'atty-quick-arrow', 'aria-hidden': 'true' }, '→'));
        cont.appendChild(firmCard);
      }

      // ── Disclaimer ──────────────────────────────────────────────────────
      cont.appendChild(h('div', { className: 'v13-disclaimer atty-disclaimer' },
        'This tool is for informational purposes only and does not constitute legal advice.'));

      // ── Sweep gauges once the node is in the DOM ────────────────────────
      // rAF gives a smooth on-paint start; the timeout is a safety net for
      // hidden/backgrounded tabs where rAF is paused (animate() is idempotent).
      window.requestAnimationFrame(function () {
        gauges.forEach(function (g) { g.animate(); });
      });
      window.setTimeout(function () {
        gauges.forEach(function (g) { g.animate(); });
      }, 80);

      return cont;
    }
  };
})(window, document);
