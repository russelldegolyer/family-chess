import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const page=read('index.html'),stats=read('chess-stats.js'),online=read('chess-online.js'),sql=read('database/chess-accuracy-2026-11-12.sql');

test('accuracy uses the win-chance formula and blends mean with harmonic mean',()=>{
 assert.match(stats,/0\.00368208/);
 assert.match(stats,/103\.1668 \* Math\.exp\(-0\.04354 \* drop\) - 3\.1669/);
 assert.match(stats,/\(mean \+ harm\) \/ 2/);
 assert.match(stats,/window\.familyChessAccuracy = Object\.freeze\(\{ forGame: accFor, cached: accCached \}\)/);
});

test('accuracy shows on the end card, My matches and record cards, and is saved through an RPC',()=>{
 assert.match(page,/id="endAcc"/);
 assert.match(page,/fillEndAccuracy\(me\)/);
 assert.match(page,/rpc\('chess_set_game_accuracy'/);
 assert.match(online,/accuracy_white,accuracy_black/);
 assert.match(online,/className='cgAcc'/);
 assert.match(online,/avg accuracy/);
 assert.match(sql,/security definer/);
 assert.match(sql,/coalesce\(accuracy_white, round\(p_white, 1\)\)/);
 assert.match(sql,/g\.status <> 'finished'/);
});

test('phones show captured pieces and the material lead',()=>{
 assert.match(page,/function updateCapStrips\(\)/);
 assert.match(page,/b\.textContent = '\+' \+ lead/);
 assert.match(page,/if \(compact\) return;   \/\* phones show captured pieces/);
});

test('the path: chapters with learn / practise / prove, all open, recommended next',()=>{
 const tr=readFileSync(new URL('../chess-training.js',import.meta.url),'utf8');
 assert.match(tr,/const CHAPTERS = \[/);
 assert.match(tr,/const recommended = \(\) => CHAPTERS\.find\(\(ch\) => !chapterDone\(ch\)\)/);
 assert.match(tr,/if \(PATH && PATH\.theme\)/);
 assert.match(tr,/lessons: \{\}, challenges: \{\}, path: \{\}/);
 for (const id of ['l1','l4','l2','l5','l3','f3','f4','f5','l8','p2','l6','l7']) assert.match(tr,new RegExp("lesson: '"+id+"'"));
});

test('daily puzzle streak and fix-this-next link',()=>{
 const tr=readFileSync(new URL('../chess-training.js',import.meta.url),'utf8');
 const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(tr,/D\.streak = D\.last === yesterday\(\) \? \(D\.streak \|\| 0\) \+ 1 : 1;/);
 assert.match(tr,/if \(D\.last && D\.last !== today && D\.last !== yesterday\(\)\) D\.streak = 0;/);
 assert.match(tr,/openChapterId/);
 assert.match(page,/function missedIdea\(sw\)/);
 assert.match(page,/familyChessTraining\.openChapterId\(fix\.id\)/);
});
