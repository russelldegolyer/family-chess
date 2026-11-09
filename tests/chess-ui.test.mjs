import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('index.html'), online=read('chess-online.js'),auth=read('auth-gate.js'),css=read('auth.css');
test('Chess 3D/2D inline module has valid JavaScript syntax',()=>{
 const match=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find(m=>/type="module"/.test(m[1]));
 assert.ok(match,'Main chess module must exist');
 const dir=mkdtempSync(join(tmpdir(),'chess-inline-'));
 try {
   const file=join(dir,'chess.mjs');writeFileSync(file,match[2]);
   const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('account controls remain accessible but never float over phone chat',()=>{
 assert.match(html,/id="authAccountToggle"/);
 assert.match(html,/id="authAccountActions"/);
 assert.match(css,/\.auth-account\{top:max\(9px,env\(safe-area-inset-top/);
 assert.match(css,/bottom:auto!important/);
 assert.match(css,/\.auth-account\.is-open \.auth-account-actions\{display:flex\}/);
 assert.match(auth,/accToggle\.addEventListener\('click'/);
 assert.match(auth,/closeAccountMenu\(\)/);
 assert.match(online,/account\.insertBefore\(launch, document\.getElementById\('authSignOut'\)\)/);
});
test('chat empty state is readable and does not promise unavailable messaging',()=>{
 assert.match(html,/chat-empty-state/);
 assert.match(html,/Private matches are live\. In-game messaging is not connected yet\./);
 assert.doesNotMatch(html,/This copy is running on its own, so moves stay on this screen/);
 assert.match(html,/\.chat-list>\.chat-empty-state/);
});
test('each authenticated player can publish their own hex color',()=>{
 assert.match(html,/familyChessPieceColorChanged/);
 assert.match(html,/if \(!chromaOk\(hex\)\) return/);
 assert.match(online,/\.update\(\{piece_color:hex\.toLowerCase\(\)\}\)\.eq\('id',uid\)/);
 assert.match(online,/clearTimeout\(colorSaveTimer\)/);
 assert.match(online,/if\(player\?\.id!==uid\)return/);
 assert.match(online,/\.select\('id,display_name,piece_color'\)/);
});
test('live game reads both seated players colors, including changes to their current match',()=>{
 assert.match(online,/const colors=Object\.fromEntries/);
 assert.match(online,/await native\.present\(g,moves\.map\(m=>m\.move_uci\),uid,labels,colors\)/);
 assert.match(html,/G\.colors=filteredColors/);
 assert.match(html,/if\(colorsChanged\)\{/);
 assert.match(html,/applySideColors\(true\)/);
 assert.match(html,/G\.onlineProvider==='supabase' \? sideColors\(\) : null/);
 assert.match(html,/setAccountColor\(hex\)/);
});
test('database field uses player-own RLS and hex constraint',()=>{
 const migration=read('database/chess-profile-colors.sql');
 assert.match(migration,/alter table public\.chess_profiles/);
 assert.match(migration,/piece_color text/);
 assert.match(migration,/chess_profiles_piece_color_hex/);
});
