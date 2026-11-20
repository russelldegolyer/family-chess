import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const t = readFileSync(new URL('../chess-training.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Your style: summary, filter, trends only with enough games, examples saved per game', () => {
  assert.match(t, /const STYLE_FAMILY = \{/);
  assert.match(t, /for \(const \[v, label\] of \[\['all', 'All'\], \['online', 'Online'\], \['cpu', 'Computer'\]\]\)/);
  assert.match(t, /if \(S\.kinds\.cpu >= 3 && S\.kinds\.online >= 3\)/);
  assert.match(t, /const trend = N >= 6 && v\.n >= 2 \?/);
  assert.match(t, /function accSpark\(series\)/);
  assert.match(t, /'tr-phase-tile' \+ \(weak \? ' weak' : ''\)/);
  assert.match(t, /notes: g\.notes \|\| prev\?\.notes \|\| undefined/);
  assert.match(page, /misses, notes: \(\(\) => \{ const seen = new Set\(\);/);
});
