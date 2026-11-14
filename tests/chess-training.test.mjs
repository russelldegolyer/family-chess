import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const tr=readFileSync(new URL('../chess-training.js',import.meta.url),'utf8');
const clock=readFileSync(new URL('../chess-clock.js',import.meta.url),'utf8');
const sql=readFileSync(new URL('../database/chess-training-clock-presence-2026-11-11.sql',import.meta.url),'utf8');
const dev=JSON.parse(readFileSync(new URL('../chess-puzzles-dev.json',import.meta.url),'utf8'));

test('training borrows the board and restores the game, never writing online state',()=>{
 assert.match(html,/window\.familyChessBoard = Object\.freeze/);
 assert.match(html,/if \(online\) window\.familyChessOnlineStop\?\.\(\)/);
 assert.match(html,/if \(sv\.online\) Promise\.resolve\(window\.familyChessOpenMatch/);
 assert.match(html,/if \(G\.mode === 'train'\) \{ TRAIN\.after\(uci, r\); return; \}/);
 assert.doesNotMatch(tr,/chess_games|chess_moves|familyChessSubmitMove/);
});
test('puzzles: five rating bands, adaptive, hints make a solve unrated, dev set validated',()=>{
 assert.match(tr,/1: \[400, 999, 'Beginner'\].*5: \[2200, 3200, 'Expert'\]/);
 assert.match(tr,/lv === 'adaptive'/);
 assert.match(tr,/rated = PZ\.rated && !PZ\.hints/);
 assert.ok(dev.puzzles.length>=400);
 for(const p of dev.puzzles){assert.match(p[1],/^[1-8pnbrqkPNBRQK\/]+ [wb] /);assert.ok(p[2].split(' ').length>=2);}
});
test('live clock changes shift total-time clocks by the difference and keep pauses',()=>{
 assert.match(clock,/const d=totalMs\(next\)-totalMs\(old\);/);
 assert.match(clock,/else if\(next!=='off'\)\{state\.w=totalMs\(next\);state\.b=totalMs\(next\);\}/);
 assert.match(sql,/create or replace function public\.chess_change_clock[\s\S]*for update/);
 assert.match(sql,/alter table public\.chess_profiles add column if not exists last_seen_at/);
 assert.doesNotMatch(sql,/(table|function|on) public\.(?!chess_)/);
});

test('exact endgame tables ship with the app and match their builder',()=>{
 for(const t of ['kqk','krk','kpk']){const b=readFileSync(new URL('../endgame-'+t+'.bin',import.meta.url));assert.equal(b.length,524288);}
 const kpk=readFileSync(new URL('../endgame-kpk.bin',import.meta.url));
 const v=(wk,bk,p,stm)=>kpk[((wk*64+bk)*64+p)*2+stm];
 const sq=s=>(+s[1]-1)*8+'abcdefgh'.indexOf(s[0]);
 assert.ok(v(sq('e6'),sq('e8'),sq('e5'),0)<254,'K on 6th in front of pawn wins');
 assert.equal(v(sq('e4'),sq('e7'),sq('e5'),0),255,'Ke4/Pe5 vs Ke7, White to move: draw (Black keeps the opposition)');
});
test('Academy starts with fundamentals and every "only move" claim is exact',()=>{
 assert.match(tr,/\{ group: 'Fundamentals' \}[\s\S]*id: 'l1'[\s\S]*id: 'l2'[\s\S]*id: 'f3', title: 'The opposition'[\s\S]*id: 'f4', title: 'The square rule'[\s\S]*id: 'f5', title: 'Key squares'/);
 assert.match(tr,/function runKeep/);
 assert.match(tr,/a winning move that is much slower than the best is "inefficient", never "wrong"/);
});
