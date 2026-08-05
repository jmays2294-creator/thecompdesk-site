/* ============================================================================
 * events.js — CD.Analytics.EVENTS: the frozen registry of legal event names.
 * ----------------------------------------------------------------------------
 * A typo'd event name is how a funnel taxonomy rots silently — a dashboard
 * quietly stops counting a step and nobody notices for a release cycle. This
 * file is the single place every legal name is declared; CD.track() (see
 * track.js) refuses anything not listed here (throws in dev, no-ops in prod).
 *
 * Naming: domain.object.action — lowercase, dot-separated, no past tense.
 * A handful of names below are two-segment (auth.success, dashboard.view)
 * rather than three — those are load-bearing exceptions: they must match,
 * character for character, the literal strings the funnel views in
 * ops/dev/migrations/099_onboarding_funnel_views.sql filter on. Do not
 * "clean up" those names without updating 099 in lockstep.
 *
 * Domains: onboarding, auth, referral, calc, dashboard, learn, paywall, review.
 * ==========================================================================*/
(function () {
  'use strict';
  window.CD = window.CD || {};

  var EVENTS = {
    // onboarding — the v2 onboarding funnel (099's step_events list)
    ONBOARDING_WELCOME_VIEW:     'onboarding.welcome.view',
    ONBOARDING_WELCOME_SKIP:      'onboarding.welcome.skip',
    ONBOARDING_WELCOME_COMPLETE:  'onboarding.welcome.complete',
    ONBOARDING_SEGMENT_VIEW:      'onboarding.segment.view',
    ONBOARDING_SEGMENT_CARD_IMPRESSION: 'onboarding.segment.card_impression',
    ONBOARDING_SEGMENT_SELECT:    'onboarding.segment.select',
    ONBOARDING_BENEFIT_VIEW:      'onboarding.benefit.view',
    ONBOARDING_BENEFIT_CONTINUE:  'onboarding.benefit.continue',
    ONBOARDING_BENEFIT_BACK:      'onboarding.benefit.back',
    ONBOARDING_RENDER_ERROR:      'onboarding.render.error',
    ONBOARDING_INTAKE_STEP_VIEW:  'onboarding.intake.step_view',
    ONBOARDING_INTAKE_STEP_COMPLETE: 'onboarding.intake.step_complete',
    ONBOARDING_INTAKE_FIELD_CHANGE:  'onboarding.intake.field_change',
    ONBOARDING_INTAKE_BACK:       'onboarding.intake.back',
    ONBOARDING_INTAKE_COMPLETE:   'onboarding.intake.complete',
    ONBOARDING_INTAKE_ABANDON:    'onboarding.intake.abandon',
    ONBOARDING_OD_EDUCATION_VIEW:   'onboarding.od.education.view',
    ONBOARDING_OD_EDUCATION_DWELL:  'onboarding.od.education.dwell',
    ONBOARDING_OD_EDUCATION_EXPAND: 'onboarding.od.education.expand',

    // auth
    AUTH_GATE_VIEW:     'auth.gate.view',
    AUTH_SUCCESS:       'auth.success',
    AUTH_PROVIDER_TAP:  'auth.provider.tap',
    AUTH_ERROR:         'auth.error',
    AUTH_GATE_SKIP:     'auth.gate.skip',

    // referral
    REFERRAL_CONSENT_VIEW:    'referral.consent.view',
    REFERRAL_CONSENT_ACCEPT:  'referral.consent.accept',
    REFERRAL_CONSENT_DECLINE: 'referral.consent.decline',
    REFERRAL_ASSIGNED:        'referral.assigned',
    REFERRAL_REOFFER_VIEW:    'referral.reoffer.view',
    REFERRAL_REOFFER_ACCEPT:  'referral.reoffer.accept',

    // calc
    CALC_CALCULATOR_OPEN:     'calc.calculator.open',
    CALC_CALCULATOR_COMPLETE: 'calc.calculator.complete',
    CALC_RESULT_SAVE:         'calc.result.save',

    // dashboard
    DASHBOARD_VIEW:       'dashboard.view',
    DASHBOARD_CARD_CLICK: 'dashboard.card.click',
    // Phase 6 — adaptive dashboard. position is REQUIRED on impression/tap:
    // it is what separates "nobody wants this" from "nobody scrolled that far".
    DASHBOARD_TILE_IMPRESSION: 'dashboard.tile.impression',
    DASHBOARD_TILE_TAP:        'dashboard.tile.tap',
    DASHBOARD_SOFTWALL_VIEW:    'dashboard.softwall.view',
    DASHBOARD_SOFTWALL_TAP:     'dashboard.softwall.tap',
    DASHBOARD_SOFTWALL_DISMISS: 'dashboard.softwall.dismiss',

    // learn
    LEARN_ARTICLE_VIEW: 'learn.article.view',
    LEARN_VIDEO_PLAY:   'learn.video.play',

    // paywall
    PAYWALL_HARDWALL_VIEW:     'paywall.hardwall.view',
    PAYWALL_GATE_VIEW:         'paywall.gate.view',
    PAYWALL_UPGRADE_CLICK:     'paywall.upgrade.click',
    PAYWALL_PURCHASE_COMPLETE: 'paywall.purchase.complete',

    // review
    REVIEW_PROMPT_VIEW:    'review.prompt.view',
    REVIEW_PROMPT_ACCEPT:  'review.prompt.accept',
    REVIEW_PROMPT_DISMISS: 'review.prompt.dismiss'
  };

  Object.freeze(EVENTS);

  // Reverse lookup for O(1) validation. Built once, frozen, never touched again.
  var VALID_NAMES = Object.create(null);
  Object.keys(EVENTS).forEach(function (key) {
    VALID_NAMES[EVENTS[key]] = true;
  });
  Object.freeze(VALID_NAMES);

  function isRegisteredEvent(name) {
    return typeof name === 'string' && VALID_NAMES[name] === true;
  }

  window.CD.Analytics = window.CD.Analytics || {};
  window.CD.Analytics.EVENTS = EVENTS;
  window.CD.Analytics.isRegisteredEvent = isRegisteredEvent;
})();
