/*
 * Comp Buddy email capture — site-wide.
 *
 * Three entry points, all routed through window.CompBuddyESP.subscribe so
 * the underlying ESP stays pluggable:
 *
 *   1. Footer form    — any <form data-capture="footer">
 *   2. Exit-intent    — auto-injected modal on mouseleave (top of viewport)
 *   3. Post-calculator — any <form data-capture="post-calculator"> rendered
 *                        after a calculator result; also exposed as
 *                        window.CompBuddyCapture.showPostCalculator(opts).
 *
 * All copy in this file is voiced as Comp Buddy (the mascot). No founder
 * name, no human signature, ever.
 *
 * Each capture tags the subscriber with its source so the welcome sequence
 * can be segmented downstream.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'cbd:exit-intent-shown';
  const EXIT_INTENT_COOLDOWN_DAYS = 14;

  function esp() {
    return (typeof window !== 'undefined' && window.CompBuddyESP) || null;
  }

  function setStatus(form, message, ok) {
    let el = form.querySelector('[data-capture-status]');
    if (!el) {
      el = document.createElement('p');
      el.setAttribute('data-capture-status', '');
      el.style.marginTop = '0.5rem';
      el.style.fontSize = '0.875rem';
      form.appendChild(el);
    }
    el.textContent = message;
    el.style.color = ok ? '#137752' : '#a4260f';
  }

  async function handleSubmit(e) {
    const form = e.currentTarget;
    e.preventDefault();
    const source = form.getAttribute('data-capture') || 'footer';
    const emailInput = form.querySelector('input[type="email"]');
    if (!emailInput) return;
    const email = emailInput.value;

    const tags = [];
    const extraTags = form.getAttribute('data-tags');
    if (extraTags) extraTags.split(',').forEach((t) => tags.push(t.trim()));

    const provider = esp();
    if (!provider) {
      setStatus(form, "Comp Buddy can't reach his mailbag right now. Try again in a sec!", false);
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    const result = await provider.subscribe({ email, source, tags });

    if (submitBtn) submitBtn.disabled = false;

    if (result.ok) {
      // Double opt-in: ESP sends a confirmation email. We don't claim the
      // user is subscribed yet — just that the confirm-it message is on its
      // way.
      setStatus(
        form,
        "Comp Buddy just sent you a confirmation email — tap the button inside and you're in!",
        true
      );
      form.reset();
    } else if (result.error === 'invalid_email') {
      setStatus(form, "Hmm, that email looks off to Comp Buddy. Mind double-checking?", false);
    } else {
      setStatus(form, "Comp Buddy tripped over a wire. Give it another try in a moment.", false);
    }
  }

  function wireForms(root) {
    const forms = (root || document).querySelectorAll('form[data-capture]');
    forms.forEach((form) => {
      if (form.dataset.cbdWired === '1') return;
      form.dataset.cbdWired = '1';
      form.addEventListener('submit', handleSubmit);
    });
  }

  // ---------- Exit-intent modal ----------

  function exitIntentRecentlyShown() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const ts = parseInt(raw, 10);
      if (!ts) return false;
      const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
      return ageDays < EXIT_INTENT_COOLDOWN_DAYS;
    } catch (e) {
      return false;
    }
  }

  function markExitIntentShown() {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch (e) {}
  }

  function buildExitIntentModal() {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-cbd-exit-modal', '');
    wrap.style.cssText =
      'position:fixed;inset:0;background:rgba(15,23,42,0.6);display:flex;' +
      'align-items:center;justify-content:center;z-index:9999;padding:1rem;';
    wrap.innerHTML = [
      '<div role="dialog" aria-modal="true" aria-labelledby="cbd-exit-title" ',
      'style="background:#fff;max-width:440px;width:100%;border-radius:14px;',
      'padding:1.5rem 1.5rem 1.25rem;box-shadow:0 25px 60px rgba(0,0,0,0.3);',
      'font-family:inherit;position:relative;">',
      '<button type="button" aria-label="Close" data-cbd-close ',
      'style="position:absolute;top:0.5rem;right:0.75rem;background:none;',
      'border:0;font-size:1.5rem;cursor:pointer;color:#475569;">&times;</button>',
      '<h2 id="cbd-exit-title" style="margin:0 0 0.5rem;font-size:1.25rem;">',
      'Hold up — Comp Buddy has something for you!</h2>',
      '<p style="margin:0 0 1rem;color:#334155;">',
      "Before you bounce, let Comp Buddy slide into your inbox with the stuff ",
      "injured workers actually need to know. No fluff, no lawyer-speak — just ",
      "Comp Buddy in your corner.</p>",
      '<form data-capture="exit-intent" novalidate>',
      '<label style="display:block;font-size:0.875rem;margin-bottom:0.25rem;">',
      'Your email</label>',
      '<input type="email" required placeholder="you@example.com" ',
      'style="width:100%;padding:0.6rem 0.75rem;border:1px solid #cbd5e1;',
      'border-radius:8px;font-size:1rem;" />',
      '<button type="submit" ',
      'style="margin-top:0.75rem;width:100%;padding:0.7rem;border:0;',
      'border-radius:8px;background:#0f766e;color:#fff;font-weight:600;',
      'cursor:pointer;">Send me Comp Buddy\'s notes</button>',
      '<p style="font-size:0.75rem;color:#64748b;margin:0.75rem 0 0;">',
      "Comp Buddy uses double opt-in. You'll get a confirmation email first. ",
      'Unsubscribe anytime — see our <a href="/privacy.html">privacy notice</a>.',
      '</p>',
      '</form>',
      '</div>',
    ].join('');

    function close() { wrap.remove(); }
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('[data-cbd-close]').addEventListener('click', close);
    return wrap;
  }

  function armExitIntent() {
    if (exitIntentRecentlyShown()) return;
    let fired = false;
    function onLeave(e) {
      if (fired) return;
      if (e.clientY > 0) return; // only top-of-viewport exits
      fired = true;
      markExitIntentShown();
      const modal = buildExitIntentModal();
      document.body.appendChild(modal);
      wireForms(modal);
      document.removeEventListener('mouseleave', onLeave);
    }
    document.addEventListener('mouseleave', onLeave);
  }

  // ---------- Post-calculator inline capture ----------

  function showPostCalculator(opts) {
    opts = opts || {};
    const mount = opts.mount ||
      document.querySelector('[data-capture-mount="post-calculator"]');
    if (!mount) return null;
    if (mount.querySelector('form[data-capture="post-calculator"]')) return null;

    const calcName = opts.calculator || mount.getAttribute('data-calculator') || '';
    const card = document.createElement('div');
    card.style.cssText =
      'border:1px solid #cbd5e1;border-radius:12px;padding:1rem 1.25rem;' +
      'background:#f8fafc;margin-top:1.5rem;';
    card.innerHTML = [
      '<h3 style="margin:0 0 0.25rem;font-size:1.1rem;">',
      'Comp Buddy can keep an eye on this for you</h3>',
      '<p style="margin:0 0 0.75rem;color:#334155;font-size:0.95rem;">',
      "Drop your email and Comp Buddy will send the plain-English breakdown of ",
      "what your numbers actually mean — plus what to watch out for next.</p>",
      '<form data-capture="post-calculator"',
      calcName ? ' data-tags="calc:' + calcName + '"' : '',
      ' novalidate style="display:flex;gap:0.5rem;flex-wrap:wrap;">',
      '<input type="email" required placeholder="you@example.com" ',
      'style="flex:1 1 200px;padding:0.55rem 0.75rem;border:1px solid #cbd5e1;',
      'border-radius:8px;font-size:1rem;" />',
      '<button type="submit" ',
      'style="padding:0.55rem 1rem;border:0;border-radius:8px;background:#0f766e;',
      'color:#fff;font-weight:600;cursor:pointer;">Send it over</button>',
      '<p style="flex-basis:100%;font-size:0.75rem;color:#64748b;margin:0.5rem 0 0;">',
      'Double opt-in. Unsubscribe anytime. ',
      '<a href="/privacy.html">Privacy</a>.</p>',
      '</form>',
    ].join('');
    mount.appendChild(card);
    wireForms(card);
    return card;
  }

  // ---------- Footer auto-inject (optional) ----------
  // If a page has <div data-capture-mount="footer"></div> we drop in a form.
  function injectFooterForm() {
    const mounts = document.querySelectorAll('[data-capture-mount="footer"]');
    mounts.forEach((mount) => {
      if (mount.querySelector('form[data-capture="footer"]')) return;
      const card = document.createElement('div');
      card.innerHTML = [
        '<form data-capture="footer" novalidate ',
        'style="display:flex;gap:0.5rem;flex-wrap:wrap;max-width:480px;">',
        '<label for="cbd-footer-email" style="flex-basis:100%;font-size:0.875rem;',
        'margin-bottom:0.25rem;">Get Comp Buddy in your inbox</label>',
        '<input id="cbd-footer-email" type="email" required ',
        'placeholder="you@example.com" ',
        'style="flex:1 1 200px;padding:0.55rem 0.75rem;border:1px solid #cbd5e1;',
        'border-radius:8px;font-size:1rem;" />',
        '<button type="submit" ',
        'style="padding:0.55rem 1rem;border:0;border-radius:8px;background:#0f766e;',
        'color:#fff;font-weight:600;cursor:pointer;">Subscribe</button>',
        '<p style="flex-basis:100%;font-size:0.75rem;color:#64748b;margin:0.5rem 0 0;">',
        'Double opt-in. Unsubscribe anytime. ',
        '<a href="/privacy.html">Privacy</a>.</p>',
        '</form>',
      ].join('');
      mount.appendChild(card);
    });
  }

  function init() {
    injectFooterForm();
    wireForms(document);
    armExitIntent();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  if (typeof window !== 'undefined') {
    window.CompBuddyCapture = {
      wireForms,
      showPostCalculator,
      _internal: { buildExitIntentModal, armExitIntent },
    };
  }
})();
