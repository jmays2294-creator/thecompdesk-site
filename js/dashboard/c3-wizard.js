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
 * c3-filings/{user_id}/{ts}.pdf (own-folder RLS). Only the PDF blob holds PHI;
 * drafts stay client-local (never DB); c3_filings rows hold no narrative PHI.
 * ========================================================================== */
(function (window) {
  'use strict';
  var CD = (window.CD = window.CD || {});

  /* ---- constants -------------------------------------------------------- */
  var STEP_NAMES = { 1: 'You & Your Job', 2: 'The Injury', 3: 'Employer & Notice', 4: 'Medical & Work', 5: 'Review & Sign' };
  var TOTAL_STEPS = 5;
  var STORAGE_PREFIX = 'c3:filing:';

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
    mailing: P1 + '_3_Mailing_address[0]', mailing2: P1 + 'undefined_3[0]',
    ssn: P1 + 'Social_Security_Number[0]',
    phone: P1 + '_5_Phone_Number[0]',
    genderM: P1 + 'Check_Box2[0]', genderF: P1 + 'Check_Box3[0]',          // A6 Gender M/F
    translatorY: P1 + 'Check_Box4[0]', translatorN: P1 + 'Check_Box5[0]',  // A7 translator Yes/No
    language: P1 + 'If_yes_for_what_language[0]',
    // B. Your employer(s)
    employer: P1 + '_1_Employer_when_injured[0]',
    employerPhone: P1 + '_2_Phone_Number[0]',
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
    // E. Return to work
    stopWorkDate: P2 + 'on_what_date[0]',
    returnedDate: P2 + 'If_yes_on_what_date[0]',
    regularDuty: P2 + 'regular_duty[0]', limitedDuty: P2 + 'limited_duty[0]',
    sameEmployer: P2 + 'Same_employer[0]', newEmployer: P2 + 'New_employer[0]', selfEmployed: P2 + 'Self_employed[0]',
    grossPay2: P2 + '_4_What_is_your_gross_pay_before_taxes_per_pay_period[0]',
    payFreq2: P2 + 'How_often_are_you_paid[0]',
    // F. Medical treatment
    firstTreatDate: P2 + '_1_What_was_the_date_of_your_first_treatment[0]',
    noneReceived: P2 + 'None_received_skip_to_question_F5[0]',
    firstTreatName1: P2 + 'Name_and_address_where_you_were_first_treated_1[0]',
    firstTreatName2: P2 + 'Name_and_address_where_you_were_first_treated_2[0]',
    firstTreatPhone: P2 + 'Phone_Number[0]',
    treatingDoctors1: P2 + 'Give_the_name_and_address_of_the_doctors_treating_you_for_this_injuryillness_1[0]',
    treatingDoctors2: P2 + 'Give_the_name_and_address_of_the_doctors_treating_you_for_this_injuryillness_2[0]',
    treatingDoctorsPhone: P2 + 'Phone_Number_2[0]',
    // Certification
    printName: P2 + 'Print_Name[0]',
    certDate: P2 + 'Date[0]'
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
      '.c3w .prefill-tag{display:inline-block;font-size:10px;font-weight:600;color:var(--success);background:var(--success-light);padding:1px 6px;border-radius:10px;margin-left:6px;text-transform:uppercase;letter-spacing:.3px}',
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

    // ---- FAIL LOUD: prefill requires a session + profile -----------------
    if (!supabase || !user || !user.id) {
      root.appendChild(el('div', { class: 'fatal' }, [
        el('h2', { text: 'We couldn’t verify your session' }),
        el('p', { text: 'Please sign in again to start your C-3 filing.' })
      ]));
      return root;
    }
    if (!profile) {
      // never silently blank-fill — the whole value of the wizard is the prefill
      root.appendChild(el('div', { class: 'fatal' }, [
        el('h2', { text: 'We couldn’t load your profile' }),
        el('p', { text: 'Your C-3 pre-fills from your Comp Buddy profile, and that read failed. Please reload and try again — we don’t want to start your claim form blank.' }),
        el('button', { class: 'btn btn-primary', style: 'max-width:220px;margin:0 auto', onclick: function () { try { window.location.reload(); } catch (e) {} } }, ['Reload'])
      ]));
      console.error('[C3] PREFILL_NO_PROFILE — refusing to render the wizard without a profile row');
      return root;
    }

    /* ---- working state (prefilled from profile) ------------------------ */
    var nm = splitName(profile.full_name);
    var addr = [profile.home_address, profile.home_city].filter(Boolean).join(', ');
    var state = {
      step: 0, branch: '', // '' | 'self' | 'attorney'
      // A. you
      name: profile.full_name || '', dob: profile.dob || '', ssn: '', gender: '',
      mailing: profile.home_address || '', mailing2: profile.home_city || '',
      phone: profile.phone || '', translator: '', language: (profile.language_pref && profile.language_pref !== 'en') ? profile.language_pref : '',
      // B. employer
      employer: profile.employer_name || '', employerPhone: '', workAddress: '', supervisor: '', otherEmployers: '',
      // C. job
      jobTitle: OCC_LABELS[profile.occupation] || '', activities: '', jobTime: '', jobOther: '', grossPay: '', payFreq: '',
      // D. injury
      doi: profile.doa || '', timeOfInjury: '', ampm: '', whereHappened: '', whatDoing: '', howHappened: '',
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
      stillTreating: '', treatingDoctors: [profile.treating_doctor_name, profile.treating_doctor_address].filter(Boolean).join(', '), treatingDoctorsPhone: profile.treating_doctor_phone || '',
      // F5/F6 prior injury (triggers C-3.3)
      priorInjury: '', priorWorkRelated: '', priorSameEmployer: '', priorTreatedByDoctor: '',
      c33_priorDesc: '', c33_providers: '', c33_releaseMentalHealth: false,
      c33Only: false,                            // standalone HIPAA-release-only flow
      // cert
      certName: profile.full_name || ''
    };
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
      el('div', { class: 'progress-label' }, [
        document.createTextNode('Step '), el('span', { id: 'c3w-step-current', text: '1' }),
        document.createTextNode(' of ' + TOTAL_STEPS + ' — '), el('span', { id: 'c3w-step-name', text: STEP_NAMES[1] })
      ])
    ]);
    root.appendChild(progress);

    var bodyWrap = el('div', { class: 'c3w-body' });
    root.appendChild(bodyWrap);

    /* ================= STEP 0 — gate & route ========================== */
    var step0 = el('div', { class: 'step-section active', id: 'c3w-step-0' });
    step0.appendChild(el('div', { class: 'step-intro' }, [
      el('div', { class: 'step-intro-icon', text: '📝' }),
      el('h2', { text: 'File your C-3 Employee Claim' }),
      el('p', { text: 'We’ll build your signed C-3 from what we already know about your case, then show you exactly how to file it with the WCB.' })
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
      step0.appendChild(el('div', { class: 'btn-row' }, [el('button', { class: 'btn btn-primary', onclick: function () { state.branch = 'self'; persist(); goToStep(1); } }, ['Get Started'])]));
    }
    // Standalone HIPAA-release entry — the C-3.3 is its own authorization and can
    // be needed even when you're not filing a fresh C-3 right now.
    step0.appendChild(el('div', { class: 'info-callout', style: 'margin-top:16px', html: 'Just need the medical-records release? <a href="#" id="c3w-c33-only-link" style="color:var(--accent);font-weight:700">Complete Form C-3.3 (HIPAA) on its own →</a><br><span style="color:var(--text-muted)">The C-3.3 authorizes the doctors who treated a previous injury to release those records to the insurer. File it with your C-3, or by itself.</span>' }));
    bodyWrap.appendChild(step0);

    /* ================= STEP 1 — You & Your Job (A + C) ================ */
    var step1 = el('div', { class: 'step-section', id: 'c3w-step-1' });
    step1.appendChild(stepIntro('👤', 'You & Your Job', 'Confirm your details — we’ve pre-filled what we know.'));
    var c1 = card('About You', 'From your profile. Edit anything that’s changed.');
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
    var c2 = card('When & Where');
    c2.appendChild(fieldRow([
      dateField('c3w-doi', 'Date of Injury / Onset', 'req', state.doi, !!state.doi),
      textField('c3w-timeOfInjury', 'Time of Injury', 'opt', state.timeOfInjury, 'e.g. 2:30', false)
    ]));
    c2.appendChild(group([el('label', { class: 'form-label', text: 'AM or PM?' }), optionRow('c3w-ampm', '', [['AM', 'AM'], ['PM', 'PM']], state.ampm, function (v) { state.ampm = v; persist(); })]));
    c2.appendChild(group([el('label', { class: 'form-label', html: 'Where did it happen?<span class="req">*</span>' }), el('input', { type: 'text', class: 'form-input', id: 'c3w-whereHappened', value: state.whereHappened, placeholder: 'e.g. 1 Main Street, Pottersville, at the loading dock' }), errEl('c3w-err-whereHappened', 'Tell us where the injury happened')]));
    step2.appendChild(c2);

    var c2b = card('What Happened');
    c2b.appendChild(group([el('label', { class: 'form-label', html: 'What were you doing when injured?<span class="req">*</span>' }), el('textarea', { class: 'form-input', id: 'c3w-whatDoing', placeholder: 'e.g. unloading a truck, typing a report' }, [state.whatDoing]), errEl('c3w-err-whatDoing', 'Describe what you were doing')]));
    c2b.appendChild(group([el('label', { class: 'form-label', html: 'How did the injury/illness happen?<span class="req">*</span>' }), el('textarea', { class: 'form-input', id: 'c3w-howHappened', placeholder: 'e.g. I tripped over a pipe and fell on the floor' }, [state.howHappened]), errEl('c3w-err-howHappened', 'Describe how it happened')]));
    step2.appendChild(c2b);

    var c2c = card('Injured Body Parts', 'We pre-checked the parts from your profile. Add the nature of the injury.');
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
    c3a.appendChild(group([el('label', { class: 'form-label', html: 'Employer When Injured<span class="req">*</span>' + prefillTag(!!state.employer) }), el('input', { type: 'text', class: 'form-input', id: 'c3w-employer', value: state.employer, placeholder: 'Company name' }), errEl('c3w-err-employer', 'Employer name is required')]));
    c3a.appendChild(fieldRow([
      textField('c3w-employerPhone', 'Employer Phone', 'opt', state.employerPhone, '(212) 555-1234', false),
      textField('c3w-supervisor', 'Supervisor’s Name', 'opt', state.supervisor, '', false)
    ]));
    c3a.appendChild(group([el('label', { class: 'form-label', html: 'Your Work Address<span class="opt">(optional)</span>' }), el('input', { type: 'text', class: 'form-input', id: 'c3w-workAddress', value: state.workAddress, placeholder: 'Where you worked' })]));
    c3a.appendChild(group([el('label', { class: 'form-label', html: 'Other Employers at the Time<span class="opt">(optional)</span>' }), el('textarea', { class: 'form-input', id: 'c3w-otherEmployers', placeholder: 'Names/addresses of any other employers' }, [state.otherEmployers])]));
    step3.appendChild(c3a);

    var c3b = card('Notice & Witnesses');
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
    c4a.appendChild(fieldRow([
      dateField('c3w-firstTreatDate', 'Date of First Treatment', 'opt', state.firstTreatDate, false),
      selectField('c3w-treatType', 'Where first treated?', 'opt', [['', 'Select…']].concat(TREAT_TYPE), state.treatType)
    ]));
    c4a.appendChild(group([el('label', { class: 'form-label', html: 'Name & address where first treated<span class="opt">(optional)</span>' }), el('input', { type: 'text', class: 'form-input', id: 'c3w-firstTreatName', value: state.firstTreatName })]));
    c4a.appendChild(group([el('label', { class: 'form-label', html: 'Doctor(s) currently treating you<span class="opt">(optional)</span>' + prefillTag(!!state.treatingDoctors) }), el('input', { type: 'text', class: 'form-input', id: 'c3w-treatingDoctors', value: state.treatingDoctors, placeholder: 'Name & address' })]));
    step4.appendChild(c4a);

    var c4b = card('Return to Work');
    c4b.appendChild(group([el('label', { class: 'form-label', html: 'Did you stop work because of the injury?' + prefillTag(!!state.stoppedWork) }), optionRow('c3w-stoppedWork', '', [['yes', 'Yes'], ['no', 'No']], state.stoppedWork, function (v) { state.stoppedWork = v; $('c3w-stop-detail').style.display = v === 'yes' ? 'block' : 'none'; persist(); })]));
    c4b.appendChild(el('div', { id: 'c3w-stop-detail', style: state.stoppedWork === 'yes' ? 'display:block' : 'display:none' }, [group([el('label', { class: 'form-label', text: 'On what date?' }), dateInput('c3w-stopWorkDate', state.stopWorkDate)])]));
    c4b.appendChild(group([el('label', { class: 'form-label', html: 'Have you returned to work?' + prefillTag(!!state.returnedWork) }), optionRow('c3w-returnedWork', '', [['no', 'No'], ['yes', 'Yes']], state.returnedWork, function (v) { state.returnedWork = v; $('c3w-return-detail').style.display = v === 'yes' ? 'block' : 'none'; persist(); })]));
    c4b.appendChild(el('div', { id: 'c3w-return-detail', style: state.returnedWork === 'yes' ? 'display:block' : 'display:none' }, [
      fieldRow([dateField('c3w-returnDate', 'Return date', 'opt', state.returnDate, false), null]),
      group([el('label', { class: 'form-label', text: 'Duty type' }), optionRow('c3w-returnDuty', '', [['regular', 'Regular duty'], ['limited', 'Limited duty']], state.returnDuty, function (v) { state.returnDuty = v; persist(); })])
    ]));
    step4.appendChild(c4b);

    var c4c = card('Prior Injury', 'If you injured this same body part before, NY requires a short HIPAA release (Form C-3.3).');
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
    revCard.appendChild(reviewGroup('You & Job', 1, [['Name', 'c3w-rev-name'], ['DOB', 'c3w-rev-dob'], ['Job', 'c3w-rev-job']]));
    revCard.appendChild(reviewGroup('Injury', 2, [['Date', 'c3w-rev-doi'], ['Where', 'c3w-rev-where'], ['Body Parts', 'c3w-rev-body']]));
    revCard.appendChild(reviewGroup('Employer', 3, [['Employer', 'c3w-rev-employer'], ['Gave Notice', 'c3w-rev-notice']]));
    revCard.appendChild(reviewGroup('Medical & Work', 4, [['Treating Dr', 'c3w-rev-doctor'], ['Returned to Work', 'c3w-rev-return'], ['Prior Injury (C-3.3)', 'c3w-rev-prior']]));
    step5.appendChild(revCard);

    var certCard = card('Certify & Sign');
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

    step5.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-secondary', onclick: function () { goToStep(4); } }, ['Back']),
      el('button', { class: 'btn btn-primary', id: 'c3w-generate', onclick: function () { generate(certAgreed.v); } }, ['Generate & File My C-3'])
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
      el('button', { class: 'btn btn-primary', id: 'c3w-c33-generate', onclick: function () { generate(certAgreedC33.v); } }, ['Generate Form C-3.3'])
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
    function prefillTag(on) { return on ? '<span class="prefill-tag">from profile</span>' : ''; }
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
      ['c3w-noticeTo', 'noticeTo'], ['c3w-noticeDate', 'noticeDate'], ['c3w-witnessNames', 'witnessNames'],
      ['c3w-objectWhat', 'objectWhat'], ['c3w-licensePlate', 'licensePlate'], ['c3w-mvCarrier', 'mvCarrier'],
      ['c3w-stopWorkDate', 'stopWorkDate'], ['c3w-returnDate', 'returnDate'], ['c3w-firstTreatDate', 'firstTreatDate'],
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
    function goToStep(n) {
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
      if (n === 5) populateReview();
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
        var dobP = dateParts(state.dob), doiP = dateParts(state.doi);
        // A. you
        setT(F.wcb, profile.wcb_case_number || '');
        setT(F.name, state.name);
        setT(F.dobM, dobP[0]); setT(F.dobD, dobP[1]); setT(F.dobY, dobP[2]);
        setT(F.mailing, state.mailing); setT(F.mailing2, state.mailing2);
        setT(F.ssn, state.ssn);
        setT(F.phone, state.phone);
        if (state.gender === 'M') setC(F.genderM); else if (state.gender === 'F') setC(F.genderF);
        if (state.translator === 'yes') { setC(F.translatorY); setT(F.language, state.language); } else if (state.translator === 'no') setC(F.translatorN);
        // B. employer
        setT(F.employer, state.employer); setT(F.employerPhone, state.employerPhone);
        setT(F.workAddress, state.workAddress); setT(F.supervisor, state.supervisor); setT(F.otherEmployers, state.otherEmployers);
        // C. job
        setT(F.jobTitle, state.jobTitle); setT(F.activities, state.activities);
        if (state.jobTime && JOBTIME_FIELDS[state.jobTime]) setC(JOBTIME_FIELDS[state.jobTime]);
        if (state.jobTime === 'Other') setT(F.jobOtherText, state.jobOther);
        setT(F.grossPay, state.grossPay); setT(F.payFreq, state.payFreq);
        // D. injury
        setT(F.doiM, doiP[0]); setT(F.doiD, doiP[1]); setT(F.doiY, doiP[2]);
        setT(F.timeOfInjury, state.timeOfInjury); if (state.ampm === 'AM') setC(F.am); else if (state.ampm === 'PM') setC(F.pm);
        setT(F.whereHappened, state.whereHappened);
        setT(F.whatDoing, state.whatDoing);
        setT(F.howHappened, state.howHappened);
        var natureText = state.nature + (state.bodyParts.length ? ('  [Body parts: ' + state.bodyParts.map(function (p) { return BODY_LABELS[p] || p; }).join(', ') + ']') : '');
        setT(F.nature, natureText);
        // Page 2 header
        setT(F.nameP2, state.name); setT(F.doiP2M, doiP[0]); setT(F.doiP2D, doiP[1]); setT(F.doiP2Y, doiP[2]);
        // third party
        if (state.objectInvolved === 'yes') setT(F.objectWhat, state.objectWhat);
        if (state.motorVehicle === 'yes') { if (state.vehicleType === 'your_vehicle') setC(F.yourVehicle); else if (state.vehicleType === 'employers_vehicle') setC(F.employersVehicle); else if (state.vehicleType === 'other_vehicle') setC(F.otherVehicle); setT(F.licensePlate, state.licensePlate); setT(F.mvCarrier1, state.mvCarrier); }
        // notice
        if (state.gaveNotice === 'yes') { setT(F.noticeTo, state.noticeTo); if (state.noticeMethod === 'orally') setC(F.orally); else if (state.noticeMethod === 'in_writing') setC(F.inWriting); }
        if (state.witnessed === 'yes') setT(F.witnessNames, state.witnessNames);
        // E. return to work
        if (state.stoppedWork === 'yes') setT(F.stopWorkDate, fmtDate(state.stopWorkDate));
        if (state.returnedWork === 'yes') { setT(F.returnedDate, fmtDate(state.returnDate)); if (state.returnDuty === 'regular') setC(F.regularDuty); else if (state.returnDuty === 'limited') setC(F.limitedDuty); }
        // F. medical
        setT(F.firstTreatDate, fmtDate(state.firstTreatDate));
        if (state.treatType && TREAT_FIELDS[state.treatType]) setC(TREAT_FIELDS[state.treatType]);
        if (state.treatType === 'none_received') setC(F.noneReceived);
        setT(F.firstTreatName1, state.firstTreatName);
        setT(F.treatingDoctors1, state.treatingDoctors); setT(F.treatingDoctorsPhone, state.treatingDoctorsPhone);
        // certification
        setT(F.printName, state.certName || state.name);
        setT(F.certDate, fmtDate(todayISO()));
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
          // Signature line sits in the certification block near the bottom of page 2.
          // Coordinates approximate; confirmed during the render-verify pass.
          var w = 220, h = Math.min(w * (png.height / png.width), 28);
          page2.drawImage(png, { x: 70, y: 70, width: w, height: h });
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
          var w = 200, h = Math.min(w * (png.height / png.width), 26);
          page.drawImage(png, { x: 80, y: 116, width: w, height: h });
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

    /* ---------- generate (build + sign + package) --------------------- */
    function generate(certAgreed) {
      if (working) return;
      syncFromDom();
      var c33Only = !!state.c33Only;
      var formLabel = c33Only ? 'C-3.3' : 'C-3';
      if (!certAgreed) { toast('Please toggle “I certify the above is true” before signing.'); return; }
      if (!state.certName || !state.certName.trim()) { toast('Type your full legal name to certify.'); return; }
      if (!sig.drawn) { toast('Please draw your signature to sign the ' + formLabel + '.'); return; }
      if (c33Only) {
        if (!state.name || !state.name.trim()) { showError('c33s-name'); toast('Your full legal name is required.'); return; }
        if (!state.nature || !state.nature.trim()) { showError('c33s-injury'); toast('Describe your current injury/illness.'); return; }
        if (!state.c33_providers || !state.c33_providers.trim()) { showError('c33s-providers'); toast('List at least one previous treating provider.'); return; }
      }
      working = true;
      var btn = $(c33Only ? 'c3w-c33-generate' : 'c3w-generate'); if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
      ensurePdfLib().then(function (PDFLib) {
        var submitter = new SelfFilePackage(supabase);
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
        return store.remove(STORE_KEY).then(function () { return result; });
      }).then(function (result) {
        working = false;
        try { if (typeof ctx.onComplete === 'function') ctx.onComplete(); } catch (e) {}
        showSuccess(result);
      }).catch(function (e) {
        working = false;
        if (btn) { btn.disabled = false; btn.textContent = c33Only ? 'Generate Form C-3.3' : 'Generate & File My C-3'; }
        console.error('[C3] GENERATE_FAILED', e);
        toast('We couldn’t generate your ' + formLabel + '. Your answers are still here — please try again.');
      });
    }

    /* ---------- success (truthful) ------------------------------------ */
    function showSuccess(result) {
      root.querySelectorAll('.step-section').forEach(function (s) { s.classList.remove('active'); });
      for (var i = 1; i <= TOTAL_STEPS; i++) { var d = $('c3w-dot-' + i); if (d) d.className = 'step-dot completed'; if (i < TOTAL_STEPS) { var l = $('c3w-line-' + i); if (l) l.className = 'step-line completed'; } }
      var toAttorney = state.branch === 'attorney' && profile.attorney_email;
      var hasC3 = !!result.signedUrl || !!result.path;
      var c33Only = !hasC3 && !!result.c33path;
      var both = hasC3 && !!result.c33path;
      var pktNoun = both ? 'both PDFs (your C-3 and C-3.3)' : 'the PDF';
      var headline = c33Only ? 'Your Form C-3.3 is ready' : 'Your C-3 is ready';
      var formName = c33Only ? 'Form C-3.3 (HIPAA medical release)' : 'C-3 Employee Claim';
      var c33Note = both ? ' Your Form C-3.3 (HIPAA release) is included — file it together with your C-3.' : '';
      var c33OnlyNote = c33Only ? ' File it together with your C-3 to commence the claim.' : '';
      var screen = el('div', { class: 'success-screen' }, [
        el('div', { class: 'success-icon', text: '✓' }),
        el('h2', { text: headline }),
        el('p', { text: 'We generated and saved your signed ' + formName + '.' + c33Note + c33OnlyNote + ' It has not been submitted to the WCB — here’s how to file it.' })
      ]);
      // download buttons
      if (result.signedUrl) screen.appendChild(el('a', { class: 'btn btn-primary', href: result.signedUrl, target: '_blank', rel: 'noopener', style: 'display:block;text-decoration:none;margin-bottom:10px', download: 'C-3_Employee_Claim.pdf' }, ['⬇ Download your C-3 (PDF)']));
      if (result.c33SignedUrl) screen.appendChild(el('a', { class: c33Only ? 'btn btn-primary' : 'btn btn-secondary', href: result.c33SignedUrl, target: '_blank', rel: 'noopener', style: 'display:block;text-decoration:none;margin-bottom:10px', download: 'C-3.3_HIPAA_Release.pdf' }, ['⬇ Download Form C-3.3']));

      // filing instructions (truthful)
      var steps = el('div', { class: 'file-steps' }, [el('h3', { text: 'How to file with the WCB' })]);
      function fstep(n, html) { return el('div', { class: 'file-step' }, [el('div', { class: 'file-step-num', text: String(n) }), el('div', { html: html })]); }
      if (both) steps.appendChild(fstep('!', '<b>File both together.</b> The C-3 and C-3.3 must be submitted as one packet — upload/attach both PDFs together below.'));
      if (c33Only) steps.appendChild(fstep('!', '<b>Pair it with your C-3.</b> The C-3.3 supports a C-3 Employee Claim — file it together with your C-3 so the Board can act on the release.'));
      if (toAttorney) {
        steps.appendChild(fstep(1, 'Send ' + pktNoun + ' to your attorney at <b>' + escapeHtml(profile.attorney_email) + '</b> — they may file for you. Download above and attach to an email.'));
        steps.appendChild(fstep(2, 'If you’d rather file it yourself, follow the WCB options below.'));
      }
      var base = toAttorney ? 2 : 0;
      steps.appendChild(fstep(base + 1, '<b>Online (fastest):</b> upload ' + pktNoun + ' at the WCB Forms Submission portal, <b>wcb.ny.gov</b> → “File a Claim / Submit Forms.”'));
      steps.appendChild(fstep(base + 2, '<b>By mail:</b> NYS Workers’ Compensation Board, Centralized Mailing, PO Box 5205, Binghamton, NY 13902-5205.'));
      steps.appendChild(fstep(base + 3, '<b>By fax:</b> (877) 533-0337.'));
      screen.appendChild(steps);
      screen.appendChild(el('div', { class: 'info-callout', html: c33Only
        ? '<strong>Before you file:</strong> open the PDF and review it. Sign in ink if a viewer didn’t carry your drawn signature, then file. Your answers are saved on the form.'
        : '<strong>Before you file:</strong> open the PDF and review it. A few Yes/No checkboxes may be blank — mark any that apply to you, then file. Your answers are saved on the form.' }));
      screen.appendChild(el('button', { class: 'btn btn-secondary', style: 'width:100%', onclick: function () { goDash(); } }, ['Back to Dashboard']));
      stepSuccess.innerHTML = '';
      stepSuccess.appendChild(screen);
      stepSuccess.classList.add('active');
      progress.style.display = 'none';
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
    }
    function escapeHtml(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
    function goDash() {
      if (typeof ctx.goToDashboard === 'function') { try { ctx.goToDashboard(); return; } catch (e) {} }
      if (typeof ctx.onComplete === 'function') { try { ctx.onComplete(); return; } catch (e) {} }
      try { window.location.reload(); } catch (e) {}
    }

    /* ---------- autosave persist + restore ---------------------------- */
    function persist() {
      var snap = {};
      Object.keys(state).forEach(function (k) { if (!SENSITIVE[k]) snap[k] = state[k]; }); // never persist SSN or signature
      store.set(STORE_KEY, snap);
    }
    function restore() {
      return store.get(STORE_KEY).then(function (saved) {
        if (!saved) return;
        Object.keys(saved).forEach(function (k) { if (k in state && !SENSITIVE[k]) state[k] = saved[k]; });
        TEXT_FIELDS.forEach(function (f) { if (SENSITIVE[f[1]]) return; var n = $(f[0]); if (n && state[f[1]] != null) n.value = state[f[1]]; });
        var g = $('c3w-gender'); if (g) g.value = state.gender || '';
        (state.bodyParts || []).forEach(function (p) { var chip = chipGrid.querySelector('.chip[data-part="' + p + '"]'); if (chip) chip.classList.add('selected'); });
        // restore standalone C-3.3 inputs too (shared state keys)
        C33_FIELDS.forEach(function (f) { if (SENSITIVE[f[1]]) return; var n = $(f[0]); if (n && state[f[1]] != null) n.value = state[f[1]]; });
        if (state.c33Only) { goToStandaloneC33(); }
        else if (state.step && state.step >= 1 && state.step <= TOTAL_STEPS) goToStep(state.step);
      });
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
