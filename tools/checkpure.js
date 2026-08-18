// Enforce the directory-level purity rule.
//
// src/core, src/battle, src/meta, src/content must never touch the DOM, the
// clock, or unseeded randomness. That is what lets the whole simulation run
// headless under `node --test` with zero mocking, and what keeps battles
// deterministic — which is in turn what makes the combat preview exact.
//
// AND THE RULE FOLLOWS THE IMPORT GRAPH, NOT THE DIRECTORY LIST. Auto-resolve
// put `tools/` code into a shipping browser bundle: `src/meta/autobattle.js`
// imports `tools/autoresolve.js` ON PURPOSE — it is the harness bot's own
// policy driving a real raid, which is the whole reason an auto-resolved raid's
// win rate IS the campaign's measured number rather than a second figure that
// could drift — and that import drags `simplayer`, `simtactics`, `simbuild` and
// `simshop` in behind it. Five files reaching `Date.now` or `Math.random`
// without anything stopping them, in the one feature whose test pins
// byte-identical determinism. A directory list cannot see that; the closure
// can, and it costs nothing to maintain, because a new import is covered the
// moment somebody writes it.
//
// It is deliberately the CLOSURE and not "also scan tools/": `tools/serve.js`
// and `tools/cdp.js` are Node scripts that must use the clock and the network,
// and banning them from doing so would be enforcing a rule that does not exist.
import { readdir, readFile } from 'node:fs/promises';
import { join, extname, dirname, resolve } from 'node:path';
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

/**
 * Every file the pure directories can reach, following relative imports out of
 * them. Returns the ones that are NOT themselves in a pure directory — today
 * that is the `tools/` chain behind auto-resolve, and tomorrow it is whatever
 * else somebody wires in.
 */
async function reachedFromPure(seeds) {
  const seen = new Set(seeds);
  const out = [];
  const queue = [...seeds];
  while (queue.length) {
    const file = queue.pop();
    let src;
    try { src = await readFile(file, 'utf8'); } catch { continue; }
    // Static `import`/`export ... from` only. A dynamic import cannot be
    // resolved without running the code, and there are none in this tree —
    // if one appears, it will simply go unchecked rather than crash here.
    for (const m of src.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), m[1]);
      if (seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
      const rel = target.slice(ROOT.length).replace(/\\/g, '/');
      if (!PURE.some((d) => rel.startsWith(`${d}/`))) out.push(target);
    }
  }
  return out;
}

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
const pureFiles = [];
for (const d of PURE) pureFiles.push(...await walk(join(ROOT, d)));
// The pure directories themselves, plus everything outside them that they can
// reach — see the header. Both are held to exactly the same list.
const checked = [...pureFiles, ...await reachedFromPure(pureFiles)];
{
  for (const file of checked) {
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
