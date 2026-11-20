import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const voice=read('chess-voice.js'),page=read('index.html'),vercel=read('vercel.json');

test('walkie-talkie: players only, phone-to-phone audio, hold to talk',()=>{
 assert.match(voice,/new RTCPeerConnection/);
 assert.match(voice,/echoCancellation: true/);
 assert.match(voice,/if \(m\.from !== friend \|\| m\.to !== S\.me\) return;/);
 assert.match(voice,/mainBtn\.addEventListener\('pointerdown'/);
 assert.match(voice,/for \(const ev of \['pointerup', 'pointercancel', 'lostpointercapture'\]\) mainBtn\.addEventListener\(ev, \(e\) => pressEnd\(e\.pointerId\)\)/);
 assert.match(page,/<script defer src="\.\/chess-voice\.js\?v=\d+"><\/script>/);
 assert.match(page,/window\.familyChessVoice\?\.update\(G\.mode === 'live' && mySeat/);
 assert.match(vercel,/microphone=\(self\)/);
});

test('walkie-talkie: the other player sees who is talking',()=>{
 assert.match(voice,/send\('talk', \{ on: true \}\)/);
 assert.match(voice,/send\('talk', \{ on: false \}\)/);
 assert.match(voice,/S\.oppName \+ ' is talking'/);
 assert.match(voice,/S\.theyTimer = setTimeout\(\(\) => \{ S\.theyTalk = false; paint\(\); \}, 4000\)/);
});

test('walkie-talkie: private pair channel, nothing sent while released, mic closed the moment you let go',()=>{
 const sql=read('database/chess-voice-private-channel-2026-11-13.sql');
 assert.match(voice,/c\.channel\('chess-voice:' \+ \[S\.me, friend\]\.sort\(\)\.join\(':'\), \{ config: \{ private: true/);
 assert.match(voice,/const track = S\.holding && S\.local \? S\.local\.getAudioTracks\(\)\[0\] \|\| null : null;/);
 assert.match(voice,/for \(const t of s\?\.getTracks\(\) \|\| \[\]\) t\.stop\(\);/);
 assert.match(voice,/const TAIL_MS = 150, HUSH_MS = 60;/);
 assert.match(voice,/if \(now \|\| !S\.local\) \{ send\('talk', \{ on: false \}\); closeMic\(\); return; \}/);
 assert.match(voice,/if \(micPending\) return micPending;/);
 assert.match(voice,/if \(press !== S\.press\) return;/);
 assert.match(voice,/if \(pid != null && S\.pid != null && pid !== S\.pid\) return;/);
 assert.match(voice,/window\.addEventListener\('blur', \(\) => pressEnd\(null, true\)\)/);
 assert.match(voice,/window\.addEventListener\('pagehide', \(\) => leave\(true\)\)/);
 assert.doesNotMatch(voice,/MediaRecorder|getUserMedia\([^)]*video: true/);
 assert.match(sql,/chess_are_friends/);
});

test('walkie-talkie: lower id makes the offer, optional relay from secrets',()=>{
 const ice=read('supabase/functions/chess-voice-ice/index.ts');
 assert.match(voice,/if \(S\.me < S\.opp\) void makeOffer\(\); else send\('hello'\);/);
 assert.match(voice,/addTransceiver\('audio', \{ direction: 'sendrecv' \}\)/);
 assert.match(ice,/CHESS_TURN_URLS/);
 assert.match(ice,/Sign in first\./);
});

test('alerts: opening the app clears the badge; an invite alert clears when answered or expired',()=>{
 const sw=read('chess-sw.js'),social=read('chess-social.js'),chat=read('chess-chat.js');
 assert.match(sw,/async function syncBadge\(\)/);
 assert.match(sw,/d\.type!=='chess-clear-alerts'/);
 assert.match(sw,/await new Promise\(r=>setTimeout\(r,62000\)\)/);
 assert.match(social,/document\.addEventListener\('visibilitychange',\(\)=>\{if\(document\.visibilityState==='visible'\)clearAlerts\(\);\}\)/);
 assert.match(social,/clearAlerts\(c\.id\);alert\.hidden=true/);
 assert.match(chat,/if\(n>0&&document\.hidden\)void navigator\.setAppBadge/);
});
