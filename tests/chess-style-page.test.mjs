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

test('Your style: hub line, tappable accuracy dots, one-line rows, a way into the weakest phase', () => {
  assert.match(t, /card\('Your style', styleLine\(\), '◎'/);
  assert.match(t, /function focusPick\(S\)/);
  assert.match(t, /'focus: ' \+ \(F\.ch \? F\.ch\.title : F\.fix\.title\)\.toLowerCase\(\)/);
  assert.match(t, /const \[chart, cap\] = accSpark\(S\.series\);/);
  assert.match(t, /class="hit" tabindex="0" role="button"/);
  assert.match(t, /if \(canOpen\(s\.g\)\) cap\.append\(btn\('Open ›'/);
  assert.match(t, /r\.querySelector\('\.tr-bar-meta'\)\.append\(el\('span', 'tr-pill-good', 'Improving'\)\)/);
  assert.match(t, /'solid in ' \+ \(p\.n - p\.bad\) \+ ' of ' \+ p\.n/);
  assert.match(t, /middlegame: \['Spot the threat ›'/);
});

test('Your style: five sliders between opposites explain how you play', () => {
  assert.match(t, /function styleAxes\(G\)/);
  for (const w of ["'Patient', r: 'Aggressive'", "'Keeps pieces', r: 'Trades pieces'", "'Solid', r: 'Loose'", "'Punishes mistakes', r: 'Misses chances'", "'Quick games', r: 'Long grinds'"]) assert.ok(t.includes("l: " + w), w);
  assert.match(t, /const hp = card\('How you play', 'tr-axes'\);/);
});

test('Your style: How you finish — closing out, boxing the king in, speed, king activity', () => {
  const plan = readFileSync(new URL('../chess-plan.js', import.meta.url), 'utf8');
  assert.match(plan, /const upAt = H\.findIndex\(\(h\) => h\.diff >= 5\);/);
  assert.match(plan, /\.\.\.\(finish \? \{ finish \} : \{\}\)/);
  for (const w of ["'Lets wins slip', r: 'Closes out wins'", "'Chases with checks', r: 'Boxes the king in'", "'Slow to finish', r: 'Finishes fast'", "'King hides', r: 'King joins in'", "'Slow start', r: 'Quick development'"]) assert.ok(t.includes("l: " + w), w);
  assert.match(t, /sliders\('How you finish', S\.axes\.finish/);
  assert.match(t, /function fillFinish\(\)/);
});
