/* ============================================================================
 * Comp Buddy Intake — Phase D (Weeks 10–13)
 * ----------------------------------------------------------------------------
 * Single-source 4-step injured-worker intake flow. Authored ONCE here in the
 * app and VENDORED byte-for-byte to ops/website/js/dashboard/ for the website,
 * exactly like worker-dashboard.js / attorney-dashboard.js.
 *
 * Public API:  window.CD.CompBuddyIntake.render(ctx) -> DOMNode
 *
 * ctx (all optional except supabase + user):
 *   supabase     Supabase client       (app: CD.supa | web: window client)
 *   user         { id }                 signed-in user (auth.uid)
 *   profile      profiles row (or {})   used to prefill email/name on first run
 *   tier         current effective tier ('free'|'comp_buddy'|'pro'|'firm'|null)
 *   isNative     bool                   true inside Capacitor
 *   onComplete   fn()                   called after a successful upsert
 *   goToDashboard fn()                  navigate to the post-auth dashboard
 *   toast        fn(msg,type)           optional host toast; module has a fallback
 *
 * Platform seams (the ONLY legitimate per-surface differences — handled INSIDE
 * this one file so the markup/validation/columns stay identical):
 *   • HTTP transport — handled at the Supabase client level (app client is
 *     created with CapacitorHttp-patched fetch; web uses normal fetch). We just
 *     call ctx.supabase, so transport parity is automatic.
 *   • Autosave store — Capacitor Preferences when present, else localStorage.
 *   • Signature input — pointer events cover mouse (web) + touch (app).
 *   • Redirect target — ctx.goToDashboard / ctx.onComplete.
 *
 * Authoritative column map: ops/secretary/dispatch_phase_d_comp_buddy_intake.md §3
 * NO MIGRATION. Live prod column names only. Writes language_pref (never
 * preferred_language); needs_transportation (TRUE = needs help); has_attorney +
 * attorney_* family (never current_attorney). work_status validated client-side
 * (no CHECK in prod). oc110a_signed_date is a DATE (date precision only).
 * ========================================================================== */
