/* ============================================================================
 * worker-dashboard.js — CD.WorkerDashboard (injured-worker home)
 * ----------------------------------------------------------------------------
 * OWNER: Worker dashboard agent. See ops/dev/APP_REDESIGN_SPEC.md §6.
 * Also owns: www/css/dashboard-worker.css and js/recovery/mini.js.
 *
 * CONTRACT (FOUNDATION wires to this — do not change the signature):
 *   window.CD.WorkerDashboard.render(ctx) -> DOMNode | null
 *     Returns the .dash-container node to take over rendering, or null to fall
 *     through to ui-controller's legacy fallback.
 *   ctx = { profile, user, tier, h, card, f$, showScreen, handleUpgrade,
 *           openAttorneyIntake, hasAccess, goToCalc }
 *
 * Renders on the WORKER (light/warm) skin. Sections top→bottom (spec §6):
 *   1. Hero greeting          5. Appointments summary
 *   2. Road-to-Recovery mini  6. Free tools + Comp Buddy grids, attorney CTA,
 *   3. Benefit tracker           upgrade banner
 *   4. Disability gauge (tied to the benefit tracker)
 *
 * DATA POLICY: self-entered + demo fallback. Real values persist to existing
 * profile columns (current_aww) where they exist; new values (disability %,
 * self-entered weekly payment, next payment date) use localStorage keyed per
 * user. TODO(migration): add `disability_pct`, `next_payment_date`,
 * `self_weekly_benefit` columns to `profiles` so these sync across devices.
 *
 * Every animation gates on prefers-reduced-motion (CSS on --rhythm-* + a JS
 * guard). Gauges/money re-animate each time the dashboard is rendered.
 * ==========================================================================*/
