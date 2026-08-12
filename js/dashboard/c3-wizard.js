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
 *   onDataChanged fn()                 REFRESH-ONLY — reload tier/profile behind
 *                                      the success screen. MUST NOT navigate.
 *   onComplete    fn()                 legacy "refresh AND go to the dashboard";
 *                                      still honoured by goDash() as a fallback,
 *                                      never called on successful generation (it
 *                                      re-rendered the host over the success
 *                                      screen — see generate()).
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

  /* ---- Phase 7 i18n seam ------------------------------------------------
   * Every WIZARD-UI string resolves through CD.t at RENDER time via T().
   * PDF PAYLOAD is deliberately NOT routed through this: anything written
   * onto the C-3/C-3.3 (field values, the [Body parts: ...] bracket, the
   * WCB filing email, OCC_LABELS job-title seeds) stays English — the form
   * is filed with the Board in English. EXPLAIN in the worker's language,
   * FILE in English. T(key, fallback) or T(key, vars, fallback). */
  function T(key, vars, fallback) {
    if (fallback === undefined) { fallback = vars; vars = null; }
    try { if (window.CD && typeof CD.t === 'function') return CD.t(key, vars, fallback); } catch (e) {}
    return fallback;
  }

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
      // [catalog key, English fallback] pairs — resolved at SHOW time via
      // CD.t so a locale switch is honored (never captured at parse time).
      var TERMS = {
        'AWW': ['c3.glossary.aww', 'Average Weekly Wage — the average amount you earned each week before your injury. Your weekly benefit checks are based on this number.'],
        'C-3': ['c3.glossary.c3', 'The Employee Claim — the official form that opens your workers’ comp case with the Board.'],
        'C-3.3': ['c3.glossary.c33', 'A short HIPAA release that lets the insurer get records from a doctor who treated an earlier injury to the same body part.'],
        'IME': ['c3.glossary.ime', 'Independent Medical Exam — a one-time exam by a doctor the insurance company picks, not your own doctor.'],
        'WCB': ['c3.glossary.wcb', 'The New York State Workers’ Compensation Board — the state agency that runs your claim.'],
        'DOI': ['c3.glossary.doi', 'Date of Injury — the day you got hurt, or the day you first noticed a work-related illness.']
      };
      function termText(abbr) {
        var d = TERMS[abbr];
        if (!d) return null;
        if (typeof d === 'string') return d;                 // define(abbr, string) API
        return (window.CD && typeof CD.t === 'function') ? CD.t(d[0], null, d[1]) : d[1];
      }
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
        var abbr = node.getAttribute('data-abbr'); var def = termText(abbr); if (!def) return;
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
        s.setAttribute('aria-label', abbr + ' — ' + ((window.CD && CD.t) ? CD.t('c3.glossary.tapHint', null, 'tap for what this means') : 'tap for what this means'));
        s.textContent = label || abbr;
        s.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); if (openAbbr === abbr) hide(); else showFor(s); });
        s.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (openAbbr === abbr) hide(); else showFor(s); } });
        return s;
      }
      return { term: term, define: function (a, d) { TERMS[a] = d; }, TERMS: TERMS, hide: hide };
    })();
  }

  /* ---- constants -------------------------------------------------------- */
  // Card-deck sections. Every card declares one (see CARDS below) so the Review
  // card can group answers by section and its Edit buttons can jump to the first
  // card in that section.
  var SECTIONS = ['You & Job', 'The Injury', 'Employer', 'Medical & Work'];
  // SECTIONS values are IDENTITY keys (cards + review match on them) — the
  // user-visible label resolves per render here.
  var SECTION_LABEL_KEYS = {
    'You & Job': 'c3.sections.youJob', 'The Injury': 'c3.sections.injury',
    'Employer': 'c3.sections.employer', 'Medical & Work': 'c3.sections.medicalWork'
  };
  function secLabel(section) {
    return T(SECTION_LABEL_KEYS[section] || '', section);
  }
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
  // BODY_LABELS is PDF PAYLOAD (the [Body parts: ...] bracket + attorney
  // off-ramp) and stays English. bodyPartLabel() is what the CHIPS and the
  // review card display — the worker reads their language, the form gets
  // the English value.
  var BODY_PART_KEYS = {
    'head': 'head', 'neck': 'neck', 'left shoulder': 'leftShoulder', 'right shoulder': 'rightShoulder',
    'left arm': 'leftArm', 'right arm': 'rightArm', 'left hand': 'leftHand', 'right hand': 'rightHand',
    'upper back': 'upperBack', 'lower back': 'lowerBack', 'left hip': 'leftHip', 'right hip': 'rightHip',
    'left knee': 'leftKnee', 'right knee': 'rightKnee', 'left ankle': 'leftAnkle', 'right ankle': 'rightAnkle',
    'left foot': 'leftFoot', 'right foot': 'rightFoot', 'chest': 'chest', 'abdomen': 'abdomen',
    'psychological': 'psychological'
  };
  function bodyPartLabel(value) {
    var k = BODY_PART_KEYS[value];
    return k ? T('c3.bodyParts.' + k, BODY_LABELS[value] || value) : (BODY_LABELS[value] || value);
  }

  var JOB_TIME = [['Full_Time', 'Full Time'], ['Part_Time', 'Part Time'], ['Seasonal', 'Seasonal'], ['Volunteer', 'Volunteer'], ['Other', 'Other']];
  var TREAT_TYPE = [['Emergency_Room', 'Emergency Room'], ['Doctors_office', 'Doctor’s office'], ['ClinicHospitalUrgent_Care', 'Clinic / Hospital / Urgent Care'], ['Hospital_Stay_over_24_hours', 'Hospital stay over 24 hours'], ['none_received', 'None received']];
  var TREAT_TYPE_KEYS = { Emergency_Room: 'emergencyRoom', Doctors_office: 'doctorsOffice', ClinicHospitalUrgent_Care: 'clinic', Hospital_Stay_over_24_hours: 'hospitalStay', none_received: 'noneReceived' };
  function treatTypeOptions() {
    return TREAT_TYPE.map(function (o) { return [o[0], T('c3.treatType.' + TREAT_TYPE_KEYS[o[0]], o[1])]; });
  }
  // occupation slug -> C-3 job-title seed text
  var OCC_LABELS = { construction: 'Construction worker', nurse: 'Nurse', delivery: 'Delivery driver', warehouse: 'Warehouse worker', office: 'Office worker', food: 'Food service worker' };

  // First sentence is legal.informationalOnly verbatim; the rest got its own
  // key in the Phase 7 extraction (it was flagged for exactly this).
  var DISCLAIMER = function () {
    var lead = (window.CD && CD.t) ? CD.t('legal.informationalOnly', 'This tool is for informational purposes only and does not constitute legal advice.') : 'This tool is for informational purposes only and does not constitute legal advice.';
    return lead + ' ' + T('c3.disclaimerRest', 'The Comp Desk is not a law firm and is not filing this claim on your behalf. You are preparing and filing your own C-3 (Employee Claim) with the New York State Workers’ Compensation Board.');
  };

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
    // B6 is a stub box (214pt) followed by TWO full-width ruled lines — the form
    // expects a list, so a concurrent employer's name AND address fit without
    // shrinking anything.
    otherEmployers: P1 + '_6_List_namesaddresses_of_any_other_employers_at_the_time_of_your_injuryillness[0]',
    otherEmployers2: P1 + '_1[0]', otherEmployers3: P1 + '_2[0]',
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
    // Both F-section phones are the SAME two-box "(___) ___-____" layout as A5
    // and B2: a 23pt area-code stub plus a 68pt rest-of-number box. Writing the
    // whole number into the stub is what rendered a treating-doctor phone at 5pt
    // inside the area-code parentheses on a filed C-3.
    firstTreatPhone: P2 + 'Phone_Number[0]', firstTreatPhone2: P2 + 'undefined_21[0]',
    treatingDoctors1: P2 + 'Give_the_name_and_address_of_the_doctors_treating_you_for_this_injuryillness_1[0]',
    treatingDoctors2: P2 + 'Give_the_name_and_address_of_the_doctors_treating_you_for_this_injuryillness_2[0]',
    treatingDoctorsPhone: P2 + 'Phone_Number_2[0]', treatingDoctorsPhone2: P2 + 'undefined_22[0]',
    // --- Completeness pass (2026-06-24): newly mapped fields. Y/N checkbox
    //     polarity confirmed by widget-rect + nearby-label extraction against
    //     the real form (label sits ~7-12px right of its box). ---
    dateHiredM: P1 + '_4_Date_you_were_hired[0]', dateHiredD: P1 + 'undefined_5[0]', dateHiredY: P1 + 'undefined_6[0]',
    usualLocYes: P1 + 'Check_Box12[0]', usualLocNo: P1 + 'Check_Box13[0]',
    usualLocWhy: P1 + 'If_no_why_were_you_at_this_location[0]', usualLocWhy2: P1 + '_4_Was_this_your_usual_work_location[0]',
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

  /* ---- portal: the wizard is a TOP-LEVEL overlay, not a child of #app -----
   * .c3w is position:fixed; z-index:100040, but ui-controller mounts it via
   * renderScreenSafe(app,'c3',…) — i.e. INSIDE #app, which is
   * overflow-y:scroll; -webkit-overflow-scrolling:touch. On iOS that scroller
   * gets its own compositing layer, which is a STACKING CONTEXT, and a z-index
   * only ever competes inside its own context: 100040 stopped meaning
   * "above everything" and started meaning "top item within #app", where #app
   * itself is z-index:auto and therefore loses to the body-level #cd-floatnav
   * at 400. Measured, by forcing the same context in Chromium: the bottom third
   * of the Back/Next row stops hit-testing to the buttons and starts hitting
   * the tab bar. A 100,040 that loses to 400 is a symptom — raising it to
   * 999999 would change nothing, because the number was never being compared
   * to 400 in the first place.
   *
   * Fix: mount the wizard on document.body, where it is a true top-level
   * overlay and its z-index means what it says. (TouGate is 100060 and also
   * body-level, so the gate still covers the wizard.)
   *
   * Teardown is anchored, not enumerated. renderScreenSafe puts the returned
   * ANCHOR into #app; every exit — the ✕, Back off card 0, goDash(),
   * onComplete, or any CD.showScreen from anywhere else — ends in
   * ui-controller render()'s `app.innerHTML=''`, which disconnects that anchor.
   * Watching the anchor therefore covers every route out, including ones added
   * later, without this file having to know what they are. The ✕'s own
   * syncFromDom() + persist() run before goDash() exactly as before; nothing
   * about the wizard's own state handling changes.
   * ---------------------------------------------------------------------- */
  var IMMERSIVE_ID = 'c3';
  function _markImmersive(on) {
    try {
      if (CD.Immersive) { on ? CD.Immersive.enter(IMMERSIVE_ID) : CD.Immersive.exit(IMMERSIVE_ID); return; }
      // The attribute IS the contract; the helper is only bookkeeping.
      if (on) document.body.setAttribute('data-immersive', IMMERSIVE_ID);
      else document.body.removeAttribute('data-immersive');
    } catch (e) { /* no-op */ }
  }

  function portal(root) {
    var app = document.getElementById('app');
    // Nothing to anchor to → keep the old in-#app mount rather than orphan a
    // fixed overlay on body that nothing can ever remove.
    if (!app || !document.body || typeof MutationObserver !== 'function') return root;

    var anchor = document.createElement('div');
    anchor.className = 'c3w-portal-anchor';
    anchor.setAttribute('aria-hidden', 'true');
    anchor.style.cssText = 'display:none';

    document.body.appendChild(root);
    _markImmersive(true);

    var obs = null;
    function teardown() {
      if (obs) { try { obs.disconnect(); } catch (e) { /* no-op */ } obs = null; }
      if (root.parentNode) root.parentNode.removeChild(root);
      _markImmersive(false);
    }
    // The auto-teardown is correct MID-FLOW: any re-render of #app means the app
    // navigated away, and an abandoned wizard must not be left floating over the
    // new screen. It is dead wrong once the wizard reaches a TERMINAL screen.
    //
    // The success screen carries the download buttons, the ✉️ "Email my claim to
    // the WCB" button — the only in-wizard path to actually filing — and the
    // how-to-file steps. Any stray re-render of #app from anywhere in the app
    // (an auth-state tick, a tier refresh, a background listener) disconnects the
    // anchor and deletes all of it, with the PDF already generated. The worker
    // sees the flow "stall" on the previous card and taps Generate again.
    //
    // So: terminalView() disarms this, and goDash() tears down explicitly
    // instead. Leaving is then something the worker chooses, never something a
    // repaint does to them.
    root.__c3portal = {
      teardown: teardown,
      disarm: function () { if (obs) { try { obs.disconnect(); } catch (e) {} obs = null; } }
    };
    try {
      obs = new MutationObserver(function () {
        // Registered BEFORE renderScreenSafe appends the anchor, so the first
        // record is that append and isConnected is already true.
        if (!anchor.isConnected) teardown();
      });
      obs.observe(app, { childList: true });
    } catch (e) {
      teardown();
      return root;
    }
    return anchor;
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

  /* ---- pdf-lib loader ---------------------------------------------------
   * Vendored copy FIRST, CDN only as a last resort — the same candidate-list
   * probe js/workspace/feeapp.js already uses (one pattern, not two).
   *
   * This was CDN-only, which meant a worker on flaky wifi — or an App Review
   * device behind a hotel captive portal — could not generate a C-3 AT ALL, on
   * the one screen where the whole feature pays off.
   *
   * The CDN entry is load-bearing, not vestigial: this file is vendored
   * byte-for-byte to thecompdesk.com, which has no js/vendor/ directory. There
   * the local candidates 404, the probe falls through, and the site behaves
   * exactly as it does today. Never make the local path the only path.
   * -------------------------------------------------------------------- */
  var PDF_LIB_CANDIDATES = [
    'js/vendor/pdf-lib.min.js',
    '/js/vendor/pdf-lib.min.js',
    'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'
  ];
  var _pdfLibPromise = null;
  function ensurePdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (_pdfLibPromise) return _pdfLibPromise;
    _pdfLibPromise = new Promise(function (resolve, reject) {
      var i = 0;
      function tryNext() {
        if (window.PDFLib) return resolve(window.PDFLib);
        if (i >= PDF_LIB_CANDIDATES.length) { _pdfLibPromise = null; return reject(new Error('pdf-lib failed to load')); }
        var s = document.createElement('script');
        s.src = PDF_LIB_CANDIDATES[i++];
        s.onload = function () { if (window.PDFLib) resolve(window.PDFLib); else tryNext(); };
        s.onerror = function () { tryNext(); };
        document.head.appendChild(s);
      }
      tryNext();
    });
    return _pdfLibPromise;
  }

  /* ---- network deadline -------------------------------------------------
   * Resolve `p`, or resolve `fallback` after `ms` — never reject, never hang.
   *
   * WHY THIS IS MODULE-SCOPE AND USED EVERYWHERE: a .catch() only fires on a
   * REJECTED promise. A dead connection, a captive portal or a half-open socket
   * does not reject — it HANGS until the OS gives up, which iOS reports as
   * `nw_read_request_report [Cn] Receive failed with error "Operation timed
   * out"` and can sit there for 60s+ (longer with CapacitorHttp routing through
   * native URLSession). Every unbounded read in the filing path is therefore a
   * silent, error-free stall that reaches the worker as a dead button.
   *
   * ONLY EVER WRAP READS. Reads are idempotent and side-effect free, so
   * abandoning one is safe. The WRITES in this flow (the storage upload and the
   * c3_filings insert) are deliberately left unbounded: a client-side deadline
   * cannot cancel a request the server may still be completing, so abandoning
   * one and letting the worker retry is exactly how one claim becomes two
   * filings — the duplicate this wizard was fixed for. A slow upload is waited
   * out, not raced.
   * -------------------------------------------------------------------- */
  function withDeadline(p, ms, label, fallback) {
    if (fallback === undefined) fallback = null;
    return new Promise(function (resolve) {
      var settled = false;
      function finish(v) { if (settled) return; settled = true; try { clearTimeout(timer); } catch (e) {} resolve(v); }
      var timer = setTimeout(function () {
        console.warn('[C3] NET_TIMEOUT ' + label + ' exceeded ' + ms + 'ms — continuing without it');
        finish(fallback);
      }, ms);
      try { Promise.resolve(p).then(finish, function (e) { console.warn('[C3] NET_FAILED ' + label, e); finish(fallback); }); }
      catch (e) { console.warn('[C3] NET_THREW ' + label, e); finish(fallback); }
    });
  }
  // Read budgets. Generous enough for a slow-but-alive connection, short enough
  // that a dead one degrades while the worker is still watching.
  var NET_MS = { template: 6000, signedUrl: 12000 };

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
  // Textareas in this wizard hold ONE ANSWER PER LINE — that is how the
  // suggestion chips add and remove their contributions. The C-3's text boxes are
  // single-line AcroForm fields, and a literal "\n" inside one renders as nothing:
  // three separate job duties collapsed onto one crowded line on a filed C-3.
  // Join to "; " so each answer stays visibly separate before any wrapping.
  function joinLines(s) {
    return String(s == null ? '' : s).split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean).join('; ');
  }
  // A3 is ONE ruled line on the C-3. The address box's typeahead commits a full
  // canonical address, so:
  //   - the apartment/unit belongs next to the STREET, not tacked on after the
  //     ZIP, which is where a plain append would put it;
  //   - Mapbox's trailing ", United States" is noise on a New York State form and
  //     costs ~15 characters of a 443pt box;
  //   - the profile's city/state/ZIP line is appended ONLY when the address has
  //     no ZIP of its own, so someone who typed a bare street still gets a
  //     complete address and someone who used the typeahead is not given two.
  function composeMailing(line1, unit, cityLine) {
    var a = String(line1 || '').trim().replace(/[,\s]+(United States|USA|U\.S\.A\.|US)\s*$/i, '');
    var u = String(unit || '').trim().replace(/^[,\s]+|[,\s]+$/g, '');
    if (u) {
      // "4B" reads as an apartment; "Apt 4B" / "Suite 200" / "#3" already say so.
      if (!/^(apt|apartment|unit|ste|suite|fl|floor|rm|room|bldg|building|#)/i.test(u)) u = 'Apt ' + u;
      var c = a.indexOf(',');
      a = c > 0 ? (a.slice(0, c) + ', ' + u + a.slice(c)) : (a ? a + ', ' + u : u);
    }
    var city = String(cityLine || '').trim();
    if (city && !/\b\d{5}(-\d{4})?\b/.test(a)) a = a ? (a + ', ' + city) : city;
    return a;
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

  // Second disclaimer constant in this file — the module-scope sweep found it after
  // FIX 1 converted the other one. Same parse-time capture, same fix.
  function FOOTER_DISCLAIMER() {
    return (window.CD && CD.t) ? CD.t('legal.informationalOnly', 'This tool is for informational purposes only and does not constitute legal advice.') : 'This tool is for informational purposes only and does not constitute legal advice.';
  }

  /* ======================================================================
   *  render(ctx) — a full-screen MODAL DECK of no-scroll cards
   * ==================================================================== */
  function render(ctx) {
    ctx = ctx || {};
    var root = el('div', { class: 'c3w' });
    var modal = el('div', { class: 'c3w-modal' });
    root.appendChild(modal);

    var supabase = ctx.supabase;
    var user = ctx.user || (ctx.profile && { id: ctx.profile.id }) || null;
    var profile = ctx.profile || null;
    var isNative = !!ctx.isNative || !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    var store = makeStore(isNative);
    var STORE_KEY = STORAGE_PREFIX + (user && user.id ? user.id : 'anon');

    function toast(msg, type) {
      if (typeof ctx.toast === 'function') { try { ctx.toast(msg, type); return; } catch (e) {} }
      // Same probe mt-tracker/accident-notice/evidence-uploader/worker-profile
      // already carried. CD.toast is app-only (js/toast.js is not synced to
      // the website), so on thecompdesk.com this falls through to the local
      // pill below — which is why that pill's CSS had to be fixed too.
      if (typeof CD.toast === 'function') { try { CD.toast(msg, type); return; } catch (e) {} }
      var t = el('div', { class: 'c3w-toast' + (type === 'ok' ? ' ok' : ''), text: msg });
      document.body.appendChild(t);
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 5000);
    }
    function fatalCard(title, msg, withReload) {
      var f = el('div', { class: 'fatal' }, [el('h2', { text: title }), el('p', { text: msg })]);
      if (withReload) f.appendChild(el('button', { class: 'btn btn-primary', style: 'max-width:220px;margin:0 auto', onclick: function () { try { window.location.reload(); } catch (e) {} } }, [T('c3.fatal.reload', 'Reload')]));
      return f;
    }

    var anon = !user || !user.id;
    // The fatal cards portal too — .c3w is position:fixed either way, so an
    // un-portalled fatal would be the same stacking bug with a dead end behind it.
    if (!supabase) { modal.appendChild(fatalCard(T('c3.fatal.genericTitle', 'Something went wrong'), T('c3.fatal.genericBody', 'Please reload and try again.'), true)); return portal(root); }
    if (!anon && !profile) {
      modal.appendChild(fatalCard(T('c3.fatal.profileTitle', 'We couldn’t load your profile'), T('c3.fatal.profileBody', 'Your C-3 pre-fills from your Comp Buddy profile, and that read failed. Please reload and try again — we don’t want to start your claim form blank.'), true));
      console.error('[C3] PREFILL_NO_PROFILE — refusing to render the wizard without a profile row');
      return portal(root);
    }
    if (!profile) profile = {};
    var signedIn = !anon;

    /* ---- working state (prefilled from profile) ------------------------ */
    var mailingCityLine = [profile.home_city, [profile.home_state, profile.home_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    var docName = profile.treating_doctor_name || profile.treating_doctor || '';
    var state = {
      step: 0, cardKey: '', branch: '',
      // Claim type drives COPY ONLY — the C-3 itself has no occupational-disease
      // section. Verified against the blank form (ops/rd/c3.pdf, 159 named
      // AcroForm fields): there is no date-of-disablement, no last-exposure and
      // no first-noticed box anywhere on it. OD is filed through the SAME fields
      // as an accident — "_1_Date_of_injury_or_date_of_onset_of_illness",
      // "..._injured_or_became_ill", "..._nature_of_your_injuryillness". So the
      // PDF field map below is deliberately UNCHANGED; what changes is that the
      // wizard stops saying only "injury"/"accident" at a worker whose claim
      // built up over time. Vocabulary matches profiles.claim_type exactly.
      claimType: (profile.claim_type === 'occupational_disease' || profile.segment === 'occupational')
        ? 'occupational_disease' : 'accident',
      // A. you  (email is collected for the attorney off-ramp only — the C-3 PDF
      // has no email box, so it is never written to the form; SSN is never stored.)
      name: profile.full_name || '', dob: profile.dob || '', ssn: '', gender: '',
      // mailing2 is the profile's city/state/ZIP line. It is NO LONGER a visible
      // box: the address field's typeahead commits a full canonical address, so
      // asking for the city again produced a second field with nothing to put in
      // it. It survives as a FALLBACK for anyone who types a bare street with no
      // ZIP (see composeMailing). mailingUnit is what the second box asks now.
      mailing: profile.home_address || '', mailing2: mailingCityLine, mailingUnit: '',
      phone: profile.phone || '', email: (user && user.email) || profile.email || '',
      translator: '', language: (profile.language_pref && profile.language_pref !== 'en') ? profile.language_pref : '',
      // B. employer
      employer: profile.employer_name || '', employerPhone: '', workAddress: '', supervisor: '', otherEmployers: '',
      // B6 concurrent employment — a second job held AT THE TIME of the injury.
      // It belongs on the C-3 because concurrent wages raise the AWW the award is
      // built from, and B6 was the one section the wizard never asked about.
      hasConcurrent: false, concurrentEmployer: '', concurrentAddress: '', concurrentJob: '',
      // C. job
      jobTitle: OCC_LABELS[profile.occupation] || '', activities: '', jobTime: '', jobOther: '', grossPay: '', payFreq: '',
      // D. injury
      doi: profile.doa || '', timeOfInjury: '', ampm: '', whereHappened: '', whatDoing: '', howHappened: '',
      usualLocation: '', usualLocationWhy: '', dateHired: '',
      bodyParts: Array.isArray(profile.body_parts) ? profile.body_parts.slice() : [], nature: '',
      // page 2: third party / notice / witnesses
      objectInvolved: '', objectWhat: '', motorVehicle: '', vehicleType: '', licensePlate: '', mvCarrier: '',
      gaveNotice: '', noticeMethod: '', noticeHow: '', noticeTo: '', noticeDate: '',
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
      c33Only: false, c33Idx: 0,
      certName: profile.full_name || ''
    };
    // CONTINUITY: fill any state field STILL EMPTY (after the signed-in profile
    // prefill above) from the ONE local worker profile, so a no-account user who
    // typed this elsewhere never re-types it. SSN is NEVER read from the store (it
    // isn't in the store). `storeSourced` flags these for the chip variant below.
    var storeSourced = {};
    try {
      if (CD.WorkerProfile && CD.WorkerProfile.get) {
        var _wp = CD.WorkerProfile.get();
        var _fs = function (sk, val) {
          if (val == null) return;
          if (Array.isArray(val)) { if (state[sk] && state[sk].length) return; state[sk] = val.slice(); storeSourced[sk] = true; return; }
          if (String(val).trim() === '' || (state[sk] && String(state[sk]).trim() !== '')) return;
          state[sk] = val; storeSourced[sk] = true;
        };
        _fs('name', _wp.full_name); _fs('dob', _wp.dob); _fs('gender', _wp.gender); _fs('phone', _wp.phone); _fs('email', _wp.email);
        _fs('mailing', _wp.home_address); _fs('jobTitle', _wp.job_title); _fs('activities', _wp.job_duties); _fs('employer', _wp.employer_name);
        _fs('workAddress', _wp.employer_address); _fs('supervisor', _wp.supervisor_name); _fs('doi', _wp.date_of_injury); _fs('bodyParts', _wp.body_parts);
        _fs('howHappened', _wp.injury_description); _fs('stopWorkDate', _wp.last_day_worked); _fs('grossPay', _wp.wage_rate); _fs('payFreq', _wp.pay_frequency);
        _fs('firstTreatDate', _wp.first_treatment_date); _fs('treatingDoctors', _wp.treating_provider); _fs('language', _wp.language_pref);
        if ((!state.certName || !state.certName.trim()) && _wp.full_name) state.certName = _wp.full_name;
      }
    } catch (e) {}
    function cloneState(s) { var o = {}; Object.keys(s).forEach(function (k) { o[k] = Array.isArray(s[k]) ? s[k].slice() : s[k]; }); return o; }
    var BASELINE = cloneState(state);
    // Which fields arrived pre-filled (profile or intake) — drives the small
    // "From your profile · Edit" chip. Seeded from the non-empty baseline values.
    var PREFILLABLE = { name: 1, dob: 1, mailing: 1, mailing2: 1, phone: 1, email: 1, jobTitle: 1, employer: 1, doi: 1, treatingDoctors: 1 };
    var prefilled = {};
    Object.keys(PREFILLABLE).forEach(function (k) { if (state[k] && String(state[k]).trim()) prefilled[k] = true; });

    var hasAtty = !!profile.has_attorney;
    var sig = { drawn: false, canvas: null };
    var sigCanvas = null;
    var working = false;
    var certAgreed = { v: false }, certAgreedC33 = { v: false };
    var curKey = null;
    function $(id) { return root.querySelector('#' + id); }

    /* ---- attorney off-ramp (unchanged behaviour; walls removed) -------- */
    function _offRampPrefill() {
      var nm = String(state.name || state.certName || '').trim().split(/\s+/).filter(Boolean);
      var bodies = (state.bodyParts && state.bodyParts.length) ? state.bodyParts.map(function (p) { return BODY_LABELS[p] || p; }).join(', ') : '';
      return {
        doa: state.doi || '', employer: state.employer || '',
        desc: state.howHappened || '', injuries: [state.nature, bodies].filter(Boolean).join(' — '),
        fname: nm[0] || '', lname: nm.length > 1 ? nm.slice(1).join(' ') : '',
        phone: state.phone || '', email: state.email || (user && user.email) || (profile && profile.email) || ''
      };
    }
    function openAttorneyOfframp() {
      try { syncFromDom(); } catch (e) {}
      try { persist(); } catch (e) {}
      try { if (CD.openAttorneyIntake) CD.openAttorneyIntake(_offRampPrefill()); }
      catch (e) { console.warn('[C3] OFFRAMP_OPEN_FAILED', e); }
    }

    /* ---- modal chrome (cream): top bar + slim progress + pinned footer -- */
    var topbar = el('div', { class: 'c3w-topbar' }, [
      el('div', { class: 'c3w-title', text: T('c3.title', 'File Your Claim') }),
      el('span', { class: 'c3w-badge', text: T('c3.badge', 'Employee Claim') })
    ]);
    if (!hasAtty) topbar.appendChild(el('button', { type: 'button', class: 'c3w-atty-link', onclick: function () { openAttorneyOfframp(); } }, ['⚖️ ' + T('c3.talkToAttorney', 'Talk to an attorney')]));
    topbar.appendChild(el('button', { type: 'button', class: 'c3w-close', 'aria-label': T('c3.close', 'Close'), onclick: function () { try { syncFromDom(); persist(); } catch (e) {} goDash(); } }, ['✕']));

    var barFill = el('div', { class: 'c3w-bar-fill' });
    var counterEl = el('div', { class: 'c3w-counter' });
    var etaEl = el('div', { class: 'c3w-eta' });
    var progress = el('div', { class: 'c3w-progress', style: 'display:none' }, [
      el('div', { class: 'c3w-bar' }, [barFill]),
      el('div', { class: 'c3w-metarow' }, [counterEl, etaEl])
    ]);

    var viewport = el('div', { class: 'c3w-viewport' });

    var backBtn = el('button', { type: 'button', class: 'c3w-back', text: T('c3.back', 'Back') });
    var nextBtn = el('button', { type: 'button', class: 'c3w-next', text: T('c3.continue', 'Continue') });
    var foot = el('div', { class: 'c3w-foot' }, [
      el('div', { class: 'c3w-foot-row' }, [backBtn, nextBtn]),
      el('div', { class: 'c3w-foot-note', text: FOOTER_DISCLAIMER() })
    ]);

    modal.appendChild(topbar);
    modal.appendChild(progress);
    modal.appendChild(viewport);
    modal.appendChild(foot);

    // Keyboard-safe height: drive the modal height from window.visualViewport so
    // the on-screen keyboard shrinks the card area instead of covering the pinned
    // Next button (never position:fixed guesswork).
    function applyVV() {
      var vv = window.visualViewport; if (!vv) return;
      modal.style.height = vv.height + 'px';
      modal.style.top = (vv.offsetTop || 0) + 'px';
    }
    // Keep the focused field visible when the keyboard opens. Shrinking the modal
    // (applyVV) stops the keyboard COVERING the footer, but it does nothing about
    // a field that is now below the fold of the shrunken viewport — the worker is
    // typing into something they cannot see. Re-centre on focus, and again after
    // the viewport actually resizes (iOS fires focus BEFORE the keyboard animates,
    // so a single scroll on focus lands on the pre-keyboard geometry and is wrong).
    var _focused = null;
    function revealFocused() {
      if (!_focused || !_focused.isConnected) return;
      try { _focused.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); }
      catch (e) { try { _focused.scrollIntoView(false); } catch (e2) {} }
    }
    viewport.addEventListener('focusin', function (e) {
      var t = e.target;
      if (!t || !/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      _focused = t;
      setTimeout(revealFocused, 60);
      setTimeout(revealFocused, 340);   // after the keyboard animation settles
    });
    viewport.addEventListener('focusout', function () { _focused = null; });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () { applyVV(); setTimeout(revealFocused, 40); });
      window.visualViewport.addEventListener('scroll', applyVV);
    }

    /* ---- field builders (el-based) ------------------------------------ */
    // Is this an occupational-disease claim? Copy-only fork — see state.claimType.
    function isOD() { return state.claimType === 'occupational_disease'; }
    // title/sub may be a plain string OR a function, so a card's heading can
    // follow claimType without the deck needing to know why.
    function _txt(v) { return (typeof v === 'function') ? v() : v; }
    function cardHead(c) {
      var h = el('div', { class: 'c3w-card-head' });
      if (c.icon) h.appendChild(el('div', { class: 'c3w-card-icon', text: c.icon }));
      h.appendChild(el('h2', { class: 'c3w-card-title', text: _txt(c.title) }));
      var sub = _txt(c.sub);
      if (sub) h.appendChild(el('p', { class: 'c3w-card-sub', text: sub }));
      return h;
    }
    function helper() { var parts = Array.prototype.slice.call(arguments); return el('div', { class: 'c3w-helper' }, parts); }
    function gloss(abbr, label) { return (CD.Glossary && CD.Glossary.term) ? CD.Glossary.term(abbr, label) : el('span', { text: label || abbr }); }
    function prefillChip(key) {
      var fromStore = !!storeSourced[key];
      return el('span', { class: 'c3w-chip', role: 'button', tabindex: '0', 'data-focuskey': key,
        title: fromStore ? T('c3.chip.toldEarlierTitle', 'You told us this earlier — tap to edit') : T('c3.chip.fromProfileTitle', 'Filled in from your profile — tap to edit'),
        text: fromStore ? T('c3.chip.toldEarlier', 'You told us this earlier · Edit') : T('c3.chip.fromProfile', 'From your profile · Edit') });
    }
    function fid(key) { return 'c3w-' + key; }
    function labelFor(text, mode, key) {
      var l = el('label', { class: 'form-label' });
      l.appendChild(document.createTextNode(text));
      if (mode === 'req') l.appendChild(el('span', { class: 'req', text: '*' }));
      else if (mode === 'opt') l.appendChild(el('span', { class: 'opt', text: T('c3.optional', '(optional)') }));
      if (prefilled[key]) l.appendChild(prefillChip(key));
      return l;
    }
    function errFor(key, msg) { return el('div', { class: 'form-error', id: 'c3w-err-' + key, text: msg }); }
    function inputField(key, label, mode, ph) {
      var g = el('div', { class: 'form-group' });
      g.appendChild(labelFor(label, mode, key));
      g.appendChild(el('input', { type: 'text', class: 'form-input', id: fid(key), value: state[key] || '', placeholder: ph || '' }));
      if (mode === 'req') g.appendChild(errFor(key, T('c3.validation.required', { field: label }, '{field} is required')));
      return g;
    }
    function areaField(key, label, mode, ph) {
      var g = el('div', { class: 'form-group' });
      g.appendChild(labelFor(label, mode, key));
      g.appendChild(el('textarea', { class: 'form-input', id: fid(key), placeholder: ph || '', rows: '3' }, [state[key] || '']));
      if (mode === 'req') g.appendChild(errFor(key, T('c3.validation.required', { field: label }, '{field} is required')));
      return g;
    }
    function dateFieldB(key, label, mode) {
      var g = el('div', { class: 'form-group' });
      g.appendChild(labelFor(label, mode, key));
      var n = el('input', { type: 'date', class: 'form-input', id: fid(key), max: todayISO() }); if (state[key]) n.value = state[key];
      g.appendChild(n);
      if (mode === 'req') g.appendChild(errFor(key, T('c3.validation.required', { field: label }, '{field} is required')));
      return g;
    }
    function selectFieldB(key, label, mode, opts) {
      var g = el('div', { class: 'form-group' });
      g.appendChild(labelFor(label, mode, key));
      var s = el('select', { class: 'form-input', id: fid(key) });
      opts.forEach(function (o) { var op = el('option', { value: o[0], text: o[1] }); if (o[0] === (state[key] || '')) op.selected = true; s.appendChild(op); });
      g.appendChild(s);
      if (mode === 'req') g.appendChild(errFor(key, T('c3.validation.required', { field: label }, '{field} is required')));
      return g;
    }
    function pairRow(a, b) {
      var w = el('div', { class: 'form-group' });
      var g = el('div', { class: 'form-row' });
      [a, b].forEach(function (c) { if (c) { c.style.marginBottom = '0'; g.appendChild(c); } else g.appendChild(el('div')); });
      w.appendChild(g); return w;
    }
    function optRow(key, opts, onpick) {
      var grp = el('div', { class: 'option-group', id: fid(key) });
      opts.forEach(function (o) {
        var card = el('div', { class: 'option-card' + (state[key] === o[0] ? ' selected' : ''), 'data-value': o[0] }, [
          el('div', { class: 'option-radio' }, [el('div', { class: 'option-radio-inner' })]),
          el('div', { class: 'option-label', text: o[1] })
        ]);
        card.addEventListener('click', function () {
          grp.querySelectorAll('.option-card').forEach(function (x) { x.classList.remove('selected'); });
          card.classList.add('selected');
          state[key] = o[0];
          if (onpick) onpick(o[0]);
          persist(); refreshNext();
        });
        grp.appendChild(card);
      });
      return grp;
    }
    function optGroup(key, label, opts, onpick) { var g = el('div', { class: 'form-group' }); if (label) g.appendChild(labelFor(label, '', key)); g.appendChild(optRow(key, opts, onpick)); return g; }
    function mhToggleRow() {
      var t = el('div', { class: 'toggle-switch' + (state.c33_releaseMentalHealth ? ' on' : '') }, [el('div', { class: 'toggle-knob' })]);
      t.addEventListener('click', function () { t.classList.toggle('on'); state.c33_releaseMentalHealth = t.classList.contains('on'); persist(); });
      return el('div', { class: 'toggle-row' }, [
        el('div', null, [el('div', { class: 'toggle-text', text: T('c3.mh.toggle', 'Also release mental-health records') }), el('div', { class: 'toggle-text-desc', text: T('c3.mh.toggleDesc', 'Optional and extra-sensitive. Off by default — only turn on to authorize it.') })]),
        t
      ]);
    }
    // Address / places hooks — Prompt C wires these; clean no-ops until then.
    // Prompt C typeahead hooks. Each degrades to a plain field when its service /
    // key is absent (the service modules no-op cleanly, never throw).
    var employerAddrSuggestion = ''; // Place Details address offered on card 14
    // mode 'place' searches POIs and streets as well as mailable addresses — see
    // address-autocomplete.js. "Where did the injury happen" is a PLACE ("One
    // State Street Plaza", "PS 9", the loading dock) far more often than it is a
    // deliverable address, and the address-only index returns nothing for those,
    // so that card looked like it had no typeahead at all.
    function attachAddress(key, mode) {
      var n = $(fid(key));
      if (!n || !CD.AddressAutocomplete || !CD.AddressAutocomplete.attach) return;
      try { CD.AddressAutocomplete.attach(n, { region: 'NY', mode: mode || 'address' }); } catch (e) {}
    }
    // Tailored-answer chips for the three free-text cards after the job card.
    // Each kind sees every answer given BEFORE it — that is what makes the
    // nature-of-injury suggestions name the body parts the worker actually
    // tapped. Fails silently to a plain textarea if the service is absent (the
    // website vendors this file without js/services/).
    function attachSuggest(kind, key, hostId) {
      if (!CD.C3Suggest || !CD.C3Suggest.attach) return;
      try {
        CD.C3Suggest.attach({
          kind: kind, textarea: $(fid(key)), host: $(hostId), supabase: supabase,
          ctx: {
            jobTitle: state.jobTitle, activities: state.activities, whatDoing: state.whatDoing,
            bodyParts: state.bodyParts,
            // ENGLISH labels on purpose: a chip's text is appended verbatim into
            // the textarea and lands on the PDF, which stays English exactly like
            // the "[Body parts: ...]" bracket written from the same BODY_LABELS.
            partLabel: function (p) { return BODY_LABELS[p] || p; }
          }
        });
      } catch (e) { console.warn('[C3] SUGGEST_ATTACH', e); }
    }
    function attachEmployer(key) {
      var n = $(fid(key));
      if (n && CD.EmployerAutocomplete && CD.EmployerAutocomplete.attach) {
        // On selection, the module fetches Place Details and offers the address on
        // the employer-address card — never auto-writes.
        try { CD.EmployerAutocomplete.attach(n, { onAddress: function (addr) { if (addr) employerAddrSuggestion = addr; } }); } catch (e) {}
      }
    }
    function attachDuties() {
      if (!CD.JobDuties || !CD.JobDuties.attach) return;
      try { CD.JobDuties.attach({ jobTitle: state.jobTitle, textarea: $(fid('activities')), host: $('c3w-duty-host'), supabase: supabase }); } catch (e) { console.warn('[C3] DUTIES_ATTACH', e); }
    }
    // "Use <employer address>?" — a dismissible offer chip on the employer-address
    // card. Never auto-writes; a TAP fills the field (the user's choice), dismiss
    // ignores it. If they already typed an address, the chip still just offers.
    function makeEmployerAddrChip(addr) {
      var wrap = el('div', { class: 'c3w-addr-offer' });
      wrap.appendChild(el('div', { class: 'c3w-addr-offer-label', text: T('c3.addrChip.label', 'Address of the employer you picked:') }));
      var use = el('button', { type: 'button', class: 'c3w-addr-use' }, [T('c3.addrChip.use', { addr: addr }, 'Use “{addr}”')]);
      use.addEventListener('click', function () { var n = $(fid('workAddress')); if (n) n.value = addr; state.workAddress = addr; persist(); refreshNext(); if (wrap.parentNode) wrap.parentNode.removeChild(wrap); });
      var x = el('button', { type: 'button', class: 'c3w-addr-dismiss', 'aria-label': T('c3.addrChip.dismiss', 'Dismiss'), text: '✕' });
      x.addEventListener('click', function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); });
      wrap.appendChild(el('div', { class: 'c3w-addr-offer-row' }, [use, x]));
      return wrap;
    }

    /* ---- field <-> state plumbing ------------------------------------- */
    var TEXT_KEYS = ['name', 'dob', 'ssn', 'gender', 'mailing', 'mailing2', 'mailingUnit', 'phone', 'email', 'jobTitle', 'activities',
      'doi', 'timeOfInjury', 'whereHappened', 'whatDoing', 'howHappened', 'nature', 'employer', 'workAddress', 'employerPhone',
      'concurrentEmployer', 'concurrentAddress', 'concurrentJob',
      'supervisor', 'noticeTo', 'noticeDate', 'stopWorkDate', 'returnDate', 'grossPay', 'payFreq', 'firstTreatDate', 'treatType',
      'firstTreatName', 'firstTreatPhone', 'treatingDoctors', 'treatingDoctorsPhone', 'c33_priorDesc', 'c33_providers', 'certName'];
    var TEXT_FIELDS = TEXT_KEYS.map(function (k) { return [fid(k), k]; });
    var SENSITIVE = { ssn: 1 }; // never persisted to the draft store; written only onto the PDF in memory
    var C33_FIELDS = [['c3w-c33s-name', 'name'], ['c3w-c33s-dob', 'dob'], ['c3w-c33s-ssn', 'ssn'], ['c3w-c33s-doi', 'doi'], ['c3w-c33s-mailing', 'mailing'], ['c3w-c33s-mailing2', 'mailing2'], ['c3w-c33s-injury', 'nature'], ['c3w-c33s-providers', 'c33_providers'], ['c3w-c33s-certName', 'certName']];
    function syncFromDom() {
      if (state.c33Only) { syncC33(); return; }
      TEXT_FIELDS.forEach(function (f) { var n = $(f[0]); if (n) state[f[1]] = n.value; });
    }
    function syncC33() { C33_FIELDS.forEach(function (f) { var n = $(f[0]); if (n) state[f[1]] = n.value; }); }

    // Delegated events on the single live card in the viewport.
    viewport.addEventListener('input', function () { syncFromDom(); refreshNext(); });
    viewport.addEventListener('change', function () { syncFromDom(); persist(); refreshNext(); });
    viewport.addEventListener('blur', function (e) { if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { syncFromDom(); persist(); } }, true);
    viewport.addEventListener('click', function (e) {
      var chip = e.target && e.target.closest ? e.target.closest('.c3w-chip') : null;
      if (chip) { var g = chip.closest('.form-group'); var inp = g && g.querySelector('input,select,textarea'); if (inp) { try { inp.focus(); if (inp.select) inp.select(); } catch (x) {} } }
    });

    /* ---- validation --------------------------------------------------- */
    function showErr(key) { var e = $('c3w-err-' + key); if (e) e.classList.add('visible'); var inp = $(fid(key)); if (inp && inp.classList) inp.classList.add('error'); }
    function clearErr(key) { var e = $('c3w-err-' + key); if (e) e.classList.remove('visible'); var inp = $(fid(key)); if (inp && inp.classList) inp.classList.remove('error'); }
    function isEmpty(key) { var v = state[key]; return !v || (Array.isArray(v) ? v.length === 0 : String(v).trim() === ''); }
    function validateCard(c, showErrors) {
      if (c.validate) return c.validate(showErrors);
      var ok = true;
      (c.required || []).forEach(function (key) { if (isEmpty(key)) { ok = false; if (showErrors) showErr(key); } else clearErr(key); });
      return ok;
    }

    /* ---- standalone C-3.3 entry link (card 1 only) -------------------- */
    function c33EntryLink() {
      var wrap = el('div', { class: 'c33-link' });
      var a = el('a', { text: T('c3.c33link', 'Just need the medical-records release? Complete Form C-3.3 (HIPAA) on its own →') });
      a.addEventListener('click', function (e) { e.preventDefault(); try { syncFromDom(); } catch (x) {} goToStandaloneC33(); });
      wrap.appendChild(a);
      return wrap;
    }

    /* ================= THE CARD DECK ==================================== */
    // One card = 2–3 related fields, sized to never scroll at 320×568. Each card
    // declares a `section` so Review can group by it. Conditional cards carry a
    // `skip()` and drop out of the live deck (and the denominator) when their gate
    // answer removes them. Prompt C wires the address / places / duties hooks.
    var S0 = SECTIONS[0], S1 = SECTIONS[1], S2 = SECTIONS[2], S3 = SECTIONS[3];
    var CARDS = [
      { key: 'route', section: S0, skip: function () { return !hasAtty; }, icon: '⚖️', title: T('c3.cards.route.title', 'How would you like to file?'),
        build: function (card) {
          card.appendChild(helper(T('c3.cards.route.helper', 'You told us you have an attorney. They may prefer to file this for you — choose how to proceed.')));
          function branchCard(icon, title, desc, branch) {
            var b = el('div', { class: 'option-card', style: 'width:100%;align-items:flex-start;margin-bottom:10px' }, [
              el('div', { style: 'font-size:20px;line-height:1', text: icon }),
              el('div', null, [el('div', { class: 'option-label', text: title }), el('div', { class: 'toggle-text-desc', text: desc })])
            ]);
            b.addEventListener('click', function () { state.branch = branch; persist(); var l = deckList(); var j = stepIndex(l, 'route'); if (j >= 0 && j < l.length - 1) goToCard(l[j + 1].key); });
            return b;
          }
          card.appendChild(branchCard('🙋', T('c3.cards.route.selfTitle', 'File it myself'), T('c3.cards.route.selfDesc', 'Build the C-3 and file it with the WCB on your own.'), 'self'));
          card.appendChild(branchCard('⚖️', T('c3.cards.route.attyTitle', 'Prepare it and send to my attorney'), T('c3.cards.route.attyDesc', 'We’ll build the C-3, then give you the PDF and your attorney’s email.'), 'attorney'));
        } },
      { key: 'name_dob', section: S0, required: ['name', 'dob'], icon: '👤', title: T('c3.cards.nameDob.title', 'Your legal name'),
        build: function (card) {
          card.appendChild(helper(T('c3.cards.nameDob.helper', 'We filled in what we already had. Tap any box to fix it.')));
          card.appendChild(inputField('name', T('c3.fields.name', 'Full legal name'), 'req', T('c3.fields.namePh', 'First MI Last')));
          card.appendChild(dateFieldB('dob', T('c3.fields.dob', 'Date of birth'), 'req'));
          card.appendChild(c33EntryLink());
        } },
      { key: 'ssn_gender', section: S0, required: ['gender'], icon: '🪪', title: T('c3.cards.ssnGender.title', 'A couple more details'),
        build: function (card) {
          card.appendChild(inputField('ssn', T('c3.fields.ssn', 'Social Security Number'), 'opt', 'XXX-XX-XXXX'));
          card.appendChild(el('div', { class: 'form-hint', text: T('c3.fields.ssnHint', 'SSN is voluntary on the C-3 — you may leave it blank. We never store it; it only goes onto the form you download.') }));
          card.appendChild(selectFieldB('gender', T('c3.fields.gender', 'Gender'), 'req', [['', T('c3.selectPlaceholder', 'Select…')], ['M', T('c3.genderM', 'Male')], ['F', T('c3.genderF', 'Female')]]));
        } },
      { key: 'mailing', section: S0, required: ['mailing'], icon: '✉️', title: T('c3.cards.mailing.title', 'Your mailing address'),
        build: function (card) {
          card.appendChild(helper(T('c3.cards.mailing.helper', 'This is where the Board will mail letters about your claim.')));
          card.appendChild(inputField('mailing', T('c3.fields.mailing', 'Mailing address'), 'req', T('c3.fields.mailingPh', 'Number and street')));
          // Was "City, State, ZIP" — dead weight, because picking a suggestion in
          // the box above commits the city, state and ZIP already. The apartment
          // is the one part of an address the typeahead genuinely cannot know.
          card.appendChild(inputField('mailingUnit', T('c3.fields.mailingUnit', 'Apartment / unit number'), 'opt', T('c3.fields.mailingUnitPh', 'Apt 4B, if any')));
        }, after: function () { attachAddress('mailing'); } },
      { key: 'contact', section: S0, required: ['phone'], icon: '📞', title: T('c3.cards.contact.title', 'How to reach you'),
        build: function (card) {
          card.appendChild(inputField('phone', T('c3.fields.phone', 'Phone'), 'req', '(212) 555-1234'));
          card.appendChild(inputField('email', T('c3.fields.email', 'Email'), 'opt', 'you@example.com'));
        } },
      { key: 'job', section: S0, required: ['jobTitle'], icon: '🧰', title: T('c3.cards.job.title', 'Your job'),
        build: function (card) {
          card.appendChild(helper(T('c3.cards.job.helperPre', 'Tell us the job you were doing when you got hurt. Your pay later helps set your '), gloss('AWW'), T('c3.cards.job.helperPost', '.')));
          card.appendChild(inputField('jobTitle', T('c3.fields.jobTitle', 'Job title or description'), 'req', T('c3.fields.jobTitlePh', 'e.g. Warehouse associate')));
        } },
      { key: 'duties', section: S0, icon: '🛠️', title: T('c3.cards.duties.title', 'Your job duties'),
        build: function (card) {
          card.appendChild(helper(T('c3.cards.duties.helper', 'What did you physically do on this job? Everyday words are perfect.')));
          card.appendChild(areaField('activities', T('c3.fields.activities', 'What were your physical job duties?'), 'opt', T('c3.fields.activitiesPh', 'e.g. lifting boxes, driving a forklift, standing all day')));
          // Job-duties suggestion chips (issue #5) render here — local-first, AI on
          // a miss. Chips APPEND lines; the textarea is never auto-filled.
          card.appendChild(el('div', { id: 'c3w-duty-host' }));
        }, after: function () { attachDuties(); } },
      { key: 'when', section: S1, required: ['doi'], icon: '📅',
        title: function () { return isOD() ? T('c3.cards.when.titleOD', 'When it began') : T('c3.cards.when.title', 'When it happened'); },
        build: function (card) {
          // The claim-type fork lives on the FIRST card of Section D (the C-3's
          // "Your injury or illness"), because it changes how every question in
          // that section should read. Re-renders the card so the date label and
          // the time-of-injury question follow the pick immediately.
          card.appendChild(optGroup('claimType', T('c3.fields.claimType', 'What kind of claim is this?'), [
            ['accident', T('c3.claimTypeAccident', 'One accident or event')],
            ['occupational_disease', T('c3.claimTypeOD', 'Built up over time')]
          ], function () { syncFromDom(); persist(); goToCard('when', true); }));
          if (isOD()) {
            card.appendChild(helper(T('c3.cards.when.helperODPre', 'For an illness that built up over time, the '), gloss('DOI'),
              T('c3.cards.when.helperODPost', ' is your date of disablement — generally when the condition first stopped you working, changed your duties, or sent you for care. An approximate date is fine; the Board can refine it.')));
            card.appendChild(dateFieldB('doi', T('c3.fields.doiOD', 'Date of disablement or onset'), 'req'));
            // No time-of-injury for an occupational disease — there is no single
            // moment to name, and the C-3's time box is optional.
          } else {
            card.appendChild(helper(T('c3.cards.when.helperPre', 'The date of injury (your '), gloss('DOI'), T('c3.cards.when.helperPost', ') is the day you got hurt, or first noticed a work-related illness.')));
            card.appendChild(dateFieldB('doi', T('c3.fields.doi', 'Date of injury / onset'), 'req'));
            card.appendChild(inputField('timeOfInjury', T('c3.fields.timeOfInjury', 'Time of injury'), 'opt', T('c3.fields.timeOfInjuryPh', 'e.g. 2:30')));
            card.appendChild(optGroup('ampm', T('c3.fields.ampm', 'AM or PM?'), [['AM', T('c3.ampmAm', 'AM')], ['PM', T('c3.ampmPm', 'PM')]]));
          }
        } },
      { key: 'where', section: S1, required: ['whereHappened'], icon: '📍', title: T('c3.cards.where.title', 'Where it happened'),
        build: function (card) {
          card.appendChild(helper(T('c3.cards.where.helper', 'The address or place where the injury happened.')));
          card.appendChild(inputField('whereHappened', T('c3.fields.whereHappened', 'Where did it happen?'), 'req', T('c3.fields.whereHappenedPh', 'e.g. 1 Main Street, at the loading dock')));
        }, after: function () { attachAddress('whereHappened', 'place'); } },
      { key: 'doing', section: S1, required: ['whatDoing'], icon: '🏃',
        title: function () { return isOD() ? T('c3.cards.doing.titleOD', 'The work that caused it') : T('c3.cards.doing.title', 'What you were doing'); },
        build: function (card) {
          card.appendChild(helper(T('c3.cards.doing.helper', 'Describe it like you’d tell a friend.')));
          // The C-3's own box reads "...when you were injured OR BECAME ILL" —
          // the wizard asked only the accident half of its own question.
          card.appendChild(isOD()
            ? areaField('whatDoing', T('c3.fields.whatDoingOD', 'What work were you doing that made you ill?'), 'req', T('c3.fields.whatDoingODPh', 'e.g. running a jackhammer daily, spraying paint in a closed booth'))
            : areaField('whatDoing', T('c3.fields.whatDoing', 'What were you doing when it happened?'), 'req', T('c3.fields.whatDoingPh', 'e.g. unloading a truck, typing a report')));
          card.appendChild(el('div', { id: 'c3w-doing-host' }));
        }, after: function () { attachSuggest('what_doing', 'whatDoing', 'c3w-doing-host'); } },
      { key: 'how', section: S1, required: ['howHappened'], icon: '⚠️',
        title: function () { return isOD() ? T('c3.cards.how.titleOD', 'How it developed') : T('c3.cards.how.title', 'How it happened'); },
        build: function (card) {
          card.appendChild(isOD()
            ? areaField('howHappened', T('c3.fields.howHappenedOD', 'How did the illness develop?'), 'req', T('c3.fields.howHappenedODPh', 'e.g. after years of loud machinery my hearing got worse and worse'))
            : areaField('howHappened', T('c3.fields.howHappened', 'How did the injury / illness happen?'), 'req', T('c3.fields.howHappenedPh', 'e.g. I tripped over a pipe and fell on the floor')));
          card.appendChild(el('div', { id: 'c3w-how-host' }));
        }, after: function () { attachSuggest('how_happened', 'howHappened', 'c3w-how-host'); } },
      { key: 'body', section: S1, icon: '🩹',
        title: function () { return isOD() ? T('c3.cards.body.titleOD', 'Body parts affected') : T('c3.cards.body.title', 'Body parts injured'); },
        sub: function () { return isOD() ? T('c3.cards.body.subOD', 'Tap every part the condition affects — pick more than one.') : T('c3.cards.body.sub', 'Tap every part that was hurt — pick more than one.'); },
        build: function (card) {
          var grid = el('div', { class: 'chip-grid', id: 'c3w-body-grid' });
          BODY_PARTS.forEach(function (bp) {
            var chip = el('div', { class: 'chip' + (state.bodyParts.indexOf(bp[0]) >= 0 ? ' selected' : ''), 'data-part': bp[0], text: bodyPartLabel(bp[0]) });
            chip.addEventListener('click', function () {
              chip.classList.toggle('selected');
              if (chip.classList.contains('selected')) { if (state.bodyParts.indexOf(bp[0]) < 0) state.bodyParts.push(bp[0]); }
              else state.bodyParts = state.bodyParts.filter(function (x) { return x !== bp[0]; });
              grid.classList.remove('error'); var e = $('c3w-err-bodyParts'); if (e) e.classList.remove('visible'); persist(); refreshNext();
            });
            grid.appendChild(chip);
          });
          card.appendChild(grid);
          card.appendChild(errFor('bodyParts', T('c3.validation.selectBodyPart', 'Select at least one body part')));
        },
        validate: function (showErrors) { var ok = state.bodyParts.length > 0; if (!ok && showErrors) { var e = $('c3w-err-bodyParts'); if (e) e.classList.add('visible'); var g = $('c3w-body-grid'); if (g) g.classList.add('error'); } return ok; } },
      { key: 'nature', section: S1, required: ['nature'], icon: '📝', title: T('c3.cards.nature.title', 'Nature of injury'),
        build: function (card) {
          card.appendChild(helper(T('c3.cards.nature.helper', 'In plain words, what’s wrong?')));
          card.appendChild(areaField('nature', T('c3.fields.nature', 'What’s wrong? (e.g. torn rotator cuff, herniated disc)'), 'req', T('c3.fields.naturePh', 'List what’s hurt')));
          card.appendChild(el('div', { id: 'c3w-nature-host' }));
        }, after: function () { attachSuggest('nature', 'nature', 'c3w-nature-host'); } },
      { key: 'employer', section: S2, required: ['employer'], icon: '🏢', title: T('c3.cards.employer.title', 'Your employer'),
        build: function (card) {
          card.appendChild(helper(T('c3.cards.employer.helper', 'The company you worked for when you got hurt — the claim is filed against them.')));
          card.appendChild(inputField('employer', T('c3.fields.employer', 'Employer name'), 'req', T('c3.fields.employerPh', 'Company name')));
        }, after: function () { attachEmployer('employer'); } },
      { key: 'employer_addr', section: S2, icon: '🏢', title: T('c3.cards.employerAddr.title', 'Employer address'),
        build: function (card) {
          card.appendChild(inputField('workAddress', T('c3.fields.workAddress', 'Employer address'), 'opt', T('c3.fields.workAddressPh', 'Where you worked')));
          if (employerAddrSuggestion) card.appendChild(makeEmployerAddrChip(employerAddrSuggestion));
          // B2 on the C-3. Its two boxes were mapped but nothing ever filled them.
          card.appendChild(inputField('employerPhone', T('c3.fields.employerPhone', 'Employer phone'), 'opt', '(212) 555-1234'));
          // B6 lives on its own card, which only joins the deck once this is
          // tapped — a worker with one job never sees an extra step.
          if (!state.hasConcurrent) {
            var add = el('button', { type: 'button', class: 'c3w-add-btn' }, [T('c3.cards.concurrent.add', '+ Add a concurrent employer')]);
            add.addEventListener('click', function () { syncFromDom(); state.hasConcurrent = true; persist(); goToCard('concurrent'); });
            card.appendChild(add);
            card.appendChild(el('div', { class: 'form-hint', text: T('c3.cards.concurrent.hint', 'Had a second job at the time of the injury? Those wages count toward your benefit rate.') }));
          }
        }, after: function () { attachAddress('workAddress'); } },
      // B6 — "List names/addresses of any other employers at the time of your
      // injury/illness". Conditional, so the deck stays 24 cards for everyone who
      // had one job. Written across B6's stub box plus its two full-width ruled
      // lines, so a name AND an address fit at the same size as the rest of the
      // form rather than being shrunk into the stub.
      { key: 'concurrent', section: S2, skip: function () { return !state.hasConcurrent; }, icon: '🧾',
        title: T('c3.cards.concurrent.title', 'Your other employer'),
        build: function (card) {
          card.appendChild(helper(T('c3.cards.concurrent.helper', 'The other job you were working at the time you got hurt. The Board counts those wages too.')));
          card.appendChild(inputField('concurrentEmployer', T('c3.fields.concurrentEmployer', 'Other employer name'), 'opt', T('c3.fields.concurrentEmployerPh', 'Company name')));
          card.appendChild(inputField('concurrentAddress', T('c3.fields.concurrentAddress', 'Their address'), 'opt', T('c3.fields.concurrentAddressPh', 'Where that job was')));
          var rm = el('button', { type: 'button', class: 'c3w-remove-btn' }, [T('c3.cards.concurrent.remove', 'Remove this employer')]);
          rm.addEventListener('click', function () {
            syncFromDom();
            state.hasConcurrent = false; state.concurrentEmployer = ''; state.concurrentAddress = '';
            persist(); goToCard('employer_addr');
          });
          card.appendChild(rm);
        },
        after: function () {
          var n = $(fid('concurrentEmployer'));
          if (n && CD.EmployerAutocomplete && CD.EmployerAutocomplete.attach) { try { CD.EmployerAutocomplete.attach(n, {}); } catch (e) {} }
          attachAddress('concurrentAddress');
        } },
      { key: 'supervisor_notice', section: S2, icon: '🗣️', title: T('c3.cards.supervisorNotice.title', 'Reporting it'),
        build: function (card) {
          card.appendChild(helper(T('c3.cards.supervisorNotice.helperPre', 'Telling your boss you were hurt matters to the '), gloss('WCB'), T('c3.cards.supervisorNotice.helperPost', '.')));
          card.appendChild(inputField('supervisor', T('c3.fields.supervisor', 'Supervisor’s name'), 'opt', ''));
          card.appendChild(optGroup('gaveNotice', T('c3.fields.gaveNotice', 'Did you tell them?'), [['yes', T('c3.yes', 'Yes')], ['no', T('c3.no', 'No')]]));
        } },
      // Only asked of someone who SAID they reported it — the C-3's whole notice
      // block is conditional on that Yes, and asking "how did you tell them" of
      // someone who answered No collected an answer the form has nowhere to put.
      { key: 'notice_detail', section: S2, skip: function () { return state.gaveNotice === 'no'; }, icon: '📨', title: T('c3.cards.noticeDetail.title', 'How you reported it'),
        build: function (card) {
          // The C-3 asks WHO notice was given to, and the wizard never did — so
          // that box came off the printer blank on every filing. Defaults to the
          // supervisor named on the previous card, and stays editable: notice
          // often goes to a foreman, a dispatcher or an HR office instead.
          if (!state.noticeTo && state.supervisor) { state.noticeTo = state.supervisor; prefilled.noticeTo = true; }
          card.appendChild(inputField('noticeTo', T('c3.fields.noticeTo', 'Who did you tell?'), 'opt', T('c3.fields.noticeToPh', 'Supervisor, foreman, or HR')));
          card.appendChild(dateFieldB('noticeDate', T('c3.fields.noticeDate', 'Date you notified your employer'), 'opt'));
          // The C-3 records oral vs written notice; a text message is filed as
          // "in writing" (state.noticeMethod stays canonical for the PDF).
          card.appendChild(optGroup('noticeHow', T('c3.fields.noticeHow', 'How did you tell them?'), [['orally', T('c3.noticeVerbal', 'Verbal')], ['in_writing', T('c3.noticeWritten', 'Written')], ['text', T('c3.noticeText', 'Text')]], function (v) { state.noticeMethod = (v === 'orally') ? 'orally' : 'in_writing'; }));
        } },
      { key: 'lost_time', section: S3, icon: '🛌', title: T('c3.cards.lostTime.title', 'Time off work'),
        build: function (card) {
          card.appendChild(helper(T('c3.cards.lostTime.helper', 'Light duty still counts as working.')));
          card.appendChild(optGroup('stoppedWork', T('c3.fields.stoppedWork', 'Did you lose time from work?'), [['yes', T('c3.yes', 'Yes')], ['no', T('c3.no', 'No')]], function () { rerender(); }));
          if (state.stoppedWork === 'yes') card.appendChild(dateFieldB('stopWorkDate', T('c3.fields.stopWorkDate', 'Last day you worked'), 'opt'));
        } },
      { key: 'returned', section: S3, skip: function () { return state.stoppedWork === 'no'; }, icon: '🔄', title: T('c3.cards.returned.title', 'Back to work?'),
        build: function (card) {
          card.appendChild(optGroup('returnedWork', T('c3.fields.returnedWork', 'Have you returned to work?'), [['no', T('c3.no', 'No')], ['yes', T('c3.yes', 'Yes')]], function () { rerender(); }));
          if (state.returnedWork === 'yes') {
            card.appendChild(dateFieldB('returnDate', T('c3.fields.returnDate', 'Date you returned'), 'opt'));
            card.appendChild(optGroup('returnDuty', T('c3.fields.returnDuty', 'Duty type'), [['regular', T('c3.dutyRegular', 'Regular duty')], ['limited', T('c3.dutyLimited', 'Limited duty')]]));
          }
        } },
      { key: 'wages', section: S3, icon: '💵', title: T('c3.cards.wages.title', 'Your wages'),
        build: function (card) {
          card.appendChild(helper(T('c3.cards.wages.helperPre', 'Your pay before taxes — helps set your '), gloss('AWW'), T('c3.cards.wages.helperPost', '.')));
          card.appendChild(inputField('grossPay', T('c3.fields.grossPay', 'Rate of pay per pay period'), 'opt', '$0.00'));
          card.appendChild(inputField('payFreq', T('c3.fields.payFreq', 'Pay frequency'), 'opt', T('c3.fields.payFreqPh', 'e.g. Weekly')));
        } },
      { key: 'first_treat', section: S3, icon: '🩺', title: T('c3.cards.firstTreat.title', 'First treatment'),
        build: function (card) {
          card.appendChild(dateFieldB('firstTreatDate', T('c3.fields.firstTreatDate', 'Date of first treatment'), 'opt'));
          card.appendChild(selectFieldB('treatType', T('c3.fields.treatType', 'Where first treated?'), 'opt', [['', T('c3.selectPlaceholder', 'Select…')]].concat(treatTypeOptions())));
          card.appendChild(inputField('firstTreatName', T('c3.fields.firstTreatName', 'Name & address where first treated'), 'opt', ''));
          // F2's phone boxes were mapped but never collected — same two-box
          // layout as the treating-doctor phone below.
          card.appendChild(inputField('firstTreatPhone', T('c3.fields.firstTreatPhone', 'Their phone'), 'opt', '(212) 555-1234'));
          // 'place' mode: a hospital or urgent care is a POI ("Mount Sinai
          // Brooklyn"), which the address-only index does not return.
        }, after: function () { attachAddress('firstTreatName', 'place'); } },
      { key: 'provider', section: S3, icon: '👩‍⚕️', title: T('c3.cards.provider.title', 'Your treating doctor'),
        build: function (card) {
          card.appendChild(helper(T('c3.cards.provider.helperPre', 'The doctor treating you now for this injury. An '), gloss('IME'), T('c3.cards.provider.helperPost', ' is a different exam the insurer may send you to.')));
          card.appendChild(inputField('treatingDoctors', T('c3.fields.treatingDoctors', 'Provider name & address'), 'opt', T('c3.fields.treatingDoctorsPh', 'Name & address')));
          card.appendChild(inputField('treatingDoctorsPhone', T('c3.fields.treatingDoctorsPhone', 'Their phone'), 'opt', '(212) 555-1234'));
        }, after: function () { attachAddress('treatingDoctors', 'place'); } },
      { key: 'prior', section: S3, icon: '🕓', title: T('c3.cards.prior.title', 'Prior injury'),
        build: function (card) {
          card.appendChild(helper(T('c3.cards.prior.helperPre', 'If you hurt this same body part before, New York needs a short release — the '), gloss('C-3.3'), T('c3.cards.prior.helperPost', '. We’ll build it automatically.')));
          card.appendChild(optGroup('priorInjury', T('c3.fields.priorInjury', 'Any prior injury to the same body part, or a similar illness?'), [['no', T('c3.no', 'No')], ['yes', T('c3.yes', 'Yes')]], function () { refreshNext(); }));
        } },
      { key: 'prior_desc', section: S3, skip: function () { return state.priorInjury !== 'yes'; }, icon: '🔏', title: T('c3.cards.priorDesc.title', 'About the prior injury'),
        build: function (card) {
          card.appendChild(helper(T('c3.cards.priorDesc.helper', 'We’ll generate Form C-3.3 too, so the doctors who treated your earlier injury can release those records to the insurer.')));
          card.appendChild(areaField('c33_priorDesc', T('c3.fields.c33PriorDesc', 'Describe the previous injury / illness'), 'opt', T('c3.fields.c33PriorDescPh', 'What happened, and when')));
          card.appendChild(areaField('c33_providers', T('c3.fields.c33Providers', 'Doctor(s) who treated it (name & address)'), 'opt', T('c3.fields.c33ProvidersPh', 'One per line')));
          card.appendChild(mhToggleRow());
        } },
      { key: 'review', icon: '✅', title: T('c3.cards.review.title', 'Review your answers'), sub: T('c3.cards.review.sub', 'Tap Edit to change a section.'), scrolls: true,
        build: function (card) { buildReview(card); } },
      { key: 'certify', icon: '✍️', title: T('c3.cards.certify.title', 'Certify & sign'),
        build: function (card) { buildCertify(card); }, after: function () { afterCertify(); },
        validate: function (showErrors) { syncFromDom(); var ok = true; if (isEmpty('certName')) { ok = false; if (showErrors) showErr('certName'); } else clearErr('certName'); if (!certAgreed.v) ok = false; if (!sig.drawn) ok = false; return ok; } }
    ];

    /* ---- Review + Certify builders ------------------------------------ */
    function buildReview(card) {
      syncFromDom();
      function grp(section, rows) {
        var g = el('div', { class: 'review-group' });
        g.appendChild(el('div', { class: 'review-group-title' }, [
          document.createTextNode(secLabel(section)),
          el('button', { class: 'review-edit-btn', onclick: function () { var k = firstCardKeyInSection(section); if (k) goToCard(k); } }, [T('c3.review.edit', 'Edit')])
        ]));
        rows.forEach(function (r) { g.appendChild(el('div', { class: 'review-row' }, [el('span', { class: 'review-label', text: r[0] }), el('span', { class: 'review-value' + (r[1] ? '' : ' empty'), text: r[1] || T('c3.review.notProvided', 'Not provided') })])); });
        return g;
      }
      var YES = T('c3.yes', 'Yes'), NO = T('c3.no', 'No');
      card.appendChild(grp(S0, [[T('c3.review.name', 'Name'), state.name], [T('c3.review.dob', 'DOB'), fmtDate(state.dob)], [T('c3.review.job', 'Job'), state.jobTitle]]));
      card.appendChild(grp(S1, [[T('c3.review.date', 'Date'), fmtDate(state.doi)], [T('c3.review.where', 'Where'), state.whereHappened], [T('c3.review.bodyParts', 'Body parts'), state.bodyParts.length ? state.bodyParts.map(function (p) { return bodyPartLabel(p); }).join(', ') : '']]));
      card.appendChild(grp(S2, [[T('c3.review.employer', 'Employer'), state.employer], [T('c3.review.toldEmployer', 'Told employer'), state.gaveNotice === 'yes' ? YES : (state.gaveNotice === 'no' ? NO : '')]]));
      card.appendChild(grp(S3, [[T('c3.review.treatingDoctor', 'Treating doctor'), state.treatingDoctors], [T('c3.review.returnedToWork', 'Returned to work'), state.returnedWork === 'yes' ? YES : (state.returnedWork === 'no' ? NO : '')], [T('c3.review.priorInjury', 'Prior injury (C-3.3)'), state.priorInjury === 'yes' ? T('c3.review.yesIncluded', 'Yes — included') : (state.priorInjury === 'no' ? NO : '')]]));
      if (!hasAtty && state.branch !== 'attorney' && typeof CD.AttorneyCTA === 'function') {
        var _reviewCta = CD.AttorneyCTA({ variant: 'inline', source: 'c3_complete', context: _offRampPrefill() });
        if (_reviewCta) card.appendChild(el('div', { style: 'margin-top:16px' }, [_reviewCta]));
      }
    }
    function buildCertify(card) {
      // Signatures are NEVER persisted (like the SSN) — reset on every (re)build.
      sig.drawn = false; sig.canvas = null;
      // The attestation is a certification, not a footnote — .agw-certify exists
      // because burying one in small print is how a filing becomes a problem
      // later. .c3w-helper is KEPT and listed first: this file is vendored to the
      // website, which loads neither widgets.css nor aurora-glass.css, so
      // .agw-certify / .ag-glass-2 are inert there and the site renders as today.
      // The wording is untouched.
      card.appendChild(el('div', { class: 'c3w-helper agw-certify ag-glass-2' }, [
        el('span', { class: 'agw-certify-txt' }, [
          T('c3.cards.certify.helperPre', 'Your '),
          gloss('C-3'),
          T('c3.cards.certify.helperPost', ' is a sworn legal form. Only sign once everything above is true.')
        ])
      ]));
      card.appendChild(inputField('certName', T('c3.fields.certName', 'Type your full legal name to certify'), 'req', T('c3.fields.certNamePh', 'Your full legal name')));
      sigCanvas = el('canvas', { class: 'sig-pad', id: 'c3w-sig' });
      card.appendChild(el('div', { class: 'form-group' }, [
        el('label', { class: 'form-label', text: T('c3.fields.drawSignature', 'Draw your signature') }),
        el('div', { class: 'sig-pad-wrap' }, [sigCanvas, el('button', { class: 'sig-clear', type: 'button', onclick: function () { clearSig(); refreshNext(); } }, [T('c3.fields.clear', 'Clear')])])
      ]));
      var ct = el('div', { class: 'toggle-switch' + (certAgreed.v ? ' on' : '') }, [el('div', { class: 'toggle-knob' })]);
      ct.addEventListener('click', function () { ct.classList.toggle('on'); certAgreed.v = ct.classList.contains('on'); refreshNext(); });
      card.appendChild(el('div', { class: 'toggle-row' }, [el('div', null, [el('div', { class: 'toggle-text', text: T('c3.certifyToggle', 'I certify the above is true') })]), ct]));
    }
    function afterCertify() {
      initSig(sigCanvas);
      // Enable Next the moment a stroke lands (initSig sets sig.drawn but can't
      // reach refreshNext from module scope).
      if (sigCanvas) { sigCanvas.addEventListener('pointerdown', function () { setTimeout(refreshNext, 0); }); sigCanvas.addEventListener('pointerup', function () { refreshNext(); }); }
    }

    /* ---- navigation --------------------------------------------------- */
    function deckList() { return CARDS.filter(function (c) { return !(c.skip && c.skip()); }); }
    function stepIndex(list, key) { for (var i = 0; i < list.length; i++) if (list[i].key === key) return i; return -1; }
    function firstCardKeyInSection(section) { var l = deckList(); for (var i = 0; i < l.length; i++) if (l[i].section === section) return l[i].key; return null; }
    function firstDataKey() { var l = deckList(); return l.length ? l[0].key : 'name_dob'; }
    // CONTINUITY: push the C-3's collected fields into the ONE local worker
    // profile on every card advance. SSN is DELIBERATELY not mapped — it never
    // enters the store (it lives only in in-memory state + on the PDF).
    function syncToStore() {
      try {
        if (!CD.WorkerProfile || !CD.WorkerProfile.merge) return;
        var nm = splitName(state.name || '');
        CD.WorkerProfile.merge({
          full_name: state.name || undefined,
          first_name: nm.first || undefined,
          last_name: nm.last || undefined,
          dob: state.dob || undefined,
          gender: state.gender || undefined,
          phone: state.phone || undefined,
          email: state.email || undefined,
          home_address: state.mailing || undefined,
          job_title: state.jobTitle || undefined,
          job_duties: state.activities || undefined,
          employer_name: state.employer || undefined,
          employer_address: state.workAddress || undefined,
          supervisor_name: state.supervisor || undefined,
          date_of_injury: state.doi || undefined,
          body_parts: (state.bodyParts && state.bodyParts.length) ? state.bodyParts.slice() : undefined,
          injury_description: state.howHappened || undefined,
          lost_time: state.stoppedWork === 'yes' ? true : (state.stoppedWork === 'no' ? false : undefined),
          last_day_worked: state.stopWorkDate || undefined,
          returned_to_work: state.returnedWork === 'yes' ? true : (state.returnedWork === 'no' ? false : undefined),
          wage_rate: state.grossPay || undefined,
          pay_frequency: state.payFreq || undefined,
          first_treatment_date: state.firstTreatDate || undefined,
          treating_provider: state.treatingDoctors || undefined,
          language_pref: state.language || undefined
        }, { source: 'c3' });
      } catch (e) {}
    }
    function goToCard(key, noSync) {
      if (!noSync) { try { syncFromDom(); } catch (e) {} }
      var list = deckList();
      var i = stepIndex(list, key);
      if (i < 0) { i = 0; key = list[0].key; }
      curKey = key; state.cardKey = key; state.step = i; persist(); syncToStore();
      renderCard(list[i], i, list.length);
    }
    function rerender() { var list = deckList(); var i = stepIndex(list, curKey); if (i < 0) i = 0; renderCard(list[i], i, list.length); }
    function renderCard(c, i, total) {
      viewport.className = 'c3w-viewport' + (c.scrolls ? ' scroll' : '');
      viewport.innerHTML = '';
      var card = el('div', { class: 'c3w-card' });
      card.appendChild(cardHead(c));
      try { c.build(card); } catch (e) { console.error('[C3] CARD_BUILD_FAILED', c.key, e); }
      viewport.appendChild(card);
      if (c.after) { try { c.after(); } catch (e) { console.warn('[C3] CARD_AFTER', c.key, e); } }
      updateChrome(c, i, total);
      wireFooter(c, i, total);
      try { viewport.scrollTop = 0; } catch (e) {}
      applyVV();
      refreshNext();
    }
    function updateChrome(c, i, total) {
      progress.style.display = '';
      barFill.style.width = Math.round(((i + 1) / total) * 100) + '%';
      counterEl.innerHTML = '';
      counterEl.appendChild(document.createTextNode(T('c3.progress.step', { n: String(i + 1), total: String(total) }, 'Step {n} of {total}')));
      if (c.section) counterEl.appendChild(el('span', { class: 'c3w-sec', text: ' · ' + secLabel(c.section) }));
      var left = total - (i + 1);
      etaEl.textContent = left > 0 ? T('c3.progress.eta', { min: String(Math.max(1, Math.round(left * 0.5))) }, 'about {min} min left') : T('c3.progress.lastStep', 'Last step');
    }
    function wireFooter(c, i, total) {
      var list = deckList();
      backBtn.textContent = i > 0 ? T('c3.back', 'Back') : T('c3.exit', 'Exit');
      backBtn.onclick = function () { if (i > 0) goToCard(list[i - 1].key); else { try { syncFromDom(); persist(); } catch (e) {} goDash(); } };
      nextBtn.removeAttribute('id'); nextBtn.disabled = false;
      if (c.key === 'certify') {
        nextBtn.textContent = T('c3.generateC3', 'Generate & File My C-3'); nextBtn.id = 'c3w-generate';
        nextBtn.onclick = function () { if (nextBtn.disabled) return; syncFromDom(); beforeExport(certAgreed.v); };
      } else if (c.key === 'review') {
        nextBtn.textContent = T('c3.looksGoodSign', 'Looks good — sign');
        nextBtn.onclick = function () { goToCard('certify'); };
      } else {
        nextBtn.textContent = T('c3.continue', 'Continue');
        nextBtn.onclick = function () { if (nextBtn.disabled) return; if (validateCard(c, true)) { var l = deckList(); var j = stepIndex(l, c.key); if (j >= 0 && j < l.length - 1) goToCard(l[j + 1].key); } };
      }
    }
    function refreshNext() {
      var list = deckList(); var i = stepIndex(list, curKey); if (i < 0) return; var c = list[i];
      if (c.key === 'review') { nextBtn.disabled = false; return; }
      nextBtn.disabled = !validateCard(c, false);
    }

    /* ---- standalone C-3.3 mini-deck (no numbered progress) ------------ */
    var c33Cards = [
      { key: 'c33_identity', icon: '🔏', title: T('c3.c33cards.identity.title', 'Medical Records Release (C-3.3)'), sub: T('c3.c33cards.identity.sub', 'Authorize the doctors who treated a previous injury to release those records to the insurer.'),
        build: function (card) {
          card.appendChild(helper(T('c3.c33cards.identity.helperPre', 'This '), gloss('C-3.3'), T('c3.c33cards.identity.helperPost', ' release only covers records from a doctor who treated an earlier injury to the same body part.')));
          card.appendChild(c33Text('c3w-c33s-name', T('c3.fields.name', 'Full legal name'), state.name, T('c3.fields.namePh', 'First MI Last')));
          card.appendChild(el('div', { class: 'form-error', id: 'c3w-err-c33s-name', text: T('c3.validation.c33Name', 'Your full legal name is required') }));
          card.appendChild(c33Date('c3w-c33s-dob', T('c3.fields.dob', 'Date of birth'), state.dob));
          card.appendChild(c33Text('c3w-c33s-ssn', T('c3.fields.ssnOptional', 'Social Security Number (optional)'), state.ssn, 'XXX-XX-XXXX'));
          card.appendChild(c33Date('c3w-c33s-doi', T('c3.fields.doiCurrent', 'Date of current injury / illness'), state.doi));
        } },
      { key: 'c33_injury', icon: '🩹', title: T('c3.c33cards.injury.title', 'Your current injury'),
        build: function (card) {
          card.appendChild(c33Text('c3w-c33s-mailing', T('c3.fields.mailingOptional', 'Mailing address (optional)'), state.mailing, T('c3.fields.mailingPh', 'Number and street')));
          card.appendChild(c33Text('c3w-c33s-mailing2', T('c3.fields.mailing2Optional', 'City, State, ZIP (optional)'), state.mailing2, T('c3.fields.mailing2Ph', 'City, NY 10001')));
          card.appendChild(c33Area('c3w-c33s-injury', T('c3.fields.currentInjury', 'Current injury / illness (all body parts)'), state.nature, T('c3.fields.currentInjuryPh', 'e.g. lower back and left hip')));
          card.appendChild(el('div', { class: 'form-error', id: 'c3w-err-c33s-injury', text: T('c3.validation.c33Injury', 'Describe your current injury/illness') }));
        } },
      { key: 'c33_providers', icon: '👩‍⚕️', title: T('c3.c33cards.providers.title', 'Previous providers'),
        build: function (card) {
          card.appendChild(helper(T('c3.c33cards.providers.helper', 'List the doctors who treated your PREVIOUS injury to the same body part — one per line, “Name — Address”.')));
          card.appendChild(c33Area('c3w-c33s-providers', T('c3.fields.c33ProvidersFull', 'Provider(s) (name & address)'), state.c33_providers, T('c3.fields.c33ProvidersFullPh', 'Dr. Jane Smith — 1 Main St, Albany NY 12203')));
          card.appendChild(el('div', { class: 'form-error', id: 'c3w-err-c33s-providers', text: T('c3.validation.c33Providers', 'List at least one provider') }));
          card.appendChild(mhToggleRow());
        } },
      { key: 'c33_certify', icon: '✍️', title: T('c3.cards.certify.title', 'Certify & sign'),
        build: function (card) {
          sig.drawn = false; sig.canvas = null;
          card.appendChild(c33Text('c3w-c33s-certName', T('c3.fields.certName', 'Type your full legal name to certify'), state.certName, T('c3.fields.certNamePh', 'Your full legal name')));
          var cv = el('canvas', { class: 'sig-pad', id: 'c3w-sig-c33' });
          card.appendChild(el('div', { class: 'form-group' }, [el('label', { class: 'form-label', text: T('c3.fields.drawSignature', 'Draw your signature') }), el('div', { class: 'sig-pad-wrap' }, [cv, el('button', { class: 'sig-clear', type: 'button', onclick: function () { clearSig(); } }, [T('c3.fields.clear', 'Clear')])])]));
          var ct = el('div', { class: 'toggle-switch' + (certAgreedC33.v ? ' on' : '') }, [el('div', { class: 'toggle-knob' })]);
          ct.addEventListener('click', function () { ct.classList.toggle('on'); certAgreedC33.v = ct.classList.contains('on'); });
          card.appendChild(el('div', { class: 'toggle-row' }, [el('div', null, [el('div', { class: 'toggle-text', text: T('c3.certifyToggleC33', 'I certify this authorization is true') })]), ct]));
          card._sig = cv;
        }, after: function () { var cv = viewport.querySelector('#c3w-sig-c33'); if (cv) initSig(cv); } }
    ];
    function c33Text(id, label, val, ph) { return el('div', { class: 'form-group' }, [el('label', { class: 'form-label', text: label }), el('input', { type: 'text', class: 'form-input', id: id, value: val || '', placeholder: ph || '' })]); }
    function c33Date(id, label, val) { var n = el('input', { type: 'date', class: 'form-input', id: id, max: todayISO() }); if (val) n.value = val; return el('div', { class: 'form-group' }, [el('label', { class: 'form-label', text: label }), n]); }
    function c33Area(id, label, val, ph) { return el('div', { class: 'form-group' }, [el('label', { class: 'form-label', text: label }), el('textarea', { class: 'form-input', id: id, placeholder: ph || '', rows: '3' }, [val || ''])]); }
    function goToStandaloneC33() { state.c33Only = true; state.c33Idx = 0; persist(); renderC33Card(0); }
    function renderC33Card(i) {
      state.c33Idx = i;
      progress.style.display = 'none';
      viewport.className = 'c3w-viewport';
      viewport.innerHTML = '';
      var c = c33Cards[i];
      var card = el('div', { class: 'c3w-card' });
      card.appendChild(cardHead(c));
      c.build(card);
      viewport.appendChild(card);
      if (c.after) { try { c.after(); } catch (e) {} }
      backBtn.textContent = i > 0 ? T('c3.back', 'Back') : T('c3.exit', 'Exit');
      backBtn.onclick = function () { if (i > 0) { syncC33(); renderC33Card(i - 1); } else { state.c33Only = false; persist(); progress.style.display = ''; goToCard(firstDataKey(), true); } };
      nextBtn.removeAttribute('id'); nextBtn.disabled = false;
      if (c.key === 'c33_certify') {
        nextBtn.textContent = T('c3.generateC33', 'Generate Form C-3.3'); nextBtn.id = 'c3w-c33-generate';
        nextBtn.onclick = function () { if (nextBtn.disabled) return; syncC33(); beforeExport(certAgreedC33.v); };
      } else {
        nextBtn.textContent = T('c3.continue', 'Continue');
        nextBtn.onclick = function () { syncC33(); renderC33Card(i + 1); };
      }
      try { viewport.scrollTop = 0; } catch (e) {}
      applyVV();
    }

    function startDeck() { progress.style.display = ''; restore(); }

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
      // Storage read, but it must never be able to take generation down with it.
      // This was `supabase.storage.from(...).download(...)` bare: the .catch()
      // under it only catches a REJECTED PROMISE, so a client without .storage
      // threw SYNCHRONOUSLY out of loadTemplate and the bundled fallback right
      // below — the one whose entire job is to cover a missing bucket — could
      // never run. Generation died with "Cannot read properties of undefined
      // (reading 'from')" instead of quietly using the blank form we ship.
      // Every branch here resolves to null so the fallback stays reachable.
      function fromStorage() {
        try {
          if (!supabase || !supabase.storage || typeof supabase.storage.from !== 'function') return Promise.resolve(null);
          var bucket = supabase.storage.from('c3-template');
          if (!bucket || typeof bucket.download !== 'function') return Promise.resolve(null);
          return Promise.resolve(bucket.download(bucketFile))
            .then(function (res) { return (res && res.data && !res.error) ? res.data.arrayBuffer() : null; })
            .catch(function () { return null; });
        } catch (e) { return Promise.resolve(null); }
      }
      // ...and it must never be able to STALL generation either.
      //
      // The .catch() above only fires on a REJECTED promise. A dead connection,
      // a captive portal or a half-open socket does not reject — it HANGS until
      // the OS gives up, which iOS reports as `nw_read_request_report [Cn]
      // Receive failed with error "Operation timed out"` and can sit there for
      // 60s+ (longer with CapacitorHttp routing through native URLSession). This
      // is the FIRST network call in generate(), and the template is ~1.6 MB, so
      // for that entire window the worker is holding a disabled "Generating…"
      // button with no success screen and no error toast — the exact symptom the
      // success-screen defect produced, from a completely unrelated cause. It is
      // also what made "the vendored pdf-lib means it works offline" untrue: the
      // library stopped needing the network, the TEMPLATE still did.
      //
      // Bounded because this is a READ: idempotent, side-effect free, and safe
      // to abandon — we already ship the same blank form at `bundledPath`.
      // See withDeadline() at module scope for why reads are bounded and the
      // upload/insert writes deliberately are not.
      return withDeadline(fromStorage(), NET_MS.template, 'c3-template read')
        .then(function (bytes) {
          if (bytes) return PDFDocument.load(bytes, LOAD_OPTS);
          // dev/pre-bucket fallback: the bundled blank form
          return fetch(bundledPath).then(function (r) { if (!r.ok) throw new Error('C-3 template not found in Storage or bundle'); return r.arrayBuffer(); }).then(function (b) { return PDFDocument.load(b, LOAD_OPTS); });
        });
    }
    function deXFA(pdf) {
      // Strip the XFA packet so XFA-aware viewers (Adobe) render the filled
      // AcroForm instead of an empty dynamic form.
      //
      // NeedAppearances is NOT set here any more — see lockAppearances(). That
      // flag means "ignore my appearance streams, regenerate them yourself",
      // which threw away 56 streams we had just generated and measured, and
      // handed the rendering of a sworn filing to whichever viewer the worker
      // happens to open it in.
      try {
        var acro = pdf.catalog.lookup(window.PDFLib.PDFName.of('AcroForm'));
        if (acro) acro.delete(window.PDFLib.PDFName.of('XFA'));
      } catch (e) { console.warn('[C3] DEXFA_SKIPPED', e); }
    }
    // THE fix for the certification year that would not stop clipping.
    //
    // Three rounds went into the /DA — the font size, then the font NAME — and
    // the year still came off a real device as "202". The reason none of it
    // worked: /DA is only consulted by a viewer that REGENERATES appearances,
    // and the appearance stream we generate was correct the whole time. Decoded
    // from a filed PDF, the year's stream draws <32303236> at 7pt starting at
    // x=1 inside a clip running to x=19.52 — 15.6pt of glyphs in 18.5pt of room.
    // It fits. It was never the file that was wrong; it was that we told every
    // viewer to throw that stream away and redraw it from scratch.
    //
    // So: generate the appearances, VERIFY every filled field and every checked
    // box actually got one, and only then clear NeedAppearances so viewers
    // render exactly what we drew and measured. If coverage is ever incomplete
    // we leave the flag ON — a regenerated field beats a blank one on a form
    // somebody swears to.
    function lockAppearances(pdf, form, PDFLib) {
      var missing = 0, checked = 0;
      try {
        form.getFields().forEach(function (f) {
          var filled = false;
          try {
            if (typeof f.getText === 'function') filled = !!f.getText();
            else if (typeof f.isChecked === 'function') filled = f.isChecked();
          } catch (e) { return; }
          if (!filled) return;
          checked++;
          var wdgs = [];
          try { wdgs = f.acroField.getWidgets(); } catch (e) {}
          if (!wdgs.length) { missing++; return; }
          var ap = null;
          try { ap = wdgs[0].dict.lookup(PDFLib.PDFName.of('AP')); } catch (e) {}
          var n = null;
          try { n = ap && ap.lookup(PDFLib.PDFName.of('N')); } catch (e) {}
          if (!n) missing++;
        });
      } catch (e) { missing = -1; }
      var acro = null;
      try { acro = pdf.catalog.lookup(PDFLib.PDFName.of('AcroForm')); } catch (e) {}
      var ok = (missing === 0 && checked > 0);
      try {
        if (acro) acro.set(PDFLib.PDFName.of('NeedAppearances'), ok ? PDFLib.PDFBool.False : PDFLib.PDFBool.True);
      } catch (e) {}
      console.log('[C3] APPEARANCES filled=' + checked + ' missingAP=' + missing + ' needAppearances=' + (!ok));
      return ok;
    }
    function fillC3(PDFLib) {
      var PDFDocument = PDFLib.PDFDocument;
      return loadTemplate(PDFDocument, 'template.pdf', 'forms/c3.pdf').then(function (pdf) {
        var form = pdf.getForm();
        function setT(name, v) { try { if (v != null && v !== '') form.getTextField(name).setText(String(v)); } catch (e) {} }
        function setC(name) { try { form.getCheckBox(name).check(); } catch (e) {} }
        function setSz(name, sz) { try { form.getTextField(name).setFontSize(sz); } catch (e) {} }
        // A font size that provably FITS the box, written in a font the form can
        // actually RESOLVE. TWO separate defects made the certification-date year
        // render as "202" on a filed C-3:
        //
        //  1. SIZE. That year box is 21pt wide — the narrowest on the form (the
        //     others are 23 and 27). Four digits at the old flat size 9 is ~20pt
        //     of glyphs before any padding.
        //
        //  2. FONT NAME — which is why fixing the size alone changed nothing.
        //     pdf-lib's setFontSize() rewrites the field's /DA using ITS OWN font
        //     name, "/Helvetica". The C-3's resource dictionary (/DR) defines
        //     /ArialMT, /CourierNewPSMT, /Helv and /ZaDb — there is no
        //     /Helvetica. deXFA sets NeedAppearances, so a viewer REGENERATES the
        //     appearance from /DA, fails to resolve /Helvetica, and falls back to
        //     its own default size, which clips again no matter what we asked
        //     for. Measured on the delivered file: /DA read "/Helvetica 7 Tf"
        //     against a /DR containing no such font, and it still clipped.
        //
        // So: size to the box AND name /Helv, which the /DR actually defines.
        // Sizes are applied here (so pdf-lib generates appearance streams at the
        // right size for viewers that use them) and the /DA font is repaired
        // afterwards for viewers that regenerate from it — both classes covered.
        function fitSz(name, maxSz) { try { fitField(form.getTextField(name), maxSz); } catch (e) {} }

        // Helvetica advance widths (AFM, /1000 em) for ASCII 32–126, three digits
        // each. /Helv IS Helvetica, so this is EXACT rather than an estimate —
        // which matters because the alternative is a flat per-character average,
        // and an average that guesses high shrinks type that would have fitted.
        // The certification year is the worst case: "2026" is four digits at
        // 0.556 em, so a 0.56 average over-measures by nothing at all for the
        // glyphs but the 6pt padding allowance pushed it down to 6pt — three
        // sizes smaller than the month and day boxes beside it, on the same row.
        // '@' is clamped to 999 (true 1015) to keep the table fixed-width; it
        // does not appear anywhere on a C-3.
        var HELV_W = '278278355556556889667191333333389584278333278278'
          + '556556556556556556556556556556278278584584584556999'
          + '667667722722667611778722278500667556833722778667778722667611722667944667667611'
          + '278278278469556333'
          + '556556500556556278556556222222500222833556556556556333500278556500722500500500'
          + '334260334584';
        function helvEm(txt) {
          var t = 0;
          for (var i = 0; i < txt.length; i++) {
            var c = txt.charCodeAt(i) - 32;
            // Anything outside Latin-1 printable (an em dash, a curly quote) gets
            // the ~average width rather than being ignored — under-counting a
            // character is how text creeps past the edge of a box.
            t += (c >= 0 && c < 95) ? parseInt(HELV_W.substr(c * 3, 3), 10) : 556;
          }
          return t / 1000;
        }
        // pdf-lib insets its appearance clip by exactly 1pt per side and starts
        // the text run at x=1 — decoded from a generated stream:
        //   1 1 m … 19.52 … W n   ·   1 0 0 1 1 5.467 Tm
        // so a 20.52pt box gives 18.52pt of drawable width. Guessing 4pt here
        // (never mind the 6 before it) cost the year a whole size for no reason.
        var CLIP_PAD = 2;
        // The largest size at which this field's text fits its own box, capped
        // at maxSz. Returns maxSz for anything it should not shrink.
        function sizeForField(f, maxSz) {
          maxSz = maxSz || 9;
          try {
            var txt = String(f.getText() || '');
            if (!txt) return maxSz;
            var wdgs = f.acroField.getWidgets();
            if (!wdgs.length) return maxSz;
            var w = wdgs[0].getRectangle().width;
            if (!w) return maxSz;
            var multi = false; try { multi = !!f.isMultiline(); } catch (e) {}
            if (multi || txt.indexOf('\n') >= 0) return maxSz;
            var em = helvEm(txt);
            if (!em) return maxSz;
            return Math.max(5, Math.min(maxSz, Math.floor((w - CLIP_PAD) / em)));
          } catch (e) { return maxSz; }
        }
        // Shrink ONE filled single-line field until its text fits its own box.
        // Multi-line fields are left alone — they wrap, which is correct.
        function fitField(f, maxSz) {
          try {
            var txt = String(f.getText() || '');
            if (!txt || txt.indexOf('\n') >= 0) return;
            var multi = false; try { multi = !!f.isMultiline(); } catch (e) {}
            if (multi) return;
            f.setFontSize(sizeForField(f, maxSz || 9));
          } catch (e) {}
        }
        // A date is THREE boxes and a phone is TWO, and they read as one value.
        // Sizing them independently is what put a 7pt year beside a 9pt month on
        // the certification line — pdf-lib centres vertically by font size, so
        // the year also floated above its own rule. Size the group to whichever
        // member is tightest and they render as one field again.
        function fitGroup(keys, maxSz) {
          maxSz = maxSz || 9;
          var sz = maxSz, any = false;
          keys.forEach(function (k) {
            try {
              var f = form.getTextField(F[k]);
              if (!f.getText()) return;
              any = true;
              sz = Math.min(sz, sizeForField(f, maxSz));
            } catch (e) {}
          });
          if (!any) return;
          keys.forEach(function (k) { setSz(F[k], sz); });
        }
        // Every filled single-line field, not just the dates. The year was the
        // one that got noticed; the same arithmetic applies to a long employer
        // name or a treating-doctor address in a narrow box.
        function fitAllFields() {
          try {
            form.getFields().forEach(function (f) {
              if (typeof f.getText !== 'function' || typeof f.setFontSize !== 'function') return;
              var cur = 9;
              try { var m = String(f.acroField.dict.get(PDFLib.PDFName.of('DA')) || '').match(/([\d.]+)\s+Tf/); if (m) cur = parseFloat(m[1]) || 9; } catch (e) {}
              fitField(f, Math.max(cur, 9));
            });
          } catch (e) { console.warn('[C3] FIT_ALL_SKIPPED', e); }
        }
        // Point every /DA at /Helv — a font this form's /DR actually defines —
        // while preserving the size the appearance streams were generated at.
        // pdf-lib names its own /Helvetica, which the /DR does not contain, so a
        // viewer honouring NeedAppearances cannot resolve it and falls back to a
        // default size. That is what rendered the certification year as "202"
        // even after the size was corrected. Runs AFTER updateFieldAppearances,
        // which rewrites /DA on every field it touches.
        function repairDA() {
          var K = PDFLib.PDFName.of('DA');
          try {
            form.getFields().forEach(function (f) {
              try {
                if (typeof f.getText !== 'function') return;
                if (!f.getText()) return;
                var da = String(f.acroField.dict.get(K) || '');
                var m = da.match(/([\d.]+)\s+Tf/);
                var sz = m ? parseFloat(m[1]) : 9;
                if (!(sz > 0)) sz = 9;
                var nda = PDFLib.PDFString.of('/Helv ' + sz + ' Tf 0 g');
                f.acroField.dict.set(K, nda);
                f.acroField.getWidgets().forEach(function (wdg) { try { wdg.dict.set(K, nda); } catch (e) {} });
              } catch (e) {}
            });
          } catch (e) { console.warn('[C3] DA_REPAIR_SKIPPED', e); }
        }
        // Spread long text across the form's existing continuation-line fields so it
        // uses every ruled line instead of clipping in the first (stub) box.
        // Per-line character capacity has to AGREE with fitField's metric, or the
        // two fight: fitField measures at 0.56em with 6pt of padding, so a cap
        // computed at a looser 0.2em/pt produced lines fitField then shrank to
        // 8pt — a page of subtly different type sizes. Deriving the cap from the
        // same numbers means a wrapped line always fits at 9 and nothing shrinks.
        //   maxChars = (w - padding) / (0.56 * 9pt)
        function capFor(w) { return Math.max(6, Math.floor((w - 6) / 5.05)); }
        function setMulti(names, widths, text) {
          text = joinLines(text);
          if (!text) return;
          var parts = wrapFields(text, widths.map(capFor));
          for (var k = 0; k < names.length; k++) { setT(names[k], parts[k] || ''); setSz(names[k], 9); }
        }
        var dobP = dateParts(state.dob), doiP = dateParts(state.doi);
        // A. you
        setT(F.wcb, profile.wcb_case_number || '');
        setT(F.name, state.name);
        setT(F.dobM, dobP[0]); setT(F.dobD, dobP[1]); setT(F.dobY, dobP[2]);
        setT(F.mailing, composeMailing(state.mailing, state.mailingUnit, state.mailing2));
        setT(F.ssn, state.ssn);
        var phP = phoneParts(state.phone); setT(F.phone, phP[0]); setT(F.phone2, phP[1]);
        if (state.gender === 'M') setC(F.genderM); else if (state.gender === 'F') setC(F.genderF);
        if (state.translator === 'yes') { setC(F.translatorY); setT(F.language, state.language); } else if (state.translator === 'no') setC(F.translatorN);
        // B. employer
        setT(F.employer, state.employer); var ephP = phoneParts(state.employerPhone); setT(F.employerPhone, ephP[0]); setT(F.employerPhone2, ephP[1]);
        setT(F.workAddress, state.workAddress); setT(F.supervisor, state.supervisor);
        // B6 — concurrent employment across the stub box and its two ruled lines.
        // A legacy free-text otherEmployers draft still wins if one is present.
        var b6 = String(state.otherEmployers || '').trim();
        if (!b6 && state.hasConcurrent) b6 = [state.concurrentEmployer, state.concurrentAddress].map(function (s) { return String(s || '').trim(); }).filter(Boolean).join(' — ');
        setMulti([F.otherEmployers, F.otherEmployers2, F.otherEmployers3], [214, 504, 503], b6);
        var dhP = dateParts(state.dateHired); setT(F.dateHiredM, dhP[0]); setT(F.dateHiredD, dhP[1]); setT(F.dateHiredY, dhP[2]);
        // C. job — C2 is a 296pt stub with a 506pt ruled line under it. Writing
        // the duties textarea straight into the stub put three newline-separated
        // duties on one crowded line and left the ruled line empty.
        setT(F.jobTitle, state.jobTitle);
        setMulti([F.activities, F.activities2], [296, 506], state.activities);
        if (state.jobTime && JOBTIME_FIELDS[state.jobTime]) setC(JOBTIME_FIELDS[state.jobTime]);
        if (state.jobTime === 'Other') setT(F.jobOtherText, state.jobOther);
        setT(F.grossPay, state.grossPay); setT(F.payFreq, state.payFreq);
        // D. injury
        setT(F.doiM, doiP[0]); setT(F.doiD, doiP[1]); setT(F.doiY, doiP[2]);
        setT(F.timeOfInjury, state.timeOfInjury); if (state.ampm === 'AM') setC(F.am); else if (state.ampm === 'PM') setC(F.pm);
        setMulti([F.whereHappened, F.whereHappened2], [190, 506], state.whereHappened);
        if (state.usualLocation === 'yes') setC(F.usualLocYes);
        else if (state.usualLocation === 'no') { setC(F.usualLocNo); setMulti([F.usualLocWhy, F.usualLocWhy2], [155, 504], state.usualLocationWhy); }
        setMulti([F.whatDoing, F.whatDoing2], [141, 503], state.whatDoing);
        setMulti([F.howHappened, F.howHappened2, F.howHappened3], [204, 506, 506], state.howHappened);
        var natureText = state.nature + (state.bodyParts.length ? ('  [Body parts: ' + state.bodyParts.map(function (p) { return BODY_LABELS[p] || p; }).join(', ') + ']') : '');
        setMulti([F.nature, F.nature2, F.nature3], [100, 506, 506], natureText);
        // Page 2 header
        setT(F.nameP2, state.name); setT(F.doiP2M, doiP[0]); setT(F.doiP2D, doiP[1]); setT(F.doiP2Y, doiP[2]);
        // third party
        if (state.objectInvolved === 'yes') setT(F.objectWhat, state.objectWhat);
        if (state.motorVehicle === 'yes') { if (state.vehicleType === 'your_vehicle') setC(F.yourVehicle); else if (state.vehicleType === 'employers_vehicle') setC(F.employersVehicle); else if (state.vehicleType === 'other_vehicle') setC(F.otherVehicle); setT(F.licensePlate, state.licensePlate); setMulti([F.mvCarrier1, F.mvCarrier2], [167, 503], state.mvCarrier); }
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
        // Both F-section entries are "name AND address" questions with a second
        // ruled line the form provides and the wizard never used, and both phones
        // are two-box layouts whose second box was never mapped — which is how a
        // 9-digit number ended up rendered at 5pt inside the area-code box.
        setMulti([F.firstTreatName1, F.firstTreatName2], [326, 345], state.firstTreatName);
        var ftPh = phoneParts(state.firstTreatPhone); setT(F.firstTreatPhone, ftPh[0]); setT(F.firstTreatPhone2, ftPh[1]);
        setMulti([F.treatingDoctors1, F.treatingDoctors2], [224, 349], state.treatingDoctors);
        var tdPh = phoneParts(state.treatingDoctorsPhone); setT(F.treatingDoctorsPhone, tdPh[0]); setT(F.treatingDoctorsPhone2, tdPh[1]);
        // Prior injury (F4) — mark Yes/No on the C-3 itself and describe it across
        // the three "complete & file Form C-3.3 together" lines. The separate
        // C-3.3 is still generated + bundled (see generate()); this makes the C-3
        // self-reference it instead of leaving the block blank.
        if (state.priorInjury === 'yes') {
          setC(F.priorYes);
          setMulti([F.c33Together1, F.c33Together2, F.c33Together3], [505, 505, 505], state.c33_priorDesc);
        } else if (state.priorInjury === 'no') setC(F.priorNo);
        // certification
        setT(F.printName, state.certName || state.name);
        var cdP = dateParts(todayISO()); setT(F.certDate, cdP[0]); setT(F.certDateD, cdP[1]); setT(F.certDateY, cdP[2]);
        // Size the narrow date/phone boxes to the width they ACTUALLY have, so a
        // 4-digit year or an area code can never clip — and size each date and
        // each phone as ONE GROUP, because that is how it reads on the page.
        //
        // This runs AFTER fitAllFields, not before: fitAllFields re-fits every
        // field independently and would push the month and day back up to 9
        // beside an 8pt year, which is the very mismatch the grouping exists to
        // remove. Last writer wins, so the group pass goes last.
        var DATE_PHONE_GROUPS = [['dobM', 'dobD', 'dobY'], ['dateHiredM', 'dateHiredD', 'dateHiredY'],
          ['doiM', 'doiD', 'doiY'], ['doiP2M', 'doiP2D', 'doiP2Y'],
          ['noticeDateM', 'noticeDateD', 'noticeDateY'],
          ['stopWorkDate', 'stopWorkD', 'stopWorkY'],
          ['returnedDate', 'returnedD', 'returnedY'],
          ['firstTreatDate', 'firstTreatD', 'firstTreatY'],
          ['certDate', 'certDateD', 'certDateY'],
          ['phone', 'phone2'], ['employerPhone', 'employerPhone2'],
          ['firstTreatPhone', 'firstTreatPhone2'],
          ['treatingDoctorsPhone', 'treatingDoctorsPhone2']];
        // Order matters:
        //   1. size every field to its own box;
        //   2. THEN unify each date/phone group (see above — this must be last);
        //   3. generate the appearance streams at those sizes — this is what a
        //      viewer actually renders now;
        //   4. repair /DA to a font the /DR defines, for the narrow case where a
        //      viewer regenerates anyway (an Acrobat user editing a field);
        //   5. save with updateFieldAppearances:false, or pdf-lib rewrites /DA
        //      back to its own unresolvable /Helvetica and undoes step 4.
        fitAllFields();
        DATE_PHONE_GROUPS.forEach(function (g) { fitGroup(g, 9); });
        try { form.updateFieldAppearances(); } catch (e) { console.warn('[C3] APPEARANCE_UPDATE_SKIPPED', e); }
        repairDA();
        // signature image on page 2 (no AcroForm field for the ink line)
        return embedSig(pdf, PDFLib).then(function () {
          deXFA(pdf);
          // Only AFTER the appearances exist: prove every filled field has one,
          // then stop telling viewers to regenerate. See lockAppearances().
          lockAppearances(pdf, form, PDFLib);
          return pdf.save({ updateFieldAppearances: false });
        });
      });
    }
    function embedSig(pdf, PDFLib) {
      if (!sig.drawn || !sig.canvas) return Promise.resolve();
      try {
        var dataUrl = sig.canvas.toDataURL('image/png');
        return pdf.embedPng(dataUrl).then(function (png) {
          var pages = pdf.getPages(); var page2 = pages[1]; if (!page2) return;
          // EMPLOYEE'S Signature line — the same row as "Print Name" and the
          // employee Date boxes. (NOT the attorney row lower down.)
          //
          // Derived from the Print_Name widget rather than hard-coded, so a WCB
          // form revision that moves the row moves the signature with it. The
          // old literals (y:132, height up to 22) put the image at 132→154 on a
          // row that ends at 146, so ~8pt of every signature climbed into the
          // text above and overlapped it. Measured against the shipped template:
          // Print_Name is x=317 y=130 w=159 h=16 on a 612×792 page.
          var rect = null;
          try { rect = pdf.getForm().getTextField(F.printName).acroField.getWidgets()[0].getRectangle(); } catch (e) {}
          var lineY = rect ? rect.y : 130;          // sit ON the ruled line
          var rowH = rect ? rect.height : 16;       // and never grow past the row
          var SIG_X = 150;                          // right of the "Employee's Signature:" label
          var maxW = rect ? Math.max(90, rect.x - 12 - SIG_X) : 150;
          var w = Math.min(150, maxW);
          var h = Math.min(w * (png.height / png.width), rowH);
          page2.drawImage(png, { x: SIG_X, y: lineY, width: w, height: h });
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
      var phase = this.onPhase || function () {};
      phase('upload');
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
          console.log('[C3] STAGE upload-done c3=' + !!c3path + ' c33=' + !!c33path);
          phase('save');
          var row = { user_id: uid, status: 'generated', storage_path: c3path ? ('c3-filings/' + c3path) : null, c33_path: c33path ? ('c3-filings/' + c33path) : null, wcb_case_number: profile.wcb_case_number || null, has_attorney: !!profile.has_attorney, generated_at: new Date().toISOString() };
          return api.from('c3_filings').insert(row).then(function (res) {
            if (res && res.error) throw res.error;
            console.log('[C3] STAGE insert-done — the filing is now SAVED on the server');
            return { kind: 'self_file', path: c3path, c33path: c33path };
          });
        })
        .then(function (out) {
          phase('link');
          // Mint short-TTL signed URLs for immediate download (present forms only).
          //
          // THE FILING IS ALREADY SAVED by the time we get here — the upload and
          // the c3_filings insert have both succeeded. These two reads are a
          // CONVENIENCE (they power the download + "Email my claim to the WCB"
          // buttons), so they must never be able to hold the success screen
          // hostage. Unbounded, they did exactly that: on a stalled connection
          // createSignedUrl is the LAST call in submit(), so it hung, submit()
          // never resolved, and the worker sat on "Generating…" forever with a
          // filing already on the server and nothing on screen to prove it.
          // That is what produced three identical filings on 2026-08-11.
          //
          // Bounded and non-fatal: on timeout the URL is simply null, submit()
          // still resolves, and showSuccess() renders the "saved, but we can't
          // link it right now" variant that points at My documents.
          var p = out.path
            ? withDeadline(api.storage.from('c3-filings').createSignedUrl(out.path, 3600), NET_MS.signedUrl, 'signed URL (C-3)')
                .then(function (s) { out.signedUrl = (s && s.data && s.data.signedUrl) || null; })
            : Promise.resolve();
          return p.then(function () {
            if (!out.c33path) return out;
            return withDeadline(api.storage.from('c3-filings').createSignedUrl(out.c33path, 3600), NET_MS.signedUrl, 'signed URL (C-3.3)')
              .then(function (s2) { out.c33SignedUrl = (s2 && s2.data && s2.data.signedUrl) || null; return out; });
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
      if (!certAgreed) { toast(T('c3.toasts.certToggle', 'Please toggle “I certify the above is true” before signing.')); return false; }
      if (!state.certName || !state.certName.trim()) { toast(T('c3.toasts.typeName', 'Type your full legal name to certify.')); return false; }
      if (!sig.drawn) { toast(T('c3.toasts.drawSig', { form: formLabel }, 'Please draw your signature to sign the {form}.')); return false; }
      if (c33Only) {
        // Navigate to the card that OWNS the missing field first, then mark
        // it, then toast. The inline error div only exists while its card is
        // rendered — export runs from the certify card, so without the
        // navigation the toast fades and the worker is stranded with no
        // indication of which card to go back to (the OD/HIPAA path).
        // Card indices: 0 = c33_identity, 1 = c33_injury, 2 = c33_providers.
        var c33Fail = function (cardIdx, key, msg) { renderC33Card(cardIdx); showErr(key); toast(msg); return false; };
        if (!state.name || !state.name.trim()) return c33Fail(0, 'c33s-name', T('c3.toasts.nameRequired', 'Your full legal name is required.'));
        if (!state.nature || !state.nature.trim()) return c33Fail(1, 'c33s-injury', T('c3.toasts.injuryRequired', 'Describe your current injury/illness.'));
        if (!state.c33_providers || !state.c33_providers.trim()) return c33Fail(2, 'c33s-providers', T('c3.toasts.providersRequired', 'List at least one previous treating provider.'));
      }
      return true;
    }

    // Step-5 export action. After validating, ANONYMOUS users see ONE optional,
    // skippable account offer before the PDF is built; signed-in users (and
    // anyone who skips) go straight to generate(). Skipping fully completes the
    // flow — a local export with full filing instructions.
    function beforeExport(certAgreed) {
      // Never a silent tap — see generate() for what this cost.
      if (working) { toast(T('c3.toasts.stillWorking', 'Still working on your C-3 — one moment.')); return; }
      syncFromDom();
      if (!validateForExport(certAgreed)) return;
      // POINT OF COMMITMENT. From here the worker is exporting a sworn filing and
      // the wizard owns the screen until it reaches a terminal state or they
      // cancel out of it. Stop the portal observer now, BEFORE the multi-second
      // generation window — an #app re-render from anywhere else in the app (an
      // auth tick, a tier refresh, a failed analytics POST) would otherwise tear
      // the wizard out mid-build, and the success screen would be assembled
      // inside a detached node that nobody can see. Exits still tear down
      // explicitly via goDash().
      disarmPortal();
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
      // z-index 100044, ABOVE the wizard's own .c3w root (100040).
      //
      // This was 100000. Both this overlay and .c3w are children of
      // document.body, so once the Aurora Glass 6.x fix portalled .c3w out of
      // #app and gave it 100040, this modal started rendering BEHIND the
      // full-screen wizard. A guest tapped "Generate & File My C-3" and the
      // account offer opened where they could not see it — the flow looked
      // frozen, and the only way to reach the modal was to tap ✕, which tore
      // the wizard down and revealed it. Order now: wizard 100040 < offer
      // 100044 < ack gate 100045 < toasts 100050/100060 < ToU gate 100060.
      var ov = el('div', { style: 'position:fixed;inset:0;z-index:100044;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:20px' });
      function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
      // #1d4ed8, not #3b82f6: white on #3b82f6 measures 3.68:1 and 14px/600 is
      // not WCAG "large text", so it needed 4.5. #1d4ed8 is 6.70:1. This literal
      // is deliberately IDENTICAL to the deploy repo's own fix (thecompdesk-site
      // 4215c49) — the two copies of this file must not disagree, or the next
      // ops/website -> deploy copy silently reverts a live accessibility fix.
      var BTN_P = 'width:100%;margin-bottom:8px;background:#1d4ed8;color:#fff;border:none;border-radius:8px;padding:13px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit';
      var BTN_S = 'width:100%;background:transparent;color:#9ba1b0;border:1px solid #2e3145;border-radius:8px;padding:12px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit';
      var card = el('div', { style: 'background:#1a1d28;border:1px solid #2e3145;border-radius:14px;padding:24px 22px;max-width:380px;width:100%;text-align:center;color:#e8eaed;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif' }, [
        el('div', { style: 'font-size:34px;line-height:1;margin-bottom:12px', text: '🗂️' }),
        el('h3', { id: 'c3w-offer-title', style: 'font-size:18px;font-weight:600;margin:0 0 8px;line-height:1.3', text: T('c3.offer.title', 'Create a free account to save this filing and track your case?') }),
        el('p', { style: 'font-size:13px;color:#9ba1b0;line-height:1.5;margin:0 0 20px', text: T('c3.offer.body', 'We’ll save your signed C-3 to your account so you can download it again and follow what happens next. You’ll still get your forms right now if you skip.') }),
        el('button', { type: 'button', style: BTN_P, onclick: function () { close(); try { if (CD.showAuth) CD.showAuth(T('c3.offer.authPrompt', 'Create a free account to save your C-3 filing')); } catch (e) {} } }, [T('c3.offer.create', 'Create account')]),
        el('button', { type: 'button', style: BTN_S, onclick: function () { close(); showCertAckGate(certAgreed); } }, [T('c3.offer.skip', 'Skip, just give me my forms')])
      ]);
      ov.appendChild(card);
      document.body.appendChild(ov);
      /* a11y (Aurora Glass 6.17): this overlay shipped with NO role, NO
       * aria-modal, no focus management and no Tab cycle — it is the last
       * screen of the C-3 filing flow, so a keyboard user reached the end of a
       * statutory form and fell straight through the dialog into the page.
       *
       * NO onEscape, deliberately. Both buttons act: "Create account" opens
       * auth, "Skip" proceeds to the certification gate and the export. There
       * is no cancel for Escape to mirror, and mapping it to Skip would fire
       * the export flow off a keystroke. Same call as showSetPasswordModal
       * (6.5) and the TOU gate (6.14).
       *
       * Guarded: this file is SHARED via sync-dashboard.sh and the website does
       * not load js/modal-a11y.js, so there it stays exactly as it was. */
      if (CD.ModalA11y) {
        CD.ModalA11y.attach(ov, { dialogEl: card, labelledBy: 'c3w-offer-title' });
      }
    }

    // MANDATORY pre-export acknowledgment — bold, loud, shown EVERY time before
    // export (and therefore before the success-screen email link), for both the
    // C-3 and the standalone C-3.3. Quotes the C-3's verbatim certification +
    // penalty-of-perjury language. The Export button is disabled until the
    // claimant checks the certify box. Never permanently dismissible.
    function showCertAckGate(certAgreed) {
      var formLabel = state.c33Only ? 'C-3.3' : 'C-3';
      // This gate stays a hard, opaque, red-bordered alarm surface — DELIBERATELY
      // not glass. It is a stop sign in front of a sworn filing; softening or
      // blurring it would work against the one job it has.
      // z-index 100045 — above .c3w (100040) and the account offer (100044).
      // Was 100001, i.e. BEHIND the portalled wizard: the mandatory sworn-document
      // gate opened invisibly and export looked like a dead button. See
      // showAccountOffer for the full stacking order.
      var ov = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'c3w-ack-title', style: 'position:fixed;inset:0;z-index:100045;background:rgba(0,0,0,.9);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto' });
      var prevFocus = document.activeElement;
      var _release = null;
      function close() {
        document.removeEventListener('keydown', onAckKey, true);
        if (_release) { try { _release(); } catch (e) {} _release = null; }
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) {}
      }
      // Escape is the keyboard equivalent of "Cancel — go back". It does NOT
      // dismiss the gate permanently: it fires again on the next export attempt.
      function onAckKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key !== 'Tab') return;
        var f = Array.prototype.filter.call(card.querySelectorAll('button, input, [href], [tabindex]:not([tabindex="-1"])'), function (n) { return !n.disabled && n.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      var card = el('div', { style: 'background:#15171f;border:2px solid #ef4444;border-radius:14px;max-width:480px;width:100%;max-height:94vh;overflow:auto;padding:22px 20px;color:#e8eaed;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 0 0 6px rgba(239,68,68,.18)' });
      card.appendChild(el('div', { id: 'c3w-ack-title', style: 'font-size:21px;font-weight:800;line-height:1.25;color:#fca5a5;text-align:center;margin-bottom:14px', text: '⚠️ ' + T('c3.ack.title', 'YOU ARE ABOUT TO SUBMIT A SWORN LEGAL DOCUMENT.') }));
      card.appendChild(el('p', { style: 'font-size:14px;line-height:1.55;color:#e8eaed;margin:0 0 14px', text: T('c3.ack.body', { form: formLabel }, 'Emailing this {form} to the New York State Workers’ Compensation Board files an official legal claim. The information on it must be TRUE and COMPLETE. Knowingly making a false statement is a crime.') }));
      var callout = el('div', { style: 'border:1px solid #f59e0b;background:rgba(245,158,11,.08);border-radius:10px;padding:14px;margin:0 0 16px' });
      callout.appendChild(el('div', { style: 'font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#f59e0b;margin-bottom:8px', text: T('c3.ack.calloutLabel', 'Certification on Form C-3 — read carefully') }));
      callout.appendChild(el('p', { style: 'font-size:12.5px;line-height:1.6;color:#dce4f0;margin:0 0 10px', text: C3_CERT_AFFIRMATION }));
      callout.appendChild(el('p', { style: 'font-size:12.5px;line-height:1.6;color:#f0d9b5;margin:0;font-weight:600', text: C3_FRAUD_WARNING }));
      card.appendChild(callout);
      var cbRow = el('label', { style: 'display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin:0 0 16px' });
      var cb = el('input', { type: 'checkbox', style: 'margin-top:2px;width:20px;height:20px;flex:0 0 auto;accent-color:#3b82f6' });
      cbRow.appendChild(cb);
      cbRow.appendChild(el('span', { style: 'font-size:13.5px;line-height:1.5;color:#e8eaed', text: T('c3.ack.checkbox', 'I have reviewed my answers and certify they are true to the best of my knowledge.') }));
      card.appendChild(cbRow);
      // #dc2626, not #ef4444: white on #ef4444 measures 3.76:1 and 15px/700 is
      // NOT WCAG "large text", so it needed 4.5:1 and failed. #dc2626 is 4.83:1.
      // The 2px #ef4444 card border and its glow keep the alarm read.
      var GO_OFF = 'width:100%;margin-bottom:8px;background:#dc2626;color:#fff;border:none;border-radius:8px;padding:14px;font-size:15px;font-weight:700;font-family:inherit;cursor:not-allowed;opacity:.5';
      var GO_ON = 'width:100%;margin-bottom:8px;background:#dc2626;color:#fff;border:none;border-radius:8px;padding:14px;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;opacity:1';
      var go = el('button', { type: 'button', disabled: 'disabled', style: GO_OFF }, [T('c3.ack.export', { form: formLabel }, 'Export & email my {form} to the WCB')]);
      var cancel = el('button', { type: 'button', style: 'width:100%;background:transparent;color:#9ba1b0;border:1px solid #2e3145;border-radius:8px;padding:11px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit' }, [T('c3.ack.cancel', 'Cancel — go back')]);
      cb.addEventListener('change', function () { if (cb.checked) { go.disabled = false; go.setAttribute('style', GO_ON); } else { go.disabled = true; go.setAttribute('style', GO_OFF); } });
      go.addEventListener('click', function () { if (go.disabled) return; close(); generate(certAgreed); });
      cancel.addEventListener('click', function () { close(); });
      card.appendChild(go);
      card.appendChild(cancel);
      ov.appendChild(card);
      document.body.appendChild(ov);
      /* a11y (Aurora Glass 6.20) — the LAST of the fourteen. This gate was
       * already correct by hand: role, aria-modal, aria-labelledby, Escape, a
       * Tab cycle and focus restore. It adopts the contract anyway, because
       * fourteen correct-by-hand implementations is the condition the audit
       * found, and the one that drifts is the one nobody re-reads. Behaviour is
       * unchanged: initialFocus stays the certify checkbox — the one thing the
       * claimant must act on, and what the visual baseline photographs — and
       * onEscape points at the SAME close() the Cancel button calls, so the two
       * cannot drift apart.
       *
       * Escape does not dismiss the gate permanently; it fires again on the
       * next export attempt. The sworn-document warning is never skippable.
       *
       * GUARDED, legacy path retained: shared to the website via
       * sync-dashboard.sh, which does not carry js/modal-a11y.js. */
      if (CD.ModalA11y) {
        _release = CD.ModalA11y.attach(ov, { labelledBy: 'c3w-ack-title', onEscape: close, initialFocus: cb });
      } else {
        document.addEventListener('keydown', onAckKey, true);
        // Land on the certify checkbox — the one thing the claimant must act on.
        setTimeout(function () { try { cb.focus(); } catch (e) {} }, 0);
      }
    }

    // The filing this wizard SESSION produced, once submit() has resolved.
    //
    // WHY: on 2026-08-11 one worker's three taps became three complete filings —
    // three 1.7 MB uploads and three c3_filings rows in 64 seconds — because the
    // success screen never appeared and there was nothing to stop a retry from
    // building and filing the whole thing again. `working` cannot cover this: it
    // is cleared the moment the chain settles, so it only guards a double-tap
    // DURING generation, not a retry after it.
    //
    // Scoped to render(), NOT the module: a worker who legitimately opens the
    // wizard again — a second injury, a second claim — must still be able to
    // file. One session, one filing.
    var filedResult = null;

    // WHERE the flow currently is. Two jobs:
    //
    //  1. It drives the button label, so "stuck" is never a mystery to the
    //     worker OR to whoever reads the bug report — "stuck on Uploading" is a
    //     diagnosis, "stuck on Generating…" was three debugging cycles.
    //  2. The watchdog needs it to decide whether a retry is SAFE. Before the
    //     upload starts nothing has been written, so retrying is free. After it
    //     starts the server may already hold the filing, and re-running would
    //     produce the duplicate claim this wizard was fixed for.
    var PHASE = { build: 'build', upload: 'upload', save: 'save', link: 'link' };
    var _phase = null;
    var _watchdog = null;
    // Long enough that a slow-but-alive 1.7 MB upload finishes; short enough
    // that a dead flow surfaces while the worker is still holding the phone.
    var WATCHDOG_MS = 90000;
    function clearWatchdog() { if (_watchdog) { try { clearTimeout(_watchdog); } catch (e) {} _watchdog = null; } }

    function generate(certAgreed) {
      // NEVER silent. `working` used to swallow the tap and return, so once
      // anything in this chain hung, every later tap of "Generate & File My
      // C-3" did nothing at all — no modal, no message — and the wizard was
      // dead until the app was force-closed. That is indistinguishable from a
      // broken button, and it is what "it just stays stuck" reported.
      if (working) { toast(T('c3.toasts.stillWorking', 'Still working on your C-3 — one moment.')); return; }
      // Already filed in this session. The claim is on the server; re-show the
      // screen that proves it rather than filing a duplicate.
      if (filedResult) { showSuccess(filedResult); return; }
      syncFromDom();
      syncToStore();
      if (!validateForExport(certAgreed)) return;
      var c33Only = !!state.c33Only;
      var formLabel = c33Only ? 'C-3.3' : 'C-3';
      working = true;
      var btn = $(c33Only ? 'c3w-c33-generate' : 'c3w-generate'); if (btn) { btn.disabled = true; btn.textContent = T('c3.generating', 'Generating…'); }
      function setPhase(p) {
        _phase = p;
        console.log('[C3] STAGE phase=' + p);
        if (!btn) return;
        btn.textContent =
          p === PHASE.upload ? T('c3.phase.uploading', 'Uploading your C-3…') :
          p === PHASE.save ? T('c3.phase.saving', 'Saving your claim…') :
          p === PHASE.link ? T('c3.phase.linking', 'Finishing up…') :
          T('c3.generating', 'Generating…');
      }
      setPhase(PHASE.build);
      // The backstop. Every previous failure here ended as an indefinite wait,
      // because a stalled read never rejects and nothing was watching the clock
      // for the flow as a whole. Individual reads have deadlines now; this
      // catches anything they don't — including a hung WRITE, which cannot be
      // bounded at the call site without risking a duplicate filing.
      clearWatchdog();
      _watchdog = setTimeout(function () {
        if (!working) return;
        console.error('[C3] WATCHDOG_FIRED phase=' + _phase + ' after ' + WATCHDOG_MS + 'ms');
        working = false;
        showStuck(_phase, formLabel, certAgreed);
      }, WATCHDOG_MS);
      // Permanent, low-volume stage log (5 lines per filing). This flow's failure
      // modes are SILENT — a stalled read throws nothing, so an Xcode log shows
      // only OS-level `nw_read_request_report … Operation timed out` with no way
      // to tell which call stalled. Two rounds of guessing bought that lesson.
      console.log('[C3] STAGE generate-start anon=' + anon + ' c33Only=' + c33Only);
      ensurePdfLib().then(function (PDFLib) {
        console.log('[C3] STAGE pdf-lib-ready');
        var submitter = anon ? new LocalDownloadPackage() : new SelfFilePackage(supabase);
        submitter.onPhase = setPhase;
        if (c33Only) {
          return fillC33(PDFLib).then(function (c33Bytes) {
            if (!c33Bytes) throw new Error('C-3.3 generation failed');
            return submitter.submit(null, c33Bytes);
          });
        }
        return fillC3(PDFLib).then(function (c3Bytes) {
          var c33P = state.priorInjury === 'yes' ? fillC33(PDFLib) : Promise.resolve(null);
          return c33P.then(function (c33Bytes) {
            // Anon: stash the PDF bytes IN MEMORY (never persisted — the PDF holds
            // the SSN) so a signup this session can attach it to the new account.
            if (anon) { try { if (CD.WorkerProfile && CD.WorkerProfile.stashC3) CD.WorkerProfile.stashC3({ name: 'C-3_Employee_Claim.pdf', pdfBytes: c3Bytes, c33Bytes: c33Bytes, hasAttorney: !!(profile && profile.has_attorney), wcbCaseNumber: (profile && profile.wcb_case_number) || null }); } catch (e) {} }
            return submitter.submit(c3Bytes, c33Bytes);
          });
        });
      }).then(function (result) {
        working = false;
        clearWatchdog();
        filedResult = result;
        try { saveClaimTypeToProfile(); } catch (e) {}

        // Housekeeping, NOT part of the filing. These two used to sit in the main
        // promise chain, so a rejected draft-clear dropped a COMPLETED filing into
        // the .catch below and told the worker "We couldn't generate your C-3" —
        // the worst possible lie, because the claim is already on the server.
        // Fire-and-forget, each swallowed independently: nothing after a resolved
        // submit() may turn a real filing into an error.
        try { Promise.resolve(store.remove(STORE_KEY)).catch(function () {}); } catch (e) {}
        try { Promise.resolve(dbClearDraft()).catch(function () {}); } catch (e) {}

        // THE SUCCESS SCREEN OWNS THE END OF THE FLOW. Render it FIRST and leave
        // it up: the download buttons, the ✉️ "Email my claim to the WCB" button
        // (the only in-wizard path to actually filing), the how-to-file steps and
        // the what-happens-next panel all live on it, and the worker stays there
        // until they choose "Back to Dashboard".
        showSuccess(result);

        // ...and only THEN refresh state behind it. This used to be ctx.onComplete(),
        // which reloads the tier AND navigates — its awaited loadTier() resolved a
        // beat later, re-rendered the dashboard, disconnected the wizard's portal
        // anchor and tore the success screen we had just built out of the DOM. The
        // worker saw nothing, so they tapped Generate again: three identical
        // filings in 64 seconds on 2026-08-11. onDataChanged is the refresh-only
        // half of that seam — it reloads entitlement/profile state and NEVER
        // navigates, so "Back to Dashboard" (goDash) stays the one way out and the
        // dashboard shows the new filing in My documents when the worker chooses it.
        try { if (!anon && typeof ctx.onDataChanged === 'function') ctx.onDataChanged(); } catch (e) {}
      }).catch(function (e) {
        working = false;
        clearWatchdog();
        if (btn) { btn.disabled = false; btn.textContent = c33Only ? T('c3.generateC33', 'Generate Form C-3.3') : T('c3.generateC3', 'Generate & File My C-3'); }
        console.error('[C3] GENERATE_FAILED phase=' + _phase, e);
        // A toast fades in five seconds and is easy to miss on a phone that was
        // put down mid-upload; if the failure happened AFTER the write started,
        // the worker needs a persistent, actionable screen instead — retrying
        // blind is how a duplicate claim gets filed.
        if (_phase === PHASE.upload || _phase === PHASE.save || _phase === PHASE.link) { showStuck(_phase, formLabel, certAgreed); return; }
        toast(T('c3.toasts.genFailed', { form: formLabel }, 'We couldn’t generate your {form}. Your answers are still here — please try again.'));
      });
    }

    // Terminal-but-recoverable screen for a flow that stalled or failed after it
    // had started writing. NEVER just re-enable the button in that case: the
    // upload and the c3_filings insert may already have landed, and a blind
    // retry is exactly how one claim becomes two filings.
    //
    // Before the write starts (PHASE.build) nothing has been persisted, so a
    // retry is free and is offered directly.
    function showStuck(phase, formLabel, certAgreed) {
      var mayHaveFiled = (phase === PHASE.upload || phase === PHASE.save || phase === PHASE.link);
      console.warn('[C3] STUCK_SCREEN phase=' + phase + ' mayHaveFiled=' + mayHaveFiled);
      terminalView();
      var v = el('div', { class: 'success-screen' });
      v.appendChild(el('div', { style: 'text-align:center;font-size:34px;margin-bottom:6px', text: '⏳' }));
      v.appendChild(el('h2', { style: 'text-align:center', text: T('c3.stuck.title', 'This is taking longer than expected') }));
      v.appendChild(el('div', { class: 'info-callout', html: mayHaveFiled
        ? T('c3.stuck.mayHaveFiled', { form: formLabel }, '<strong>Your {form} may already have been submitted.</strong> We started sending it but lost the connection before we could confirm. Open <b>My documents</b> on your dashboard to check <b>before</b> trying again — filing twice creates a duplicate claim.')
        : T('c3.stuck.notFiled', { form: formLabel }, '<strong>Your {form} was not submitted.</strong> We couldn’t finish building it — this is almost always a connection problem. Your answers are saved, so you can try again.') }));
      if (mayHaveFiled) {
        v.appendChild(el('button', { class: 'btn btn-primary', style: 'width:100%;margin-bottom:10px', onclick: function () { goDash(); } }, [T('c3.stuck.checkDocs', 'Check My documents')]));
      } else {
        v.appendChild(el('button', { class: 'btn btn-primary', style: 'width:100%;margin-bottom:10px', onclick: function () {
          // Rebuild the deck at the certify card and let them re-sign + retry.
          progress.style.display = ''; foot.style.display = '';
          goToCard('certify', true);
        } }, [T('c3.stuck.tryAgain', 'Try again')]));
      }
      v.appendChild(el('button', { class: 'btn btn-secondary', style: 'width:100%', onclick: function () { goDash(); } }, [T('c3.success.backToDash', 'Back to Dashboard')]));
      viewport.appendChild(v);
      try { viewport.scrollTop = 0; } catch (e) {}
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

    /* ---------- success (truthful) — terminal view in the card viewport - */
    // Disarm the portal's auto-teardown, then clear the deck chrome. From here
    // on the wizard is TERMINAL and only goDash() may remove it — see portal().
    function terminalView() {
      disarmPortal();
      reattachPortal();
      progress.style.display = 'none'; foot.style.display = 'none'; viewport.className = 'c3w-viewport scroll'; viewport.innerHTML = '';
    }
    function showSuccess(result) {
      console.log('[C3] STAGE success-screen path=' + (result && result.path) + ' c33=' + (result && result.c33path) +
        ' signedUrl=' + !!(result && result.signedUrl) + ' c33SignedUrl=' + !!(result && result.c33SignedUrl));
      terminalView();
      var toAttorney = state.branch === 'attorney' && profile.attorney_email;
      var hasC3 = !!result.signedUrl || !!result.path;
      var c33Only = !hasC3 && !!result.c33path;
      var both = hasC3 && !!result.c33path;
      var _formType = both ? 'c3_c33' : (c33Only ? 'c33' : 'c3');
      var pktNoun = both ? T('c3.success.packetBoth', 'both PDFs (your C-3 and C-3.3)') : T('c3.success.packetOne', 'the PDF');
      var headline = c33Only ? T('c3.success.headlineC33', 'Your Form C-3.3 is ready') : T('c3.success.headlineC3', 'Your C-3 is ready');
      var formName = c33Only ? T('c3.success.formNameC33', 'Form C-3.3 (HIPAA medical release)') : T('c3.success.formNameC3', 'C-3 Employee Claim');
      var c33Note = both ? ' ' + T('c3.success.c33Note', 'Your Form C-3.3 (HIPAA release) is included — file it together with your C-3.') : '';
      var c33OnlyNote = c33Only ? ' ' + T('c3.success.c33OnlyNote', 'File it together with your C-3 to commence the claim.') : '';
      var savedClause = anon
        ? ' ' + T('c3.success.savedAnon', 'It’s on this device only — your answers and Social Security number were not uploaded to us.')
        : ' ' + T('c3.success.savedAccount', 'We saved it to your account.');
      var screen = el('div', { class: 'success-screen' }, [
        el('div', { class: 'success-icon', text: '✓' }),
        el('h2', { text: headline }),
        el('p', { text: T('c3.success.generated', { formName: formName }, 'We generated your signed {formName}.') + savedClause + c33Note + c33OnlyNote + ' ' + T('c3.success.notSubmitted', 'It has not been submitted to the WCB — here’s how to file it.') })
      ]);
      function dlBtn(label, cls, fileName, url) {
        var b = el('button', { type: 'button', class: cls, style: 'display:block;width:100%;text-align:center;margin-bottom:10px' }, [label]);
        b.addEventListener('click', function () {
          logUsage('download', _formType);
          if (CD.NativeMail && CD.NativeMail.savePdf) {
            var orig = b.textContent; b.disabled = true;
            b.textContent = T('c3.success.preparing', 'Preparing…');
            CD.NativeMail.savePdf({ name: fileName, url: url })
              .catch(function (e) { console.warn('[C3] SAVE_FAILED', e); })
              .then(function () { b.disabled = false; b.textContent = orig; });
          } else { try { window.open(url, '_blank'); } catch (e) {} }
        });
        return b;
      }
      if (result.signedUrl) screen.appendChild(dlBtn('⬇ ' + T('c3.success.downloadC3', 'Download your C-3 (PDF)'), 'btn btn-primary', 'C-3_Employee_Claim.pdf', result.signedUrl));
      if (result.c33SignedUrl) screen.appendChild(dlBtn('⬇ ' + T('c3.success.downloadC33', 'Download Form C-3.3'), c33Only ? 'btn btn-primary' : 'btn btn-secondary', 'C-3.3_HIPAA_Release.pdf', result.c33SignedUrl));

      var WCB_EMAIL = 'wcbclaimsfiling@wcb.ny.gov';
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
        var emailBtn = el('button', { type: 'button', class: 'btn btn-primary', style: 'display:block;width:100%;margin-bottom:10px' }, ['✉️ ' + T('c3.success.emailBtn', 'Email my claim to the WCB')]);
        emailBtn.addEventListener('click', function () {
          logUsage('email', _formType);
          emailBtn.disabled = true; var orig = emailBtn.textContent; emailBtn.textContent = T('c3.success.openingMail', 'Opening mail…');
          CD.NativeMail.emailClaimToWCB({ to: WCB_EMAIL, subject: _emailSubject, body: _emailBody, attachments: _emailAtts })
            .catch(function (e) { console.warn('[C3] EMAIL_TO_WCB_FAILED', e); })
            .then(function () { emailBtn.disabled = false; emailBtn.textContent = orig; });
        });
        screen.appendChild(emailBtn);
      }

      // The connection dropped between saving the filing and minting its
      // download links. The claim IS on the server — the upload and the
      // c3_filings insert both succeeded — but with no signed URL there is no
      // download button and no email button to render, and the "tap ✉️ Email my
      // claim to the WCB above" step below would be pointing at nothing. Say so
      // plainly and send them to My documents, whose own ✉️ Email to WCB button
      // (worker-dashboard.js) mints a fresh link and has always worked.
      var _linksMissing = !anon && !result.signedUrl && !result.c33SignedUrl && !!(result.path || result.c33path);
      if (_linksMissing) {
        console.warn('[C3] SIGNED_URL_UNAVAILABLE — filing saved, links not minted');
        screen.appendChild(el('div', { class: 'info-callout', html: T('c3.success.linksUnavailable',
          '<strong>Your claim is saved to your account.</strong> We couldn’t create the download link just now — your connection dropped. Open <b>My documents</b> on your dashboard to download it or email it to the WCB.') }));
      }

      var steps = el('div', { class: 'file-steps' }, [el('h3', { text: T('c3.success.howToFile', 'How to file with the WCB') })]);
      function fstep(n, html) { return el('div', { class: 'file-step' }, [el('div', { class: 'file-step-num', text: String(n) }), el('div', { html: html })]); }
      if (both) steps.appendChild(fstep('!', T('c3.success.stepBothWarning', '<b>Send both in the same email.</b> Because you indicated a prior injury to the same body part, your C-3.3 (HIPAA release) must be filed <b>together with your C-3, in one email/submission</b> — never sent separately.')));
      if (c33Only) steps.appendChild(fstep('!', T('c3.success.stepPairWarning', '<b>Pair it with your C-3.</b> File the C-3.3 in the <b>same email/submission</b> as your C-3 so the Board can act on the release.')));
      var stepNo = 0;
      if (toAttorney) {
        steps.appendChild(fstep(++stepNo, T('c3.success.stepAttorney', { packet: pktNoun, email: escapeHtml(profile.attorney_email) }, 'Send {packet} to your attorney at <b>{email}</b> — they may file for you. Download above and attach to an email.')));
        steps.appendChild(fstep(++stepNo, T('c3.success.stepPreferSelf', 'Prefer to file it yourself? Use any of the options below.')));
      }
      // Only promise the one-tap email when the button is actually on screen.
      if (!_linksMissing) steps.appendChild(fstep(++stepNo, T('c3.success.stepEmail', { packet: pktNoun, email: WCB_EMAIL }, '<b>Email it to the WCB (fastest):</b> tap <b>“✉️ Email my claim to the WCB”</b> above — it opens your mail app with {packet} attached, addressed to <b>{email}</b>. This is the email filing described in <b>Item 7</b> of the C-3.')));
      steps.appendChild(fstep(++stepNo, T('c3.success.stepOnline', { packet: pktNoun }, '<b>Online:</b> upload {packet} at the WCB Forms Submission portal, <b>wcb.ny.gov</b> → “File a Claim / Submit Forms.”')));
      steps.appendChild(fstep(++stepNo, T('c3.success.stepMail', '<b>By mail:</b> NYS Workers’ Compensation Board, Centralized Mailing, PO Box 5205, Binghamton, NY 13902-5205.')));
      steps.appendChild(fstep(++stepNo, T('c3.success.stepFax', '<b>By fax:</b> (877) 533-0337.')));
      screen.appendChild(steps);

      var nextBox = el('div', { class: 'file-steps' }, [el('h3', { text: T('c3.success.whatNextTitle', 'What the WCB does next') })]);
      nextBox.appendChild(el('div', { class: 'file-step' }, [el('div', { html: T('c3.success.whatNextBody', 'Once they receive your claim, the Board <b>indexes it and assigns a WCB case number</b>, then notifies your employer and its insurance carrier. The carrier must accept or dispute the claim, and the Board will mail you about any hearings or next steps. <b>Keep a copy of everything you file.</b>') })]));
      screen.appendChild(nextBox);

      // The ONE unified attorney affordance — carries its own ATTORNEY ADVERTISING
      // chip + "How this works" link (attorney-cta.js), so no wall is needed here.
      if (!(profile && profile.has_attorney) && !toAttorney && typeof CD.AttorneyCTA === 'function') {
        var _doneCta = CD.AttorneyCTA({ variant: 'inline', source: 'c3_complete' });
        if (_doneCta) screen.appendChild(el('div', { style: 'margin:4px 0 16px' }, [_doneCta]));
      }

      screen.appendChild(el('div', { class: 'info-callout', html: c33Only
        ? T('c3.success.beforeFileC33', '<strong>Before you file:</strong> open the PDF and review it. Sign in ink if a viewer didn’t carry your drawn signature, then file. Your answers are saved on the form.')
        : T('c3.success.beforeFileC3', '<strong>Before you file:</strong> open the PDF and review it. A few Yes/No checkboxes may be blank — mark any that apply to you, then file. Your answers are saved on the form.') }));
      screen.appendChild(el('button', { class: 'btn btn-primary', style: 'width:100%;margin-bottom:10px', onclick: function () { showNextSteps(_formType); } }, ['✅ ' + T('c3.success.sentBtn', 'I’ve sent it — what happens next?')]));
      screen.appendChild(el('button', { class: 'btn btn-secondary', style: 'width:100%', onclick: function () { goDash(); } }, [T('c3.success.backToDash', 'Back to Dashboard')]));
      viewport.appendChild(screen);
      try { viewport.scrollTop = 0; } catch (e) {}
      // The STAGE line above only proves showSuccess was ENTERED. This proves it
      // finished AND that the screen is still on screen a beat later — the exact
      // gap that made "the wizard stalls" ambiguous for three debugging rounds.
      console.log('[C3] STAGE success-rendered connected=' + screen.isConnected + ' rootInDoc=' + root.isConnected);
      setTimeout(function () {
        console.log('[C3] STAGE success-alive+2s connected=' + screen.isConnected + ' rootInDoc=' + root.isConnected +
          ' visible=' + (screen.getBoundingClientRect().height > 0));
      }, 2000);
    }

    function showNextSteps(formType) {
      terminalView();
      var v = el('div', { class: 'success-screen' });
      v.appendChild(el('div', { style: 'text-align:center;font-size:34px;margin-bottom:6px', text: '📬' }));
      v.appendChild(el('h2', { style: 'text-align:center', text: T('c3.next.title', 'What happens next') }));
      v.appendChild(el('p', { style: 'text-align:center', text: T('c3.next.sub', 'You’ve filed your claim with the New York State Workers’ Compensation Board. Here’s what to expect over the coming weeks.') }));
      var box = el('div', { class: 'file-steps' });
      function nstep(n, html) { return el('div', { class: 'file-step' }, [el('div', { class: 'file-step-num', text: String(n) }), el('div', { html: html })]); }
      box.appendChild(nstep(1, T('c3.next.s1', 'The Board <b>receives and indexes your claim</b> and assigns it a <b>WCB case number</b>.')));
      box.appendChild(nstep(2, T('c3.next.s2', '<b>Watch your mailbox.</b> The Board contacts you <b>by mail at the address on your form</b> over the coming weeks. Open everything and keep it.')));
      box.appendChild(nstep(3, T('c3.next.s3', 'Your <b>employer and its insurance carrier are notified</b>. The carrier must then <b>accept or dispute (deny)</b> your claim.')));
      box.appendChild(nstep(4, T('c3.next.s4', 'If it’s <b>accepted</b>, your benefits move forward. If it’s <b>disputed</b>, the Board schedules a <b>hearing</b> and mails you the date.')));
      box.appendChild(nstep(5, T('c3.next.s5', '<b>Keep a copy of everything</b> you filed and every letter you receive.')));
      v.appendChild(box);
      v.appendChild(el('div', { class: 'info-callout', html: T('c3.next.callout', 'This can take a few weeks — that’s normal. If you’re unsure about anything, it’s wise to speak with a workers’ compensation attorney.') }));
      if (anon) {
        var card = el('div', { style: 'border:2px solid #f59e0b;background:rgba(245,158,11,.08);border-radius:12px;padding:18px 16px;margin:4px 0 14px;text-align:center' });
        card.appendChild(el('div', { style: 'font-size:15px;font-weight:700;color:#f0d9b5;margin-bottom:6px', text: '⚠️ ' + T('c3.next.dontLose', 'Don’t lose your completed C-3') }));
        card.appendChild(el('p', { style: 'font-size:13px;color:#cbd2dd;line-height:1.5;margin:0 0 14px', text: T('c3.next.dontLoseBody', 'Your filing lives only on this phone right now — if you close or delete the app, it’s gone for good. Create a free account to save it and track your case.') }));
        card.appendChild(el('button', { class: 'btn btn-primary', style: 'width:100%;margin-bottom:8px', onclick: function () { try { if (CD.showAuth) CD.showAuth(T('c3.offer.authPrompt', 'Create a free account to save your C-3 filing')); } catch (e) {} } }, [T('c3.next.createAccount', 'Create my free account')]));
        card.appendChild(el('button', { class: 'btn btn-secondary', style: 'width:100%', onclick: function () { goDash(); } }, [T('c3.next.noThanks', 'No thanks — done')]));
        v.appendChild(card);
      } else {
        v.appendChild(el('button', { class: 'btn btn-secondary', style: 'width:100%', onclick: function () { goDash(); } }, [T('c3.success.backToDash', 'Back to Dashboard')]));
      }
      viewport.appendChild(v);
      try { viewport.scrollTop = 0; } catch (e) {}
    }
    function escapeHtml(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
    function disarmPortal() { try { if (root.__c3portal) root.__c3portal.disarm(); } catch (e) {} }
    // Last line of defence, and the one that actually had to exist.
    //
    // Disarming only stops FUTURE teardowns. On 2026-08-11 the device log showed
    // `success-rendered connected=false rootInDoc=false` — the wizard had already
    // been removed from the DOM *during* the 6-10s generation window (an #app
    // re-render from elsewhere in the app; the same log carries a failed
    // analytics POST and a burst of biometric re-init). showSuccess then built a
    // perfect success screen inside a detached node and the worker saw the
    // previous card, or a black screen behind the account-offer modal.
    //
    // Disarming at the terminal screen was too late by definition. So the
    // terminal view also PUTS THE WIZARD BACK if something took it: the C-3 is
    // generated, the worker is owed the screen with the download and ✉️ WCB
    // buttons, and no repaint elsewhere in the app gets to deny them that.
    function reattachPortal() {
      try {
        if (!root.isConnected && document.body) {
          document.body.appendChild(root);
          _markImmersive(true);
          console.warn('[C3] PORTAL_REATTACHED — the wizard had been removed from the DOM mid-flow');
        }
      } catch (e) { console.warn('[C3] PORTAL_REATTACH_FAILED', e); }
    }
    // Leaving is the worker's choice, so THIS is where the portal comes down.
    // Once terminalView() has disarmed the observer, nothing else removes the
    // root — without this the wizard would be orphaned over the dashboard.
    function goDash() {
      try { if (root.__c3portal) root.__c3portal.teardown(); } catch (e) {}
      if (typeof ctx.goToDashboard === 'function') { try { ctx.goToDashboard(); return; } catch (e) {} }
      if (typeof ctx.onComplete === 'function') { try { ctx.onComplete(); return; } catch (e) {} }
      try { window.location.reload(); } catch (e) {}
    }

    /* ---------- autosave persist + restore (card-index keyed) ---------- */
    var DRAFT_TABLE = 'c3_drafts';
    var _dbTimer = null;
    function nowMs() { try { return Date.now(); } catch (e) { return 0; } }
    function relTime(ms) {
      if (!ms) return '';
      var s = Math.round((nowMs() - ms) / 1000); if (s < 45) return T('c3.relTime.justNow', 'just now');
      var m = Math.round(s / 60); if (m < 60) return m === 1 ? T('c3.relTime.minuteAgo', '1 minute ago') : T('c3.relTime.minutesAgo', { n: String(m) }, '{n} minutes ago');
      var h = Math.round(m / 60); if (h < 24) return h === 1 ? T('c3.relTime.hourAgo', '1 hour ago') : T('c3.relTime.hoursAgo', { n: String(h) }, '{n} hours ago');
      var d = Math.round(h / 24); return d === 1 ? T('c3.relTime.dayAgo', '1 day ago') : T('c3.relTime.daysAgo', { n: String(d) }, '{n} days ago');
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
    // Save on every card advance, keyed to the card index. SSN is EXEMPT — it is
    // never written to the draft store (in-memory only, straight onto the PDF).
    // Push claim_type (+ the disablement date, which for an OD claim IS the date
    // this wizard collected as `doi`) onto the profiles row.
    //
    // WHY THIS EXISTS: deadlines.js anchors the WCL §18/§45 clock on
    // profiles.date_of_disablement when it is present and falls back to the
    // accident date otherwise; tile-manifest.js ships a whole `disablement` tile
    // and an "Occupational deadlines run from your date of disablement — add it"
    // empty state; adaptive-dashboard.js reads p.date_of_disablement directly.
    // Every one of those was permanently empty for a worker who had just typed
    // the date into this wizard, because the C-3 only ever wrote to the LOCAL
    // WorkerProfile store — which models date_of_injury and has no claim_type or
    // date_of_disablement key at all. Fire-and-forget: a failed write must never
    // block a generated filing.
    function saveClaimTypeToProfile() {
      if (anon || !user || !user.id || !supabase) return;
      var patch = { claim_type: state.claimType };
      if (isOD() && state.doi) patch.date_of_disablement = state.doi;
      try {
        supabase.from('profiles').update(patch).eq('id', user.id).then(function (res) {
          if (res && res.error) console.warn('[C3] CLAIM_TYPE_SAVE_FAILED', res.error);
        }, function (e) { console.warn('[C3] CLAIM_TYPE_SAVE_FAILED', e); });
      } catch (e) { console.warn('[C3] CLAIM_TYPE_SAVE_FAILED', e); }
    }
    function persist() {
      var snap = {};
      Object.keys(state).forEach(function (k) { if (!SENSITIVE[k]) snap[k] = state[k]; });
      snap.__savedAt = nowMs();
      store.set(STORE_KEY, snap);
      dbSaveDraftDebounced(snap);
    }
    function applyDraft(saved) {
      if (!saved) return;
      Object.keys(saved).forEach(function (k) { if (k === '__savedAt') return; if (k in state && !SENSITIVE[k]) state[k] = saved[k]; });
    }
    function resetToBaseline() {
      Object.keys(state).forEach(function (k) { state[k] = Array.isArray(BASELINE[k]) ? BASELINE[k].slice() : (k in BASELINE ? BASELINE[k] : (Array.isArray(state[k]) ? [] : '')); });
      state.step = 0; state.cardKey = ''; state.c33Only = false;
      prefilled = {}; Object.keys(PREFILLABLE).forEach(function (k) { if (state[k] && String(state[k]).trim()) prefilled[k] = true; });
    }
    function hydrateFromIntake() {
      if (anon || !user || !user.id) return Promise.resolve();
      return store.get(INTAKE_PREFIX + user.id).then(function (intk) {
        if (!intk) return;
        function blank(k) { return state[k] == null || String(state[k]).trim() === ''; }
        function fill(stateKey, val) { if (val == null || String(val).trim() === '' || !blank(stateKey)) return; state[stateKey] = val; if (PREFILLABLE[stateKey]) prefilled[stateKey] = true; }
        var nm2 = [intk.first_name, intk.last_name].filter(Boolean).join(' ');
        fill('name', nm2); if (blank('certName') && nm2) state.certName = nm2;
        fill('dob', intk.dob); fill('phone', intk.phone); fill('mailing', intk.home_address); fill('doi', intk.doa); fill('employer', intk.employer_name);
        fill('treatingDoctors', [intk.treating_doctor, intk.treating_doctor_address].filter(Boolean).join(', '));
        if (intk.language_pref && intk.language_pref !== 'en' && blank('language')) state.language = intk.language_pref;
        if ((!state.bodyParts || !state.bodyParts.length) && Array.isArray(intk.body_parts) && intk.body_parts.length) state.bodyParts = intk.body_parts.slice();
        if (intk.work_status) {
          if (blank('stoppedWork')) state.stoppedWork = (intk.work_status !== 'working') ? 'yes' : '';
          if (blank('returnedWork')) state.returnedWork = (intk.work_status === 'working' || intk.work_status === 'light_duty') ? 'yes' : '';
          if (blank('returnDuty')) state.returnDuty = (intk.work_status === 'light_duty') ? 'limited' : (intk.work_status === 'working' ? 'regular' : '');
        }
        persist();
      }).catch(function () {});
    }
    // On re-entry, OFFER to resume (don't silently jump) — the worker chooses.
    function offerResume(savedKey, atMs) {
      progress.style.display = 'none'; foot.style.display = 'none';
      viewport.className = 'c3w-viewport'; viewport.innerHTML = '';
      var when = relTime(atMs);
      var card = el('div', { class: 'c3w-resume-card' }, [
        el('div', { style: 'font-size:34px;margin-bottom:10px', text: '⏳' }),
        el('h2', { class: 'c3w-card-title', style: 'font-size:20px', text: T('c3.resume.title', 'Resume your claim') }),
        el('p', { class: 'c3w-card-sub', style: 'margin:6px 0 18px', text: when ? T('c3.resume.savedWhen', { when: when }, 'Saved {when} — pick up right where you left off.') : T('c3.resume.pickUp', 'Pick up right where you left off.') }),
        el('button', { class: 'btn btn-primary', style: 'width:100%;margin-bottom:10px', onclick: function () { foot.style.display = ''; goToCard(savedKey, true); } }, [T('c3.resume.resumeBtn', 'Resume')]),
        el('button', { class: 'btn btn-secondary', style: 'width:100%', onclick: function () { try { store.remove(STORE_KEY); } catch (e) {} dbClearDraft(); resetToBaseline(); foot.style.display = ''; goToCard(firstDataKey(), true); } }, [T('c3.resume.startOver', 'Start over')])
      ]);
      viewport.appendChild(card);
    }
    function restore() {
      return store.get(STORE_KEY).then(function (localSaved) {
        return dbGetDraft().then(function (dbRow) {
          var localAt = (localSaved && localSaved.__savedAt) ? localSaved.__savedAt : 0;
          var dbAt = (dbRow && dbRow.updated_at) ? new Date(dbRow.updated_at).getTime() : 0;
          var chosen = null, chosenAt = 0, chosenKey = '';
          if (dbRow && dbRow.data && dbAt >= localAt) { chosen = dbRow.data; chosenAt = dbAt; chosenKey = dbRow.data.cardKey || ''; }
          else if (localSaved) { chosen = localSaved; chosenAt = localAt; chosenKey = localSaved.cardKey || ''; }
          if (chosen) applyDraft(chosen);
          return hydrateFromIntake().then(function () {
            if (chosen && chosen.c33Only) { goToStandaloneC33(); return; }
            if (chosenKey && stepIndex(deckList(), chosenKey) > 0) offerResume(chosenKey, chosenAt);
            else goToCard(firstDataKey(), true);
          });
        });
      }).catch(function (e) { console.warn('[C3] RESTORE_FAILED', e); goToCard(firstDataKey(), true); });
    }

    // boot — show the Terms-of-Use gate at C-3 start EVERY time; start the deck on
    // accept, leave the flow on "Not now".
    setTimeout(function () {
      applyVV();
      try {
        if (CD.TouGate && CD.TouGate.open) CD.TouGate.open({ onAccept: startDeck, onCancel: goDash });
        else startDeck();
      } catch (e) { startDeck(); }
    }, 0);
    return portal(root);
  }

  CD.C3Wizard = { render: render };
})(window);
