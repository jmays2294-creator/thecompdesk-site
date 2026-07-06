/* ============================================================================
 * job-buddy-wizard.js — Job Buddy first-run "Work Profile" wizard.
 * ----------------------------------------------------------------------------
 * A self-contained, surface-agnostic multi-step modal. It is the SINGLE front
 * door to a worker's Job Buddy profile — it collects the VOCATIONAL profile
 * (education, certs/licenses/courses, skills, languages, experience, prior
 * titles) AND the existing MEDICAL work restrictions in one flow.
 *
 * Two surfaces, one module (kept byte-identical app↔web):
 *   - Logged-in  → writes vocational_profiles + restriction_profiles under RLS
 *                  via the passed Supabase client, sets profiles.job_buddy_onboarded.
 *   - Anonymous  → localStorage ONLY. Persists NOTHING server-side. The copy says
 *                  so. On sign-in we offer to sync the local profile up.
 *
 * HARD RULES:
 *   - Nothing is inferred or saved until the user reaches Review and taps Confirm
 *     (sets vocational_confirmed_by_user / restriction confirmed_by_user). §114-a.
 *   - birth_year only (age band) — we never collect or store a full date of birth.
 *
 * Accessibility: focus-trapped, ESC + overlay-click → "finish later" (no save),
 * keyboard-navigable, 44px touch targets, prefers-reduced-motion respected.
 *
 * Public API (window.JobBuddyWizard, also mirrored to CD.JobBuddyWizard):
 *   JobBuddyWizard.open(opts)           -> force-open the wizard
 *   JobBuddyWizard.maybeAutoOpen(opts)  -> open once (logged-in: !job_buddy_onboarded;
 *                                          anon: once per session) -> Promise<bool>
 *   JobBuddyWizard.hasLocalProfile()    -> bool (an anon profile is saved on this device)
 *   JobBuddyWizard.loadLocal()          -> the saved local profile | null
 *   JobBuddyWizard.syncLocalToSupabase(supa, userId) -> Promise (push local → account)
 *   opts: { supabase, user:{id}, profile?, calc?, force?, onComplete?(data), onClose?() }
 * ==========================================================================*/
