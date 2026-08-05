/**
 * professions.js — the single source of truth for the profession picker.
 *
 * These values MUST stay identical to the CHECK constraint applied in
 * migration 109 (`profiles_profession_chk`):
 *
 *   attorney · paralegal · settlement_coordinator · legal_assistant ·
 *   case_manager · adjuster · other
 *
 * A value here that the constraint rejects surfaces as a failed save the user
 * cannot fix. Three separate surfaces collect this field — signup step 2, the
 * post-OAuth completion step, and /account — so the list lives in exactly one
 * file rather than being retyped three times and drifting.
 *
 * Classic script, not a module, for the same reason as js/social-auth.js: these
 * pages build their Supabase client from the UMD global, and a failed module
 * import takes the whole page down.
 *
 * Context: `profession` is DESCRIPTIVE ONLY. `designation` stays the binary
 * router ('worker' | 'attorney') that every access gate reads. Widening
 * designation instead would have risked routing a paralegal into the
 * injured-worker dashboard through any gate that was missed.
 */
(function () {
  'use strict';

  var PROFESSIONS = [
    { value: 'attorney',               label: 'Attorney' },
    { value: 'paralegal',              label: 'Paralegal' },
    { value: 'legal_assistant',        label: 'Legal assistant' },
    { value: 'settlement_coordinator', label: 'Settlement coordinator' },
    { value: 'case_manager',           label: 'Case manager' },
    { value: 'adjuster',               label: 'Adjuster' },
    { value: 'other',                  label: 'Other' },
  ];

  var VALUES = PROFESSIONS.map(function (p) { return p.value; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * <select> markup. `selected` pre-selects an existing value.
   * `placeholder` is the empty first option; pass null to omit it (i.e. when a
   * value is already guaranteed).
   */
  function selectHtml(id, selected, placeholder) {
    var opts = '';
    if (placeholder !== null) {
      opts += '<option value=""' + (selected ? '' : ' selected') + ' disabled>' +
              esc(placeholder || 'Select your role…') + '</option>';
    }
    PROFESSIONS.forEach(function (p) {
      opts += '<option value="' + p.value + '"' +
              (p.value === selected ? ' selected' : '') + '>' + esc(p.label) + '</option>';
    });
    return '<select id="' + esc(id) + '">' + opts + '</select>';
  }

  /** Free-text input, shown only when profession === 'other'. */
  function otherInputHtml(id, value, hidden) {
    return '<input type="text" id="' + esc(id) + '" maxlength="80" ' +
           'placeholder="Tell us your role" value="' + esc(value || '') + '"' +
           (hidden ? ' hidden' : '') + '>';
  }

  /**
   * Wire the "Other" reveal. Idempotent, and safe if either element is absent.
   * Returns nothing; read values with readValues().
   */
  function bindOther(selectId, otherId) {
    var sel = document.getElementById(selectId);
    var oth = document.getElementById(otherId);
    if (!sel || !oth) return;
    var sync = function () {
      var isOther = sel.value === 'other';
      oth.hidden = !isOther;
      // profiles_profession_other_chk rejects free text unless profession =
      // 'other', so clearing here keeps the write from being refused outright.
      if (!isOther) oth.value = '';
    };
    if (sel.dataset.tcdOtherBound !== '1') {
      sel.dataset.tcdOtherBound = '1';
      sel.addEventListener('change', sync);
    }
    sync();
  }

  /**
   * Read a constraint-safe {profession, profession_other} pair.
   * Returns null for profession when nothing valid is selected, so callers can
   * enforce "required" themselves rather than writing a bad value.
   */
  function readValues(selectId, otherId) {
    var sel = document.getElementById(selectId);
    var oth = document.getElementById(otherId);
    var v = sel && sel.value ? sel.value : null;
    if (v && VALUES.indexOf(v) === -1) v = null;      // never send an unknown value
    var other = (v === 'other' && oth && oth.value.trim()) ? oth.value.trim() : null;
    return { profession: v, profession_other: other };
  }

  window.TCDProfessions = {
    LIST: PROFESSIONS,
    VALUES: VALUES,
    selectHtml: selectHtml,
    otherInputHtml: otherInputHtml,
    bindOther: bindOther,
    readValues: readValues,
  };
})();
