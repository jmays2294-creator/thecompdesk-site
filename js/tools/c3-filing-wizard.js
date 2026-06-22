/* ============================================================================
 * C-3 (Employee Claim) Filing Wizard — PUBLIC WEBSITE port
 * ----------------------------------------------------------------------------
 * Dawn-skinned, anonymous-capable port of the production app wizard
 * (www/js/dashboard/c3-wizard.js). The verified WCB C-3.0 (6-22) + C-3.3 field
 * map, the step flow, signature capture, validation, and the pdf-lib
 * fill / de-XFA logic are REUSED VERBATIM from the app — only three things
 * differ for the marketing site:
 *
 *   1. Visual skin — scoped under `.c3fw` on the Worker (Dawn) tokens
 *      (--skin-*, Fraunces/DM Sans, cream/orange) instead of the app's dark theme.
 *   2. No login wall — anonymous visitors can complete + download the PDF. There
 *      is no fail-loud-on-missing-profile gate; `ctx.profile` is optional and
 *      prefill simply degrades to blank fields when absent.
 *   3. Submission seam — signed-in Comp Buddy users get the SelfFilePackage
 *      (upload to c3-filings + a c3_filings row + signed URL); anonymous users
 *      get the DownloadOnlyPackage (in-browser Blob download, nothing persisted).
 *
 * TRUTHFUL SCOPE (v1): we generate + (for signed-in users) store + give filing
 * instructions. We do NOT e-file to the WCB. This is claimant self-help, NOT
 * legal advice and NOT us filing on their behalf.
 *
 * Public API:  window.CD.C3FilingWizard.render(ctx) -> DOMNode
 *
 * ctx:
 *   supabase      Supabase client  (null/absent → anonymous mode)
 *   user          { id, email }     signed-in user (null/absent → anonymous)
 *   profile       profiles row      optional — drives the 14-field prefill
 *   onComplete    fn()              optional, called after a successful generation
 *   toast         fn(msg,type)      optional host toast; module has a fallback
 * ========================================================================== */