(function (global) {
  'use strict';

  var W = global.JobBuddyWizard = global.JobBuddyWizard || {};
  var CD = global.CD = global.CD || {};
  CD.JobBuddyWizard = W;

  // ─── storage keys ─────────────────────────────────────────────────────────
  var LS_PROFILE = 'jb_voc_profile_v1';   // localStorage: the anon-saved work profile (voc + restrictions)
  var SS_SEEN    = 'jb_wizard_seen_v1';    // sessionStorage: once-per-session auto-open suppressor

  // ─── option presets (WC-population tuned) ─────────────────────────────────
  var EDUCATION = [
    { v: 'none', l: 'No formal schooling' },
    { v: 'some_hs', l: 'Some high school' },
    { v: 'hs_ged', l: 'High school / GED' },
    { v: 'some_college', l: 'Some college' },
    { v: 'associate', l: 'Associate degree' },
    { v: 'bachelor', l: "Bachelor's degree" },
    { v: 'graduate', l: 'Graduate degree' },
    { v: 'vocational_cert', l: 'Vocational / trade certificate' }
  ];
  var COMPUTER = [
    { v: 'none', l: 'None' }, { v: 'basic', l: 'Basic' },
    { v: 'intermediate', l: 'Intermediate' }, { v: 'advanced', l: 'Advanced' }
  ];
  var PROFICIENCY = ['Basic', 'Conversational', 'Fluent', 'Native'];
  var FREQ = [
    { v: '', l: '—' }, { v: 'none', l: 'None' }, { v: 'occasional', l: 'Occasional' },
    { v: 'frequent', l: 'Frequent' }, { v: 'unrestricted', l: 'Unrestricted' }
  ];
  var LICENSE_PRESETS = ['CDL-A', 'CDL-B', 'Forklift', 'Security Guard', 'CNA', 'HHA (Home Health Aide)'];
  var CERT_PRESETS    = ['OSHA-10', 'OSHA-30', 'Food Handler', 'Basic Computer', 'Bilingual'];
  var LANG_PRESETS    = ['English', 'Spanish', 'Polish', 'Russian', 'Haitian Creole', 'Mandarin', 'Bengali'];

  var DISCLAIMER = 'This tool is for informational purposes only and does not constitute legal advice.';

  // ─── tiny DOM helper (mirrors job-buddy-public.js el()) ───────────────────
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null) return;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') n[k] = !!v;
      else n.setAttribute(k, v);
    });
    (Array.isArray(kids) ? kids : (kids == null ? [] : [kids])).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return n;
  }
  function intOrNull(v) { var n = parseInt(v, 10); return isNaN(n) ? null : n; }
  function nowISO() { return new Date().toISOString(); }
  function thisYear() { return new Date().getFullYear(); }
  function ageBand(birthYear) {
    if (!birthYear) return null;
    var age = thisYear() - birthYear;
    if (age < 0 || age > 120) return null;
    if (age < 25) return 'Under 25';
    if (age < 35) return '25–34';
    if (age < 45) return '35–44';
    if (age < 55) return '45–54';
    if (age < 65) return '55–64';
    return '65+';
  }

  // ─── draft model ──────────────────────────────────────────────────────────
  function emptyDraft() {
    return {
      // vocational_profiles
      birth_year: null, education_level: '', computer_proficiency: '',
      years_experience: null, prior_job_titles: [], certifications: [],
      licenses: [], courses: [], special_skills: [], languages: [],
      transferable_skills_summary: '',
      // restriction_profiles (medical)
      lifting_limit_lbs: null, stand_minutes: null, sit_minutes: null,
      bend_twist: '', overhead_reach: '', can_drive: null, other_restrictions: ''
    };
  }

  // Map a saved vocational_profiles row + restriction_profiles row onto a draft.
  function draftFromRows(voc, rest) {
    var d = emptyDraft();
    if (voc) {
      d.birth_year = voc.birth_year != null ? voc.birth_year : null;
      d.education_level = voc.education_level || '';
      d.computer_proficiency = voc.computer_proficiency || '';
      d.years_experience = voc.years_experience != null ? voc.years_experience : null;
      d.prior_job_titles = Array.isArray(voc.prior_job_titles) ? voc.prior_job_titles.slice() : [];
      d.certifications = Array.isArray(voc.certifications) ? voc.certifications.slice() : [];
      d.licenses = Array.isArray(voc.licenses) ? voc.licenses.slice() : [];
      d.courses = Array.isArray(voc.courses) ? voc.courses.slice() : [];
      d.special_skills = Array.isArray(voc.special_skills) ? voc.special_skills.slice() : [];
      d.languages = Array.isArray(voc.languages) ? voc.languages.slice() : [];
      d.transferable_skills_summary = voc.transferable_skills_summary || '';
    }
    if (rest) {
      d.lifting_limit_lbs = rest.lifting_limit_lbs != null ? rest.lifting_limit_lbs : null;
      d.stand_minutes = rest.stand_minutes != null ? rest.stand_minutes : null;
      d.sit_minutes = rest.sit_minutes != null ? rest.sit_minutes : null;
      d.bend_twist = rest.bend_twist || '';
      d.overhead_reach = rest.overhead_reach || '';
      d.can_drive = (rest.can_drive === true || rest.can_drive === false) ? rest.can_drive : null;
      d.other_restrictions = rest.other_restrictions || '';
    }
    return d;
  }

  // Split a draft into the two persistence payloads (only valid columns each).
  function vocPayload(d) {
    return {
      birth_year: d.birth_year, education_level: d.education_level || null,
      certifications: d.certifications || [], licenses: d.licenses || [],
      courses: d.courses || [], special_skills: d.special_skills || [],
      languages: d.languages || [], computer_proficiency: d.computer_proficiency || null,
      years_experience: d.years_experience, prior_job_titles: d.prior_job_titles || [],
      transferable_skills_summary: d.transferable_skills_summary || null
    };
  }
  function restPayload(d) {
    return {
      lifting_limit_lbs: d.lifting_limit_lbs, stand_minutes: d.stand_minutes, sit_minutes: d.sit_minutes,
      bend_twist: d.bend_twist || null, overhead_reach: d.overhead_reach || null,
      can_drive: (d.can_drive === true || d.can_drive === false) ? d.can_drive : null,
      other_restrictions: d.other_restrictions || null, source: 'manual'
    };
  }

  // ─── persistence ──────────────────────────────────────────────────────────
  W.loadLocal = function () {
    try { return JSON.parse(global.localStorage.getItem(LS_PROFILE) || 'null'); } catch (e) { return null; }
  };
  W.hasLocalProfile = function () { return !!W.loadLocal(); };
  function saveLocal(d) {
    // Only ever called from the Review → Confirm step, so stamp the confirmed flags
    // (mirrors saveSupabase). Job Buddy's live matcher requires confirmed_by_user, and
    // the standalone Restrictions tab reads this same device record.
    try {
      global.localStorage.setItem(LS_PROFILE, JSON.stringify({
        voc: Object.assign({ vocational_confirmed_by_user: true }, vocPayload(d)),
        rest: Object.assign({ confirmed_by_user: true }, restPayload(d)),
        saved_at: nowISO()
      }));
    } catch (e) {}
  }
  W.clearLocal = function () { try { global.localStorage.removeItem(LS_PROFILE); } catch (e) {} };

  function throwErr(r) { if (r && r.error) throw r.error; return r && r.data; }

  // Write both profiles + flip the onboarded/enabled flags. Confirms on save.
  function saveSupabase(supa, userId, d) {
    var voc = Object.assign({ user_id: userId, updated_at: nowISO(), vocational_confirmed_by_user: true }, vocPayload(d));
    var rest = Object.assign({ user_id: userId, updated_at: nowISO(), confirmed_by_user: true }, restPayload(d));
    return supa.from('vocational_profiles').upsert(voc, { onConflict: 'user_id' }).select().maybeSingle().then(throwErr)
      .then(function () { return supa.from('restriction_profiles').upsert(rest, { onConflict: 'user_id' }).select().maybeSingle().then(throwErr); })
      .then(function () { return supa.from('profiles').update({ job_buddy_onboarded: true, job_buddy_enabled: true }).eq('id', userId); })
      .then(function (r) { if (r && r.error) throw r.error; return true; });
  }

  // Push a device-saved (anon) profile up to the account after sign-in.
  W.syncLocalToSupabase = function (supa, userId) {
    var local = W.loadLocal();
    if (!local || !supa || !userId) return Promise.reject(new Error('Nothing to sync.'));
    var d = draftFromRows(local.voc, local.rest);
    return saveSupabase(supa, userId, d).then(function () { W.clearLocal(); return true; });
  };

  // ════════════════════════════════════════════════════════════════════════
  // MODAL
  // ════════════════════════════════════════════════════════════════════════
  var _openInstance = null;

  function markSeen() { try { global.sessionStorage.setItem(SS_SEEN, '1'); } catch (e) {} }
  function wasSeen() { try { return !!global.sessionStorage.getItem(SS_SEEN); } catch (e) { return false; } }

  W.maybeAutoOpen = function (opts) {
    opts = opts || {};
    if (opts.user && opts.supabase) {
      var prof = opts.profile;
      var check = (prof && typeof prof.job_buddy_onboarded !== 'undefined')
        ? Promise.resolve(prof)
        : opts.supabase.from('profiles').select('job_buddy_onboarded').eq('id', opts.user.id).maybeSingle().then(function (r) { return r.data; });
      return Promise.resolve(check).then(function (p) {
        if (p && p.job_buddy_onboarded) return false;
        W.open(opts); return true;
      }).catch(function () { return false; });  // never block the page on a profile read
    }
    // anonymous — once per browser session
    if (wasSeen()) return Promise.resolve(false);
    W.open(opts);
    return Promise.resolve(true);
  };

  W.open = function (opts) {
    opts = opts || {};
    if (_openInstance) return _openInstance;
    markSeen();  // opening counts as "seen" so finish-later/skip won't reopen this session

    var loggedIn = !!(opts.supabase && opts.user && opts.user.id);
    var state = { step: 0, draft: emptyDraft(), fromLocal: false, saving: false, errorMsg: '' };
    var lastFocused = document.activeElement;

    // ── overlay + dialog shell ──
    var overlay = el('div', { class: 'jbw-overlay', role: 'presentation' });
    var dialog = el('div', {
      class: 'jbw-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'jbw-title'
    });
    overlay.appendChild(dialog);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) finishLater(); });

    var STEPS = [
      { key: 'welcome', label: 'Welcome', render: renderWelcome },
      { key: 'background', label: 'Work background', render: renderBackground },
      { key: 'education', label: 'Education & training', render: renderEducation },
      { key: 'medical', label: 'Medical restrictions', render: renderMedical },
      { key: 'review', label: 'Review & confirm', render: renderReview }
    ];

    var header = el('div', { class: 'jbw-head' });
    var body = el('div', { class: 'jbw-body', id: 'jbw-body', tabindex: '-1' });
    var footer = el('div', { class: 'jbw-foot' });
    dialog.appendChild(header); dialog.appendChild(body); dialog.appendChild(footer);

    document.body.appendChild(overlay);
    document.body.classList.add('jbw-open');
    _openInstance = overlay;

    // focus trap
    overlay.addEventListener('keydown', onKeydown);

    // Prefill, then paint.
    prefill().then(function () { paint(); });

    function prefill() {
      if (loggedIn) {
        return Promise.all([
          opts.supabase.from('vocational_profiles').select('*').eq('user_id', opts.user.id).maybeSingle(),
          opts.supabase.from('restriction_profiles').select('*').eq('user_id', opts.user.id).maybeSingle()
        ]).then(function (res) {
          var voc = res[0] && res[0].data, rest = res[1] && res[1].data;
          if (voc || rest) { state.draft = draftFromRows(voc, rest); return; }
          // No server profile yet — offer to reuse a device-saved one (sign-in sync path).
          var local = W.loadLocal();
          if (local) { state.draft = draftFromRows(local.voc, local.rest); state.fromLocal = true; }
        }).catch(function () { /* prefill is best-effort */ });
      }
      var l = W.loadLocal();
      if (l) state.draft = draftFromRows(l.voc, l.rest);
      return Promise.resolve();
    }

    // ── render orchestration ──
    function paint() {
      var s = STEPS[state.step];
      // header
      header.innerHTML = '';
      header.appendChild(el('div', { class: 'jbw-eyebrow' }, loggedIn ? 'Job Buddy · Work profile' : 'Job Buddy · Work profile (this device only)'));
      var titleRow = el('div', { class: 'jbw-titlerow' }, [
        el('h2', { class: 'jbw-title', id: 'jbw-title' }, s.label),
        el('button', { class: 'jbw-x', type: 'button', 'aria-label': 'Finish later', onclick: finishLater }, '×')
      ]);
      header.appendChild(titleRow);
      header.appendChild(renderStepDots());

      // body
      body.innerHTML = '';
      s.render(body);
      if (state.errorMsg) body.appendChild(el('div', { class: 'jbw-error', role: 'alert' }, state.errorMsg));

      // footer
      footer.innerHTML = '';
      renderFooter();

      // focus the body region for screen readers / keyboard
      try { (dialog.querySelector('.jbw-autofocus') || body).focus(); } catch (e) {}
    }

    function renderStepDots() {
      var dots = el('ol', { class: 'jbw-dots', 'aria-label': 'Progress' });
      STEPS.forEach(function (st, i) {
        dots.appendChild(el('li', {
          class: 'jbw-dot' + (i === state.step ? ' is-active' : (i < state.step ? ' is-done' : '')),
          'aria-current': i === state.step ? 'step' : null
        }, String(i + 1)));
      });
      return dots;
    }

    function renderFooter() {
      var left = el('div', { class: 'jbw-foot-l' });
      var right = el('div', { class: 'jbw-foot-r' });

      if (state.step === 0) {
        left.appendChild(el('button', { class: 'jbw-btn ghost', type: 'button', onclick: finishLater }, 'Skip for now'));
        right.appendChild(el('button', { class: 'jbw-btn primary jbw-autofocus', type: 'button', onclick: next }, 'Get started'));
      } else if (state.step === STEPS.length - 1) {
        left.appendChild(el('button', { class: 'jbw-btn ghost', type: 'button', onclick: back }, '← Back'));
        var save = el('button', {
          class: 'jbw-btn primary', type: 'button', disabled: !state.confirmChecked || state.saving,
          onclick: doSave
        }, state.saving ? 'Saving…' : (loggedIn ? 'Confirm & save' : 'Confirm & save to this device'));
        state._saveBtn = save;
        right.appendChild(save);
      } else {
        left.appendChild(el('button', { class: 'jbw-btn ghost', type: 'button', onclick: back }, '← Back'));
        right.appendChild(el('button', { class: 'jbw-btn primary', type: 'button', onclick: next }, 'Next →'));
      }
      footer.appendChild(left); footer.appendChild(right);
    }

    function next() { if (state.step < STEPS.length - 1) { state.step++; state.errorMsg = ''; paint(); } }
    function back() { if (state.step > 0) { state.step--; state.errorMsg = ''; paint(); } }

    // ── step 1: welcome ──
    function renderWelcome(mount) {
      mount.appendChild(el('p', { class: 'jbw-lead' },
        'A few quick questions so we only show you jobs you can actually be hired for — your background, training, and your medical work restrictions.'));
      var ul = el('ul', { class: 'jbw-welcome-list' }, [
        el('li', {}, 'Takes about 2 minutes. You can skip any question.'),
        el('li', {}, 'Nothing is saved until you review and confirm at the end.'),
        el('li', {}, loggedIn
          ? 'Saved securely to your account — only you (and your attorney, if you have one) can see it.'
          : 'You’re not signed in, so this stays on this device only. Sign in anytime to save it to your account.')
      ]);
      mount.appendChild(ul);
    }

    // ── step 2: work background ──
    function renderBackground(mount) {
      var d = state.draft;
      // Year of birth (age band only)
      var byInput = el('input', {
        class: 'jbw-input jbw-autofocus', type: 'number', inputmode: 'numeric',
        min: '1900', max: String(thisYear()), placeholder: 'e.g. 1985',
        value: d.birth_year == null ? '' : d.birth_year, 'aria-describedby': 'jbw-age-band'
      });
      var bandOut = el('span', { class: 'jbw-ageband', id: 'jbw-age-band' }, d.birth_year ? ('Age band: ' + (ageBand(d.birth_year) || '—')) : '');
      byInput.addEventListener('input', function () {
        d.birth_year = intOrNull(byInput.value);
        bandOut.textContent = d.birth_year ? ('Age band: ' + (ageBand(d.birth_year) || '—')) : '';
      });
      mount.appendChild(fieldWrap('Year of birth', [el('div', { class: 'jbw-in-row' }, [byInput, bandOut])],
        'We use your age band only — never your full date of birth.'));

      // Years of experience
      var yrs = el('input', { class: 'jbw-input', type: 'number', inputmode: 'numeric', min: '0', max: '80', placeholder: 'e.g. 12', value: d.years_experience == null ? '' : d.years_experience });
      yrs.addEventListener('input', function () { d.years_experience = intOrNull(yrs.value); });
      mount.appendChild(fieldWrap('Total years of work experience', [yrs]));

      // Prior job titles (chips)
      mount.appendChild(chipField('Jobs you’ve held', 'prior_job_titles', [], 'Add a job title and press Enter (e.g. Warehouse Associate)'));

      // Languages
      mount.appendChild(renderLanguages());
    }

    function renderLanguages() {
      var d = state.draft;
      var wrap = el('div', { class: 'jbw-fld' });
      wrap.appendChild(el('span', { class: 'jbw-lbl' }, 'Languages you speak'));
      var list = el('div', { class: 'jbw-langlist' });
      function repaint() {
        list.innerHTML = '';
        d.languages.forEach(function (lang, i) {
          var name = el('input', { class: 'jbw-input jbw-lang-name', type: 'text', value: lang.language || '', placeholder: 'Language' });
          name.addEventListener('input', function () { d.languages[i].language = name.value; });
          var prof = el('select', { class: 'jbw-input jbw-lang-prof', 'aria-label': 'Proficiency' });
          prof.appendChild(el('option', { value: '' }, 'Proficiency'));
          PROFICIENCY.forEach(function (p) { prof.appendChild(el('option', { value: p, selected: lang.proficiency === p }, p)); });
          prof.addEventListener('change', function () { d.languages[i].proficiency = prof.value; });
          var rm = el('button', { class: 'jbw-chip-x', type: 'button', 'aria-label': 'Remove language', onclick: function () { d.languages.splice(i, 1); repaint(); } }, '×');
          list.appendChild(el('div', { class: 'jbw-langrow' }, [name, prof, rm]));
        });
      }
      function add(langName) {
        if (d.languages.some(function (x) { return (x.language || '').toLowerCase() === langName.toLowerCase(); })) return;
        d.languages.push({ language: langName, proficiency: '' }); repaint();
      }
      repaint();
      var presetRow = el('div', { class: 'jbw-presets' });
      LANG_PRESETS.forEach(function (p) {
        presetRow.appendChild(el('button', { class: 'jbw-preset', type: 'button', onclick: function () { add(p); } }, '+ ' + p));
      });
      var addBtn = el('button', { class: 'jbw-btn ghost jbw-addmore', type: 'button', onclick: function () { d.languages.push({ language: '', proficiency: '' }); repaint(); } }, '+ Add another language');
      wrap.appendChild(list); wrap.appendChild(presetRow); wrap.appendChild(addBtn);
      return wrap;
    }

    // ── step 3: education & training ──
    function renderEducation(mount) {
      var d = state.draft;
      var sel = el('select', { class: 'jbw-input jbw-autofocus' });
      sel.appendChild(el('option', { value: '' }, 'Select your highest level…'));
      EDUCATION.forEach(function (o) { sel.appendChild(el('option', { value: o.v, selected: d.education_level === o.v }, o.l)); });
      sel.addEventListener('change', function () { d.education_level = sel.value || ''; });
      mount.appendChild(fieldWrap('Highest level of education', [sel]));

      var cp = el('select', { class: 'jbw-input' });
      cp.appendChild(el('option', { value: '' }, 'Select…'));
      COMPUTER.forEach(function (o) { cp.appendChild(el('option', { value: o.v, selected: d.computer_proficiency === o.v }, o.l)); });
      cp.addEventListener('change', function () { d.computer_proficiency = cp.value || ''; });
      mount.appendChild(fieldWrap('Comfort with computers', [cp]));

      mount.appendChild(chipField('Licenses', 'licenses', LICENSE_PRESETS, 'Add a license and press Enter'));
      mount.appendChild(chipField('Certifications', 'certifications', CERT_PRESETS, 'Add a certification and press Enter'));
      mount.appendChild(chipField('Courses / training', 'courses', [], 'Add a course and press Enter'));
      mount.appendChild(chipField('Special skills', 'special_skills', [], 'Add a skill and press Enter (e.g. bilingual, welding)'));
    }

    // ── step 4: medical restrictions (reuses the restriction fields) ──
    function renderMedical(mount) {
      var d = state.draft;
      mount.appendChild(el('p', { class: 'jbw-help' },
        'These come from your IME or C-4.3. We use them to match jobs you can safely do. Enter what your doctor restricted — you’ll confirm everything on the next step.'));

      var grid = el('div', { class: 'jbw-grid' });
      grid.appendChild(numField('Lifting limit', 'lifting_limit_lbs', 'lbs', 'e.g. 10', true));
      grid.appendChild(numField('Standing tolerance', 'stand_minutes', 'min', 'e.g. 20'));
      grid.appendChild(numField('Sitting tolerance', 'sit_minutes', 'min', 'e.g. 60'));
      grid.appendChild(selField('Bend / twist', 'bend_twist', FREQ));
      grid.appendChild(selField('Overhead reach', 'overhead_reach', FREQ));
      grid.appendChild(selField('Can you drive?', 'can_drive', [{ v: '', l: '—' }, { v: 'true', l: 'Yes' }, { v: 'false', l: 'No' }], true));
      mount.appendChild(grid);

      var ta = el('textarea', { class: 'jbw-input jbw-ta', placeholder: 'Anything else your doctor restricted (e.g. no repetitive bending, no ladders)…' });
      ta.value = d.other_restrictions || '';
      ta.addEventListener('input', function () { d.other_restrictions = ta.value; });
      mount.appendChild(fieldWrap('Other restrictions', [ta]));
    }

    // ── step 5: review & confirm ──
    function renderReview(mount) {
      var d = state.draft;
      if (state.fromLocal) {
        mount.appendChild(el('div', { class: 'jbw-synced', role: 'status' },
          'We found a work profile saved on this device and filled it in below. Confirm to save it to your account.'));
      }
      mount.appendChild(el('p', { class: 'jbw-help' },
        'Please review everything. Nothing is saved until you check the box and confirm — we never guess or fill anything in for you.'));

      var dl = el('dl', { class: 'jbw-review' });
      function row(label, val) {
        dl.appendChild(el('dt', {}, label));
        dl.appendChild(el('dd', { class: (val == null || val === '' || (Array.isArray(val) && !val.length)) ? 'is-empty' : '' },
          Array.isArray(val) ? (val.length ? val.join(', ') : 'Not provided') : (val == null || val === '' ? 'Not provided' : String(val))));
      }
      var eduLabel = (EDUCATION.filter(function (e) { return e.v === d.education_level; })[0] || {}).l || '';
      var cpLabel = (COMPUTER.filter(function (e) { return e.v === d.computer_proficiency; })[0] || {}).l || '';
      row('Age band', d.birth_year ? (ageBand(d.birth_year) + ' (born ' + d.birth_year + ')') : '');
      row('Years of experience', d.years_experience);
      row('Jobs held', d.prior_job_titles);
      row('Languages', d.languages.map(function (x) { return x.language + (x.proficiency ? ' (' + x.proficiency + ')' : ''); }));
      row('Education', eduLabel);
      row('Computer comfort', cpLabel);
      row('Licenses', d.licenses);
      row('Certifications', d.certifications);
      row('Courses / training', d.courses);
      row('Special skills', d.special_skills);
      row('Lifting limit', d.lifting_limit_lbs != null ? d.lifting_limit_lbs + ' lbs' : '');
      row('Standing tolerance', d.stand_minutes != null ? d.stand_minutes + ' min' : '');
      row('Sitting tolerance', d.sit_minutes != null ? d.sit_minutes + ' min' : '');
      row('Bend / twist', d.bend_twist);
      row('Overhead reach', d.overhead_reach);
      row('Can drive', d.can_drive === true ? 'Yes' : (d.can_drive === false ? 'No' : ''));
      row('Other restrictions', d.other_restrictions);
      mount.appendChild(dl);

      var cbId = 'jbw-confirm';
      var cb = el('input', { type: 'checkbox', id: cbId, checked: !!state.confirmChecked });
      cb.addEventListener('change', function () {
        state.confirmChecked = cb.checked;
        if (state._saveBtn) state._saveBtn.disabled = !cb.checked || state.saving;
      });
      mount.appendChild(el('label', { class: 'jbw-confirm', htmlFor: cbId }, [
        cb,
        el('span', {}, loggedIn
          ? 'I confirm this information is accurate and current, and I want to save it to my account.'
          : 'I confirm this information is accurate and current. I understand it is saved on this device only until I sign in.')
      ]));

      mount.appendChild(el('p', { class: 'jbw-disclaimer' }, DISCLAIMER));
    }

    // ── save ──
    function doSave() {
      if (!state.confirmChecked || state.saving) return;
      state.saving = true; state.errorMsg = '';
      if (state._saveBtn) { state._saveBtn.disabled = true; state._saveBtn.textContent = 'Saving…'; }
      var d = state.draft;
      var done = function () {
        state.saving = false;
        try { if (typeof opts.onComplete === 'function') opts.onComplete({ voc: vocPayload(d), rest: restPayload(d), loggedIn: loggedIn }); } catch (e) {}
        try { global.dispatchEvent(new CustomEvent('jobbuddy:profile-updated', { detail: { loggedIn: loggedIn, voc: vocPayload(d), rest: restPayload(d) } })); } catch (e) {}
        close();
      };
      if (loggedIn) {
        saveSupabase(opts.supabase, opts.user.id, d).then(function () {
          if (state.fromLocal) W.clearLocal();  // synced a device profile up → drop the local copy
        }).then(done).catch(function (e) {
          state.saving = false; state.errorMsg = (e && e.message) ? ('Couldn’t save: ' + e.message) : 'Couldn’t save — please try again.';
          paint();
        });
      } else {
        saveLocal(d); done();
      }
    }

    // ── close paths ──
    function finishLater() { close(); }
    function close() {
      try { overlay.removeEventListener('keydown', onKeydown); } catch (e) {}
      try { document.body.removeChild(overlay); } catch (e) {}
      document.body.classList.remove('jbw-open');
      _openInstance = null;
      try { if (lastFocused && lastFocused.focus) lastFocused.focus(); } catch (e) {}
      try { if (typeof opts.onClose === 'function') opts.onClose(); } catch (e) {}
    }

    // ── focus trap + ESC ──
    function focusables() {
      return Array.prototype.slice.call(dialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(function (n) { return n.offsetParent !== null || n === document.activeElement; });
    }
    function onKeydown(e) {
      if (e.key === 'Escape') { e.preventDefault(); finishLater(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    // ── shared field builders ──
    function fieldWrap(label, kids, help) {
      var c = el('label', { class: 'jbw-fld' }, [el('span', { class: 'jbw-lbl' }, label)]);
      kids.forEach(function (k) { c.appendChild(k); });
      if (help) c.appendChild(el('span', { class: 'jbw-fld-help' }, help));
      return c;
    }
    function numField(label, key, suffix, ph, autofocus) {
      var d = state.draft;
      var inp = el('input', { class: 'jbw-input' + (autofocus ? ' jbw-autofocus' : ''), type: 'number', inputmode: 'numeric', placeholder: ph || '', value: d[key] == null ? '' : d[key] });
      inp.addEventListener('input', function () { d[key] = intOrNull(inp.value); });
      return el('label', { class: 'jbw-fld' }, [
        el('span', { class: 'jbw-lbl' }, label),
        el('div', { class: 'jbw-in-suf' }, [inp, suffix ? el('span', { class: 'jbw-suf' }, suffix) : null])
      ]);
    }
    function selField(label, key, optsArr, isBool) {
      var d = state.draft;
      var sel = el('select', { class: 'jbw-input' });
      optsArr.forEach(function (o) {
        var cur = isBool ? (d[key] === true ? 'true' : (d[key] === false ? 'false' : '')) : (d[key] == null ? '' : String(d[key]));
        sel.appendChild(el('option', { value: o.v, selected: String(cur) === String(o.v) }, o.l));
      });
      sel.addEventListener('change', function () {
        if (isBool) d[key] = sel.value === 'true' ? true : (sel.value === 'false' ? false : null);
        else d[key] = sel.value || '';
      });
      return el('label', { class: 'jbw-fld' }, [el('span', { class: 'jbw-lbl' }, label), sel]);
    }
    function chipField(label, key, presets, ph) {
      var d = state.draft;
      var wrap = el('div', { class: 'jbw-fld' });
      wrap.appendChild(el('span', { class: 'jbw-lbl' }, label));
      var chipBox = el('div', { class: 'jbw-chips' });
      function repaint() {
        chipBox.innerHTML = '';
        d[key].forEach(function (val, i) {
          chipBox.appendChild(el('span', { class: 'jbw-chip' }, [
            document.createTextNode(val),
            el('button', { class: 'jbw-chip-x', type: 'button', 'aria-label': 'Remove ' + val, onclick: function () { d[key].splice(i, 1); repaint(); } }, '×')
          ]));
        });
      }
      function add(v) {
        v = (v || '').trim(); if (!v) return;
        if (d[key].some(function (x) { return x.toLowerCase() === v.toLowerCase(); })) return;
        d[key].push(v); repaint();
      }
      repaint();
      var inp = el('input', { class: 'jbw-input', type: 'text', placeholder: ph || 'Add and press Enter' });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add(inp.value); inp.value = ''; } });
      var addBtn = el('button', { class: 'jbw-chip-add', type: 'button', 'aria-label': 'Add', onclick: function () { add(inp.value); inp.value = ''; inp.focus(); } }, 'Add');
      wrap.appendChild(chipBox);
      wrap.appendChild(el('div', { class: 'jbw-in-row' }, [inp, addBtn]));
      if (presets && presets.length) {
        var presetRow = el('div', { class: 'jbw-presets' });
        presets.forEach(function (p) { presetRow.appendChild(el('button', { class: 'jbw-preset', type: 'button', onclick: function () { add(p); } }, '+ ' + p)); });
        wrap.appendChild(presetRow);
      }
      return wrap;
    }

    return overlay;
  };

})(typeof window !== 'undefined' ? window : this);
