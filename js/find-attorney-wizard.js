/**
 * find-attorney-wizard.js
 *
 * Injured-worker intake wizard (Flow A) for find-attorney.html.
 * Handles 3-step form, geolocation, Cloudflare Turnstile, and
 * submission to the submit-attorney-lead Supabase edge function.
 *
 * Exported for unit-testability; called by find-attorney.html inline.
 */

// ── Config ───────────────────────────────────────────────────
const SUPABASE_URL = 'https://ltibymvlytodkemdeeox.supabase.co';
const EDGE_FN_URL  = `${SUPABASE_URL}/functions/v1/submit-attorney-lead`;

// ── DOM Helpers ───────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function show(id) { const el = $(id); if (el) el.hidden = false; }
function hide(id) { const el = $(id); if (el) el.hidden = true; }
function setErr(id, msg) {
  const el = $(id);
  if (el) { el.textContent = msg; el.hidden = !msg; }
}
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}

// ── State ─────────────────────────────────────────────────────
let wizardData = {};
let geoResult  = null;   // { lat, lng } or null
let map        = null;   // Mapbox map instance (passed in)

// ── Step navigation ───────────────────────────────────────────
let currentStep = 1;

export function initWizard(mapInstance) {
  map = mapInstance;
  // Expose showStep globally so the inline skip button can call it.
  window.wizardGoToStep = showStep;
  showStep(1);
  attachStep1Events();
  attachStep2Events();
  attachStep3Events();
  checkQueryParams();
}

function showStep(n) {
  [1, 2, 3, 'confirm'].forEach(s => {
    const el = $(`wizard-step-${s}`);
    if (el) el.hidden = (s !== n);
  });
  currentStep = n;
  // Update progress dots
  for (let i = 1; i <= 3; i++) {
    const dot = $(`wizard-dot-${i}`);
    if (!dot) continue;
    dot.className = i < n ? 'dot done' : i === n ? 'dot active' : 'dot';
  }
  // Scroll wizard into view smoothly
  const wiz = $('wizard-section');
  if (wiz) wiz.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Step 1: Accident details ──────────────────────────────────

function attachStep1Events() {
  const form = $('wizard-form-1');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!validateStep1()) return;
    const fd = new FormData(form);
    wizardData.date_of_accident     = fd.get('date_of_accident');
    wizardData.employer_name        = fd.get('employer_name');
    wizardData.accident_description = fd.get('accident_description');
    wizardData.injuries             = fd.get('injuries');
    showStep(2);
  });

  // Character count for accident description
  const desc  = $('accident_description');
  const count = $('desc-count');
  if (desc && count) {
    desc.addEventListener('input', () => {
      count.textContent = `${desc.value.length}/1500`;
    });
  }

  // DOA: warn if >10 years
  const doa = $('date_of_accident');
  const doaWarn = $('doa-warn');
  if (doa && doaWarn) {
    doa.addEventListener('change', () => {
      const d = new Date(doa.value);
      const tenYearsAgo = new Date();
      tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
      doaWarn.hidden = !(d < tenYearsAgo);
    });
  }
}

function validateStep1() {
  let ok = true;
  setErr('err-doa', '');
  setErr('err-employer', '');
  setErr('err-desc', '');
  setErr('err-injuries', '');

  const doa  = $('date_of_accident')?.value;
  const now  = new Date();
  const doaD = doa ? new Date(doa) : null;
  if (!doa) {
    setErr('err-doa', 'Date of accident is required.'); ok = false;
  } else if (doaD > now) {
    setErr('err-doa', 'Date of accident cannot be in the future.'); ok = false;
  }

  if (!$('employer_name')?.value.trim()) {
    setErr('err-employer', 'Employer name is required.'); ok = false;
  }

  const desc = $('accident_description')?.value.trim() ?? '';
  if (desc.length < 20) {
    setErr('err-desc', 'Please describe the accident (at least 20 characters).'); ok = false;
  } else if (desc.length > 1500) {
    setErr('err-desc', 'Description must be 1500 characters or fewer.'); ok = false;
  }

  const inj = $('injuries')?.value.trim() ?? '';
  if (inj.length < 5) {
    setErr('err-injuries', 'Please describe your injuries (at least 5 characters).'); ok = false;
  } else if (inj.length > 1000) {
    setErr('err-injuries', 'Injuries description must be 1000 characters or fewer.'); ok = false;
  }

  return ok;
}

// ── Step 2: Location ──────────────────────────────────────────

function attachStep2Events() {
  const geoBtn  = $('btn-use-location');
  const skipBtn = $('btn-skip-location');
  const zipFrm  = $('zip-form');
  const step2Next = $('wizard-step2-next');

  if (geoBtn) {
    geoBtn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        setErr('err-geo', 'Geolocation is not supported by your browser.');
        show('zip-form');
        return;
      }
      geoBtn.disabled = true;
      geoBtn.textContent = 'Locating…';
      navigator.geolocation.getCurrentPosition(
        pos => {
          geoResult = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          geoBtn.textContent = 'Location found ✓';
          geoBtn.style.background = 'var(--gn, #2dd4a0)';
          setErr('err-geo', '');
          // Center map on user location
          if (map) {
            map.flyTo({ center: [geoResult.lng, geoResult.lat], zoom: 10 });
          }
          show('step2-next-wrapper');
          show('wizard-step2-next');
        },
        () => {
          geoBtn.disabled = false;
          geoBtn.textContent = 'Use My Location';
          setErr('err-geo', 'Location access denied. Enter your ZIP code below.');
          show('zip-form');
        }
      );
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      setErr('err-geo', '');
      show('zip-form');
    });
  }

  if (zipFrm) {
    zipFrm.addEventListener('submit', e => {
      e.preventDefault();
      const zip = $('geo_zip')?.value.trim();
      if (!zip || !/^\d{5}$/.test(zip)) {
        setErr('err-zip', 'Please enter a valid 5-digit ZIP code.');
        return;
      }
      setErr('err-zip', '');
      wizardData.geo_zip = zip;
      show('step2-next-wrapper');
      show('wizard-step2-next');
    });
  }

  if (step2Next) {
    step2Next.addEventListener('click', () => {
      if (geoResult) {
        wizardData.geo_lat = geoResult.lat;
        wizardData.geo_lng = geoResult.lng;
        wizardData.geo_consent = true;
      }
      showStep(3);
    });
  }

  // "Back" button
  const backBtn2 = $('wizard-back-2');
  if (backBtn2) backBtn2.addEventListener('click', () => showStep(1));
}

