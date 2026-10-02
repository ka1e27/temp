// Zero-dependency static server for development.
// ES modules require a real HTTP origin (see the file:// guard in index.html).
//
//   node tools/serve.js                       # the repo at http://localhost:8080/
//   node tools/serve.js --base=/temp/         # the repo at http://localhost:8080/temp/, NOTHING at /
//   node tools/serve.js --root=_site --port=9000
//   node tools/serve.js --hooks               # test hooks for tools/check.mjs --base: ?__respond=503 answers with that status (an HTML error page), ?__portal=1 answers
//                                             # 200 text/html whatever was asked for (a captive portal), so the service worker's fallbacks can be exercised for real
//   env: PORT, BASE_PATH, ROOT_DIR (flags win)
//
// GitHub Pages serves this site from a project subpath (https://ka1e27.github.io/temp/), never from
// "/". `--base` reproduces that exactly: every request must carry the prefix, "/" is a 404, and
// "/temp" redirects to "/temp/" like Pages does. Anything that only works from "/" (an absolute
// path, a service worker scope, a manifest start_url) then fails here instead of in production.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.join('=') || 'true'];
}));

const REPO = fileURLToPath(new URL('..', import.meta.url));
const rootArg = flags.root || process.env.ROOT_DIR;
const ROOT = rootArg ? resolve(isAbsolute(rootArg) ? rootArg : join(process.cwd(), rootArg)) : REPO;
const PORT = Number(flags.port ?? process.env.PORT) || 8080;

/**
 * '/temp/' -> '/temp'; '' or '/' -> '' (served from the root). Git Bash on Windows rewrites an argument like
 * "/temp/" into "C:/Program Files/Git/temp/" before Node sees it: a drive-letter path means its last segment.
 */
function normaliseBase(raw) {
  let text = String(raw || '').trim().replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(text)) text = `/${text.split('/').filter(Boolean).pop() || ''}`;
  const trimmed = text.replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
const BASE = normaliseBase(flags.base ?? process.env.BASE_PATH);
const HOOKS = flags.hooks === 'true';

// `.js` MUST be text/javascript or the browser refuses to execute the module.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // A manifest served as application/octet-stream is a manifest the browser
  // ignores: no install prompt, no theme colour, no splash screen — and nothing
  // in the page reports it. tests/shell.test.js checks the file and its contents;
  // this line is what makes the file mean anything when served.
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let rel = decodeURIComponent(url.pathname);

  if (BASE) {
    if (rel === BASE) {
      // Pages redirects the bare project path to the trailing-slash form.
      res.writeHead(301, { Location: `${BASE}/${url.search}` }).end();
      return;
    }
    if (!rel.startsWith(`${BASE}/`)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`Not found (this server only serves ${BASE}/)`);
      return;
    }
    rel = rel.slice(BASE.length);
  }
  if (rel === '/') rel = '/index.html';

  if (HOOKS) {
    const forced = Number(url.searchParams.get('__respond'));
    if (forced >= 100 && forced < 600) {
      res.writeHead(forced, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(`<h1>${forced}</h1>`);
      return;
    }
    if (url.searchParams.has('__portal')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end('<html><body>Sign in to the Wi-Fi network</body></html>');
      return;
    }
  }

  // Contain path traversal: resolve, then verify the result is still under ROOT.
  const abs = join(ROOT, normalize(rel));
  if (!abs.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(abs);
    res.writeHead(200, {
      'Content-Type': MIME[extname(abs)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Hex Dominion → http://localhost:${PORT}${BASE ? `${BASE}/` : ''}`);
});
