import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNum, formatRate, formatDuration, formatPct } from '../core/format.js';

test('formatNum: sub-1000 integers show no decimal', () => {
  assert.equal(formatNum(0), '0');
  assert.equal(formatNum(42), '42');
  assert.equal(formatNum(950), '950');
  assert.equal(formatNum(999), '999');
  assert.equal(formatNum(10), '10');
});

test('formatNum: sub-10 non-integers show exactly one decimal', () => {
  assert.equal(formatNum(4.5), '4.5');
  assert.equal(formatNum(0.4), '0.4');
  assert.equal(formatNum(9.94), '9.9');
});

test('formatNum: rounding that crosses a display boundary re-formats correctly', () => {
  assert.equal(formatNum(9.99), '10');   // would naively be "10.0"
  assert.equal(formatNum(9.96), '10');
  assert.equal(formatNum(999.96), '1.00K'); // crosses the K boundary
  assert.equal(formatNum(99999), '100K');   // crosses the 2-decimal -> 0-decimal boundary
});

test('formatNum: K/M/B/T keep exactly 3 significant digits', () => {
  assert.equal(formatNum(1000), '1.00K');
  assert.equal(formatNum(1234), '1.23K');
  assert.equal(formatNum(12345), '12.3K');
  assert.equal(formatNum(123456), '123K');
  assert.equal(formatNum(1_000_000), '1.00M');
  assert.equal(formatNum(1_234_000), '1.23M');
  assert.equal(formatNum(3_400_000_000), '3.40B');
  assert.equal(formatNum(1e12), '1.00T');
});

test('formatNum: letter-pair suffixes past T', () => {
  assert.equal(formatNum(1e15), '1.00aa');
  assert.equal(formatNum(1.5e15), '1.50aa');
  assert.equal(formatNum(1e18), '1.00ab');
  assert.equal(formatNum(1e15 * 1000 ** 26), '1.00ba');
});

test('formatNum: negative numbers mirror their positive form with a leading -', () => {
  assert.equal(formatNum(-1234), '-1.23K');
  assert.equal(formatNum(-42), '-42');
  assert.equal(formatNum(-4.5), '-4.5');
});

test('formatRate: signed, delegates magnitude formatting to formatNum', () => {
  assert.equal(formatRate(1.2), '+1.2/s');
  assert.equal(formatRate(-3), '-3/s');
  assert.equal(formatRate(0), '+0/s');
  assert.equal(formatRate(12345), '+12.3K/s');
});

test('formatDuration: matches every worked example from the contract', () => {
  assert.equal(formatDuration(12), '12s');
  assert.equal(formatDuration(245), '4m 05s');
  assert.equal(formatDuration(11520), '3h 12m');
  assert.equal(formatDuration(187200), '2d 4h');
});

test('formatDuration: boundary values', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(59), '59s');
  assert.equal(formatDuration(60), '1m 00s');
  assert.equal(formatDuration(3599), '59m 59s');
  assert.equal(formatDuration(3600), '1h 0m');
  assert.equal(formatDuration(86399), '23h 59m');
  assert.equal(formatDuration(86400), '1d 0h');
});

test('formatDuration: negative/fractional seconds clamp to 0s, never crash', () => {
  assert.equal(formatDuration(-5), '0s');
  assert.equal(formatDuration(0.9), '0s');
});

test('formatPct: signed whole-number percentage from a fraction', () => {
  assert.equal(formatPct(0.12), '+12%');
  assert.equal(formatPct(-0.06), '-6%');
  assert.equal(formatPct(0), '+0%');
  assert.equal(formatPct(0.25), '+25%');
  assert.equal(formatPct(1), '+100%');
});

// --- robustness: stray strings, missing fields and non-finite input never print "NaN", "Infinity" or "NaNd NaNh" ---------

test('formatNum: numeric strings are parsed, non-numbers are a dash, only a real infinity is the infinity sign', () => {
  assert.equal(formatNum('12'), '12');
  assert.equal(formatNum(' 1234 '), '1.23K');
  assert.equal(formatNum('-5'), '-5');
  for (const bad of [NaN, undefined, null, '', '  ', 'abc', {}, [], true]) assert.equal(formatNum(bad), '—', `formatNum(${String(bad)})`);
  assert.equal(formatNum(Infinity), '∞');
  assert.equal(formatNum(-Infinity), '-∞');
  assert.equal(formatNum(1234), '1.23K'); // numbers unchanged
});

test('formatRate: guarded like formatNum', () => {
  assert.equal(formatRate('1.2'), '+1.2/s');
  assert.equal(formatRate(-1.2), '-1.2/s');
  for (const bad of [NaN, undefined, null, '', 'x']) assert.equal(formatRate(bad), '—');
});

test('formatDuration: non-finite and non-numeric input is a dash, strings are parsed, negatives clamp to 0s', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, '', 'soon', {}]) {
    const out = formatDuration(bad);
    assert.equal(out, '—', `formatDuration(${String(bad)})`);
    assert.ok(!/NaN|Infinity/.test(out));
  }
  assert.equal(formatDuration('65'), '1m 05s');
  assert.equal(formatDuration(-5), '0s');
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(90061), '1d 1h');
  // an absurd but finite span stays readable instead of exponent notation
  assert.ok(!/e\+/.test(formatDuration(1e300)), formatDuration(1e300));
  assert.ok(/d \d+h$/.test(formatDuration(1e300)));
});

test('formatPct: non-finite and non-numeric input is a dash, strings are parsed', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, '', 'x']) assert.equal(formatPct(bad), '—', `formatPct(${String(bad)})`);
  assert.equal(formatPct('0.12'), '+12%');
  assert.equal(formatPct(-0.06), '-6%');
  assert.equal(formatPct(0), '+0%');
});

test('ui formatDurationWords: same guard (non-finite or non-numeric is a dash, strings are parsed)', async () => {
  const { formatDurationWords } = await import('../ui/format.js');
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, '', 'x']) assert.equal(formatDurationWords(bad), '—');
  assert.equal(formatDurationWords('3600'), '1h 0m');
  assert.equal(formatDurationWords(59.6), '1m 0s');
  assert.equal(formatDurationWords(-4), '0s');
  assert.equal(formatDurationWords(12 * 60 + 6), '12m 6s');
});
