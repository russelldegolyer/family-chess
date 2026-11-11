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
  "\n({activateChessColorProfile,clearChessColorProfile,myColor,setMyColor})",
  ctx,{timeout:1000});
 return {api,events};
}

test('a new session restores the White piece colour for the same signed-in profile',()=>{
 const storage=new Map();
 let {api,events}=makeColors(storage);
 api.activateChessColorProfile('account-A');
 api.setMyColor('#2857aa');
 assert.equal(api.myColor(),'#2857aa');
 assert.deepEqual(events,['familyChessPieceColorChanged']);
 ({api}=makeColors(storage));
 api.activateChessColorProfile('account-A');
 assert.equal(api.myColor(),'#2857aa');
});

test('a different account does not inherit the previous account colour',()=>{
 const storage=new Map();
 const {api}=makeColors(storage);
 api.activateChessColorProfile('first-account');
 api.setMyColor('#2857aa');
 api.activateChessColorProfile('second-account');
 assert.equal(api.myColor(),'#c60018');
 api.setMyColor('#aa5678');
 api.activateChessColorProfile('first-account');
 assert.equal(api.myColor(),'#2857aa');
});

test('the first account migrates a colour saved before profile support',()=>{
 const storage=new Map([['sg.myColor','#3a679c']]);
 const {api}=makeColors(storage);
 api.activateChessColorProfile('first');
 assert.equal(api.myColor(),'#3a679c');
 api.activateChessColorProfile('other');
 assert.equal(api.myColor(),'#c60018');
});

test('Black pieces are always black; the player colour paints only White',()=>{
 assert.match(page,/const BLACK_PIECES = COLOR_DEF\.opp;/);
 assert.match(page,/return \{ w, b: BLACK_PIECES \};/);
 assert.match(page,/return \{ w: mine, b: BLACK_PIECES \};/);
 assert.doesNotMatch(page,/setOppColor|CPU_COLOR|familyChessPracticeColorChanged/);
});

test('the White colour is persisted through signed-in events',()=>{
 assert.match(page,/familyChessPieceColorChanged/);
 assert.match(online,/select\('display_name,piece_color,clock_preference'\)/);
 assert.doesNotMatch(online,/practice_opponent_color|getPracticeOpponentColor/);
 assert.match(online,/savePendingColor\(kind,id\)/);
 assert.match(online,/localStorage\.setItem\(colorPendingKey\(kind,id\)/);
 assert.match(online,/native\.activateColorProfile\?\.\(id\)/);
});
