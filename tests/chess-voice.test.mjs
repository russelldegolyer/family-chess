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
 assert.match(voice,/for \(const ev of \['pointerup', 'pointercancel', 'lostpointercapture'\]\) mainBtn\.addEventListener\(ev, \(\) => pressEnd\(\)\)/);
 assert.match(page,/<script defer src="\.\/chess-voice\.js\?v=\d+"><\/script>/);
 assert.match(page,/window\.familyChessVoice\?\.update\(G\.mode === 'live' && mySeat/);
 assert.match(vercel,/microphone=\(self\)/);
});

test('walkie-talkie: the other player sees who is talking',()=>{
 assert.match(voice,/send\('talk', \{ on: true \}\)/);
 assert.match(voice,/send\('talk', \{ on: false \}\)/);
 assert.match(voice,/S\.oppName \+ ' is talking'/);
 assert.match(voice,/S\.theyTimer = setTimeout\(\(\) => \{ S\.theyTalk = false; paint\(\); \}, 5000\)/);
});

test('walkie-talkie: private pair channel, nothing sent while released, mic closed when idle or leaving',()=>{
 const sql=read('database/chess-voice-private-channel-2026-11-13.sql');
 assert.match(voice,/c\.channel\('chess-voice:' \+ \[S\.me, friend\]\.sort\(\)\.join\(':'\), \{ config: \{ private: true/);
 assert.match(voice,/const track = S\.holding && S\.local \? S\.local\.getAudioTracks\(\)\[0\] \|\| null : null;/);
 assert.match(voice,/for \(const t of S\.local\?\.getTracks\(\) \|\| \[\]\) t\.stop\(\);/);
 assert.match(voice,/const MIC_IDLE_MS = 45000;/);
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
