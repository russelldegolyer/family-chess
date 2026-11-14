import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const page=read('index.html'),train=read('chess-training.js'),clock=read('chess-clock.js'),social=read('chess-social.js');
const edge=read('supabase/functions/chess-saved-game/index.ts'),sql=read('database/chess-saved-games-2026-11-12.sql');
const early=read('database/chess-early-resign-invite-70s-2026-11-12.sql');

/* pull a top-level helper out of chess-training.js and run it on its own */
const grab=(name)=>{const i=train.indexOf('  function '+name+'(');assert.ok(i>0,name+' exists');
 let d=0,j=train.indexOf('{',i);for(let k=j;k<train.length;k++){if(train[k]==='{')d++;else if(train[k]==='}'&&--d===0)return train.slice(i,k+1);}};
const editor=new Function(grab('parseFen')+grab('buildFen')+'return {parseFen,buildFen};')();

test('Save button saves for the player only, asks to overwrite, and fills once saved',()=>{
 assert.match(page,/id="btnSave"/);assert.match(page,/id="btnChatSave"/);
 assert.match(page,/chess_save_online_game', \{ p_game_id: G\.gid, p_replace: replace \}/);
 assert.match(page,/'Overwrite last save'/);assert.match(page,/'Save as new'/);
 assert.match(page,/classList\.toggle\('is-saved', savedNow\)/);
 assert.match(page,/#btnSave\.is-saved svg path/);
 assert.match(sql,/now writes ONE row for the caller only/);
});

test('saved games keep clock times and pawn-for-time changes',()=>{
 assert.match(page,/function localClockNow\(\)/);
 assert.match(page,/p_clock: localClockNow\(\)/);
 assert.match(page,/p_actions: \(G\.clockActions \|\| \[\]\)/);
 assert.match(page,/ChessClock\?\.resumeLocal\?\.\(row\.clock\.mode, row\.clock\.w, row\.clock\.b/);
 assert.match(clock,/function resumeLocal\(mode,w,b,turn,ply,expiry\)/);
 assert.match(clock,/startLocal,resumeLocal,moveLocal/);
 assert.match(edge,/clock_white_ms: ms\(ck\.w\), clock_black_ms: ms\(ck\.b\)/);
 assert.match(sql,/Limit 30 saved games per player/);
});

test('sending a saved game re-checks moves server-side and uses a saved-game invite',()=>{
 assert.match(edge,/new Chess\(startFen\)/);
 assert.match(edge,/chess\.move\(\{ from: u\.slice\(0, 2\)/);
 assert.match(edge,/kind: 'saved'/);
 assert.match(edge,/if \(chess\.isGameOver\(\)\)/);
 assert.match(train,/functions\.invoke\('chess-notify-challenge'/);
 assert.match(social,/wants to continue your saved game/);
 assert.match(social,/declined your saved game/);
});

test('resumed games show both last moves until the next move',()=>{
 assert.match(page,/function resumeMoves\(\)/);
 assert.match(page,/G\.moves\.length !== G\.resumePlies/);
 assert.match(page,/Picking up where you left off/);
 assert.match(page,/START_FEN = game\.start_fen \|\| null;/);
});

test('Create game builds legal FEN with castling only from home squares',()=>{
 const start='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
 const {board,turn}=editor.parseFen(start);
 assert.equal(editor.buildFen(board,turn),start);
 delete board.h1; assert.equal(editor.buildFen(board,'b').split(' ').slice(1,3).join(' '),'b Qkq');
 const lone=editor.parseFen('4k3/8/8/3Q4/8/8/8/6K1 w - - 0 1');
 assert.equal(editor.buildFen(lone.board,lone.turn),'4k3/8/8/3Q4/8/8/8/6K1 w - - 0 1');
 assert.match(train,/Each side needs exactly one king\./);
 assert.match(train,/Pawns can’t stand on the first or last rank\./);
 assert.match(train,/'Overwrite original'/);
 assert.match(train,/p_source: 'custom'/);
});

test('resigning in the first 3 moves removes the game and never counts',()=>{
 assert.match(page,/const EARLY_PLIES = 6;/);
 assert.match(page,/if \(earlyResign\(\) && \(G\.mode === 'cpu' \|\| G\.mode === 'local'\)\)/);
 assert.match(page,/chess\.cpuEarlyScrub/);
 assert.match(early,/if v_plies <= 6 then\s+delete from public\.chess_games where id=p_game_id;\s+return 'deleted';/);
 assert.match(early,/interval '70 seconds'/);
 assert.match(social,/function shown\(r,kind\)\{return kind==='saved'\?r:Math\.max\(1,Math\.min\(60,r-10\)\)/);
});