(function (window) {
  'use strict';
  var CD = window.CD = window.CD || {};
  var document = window.document;

  // Resolved per-render (not module load) so a locale switch re-reads it.
  var DISCLAIMER_EN = 'This tool is for informational purposes only and does not constitute legal advice.';
  function DISCLAIMER_T() { return CD.t('legal.informationalOnly', null, DISCLAIMER_EN); }
  var LS_PREFIX = 'cd_worker_dash_v1::';
  var WORK_STATUS_LABELS = {
    working: 'Working (full duty)', light_duty: 'Light duty',
    not_working: 'Not working', terminated: 'Terminated'
  };

  // ── local-state helpers (self-entered values not yet in the DB) ───────────
  function _lsKey() {
    return LS_PREFIX + ((CD.currentUser && CD.currentUser.id) || 'anon');
  }
  function _readLocal() {
    try { return JSON.parse(window.localStorage.getItem(_lsKey()) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function _writeLocal(patch) {
    try {
      var cur = _readLocal();
      Object.keys(patch || {}).forEach(function (k) { cur[k] = patch[k]; });
      window.localStorage.setItem(_lsKey(), JSON.stringify(cur));
      return cur;
    } catch (e) { return _readLocal(); }
  }

  function _reduced() {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  function _firstName(profile, user) {
    var full = (profile && profile.full_name) || '';
    full = String(full).trim();
    if (full) return full.split(/\s+/)[0];
    var email = (user && user.email) || (profile && profile.email) || '';
    if (email) return String(email).split('@')[0];
    return 'there';
  }

  // 2/3 weekly rate capped at the statutory max for the DOA. Uses the shared
  // calc-core (CD.Calc.maxRateForDOA — single source of truth) when reachable;
  // falls back to the current-period max. NOTE: current_aww may be a STRING —
  // Number() before any math.
  function _maxForDOA(doa) {
    try {
      if (doa && CD.Calc && CD.Calc.maxRateForDOA) { var m = CD.Calc.maxRateForDOA(doa); if (m) return m; }
    } catch (e) {}
    return _cap();
  }
  function _cap() {
    try {
      var today = new Date().toISOString().slice(0, 10);
      if (CD.Calc && CD.Calc.maxRateForDOA) { var mc = CD.Calc.maxRateForDOA(today); if (mc) return mc; }
      if (CD.getMax) { var r = CD.getMax(today); if (r && r.max) return r.max; }
      if (CD.MAX_RATES && CD.MAX_RATES[0]) return CD.MAX_RATES[0].max;
    } catch (e) {}
    return 1281.50; // sane fallback = current-period max
  }
  function _weeklyRate(aww, doa) {
    var n = Number(aww);                       // coerce string AWW (bug fix)
    if (!isFinite(n) || n <= 0) return 0;
    return Math.min((n * 2) / 3, _maxForDOA(doa));
  }

  // ── public entry ──────────────────────────────────────────────────────────
  function render(ctx) {
    ctx = ctx || {};
    var h = ctx.h, card = ctx.card, f$ = ctx.f$;
    if (!h) return null; // need the DOM helper to build anything

    var profile = ctx.profile || CD.currentProfile || {};
    var user = ctx.user || CD.currentUser || null;
    var tier = ctx.tier || CD.currentTier || 'free';
    var showScreen = ctx.showScreen || CD.showScreen || function () {};
    var hasAccess = ctx.hasAccess || CD.hasAccess || function () { return false; };
    var handleUpgrade = ctx.handleUpgrade || CD.handleUpgrade || function () {};
    var openAttorneyIntake = ctx.openAttorneyIntake || CD.openAttorneyIntake || function () {};
    var local = _readLocal();
    var reduced = _reduced();

    // Aurora Glass 2E — reveal the shared field (glass-0), the same way
    // CD.AdaptiveDashboard does. INERT ON THE WEBSITE: this file is vendored
    // there by ops/website/sync-dashboard.sh, and the site has neither the
    // .ag-field element nor aurora-glass.css, so the class matches nothing.
    // The attorney Command Center deliberately does NOT do this — it carries
    // its own .cc-bg aurora, now fed from the same --v3-* tokens, and two
    // fields stacked would be two fields.
    try { document.body.classList.add('ag-field-on'); } catch (e) { /* no-op */ }

    var cont = h('div', { className: 'dash-container worker-dash' });

    // ── 1. HERO GREETING ──────────────────────────────────────────────────
    // Guests (no account) get a generic welcome with NO name — never "Welcome
    // back, there". Known users keep the personalized greeting.
    var _known = !!((profile && profile.full_name) || (user && user.email));
    var hero = h('section', { className: 'wd-hero' }, [
      h('div', { className: 'wd-hero-eyebrow' }, 'Comp Buddy · The Comp Desk'),
      h('h1', { className: 'wd-hero-title' },
        _known
          ? [CD.t('dashboard.welcomeBack', null, 'Welcome back, '), h('span', { className: 'wd-hero-name' }, _firstName(profile, user))]
          : [CD.t('dashboard.welcome', null, 'Welcome')]),
      h('div', { className: 'wd-hero-sub' }, [
        h('span', { className: 'wd-badge worker-badge' }, '👷 ' + CD.t('dashboard.badgeWorker', null, 'Injured Worker')),
        h('span', { className: 'wd-hero-tagline' }, _known ? CD.t('dashboard.taglineKnown', null, 'Here\u2019s where your case stands today. Take it one step at a time.') : CD.t('dashboard.taglineNew', null, 'Start your claim and learn your rights. Take it one step at a time.'))
      ])
    ]);
    cont.appendChild(hero);

    // ── 1a. FEATURE SPOTLIGHT (Calm Path) ─────────────────────────────────
    // The signature "Calm Path" header element: a gentle, auto-rotating
    // spotlight of the core free features. Sits between the greeting and the
    // primary claim CTA; every slide opens its feature via showScreen().
    cont.appendChild(_featureSpotlight(h, showScreen, reduced, openAttorneyIntake));

    // ── 1b. PRIMARY CTA — "Start your WC claim" (the visual #1 action) ─────
    // Launches the C-3 (Employee Claim) wizard directly. Works for guests:
    // CD.C3Wizard runs an anonymous mode that generates the filled PDF for
    // local download — no sign-in required. The four secondary entries below
    // are all free per the locked gating and all work anonymously.
    var claimCard = h('div', { className: 'wd-claim-card' }, [
      h('div', { className: 'wd-claim-head' }, [
        h('span', { className: 'wd-claim-icon', 'aria-hidden': 'true' }, '📝'),
        h('div', { className: 'wd-claim-copy' }, [
          h('div', { className: 'wd-claim-eyebrow' }, CD.t('dashboard.claimEyebrow', null, 'Injured on the job?')),
          h('p', { className: 'wd-claim-sub' },
            CD.t('dashboard.claimSub', null, 'File your official C-3 Employee Claim with the NYS Workers\u2019 Compensation Board — guided step by step. Free, no account needed.'))
        ])
      ]),
      h('button', {
        type: 'button', className: 'wd-btn wd-btn-accent wd-claim-btn',
        onclick: function () { showScreen('c3'); }
      }, '📝  ' + CD.t('dashboard.startClaimBtn', null, 'Start your Workers\u2019 Compensation Claim'))
    ]);
    cont.appendChild(h('section', { className: 'wd-section wd-claim' }, claimCard));

    // Secondary quick-entries under the primary CTA — all free, all guest-safe.
    var quickGrid = h('div', { className: 'wd-grid wd-claim-secondary' });
    [
      // GLOSSARY (P2-4): a friendly on-ramp for first-timers → the Learning Portal
      // (/learn: glossary, rights, timeline); Road to Recovery sits right beside it.
      { icon: '📖', title: CD.t('dashboard.tileNewToComp', null, 'New to workers\u2019 comp?'), desc: CD.t('dashboard.descNewToComp', null, 'Start here — glossary, your rights & the road ahead'), screen: 'learning' },
      { icon: '🎯', title: 'Job Buddy', desc: CD.t('dashboard.descJobBuddy', null, 'Find work within your restrictions + C-258.1 log'), screen: 'job_buddy' },
      { icon: '🛣️', title: 'Road to Recovery', desc: CD.t('dashboard.descRecovery', null, 'See every step of your case'), screen: 'recovery' },
      { icon: '🏥', title: CD.t('dashboard.tileFindDoctor', null, 'Find a Doctor'), desc: CD.t('dashboard.descFindDoctor', null, 'Find WCB-authorized doctors'), screen: 'doctor' },
      { icon: '📚', title: CD.t('dashboard.tileLearningPortal', null, 'Learning Portal'), desc: CD.t('dashboard.descLearningPortal', null, 'WC glossary, FAQ & timeline'), screen: 'learning' }
    ].forEach(function (q) {
      quickGrid.appendChild(_featureCard(h, {
        icon: q.icon, title: q.title, desc: q.desc, badge: CD.t('dashboard.badgeFree', null, 'Free'), badgeCls: 'is-free',
        onClick: function () { showScreen(q.screen); }
      }));
    });
    cont.appendChild(h('section', { className: 'wd-section' }, quickGrid));

    // ── 2. ROAD-TO-RECOVERY MINI-MAP ──────────────────────────────────────
    var recWrap = h('section', { className: 'wd-section wd-recovery' });
    var recMount = h('div', { className: 'wd-recovery-mount' });
    recWrap.appendChild(recMount);
    cont.appendChild(recWrap);
    try {
      if (CD.Recovery && typeof CD.Recovery.renderMini === 'function') {
        CD.Recovery.renderMini(recMount, { onOpen: function () { showScreen('recovery'); } });
      } else {
        recMount.appendChild(_recoveryFallback(h, showScreen));
      }
    } catch (e) {
      console.error('[worker-dash] RECOVERY_MINI_FAILED', e);
      recMount.appendChild(_recoveryFallback(h, showScreen));
    }

    // ── 3 + 4. BENEFIT TRACKER + DISABILITY GAUGE (true-state) ────────────
    // AWW is read ONLY from the real profile column — no placeholder/demo value
    // is ever shown. Missing → actionable empty-state that launches the AWW
    // Wizard. Present → the real AWW + the weekly rate it drives (⅔ × AWW capped
    // at the DOA max via CD.Calc.maxRateForDOA(doa)).
    var doa = (profile && profile.doa) || null;
    var awwRaw = (profile && profile.current_aww != null && String(profile.current_aww).trim() !== '' && Number(profile.current_aww) > 0)
      ? Number(profile.current_aww) : null;

    var benefit = null, gauge = null;
    if (awwRaw == null) {
      cont.appendChild(h('section', { className: 'wd-section' }, _awwEmptyState(h, reduced, showScreen)));
    } else {
      // Self-entered degree of disability refines the estimate; defaults to 100%
      // (total disability) — that's the real statutory ⅔ rate, not a sample.
      var disPct = (local.disability_pct != null && isFinite(Number(local.disability_pct))) ? Number(local.disability_pct) : 100;
      disPct = Math.max(0, Math.min(100, disPct));

      var fullRate = _weeklyRate(awwRaw, doa);             // 2/3 capped (total disability)
      var trackerGauge = h('div', { className: 'wd-tg-grid' });
      var moneyState = { fullRate: fullRate, disPct: disPct, awwRaw: awwRaw, awwDemo: false, disDemo: false, doa: doa };

      benefit = _benefitTracker(h, card, f$, moneyState, reduced, showScreen, local);
      gauge = _disabilityGauge(h, f$, moneyState, reduced, function (newPct) {
        // user changed the gauge → persist + relink the tracker figure
        moneyState.disPct = newPct;
        _writeLocal({ disability_pct: newPct });
        benefit.update();
      });

      trackerGauge.appendChild(benefit.node);
      trackerGauge.appendChild(gauge.node);
      cont.appendChild(h('section', { className: 'wd-section' }, trackerGauge));
    }

    // ── 4b. CASE SNAPSHOT + NEXT STEPS (true-state adaptive) ──────────────
    // Each row is driven off a real profile field: present values render as a
    // snapshot, missing values render as actionable empty-state next-steps.
    cont.appendChild(h('section', { className: 'wd-section' }, _caseStatus(h, profile, showScreen, openAttorneyIntake)));

    // ── 4c. TALK TO AN ATTORNEY (video consult) ───────────────────────────
    // Delegated to CD.Consult so the booking flow + styling live in one module
    // (mirrors the CD.Recovery / CD.AttorneyCTA delegation above). Opens the
    // 'consult' screen: pick a slot → details → pay (if priced) → join a
    // Whereby video room. Absent module → section is simply skipped.
    try {
      if (CD.Consult && typeof CD.Consult.workerPromoCard === 'function') {
        var consultCard = CD.Consult.workerPromoCard({ h: h, showScreen: showScreen, profile: profile, user: user });
        if (consultCard) cont.appendChild(h('section', { className: 'wd-section' }, consultCard));
      }
    } catch (e) { console.error('[worker-dash] CONSULT_PROMO_FAILED', e); }

    // ── 5. APPOINTMENTS SUMMARY ───────────────────────────────────────────
    var apptCard = h('div', { className: 'wd-card wd-appts' });
    apptCard.appendChild(h('div', { className: 'wd-card-hd' }, [
      h('h2', { className: 'wd-card-title' }, '📅 ' + CD.t('dashboard.upcomingAppointments', null, 'Upcoming appointments')),
      h('button', {
        type: 'button', className: 'wd-link-btn',
        onclick: function () { showScreen('appointments'); }
      }, CD.t('dashboard.viewCalendar', null, 'View calendar →'))
    ]));
    var apptMount = h('div', { className: 'wd-appts-mount' });
    apptCard.appendChild(apptMount);
    apptCard.appendChild(h('button', {
      type: 'button', className: 'wd-btn wd-btn-ghost wd-appts-add',
      onclick: function () { showScreen('appointments'); }
    }, '+ ' + CD.t('dashboard.addAppointment', null, 'Add appointment')));
    cont.appendChild(h('section', { className: 'wd-section' }, apptCard));
    try {
      if (CD.Appointments && typeof CD.Appointments.renderUpcoming === 'function') {
        CD.Appointments.renderUpcoming(apptMount, { limit: 3 });
      } else {
        apptMount.appendChild(h('div', { className: 'wd-appts-empty' }, 'Appointments unavailable right now.'));
      }
    } catch (e) {
      console.error('[worker-dash] APPTS_FAILED', e);
      apptMount.appendChild(h('div', { className: 'wd-appts-empty' }, 'Appointments unavailable right now.'));
    }

    // ── 5b. MY DOCUMENTS / FILINGS ────────────────────────────────────────
    // Surfaces the claimant's generated C-3 (and C-3.3) filings from c3_filings
    // so they're not stranded in the table — download via short-TTL signed URL
    // + an honest "email it to the WCB yourself" path. Signed-in users only.
    var docsCard = _documentsCard(h, showScreen);
    if (docsCard) cont.appendChild(h('section', { className: 'wd-section' }, docsCard));

    // ── 6a. Free-tier upgrade banner ──────────────────────────────────────
    if (tier === 'free') {
      var ban = h('div', { className: 'wd-card wd-upgrade' }, [
        h('div', { className: 'wd-upgrade-text' }, [
          h('h3', { className: 'wd-upgrade-title' }, CD.t('dashboard.unlockAssistant', {assistant: 'Comp Buddy'}, 'Unlock Comp Buddy')),
          h('p', { className: 'wd-upgrade-sub' }, CD.t('dashboard.unlockSub', null, 'IME reminders, settlement calculator, my-injury tools, recovery tracking & more.'))
        ]),
        h('button', {
          type: 'button', className: 'wd-btn wd-btn-primary',
          onclick: function () { handleUpgrade('comp_buddy'); }
        }, CD.t('dashboard.upgradePrice', {price: '$9.99'}, 'Upgrade — $9.99/mo'))
      ]);
      cont.appendChild(h('section', { className: 'wd-section' }, ban));
    }

    // ── 6b. Free tools grid ───────────────────────────────────────────────
    cont.appendChild(h('div', { className: 'wd-section-label' }, CD.t('dashboard.sectionFreeTools', null, 'Free tools')));
    var freeGrid = h('div', { className: 'wd-grid' });
    [
      { icon: '📊', title: CD.t('dashboard.tileAww', null, 'Average Weekly Wage'), desc: CD.t('dashboard.descAww', null, 'Calculate your AWW & weekly rate'), screen: 'aww' },
      { icon: '🧮', title: CD.t('dashboard.tileQuickCalc', null, 'Quick Calc'), desc: CD.t('dashboard.descQuickCalc', null, 'Benefits & rate calculators'), screen: 'calculator' },
      { icon: '📚', title: CD.t('dashboard.tileLearnRights', null, 'Learn Your Rights'), desc: CD.t('dashboard.descLearnRights', null, 'WC glossary, FAQ, timeline'), screen: 'learning' },
      { icon: '🏥', title: CD.t('dashboard.tileFindDoctor', null, 'Find a Doctor'), desc: CD.t('dashboard.descFindDoctor', null, 'Find WCB-authorized doctors'), screen: 'doctor' }
    ].forEach(function (ft) {
      freeGrid.appendChild(_featureCard(h, {
        icon: ft.icon, title: ft.title, desc: ft.desc, badge: CD.t('dashboard.badgeFree', null, 'Free'), badgeCls: 'is-free',
        onClick: function () { showScreen(ft.screen); }
      }));
    });
    cont.appendChild(h('section', { className: 'wd-section' }, freeGrid));

    // ── 6c. Comp Buddy features grid ──────────────────────────────────────
    cont.appendChild(h('div', { className: 'wd-section-label' }, CD.t('dashboard.sectionAssistantFeatures', {assistant: 'Comp Buddy'}, 'Comp Buddy features')));
    // Surface ALL Comp Buddy features so an injured worker sees everything
    // available — honest tier gating (locked/Pro) + truthful "Coming soon".
    // Locked decision (2026-06-24): the core injured-worker features are FREE +
    // anonymous-capable — Road to Recovery, IME Reminders, Job Buddy, C-3, Find a
    // Doctor, Learning. The paywall stays only on the CALCULATORS (Settlement, My
    // Injury Tools) and attorney/marketplace surfaces.
    var buddy = [
      { icon: '🛣️', title: 'Road to Recovery', desc: CD.t('dashboard.descRecovery', null, 'See every step of your case'), tier: 'free', screen: 'recovery' },
      { icon: '🔔', title: CD.t('dashboard.tileImeReminders', null, 'IME Reminders'), desc: CD.t('dashboard.descIme', null, 'Never miss an IME appointment'), tier: 'free', screen: 'ime' },
      { icon: '⚖️', title: CD.t('dashboard.tileSettlement', null, 'Settlement Calculator'), desc: CD.t('dashboard.descSettlement', null, 'Estimate your SLU value'), tier: 'comp_buddy', screen: 'settlement' },
      { icon: '🛠️', title: CD.t('dashboard.tileInjuryTools', null, 'My Injury Tools'), desc: CD.t('dashboard.descInjuryTools', null, 'SLU estimator, radiculopathy & more'), tier: 'comp_buddy', screen: 'advanced_tools' },
      { icon: '🎯', title: 'Job Buddy (Beta)', desc: CD.t('dashboard.descJobBuddyBeta', null, 'Free beta — find work within your restrictions + C-258.1 log'), tier: 'free', screen: 'job_buddy' },
      { icon: '📝', title: CD.t('dashboard.tileFileC3', null, 'File a C-3 Claim'), desc: CD.t('dashboard.descFileC3', null, 'Generate & file your Employee Claim'), tier: 'free', screen: 'c3' },
      { icon: '⚖️', title: CD.t('dashboard.tileFindAttorney', null, 'Find an Attorney'), desc: CD.t('dashboard.descFindAttorney', null, 'Get matched — free, no obligation'), tier: 'free', attorney: true },
      { icon: '🤖', title: CD.t('dashboard.tileCaseAdvisor', null, 'AI Case Advisor'), desc: CD.t('dashboard.descCaseAdvisor', null, 'Ask questions about your claim'), tier: 'pro', soon: true },
      { icon: '📋', title: CD.t('dashboard.tileUtdm', null, 'UTDM Monitoring'), desc: CD.t('dashboard.descUtdm', null, 'Track medical updates'), tier: 'comp_buddy', soon: true },
      { icon: '🚗', title: CD.t('dashboard.tileMileage', null, 'Mileage & Travel'), desc: CD.t('dashboard.descMileage', null, 'Log trips, fares & mileage for reimbursement'), tier: 'free', screen: 'mt' },
      { icon: '🧾', title: CD.t('dashboard.tileAccidentNotice', null, 'Accident & Notice Evidence'), desc: CD.t('dashboard.descAccidentNotice', null, 'Collect proof you reported your accident'), tier: 'comp_buddy', screen: 'accident-notice' }
    ];
    var buddyGrid = h('div', { className: 'wd-grid' });
    buddy.forEach(function (f) {
      var locked = !hasAccess(f.tier);
      var onClick = null;
      if (!f.soon && f.attorney) onClick = function () { openAttorneyIntake({ source: 'dashboard' }); };
      else if (!f.soon && !locked) onClick = function () { showScreen(f.screen); };
      else if (!f.soon && locked) onClick = function () { handleUpgrade(f.tier === 'pro' ? 'pro' : 'comp_buddy'); };
      buddyGrid.appendChild(_featureCard(h, {
        icon: f.icon, title: f.title, desc: f.desc,
        badge: f.tier === 'free' ? CD.t('dashboard.badgeFree', null, 'Free') : (f.tier === 'pro' ? 'Pro' : 'Comp Buddy'),
        badgeCls: f.tier === 'free' ? 'is-free' : (f.tier === 'pro' ? 'is-pro' : 'is-buddy'),
        soon: f.soon, locked: locked && !f.soon && !f.attorney, onClick: onClick
      }));
    });
    cont.appendChild(h('section', { className: 'wd-section' }, buddyGrid));

    // ── 6d. Attorney lead CTA ─────────────────────────────────────────────
    // The ONE unified affordance (CD.AttorneyCTA) — identical on every surface.
    if (!(profile && profile.has_attorney) && typeof CD.AttorneyCTA === 'function') {
      // factory returns null for represented workers (anon pending intake) —
      // skip the section wrapper too so no empty band is left behind
      var dashCta = CD.AttorneyCTA({ variant: 'card', source: 'dashboard' });
      if (dashCta) cont.appendChild(h('section', { className: 'wd-section' }, dashCta));
    }

    cont.appendChild(h('p', { className: 'wd-disclaimer' }, DISCLAIMER_T()));

    // Re-animate gauge/money when the dashboard becomes the active screen again.
    // ui-controller re-renders on navigation, so each render replays naturally;
    // we also kick the gauge sweep on the next frame here.
    if (!reduced) {
      window.requestAnimationFrame(function () {
        try { if (benefit) benefit.play(); if (gauge) gauge.play(); } catch (e) {}
      });
    } else {
      try { if (benefit) benefit.play(); if (gauge) gauge.play(); } catch (e) {}
    }

    // ── 7. First-open modal stack ─────────────────────────────────────────
    // Deferred past first paint so the dashboard settles before the modals.
    setTimeout(function () { try { _maybeFirstOpenStack(showScreen); } catch (e) {} }, 600);

    return cont;
  }

  // ── FIRST-OPEN MODAL STACK ──────────────────────────────────────────────
  // Ordered, one card at a time:
  //   1. LANGUAGE  — whenever no explicit language choice exists yet.
  //   2. FILE A CLAIM — the one-time first-claim welcome.
  // Language comes FIRST and the claim card is chained off its close, so the
  // claim copy is built AFTER setLocale() and therefore renders in the language
  // the worker just picked.
  //
  // _firstOpenRan is a per-session latch. Choosing a language dispatches
  // 'cd:localechange' → ui-controller render() → this dashboard is rebuilt →
  // another 600ms timer is queued. Without the latch that second timer would
  // race the chain below and could double-show the claim card. (The claim card
  // also has its own persisted once-ever key for across-session suppression.)
  var _firstOpenRan = false;

  function _maybeFirstOpenStack(showScreen) {
    if (_firstOpenRan) return;
    _firstOpenRan = true;
    _maybeLanguagePrompt().then(function () {
      try { _maybeFirstClaimPrompt(showScreen); } catch (e) {}
    });
  }

  // Resolves when the language modal closes, or immediately when not needed.
  // Never blocks the stack: any failure falls through to the claim card.
  function _maybeLanguagePrompt() {
    try {
      if (!CD.LanguagePicker || !CD.LanguagePicker.shouldPrompt) return Promise.resolve(false);
      if (!CD.LanguagePicker.shouldPrompt()) return Promise.resolve(false);
      return CD.LanguagePicker.openModal().catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  // ── FIRST-CLAIM WELCOME (one-time, anonymous worker skin only) ──────────
  // A calm, once-ever welcome for first-time downloaders that routes straight
  // into the C-3 (File a Claim) wizard. Never shown to signed-in users or on
  // the attorney skin. Persistence mirrors tou-gate.js: Capacitor Preferences
  // on native, localStorage on web.
  var FIRST_CLAIM_KEY = 'cd_first_claim_prompt_v1';
  function _fcpIsNative() { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
  function _fcpPrefs() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) || null; }
  function _fcpGet(key) {
    var p = _fcpPrefs();
    if (_fcpIsNative() && p) return p.get({ key: key }).then(function (r) { return r && r.value ? r.value : null; }).catch(function () { return null; });
    try { return Promise.resolve(window.localStorage.getItem(key)); } catch (e) { return Promise.resolve(null); }
  }
  function _fcpSet(key, val) {
    var p = _fcpPrefs();
    try { if (_fcpIsNative() && p) return p.set({ key: key, value: val }).catch(function () {}); window.localStorage.setItem(key, val); }
    catch (e) {}
    return Promise.resolve();
  }

  function _maybeFirstClaimPrompt(showScreen) {
    if (CD.currentUser) return;                                    // never for signed-in users
    try {
      if (document.documentElement.getAttribute('data-audience') === 'attorney') return;
    } catch (e) {}
    if (document.getElementById('cd-fcp-overlay')) return;         // already on screen
    _fcpGet(FIRST_CLAIM_KEY).then(function (v) {
      if (v) return;                                               // already shown once
      _fcpSet(FIRST_CLAIM_KEY, '1');
      _showFirstClaimModal(showScreen);
    });
  }

  // Cream worker-skin look, matching tou-gate.js. Self-contained copy so this
  // modal never depends on the TOU gate having injected its styles first.
  function _fcpEnsureStyles() {
    if (document.getElementById('cd-fcp-styles')) return;
    var css = [
      '.cd-fcp-overlay{position:fixed;inset:0;z-index:100060;background:rgba(20,17,14,.62);display:flex;align-items:center;justify-content:center;padding:16px;',
        'font-family:"DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-tap-highlight-color:transparent;}',
      '.cd-fcp{--cream:#F8F6F1;--line:#E7DECB;--ink:#241F1B;--muted:#5A5148;--orange:#E87722;--orange-deep:#C25E12;',
        'width:100%;max-width:400px;background:var(--cream);border:1px solid var(--line);border-radius:18px;',
        'box-shadow:0 18px 48px rgba(20,17,14,.4);color:var(--ink);padding:22px 20px 18px;}',
      '.cd-fcp *{box-sizing:border-box;}',
      '.cd-fcp-title{font-family:"Fraunces",Georgia,"Times New Roman",serif;font-weight:600;font-size:20px;letter-spacing:-.01em;color:var(--ink);margin:0 0 10px;}',
      '.cd-fcp-body{font-size:13.5px;line-height:1.62;color:var(--muted);margin:0 0 18px;}',
      '.cd-fcp-btn{width:100%;font-family:inherit;font-weight:700;font-size:15px;border:none;cursor:pointer;background:var(--orange);color:#fff;',
        'border-radius:999px;padding:14px 18px;line-height:1;transition:background 160ms ease;}',
      '.cd-fcp-btn:hover{background:var(--orange-deep);}',
      '.cd-fcp-btn:focus-visible{outline:3px solid rgba(232,119,34,.45);outline-offset:2px;}',
      '.cd-fcp-later{display:block;width:100%;margin-top:8px;background:none;border:none;font-family:inherit;font-size:12.5px;',
        'font-weight:600;color:var(--muted);text-decoration:underline;text-underline-offset:2px;cursor:pointer;padding:6px;}',
      '@media (prefers-reduced-motion:reduce){.cd-fcp-btn{transition:none;}}'
    ].join('');
    var s = document.createElement('style'); s.id = 'cd-fcp-styles'; s.textContent = css; document.head.appendChild(s);
  }

  function _showFirstClaimModal(showScreen) {
    _fcpEnsureStyles();
    var overlay = document.createElement('div');
    overlay.className = 'cd-fcp-overlay'; overlay.id = 'cd-fcp-overlay';
    var box = document.createElement('div');
    box.className = 'cd-fcp';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'cd-fcp-title');

    var title = document.createElement('h2');
    title.className = 'cd-fcp-title'; title.id = 'cd-fcp-title';
    title.textContent = CD.t('wizard.firstClaimTitle', null, 'Take the first step when you\u2019re ready');
    var body = document.createElement('p');
    body.className = 'cd-fcp-body';
    body.textContent = CD.t('wizard.firstClaimBody', null,
      'If you were recently hurt at work, you can start your official workers\u2019 ' +
      'compensation claim right here. We\u2019ll walk you through it gently, one step at a time — ' +
      'there\u2019s no rush, and you can stop anytime.');

    var _release = null;
    function close() {
      try { document.removeEventListener('keydown', onKey, true); } catch (e) {}
      if (_release) { try { _release(); } catch (e) {} _release = null; }
      try { overlay.remove(); } catch (e) {}
    }
    function onKey(e) { if (e && e.key === 'Escape') { e.preventDefault(); close(); } }

    var start = document.createElement('button');
    start.type = 'button'; start.className = 'cd-fcp-btn';
    start.textContent = CD.t('wizard.startMyClaim', null, 'Start my claim');
    start.addEventListener('click', function () { close(); try { showScreen('c3'); } catch (e) {} });
    var later = document.createElement('button');
    later.type = 'button'; later.className = 'cd-fcp-later';
    later.textContent = CD.t('common.maybeLater', null, 'Maybe later');
    later.addEventListener('click', close);

    box.appendChild(title); box.appendChild(body);
    box.appendChild(start); box.appendChild(later);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    /* a11y (Aurora Glass 6.20). This dialog announced itself correctly and
     * closed on Escape, but it had NO TAB TRAP: two Tabs walked focus out of it
     * and into the dashboard behind the scrim, where the user is typing into
     * something they cannot see. That is the one thing every hand-rolled modal
     * in the 6.4 audit got wrong, and it is the reason the contract exists.
     *
     * Initial focus is left at the contract's default — the dialog container,
     * not "Start my claim". Chromium matches :focus-visible on a PROGRAMMATIC
     * focus even for a tap-opened modal (measured in 6.8), so focusing the
     * primary button draws a keyboard ring at every touch user; that cost two
     * visual regressions before the default was changed in 6.15.
     *
     * GUARDED, and the legacy path stays: this file is copied verbatim to the
     * website by sync-dashboard.sh and the website does not load
     * js/modal-a11y.js. Deleting the hand-rolled listener would take Escape
     * away there. */
    if (CD.ModalA11y) {
      _release = CD.ModalA11y.attach(overlay, { dialogEl: box, labelledBy: 'cd-fcp-title', onEscape: close });
    } else {
      document.addEventListener('keydown', onKey, true);
      try { start.focus(); } catch (e) {}
    }
  }

  // ── BENEFIT TRACKER ─────────────────────────────────────────────────────
  // Money motion: a stack of bills slides/builds in on render. The estimated
  // weekly figure is driven by moneyState (fullRate × disPct).
  function _benefitTracker(h, card, f$, money, reduced, showScreen, local) {
    var node = h('div', { className: 'wd-card wd-benefit' });

    node.appendChild(h('div', { className: 'wd-card-hd' }, [
      h('h2', { className: 'wd-card-title' }, '💵 Benefit tracker'),
      (money.awwDemo || money.disDemo)
        ? h('span', { className: 'wd-demo-tag' }, 'Sample')
        : null
    ]));

    // next payment date — self-entered (localStorage) only; never a fake date.
    var nextDate = local.next_payment_date ? new Date(local.next_payment_date + 'T00:00:00') : null;

    // money visual
    var moneyArt = h('div', { className: 'wd-money', 'aria-hidden': 'true' });
    for (var i = 0; i < 5; i++) {
      moneyArt.appendChild(h('span', { className: 'wd-bill wd-bill-' + i }, '$'));
    }
    var coin = h('span', { className: 'wd-coin', 'aria-hidden': 'true' }, '◉');
    moneyArt.appendChild(coin);

    var amtEl = h('div', { className: 'wd-benefit-amt', role: 'status', 'aria-live': 'polite' });
    var amtSub = h('div', { className: 'wd-benefit-sub' });
    var dateEl = h('div', { className: 'wd-benefit-date' });

    function paintFigures() {
      var est = money.fullRate * (money.disPct / 100);
      amtEl.textContent = f$(est);
      amtSub.innerHTML = '';
      amtSub.appendChild(h('span', null, 'estimated weekly benefit'));
      amtSub.appendChild(h('span', { className: 'wd-benefit-formula' },
        ' · ' + (money.disPct) + '% of ' + f$(money.fullRate) + ' full rate'));
      dateEl.innerHTML = '';
      dateEl.appendChild(h('span', { className: 'wd-benefit-date-lbl' }, 'Next payment'));
      if (nextDate) {
        dateEl.appendChild(h('span', { className: 'wd-benefit-date-val' },
          nextDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })));
      } else {
        dateEl.appendChild(h('span', { className: 'wd-benefit-date-val wd-muted' }, 'Add your date'));
      }
    }
    paintFigures();

    var body = h('div', { className: 'wd-benefit-body' }, [
      moneyArt,
      h('div', { className: 'wd-benefit-figs' }, [amtEl, amtSub, dateEl])
    ]);
    node.appendChild(body);

    // editable schedule
    var editBtn = h('button', {
      type: 'button', className: 'wd-link-btn wd-benefit-edit',
      onclick: function () { openEditor(); }
    }, 'Edit amount & date');
    node.appendChild(editBtn);

    var editorWrap = h('div', { className: 'wd-benefit-editor', hidden: 'hidden' });
    node.appendChild(editorWrap);

    function openEditor() {
      if (!editorWrap.hasAttribute('hidden')) { editorWrap.setAttribute('hidden', 'hidden'); return; }
      editorWrap.removeAttribute('hidden');
      editorWrap.innerHTML = '';
      var awwIn = h('input', {
        className: 'wd-input', type: 'number', inputMode: 'decimal',
        value: Number(money.awwRaw) || '', placeholder: 'Average weekly wage ($)'
      });
      var dateIn = h('input', {
        className: 'wd-input', type: 'date',
        value: nextDate ? _toDateInput(nextDate) : ''
      });
      editorWrap.appendChild(_field(h, 'Average weekly wage ($)', awwIn));
      editorWrap.appendChild(_field(h, 'Next payment date', dateIn));
      var save = h('button', {
        type: 'button', className: 'wd-btn wd-btn-primary wd-btn-sm',
        onclick: function () {
          var newAww = Number(awwIn.value);
          if (isFinite(newAww) && newAww > 0) {
            money.awwRaw = newAww; money.awwDemo = false;
            money.fullRate = _weeklyRate(newAww, money.doa);
            _persistAww(newAww);
          }
          if (dateIn.value) {
            nextDate = new Date(dateIn.value + 'T00:00:00');
            _writeLocal({ next_payment_date: dateIn.value });
          }
          editorWrap.setAttribute('hidden', 'hidden');
          // drop sample tag if both real now
          var hd = node.querySelector('.wd-card-hd .wd-demo-tag');
          if (hd && !money.awwDemo && !money.disDemo) hd.remove();
          paintFigures();
          replay();
        }
      }, 'Save');
      editorWrap.appendChild(save);
      editorWrap.appendChild(h('p', { className: 'wd-input-note' },
        CD.t('dashboard.awwSavedNote', null, 'Saved on this device. We use your AWW to estimate two-thirds of your wage, capped at the state maximum.')));
    }

    function replay() {
      if (reduced) { node.classList.add('is-played'); return; }
      node.classList.remove('is-played');
      // force reflow to restart CSS animations
      void node.offsetWidth;
      window.requestAnimationFrame(function () { node.classList.add('is-played'); });
    }

    return {
      node: node,
      update: function () { paintFigures(); },   // called when gauge % changes
      play: replay
    };
  }

  // Persist AWW to the real profile column when we can (Comp Buddy+ logged in).
  function _persistAww(aww) {
    try {
      if (CD.currentUser && CD.supa && CD.currentProfile) {
        CD.currentProfile.current_aww = aww;
        CD.supa.from('profiles').update({ current_aww: aww }).eq('id', CD.currentUser.id)
          .then(function (res) { if (res && res.error) console.warn('[worker-dash] AWW_SAVE_FAILED', res.error); })
          .catch(function (e) { console.warn('[worker-dash] AWW_SAVE_FAILED', e); });
      }
    } catch (e) { console.warn('[worker-dash] AWW_SAVE_FAILED', e); }
  }

  // ── MY DOCUMENTS / FILINGS ──────────────────────────────────────────────
  // Lists the signed-in claimant's c3_filings rows (owner-RLS) — each generated
  // C-3 (and C-3.3 when present) with a status, a short-TTL signed-URL download,
  // and an honest "email it to the WCB yourself" mailto (the claimant attaches +
  // sends; we never file on their behalf). Loads async after first paint, like
  // appointments. Returns null (hidden) for anonymous or unconfigured clients.
  var WCB_FILING_EMAIL = 'wcbclaimsfiling@wcb.ny.gov';
  function _fmtUSDate(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    return p.length === 3 ? (p[1] + '/' + p[2] + '/' + p[0]) : String(iso);
  }
  // Stored doc paths are durable "bucket/key" strings (c3-filings/{uid}/…,
  // oc110a-signed/{uid}/…). Split into the bucket + object key for signing.
  function _bucketAndKey(p) {
    p = String(p || ''); var i = p.indexOf('/');
    return i > 0 ? { bucket: p.slice(0, i), key: p.slice(i + 1) } : null;
  }
  // Pre-open a tab synchronously (within the click gesture) so popup blockers
  // don't eat it, then point it at the freshly minted signed URL.
  function _openSignedDoc(path) {
    if (!CD.supa || !path) return;
    var bk = _bucketAndKey(path);
    if (!bk) { console.warn('[worker-dash] DOC_BAD_PATH', path); return; }
    var w = null;
    try { w = window.open('about:blank', '_blank'); } catch (e) {}
    CD.supa.storage.from(bk.bucket).createSignedUrl(bk.key, 300)
      .then(function (r) {
        var url = r && r.data && r.data.signedUrl;
        if (url) { if (w) w.location.href = url; else window.location.href = url; }
        else { if (w) w.close(); console.warn('[worker-dash] DOC_SIGNED_URL_FAILED', r && r.error); }
      })
      .catch(function (e) { if (w) w.close(); console.warn('[worker-dash] DOC_SIGNED_URL_FAILED', e); });
  }
  // Mint a short-TTL signed URL for a stored "bucket/key" path (for attaching).
  function _signedUrlFor(path) {
    var bk = _bucketAndKey(path);
    if (!CD.supa || !bk) return Promise.resolve(null);
    return CD.supa.storage.from(bk.bucket).createSignedUrl(bk.key, 300)
      .then(function (r) { return (r && r.data && r.data.signedUrl) || null; })
      .catch(function () { return null; });
  }
  // Accident & Notice evidence lives on the private 'worker-evidence' bucket with
  // a BARE object key ({uid}/accident_notice/{uuid}{ext}) — NOT the "bucket/key"
  // form c3_filings/oc110a store — so sign against that bucket directly.
  function _signEvidence(storagePath, seconds) {
    if (!CD.supa || !storagePath) return Promise.resolve(null);
    var key = String(storagePath).replace(/^worker-evidence\//, '');
    return CD.supa.storage.from('worker-evidence').createSignedUrl(key, seconds || 300)
      .then(function (r) { return (r && r.data && (r.data.signedUrl || r.data.signedURL)) || null; })
      .catch(function () { return null; });
  }
  function _viewEvidenceDoc(storagePath, title) {
    _signEvidence(storagePath, 300).then(function (u) {
      if (u) { CD.openDocViewer(u, title); }
      else { console.warn('[worker-dash] EVIDENCE_VIEW_FAILED', storagePath); }
    });
  }
  function _openEvidenceDoc(storagePath) {
    var w = null;
    try { w = window.open('about:blank', '_blank'); } catch (e) {}
    _signEvidence(storagePath, 300).then(function (u) {
      if (u) { if (w) w.location.href = u; else window.location.href = u; }
      else { if (w) w.close(); console.warn('[worker-dash] EVIDENCE_OPEN_FAILED', storagePath); }
    });
  }
  // One worker_evidence (accident_notice) row → a documents entry with a photo/PDF
  // badge, opened via a short-TTL signed URL (mirrors the c3_filings row pattern).
  function _evidenceRow(h, r) {
    var mime = String(r.mime_type || '');
    var badge = /^image\//.test(mime) ? '📷 Photo' : (/pdf/i.test(mime) ? '📄 PDF' : '📎 File');
    var when = _fmtUSDate(r.created_at);
    var title = r.file_name || 'Accident & Notice evidence';
    return _genericDocRow(h, {
      title: title,
      sub: badge + (when ? ' · ' + when : ''),
      actions: [
        h('button', { type: 'button', className: 'wd-btn wd-btn-primary', onclick: function () { _viewEvidenceDoc(r.storage_path, title); } }, '👁 View'),
        h('button', { type: 'button', className: 'wd-btn wd-btn-ghost', onclick: function () { _openEvidenceDoc(r.storage_path); } }, '⬇ Download'),
        h('button', { type: 'button', className: 'wd-btn wd-btn-danger', onclick: function (e) { _deleteEvidence(r, e.currentTarget.closest('.wd-doc-row')); } }, '🗑 Delete')
      ]
    });
  }
  // Native "email to WCB" for a stored filing: downloads the EXISTING PDF(s)
  // (never re-generates) and opens the device mail composer with them attached —
  // C-3 and C-3.3 in ONE email. Falls back to the share sheet / copyable address
  // (handled inside CD.NativeMail) on iOS with no Mail account configured.
  function _emailFilingToWCB(r, profile, hasC3, hasC33, btn) {
    if (!CD.NativeMail || !CD.NativeMail.emailClaimToWCB) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Opening mail…'; }
    var jobs = [];
    if (hasC3) jobs.push(_signedUrlFor(r.storage_path).then(function (u) { return u ? { name: 'C-3_Employee_Claim.pdf', url: u } : null; }));
    if (hasC33) jobs.push(_signedUrlFor(r.c33_path).then(function (u) { return u ? { name: 'C-3.3_HIPAA_Release.pdf', url: u } : null; }));
    Promise.all(jobs).then(function (atts) {
      atts = atts.filter(Boolean);
      var name = (profile && profile.full_name) || '';
      var caseNo = (profile && profile.wcb_case_number) ? (' ' + profile.wcb_case_number) : '';
      var both = hasC3 && hasC33;
      var body = ['To the New York State Workers’ Compensation Board:', '',
        'Attached is my completed ' + (hasC3 ? ('Form C-3 (Employee Claim)' + (both ? ' and Form C-3.3 (Limited Release of Health Information)' : '')) : 'Form C-3.3 (Limited Release of Health Information)') + '.', '',
        'Claimant: ' + (name || '—')];
      if (profile && profile.wcb_case_number) body.push('WCB case number: ' + profile.wcb_case_number);
      body.push('', 'I am filing my own claim. Thank you.');
      return CD.NativeMail.emailClaimToWCB({ to: WCB_FILING_EMAIL, subject: 'WCB Claim — ' + (name || 'Employee Claim') + caseNo, body: body.join('\n'), attachments: atts });
    }).catch(function (e) { console.warn('[worker-dash] EMAIL_FILING_FAILED', e); })
      .then(function () { if (btn) { btn.disabled = false; btn.textContent = '✉️ Email to WCB'; } });
  }
  // Generic document row used for every source (C-3 filings, OC-110a, …).
  function _genericDocRow(h, opts) {
    var row = h('div', { className: 'wd-doc-row', style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', padding: '12px 0', borderTop: '1px solid var(--skin-divider)' } });
    row.appendChild(h('div', { style: { flex: '1 1 200px', minWidth: '0' } }, [
      h('div', { style: { fontWeight: '600', color: 'var(--skin-text)' } }, opts.title),
      h('div', { className: 'wd-doc-sub', style: { fontSize: '12.5px', color: 'var(--skin-text-muted)' } }, opts.sub)
    ]));
    row.appendChild(h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } }, (opts.actions || []).filter(Boolean)));
    return row;
  }
  // Delete a stored C-3 filing: remove the PDF object(s) from storage (best-
  // effort), then the c3_filings row (RLS scopes it to the owner via user_id),
  // then drop the row from the DOM. Confirmed first — this is irreversible.
  function _deleteFiling(r, rowEl) {
    if (!CD.supa || !r || !r.id || !CD.currentUser) return;
    if (!window.confirm('Delete this filing? This removes the saved PDF(s) from your documents and can’t be undone.')) return;
    var byBucket = {};
    [r.storage_path, r.c33_path].filter(Boolean).forEach(function (p) {
      var bk = _bucketAndKey(p); if (bk) { (byBucket[bk.bucket] = byBucket[bk.bucket] || []).push(bk.key); }
    });
    var jobs = Object.keys(byBucket).map(function (b) { return CD.supa.storage.from(b).remove(byBucket[b]); });
    Promise.all(jobs).catch(function (e) { console.warn('[worker-dash] DOC_STORAGE_DELETE_FAILED', e); })
      .then(function () { return CD.supa.from('c3_filings').delete().eq('id', r.id).eq('user_id', CD.currentUser.id); })
      .then(function (res) {
        if (res && res.error) { console.warn('[worker-dash] DOC_DELETE_FAILED', res.error); alert('Could not delete that filing — please try again.'); return; }
        if (rowEl && rowEl.parentNode) rowEl.parentNode.removeChild(rowEl);
      })
      .catch(function (e) { console.warn('[worker-dash] DOC_DELETE_FAILED', e); alert('Could not delete that filing — please try again.'); });
  }
  // Delete an Accident & Notice evidence file (bare key on the worker-evidence
  // bucket), then the worker_evidence row, then the DOM row. Confirmed first.
  function _deleteEvidence(r, rowEl) {
    if (!CD.supa || !r || !r.id || !CD.currentUser) return;
    if (!window.confirm('Delete this evidence file? This can’t be undone.')) return;
    var key = r.storage_path ? String(r.storage_path).replace(/^worker-evidence\//, '') : null;
    var rm = key ? CD.supa.storage.from('worker-evidence').remove([key]) : Promise.resolve();
    rm.catch(function (e) { console.warn('[worker-dash] EV_STORAGE_DELETE_FAILED', e); })
      .then(function () { return CD.supa.from('worker_evidence').delete().eq('id', r.id).eq('user_id', CD.currentUser.id); })
      .then(function (res) {
        if (res && res.error) { console.warn('[worker-dash] EV_DELETE_FAILED', res.error); alert('Could not delete that file — please try again.'); return; }
        if (rowEl && rowEl.parentNode) rowEl.parentNode.removeChild(rowEl);
      })
      .catch(function (e) { console.warn('[worker-dash] EV_DELETE_FAILED', e); alert('Could not delete that file — please try again.'); });
  }
  // One c3_filings row → a documents entry. Handles C-3-only, C-3+C-3.3 bundles,
  // and standalone C-3.3-only filings (storage_path null) without a broken button.
  function _docRow(h, r, profile) {
    var when = _fmtUSDate(r.generated_at || r.created_at);
    var hasC3 = !!r.storage_path, hasC33 = !!r.c33_path;
    var statusLabel = ({ draft: 'Draft', generated: 'Generated', filed_self: 'Filed (self-reported)', e_filed: 'E-filed' })[r.status] || r.status || '';
    var title = hasC3 ? ('C-3 Employee Claim' + (hasC33 ? ' + C-3.3' : '')) : (hasC33 ? 'C-3.3 Limited Release (HIPAA)' : 'C-3 filing');
    return _genericDocRow(h, {
      title: title,
      sub: (when ? 'Generated ' + when : 'Generated') + ' · ' + statusLabel,
      actions: [
        hasC3 ? h('button', { type: 'button', className: 'wd-btn wd-btn-primary', onclick: function () { _viewSignedDoc(r.storage_path, 'C-3 Employee Claim'); } }, '👁 View C-3') : null,
        hasC3 ? h('button', { type: 'button', className: 'wd-btn wd-btn-ghost', onclick: function () { _openSignedDoc(r.storage_path); } }, '⬇ C-3') : null,
        hasC33 ? h('button', { type: 'button', className: 'wd-btn wd-btn-primary', onclick: function () { _viewSignedDoc(r.c33_path, 'C-3.3 Limited Release (HIPAA)'); } }, '👁 View C-3.3') : null,
        hasC33 ? h('button', { type: 'button', className: 'wd-btn wd-btn-ghost', onclick: function () { _openSignedDoc(r.c33_path); } }, '⬇ C-3.3') : null,
        // Native mail composer with the PDF(s) attached (replaces the old mailto,
        // which couldn't carry attachments). On web it falls back to a mailto.
        h('button', { type: 'button', className: 'wd-btn wd-btn-ghost', onclick: function (e) { _emailFilingToWCB(r, profile, hasC3, hasC33, e.currentTarget); } }, '✉️ Email to WCB'),
        h('button', { type: 'button', className: 'wd-btn wd-btn-danger', onclick: function (e) { _deleteFiling(r, e.currentTarget.closest('.wd-doc-row')); } }, '🗑 Delete')
      ]
    });
  }
  // OC-110a (Authorization for Medical Records) — signed during Comp Buddy intake,
  // stored at profile.oc110a_doc_url (bucket/key in oc110a-signed).
  function _oc110aRow(h, profile) {
    if (!profile || !profile.oc110a_signed || !profile.oc110a_doc_url) return null;
    var when = _fmtUSDate(profile.oc110a_signed_date);
    return _genericDocRow(h, {
      title: CD.t('dashboard.docOc110a', null, 'OC-110a Medical Authorization'),
      sub: (when ? 'Signed ' + when : 'Signed') + ' · Authorization for Medical Records',
      actions: [
        h('button', { type: 'button', className: 'wd-btn wd-btn-primary', onclick: function () { _viewSignedDoc(profile.oc110a_doc_url, 'OC-110a Medical Authorization'); } }, '👁 View'),
        h('button', { type: 'button', className: 'wd-btn wd-btn-ghost', onclick: function () { _openSignedDoc(profile.oc110a_doc_url); } }, '⬇ Download')
      ]
    });
  }
  function _documentsCard(h, showScreen) {
    if (!CD.currentUser || !CD.supa) return null;   // signed-in + configured client only
    var profile = CD.currentProfile || {};
    var node = h('div', { id: 'my-documents', className: 'wd-card wd-docs' });
    node.appendChild(h('div', { className: 'wd-card-hd' }, [
      h('h2', { className: 'wd-card-title' }, '📄 My documents'),
      h('button', { type: 'button', className: 'wd-link-btn', onclick: function () { showScreen('c3'); } }, 'File a C-3 →')
    ]));
    // OC-110a renders synchronously from the profile (no extra query); the C-3
    // filings load async below and append beneath it.
    var ocRow = _oc110aRow(h, profile);
    if (ocRow) node.appendChild(ocRow);
    var hasStatic = !!ocRow;

    var mount = h('div', { className: 'wd-docs-mount' });
    node.appendChild(mount);
    mount.appendChild(h('div', { className: 'wd-appts-empty' }, 'Loading your filings…'));
    function emptyOrNone(msg) {
      mount.innerHTML = '';
      // Don't show "no documents" if OC-110a is already listed above.
      if (!hasStatic) mount.appendChild(h('div', { className: 'wd-appts-empty' }, msg));
    }
    try {
      CD.supa.from('c3_filings')
        .select('id,status,storage_path,c33_path,wcb_case_number,generated_at,created_at')
        .eq('user_id', CD.currentUser.id)
        .order('created_at', { ascending: false })
        .then(function (res) {
          if (res && res.error) { console.warn('[worker-dash] DOCS_FETCH_FAILED', res.error); emptyOrNone('Your filings are unavailable right now.'); return; }
          var rows = (res && res.data) || [];
          mount.innerHTML = '';
          if (!rows.length) { if (!hasStatic) mount.appendChild(h('div', { className: 'wd-appts-empty' }, 'No filings yet. Generate your C-3 and it’ll be saved here.')); return; }
          rows.forEach(function (r) { mount.appendChild(_docRow(h, r, profile)); });
        }, function (e) {
          console.warn('[worker-dash] DOCS_FETCH_FAILED', e); emptyOrNone('Your filings are unavailable right now.');
        });
    } catch (e) {
      console.warn('[worker-dash] DOCS_FETCH_FAILED', e); emptyOrNone('Your filings are unavailable right now.');
    }

    // ── Accident & Notice subsection ──────────────────────────────────────
    // Photos/PDFs captured or scanned via the Accident & Notice screen land in
    // worker_evidence (purpose 'accident_notice') on the private worker-evidence
    // bucket. They surface here automatically — no extra step. Hidden when empty.
    var anWrap = h('div', { className: 'wd-docs-an', style: { display: 'none', marginTop: '20px' } });
    anWrap.appendChild(h('div', { className: 'wd-card-hd' }, [
      h('h3', { className: 'wd-card-title', style: { fontSize: '15px' } }, '🗂️ Accident & Notice'),
      h('button', { type: 'button', className: 'wd-link-btn', onclick: function () { showScreen('accident-notice'); } }, 'Open Accident & Notice →')
    ]));
    var anMount = h('div', { className: 'wd-docs-an-mount' });
    anWrap.appendChild(anMount);
    node.appendChild(anWrap);
    try {
      CD.supa.from('worker_evidence')
        .select('id,file_name,mime_type,created_at,storage_path,packet_id')
        .eq('user_id', CD.currentUser.id)
        .eq('purpose', 'accident_notice')
        .order('created_at', { ascending: false })
        .then(function (res) {
          if (res && res.error) { console.warn('[worker-dash] AN_FETCH_FAILED', res.error); return; }
          var rows = (res && res.data) || [];
          if (!rows.length) return;   // subsection stays hidden when there's nothing
          anMount.innerHTML = '';
          rows.forEach(function (r) { anMount.appendChild(_evidenceRow(h, r)); });
          anWrap.style.display = '';
        }, function (e) { console.warn('[worker-dash] AN_FETCH_FAILED', e); });
    } catch (e) { console.warn('[worker-dash] AN_FETCH_FAILED', e); }

    return node;
  }

  // ── DISABILITY GAUGE ────────────────────────────────────────────────────
  // SVG arc gauge. Needle/arc sweeps up on render. Tied to the tracker via the
  // onChange callback (slider drives moneyState.disPct).
  function _disabilityGauge(h, f$, money, reduced, onChange) {
    var node = h('div', { className: 'wd-card wd-gauge' });
    // Big % lives in the header (right of the title) — not overlaid on the gauge.
    var pctEl = h('span', { className: 'wd-gauge-pct' }, money.disPct + '%');
    node.appendChild(h('div', { className: 'wd-card-hd wd-gauge-hd' }, [
      h('h2', { className: 'wd-card-title' }, '📈 Disability level'),
      h('div', { className: 'wd-gauge-hd-right' }, [
        money.disDemo ? h('span', { className: 'wd-demo-tag' }, 'Sample') : null,
        pctEl
      ])
    ]));

    var SVGNS = 'http://www.w3.org/2000/svg';
    function svg(name, attrs) {
      var el = document.createElementNS(SVGNS, name);
      Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
      return el;
    }
    // semicircle gauge: radius 80, centre (100,100), 180° sweep
    var R = 80, CX = 100, CY = 100;
    function pt(deg) {
      var rad = (Math.PI / 180) * deg;
      return [CX + R * Math.cos(rad), CY + R * Math.sin(rad)];
    }
    // 180° (left) → 360° (right). arc path for full track.
    var startA = pt(180), endA = pt(360);
    var trackD = 'M' + startA[0] + ' ' + startA[1] +
      ' A ' + R + ' ' + R + ' 0 0 1 ' + endA[0] + ' ' + endA[1];

    var s = svg('svg', { viewBox: '0 0 200 120', className: 'wd-gauge-svg', 'aria-hidden': 'true' });
    s.appendChild(svg('path', {
      d: trackD, fill: 'none', stroke: 'var(--skin-divider)',
      'stroke-width': '16', 'stroke-linecap': 'round'
    }));
    var arc = svg('path', {
      d: trackD, fill: 'none', stroke: 'var(--skin-accent)',
      'stroke-width': '16', 'stroke-linecap': 'round', pathLength: '100'
    });
    arc.setAttribute('stroke-dasharray', '0 100');
    s.appendChild(arc);

    // needle
    var needle = svg('line', {
      x1: String(CX), y1: String(CY), x2: String(CX - R + 14), y2: String(CY),
      stroke: 'var(--skin-text)', 'stroke-width': '3', 'stroke-linecap': 'round',
      className: 'wd-gauge-needle'
    });
    s.appendChild(needle);
    s.appendChild(svg('circle', { cx: String(CX), cy: String(CY), r: '6', fill: 'var(--skin-text)' }));

    var gaugeWrap = h('div', { className: 'wd-gauge-wrap' }, [s]);
    node.appendChild(gaugeWrap);

    // slider (self-entry, AA labelled)
    var slider = h('input', {
      type: 'range', min: '0', max: '100', step: '5', value: String(money.disPct),
      className: 'wd-gauge-slider', 'aria-label': 'Your disability percentage',
      'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(money.disPct)
    });
    node.appendChild(h('div', { className: 'wd-gauge-slider-row' }, [
      h('span', { className: 'wd-gauge-slider-end' }, '0%'),
      slider,
      h('span', { className: 'wd-gauge-slider-end' }, '100%')
    ]));
    node.appendChild(h('p', { className: 'wd-input-note' },
      'Self-entered. Your treating doctor sets your official degree of disability. This drives the estimate in your benefit tracker.'));

    function sweepTo(pct, animate) {
      var clamped = Math.max(0, Math.min(100, pct));
      // arc: dasharray fraction of the 100-unit path length (half-circle).
      var dash = clamped / 100 * 100;
      // needle angle: 180° (0%) → 360°/0° (100%)
      var ang = 180 + (clamped / 100) * 180;
      var rad = (Math.PI / 180) * ang;
      var nx = CX + (R - 14) * Math.cos(rad);
      var ny = CY + (R - 14) * Math.sin(rad);
      if (animate && !reduced) {
        arc.style.transition = 'stroke-dasharray var(--rhythm-slow, 900ms) var(--ease-out, ease)';
        needle.style.transition = 'all var(--rhythm-slow, 900ms) var(--ease-out, ease)';
      } else {
        arc.style.transition = 'none';
        needle.style.transition = 'none';
      }
      arc.setAttribute('stroke-dasharray', dash + ' 100');
      needle.setAttribute('x2', nx.toFixed(1));
      needle.setAttribute('y2', ny.toFixed(1));
      pctEl.textContent = clamped + '%';
    }

    slider.addEventListener('input', function () {
      var v = Number(slider.value);
      slider.setAttribute('aria-valuenow', String(v));
      money.disPct = v; money.disDemo = false;
      sweepTo(v, false);
      var tag = node.querySelector('.wd-card-hd .wd-demo-tag');
      if (tag) tag.remove();
      if (onChange) onChange(v);
    });

    function play() {
      if (reduced) { sweepTo(money.disPct, false); return; }
      sweepTo(0, false);
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () { sweepTo(money.disPct, true); });
      });
    }

    return { node: node, play: play };
  }

  // ── Feature spotlight carousel (Calm Path) ─────────────────────────────────
  // A gentle, auto-rotating spotlight of the core free features. The whole card
  // is a tap target that opens the current feature; the CTA does the same. Dots
  // + prev/next allow manual control; a slim progress bar shows the dwell.
  // Autoplay pauses on hover/press and is disabled entirely (with no crossfade)
  // under prefers-reduced-motion. SELF-CLEANING: the rAF loop stops the instant
  // the node leaves the DOM, so a dashboard re-render never leaks a timer.
  function _featureSpotlight(h, showScreen, reduced, openAttorneyIntake) {
    var FEATURES = [
      { icon: '📝', chip: 'C-3 · ' + CD.t('dashboard.badgeFree', null, 'Free'), title: CD.t('dashboard.tileFileClaim', null, 'File a Claim'),
        desc: CD.t('dashboard.descFileClaim', null, 'File your official C-3 claim with the Workers\u2019 Compensation Board. We\u2019ll guide you gently, one step at a time.'),
        cta: CD.t('wizard.startMyClaim', null, 'Start my claim'), screen: 'c3' },
      { icon: '⚖️', chip: CD.t('dashboard.badgeFree', null, 'Free') + ' · ' + CD.t('dashboard.chipMinutes', {n: 2}, '2 min'), title: CD.t('dashboard.tileFindAttorneyFast', null, 'Find an Attorney in Less Than 2 Minutes'),
        desc: CD.t('dashboard.descFindAttorneyFast', null, 'Get matched with a licensed New York workers\u2019 comp attorney near you — free, no obligation, no pressure.'),
        cta: CD.t('dashboard.stepFindAttorney', null, 'Find an attorney'), action: function () { openAttorneyIntake({ source: 'spotlight' }); } },
      { icon: '🏥', chip: 'WCB · ' + CD.t('dashboard.badgeFree', null, 'Free'), title: CD.t('dashboard.tileFindDoctor', null, 'Find a Doctor'),
        desc: CD.t('dashboard.descFindDoctorLong', null, 'Find WCB-authorized doctors near you, by body part and borough. No pressure, no rush.'),
        cta: CD.t('dashboard.ctaFindDoctor', null, 'Find a doctor'), screen: 'doctor' },
      { icon: '🎯', chip: 'C-258.1 · ' + CD.t('dashboard.badgeFree', null, 'Free'), title: 'Job Buddy',
        desc: CD.t('dashboard.descJobBuddyLong', null, 'Find work that respects your medical restrictions — at your own pace, with a simple job-search log.'),
        cta: CD.t('dashboard.ctaOpen', {name: 'Job Buddy'}, 'Open Job Buddy'), screen: 'job_buddy' },
      { icon: '🛣️', chip: CD.t('dashboard.chipRoadmap', null, 'Roadmap') + ' · ' + CD.t('dashboard.badgeFree', null, 'Free'), title: 'Road to Recovery',
        desc: CD.t('dashboard.descRecoveryLong', null, 'See exactly where your case stands today, laid out in plain, reassuring language.'),
        cta: CD.t('dashboard.ctaSeeRoad', null, 'See my road'), screen: 'recovery' },
      { icon: '📚', chip: CD.t('dashboard.chipGuide', null, 'Guide') + ' · ' + CD.t('dashboard.badgeFree', null, 'Free'), title: CD.t('dashboard.tileLearningPortal', null, 'Learning Portal'),
        desc: CD.t('dashboard.descLearningPortalLong', null, 'Plain-English answers whenever you need them — glossary, FAQ and timeline.'),
        cta: CD.t('dashboard.ctaStartLearning', null, 'Start learning'), screen: 'learning' },
      { icon: '💬', chip: 'AI · ' + CD.t('dashboard.badgeFree', null, 'Free'), title: 'Ask Comp Buddy',
        desc: CD.t('dashboard.descAskAssistant', null, 'Ask anything about your case, or upload a photo of a decision and we\u2019ll explain it simply.'),
        cta: CD.t('dashboard.ctaAskQuestion', null, 'Ask a question'), screen: 'chat' }
    ];
    var DWELL = 7000;
    var state = { i: 0, paused: false };

    var bar = h('div', { className: 'wd-sp-bar' });
    var icon = h('div', { className: 'wd-sp-icon', 'aria-hidden': 'true' });
    var chip = h('span', { className: 'wd-sp-chip' });
    var title = h('h2', { className: 'wd-sp-title' });
    var desc = h('p', { className: 'wd-sp-desc' });
    var cta = h('button', { type: 'button', className: 'wd-btn wd-btn-accent wd-sp-cta' });
    var content = h('div', { className: 'wd-sp-content' }, [
      h('div', { className: 'wd-sp-top' }, [icon, chip]),
      title, desc, cta
    ]);

    function open(idx) {
      try {
        var f = FEATURES[idx];
        if (f && typeof f.action === 'function') { f.action(); return; }
        showScreen(f.screen);
      } catch (e) {}
    }

    var card = h('div', {
      className: 'wd-sp-card', role: 'button', tabindex: '0',
      onclick: function () { open(state.i); },
      onkeydown: function (e) {
        if (e && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(state.i); }
      },
      onpointerenter: function () { state.paused = true; },
      onpointerleave: function () { state.paused = false; },
      onpointerdown: function () { state.paused = true; },
      onpointerup: function () { state.paused = false; }
    }, [bar, h('div', { className: 'wd-sp-pad' }, content)]);

    // CTA is its own tap target — stop the card handler double-firing.
    cta.onclick = function (e) { if (e && e.stopPropagation) e.stopPropagation(); open(state.i); };

    var dots = FEATURES.map(function (f, idx) {
      var dot = h('span', { className: 'wd-sp-dot' });
      var btn = h('button', {
        type: 'button', className: 'wd-sp-dotbtn', 'aria-label': 'Go to ' + f.title,
        onclick: function () { goTo(idx); }
      }, dot);
      btn._dot = dot;
      return btn;
    });
    var controls = h('div', { className: 'wd-sp-controls' }, [
      h('button', { type: 'button', className: 'wd-sp-nav', 'aria-label': 'Previous feature', onclick: function () { advance(-1); } }, '‹'),
      h('div', { className: 'wd-sp-dots' }, dots),
      h('button', { type: 'button', className: 'wd-sp-nav', 'aria-label': 'Next feature', onclick: function () { advance(1); } }, '›')
    ]);

    var root = h('section', { className: 'wd-section wd-spotlight' }, [
      h('div', { className: 'wd-section-label wd-sp-label' }, CD.t('dashboard.sectionWhereToStart', null, 'Where to start')),
      card, controls
    ]);

    var progress = 0, last = 0, raf = 0;

    function paint(fade) {
      var f = FEATURES[state.i];
      icon.textContent = f.icon;
      chip.textContent = f.chip;
      title.textContent = f.title;
      desc.textContent = f.desc;
      cta.textContent = f.cta + '  →';
      card.setAttribute('aria-label', 'Feature ' + (state.i + 1) + ' of ' + FEATURES.length + ': ' + f.title + '. Tap to open.');
      dots.forEach(function (b, idx) { b._dot.className = 'wd-sp-dot' + (idx === state.i ? ' is-active' : ''); });
      if (!reduced && fade) {
        content.classList.remove('is-in');
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () { content.classList.add('is-in'); });
        });
      } else {
        content.classList.add('is-in');
      }
    }
    function goTo(idx) {
      state.i = ((idx % FEATURES.length) + FEATURES.length) % FEATURES.length;
      progress = 0; bar.style.width = '0%';
      paint(true);
    }
    function advance(dir) { goTo(state.i + dir); }

    function tick(t) {
      if (!root.isConnected) { if (raf) window.cancelAnimationFrame(raf); raf = 0; return; }
      if (!last) last = t;
      var dt = t - last; last = t;
      if (!reduced && !state.paused) {
        progress += (dt / DWELL) * 100;
        if (progress >= 100) { advance(1); }
        else { bar.style.width = progress.toFixed(2) + '%'; }
      }
      raf = window.requestAnimationFrame(tick);
    }

    paint(false);
    if (!reduced && window.requestAnimationFrame) { raf = window.requestAnimationFrame(tick); }
    return root;
  }

  // ── small builders ────────────────────────────────────────────────────────
  function _featureCard(h, o) {
    var cls = 'wd-fcard' + (o.locked ? ' is-locked' : '') + (o.soon ? ' is-soon' : '');
    var c = h('div', { className: cls });
    if (o.soon) c.appendChild(h('span', { className: 'wd-fcard-flag' }, CD.t('dashboard.comingSoon', null, 'Coming soon')));
    else if (o.locked) c.appendChild(h('span', { className: 'wd-fcard-lock' }, '🔒 ' + CD.t('dashboard.unlock', null, 'Unlock')));
    c.appendChild(h('div', { className: 'wd-fcard-icon' }, o.icon));
    c.appendChild(h('div', { className: 'wd-fcard-title' }, o.title));
    c.appendChild(h('div', { className: 'wd-fcard-desc' }, o.desc));
    c.appendChild(h('div', { className: 'wd-fcard-foot' },
      h('span', { className: 'wd-tier-badge ' + (o.badgeCls || '') }, o.badge)));
    if (o.onClick && !o.soon) {
      c.classList.add('is-clickable');
      c.setAttribute('role', 'button');
      c.setAttribute('tabindex', '0');
      c.onclick = o.onClick;
      c.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.onClick(); }
      });
    }
    return c;
  }

  function _field(h, label, control) {
    return h('label', { className: 'wd-field' }, [
      h('span', { className: 'wd-field-label' }, label),
      control
    ]);
  }

  function _recoveryFallback(h, showScreen) {
    return h('button', {
      type: 'button', className: 'wd-recovery-fallback',
      onclick: function () { showScreen('recovery'); }
    }, [
      h('span', { className: 'wd-recovery-fallback-ico' }, '🛣️'),
      h('span', null, 'Open your Road to Recovery →')
    ]);
  }

  // ── AWW EMPTY-STATE ─────────────────────────────────────────────────────
  // Shown when profiles.current_aww is null. Friendly animated card explaining
  // AWW drives the weekly check; CTA launches the AWW Wizard (screen 'aww').
  function _awwEmptyState(h, reduced, showScreen) {
    var cardEl = h('div', { className: 'wd-card wd-aww-empty' + (reduced ? '' : ' wd-aww-empty-anim') });
    cardEl.appendChild(h('div', { className: 'wd-aww-empty-art', 'aria-hidden': 'true' }, [
      h('span', { className: 'wd-aww-coin' }, '💵'),
      h('span', { className: 'wd-aww-spark wd-aww-spark-1' }, '＋'),
      h('span', { className: 'wd-aww-spark wd-aww-spark-2' }, '✓')
    ]));
    cardEl.appendChild(h('h2', { className: 'wd-card-title wd-aww-empty-title' }, CD.t('dashboard.setAwwTitle', null, 'Set your Average Weekly Wage')));
    cardEl.appendChild(h('p', { className: 'wd-aww-empty-sub' },
      CD.t('dashboard.setAwwSub', null, 'Your weekly check is two-thirds of your Average Weekly Wage, up to the state maximum. ') +
      CD.t('dashboard.setAwwSub2', null, 'Tell us how you were paid and we\u2019ll calculate it — then your real weekly rate shows up right here.')));
    cardEl.appendChild(h('button', {
      type: 'button', className: 'wd-btn wd-btn-primary wd-aww-empty-cta',
      onclick: function () { showScreen('aww'); }
    }, CD.t('dashboard.calculateAww', null, 'Calculate my AWW →')));
    return cardEl;
  }

  // ── CASE SNAPSHOT + NEXT STEPS ──────────────────────────────────────────
  // Every row is driven off a REAL profile field. Present values render as a
  // read-only snapshot; missing values render as actionable next-step tiles.
  function _caseStatus(h, profile, showScreen, openAttorneyIntake) {
    profile = profile || {};
    var wrap = h('div', { className: 'wd-card wd-casestatus' });
    wrap.appendChild(h('div', { className: 'wd-card-hd' }, [
      h('h2', { className: 'wd-card-title' }, '🧭 ' + CD.t('dashboard.caseAtAGlance', null, 'Your case at a glance'))
    ]));

    // present-value snapshot — ONLY real values
    var snap = h('div', { className: 'wd-snap' });
    function snapRow(label, value) {
      snap.appendChild(h('div', { className: 'wd-snap-row' }, [
        h('span', { className: 'wd-snap-lbl' }, label),
        h('span', { className: 'wd-snap-val' }, value)
      ]));
    }
    if (profile.wcb_case_number) snapRow('WCB case #', String(profile.wcb_case_number));
    if (profile.doa) snapRow('Date of accident', _fmtDate(profile.doa));
    var parts = Array.isArray(profile.body_parts) ? profile.body_parts : [];
    if (parts.length) snapRow('Injury', parts.map(_titleCase).join(', '));
    if (profile.work_status) snapRow('Work status', WORK_STATUS_LABELS[profile.work_status] || profile.work_status);
    if (profile.treating_doctor) snapRow('Treating doctor', String(profile.treating_doctor));
    if (snap.children.length) wrap.appendChild(snap);

    // next-step tiles for each MISSING real field (actionable empty-states)
    var steps = [];
    if (!profile.wcb_case_number) steps.push({ icon: '📝', title: CD.t('dashboard.stepFileClaim', null, 'File your claim (C-3)'), desc: CD.t('dashboard.stepFileClaimDesc', null, 'Generate & file your Employee Claim with the WCB.'), screen: 'c3' });
    if (!profile.treating_doctor) steps.push({ icon: '🏥', title: CD.t('dashboard.stepFindDoctor', null, 'Find a treating doctor'), desc: CD.t('dashboard.stepFindDoctorDesc', null, 'Find a WCB-authorized doctor near you.'), screen: 'doctor' });
    if (!profile.has_attorney) steps.push({ icon: '⚖️', title: CD.t('dashboard.stepFindAttorney', null, 'Find an attorney'), desc: CD.t('dashboard.stepFindAttorneyDesc', null, 'Get matched with a workers\u2019 comp attorney — free.'), attorney: true });
    steps.push({ icon: '🔔', title: CD.t('dashboard.stepAddIme', null, 'Add your IME / appointment'), desc: CD.t('dashboard.stepAddImeDesc', null, 'Track IME & appointment dates so you never miss one.'), screen: 'ime' });
    if (!profile.oc110a_signed) steps.push({ icon: '🖊️', title: CD.t('dashboard.stepOc110a', null, 'Complete your medical authorization'), desc: CD.t('dashboard.stepOc110aDesc', null, 'Sign your OC-110a so we can monitor your case.'), screen: 'onboarding' });

    if (steps.length) {
      wrap.appendChild(h('div', { className: 'wd-steps-label' }, CD.t('dashboard.nextSteps', null, 'Next steps')));
      var list = h('div', { className: 'wd-steps' });
      steps.forEach(function (s) {
        var go = s.attorney ? function () { openAttorneyIntake({ source: 'dashboard' }); } : function () { showScreen(s.screen); };
        var row = h('div', { className: 'wd-step', role: 'button', tabIndex: '0' });
        row.onclick = go;
        row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        row.appendChild(h('span', { className: 'wd-step-ico' }, s.icon));
        row.appendChild(h('div', { className: 'wd-step-txt' }, [
          h('div', { className: 'wd-step-title' }, s.title),
          h('div', { className: 'wd-step-desc' }, s.desc)
        ]));
        row.appendChild(h('span', { className: 'wd-step-chev' }, '→'));
        list.appendChild(row);
      });
      wrap.appendChild(list);
    }
    return wrap;
  }

  function _titleCase(s) {
    return String(s || '').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function _fmtDate(d) {
    try {
      var p = String(d).split('-');
      if (p.length === 3) return new Date(p[0], Number(p[1]) - 1, p[2]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {}
    return String(d || '');
  }

  function _nextFriday() {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var add = (5 - d.getDay() + 7) % 7; if (add === 0) add = 7;
    d.setDate(d.getDate() + add);
    return d;
  }
  function _toDateInput(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // ── In-app PDF viewer + "My Documents" screen ───────────────────────────
  // Opens a stored filing INSIDE the app (signed URL in an iframe) so the worker
  // can READ their C-3 without downloading it. "Open externally" stays as a fallback.
  CD.openDocViewer = function (url, title) {
    if (!url) return;
    var ov = document.createElement('div'); ov.className = 'cd-docview-ov';
    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    var bar = document.createElement('div'); bar.className = 'cd-docview-bar';
    var ttl = document.createElement('div'); ttl.className = 'cd-docview-title'; ttl.textContent = title || 'Document';
    var openBtn = document.createElement('button'); openBtn.type = 'button'; openBtn.className = 'cd-docview-open'; openBtn.textContent = 'Open externally';
    openBtn.onclick = function () { try { window.open(url, '_blank'); } catch (e) { try { window.open(url, '_system'); } catch (e2) {} } };
    var x = document.createElement('button'); x.type = 'button'; x.className = 'cd-docview-x'; x.setAttribute('aria-label', 'Close'); x.textContent = '✕'; x.onclick = close;
    bar.appendChild(ttl); bar.appendChild(openBtn); bar.appendChild(x);
    var frame = document.createElement('iframe'); frame.className = 'cd-docview-frame'; frame.src = url; frame.setAttribute('title', title || 'Document');
    // Bottom-right "Done": the top-right ✕ sits in the iOS status-bar dead-zone
    // where touches don't always register — this is the reliable thumb-reach close.
    var done = document.createElement('button'); done.type = 'button'; done.className = 'cd-docview-done';
    done.textContent = 'Done'; done.setAttribute('aria-label', 'Close document'); done.onclick = close;
    ov.appendChild(bar); ov.appendChild(frame); ov.appendChild(done);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
  };
  // Mint a short-TTL signed URL for a stored "bucket/key" path, then view it in-app.
  function _viewSignedDoc(path, title) {
    var bk = _bucketAndKey(path);
    if (!CD.supa || !bk) { return; }
    CD.supa.storage.from(bk.bucket).createSignedUrl(bk.key, 300)
      .then(function (r) {
        var u = r && r.data && r.data.signedUrl;
        if (u) { CD.openDocViewer(u, title); }
        else { console.warn('[worker-dash] DOC_VIEW_FAILED', r && r.error); }
      })
      .catch(function (e) { console.warn('[worker-dash] DOC_VIEW_FAILED', e); });
  }
  // Full-screen "My Documents" screen (reached from the nav menu). Reuses the same
  // documents card the dashboard shows.
  CD.renderDocumentsScreen = function (showScreen) {
    var H = CD.h || window.h;
    showScreen = showScreen || CD.showScreen || function () {};
    var wrap = H('div', { className: 'content cd-docs-screen' });
    wrap.appendChild(H('div', { className: 'wd-docs-screen-intro', style: { padding: '4px 2px 12px', color: 'var(--txM)', fontSize: '13px', lineHeight: '1.5' } },
      'Your generated claim forms, saved here. Tap “View” to read a form in the app — no download needed.'));
    var card = _documentsCard(H, showScreen);
    if (card) { wrap.appendChild(card); }
    else { wrap.appendChild(H('div', { className: 'wd-appts-empty' }, 'Sign in to see your documents.')); }
    return wrap;
  };

  CD.WorkerDashboard = { render: render };
})(window);
