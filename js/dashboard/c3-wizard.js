/* ============================================================================
 * C-3 (Employee Claim) Filing Wizard — Phase F / Feature 7
 * ----------------------------------------------------------------------------
 * Self-help wizard that produces a complete, signed, FILING-READY C-3 PDF
 * (NYS WCB Employee Claim, rev. C-3.0 (6-22)) pre-filled from the claimant's
 * Comp Buddy profile, plus the C-3.3 "Limited Release of Health Information
 * (HIPAA)" supplement when a prior injury to the same body part is reported.
 *
 * TRUTHFUL SCOPE (v1): we generate + store + give filing instructions. We do
 * NOT e-file to the WCB (eCase API blocked on the data partnership). The
 * submission seam (C3Submitter) has two implementations — SelfFilePackage (v1)
 * and ECaseSubmit (stub that throws) — so the UI is structurally incapable of
 * claiming "submitted to WCB" until true e-file lands.
 *
 * This is claimant self-help, NOT legal advice and NOT us filing on their
 * behalf. See ops/rd/specs/c3_filing_wizard_spec.md.
 *
 * Public API:  window.CD.C3Wizard.render(ctx) -> DOMNode
 *
 * ctx (supabase + user required):
 *   supabase      Supabase client     (app: CD.supa | web: window client)
 *   user          { id, email }        signed-in user (auth.uid)
 *   profile       profiles row         REQUIRED for prefill — fail loud if absent
 *   isNative      bool                 true inside Capacitor
 *   onComplete    fn()                 called after a successful generation
 *   goToDashboard fn()                 navigate back to the dashboard
 *   toast         fn(msg,type)         optional host toast; module has a fallback
 *
 * Authored ONCE here in the app and VENDORED byte-for-byte to
 * ops/website/js/dashboard/, then mirrored to ios/ + android/ public bundles,
 * exactly like comp-buddy-intake.js.
 *
 * Storage (migration 048): templates in c3-template (read), generated PDFs in
 * c3-filings/{user_id}/{ts}.pdf (own-folder RLS). c3_filings rows hold no
 * narrative PHI. In-progress ANSWERS autosave to client storage always, and —
 * for signed-in users — to an owner-only c3_drafts row (migration 079) so a
 * claim can resume across devices; the draft is answers-only (SSN + signature
 * are stripped client-side) and is deleted the moment the signed PDF is made.
 * ========================================================================== */
