import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const tr=read('chess-training.js'),plan=read('chess-plan.js'),page=read('index.html'),stats=read('chess-stats.js');

test('mistakes come back: 1, 3, 7 days, three right = learned, never rated',()=>{
 assert.match(tr,/const GAPS = \[1, 3, 7\];/);
 assert.match(tr,/if \(!ok && !\(PATH && PATH\.review\)\) reviewAdd\('puzzle', PZ\.p\);/);
 assert.match(tr,/const casual = !!\(PATH && \(PATH\.review \|\| PATH\.speed\)\);/);
 assert.match(tr,/rated: !retry && !casual/);
 assert.match(tr,/review: \[\], drills: \{/);
});

test('threat and blunder drills use the board tap hook; speed rounds are five puzzles',()=>{
 assert.match(page,/if \(G\.mode === 'train' && TRAIN\.onTap\) \{ if \(sq\) TRAIN\.onTap\(sq\); return; \}/);
 assert.match(page,/onTap\(fn\) \{ TRAIN\.onTap = fn \|\| null;/);
 assert.match(tr,/async function startThreat\(/);
 assert.match(tr,/async function startBlunder\(/);
 assert.match(tr,/const SPEED_N = 5, PACE = 15000;/);
 assert.match(tr,/parts\[1\] = other\(attacker\); parts\[3\] = '-';/);
});

test('defence chapters and new Academy lessons, scripted lines can move to another file',()=>{
 for (const id of ['d1','d2','d3','d4']) assert.match(tr,new RegExp("\\{ id: '"+id+"', title: '[^']+', blurb: '[^']+', defend: true"));
 for (const id of ['q1','r1','r2','s1','s2','s3','s4','dq','dr']) assert.match(tr,new RegExp("\\{ id: '"+id+"', title:"));
 assert.match(tr,/function transform\(fen, moves\)/);
 assert.match(tr,/if \(m\.survive\) return void playSurvive/);
 assert.match(tr,/if \(m\.series\) return void runSeries/);
 assert.match(tr,/const lessonSide = \(l\) => l\.side \|\|/);
});

test('your plan on the end card feeds the style profile',()=>{
 assert.match(plan,/window\.familyChessPlan = Object\.freeze\(\{ read, open, headline, FIX, PLAN_NAME, ORDER \}\)/);
 assert.match(plan,/hung:\s+\{ chapter: 'd1'/);
 assert.match(page,/<script defer src="\.\/chess-plan\.js\?v=\d+"><\/script>/);
 assert.match(page,/<link rel="stylesheet" href="\.\/chess-plan\.css\?v=\d+">/);
 assert.match(page,/function fillEndPlan\(me, acc\)/);
 assert.match(page,/window\.familyChessTraining\?\.recordGame\?\.\(/);
 assert.match(tr,/function recordGame\(g\)/);
 assert.match(tr,/function styleFocus\(\)/);
 assert.match(stats,/drops\[i\] = Math\.max\(0, Math\.round\(drop\)\);/);
});

test('practice and drills never write game state; the plan read stays on the device',()=>{
 assert.doesNotMatch(plan,/fetch\(|chessSupabase|XMLHttpRequest/);
 assert.doesNotMatch(tr,/from\('chess_games'\)\.(insert|update|upsert)/);
});
