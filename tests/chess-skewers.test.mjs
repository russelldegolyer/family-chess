import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const t = readFileSync(new URL('../chess-training.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../chess-training.css', import.meta.url), 'utf8');

test('skewers are read from the solution line (the piece in front steps off it, we take the one behind)', () => {
  assert.match(t, /function skewerIn\(fen, moves, from = 0\)/);
  assert.match(t, /!between\(me\.from, me\.to, op\.from\) \|\| VAL\[op\.piece\] <= VAL\[me\.captured\]/);
  assert.match(t, /set: H\[k - 2\]\.to === me\.from \? k - 2 : -1, take: k/);
  /* the threat drill names a skewer from the line first, even where a block was possible but worse */
  assert.match(t, /const sk = line && line\[0\] === uci \? skewerIn\(fen, line, 0\) : null;/);
});

test('skewer practice and speed rounds prefer puzzles whose first move is the skewer', () => {
  assert.match(t, /const pure = cat\[3\] === 'skewer' && !!\(opt \|\| \(PATH && PATH\.step === 'practice'\)\);/);
  assert.match(t, /const fits = \(p\) => !pure \|\| skewerIn\(p\.fen, p\.moves, 1\)\?\.set === 1;/);
  assert.match(t, /if \(skip\.length >= 4\) break;/);            /* never hunts forever */
  assert.match(t, /const all = clean\.length >= 3 \? clean : any;/);
});

test('puzzle ideas put the chapter theme first and broad tags like "endgame" last', () => {
  assert.match(t, /const BROAD = new Set\(\['endgame', 'crushing'\]\);/);
  assert.match(t, /\.sort\(\(a, b\) => \(b === lead\) - \(a === lead\) \|\| BROAD\.has\(a\) - BROAD\.has\(b\)\)/);
});

test('skewer hints ring the two pieces on the line; the result explains the skewer in that position', () => {
  assert.match(t, /function skewerHint\(\)/);
  assert.match(t, /rings: \[s\.front\.sq, s\.back\.sq\], legend: 'Ringed: the two pieces on one line'/);
  assert.match(t, /ringColor: '#ffd60a', legend: \[\['ring', sk\.legend\]\]/);
  assert.match(t, /function skewerSay\(s\)/);
  assert.match(t, /const ex = el\('div', 'tr-say', PZ\.sk \? skewerSay\(PZ\.sk\)/);
  assert.match(t, /el\('div', 'tr-say', PZ\.sk \? skewerSay\(PZ\.sk\) : th\.length \? \(NAME\[th\[0\]\]/);
});

test('the Skewers chapter teaches with two worked examples on the board', () => {
  assert.match(t, /const learn = \(text, look, demo\) => \(\{ text, look, demo \}\);/);
  assert.match(t, /\{ title: 'King in front', fen: 'q7\/5p1p\/6p1\/3k4\/8\/8\/5PPP\/3B2K1 w - - 0 1'/);
  assert.match(t, /\{ title: 'Queen in front', fen: 'rn4k1\/p4ppp\/1p6\/3q4\/8\/P7\/1P2BPPP\/6K1 w - - 0 1'/);
  assert.match(t, /async function openLearnDemo\(ch, ex = 0, st = 0\)/);
  assert.match(t, /btn\('See it on the board', 'primary', \(\) => openLearnDemo\(ch\), 'play'\)/);
  assert.match(css, /\.tr-actions\.tr-stack \{ flex-direction: column; \}/);
});
