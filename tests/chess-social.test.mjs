import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const online=read('chess-online.js'),social=read('chess-social.js'),css=read('chess-social.css');
const page=read('index.html'),schema=read('database/chess-lobby-challenges.sql');
const sw=read('chess-sw.js'),edge=read('supabase/functions/chess-notify-challenge/index.ts');
test('family spectator feature remains intact while adding direct challenges',()=>{
 assert.match(online,/id="cgLiveGames"/);
 assert.match(online,/function refreshLive\(prompt=false\)/);
 assert.match(online,/startMatch\(game.id,participant\?'play':'watch'\)/);
 assert.match(online,/spectatorBar\.hidden=false/);
 assert.match(online,/if\s*\(!player \|\| !matchId \|\| id !== matchId \|\| matchMode!=='play'\)/);
 assert.match(online,/window\.familyChessOpenMatch = \(id,mode='play'\) => startMatch\(id,mode\)/);
 assert.match(online,/id="cgSocialMount"/);
 assert.match(online,/<details class="cgSettings" id="cgSettings">/);
 assert.doesNotMatch(social,/id="cgLiveGames"/);
 assert.match(page,/chess-social\.js\?v=\d+/);
});
test('online availability and user names are based on authenticated profiles and presence',()=>{
 assert.match(social,/api\.from\('chess_profiles'\)\.select\(hasLastSeen\?'id,display_name,last_seen_at':'id,display_name'\)/);
 assert.match(social,/Last online/);
 assert.match(social,/chess_touch_last_seen/);
 assert.match(social,/api\.channel\('chess-family-presence-v1'/);
 assert.match(social,/presence\.presenceState\(\)/);
 assert.match(social,/document\.visibilityState==='hidden'/);
 assert.match(social,/\.white_player_id===p\.id\|\|g\.black_player_id===p\.id/);
 assert.match(css,/\.cgSocialDot\.online\{background:#30d158/);
});
test('60-second, non-editable challenges require authenticated, atomic acceptance',()=>{
 assert.match(schema,/expires_at timestamptz not null default \(now\(\)\+interval '60 seconds'\)/);
 assert.match(schema,/create or replace function public\.chess_send_challenge/);
 assert.match(schema,/create or replace function public\.chess_respond_challenge/);
 assert.match(schema,/where id=p_id for update/);
 assert.match(schema,/c\.expires_at <= clock_timestamp\(\)/);
 assert.match(schema,/insert into public\.chess_games\(white_player_id,black_player_id,status\)/);
 assert.match(schema,/revoke all on public\.chess_challenges from anon,authenticated/);
 assert.match(schema,/create policy chess_challenges_read_party/);
 assert.doesNotMatch(schema,/drop policy if exists chess_games_read/);
 assert.match(social,/api\.rpc\('chess_send_challenge'/);
 assert.match(social,/api\.rpc\('chess_respond_challenge'/);
 assert.match(social,/window\.familyChessOpenMatch\(accepted\.game_id,'play'\)/);
});
test('offline push is opt-in, encrypted, service-role-only and expiry-limited',()=>{
 assert.match(social,/Notification\.requestPermission\(\)/);
 assert.match(social,/navigator\.serviceWorker\.register\('\/chess-sw\.js'\)/);
 assert.match(social,/applicationServerKey:urlBase64ToUInt8\(VAPID_PUBLIC_KEY\)/);
 assert.match(social,/chess_push_subscriptions/);
 assert.match(social,/chess-notify-challenge/);
 assert.match(sw,/self\.registration\.showNotification/);
 assert.match(sw,/notificationclick/);
 assert.match(sw,/self\.clients\.openWindow/);
 assert.match(edge,/client\.auth\.getUser\(token\)/);
 assert.match(edge,/c\.challenger_id!==user\.id/);
 assert.match(edge,/\.is\("push_sent_at",null\)/);
 assert.match(edge,/admin\.rpc\("chess_vapid_config"\)/);
 assert.match(edge,/webpush\.sendNotification/);
 assert.match(read('database/chess-vapid-vault-access.sql'),/grant execute on function public\.chess_vapid_config\(\) to service_role/);
});

test('offline challenge links prioritize the intended invite and explain expiry',()=>{
 assert.match(social,/available\.find\(c=>c\.id===deepLink\)\|\|available\[0\]/);
 assert.match(social,/url\.searchParams\.delete\('challenge'\)/);
 assert.match(social,/That invitation has expired or was already answered/);
});

test('players in active games can still receive separate direct challenges',()=>{
 assert.match(social,/if\(game\)\{\s*const watchBtn=node/);
 assert.match(social,/const challengeBtn=node\('button','cgSocialAction'/);
 const sql=read('database/chess-allow-challenges-during-existing-games.sql');
 assert.doesNotMatch(sql,/Finish your current game before sending another challenge/);
 assert.doesNotMatch(sql,/A player is already in an active match/);
 assert.match(sql,/The newly accepted game does not alter other active matches/);
});
