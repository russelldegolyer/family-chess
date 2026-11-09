/* Per-match Supabase chat. Only the match participants can read or send. */
(function familyChessChat() {
  'use strict';
  const db = window.chessSupabase;
  const list = document.getElementById('chatList');
  const input = document.getElementById('chatInput');
  const sendButton = document.getElementById('chatSend');
  if (!db || !list || !input || !sendButton) return;

  const state = {
    id: null, mode: null, view: null, messages: [], pending: [],
    loaded: false, error: '', generation: 0, channel: null, poll: null,
    sending: false, readBusy: false, reread: false, seen: new Set(), names: {}, clearing:false
  };

  const visible = () => {
    const panel = document.getElementById('panel');
    const history = document.getElementById('historyView');
    if (document.hidden || !panel || !history.hidden) return false;
    return window.innerWidth < 900 ? panel.classList.contains('open') : true;
  };
  const table=()=>state.mode==='watch'?'chess_spectator_messages':'chess_chat_messages';
  function canSend(v = state.view) {
    if (!v || !state.id || v.gameId !== state.id || !v.userId ||
        v.status!=='active' || state.sending || state.clearing) return false;
    if(state.mode==='watch') return v.mySeat == null;
    return state.mode==='play' && (v.mySeat==='w'||v.mySeat==='b') &&
      (v.userId===v.whiteId||v.userId===v.blackId);
  }
  function updateInput() {
    const permitted = canSend();
    input.disabled = !permitted;
    sendButton.disabled = !permitted;
    input.placeholder = state.mode === 'watch'
      ? (permitted ? 'Message other spectators…' : 'Spectator chat is closed')
      : !state.id
        ? 'Open a family game to chat'
        : state.view?.status === 'finished' || state.view?.status === 'over'
          ? 'This match has ended'
          : state.view?.status === 'waiting'
            ? 'Waiting for your opponent'
            : state.sending ? 'Sending…' : permitted ? 'Type a message…' : 'Chat unavailable';
  }
  function timeLabel(s) {
    const t = new Date(s);
    return Number.isNaN(t.getTime()) ? '' :
      t.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
  }
  function note(title, description) {
    const wrapper = document.createElement('div');
    wrapper.className = 'note chat-empty-state';
    const head = document.createElement('strong');
    head.className = 'chat-empty-title';
    head.textContent = title;
    const p = document.createElement('p');
    p.className = 'chat-empty-description';
    p.textContent = description;
    wrapper.append(head,p);
    return wrapper;
  }
  function paint(forceBottom=false) {
    updateInput();
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 96;
    if (!state.id) {
      list.replaceChildren(note('Messages', 'Open a private game to message your opponent.'));
      return;
    }
    if (state.mode==='play' && state.view?.mySeat == null) {
      list.replaceChildren(note('Private chat','Only the two chess players can read this conversation.'));
      return;
    }
    const frag=document.createDocumentFragment();
    const entries=[...state.messages,...state.pending]
      .sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at) || String(a.id).localeCompare(String(b.id)))
      .slice(-100);
    if (!entries.length) frag.append(note(state.mode==='watch'?'Spectator chat':'Messages',state.loaded
      ? (state.mode==='watch'?'No spectator messages yet. Say hello to everyone watching.':'No messages yet. Say hello to your opponent.')
      : 'Loading messages from this match…'));
    let previous=null;
    for (const msg of entries) {
      const mine = msg.sender_id === state.view?.userId;
      const side = msg.sender_id === state.view?.whiteId ? 'white'
        : msg.sender_id === state.view?.blackId ? 'black' : 'guest';
      const stamp=Date.parse(msg.created_at) || 0;
      const consecutive = previous && previous.sender_id === msg.sender_id &&
        stamp - (Date.parse(previous.created_at)||0) < 180000;
      const row = document.createElement('div');
      row.className = 'msg '+side+(mine?' mine':' theirs')+
        (consecutive?' cont':'')+(msg.pending?' pending':'');
      if (!consecutive) {
        const label = document.createElement('div');
        label.className='msg-name';
        label.textContent = mine ? 'You' : state.mode==='watch'
          ? (state.names[msg.sender_id] || 'Spectator')
          : side === 'white' ? (state.view?.whiteName || 'White')
          : side === 'black' ? (state.view?.blackName || 'Black') : 'Player';
        row.append(label);
      }
      const bubble=document.createElement('div');
      bubble.className='bubble';
      bubble.textContent=msg.body;
      const t=document.createElement('time');
      t.dateTime=msg.created_at;
      t.textContent=msg.pending?'Sending…':timeLabel(msg.created_at);
      row.append(bubble,t);
      frag.append(row);
      previous=msg;
    }
    if (state.error) {
      const p=document.createElement('p');
      p.className='note';
      p.style.color='#ff9898';
      p.textContent=state.error;
      frag.append(p);
    }
    list.replaceChildren(frag);
    if (forceBottom || nearBottom) list.scrollTop = list.scrollHeight;
  }

  function accept(rows, forceBottom=false, replace=false) {
    if (!state.id) return;
    const previous = new Set(state.messages.map(m=>m.id));
    const latest = new Map((replace?[]:state.messages).map(m=>[m.id,m]));
    for (const row of rows) {
      if (!row || row.game_id !== state.id || typeof row.body !== 'string') continue;
      latest.set(row.id,row);
      if (state.loaded && !previous.has(row.id) && !state.seen.has(row.id) &&
          row.sender_id !== state.view?.userId && !visible()) {
        const badge=document.getElementById('unread');
        if (badge) {
          const n = Math.min(9, Number(badge.dataset.supChatUnread||'0')+1);
          badge.dataset.supChatUnread=String(n);
          badge.textContent=n===9?'9+':String(n);
          badge.hidden=false;
        }
      }
      state.seen.add(row.id);
      state.pending = state.pending.filter(p=>p.id!==row.id);
    }
    state.messages = [...latest.values()]
      .sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at) || String(a.id).localeCompare(String(b.id)))
      .slice(-100);
    state.loaded=true;
    paint(forceBottom);
  }
  async function refresh() {
    if (!state.id || !['play','watch'].includes(state.mode)) return;
    if (state.readBusy) {state.reread=true;return;}
    state.readBusy=true;
    const id=state.id,generation=state.generation;
    try {
      const {data,error}=await db.from(table())
        .select('id,game_id,sender_id,body,created_at')
        .eq('game_id',id)
        .order('created_at',{ascending:false})
        .limit(100);
      if (id!==state.id||generation!==state.generation) return;
      if (error) {state.error='Messages could not load: '+error.message;paint();return;}
      state.error='';
      if(state.mode==='watch'&&data?.length){
        const ids=[...new Set(data.map(m=>m.sender_id))];
        const {data:players}=await db.from('chess_profiles')
          .select('id,display_name').in('id',ids);
        if(generation!==state.generation||id!==state.id)return;
        state.names=Object.fromEntries((players||[]).map(p=>[p.id,p.display_name]));
      }
      accept((data||[]).reverse(),false,true);
    } catch(e) {
      if (id===state.id&&generation===state.generation) {
        state.error='Messages could not load: '+(e?.message||'Check your connection.');
        paint();
      }
    } finally {
      if (generation===state.generation) {
        state.readBusy=false;
        if(state.reread) {state.reread=false;void refresh();}
      }
    }
  }
  function stop() {
    state.generation++;
    if(state.poll){clearInterval(state.poll);state.poll=null;}
    if(state.channel){void db.removeChannel(state.channel);state.channel=null;}
    state.id=null;state.mode=null;state.view=null;state.messages=[];state.pending=[];
    state.loaded=false;state.error='';state.sending=false;state.readBusy=false;
    state.clearing=false;state.names={};
    state.reread=false;state.seen.clear();
    const badge=document.getElementById('unread');
    if(badge){badge.dataset.supChatUnread='0';badge.hidden=true;}
    updateInput();
  }
  function begin(id,mode) {
    stop();
    if(!id)return;
    state.id=id;state.mode=mode;
    if(mode!=='play'&&mode!=='watch'){paint();return;}
    void refresh();
    state.channel=db.channel('family-chess-chat-'+mode+'-'+id)
      .on('postgres_changes',{
        event:'INSERT',schema:'public',table:table(),
        filter:'game_id=eq.'+id
      },({new:message})=>{
        if(id!==state.id)return;
        accept([message], true);
        if(state.mode==='watch'&&!state.names[message.sender_id])void refresh();
      })
      .on('postgres_changes',{
        event:'DELETE',schema:'public',table:table()
      },()=>{if(id===state.id)void refresh();})
      .subscribe();
    state.poll=setInterval(()=>{if(state.id===id)void refresh();},12000);
  }
  async function send(raw) {
    const text=String(raw||'').replace(/\s+/g,' ').trim().slice(0,400);
    if(!text)return;
    if(!canSend()) {
      if(!input.value)input.value=text;
      state.error='Open an active game to send messages.';
      paint();return;
    }
    const id=state.id,generation=state.generation,userId=state.view.userId;
    const messageId=crypto.randomUUID();
    const optimistic={
      id:messageId,game_id:id,sender_id:userId,body:text,
      created_at:new Date().toISOString(),pending:true
    };
    state.pending.push(optimistic);
    state.sending=true;state.error='';
    paint(true);
    try {
      const {data,error}=await db.from(table())
        .insert({id:messageId,game_id:id,sender_id:userId,body:text})
        .select('id,game_id,sender_id,body,created_at')
        .single();
      if (error) throw error;
      if(generation!==state.generation || id!==state.id)return;
      state.pending=state.pending.filter(m=>m.id!==messageId);
      accept([data],true);
    } catch(e) {
      if(generation!==state.generation||id!==state.id)return;
      state.pending=state.pending.filter(m=>m.id!==messageId);
      if(!input.value)input.value=text;
      state.error='Message not sent: '+(e?.message||'Please retry.');
      paint();
    } finally {
      if(generation===state.generation){
        state.sending=false;updateInput();
      }
    }
  }
  async function clear() {
    if(!state.id||!state.view?.userId)throw new Error('Open a game first.');
    const id=state.id,mode=state.mode,generation=state.generation,uid=state.view.userId;
    if(mode!=='play'&&mode!=='watch')throw new Error('No online chat selected.');
    if(state.clearing) return;
    state.clearing=true;updateInput();
    try {
      let q=db.from(table()).delete().eq('game_id',id);
      if(mode==='watch')q=q.eq('sender_id',uid);
      const {error}=await q;
      if(error)throw error;
      if(generation!==state.generation)return;
      state.pending=[];
      state.error='';
      await refresh();
    }finally{
      if(generation===state.generation){state.clearing=false;updateInput();}
    }
  }
  function render(view,forceBottom=false){
    state.view=view;
    const title=document.querySelector('#panel .chat-title');
    if(title) title.textContent=state.mode==='watch'?'Spectators':'Chat';
    const badge=document.getElementById('unread');
    if(visible()&&badge && badge.dataset.supChatUnread!=='0') {
      badge.dataset.supChatUnread='0';badge.hidden=true;
    }
    paint(forceBottom);
  }
  window.familyChessChat={ render, canSend, send, refresh, clear, mode:()=>state.mode };
  window.addEventListener('familyChessMatchChanged',event=>{
    const detail=event.detail||{};
    if(detail.id&&detail.mode){begin(detail.id,detail.mode);}
    else stop();
  });
  db.auth.onAuthStateChange((_event,session)=>{
    if(!session?.user) setTimeout(stop,0);
  });
})();
