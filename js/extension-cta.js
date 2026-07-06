/* The Comp Desk — Chrome Web Store install CTA.
 *
 * SINGLE SOURCE OF TRUTH for the extension's store URL. If the listing ever
 * moves, change STORE_URL here and every "Add to Chrome" button across the
 * site updates. Live listing:
 *   https://chromewebstore.google.com/detail/aachpchfcnbdbhljjinafackkdpjmobo
 *
 * Buttons opt in with the [data-ext-install] attribute. They ship a working
 * fallback href in the HTML (so they work + crawl with JS off); this script
 * upgrades them to the canonical store URL with install attribution and opens
 * them in a new tab. The desktop-Chrome-only caveat is shown as static copy
 * next to each button, so nothing here has to branch on the user agent.
 */
(function () {
  var STORE_URL   = 'https://chromewebstore.google.com/detail/aachpchfcnbdbhljjinafackkdpjmobo';
  var INSTALL_URL = STORE_URL + '?utm_source=thecompdesk&utm_medium=web';

  document.querySelectorAll('a[data-ext-install]').forEach(function (a) {
    a.href = INSTALL_URL;
    a.target = '_blank';
    a.rel = 'noopener';
  });
})();