(function (window) {
  'use strict';
  var CD = (window.CD = window.CD || {});

  /* ---- constants -------------------------------------------------------- */
  var STEP_NAMES = { 1: 'About You', 2: 'Your Case', 3: 'Medical & Prefs', 4: 'Review & Sign' };

  // 21 body parts — canonical lowercase values stored in body_parts TEXT[].
  var BODY_PARTS = [
    ['head', 'Head'], ['neck', 'Neck'], ['left shoulder', 'L Shoulder'], ['right shoulder', 'R Shoulder'],
    ['left arm', 'L Arm'], ['right arm', 'R Arm'], ['left hand', 'L Hand'], ['right hand', 'R Hand'],
    ['upper back', 'Upper Back'], ['lower back', 'Lower Back'], ['left hip', 'L Hip'], ['right hip', 'R Hip'],
    ['left knee', 'L Knee'], ['right knee', 'R Knee'], ['left ankle', 'L Ankle'], ['right ankle', 'R Ankle'],
    ['left foot', 'L Foot'], ['right foot', 'R Foot'], ['chest', 'Chest'], ['abdomen', 'Abdomen'],
    ['psychological', 'Psychological']
  ];

  // work_status — the 4-value allowlist (NO CHECK constraint in prod).
  var WORK_STATUS = ['working', 'light_duty', 'not_working', 'terminated'];
  var WORK_STATUS_CARDS = [
    ['not_working', 'Not Working', 'Fully out of work due to injury'],
    ['light_duty', 'Light Duty', 'Working with medical restrictions'],
    ['working', 'Working Full Duty', 'Returned to full work capacity'],
    ['terminated', 'Terminated / Laid Off', 'Employment ended']
  ];
  var WORK_STATUS_LABELS = {
    working: 'Full Duty', light_duty: 'Light Duty', not_working: 'Not Working', terminated: 'Terminated'
  };

  var LANGS = [
    ['en', 'English'], ['es', 'Español (Spanish)'], ['zh', '中文 (Chinese)'],
    ['ru', 'Русский (Russian)'], ['ko', '한국어 (Korean)'],
    ['pl', 'Polski (Polish)'], ['ht', 'Kreyòl (Haitian Creole)'], ['bn', 'বাংলা (Bengali)'],
    ['ar', 'العربية (Arabic)'], ['other', 'Other']
  ];
  var LANG_LABELS = {};
  LANGS.forEach(function (l) { LANG_LABELS[l[0]] = l[1].replace(/\s*\(.*\)$/, ''); });

  var OC110A_DISCLOSURE =
    'By signing below, you authorize the Workers’ Compensation Board and your ' +
    'employer’s insurance carrier to access your medical records related to this ' +
    'claim. This authorization is valid for one (1) year from the date of signature. ' +
    'You may revoke this authorization at any time in writing.';

  var STORAGE_PREFIX = 'cbi:intake:';

  /* ---- styles (scoped under .cbi) -------------------------------------- */
  function ensureStyles() {
    if (document.getElementById('cbi-styles')) return;
    var css = [
    /* Worker cream/dark-ink skin (2026-07-11): was a self-contained DARK palette.
       --accent = orange FILL; --accent-text = orange used as TEXT (AA on cream).
       Semantic status hues retuned darker for a light bg. Font unified to DM Sans. */
      '.cbi{--bg-primary:#F8F6F1;--bg-card:#FFFFFF;--bg-card-hover:#F4EADB;--bg-input:#F8F6F1;--border:#E7DECB;--text-primary:#241F1B;--text-secondary:#5A5148;--text-muted:#5A5148;--accent:#E87722;--accent-hover:#C25E12;--accent-text:#A8500C;--accent-light:rgba(232,119,34,.12);--success:#1E8E5A;--success-light:rgba(30,142,90,.12);--warning:#C77A0A;--warning-light:rgba(199,122,10,.12);--danger:#C53A2B;--danger-light:rgba(197,58,43,.12);--radius:12px;--radius-sm:8px;color:var(--text-primary);font-family:"DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;line-height:1.5}',
      '.cbi *{box-sizing:border-box}',
      '.cbi .cbi-header{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:9px 14px;display:flex;align-items:center;gap:12px;margin-bottom:10px}',
      '.cbi .cbi-header h1{font-size:15px;font-weight:600;margin:0}',
      '.cbi .cbi-badge{margin-left:auto;background:var(--accent-light);color:var(--accent-text);font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:.5px}',
      '.cbi .progress-container{padding:2px 0 10px}',
      '.cbi .progress-steps{display:flex;align-items:center;justify-content:center;margin-bottom:6px}',
      '.cbi .progress-step{display:flex;align-items:center}',
      '.cbi .step-dot{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid var(--border);color:var(--text-muted);background:var(--bg-primary);transition:all .3s ease;flex-shrink:0}',
      '.cbi .step-dot.active{border-color:var(--accent-text);color:var(--accent-text);background:var(--accent-light)}',
      '.cbi .step-dot.completed{border-color:var(--success);color:#fff;background:var(--success)}',
      '.cbi .step-line{width:40px;height:2px;background:var(--border);transition:background .3s ease}',
      '.cbi .step-line.completed{background:var(--success)}',
      '.cbi .progress-label{text-align:center;font-size:12px;color:var(--text-muted)}',
      '.cbi .progress-label span{color:var(--accent-text);font-weight:600}',
      '.cbi .cbi-body{max-width:600px;margin:0 auto}',
      '.cbi .step-section{display:none}',
      '.cbi .step-section.active{display:block;animation:cbiFade .3s ease}',
      '@keyframes cbiFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
      '.cbi .card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:18px;margin-bottom:12px}',
      '.cbi .card-title{font-size:16px;font-weight:600;margin-bottom:4px}',
      '.cbi .card-subtitle{font-size:13px;color:var(--text-secondary);margin-bottom:18px}',
      '.cbi .step-intro{text-align:center;margin-bottom:14px}',
      '.cbi .step-intro-icon{font-size:26px;margin-bottom:2px}',
      '.cbi .step-intro h2{font-size:18px;font-weight:600;margin:0 0 2px}',
      '.cbi .step-intro p{font-size:14px;color:var(--text-secondary);margin:0}',
      '.cbi .form-group{margin-bottom:14px}',
      '.cbi .form-group:last-child{margin-bottom:0}',
      '.cbi .form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '.cbi .form-label{display:block;font-size:13px;font-weight:500;color:var(--text-secondary);margin-bottom:6px}',
      '.cbi .form-label .req{color:var(--danger);margin-left:2px}',
      '.cbi .form-label .opt{color:var(--text-muted);font-weight:400;font-size:11px;margin-left:4px}',
      '.cbi .form-input{width:100%;padding:12px 14px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:15px;font-family:inherit;transition:border-color .2s ease;-webkit-appearance:none}',
      '.cbi .form-input:focus{outline:none;border-color:var(--accent-text)}',
      '.cbi .form-input::placeholder{color:var(--text-muted)}',
      '.cbi .form-input.error{border-color:var(--danger)}',
      '.cbi select.form-input{cursor:pointer}',
      '.cbi textarea.form-input{resize:vertical;min-height:80px}',
      '.cbi .form-error{font-size:12px;color:var(--danger);margin-top:4px;display:none}',
      '.cbi .form-error.visible{display:block}',
      '.cbi .form-hint{font-size:12px;color:var(--text-muted);margin-top:4px}',
      '.cbi .chip-grid{display:flex;flex-wrap:wrap;gap:8px}',
      '.cbi .chip{min-height:var(--v3-tap-min,44px);display:inline-flex;align-items:center;padding:8px 14px;background:var(--bg-input);border:1px solid var(--border);border-radius:20px;color:var(--text-secondary);font-size:13px;cursor:pointer;transition:all .2s ease;user-select:none}',
      '.cbi .chip:hover{border-color:var(--accent-text);color:var(--text-primary)}',
      '.cbi .chip.selected{background:var(--accent-light);border-color:var(--accent-text);color:var(--accent-text);font-weight:500}',
      '.cbi .chip-grid.error{outline:1px solid var(--danger);outline-offset:4px;border-radius:var(--radius-sm)}',
      '.cbi .option-group{display:flex;flex-direction:column;gap:10px}',
      '.cbi .option-card{display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;transition:all .2s ease}',
      '.cbi .option-card:hover{border-color:var(--accent-text)}',
      '.cbi .option-card.selected{border-color:var(--accent-text);background:var(--accent-light)}',
      '.cbi .option-radio{width:18px;height:18px;border-radius:50%;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s ease}',
      '.cbi .option-card.selected .option-radio{border-color:var(--accent-text)}',
      '.cbi .option-radio-inner{width:8px;height:8px;border-radius:50%;background:var(--accent);transform:scale(0);transition:transform .2s ease}',
      '.cbi .option-card.selected .option-radio-inner{transform:scale(1)}',
      '.cbi .option-label{font-size:14px;font-weight:500}',
      '.cbi .option-desc{font-size:12px;color:var(--text-muted);margin-top:2px}',
      '.cbi .option-group.error{outline:1px solid var(--danger);outline-offset:4px;border-radius:var(--radius-sm)}',
      '.cbi .toggle-row{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm)}',
      '.cbi .toggle-text{font-size:14px;font-weight:500}',
      '.cbi .toggle-text-desc{font-size:12px;color:var(--text-muted);margin-top:2px}',
      '.cbi .toggle-switch{width:44px;height:24px;background:var(--border);border-radius:12px;position:relative;cursor:pointer;transition:background .2s ease;flex-shrink:0}',
      '.cbi .toggle-switch.on{background:var(--accent)}',
      '.cbi .toggle-knob{width:18px;height:18px;background:#fff;border-radius:50%;position:absolute;top:3px;left:3px;transition:transform .2s ease}',
      '.cbi .toggle-switch.on .toggle-knob{transform:translateX(20px)}',
      '.cbi .btn-row{display:flex;gap:12px;margin-top:16px}',
      '.cbi .btn{flex:1;padding:14px 20px;border-radius:var(--radius-sm);font-size:15px;font-weight:600;cursor:pointer;border:none;transition:all .2s ease;font-family:inherit}',
      '.cbi .btn-primary{background:var(--accent);color:#fff}',
      '.cbi .btn-primary:hover{background:var(--accent-hover)}',
      '.cbi .btn-primary:disabled{opacity:.4;cursor:not-allowed}',
      '.cbi .btn-secondary{background:var(--bg-input);border:1px solid var(--border);color:var(--text-secondary)}',
      '.cbi .btn-secondary:hover{border-color:var(--text-muted);color:var(--text-primary)}',
      '.cbi .btn-skip{background:none;border:none;color:var(--text-muted);font-size:13px;cursor:pointer;padding:8px;text-align:center;margin-top:8px;width:100%}',
      '.cbi .btn-skip:hover{color:var(--text-secondary)}',
      '.cbi .review-group{margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)}',
      '.cbi .review-group:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}',
      '.cbi .review-group-title{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}',
      '.cbi .review-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}',
      '.cbi .review-label{font-size:13px;color:var(--text-secondary)}',
      '.cbi .review-value{font-size:14px;font-weight:500;text-align:right;max-width:60%}',
      '.cbi .review-value.empty{color:var(--text-muted);font-style:italic;font-weight:400}',
      '.cbi .review-edit-btn{background:none;border:none;color:var(--accent-text);font-size:12px;cursor:pointer;padding:2px 6px;font-family:inherit}',
      '.cbi .info-callout{background:var(--accent-light);border:1px solid rgba(232,119,34,.30);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:16px;font-size:12px;color:var(--text-secondary);line-height:1.6}',
      '.cbi .info-callout strong{color:var(--accent-text)}',
      '.cbi .legal-notice{background:var(--warning-light);border:1px solid rgba(199,122,10,.35);border-radius:var(--radius-sm);padding:14px 16px;margin-bottom:16px}',
      '.cbi .legal-notice-title{font-size:13px;font-weight:600;color:var(--warning);margin-bottom:4px}',
      '.cbi .legal-notice p{font-size:12px;color:var(--text-secondary);line-height:1.6;margin:0}',
      '.cbi .sig-pad-wrap{position:relative;margin-top:6px}',
      '.cbi .sig-pad{width:100%;height:160px;background:#fff;border:1px solid var(--border);border-radius:var(--radius-sm);touch-action:none;cursor:crosshair;display:block}',
      '.cbi .sig-clear{position:absolute;top:8px;right:8px;background:rgba(0,0,0,.55);color:#fff;border:none;border-radius:6px;font-size:11px;padding:4px 8px;cursor:pointer}',
      '.cbi .sig-flag{font-size:11px;color:var(--warning);margin-top:6px;display:none}',
      '.cbi .sig-flag.visible{display:block}',
      '.cbi .success-screen{text-align:center;padding:32px 16px}',
      '.cbi .success-icon{width:72px;height:72px;background:var(--success-light);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:34px;color:var(--success)}',
      '.cbi .success-screen h2{font-size:22px;font-weight:600;margin:0 0 8px}',
      '.cbi .success-screen p{font-size:14px;color:var(--text-secondary);margin:0 0 22px}',
      '.cbi .feature-unlock-list{text-align:left;margin-bottom:22px}',
      '.cbi .feature-unlock-item{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);font-size:14px}',
      '.cbi .feature-unlock-item:last-child{border-bottom:none}',
      '.cbi .feature-unlock-item.locked{opacity:.45}',
      '.cbi .feature-unlock-check{font-size:16px;flex-shrink:0;color:var(--success)}',
      '.cbi .feature-unlock-item.locked .feature-unlock-check{color:var(--text-muted)}',
      '.cbi .disclaimer{text-align:center;font-size:11px;color:var(--text-muted);padding:16px 8px 8px;line-height:1.6}',
      '.cbi .cbi-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:520px;width:calc(100% - 32px);background:var(--danger);color:#fff;padding:12px 16px;border-radius:var(--radius-sm);font-size:13px;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,.4)}',
      '.cbi .cbi-toast.ok{background:var(--success)}',
      '@media (max-width:480px){.cbi .form-row{grid-template-columns:1fr}.cbi .step-line{width:24px}.cbi .card{padding:16px}}'
    ].join('\n');
    var s = document.createElement('style');
    s.id = 'cbi-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---- small DOM helper ------------------------------------------------- */
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  /* ---- autosave storage adapter (platform seam) ------------------------- */
  function makeStore(isNative) {
    var prefs = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) || null;
    var usePrefs = isNative && prefs;
    return {
      get: function (key) {
        try {
          if (usePrefs) return prefs.get({ key: key }).then(function (r) { return r && r.value ? JSON.parse(r.value) : null; }).catch(function () { return null; });
          var raw = window.localStorage.getItem(key);
          return Promise.resolve(raw ? JSON.parse(raw) : null);
        } catch (e) { return Promise.resolve(null); }
      },
      set: function (key, val) {
        try {
          var str = JSON.stringify(val);
          if (usePrefs) return prefs.set({ key: key, value: str }).catch(function () {});
          window.localStorage.setItem(key, str);
          return Promise.resolve();
        } catch (e) { return Promise.resolve(); }
      },
      remove: function (key) {
        try {
          if (usePrefs) return prefs.remove({ key: key }).catch(function () {});
          window.localStorage.removeItem(key);
          return Promise.resolve();
        } catch (e) { return Promise.resolve(); }
      }
    };
  }

  /* ---- pdf-lib loader (web may not have it) ----------------------------- */
  function ensurePdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
      s.onload = function () { resolve(window.PDFLib); };
      s.onerror = function () { reject(new Error('pdf-lib failed to load')); };
      document.head.appendChild(s);
    });
  }

  /* ---- helpers ---------------------------------------------------------- */
  function fmtDate(d) { if (!d) return ''; var p = d.split('-'); return p.length === 3 ? p[1] + '/' + p[2] + '/' + p[0] : d; }
  function todayISO() { return new Date().toISOString().split('T')[0]; }
  function capWords(s) { return s.split(' ').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' '); }

  /* ---- typed date fields (DOB + DOA) -----------------------------------
   * We do NOT use <input type="date">. Its .value silently reads '' whenever the
   * native control judges the entry incomplete or out-of-order (locale that
   * expects DD/MM, partial entry, and several iOS/Android in-app webviews) — that
   * is what made the DOB "disappear" mid-intake and blocked Continue. Instead we
   * accept a typed MM/DD/YYYY string identically on EVERY platform and normalize
   * to the ISO 'YYYY-MM-DD' the profiles table stores. State always holds ISO.
   * ------------------------------------------------------------------------- */
  function isoToDisplay(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    return p.length === 3 ? p[1] + '/' + p[2] + '/' + p[0] : '';
  }
  function maskDateInput(v) {
    v = String(v == null ? '' : v).replace(/[^\d/]/g, '');   // digits + slashes only
    if (v.indexOf('/') !== -1) {
      // Respect the user's own slashes so single-digit month/day (5/1/1990) work.
      var parts = v.split('/').slice(0, 3);
      parts[0] = parts[0].slice(0, 2);
      if (parts[1] != null) parts[1] = parts[1].slice(0, 2);
      if (parts[2] != null) parts[2] = parts[2].slice(0, 4);
      return parts.join('/');
    }
    // No slashes typed — auto-insert as the digit stream grows (MMDDYYYY).
    var d = v.replace(/\D/g, '').slice(0, 8), out = d.slice(0, 2);
    if (d.length > 2) out += '/' + d.slice(2, 4);
    if (d.length > 4) out += '/' + d.slice(4, 8);
    return out;
  }
  function displayToIso(v) {
    // Return 'YYYY-MM-DD' ONLY for a complete, real calendar date; else ''.
    var m = String(v == null ? '' : v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return '';
    var mm = +m[1], dd = +m[2], yyyy = +m[3];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 1900 || yyyy > 2100) return '';
    var dt = new Date(yyyy, mm - 1, dd);
    if (dt.getFullYear() !== yyyy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return '';  // e.g. 02/31
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return yyyy + '-' + pad(mm) + '-' + pad(dd);
  }

  /* ======================================================================
   *  render(ctx)
   * ==================================================================== */
  function render(ctx) {
    ctx = ctx || {};
    ensureStyles();

    var supabase = ctx.supabase;
    var user = ctx.user || (ctx.profile && { id: ctx.profile.id }) || null;
    var profile = ctx.profile || {};
    var isNative = !!ctx.isNative || !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    var store = makeStore(isNative);
    var STORE_KEY = STORAGE_PREFIX + (user && user.id ? user.id : 'anon');

    // ---- working state -------------------------------------------------
    // Prefill from the existing profile row where present (e.g. full_name set
    // at signup), so a resumed/partial profile shows what we already know.
    var existingName = (profile.full_name || '').trim().split(/\s+/);
    var state = {
      step: 1,
      first_name: existingName[0] || '',
      last_name: existingName.slice(1).join(' ') || '',
      dob: '',
      phone: profile.phone || '',
      language_pref: profile.language_pref || 'en',
      doa: '',
      wcb_case_number: '',
      employer_name: '',
      body_parts: [],
      work_status: '',
      treating_doctor: '',
      treating_doctor_address: '',
      home_address: '',
      needs_transportation: false,
      has_attorney: false,
      attorney_name: '',
      attorney_firm: '',
      attorney_phone: '',
      attorney_email: '',
      medical_restrictions: '',
      oc110a_agreed: false,
      oc110a_name: ''
    };
    var sig = { drawn: false, canvas: null };
    var submitting = false;

    var root = el('div', { class: 'cbi' });

    /* ---------- toast (fail-loud) ------------------------------------- */
    function toast(msg, type) {
      if (typeof ctx.toast === 'function') { try { ctx.toast(msg, type); return; } catch (e) {} }
      var t = el('div', { class: 'cbi-toast' + (type === 'ok' ? ' ok' : ''), text: msg });
      document.body.appendChild(t);
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 5000);
    }

    /* ---------- query within root ------------------------------------- */
    function $(id) { return root.querySelector('#' + id); }

    /* ---------- build markup ------------------------------------------ */
    root.appendChild(el('div', { class: 'cbi-header' }, [
      el('h1', { text: 'Comp Buddy Setup' }),
      el('span', { class: 'cbi-badge', text: 'Comp Buddy' })
    ]));

    // progress bar
    var pSteps = el('div', { class: 'progress-steps' });
    for (var i = 1; i <= 4; i++) {
      pSteps.appendChild(el('div', { class: 'progress-step' }, [
        el('div', { class: 'step-dot' + (i === 1 ? ' active' : ''), id: 'cbi-dot-' + i, text: String(i) })
      ]));
      if (i < 4) pSteps.appendChild(el('div', { class: 'step-line', id: 'cbi-line-' + i }));
    }
    root.appendChild(el('div', { class: 'progress-container' }, [
      pSteps,
      el('div', { class: 'progress-label', id: 'cbi-plabel' }, [
        document.createTextNode('Step '), el('span', { id: 'cbi-step-current', text: '1' }),
        document.createTextNode(' of 4 — '), el('span', { id: 'cbi-step-name', text: STEP_NAMES[1] })
      ])
    ]));

    var bodyWrap = el('div', { class: 'cbi-body' });
    root.appendChild(bodyWrap);

    /* ---- STEP 1 ---- */
    var step1 = el('div', { class: 'step-section active', id: 'cbi-step-1' });
    step1.appendChild(el('div', { class: 'step-intro' }, [
      el('div', { class: 'step-intro-icon', text: '👤' }),
      el('h2', { text: 'About You' }),
      el('p', { text: 'Just the basics — we’ll personalize your dashboard from here.' })
    ]));
    var c1 = el('div', { class: 'card' }, [el('div', { class: 'card-title', text: 'Contact Info' })]);
    c1.appendChild(el('div', { class: 'form-group' }, [
      el('div', { class: 'form-row' }, [
        el('div', null, [el('label', { class: 'form-label', html: 'First Name<span class="req">*</span>' }), el('input', { type: 'text', class: 'form-input', id: 'cbi-first', autocomplete: 'given-name', value: state.first_name })]),
        el('div', null, [el('label', { class: 'form-label', html: 'Last Name<span class="req">*</span>' }), el('input', { type: 'text', class: 'form-input', id: 'cbi-last', autocomplete: 'family-name', value: state.last_name })])
      ]),
      el('div', { class: 'form-error', id: 'cbi-err-name', text: 'First and last name are required' })
    ]));
    c1.appendChild(el('div', { class: 'form-group' }, [
      el('div', { class: 'form-row' }, [
        el('div', null, [el('label', { class: 'form-label', html: 'Date of Birth<span class="req">*</span>' }), el('input', { type: 'text', class: 'form-input', id: 'cbi-dob', inputmode: 'numeric', autocomplete: 'bday', placeholder: 'MM/DD/YYYY', maxlength: '10' }), el('div', { class: 'form-error', id: 'cbi-err-dob', text: 'Enter your date of birth as MM/DD/YYYY' })]),
        el('div', null, [el('label', { class: 'form-label', html: 'Phone<span class="req">*</span>' }), el('input', { type: 'tel', class: 'form-input', id: 'cbi-phone', placeholder: '(212) 555-1234', inputmode: 'tel', autocomplete: 'tel', value: state.phone }), el('div', { class: 'form-error', id: 'cbi-err-phone', text: 'Phone number is required' })])
      ])
    ]));
    var langSel = el('select', { class: 'form-input', id: 'cbi-lang' });
    LANGS.forEach(function (l) { var o = el('option', { value: l[0], text: l[1] }); if (l[0] === state.language_pref) o.selected = true; langSel.appendChild(o); });
    c1.appendChild(el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label', html: 'Preferred Language<span class="opt">(for the app)</span>' }), langSel
    ]));
    step1.appendChild(c1);
    step1.appendChild(el('div', { class: 'btn-row' }, [el('button', { class: 'btn btn-primary', onclick: function () { validateAndNext(1); } }, ['Continue'])]));
    bodyWrap.appendChild(step1);

    /* ---- STEP 2 ---- */
    var step2 = el('div', { class: 'step-section', id: 'cbi-step-2' });
    step2.appendChild(el('div', { class: 'step-intro' }, [
      el('div', { class: 'step-intro-icon', text: '📋' }),
      el('h2', { text: 'Your Case' }),
      el('p', { text: 'Core details about your workers’ comp claim.' })
    ]));
    var c2 = el('div', { class: 'card' }, [
      el('div', { class: 'card-title', text: 'Case Basics' }),
      el('div', { class: 'card-subtitle', text: 'Required to build your claim dashboard.' })
    ]);
    c2.appendChild(el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label', html: 'Date of Accident<span class="req">*</span>' }),
      el('input', { type: 'text', class: 'form-input', id: 'cbi-doa', inputmode: 'numeric', autocomplete: 'off', placeholder: 'MM/DD/YYYY', maxlength: '10' }),
      el('div', { class: 'form-error', id: 'cbi-err-doa', text: 'A valid date of accident (today or earlier) is required' })
    ]));
    c2.appendChild(el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label', html: 'WCB Case Number<span class="opt">(if you have one)</span>' }),
      el('input', { type: 'text', class: 'form-input', id: 'cbi-wcb', placeholder: 'e.g. G1234567', maxlength: '20' }),
      el('div', { class: 'form-error', id: 'cbi-err-wcb', text: 'Use the format on your WCB letter, e.g. G1234567' }),
      el('div', { class: 'form-hint', text: 'Found on any WCB correspondence. Leave blank if you haven’t filed yet.' })
    ]));
    c2.appendChild(el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label', html: 'Employer at Time of Accident<span class="req">*</span>' }),
      el('input', { type: 'text', class: 'form-input', id: 'cbi-employer', placeholder: 'Company name' }),
      el('div', { class: 'form-error', id: 'cbi-err-employer', text: 'Employer name is required' })
    ]));
    var chipGrid = el('div', { class: 'chip-grid', id: 'cbi-body-grid' });
    BODY_PARTS.forEach(function (bp) {
      var chip = el('div', { class: 'chip', 'data-part': bp[0], text: bp[1] });
      chip.addEventListener('click', function () {
        chip.classList.toggle('selected');
        var p = bp[0];
        if (chip.classList.contains('selected')) { if (state.body_parts.indexOf(p) < 0) state.body_parts.push(p); }
        else { state.body_parts = state.body_parts.filter(function (x) { return x !== p; }); }
        chipGrid.classList.remove('error'); clearError('body'); persist();
      });
      chipGrid.appendChild(chip);
    });
    c2.appendChild(el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label', html: 'Injured Body Parts<span class="req">*</span>' }),
      chipGrid,
      el('div', { class: 'form-error', id: 'cbi-err-body', text: 'Select at least one injured body part' })
    ]));
    var wsGroup = el('div', { class: 'option-group', id: 'cbi-work-group' });
    WORK_STATUS_CARDS.forEach(function (ws) {
      var card = el('div', { class: 'option-card', 'data-value': ws[0] }, [
        el('div', { class: 'option-radio' }, [el('div', { class: 'option-radio-inner' })]),
        el('div', null, [el('div', { class: 'option-label', text: ws[1] }), el('div', { class: 'option-desc', text: ws[2] })])
      ]);
      card.addEventListener('click', function () {
        wsGroup.querySelectorAll('.option-card').forEach(function (c) { c.classList.remove('selected'); });
        card.classList.add('selected');
        state.work_status = ws[0];
        wsGroup.classList.remove('error'); clearError('work'); persist();
      });
      wsGroup.appendChild(card);
    });
    c2.appendChild(el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label', html: 'Current Work Status<span class="req">*</span>' }),
      wsGroup,
      el('div', { class: 'form-error', id: 'cbi-err-work', text: 'Select your current work status' })
    ]));
    step2.appendChild(c2);
    step2.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-secondary', onclick: function () { goToStep(1); } }, ['Back']),
      el('button', { class: 'btn btn-primary', onclick: function () { validateAndNext(2); } }, ['Continue'])
    ]));
    bodyWrap.appendChild(step2);

    /* ---- STEP 3 ---- */
    var step3 = el('div', { class: 'step-section', id: 'cbi-step-3' });
    step3.appendChild(el('div', { class: 'step-intro' }, [
      el('div', { class: 'step-intro-icon', text: '🩺' }),
      el('h2', { text: 'Medical & Preferences' }),
      el('p', { text: 'Helps personalize your dashboard. All optional — skip what you don’t have.' })
    ]));
    var c3a = el('div', { class: 'card' }, [el('div', { class: 'card-title', text: 'Treating Physician' })]);
    c3a.appendChild(el('div', { class: 'form-group' }, [el('label', { class: 'form-label', html: 'Doctor’s Name<span class="opt">(optional)</span>' }), el('input', { type: 'text', class: 'form-input', id: 'cbi-doctor', placeholder: 'e.g. Dr. Sarah Chen' })]));
    c3a.appendChild(el('div', { class: 'form-group' }, [el('label', { class: 'form-label', html: 'Doctor’s Address<span class="opt">(optional)</span>' }), el('input', { type: 'text', class: 'form-input', id: 'cbi-doctor-addr', placeholder: 'Street, City, State, ZIP' })]));
    step3.appendChild(c3a);

    var c3b = el('div', { class: 'card' }, [el('div', { class: 'card-title', text: 'You & Your Case' })]);
    c3b.appendChild(el('div', { class: 'form-group' }, [el('label', { class: 'form-label', html: 'Home Address<span class="opt">(for directions to appointments)</span>' }), el('input', { type: 'text', class: 'form-input', id: 'cbi-address', placeholder: 'Street, City, State, ZIP', autocomplete: 'street-address' })]));
    // needs_transportation — reworded per dispatch §3. TRUE = needs help.
    var tTransport = el('div', { class: 'toggle-switch', id: 'cbi-toggle-transport' }, [el('div', { class: 'toggle-knob' })]);
    tTransport.addEventListener('click', function () { tTransport.classList.toggle('on'); state.needs_transportation = tTransport.classList.contains('on'); persist(); });
    c3b.appendChild(el('div', { class: 'form-group' }, [el('div', { class: 'toggle-row' }, [
      el('div', null, [el('div', { class: 'toggle-text', text: 'Do you need help with transportation to your medical appointments?' }), el('div', { class: 'toggle-text-desc', text: 'We can surface transportation assistance options' })]),
      tTransport
    ])]));
    // has_attorney toggle → conditional attorney_* fields
    var tAttorney = el('div', { class: 'toggle-switch', id: 'cbi-toggle-attorney' }, [el('div', { class: 'toggle-knob' })]);
    var attyFields = el('div', { id: 'cbi-atty-fields', style: 'display:none;margin-top:14px' }, [
      el('div', { class: 'form-group' }, [el('label', { class: 'form-label', html: 'Attorney Name<span class="opt">(optional)</span>' }), el('input', { type: 'text', class: 'form-input', id: 'cbi-atty-name', placeholder: 'Attorney name' })]),
      el('div', { class: 'form-group' }, [el('label', { class: 'form-label', html: 'Firm<span class="opt">(optional)</span>' }), el('input', { type: 'text', class: 'form-input', id: 'cbi-atty-firm', placeholder: 'Firm name' })]),
      el('div', { class: 'form-group' }, [el('div', { class: 'form-row' }, [
        el('div', null, [el('label', { class: 'form-label', html: 'Attorney Phone<span class="opt">(optional)</span>' }), el('input', { type: 'tel', class: 'form-input', id: 'cbi-atty-phone', placeholder: '(212) 555-1234', inputmode: 'tel' })]),
        el('div', null, [el('label', { class: 'form-label', html: 'Attorney Email<span class="opt">(optional)</span>' }), el('input', { type: 'email', class: 'form-input', id: 'cbi-atty-email', placeholder: 'name@firm.com', inputmode: 'email' })])
      ])])
    ]);
    tAttorney.addEventListener('click', function () {
      tAttorney.classList.toggle('on');
      state.has_attorney = tAttorney.classList.contains('on');
      attyFields.style.display = state.has_attorney ? 'block' : 'none';
      persist();
    });
    c3b.appendChild(el('div', { class: 'form-group' }, [el('div', { class: 'toggle-row' }, [
      el('div', null, [el('div', { class: 'toggle-text', text: 'Do you have an attorney?' }), el('div', { class: 'toggle-text-desc', text: 'If yes, we’ll skip the “find an attorney” prompts' })]),
      tAttorney
    ])]));
    c3b.appendChild(attyFields);
    c3b.appendChild(el('div', { class: 'form-group' }, [el('label', { class: 'form-label', html: 'Medical Restrictions<span class="opt">(from latest C-4)</span>' }), el('textarea', { class: 'form-input', id: 'cbi-restrictions', placeholder: 'e.g. No lifting over 20 lbs, limited standing to 2 hours' })]));
    step3.appendChild(c3b);
    step3.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-secondary', onclick: function () { goToStep(2); } }, ['Back']),
      el('button', { class: 'btn btn-primary', onclick: function () { saveStep(3); goToStep(4); } }, ['Continue'])
    ]));
    step3.appendChild(el('button', { class: 'btn-skip', onclick: function () { skipToStep(4); } }, ['Skip for now']));
    bodyWrap.appendChild(step3);

    /* ---- STEP 4 ---- */
    var step4 = el('div', { class: 'step-section', id: 'cbi-step-4' });
    step4.appendChild(el('div', { class: 'step-intro' }, [
      el('div', { class: 'step-intro-icon', text: '✅' }),
      el('h2', { text: 'Review & Authorize' }),
      el('p', { text: 'Double-check your info, then authorize medical records access.' })
    ]));
    var revCard = el('div', { class: 'card' }, [
      el('div', { class: 'card-title', text: 'Profile Summary' }),
      el('div', { class: 'card-subtitle', text: 'Tap “Edit” to change any section.' })
    ]);
    function revRow(label, id) { return el('div', { class: 'review-row' }, [el('span', { class: 'review-label', text: label }), el('span', { class: 'review-value', id: id, text: '—' })]); }
    revCard.appendChild(el('div', { class: 'review-group' }, [
      el('div', { class: 'review-group-title' }, [document.createTextNode('About You'), el('button', { class: 'review-edit-btn', onclick: function () { goToStep(1); } }, ['Edit'])]),
      revRow('Name', 'cbi-rev-name'), revRow('DOB', 'cbi-rev-dob'), revRow('Phone', 'cbi-rev-phone'), revRow('Language', 'cbi-rev-lang')
    ]));
    revCard.appendChild(el('div', { class: 'review-group' }, [
      el('div', { class: 'review-group-title' }, [document.createTextNode('Your Case'), el('button', { class: 'review-edit-btn', onclick: function () { goToStep(2); } }, ['Edit'])]),
      revRow('Date of Accident', 'cbi-rev-doa'), revRow('WCB Case #', 'cbi-rev-wcb'), revRow('Employer', 'cbi-rev-employer'), revRow('Body Parts', 'cbi-rev-body'), revRow('Work Status', 'cbi-rev-work')
    ]));
    revCard.appendChild(el('div', { class: 'review-group' }, [
      el('div', { class: 'review-group-title' }, [document.createTextNode('Medical & Prefs'), el('button', { class: 'review-edit-btn', onclick: function () { goToStep(3); } }, ['Edit'])]),
      revRow('Treating Doctor', 'cbi-rev-doctor'), revRow('Home Address', 'cbi-rev-address'),
      revRow('Needs Transport Help', 'cbi-rev-transport'), revRow('Attorney', 'cbi-rev-attorney'), revRow('Restrictions', 'cbi-rev-restrictions')
    ]));
    step4.appendChild(revCard);
    step4.appendChild(el('div', { class: 'info-callout', html: '<strong>Heads up — filing a C-3?</strong> If you haven’t filed your C-3 Employee Claim yet, you can use our C-3 filing wizard from the dashboard after setup. It’ll pre-fill what you’ve entered here and walk you through the remaining details.' }));

    // OC-110a card
    var ocCard = el('div', { class: 'card' }, [el('div', { class: 'card-title', text: 'OC-110a Medical Authorization' })]);
    ocCard.appendChild(el('div', { class: 'legal-notice' }, [
      el('div', { class: 'legal-notice-title', html: '⚠️ Important Legal Notice' }),
      el('p', { text: OC110A_DISCLOSURE })
    ]));
    ocCard.appendChild(el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label', text: 'Type Your Full Legal Name to Sign' }),
      el('input', { type: 'text', class: 'form-input', id: 'cbi-oc-name', placeholder: 'Your full legal name' }),
      el('div', { class: 'form-hint', text: 'This name is stamped onto your OC-110a alongside your signature.' })
    ]));
    var sigCanvas = el('canvas', { class: 'sig-pad', id: 'cbi-sig' });
    var sigWrap = el('div', { class: 'sig-pad-wrap' }, [sigCanvas, el('button', { class: 'sig-clear', type: 'button', onclick: function () { clearSig(); } }, ['Clear'])]);
    ocCard.appendChild(el('div', { class: 'form-group' }, [el('label', { class: 'form-label', text: 'Draw Your Signature' }), sigWrap]));
    var tOc = el('div', { class: 'toggle-switch', id: 'cbi-toggle-oc' }, [el('div', { class: 'toggle-knob' })]);
    tOc.addEventListener('click', function () { tOc.classList.toggle('on'); state.oc110a_agreed = tOc.classList.contains('on'); });
    ocCard.appendChild(el('div', { class: 'form-group' }, [el('div', { class: 'toggle-row' }, [
      el('div', null, [el('div', { class: 'toggle-text', text: 'I agree to the OC-110a authorization' }), el('div', { class: 'toggle-text-desc', text: 'Required for eCase monitoring & UTDM alerts' })]),
      tOc
    ])]));
    ocCard.appendChild(el('div', { class: 'sig-flag', id: 'cbi-sig-flag', text: 'Official WCB OC-110a template pending upload — your authorization is recorded against the disclosure shown above.' }));
    ocCard.appendChild(el('button', { class: 'btn-skip', onclick: function () { skipOc(); } }, ['I’ll do this later']));
    step4.appendChild(ocCard);

    step4.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-secondary', onclick: function () { goToStep(3); } }, ['Back']),
      el('button', { class: 'btn btn-primary', id: 'cbi-submit', onclick: function () { submit(); } }, ['Complete Setup'])
    ]));
    bodyWrap.appendChild(step4);

    /* ---- SUCCESS ---- */
    var stepSuccess = el('div', { class: 'step-section', id: 'cbi-step-success' });
    bodyWrap.appendChild(stepSuccess);

    root.appendChild(el('div', { class: 'disclaimer', html: 'This tool is for informational purposes only and does not constitute legal advice.<br>The Comp Desk &copy; 2026' }));

    /* ---------- field <-> state plumbing ------------------------------ */
    var TEXT_FIELDS = [
      ['cbi-first', 'first_name'], ['cbi-last', 'last_name'], ['cbi-dob', 'dob'], ['cbi-phone', 'phone'],
      ['cbi-doa', 'doa'], ['cbi-wcb', 'wcb_case_number'], ['cbi-employer', 'employer_name'],
      ['cbi-doctor', 'treating_doctor'], ['cbi-doctor-addr', 'treating_doctor_address'], ['cbi-address', 'home_address'],
      ['cbi-atty-name', 'attorney_name'], ['cbi-atty-firm', 'attorney_firm'], ['cbi-atty-phone', 'attorney_phone'],
      ['cbi-atty-email', 'attorney_email'], ['cbi-restrictions', 'medical_restrictions'], ['cbi-oc-name', 'oc110a_name']
    ];
    function saveStep(step) {
      TEXT_FIELDS.forEach(function (f) { var n = $(f[0]); if (n) { var v = n.value; state[f[1]] = (f[1] === 'dob' || f[1] === 'doa') ? displayToIso(v) : v.trim(); } });
      var lang = $('cbi-lang'); if (lang) state.language_pref = lang.value;
      // body_parts, work_status, toggles tracked live via their handlers.
    }
    // autosave on blur for every input/select/textarea
    root.querySelectorAll('input,select,textarea').forEach(function (n) {
      n.addEventListener('blur', function () { saveStep(state.step); persist(); });
      n.addEventListener('change', function () { saveStep(state.step); persist(); });
    });
    // Live MM/DD/YYYY masking for the typed date fields (DOB + DOA). Reformats the
    // visible text on every keystroke and mirrors a normalized ISO value into
    // state, so a valid date is captured on every input path — and, being plain
    // text, the field can never be silently blanked by a native date picker.
    ['cbi-dob', 'cbi-doa'].forEach(function (id) {
      var n = $(id); if (!n) return;
      var key = (id === 'cbi-dob') ? 'dob' : 'doa';
      n.addEventListener('input', function () {
        var masked = maskDateInput(n.value);
        if (masked !== n.value) n.value = masked;
        state[key] = displayToIso(masked);      // '' until a complete valid date
        clearError(key === 'dob' ? 'dob' : 'doa');
        persist();
      });
    });

    /* ---------- validation ------------------------------------------- */
    function showError(id) { var e = $('cbi-err-' + id); if (e) e.classList.add('visible'); }
    function clearError(id) { var e = $('cbi-err-' + id); if (e) e.classList.remove('visible'); }
    function validateAndNext(step) {
      saveStep(step);
      var ok = true;
      if (step === 1) {
        if (!state.first_name || !state.last_name) { showError('name'); ok = false; } else clearError('name');
        if (!state.dob || state.dob > todayISO()) { showError('dob'); ok = false; } else clearError('dob');
        if (!state.phone) { showError('phone'); ok = false; } else clearError('phone');
      } else if (step === 2) {
        if (!state.doa || state.doa > todayISO()) { showError('doa'); ok = false; } else clearError('doa');
        // wcb optional but if present must loosely match W/G + digits
        if (state.wcb_case_number && !/^[A-Za-z]?\d{7,10}$/.test(state.wcb_case_number.replace(/\s/g, ''))) { showError('wcb'); ok = false; } else clearError('wcb');
        if (!state.employer_name) { showError('employer'); ok = false; } else clearError('employer');
        if (state.body_parts.length === 0) { showError('body'); $('cbi-body-grid').classList.add('error'); ok = false; } else clearError('body');
        if (WORK_STATUS.indexOf(state.work_status) < 0) { showError('work'); $('cbi-work-group').classList.add('error'); ok = false; } else clearError('work');
      }
      if (ok) goToStep(step + 1);
    }

    /* ---------- navigation ------------------------------------------- */
    function goToStep(n) {
      saveStep(state.step);
      persist();
      state.step = n;
      root.querySelectorAll('.step-section').forEach(function (s) { s.classList.remove('active'); });
      var sec = $('cbi-step-' + n); if (sec) sec.classList.add('active');
      for (var i = 1; i <= 4; i++) {
        var dot = $('cbi-dot-' + i); if (dot) { dot.className = 'step-dot'; if (i < n) dot.classList.add('completed'); else if (i === n) dot.classList.add('active'); }
        if (i < 4) { var line = $('cbi-line-' + i); if (line) { line.className = 'step-line'; if (i < n) line.classList.add('completed'); } }
      }
      var sc = $('cbi-step-current'); if (sc) sc.textContent = String(n);
      var sn = $('cbi-step-name'); if (sn) sn.textContent = STEP_NAMES[n] || '';
      if (n === 4) populateReview();
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
    }
    function skipToStep(n) { saveStep(state.step); goToStep(n); }

    /* ---------- review ------------------------------------------------ */
    function setRev(id, val) {
      var e = $(id); if (!e) return;
      if (val) { e.textContent = val; e.classList.remove('empty'); }
      else { e.textContent = 'Not provided'; e.classList.add('empty'); }
    }
    function populateReview() {
      setRev('cbi-rev-name', [state.first_name, state.last_name].filter(Boolean).join(' '));
      setRev('cbi-rev-dob', fmtDate(state.dob));
      setRev('cbi-rev-phone', state.phone);
      setRev('cbi-rev-lang', LANG_LABELS[state.language_pref] || state.language_pref);
      setRev('cbi-rev-doa', fmtDate(state.doa));
      setRev('cbi-rev-wcb', state.wcb_case_number);
      setRev('cbi-rev-employer', state.employer_name);
      setRev('cbi-rev-body', state.body_parts.length ? state.body_parts.map(capWords).join(', ') : '');
      setRev('cbi-rev-work', WORK_STATUS_LABELS[state.work_status] || '');
      setRev('cbi-rev-doctor', state.treating_doctor);
      setRev('cbi-rev-address', state.home_address);
      setRev('cbi-rev-transport', state.needs_transportation ? 'Yes' : 'No');
      setRev('cbi-rev-attorney', state.has_attorney ? (state.attorney_name || 'Yes') : 'No');
      setRev('cbi-rev-restrictions', state.medical_restrictions);
    }

    /* ---------- signature canvas (D-3) ------------------------------- */
    function initSig() {
      var canvas = sigCanvas;
      sig.canvas = canvas;
      // size backing store to displayed size * dpr for crisp lines
      function resize() {
        var rect = canvas.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;
        if (!rect.width) return;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        var c = canvas.getContext('2d');
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.lineWidth = 2; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#0f1117';
      }
      resize();
      var drawing = false, last = null;
      function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
      canvas.addEventListener('pointerdown', function (e) { drawing = true; last = pos(e); sig.drawn = true; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); });
      canvas.addEventListener('pointermove', function (e) {
        if (!drawing) return;
        var p = pos(e), c = canvas.getContext('2d');
        c.beginPath(); c.moveTo(last.x, last.y); c.lineTo(p.x, p.y); c.stroke(); last = p; e.preventDefault();
      });
      function end() { drawing = false; last = null; }
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointerleave', end);
      canvas.addEventListener('pointercancel', end);
    }
    function clearSig() {
      if (!sig.canvas) return;
      var c = sig.canvas.getContext('2d');
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, sig.canvas.width, sig.canvas.height); c.restore();
      sig.drawn = false;
    }
    function skipOc() {
      state.oc110a_agreed = false; sig.drawn = false; clearSig();
      var n = $('cbi-oc-name'); if (n) n.value = '';
      state.oc110a_name = '';
      tOc.classList.remove('on');
      toast('OK — you can sign your OC-110a later from the dashboard.', 'ok');
    }

    /* ---------- OC-110a PDF generation + upload (D-3) ----------------- */
    // Returns { signed:bool, date:string|null, url:string|null }. Generates the
    // authorization PDF from the official template if present in Storage, else
    // from the on-screen disclosure text (NOT lorem-ipsum) and flags it.
    function genAndUploadOc110a() {
      return ensurePdfLib().then(function (PDFLib) {
        var PDFDocument = PDFLib.PDFDocument, StandardFonts = PDFLib.StandardFonts, rgb = PDFLib.rgb;
        // try official template
        return supabase.storage.from('oc110a-template').download('template.pdf')
          .then(function (res) { return (res && res.data && !res.error) ? res.data.arrayBuffer() : null; })
          .catch(function () { return null; })
          .then(function (tplBytes) {
            var usingPlaceholder = !tplBytes;
            var docP = tplBytes ? PDFDocument.load(tplBytes) : PDFDocument.create();
            return docP.then(function (pdf) {
              return pdf.embedFont(StandardFonts.Helvetica).then(function (font) {
                var page = pdf.getPages()[0] || pdf.addPage([612, 792]);
                var size = page.getSize();
                var fullName = state.oc110a_name || [state.first_name, state.last_name].filter(Boolean).join(' ');
                if (usingPlaceholder) {
                  // Build a real authorization record from the displayed disclosure.
                  var fb = pdf.embedFont(StandardFonts.HelveticaBold);
                  page.drawText('OC-110a — Authorization for Medical Records', { x: 50, y: size.height - 60, size: 14, font: fb, color: rgb(0.06, 0.07, 0.09) });
                  var words = OC110A_DISCLOSURE.split(' '), line = '', y = size.height - 95, maxW = size.width - 100;
                  words.forEach(function (w) {
                    var test = line ? line + ' ' + w : w;
                    if (font.widthOfTextAtSize(test, 11) > maxW) { page.drawText(line, { x: 50, y: y, size: 11, font: font, color: rgb(0.2, 0.2, 0.2) }); y -= 16; line = w; }
                    else line = test;
                  });
                  if (line) page.drawText(line, { x: 50, y: y, size: 11, font: font, color: rgb(0.2, 0.2, 0.2) });
                } else {
                  // Official WCB OC-110a is a fillable AcroForm (21 named fields,
                  // all on page 1). Fill the claimant identity + case + date fields
                  // and check the WC case-type box; the signature itself is stamped
                  // onto the signature line below, then the form is flattened so the
                  // authorization can't be altered after signing.
                  try {
                    var form = pdf.getForm();
                    var setT = function (n, v) { try { form.getTextField(n).setText(v || ''); } catch (e) {} };
                    setT('Claimants name', fullName);
                    setT('Case numbers/dates of accident', [state.wcb_case_number, state.doa ? ('DOA ' + fmtDate(state.doa)) : ''].filter(Boolean).join('   '));
                    setT('Date 1', fmtDate(todayISO()));
                    try { form.getCheckBox('Case type WC').check(); } catch (e) {}
                  } catch (e) { console.warn('[CBI] OC110A_FORM_FILL_SKIPPED', e); }
                }
                // signature image
                var sigPng = sig.canvas.toDataURL('image/png');
                return pdf.embedPng(sigPng).then(function (png) {
                  if (usingPlaceholder) {
                    var sw = 200, sh = sw * (png.height / png.width);
                    page.drawText('Signed by: ' + fullName, { x: 50, y: 150, size: 11, font: font, color: rgb(0.06, 0.07, 0.09) });
                    page.drawText('Date: ' + todayISO(), { x: 50, y: 132, size: 11, font: font, color: rgb(0.06, 0.07, 0.09) });
                    page.drawImage(png, { x: 50, y: 70, width: sw, height: Math.min(sh, 55) });
                  } else {
                    // Stamp the drawn signature on the claimant signature line —
                    // the row holding the "Date 1" field (rect ≈ x346,y214); the
                    // signature line runs to its left, so we sit just above it.
                    var sw2 = 230, sh2 = Math.min(sw2 * (png.height / png.width), 26);
                    page.drawImage(png, { x: 45, y: 214, width: sw2, height: sh2 });
                    try { pdf.getForm().flatten(); } catch (e) { console.warn('[CBI] OC110A_FLATTEN_SKIPPED', e); }
                  }
                  return pdf.save();
                });
              });
            }).then(function (outBytes) {
              var path = user.id + '/' + Date.now() + '.pdf';
              var blob = new Blob([outBytes], { type: 'application/pdf' });
              return supabase.storage.from('oc110a-signed').upload(path, blob, { contentType: 'application/pdf', upsert: false })
                .then(function (up) {
                  if (up && up.error) throw up.error;
                  // Private bucket: store the durable object path (bucket/key).
                  // The dashboard mints a short-lived signed URL on demand.
                  var url = 'oc110a-signed/' + path;
                  if (usingPlaceholder) { console.warn('[CBI] OC110A_TEMPLATE_MISSING — generated from on-screen disclosure; upload official WCB OC-110a to oc110a-template/template.pdf'); var fl = $('cbi-sig-flag'); if (fl) fl.classList.add('visible'); }
                  return { signed: true, date: todayISO(), url: url };
                });
            });
          });
      });
    }

    /* ---------- submit (D-2 + D-3 + D-5) ----------------------------- */
    function buildPayload(oc) {
      var p = {
        id: user.id,
        // email is NOT NULL with no default. Supabase .upsert() issues
        // INSERT ... ON CONFLICT, and Postgres validates NOT NULL on the proposed
        // INSERT tuple BEFORE conflict arbitration — so the upsert fails unless
        // email is supplied, even though the row already exists. Always present
        // on an authenticated session; idempotent on the UPDATE path.
        email: (user && user.email) || profile.email || undefined,
        user_type: 'worker',
        full_name: [state.first_name, state.last_name].filter(Boolean).join(' ') || null,
        phone: state.phone || null,
        dob: state.dob || null,
        language_pref: state.language_pref || 'en',   // language_pref ONLY
        doa: state.doa || null,
        wcb_case_number: state.wcb_case_number || null,
        employer_name: state.employer_name || null,
        body_parts: state.body_parts,                 // JS array -> TEXT[]
        work_status: state.work_status,               // validated value
        home_address: state.home_address || null,
        treating_doctor: state.treating_doctor || null,
        treating_doctor_address: state.treating_doctor_address || null,
        needs_transportation: !!state.needs_transportation,
        medical_restrictions: state.medical_restrictions || null,
        has_attorney: !!state.has_attorney,
        attorney_name: (state.has_attorney && state.attorney_name) ? state.attorney_name : null,
        attorney_firm: (state.has_attorney && state.attorney_firm) ? state.attorney_firm : null,
        attorney_phone: (state.has_attorney && state.attorney_phone) ? state.attorney_phone : null,
        attorney_email: (state.has_attorney && state.attorney_email) ? state.attorney_email : null,
        oc110a_signed: !!oc.signed,
        oc110a_signed_date: oc.date,                  // DATE precision
        oc110a_doc_url: oc.url,
        onboarding_completed: true                    // existing col — lights up worker dashboard
      };
      // Tier: set comp_buddy ONLY when not already a higher paid tier (never downgrade).
      var t = (ctx.tier || 'free');
      if (t === 'free' || t === 'comp_buddy' || !t) p.subscription_tier = 'comp_buddy';
      return p;
    }

    function submit() {
      if (submitting) return;
      saveStep(4);
      if (!supabase || !user || !user.id) { console.error('[CBI] SUBMIT_NO_SESSION'); toast('We couldn’t verify your session. Please sign in again.'); return; }
      // re-validate the required gates server-side has no CHECK for
      if (!state.dob || state.dob > todayISO() || !state.doa || state.doa > todayISO() || !state.employer_name || state.body_parts.length === 0 || WORK_STATUS.indexOf(state.work_status) < 0 || !state.first_name || !state.last_name || !state.phone) {
        toast('Some required fields are missing. Please review steps 1 and 2.');
        return;
      }
      submitting = true;
      var btn = $('cbi-submit'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

      // OC-110a only if agreed + name + a drawn signature.
      var wantsOc = state.oc110a_agreed && state.oc110a_name && sig.drawn;
      var ocPromise = wantsOc ? genAndUploadOc110a().catch(function (e) {
        console.error('[CBI] OC110A_UPLOAD_FAILED', e);
        toast('Your info will be saved, but the OC-110a signature couldn’t be uploaded. You can sign later from the dashboard.');
        return { signed: false, date: null, url: null };
      }) : Promise.resolve({ signed: false, date: null, url: null });

      ocPromise.then(function (oc) {
        var payload = buildPayload(oc);
        return supabase.from('profiles').upsert(payload, { onConflict: 'id' }).then(function (res) {
          if (res && res.error) throw res.error;
          return { payload: payload, oc: oc };
        });
      }).then(function (out) {
        // clear autosave on success
        return store.remove(STORE_KEY).then(function () { return out; });
      }).then(function (out) {
        submitting = false;
        // keep host profile in sync if present
        try { if (CD.currentProfile) Object.keys(out.payload).forEach(function (k) { CD.currentProfile[k] = out.payload[k]; }); } catch (e) {}
        showSuccess(out.oc.signed);
      }).catch(function (e) {
        submitting = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Complete Setup'; }
        console.error('[CBI] PROFILE_UPSERT_FAILED', e);
        toast('We couldn’t save your setup. Your answers are still here — please try again.');
        // stay on review step with data intact (do NOT advance)
      });
    }

    /* ---------- success screen (D-5) --------------------------------- */
    function showSuccess(ocSigned) {
      root.querySelectorAll('.step-section').forEach(function (s) { s.classList.remove('active'); });
      for (var i = 1; i <= 4; i++) { var d = $('cbi-dot-' + i); if (d) d.className = 'step-dot completed'; if (i < 4) { var l = $('cbi-line-' + i); if (l) l.className = 'step-line completed'; } }
      var pl = $('cbi-plabel'); if (pl) pl.innerHTML = '<span style="color:var(--success)">Setup Complete</span>';
      var items = [
        { t: 'Find authorized WCB doctors near you', on: true },
        { t: 'IME appointment reminders & directions', on: true },
        { t: 'Track your medical & transportation benefits', on: true },
        { t: 'Benefit calculator with your case pre-loaded', on: true },
        { t: 'C-3 filing wizard (pre-filled from your profile)', on: true },
        { t: 'eCase monitoring & UTDM treatment-gap alerts', on: !!ocSigned }
      ];
      var list = el('div', { class: 'feature-unlock-list' });
      items.forEach(function (it) {
        list.appendChild(el('div', { class: 'feature-unlock-item' + (it.on ? '' : ' locked') }, [
          el('span', { class: 'feature-unlock-check', text: it.on ? '✓' : '○' }),
          el('span', { text: it.t + (it.on ? '' : ' (sign your OC-110a to unlock)') })
        ]));
      });
      stepSuccess.innerHTML = '';
      stepSuccess.appendChild(el('div', { class: 'success-screen' }, [
        el('div', { class: 'success-icon', text: '✓' }),
        el('h2', { text: 'You’re All Set!' }),
        el('p', { text: 'Your Comp Buddy profile is ready. Here’s what you’ve unlocked:' }),
        list,
        el('button', { class: 'btn btn-primary', style: 'width:100%', onclick: function () { goDash(); } }, ['Go to Dashboard'])
      ]));
      stepSuccess.classList.add('active');
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
    }
    function goDash() {
      if (typeof ctx.onComplete === 'function') { try { ctx.onComplete(); return; } catch (e) {} }
      if (typeof ctx.goToDashboard === 'function') { try { ctx.goToDashboard(); return; } catch (e) {} }
      try { window.location.reload(); } catch (e) {}
    }

    /* ---------- autosave persist + restore (D-4) --------------------- */
    function persist() {
      // never persist the signature image
      var snap = {};
      Object.keys(state).forEach(function (k) { if (k !== 'oc110a_agreed') snap[k] = state[k]; });
      store.set(STORE_KEY, snap);
      // CONTINUITY: feed the ONE local worker profile so a no-account user's intake
      // answers prefill the C-3, attorney intake, etc. (SSN is never collected here).
      try {
        if (CD.WorkerProfile && CD.WorkerProfile.merge) {
          CD.WorkerProfile.merge({
            full_name: [state.first_name, state.last_name].filter(Boolean).join(' ') || undefined,
            first_name: state.first_name || undefined, last_name: state.last_name || undefined,
            dob: state.dob || undefined, phone: state.phone || undefined, language_pref: state.language_pref || undefined,
            date_of_injury: state.doa || undefined, employer_name: state.employer_name || undefined,
            body_parts: (state.body_parts && state.body_parts.length) ? state.body_parts.slice() : undefined,
            home_address: state.home_address || undefined, treating_provider: state.treating_doctor || undefined,
            needs_transportation: state.needs_transportation === true ? true : undefined,
            lost_time: (state.work_status === 'not_working' || state.work_status === 'terminated') ? true : (state.work_status === 'working' || state.work_status === 'light_duty' ? false : undefined),
            returned_to_work: (state.work_status === 'working' || state.work_status === 'light_duty') ? true : undefined
          }, { source: 'intake' });
        }
      } catch (e) {}
    }
    function restore() {
      return store.get(STORE_KEY).then(function (saved) {
        if (!saved) return;
        Object.keys(saved).forEach(function (k) { if (k in state) state[k] = saved[k]; });
        // reflect into DOM
        TEXT_FIELDS.forEach(function (f) { if (f[1] === 'oc110a_name') return; var n = $(f[0]); if (n && state[f[1]] != null) n.value = (f[1] === 'dob' || f[1] === 'doa') ? isoToDisplay(state[f[1]]) : state[f[1]]; });
        var lang = $('cbi-lang'); if (lang) lang.value = state.language_pref || 'en';
        (state.body_parts || []).forEach(function (p) { var chip = chipGrid.querySelector('.chip[data-part="' + p + '"]'); if (chip) chip.classList.add('selected'); });
        if (state.work_status) { var wc = wsGroup.querySelector('.option-card[data-value="' + state.work_status + '"]'); if (wc) wc.classList.add('selected'); }
        if (state.needs_transportation) tTransport.classList.add('on');
        if (state.has_attorney) { tAttorney.classList.add('on'); attyFields.style.display = 'block'; }
        if (state.step && state.step >= 1 && state.step <= 4) goToStep(state.step);
      });
    }

    // boot: init signature + restore autosave (deferred so it's in the DOM)
    setTimeout(function () {
      initSig(); restore();
      // Prompt C: same NY address typeahead as the C-3 wizard (no fork). No-ops to
      // a plain field if the service/token is unavailable.
      try {
        if (CD.AddressAutocomplete && CD.AddressAutocomplete.attach) {
          var a = $('cbi-address'); if (a) CD.AddressAutocomplete.attach(a, { region: 'NY' });
          var d = $('cbi-doctor-addr'); if (d) CD.AddressAutocomplete.attach(d, { region: 'NY' });
        }
      } catch (e) {}
    }, 0);

    return root;
  }

  CD.CompBuddyIntake = { render: render };
})(window);
