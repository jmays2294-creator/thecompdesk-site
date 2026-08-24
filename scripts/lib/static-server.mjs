/**
 * static-server.mjs — zero-dependency local server that mimics Vercel's
 * cleanUrls resolution, so a harness testing "/calculators/slu" hits the same
 * file the deployed site would serve.
 *
 * Extracted from scripts/a11y-audit.mjs, which grew the first copy. That file
 * is deliberately left alone — it is a gate people already trust, and the win
 * from de-duplicating it is smaller than the risk of touching it. New harnesses
 * import this.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp4': 'video/mp4', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

export function makeResolver(root) {
  return function resolveFile(urlPath) {
    const clean = decodeURIComponent(String(urlPath).split('?')[0].split('#')[0]);
    const candidates = clean.endsWith('/')
      ? [path.join(clean, 'index.html')]
      : [clean, clean + '.html', path.join(clean, 'index.html')];
    for (const c of candidates) {
      const abs = path.join(root, c);
      if (abs.startsWith(root) && fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
    }
    return null;
  };
}

/**
 * @param {string} root  repo root to serve
 * @returns {Promise<{server: http.Server, port: number, origin: string, close: () => Promise<void>}>}
 */
export function startServer(root) {
  const resolveFile = makeResolver(root);
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = resolveFile(req.url === '/' ? '/index.html' : req.url);
      if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
