import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const engineText=html.match(/<script type="text\/plain" id="engineSrc">([\s\S]*?)<\/script>/)?.[1];
assert.ok(engineText,'embedded computer engine must exist');
const create=()=>{
  const sandbox={performance:{now:()=>Number(process.hrtime.bigint()/1000000n)}};
  vm.runInNewContext(engineText+'\nthis.makeEngine=Engine;',sandbox,{timeout:1500});
  return sandbox.makeEngine();
};
const opening='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const movesFromStart=new Set([
  'a2a3','a2a4','b2b3','b2b4','c2c3','c2c4','d2d3','d2d4',
  'e2e3','e2e4','f2f3','f2f4','g2g3','g2g4','h2h3','h2h4',
  'b1a3','b1c3','g1f3','g1h3'
]);

test('the setup screen offers exactly five numbered computer levels',()=>{
 const block=html.match(/id="optLevel"([\s\S]*?)<\/div>/)?.[1];
 assert.ok(block);
 const choices=[...block.matchAll(/data-v="(\d+)"[^>]*>([^<]+)<\/button>/g)];
 assert.deepEqual(choices.map(x=>x[1]),['1','2','3','4','5']);
 assert.deepEqual(choices.map(x=>x[2]),['1','2','3','4','5']);
 assert.doesNotMatch(block,/Gukesh|Magnus|Easy|Average|Hard/i);
 assert.match(html,/clamp\(Number\(store\.get\('sg\.level', 2\)\) \|\| 2, 1, 5\)/);
 assert.match(html,/cpuLevels: \[1, 2, 3, 4, 5\]/);
});

test('the engine generates a legal opening move at each level',()=>{
 const ai=create();
 ai.load(opening);
 assert.equal(ai.perft(1),20);
 for(let level=1;level<=5;level++){
   const out=ai.think(opening,level,level>=3?120:80,()=>.42);
   assert.ok(movesFromStart.has(out?.move),'level '+level+' returned illegal opening move '+out?.move);
   assert.ok(out.nodes>0,'level '+level+' must actually search');
 }
});

test('the two hard profiles use separate decision criteria, not labels',()=>{
 assert.match(engineText,/if \(level === 4\)/);
 assert.match(engineText,/else if \(level === 5\)/);
 assert.match(engineText,/function rootStyle\(m, givesCheck\)/);
 assert.match(engineText,/givesCheck \? 16 : 0/);
 assert.match(engineText,/if \(!m\.c && !givesCheck\) bonus \+= 5/);
 assert.match(engineText,/const KEND =/);
 assert.match(engineText,/const QD = \{ 1: 0, 2: 4, 3: 10, 4: 12, 5: 12 \}/);
});
test('level one is intentionally less calculating and can choose worse moves',()=>{
 assert.match(engineText,/lvl === 1 \? 1 : lvl === 2 \? 4/);
 assert.match(engineText,/if \(chance < 0\.12\)/);
 assert.match(engineText,/Math\.floor\(n \* 0\.40\)/);
});
