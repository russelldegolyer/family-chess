/* Chess clock: shared board HUD for 3D and 2D, local and server-authoritative online games.
   Only Supabase may finalize online timeouts. The client merely displays time and requests settlement. */
(() => {
  'use strict';
  const MODES = Object.freeze({ off:0, '10m':600000, '12m':720000, '15m':900000, move60:60000 });
  const VALID = new Set(Object.keys(MODES));
  const prefKey = 'sg.chessClock';
  let preference = 'off';
  try { const saved = JSON.parse(localStorage.getItem(prefKey) || '"off"'); if (VALID.has(saved)) preference = saved; else if(saved==='move3')preference='move60'; } catch {}
  const hud = document.createElement('div');
  hud.id = 'chessClockHud';
  hud.hidden = true;
  hud.setAttribute('role','group');
  hud.setAttribute('aria-label','Chess game clocks');
  const nodes = {};
  for (const [side,label] of [['w','White'],['b','Black']]) {
    const node = document.createElement('div');
    node.className = 'chess-clock';
    node.dataset.side = side;
    const small = document.createElement('span'); small.className='chess-clock-label';small.textContent=label;
    const time = document.createElement('strong');time.className='chess-clock-time';time.textContent='—:—';
    node.append(small,time);
    hud.append(node);
    nodes[side] = {node,time};
  }
  document.getElementById('ui')?.append(hud);
  const style = document.createElement('style');
  style.textContent = `
    #chessClockHud[hidden]{display:none!important}
    #chessClockHud{position:absolute;left:var(--gl,16px);top:calc(var(--gt,16px) + 88px);
      z-index:2;display:flex;gap:8px;max-width:calc(100vw - var(--area-r,0px) - 32px);
      pointer-events:none;color:#f4f4f6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #chessClockHud .chess-clock{display:flex;align-items:center;gap:9px;min-width:108px;
      padding:8px 11px;background:rgba(18,18,21,.90);border:1px solid rgba(255,255,255,.20);
      border-radius:11px;box-shadow:0 6px 18px #0007;backdrop-filter:blur(10px)}
    #chessClockHud .chess-clock-label{font-size:11px;font-weight:650;color:#bcbcc4}
    #chessClockHud .chess-clock-time{font-size:21px;font-weight:750;letter-spacing:.015em;
      line-height:1.1;font-variant-numeric:tabular-nums}
    #chessClockHud .chess-clock.active{border-color:rgba(255,255,255,.75);
      background:rgba(39,39,43,.97);box-shadow:0 0 0 1px #ffffff15,0 8px 22px #000a}
    #chessClockHud .chess-clock.active .chess-clock-time{color:#fff}
    #chessClockHud .chess-clock.low{border-color:#d64a58;background:rgba(65,18,23,.97)}
    #chessClockHud .chess-clock.low .chess-clock-time{color:#ff9ca4}
    #chessClockHud .chess-clock.expired .chess-clock-time{color:#fa707d}
    body.clock-timed #status{display:none!important}
    @media(max-width:899px){
      #chessClockHud{top:max(58px,calc(var(--gt,16px) + 43px));left:8px;gap:5px;
        max-width:calc(100vw - 16px)}
      #chessClockHud .chess-clock{min-width:0;gap:6px;padding:5px 8px;border-radius:9px}
      #chessClockHud .chess-clock-label{font-size:10px}
      #chessClockHud .chess-clock-time{font-size:16px}
    }
    @media(max-width:360px){
      #chessClockHud .chess-clock-time{font-size:14px}
      #chessClockHud .chess-clock{padding:5px 6px}
    }`;
  document.head.append(style);

  const state = { source:null, mode:'off', status:'waiting', turn:'w', gameId:null,
    w:0,b:0,startedAt:0,history:[],onLocalTimeout:null,onOnlineTimeout:null,
    claimedAt:0, claimInFlight:false,clockState:'running',penaltySide:null,
    actorSide:null,viewSide:'w',bonusW:0,bonusB:0 };
  const parseDate = v => v ? new Date(v).getTime() || 0 : 0;
  const normalized = mode => VALID.has(mode) ? mode : 'off';
  const active = () => state.mode!=='off' && state.status==='active'
    && state.clockState==='running' && state.startedAt>0;
  const remaining = (side,at=Date.now()) => Math.max(0, state[side] -
    (active() && side===state.turn ? Math.max(0,at-state.startedAt) : 0));
  const stamp = ms => {
    const seconds = Math.ceil(Math.max(0,ms)/1000);
    return Math.floor(seconds/60) + ':' + String(seconds%60).padStart(2,'0');
  };
  function redraw() {
    const on = state.mode!=='off';
    const shown = !hud.hidden;
    hud.hidden = !on;
    document.body.classList.toggle('clock-timed',on);
    if (shown!==on) window.dispatchEvent(new Event('resize'));
    if (!on) return;
    const at = Date.now();
    for (const side of ['w','b']) {
      const left = remaining(side,at), selected = state.turn===side && state.status==='active';
      const n = nodes[side];
      const t = stamp(left);
      if (n.time.textContent!==t) n.time.textContent=t;
      n.node.classList.toggle('active',selected);
      n.node.classList.toggle('low',selected && left<=30000);
      n.node.classList.toggle('expired',left===0);
      n.node.setAttribute('aria-label',(side==='w'?'White':'Black')+' '+t+(selected?' to move':''));
    }
  }
  function tick() {
    redraw();
    if (!active() || remaining(state.turn)>0) return;
    if (state.source==='local') {
      state[state.turn]=0;
      state.startedAt=0;
      state.clockState='penalty';
      state.penaltySide=state.turn;
      redraw();
      state.onLocalTimeout?.(state.turn);
    } else if(state.source==='online' && state.onOnlineTimeout && state.gameId &&
      !state.claimInFlight && Date.now()-state.claimedAt>4000) {
      state.claimedAt=Date.now();
      state.claimInFlight=true;
      Promise.resolve().then(()=>state.onOnlineTimeout(state.gameId))
        .catch(()=>{}).finally(()=>{state.claimInFlight=false;});
    }
  }
  setInterval(tick,200);
  document.addEventListener('visibilitychange',tick);

  function getPreference(){return preference;}
  function setPreference(mode) {
    mode=normalized(mode);
    preference=mode;
    try { localStorage.setItem(prefKey,JSON.stringify(mode)); } catch {}
    return mode;
  }
  function startLocal(mode,onTimeout) {
    mode=normalized(mode);
    const limit=MODES[mode];
    Object.assign(state,{source:'local',mode,status:'active',turn:'w',gameId:null,
      clockState:'running',penaltySide:null,bonusW:0,bonusB:0,
      w:limit,b:limit,startedAt:mode==='off'?0:Date.now(),
      history:[{w:limit,b:limit,turn:'w'}],onLocalTimeout:onTimeout,onOnlineTimeout:null,
      claimedAt:0,claimInFlight:false});
    tick();
  }
  function moveLocal(nextTurn,ply,ended=false) {
    if (state.source!=='local' || state.mode==='off') return;
    const now=Date.now();
    const mover=state.turn;
    state[mover]=remaining(mover,now);
    if(state[mover]<=0) {tick();return;}
    if(state.mode==='move60') {
      const bonusKey=nextTurn==='w'?'bonusW':'bonusB';
      state[nextTurn]=60000+state[bonusKey];
      state[bonusKey]=0;
    }
    state.turn=nextTurn;
    state.status=ended?'over':'active';
    state.startedAt=ended?0:now;
    if(Number.isInteger(ply)&&ply>=0)state.history[ply]={w:state.w,b:state.b,turn:state.turn};
    tick();
  }
  function undoLocal(ply,nextTurn) {
    if (state.source!=='local'||state.mode==='off') return;
    const snap=state.history[ply] || state.history[0];
    if(!snap)return;
    state.history=state.history.slice(0,ply+1);
    state.w=snap.w;state.b=snap.b;
    state.turn=nextTurn;
    state.status='active';state.clockState='running';state.penaltySide=null;
    state.startedAt=Date.now();
    tick();
  }
  function stopLocal() {
    if(state.source!=='local')return;
    const at=Date.now();
    if(state.status==='active'&&state.mode!=='off')state[state.turn]=remaining(state.turn,at);
    state.status='over';state.startedAt=0;
    tick();
  }
  function showOnline(game,turn,onTimeout) {
    if(!game)return;
    const mode=normalized(game.clock_mode);
    const first=state.source!=='online'||state.gameId!==game.id;
    Object.assign(state,{source:'online',mode,gameId:game.id,turn:turn==='b'?'b':'w',
      status:game.status==='active'?'active':game.status==='finished'?'over':'waiting',
      clockState:game.clock_state||'running',penaltySide:game.clock_penalty_side||null,
      w:Math.max(0,Number(game.clock_white_ms)||0),
      b:Math.max(0,Number(game.clock_black_ms)||0),
      startedAt:parseDate(game.clock_turn_started_at),onOnlineTimeout:onTimeout,
      onLocalTimeout:null});
    if(first){state.claimedAt=0;state.claimInFlight=false;}
    tick();
  }
  function reset() {
    Object.assign(state,{source:null,mode:'off',status:'waiting',startedAt:0,gameId:null,
      clockState:'running',penaltySide:null,actorSide:null,
      onOnlineTimeout:null,onLocalTimeout:null,w:0,b:0,history:[],claimedAt:0,claimInFlight:false});
    tick();
  }
  window.ChessClock=Object.freeze({MODES,getPreference,setPreference,startLocal,moveLocal,
    undoLocal,stopLocal,showOnline,reset,remaining,check:tick,snapshot:()=>({...state,history:state.history.slice()})});
  tick();
})();
