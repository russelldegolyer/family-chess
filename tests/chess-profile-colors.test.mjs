import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const page=read('index.html');
const online=read('chess-online.js');
const migration=read('database/chess-profile-piece-colors-2026-11-09.sql');
const start=page.indexOf("if (!store.get('sg.colorsV2', false))");
const end=page.indexOf("/* the colour shown for each logical side",start);
assert.ok(start>=0&&end>start,'profile colour logic exists');
const fragment=page.slice(start,end);

function makeColors(storage){
 const events=[];
 const store={
  get(k,d){return storage.has(k)?storage.get(k):d;},
  set(k,v){storage.set(k,v);}
 };
 const ctx={
  store,G:{mode:'cpu',onlineProvider:null},PROG:{ready:false,P:null},
  VIEW:'3d',
  COLOR_DEF:{mine:'#c60018',opp:'#141414'},
  chromaOk:c=>typeof c==='string'&&/^#[0-9a-fA-F]{6}$/.test(c),
  window:{dispatchEvent:e=>events.push(e.type)},
  CustomEvent:class {constructor(type,opts){this.type=type;this.detail=opts.detail;}},
  applySideColors(){},updatePlates(){},draw2D(){}
 };
 const api=vm.runInNewContext(fragment+
  "\n({activateChessColorProfile,clearChessColorProfile,myColor,oppColor,setMyColor,setOppColor,cpuColor:()=>CPU_COLOR})",
  ctx,{timeout:1000});
 return {api,events};
}

test('new sessions restore both piece colors for the same signed-in profile',()=>{
 const storage=new Map();
 let {api}=makeColors(storage);
 api.activateChessColorProfile('account-A');
 api.setMyColor('#2857aa');
 api.setOppColor('#e7a938');
 assert.equal(api.myColor(),'#2857aa');
 assert.equal(api.oppColor(),'#e7a938');
 ({api}=makeColors(storage));
 api.activateChessColorProfile('account-A');
 assert.equal(api.myColor(),'#2857aa');
 assert.equal(api.oppColor(),'#e7a938');
 assert.equal(api.cpuColor(),'#e7a938');
});

test('a different account does not inherit the previous account colors',()=>{
 const storage=new Map();
 const {api}=makeColors(storage);
 api.activateChessColorProfile('first-account');
 api.setMyColor('#2857aa');api.setOppColor('#e7a938');
 api.activateChessColorProfile('second-account');
 assert.equal(api.myColor(),'#c60018');
 assert.equal(api.oppColor(),'#141414');
 api.setMyColor('#aa5678');
 api.activateChessColorProfile('first-account');
 assert.equal(api.myColor(),'#2857aa');
 assert.equal(api.oppColor(),'#e7a938');
});

test('the first account migrates custom colors saved before profile support',()=>{
 const storage=new Map([['sg.myColor','#3a679c'],['sg.oppColor','#d79933']]);
 const {api}=makeColors(storage);
 api.activateChessColorProfile('first');
 assert.equal(api.myColor(),'#3a679c');
 assert.equal(api.oppColor(),'#d79933');
 api.activateChessColorProfile('other');
 assert.equal(api.myColor(),'#c60018');
 assert.equal(api.oppColor(),'#141414');
});

test('player and practice color selections are persisted through signed-in events',()=>{
 assert.match(page,/familyChessPieceColorChanged/);
 assert.match(page,/familyChessPracticeColorChanged/);
 assert.match(page,/CPU_COLOR = oppColor\(\)/);
 assert.match(page,/set: \(hx\) => setOppColor\(hx\)/);
 assert.match(online,/piece_color,practice_opponent_color,clock_preference/);
 assert.match(online,/savePendingColor\(kind,id\)/);
 assert.match(online,/localStorage\.setItem\(colorPendingKey\(kind,id\)/);
 assert.match(online,/native\.activateColorProfile\?\.\(id\)/);
 assert.match(migration,/ADD COLUMN IF NOT EXISTS practice_opponent_color/);
 assert.match(migration,/chess_profiles_practice_opponent_color_hex/);
});
