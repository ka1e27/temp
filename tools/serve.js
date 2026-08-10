// Zero-dependency static server for development.
// ES modules require a real HTTP origin (see the file:// guard in index.html).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 8080;

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
  if (rel === '/') rel = '/index.html';

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
  console.log(`Hex Dominion → http://localhost:${PORT}`);
});
