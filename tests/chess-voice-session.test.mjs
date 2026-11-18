import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const voice = readFileSync(new URL('../chess-voice.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('iPhone: the microphone opens in play-and-record, and move sounds never switch to playback during a call', () => {
  const mic = voice.slice(voice.indexOf('async function mic()'), voice.indexOf('function makePc()'));
  assert.ok(mic.indexOf("session('play-and-record')") > -1 && mic.indexOf("session('play-and-record')") < mic.indexOf('getUserMedia'));
  assert.match(voice, /if \(S\.local \|\| S\.pc\) session\('auto'\)/);
  assert.match(html, /const vs = window\.familyChessVoice\?\.state\?\.\(\);\s*if \(!vs \|\| vs === 'idle' \|\| vs === 'ringing'\)/);
});
