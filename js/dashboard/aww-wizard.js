/* ============================================================================
 * AWW Wizard — Average Weekly Wage guided entry (Session 2, Goal B)
 * ----------------------------------------------------------------------------
 * A short, guided flow that collects the minimum a worker can answer and reuses
 * the SHARED AWW engine (CD.Calc.computeAWW in calc-core.js) to compute their
 * §14 Average Weekly Wage and the resulting weekly compensation rate
 * (⅔ × AWW, capped at the DOA's statutory maximum). On confirm it writes the
 * real value to profiles.current_aww — no migration, prod column only.
 *
 * PARITY: math is NEVER reimplemented here. We call CD.Calc.computeAWW with the
 * exact same state shape the website/app workspace AWW tab uses
 * (ui-controller renderAWWTab → computeAWW({method, methodMultiEarn,
 * methodMultiDays, daysWeek}) / ({method:'straight', methodStraightEarn,
 * methodStraightWeeks})), so the wizard's AWW can never drift from the
 * calculator for the same inputs.
 *
 * Authored ONCE here in the app and VENDORED byte-for-byte to
 * ops/website/js/dashboard/ for the website, exactly like comp-buddy-intake.js
 * and c3-wizard.js. Same scoped-style / autosave / progress architecture.
 *
 * Public API:  window.CD.AWWWizard.render(ctx) -> DOMNode
 *
 * ctx (supabase + user required to persist; renders read-only without them):
 *   supabase      Supabase client   (app: CD.supa | web: window client)
 *   user          { id }            signed-in user (auth.uid)
 *   profile       profiles row      used to prefill doa / current_aww
 *   isNative      bool              true inside Capacitor (autosave store seam)
 *   onComplete    fn()              called after a successful current_aww write
 *   goToDashboard fn()              navigate back to the dashboard
 *   toast         fn(msg,type)      optional host toast; module has a fallback
 *
 * Upload path (paystubs / W-2) is a TRUTHFUL DISABLED STUB — the WageDocExtractor
 * seam throws not_implemented (mirrors the C-3 C3Submitter/ECaseSubmit pattern)
 * and is gated behind UPLOAD_ENABLED=false until the Jul 10, 2026 HIPAA/BAA
 * decision. No wage-document storage is built here; v1 collects no PHI.
 * ========================================================================== */