// ── Step 3: Contact info + submit ─────────────────────────────

function attachStep3Events() {
  const form = $('wizard-form-3');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateStep3()) return;

    const fd       = new FormData(form);
    const submitBtn = $('wizard-submit-btn');

    // Gather Turnstile token
    const turnstileInput = form.querySelector('[name="cf-turnstile-response"]');
    const cfToken = turnstileInput?.value || '';

    const payload = {
      ...wizardData,
      first_name:         fd.get('first_name'),
      last_name:          fd.get('last_name'),
      phone:              fd.get('phone'),
      email:              fd.get('email'),
      preferred_contact:  fd.get('preferred_contact'),
      best_time:          fd.get('best_time') || null,
      tcpa_consent:       fd.get('tcpa_consent') === 'on',
      disclaimer_ack:     fd.get('disclaimer_ack') === 'on',
      geo_consent:        !!geoResult,
      _hp:                fd.get('_hp') || '',   // honeypot
      cf_turnstile_response: cfToken,
      source:             'web',
      utm:                getUtm(),
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    setErr('err-submit', '');

    try {
      const res = await fetch(EDGE_FN_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Submission failed.');
      }

      // Success
      showStep('confirm');
      const nameEl = $('confirm-name');
      if (nameEl) nameEl.textContent = escHtml(payload.first_name);
    } catch (err) {
      setErr('err-submit', err.message || 'Something went wrong. Please try again.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit →';
    }
  });

  const backBtn3 = $('wizard-back-3');
  if (backBtn3) backBtn3.addEventListener('click', () => showStep(2));
}

function validateStep3() {
  let ok = true;
  setErr('err-fname', '');
  setErr('err-lname', '');
  setErr('err-phone', '');
  setErr('err-email', '');
  setErr('err-tcpa', '');
  setErr('err-disclaimer', '');

  if (!$('first_name')?.value.trim()) {
    setErr('err-fname', 'First name is required.'); ok = false;
  }
  if (!$('last_name')?.value.trim()) {
    setErr('err-lname', 'Last name is required.'); ok = false;
  }

  const phone = $('phone')?.value.trim() ?? '';
  if (!phone || !isValidPhone(phone)) {
    setErr('err-phone', 'A valid US phone number is required.'); ok = false;
  }

  const email = $('email')?.value.trim() ?? '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setErr('err-email', 'A valid email address is required.'); ok = false;
  }

  if (!$('tcpa_consent')?.checked) {
    setErr('err-tcpa', 'You must consent to be contacted.'); ok = false;
  }
  if (!$('disclaimer_ack')?.checked) {
    setErr('err-disclaimer', 'You must acknowledge the disclaimer.'); ok = false;
  }

  return ok;
}

function isValidPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits[0] === '1');
}

// ── UTM capture ───────────────────────────────────────────────
function getUtm() {
  const p = new URLSearchParams(window.location.search);
  const utm = {};
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(k => {
    if (p.has(k)) utm[k] = p.get(k);
  });
  return Object.keys(utm).length ? utm : null;
}

// ── Handle success/cancel query params on page load ───────────
function checkQueryParams() {
  const p = new URLSearchParams(window.location.search);
  if (p.get('signup') === 'success') {
    const notice = $('attorney-signup-success');
    if (notice) { notice.hidden = false; notice.scrollIntoView({ behavior: 'smooth' }); }
  }
  if (p.get('signup') === 'cancel') {
    const notice = $('attorney-signup-cancel');
    if (notice) { notice.hidden = false; }
  }
}

// ── Map: sort participating attorneys by distance ─────────────
// Exported for unit testing. Sort is purely distance-based;
// no preference is given to any firm. See tests/find-attorney-map-sort.test.js.

/**
 * Haversine distance in kilometers between two lat/lng points.
 * @param {number} lat1 @param {number} lng1
 * @param {number} lat2 @param {number} lng2
 * @returns {number} distance in km
 */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) { return deg * Math.PI / 180; }

/**
 * Sort attorney records by distance from userLat/userLng.
 * If a record has no lat/lng, it sorts to the end.
 * Tie-breaking: stable insertion order (no secondary sort by firm name
 * or any other firm-identifying field).
 *
 * @param {Array<{office_lat: number|null, office_lng: number|null}>} attorneys
 * @param {number} userLat
 * @param {number} userLng
 * @returns {Array} sorted copy — does not mutate the input
 */
export function sortByDistance(attorneys, userLat, userLng) {
  return attorneys
    .map((a, i) => {
      const dist = (a.office_lat != null && a.office_lng != null)
        ? haversineKm(userLat, userLng, a.office_lat, a.office_lng)
        : Infinity;
      return { a, dist, i };
    })
    .sort((x, y) => {
      if (x.dist !== y.dist) return x.dist - y.dist;
      return x.i - y.i;  // stable: preserve original order on tie
    })
    .map(({ a }) => a);
}
