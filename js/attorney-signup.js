/**
 * attorney-signup.js
 *
 * Attorney signup flow (Flow B) for find-attorney.html.
 * Multi-step: account creation → firm intake → Stripe checkout redirect.
 *
 * Steps:
 *   1. Account creation (Supabase auth: email + password, or magic link)
 *   2. Firm intake form (firm name, bar #, address, phone, bio, etc.)
 *   3. Stripe subscription checkout (redirect to Stripe Checkout)
 *   4. Confirmation screen (shown after ?signup=success return)
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ── Config ─────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://ltibymvlytodkemdeeox.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0aWJ5bXZseXRvZGtlbWRlZW94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjA1NjYsImV4cCI6MjA5MDM5NjU2Nn0.b5oQqQIdgJRc0DEP2k7kMVdCRzfyfnuAwjVNZlbVyak';
const CHECKOUT_FN   = `${SUPABASE_URL}/functions/v1/create-attorney-checkout`;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── DOM helpers ────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function show(id) { const el = $(id); if (el) el.hidden = false; }
function hide(id) { const el = $(id); if (el) el.hidden = true; }
function setErr(id, msg) {
  const el = $(id);
  if (el) { el.textContent = msg || ''; el.hidden = !msg; }
}

// ── Entry point ────────────────────────────────────────────────
export function initAttorneySignup() {
  attachJoinBtnEvent();
  attachStep1Events();
  attachStep2Events();
  handleSignupReturn();
  checkExistingSession();
}

// ── "Join Our Network" button ─────────────────────────────────
function attachJoinBtnEvent() {
  const btn = $('btn-attorney-join');
  if (!btn) return;
  btn.addEventListener('click', e => {
    e.preventDefault();
    showSignupStep(1);
    const sect = $('attorney-signup-section');
    if (sect) sect.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

let signupStep = 0;

function showSignupStep(n) {
  signupStep = n;
  [1, 2, 3, 4].forEach(s => {
    const el = $(`attorney-step-${s}`);
    if (el) el.hidden = (s !== n);
  });
  show('attorney-signup-section');
  for (let i = 1; i <= 3; i++) {
    const dot = $(`atty-dot-${i}`);
    if (!dot) continue;
    dot.className = i < n ? 'dot done' : i === n ? 'dot active' : 'dot';
  }
}

// ── Step 1: Account creation ───────────────────────────────────
function attachStep1Events() {
  const emailPasswordForm = $('atty-auth-form');
  const magicLinkBtn      = $('btn-magic-link');

  if (emailPasswordForm) {
    emailPasswordForm.addEventListener('submit', async e => {
      e.preventDefault();
      setErr('err-atty-auth', '');
      const email    = $('atty-email')?.value.trim();
      const password = $('atty-password')?.value;
      const mode     = $('atty-auth-mode')?.value || 'signup';

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setErr('err-atty-auth', 'Valid email required.'); return;
      }
      if (!password || password.length < 8) {
        setErr('err-atty-auth', 'Password must be at least 8 characters.'); return;
      }

      const submitBtn = emailPasswordForm.querySelector('button[type=submit]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Please wait…'; }

      let error;
      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        error = signUpError;
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        error = signInError;
      }

      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = mode === 'signup' ? 'Create Account →' : 'Sign In →'; }

      if (error) {
        setErr('err-atty-auth', error.message); return;
      }

      // Check if they already have an account row → skip to step 3
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: acct } = await supabase
          .from('attorney_accounts')
          .select('id, status')
          .eq('user_id', session.user.id)
          .single();

        if (acct) {
          if (acct.status === 'active') {
            showSignupStep(4); // Already subscribed
          } else {
            showSignupStep(3); // Has account, needs to pay
          }
          return;
        }
      }

      showSignupStep(2);
    });
  }

  // Toggle sign-in / sign-up mode
  const toggleMode = $('toggle-auth-mode');
  if (toggleMode) {
    toggleMode.addEventListener('click', e => {
      e.preventDefault();
      const modeInput = $('atty-auth-mode');
      const isSignup  = modeInput?.value === 'signup';
      if (modeInput) modeInput.value = isSignup ? 'signin' : 'signup';
      const submitBtn = $('atty-auth-submit-btn');
      if (submitBtn) submitBtn.textContent = isSignup ? 'Sign In →' : 'Create Account →';
      toggleMode.textContent = isSignup
        ? "Don't have an account? Sign up"
        : 'Already have an account? Sign in';
      const pwWrap = $('atty-password-wrap');
      if (pwWrap) pwWrap.hidden = isSignup;
    });
  }

  if (magicLinkBtn) {
    magicLinkBtn.addEventListener('click', async () => {
      setErr('err-atty-auth', '');
      const email = $('atty-email')?.value.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setErr('err-atty-auth', 'Enter your email address first.'); return;
      }
      magicLinkBtn.disabled = true;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.href + '#attorney-signup-section' },
      });
      magicLinkBtn.disabled = false;
      if (error) {
        setErr('err-atty-auth', error.message);
      } else {
        setErr('err-atty-auth', '');
        const sent = $('magic-link-sent');
        if (sent) { sent.hidden = false; }
      }
    });
  }
}

// ── Step 2: Firm intake form ───────────────────────────────────
function attachStep2Events() {
  const form = $('atty-firm-form');
  if (!form) return;

  // Headshot preview
  const headshotInput = $('headshot_file');
  const headshotPreview = $('headshot-preview');
  if (headshotInput && headshotPreview) {
    headshotInput.addEventListener('change', () => {
      const file = headshotInput.files[0];
      if (file) {
        headshotPreview.src = URL.createObjectURL(file);
        headshotPreview.hidden = false;
      }
    });
  }

  // Bio character count
  const bio      = $('atty_bio');
  const bioCount = $('bio-count');
  if (bio && bioCount) {
    bio.addEventListener('input', () => {
      bioCount.textContent = `${bio.value.length}/500`;
    });
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateFirmForm()) return;

    const submitBtn = form.querySelector('button[type=submit]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }
    setErr('err-firm-form', '');

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setErr('err-firm-form', 'Session expired. Please sign in again.');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save & Continue →'; }
      showSignupStep(1);
      return;
    }

    const fd = new FormData(form);

    // Handle headshot upload (optional)
    let headshotUrl = null;
    const file = fd.get('headshot_file');
    if (file && file.size > 0) {
      const ext  = file.name.split('.').pop().toLowerCase();
      const path = `headshots/${session.user.id}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('attorney-assets')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (!uploadErr) {
        const { data: { publicUrl } } = supabase.storage
          .from('attorney-assets')
          .getPublicUrl(path);
        headshotUrl = publicUrl;
      }
    }

    // Practice areas (checkboxes)
    const practiceAreas = Array.from(
      form.querySelectorAll('[name="practice_areas"]:checked')
    ).map(el => el.value);

    // Languages (checkboxes)
    const languages = Array.from(
      form.querySelectorAll('[name="languages"]:checked')
    ).map(el => el.value);

    const accountData = {
      user_id:        session.user.id,
      firm_name:      fd.get('firm_name')?.trim(),
      attorney_name:  fd.get('attorney_name')?.trim(),
      bar_number:     fd.get('bar_number')?.trim() || null,
      office_address: fd.get('office_address')?.trim(),
      phone_e164:     normalizePhone(fd.get('phone')?.trim()),
      public_email:   fd.get('public_email')?.trim(),
      website:        sanitizeUrl(fd.get('website')?.trim()),
      practice_areas: practiceAreas,
      languages,
      headshot_url:   headshotUrl,
      bio:            fd.get('atty_bio')?.trim() || null,
      status:         'pending',
    };

    const { error: upsertErr } = await supabase
      .from('attorney_accounts')
      .upsert(accountData, { onConflict: 'user_id' });

    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save & Continue →'; }

    if (upsertErr) {
      setErr('err-firm-form', upsertErr.message); return;
    }

    showSignupStep(3);
  });

  const backBtn = $('atty-back-2');
  if (backBtn) backBtn.addEventListener('click', () => showSignupStep(1));
}

function validateFirmForm() {
  let ok = true;
  setErr('err-firm-name', '');
  setErr('err-atty-name', '');
  setErr('err-address', '');
  setErr('err-atty-phone', '');
  setErr('err-public-email', '');
  setErr('err-bio', '');

  if (!$('firm_name')?.value.trim()) {
    setErr('err-firm-name', 'Firm name is required.'); ok = false;
  }
  if (!$('attorney_name')?.value.trim()) {
    setErr('err-atty-name', 'Attorney name is required.'); ok = false;
  }
  if (!$('office_address')?.value.trim()) {
    setErr('err-address', 'Office address is required.'); ok = false;
  }
  const phone = $('atty_phone')?.value.trim() ?? '';
  if (!phone || !isValidPhone(phone)) {
    setErr('err-atty-phone', 'Valid US phone number required.'); ok = false;
  }
  const email = $('public_email')?.value.trim() ?? '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setErr('err-public-email', 'Valid email required.'); ok = false;
  }
  const bio = $('atty_bio')?.value.trim() ?? '';
  if (bio.length > 500) {
    setErr('err-bio', 'Bio must be 500 characters or fewer.'); ok = false;
  }

  return ok;
}

// ── Step 3: Stripe checkout ────────────────────────────────────
// (Shown automatically via showSignupStep(3). Checkout button calls the edge fn.)
// The HTML contains a "Subscribe for $5.99/month →" button wired here:

export async function startStripeCheckout() {
  const btn = $('btn-stripe-checkout');
  if (btn) { btn.disabled = true; btn.textContent = 'Redirecting to payment…'; }
  setErr('err-stripe', '');

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not signed in. Please sign in and try again.');

    const res = await fetch(CHECKOUT_FN, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({}),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Checkout session creation failed.');
    if (!data.url) throw new Error('No checkout URL returned.');

    window.location.href = data.url;
  } catch (err) {
    setErr('err-stripe', err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Subscribe for $5.99/month →'; }
  }
}

// ── Handle return from Stripe Checkout ────────────────────────
function handleSignupReturn() {
  const p = new URLSearchParams(window.location.search);
  if (p.get('signup') === 'success') {
    showSignupStep(4);
    const sect = $('attorney-signup-section');
    if (sect) sect.scrollIntoView({ behavior: 'smooth' });
  }
}

// ── Check existing auth session on load ───────────────────────
async function checkExistingSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const { data: acct } = await supabase
    .from('attorney_accounts')
    .select('id, status')
    .eq('user_id', session.user.id)
    .single();

  if (!acct) return; // No account row yet — normal for new users

  // If they navigated back to the page while signed in + have pending status:
  // nothing to auto-show. If they have an active subscription, show confirmation.
  if (acct.status === 'active') {
    const badge = $('atty-active-badge');
    if (badge) badge.hidden = false;
  }
}

// ── Helpers ───────────────────────────────────────────────────
function isValidPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits[0] === '1');
}

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return raw;
}

function sanitizeUrl(url) {
  if (!url) return null;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'https://' + url;
  }
  return url;
}