(function (window) {
  'use strict';
  var CD = (window.CD = window.CD || {});

  /* ---- feature gate: paystub/W-2 upload stays OFF until HIPAA/BAA (Jul 10 2026) */
  var UPLOAD_ENABLED = false;

  /* ---- constants -------------------------------------------------------- */
  var STEP_NAMES = { 1: 'Your Work', 2: 'Your Earnings', 3: 'Your Wage' };
  var TOTAL_STEPS = 3;
  var STORAGE_PREFIX = 'awwz:wizard:';
  var LS_METHOD_PREFIX = 'cd_aww_method::'; // remembers method label for the dashboard

  var DAYS_WEEK = [['4', '4 days'], ['5', '5 days'], ['6', '6 days'], ['7', '7 days']];

  // First sentence is legal.informationalOnly verbatim, so it is translated. The rest
  // is screen-specific guidance with no catalog key and stays English — inventing a
  // key here would mean authoring untranslated copy, and dropping it would delete
  // product content to make a coverage number look better. Flagged for P7.
  var DISCLAIMER = function () {
    var lead = (window.CD && CD.t) ? CD.t('legal.informationalOnly', 'This tool is for informational purposes only and does not constitute legal advice.') : 'This tool is for informational purposes only and does not constitute legal advice.';
    return lead + ' ' +
    'Your Average Weekly Wage is ultimately set by the Workers’ Compensation Board from ' +
    'your employer’s payroll records (Form C-240 / wage statement).';
  };

  /* ---- small DOM helper (identical to intake / c3) ---------------------- */
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c == null) return; n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  /* ---- autosave storage adapter (platform seam, identical pattern) ------ */
  function makeStore(isNative) {
    var prefs = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) || null;
    var usePrefs = isNative && prefs;
    return {
      get: function (key) {
        try {
          if (usePrefs) return prefs.get({ key: key }).then(function (r) { return r && r.value ? JSON.parse(r.value) : null; }).catch(function () { return null; });
          var raw = window.localStorage.getItem(key); return Promise.resolve(raw ? JSON.parse(raw) : null);
        } catch (e) { return Promise.resolve(null); }
      },
      set: function (key, val) {
        try { var str = JSON.stringify(val); if (usePrefs) return prefs.set({ key: key, value: str }).catch(function () {}); window.localStorage.setItem(key, str); return Promise.resolve(); }
        catch (e) { return Promise.resolve(); }
      },
      remove: function (key) {
        try { if (usePrefs) return prefs.remove({ key: key }).catch(function () {}); window.localStorage.removeItem(key); return Promise.resolve(); }
        catch (e) { return Promise.resolve(); }
      }
    };
  }

  /* ---- helpers ---------------------------------------------------------- */
  function todayISO() { return new Date().toISOString().split('T')[0]; }
  function fmtMoney(n) {
    var v = Number(n) || 0;
    return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /* ---- wage-document extraction seam (TRUTHFUL STUB) --------------------
   * Mirrors the C-3 wizard's C3Submitter/ECaseSubmit pattern: the real
   * implementation does not exist, so the seam throws not_implemented and the
   * UI is structurally incapable of claiming an upload succeeded. Gated behind
   * UPLOAD_ENABLED until the Jul 10, 2026 HIPAA/BAA decision lands. */
  function WageDocExtractor() {}
  WageDocExtractor.prototype.extract = function () {
    return Promise.reject(new Error('not_implemented: paystub/W-2 extraction is not available yet (HIPAA/BAA decision pending Jul 10, 2026).'));
  };

  /* ======================================================================
   *  render(ctx)
   * ==================================================================== */
  function render(ctx) {
    ctx = ctx || {};
    var root = el('div', { class: 'awwz' });

    // Shared engine is required — refuse to fake AWW math if calc-core is absent.
    if (!CD.Calc || typeof CD.Calc.computeAWW !== 'function') {
      root.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'card-title', text: 'AWW calculator unavailable' }),
        el('div', { class: 'card-subtitle', text: 'The wage engine didn’t load. Please reload and try again.' })
      ]));
      console.error('[AWWZ] CALC_CORE_MISSING — CD.Calc.computeAWW not available');
      return root;
    }

    var supabase = ctx.supabase || CD.supa || null;
    var user = ctx.user || CD.currentUser || (ctx.profile && ctx.profile.id ? { id: ctx.profile.id } : null);
    var profile = ctx.profile || CD.currentProfile || {};
    var isNative = !!ctx.isNative || !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    var store = makeStore(isNative);
    var STORE_KEY = STORAGE_PREFIX + (user && user.id ? user.id : 'anon');
    var canPersist = !!(supabase && user && user.id);

    /* ---- working state (prefilled from profile) ------------------------ */
    var state = {
      step: 1,
      doa: profile.doa || '',
      method: 'multi',            // 'multi' (§14(1)/(2)) | 'straight' (§14(3)/(4))
      daysWeek: '5',
      // §14(1)/(2) multiplier inputs
      multiEarn: '',
      multiDays: '',
      // §14(3)/(4) catchall inputs
      straightEarn: '',
      straightWeeks: '',
      // §2(9) adjustments
      tips: '',
      board: '',
      // §14(6) concurrent employment
      concurrentOn: false,
      concurrentAww: ''
    };
    var saving = false;

    function $(id) { return root.querySelector('#' + id); }

    function toast(msg, type) {
      if (typeof ctx.toast === 'function') { try { ctx.toast(msg, type); return; } catch (e) {} }
      // Same probe mt-tracker/accident-notice/evidence-uploader/worker-profile
      // already carried. CD.toast is app-only (js/toast.js is not synced to
      // the website), so on thecompdesk.com this falls through to the local
      // pill below — which is why that pill's CSS had to be fixed too.
      if (typeof CD.toast === 'function') { try { CD.toast(msg, type); return; } catch (e) {} }
      var t = el('div', { class: 'awwz-toast' + (type === 'ok' ? ' ok' : ''), text: msg });
      document.body.appendChild(t);
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4500);
    }

    /* ---- header + progress ------------------------------------------- */
    root.appendChild(el('div', { class: 'awwz-header' }, [
      el('h1', { text: 'Average Weekly Wage' }),
      el('span', { class: 'awwz-badge', text: 'AWW Wizard' })
    ]));
    var pSteps = el('div', { class: 'progress-steps' });
    for (var i = 1; i <= TOTAL_STEPS; i++) {
      pSteps.appendChild(el('div', { class: 'progress-step' }, [el('div', { class: 'step-dot' + (i === 1 ? ' active' : ''), id: 'awwz-dot-' + i, text: String(i) })]));
      if (i < TOTAL_STEPS) pSteps.appendChild(el('div', { class: 'step-line', id: 'awwz-line-' + i }));
    }
    root.appendChild(el('div', { class: 'progress-container' }, [
      pSteps,
      el('div', { class: 'progress-label' }, [
        document.createTextNode('Step '), el('span', { id: 'awwz-step-current', text: '1' }),
        document.createTextNode(' of ' + TOTAL_STEPS + ' — '), el('span', { id: 'awwz-step-name', text: STEP_NAMES[1] })
      ])
    ]));

    var bodyWrap = el('div', { class: 'awwz-body' });
    root.appendChild(bodyWrap);

    /* ================= STEP 1 — Your Work ============================== */
    var step1 = el('div', { class: 'step-section active', id: 'awwz-step-1' });
    step1.appendChild(el('div', { class: 'step-intro' }, [
      el('div', { class: 'step-intro-icon', text: '📊' }),
      el('h2', { text: 'Your Average Weekly Wage' }),
      el('p', { text: 'Your AWW is what your weekly check is based on — ⅔ of it, up to the state maximum. Let’s figure it out.' })
    ]));
    var c1 = el('div', { class: 'card' }, [el('div', { class: 'card-title', text: 'When were you injured?' })]);
    c1.appendChild(el('div', { class: 'form-group' }, [
      el('label', { class: 'form-label', html: 'Date of Accident<span class="req">*</span>' }),
      el('input', { type: 'date', class: 'form-input', id: 'awwz-doa', max: todayISO(), value: state.doa }),
      el('div', { class: 'form-error', id: 'awwz-err-doa', text: 'Your date of accident sets the state maximum rate — please enter it.' }),
      el('div', { class: 'form-hint', text: 'This sets the statutory maximum weekly rate that applies to your claim.' })
    ]));
    step1.appendChild(c1);

    var c1b = el('div', { class: 'card' }, [
      el('div', { class: 'card-title', text: 'How steady was your work?' }),
      el('div', { class: 'card-subtitle', text: 'In the year before your injury. This picks the right §14 method.' })
    ]);
    var methodGroup = el('div', { class: 'option-group', id: 'awwz-method-group' });
    var METHODS = [
      ['multi', 'Steady schedule', 'I worked a regular number of days each week (§14(1)/(2)).'],
      ['straight', 'Irregular / new / seasonal', 'New job, seasonal, or variable hours (§14(3)/(4) catchall).']
    ];
    METHODS.forEach(function (m) {
      var cardEl = el('div', { class: 'option-card' + (state.method === m[0] ? ' selected' : ''), 'data-value': m[0] }, [
        el('div', { class: 'option-radio' }, [el('div', { class: 'option-radio-inner' })]),
        el('div', null, [el('div', { class: 'option-label', text: m[1] }), el('div', { class: 'option-desc', text: m[2] })])
      ]);
      cardEl.addEventListener('click', function () {
        methodGroup.querySelectorAll('.option-card').forEach(function (c) { c.classList.remove('selected'); });
        cardEl.classList.add('selected');
        state.method = m[0];
        $('awwz-days-wrap').style.display = state.method === 'multi' ? 'block' : 'none';
        persist();
      });
      methodGroup.appendChild(cardEl);
    });
    c1b.appendChild(el('div', { class: 'form-group' }, [methodGroup]));
    // days/week — only relevant to the multiplier method
    var daysGroup = el('div', { class: 'option-group horizontal', id: 'awwz-days-group' });
    DAYS_WEEK.forEach(function (d) {
      var dc = el('div', { class: 'option-card compact' + (state.daysWeek === d[0] ? ' selected' : ''), 'data-value': d[0] }, [
        el('div', { class: 'option-radio' }, [el('div', { class: 'option-radio-inner' })]),
        el('div', { class: 'option-label', text: d[1] })
      ]);
      dc.addEventListener('click', function () {
        daysGroup.querySelectorAll('.option-card').forEach(function (c) { c.classList.remove('selected'); });
        dc.classList.add('selected');
        state.daysWeek = d[0];
        persist();
      });
      daysGroup.appendChild(dc);
    });
    c1b.appendChild(el('div', { id: 'awwz-days-wrap', style: state.method === 'multi' ? 'display:block' : 'display:none' }, [
      el('div', { class: 'form-group' }, [
        el('label', { class: 'form-label', text: 'How many days a week did you normally work?' }),
        daysGroup
      ])
    ]));
    step1.appendChild(c1b);
    step1.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-primary', onclick: function () { validateAndNext(1); } }, ['Continue'])
    ]));
    bodyWrap.appendChild(step1);

    /* ================= STEP 2 — Your Earnings ========================= */
    var step2 = el('div', { class: 'step-section', id: 'awwz-step-2' });
    step2.appendChild(el('div', { class: 'step-intro' }, [
      el('div', { class: 'step-intro-icon', text: '💵' }),
      el('h2', { text: 'Your Earnings' }),
      el('p', { text: 'Use your gross (before-tax) pay. A recent pay stub or W-2 is the easiest source.' })
    ]));

    // §14(1)/(2) multiplier card
    var cMulti = el('div', { class: 'card', id: 'awwz-card-multi', style: state.method === 'multi' ? '' : 'display:none' }, [
      el('div', { class: 'card-title', text: 'Earnings (§14(1)/(2))' }),
      el('div', { class: 'card-subtitle', text: 'Your total gross pay and the days you actually worked over the 52 weeks before your injury.' })
    ]);
    cMulti.appendChild(el('div', { class: 'form-group' }, [
      el('div', { class: 'form-row' }, [
        el('div', null, [
          el('label', { class: 'form-label', html: 'Total gross earnings<span class="req">*</span>' }),
          el('div', { class: 'input-money' }, [el('span', { text: '$' }), el('input', { type: 'number', inputmode: 'decimal', class: 'form-input', id: 'awwz-multiEarn', placeholder: '0.00', value: state.multiEarn })])
        ]),
        el('div', null, [
          el('label', { class: 'form-label', html: 'Days actually worked<span class="req">*</span>' }),
          el('input', { type: 'number', inputmode: 'numeric', class: 'form-input', id: 'awwz-multiDays', placeholder: 'e.g. 240', value: state.multiDays })
        ])
      ]),
      el('div', { class: 'form-error', id: 'awwz-err-multi', text: 'Enter your gross earnings and the number of days you worked.' }),
      el('div', { class: 'form-hint', text: 'We divide earnings by days worked, then multiply by the statutory factor for your schedule.' })
    ]));
    step2.appendChild(cMulti);

    // §14(3)/(4) catchall card
    var cStraight = el('div', { class: 'card', id: 'awwz-card-straight', style: state.method === 'straight' ? '' : 'display:none' }, [
      el('div', { class: 'card-title', text: 'Earnings (§14(3)/(4) Catchall)' }),
      el('div', { class: 'card-subtitle', text: 'Your total gross pay divided by the number of weeks you actually worked.' })
    ]);
    cStraight.appendChild(el('div', { class: 'form-group' }, [
      el('div', { class: 'form-row' }, [
        el('div', null, [
          el('label', { class: 'form-label', html: 'Total gross earnings<span class="req">*</span>' }),
          el('div', { class: 'input-money' }, [el('span', { text: '$' }), el('input', { type: 'number', inputmode: 'decimal', class: 'form-input', id: 'awwz-straightEarn', placeholder: '0.00', value: state.straightEarn })])
        ]),
        el('div', null, [
          el('label', { class: 'form-label', html: 'Weeks worked<span class="req">*</span>' }),
          el('input', { type: 'number', inputmode: 'numeric', class: 'form-input', id: 'awwz-straightWeeks', placeholder: 'e.g. 30', value: state.straightWeeks })
        ])
      ]),
      el('div', { class: 'form-error', id: 'awwz-err-straight', text: 'Enter your gross earnings and the number of weeks you worked.' })
    ]));
    step2.appendChild(cStraight);

    // §2(9) adjustments + §14(6) concurrent
    var cAdj = el('div', { class: 'card' }, [
      el('div', { class: 'card-title', text: 'Add-ons' }),
      el('div', { class: 'card-subtitle', text: 'Optional — skip any that don’t apply to you.' })
    ]);
    cAdj.appendChild(el('div', { class: 'form-group' }, [
      el('div', { class: 'form-row' }, [
        el('div', null, [
          el('label', { class: 'form-label', html: 'Tips / gratuities<span class="opt">(§2(9))</span>' }),
          el('div', { class: 'input-money' }, [el('span', { text: '$' }), el('input', { type: 'number', inputmode: 'decimal', class: 'form-input', id: 'awwz-tips', placeholder: '0.00', value: state.tips })])
        ]),
        el('div', null, [
          el('label', { class: 'form-label', html: 'Board / lodging<span class="opt">(§2(9))</span>' }),
          el('div', { class: 'input-money' }, [el('span', { text: '$' }), el('input', { type: 'number', inputmode: 'decimal', class: 'form-input', id: 'awwz-board', placeholder: '0.00', value: state.board })])
        ])
      ]),
      el('div', { class: 'form-hint', text: 'Weekly value of tips and any employer-provided board or lodging, if your wages didn’t already include them.' })
    ]));
    // concurrent employment toggle (§14(6))
    var tConc = el('div', { class: 'toggle-switch' + (state.concurrentOn ? ' on' : ''), id: 'awwz-toggle-conc' }, [el('div', { class: 'toggle-knob' })]);
    var concWrap = el('div', { id: 'awwz-conc-wrap', style: state.concurrentOn ? 'display:block;margin-top:14px' : 'display:none' }, [
      el('div', { class: 'form-group' }, [
        el('label', { class: 'form-label', html: 'AWW from your other job(s)<span class="opt">(§14(6))</span>' }),
        el('div', { class: 'input-money' }, [el('span', { text: '$' }), el('input', { type: 'number', inputmode: 'decimal', class: 'form-input', id: 'awwz-concurrentAww', placeholder: '0.00', value: state.concurrentAww })]),
        el('div', { class: 'form-hint', text: 'If you had a second job at the time of injury, its wages can be added under §14(6). Bring proof (pay stubs) — the Board will want it.' })
      ])
    ]);
    tConc.addEventListener('click', function () {
      tConc.classList.toggle('on');
      state.concurrentOn = tConc.classList.contains('on');
      concWrap.style.display = state.concurrentOn ? 'block' : 'none';
      persist();
    });
    cAdj.appendChild(el('div', { class: 'form-group' }, [el('div', { class: 'toggle-row' }, [
      el('div', null, [el('div', { class: 'toggle-text', text: 'Did you have a second job?' }), el('div', { class: 'toggle-text-desc', text: 'Concurrent employment can raise your AWW (§14(6))' })]),
      tConc
    ])]));
    cAdj.appendChild(concWrap);
    step2.appendChild(cAdj);

    // live AWW preview
    var livePreview = el('div', { class: 'live-aww' }, [
      el('span', { class: 'lbl', text: 'Estimated AWW so far' }),
      el('span', { class: 'val', id: 'awwz-live', text: '$0.00' })
    ]);
    step2.appendChild(livePreview);

    // disabled upload scaffold (TRUTHFUL — Coming soon; behind UPLOAD_ENABLED)
    var uploadStub = el('div', { class: 'upload-stub', id: 'awwz-upload-stub' }, [
      el('div', { class: 'ico', text: '📄' }),
      el('div', null, [
        el('div', { class: 'upload-stub-title', text: 'Upload paystubs / W-2' }),
        el('div', { class: 'upload-stub-desc', text: 'Let us read your wages from a document automatically.' })
      ]),
      el('span', { class: 'soon', text: 'Coming soon' })
    ]);
    uploadStub.addEventListener('click', function () {
      if (UPLOAD_ENABLED) { tryWageUpload(); return; }
      toast('Document upload is coming soon — for now, enter your wages above.', 'ok');
    });
    step2.appendChild(uploadStub);

    step2.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-secondary', onclick: function () { goToStep(1); } }, ['Back']),
      el('button', { class: 'btn btn-primary', onclick: function () { validateAndNext(2); } }, ['See my AWW'])
    ]));
    bodyWrap.appendChild(step2);

    /* ================= STEP 3 — Your Wage (result) ==================== */
    var step3 = el('div', { class: 'step-section', id: 'awwz-step-3' });
    step3.appendChild(el('div', { class: 'step-intro' }, [
      el('div', { class: 'step-intro-icon', text: '✅' }),
      el('h2', { text: 'Your Average Weekly Wage' }),
      el('p', { text: 'Here’s your AWW and the weekly rate it drives. Confirm to save it to your profile.' })
    ]));
    var resultCard = el('div', { class: 'card', id: 'awwz-result-card' });
    step3.appendChild(resultCard);
    step3.appendChild(el('div', { class: 'info-callout', html: '<strong>How this is used:</strong> the Board pays ⅔ of your AWW for total disability, capped at the statutory maximum for your accident date. If you’re partially disabled, your check is that rate times your degree of disability.' }));
    step3.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-secondary', onclick: function () { goToStep(2); } }, ['Back']),
      el('button', { class: 'btn btn-primary', id: 'awwz-confirm', onclick: function () { confirmSave(); } }, [canPersist ? 'Save my AWW' : 'Done'])
    ]));
    bodyWrap.appendChild(step3);

    /* ---- success ----------------------------------------------------- */
    var stepSuccess = el('div', { class: 'step-section', id: 'awwz-step-success' });
    bodyWrap.appendChild(stepSuccess);

    root.appendChild(el('div', { class: 'disclaimer', html: DISCLAIMER() + '<br>The Comp Desk &copy; 2026' }));

    /* ---------- field <-> state plumbing ------------------------------ */
    var FIELD_MAP = [
      ['awwz-doa', 'doa'], ['awwz-multiEarn', 'multiEarn'], ['awwz-multiDays', 'multiDays'],
      ['awwz-straightEarn', 'straightEarn'], ['awwz-straightWeeks', 'straightWeeks'],
      ['awwz-tips', 'tips'], ['awwz-board', 'board'], ['awwz-concurrentAww', 'concurrentAww']
    ];
    function syncFromDom() {
      FIELD_MAP.forEach(function (f) { var n = $(f[0]); if (n) state[f[1]] = n.value; });
    }
    root.querySelectorAll('input').forEach(function (n) {
      n.addEventListener('input', function () { syncFromDom(); updateLive(); });
      n.addEventListener('blur', function () { syncFromDom(); persist(); });
      n.addEventListener('change', function () { syncFromDom(); persist(); updateLive(); });
    });

    /* ---------- the shared AWW computation (NO local math) ------------ */
    // Builds the exact state shape CD.Calc.computeAWW expects — identical to the
    // workspace AWW tab (ui-controller renderAWWTab) — so results can't drift.
    function computeResult() {
      var s = {
        method: state.method, // 'multi' | 'straight'
        doi: state.doa,       // drives maxRateForDOA / minRateForDOA
        adjTips: num(state.tips),
        adjBoard: num(state.board),
        concurrentOn: !!state.concurrentOn,
        adjConcurrent: num(state.concurrentAww)
      };
      if (state.method === 'straight') {
        s.methodStraightEarn = num(state.straightEarn);
        s.methodStraightWeeks = num(state.straightWeeks);
      } else {
        s.methodMultiEarn = num(state.multiEarn);
        s.methodMultiDays = num(state.multiDays);
        s.daysWeek = parseInt(state.daysWeek, 10) || 5;
      }
      return CD.Calc.computeAWW(s);
    }
    function updateLive() {
      var live = $('awwz-live'); if (!live) return;
      var r = computeResult();
      live.textContent = fmtMoney(r.aww);
    }

    /* ---------- validation ------------------------------------------- */
    function showError(id) { var e = $('awwz-err-' + id); if (e) e.classList.add('visible'); }
    function clearError(id) { var e = $('awwz-err-' + id); if (e) e.classList.remove('visible'); }
    function validateAndNext(step) {
      syncFromDom();
      var ok = true;
      if (step === 1) {
        if (!state.doa || state.doa > todayISO()) { showError('doa'); ok = false; } else clearError('doa');
      } else if (step === 2) {
        if (state.method === 'multi') {
          if (!(num(state.multiEarn) > 0) || !(num(state.multiDays) > 0)) { showError('multi'); ok = false; } else clearError('multi');
        } else {
          if (!(num(state.straightEarn) > 0) || !(num(state.straightWeeks) > 0)) { showError('straight'); ok = false; } else clearError('straight');
        }
      }
      if (ok) goToStep(step + 1);
    }

    /* ---------- navigation ------------------------------------------- */
    function goToStep(n) {
      syncFromDom();
      persist();
      state.step = n;
      root.querySelectorAll('.step-section').forEach(function (s) { s.classList.remove('active'); });
      var sec = $('awwz-step-' + n); if (sec) sec.classList.add('active');
      // reflect the chosen method's earnings card on step 2
      var cm = $('awwz-card-multi'), cs = $('awwz-card-straight');
      if (cm) cm.style.display = state.method === 'multi' ? '' : 'none';
      if (cs) cs.style.display = state.method === 'straight' ? '' : 'none';
      for (var i = 1; i <= TOTAL_STEPS; i++) {
        var dot = $('awwz-dot-' + i); if (dot) { dot.className = 'step-dot'; if (i < n) dot.classList.add('completed'); else if (i === n) dot.classList.add('active'); }
        if (i < TOTAL_STEPS) { var line = $('awwz-line-' + i); if (line) { line.className = 'step-line'; if (i < n) line.classList.add('completed'); } }
      }
      var sc = $('awwz-step-current'); if (sc) sc.textContent = String(n);
      var sn = $('awwz-step-name'); if (sn) sn.textContent = STEP_NAMES[n] || '';
      if (n === 2) updateLive();
      if (n === 3) renderResult();
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
    }

    /* ---------- result rendering -------------------------------------- */
    function renderResult() {
      var r = computeResult();
      var maxRate = num(r.maxRate);
      // Weekly comp rate = ⅔ × AWW capped at the DOA max (calc-core ttRate is the
      // min/max-bounded ⅔; we also surface the cap explicitly for transparency).
      var weeklyRate = num(r.ttRate);
      var twoThirds = Math.round(r.aww * 2 / 3 * 100) / 100;
      var capped = !!r.capped;

      resultCard.innerHTML = '';
      resultCard.appendChild(el('div', { class: 'result-hero' }, [
        el('div', { class: 'result-aww-lbl', text: 'Average Weekly Wage' }),
        el('div', { class: 'result-aww', text: fmtMoney(r.aww) }),
        el('div', { class: 'result-method', text: r.methodLabel || '' })
      ]));
      if (r.formula) resultCard.appendChild(el('div', { class: 'result-formula', text: r.formula }));
      if (r.isComposite) resultCard.appendChild(el('div', { class: 'result-formula', text: '+ concurrent employment (§14(6)): ' + fmtMoney(r.concurrentAww) }));
      resultCard.appendChild(el('div', { class: 'result-rate' }, [
        el('span', { class: 'lbl', text: 'Weekly rate (⅔ AWW, total disability)' }),
        el('span', { class: 'val', text: fmtMoney(weeklyRate) })
      ]));
      if (capped && maxRate > 0) {
        resultCard.appendChild(el('div', { class: 'cap-note', text: 'Capped at the ' + fmtMoney(maxRate) + ' statutory maximum for your accident date (⅔ of your AWW would be ' + fmtMoney(twoThirds) + ').' }));
      } else if (maxRate === 0) {
        resultCard.appendChild(el('div', { class: 'cap-note', text: 'No statutory maximum found for that accident date — showing an uncapped ⅔ estimate. Double-check your date of accident.' }));
      }
    }

    /* ---------- confirm + persist ------------------------------------ */
    function confirmSave() {
      syncFromDom();
      var r = computeResult();
      var aww = Math.round(num(r.aww) * 100) / 100;
      if (!(aww > 0)) { toast('Your AWW came out to $0 — go back and check your earnings.'); return; }

      // remember the method label locally so the dashboard can show it (no column)
      try { window.localStorage.setItem(LS_METHOD_PREFIX + ((user && user.id) || 'anon'), r.methodLabel || ''); } catch (e) {}

      // keep host profile in sync immediately so the dashboard repaints with real data
      try {
        if (CD.currentProfile) CD.currentProfile.current_aww = aww;
        if (profile) profile.current_aww = aww;
      } catch (e) {}

      if (!canPersist) { store.remove(STORE_KEY); showSuccess(aww, false); return; }

      if (saving) return;
      saving = true;
      var btn = $('awwz-confirm'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      supabase.from('profiles').update({ current_aww: aww }).eq('id', user.id).then(function (res) {
        saving = false;
        if (res && res.error) {
          if (btn) { btn.disabled = false; btn.textContent = 'Save my AWW'; }
          console.error('[AWWZ] AWW_SAVE_FAILED', res.error);
          toast('We couldn’t save your AWW. Your entries are still here — please try again.');
          return;
        }
        store.remove(STORE_KEY);
        showSuccess(aww, true);
      }).catch(function (e) {
        saving = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Save my AWW'; }
        console.error('[AWWZ] AWW_SAVE_FAILED', e);
        toast('We couldn’t save your AWW. Your entries are still here — please try again.');
      });
    }

    /* ---------- success ----------------------------------------------- */
    function showSuccess(aww, persisted) {
      var r = computeResult();
      root.querySelectorAll('.step-section').forEach(function (s) { s.classList.remove('active'); });
      for (var i = 1; i <= TOTAL_STEPS; i++) { var d = $('awwz-dot-' + i); if (d) d.className = 'step-dot completed'; if (i < TOTAL_STEPS) { var l = $('awwz-line-' + i); if (l) l.className = 'step-line completed'; } }
      var sc = $('awwz-step-current'); if (sc) sc.textContent = String(TOTAL_STEPS);
      stepSuccess.innerHTML = '';
      stepSuccess.appendChild(el('div', { class: 'result-hero', style: 'padding:24px 8px 8px' }, [
        el('div', { class: 'step-intro-icon', text: '🎉' }),
        el('div', { class: 'result-aww-lbl', text: persisted ? 'Saved to your profile' : 'Your AWW' }),
        el('div', { class: 'result-aww', text: fmtMoney(aww) }),
        el('div', { class: 'result-method', text: persisted ? 'Your dashboard now shows your real weekly rate' : r.methodLabel || '' })
      ]));
      stepSuccess.appendChild(el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn btn-primary', style: 'width:100%', onclick: function () { goDash(); } }, ['Back to Dashboard'])
      ]));
      stepSuccess.classList.add('active');
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
    }
    function goDash() {
      if (typeof ctx.onComplete === 'function') { try { ctx.onComplete(); return; } catch (e) {} }
      if (typeof ctx.goToDashboard === 'function') { try { ctx.goToDashboard(); return; } catch (e) {} }
      try { window.location.reload(); } catch (e) {}
    }

    /* ---------- wage upload (disabled seam — truthful stub) ----------- */
    function tryWageUpload() {
      // Reachable ONLY if UPLOAD_ENABLED is flipped true post-HIPAA/BAA. Until
      // then the seam throws not_implemented and we surface that honestly.
      new WageDocExtractor().extract().then(function () {
        // future: prefill earnings from the parsed document
      }).catch(function (e) {
        console.warn('[AWWZ] WAGE_UPLOAD_UNAVAILABLE', e && e.message);
        toast('Document upload isn’t available yet. Please enter your wages manually.');
      });
    }

    /* ---------- autosave persist + restore ---------------------------- */
    function persist() { store.set(STORE_KEY, state);
      // CONTINUITY: the AWW wizard's only profile-relevant field is the date of injury.
      try { if (CD.WorkerProfile && CD.WorkerProfile.merge && state.doa) CD.WorkerProfile.merge({ date_of_injury: state.doa }, { source: 'aww' }); } catch (e) {}
    }
    function restore() {
      return store.get(STORE_KEY).then(function (saved) {
        if (!saved) { updateLive(); return; }
        Object.keys(saved).forEach(function (k) { if (k in state) state[k] = saved[k]; });
        FIELD_MAP.forEach(function (f) { var n = $(f[0]); if (n && state[f[1]] != null) n.value = state[f[1]]; });
        // reflect method + days + concurrent selections
        var mg = $('awwz-method-group');
        if (mg) mg.querySelectorAll('.option-card').forEach(function (c) { c.classList.toggle('selected', c.getAttribute('data-value') === state.method); });
        var dw = $('awwz-days-wrap'); if (dw) dw.style.display = state.method === 'multi' ? 'block' : 'none';
        var dg = $('awwz-days-group');
        if (dg) dg.querySelectorAll('.option-card').forEach(function (c) { c.classList.toggle('selected', c.getAttribute('data-value') === state.daysWeek); });
        if (state.concurrentOn) { var tc = $('awwz-toggle-conc'); if (tc) tc.classList.add('on'); var cw = $('awwz-conc-wrap'); if (cw) cw.style.display = 'block'; }
        if (state.step && state.step >= 1 && state.step <= TOTAL_STEPS) goToStep(state.step);
        else updateLive();
      });
    }

    // boot
    setTimeout(function () { restore(); }, 0);
    return root;
  }

  CD.AWWWizard = { render: render };
})(window);
