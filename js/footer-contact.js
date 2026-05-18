/**
 * footer-contact.js — Universal contact block + UPL disclaimer
 *
 * Self-bootstrapping. On load, injects a standardized Contact block
 * (phone, text-friendly note, email) and the UPL disclaimer into the
 * page footer. If the page has an existing <footer>, the block is
 * prepended into it (above any existing copyright lines). If not, a
 * new <footer> is appended at the end of <body>.
 *
 * Suppression: set `<body data-no-contact-footer="true">` on any page
 * that shouldn't get the injection (e.g., legal/terms full-screen
 * docs, auth modals).
 *
 * Phone: (786) 815-4612 · Email: contact@thecompdesk.com
 */
(function injectContactFooter() {
  const PHONE_DISPLAY = '(786) 815-4612';
  const PHONE_TEL = '+17868154612';
  const EMAIL = 'contact@thecompdesk.com';
  const FRAMING = 'Questions? Call, text, or email us.';
  const UPL = 'The Comp Desk is a software platform, not a law firm. Contacting us does not create an attorney-client relationship with any attorney.';

  function buildBlock() {
    const wrap = document.createElement('div');
    wrap.className = 'tcd-contact-block';
    wrap.setAttribute('data-tcd', 'contact-footer');
    wrap.innerHTML = `
      <style>
        .tcd-contact-block {
          padding: 28px 20px 20px;
          margin: 0 auto;
          max-width: 1100px;
          color: rgba(220, 220, 220, 0.9);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          font-size: 13px;
          line-height: 1.55;
          text-align: center;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }
        .tcd-contact-block .tcd-contact-title {
          font-size: 15px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.95);
          margin: 0 0 6px;
          letter-spacing: 0.2px;
        }
        .tcd-contact-block .tcd-contact-methods {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 18px;
          justify-content: center;
          margin: 6px 0 10px;
        }
        .tcd-contact-block a.tcd-contact-link {
          color: #4f8ff7;
          text-decoration: none;
          font-weight: 600;
          white-space: nowrap;
        }
        .tcd-contact-block a.tcd-contact-link:hover {
          text-decoration: underline;
        }
        .tcd-contact-block .tcd-contact-note {
          color: rgba(200, 200, 200, 0.75);
          font-size: 12px;
        }
        .tcd-contact-block .tcd-upl {
          margin: 10px auto 0;
          max-width: 760px;
          font-size: 11.5px;
          color: rgba(180, 180, 180, 0.85);
          font-style: italic;
          line-height: 1.5;
        }
      </style>
      <p class="tcd-contact-title">${FRAMING}</p>
      <p class="tcd-contact-methods">
        <a class="tcd-contact-link" href="tel:${PHONE_TEL}" aria-label="Call or text The Comp Desk">${PHONE_DISPLAY}</a>
        <span class="tcd-contact-note">(call or text)</span>
        <a class="tcd-contact-link" href="mailto:${EMAIL}" aria-label="Email The Comp Desk">${EMAIL}</a>
      </p>
      <p class="tcd-upl">${UPL}</p>
    `;
    return wrap;
  }

  function inject() {
    if (document.body && document.body.getAttribute('data-no-contact-footer') === 'true') return;
    if (document.querySelector('[data-tcd="contact-footer"]')) return; // idempotent

    const existing = document.querySelector('footer');
    const block = buildBlock();

    if (existing) {
      // Prepend so the contact info sits above any existing copyright/legal lines
      if (existing.firstChild) {
        existing.insertBefore(block, existing.firstChild);
      } else {
        existing.appendChild(block);
      }
    } else {
      const footer = document.createElement('footer');
      footer.appendChild(block);
      document.body.appendChild(footer);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
