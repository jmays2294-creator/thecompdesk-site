// HaveIBeenPwned k-anonymity password check.
// The password never leaves the browser — we send only the first 5 chars of its
// SHA-1 hash to api.pwnedpasswords.com/range/{prefix}, then check the response
// for our suffix locally.
//
// Exposed as window.tcdHibpCheck so both classic <script> and ESM callers can use it.
//
// Returns: { pwned: true, count } | { pwned: false } | { pwned: false, error: '...' }
//
// Fail-open policy: network errors return { pwned: false, error }. Callers should
// treat this as "couldn't verify, allow signup" — better UX than blocking everyone
// during an HIBP outage.

(function () {
  async function sha1Hex(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-1', buf);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }

  async function tcdHibpCheck(password) {
    if (!password) return { pwned: false };
    try {
      const hash = await sha1Hex(password);
      const prefix = hash.slice(0, 5);
      const suffix = hash.slice(5);
      const resp = await fetch('https://api.pwnedpasswords.com/range/' + prefix, {
        headers: { 'Add-Padding': 'true' },
      });
      if (!resp.ok) return { pwned: false, error: 'http_' + resp.status };
      const text = await resp.text();
      for (const line of text.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx <= 0) continue;
        const lineSuffix = line.slice(0, colonIdx).trim().toUpperCase();
        if (lineSuffix === suffix) {
          const count = parseInt(line.slice(colonIdx + 1), 10) || 0;
          return { pwned: true, count };
        }
      }
      return { pwned: false };
    } catch (e) {
      return { pwned: false, error: (e && e.message) || 'unknown' };
    }
  }

  window.tcdHibpCheck = tcdHibpCheck;
})();
