// Fail the build if any source file exceeds the line budget.
// A hard gate beats a guideline when several agents author in parallel.
import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LIMIT = 400;
const DIRS = ['src', 'tools', 'tests'];
const EXTS = new Set(['.js', '.css']);

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
    else if (EXTS.has(extname(e.name))) out.push(p);
  }
  return out;
}

const offenders = [];
for (const d of DIRS) {
  for (const file of await walk(join(ROOT, d))) {
    const lines = (await readFile(file, 'utf8')).split('\n').length;
    if (lines > LIMIT) offenders.push([file.slice(ROOT.length), lines]);
  }
}

if (offenders.length) {
  console.error(`Files over ${LIMIT} lines:\n`);
  for (const [f, n] of offenders.sort((a, b) => b[1] - a[1])) {
    console.error(`  ${n.toString().padStart(5)}  ${f}`);
  }
  console.error('\nSplit them. Long files are where merge conflicts live.');
  process.exit(1);
}
console.log('checksize: ok');
