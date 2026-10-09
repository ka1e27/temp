// The War Council's "current → next" line shows only what changes (council.js effectDiff).
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectDiff } from '../ui/council.js';

test('effectDiff writes the shared words once', () => {
  assert.deepEqual(effectDiff('+0% troop growth', '+3% troop growth'), { head: '', cur: '+0%', next: '+3%', tail: 'troop growth' });
  assert.deepEqual(effectDiff('+0 War Camp troops', '+2 War Camp troops'), { head: '', cur: '+0', next: '+2', tail: 'War Camp troops' });
  assert.deepEqual(effectDiff('Send 50% from every settlement · 30s cooldown', 'Send 50% from every settlement · 28.5s cooldown'),
    { head: 'Send 50% from every settlement ·', cur: '30s', next: '28.5s', tail: 'cooldown' });
});

test('effectDiff keeps a word on each side and handles a locked power', () => {
  assert.deepEqual(effectDiff('—', '−10 troops in blast · 25s cooldown'), { head: '', cur: '—', next: '−10 troops in blast · 25s cooldown', tail: '' });
  const same = effectDiff('+5% attack', '+5% attack');
  assert.ok(same.cur && same.next, 'identical values still show a value on each side');
  const d = effectDiff('Defence ×2.5 for 8s · 30s cooldown', 'Defence ×2.8 for 9s · 28s cooldown');
  assert.equal(`${d.head} ${d.cur} → ${d.next} ${d.tail}`.trim(), 'Defence ×2.5 for 8s · 30s → ×2.8 for 9s · 28s cooldown');
});
