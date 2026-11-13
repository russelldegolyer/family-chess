import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const voice=read('chess-voice.js'),page=read('index.html'),vercel=read('vercel.json');

test('voice chat: players only, accept to join, phone-to-phone audio',()=>{
 assert.match(voice,/new RTCPeerConnection/);
 assert.match(voice,/echoCancellation: true/);
 assert.match(voice,/if \(m\.from !== friend \|\| m\.to !== S\.me\) return;/);
 assert.match(voice,/wants to talk/);
 assert.match(page,/<script defer src="\.\/chess-voice\.js\?v=\d+"><\/script>/);
 assert.match(page,/window\.familyChessVoice\?\.update\(G\.mode === 'live' && mySeat/);
 assert.match(vercel,/microphone=\(self\)/);
});

test('voice chat: private pair channel, survives game changes, mic ends it, mic released on end',()=>{
 const voice=readFileSync(new URL('../chess-voice.js',import.meta.url),'utf8');
 const sql=readFileSync(new URL('../database/chess-voice-private-channel-2026-11-13.sql',import.meta.url),'utf8');
 assert.match(voice,/c\.channel\('chess-voice:' \+ \[S\.me, friend\]\.sort\(\)\.join\(':'\), \{ config: \{ private: true/);
 assert.match(voice,/if \(S\.state !== 'idle'\) \{ paint\(\); return; \}/);
 assert.match(voice,/hangUp\(true\);   \/\* on a call \(or calling\): the mic button ends it \*\//);
 assert.match(voice,/for \(const t of S\.local\?\.getTracks\(\) \|\| \[\]\) t\.stop\(\);/);
 assert.doesNotMatch(voice,/MediaRecorder|getUserMedia\([^)]*video: true/);
 assert.match(sql,/chess_are_friends/);
});

test('voice chat: ring sound, re-ring, push to closed apps, optional relay from secrets',()=>{
 const voice=readFileSync(new URL('../chess-voice.js',import.meta.url),'utf8');
 const notify=readFileSync(new URL('../supabase/functions/chess-notify-challenge/index.ts',import.meta.url),'utf8');
 const ice=readFileSync(new URL('../supabase/functions/chess-voice-ice/index.ts',import.meta.url),'utf8');
 assert.match(voice,/function startRingSound\(\)/);
 assert.match(voice,/S\.ringTick = setInterval/);
 assert.match(voice,/action: 'voice_call', target_id: S\.opp/);
 assert.match(notify,/You can only call friends/);
 assert.match(ice,/CHESS_TURN_URLS/);
 assert.match(ice,/Sign in first\./);
});