(function (window) {
  'use strict';
  var CD = (window.CD = window.CD || {});

  /* ---- constants (verbatim from the app wizard) ------------------------- */
  var STEP_NAMES = { 1: 'You & Your Job', 2: 'The Injury', 3: 'Employer & Notice', 4: 'Medical & Work', 5: 'Review & Sign' };
  var TOTAL_STEPS = 5;
  var STORAGE_PREFIX = 'c3:filing:';

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
  var OCC_LABELS = { construction: 'Construction worker', nurse: 'Nurse', delivery: 'Delivery driver', warehouse: 'Warehouse worker', office: 'Office worker', food: 'Food service worker' };

  var DISCLAIMER =
    'This tool is for informational purposes only and does not constitute legal advice. ' +
    'The Comp Desk is not a law firm and is not filing this claim on your behalf. You are ' +
    'preparing and filing your own C-3 (Employee Claim) with the New York State Workers’ ' +
    'Compensation Board.';

  /* ---- C-3 PDF field map (VERBATIM from www/js/dashboard/c3-wizard.js) ----
   * Verified against the real form (ops/website/forms/c3.pdf, C-3.0 (6-22)):
   * all 85 mapped names resolve; 48 text + 17 checkbox fills land. */
  var P1 = 'topmostSubform[0].Page1[0].';
  var P2 = 'topmostSubform[0].Page2[0].';
  var F = {
    wcb: P1 + 'WCB_Case_Number_if_you_know_it[0]',
    name: P1 + '_1_Name[0]',
    dobM: P1 + '_2_Date_of_Birth[0]', dobD: P1 + 'undefined[0]', dobY: P1 + 'undefined_2[0]',
    mailing: P1 + '_3_Mailing_address[0]', mailing2: P1 + 'undefined_3[0]',
    ssn: P1 + 'Social_Security_Number[0]',
    phone: P1 + '_5_Phone_Number[0]',
    genderM: P1 + 'Check_Box2[0]', genderF: P1 + 'Check_Box3[0]',
    translatorY: P1 + 'Check_Box4[0]', translatorN: P1 + 'Check_Box5[0]',
    language: P1 + 'If_yes_for_what_language[0]',
    employer: P1 + '_1_Employer_when_injured[0]',
    employerPhone: P1 + '_2_Phone_Number[0]',
    workAddress: P1 + '_3_Your_work_address[0]',
    supervisor: P1 + '_5_Your_supervisors_name[0]',
    otherEmployers: P1 + '_6_List_namesaddresses_of_any_other_employers_at_the_time_of_your_injuryillness[0]',
    jobTitle: P1 + '_1_What_was_your_job_title_or_description[0]',
    activities: P1 + '_2_What_types_of_activities_did_you_normally_perform_at_work[0]',
    activities2: P1 + 'Activities_Performed[0]',
    jobOtherText: P1 + 'undefined_7[0]',
    grossPay: P1 + '_4_What_was_your_gross_pay_before_taxes_per_pay_period[0]',
    payFreq: P1 + '_5_How_often_were_you_paid[0]',
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
    nameP2: P2 + 'YOUR_NAME[0]',
    doiP2M: P2 + 'DATE_OF_INJURYILLNESS[0]', doiP2D: P2 + 'undefined_11[0]', doiP2Y: P2 + 'undefined_12[0]',
    objectWhat: P2 + 'If_yes_what[0]',
    yourVehicle: P2 + 'your_vehicle[0]', employersVehicle: P2 + 'employers_vehicle[0]', otherVehicle: P2 + 'other_vehicle[0]',
    licensePlate: P2 + 'License_plate_number_if_known[0]',
    mvCarrier1: P2 + 'If_your_vehicle_was_involved_give_name_and_address_of_your_motor_vehicle_insurance_carrier_1[0]',
    mvCarrier2: P2 + 'If_your_vehicle_was_involved_give_name_and_address_of_your_motor_vehicle_insurance_carrier_2[0]',
    noticeTo: P2 + 'If_yes_notice_was_given_to[0]', orally: P2 + 'orally[0]', inWriting: P2 + 'in_writing[0]',
    witnessNames: P2 + 'If_yes_list_names[0]',
    stopWorkDate: P2 + 'on_what_date[0]',
    returnedDate: P2 + 'If_yes_on_what_date[0]',
    regularDuty: P2 + 'regular_duty[0]', limitedDuty: P2 + 'limited_duty[0]',
    sameEmployer: P2 + 'Same_employer[0]', newEmployer: P2 + 'New_employer[0]', selfEmployed: P2 + 'Self_employed[0]',
    grossPay2: P2 + '_4_What_is_your_gross_pay_before_taxes_per_pay_period[0]',
    payFreq2: P2 + 'How_often_are_you_paid[0]',
    firstTreatDate: P2 + '_1_What_was_the_date_of_your_first_treatment[0]',
    noneReceived: P2 + 'None_received_skip_to_question_F5[0]',
    firstTreatName1: P2 + 'Name_and_address_where_you_were_first_treated_1[0]',
    firstTreatName2: P2 + 'Name_and_address_where_you_were_first_treated_2[0]',
    firstTreatPhone: P2 + 'Phone_Number[0]',
    treatingDoctors1: P2 + 'Give_the_name_and_address_of_the_doctors_treating_you_for_this_injuryillness_1[0]',
    treatingDoctors2: P2 + 'Give_the_name_and_address_of_the_doctors_treating_you_for_this_injuryillness_2[0]',
    treatingDoctorsPhone: P2 + 'Phone_Number_2[0]',
    printName: P2 + 'Print_Name[0]',
    certDate: P2 + 'Date[0]'
  };
  var TREAT_FIELDS = {
    Emergency_Room: P2 + 'Emergency_Room[0]', Doctors_office: P2 + 'Doctors_office[0]',
    ClinicHospitalUrgent_Care: P2 + 'ClinicHospitalUrgent_Care[0]', Hospital_Stay_over_24_hours: P2 + 'Hospital_Stay_over_24_hours[0]',
    none_received: P2 + 'none_received[0]'
  };
  var JOBTIME_FIELDS = { Full_Time: P1 + 'Full_Time[0]', Part_Time: P1 + 'Part_Time[0]', Seasonal: P1 + 'Seasonal[0]', Volunteer: P1 + 'Volunteer[0]', Other: P1 + 'Other[0]' };

  /* ---- styles (scoped under .c3fw, Dawn / Worker skin tokens) ----------- */
  function ensureStyles() {
    if (document.getElementById('c3fw-styles')) return;
    var css = [
      '.c3fw{--accent:var(--skin-accent,#E87722);--accent-hover:var(--skin-accent-deep,#C85F0F);--accent-light:rgba(232,119,34,.10);--ok:#3f9c6a;--ok-light:rgba(91,185,127,.14);--warn:var(--skin-accent-deep,#C85F0F);--warn-light:rgba(232,119,34,.07);--danger:#C0392B;--danger-light:rgba(192,57,43,.08);--card:var(--skin-surface-elev,#fff);--input:var(--skin-surface-warm,#F4EADB);--brd:var(--skin-divider,rgba(45,49,66,.10));--tp:var(--skin-text,#2D3142);--ts:var(--skin-text-soft,#4D5266);--tm:var(--skin-text-muted,#7A8095);--rad:var(--skin-card-radius,16px);--rad-sm:12px;color:var(--tp);font-family:var(--font-body,"DM Sans",system-ui,sans-serif);line-height:1.5}',
      '.c3fw *{box-sizing:border-box}',
      '.c3fw .c3fw-header{background:var(--card);border:1px solid var(--brd);border-radius:var(--rad);padding:16px 20px;display:flex;align-items:center;gap:12px;margin-bottom:16px;box-shadow:var(--skin-card-shadow,0 1px 3px rgba(0,0,0,.06))}',
      '.c3fw .c3fw-header h1{font-family:var(--font-display,"Fraunces",serif);font-size:21px;font-weight:600;letter-spacing:-.01em;margin:0;color:var(--tp)}',
      '.c3fw .c3fw-badge{margin-left:auto;background:var(--accent-light);color:var(--accent-hover);font-size:11px;font-weight:700;padding:5px 12px;border-radius:999px;text-transform:uppercase;letter-spacing:.06em}',
      '.c3fw .progress-container{padding:4px 0 16px}',
      '.c3fw .progress-steps{display:flex;align-items:center;justify-content:center;margin-bottom:8px}',
      '.c3fw .progress-step{display:flex;align-items:center}',
      '.c3fw .step-dot{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid var(--brd);color:var(--tm);background:var(--card);transition:all .3s ease;flex-shrink:0}',
      '.c3fw .step-dot.active{border-color:var(--accent);color:var(--accent-hover);background:var(--accent-light)}',
      '.c3fw .step-dot.completed{border-color:var(--ok);color:#fff;background:var(--ok)}',
      '.c3fw .step-line{width:34px;height:2px;background:var(--brd);transition:background .3s ease}',
      '.c3fw .step-line.completed{background:var(--ok)}',
      '.c3fw .progress-label{text-align:center;font-size:12px;color:var(--tm)}',
      '.c3fw .progress-label span{color:var(--accent-hover);font-weight:700}',
      '.c3fw .c3fw-body{max-width:620px;margin:0 auto}',
      '.c3fw .step-section{display:none}',
      '.c3fw .step-section.active{display:block;animation:c3fwFade .3s ease}',
      '@keyframes c3fwFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
      '@media (prefers-reduced-motion:reduce){.c3fw .step-section.active{animation:none}.c3fw *{transition:none!important}}',
      '.c3fw .card{background:var(--card);border:1px solid var(--brd);border-radius:var(--rad);padding:24px;margin-bottom:16px;box-shadow:var(--skin-card-shadow,0 1px 3px rgba(0,0,0,.06))}',
      '.c3fw .card-title{font-family:var(--font-display,"Fraunces",serif);font-size:18px;font-weight:600;margin-bottom:4px;color:var(--tp)}',
      '.c3fw .card-subtitle{font-size:13.5px;color:var(--ts);margin-bottom:18px}',
      '.c3fw .step-intro{text-align:center;margin-bottom:24px}',
      '.c3fw .step-intro-icon{font-size:30px;margin-bottom:6px}',
      '.c3fw .step-intro h2{font-family:var(--font-display,"Fraunces",serif);font-size:24px;font-weight:600;letter-spacing:-.01em;margin:0 0 6px;color:var(--tp)}',
      '.c3fw .step-intro p{font-size:14.5px;color:var(--ts);margin:0;max-width:46ch;margin:0 auto}',
      '.c3fw .form-group{margin-bottom:18px}',
      '.c3fw .form-group:last-child{margin-bottom:0}',
      '.c3fw .form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '.c3fw .form-label{display:block;font-size:13px;font-weight:600;color:var(--ts);margin-bottom:6px}',
      '.c3fw .form-label .req{color:var(--danger);margin-left:2px}',
      '.c3fw .form-label .opt{color:var(--tm);font-weight:400;font-size:11px;margin-left:4px}',
      '.c3fw .form-input{width:100%;padding:12px 14px;background:var(--input);border:1px solid var(--brd);border-radius:var(--rad-sm);color:var(--tp);font-size:15px;font-family:inherit;transition:border-color .2s ease,box-shadow .2s ease;-webkit-appearance:none}',
      '.c3fw .form-input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(232,119,34,.15)}',
      '.c3fw .form-input::placeholder{color:var(--tm)}',
      '.c3fw .form-input.error{border-color:var(--danger)}',
      '.c3fw select.form-input{cursor:pointer}',
      '.c3fw textarea.form-input{resize:vertical;min-height:84px}',
      '.c3fw .form-error{font-size:12px;color:var(--danger);margin-top:4px;display:none}',
      '.c3fw .form-error.visible{display:block}',
      '.c3fw .form-hint{font-size:12px;color:var(--tm);margin-top:4px}',
      '.c3fw .prefill-tag{display:inline-block;font-size:10px;font-weight:700;color:var(--ok);background:var(--ok-light);padding:1px 7px;border-radius:10px;margin-left:6px;text-transform:uppercase;letter-spacing:.04em}',
      '.c3fw .chip-grid{display:flex;flex-wrap:wrap;gap:8px}',
      '.c3fw .chip{padding:8px 14px;background:var(--input);border:1px solid var(--brd);border-radius:999px;color:var(--ts);font-size:13px;cursor:pointer;transition:all .2s ease;user-select:none}',
      '.c3fw .chip:hover{border-color:var(--accent);color:var(--tp)}',
      '.c3fw .chip.selected{background:var(--accent-light);border-color:var(--accent);color:var(--accent-hover);font-weight:600}',
      '.c3fw .chip-grid.error{outline:1px solid var(--danger);outline-offset:4px;border-radius:var(--rad-sm)}',
      '.c3fw .option-group{display:flex;flex-direction:column;gap:10px}',
      '.c3fw .option-group.horizontal{flex-direction:row;flex-wrap:wrap}',
      '.c3fw .option-card{display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--input);border:1px solid var(--brd);border-radius:var(--rad-sm);cursor:pointer;transition:all .2s ease}',
      '.c3fw .option-card.compact{padding:10px 14px;flex:0 0 auto}',
      '.c3fw .option-card:hover{border-color:var(--accent)}',
      '.c3fw .option-card.selected{border-color:var(--accent);background:var(--accent-light)}',
      '.c3fw .option-radio{width:18px;height:18px;border-radius:50%;border:2px solid var(--brd);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s ease}',
      '.c3fw .option-card.selected .option-radio{border-color:var(--accent)}',
      '.c3fw .option-radio-inner{width:8px;height:8px;border-radius:50%;background:var(--accent);transform:scale(0);transition:transform .2s ease}',
      '.c3fw .option-card.selected .option-radio-inner{transform:scale(1)}',
      '.c3fw .option-label{font-size:14px;font-weight:600;color:var(--tp)}',
      '.c3fw .option-desc{font-size:12px;color:var(--tm);margin-top:2px}',
      '.c3fw .toggle-row{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--input);border:1px solid var(--brd);border-radius:var(--rad-sm)}',
      '.c3fw .toggle-text{font-size:14px;font-weight:600;color:var(--tp)}',
      '.c3fw .toggle-text-desc{font-size:12px;color:var(--tm);margin-top:2px}',
      '.c3fw .toggle-switch{width:46px;height:26px;background:var(--brd);border-radius:13px;position:relative;cursor:pointer;transition:background .2s ease;flex-shrink:0}',
      '.c3fw .toggle-switch.on{background:var(--accent)}',
      '.c3fw .toggle-knob{width:20px;height:20px;background:#fff;border-radius:50%;position:absolute;top:3px;left:3px;transition:transform .2s ease;box-shadow:0 1px 2px rgba(0,0,0,.2)}',
      '.c3fw .toggle-switch.on .toggle-knob{transform:translateX(20px)}',
      '.c3fw .btn-row{display:flex;gap:12px;margin-top:22px}',
      '.c3fw .btn{flex:1;padding:14px 20px;border-radius:var(--rad-sm);font-size:15px;font-weight:700;cursor:pointer;border:none;transition:all .2s ease;font-family:inherit}',
      '.c3fw .btn-primary{background:var(--accent);color:#fff}',
      '.c3fw .btn-primary:hover{background:var(--accent-hover)}',
      '.c3fw .btn-primary:disabled{opacity:.5;cursor:not-allowed}',
      '.c3fw .btn-secondary{background:var(--input);border:1px solid var(--brd);color:var(--ts)}',
      '.c3fw .btn-secondary:hover{border-color:var(--tm);color:var(--tp)}',
      '.c3fw .review-group{margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--brd)}',
      '.c3fw .review-group:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}',
      '.c3fw .review-group-title{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--tm);font-weight:700;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}',
      '.c3fw .review-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;gap:12px}',
      '.c3fw .review-label{font-size:13px;color:var(--ts);flex-shrink:0}',
      '.c3fw .review-value{font-size:14px;font-weight:600;text-align:right;color:var(--tp)}',
      '.c3fw .review-value.empty{color:var(--tm);font-style:italic;font-weight:400}',
      '.c3fw .review-edit-btn{background:none;border:none;color:var(--accent-hover);font-size:12px;font-weight:600;cursor:pointer;padding:2px 6px;font-family:inherit}',
      '.c3fw .info-callout{background:var(--accent-light);border:1px solid rgba(232,119,34,.30);border-radius:var(--rad-sm);padding:12px 14px;margin-bottom:16px;font-size:12.5px;color:var(--ts);line-height:1.6}',
      '.c3fw .info-callout strong{color:var(--accent-hover)}',
      '.c3fw .legal-notice{background:var(--warn-light);border:1px solid rgba(232,119,34,.25);border-left:4px solid var(--accent);border-radius:var(--rad-sm);padding:14px 16px;margin-bottom:16px}',
      '.c3fw .legal-notice-title{font-size:13px;font-weight:700;color:var(--warn);margin-bottom:4px}',
      '.c3fw .legal-notice p{font-size:12.5px;color:var(--ts);line-height:1.6;margin:0}',
      '.c3fw .branch-card{display:flex;align-items:flex-start;gap:12px;padding:16px;background:var(--input);border:1px solid var(--brd);border-radius:var(--rad-sm);cursor:pointer;margin-bottom:12px;transition:all .2s ease}',
      '.c3fw .branch-card:hover{border-color:var(--accent);background:var(--accent-light)}',
      '.c3fw .branch-icon{font-size:22px;flex-shrink:0}',
      '.c3fw .branch-title{font-size:14px;font-weight:700;margin-bottom:2px;color:var(--tp)}',
      '.c3fw .branch-desc{font-size:12px;color:var(--ts)}',
      '.c3fw .sig-pad-wrap{position:relative;margin-top:6px}',
      '.c3fw .sig-pad{width:100%;height:170px;background:#fff;border:1px solid var(--brd);border-radius:var(--rad-sm);touch-action:none;cursor:crosshair;display:block}',
      '.c3fw .sig-clear{position:absolute;top:8px;right:8px;background:rgba(45,49,66,.6);color:#fff;border:none;border-radius:6px;font-size:11px;padding:4px 8px;cursor:pointer}',
      '.c3fw .success-screen{text-align:center;padding:24px 16px}',
      '.c3fw .success-icon{width:74px;height:74px;background:var(--ok-light);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:36px;color:var(--ok)}',
      '.c3fw .success-screen h2{font-family:var(--font-display,"Fraunces",serif);font-size:24px;font-weight:600;margin:0 0 8px;color:var(--tp)}',
      '.c3fw .success-screen p{font-size:14px;color:var(--ts);margin:0 0 18px}',
      '.c3fw .file-steps{text-align:left;background:var(--card);border:1px solid var(--brd);border-radius:var(--rad-sm);padding:16px 18px;margin-bottom:16px}',
      '.c3fw .file-steps h3{font-family:var(--font-display,"Fraunces",serif);font-size:15px;font-weight:600;margin:0 0 12px;color:var(--tp)}',
      '.c3fw .file-step{display:flex;gap:10px;font-size:13px;color:var(--ts);margin-bottom:10px;line-height:1.5}',
      '.c3fw .file-step:last-child{margin-bottom:0}',
      '.c3fw .file-step b{color:var(--tp)}',
      '.c3fw .file-step-num{flex-shrink:0;width:22px;height:22px;border-radius:50%;background:var(--accent-light);color:var(--accent-hover);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}',
      '.c3fw .disclaimer{text-align:center;font-size:11px;color:var(--tm);padding:16px 8px 8px;line-height:1.6}',
      '.c3fw .c3fw-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:520px;width:calc(100% - 32px);background:var(--danger);color:#fff;padding:12px 16px;border-radius:var(--rad-sm);font-size:13px;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,.25)}',
      '.c3fw .c3fw-toast.ok{background:var(--ok)}',
      '@media (max-width:480px){.c3fw .form-row{grid-template-columns:1fr}.c3fw .step-line{width:20px}.c3fw .card{padding:18px}}'
    ].join('\n');
    var s = document.createElement('style'); s.id = 'c3fw-styles'; s.textContent = css; document.head.appendChild(s);
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
    (children || []).forEach(function (c) { if (c == null) return; n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  /* ---- autosave storage adapter (web: localStorage) --------------------- */
  function makeStore() {
    return {
      get: function (key) { try { var raw = window.localStorage.getItem(key); return Promise.resolve(raw ? JSON.parse(raw) : null); } catch (e) { return Promise.resolve(null); } },
      set: function (key, val) { try { window.localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} return Promise.resolve(); },
      remove: function (key) { try { window.localStorage.removeItem(key); } catch (e) {} return Promise.resolve(); }
    };
  }

  /* ---- pdf-lib loader (CDN; reused if the page already loaded it) ------- */
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

  /* ---- helpers (verbatim) ----------------------------------------------- */
  function fmtDate(d) { if (!d) return ''; var p = d.split('-'); return p.length === 3 ? p[1] + '/' + p[2] + '/' + p[0] : d; }
  function dateParts(d) { if (!d) return ['', '', '']; var p = d.split('-'); return p.length === 3 ? [p[1], p[2], p[0]] : ['', '', '']; }
  function todayISO() { return new Date().toISOString().split('T')[0]; }
  function capWords(s) { return (s || '').split(' ').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' '); }
  function escapeHtml(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  /* ======================================================================
   *  render(ctx)
   * ==================================================================== */
  function render(ctx) {
    ctx = ctx || {};
    ensureStyles();
    var root = el('div', { class: 'c3fw' });

    var supabase = ctx.supabase || null;
    var user = ctx.user || null;
    var signedIn = !!(supabase && user && user.id);
    var profile = ctx.profile || {};          // optional — degrades to blank prefill
    var store = makeStore();
    var STORE_KEY = STORAGE_PREFIX + (signedIn ? user.id : 'anon');

    function toast(msg, type) {
      if (typeof ctx.toast === 'function') { try { ctx.toast(msg, type); return; } catch (e) {} }
      var t = el('div', { class: 'c3fw-toast' + (type === 'ok' ? ' ok' : ''), text: msg });
      document.body.appendChild(t);
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 5000);
    }

    /* ---- working state (prefilled from profile when present) ------------ */
    var state = {
      step: 0, branch: '',
      name: profile.full_name || '', dob: profile.dob || '', ssn: '', gender: '',
      mailing: profile.home_address || '', mailing2: profile.home_city || '',
      phone: profile.phone || '', translator: '', language: (profile.language_pref && profile.language_pref !== 'en') ? profile.language_pref : '',
      employer: profile.employer_name || '', employerPhone: '', workAddress: '', supervisor: '', otherEmployers: '',
      jobTitle: OCC_LABELS[profile.occupation] || '', activities: '', jobTime: '', jobOther: '', grossPay: '', payFreq: '',
      doi: profile.doa || '', timeOfInjury: '', ampm: '', whereHappened: '', whatDoing: '', howHappened: '',
      bodyParts: Array.isArray(profile.body_parts) ? profile.body_parts.slice() : [], nature: '',
      objectInvolved: '', objectWhat: '', motorVehicle: '', vehicleType: '', licensePlate: '', mvCarrier: '',
      gaveNotice: '', noticeMethod: '', noticeTo: '', noticeDate: '',
      witnessed: '', witnessNames: '',
      stoppedWork: profile.work_status && profile.work_status !== 'working' ? 'yes' : '', stopWorkDate: '',
      returnedWork: profile.work_status === 'working' ? 'yes' : (profile.work_status === 'light_duty' ? 'yes' : ''),
      returnDuty: profile.work_status === 'light_duty' ? 'limited' : (profile.work_status === 'working' ? 'regular' : ''),
      returnDate: '', returnEmployer: '', grossPay2: '', payFreq2: '',
      firstTreatDate: '', treatType: '', firstTreatName: '', firstTreatPhone: '',
      stillTreating: '', treatingDoctors: [profile.treating_doctor_name, profile.treating_doctor_address].filter(Boolean).join(', '), treatingDoctorsPhone: profile.treating_doctor_phone || '',
      priorInjury: '', priorWorkRelated: '', priorSameEmployer: '', priorTreatedByDoctor: '',
      c33_priorDesc: '', c33_providers: '', c33_releaseMentalHealth: false,
      certName: profile.full_name || ''
    };
    var sig = { drawn: false, canvas: null };
    var working = false;

    function $(id) { return root.querySelector('#' + id); }

    /* ---------- header + progress ------------------------------------- */
    root.appendChild(el('div', { class: 'c3fw-header' }, [
      el('h1', { text: 'File Your C-3 Claim' }),
      el('span', { class: 'c3fw-badge', text: 'Employee Claim' })
    ]));
    var pSteps = el('div', { class: 'progress-steps' });
    for (var i = 1; i <= TOTAL_STEPS; i++) {
      pSteps.appendChild(el('div', { class: 'progress-step' }, [el('div', { class: 'step-dot', id: 'c3fw-dot-' + i, text: String(i) })]));
      if (i < TOTAL_STEPS) pSteps.appendChild(el('div', { class: 'step-line', id: 'c3fw-line-' + i }));
    }
    var progress = el('div', { class: 'progress-container', id: 'c3fw-progress', style: 'display:none' }, [
      pSteps,
      el('div', { class: 'progress-label' }, [
        document.createTextNode('Step '), el('span', { id: 'c3fw-step-current', text: '1' }),
        document.createTextNode(' of ' + TOTAL_STEPS + ' — '), el('span', { id: 'c3fw-step-name', text: STEP_NAMES[1] })
      ])
    ]);
    root.appendChild(progress);

    var bodyWrap = el('div', { class: 'c3fw-body' });
    root.appendChild(bodyWrap);

    /* ================= STEP 0 — gate & route ========================== */
    var step0 = el('div', { class: 'step-section active', id: 'c3fw-step-0' });
    step0.appendChild(el('div', { class: 'step-intro' }, [
      el('div', { class: 'step-intro-icon', text: '📝' }),
      el('h2', { text: 'File your C-3 Employee Claim' }),
      el('p', { text: signedIn
        ? 'We’ll build your signed C-3 from what we already know about your case, then show you exactly how to file it with the WCB.'
        : 'We’ll walk you through the WCB Form C-3 in plain English, build your signed PDF, and show you exactly how to file it. No account required.' })
    ]));
    var gateCard = el('div', { class: 'card' });
    gateCard.appendChild(el('div', { class: 'legal-notice' }, [
      el('div', { class: 'legal-notice-title', html: '⚠️ Please read' }),
      el('p', { text: DISCLAIMER })
    ]));
    gateCard.appendChild(el('div', { class: 'info-callout', html: '<strong>What this does:</strong> generates a complete, signed C-3 PDF and gives you the fastest way to file it yourself. <strong>What it does not do:</strong> we do not electronically submit it to the WCB for you — electronic filing isn’t available yet, so you’ll file the PDF we create.' }));
    if (!signedIn) {
      gateCard.appendChild(el('div', { class: 'info-callout', html: '<strong>Have a Comp Buddy account?</strong> <a href="/auth_v2.html?redirect=%2Ftools%2Fclaim-filing" style="color:var(--accent-hover);font-weight:700">Sign in</a> and we’ll pre-fill your name, employer, injury date and more — and keep a copy of your filing. You can also continue without an account.' }));
    }
    step0.appendChild(gateCard);

    var hasAtty = !!(signedIn && profile.has_attorney);
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
    bodyWrap.appendChild(step0);

    /* ================= STEP 1 — You & Your Job (A + C) ================ */
    var step1 = el('div', { class: 'step-section', id: 'c3fw-step-1' });
    step1.appendChild(stepIntro('👤', 'You & Your Job', signedIn ? 'Confirm your details — we’ve pre-filled what we know.' : 'Tell us about you and your job at the time of the injury.'));
    var c1 = card('About You', signedIn ? 'From your profile. Edit anything that’s changed.' : 'Your basic details, as they should appear on the claim.');
    c1.appendChild(fieldRow([
      textField('c3fw-name', 'Full Legal Name', 'req', state.name, 'First MI Last', !!state.name),
      dateField('c3fw-dob', 'Date of Birth', 'req', state.dob, !!state.dob)
    ]));
    c1.appendChild(fieldRow([
      textField('c3fw-ssn', 'Social Security Number', 'opt', state.ssn, 'XXX-XX-XXXX', false),
      selectField('c3fw-gender', 'Gender', 'req', [['', 'Select…'], ['M', 'Male'], ['F', 'Female']], state.gender)
    ]));
    c1.appendChild(el('div', { class: 'form-hint', style: 'margin-top:-10px', text: 'SSN is voluntary on the C-3 — you may leave it blank. We never store it; it only goes onto the form you download.' }));
    c1.appendChild(group([el('label', { class: 'form-label', html: 'Mailing Address<span class="req">*</span>' + prefillTag(!!state.mailing) }), el('input', { type: 'text', class: 'form-input', id: 'c3fw-mailing', value: state.mailing, placeholder: 'Number and street' }), errEl('c3fw-err-mailing', 'Your mailing address is required')]));
    c1.appendChild(fieldRow([
      textField('c3fw-mailing2', 'City, State, ZIP', 'opt', state.mailing2, 'City, NY 10001', !!state.mailing2),
      textField('c3fw-phone', 'Phone', 'req', state.phone, '(212) 555-1234', !!state.phone)
    ]));
    var transWrap = optionRow('c3fw-translator', 'Need a translator at a Board hearing?', [['no', 'No'], ['yes', 'Yes']], state.translator, function (v) {
      state.translator = v; $('c3fw-lang-wrap').style.display = v === 'yes' ? 'block' : 'none'; persist();
    });
    c1.appendChild(group([el('label', { class: 'form-label', text: 'Translator at a Hearing?' }), transWrap]));
    c1.appendChild(el('div', { id: 'c3fw-lang-wrap', style: state.translator === 'yes' ? 'display:block' : 'display:none' }, [
      group([el('label', { class: 'form-label', text: 'What language?' }), el('input', { type: 'text', class: 'form-input', id: 'c3fw-language', value: state.language, placeholder: 'e.g. Spanish' })])
    ]));
    step1.appendChild(c1);

    var c1b = card('Your Job', 'On the date of your injury or illness.');
    c1b.appendChild(group([el('label', { class: 'form-label', html: 'Job Title or Description<span class="req">*</span>' + prefillTag(!!state.jobTitle) }), el('input', { type: 'text', class: 'form-input', id: 'c3fw-jobTitle', value: state.jobTitle, placeholder: 'e.g. Warehouse associate' }), errEl('c3fw-err-jobTitle', 'Your job title is required')]));
    c1b.appendChild(group([el('label', { class: 'form-label', html: 'What did you normally do at work?<span class="opt">(optional)</span>' }), el('textarea', { class: 'form-input', id: 'c3fw-activities', placeholder: 'Day-to-day duties' }, [state.activities])]));
    var jobTimeGroup = optionRow('c3fw-jobTime', 'Was your job?', JOB_TIME.map(function (j) { return [j[0], j[1]]; }), state.jobTime, function (v) { state.jobTime = v; $('c3fw-jobOther-wrap').style.display = v === 'Other' ? 'block' : 'none'; persist(); });
    c1b.appendChild(group([el('label', { class: 'form-label', text: 'Employment Type' }), jobTimeGroup]));
    c1b.appendChild(el('div', { id: 'c3fw-jobOther-wrap', style: state.jobTime === 'Other' ? 'display:block' : 'display:none' }, [group([el('label', { class: 'form-label', text: 'Describe (Other)' }), el('input', { type: 'text', class: 'form-input', id: 'c3fw-jobOther', value: state.jobOther })])]));
    c1b.appendChild(fieldRow([
      textField('c3fw-grossPay', 'Gross Pay per Pay Period', 'opt', state.grossPay, '$0.00', false),
      textField('c3fw-payFreq', 'How Often Paid?', 'opt', state.payFreq, 'e.g. Weekly', false)
    ]));
    step1.appendChild(c1b);
    step1.appendChild(navRow(0, function () { validateAndNext(1); }));
    bodyWrap.appendChild(step1);

    /* ================= STEP 2 — The Injury (D) ======================== */
    var step2 = el('div', { class: 'step-section', id: 'c3fw-step-2' });
    step2.appendChild(stepIntro('🩹', 'The Injury', 'Tell us exactly what happened — this is the heart of your claim.'));
    var c2 = card('When & Where');
    c2.appendChild(fieldRow([
      dateField('c3fw-doi', 'Date of Injury / Onset', 'req', state.doi, !!state.doi),
      textField('c3fw-timeOfInjury', 'Time of Injury', 'opt', state.timeOfInjury, 'e.g. 2:30', false)
    ]));
    c2.appendChild(group([el('label', { class: 'form-label', text: 'AM or PM?' }), optionRow('c3fw-ampm', '', [['AM', 'AM'], ['PM', 'PM']], state.ampm, function (v) { state.ampm = v; persist(); })]));
    c2.appendChild(group([el('label', { class: 'form-label', html: 'Where did it happen?<span class="req">*</span>' }), el('input', { type: 'text', class: 'form-input', id: 'c3fw-whereHappened', value: state.whereHappened, placeholder: 'e.g. 1 Main Street, Pottersville, at the loading dock' }), errEl('c3fw-err-whereHappened', 'Tell us where the injury happened')]));
    step2.appendChild(c2);

    var c2b = card('What Happened');
    c2b.appendChild(group([el('label', { class: 'form-label', html: 'What were you doing when injured?<span class="req">*</span>' }), el('textarea', { class: 'form-input', id: 'c3fw-whatDoing', placeholder: 'e.g. unloading a truck, typing a report' }, [state.whatDoing]), errEl('c3fw-err-whatDoing', 'Describe what you were doing')]));
    c2b.appendChild(group([el('label', { class: 'form-label', html: 'How did the injury/illness happen?<span class="req">*</span>' }), el('textarea', { class: 'form-input', id: 'c3fw-howHappened', placeholder: 'e.g. I tripped over a pipe and fell on the floor' }, [state.howHappened]), errEl('c3fw-err-howHappened', 'Describe how it happened')]));
    step2.appendChild(c2b);

    var c2c = card('Injured Body Parts', signedIn ? 'We pre-checked the parts from your profile. Add the nature of the injury.' : 'Tap every body part the injury affected, then describe it.');
    var chipGrid = el('div', { class: 'chip-grid', id: 'c3fw-body-grid' });
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
    c2c.appendChild(group([el('label', { class: 'form-label', html: 'Body Parts Affected<span class="req">*</span>' }), chipGrid, errEl('c3fw-err-body', 'Select at least one body part')]));
    c2c.appendChild(group([el('label', { class: 'form-label', html: 'Explain the nature of the injury<span class="req">*</span>' }), el('textarea', { class: 'form-input', id: 'c3fw-nature', placeholder: 'e.g. twisted left ankle and cut to forehead' }, [state.nature]), errEl('c3fw-err-nature', 'Describe the nature of your injury')]));
    step2.appendChild(c2c);
    step2.appendChild(navRow(1, function () { validateAndNext(2); }));
    bodyWrap.appendChild(step2);

    /* ================= STEP 3 — Employer & Notice (B + notice) ======== */
    var step3 = el('div', { class: 'step-section', id: 'c3fw-step-3' });
    step3.appendChild(stepIntro('🏢', 'Employer & Notice', 'Your employer, and whether you reported the injury.'));
    var c3a = card('Your Employer');
    c3a.appendChild(group([el('label', { class: 'form-label', html: 'Employer When Injured<span class="req">*</span>' + prefillTag(!!state.employer) }), el('input', { type: 'text', class: 'form-input', id: 'c3fw-employer', value: state.employer, placeholder: 'Company name' }), errEl('c3fw-err-employer', 'Employer name is required')]));
    c3a.appendChild(fieldRow([
      textField('c3fw-employerPhone', 'Employer Phone', 'opt', state.employerPhone, '(212) 555-1234', false),
      textField('c3fw-supervisor', 'Supervisor’s Name', 'opt', state.supervisor, '', false)
    ]));
    c3a.appendChild(group([el('label', { class: 'form-label', html: 'Your Work Address<span class="opt">(optional)</span>' }), el('input', { type: 'text', class: 'form-input', id: 'c3fw-workAddress', value: state.workAddress, placeholder: 'Where you worked' })]));
    c3a.appendChild(group([el('label', { class: 'form-label', html: 'Other Employers at the Time<span class="opt">(optional)</span>' }), el('textarea', { class: 'form-input', id: 'c3fw-otherEmployers', placeholder: 'Names/addresses of any other employers' }, [state.otherEmployers])]));
    step3.appendChild(c3a);

    var c3b = card('Notice & Witnesses');
    c3b.appendChild(group([el('label', { class: 'form-label', text: 'Did you tell your employer/supervisor?' }), optionRow('c3fw-gaveNotice', '', [['yes', 'Yes'], ['no', 'No']], state.gaveNotice, function (v) { state.gaveNotice = v; $('c3fw-notice-detail').style.display = v === 'yes' ? 'block' : 'none'; persist(); })]));
    c3b.appendChild(el('div', { id: 'c3fw-notice-detail', style: state.gaveNotice === 'yes' ? 'display:block' : 'display:none' }, [
      group([el('label', { class: 'form-label', text: 'How?' }), optionRow('c3fw-noticeMethod', '', [['orally', 'Orally'], ['in_writing', 'In writing']], state.noticeMethod, function (v) { state.noticeMethod = v; persist(); })]),
      fieldRow([textField('c3fw-noticeTo', 'Given to whom?', 'opt', state.noticeTo, 'Name', false), dateField('c3fw-noticeDate', 'Date notice given', 'opt', state.noticeDate, false)])
    ]));
    c3b.appendChild(group([el('label', { class: 'form-label', text: 'Did anyone witness it?' }), optionRow('c3fw-witnessed', '', [['no', 'No'], ['yes', 'Yes']], state.witnessed, function (v) { state.witnessed = v; $('c3fw-witness-detail').style.display = v === 'yes' ? 'block' : 'none'; persist(); })]));
    c3b.appendChild(el('div', { id: 'c3fw-witness-detail', style: state.witnessed === 'yes' ? 'display:block' : 'display:none' }, [
      group([el('label', { class: 'form-label', text: 'Witness name(s)' }), el('input', { type: 'text', class: 'form-input', id: 'c3fw-witnessNames', value: state.witnessNames })])
    ]));
    step3.appendChild(c3b);

    var c3c = card('Was a Vehicle or Object Involved?', 'Optional — only if relevant.');
    c3c.appendChild(group([el('label', { class: 'form-label', text: 'Was an object (forklift, tool, etc.) involved?' }), optionRow('c3fw-objectInvolved', '', [['no', 'No'], ['yes', 'Yes']], state.objectInvolved, function (v) { state.objectInvolved = v; $('c3fw-object-detail').style.display = v === 'yes' ? 'block' : 'none'; persist(); })]));
    c3c.appendChild(el('div', { id: 'c3fw-object-detail', style: state.objectInvolved === 'yes' ? 'display:block' : 'display:none' }, [group([el('label', { class: 'form-label', text: 'What object?' }), el('input', { type: 'text', class: 'form-input', id: 'c3fw-objectWhat', value: state.objectWhat })])]));
    c3c.appendChild(group([el('label', { class: 'form-label', text: 'Was a licensed motor vehicle involved?' }), optionRow('c3fw-motorVehicle', '', [['no', 'No'], ['yes', 'Yes']], state.motorVehicle, function (v) { state.motorVehicle = v; $('c3fw-mv-detail').style.display = v === 'yes' ? 'block' : 'none'; persist(); })]));
    c3c.appendChild(el('div', { id: 'c3fw-mv-detail', style: state.motorVehicle === 'yes' ? 'display:block' : 'display:none' }, [
      group([el('label', { class: 'form-label', text: 'Whose vehicle?' }), optionRow('c3fw-vehicleType', '', [['your_vehicle', 'Yours'], ['employers_vehicle', 'Employer’s'], ['other_vehicle', 'Other']], state.vehicleType, function (v) { state.vehicleType = v; persist(); })]),
      fieldRow([textField('c3fw-licensePlate', 'License Plate', 'opt', state.licensePlate, '', false), textField('c3fw-mvCarrier', 'Your Auto Insurance Carrier', 'opt', state.mvCarrier, 'Name & address', false)])
    ]));
    step3.appendChild(c3c);
    step3.appendChild(navRow(2, function () { validateAndNext(3); }));
    bodyWrap.appendChild(step3);

    /* ================= STEP 4 — Medical & Work (F + E + C-3.3) ======== */
    var step4 = el('div', { class: 'step-section', id: 'c3fw-step-4' });
    step4.appendChild(stepIntro('🩺', 'Medical & Work Status', 'Your treatment and whether you’ve been back to work.'));
    var c4a = card('Medical Treatment');
    c4a.appendChild(fieldRow([
      dateField('c3fw-firstTreatDate', 'Date of First Treatment', 'opt', state.firstTreatDate, false),
      selectField('c3fw-treatType', 'Where first treated?', 'opt', [['', 'Select…']].concat(TREAT_TYPE), state.treatType)
    ]));
    c4a.appendChild(group([el('label', { class: 'form-label', html: 'Name & address where first treated<span class="opt">(optional)</span>' }), el('input', { type: 'text', class: 'form-input', id: 'c3fw-firstTreatName', value: state.firstTreatName })]));
    c4a.appendChild(group([el('label', { class: 'form-label', html: 'Doctor(s) currently treating you<span class="opt">(optional)</span>' + prefillTag(!!state.treatingDoctors) }), el('input', { type: 'text', class: 'form-input', id: 'c3fw-treatingDoctors', value: state.treatingDoctors, placeholder: 'Name & address' })]));
    step4.appendChild(c4a);

    var c4b = card('Return to Work');
    c4b.appendChild(group([el('label', { class: 'form-label', html: 'Did you stop work because of the injury?' + prefillTag(!!state.stoppedWork) }), optionRow('c3fw-stoppedWork', '', [['yes', 'Yes'], ['no', 'No']], state.stoppedWork, function (v) { state.stoppedWork = v; $('c3fw-stop-detail').style.display = v === 'yes' ? 'block' : 'none'; persist(); })]));
    c4b.appendChild(el('div', { id: 'c3fw-stop-detail', style: state.stoppedWork === 'yes' ? 'display:block' : 'display:none' }, [group([el('label', { class: 'form-label', text: 'On what date?' }), dateInput('c3fw-stopWorkDate', state.stopWorkDate)])]));
    c4b.appendChild(group([el('label', { class: 'form-label', html: 'Have you returned to work?' + prefillTag(!!state.returnedWork) }), optionRow('c3fw-returnedWork', '', [['no', 'No'], ['yes', 'Yes']], state.returnedWork, function (v) { state.returnedWork = v; $('c3fw-return-detail').style.display = v === 'yes' ? 'block' : 'none'; persist(); })]));
    c4b.appendChild(el('div', { id: 'c3fw-return-detail', style: state.returnedWork === 'yes' ? 'display:block' : 'display:none' }, [
      fieldRow([dateField('c3fw-returnDate', 'Return date', 'opt', state.returnDate, false), null]),
      group([el('label', { class: 'form-label', text: 'Duty type' }), optionRow('c3fw-returnDuty', '', [['regular', 'Regular duty'], ['limited', 'Limited duty']], state.returnDuty, function (v) { state.returnDuty = v; persist(); })])
    ]));
    step4.appendChild(c4b);

    var c4c = card('Prior Injury', 'If you injured this same body part before, NY requires a short HIPAA release (Form C-3.3).');
    c4c.appendChild(group([el('label', { class: 'form-label', text: 'Have you had another injury to the same body part, or a similar illness?' }), optionRow('c3fw-priorInjury', '', [['no', 'No'], ['yes', 'Yes']], state.priorInjury, function (v) { state.priorInjury = v; $('c3fw-c33-detail').style.display = v === 'yes' ? 'block' : 'none'; persist(); })]));
    var c33Detail = el('div', { id: 'c3fw-c33-detail', style: state.priorInjury === 'yes' ? 'display:block' : 'display:none' });
    c33Detail.appendChild(el('div', { class: 'info-callout', html: '<strong>We’ll generate Form C-3.3 too.</strong> It authorizes the doctors who treated your previous injury to release those records to the insurer. File it together with your C-3.' }));
    c33Detail.appendChild(group([el('label', { class: 'form-label', text: 'Describe the previous injury/illness' }), el('textarea', { class: 'form-input', id: 'c3fw-c33-priorDesc', placeholder: 'What happened, and when' }, [state.c33_priorDesc])]));
    c33Detail.appendChild(group([el('label', { class: 'form-label', text: 'Doctor(s) who treated the previous injury (name & address)' }), el('textarea', { class: 'form-input', id: 'c3fw-c33-providers', placeholder: 'One per line' }, [state.c33_providers])]));
    var mhToggle = el('div', { class: 'toggle-switch' + (state.c33_releaseMentalHealth ? ' on' : ''), id: 'c3fw-mh-toggle' }, [el('div', { class: 'toggle-knob' })]);
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
    var step5 = el('div', { class: 'step-section', id: 'c3fw-step-5' });
    step5.appendChild(stepIntro('✅', 'Review & Sign', 'Check your answers, then certify and sign.'));
    var revCard = card('Review', 'Tap “Edit” to change a section.');
    revCard.appendChild(reviewGroup('You & Job', 1, [['Name', 'c3fw-rev-name'], ['DOB', 'c3fw-rev-dob'], ['Job', 'c3fw-rev-job']]));
    revCard.appendChild(reviewGroup('Injury', 2, [['Date', 'c3fw-rev-doi'], ['Where', 'c3fw-rev-where'], ['Body Parts', 'c3fw-rev-body']]));
    revCard.appendChild(reviewGroup('Employer', 3, [['Employer', 'c3fw-rev-employer'], ['Gave Notice', 'c3fw-rev-notice']]));
    revCard.appendChild(reviewGroup('Medical & Work', 4, [['Treating Dr', 'c3fw-rev-doctor'], ['Returned to Work', 'c3fw-rev-return'], ['Prior Injury (C-3.3)', 'c3fw-rev-prior']]));
    step5.appendChild(revCard);

    var certCard = card('Certify & Sign');
    certCard.appendChild(el('div', { class: 'legal-notice' }, [
      el('div', { class: 'legal-notice-title', html: '⚠️ Certification' }),
      el('p', { text: 'I am making a claim for benefits under the Workers’ Compensation Law. My signature affirms that the information I am providing is true and accurate to the best of my knowledge and belief. Any person who knowingly and with intent to defraud presents false information may be guilty of a crime subject to fines and imprisonment.' })
    ]));
    certCard.appendChild(group([el('label', { class: 'form-label', text: 'Type your full legal name to certify' }), el('input', { type: 'text', class: 'form-input', id: 'c3fw-certName', value: state.certName, placeholder: 'Your full legal name' })]));
    var sigCanvas = el('canvas', { class: 'sig-pad', id: 'c3fw-sig' });
    certCard.appendChild(group([el('label', { class: 'form-label', text: 'Draw your signature' }), el('div', { class: 'sig-pad-wrap' }, [sigCanvas, el('button', { class: 'sig-clear', type: 'button', onclick: function () { clearSig(); } }, ['Clear'])])]));
    var certToggle = el('div', { class: 'toggle-switch', id: 'c3fw-cert-toggle' }, [el('div', { class: 'toggle-knob' })]);
    var certAgreed = { v: false };
    certToggle.addEventListener('click', function () { certToggle.classList.toggle('on'); certAgreed.v = certToggle.classList.contains('on'); });
    certCard.appendChild(el('div', { class: 'toggle-row' }, [el('div', null, [el('div', { class: 'toggle-text', text: 'I certify the above is true' })]), certToggle]));
    step5.appendChild(certCard);

    step5.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-secondary', onclick: function () { goToStep(4); } }, ['Back']),
      el('button', { class: 'btn btn-primary', id: 'c3fw-generate', onclick: function () { generate(certAgreed.v); } }, ['Generate & File My C-3'])
    ]));
    bodyWrap.appendChild(step5);

    /* ================= SUCCESS ======================================== */
    var stepSuccess = el('div', { class: 'step-section', id: 'c3fw-step-success' });
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
    function textField(id, label, mode, val, ph, pre) { return el('div', null, [el('label', { class: 'form-label', html: labelHtml(label, mode) + prefillTag(pre) }), el('input', { type: 'text', class: 'form-input', id: id, value: val || '', placeholder: ph || '' }), errEl('c3fw-err-' + id.replace('c3fw-', ''), label + ' is required')]); }
    function dateInput(id, val) { var n = el('input', { type: 'date', class: 'form-input', id: id, max: todayISO() }); if (val) n.value = val; return n; }
    function dateField(id, label, mode, val, pre) { return el('div', null, [el('label', { class: 'form-label', html: labelHtml(label, mode) + prefillTag(pre) }), dateInput(id, val), errEl('c3fw-err-' + id.replace('c3fw-', ''), label + ' is required')]); }
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
      ['c3fw-name', 'name'], ['c3fw-dob', 'dob'], ['c3fw-ssn', 'ssn'], ['c3fw-mailing', 'mailing'], ['c3fw-mailing2', 'mailing2'],
      ['c3fw-phone', 'phone'], ['c3fw-language', 'language'], ['c3fw-jobTitle', 'jobTitle'], ['c3fw-activities', 'activities'],
      ['c3fw-jobOther', 'jobOther'], ['c3fw-grossPay', 'grossPay'], ['c3fw-payFreq', 'payFreq'], ['c3fw-doi', 'doi'],
      ['c3fw-timeOfInjury', 'timeOfInjury'], ['c3fw-whereHappened', 'whereHappened'], ['c3fw-whatDoing', 'whatDoing'],
      ['c3fw-howHappened', 'howHappened'], ['c3fw-nature', 'nature'], ['c3fw-employer', 'employer'], ['c3fw-employerPhone', 'employerPhone'],
      ['c3fw-supervisor', 'supervisor'], ['c3fw-workAddress', 'workAddress'], ['c3fw-otherEmployers', 'otherEmployers'],
      ['c3fw-noticeTo', 'noticeTo'], ['c3fw-noticeDate', 'noticeDate'], ['c3fw-witnessNames', 'witnessNames'],
      ['c3fw-objectWhat', 'objectWhat'], ['c3fw-licensePlate', 'licensePlate'], ['c3fw-mvCarrier', 'mvCarrier'],
      ['c3fw-stopWorkDate', 'stopWorkDate'], ['c3fw-returnDate', 'returnDate'], ['c3fw-firstTreatDate', 'firstTreatDate'],
      ['c3fw-treatType', 'treatType'], ['c3fw-firstTreatName', 'firstTreatName'], ['c3fw-treatingDoctors', 'treatingDoctors'],
      ['c3fw-c33-priorDesc', 'c33_priorDesc'], ['c3fw-c33-providers', 'c33_providers'], ['c3fw-certName', 'certName']
    ];
    var SENSITIVE = { ssn: 1 }; // never persisted to the draft store
    function syncFromDom() {
      TEXT_FIELDS.forEach(function (f) { var n = $(f[0]); if (n) state[f[1]] = n.value; });
      var g = $('c3fw-gender'); if (g) state.gender = g.value;
    }
    root.addEventListener('blur', function (e) { if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { syncFromDom(); persist(); } }, true);
    root.addEventListener('change', function (e) { if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { syncFromDom(); persist(); } });

    /* ---------- validation -------------------------------------------- */
    function showError(id) { var e = $('c3fw-err-' + id); if (e) e.classList.add('visible'); }
    function clearError(id) { var e = $('c3fw-err-' + id); if (e) e.classList.remove('visible'); }
    function validateAndNext(step) {
      syncFromDom(); var ok = true;
      function req(stKey, errId) { if (!state[stKey] || !String(state[stKey]).trim()) { showError(errId); ok = false; } else clearError(errId); }
      if (step === 1) { req('name', 'name'); req('mailing', 'mailing'); req('phone', 'phone'); req('jobTitle', 'jobTitle'); if (!state.dob) { showError('dob'); ok = false; } else clearError('dob'); if (!state.gender) { ok = false; toast('Please select gender (required on the C-3).'); } }
      else if (step === 2) { if (!state.doi) { showError('doi'); ok = false; } else clearError('doi'); req('whereHappened', 'whereHappened'); req('whatDoing', 'whatDoing'); req('howHappened', 'howHappened'); req('nature', 'nature'); if (state.bodyParts.length === 0) { showError('body'); $('c3fw-body-grid').classList.add('error'); ok = false; } else clearError('body'); }
      else if (step === 3) { req('employer', 'employer'); }
      if (ok) goToStep(step + 1);
    }

    /* ---------- navigation -------------------------------------------- */
    function goToStep(n) {
      syncFromDom(); state.step = n; persist();
      progress.style.display = n >= 1 ? 'block' : 'none';
      root.querySelectorAll('.step-section').forEach(function (s) { s.classList.remove('active'); });
      var sec = $('c3fw-step-' + n); if (sec) sec.classList.add('active');
      for (var i = 1; i <= TOTAL_STEPS; i++) {
        var dot = $('c3fw-dot-' + i); if (dot) { dot.className = 'step-dot'; if (i < n) dot.classList.add('completed'); else if (i === n) dot.classList.add('active'); }
        if (i < TOTAL_STEPS) { var line = $('c3fw-line-' + i); if (line) { line.className = 'step-line'; if (i < n) line.classList.add('completed'); } }
      }
      var sc = $('c3fw-step-current'); if (sc) sc.textContent = String(n);
      var sn = $('c3fw-step-name'); if (sn) sn.textContent = STEP_NAMES[n] || '';
      if (n === 5) populateReview();
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
    }

    /* ---------- review ------------------------------------------------ */
    function setRev(id, val) { var e = $(id); if (!e) return; if (val) { e.textContent = val; e.classList.remove('empty'); } else { e.textContent = 'Not provided'; e.classList.add('empty'); } }
    function populateReview() {
      setRev('c3fw-rev-name', state.name); setRev('c3fw-rev-dob', fmtDate(state.dob)); setRev('c3fw-rev-job', state.jobTitle);
      setRev('c3fw-rev-doi', fmtDate(state.doi)); setRev('c3fw-rev-where', state.whereHappened);
      setRev('c3fw-rev-body', state.bodyParts.length ? state.bodyParts.map(function (p) { return BODY_LABELS[p] || capWords(p); }).join(', ') : '');
      setRev('c3fw-rev-employer', state.employer); setRev('c3fw-rev-notice', state.gaveNotice === 'yes' ? 'Yes' : (state.gaveNotice === 'no' ? 'No' : ''));
      setRev('c3fw-rev-doctor', state.treatingDoctors); setRev('c3fw-rev-return', state.returnedWork === 'yes' ? ('Yes' + (state.returnDuty ? ' — ' + state.returnDuty : '')) : (state.returnedWork === 'no' ? 'No' : ''));
      setRev('c3fw-rev-prior', state.priorInjury === 'yes' ? 'Yes — C-3.3 included' : (state.priorInjury === 'no' ? 'No' : ''));
    }

    /* ---------- signature canvas -------------------------------------- */
    function initSig() {
      var canvas = sigCanvas; sig.canvas = canvas;
      function resize() {
        var rect = canvas.getBoundingClientRect(); var dpr = window.devicePixelRatio || 1; if (!rect.width) return;
        canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
        var c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.lineWidth = 2; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#1B2A4A';
      }
      resize();
      var drawing = false, last = null;
      function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
      canvas.addEventListener('pointerdown', function (e) { drawing = true; last = pos(e); sig.drawn = true; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); });
      canvas.addEventListener('pointermove', function (e) { if (!drawing) return; var p = pos(e), c = canvas.getContext('2d'); c.beginPath(); c.moveTo(last.x, last.y); c.lineTo(p.x, p.y); c.stroke(); last = p; e.preventDefault(); });
      function end() { drawing = false; last = null; }
      canvas.addEventListener('pointerup', end); canvas.addEventListener('pointerleave', end); canvas.addEventListener('pointercancel', end);
    }
    function clearSig() { if (!sig.canvas) return; var c = sig.canvas.getContext('2d'); c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, sig.canvas.width, sig.canvas.height); c.restore(); sig.drawn = false; }

    /* ================================================================
     * PDF fill (OC-400 pattern: AcroForm fill-by-name + de-XFA on save)
     * Verbatim from the app wizard; loadTemplate handles anonymous mode
     * (no supabase client → straight to the bundled /forms/ copy).
     * ============================================================== */
    function loadTemplate(PDFDocument, bucketFile, bundledPath) {
      var LOAD_OPTS = { ignoreEncryption: true, throwOnInvalidObject: false, parseSpeed: (window.PDFLib && window.PDFLib.ParseSpeeds) ? window.PDFLib.ParseSpeeds.Fastest : 1500 };
      function fromBundle() { return fetch(bundledPath).then(function (r) { if (!r.ok) throw new Error('C-3 template not found in Storage or bundle'); return r.arrayBuffer(); }).then(function (b) { return PDFDocument.load(b, LOAD_OPTS); }); }
      // Anonymous (or no storage client): the c3-template bucket is auth-only, so
      // go straight to the bundled blank form shipped in the website repo.
      if (!supabase || !supabase.storage) return fromBundle();
      return supabase.storage.from('c3-template').download(bucketFile)
        .then(function (res) { return (res && res.data && !res.error) ? res.data.arrayBuffer() : null; })
        .catch(function () { return null; })
        .then(function (bytes) { return bytes ? PDFDocument.load(bytes, LOAD_OPTS) : fromBundle(); });
    }
    function deXFA(pdf) {
      try {
        var acro = pdf.catalog.lookup(window.PDFLib.PDFName.of('AcroForm'));
        if (acro) { acro.delete(window.PDFLib.PDFName.of('XFA')); acro.set(window.PDFLib.PDFName.of('NeedAppearances'), window.PDFLib.PDFBool.True); }
      } catch (e) { console.warn('[C3] DEXFA_SKIPPED', e); }
    }
    function fillC3(PDFLib) {
      var PDFDocument = PDFLib.PDFDocument;
      return loadTemplate(PDFDocument, 'template.pdf', '/forms/c3.pdf').then(function (pdf) {
        var form = pdf.getForm();
        function setT(name, v) { try { if (v != null && v !== '') form.getTextField(name).setText(String(v)); } catch (e) {} }
        function setC(name) { try { form.getCheckBox(name).check(); } catch (e) {} }
        var dobP = dateParts(state.dob), doiP = dateParts(state.doi);
        setT(F.wcb, profile.wcb_case_number || '');
        setT(F.name, state.name);
        setT(F.dobM, dobP[0]); setT(F.dobD, dobP[1]); setT(F.dobY, dobP[2]);
        setT(F.mailing, state.mailing); setT(F.mailing2, state.mailing2);
        setT(F.ssn, state.ssn);
        setT(F.phone, state.phone);
        if (state.gender === 'M') setC(F.genderM); else if (state.gender === 'F') setC(F.genderF);
        if (state.translator === 'yes') { setC(F.translatorY); setT(F.language, state.language); } else if (state.translator === 'no') setC(F.translatorN);
        setT(F.employer, state.employer); setT(F.employerPhone, state.employerPhone);
        setT(F.workAddress, state.workAddress); setT(F.supervisor, state.supervisor); setT(F.otherEmployers, state.otherEmployers);
        setT(F.jobTitle, state.jobTitle); setT(F.activities, state.activities);
        if (state.jobTime && JOBTIME_FIELDS[state.jobTime]) setC(JOBTIME_FIELDS[state.jobTime]);
        if (state.jobTime === 'Other') setT(F.jobOtherText, state.jobOther);
        setT(F.grossPay, state.grossPay); setT(F.payFreq, state.payFreq);
        setT(F.doiM, doiP[0]); setT(F.doiD, doiP[1]); setT(F.doiY, doiP[2]);
        setT(F.timeOfInjury, state.timeOfInjury); if (state.ampm === 'AM') setC(F.am); else if (state.ampm === 'PM') setC(F.pm);
        setT(F.whereHappened, state.whereHappened);
        setT(F.whatDoing, state.whatDoing);
        setT(F.howHappened, state.howHappened);
        var natureText = state.nature + (state.bodyParts.length ? ('  [Body parts: ' + state.bodyParts.map(function (p) { return BODY_LABELS[p] || p; }).join(', ') + ']') : '');
        setT(F.nature, natureText);
        setT(F.nameP2, state.name); setT(F.doiP2M, doiP[0]); setT(F.doiP2D, doiP[1]); setT(F.doiP2Y, doiP[2]);
        if (state.objectInvolved === 'yes') setT(F.objectWhat, state.objectWhat);
        if (state.motorVehicle === 'yes') { if (state.vehicleType === 'your_vehicle') setC(F.yourVehicle); else if (state.vehicleType === 'employers_vehicle') setC(F.employersVehicle); else if (state.vehicleType === 'other_vehicle') setC(F.otherVehicle); setT(F.licensePlate, state.licensePlate); setT(F.mvCarrier1, state.mvCarrier); }
        if (state.gaveNotice === 'yes') { setT(F.noticeTo, state.noticeTo); if (state.noticeMethod === 'orally') setC(F.orally); else if (state.noticeMethod === 'in_writing') setC(F.inWriting); }
        if (state.witnessed === 'yes') setT(F.witnessNames, state.witnessNames);
        if (state.stoppedWork === 'yes') setT(F.stopWorkDate, fmtDate(state.stopWorkDate));
        if (state.returnedWork === 'yes') { setT(F.returnedDate, fmtDate(state.returnDate)); if (state.returnDuty === 'regular') setC(F.regularDuty); else if (state.returnDuty === 'limited') setC(F.limitedDuty); }
        setT(F.firstTreatDate, fmtDate(state.firstTreatDate));
        if (state.treatType && TREAT_FIELDS[state.treatType]) setC(TREAT_FIELDS[state.treatType]);
        if (state.treatType === 'none_received') setC(F.noneReceived);
        setT(F.firstTreatName1, state.firstTreatName);
        setT(F.treatingDoctors1, state.treatingDoctors); setT(F.treatingDoctorsPhone, state.treatingDoctorsPhone);
        setT(F.printName, state.certName || state.name);
        setT(F.certDate, fmtDate(todayISO()));
        return embedSig(pdf, PDFLib).then(function () { deXFA(pdf); return pdf.save(); });
      });
    }
    function embedSig(pdf, PDFLib) {
      if (!sig.drawn || !sig.canvas) return Promise.resolve();
      try {
        var dataUrl = sig.canvas.toDataURL('image/png');
        return pdf.embedPng(dataUrl).then(function (png) {
          var pages = pdf.getPages(); var page2 = pages[1]; if (!page2) return;
          var w = 220, h = Math.min(w * (png.height / png.width), 28);
          page2.drawImage(png, { x: 70, y: 70, width: w, height: h });
        });
      } catch (e) { console.warn('[C3] SIG_EMBED_SKIPPED', e); return Promise.resolve(); }
    }
    function fillC33(PDFLib) {
      var PDFDocument = PDFLib.PDFDocument;
      return loadTemplate(PDFDocument, 'c33-template.pdf', '/forms/c3_3.pdf').then(function (pdf) {
        var form = pdf.getForm();
        function setT(name, v) { try { if (v != null && v !== '') form.getTextField(name).setText(String(v)); } catch (e) {} }
        function setC(name) { try { form.getCheckBox(name).check(); } catch (e) {} }
        setT('WCB Case Number', profile.wcb_case_number || '');
        setT('DOB2', fmtDate(state.dob));
        setT('Current Injury/Illness', state.nature || state.bodyParts.map(function (p) { return BODY_LABELS[p] || p; }).join(', '));
        setT('Text2', state.name);
        setT('Text3', state.c33_priorDesc);
        setT('Text4', state.c33_providers);
        if (state.c33_releaseMentalHealth) setC('Release mental health care');
        return embedSig(pdf, PDFLib).then(function () { return pdf.save(); });
      }).catch(function (e) { console.warn('[C3] C33_FILL_FAILED', e); return null; });
    }

    /* ---------- submission seam (C3Submitter) ------------------------- */
    // Signed-in: upload to private storage + write a low-PHI c3_filings row.
    function SelfFilePackage(api) { this.api = api; }
    SelfFilePackage.prototype.submit = function (pdfBytes, c33Bytes) {
      var api = this.api, uid = user.id, ts = Date.now();
      var path = uid + '/' + ts + '.pdf';
      var blob = new Blob([pdfBytes], { type: 'application/pdf' });
      return api.storage.from('c3-filings').upload(path, blob, { contentType: 'application/pdf', upsert: false })
        .then(function (up) { if (up && up.error) throw up.error; })
        .then(function () {
          if (!c33Bytes) return null;
          var c33path = uid + '/' + ts + '_c33.pdf';
          return api.storage.from('c3-filings').upload(c33path, new Blob([c33Bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false })
            .then(function (up2) { if (up2 && up2.error) throw up2.error; return c33path; });
        })
        .then(function (c33path) {
          var row = { user_id: uid, status: 'generated', storage_path: 'c3-filings/' + path, c33_path: c33path ? ('c3-filings/' + c33path) : null, wcb_case_number: profile.wcb_case_number || null, has_attorney: !!profile.has_attorney, generated_at: new Date().toISOString() };
          return api.from('c3_filings').insert(row).then(function (res) { if (res && res.error) throw res.error; return { kind: 'self_file', saved: true, path: path, c33path: c33path }; });
        })
        .then(function (out) {
          return api.storage.from('c3-filings').createSignedUrl(out.path, 3600).then(function (s) {
            out.signedUrl = (s && s.data && s.data.signedUrl) || null;
            if (!out.c33path) return out;
            return api.storage.from('c3-filings').createSignedUrl(out.c33path, 3600).then(function (s2) { out.c33SignedUrl = (s2 && s2.data && s2.data.signedUrl) || null; return out; });
          });
        });
    };
    // Anonymous: hand the bytes straight back as in-browser object URLs. Nothing
    // is uploaded and no row is written — the PDF lives only in the visitor's tab.
    function DownloadOnlyPackage() {}
    DownloadOnlyPackage.prototype.submit = function (pdfBytes, c33Bytes) {
      var out = { kind: 'download', saved: false };
      out.signedUrl = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
      if (c33Bytes) { out.c33SignedUrl = URL.createObjectURL(new Blob([c33Bytes], { type: 'application/pdf' })); out.c33path = true; }
      return Promise.resolve(out);
    };
    function ECaseSubmit() {}
    ECaseSubmit.prototype.submit = function () { return Promise.reject(new Error('eCase electronic submission is not yet available (WCB data partnership pending).')); };

    /* ---------- generate (build + sign + package) --------------------- */
    function generate(certAgreed) {
      if (working) return;
      syncFromDom();
      if (!certAgreed) { toast('Please toggle “I certify the above is true” before signing.'); return; }
      if (!state.certName || !state.certName.trim()) { toast('Type your full legal name to certify.'); return; }
      if (!sig.drawn) { toast('Please draw your signature to sign the C-3.'); return; }
      working = true;
      var btn = $('c3fw-generate'); if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
      ensurePdfLib().then(function (PDFLib) {
        return fillC3(PDFLib).then(function (c3Bytes) {
          var c33P = state.priorInjury === 'yes' ? fillC33(PDFLib) : Promise.resolve(null);
          return c33P.then(function (c33Bytes) {
            var submitter = signedIn ? new SelfFilePackage(supabase) : new DownloadOnlyPackage();
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
        if (btn) { btn.disabled = false; btn.textContent = 'Generate & File My C-3'; }
        console.error('[C3] GENERATE_FAILED', e);
        toast('We couldn’t generate your C-3. Your answers are still here — please try again.');
      });
    }

    /* ---------- success (truthful) ------------------------------------ */
    function showSuccess(result) {
      root.querySelectorAll('.step-section').forEach(function (s) { s.classList.remove('active'); });
      for (var i = 1; i <= TOTAL_STEPS; i++) { var d = $('c3fw-dot-' + i); if (d) d.className = 'step-dot completed'; if (i < TOTAL_STEPS) { var l = $('c3fw-line-' + i); if (l) l.className = 'step-line completed'; } }
      var toAttorney = state.branch === 'attorney' && profile.attorney_email;
      var c33Note = result.c33path ? ' Your Form C-3.3 (HIPAA release) is included — file it together with your C-3.' : '';
      var savedNote = result.saved ? 'We generated and saved your signed C-3 Employee Claim.' : 'We generated your signed C-3 Employee Claim.';
      var screen = el('div', { class: 'success-screen' }, [
        el('div', { class: 'success-icon', text: '✓' }),
        el('h2', { text: 'Your C-3 is ready' }),
        el('p', { text: savedNote + c33Note + ' It has not been submitted to the WCB — here’s how to file it.' })
      ]);
      if (result.signedUrl) screen.appendChild(el('a', { class: 'btn btn-primary', href: result.signedUrl, target: '_blank', rel: 'noopener', style: 'display:block;text-decoration:none;margin-bottom:10px', download: 'C-3_Employee_Claim.pdf' }, ['⬇ Download your C-3 (PDF)']));
      if (result.c33SignedUrl) screen.appendChild(el('a', { class: 'btn btn-secondary', href: result.c33SignedUrl, target: '_blank', rel: 'noopener', style: 'display:block;text-decoration:none;margin-bottom:10px', download: 'C-3.3_HIPAA_Release.pdf' }, ['⬇ Download Form C-3.3']));

      var steps = el('div', { class: 'file-steps' }, [el('h3', { text: 'How to file with the WCB' })]);
      function fstep(n, html) { return el('div', { class: 'file-step' }, [el('div', { class: 'file-step-num', text: String(n) }), el('div', { html: html })]); }
      if (toAttorney) {
        steps.appendChild(fstep(1, 'Send the PDF to your attorney at <b>' + escapeHtml(profile.attorney_email) + '</b> — they may file it for you. Download it above and attach it to an email.'));
        steps.appendChild(fstep(2, 'If you’d rather file it yourself, follow the WCB options below.'));
      }
      var base = toAttorney ? 2 : 0;
      steps.appendChild(fstep(base + 1, '<b>By email (self-file):</b> attach the PDF and send it to <b>wcbclaimsfiling@wcb.ny.gov</b>.'));
      steps.appendChild(fstep(base + 2, '<b>Online:</b> upload the PDF at the WCB Forms Submission portal, <b>wcb.ny.gov</b> → “File a Claim / Submit Forms.”'));
      steps.appendChild(fstep(base + 3, '<b>By mail:</b> NYS Workers’ Compensation Board, Centralized Mailing, PO Box 5205, Binghamton, NY 13902-5205.'));
      steps.appendChild(fstep(base + 4, '<b>By fax:</b> (877) 533-0337.'));
      screen.appendChild(steps);
      screen.appendChild(el('div', { class: 'info-callout', html: '<strong>Before you file:</strong> open the PDF and review it. A few Yes/No checkboxes may be blank — mark any that apply to you, then file. Your answers are saved on the form.' }));
      if (!result.saved) screen.appendChild(el('div', { class: 'info-callout', html: '<strong>Heads up:</strong> we didn’t keep a copy — save the downloaded PDF somewhere safe. <a href="/auth_v2.html?redirect=%2Ftools%2Fclaim-filing" style="color:var(--accent-hover);font-weight:700">Create a free Comp Buddy account</a> to store your filings and track your claim.' }));
      screen.appendChild(el('button', { class: 'btn btn-secondary', style: 'width:100%', onclick: function () { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {} } }, ['Done']));
      stepSuccess.innerHTML = '';
      stepSuccess.appendChild(screen);
      stepSuccess.classList.add('active');
      progress.style.display = 'none';
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
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
        var g = $('c3fw-gender'); if (g) g.value = state.gender || '';
        (state.bodyParts || []).forEach(function (p) { var chip = chipGrid.querySelector('.chip[data-part="' + p + '"]'); if (chip) chip.classList.add('selected'); });
        if (state.step && state.step >= 1 && state.step <= TOTAL_STEPS) goToStep(state.step);
      });
    }

    // boot
    setTimeout(function () { initSig(); restore(); }, 0);
    return root;
  }

  CD.C3FilingWizard = { render: render };
})(window);
