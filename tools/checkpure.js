// Enforce the directory-level purity rule.
//
// src/core, src/battle, src/meta, src/content must never touch the DOM, the
// clock, or unseeded randomness. That is what lets the whole simulation run
// headless under `node --test` with zero mocking, and what keeps battles
// deterministic — which is in turn what makes the combat preview exact.
import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PURE = ['src/core', 'src/battle', 'src/meta', 'src/content'];

const BANNED = [
  [/\bdocument\b/, 'document'],
  [/\bwindow\b/, 'window'],
  [/\blocalStorage\b/, 'localStorage'],
  [/\bsessionStorage\b/, 'sessionStorage'],
  [/\bMath\.random\b/, 'Math.random (use core/rng.js)'],
  [/\bDate\.now\b/, 'Date.now (inject the clock)'],
  [/\bperformance\./, 'performance.* (inject the clock)'],
  [/\bfetch\s*\(/, 'fetch'],
  [/\brequestAnimationFrame\b/, 'requestAnimationFrame'],
  [/\bgetComputedStyle\b/, 'getComputedStyle'],
];

// save.js is allowed to DEFINE a storage adapter; it must still be injected at
// the call site, so we only permit the identifier inside an adapter factory.
const EXEMPT = new Set(['src/meta/save.js']);

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (extname(e.name) === '.js') out.push(p);
  }
  return out;
}

const violations = [];
for (const d of PURE) {
  for (const file of await walk(join(ROOT, d))) {
    const rel = file.slice(ROOT.length).replace(/\\/g, '/');
    const src = await readFile(file, 'utf8');
    src.split('\n').forEach((line, i) => {
      // Skip comments — banned words are fine in prose explaining the rule.
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      if (!code.trim()) return;
      for (const [re, label] of BANNED) {
        if (re.test(code)) {
          if (EXEMPT.has(rel) && /localStorage/.test(label)) continue;
          violations.push(`  ${rel}:${i + 1}  ${label}\n      ${line.trim().slice(0, 90)}`);
        }
      }
    });
  }
}

if (violations.length) {
  console.error('Purity violations (these directories must run headless):\n');
  console.error(violations.join('\n'));
  console.error('\nInject the dependency instead of reaching for a global.');
  process.exit(1);
}
console.log('checkpure: ok');
