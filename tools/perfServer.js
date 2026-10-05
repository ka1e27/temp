// A GitHub-Pages-shaped server for tools/perf.mjs: the repo under /temp/, gzip on text files, and (by default) HTTP/2 over TLS like
// Pages' CDN. The protocol matters for a throttled first load: HTTP/1.1 holds Chrome to 6 connections per host, so ~250 modules at a
// 165 ms round trip queue for seconds that a real visitor (HTTP/2, one multiplexed connection) never waits. A self-signed certificate
// is made once with openssl (Git for Windows and every Linux CI ship it) and Chrome is launched with --ignore-certificate-errors.
// No openssl: it falls back to HTTP/1.1 and says so. Zero dependencies.
import http from 'node:http';
import http2 from 'node:http2';
import { gzipSync } from 'node:zlib';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg']);

async function certificate() {
  const dir = join(tmpdir(), 'hd-perf-tls');
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  if (!existsSync(key) || !existsSync(cert)) {
    await mkdir(dir, { recursive: true });
    const candidates = ['openssl', 'C:/Program Files/Git/usr/bin/openssl.exe', 'C:/Program Files/Git/mingw64/bin/openssl.exe'];
    let made = false;
    for (const bin of candidates) {
      try {
        execFileSync(bin, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '3650',
          '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
        made = true;
        break;
      } catch { /* try the next one */ }
    }
    if (!made) return null;
  }
  return { key: await readFile(key), cert: await readFile(cert) };
}

/**
 * Starts the server. Resolves to { origin, base, proto, close, stats } where `base` is `${origin}/temp`.
 * @param {{ port?: number, proto?: 'h2'|'h1', subpath?: string }} [opts]
 */
export async function startPerfServer({ port = 0, proto = 'h2', subpath = '/temp', root = REPO } = {}) {
  const ROOT = resolve(root);
  const cache = new Map(); // path -> { body, gz, type }
  const stats = { requests: 0, bytes: 0 };
  async function load(file) {
    if (cache.has(file)) return cache.get(file);
    const body = await readFile(file);
    const ext = extname(file).toLowerCase();
    const entry = { body, gz: COMPRESS.has(ext) ? gzipSync(body, { level: 6 }) : null, type: MIME[ext] || 'application/octet-stream' };
    cache.set(file, entry);
    return entry;
  }
  async function handle(req, res) {
    const url = new URL(req.url, 'https://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel === subpath) { res.writeHead(301, { Location: `${subpath}/${url.search}` }); res.end(); return; }
    if (!rel.startsWith(`${subpath}/`)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    rel = rel.slice(subpath.length);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT + sep)) { res.writeHead(403); res.end(); return; }
    try {
      const e = await load(file);
      const gzip = e.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      const body = gzip ? e.gz : e.body;
      stats.requests += 1;
      stats.bytes += body.length;
      res.writeHead(200, {
        'Content-Type': e.type, 'Content-Length': body.length, 'Cache-Control': 'max-age=600', // what Pages sends
        ...(gzip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  }
  let server;
  let used = proto;
  const tls = proto === 'h2' ? await certificate() : null;
  if (proto === 'h2' && tls) server = http2.createSecureServer({ ...tls, allowHTTP1: true }, (q, s) => { handle(q, s).catch(() => {}); });
  else { used = 'h1'; server = http.createServer((q, s) => { handle(q, s).catch(() => {}); }); }
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const origin = `${used === 'h2' ? 'https' : 'http'}://localhost:${server.address().port}`;
  return {
    origin, base: `${origin}${subpath}`, proto: used, stats,
    close: () => new Promise((r) => { server.close(() => r()); if (server.closeAllConnections) server.closeAllConnections(); setTimeout(r, 500); }),
  };
}
