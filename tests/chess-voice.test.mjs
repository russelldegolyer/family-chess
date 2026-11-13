import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const voice=read('chess-voice.js'),page=read('index.html'),vercel=read('vercel.json');

test('voice chat: players only, accept to join, phone-to-phone audio',()=>{
 assert.match(voice,/new RTCPeerConnection/);
 assert.match(voice,/echoCancellation: true/);
 assert.match(voice,/if \(m\.from !== S\.opp \|\| m\.to !== S\.me\) return;/);
 assert.match(voice,/wants to talk/);
 assert.match(page,/<script defer src="\.\/chess-voice\.js\?v=\d+"><\/script>/);
 assert.match(page,/window\.familyChessVoice\?\.update\(G\.mode === 'live' && mySeat/);
 assert.match(vercel,/microphone=\(self\)/);
});
