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
 assert.match(clock,/const d=MODES\[next\]-MODES\[old\];\s*state\.w=Math\.max\(0,state\.w\+d\);state\.b=Math\.max\(0,state\.b\+d\);/);
 assert.match(clock,/else if\(next==='move60'\)\{state\.w=60000;state\.b=60000;\}/);
 assert.match(sql,/create or replace function public\.chess_change_clock[\s\S]*for update/);
 assert.match(sql,/alter table public\.chess_profiles add column if not exists last_seen_at/);
 assert.doesNotMatch(sql,/(table|function|on) public\.(?!chess_)/);
});
