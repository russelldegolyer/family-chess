import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const social=read('chess-social.js'),train=read('chess-training.js'),notify=read('supabase/functions/chess-notify-challenge/index.ts');
const saved=read('supabase/functions/chess-saved-game/index.ts'),sql=read('database/chess-friends-2026-11-12.sql');

test('players list shows friends only, with codes, requests and remove',()=>{
 assert.match(social,/profiles\.filter\(p=>p\.id!==user\.id&&friendIds\.has\(p\.id\)\)/);
 assert.match(social,/api\.from\('chess_friendships'\)/);
 assert.match(social,/rpc\('chess_my_friend_code'\)/);
 assert.match(social,/'chess_friend_request',\{p_code:code\}/);
 assert.match(social,/'chess_friend_respond',\{p_id:f\.id,p_accept:true\}/);
 assert.match(social,/'chess_friend_remove',\{p_other:p\.id\}/);
 assert.match(social,/id="cgEditFriends"/);
});

test('friend requests send a push once',()=>{
 assert.match(social,/action:'friend_request',target_id:r\.target/);
 assert.match(notify,/isFriend=body\?\.action==="friend_request"/);
 assert.match(notify,/\.is\("push_sent_at",null\)/);
 assert.match(notify,/wants to be friends on Chess/);
});

test('only friends can be invited or sent saved games',()=>{
 assert.match(saved,/You can only send games to friends\./);
 assert.match(train,/\.from\('chess_friendships'\)\.select\('user_a,user_b'\)\.eq\('status', 'accepted'\)/);
 assert.match(train,/rpc\('chess_are_friends', \{ p_a: uid, p_b: g\.opponent_id \}\)/);
 assert.match(sql,/'You can only invite friends'/);
 assert.match(sql,/spectators must be friends of a player/);
 assert.match(sql,/chess_join_game now befriends the joiner and the inviter/);
});