(function (window) {
  'use strict';
  var CD = (window.CD = window.CD || {});

  /* ---- shared glossary tooltip (CD.Glossary) — create if absent ---------
   * A tiny, self-contained "tap an acronym for a plain-language definition"
   * helper. Authored here (first place that needed it) but attached to CD so
   * ANY surface can reuse it: `CD.Glossary.term('AWW')` returns a DOM node that
   * shows a small popover on tap/hover. Definitions are worker-voice, not
   * statutory. It injects its own styles + one shared popover, so it works even
   * where the .c3w wizard styles aren't loaded. */
  if (!CD.Glossary) {
    CD.Glossary = (function () {
      // Plain-English, injured-worker-voice definitions (no legalese). Add terms
      // here as new surfaces need them.
      var TERMS = {
        'AWW': 'Average Weekly Wage — the average amount you earned each week before your injury. Your weekly benefit checks are based on this number.',
        'C-3': 'The Employee Claim — the official form that opens your workers’ comp case with the Board.',
        'C-3.3': 'A short HIPAA release that lets the insurer get records from a doctor who treated an earlier injury to the same body part.',
        'IME': 'Independent Medical Exam — a one-time exam by a doctor the insurance company picks, not your own doctor.',
        'WCB': 'The New York State Workers’ Compensation Board — the state agency that runs your claim.',
        'DOI': 'Date of Injury — the day you got hurt, or the day you first noticed a work-related illness.'
      };
      var pop = null, openAbbr = null;
      function ensureStyles() {
        if (document.getElementById('cd-gloss-styles')) return;
        var css = [
          '.cd-gloss{border-bottom:1px dotted currentColor;cursor:help;font-weight:600;white-space:nowrap}',
          '.cd-gloss:focus{outline:2px solid #3b82f6;outline-offset:2px;border-radius:2px}',
          '.cd-gloss-pop{position:absolute;z-index:100050;max-width:264px;background:#15171f;color:#e8eaed;border:1px solid #2e3145;border-radius:8px;padding:10px 12px;font-size:12.5px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.5)}',
          '.cd-gloss-pop b{color:#7ab0ff}'
        ].join('\n');
        var s = document.createElement('style'); s.id = 'cd-gloss-styles'; s.textContent = css; document.head.appendChild(s);
      }
      function ensurePop() {
        if (pop) return pop;
        ensureStyles();
        pop = document.createElement('div');
        pop.className = 'cd-gloss-pop';
        pop.setAttribute('role', 'tooltip');
        pop.style.display = 'none';
        document.body.appendChild(pop);
        document.addEventListener('click', function (e) {
          if (!pop || pop.style.display === 'none') return;
          if (e.target && e.target.classList && e.target.classList.contains('cd-gloss')) return;
          hide();
        });
        window.addEventListener('resize', hide);
        window.addEventListener('scroll', hide, true);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
        return pop;
      }
      function hide() { if (pop) { pop.style.display = 'none'; openAbbr = null; } }
      function showFor(node) {
        var abbr = node.getAttribute('data-abbr'); var def = TERMS[abbr]; if (!def) return;
        var p = ensurePop();
        p.innerHTML = ''; var b = document.createElement('b'); b.textContent = abbr;
        p.appendChild(b); p.appendChild(document.createTextNode(' — ' + def));
        p.style.display = 'block'; openAbbr = abbr;
        var r = node.getBoundingClientRect();
        var sx = window.pageXOffset || 0, sy = window.pageYOffset || 0;
        var vw = document.documentElement.clientWidth;
        var left = Math.min(r.left + sx, sx + vw - p.offsetWidth - 12);
        p.style.top = (r.bottom + sy + 6) + 'px';
        p.style.left = Math.max(8, left) + 'px';
      }
      function term(abbr, label) {
        var s = document.createElement('span');
        s.className = 'cd-gloss'; s.setAttribute('data-abbr', abbr);
        s.setAttribute('role', 'button'); s.setAttribute('tabindex', '0');
        s.setAttribute('aria-label', abbr + ' — tap for what this means');
        s.textContent = label || abbr;
        s.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); if (openAbbr === abbr) hide(); else showFor(s); });
        s.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (openAbbr === abbr) hide(); else showFor(s); } });
        return s;
      }
      return { term: term, define: function (a, d) { TERMS[a] = d; }, TERMS: TERMS, hide: hide };
    })();
  }

  /* ---- constants -------------------------------------------------------- */
  var STEP_NAMES = { 1: 'You & Your Job', 2: 'The Injury', 3: 'Employer & Notice', 4: 'Medical & Work', 5: 'Review & Sign' };
  var TOTAL_STEPS = 5;
  // Honest per-step time-to-complete (minutes) for a worker filling by hand, with
  // most of step 1 pre-filled. Drives the "about N min left" estimate: remaining =
  // sum of the CURRENT step through step 5 (see etaRemaining). Kept modest and
  // labelled "about" — better to slightly over-promise speed than to intimidate.
  var STEP_MIN = { 1: 2, 2: 3, 3: 2, 4: 2, 5: 2 };
  var STORAGE_PREFIX = 'c3:filing:';
  var INTAKE_PREFIX = 'cbi:intake:';   // the Comp Buddy intake's own autosave key

  // Same 21 body parts as the intake (canonical lowercase values).
  var BODY_PARTS = [
    ['head', 'Head'], ['neck', 'Neck'], ['left shoulder', 'L Shoulder'], ['right shoulder', 'R Shoulder'],
    ['left arm', 'L Arm'], ['right arm', 'R Arm'], ['left hand', 'L Hand'], ['right hand', 'R Hand'],
    ['upper back', 'Upper Back'], ['lower back', 'Lower Back'], ['left hip', 'L Hip'], ['right hip', 'R Hip'],
    ['left knee', 'L Knee'], ['right knee', 'R Knee'], ['left ankle', 'L Ankle'], ['right ankle', 'R Ankle'],
    ['left foot', 'L Foot'], ['right foot', 'R Foot'], ['chest', 'Chest'], ['abdomen', 'Abdomen'],
    ['psychological', 'Psychological']
  ];
  var BODY_LABELS = {}; BODY_PARTS.forEach(function (b) { BODY_LABELS[b[0]] = b[1]; });

  var JOB_TIME = [['Full_Time', 'Full Time'], ['Part_Time', 'Part Time'], ['Seasonal', 'Seasonal'], ['Volunteer', 'Volunteer'], ['Other', 'Other']];
  var TREAT_TYPE = [['Emergency_Room', 'Emergency Room'], ['Doctors_office', 'Doctor’s office'], ['ClinicHospitalUrgent_Care', 'Clinic / Hospital / Urgent Care'], ['Hospital_Stay_over_24_hours', 'Hospital stay over 24 hours'], ['none_received', 'None received']];
  // occupation slug -> C-3 job-title seed text
  var OCC_LABELS = { construction: 'Construction worker', nurse: 'Nurse', delivery: 'Delivery driver', warehouse: 'Warehouse worker', office: 'Office worker', food: 'Food service worker' };

  var DISCLAIMER =
    'This tool is for informational purposes only and does not constitute legal advice. ' +
    'The Comp Desk is not a law firm and is not filing this claim on your behalf. You are ' +
    'preparing and filing your own C-3 (Employee Claim) with the New York State Workers’ ' +
    'Compensation Board.';

  // VERBATIM certification + penalty-of-perjury language from the bottom of WCB
  // Form C-3 (C-3.0 (6-22)), Page 2. Pulled exactly from the form's certification
  // block — do NOT paraphrase (this is the statutory fraud warning, ALL-CAPS
  // emphasis preserved as printed). Shown in the pre-export acknowledgment gate.
  var C3_CERT_AFFIRMATION =
    'I am hereby making a claim for benefits under the Workers’ Compensation Law. ' +
    'My signature affirms that the information I am providing is true and accurate to the ' +
    'best of my knowledge and belief.';
  var C3_FRAUD_WARNING =
    'Any person who knowingly and with INTENT TO DEFRAUD presents, causes to be presented, ' +
    'or prepares with knowledge or belief that it will be presented to, or by an insurer, ' +
    'or self-insurer, any information containing any FALSE MATERIAL STATEMENT or conceals ' +
    'any material fact, SHALL BE GUILTY OF A CRIME and subject to substantial FINES AND ' +
    'IMPRISONMENT.';

  /* ---- C-3 PDF field map (full hierarchical names — short names do NOT resolve) ----
   * Verified against the real form dump (ops/rd/c3.pdf, C-3.0 (6-22)). Text fields and
   * SEMANTICALLY-NAMED checkboxes are mapped with confidence. Generic Check_BoxNN yes/no
   * pairs whose polarity can't be confirmed without a render pass are intentionally LEFT
   * UNMARKED — the claimant ticks them on the generated PDF (safe failure mode on a
   * fraud-attestation form). See C3_VERIFY_TODO + the success-screen disclosure. */
  var P1 = 'topmostSubform[0].Page1[0].';
  var P2 = 'topmostSubform[0].Page2[0].';
  var F = {
    // Page 1 — header + A. Your information
    wcb: P1 + 'WCB_Case_Number_if_you_know_it[0]',
    name: P1 + '_1_Name[0]',
    dobM: P1 + '_2_Date_of_Birth[0]', dobD: P1 + 'undefined[0]', dobY: P1 + 'undefined_2[0]',
    mailing: P1 + '_3_Mailing_address[0]',
    ssn: P1 + 'Social_Security_Number[0]',
    phone: P1 + '_5_Phone_Number[0]', phone2: P1 + 'undefined_3[0]',   // A5: area-code box + rest (undefined_3 was mis-mapped as mailing line 2)
    genderM: P1 + 'Check_Box2[0]', genderF: P1 + 'Check_Box3[0]',          // A6 Gender M/F
    translatorY: P1 + 'Check_Box4[0]', translatorN: P1 + 'Check_Box5[0]',  // A7 translator Yes/No
    language: P1 + 'If_yes_for_what_language[0]',
    // B. Your employer(s)
    employer: P1 + '_1_Employer_when_injured[0]',
    employerPhone: P1 + '_2_Phone_Number[0]', employerPhone2: P1 + 'undefined_4[0]',   // B2: area-code box + rest
    workAddress: P1 + '_3_Your_work_address[0]',
    supervisor: P1 + '_5_Your_supervisors_name[0]',
    otherEmployers: P1 + '_6_List_namesaddresses_of_any_other_employers_at_the_time_of_your_injuryillness[0]',
    // C. Your job
    jobTitle: P1 + '_1_What_was_your_job_title_or_description[0]',
    activities: P1 + '_2_What_types_of_activities_did_you_normally_perform_at_work[0]',
    activities2: P1 + 'Activities_Performed[0]',
    jobOtherText: P1 + 'undefined_7[0]',
    grossPay: P1 + '_4_What_was_your_gross_pay_before_taxes_per_pay_period[0]',
    payFreq: P1 + '_5_How_often_were_you_paid[0]',
    // D. Injury (page 1)
    doiM: P1 + '_1_Date_of_injury_or_date_of_onset_of_illness[0]', doiD: P1 + 'undefined_8[0]', doiY: P1 + 'undefined_9[0]',
    timeOfInjury: P1 + '_2_Time_of_injury[0]', am: P1 + 'AM[0]', pm: P1 + 'PM[0]',
    whereHappened: P1 + '_3_Where_did_the_injuryillness_happen_eg_1_Main_Street_Pottersville_at_the_front_door[0]',
    whereHappened2: P1 + 'Where_Injury_Happen[0]',
    whatDoing: P1 + '_5_What_were_you_doing_when_you_were_injured_or_became_ill_eg_unloading_a_truck_typing_a_report[0]',
    whatDoing2: P1 + 'What_were_you_doing[0]',
    howHappened: P1 + '_6_How_did_the_injuryillness_happen_eg_I_tripped_over_a_pipe_and_fell_on_the_floor[0]',
    howHappened2: P1 + '_1_2[0]', howHappened3: P1 + '_2_2[0]',
    nature: P1 + '_7_Explain_fully_the_nature_of_your_injuryillness_list_body_parts_affected_eg_twisted_left_ankle_and_cut_to_forehead[0]',
    nature2: P1 + '_1_3[0]', nature3: P1 + '_2_3[0]',
    // Page 2 — header
    nameP2: P2 + 'YOUR_NAME[0]',
    doiP2M: P2 + 'DATE_OF_INJURYILLNESS[0]', doiP2D: P2 + 'undefined_11[0]', doiP2Y: P2 + 'undefined_12[0]',
    objectWhat: P2 + 'If_yes_what[0]',
    yourVehicle: P2 + 'your_vehicle[0]', employersVehicle: P2 + 'employers_vehicle[0]', otherVehicle: P2 + 'other_vehicle[0]',
    licensePlate: P2 + 'License_plate_number_if_known[0]',
    mvCarrier1: P2 + 'If_your_vehicle_was_involved_give_name_and_address_of_your_motor_vehicle_insurance_carrier_1[0]',
    mvCarrier2: P2 + 'If_your_vehicle_was_involved_give_name_and_address_of_your_motor_vehicle_insurance_carrier_2[0]',
    noticeTo: P2 + 'If_yes_notice_was_given_to[0]', orally: P2 + 'orally[0]', inWriting: P2 + 'in_writing[0]',
    witnessNames: P2 + 'If_yes_list_names[0]',
    // E. Return to work — each date is THREE boxes (M / D / Y), not one
    stopWorkDate: P2 + 'on_what_date[0]', stopWorkD: P2 + 'undefined_15[0]', stopWorkY: P2 + 'undefined_16[0]',
    returnedDate: P2 + 'If_yes_on_what_date[0]', returnedD: P2 + 'undefined_17[0]', returnedY: P2 + 'undefined_18[0]',
    regularDuty: P2 + 'regular_duty[0]', limitedDuty: P2 + 'limited_duty[0]',
    sameEmployer: P2 + 'Same_employer[0]', newEmployer: P2 + 'New_employer[0]', selfEmployed: P2 + 'Self_employed[0]',
    grossPay2: P2 + '_4_What_is_your_gross_pay_before_taxes_per_pay_period[0]',
    payFreq2: P2 + 'How_often_are_you_paid[0]',
    // F. Medical treatment
    firstTreatDate: P2 + '_1_What_was_the_date_of_your_first_treatment[0]', firstTreatD: P2 + 'undefined_19[0]', firstTreatY: P2 + 'undefined_20[0]',
    noneReceived: P2 + 'None_received_skip_to_question_F5[0]',
    firstTreatName1: P2 + 'Name_and_address_where_you_were_first_treated_1[0]',
    firstTreatName2: P2 + 'Name_and_address_where_you_were_first_treated_2[0]',
    firstTreatPhone: P2 + 'Phone_Number[0]',
    treatingDoctors1: P2 + 'Give_the_name_and_address_of_the_doctors_treating_you_for_this_injuryillness_1[0]',
    treatingDoctors2: P2 + 'Give_the_name_and_address_of_the_doctors_treating_you_for_this_injuryillness_2[0]',
    treatingDoctorsPhone: P2 + 'Phone_Number_2[0]',
    // --- Completeness pass (2026-06-24): newly mapped fields. Y/N checkbox
    //     polarity confirmed by widget-rect + nearby-label extraction against
    //     the real form (label sits ~7-12px right of its box). ---
    dateHiredM: P1 + '_4_Date_you_were_hired[0]', dateHiredD: P1 + 'undefined_5[0]', dateHiredY: P1 + 'undefined_6[0]',
    usualLocYes: P1 + 'Check_Box12[0]', usualLocNo: P1 + 'Check_Box13[0]', usualLocWhy: P1 + 'If_no_why_were_you_at_this_location[0]',
    noticeDateM: P2 + 'Date_notice_given[0]', noticeDateD: P2 + 'undefined_13[0]', noticeDateY: P2 + 'undefined_14[0]',
    gaveNoticeYes: P2 + 'Check_Box19[0]', gaveNoticeNo: P2 + 'Check_Box20[0]',
    stoppedYes: P2 + 'Check_Box24[0]', stoppedNo: P2 + 'Check_Box25[0]',
    returnedYes: P2 + 'Yes_10[0]', returnedNo: P2 + 'No_10[0]',
    priorYes: P2 + 'Check_Box28[0]', priorNo: P2 + 'Check_Box29[0]',
    c33Together1: P2 + 'you_and_COMPLETE_AND_FILE_FORM_C33_TOGETHER_WITH_THIS_FORM_1[0]',
    c33Together2: P2 + 'you_and_COMPLETE_AND_FILE_FORM_C33_TOGETHER_WITH_THIS_FORM_2[0]',
    c33Together3: P2 + 'you_and_COMPLETE_AND_FILE_FORM_C33_TOGETHER_WITH_THIS_FORM_3[0]',
    // Certification — employee signature row; Date is THREE boxes (M / D / Y)
    printName: P2 + 'Print_Name[0]',
    certDate: P2 + 'Date[0]', certDateD: P2 + 'undefined_23[0]', certDateY: P2 + 'undefined_24[0]'
  };
  // Treatment-type checkboxes keyed by their semantic field name
  var TREAT_FIELDS = {
    Emergency_Room: P2 + 'Emergency_Room[0]', Doctors_office: P2 + 'Doctors_office[0]',
    ClinicHospitalUrgent_Care: P2 + 'ClinicHospitalUrgent_Care[0]', Hospital_Stay_over_24_hours: P2 + 'Hospital_Stay_over_24_hours[0]',
    none_received: P2 + 'none_received[0]'
  };
  var JOBTIME_FIELDS = { Full_Time: P1 + 'Full_Time[0]', Part_Time: P1 + 'Part_Time[0]', Seasonal: P1 + 'Seasonal[0]', Volunteer: P1 + 'Volunteer[0]', Other: P1 + 'Other[0]' };
  // Generic yes/no checkboxes whose polarity needs a render-confirm pass before we auto-tick.
  var C3_VERIFY_TODO = 'Confirm polarity of generic Check_Box6/7/9/10/12/13/15-35 (yes/no pairs) by render before auto-checking; currently left for the claimant to mark.';

  /* ---- C-3.3 (HIPAA Limited Release) field map — RENDER-CONFIRMED --------
   * c3_3.pdf is pure AcroForm (no XFA), 1 page, 26 fields. The generic
   * Text<N> names were mapped to their labeled boxes by filling each with a
   * marker and visually confirming placement (Preview/pdftoppm) against the
   * real form — every name below === the box it lands in. Kept byte-identical
   * with the web port (ops/website/js/tools/c3-filing-wizard.js). Verified
   * headless by the c3_3 fill harness (26/26 boxes). */
  var C33 = {
    wcb: 'WCB Case Number',                                   // header
    name: 'Text2',                                            // A.1 Name
    ssn1: 'Text3', ssn2: 'Text4', ssn3: 'Text5',             // A.2 SSN (3-2-4)
    mailing: 'Text6',                                         // A.3 Mailing address
    dobM: 'Text7', dobD: 'DOB2', dobY: 'Text9',              // A.4 Date of birth M/D/Y
    injM: 'Text10', injD: 'Text11', injY: 'Text12',          // A.5 Date of current injury M/D/Y
    injury1: 'Text13', injury2: 'Current Injury/Illness',    // A.6 Current injury/illness (2 lines)
    rep1: 'Text15', rep2: 'Text16',                          // A.7 Legal rep name/address (2 lines)
    releaseMH: 'Release mental health care',                  // checkbox (heightened-sensitivity, default OFF)
    prov1Name: 'Text18', prov1Phone: 'Text19', prov1Addr: 'Text20', // B.1/2/3 Provider 1
    prov2Name: 'Text21', prov2Phone: 'Text22', prov2Addr: 'Text26', // B.4/5/6 Provider 2
    certDate: 'Text23',                                       // C. Claimant signature date (ink line is drawn)
    unableName: 'Text24', unableDate: 'Text25'                // unable-to-sign block — N/A in self-file
  };

  /* ---- styles (scoped under .c3w; same tokens/components as .cbi) -------- */
  function ensureStyles() {
    if (document.getElementById('c3w-styles')) return;
    var css = [
      '.c3w{--bg-primary:#0f1117;--bg-card:#1a1d28;--bg-card-hover:#242736;--bg-input:#252836;--border:#2e3145;--text-primary:#e8eaed;--text-secondary:#9ba1b0;--text-muted:#6b7280;--accent:#3b82f6;--accent-hover:#2563eb;--accent-light:rgba(59,130,246,.15);--success:#22c55e;--success-light:rgba(34,197,94,.15);--warning:#f59e0b;--warning-light:rgba(245,158,11,.15);--danger:#ef4444;--danger-light:rgba(239,68,68,.15);--radius:12px;--radius-sm:8px;color:var(--text-primary);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;line-height:1.5}',
      '.c3w *{box-sizing:border-box}',
      '.c3w .c3w-header{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 18px;display:flex;align-items:center;gap:12px;margin-bottom:14px}',
      '.c3w .c3w-header h1{font-size:17px;font-weight:600;margin:0}',
      '.c3w .c3w-badge{margin-left:auto;background:var(--accent-light);color:var(--accent);font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:.5px}',
      '.c3w .progress-container{padding:4px 0 14px}',
      '.c3w .progress-steps{display:flex;align-items:center;justify-content:center;margin-bottom:8px}',
      '.c3w .progress-step{display:flex;align-items:center}',
      '.c3w .step-dot{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid var(--border);color:var(--text-muted);background:var(--bg-primary);transition:all .3s ease;flex-shrink:0}',
      '.c3w .step-dot.active{border-color:var(--accent);color:var(--accent);background:var(--accent-light)}',
      '.c3w .step-dot.completed{border-color:var(--success);color:#fff;background:var(--success)}',
      '.c3w .step-line{width:34px;height:2px;background:var(--border);transition:background .3s ease}',
      '.c3w .step-line.completed{background:var(--success)}',
      '.c3w .progress-label{text-align:center;font-size:12px;color:var(--text-muted)}',
      '.c3w .progress-label span{color:var(--accent);font-weight:600}',
      '.c3w .c3w-body{max-width:600px;margin:0 auto}',
      '.c3w .step-section{display:none}',
      '.c3w .step-section.active{display:block;animation:c3wFade .3s ease}',
      '@keyframes c3wFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
      '.c3w .card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:22px;margin-bottom:16px}',
      '.c3w .card-title{font-size:16px;font-weight:600;margin-bottom:4px}',
      '.c3w .card-subtitle{font-size:13px;color:var(--text-secondary);margin-bottom:18px}',
      '.c3w .step-intro{text-align:center;margin-bottom:22px}',
      '.c3w .step-intro-icon{font-size:30px;margin-bottom:6px}',
      '.c3w .step-intro h2{font-size:20px;font-weight:600;margin:0 0 4px}',
      '.c3w .step-intro p{font-size:14px;color:var(--text-secondary);margin:0}',
      '.c3w .form-group{margin-bottom:18px}',
      '.c3w .form-group:last-child{margin-bottom:0}',
      '.c3w .form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '.c3w .form-label{display:block;font-size:13px;font-weight:500;color:var(--text-secondary);margin-bottom:6px}',
      '.c3w .form-label .req{color:var(--danger);margin-left:2px}',
      '.c3w .form-label .opt{color:var(--text-muted);font-weight:400;font-size:11px;margin-left:4px}',
      '.c3w .form-input{width:100%;padding:12px 14px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:15px;font-family:inherit;transition:border-color .2s ease;-webkit-appearance:none}',
      '.c3w .form-input:focus{outline:none;border-color:var(--accent)}',
      '.c3w .form-input::placeholder{color:var(--text-muted)}',
      '.c3w .form-input.error{border-color:var(--danger)}',
      '.c3w select.form-input{cursor:pointer}',
      '.c3w textarea.form-input{resize:vertical;min-height:80px}',
      '.c3w .form-error{font-size:12px;color:var(--danger);margin-top:4px;display:none}',
      '.c3w .form-error.visible{display:block}',
      '.c3w .form-hint{font-size:12px;color:var(--text-muted);margin-top:4px}',
      // "Filled in from your profile — tap to edit" chip: subtle, tappable (focuses the field).
      '.c3w .prefill-tag{display:inline-block;font-size:10px;font-weight:600;color:var(--accent);background:var(--accent-light);padding:1px 7px;border-radius:10px;margin-left:6px;cursor:pointer;white-space:nowrap;vertical-align:middle;-webkit-user-select:none;user-select:none}',
      '.c3w .prefill-tag:hover{background:rgba(59,130,246,.28)}',
      '.c3w .prefill-tag:focus{outline:2px solid var(--accent);outline-offset:1px}',
      // one plain-language, worker-voice sentence under a field group.
      '.c3w .c3w-helper{font-size:12.5px;color:var(--text-secondary);line-height:1.5;margin:-4px 0 16px}',
      // persistent progress bar + ETA under the step dots.
      '.c3w .c3w-progress-bar{height:6px;background:var(--border);border-radius:999px;overflow:hidden;margin:2px 0 8px}',
      '.c3w .c3w-progress-fill{height:100%;width:0;background:var(--accent);border-radius:999px;transition:width .35s ease}',
      '.c3w .c3w-eta{text-align:center;font-size:11px;color:var(--text-muted);margin-top:2px}',
      // resume banner shown on re-entry when a saved draft exists.
      '.c3w .c3w-resume{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--accent-light);border:1px solid rgba(59,130,246,.35);border-radius:var(--radius);padding:14px 16px;margin-bottom:16px}',
      '.c3w .c3w-resume-icon{font-size:22px;flex-shrink:0}',
      '.c3w .c3w-resume-body{flex:1;min-width:160px}',
      '.c3w .c3w-resume-title{font-size:14px;font-weight:600;color:var(--text-primary)}',
      '.c3w .c3w-resume-sub{font-size:12px;color:var(--text-secondary);margin-top:2px}',
      '.c3w .c3w-resume-actions{display:flex;gap:8px;flex-shrink:0}',
      '.c3w .c3w-resume-actions .btn{flex:0 0 auto;padding:9px 16px;font-size:13px}',
      '.c3w .chip-grid{display:flex;flex-wrap:wrap;gap:8px}',
      '.c3w .chip{padding:8px 14px;background:var(--bg-input);border:1px solid var(--border);border-radius:20px;color:var(--text-secondary);font-size:13px;cursor:pointer;transition:all .2s ease;user-select:none}',
      '.c3w .chip:hover{border-color:var(--accent);color:var(--text-primary)}',
      '.c3w .chip.selected{background:var(--accent-light);border-color:var(--accent);color:var(--accent);font-weight:500}',
      '.c3w .chip-grid.error{outline:1px solid var(--danger);outline-offset:4px;border-radius:var(--radius-sm)}',
      '.c3w .option-group{display:flex;flex-direction:column;gap:10px}',
      '.c3w .option-group.horizontal{flex-direction:row;flex-wrap:wrap}',
      '.c3w .option-card{display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;transition:all .2s ease}',
      '.c3w .option-card.compact{padding:10px 14px;flex:0 0 auto}',
      '.c3w .option-card:hover{border-color:var(--accent)}',
      '.c3w .option-card.selected{border-color:var(--accent);background:var(--accent-light)}',
      '.c3w .option-radio{width:18px;height:18px;border-radius:50%;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s ease}',
      '.c3w .option-card.selected .option-radio{border-color:var(--accent)}',
      '.c3w .option-radio-inner{width:8px;height:8px;border-radius:50%;background:var(--accent);transform:scale(0);transition:transform .2s ease}',
      '.c3w .option-card.selected .option-radio-inner{transform:scale(1)}',
      '.c3w .option-label{font-size:14px;font-weight:500}',
      '.c3w .option-desc{font-size:12px;color:var(--text-muted);margin-top:2px}',
      '.c3w .toggle-row{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm)}',
      '.c3w .toggle-text{font-size:14px;font-weight:500}',
      '.c3w .toggle-text-desc{font-size:12px;color:var(--text-muted);margin-top:2px}',
      '.c3w .toggle-switch{width:44px;height:24px;background:var(--border);border-radius:12px;position:relative;cursor:pointer;transition:background .2s ease;flex-shrink:0}',
      '.c3w .toggle-switch.on{background:var(--accent)}',
      '.c3w .toggle-knob{width:18px;height:18px;background:#fff;border-radius:50%;position:absolute;top:3px;left:3px;transition:transform .2s ease}',
      '.c3w .toggle-switch.on .toggle-knob{transform:translateX(20px)}',
      '.c3w .btn-row{display:flex;gap:12px;margin-top:22px}',
      '.c3w .btn{flex:1;padding:14px 20px;border-radius:var(--radius-sm);font-size:15px;font-weight:600;cursor:pointer;border:none;transition:all .2s ease;font-family:inherit}',
      '.c3w .btn-primary{background:var(--accent);color:#fff}',
      '.c3w .btn-primary:hover{background:var(--accent-hover)}',
      '.c3w .btn-primary:disabled{opacity:.4;cursor:not-allowed}',
      '.c3w .btn-secondary{background:var(--bg-input);border:1px solid var(--border);color:var(--text-secondary)}',
      '.c3w .btn-secondary:hover{border-color:var(--text-muted);color:var(--text-primary)}',
      '.c3w .btn-skip{background:none;border:none;color:var(--text-muted);font-size:13px;cursor:pointer;padding:8px;text-align:center;margin-top:8px;width:100%}',
      '.c3w .btn-skip:hover{color:var(--text-secondary)}',
      '.c3w .review-group{margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)}',
      '.c3w .review-group:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}',
      '.c3w .review-group-title{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}',
      '.c3w .review-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;gap:12px}',
      '.c3w .review-label{font-size:13px;color:var(--text-secondary);flex-shrink:0}',
      '.c3w .review-value{font-size:14px;font-weight:500;text-align:right}',
      '.c3w .review-value.empty{color:var(--text-muted);font-style:italic;font-weight:400}',
      '.c3w .review-edit-btn{background:none;border:none;color:var(--accent);font-size:12px;cursor:pointer;padding:2px 6px;font-family:inherit}',
      '.c3w .info-callout{background:var(--accent-light);border:1px solid rgba(59,130,246,.3);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:16px;font-size:12px;color:var(--text-secondary);line-height:1.6}',
      '.c3w .info-callout strong{color:var(--accent)}',
      '.c3w .c3w-offramp{position:relative}',
      '.c3w .c3w-ad-label{font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px}',
      '.c3w .c3w-ad-disc{font-size:10px;line-height:1.5;color:var(--text-muted);margin:12px 0 0;padding-top:10px;border-top:1px solid var(--border)}',
      '.c3w .c3w-nudge-title{font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:4px}',
      '.c3w .c3w-nudge-sub{font-size:13px;color:var(--text-secondary);margin:0 0 12px;line-height:1.5}',
      '.c3w .c3w-nudge-x{position:absolute;top:8px;right:10px;background:none;border:none;color:var(--text-muted);font-size:16px;cursor:pointer;line-height:1;padding:4px}',
      '.c3w .legal-notice{background:var(--warning-light);border:1px solid rgba(245,158,11,.3);border-radius:var(--radius-sm);padding:14px 16px;margin-bottom:16px}',
      '.c3w .legal-notice-title{font-size:13px;font-weight:600;color:var(--warning);margin-bottom:4px}',
      '.c3w .legal-notice p{font-size:12px;color:var(--text-secondary);line-height:1.6;margin:0}',
      '.c3w .branch-card{display:flex;align-items:flex-start;gap:12px;padding:16px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;margin-bottom:12px;transition:all .2s ease}',
      '.c3w .branch-card:hover{border-color:var(--accent);background:var(--accent-light)}',
      '.c3w .branch-icon{font-size:22px;flex-shrink:0}',
      '.c3w .branch-title{font-size:14px;font-weight:600;margin-bottom:2px}',
      '.c3w .branch-desc{font-size:12px;color:var(--text-secondary)}',
      '.c3w .sig-pad-wrap{position:relative;margin-top:6px}',
      '.c3w .sig-pad{width:100%;height:160px;background:#fff;border:1px solid var(--border);border-radius:var(--radius-sm);touch-action:none;cursor:crosshair;display:block}',
      '.c3w .sig-clear{position:absolute;top:8px;right:8px;background:rgba(0,0,0,.55);color:#fff;border:none;border-radius:6px;font-size:11px;padding:4px 8px;cursor:pointer}',
      '.c3w .success-screen{text-align:center;padding:24px 16px}',
      '.c3w .success-icon{width:72px;height:72px;background:var(--success-light);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:34px;color:var(--success)}',
      '.c3w .success-screen h2{font-size:22px;font-weight:600;margin:0 0 8px}',
      '.c3w .success-screen p{font-size:14px;color:var(--text-secondary);margin:0 0 18px}',
      '.c3w .file-steps{text-align:left;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px 18px;margin-bottom:16px}',
      '.c3w .file-steps h3{font-size:13px;font-weight:600;margin:0 0 10px;color:var(--text-primary)}',
      '.c3w .file-step{display:flex;gap:10px;font-size:13px;color:var(--text-secondary);margin-bottom:10px;line-height:1.5}',
      '.c3w .file-step:last-child{margin-bottom:0}',
      '.c3w .file-step b{color:var(--text-primary)}',
      '.c3w .file-step-num{flex-shrink:0;width:20px;height:20px;border-radius:50%;background:var(--accent-light);color:var(--accent);font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center}',
      '.c3w .disclaimer{text-align:center;font-size:11px;color:var(--text-muted);padding:16px 8px 8px;line-height:1.6}',
      '.c3w .fatal{background:var(--danger-light);border:1px solid var(--danger);border-radius:var(--radius);padding:20px;text-align:center;color:var(--text-primary)}',
      '.c3w .fatal h2{font-size:18px;margin:0 0 8px}',
      '.c3w .fatal p{font-size:13px;color:var(--text-secondary);margin:0 0 14px}',
      '.c3w .c3w-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:520px;width:calc(100% - 32px);background:var(--danger);color:#fff;padding:12px 16px;border-radius:var(--radius-sm);font-size:13px;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,.4)}',
      '.c3w .c3w-toast.ok{background:var(--success)}',
      '@media (max-width:480px){.c3w .form-row{grid-template-columns:1fr}.c3w .step-line{width:20px}.c3w .card{padding:18px}}'
    ].join('\n');
    var s = document.createElement('style'); s.id = 'c3w-styles'; s.textContent = css; document.head.appendChild(s);
  }

  /* ---- small DOM helper (identical to intake) --------------------------- */
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

  /* ---- autosave storage adapter (platform seam) ------------------------- */
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

  /* ---- pdf-lib loader --------------------------------------------------- */
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
  function dateParts(d) { if (!d) return ['', '', '']; var p = d.split('-'); return p.length === 3 ? [p[1], p[2], p[0]] : ['', '', '']; }
  function todayISO() { return new Date().toISOString().split('T')[0]; }
  // Split a phone into [areaCode, rest] for the form's "(___) ______" two-box layout.
  function phoneParts(s) { var d = String(s || '').replace(/[^0-9]/g, ''); if (d.length < 4) return [d, '']; var a = d.slice(0, 3), rest = d.slice(3); if (rest.length === 7) rest = rest.slice(0, 3) + '-' + rest.slice(3); return [a, rest]; }
  // Word-wrap `text` across N lines whose char capacities are given by `caps`
  // (one per line). Any overflow is appended to the final line so nothing is lost.
  function wrapFields(text, caps) {
    var words = String(text || '').trim().split(/\s+/).filter(Boolean), out = [], i = 0;
    for (var c = 0; c < caps.length; c++) {
      var line = '';
      while (i < words.length) { var cand = line ? line + ' ' + words[i] : words[i]; if (line && cand.length > caps[c]) break; line = cand; i++; if (line.length >= caps[c]) break; }
      out.push(line);
    }
    if (i < words.length) out[out.length - 1] = (out[out.length - 1] + ' ' + words.slice(i).join(' ')).trim();
    return out;
  }
  function capWords(s) { return (s || '').split(' ').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' '); }
  // Split a long string across a 2-line form field on a word boundary near n1.
  function wrap2(text, n1) { text = String(text || ''); if (text.length <= n1) return [text, '']; var brk = text.lastIndexOf(' ', n1); if (brk < Math.floor(n1 * 0.5)) brk = n1; return [text.slice(0, brk).trim(), text.slice(brk).trim()]; }
  // Parse the providers textarea (one provider per line, "Name — Address" or "Name, Address") into up to 2 {name,addr}.
  function parseProviders(text) {
    var lines = String(text || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    return lines.slice(0, 2).map(function (l) {
      var m = l.match(/\s[—–-]\s/); var idx = m ? l.indexOf(m[0]) : -1, sep = m ? m[0].length : 0;
      if (idx < 0) { var c = l.indexOf(', '); if (c >= 0) { idx = c; sep = 2; } }
      if (idx >= 0) return { name: l.slice(0, idx).trim(), addr: l.slice(idx + sep).trim() };
      return { name: l, addr: '' };
    });
  }
  function splitName(full) {
    var parts = (full || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { first: '', mi: '', last: '' };
    if (parts.length === 1) return { first: parts[0], mi: '', last: '' };
    if (parts.length === 2) return { first: parts[0], mi: '', last: parts[1] };
    return { first: parts[0], mi: parts[1].charAt(0), last: parts.slice(2).join(' ') };
  }

  /* ======================================================================
   *  render(ctx)
   * ==================================================================== */
  function render(ctx) {
    ctx = ctx || {};
    ensureStyles();
    var root = el('div', { class: 'c3w' });

    var supabase = ctx.supabase;
    var user = ctx.user || (ctx.profile && { id: ctx.profile.id }) || null;
    var profile = ctx.profile || null;
    var isNative = !!ctx.isNative || !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    var store = makeStore(isNative);
    var STORE_KEY = STORAGE_PREFIX + (user && user.id ? user.id : 'anon');

    function toast(msg, type) {
      if (typeof ctx.toast === 'function') { try { ctx.toast(msg, type); return; } catch (e) {} }
      var t = el('div', { class: 'c3w-toast' + (type === 'ok' ? ' ok' : ''), text: msg });
      document.body.appendChild(t);
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 5000);
    }

    // ANONYMOUS mode: no session is fine — the wizard still produces a complete,
    // signed C-3, generated client-side and offered as a local download (no cloud
    // save, since c3-filings storage + rows are owner-scoped). Prefill is simply
    // empty. A SIGNED-IN user with a failed profile read is still a hard error
    // (we won't start their claim blank when we should have had prefill).
    var anon = !user || !user.id;
    if (!supabase) {
      root.appendChild(el('div', { class: 'fatal' }, [
        el('h2', { text: 'Something went wrong' }),
        el('p', { text: 'Please reload and try again.' })
      ]));
      return root;
    }
    if (!anon && !profile) {
      // never silently blank-fill — the whole value of the wizard is the prefill
      root.appendChild(el('div', { class: 'fatal' }, [
        el('h2', { text: 'We couldn’t load your profile' }),
        el('p', { text: 'Your C-3 pre-fills from your Comp Buddy profile, and that read failed. Please reload and try again — we don’t want to start your claim form blank.' }),
        el('button', { class: 'btn btn-primary', style: 'max-width:220px;margin:0 auto', onclick: function () { try { window.location.reload(); } catch (e) {} } }, ['Reload'])
      ]));
      console.error('[C3] PREFILL_NO_PROFILE — refusing to render the wizard without a profile row');
      return root;
    }
    if (!profile) profile = {}; // anonymous: empty prefill, user fills it in
    var signedIn = !anon;       // drives prefill-aware copy (e.g. "From your profile")

    /* ---- working state (prefilled from profile) ------------------------ */
    // City/State/ZIP live in three profile columns; the Comp Buddy intake only
    // captures home_address today, so mailing2 is usually blank until edited.
    var mailingCityLine = [profile.home_city, [profile.home_state, profile.home_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    // Treating-doctor prefill spans two column names: the intake writes the doctor
    // NAME to profiles.treating_doctor, while the older column is treating_doctor_name.
    // Prefer whichever is populated so an intake-entered doctor actually carries over.
    var docName = profile.treating_doctor_name || profile.treating_doctor || '';
    var state = {
      step: 0, branch: '', // '' | 'self' | 'attorney'
      // A. you
      name: profile.full_name || '', dob: profile.dob || '', ssn: '', gender: '',
      mailing: profile.home_address || '', mailing2: mailingCityLine,
      phone: profile.phone || '', translator: '', language: (profile.language_pref && profile.language_pref !== 'en') ? profile.language_pref : '',
      // B. employer
      employer: profile.employer_name || '', employerPhone: '', workAddress: '', supervisor: '', otherEmployers: '',
      // C. job
      jobTitle: OCC_LABELS[profile.occupation] || '', activities: '', jobTime: '', jobOther: '', grossPay: '', payFreq: '',
      // D. injury
      doi: profile.doa || '', timeOfInjury: '', ampm: '', whereHappened: '', whatDoing: '', howHappened: '',
      usualLocation: '', usualLocationWhy: '', dateHired: '',
      bodyParts: Array.isArray(profile.body_parts) ? profile.body_parts.slice() : [], nature: '',
      // page 2: third party / notice / witnesses
      objectInvolved: '', objectWhat: '', motorVehicle: '', vehicleType: '', licensePlate: '', mvCarrier: '',
      gaveNotice: '', noticeMethod: '', noticeTo: '', noticeDate: '',
      witnessed: '', witnessNames: '',
      // E. return to work
      stoppedWork: profile.work_status && profile.work_status !== 'working' ? 'yes' : '', stopWorkDate: '',
      returnedWork: profile.work_status === 'working' ? 'yes' : (profile.work_status === 'light_duty' ? 'yes' : ''),
      returnDuty: profile.work_status === 'light_duty' ? 'limited' : (profile.work_status === 'working' ? 'regular' : ''),
      returnDate: '', returnEmployer: '', grossPay2: '', payFreq2: '',
      // F. medical
      firstTreatDate: '', treatType: '', firstTreatName: '', firstTreatPhone: '',
      stillTreating: '', treatingDoctors: [docName, profile.treating_doctor_address].filter(Boolean).join(', '), treatingDoctorsPhone: profile.treating_doctor_phone || '',
      // F5/F6 prior injury (triggers C-3.3)
      priorInjury: '', priorWorkRelated: '', priorSameEmployer: '', priorTreatedByDoctor: '',
      c33_priorDesc: '', c33_providers: '', c33_releaseMentalHealth: false,
      c33Only: false,                            // standalone HIPAA-release-only flow
      // cert
      certName: profile.full_name || ''
    };
    // Snapshot of the pure profile-prefill baseline, taken BEFORE any saved draft
    // or intake data is merged in. "Start over" on the resume banner reverts to this.
    function cloneState(s) { var o = {}; Object.keys(s).forEach(function (k) { o[k] = Array.isArray(s[k]) ? s[k].slice() : s[k]; }); return o; }
    var BASELINE = cloneState(state);

    /* ---------- attorney off-ramps (3 places; always skippable) --------
     * Each SAVES the draft then opens the in-app lead intake (submit-attorney-lead,
     * source:'app') PRE-FILLED from what's collected. The intake is an overlay on
     * TOP of the wizard, so closing it returns the user to the same step — never
     * blocks the self-file path. Area labelled "Attorney Advertising" + the shared
     * neutral referral disclosure (CD.REFERRAL_DISCLOSURE). */
    function _offRampPrefill() {
      var nm = String(state.name || state.certName || '').trim().split(/\s+/).filter(Boolean);
      var bodies = (state.bodyParts && state.bodyParts.length) ? state.bodyParts.map(function (p) { return BODY_LABELS[p] || p; }).join(', ') : '';
      return {
        doa: state.doi || '', employer: state.employer || '',
        desc: state.howHappened || '', injuries: [state.nature, bodies].filter(Boolean).join(' — '),
        fname: nm[0] || '', lname: nm.length > 1 ? nm.slice(1).join(' ') : '',
        phone: state.phone || '', email: (user && user.email) || (profile && profile.email) || ''
      };
    }
    function openAttorneyOfframp() {
      try { syncFromDom(); } catch (e) {}
      try { persist(); } catch (e) {}                 // never lose progress
      try { if (CD.openAttorneyIntake) CD.openAttorneyIntake(_offRampPrefill()); }
      catch (e) { console.warn('[C3] OFFRAMP_OPEN_FAILED', e); }
    }
    function _attyAdLabel() { return el('div', { class: 'c3w-ad-label', text: 'Attorney Advertising' }); }
    function _attyDisclosure() { return el('p', { class: 'c3w-ad-disc', text: (CD.REFERRAL_DISCLOSURE || '') }); }
    function _preStartGate() {
      // CTAs FIRST (worker can act without scrolling past the notice), warning + disclosure below.
      return el('div', { class: 'card c3w-offramp' }, [
        _attyAdLabel(),
        el('div', { class: 'btn-row' }, [
          el('button', { type: 'button', class: 'btn btn-primary', onclick: function () { openAttorneyOfframp(); } }, ['Talk to an attorney first']),
          el('button', { type: 'button', class: 'btn btn-secondary', onclick: function () { state.branch = 'self'; persist(); goToStep(1); } }, ['Continue on my own'])
        ]),
        el('div', { class: 'legal-notice' }, [
          el('div', { class: 'legal-notice-title', html: '⚖️ Consider an attorney first' }),
          el('p', { text: 'It is strongly advisable to consult a workers’ compensation attorney to make sure your claim is filed correctly. Filing errors can hurt your case.' })
        ]),
        _attyDisclosure()
      ]);
    }
    function _midNudge() {
      var c = el('div', { class: 'card c3w-offramp' });
      var x = el('button', { type: 'button', class: 'c3w-nudge-x', 'aria-label': 'Dismiss', text: '✕' });
      x.addEventListener('click', function () { if (c.parentNode) c.parentNode.removeChild(c); });
      c.appendChild(x);
      c.appendChild(_attyAdLabel());
      c.appendChild(el('div', { class: 'c3w-nudge-title', text: 'Not sure how to answer?' }));
      c.appendChild(el('p', { class: 'c3w-nudge-sub', text: 'A free attorney consult can help you get it right.' }));
      c.appendChild(el('button', { type: 'button', class: 'btn btn-secondary', onclick: function () { openAttorneyOfframp(); } }, ['Talk to an attorney — free']));
      c.appendChild(_attyDisclosure());
      return c;
    }
    function _preExportNudge() {
      return el('div', { class: 'card c3w-offramp' }, [
        _attyAdLabel(),
        el('div', { class: 'c3w-nudge-title', text: 'Want an attorney to review this before you file?' }),
        el('p', { class: 'c3w-nudge-sub', text: 'It’s free — a participating attorney can look it over before you submit.' }),
        el('button', { type: 'button', class: 'btn btn-secondary', onclick: function () { openAttorneyOfframp(); } }, ['Have an attorney review it — free']),
        _attyDisclosure()
      ]);
    }
    var sig = { drawn: false, canvas: null };
    var working = false;

    function $(id) { return root.querySelector('#' + id); }

    /* ---------- header + progress ------------------------------------- */
    root.appendChild(el('div', { class: 'c3w-header' }, [
      el('h1', { text: 'File Your C-3 Claim' }),
      el('span', { class: 'c3w-badge', text: 'Employee Claim' })
    ]));
    var pSteps = el('div', { class: 'progress-steps' });
    for (var i = 1; i <= TOTAL_STEPS; i++) {
      pSteps.appendChild(el('div', { class: 'progress-step' }, [el('div', { class: 'step-dot', id: 'c3w-dot-' + i, text: String(i) })]));
      if (i < TOTAL_STEPS) pSteps.appendChild(el('div', { class: 'step-line', id: 'c3w-line-' + i }));
    }
    var progress = el('div', { class: 'progress-container', id: 'c3w-progress', style: 'display:none' }, [
      pSteps,
      el('div', { class: 'c3w-progress-bar' }, [el('div', { class: 'c3w-progress-fill', id: 'c3w-bar-fill' })]),
      el('div', { class: 'progress-label' }, [
        document.createTextNode('Step '), el('span', { id: 'c3w-step-current', text: '1' }),
        document.createTextNode(' of ' + TOTAL_STEPS + ' — '), el('span', { id: 'c3w-step-name', text: STEP_NAMES[1] })
      ]),
      el('div', { class: 'c3w-eta', id: 'c3w-eta' })
    ]);
    root.appendChild(progress);

    var bodyWrap = el('div', { class: 'c3w-body' });
    root.appendChild(bodyWrap);

    /* ================= STEP 0 — gate & route ========================== */
    var step0 = el('div', { class: 'step-section active', id: 'c3w-step-0' });
    step0.appendChild(el('div', { class: 'step-intro' }, [
      el('div', { class: 'step-intro-icon', text: '📝' }),
      el('h2', { text: 'File your C-3 Employee Claim' }),
      el('p', { text: signedIn
        ? 'We’ll build your signed C-3 from what we already know about your case, then show you exactly how to file it with the WCB.'
        : 'We’ll build your signed C-3 from your answers, then show you exactly how to file it with the WCB. No account needed.' })
    ]));
    var gateCard = el('div', { class: 'card' });
    gateCard.appendChild(el('div', { class: 'legal-notice' }, [
      el('div', { class: 'legal-notice-title', html: '⚠️ Please read' }),
      el('p', { text: DISCLAIMER })
    ]));
    gateCard.appendChild(el('div', { class: 'info-callout', html: '<strong>What this does:</strong> generates a complete, signed C-3 PDF and gives you the fastest way to file it yourself. <strong>What it does not do:</strong> we do not electronically submit it to the WCB for you — electronic filing isn’t available yet, so you’ll file the PDF we create.' }));
    step0.appendChild(gateCard);

    var hasAtty = !!profile.has_attorney;
    if (hasAtty) {
      var branchCard = el('div', { class: 'card' }, [
        el('div', { class: 'card-title', text: 'You told us you have an attorney' }),
        el('div', { class: 'card-subtitle', text: 'Your attorney may prefer to file this for you. How would you like to proceed?' })
      ]);
      branchCard.appendChild(el('div', { class: 'branch-card', onclick: function () { state.branch = 'attorney'; persist(); goToStep(1); } }, [
        el('div', { class: 'branch-icon', text: '⚖️' }),
        el('div', null, [el('div', { class: 'branch-title', text: 'Prepare it and send to my attorney' }), el('div', { class: 'branch-desc', text: 'We’ll build the C-3, then give you the PDF and your attorney’s email so you can send it to them.' })])
      ]));
      branchCard.appendChild(el('div', { class: 'branch-card', onclick: function () { state.branch = 'self'; persist(); goToStep(1); } }, [
        el('div', { class: 'branch-icon', text: '🙋' }),
        el('div', null, [el('div', { class: 'branch-title', text: 'File it myself' }), el('div', { class: 'branch-desc', text: 'Build the C-3 and file it with the WCB on your own.' })])
      ]));
      step0.appendChild(branchCard);
    } else {
      // (a) PRE-START off-ramp gate — replaces the plain "Get Started" button.
      step0.appendChild(_preStartGate());
    }
    // Standalone HIPAA-release entry — the C-3.3 is its own authorization and can
    // be needed even when you're not filing a fresh C-3 right now.
    step0.appendChild(el('div', { class: 'info-callout', style: 'margin-top:16px', html: 'Just need the medical-records release? <a href="#" id="c3w-c33-only-link" style="color:var(--accent);font-weight:700">Complete Form C-3.3 (HIPAA) on its own →</a><br><span style="color:var(--text-muted)">The C-3.3 authorizes the doctors who treated a previous injury to release those records to the insurer. File it with your C-3, or by itself.</span>' }));
    bodyWrap.appendChild(step0);

    /* ================= STEP 1 — You & Your Job (A + C) ================ */
    var step1 = el('div', { class: 'step-section', id: 'c3w-step-1' });
    step1.appendChild(stepIntro('👤', 'You & Your Job', 'Confirm your details — we’ve pre-filled what we know.'));
    var c1 = card('About You', 'From your profile. Edit anything that’s changed.');
    c1.appendChild(helper('Double-check the basics — we filled in what we already had. If anything looks off, just tap the box and fix it.'));
    c1.appendChild(fieldRow([
      textField('c3w-name', 'Full Legal Name', 'req', state.name, 'First MI Last', !!state.name),
      dateField('c3w-dob', 'Date of Birth', 'req', state.dob, !!state.dob)
    ]));
    c1.appendChild(fieldRow([
      textField('c3w-ssn', 'Social Security Number', 'opt', state.ssn, 'XXX-XX-XXXX', false),
      selectField('c3w-gender', 'Gender', 'req', [['', 'Select…'], ['M', 'Male'], ['F', 'Female']], state.gender)
    ]));
    c1.appendChild(el('div', { class: 'form-hint', style: 'margin-top:-10px', text: 'SSN is voluntary on the C-3 — you may leave it blank. We never store it; it only goes onto the form you download.' }));
    c1.appendChild(group([el('label', { class: 'form-label', html: 'Mailing Address<span class="req">*</span>' + prefillTag(!!state.mailing) }), el('input', { type: 'text', class: 'form-input', id: 'c3w-mailing', value: state.mailing, placeholder: 'Number and street' }), errEl('c3w-err-mailing', 'Your mailing address is required')]));
    c1.appendChild(fieldRow([
      textField('c3w-mailing2', 'City, State, ZIP', 'opt', state.mailing2, 'City, NY 10001', !!state.mailing2),
      textField('c3w-phone', 'Phone', 'req', state.phone, '(212) 555-1234', !!state.phone)
    ]));
    var transWrap = optionRow('c3w-translator', 'Need a translator at a Board hearing?', [['no', 'No'], ['yes', 'Yes']], state.translator, function (v) {
      state.translator = v; $('c3w-lang-wrap').style.display = v === 'yes' ? 'block' : 'none'; persist();
    });
    c1.appendChild(group([el('label', { class: 'form-label', text: 'Translator at a Hearing?' }), transWrap]));
    c1.appendChild(el('div', { id: 'c3w-lang-wrap', style: state.translator === 'yes' ? 'display:block' : 'display:none' }, [
      group([el('label', { class: 'form-label', text: 'What language?' }), el('input', { type: 'text', class: 'form-input', id: 'c3w-language', value: state.language, placeholder: 'e.g. Spanish' })])
    ]));
    step1.appendChild(c1);

    var c1b = card('Your Job', 'On the date of your injury or illness.');
    c1b.appendChild(helper('Tell us about the job you were doing when you got hurt. Your pay here helps set your ', gloss('AWW'), ' — the weekly wage your benefit checks are based on.'));
    c1b.appendChild(group([el('label', { class: 'form-label', html: 'Job Title or Description<span class="req">*</span>' + prefillTag(!!state.jobTitle) }), el('input', { type: 'text', class: 'form-input', id: 'c3w-jobTitle', value: state.jobTitle, placeholder: 'e.g. Warehouse associate' }), errEl('c3w-err-jobTitle', 'Your job title is required')]));
    c1b.appendChild(group([el('label', { class: 'form-label', html: 'What did you normally do at work?<span class="opt">(optional)</span>' }), el('textarea', { class: 'form-input', id: 'c3w-activities', placeholder: 'Day-to-day duties' }, [state.activities])]));
    var jobTimeGroup = optionRow('c3w-jobTime', 'Was your job?', JOB_TIME.map(function (j) { return [j[0], j[1]]; }), state.jobTime, function (v) { state.jobTime = v; $('c3w-jobOther-wrap').style.display = v === 'Other' ? 'block' : 'none'; persist(); });
    c1b.appendChild(group([el('label', { class: 'form-label', text: 'Employment Type' }), jobTimeGroup]));
    c1b.appendChild(el('div', { id: 'c3w-jobOther-wrap', style: state.jobTime === 'Other' ? 'display:block' : 'display:none' }, [group([el('label', { class: 'form-label', text: 'Describe (Other)' }), el('input', { type: 'text', class: 'form-input', id: 'c3w-jobOther', value: state.jobOther })])]));
    c1b.appendChild(fieldRow([
      textField('c3w-grossPay', 'Gross Pay per Pay Period', 'opt', state.grossPay, '$0.00', false),
      textField('c3w-payFreq', 'How Often Paid?', 'opt', state.payFreq, 'e.g. Weekly', false)
    ]));
    step1.appendChild(c1b);
    step1.appendChild(navRow(0, function () { validateAndNext(1); }));
    bodyWrap.appendChild(step1);

    /* ================= STEP 2 — The Injury (D) ======================== */
    var step2 = el('div', { class: 'step-section', id: 'c3w-step-2' });
    step2.appendChild(stepIntro('🩹', 'The Injury', 'Tell us exactly what happened — this is the heart of your claim.'));
    step2.appendChild(_midNudge()); // (b) dismissible mid-wizard soft nudge
    var c2 = card('When & Where');
    c2.appendChild(helper('Tell us when and where it happened. The date of injury (your ', gloss('DOI'), ') is the day you got hurt, or the day you first noticed a work-related illness.'));
    c2.appendChild(fieldRow([
      dateField('c3w-doi', 'Date of Injury / Onset', 'req', state.doi, !!state.doi),
      textField('c3w-timeOfInjury', 'Time of Injury', 'opt', state.timeOfInjury, 'e.g. 2:30', false)
    ]));
    c2.appendChild(group([el('label', { class: 'form-label', text: 'AM or PM?' }), optionRow('c3w-ampm', '', [['AM', 'AM'], ['PM', 'PM']], state.ampm, function (v) { state.ampm = v; persist(); })]));
    c2.appendChild(group([el('label', { class: 'form-label', html: 'Where did it happen?<span class="req">*</span>' }), el('input', { type: 'text', class: 'form-input', id: 'c3w-whereHappened', value: state.whereHappened, placeholder: 'e.g. 1 Main Street, Pottersville, at the loading dock' }), errEl('c3w-err-whereHappened', 'Tell us where the injury happened')]));
    c2.appendChild(group([el('label', { class: 'form-label', text: 'Was this your usual work location?' }), optionRow('c3w-usualLocation', '', [['yes', 'Yes'], ['no', 'No']], state.usualLocation, function (v) { state.usualLocation = v; $('c3w-usualloc-detail').style.display = v === 'no' ? 'block' : 'none'; persist(); })]));
    c2.appendChild(el('div', { id: 'c3w-usualloc-detail', style: state.usualLocation === 'no' ? 'display:block' : 'display:none' }, [group([el('label', { class: 'form-label', text: 'If no, why were you at this location?' }), el('input', { type: 'text', class: 'form-input', id: 'c3w-usualLocationWhy', value: state.usualLocationWhy })])]));
    step2.appendChild(c2);

    var c2b = card('What Happened');
    c2b.appendChild(helper('Describe it like you’d tell a friend — what you were doing, and how you got hurt. Everyday words are perfect.'));
    c2b.appendChild(group([el('label', { class: 'form-label', html: 'What were you doing when injured?<span class="req">*</span>' }), el('textarea', { class: 'form-input', id: 'c3w-whatDoing', placeholder: 'e.g. unloading a truck, typing a report' }, [state.whatDoing]), errEl('c3w-err-whatDoing', 'Describe what you were doing')]));
    c2b.appendChild(group([el('label', { class: 'form-label', html: 'How did the injury/illness happen?<span class="req">*</span>' }), el('textarea', { class: 'form-input', id: 'c3w-howHappened', placeholder: 'e.g. I tripped over a pipe and fell on the floor' }, [state.howHappened]), errEl('c3w-err-howHappened', 'Describe how it happened')]));
    step2.appendChild(c2b);

    var c2c = card('Injured Body Parts', 'We pre-checked the parts from your profile. Add the nature of the injury.');
    c2c.appendChild(helper('Tap every part of your body that was hurt — you can pick more than one.'));
    var chipGrid = el('div', { class: 'chip-grid', id: 'c3w-body-grid' });
    BODY_PARTS.forEach(function (bp) {
      var chip = el('div', { class: 'chip' + (state.bodyParts.indexOf(bp[0]) >= 0 ? ' selected' : ''), 'data-part': bp[0], text: bp[1] });
      chip.addEventListener('click', function () {
        chip.classList.toggle('selected');
        if (chip.classList.contains('selected')) { if (state.bodyParts.indexOf(bp[0]) < 0) state.bodyParts.push(bp[0]); }
        else state.bodyParts = state.bodyParts.filter(function (x) { return x !== bp[0]; });
        chipGrid.classList.remove('error'); clearError('body'); persist();
      });
      chipGrid.appendChild(chip);
    });
    c2c.appendChild(group([el('label', { class: 'form-label', html: 'Body Parts Affected<span class="req">*</span>' }), chipGrid, errEl('c3w-err-body', 'Select at least one body part')]));
    c2c.appendChild(group([el('label', { class: 'form-label', html: 'Explain the nature of the injury<span class="req">*</span>' }), el('textarea', { class: 'form-input', id: 'c3w-nature', placeholder: 'e.g. twisted left ankle and cut to forehead' }, [state.nature]), errEl('c3w-err-nature', 'Describe the nature of your injury')]));
    step2.appendChild(c2c);
    step2.appendChild(navRow(1, function () { validateAndNext(2); }));
    bodyWrap.appendChild(step2);

    /* ================= STEP 3 — Employer & Notice (B + notice) ======== */
    var step3 = el('div', { class: 'step-section', id: 'c3w-step-3' });
    step3.appendChild(stepIntro('🏢', 'Employer & Notice', 'Your employer, and whether you reported the injury.'));
    var c3a = card('Your Employer');
    c3a.appendChild(helper('This is the company you worked for when you got hurt — the one your claim is filed against.'));
    c3a.appendChild(group([el('label', { class: 'form-label', html: 'Employer When Injured<span class="req">*</span>' + prefillTag(!!state.employer) }), el('input', { type: 'text', class: 'form-input', id: 'c3w-employer', value: state.employer, placeholder: 'Company name' }), errEl('c3w-err-employer', 'Employer name is required')]));
    c3a.appendChild(fieldRow([
      textField('c3w-employerPhone', 'Employer Phone', 'opt', state.employerPhone, '(212) 555-1234', false),
      textField('c3w-supervisor', 'Supervisor’s Name', 'opt', state.supervisor, '', false)
    ]));
    c3a.appendChild(fieldRow([dateField('c3w-dateHired', 'Date You Were Hired', 'opt', state.dateHired, false), null]));
    c3a.appendChild(group([el('label', { class: 'form-label', html: 'Your Work Address<span class="opt">(optional)</span>' }), el('input', { type: 'text', class: 'form-input', id: 'c3w-workAddress', value: state.workAddress, placeholder: 'Where you worked' })]));
    c3a.appendChild(group([el('label', { class: 'form-label', html: 'Other Employers at the Time<span class="opt">(optional)</span>' }), el('textarea', { class: 'form-input', id: 'c3w-otherEmployers', placeholder: 'Names/addresses of any other employers' }, [state.otherEmployers])]));
    step3.appendChild(c3a);

    var c3b = card('Notice & Witnesses');
    c3b.appendChild(helper('Telling your boss you were hurt matters. The ', gloss('WCB'), ' wants to know who you told, and when.'));
    c3b.appendChild(group([el('label', { class: 'form-label', text: 'Did you tell your employer/supervisor?' }), optionRow('c3w-gaveNotice', '', [['yes', 'Yes'], ['no', 'No']], state.gaveNotice, function (v) { state.gaveNotice = v; $('c3w-notice-detail').style.display = v === 'yes' ? 'block' : 'none'; persist(); })]));
    c3b.appendChild(el('div', { id: 'c3w-notice-detail', style: state.gaveNotice === 'yes' ? 'display:block' : 'display:none' }, [
      group([el('label', { class: 'form-label', text: 'How?' }), optionRow('c3w-noticeMethod', '', [['orally', 'Orally'], ['in_writing', 'In writing']], state.noticeMethod, function (v) { state.noticeMethod = v; persist(); })]),
      fieldRow([textField('c3w-noticeTo', 'Given to whom?', 'opt', state.noticeTo, 'Name', false), dateField('c3w-noticeDate', 'Date notice given', 'opt', state.noticeDate, false)])
    ]));
    c3b.appendChild(group([el('label', { class: 'form-label', text: 'Did anyone witness it?' }), optionRow('c3w-witnessed', '', [['no', 'No'], ['yes', 'Yes']], state.witnessed, function (v) { state.witnessed = v; $('c3w-witness-detail').style.display = v === 'yes' ? 'block' : 'none'; persist(); })]));
    c3b.appendChild(el('div', { id: 'c3w-witness-detail', style: state.witnessed === 'yes' ? 'display:block' : 'display:none' }, [
      group([el('label', { class: 'form-label', text: 'Witness name(s)' }), el('input', { type: 'text', class: 'form-input', id: 'c3w-witnessNames', value: state.witnessNames })])
    ]));
    step3.appendChild(c3b);

    var c3c = card('Was a Vehicle or Object Involved?', 'Optional — only if relevant.');
    c3c.appendChild(helper('Only fill this in if a vehicle or piece of equipment was part of what happened. Otherwise, skip it.'));
    c3c.appendChild(group([el('label', { class: 'form-label', text: 'Was an object (forklift, tool, etc.) involved?' }), optionRow('c3w-objectInvolved', '', [['no', 'No'], ['yes', 'Yes']], state.objectInvolved, function (v) { state.objectInvolved = v; $('c3w-object-detail').style.display = v === 'yes' ? 'block' : 'none'; persist(); })]));
    c3c.appendChild(el('div', { id: 'c3w-object-detail', style: state.objectInvolved === 'yes' ? 'display:block' : 'display:none' }, [group([el('label', { class: 'form-label', text: 'What object?' }), el('input', { type: 'text', class: 'form-input', id: 'c3w-objectWhat', value: state.objectWhat })])]));
    c3c.appendChild(group([el('label', { class: 'form-label', text: 'Was a licensed motor vehicle involved?' }), optionRow('c3w-motorVehicle', '', [['no', 'No'], ['yes', 'Yes']], state.motorVehicle, function (v) { state.motorVehicle = v; $('c3w-mv-detail').style.display = v === 'yes' ? 'block' : 'none'; persist(); })]));
    c3c.appendChild(el('div', { id: 'c3w-mv-detail', style: state.motorVehicle === 'yes' ? 'display:block' : 'display:none' }, [
      group([el('label', { class: 'form-label', text: 'Whose vehicle?' }), optionRow('c3w-vehicleType', '', [['your_vehicle', 'Yours'], ['employers_vehicle', 'Employer’s'], ['other_vehicle', 'Other']], state.vehicleType, function (v) { state.vehicleType = v; persist(); })]),
      fieldRow([textField('c3w-licensePlate', 'License Plate', 'opt', state.licensePlate, '', false), textField('c3w-mvCarrier', 'Your Auto Insurance Carrier', 'opt', state.mvCarrier, 'Name & address', false)])
    ]));
    step3.appendChild(c3c);
    step3.appendChild(navRow(2, function () { validateAndNext(3); }));
    bodyWrap.appendChild(step3);

    /* ================= STEP 4 — Medical & Work (F + E + C-3.3) ======== */
    var step4 = el('div', { class: 'step-section', id: 'c3w-step-4' });
    step4.appendChild(stepIntro('🩺', 'Medical & Work Status', 'Your treatment and whether you’ve been back to work.'));
    var c4a = card('Medical Treatment');
    c4a.appendChild(helper('List the doctors treating you for this injury. If the insurer later sends you to an ', gloss('IME'), ', that’s a different exam — this is about your own care.'));
    c4a.appendChild(fieldRow([
      dateField('c3w-firstTreatDate', 'Date of First Treatment', 'opt', state.firstTreatDate, false),
      selectField('c3w-treatType', 'Where first treated?', 'opt', [['', 'Select…']].concat(TREAT_TYPE), state.treatType)
    ]));
    c4a.appendChild(fieldRow([
      textField('c3w-firstTreatName', 'Name & address where first treated', 'opt', state.firstTreatName, '', false),
      textField('c3w-firstTreatPhone', 'Their phone', 'opt', state.firstTreatPhone, '(212) 555-1234', false)
    ]));
    c4a.appendChild(group([el('label', { class: 'form-label', html: 'Doctor(s) currently treating you<span class="opt">(optional)</span>' + prefillTag(!!state.treatingDoctors) }), el('input', { type: 'text', class: 'form-input', id: 'c3w-treatingDoctors', value: state.treatingDoctors, placeholder: 'Name & address' })]));
    step4.appendChild(c4a);

    var c4b = card('Return to Work');
    c4b.appendChild(helper('Let us know if you stopped working or went back. Light duty still counts as going back.'));
    c4b.appendChild(group([el('label', { class: 'form-label', html: 'Did you stop work because of the injury?' + prefillTag(!!state.stoppedWork) }), optionRow('c3w-stoppedWork', '', [['yes', 'Yes'], ['no', 'No']], state.stoppedWork, function (v) { state.stoppedWork = v; $('c3w-stop-detail').style.display = v === 'yes' ? 'block' : 'none'; persist(); })]));
    c4b.appendChild(el('div', { id: 'c3w-stop-detail', style: state.stoppedWork === 'yes' ? 'display:block' : 'display:none' }, [group([el('label', { class: 'form-label', text: 'On what date?' }), dateInput('c3w-stopWorkDate', state.stopWorkDate)])]));
    c4b.appendChild(group([el('label', { class: 'form-label', html: 'Have you returned to work?' + prefillTag(!!state.returnedWork) }), optionRow('c3w-returnedWork', '', [['no', 'No'], ['yes', 'Yes']], state.returnedWork, function (v) { state.returnedWork = v; $('c3w-return-detail').style.display = v === 'yes' ? 'block' : 'none'; persist(); })]));
    c4b.appendChild(el('div', { id: 'c3w-return-detail', style: state.returnedWork === 'yes' ? 'display:block' : 'display:none' }, [
      fieldRow([dateField('c3w-returnDate', 'Return date', 'opt', state.returnDate, false), null]),
      group([el('label', { class: 'form-label', text: 'Duty type' }), optionRow('c3w-returnDuty', '', [['regular', 'Regular duty'], ['limited', 'Limited duty']], state.returnDuty, function (v) { state.returnDuty = v; persist(); })]),
      group([el('label', { class: 'form-label', text: 'Returned with which employer?' }), optionRow('c3w-returnEmployer', '', [['same', 'Same employer'], ['new', 'New employer'], ['self', 'Self-employed']], state.returnEmployer, function (v) { state.returnEmployer = v; persist(); })]),
      fieldRow([
        textField('c3w-grossPay2', 'Current gross pay per pay period', 'opt', state.grossPay2, 'e.g. $800', false),
        textField('c3w-payFreq2', 'How often paid now?', 'opt', state.payFreq2, 'e.g. Weekly', false)
      ])
    ]));
    step4.appendChild(c4b);

    var c4c = card('Prior Injury', 'If you injured this same body part before, NY requires a short HIPAA release (Form C-3.3).');
    c4c.appendChild(helper('If you hurt this same body part before, New York needs a short release — the ', gloss('C-3.3'), '. We’ll build it for you automatically.'));
    c4c.appendChild(group([el('label', { class: 'form-label', text: 'Have you had another injury to the same body part, or a similar illness?' }), optionRow('c3w-priorInjury', '', [['no', 'No'], ['yes', 'Yes']], state.priorInjury, function (v) { state.priorInjury = v; $('c3w-c33-detail').style.display = v === 'yes' ? 'block' : 'none'; persist(); })]));
    var c33Detail = el('div', { id: 'c3w-c33-detail', style: state.priorInjury === 'yes' ? 'display:block' : 'display:none' });
    c33Detail.appendChild(el('div', { class: 'info-callout', html: '<strong>We’ll generate Form C-3.3 too.</strong> It authorizes the doctors who treated your previous injury to release those records to the insurer. File it together with your C-3.' }));
    c33Detail.appendChild(group([el('label', { class: 'form-label', text: 'Describe the previous injury/illness' }), el('textarea', { class: 'form-input', id: 'c3w-c33-priorDesc', placeholder: 'What happened, and when' }, [state.c33_priorDesc])]));
    c33Detail.appendChild(group([el('label', { class: 'form-label', text: 'Doctor(s) who treated the previous injury (name & address)' }), el('textarea', { class: 'form-input', id: 'c3w-c33-providers', placeholder: 'One per line' }, [state.c33_providers])]));
    var mhToggle = el('div', { class: 'toggle-switch' + (state.c33_releaseMentalHealth ? ' on' : ''), id: 'c3w-mh-toggle' }, [el('div', { class: 'toggle-knob' })]);
    mhToggle.addEventListener('click', function () { mhToggle.classList.toggle('on'); state.c33_releaseMentalHealth = mhToggle.classList.contains('on'); persist(); });
    c33Detail.appendChild(el('div', { class: 'toggle-row' }, [
      el('div', null, [el('div', { class: 'toggle-text', text: 'Also release mental health records' }), el('div', { class: 'toggle-text-desc', text: 'Optional and extra-sensitive — only turn this on if you intend to authorize mental health record release. Off by default.' })]),
      mhToggle
    ]));
    c4c.appendChild(c33Detail);
    step4.appendChild(c4c);
    step4.appendChild(navRow(3, function () { validateAndNext(4); }));
    bodyWrap.appendChild(step4);

    /* ================= STEP 5 — Review & Sign ========================= */
    var step5 = el('div', { class: 'step-section', id: 'c3w-step-5' });
    step5.appendChild(stepIntro('✅', 'Review & Sign', 'Check your answers, then certify and sign.'));
    var revCard = card('Review', 'Tap “Edit” to change a section.');
    revCard.appendChild(helper('Read it over. Tap “Edit” on any section to fix it before you sign.'));
    revCard.appendChild(reviewGroup('You & Job', 1, [['Name', 'c3w-rev-name'], ['DOB', 'c3w-rev-dob'], ['Job', 'c3w-rev-job']]));
    revCard.appendChild(reviewGroup('Injury', 2, [['Date', 'c3w-rev-doi'], ['Where', 'c3w-rev-where'], ['Body Parts', 'c3w-rev-body']]));
    revCard.appendChild(reviewGroup('Employer', 3, [['Employer', 'c3w-rev-employer'], ['Gave Notice', 'c3w-rev-notice']]));
    revCard.appendChild(reviewGroup('Medical & Work', 4, [['Treating Dr', 'c3w-rev-doctor'], ['Returned to Work', 'c3w-rev-return'], ['Prior Injury (C-3.3)', 'c3w-rev-prior']]));
    step5.appendChild(revCard);

    var certCard = card('Certify & Sign');
    certCard.appendChild(helper('Your ', gloss('C-3'), ' is a sworn legal form. Only sign once everything above is true and complete.'));
    certCard.appendChild(el('div', { class: 'legal-notice' }, [
      el('div', { class: 'legal-notice-title', html: '⚠️ Certification' }),
      el('p', { text: 'I am making a claim for benefits under the Workers’ Compensation Law. My signature affirms that the information I am providing is true and accurate to the best of my knowledge and belief. Any person who knowingly and with intent to defraud presents false information may be guilty of a crime subject to fines and imprisonment.' })
    ]));
    certCard.appendChild(group([el('label', { class: 'form-label', text: 'Type your full legal name to certify' }), el('input', { type: 'text', class: 'form-input', id: 'c3w-certName', value: state.certName, placeholder: 'Your full legal name' })]));
    var sigCanvas = el('canvas', { class: 'sig-pad', id: 'c3w-sig' });
    certCard.appendChild(group([el('label', { class: 'form-label', text: 'Draw your signature' }), el('div', { class: 'sig-pad-wrap' }, [sigCanvas, el('button', { class: 'sig-clear', type: 'button', onclick: function () { clearSig(); } }, ['Clear'])])]));
    var certToggle = el('div', { class: 'toggle-switch', id: 'c3w-cert-toggle' }, [el('div', { class: 'toggle-knob' })]);
    var certAgreed = { v: false };
    certToggle.addEventListener('click', function () { certToggle.classList.toggle('on'); certAgreed.v = certToggle.classList.contains('on'); });
    certCard.appendChild(el('div', { class: 'toggle-row' }, [el('div', null, [el('div', { class: 'toggle-text', text: 'I certify the above is true' })]), certToggle]));
    step5.appendChild(certCard);

    step5.appendChild(_preExportNudge()); // (c) pre-export off-ramp, above the export button

    step5.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-secondary', onclick: function () { goToStep(4); } }, ['Back']),
      el('button', { class: 'btn btn-primary', id: 'c3w-generate', onclick: function () { beforeExport(certAgreed.v); } }, ['Generate & File My C-3'])
    ]));
    bodyWrap.appendChild(step5);

    /* ============ STANDALONE C-3.3 (HIPAA release on its own) ========= */
    var certAgreedC33 = { v: false };
    var stepC33 = el('div', { class: 'step-section', id: 'c3w-step-c33' });
    stepC33.appendChild(stepIntro('🔏', 'Medical Records Release (C-3.3)', 'Authorize the doctors who treated a previous injury to release those records to the insurer. You can file this with — or independently of — your C-3.'));
    stepC33.appendChild(el('div', { class: 'legal-notice' }, [
      el('div', { class: 'legal-notice-title', html: '⚠️ Please read' }),
      el('p', { text: DISCLAIMER })
    ]));
    var sc1 = card('Your Information', signedIn ? 'From your profile. Edit anything that’s changed.' : 'Who the release is for.');
    sc1.appendChild(helper('This ', gloss('C-3.3'), ' release only covers records from a doctor who treated an earlier injury to the same body part.'));
    sc1.appendChild(fieldRow([
      textField('c3w-c33s-name', 'Full Legal Name', 'req', state.name, 'First MI Last', !!state.name),
      dateField('c3w-c33s-dob', 'Date of Birth', 'req', state.dob, !!state.dob)
    ]));
    sc1.appendChild(fieldRow([
      textField('c3w-c33s-ssn', 'Social Security Number', 'opt', state.ssn, 'XXX-XX-XXXX', false),
      dateField('c3w-c33s-doi', 'Date of Current Injury/Illness', 'opt', state.doi, !!state.doi)
    ]));
    sc1.appendChild(group([el('label', { class: 'form-label', html: 'Mailing Address<span class="opt">(optional)</span>' + prefillTag(!!state.mailing) }), el('input', { type: 'text', class: 'form-input', id: 'c3w-c33s-mailing', value: state.mailing, placeholder: 'Number and street' })]));
    sc1.appendChild(group([el('label', { class: 'form-label', html: 'City, State, ZIP<span class="opt">(optional)</span>' }), el('input', { type: 'text', class: 'form-input', id: 'c3w-c33s-mailing2', value: state.mailing2, placeholder: 'City, NY 10001' })]));
    sc1.appendChild(group([el('label', { class: 'form-label', html: 'Current injury/illness (all body parts)<span class="req">*</span>' }), el('textarea', { class: 'form-input', id: 'c3w-c33s-injury', placeholder: 'e.g. lower back and left hip' }, [state.nature]), errEl('c3w-err-c33s-injury', 'Describe your current injury/illness')]));
    stepC33.appendChild(sc1);

    var sc2 = card('Previous Treating Providers', 'List the doctors who treated your PREVIOUS injury to the same body part (the records being released). One per line — “Name — Address”.');
    sc2.appendChild(group([el('label', { class: 'form-label', html: 'Provider(s) (name &amp; address)<span class="req">*</span>' }), el('textarea', { class: 'form-input', id: 'c3w-c33s-providers', placeholder: 'Dr. Jane Smith — 1 Main St, Albany NY 12203\nUrgent Care — 9 Market St, Troy NY 12180' }, [state.c33_providers]), errEl('c3w-err-c33s-providers', 'List at least one provider')]));
    var mhToggleS = el('div', { class: 'toggle-switch' + (state.c33_releaseMentalHealth ? ' on' : ''), id: 'c3w-c33s-mh-toggle' }, [el('div', { class: 'toggle-knob' })]);
    mhToggleS.addEventListener('click', function () { mhToggleS.classList.toggle('on'); state.c33_releaseMentalHealth = mhToggleS.classList.contains('on'); persist(); });
    sc2.appendChild(el('div', { class: 'toggle-row' }, [
      el('div', null, [el('div', { class: 'toggle-text', text: 'Also release mental health records' }), el('div', { class: 'toggle-text-desc', text: 'Optional and extra-sensitive — only turn this on if you intend to authorize mental health record release. Off by default.' })]),
      mhToggleS
    ]));
    stepC33.appendChild(sc2);

    var sc3 = card('Certify & Sign');
    sc3.appendChild(el('div', { class: 'legal-notice' }, [
      el('div', { class: 'legal-notice-title', html: '⚠️ Authorization' }),
      el('p', { text: 'I request that the health care provider(s) listed above give my employer’s workers’ compensation insurer copies of all health records related to any previous injury/illness, to all body parts described above. My signature affirms this authorization is voluntary and accurate.' })
    ]));
    sc3.appendChild(group([el('label', { class: 'form-label', text: 'Type your full legal name to certify' }), el('input', { type: 'text', class: 'form-input', id: 'c3w-c33s-certName', value: state.certName, placeholder: 'Your full legal name' })]));
    var sigCanvasC33 = el('canvas', { class: 'sig-pad', id: 'c3w-sig-c33' });
    sc3.appendChild(group([el('label', { class: 'form-label', text: 'Draw your signature' }), el('div', { class: 'sig-pad-wrap' }, [sigCanvasC33, el('button', { class: 'sig-clear', type: 'button', onclick: function () { clearSig(); } }, ['Clear'])])]));
    var certToggleC33 = el('div', { class: 'toggle-switch', id: 'c3w-c33s-cert-toggle' }, [el('div', { class: 'toggle-knob' })]);
    certToggleC33.addEventListener('click', function () { certToggleC33.classList.toggle('on'); certAgreedC33.v = certToggleC33.classList.contains('on'); });
    sc3.appendChild(el('div', { class: 'toggle-row' }, [el('div', null, [el('div', { class: 'toggle-text', text: 'I certify this authorization is true' })]), certToggleC33]));
    stepC33.appendChild(sc3);
    stepC33.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-secondary', onclick: function () { state.c33Only = false; persist(); goToStep(0); } }, ['Back']),
      el('button', { class: 'btn btn-primary', id: 'c3w-c33-generate', onclick: function () { beforeExport(certAgreedC33.v); } }, ['Generate Form C-3.3'])
    ]));
    bodyWrap.appendChild(stepC33);

    /* ================= SUCCESS ======================================== */
    var stepSuccess = el('div', { class: 'step-section', id: 'c3w-step-success' });
    bodyWrap.appendChild(stepSuccess);

    root.appendChild(el('div', { class: 'disclaimer', html: 'This tool is for informational purposes only and does not constitute legal advice.<br>The Comp Desk &copy; 2026' }));

    /* ---------- component builders (local) ---------------------------- */
    function stepIntro(icon, h, p) { return el('div', { class: 'step-intro' }, [el('div', { class: 'step-intro-icon', text: icon }), el('h2', { text: h }), el('p', { text: p })]); }
    function card(title, sub) { var c = el('div', { class: 'card' }, [el('div', { class: 'card-title', text: title })]); if (sub) c.appendChild(el('div', { class: 'card-subtitle', text: sub })); return c; }
    function group(children) { return el('div', { class: 'form-group' }, children); }
    function fieldRow(cells) { return el('div', { class: 'form-group' }, [el('div', { class: 'form-row' }, cells.map(function (c) { return c || el('div'); }))]); }
    function errEl(id, msg) { return el('div', { class: 'form-error', id: id, text: msg }); }
    // Subtle, tappable "we filled this in" chip. Tapping it focuses the field so
    // the worker can correct it (handled by the delegated click handler below).
    function prefillTag(on) { return on ? '<span class="prefill-tag" role="button" tabindex="0" title="Filled in from your profile — tap to edit">From your profile · Edit</span>' : ''; }
    // one plain-language, worker-voice line under a field group. `parts` is an
    // array of strings and/or DOM nodes (e.g. CD.Glossary.term('AWW')).
    function helper() { var parts = Array.prototype.slice.call(arguments); return el('div', { class: 'c3w-helper' }, parts); }
    // a tappable glossary acronym (falls back to plain text if CD.Glossary absent).
    function gloss(abbr, label) { return (CD.Glossary && CD.Glossary.term) ? CD.Glossary.term(abbr, label) : el('span', { text: label || abbr }); }
    function labelHtml(label, mode) { return label + (mode === 'req' ? '<span class="req">*</span>' : (mode === 'opt' ? '<span class="opt">(optional)</span>' : '')); }
    function textField(id, label, mode, val, ph, pre) { return el('div', null, [el('label', { class: 'form-label', html: labelHtml(label, mode) + prefillTag(pre) }), el('input', { type: 'text', class: 'form-input', id: id, value: val || '', placeholder: ph || '' }), errEl('c3w-err-' + id.replace('c3w-', ''), label + ' is required')]); }
    function dateInput(id, val) { var n = el('input', { type: 'date', class: 'form-input', id: id, max: todayISO() }); if (val) n.value = val; return n; }
    function dateField(id, label, mode, val, pre) { return el('div', null, [el('label', { class: 'form-label', html: labelHtml(label, mode) + prefillTag(pre) }), dateInput(id, val), errEl('c3w-err-' + id.replace('c3w-', ''), label + ' is required')]); }
    function selectField(id, label, mode, opts, val) { var s = el('select', { class: 'form-input', id: id }); opts.forEach(function (o) { var op = el('option', { value: o[0], text: o[1] }); if (o[0] === val) op.selected = true; s.appendChild(op); }); return el('div', null, [el('label', { class: 'form-label', html: labelHtml(label, mode) }), s]); }
    function optionRow(id, label, opts, val, onpick) {
      var grp = el('div', { class: 'option-group horizontal', id: id });
      opts.forEach(function (o) {
        var c = el('div', { class: 'option-card compact' + (o[0] === val ? ' selected' : ''), 'data-value': o[0] }, [el('div', { class: 'option-radio' }, [el('div', { class: 'option-radio-inner' })]), el('div', { class: 'option-label', text: o[1] })]);
        c.addEventListener('click', function () { grp.querySelectorAll('.option-card').forEach(function (x) { x.classList.remove('selected'); }); c.classList.add('selected'); onpick(o[0]); });
        grp.appendChild(c);
      });
      return grp;
    }
    function reviewGroup(title, step, rows) {
      var g = el('div', { class: 'review-group' }, [el('div', { class: 'review-group-title' }, [document.createTextNode(title), el('button', { class: 'review-edit-btn', onclick: function () { goToStep(step); } }, ['Edit'])])]);
      rows.forEach(function (r) { g.appendChild(el('div', { class: 'review-row' }, [el('span', { class: 'review-label', text: r[0] }), el('span', { class: 'review-value', id: r[1], text: '—' })])); });
      return g;
    }
    function navRow(backStep, nextFn) {
      return el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn btn-secondary', onclick: function () { goToStep(backStep); } }, ['Back']),
        el('button', { class: 'btn btn-primary', onclick: nextFn }, ['Continue'])
      ]);
    }

    /* ---------- field <-> state plumbing ------------------------------ */
    var TEXT_FIELDS = [
      ['c3w-name', 'name'], ['c3w-dob', 'dob'], ['c3w-ssn', 'ssn'], ['c3w-mailing', 'mailing'], ['c3w-mailing2', 'mailing2'],
      ['c3w-phone', 'phone'], ['c3w-language', 'language'], ['c3w-jobTitle', 'jobTitle'], ['c3w-activities', 'activities'],
      ['c3w-jobOther', 'jobOther'], ['c3w-grossPay', 'grossPay'], ['c3w-payFreq', 'payFreq'], ['c3w-doi', 'doi'],
      ['c3w-timeOfInjury', 'timeOfInjury'], ['c3w-whereHappened', 'whereHappened'], ['c3w-whatDoing', 'whatDoing'],
      ['c3w-howHappened', 'howHappened'], ['c3w-nature', 'nature'], ['c3w-employer', 'employer'], ['c3w-employerPhone', 'employerPhone'],
      ['c3w-supervisor', 'supervisor'], ['c3w-workAddress', 'workAddress'], ['c3w-otherEmployers', 'otherEmployers'],
      ['c3w-dateHired', 'dateHired'], ['c3w-usualLocationWhy', 'usualLocationWhy'],
      ['c3w-noticeTo', 'noticeTo'], ['c3w-noticeDate', 'noticeDate'], ['c3w-witnessNames', 'witnessNames'],
      ['c3w-objectWhat', 'objectWhat'], ['c3w-licensePlate', 'licensePlate'], ['c3w-mvCarrier', 'mvCarrier'],
      ['c3w-stopWorkDate', 'stopWorkDate'], ['c3w-returnDate', 'returnDate'], ['c3w-grossPay2', 'grossPay2'], ['c3w-payFreq2', 'payFreq2'],
      ['c3w-firstTreatDate', 'firstTreatDate'], ['c3w-firstTreatPhone', 'firstTreatPhone'],
      ['c3w-treatType', 'treatType'], ['c3w-firstTreatName', 'firstTreatName'], ['c3w-treatingDoctors', 'treatingDoctors'],
      ['c3w-c33-priorDesc', 'c33_priorDesc'], ['c3w-c33-providers', 'c33_providers'], ['c3w-certName', 'certName']
    ];
    var SENSITIVE = { ssn: 1 }; // never persisted to the draft store
    function syncFromDom() {
      if (state.c33Only) { syncC33(); return; }   // standalone fields only — don't clobber blank C-3 inputs
      TEXT_FIELDS.forEach(function (f) { var n = $(f[0]); if (n) { var v = n.value; state[f[1]] = (/dob|doi|Date/.test(f[1])) ? v : v; } });
      var g = $('c3w-gender'); if (g) state.gender = g.value;
    }
    // Standalone C-3.3 inputs → shared state keys (own ids so they don't collide with the C-3 flow).
    var C33_FIELDS = [['c3w-c33s-name', 'name'], ['c3w-c33s-dob', 'dob'], ['c3w-c33s-ssn', 'ssn'], ['c3w-c33s-doi', 'doi'], ['c3w-c33s-mailing', 'mailing'], ['c3w-c33s-mailing2', 'mailing2'], ['c3w-c33s-injury', 'nature'], ['c3w-c33s-providers', 'c33_providers'], ['c3w-c33s-certName', 'certName']];
    function syncC33() { C33_FIELDS.forEach(function (f) { var n = $(f[0]); if (n) state[f[1]] = n.value; }); }
    root.addEventListener('blur', function (e) { if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { syncFromDom(); persist(); } }, true);
    root.addEventListener('change', function (e) { if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { syncFromDom(); persist(); } });
    // "tap to edit": tapping a prefill chip focuses (and selects) the field it labels.
    function focusFieldFor(chip) {
      var lbl = chip.closest ? chip.closest('label') : null;
      var wrap = lbl ? lbl.parentNode : (chip.parentNode);
      var inp = wrap && wrap.querySelector ? wrap.querySelector('input,select,textarea') : null;
      if (inp) { try { inp.focus(); if (inp.select) inp.select(); } catch (x) {} }
    }
    root.addEventListener('click', function (e) {
      var chip = e.target && e.target.closest ? e.target.closest('.prefill-tag') : null;
      if (chip) { e.preventDefault(); focusFieldFor(chip); }
    });
    root.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.classList && e.target.classList.contains('prefill-tag')) { e.preventDefault(); focusFieldFor(e.target); }
    });
    // Add a prefill chip to a field's label after the fact (used when the Comp
    // Buddy intake hydrates a field that the profile left blank). Marked dynamic
    // so "Start over" can strip these while leaving the baked-in profile chips.
    function markPrefilled(inputId) {
      var inp = $(inputId); if (!inp) return;
      var wrap = inp.parentNode; var lbl = wrap && wrap.querySelector ? wrap.querySelector('label') : null; if (!lbl) return;
      if (lbl.querySelector('.prefill-tag')) return;
      var s = el('span', { class: 'prefill-tag c3w-chip-dyn', role: 'button', tabindex: '0', title: 'Filled in from your profile — tap to edit', text: 'From your profile · Edit' });
      lbl.appendChild(s);
    }

    /* ---------- validation -------------------------------------------- */
    function showError(id) { var e = $('c3w-err-' + id); if (e) e.classList.add('visible'); }
    function clearError(id) { var e = $('c3w-err-' + id); if (e) e.classList.remove('visible'); }
    function validateAndNext(step) {
      syncFromDom(); var ok = true;
      function req(stKey, errId) { if (!state[stKey] || !String(state[stKey]).trim()) { showError(errId); ok = false; } else clearError(errId); }
      if (step === 1) { req('name', 'name'); req('mailing', 'mailing'); req('phone', 'phone'); req('jobTitle', 'jobTitle'); if (!state.dob) { showError('dob'); ok = false; } else clearError('dob'); if (!state.gender) { ok = false; toast('Please select gender (required on the C-3).'); } }
      else if (step === 2) { if (!state.doi) { showError('doi'); ok = false; } else clearError('doi'); req('whereHappened', 'whereHappened'); req('whatDoing', 'whatDoing'); req('howHappened', 'howHappened'); req('nature', 'nature'); if (state.bodyParts.length === 0) { showError('body'); $('c3w-body-grid').classList.add('error'); ok = false; } else clearError('body'); }
      else if (step === 3) { req('employer', 'employer'); }
      // step 4 has no hard requirements
      if (ok) goToStep(step + 1);
    }

    /* ---------- navigation -------------------------------------------- */
    // Honest "about N min left": sum of the current step through the last step.
    function etaRemaining(n) { var m = 0; for (var i = Math.max(1, n); i <= TOTAL_STEPS; i++) m += (STEP_MIN[i] || 2); return m; }
    function goToStep(n) {
      try {
        syncFromDom(); state.step = n; persist();
        progress.style.display = n >= 1 ? 'block' : 'none';
        root.querySelectorAll('.step-section').forEach(function (s) { s.classList.remove('active'); });
        var sec = $('c3w-step-' + n); if (sec) sec.classList.add('active');
        for (var i = 1; i <= TOTAL_STEPS; i++) {
          var dot = $('c3w-dot-' + i); if (dot) { dot.className = 'step-dot'; if (i < n) dot.classList.add('completed'); else if (i === n) dot.classList.add('active'); }
          if (i < TOTAL_STEPS) { var line = $('c3w-line-' + i); if (line) { line.className = 'step-line'; if (i < n) line.classList.add('completed'); } }
        }
        var sc = $('c3w-step-current'); if (sc) sc.textContent = String(n);
        var sn = $('c3w-step-name'); if (sn) sn.textContent = STEP_NAMES[n] || '';
        var fill = $('c3w-bar-fill'); if (fill) fill.style.width = Math.round((Math.min(n, TOTAL_STEPS) / TOTAL_STEPS) * 100) + '%';
        var eta = $('c3w-eta'); if (eta) eta.textContent = (n >= 1 && n <= TOTAL_STEPS) ? ('about ' + etaRemaining(n) + ' min left') : '';
        if (n === 5) populateReview();
      } catch (e) {
        console.error('[C3] STEP_TOGGLE_FAILED', e);
      }
      // FAIL-SAFE: never leave the wizard with nothing visible. If the toggle above
      // threw (or somehow left no section active), fall back to Step 1 so the
      // claimant always sees a usable form rather than a blank screen.
      if (!root.querySelector('.step-section.active')) {
        var fb = $('c3w-step-1') || $('c3w-step-0');
        if (fb) { fb.classList.add('active'); progress.style.display = 'block'; }
      }
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
    }
    // Route into the standalone HIPAA-release-only flow (no numbered stepper).
    function goToStandaloneC33() {
      state.c33Only = true; persist();
      progress.style.display = 'none';
      root.querySelectorAll('.step-section').forEach(function (s) { s.classList.remove('active'); });
      var sec = $('c3w-step-c33'); if (sec) sec.classList.add('active');
      clearSig(); initSig(sigCanvasC33);
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
    }

    /* ---------- review ------------------------------------------------ */
    function setRev(id, val) { var e = $(id); if (!e) return; if (val) { e.textContent = val; e.classList.remove('empty'); } else { e.textContent = 'Not provided'; e.classList.add('empty'); } }
    function populateReview() {
      setRev('c3w-rev-name', state.name); setRev('c3w-rev-dob', fmtDate(state.dob)); setRev('c3w-rev-job', state.jobTitle);
      setRev('c3w-rev-doi', fmtDate(state.doi)); setRev('c3w-rev-where', state.whereHappened);
      setRev('c3w-rev-body', state.bodyParts.length ? state.bodyParts.map(function (p) { return BODY_LABELS[p] || capWords(p); }).join(', ') : '');
      setRev('c3w-rev-employer', state.employer); setRev('c3w-rev-notice', state.gaveNotice === 'yes' ? 'Yes' : (state.gaveNotice === 'no' ? 'No' : ''));
      setRev('c3w-rev-doctor', state.treatingDoctors); setRev('c3w-rev-return', state.returnedWork === 'yes' ? ('Yes' + (state.returnDuty ? ' — ' + state.returnDuty : '')) : (state.returnedWork === 'no' ? 'No' : ''));
      setRev('c3w-rev-prior', state.priorInjury === 'yes' ? 'Yes — C-3.3 included' : (state.priorInjury === 'no' ? 'No' : ''));
    }

    /* ---------- signature canvas -------------------------------------- */
    function initSig(canvas) {
      canvas = canvas || sigCanvas;
      function resize() {
        var rect = canvas.getBoundingClientRect(); var dpr = window.devicePixelRatio || 1; if (!rect.width) return;
        canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
        var c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.lineWidth = 2; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#0f1117';
      }
      resize();
      if (canvas.__sigInit) return; canvas.__sigInit = true;  // bind pointer handlers once
      var drawing = false, last = null;
      function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
      canvas.addEventListener('pointerdown', function (e) { drawing = true; last = pos(e); sig.drawn = true; sig.canvas = canvas; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); });
      canvas.addEventListener('pointermove', function (e) { if (!drawing) return; var p = pos(e), c = canvas.getContext('2d'); c.beginPath(); c.moveTo(last.x, last.y); c.lineTo(p.x, p.y); c.stroke(); last = p; e.preventDefault(); });
      function end() { drawing = false; last = null; }
      canvas.addEventListener('pointerup', end); canvas.addEventListener('pointerleave', end); canvas.addEventListener('pointercancel', end);
    }
    function clearSig() { if (!sig.canvas) return; var c = sig.canvas.getContext('2d'); c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, sig.canvas.width, sig.canvas.height); c.restore(); sig.drawn = false; }

    /* ================================================================
     * PDF fill (OC-400 pattern: AcroForm fill-by-name + de-XFA on save)
     * ============================================================== */
    function loadTemplate(PDFDocument, bucketFile, bundledPath) {
      // The official WCB C-3 is a large, digitally-CERTIFIED PDF. pdf-lib's default
      // load() hangs on it (the cert/encryption dict + slow stream parse); the
      // OC-400/OC-110a templates aren't signed so they never hit this. ignoreEncryption
      // + Fastest parse loads it in ~140ms. (The C-3.3 is plain and loads either way.)
      var LOAD_OPTS = { ignoreEncryption: true, throwOnInvalidObject: false, parseSpeed: (window.PDFLib && window.PDFLib.ParseSpeeds) ? window.PDFLib.ParseSpeeds.Fastest : 1500 };
      return supabase.storage.from('c3-template').download(bucketFile)
        .then(function (res) { return (res && res.data && !res.error) ? res.data.arrayBuffer() : null; })
        .catch(function () { return null; })
        .then(function (bytes) {
          if (bytes) return PDFDocument.load(bytes, LOAD_OPTS);
          // dev/pre-bucket fallback: the bundled blank form
          return fetch(bundledPath).then(function (r) { if (!r.ok) throw new Error('C-3 template not found in Storage or bundle'); return r.arrayBuffer(); }).then(function (b) { return PDFDocument.load(b, LOAD_OPTS); });
        });
    }
    function deXFA(pdf) {
      // Strip the XFA packet so XFA-aware viewers (Adobe) render the filled
      // AcroForm instead of an empty dynamic form. Also force appearance regen.
      try {
        var acro = pdf.catalog.lookup(window.PDFLib.PDFName.of('AcroForm'));
        if (acro) { acro.delete(window.PDFLib.PDFName.of('XFA')); acro.set(window.PDFLib.PDFName.of('NeedAppearances'), window.PDFLib.PDFBool.True); }
      } catch (e) { console.warn('[C3] DEXFA_SKIPPED', e); }
    }
    function fillC3(PDFLib) {
      var PDFDocument = PDFLib.PDFDocument;
      return loadTemplate(PDFDocument, 'template.pdf', 'forms/c3.pdf').then(function (pdf) {
        var form = pdf.getForm();
        function setT(name, v) { try { if (v != null && v !== '') form.getTextField(name).setText(String(v)); } catch (e) {} }
        function setC(name) { try { form.getCheckBox(name).check(); } catch (e) {} }
        function setSz(name, sz) { try { form.getTextField(name).setFontSize(sz); } catch (e) {} }
        // Spread long text across the form's existing continuation-line fields so it
        // uses every ruled line instead of clipping in the first (stub) box.
        function setMulti(names, widths, text) { if (!text) return; var caps = widths.map(function (w) { return Math.max(6, Math.floor(w / 5)); }); var parts = wrapFields(text, caps); for (var k = 0; k < names.length; k++) { setT(names[k], parts[k] || ''); setSz(names[k], 9); } }
        var dobP = dateParts(state.dob), doiP = dateParts(state.doi);
        // A. you
        setT(F.wcb, profile.wcb_case_number || '');
        setT(F.name, state.name);
        setT(F.dobM, dobP[0]); setT(F.dobD, dobP[1]); setT(F.dobY, dobP[2]);
        setT(F.mailing, [state.mailing, state.mailing2].filter(Boolean).join(' '));
        setT(F.ssn, state.ssn);
        var phP = phoneParts(state.phone); setT(F.phone, phP[0]); setT(F.phone2, phP[1]);
        if (state.gender === 'M') setC(F.genderM); else if (state.gender === 'F') setC(F.genderF);
        if (state.translator === 'yes') { setC(F.translatorY); setT(F.language, state.language); } else if (state.translator === 'no') setC(F.translatorN);
        // B. employer
        setT(F.employer, state.employer); var ephP = phoneParts(state.employerPhone); setT(F.employerPhone, ephP[0]); setT(F.employerPhone2, ephP[1]);
        setT(F.workAddress, state.workAddress); setT(F.supervisor, state.supervisor); setT(F.otherEmployers, state.otherEmployers);
        var dhP = dateParts(state.dateHired); setT(F.dateHiredM, dhP[0]); setT(F.dateHiredD, dhP[1]); setT(F.dateHiredY, dhP[2]);
        // C. job
        setT(F.jobTitle, state.jobTitle); setT(F.activities, state.activities);
        if (state.jobTime && JOBTIME_FIELDS[state.jobTime]) setC(JOBTIME_FIELDS[state.jobTime]);
        if (state.jobTime === 'Other') setT(F.jobOtherText, state.jobOther);
        setT(F.grossPay, state.grossPay); setT(F.payFreq, state.payFreq);
        // D. injury
        setT(F.doiM, doiP[0]); setT(F.doiD, doiP[1]); setT(F.doiY, doiP[2]);
        setT(F.timeOfInjury, state.timeOfInjury); if (state.ampm === 'AM') setC(F.am); else if (state.ampm === 'PM') setC(F.pm);
        setMulti([F.whereHappened, F.whereHappened2], [190, 506], state.whereHappened);
        if (state.usualLocation === 'yes') setC(F.usualLocYes);
        else if (state.usualLocation === 'no') { setC(F.usualLocNo); setT(F.usualLocWhy, state.usualLocationWhy); }
        setMulti([F.whatDoing, F.whatDoing2], [141, 503], state.whatDoing);
        setMulti([F.howHappened, F.howHappened2, F.howHappened3], [204, 506, 506], state.howHappened);
        var natureText = state.nature + (state.bodyParts.length ? ('  [Body parts: ' + state.bodyParts.map(function (p) { return BODY_LABELS[p] || p; }).join(', ') + ']') : '');
        setMulti([F.nature, F.nature2, F.nature3], [100, 506, 506], natureText);
        // Page 2 header
        setT(F.nameP2, state.name); setT(F.doiP2M, doiP[0]); setT(F.doiP2D, doiP[1]); setT(F.doiP2Y, doiP[2]);
        // third party
        if (state.objectInvolved === 'yes') setT(F.objectWhat, state.objectWhat);
        if (state.motorVehicle === 'yes') { if (state.vehicleType === 'your_vehicle') setC(F.yourVehicle); else if (state.vehicleType === 'employers_vehicle') setC(F.employersVehicle); else if (state.vehicleType === 'other_vehicle') setC(F.otherVehicle); setT(F.licensePlate, state.licensePlate); setT(F.mvCarrier1, state.mvCarrier); }
        // notice
        if (state.gaveNotice === 'yes') {
          setC(F.gaveNoticeYes);
          setT(F.noticeTo, state.noticeTo);
          if (state.noticeMethod === 'orally') setC(F.orally); else if (state.noticeMethod === 'in_writing') setC(F.inWriting);
          var ndP = dateParts(state.noticeDate); setT(F.noticeDateM, ndP[0]); setT(F.noticeDateD, ndP[1]); setT(F.noticeDateY, ndP[2]);
        } else if (state.gaveNotice === 'no') setC(F.gaveNoticeNo);
        if (state.witnessed === 'yes') setT(F.witnessNames, state.witnessNames);
        // E. return to work
        if (state.stoppedWork === 'yes') { setC(F.stoppedYes); var swP = dateParts(state.stopWorkDate); setT(F.stopWorkDate, swP[0]); setT(F.stopWorkD, swP[1]); setT(F.stopWorkY, swP[2]); }
        else if (state.stoppedWork === 'no') setC(F.stoppedNo);
        if (state.returnedWork === 'yes') {
          setC(F.returnedYes);
          var rdP = dateParts(state.returnDate); setT(F.returnedDate, rdP[0]); setT(F.returnedD, rdP[1]); setT(F.returnedY, rdP[2]);
          if (state.returnDuty === 'regular') setC(F.regularDuty); else if (state.returnDuty === 'limited') setC(F.limitedDuty);
          if (state.returnEmployer === 'same') setC(F.sameEmployer); else if (state.returnEmployer === 'new') setC(F.newEmployer); else if (state.returnEmployer === 'self') setC(F.selfEmployed);
          setT(F.grossPay2, state.grossPay2); setT(F.payFreq2, state.payFreq2);
        } else if (state.returnedWork === 'no') setC(F.returnedNo);
        // F. medical
        var ftP = dateParts(state.firstTreatDate); setT(F.firstTreatDate, ftP[0]); setT(F.firstTreatD, ftP[1]); setT(F.firstTreatY, ftP[2]);
        if (state.treatType && TREAT_FIELDS[state.treatType]) setC(TREAT_FIELDS[state.treatType]);
        if (state.treatType === 'none_received') setC(F.noneReceived);
        setT(F.firstTreatName1, state.firstTreatName); setT(F.firstTreatPhone, state.firstTreatPhone);
        setT(F.treatingDoctors1, state.treatingDoctors); setT(F.treatingDoctorsPhone, state.treatingDoctorsPhone);
        // Prior injury (F4) — mark Yes/No on the C-3 itself and describe it across
        // the three "complete & file Form C-3.3 together" lines. The separate
        // C-3.3 is still generated + bundled (see generate()); this makes the C-3
        // self-reference it instead of leaving the block blank.
        if (state.priorInjury === 'yes') {
          setC(F.priorYes);
          var pw = String(state.c33_priorDesc || '').trim();
          if (pw) { var l1 = wrap2(pw, 64), rest = wrap2(l1[1], 64); setT(F.c33Together1, l1[0]); setT(F.c33Together2, rest[0]); setT(F.c33Together3, rest[1]); }
        } else if (state.priorInjury === 'no') setC(F.priorNo);
        // certification
        setT(F.printName, state.certName || state.name);
        var cdP = dateParts(todayISO()); setT(F.certDate, cdP[0]); setT(F.certDateD, cdP[1]); setT(F.certDateY, cdP[2]);
        // Shrink every narrow date/phone box so the year (or area code) can't clip.
        ['dobM', 'dobD', 'dobY', 'dateHiredM', 'dateHiredD', 'dateHiredY', 'doiM', 'doiD', 'doiY', 'doiP2M', 'doiP2D', 'doiP2Y', 'noticeDateM', 'noticeDateD', 'noticeDateY', 'stopWorkDate', 'stopWorkD', 'stopWorkY', 'returnedDate', 'returnedD', 'returnedY', 'firstTreatDate', 'firstTreatD', 'firstTreatY', 'certDate', 'certDateD', 'certDateY', 'phone', 'phone2', 'employerPhone', 'employerPhone2'].forEach(function (k) { setSz(F[k], 9); });
        // signature image on page 2 (no AcroForm field for the ink line)
        return embedSig(pdf, PDFLib).then(function () { deXFA(pdf); return pdf.save(); });
      });
    }
    function embedSig(pdf, PDFLib) {
      if (!sig.drawn || !sig.canvas) return Promise.resolve();
      try {
        var dataUrl = sig.canvas.toDataURL('image/png');
        return pdf.embedPng(dataUrl).then(function (png) {
          var pages = pdf.getPages(); var page2 = pages[1]; if (!page2) return;
          // EMPLOYEE'S Signature line — same row as the employee "Date" box (y≈129),
          // to the right of the "Employee's Signature:" label. (NOT the attorney row
          // lower down.) Render-verified 2026-06-25.
          var w = 150, h = Math.min(w * (png.height / png.width), 22);
          page2.drawImage(png, { x: 150, y: 132, width: w, height: h });
        });
      } catch (e) { console.warn('[C3] SIG_EMBED_SKIPPED', e); return Promise.resolve(); }
    }
    // C-3.3 ink line sits in section C near the bottom of the single page
    // (y≈112 from the render-confirm pass), left of the date field (Text23 @ x441).
    function embedSigC33(pdf, PDFLib) {
      if (!sig.drawn || !sig.canvas) return Promise.resolve();
      try {
        var dataUrl = sig.canvas.toDataURL('image/png');
        return pdf.embedPng(dataUrl).then(function (png) {
          var page = pdf.getPages()[0]; if (!page) return;
          var w = 200, h = Math.min(w * (png.height / png.width), 22);
          page.drawImage(png, { x: 80, y: 104, width: w, height: h });
        });
      } catch (e) { console.warn('[C3] C33_SIG_SKIPPED', e); return Promise.resolve(); }
    }
    // C-3.3 is plain AcroForm (no XFA to strip) but still set NeedAppearances so
    // viewers regenerate field appearances from our values.
    function setNeedAppearances(pdf) {
      try { var acro = pdf.catalog.lookup(window.PDFLib.PDFName.of('AcroForm')); if (acro) acro.set(window.PDFLib.PDFName.of('NeedAppearances'), window.PDFLib.PDFBool.True); }
      catch (e) { console.warn('[C3] C33_NEEDAPP_SKIPPED', e); }
    }
    function fillC33(PDFLib) {
      var PDFDocument = PDFLib.PDFDocument;
      return loadTemplate(PDFDocument, 'c33-template.pdf', 'forms/c3_3.pdf').then(function (pdf) {
        var form = pdf.getForm();
        function setT(name, v) { try { if (v != null && v !== '') form.getTextField(name).setText(String(v)); } catch (e) {} }
        function setC(name) { try { form.getCheckBox(name).check(); } catch (e) {} }
        var dobP = dateParts(state.dob), injP = dateParts(state.doi);
        // A. Claimant identity
        setT(C33.wcb, profile.wcb_case_number || '');
        setT(C33.name, state.name || state.certName);
        var ssn = (state.ssn || '').replace(/[^0-9]/g, '');
        if (ssn.length >= 9) { setT(C33.ssn1, ssn.slice(0, 3)); setT(C33.ssn2, ssn.slice(3, 5)); setT(C33.ssn3, ssn.slice(5, 9)); }
        setT(C33.mailing, [state.mailing, state.mailing2].filter(Boolean).join(', '));
        setT(C33.dobM, dobP[0]); setT(C33.dobD, dobP[1]); setT(C33.dobY, dobP[2]);
        setT(C33.injM, injP[0]); setT(C33.injD, injP[1]); setT(C33.injY, injP[2]);
        var injuryDesc = state.nature || state.bodyParts.map(function (p) { return BODY_LABELS[p] || p; }).join(', ');
        var iw = wrap2(injuryDesc, 46); setT(C33.injury1, iw[0]); setT(C33.injury2, iw[1]);
        // A.7 legal representative — only when represented and proceeding via the attorney path
        if (profile.has_attorney && profile.attorney_name) {
          var rw = wrap2(profile.attorney_name + (profile.attorney_phone ? ' — ' + profile.attorney_phone : ''), 48);
          setT(C33.rep1, rw[0]); setT(C33.rep2, rw[1]);
        }
        // B. Previous treating providers (records being released)
        var provText = state.c33_providers || [profile.treating_doctor_name, profile.treating_doctor_address].filter(Boolean).join(' — ');
        var provs = parseProviders(provText);
        if (provs[0]) { setT(C33.prov1Name, provs[0].name); setT(C33.prov1Addr, provs[0].addr); }
        if (provs[1]) { setT(C33.prov2Name, provs[1].name); setT(C33.prov2Addr, provs[1].addr); }
        // Heightened-sensitivity opt-in — default OFF; only when explicitly toggled on
        if (state.c33_releaseMentalHealth) setC(C33.releaseMH);
        // C. Certification date (ink signature drawn separately)
        setT(C33.certDate, fmtDate(todayISO()));
        return embedSigC33(pdf, PDFLib).then(function () { setNeedAppearances(pdf); return pdf.save(); });
      }).catch(function (e) { console.warn('[C3] C33_FILL_FAILED', e); return null; });
    }

    /* ---------- submission seam (C3Submitter) ------------------------- */
    function SelfFilePackage(api) { this.api = api; }
    // Uploads whichever forms were generated (C-3 and/or C-3.3) and writes one
    // low-PHI c3_filings row pointing at both — so a single filing surfaces both
    // PDFs in the claimant's Documents. C-3.3-only filings persist with a null
    // storage_path (C-3 absent) and a populated c33_path.
    SelfFilePackage.prototype.submit = function (pdfBytes, c33Bytes) {
      var api = this.api, uid = user.id, ts = Date.now();
      var c3path = pdfBytes ? (uid + '/' + ts + '.pdf') : null;
      var first = c3path
        ? api.storage.from('c3-filings').upload(c3path, new Blob([pdfBytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false }).then(function (up) { if (up && up.error) throw up.error; })
        : Promise.resolve();
      return first
        .then(function () {
          if (!c33Bytes) return null;
          var c33path = uid + '/' + ts + '_c33.pdf';
          return api.storage.from('c3-filings').upload(c33path, new Blob([c33Bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false })
            .then(function (up2) { if (up2 && up2.error) throw up2.error; return c33path; });
        })
        .then(function (c33path) {
          var row = { user_id: uid, status: 'generated', storage_path: c3path ? ('c3-filings/' + c3path) : null, c33_path: c33path ? ('c3-filings/' + c33path) : null, wcb_case_number: profile.wcb_case_number || null, has_attorney: !!profile.has_attorney, generated_at: new Date().toISOString() };
          return api.from('c3_filings').insert(row).then(function (res) { if (res && res.error) throw res.error; return { kind: 'self_file', path: c3path, c33path: c33path }; });
        })
        .then(function (out) {
          // mint short-TTL signed URLs for immediate download (only for present forms)
          var p = out.path
            ? api.storage.from('c3-filings').createSignedUrl(out.path, 3600).then(function (s) { out.signedUrl = (s && s.data && s.data.signedUrl) || null; })
            : Promise.resolve();
          return p.then(function () {
            if (!out.c33path) return out;
            return api.storage.from('c3-filings').createSignedUrl(out.c33path, 3600).then(function (s2) { out.c33SignedUrl = (s2 && s2.data && s2.data.signedUrl) || null; return out; });
          });
        });
    };
    function ECaseSubmit() {}
    ECaseSubmit.prototype.submit = function () { return Promise.reject(new Error('eCase electronic submission is not yet available (WCB data partnership pending).')); };

    // Anonymous path: c3-filings storage + c3_filings rows are owner-scoped and
    // need a session, so for guests we skip the cloud save entirely and hand back
    // object-URL download links. The success screen's download buttons consume
    // result.signedUrl / result.c33SignedUrl exactly the same as the signed-in
    // path, so the rest of the flow is unchanged.
    function LocalDownloadPackage() {}
    LocalDownloadPackage.prototype.submit = function (pdfBytes, c33Bytes) {
      var out = { kind: 'self_file', path: null, c33path: null };
      try {
        if (pdfBytes) { out.signedUrl = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' })); out.path = 'local'; }
        if (c33Bytes) { out.c33SignedUrl = URL.createObjectURL(new Blob([c33Bytes], { type: 'application/pdf' })); out.c33path = 'local'; }
      } catch (e) { return Promise.reject(e); }
      return Promise.resolve(out);
    };

    /* ---------- generate (build + sign + package) --------------------- */
    // Shared pre-export validation — used by both the account-offer gate and
    // generate() so the two never drift. Returns false (with a toast) if the
    // certify toggle, typed name, signature, or C-3.3-only fields are missing.
    function validateForExport(certAgreed) {
      var c33Only = !!state.c33Only;
      var formLabel = c33Only ? 'C-3.3' : 'C-3';
      if (!certAgreed) { toast('Please toggle “I certify the above is true” before signing.'); return false; }
      if (!state.certName || !state.certName.trim()) { toast('Type your full legal name to certify.'); return false; }
      if (!sig.drawn) { toast('Please draw your signature to sign the ' + formLabel + '.'); return false; }
      if (c33Only) {
        if (!state.name || !state.name.trim()) { showError('c33s-name'); toast('Your full legal name is required.'); return false; }
        if (!state.nature || !state.nature.trim()) { showError('c33s-injury'); toast('Describe your current injury/illness.'); return false; }
        if (!state.c33_providers || !state.c33_providers.trim()) { showError('c33s-providers'); toast('List at least one previous treating provider.'); return false; }
      }
      return true;
    }

    // Step-5 export action. After validating, ANONYMOUS users see ONE optional,
    // skippable account offer before the PDF is built; signed-in users (and
    // anyone who skips) go straight to generate(). Skipping fully completes the
    // flow — a local export with full filing instructions.
    function beforeExport(certAgreed) {
      if (working) return;
      syncFromDom();
      if (!validateForExport(certAgreed)) return;
      // Optional account offer (anon) → then the MANDATORY sworn-document ack gate,
      // which is the final, non-dismissible step before generate for EVERYONE.
      if (!anon) { showCertAckGate(certAgreed); return; }
      showAccountOffer(certAgreed);
    }

    // Optional account-creation offer (anonymous only). Never blocks export: the
    // draft (non-sensitive fields only) is autosaved, "Create account" opens the
    // app's auth screen, and "Skip" generates + exports the forms locally.
    function showAccountOffer(certAgreed) {
      persist();
      var ov = el('div', { style: 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:20px' });
      function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
      var BTN_P = 'width:100%;margin-bottom:8px;background:#1d4ed8;color:#fff;border:none;border-radius:8px;padding:13px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit';
      var BTN_S = 'width:100%;background:transparent;color:#9ba1b0;border:1px solid #2e3145;border-radius:8px;padding:12px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit';
      var card = el('div', { style: 'background:#1a1d28;border:1px solid #2e3145;border-radius:14px;padding:24px 22px;max-width:380px;width:100%;text-align:center;color:#e8eaed;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif' }, [
        el('div', { style: 'font-size:34px;line-height:1;margin-bottom:12px', text: '🗂️' }),
        el('h3', { style: 'font-size:18px;font-weight:600;margin:0 0 8px;line-height:1.3', text: 'Create a free account to save this filing and track your case?' }),
        el('p', { style: 'font-size:13px;color:#9ba1b0;line-height:1.5;margin:0 0 20px', text: 'We’ll save your signed C-3 to your account so you can download it again and follow what happens next. You’ll still get your forms right now if you skip.' }),
        el('button', { type: 'button', style: BTN_P, onclick: function () { close(); try { if (CD.showAuth) CD.showAuth('Create a free account to save your C-3 filing'); } catch (e) {} } }, ['Create account']),
        el('button', { type: 'button', style: BTN_S, onclick: function () { close(); showCertAckGate(certAgreed); } }, ['Skip, just give me my forms'])
      ]);
      ov.appendChild(card);
      document.body.appendChild(ov);
    }

    // MANDATORY pre-export acknowledgment — bold, loud, shown EVERY time before
    // export (and therefore before the success-screen email link), for both the
    // C-3 and the standalone C-3.3. Quotes the C-3's verbatim certification +
    // penalty-of-perjury language. The Export button is disabled until the
    // claimant checks the certify box. Never permanently dismissible.
    function showCertAckGate(certAgreed) {
      var formLabel = state.c33Only ? 'C-3.3' : 'C-3';
      var ov = el('div', { style: 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.9);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto' });
      function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
      var card = el('div', { style: 'background:#15171f;border:2px solid #ef4444;border-radius:14px;max-width:480px;width:100%;max-height:94vh;overflow:auto;padding:22px 20px;color:#e8eaed;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 0 0 6px rgba(239,68,68,.18)' });
      card.appendChild(el('div', { style: 'font-size:21px;font-weight:800;line-height:1.25;color:#fca5a5;text-align:center;margin-bottom:14px', text: '⚠️ YOU ARE ABOUT TO SUBMIT A SWORN LEGAL DOCUMENT.' }));
      card.appendChild(el('p', { style: 'font-size:14px;line-height:1.55;color:#e8eaed;margin:0 0 14px', text: 'Emailing this ' + formLabel + ' to the New York State Workers’ Compensation Board files an official legal claim. The information on it must be TRUE and COMPLETE. Knowingly making a false statement is a crime.' }));
      var callout = el('div', { style: 'border:1px solid #f59e0b;background:rgba(245,158,11,.08);border-radius:10px;padding:14px;margin:0 0 16px' });
      callout.appendChild(el('div', { style: 'font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#f59e0b;margin-bottom:8px', text: 'Certification on Form C-3 — read carefully' }));
      callout.appendChild(el('p', { style: 'font-size:12.5px;line-height:1.6;color:#dce4f0;margin:0 0 10px', text: C3_CERT_AFFIRMATION }));
      callout.appendChild(el('p', { style: 'font-size:12.5px;line-height:1.6;color:#f0d9b5;margin:0;font-weight:600', text: C3_FRAUD_WARNING }));
      card.appendChild(callout);
      var cbRow = el('label', { style: 'display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin:0 0 16px' });
      var cb = el('input', { type: 'checkbox', style: 'margin-top:2px;width:20px;height:20px;flex:0 0 auto;accent-color:#3b82f6' });
      cbRow.appendChild(cb);
      cbRow.appendChild(el('span', { style: 'font-size:13.5px;line-height:1.5;color:#e8eaed', text: 'I have reviewed my answers and certify they are true to the best of my knowledge.' }));
      card.appendChild(cbRow);
      var GO_OFF = 'width:100%;margin-bottom:8px;background:#ef4444;color:#fff;border:none;border-radius:8px;padding:14px;font-size:15px;font-weight:700;font-family:inherit;cursor:not-allowed;opacity:.5';
      var GO_ON = 'width:100%;margin-bottom:8px;background:#ef4444;color:#fff;border:none;border-radius:8px;padding:14px;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;opacity:1';
      var go = el('button', { type: 'button', disabled: 'disabled', style: GO_OFF }, ['Export & email my ' + formLabel + ' to the WCB']);
      var cancel = el('button', { type: 'button', style: 'width:100%;background:transparent;color:#9ba1b0;border:1px solid #2e3145;border-radius:8px;padding:11px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit' }, ['Cancel — go back']);
      cb.addEventListener('change', function () { if (cb.checked) { go.disabled = false; go.setAttribute('style', GO_ON); } else { go.disabled = true; go.setAttribute('style', GO_OFF); } });
      go.addEventListener('click', function () { if (go.disabled) return; close(); generate(certAgreed); });
      cancel.addEventListener('click', function () { close(); });
      card.appendChild(go);
      card.appendChild(cancel);
      ov.appendChild(card);
      document.body.appendChild(ov);
    }

    function generate(certAgreed) {
      if (working) return;
      syncFromDom();
      if (!validateForExport(certAgreed)) return;
      var c33Only = !!state.c33Only;
      var formLabel = c33Only ? 'C-3.3' : 'C-3';
      working = true;
      var btn = $(c33Only ? 'c3w-c33-generate' : 'c3w-generate'); if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
      ensurePdfLib().then(function (PDFLib) {
        var submitter = anon ? new LocalDownloadPackage() : new SelfFilePackage(supabase);
        if (c33Only) {
          return fillC33(PDFLib).then(function (c33Bytes) {
            if (!c33Bytes) throw new Error('C-3.3 generation failed');
            return submitter.submit(null, c33Bytes);
          });
        }
        return fillC3(PDFLib).then(function (c3Bytes) {
          var c33P = state.priorInjury === 'yes' ? fillC33(PDFLib) : Promise.resolve(null);
          return c33P.then(function (c33Bytes) {
            return submitter.submit(c3Bytes, c33Bytes);
          });
        });
      }).then(function (result) {
        // Draft is fulfilled — clear both the local autosave and the server row.
        return store.remove(STORE_KEY).then(function () { return dbClearDraft(); }).then(function () { return result; });
      }).then(function (result) {
        working = false;
        // onComplete reloads tier + returns to the dashboard (where signed-in
        // users see the new filing in "My Documents"). Guests have no Documents
        // card and the local download link lives ONLY on the success screen, so
        // skip the navigate-away for them — keep the success screen up.
        try { if (!anon && typeof ctx.onComplete === 'function') ctx.onComplete(); } catch (e) {}
        showSuccess(result);
      }).catch(function (e) {
        working = false;
        if (btn) { btn.disabled = false; btn.textContent = c33Only ? 'Generate Form C-3.3' : 'Generate & File My C-3'; }
        console.error('[C3] GENERATE_FAILED', e);
        toast('We couldn’t generate your ' + formLabel + '. Your answers are still here — please try again.');
      });
    }

    // Anonymous usage ping — records ONLY { action, form_type, timestamp } so Joel
    // can track C-3 completions. No name, SSN, medical, IP, or account id. Fire-
    // and-forget; never blocks the user. (Edge fn log-c3-usage, verify_jwt=false.)
    function logUsage(action, formType) {
      try {
        var sb = supabase || CD.supa;
        if (sb && sb.functions && sb.functions.invoke) sb.functions.invoke('log-c3-usage', { body: { action: action, form_type: formType } }).catch(function () {});
      } catch (e) {}
    }

    /* ---------- success (truthful) ------------------------------------ */
    function showSuccess(result) {
      root.querySelectorAll('.step-section').forEach(function (s) { s.classList.remove('active'); });
      for (var i = 1; i <= TOTAL_STEPS; i++) { var d = $('c3w-dot-' + i); if (d) d.className = 'step-dot completed'; if (i < TOTAL_STEPS) { var l = $('c3w-line-' + i); if (l) l.className = 'step-line completed'; } }
      var toAttorney = state.branch === 'attorney' && profile.attorney_email;
      var hasC3 = !!result.signedUrl || !!result.path;
      var c33Only = !hasC3 && !!result.c33path;
      var both = hasC3 && !!result.c33path;
      var _formType = both ? 'c3_c33' : (c33Only ? 'c33' : 'c3');
      var pktNoun = both ? 'both PDFs (your C-3 and C-3.3)' : 'the PDF';
      var headline = c33Only ? 'Your Form C-3.3 is ready' : 'Your C-3 is ready';
      var formName = c33Only ? 'Form C-3.3 (HIPAA medical release)' : 'C-3 Employee Claim';
      var c33Note = both ? ' Your Form C-3.3 (HIPAA release) is included — file it together with your C-3.' : '';
      var c33OnlyNote = c33Only ? ' File it together with your C-3 to commence the claim.' : '';
      // Honest about persistence: signed-in filings are saved to the account;
      // anonymous filings live only in this browser (no SSN/medical sent to us).
      var savedClause = anon
        ? ' It’s on this device only — your answers and Social Security number were not uploaded to us.'
        : ' We saved it to your account.';
      var screen = el('div', { class: 'success-screen' }, [
        el('div', { class: 'success-icon', text: '✓' }),
        el('h2', { text: headline }),
        el('p', { text: 'We generated your signed ' + formName + '.' + savedClause + c33Note + c33OnlyNote + ' It has not been submitted to the WCB — here’s how to file it.' })
      ]);
      // download buttons — native-safe. A blob: <a download> is a no-op inside a
      // WKWebView, so we route through CD.NativeMail.savePdf (writes to disk + opens
      // the iOS share sheet on device; real blob download on web).
      function dlBtn(label, cls, fileName, url) {
        var b = el('button', { type: 'button', class: cls, style: 'display:block;width:100%;text-align:center;margin-bottom:10px' }, [label]);
        b.addEventListener('click', function () {
          logUsage('download', _formType);
          if (CD.NativeMail && CD.NativeMail.savePdf) {
            var orig = b.textContent; b.disabled = true; b.textContent = 'Preparing…';
            CD.NativeMail.savePdf({ name: fileName, url: url })
              .catch(function (e) { console.warn('[C3] SAVE_FAILED', e); })
              .then(function () { b.disabled = false; b.textContent = orig; });
          } else { try { window.open(url, '_blank'); } catch (e) {} }
        });
        return b;
      }
      if (result.signedUrl) screen.appendChild(dlBtn('⬇ Download your C-3 (PDF)', 'btn btn-primary', 'C-3_Employee_Claim.pdf', result.signedUrl));
      if (result.c33SignedUrl) screen.appendChild(dlBtn('⬇ Download Form C-3.3', c33Only ? 'btn btn-primary' : 'btn btn-secondary', 'C-3.3_HIPAA_Release.pdf', result.c33SignedUrl));

      var WCB_EMAIL = 'wcbclaimsfiling@wcb.ny.gov';

      // ── Native "email to the WCB" with the in-memory PDF(s) ATTACHED ──────
      // Uses the bytes we just generated (fetched from the in-memory blob / signed
      // URL) — never re-generates. The C-3 and C-3.3 go in ONE email (the Board
      // needs both to commence the case). Opens the composer; the worker reviews
      // and taps Send — we never auto-send. Gated by Item 6: the success screen is
      // only reachable after the sworn-document acknowledgment.
      var _emailAtts = [];
      if (result.signedUrl) _emailAtts.push({ name: 'C-3_Employee_Claim.pdf', url: result.signedUrl });
      if (result.c33SignedUrl) _emailAtts.push({ name: 'C-3.3_HIPAA_Release.pdf', url: result.c33SignedUrl });
      if (_emailAtts.length && CD.NativeMail && CD.NativeMail.emailClaimToWCB) {
        var _claimant = String(state.certName || state.name || '').trim();
        var _caseNo = (profile && profile.wcb_case_number) ? (' ' + profile.wcb_case_number) : '';
        var _emailSubject = 'WCB Claim — ' + (_claimant || 'Employee Claim') + _caseNo;
        var _bothForms = !!result.signedUrl && !!result.c33SignedUrl;
        var _bodyLines = ['To the New York State Workers’ Compensation Board:', '',
          'Attached is my completed ' + (c33Only ? 'Form C-3.3 (Limited Release of Health Information)' : ('Form C-3 (Employee Claim)' + (_bothForms ? ' and Form C-3.3 (Limited Release of Health Information)' : ''))) + '.', '',
          'Claimant: ' + (_claimant || '—')];
        if (profile && profile.wcb_case_number) _bodyLines.push('WCB case number: ' + profile.wcb_case_number);
        _bodyLines.push('', 'I am filing my own claim. Thank you.');
        var _emailBody = _bodyLines.join('\n');
        var emailBtn = el('button', { type: 'button', class: 'btn btn-primary', style: 'display:block;width:100%;margin-bottom:10px' }, ['✉️ Email my claim to the WCB']);
        emailBtn.addEventListener('click', function () {
          logUsage('email', _formType);
          emailBtn.disabled = true; var orig = emailBtn.textContent; emailBtn.textContent = 'Opening mail…';
          CD.NativeMail.emailClaimToWCB({ to: WCB_EMAIL, subject: _emailSubject, body: _emailBody, attachments: _emailAtts })
            .catch(function (e) { console.warn('[C3] EMAIL_TO_WCB_FAILED', e); })
            .then(function () { emailBtn.disabled = false; emailBtn.textContent = orig; });
        });
        screen.appendChild(emailBtn);
      }

      // filing instructions (truthful) — shown to BOTH anonymous and signed-in users
      var steps = el('div', { class: 'file-steps' }, [el('h3', { text: 'How to file with the WCB' })]);
      function fstep(n, html) { return el('div', { class: 'file-step' }, [el('div', { class: 'file-step-num', text: String(n) }), el('div', { html: html })]); }
      // The C-3.3 must travel WITH the C-3 in the SAME email/submission whenever a
      // prior injury to the same body part was indicated.
      if (both) steps.appendChild(fstep('!', '<b>Send both in the same email.</b> Because you indicated a prior injury to the same body part, your C-3.3 (HIPAA release) must be filed <b>together with your C-3, in one email/submission</b> — never sent separately.'));
      if (c33Only) steps.appendChild(fstep('!', '<b>Pair it with your C-3.</b> File the C-3.3 in the <b>same email/submission</b> as your C-3 so the Board can act on the release.'));
      var stepNo = 0;
      if (toAttorney) {
        steps.appendChild(fstep(++stepNo, 'Send ' + pktNoun + ' to your attorney at <b>' + escapeHtml(profile.attorney_email) + '</b> — they may file for you. Download above and attach to an email.'));
        steps.appendChild(fstep(++stepNo, 'Prefer to file it yourself? Use any of the options below.'));
      }
      // Email to the WCB (per Item 7 of the C-3 filing instructions) — the button above opens your mail app with the PDF(s) already attached.
      steps.appendChild(fstep(++stepNo, '<b>Email it to the WCB (fastest):</b> tap <b>“✉️ Email my claim to the WCB”</b> above — it opens your mail app with ' + pktNoun + ' attached, addressed to <b>' + WCB_EMAIL + '</b>. This is the email filing described in <b>Item 7</b> of the C-3.'));
      steps.appendChild(fstep(++stepNo, '<b>Online:</b> upload ' + pktNoun + ' at the WCB Forms Submission portal, <b>wcb.ny.gov</b> → “File a Claim / Submit Forms.”'));
      steps.appendChild(fstep(++stepNo, '<b>By mail:</b> NYS Workers’ Compensation Board, Centralized Mailing, PO Box 5205, Binghamton, NY 13902-5205.'));
      steps.appendChild(fstep(++stepNo, '<b>By fax:</b> (877) 533-0337.'));
      screen.appendChild(steps);

      // What the WCB does next — shown to everyone.
      var nextBox = el('div', { class: 'file-steps' }, [el('h3', { text: 'What the WCB does next' })]);
      nextBox.appendChild(el('div', { class: 'file-step' }, [el('div', { html: 'Once they receive your claim, the Board <b>indexes it and assigns a WCB case number</b>, then notifies your employer and its insurance carrier. The carrier must accept or dispute the claim, and the Board will mail you about any hearings or next steps. <b>Keep a copy of everything you file.</b>' })]));
      screen.appendChild(nextBox);

      // The ONE unified attorney affordance (CD.AttorneyCTA) — same component the
      // worker meets on the dashboard, settlement result, recovery step panel and
      // chat. Offered here as a "have a lawyer look at what you filed" moment,
      // wrapped in the wizard's standard Attorney-Advertising label + referral
      // disclosure. Suppressed for workers who already have an attorney.
      if (!(profile && profile.has_attorney) && !toAttorney && typeof CD.AttorneyCTA === 'function') {
        var attyCard = el('div', { class: 'card c3w-offramp' });
        attyCard.appendChild(_attyAdLabel());
        attyCard.appendChild(CD.AttorneyCTA({ variant: 'inline', source: 'c3_complete' }));
        attyCard.appendChild(_attyDisclosure());
        screen.appendChild(attyCard);
      }

      screen.appendChild(el('div', { class: 'info-callout', html: c33Only
        ? '<strong>Before you file:</strong> open the PDF and review it. Sign in ink if a viewer didn’t carry your drawn signature, then file. Your answers are saved on the form.'
        : '<strong>Before you file:</strong> open the PDF and review it. A few Yes/No checkboxes may be blank — mark any that apply to you, then file. Your answers are saved on the form.' }));
      screen.appendChild(el('button', { class: 'btn btn-primary', style: 'width:100%;margin-bottom:10px', onclick: function () { showNextSteps(_formType); } }, ['✅ I’ve sent it — what happens next?']));
      screen.appendChild(el('button', { class: 'btn btn-secondary', style: 'width:100%', onclick: function () { goDash(); } }, ['Back to Dashboard']));
      stepSuccess.innerHTML = '';
      stepSuccess.appendChild(screen);
      stepSuccess.classList.add('active');
      progress.style.display = 'none';
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
    }

    // Dedicated "what happens next" page — reached from the success screen after
    // the worker sends/downloads. Ends with a last-chance account offer for
    // anonymous filers (whose C-3 lives only on this device).
    function showNextSteps(formType) {
      var v = el('div', { class: 'success-screen' });
      v.appendChild(el('div', { style: 'text-align:center;font-size:34px;margin-bottom:6px', text: '📬' }));
      v.appendChild(el('h2', { style: 'text-align:center', text: 'What happens next' }));
      v.appendChild(el('p', { style: 'text-align:center', text: 'You’ve filed your claim with the New York State Workers’ Compensation Board. Here’s what to expect over the coming weeks.' }));
      var box = el('div', { class: 'file-steps' });
      function nstep(n, html) { return el('div', { class: 'file-step' }, [el('div', { class: 'file-step-num', text: String(n) }), el('div', { html: html })]); }
      box.appendChild(nstep(1, 'The Board <b>receives and indexes your claim</b> and assigns it a <b>WCB case number</b>.'));
      box.appendChild(nstep(2, '<b>Watch your mailbox.</b> The Board contacts you <b>by mail at the address on your form</b> over the coming weeks. Open everything and keep it.'));
      box.appendChild(nstep(3, 'Your <b>employer and its insurance carrier are notified</b>. The carrier must then <b>accept or dispute (deny)</b> your claim.'));
      box.appendChild(nstep(4, 'If it’s <b>accepted</b>, your benefits move forward. If it’s <b>disputed</b>, the Board schedules a <b>hearing</b> and mails you the date.'));
      box.appendChild(nstep(5, '<b>Keep a copy of everything</b> you filed and every letter you receive.'));
      v.appendChild(box);
      v.appendChild(el('div', { class: 'info-callout', html: 'This can take a few weeks — that’s normal. If you’re unsure about anything, it’s wise to speak with a workers’ compensation attorney.' }));
      if (anon) {
        var card = el('div', { style: 'border:2px solid #f59e0b;background:rgba(245,158,11,.08);border-radius:12px;padding:18px 16px;margin:4px 0 14px;text-align:center' });
        card.appendChild(el('div', { style: 'font-size:15px;font-weight:700;color:#f0d9b5;margin-bottom:6px', text: '⚠️ Don’t lose your completed C-3' }));
        card.appendChild(el('p', { style: 'font-size:13px;color:#cbd2dd;line-height:1.5;margin:0 0 14px', text: 'Your filing lives only on this phone right now — if you close or delete the app, it’s gone for good. Create a free account to save it and track your case.' }));
        card.appendChild(el('button', { class: 'btn btn-primary', style: 'width:100%;margin-bottom:8px', onclick: function () { try { if (CD.showAuth) CD.showAuth('Create a free account to save your C-3 filing'); } catch (e) {} } }, ['Create my free account']));
        card.appendChild(el('button', { class: 'btn btn-secondary', style: 'width:100%', onclick: function () { goDash(); } }, ['No thanks — done']));
        v.appendChild(card);
      } else {
        v.appendChild(el('button', { class: 'btn btn-secondary', style: 'width:100%', onclick: function () { goDash(); } }, ['Back to Dashboard']));
      }
      stepSuccess.innerHTML = '';
      stepSuccess.appendChild(v);
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
    }
    function escapeHtml(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
    function goDash() {
      if (typeof ctx.goToDashboard === 'function') { try { ctx.goToDashboard(); return; } catch (e) {} }
      if (typeof ctx.onComplete === 'function') { try { ctx.onComplete(); return; } catch (e) {} }
      try { window.location.reload(); } catch (e) {}
    }

    /* ---------- autosave persist + restore ---------------------------- */
    // Option-card groups + their state key (so a resumed draft re-selects them),
    // and the conditional detail sections that show based on those picks.
    var OPTION_GROUPS = [
      ['c3w-translator', 'translator'], ['c3w-jobTime', 'jobTime'], ['c3w-ampm', 'ampm'],
      ['c3w-usualLocation', 'usualLocation'], ['c3w-gaveNotice', 'gaveNotice'], ['c3w-noticeMethod', 'noticeMethod'],
      ['c3w-witnessed', 'witnessed'], ['c3w-objectInvolved', 'objectInvolved'], ['c3w-motorVehicle', 'motorVehicle'],
      ['c3w-vehicleType', 'vehicleType'], ['c3w-stoppedWork', 'stoppedWork'], ['c3w-returnedWork', 'returnedWork'],
      ['c3w-returnDuty', 'returnDuty'], ['c3w-returnEmployer', 'returnEmployer'], ['c3w-priorInjury', 'priorInjury']
    ];
    var COND_WRAPS = [
      ['c3w-lang-wrap', function () { return state.translator === 'yes'; }],
      ['c3w-jobOther-wrap', function () { return state.jobTime === 'Other'; }],
      ['c3w-usualloc-detail', function () { return state.usualLocation === 'no'; }],
      ['c3w-notice-detail', function () { return state.gaveNotice === 'yes'; }],
      ['c3w-witness-detail', function () { return state.witnessed === 'yes'; }],
      ['c3w-object-detail', function () { return state.objectInvolved === 'yes'; }],
      ['c3w-mv-detail', function () { return state.motorVehicle === 'yes'; }],
      ['c3w-stop-detail', function () { return state.stoppedWork === 'yes'; }],
      ['c3w-return-detail', function () { return state.returnedWork === 'yes'; }],
      ['c3w-c33-detail', function () { return state.priorInjury === 'yes'; }]
    ];
    // Push the whole `state` back onto the DOM — text inputs, gender, body-part
    // chips, option cards, mental-health toggles, and conditional sections. Used
    // when applying a saved draft or resetting to the profile baseline.
    function reflectStateToDom() {
      TEXT_FIELDS.forEach(function (f) { if (SENSITIVE[f[1]]) return; var n = $(f[0]); if (n) n.value = (state[f[1]] != null ? state[f[1]] : ''); });
      var g = $('c3w-gender'); if (g) g.value = state.gender || '';
      C33_FIELDS.forEach(function (f) { if (SENSITIVE[f[1]]) return; var n = $(f[0]); if (n) n.value = (state[f[1]] != null ? state[f[1]] : ''); });
      if (chipGrid) chipGrid.querySelectorAll('.chip').forEach(function (chip) { var part = chip.getAttribute('data-part'); if (state.bodyParts && state.bodyParts.indexOf(part) >= 0) chip.classList.add('selected'); else chip.classList.remove('selected'); });
      OPTION_GROUPS.forEach(function (o) { var grp = $(o[0]); if (!grp) return; grp.querySelectorAll('.option-card').forEach(function (c) { c.classList[(state[o[1]] && c.getAttribute('data-value') === state[o[1]]) ? 'add' : 'remove']('selected'); }); });
      ['c3w-mh-toggle', 'c3w-c33s-mh-toggle'].forEach(function (id) { var t = $(id); if (t) t.classList[state.c33_releaseMentalHealth ? 'add' : 'remove']('on'); });
      COND_WRAPS.forEach(function (w) { var node = $(w[0]); if (node) node.style.display = w[1]() ? 'block' : 'none'; });
    }

    /* ---------- server-side draft (c3_drafts, signed-in only) ----------
     * One open draft per user (unique user_id), owner-only RLS. Answers-only —
     * SSN + signature are already stripped by persist(). Fire-and-forget and
     * fully fail-safe: if the table isn't there yet (migration 079 unapplied) or
     * the network is down, the local autosave still carries the draft. */
    var DRAFT_TABLE = 'c3_drafts';
    var _dbTimer = null;
    function nowMs() { try { return Date.now(); } catch (e) { return 0; } }
    function relTime(ms) {
      if (!ms) return '';
      var s = Math.round((nowMs() - ms) / 1000); if (s < 45) return 'just now';
      var m = Math.round(s / 60); if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
      var h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
      var d = Math.round(h / 24); return d + (d === 1 ? ' day ago' : ' days ago');
    }
    function dbSaveDraftDebounced(snap) {
      if (anon || !supabase || !user || !user.id) return;
      if (_dbTimer) { try { clearTimeout(_dbTimer); } catch (e) {} }
      _dbTimer = setTimeout(function () {
        try {
          supabase.from(DRAFT_TABLE).upsert({ user_id: user.id, step: state.step || 0, data: snap }, { onConflict: 'user_id' })
            .then(function (res) { if (res && res.error) console.warn('[C3] DRAFT_DB_SAVE', res.error.message || res.error); }, function () {});
        } catch (e) {}
      }, 900);
    }
    function dbClearDraft() {
      if (anon || !supabase || !user || !user.id) return Promise.resolve();
      try { return Promise.resolve(supabase.from(DRAFT_TABLE).delete().eq('user_id', user.id)).then(function () {}, function () {}); }
      catch (e) { return Promise.resolve(); }
    }
    function dbGetDraft() {
      if (anon || !supabase || !user || !user.id) return Promise.resolve(null);
      try {
        return Promise.resolve(supabase.from(DRAFT_TABLE).select('data,step,updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(1))
          .then(function (res) { return (res && res.data && res.data[0]) ? res.data[0] : null; }, function () { return null; });
      } catch (e) { return Promise.resolve(null); }
    }

    function persist() {
      var snap = {};
      Object.keys(state).forEach(function (k) { if (!SENSITIVE[k]) snap[k] = state[k]; }); // never persist SSN or signature
      snap.__savedAt = nowMs();
      store.set(STORE_KEY, snap);
      dbSaveDraftDebounced(snap);
    }

    // Merge a saved snapshot onto state (SSN/signature excluded) and reflect it.
    function applyDraft(saved) {
      if (!saved) return;
      Object.keys(saved).forEach(function (k) { if (k === '__savedAt') return; if (k in state && !SENSITIVE[k]) state[k] = saved[k]; });
      reflectStateToDom();
    }
    // "Start over": discard the in-progress draft and revert every field to the
    // original profile-prefill baseline (removes intake-added chips too).
    function resetToBaseline() {
      Object.keys(state).forEach(function (k) { state[k] = Array.isArray(BASELINE[k]) ? BASELINE[k].slice() : (k in BASELINE ? BASELINE[k] : (Array.isArray(state[k]) ? [] : '')); });
      state.step = 0; state.c33Only = false;
      reflectStateToDom();
      root.querySelectorAll('.prefill-tag.c3w-chip-dyn').forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
    }

    // Pull the Comp Buddy intake's OWN autosave (cbi:intake:<uid>) and fill any
    // C-3 field the profile left blank — so a half-finished intake still enriches
    // the claim. Profile + the user's own C-3 draft always win (we only fill blanks).
    function hydrateFromIntake() {
      if (anon || !user || !user.id) return Promise.resolve();
      return store.get(INTAKE_PREFIX + user.id).then(function (intk) {
        if (!intk) return;
        function blank(k) { return state[k] == null || String(state[k]).trim() === ''; }
        function fill(stateKey, val, inputId) {
          if (val == null || String(val).trim() === '' || !blank(stateKey)) return;
          state[stateKey] = val;
          if (inputId) { var n = $(inputId); if (n) { n.value = val; markPrefilled(inputId); } }
        }
        var nm2 = [intk.first_name, intk.last_name].filter(Boolean).join(' ');
        fill('name', nm2, 'c3w-name');
        if (blank('certName') && nm2) state.certName = nm2;
        fill('dob', intk.dob, 'c3w-dob');
        fill('phone', intk.phone, 'c3w-phone');
        fill('mailing', intk.home_address, 'c3w-mailing');
        fill('doi', intk.doa, 'c3w-doi');
        fill('employer', intk.employer_name, 'c3w-employer');
        fill('treatingDoctors', [intk.treating_doctor, intk.treating_doctor_address].filter(Boolean).join(', '), 'c3w-treatingDoctors');
        if (intk.language_pref && intk.language_pref !== 'en' && blank('language')) state.language = intk.language_pref;
        if ((!state.bodyParts || !state.bodyParts.length) && Array.isArray(intk.body_parts) && intk.body_parts.length) {
          state.bodyParts = intk.body_parts.slice();
          state.bodyParts.forEach(function (p) { var chip = chipGrid.querySelector('.chip[data-part="' + p + '"]'); if (chip) chip.classList.add('selected'); });
        }
        if (intk.work_status) {
          if (blank('stoppedWork')) state.stoppedWork = (intk.work_status !== 'working') ? 'yes' : '';
          if (blank('returnedWork')) state.returnedWork = (intk.work_status === 'working' || intk.work_status === 'light_duty') ? 'yes' : '';
          if (blank('returnDuty')) state.returnDuty = (intk.work_status === 'light_duty') ? 'limited' : (intk.work_status === 'working' ? 'regular' : '');
        }
        persist();
      }).catch(function () {});
    }

    // On re-entry, OFFER to resume (don't silently jump) — the worker chooses.
    function offerResume(step, atMs) {
      var host = $('c3w-step-0'); if (!host || $('c3w-resume')) return;
      var when = relTime(atMs);
      var banner = el('div', { class: 'c3w-resume', id: 'c3w-resume' }, [
        el('div', { class: 'c3w-resume-icon', text: '⏳' }),
        el('div', { class: 'c3w-resume-body' }, [
          el('div', { class: 'c3w-resume-title', text: 'Resume your claim' }),
          el('div', { class: 'c3w-resume-sub', text: when ? ('Saved ' + when + ' — pick up right where you left off.') : 'Pick up right where you left off.' })
        ]),
        el('div', { class: 'c3w-resume-actions' }, [
          el('button', { type: 'button', class: 'btn btn-primary', onclick: function () { var b = $('c3w-resume'); if (b && b.parentNode) b.parentNode.removeChild(b); goToStep(Math.min(Math.max(step, 1), TOTAL_STEPS)); } }, ['Resume']),
          el('button', { type: 'button', class: 'btn btn-secondary', onclick: function () { dismissResume(); } }, ['Start over'])
        ])
      ]);
      host.insertBefore(banner, host.firstChild);
    }
    function dismissResume() {
      try { store.remove(STORE_KEY); } catch (e) {}
      dbClearDraft();
      resetToBaseline();
      var b = $('c3w-resume'); if (b && b.parentNode) b.parentNode.removeChild(b);
    }

    function restore() {
      return store.get(STORE_KEY).then(function (localSaved) {
        return dbGetDraft().then(function (dbRow) {
          var localAt = (localSaved && localSaved.__savedAt) ? localSaved.__savedAt : 0;
          var dbAt = (dbRow && dbRow.updated_at) ? new Date(dbRow.updated_at).getTime() : 0;
          // Prefer whichever copy is newer (cross-device); ties go to the server.
          var chosen = null, chosenAt = 0, chosenStep = 0;
          if (dbRow && dbRow.data && dbAt >= localAt) { chosen = dbRow.data; chosenAt = dbAt; chosenStep = dbRow.step || dbRow.data.step || 0; }
          else if (localSaved) { chosen = localSaved; chosenAt = localAt; chosenStep = localSaved.step || 0; }
          if (chosen) applyDraft(chosen);
          return hydrateFromIntake().then(function () {
            if (chosen && chosen.c33Only) { goToStandaloneC33(); return; }
            if (chosen && chosenStep >= 1) offerResume(chosenStep, chosenAt);
            // otherwise: fresh start on step 0 with profile + intake prefill in place.
          });
        });
      }).catch(function (e) { console.warn('[C3] RESTORE_FAILED', e); });
    }

    // boot
    setTimeout(function () {
      initSig(sigCanvas);
      var c33Link = $('c3w-c33-only-link');
      if (c33Link) c33Link.addEventListener('click', function (e) { e.preventDefault(); syncFromDom(); goToStandaloneC33(); });
      restore();
    }, 0);
    return root;
  }

  CD.C3Wizard = { render: render };
})(window);
