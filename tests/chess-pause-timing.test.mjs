import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const clock=read('chess-clock.js');
const page=read('index.html');
const pawnEdge=read('supabase/functions/chess-clock-action/index.ts');
const submitEdge=read('supabase/functions/chess-submit-move/index.ts');
const sql=read('database/chess-move60-sudden-death-2026-11-09.sql');

function makeClock(){
  let now=1_800_000_000_000;
  class MockNode {
    constructor(){
      this.children=[];this.style={};this.dataset={};this.hidden=false;this.textContent='';
      this.classList={
        add(){},remove(){},toggle(){},contains(){return false}
      };
    }
    append(...nodes){this.children.push(...nodes)}
    setAttribute(){}
    addEventListener(){}
    getBoundingClientRect(){return {top:120,bottom:175,left:9,right:140,width:131,height:55}}
  }
  const ui=new MockNode(),head=new MockNode(),body=new MockNode();
  const document={
    head,body,createElement(){return new MockNode()},
    getElementById(id){return id==='ui'?ui:new MockNode()},
    querySelector(){return new MockNode()},
    addEventListener(){}
  };
  const window={innerWidth:390,visualViewport:{height:812,offsetTop:0},
    dispatchEvent(){},ChessClock:null};
  const context={document,window,localStorage:{getItem(){return '"off"'},setItem(){}},
    Date:class extends Date {static now(){return now}},
    Event:class {constructor(type){this.type=type}},setInterval(){}};
  vm.runInNewContext(clock,context,{timeout:1000});
  return {clock:window.ChessClock,advance(ms){now+=ms}};
}

test('60 seconds per move has no pawn trade or penalty and expires as a loss',()=>{
  const a=makeClock();
  let expired=null;
  a.clock.startLocal('move60',side=>{expired=side});
  a.clock.moveLocal('b',1);a.clock.moveLocal('w',2);
  a.clock.setPerspective('w','w');
  a.advance(45_000);
  assert.equal(a.clock.sacrificeLocal('b',1),false);
  a.advance(16_000);
  a.clock.check();
  assert.equal(expired,'w');
  assert.equal(a.clock.snapshot().status,'over');
  assert.notEqual(a.clock.snapshot().clockState,'penalty');
  assert.equal(a.clock.resolveLocalPenalty(),false);
});

test('a practice clock waits for the first move before counting down',()=>{
  const a=makeClock();
  a.clock.startLocal('10m',()=>{});
  a.advance(120_000);a.clock.check();
  assert.equal(a.clock.snapshot().w,600_000);
  a.clock.moveLocal('b',1);
  a.advance(5_000);a.clock.moveLocal('w',2);
  assert.equal(a.clock.snapshot().b,595_000);
});

test('normal timed chess allows pawn +1:30 only at 10 seconds or less',()=>{
  const a=makeClock();
  a.clock.startLocal('10m',()=>{});
  a.clock.moveLocal('b',1);a.clock.moveLocal('w',2);
  a.clock.setPerspective('w','w');
  a.advance(575_000);
  assert.equal(a.clock.sacrificeLocal('b',1),false);
  a.advance(16_000);
  assert.equal(a.clock.sacrificeLocal('b',1),true);
  assert.equal(a.clock.snapshot().turn,'b');
  assert.ok(a.clock.snapshot().w>=95_000);
});

test('a normal time-out still requests a pawn penalty',()=>{
  const a=makeClock();
  let expired=null;
  a.clock.startLocal('10m',side=>{expired=side});
  a.clock.moveLocal('b',1);a.clock.moveLocal('w',2);
  a.advance(601_000);a.clock.check();
  assert.equal(expired,'w');
  assert.equal(a.clock.snapshot().clockState,'penalty');
});

test('Pause is available in the main board and chat header, not as a floating clock action',()=>{
  assert.match(page,/id="btnPause"/);
  assert.match(page,/id="btnChatPause"/);
  assert.doesNotMatch(page,/id="btnChatView"/);
  assert.match(page,/\$\('btnPause'\)\.addEventListener/);
  assert.match(page,/\$\('btnChatPause'\)\.addEventListener/);
  assert.match(clock,/pauseBtn\.hidden=true/);
});

test('pawn exchange is rejected outside standard timed games on all layers',()=>{
  assert.match(clock,/const pawnRule = \(\) =>/);
  assert.match(page,/ChessClock\?\.pawnRule\?\.\(\)/);
  assert.match(pawnEdge,/\^\(10m\|12m\|15m\|m\[0-9\]\{1,3\}\)\$/);
  assert.match(sql,/Pawn exchanges require a normal timed game/);
  assert.match(sql,/end_reason='timeout'/);
  assert.match(submitEdge,/g\.clock_mode==='move60'/);
});

test('nameplate accent is tied to selected piece color, independent of turn',()=>{
  assert.match(page,/const chosen=plateRim\(side\)/);
  assert.match(page,/setProperty\('--plate-accent',chosen\)/);
  assert.match(page,/setProperty\('--plate-ring',chosen\)/);
  assert.match(page,/#plateTop:not\(\.turn\),#plateBottom:not\(\.turn\)/);
});
