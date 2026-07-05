/* field-help-registry.js — "Why this matters" calculator field copy.
 *
 * SINGLE SHARED COPY BLOCK for the educational field-help text used by BOTH the
 * website (free calculators, via field-help.js) and the app. The object below is
 * kept byte-identical to the app's `FIELD_HELP` in `www/js/ui-components.js`
 * (Item 5A) so web and app never drift. If you edit copy in one place, edit it
 * in the other — or, ideally, point ui-components.js at this file too.
 *
 * Mirrored byte-for-byte to every web surface, exactly like calc-core.js:
 *   • ops/website/js/field-help-registry.js          (website drafting)
 *   • ~/Code/thecompdesk-site/js/field-help-registry.js  (Vercel deploy)
 *   • www/js/data/field-help-registry.js             (staged for the app)
 *
 * Per CLAUDE.md, ALL educational/tooltip copy is Joel-approved. Plain language,
 * no dollar figures. Schema:  key → { title: string, body: string (HTML allowed) }.
 */
(function () {
  'use strict';
  window.CD = window.CD || {};

  // ⚠️ Keep this object IDENTICAL to FIELD_HELP in www/js/ui-components.js.
  window.CD.FIELD_HELP = {
    doa: {
      title: 'Date of Accident',
      body: 'Your weekly benefit is based on the 52 weeks of pay right before your accident. The Board uses this date to pull that 52-week window — so it has to be right.'
        + '<br><br>If your condition built up over time from the work itself (an occupational disease) rather than one event, a different date applies: the <strong>date of disablement</strong> — generally the day the condition first kept you from working (or when you knew, or should have known, it was work-related).',
    },
    aww: {
      title: 'Average Weekly Wage (AWW)',
      body: 'Roughly your average weekly pay before the injury. Your check is two-thirds of this number, so getting it right matters for every payment.'
        + '<br><br>Include overtime and the value of things like employer-provided lodging.',
    },
    // ── Approved copy kept on hand, but no matching input exists in the guest tier
    //    yet, so these are intentionally NOT wired. Wire by adding a
    //    data-fieldhelp="<key>" attribute once a real field appears. ──
    dod: {
      title: 'Date of Disablement (occupational disease)',
      body: 'For conditions that develop from the job over time, this replaces a single accident date. It\'s generally when the condition first disabled you from working, or when you knew/should have known it was work-related.',
    },
    weeks: {
      title: 'Number of Weeks / Period',
      body: 'The stretch of time a benefit covers. Used to turn your weekly rate into a total.',
    },
    disabilityPct: {
      title: 'Disability %',
      body: 'Your treating doctor sets your official degree of disability. It scales your weekly benefit — a higher percentage means a larger check.',
    },
    // ── GLOSSARY TERMS (P2-4) — plain-English definitions for the worker-facing
    //    glossary component (AWW is above). ⚠️ DRAFT copy pending Joel's vetting. ──
    slu: {
      title: 'Schedule Loss of Use (SLU)',
      body: 'A one-time award for permanently losing some use of a “scheduled” body part — an arm, leg, hand, foot, finger, toe, eye, or ear.'
        + '<br><br>The law assigns each part a set number of weeks. Your award is your percentage of loss applied to those weeks, paid at your weekly rate.',
    },
    lwec: {
      title: 'Loss of Wage-Earning Capacity (LWEC)',
      body: 'For permanent injuries to body parts that aren’t on the schedule (like your back, neck, or a systemic condition), you’re “classified” instead of getting an SLU.'
        + '<br><br>Your LWEC is how much your injury lowers your ability to earn. It sets both your ongoing weekly benefit and the most weeks you can be paid.',
    },
    ime: {
      title: 'Independent Medical Exam (IME)',
      body: 'A one-time exam by a doctor the insurance company picks — not your own doctor — to give their opinion on your injury, treatment, or degree of disability.'
        + '<br><br>You’re entitled to advance notice and can share your own doctor’s findings. Missing a properly-noticed IME can pause your benefits, so don’t ignore the notice.',
    },
    c3: {
      title: 'C-3 — Employee Claim',
      body: 'The form you file with the Workers’ Compensation Board to officially open your claim. It tells the Board who you are, how and where you were hurt, and who your employer is.'
        + '<br><br>Filing it protects your rights — generally file within two years of the injury.',
    },
    // TODO(Joel): the guest-reachable fee calculators (CCP/Award, SLU Fees, LWEC,
    // Section 32, Burns) and the AWW-calc inputs (Total Earnings, Days Paid, Weeks
    // Worked, Hourly Rate, Hrs/Wk, Tips, Board/Lodging, CCP Amount, Prior Payments,
    // Rate %, Prior Wks, etc.) currently have NO approved help copy. Add {title,
    // body} entries above and tag their inputs with data-fieldhelp when wording is
    // approved. Web-only guest fields still awaiting copy: maxRate/maxRateInput,
    // hourlyRate, hoursPerWeek, weeksWorked, daysWorked, totalEarnings,
    // straightEarnings, annualEarnings52, overtimeAmount, priorAWW, newAWW,
    // concurrentAWW; SLU priorPayments/part/pct/pw; LWEC lwecPercent/lwecFeePerWeek;
    // CCP ccpAmount; radiculopathy spineRegion/nerveLevel/score_*; spine-brain
    // compRate/claimantAge/lifeExpectancy/asiaClass/sciLevel/tbiSeverity/cognitiveLevel.
  };
})();
