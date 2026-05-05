/* ────────────────────────────────────────────────────────────────────────
   Attorney Referral Network — Application Modal
   Drop-in module. Include with:
     <script defer src="/js/attorney-network-modal.js"></script>
   Then trigger with:
     <button onclick="openAttorneyApplication()">Join Our Attorney Referral Network</button>

   Submits to the `submit-attorney-application` Supabase edge function.
   Field names below are the proposed schema; Dev will mirror them in the
   attorney_applications table.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  if (window.__ATTORNEY_NET_MODAL_LOADED__) return;
  window.__ATTORNEY_NET_MODAL_LOADED__ = true;

  const SUPABASE_URL  = 'https://ltibymvlytodkemdeeox.supabase.co';
  const EDGE_FN_URL   = SUPABASE_URL + '/functions/v1/submit-attorney-application';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0aWJ5bXZseXRvZGtlbWRlZW94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjA1NjYsImV4cCI6MjA5MDM5NjU2Nn0.b5oQqQIdgJRc0DEP2k7kMVdCRzfyfnuAwjVNZlbVyak';

  // ── Counties: NYC 5 boroughs, then Statewide ────────────────────────
  const COUNTY_OPTIONS = [
    { value: 'Bronx',                 label: 'Bronx'                 },
    { value: 'Kings (Brooklyn)',      label: 'Kings (Brooklyn)'      },
    { value: 'New York (Manhattan)',  label: 'New York (Manhattan)'  },
    { value: 'Queens',                label: 'Queens'                },
    { value: 'Richmond (Staten Island)', label: 'Richmond (Staten Island)' },
    { value: 'Statewide',             label: 'Statewide (all NY counties)' },
  ];

  // ── Inject CSS once ─────────────────────────────────────────────────
  const css = `
  .attyApp-overlay{display:none;position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);justify-content:center;align-items:flex-start;padding:20px;overflow-y:auto;}
  .attyApp-overlay.active{display:flex;}
  .attyApp-modal{background:#0e1322;border:1px solid #1c2d4a;border-radius:16px;width:100%;max-width:600px;position:relative;animation:attyAppIn 0.25s ease;color:#dce4f0;font-family:'DM Sans',system-ui,sans-serif;line-height:1.55;margin:24px auto;}
  @keyframes attyAppIn{from{opacity:0;transform:translateY(20px);}to{opacity:1;transform:translateY(0);}}
  .attyApp-close{position:absolute;top:14px;right:14px;background:none;border:none;color:#8899b4;font-size:26px;cursor:pointer;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:6px;transition:background 0.15s;line-height:1;}
  .attyApp-close:hover{background:rgba(255,255,255,0.08);color:#f4f6fa;}
  .attyApp-header{padding:32px 32px 0;text-align:center;}
  .attyApp-header h3{font-size:22px;font-weight:800;color:#f4f6fa;margin:0 0 6px;letter-spacing:-0.3px;}
  .attyApp-header p{font-size:14px;color:#8899b4;margin:0;}
  .attyApp-body{padding:20px 32px 32px;}
  @media(max-width:600px){
    .attyApp-header{padding:24px 20px 0;}
    .attyApp-body{padding:16px 20px 24px;}
    .attyApp-modal{margin:8px auto;border-radius:12px;}
  }

  .attyApp-field{margin-bottom:16px;}
  .attyApp-field label{display:block;font-size:13px;font-weight:600;color:#8899b4;margin-bottom:6px;}
  .attyApp-field label .req{color:#ef4444;}
  .attyApp-field input,.attyApp-field select,.attyApp-field textarea{width:100%;background:rgba(6,8,15,0.6);border:1px solid #1c2d4a;border-radius:8px;padding:10px 14px;color:#f4f6fa;font-family:inherit;font-size:14px;outline:none;transition:border-color 0.15s;line-height:1.5;}
  .attyApp-field input:focus,.attyApp-field select:focus,.attyApp-field textarea:focus{border-color:#4f8ff7;}
  .attyApp-field input::placeholder,.attyApp-field textarea::placeholder{color:#5a6a82;}
  .attyApp-field textarea{resize:vertical;min-height:88px;}
  .attyApp-field .hint{font-size:11px;color:#5a6a82;margin-top:4px;}
  .attyApp-field.has-error input,.attyApp-field.has-error select,.attyApp-field.has-error textarea,
  .attyApp-field.has-error .attyApp-counties{border-color:#ef4444;}
  .attyApp-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  @media(max-width:520px){.attyApp-row{grid-template-columns:1fr;}}

  .attyApp-counties{background:rgba(6,8,15,0.6);border:1px solid #1c2d4a;border-radius:8px;padding:8px 12px;display:flex;flex-wrap:wrap;gap:6px;}
  .attyApp-counties label{display:inline-flex;align-items:center;gap:6px;background:rgba(79,143,247,0.10);border:1px solid rgba(79,143,247,0.25);color:#dce4f0;font-size:12px;font-weight:600;padding:6px 10px;border-radius:14px;cursor:pointer;margin:0;transition:background 0.15s,border-color 0.15s;}
  .attyApp-counties label:hover{background:rgba(79,143,247,0.20);}
  .attyApp-counties input[type=checkbox]{accent-color:#4f8ff7;width:14px;height:14px;margin:0;}
  .attyApp-counties label.checked{background:#4f8ff7;border-color:#4f8ff7;color:#fff;}

  .attyApp-error{background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#fca5a5;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px;display:none;}
  .attyApp-error.visible{display:block;}

  .attyApp-submit{width:100%;background:#f0a030;color:#1a1200;padding:13px 24px;border-radius:8px;font-weight:800;font-size:15px;border:none;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;font-family:inherit;}
  .attyApp-submit:hover{transform:translateY(-1px);box-shadow:0 4px 20px rgba(240,160,48,0.3);}
  .attyApp-submit:disabled{opacity:0.5;cursor:not-allowed;transform:none;box-shadow:none;}
  .attyApp-spinner{display:inline-block;width:16px;height:16px;border:2.5px solid rgba(0,0,0,0.25);border-top-color:#1a1200;border-radius:50%;animation:attyAppSpin 0.6s linear infinite;margin-right:8px;vertical-align:middle;}
  @keyframes attyAppSpin{to{transform:rotate(360deg);}}

  .attyApp-confirm{text-align:center;padding:32px 20px;}
  .attyApp-confirm .check{width:64px;height:64px;border-radius:50%;background:rgba(45,212,160,0.15);color:#2dd4a0;display:inline-flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:18px;}
  .attyApp-confirm h3{font-size:22px;font-weight:800;color:#f4f6fa;margin:0 0 10px;}
  .attyApp-confirm p{font-size:14px;color:#8899b4;line-height:1.7;max-width:420px;margin:0 auto;}
  .attyApp-confirm .ref{font-family:'JetBrains Mono',monospace;font-size:12px;color:#4f8ff7;background:rgba(79,143,247,0.12);padding:4px 12px;border-radius:6px;display:inline-block;margin-top:14px;}
  .attyApp-confirm .done{margin-top:24px;display:inline-flex;align-items:center;gap:8px;background:#4f8ff7;color:#fff;padding:10px 24px;border-radius:8px;font-weight:700;font-size:14px;border:none;cursor:pointer;font-family:inherit;}

  .attyApp-disclosure{font-size:11px;color:#5a6a82;text-align:center;margin-top:14px;line-height:1.5;}
  `;
  const styleEl = document.createElement('style');
  styleEl.id = 'attyApp-styles';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── Build modal HTML once ───────────────────────────────────────────
  const wrapper = document.createElement('div');
  wrapper.className = 'attyApp-overlay';
  wrapper.id = 'attyAppOverlay';
  wrapper.setAttribute('role', 'dialog');
  wrapper.setAttribute('aria-modal', 'true');
  wrapper.setAttribute('aria-labelledby', 'attyAppTitle');

  const countiesHtml = COUNTY_OPTIONS.map(c =>
    `<label data-county="${c.value}"><input type="checkbox" name="counties_served" value="${c.value}"> ${c.label}</label>`
  ).join('');

  wrapper.innerHTML = `
    <div class="attyApp-modal">
      <button class="attyApp-close" type="button" aria-label="Close" data-close>&times;</button>

      <div id="attyAppForm">
        <div class="attyApp-header">
          <h3 id="attyAppTitle">Apply to Join the Attorney Network</h3>
          <p>Be considered for The Comp Desk's neutral, round-robin attorney referral rotation. We'll review your application and follow up within 5 business days.</p>
        </div>

        <form class="attyApp-body" id="attyAppFormEl" novalidate autocomplete="on">
          <div class="attyApp-error" id="attyAppErr"></div>

          <div class="attyApp-field">
            <label>Full name <span class="req">*</span></label>
            <input type="text" name="full_name" required autocomplete="name" maxlength="200" placeholder="Jane A. Doe, Esq.">
          </div>

          <div class="attyApp-row">
            <div class="attyApp-field">
              <label>NY bar number <span class="req">*</span></label>
              <input type="text" name="ny_bar_number" required maxlength="20" placeholder="e.g., 5123456" inputmode="numeric">
            </div>
            <div class="attyApp-field">
              <label>Years practicing WC <span class="req">*</span></label>
              <input type="number" name="years_practicing_wc" required min="0" max="60" step="1" placeholder="e.g., 8">
            </div>
          </div>

          <div class="attyApp-field">
            <label>Firm name <span class="req">*</span></label>
            <input type="text" name="firm_name" required autocomplete="organization" maxlength="200" placeholder="Firm or solo practice name">
          </div>

          <div class="attyApp-field">
            <label>Firm address <span class="req">*</span></label>
            <input type="text" name="firm_address" required autocomplete="street-address" maxlength="300" placeholder="Street, city, state, ZIP">
          </div>

          <div class="attyApp-row">
            <div class="attyApp-field">
              <label>Primary contact email <span class="req">*</span></label>
              <input type="email" name="contact_email" required autocomplete="email" maxlength="200" placeholder="you@firm.com">
            </div>
            <div class="attyApp-field">
              <label>Primary contact phone <span class="req">*</span></label>
              <input type="tel" name="contact_phone" required autocomplete="tel" maxlength="30" placeholder="(555) 123-4567">
            </div>
          </div>

          <div class="attyApp-field">
            <label>Counties served <span class="req">*</span></label>
            <div class="attyApp-counties" id="attyAppCounties" role="group" aria-label="Counties served">${countiesHtml}</div>
            <div class="hint">Select all that apply. "Statewide" means you accept leads from any NY county.</div>
          </div>

          <div class="attyApp-row">
            <div class="attyApp-field">
              <label>Malpractice carrier <span class="req">*</span></label>
              <input type="text" name="malpractice_carrier" required maxlength="150" placeholder="Carrier name">
            </div>
            <div class="attyApp-field">
              <label>Policy number <span class="req">*</span></label>
              <input type="text" name="malpractice_policy_number" required maxlength="60" placeholder="Policy #">
            </div>
          </div>

          <div class="attyApp-field">
            <label>Conflict-check method <span class="req">*</span></label>
            <input type="text" name="conflict_check_method" required maxlength="200" placeholder="e.g., Litify conflicts module, Clio, manual master list">
            <div class="hint">How your firm screens new matters for conflicts.</div>
          </div>

          <div class="attyApp-field">
            <label>Why you want to join <span class="req">*</span></label>
            <textarea name="why_join" required minlength="20" maxlength="2000" placeholder="Tell us a bit about your practice and why you're a good fit for the network."></textarea>
          </div>

          <button type="submit" class="attyApp-submit" id="attyAppSubmitBtn">Submit Application</button>
          <p class="attyApp-disclosure">The Comp Desk does not endorse, recommend, or certify any attorney. Listing is purely informational and based on neutral round-robin rotation.</p>
        </form>
      </div>

      <div id="attyAppConfirm" style="display:none;">
        <div class="attyApp-confirm">
          <div class="check">&#10003;</div>
          <h3>Thanks</h3>
          <p>We'll review your application and follow up within <strong style="color:#f4f6fa;">5 business days</strong>.</p>
          <div class="ref" id="attyAppRef"></div>
          <div><button type="button" class="done" data-close>Done</button></div>
        </div>
      </div>
    </div>
  `;

  function attach() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', attach, { once: true });
      return;
    }
    document.body.appendChild(wrapper);

    // Close handlers
    wrapper.addEventListener('click', (e) => {
      if (e.target === wrapper || e.target.closest('[data-close]')) {
        closeAttorneyApplication();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && wrapper.classList.contains('active')) {
        closeAttorneyApplication();
      }
    });

    // County chip checked-state visual
    const countiesEl = wrapper.querySelector('#attyAppCounties');
    countiesEl.addEventListener('change', (e) => {
      const lbl = e.target.closest('label[data-county]');
      if (lbl) lbl.classList.toggle('checked', e.target.checked);
    });

    // Phone formatter
    const phoneEl = wrapper.querySelector('input[name="contact_phone"]');
    phoneEl.addEventListener('input', () => {
      let d = phoneEl.value.replace(/\D/g, '').slice(0, 10);
      if (d.length >= 7)      phoneEl.value = '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6);
      else if (d.length >= 4) phoneEl.value = '(' + d.slice(0,3) + ') ' + d.slice(3);
      else if (d.length > 0)  phoneEl.value = '(' + d;
    });

    // Submit
    const formEl = wrapper.querySelector('#attyAppFormEl');
    formEl.addEventListener('submit', handleSubmit);
  }

  attach();

  function clearErrors() {
    wrapper.querySelectorAll('.attyApp-field.has-error').forEach(f => f.classList.remove('has-error'));
    const errEl = wrapper.querySelector('#attyAppErr');
    errEl.textContent = '';
    errEl.classList.remove('visible');
  }

  function showError(msg) {
    const errEl = wrapper.querySelector('#attyAppErr');
    errEl.textContent = msg;
    errEl.classList.add('visible');
    errEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function validate(payload, formEl) {
    const errs = [];
    const flag = (name) => {
      const el = formEl.querySelector(`[name="${name}"]`);
      el?.closest('.attyApp-field')?.classList.add('has-error');
    };

    if (!payload.full_name)        { errs.push('Full name is required.'); flag('full_name'); }
    if (!payload.ny_bar_number)    { errs.push('NY bar number is required.'); flag('ny_bar_number'); }
    if (payload.ny_bar_number && !/^\d{4,10}$/.test(payload.ny_bar_number)) {
      errs.push('Bar number should be 4–10 digits.'); flag('ny_bar_number');
    }
    if (!payload.firm_name)        { errs.push('Firm name is required.'); flag('firm_name'); }
    if (!payload.firm_address)     { errs.push('Firm address is required.'); flag('firm_address'); }
    if (!payload.contact_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.contact_email)) {
      errs.push('A valid contact email is required.'); flag('contact_email');
    }
    if (!payload.contact_phone || payload.contact_phone.replace(/\D/g, '').length < 10) {
      errs.push('A valid 10-digit phone number is required.'); flag('contact_phone');
    }
    if (!Array.isArray(payload.counties_served) || payload.counties_served.length === 0) {
      errs.push('Select at least one county served.');
      formEl.querySelector('#attyAppCounties')?.closest('.attyApp-field')?.classList.add('has-error');
    }
    if (payload.years_practicing_wc === '' || payload.years_practicing_wc === null || isNaN(payload.years_practicing_wc) || payload.years_practicing_wc < 0) {
      errs.push('Years practicing WC must be 0 or more.'); flag('years_practicing_wc');
    }
    if (!payload.malpractice_carrier)        { errs.push('Malpractice carrier is required.'); flag('malpractice_carrier'); }
    if (!payload.malpractice_policy_number)  { errs.push('Malpractice policy number is required.'); flag('malpractice_policy_number'); }
    if (!payload.conflict_check_method)      { errs.push('Conflict-check method is required.'); flag('conflict_check_method'); }
    if (!payload.why_join || payload.why_join.length < 20) {
      errs.push('Tell us a bit more about why you want to join (at least 20 characters).');
      flag('why_join');
    }
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    clearErrors();
    const formEl = wrapper.querySelector('#attyAppFormEl');
    const fd = new FormData(formEl);
    const counties = fd.getAll('counties_served');
    const yearsRaw = fd.get('years_practicing_wc');

    const payload = {
      full_name:                  (fd.get('full_name')           || '').trim(),
      ny_bar_number:              (fd.get('ny_bar_number')       || '').trim(),
      firm_name:                  (fd.get('firm_name')           || '').trim(),
      firm_address:               (fd.get('firm_address')        || '').trim(),
      contact_email:              (fd.get('contact_email')       || '').trim().toLowerCase(),
      contact_phone:              (fd.get('contact_phone')       || '').trim(),
      counties_served:            counties,
      years_practicing_wc:        yearsRaw === null || yearsRaw === '' ? null : Number(yearsRaw),
      malpractice_carrier:        (fd.get('malpractice_carrier') || '').trim(),
      malpractice_policy_number:  (fd.get('malpractice_policy_number') || '').trim(),
      conflict_check_method:      (fd.get('conflict_check_method')     || '').trim(),
      why_join:                   (fd.get('why_join')            || '').trim(),
      source:                     'web',
      page:                       location.pathname,
    };

    const errs = validate(payload, formEl);
    if (errs.length) { showError(errs[0]); return; }

    const btn = wrapper.querySelector('#attyAppSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="attyApp-spinner"></span>Submitting...';

    try {
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON,
          'Authorization': 'Bearer ' + SUPABASE_ANON,
        },
        body: JSON.stringify(payload),
      });
      let data = {};
      try { data = await res.json(); } catch (_) {}

      if (res.ok && (data.ok ?? true)) {
        wrapper.querySelector('#attyAppForm').style.display = 'none';
        wrapper.querySelector('#attyAppConfirm').style.display = 'block';
        if (data.id) {
          wrapper.querySelector('#attyAppRef').textContent = 'Ref: ' + String(data.id).substring(0, 8).toUpperCase();
        }
      } else {
        throw new Error(data.error || `Submission failed (${res.status}). Please try again.`);
      }
    } catch (err) {
      showError(err.message || 'Something went wrong. Please try again.');
      btn.disabled = false;
      btn.innerHTML = 'Submit Application';
    }
  }

  // ── Public API ──────────────────────────────────────────────────────
  window.openAttorneyApplication = function () {
    // Reset to form view
    wrapper.querySelector('#attyAppForm').style.display = '';
    wrapper.querySelector('#attyAppConfirm').style.display = 'none';
    const btn = wrapper.querySelector('#attyAppSubmitBtn');
    if (btn) { btn.disabled = false; btn.innerHTML = 'Submit Application'; }
    clearErrors();
    wrapper.classList.add('active');
    document.body.style.overflow = 'hidden';
    // Focus first input for keyboard users
    setTimeout(() => wrapper.querySelector('input[name="full_name"]')?.focus(), 80);
  };

  window.closeAttorneyApplication = function () {
    wrapper.classList.remove('active');
    document.body.style.overflow = '';
  };
})();
