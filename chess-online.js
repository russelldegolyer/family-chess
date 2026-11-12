/* Supabase match invitation setup. Live moves are not enabled yet. */
(function chessOnline() {
  'use strict';
  const api = window.chessSupabase;
  const account = document.getElementById('accountControl');
  if (!api || !account) return;
  const style = document.createElement('style');
  style.textContent = `
    #cgCreatedLink[hidden] {display:none!important}
    .cgCreatedLink {border:1px solid #55585d;background:#202024;border-radius:12px;padding:12px;
      display:flex;flex-direction:column;gap:11px;margin:0 0 16px}
    .cgCreatedLink strong {font-size:14px}
    .cgCreatedLink a {font-size:12px;color:#e9e9ff;overflow-wrap:anywhere;text-decoration:underline}
    .cgCreatedLink .cgButton {flex:1}
    #cgAccountEmail{color:#a1a1a9;font-size:12px;overflow-wrap:anywhere;line-height:1.5}
    #cgSignOutSlot{width:100%}
    #cgSignOutSlot #authSignOut.cgAccountSignOut{
      width:100%;min-height:44px;border:1px solid #675054;border-radius:10px;
      padding:10px 14px;background:#2d2225;color:#ffbdbd;
      font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      cursor:pointer;box-shadow:none;
    }
    #cgSignOutSlot #authSignOut.cgAccountSignOut:disabled{opacity:.5;cursor:wait}
    .cgInput {font-size:16px!important}
    #cgWatchShortcut{display:none!important}

    #cgLaunch {background:#f2f2f2;color:#111;border:0;border-radius:7px;padding:7px 10px;font-size:12px;font-weight:700;cursor:pointer}
    #cgLobby[hidden]{display:none!important}
    #cgLobby{position:fixed;inset:0;z-index:180;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f5f5f5}
    .cgShade{position:absolute;inset:0;background:#000c}
    .cgPanel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,calc(100% - 24px));max-height:calc(100dvh - 24px);overflow:auto;background:#111;border:1px solid #383838;border-radius:16px;padding:22px;box-shadow:0 20px 60px #000c}
    .cgHeader,.cgRow{display:flex;gap:9px;align-items:center}
    .cgHeader{justify-content:space-between}
    .cgHeader h2{font-size:23px;margin:0 0 6px}
    .cgMuted{color:#aaa;font-size:12px;line-height:1.6}
    .cgLabel{display:block;color:#ccc;font-size:12px;font-weight:650;margin:17px 0 7px}
    .cgInput{flex:1;min-width:0;width:100%;min-height:43px;background:#1c1c1c;border:1px solid #444;border-radius:9px;color:#fff;padding:10px;font:inherit}
    .cgButton{min-height:43px;border:1px solid #555;border-radius:9px;background:#242424;color:#fff;font:600 13px inherit;padding:9px 12px;cursor:pointer}
    .cgButton.primary{background:#eee;color:#111;border-color:#eee;width:100%;font-weight:700}
    .cgButton:disabled{opacity:.5;cursor:default}
    #cgGames{margin-top:6px;border-radius:12px;overflow:hidden;background:#1a1a1c}
    .cgGame{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;border:0;background:none;color:#fff;font:inherit;text-align:left;cursor:pointer}
    .cgGame+.cgGame{box-shadow:inset 0 .5px 0 #3a3a3c}
    .cgGame:active{background:#232326}
    .cgBadge{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:9px;font:800 14px/1 inherit;letter-spacing:-.02em}
    .cgBadge.win{background:#1f6f3a;color:#c9f7d6}.cgBadge.loss{background:#7a2323;color:#ffd0d0}
    .cgBadge.draw{background:#3a3a3e;color:#e5e5ea}.cgBadge.live{background:#0a5fc2;color:#fff;font-size:9px}
    .cgBadge.wait{background:#5b4513;color:#ffe2a3;font-size:9px}.cgBadge.void{background:#262628;color:#8e8e93}
    .cgGameText{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
    .cgGameText b{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .cgGameText span{font-size:12px;color:#8e8e93;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .cgGameCopy{flex:none;min-height:30px;padding:0 10px;border:0;border-radius:999px;background:#2c2c2e;color:#0a84ff;font:600 12px inherit;cursor:pointer}
    .cgChevron{flex:none;color:#636366;font-size:18px}
    #cgMessage{min-height:20px;color:#ccc;font-size:12px;line-height:1.5;margin-top:12px}
    #cgMessage.error{color:#ffa7a7}
    .cgLiveCount{color:#b2f1c2;font-size:12px;font-weight:600;white-space:nowrap}
    .cgLiveList{display:flex;flex-direction:column;gap:9px}
    .cgLiveList{gap:0!important;border-radius:14px;overflow:hidden;background:#2c2c2e}
    .cgLiveCard{display:flex;align-items:center;gap:12px;padding:10px 12px;min-height:56px}
    .cgLiveCard+.cgLiveCard{box-shadow:inset 0 .5px 0 #3a3a3c}
    .cgLiveText{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
    .cgLiveCard .cgButton.cgWatch{flex:none;width:auto!important;margin:0!important;min-height:34px;padding:0 14px;border:0;border-radius:999px;background:#3a3a3c;color:#fff;font-size:14px}
    .cgLiveTitle{font-size:15px;line-height:1.25;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .cgLiveMeta{display:block;color:#8e8e93;font-size:12px}
    .cgLiveTag{flex:none;width:9px;height:9px;margin:0 6px;border-radius:50%;background:#30d158;box-shadow:0 0 0 4px rgba(48,209,88,.15)}
    .cgWatch{width:100%;background:#e9f2eb;color:#101811;border:0;font-weight:700}
    #cgWatchShortcut{position:fixed;z-index:70;top:max(72px,calc(env(safe-area-inset-top,0px) + 62px));left:max(12px,env(safe-area-inset-left,0px));
      border:1px solid #3b7650;border-radius:999px;padding:10px 14px;background:#15251b;color:#d8f9e4;
      box-shadow:0 6px 25px #0009;cursor:pointer;font:650 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #cgSpectatorBar{position:fixed;z-index:70;top:max(72px,calc(env(safe-area-inset-top,0px) + 62px));left:max(12px,env(safe-area-inset-left,0px));
      max-width:calc(100vw - 24px);display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:7px 8px 7px 11px;
      border:1px solid #38443c;border-radius:12px;background:#142019;color:#def4e5;font-size:12px;box-shadow:0 8px 28px #0009}
    #cgSpectatorBar .cgLeave{border:0;border-radius:8px;background:#303b33;color:#fff;padding:8px 11px;min-height:34px;cursor:pointer}
    @media(max-width:600px){.cgPanel{top:auto;bottom:0;left:0;transform:none;width:100%;border-radius:16px 16px 0 0;max-height:calc(100dvh - 15px);padding-bottom:max(22px,env(safe-area-inset-bottom,0px))}}
    /* ---- simplified lobby: one sheet, players first, everything else quiet ---- */
    .cgPanel{background:#1c1c1e;border:0;border-radius:22px;padding:8px 16px 18px}
    @media(max-width:600px){.cgPanel{border-radius:22px 22px 0 0;padding-bottom:max(18px,env(safe-area-inset-bottom,0px))}}
    .cgGrab{width:36px;height:5px;border-radius:3px;background:#48484a;margin:0 auto 10px}
    @media(min-width:601px){.cgGrab{display:none}}
    .cgTop{display:flex;align-items:center;justify-content:space-between;margin:2px 0 14px}
    .cgTop h2{margin:0;font:700 24px/1.1 -apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif;letter-spacing:-.02em}
    .cgX{display:grid;place-items:center;width:30px;height:30px;border:0;border-radius:50%;background:#2c2c2e;color:#aeaeb2;cursor:pointer}
    .cgSection{display:flex;align-items:baseline;justify-content:space-between;margin:20px 4px 8px;font:600 13px/1 -apple-system,BlinkMacSystemFont,sans-serif;color:#8e8e93;text-transform:uppercase;letter-spacing:.04em}
    .cgSection .cgLiveCount{text-transform:none;letter-spacing:0}
    .cgLink{border:0;background:none;color:#0a84ff;font:500 15px/1 -apple-system,BlinkMacSystemFont,sans-serif;padding:4px 0;cursor:pointer;text-transform:none;letter-spacing:0}
    .cgQuick{display:grid;grid-template-columns:1fr;gap:8px;margin:12px 0 0}
    .cgQuick button:not([hidden]){display:flex;align-items:center;justify-content:center;gap:7px;min-height:46px;border:0;border-radius:14px;background:#2c2c2e;color:#f2f2f7;font:600 14px/1 -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer}
    .cgCancelInvite{align-self:center;color:#ff6961;font-size:15px}
    .cgGameCopy.cgGameCancel{color:#ff6961}
    .cgQuick button.cgSmallLink:not([hidden]){min-height:30px;background:none;color:#0a84ff;font-size:13px;font-weight:500}
    .cgMore{display:block;width:100%;padding:9px;border:0;background:none;color:#0a84ff;font:500 13px/1 -apple-system,sans-serif;cursor:pointer}
    .cgCreatedLink{margin:10px 0 0;padding:14px;border:0;border-radius:16px;background:#2c2c2e;gap:10px}
    .cgCreatedHead{display:flex;flex-direction:column;gap:3px}
    .cgCreatedLink a{font-size:12px;color:#8e8e93;text-decoration:none}
    .cgCreatedLink .cgButton{min-height:42px;border:0;border-radius:12px;background:#3a3a3c}
    .cgCreatedLink .cgButton.primary{background:#0a84ff;color:#fff;width:auto}
    .cgNotifyRow .cgInput{min-height:42px;border:0;border-radius:12px;background:#3a3a3c}
    #cgMessage{min-height:0;margin:8px 4px 0;color:#8e8e93}
    #cgMessage:empty{display:none}
    #cgLiveBlock:not(:has(.cgLiveCard)){display:none}
    .cgSettings{margin:22px 0 0;border-radius:14px;background:#2c2c2e;padding:0 14px}
    .cgSettings>summary{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:48px;list-style:none;cursor:pointer;font:500 16px/1 -apple-system,BlinkMacSystemFont,sans-serif;color:#f2f2f7}
    .cgSettings>summary::-webkit-details-marker{display:none}
    .cgSettings>summary::after{content:"›";color:#636366;font-size:20px;transition:transform .2s}
    .cgSettings[open]>summary::after{transform:rotate(90deg)}
    .cgSettingsName{margin-left:auto;color:#8e8e93;font-size:15px;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cgSettingsBody{display:flex;flex-direction:column;gap:16px;padding:4px 0 16px;border-top:.5px solid #3a3a3c}
    .cgSettingsBody .cgLabel{margin:12px 0 7px;color:#8e8e93;font-weight:600;text-transform:uppercase;letter-spacing:.04em;font-size:11px}
    .cgSettingsBody .cgInput{min-height:42px;border:0;border-radius:12px;background:#3a3a3c}
    .cgSettingsBody .cgButton{min-height:42px;border:0;border-radius:12px;background:#3a3a3c}
    #cgNotifySlot .cgButton{width:100%;margin-top:8px}
    #cgNotifySlot .cgSocialSub{margin:8px 2px 0}
    .cgBack{display:block;margin:16px auto 0;font-size:15px}
  `;
  document.head.appendChild(style);
  const launch = document.createElement('button');
  launch.id = 'cgLaunch'; launch.type = 'button'; launch.textContent = 'Online games'; launch.hidden = true;
  // The account controls were moved into a nested actions panel; inserting
  // against the outer account div aborts initialization on mobile.
  const accountActions = document.getElementById('authAccountActions') || account;
  const signOut = document.getElementById('authSignOut');
  accountActions.insertBefore(launch, signOut);
  const root = document.createElement('div');
  root.id = 'cgLobby'; root.hidden = true; root.setAttribute('role','dialog'); root.setAttribute('aria-modal','true'); root.setAttribute('aria-label','Chess online games');
  root.innerHTML = `
    <div class="cgShade"></div><section class="cgPanel">
      <div class="cgGrab" aria-hidden="true"></div>
      <div class="cgTop"><h2>Play online</h2>
        <button class="cgX" id="cgClose" type="button" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></button></div>
      <div id="cgSocialMount"></div>
      <div id="cgLobbyActions" class="cgQuick" aria-label="More ways to play">
        <button id="cgGoLink" class="cgSmallLink" type="button">or share an invite link</button>
      </div>
      <div id="cgCreatedLink" class="cgCreatedLink" hidden>
        <div class="cgCreatedHead"><strong>Invite link ready</strong><span class="cgMuted">Anyone with it can join as your opponent</span></div>
        <a id="cgNewInviteURL" href="#" rel="nofollow" target="_blank"></a>
        <div class="cgRow">
          <button id="cgShareNewInvite" class="cgButton primary" type="button">Share</button>
          <button id="cgCopyNewInvite" class="cgButton" type="button">Copy</button>
        </div>
        <div class="cgRow cgNotifyRow">
          <select id="cgInviteRecipient" class="cgInput" aria-label="Notify a player">
            <option value="">Or notify a player…</option>
          </select>
          <button id="cgNotifyInvite" class="cgButton" type="button">Notify</button>
        </div>
        <button id="cgCancelInvite" class="cgLink cgCancelInvite" type="button">Cancel invite</button>
      </div>
      <div class="cgRecord" id="cgRecord" aria-label="Your record">
        <button class="cgRecCard" id="cgRecOnlineCard" type="button" aria-label="Stats vs players"><span class="cgRecHead"><span>vs Players</span><em>›</em></span><span id="cgRecOnline"></span></button>
        <button class="cgRecCard" id="cgRecCpuCard" type="button" aria-label="Stats vs the computer"><span class="cgRecHead"><span>vs Computer</span><em>›</em></span><span id="cgRecCpu"></span></button>
      </div>
      <div id="cgMessage" role="status" aria-live="polite"></div>
      <div class="cgBlock" id="cgLiveBlock">
        <div class="cgSection"><span>Live now</span><span id="cgLiveCount" class="cgLiveCount" aria-live="polite"></span></div>
        <div id="cgLiveGames" class="cgLiveList"><span class="cgMuted">Checking for live matches…</span></div>
      </div>
      <div class="cgBlock">
        <div class="cgSection"><span>My matches</span><button class="cgLink" id="cgRefresh" type="button">Refresh</button></div>
        <div id="cgGames" class="cgMuted">No matches yet.</div>
      </div>
      <details class="cgSettings" id="cgSettings">
        <summary>Settings<span class="cgSettingsName" id="cgNameValue">Loading…</span></summary>
        <div class="cgSettingsBody">
          <form id="cgProfileForm"><label class="cgLabel" for="cgDisplayName">Chess name</label>
            <div class="cgRow"><input id="cgDisplayName" class="cgInput" type="text" autocomplete="nickname"
              autocapitalize="words" required minlength="2" maxlength="40">
            <button class="cgButton" type="submit">Save</button></div></form>
          <div id="cgNotifySlot"><span class="cgLabel">Challenge notifications</span></div>
          <form id="cgJoinForm"><label class="cgLabel" for="cgJoinId">Join with a link</label>
            <div class="cgRow"><input id="cgJoinId" class="cgInput" type="text" placeholder="Paste a game link" required>
            <button class="cgButton" type="submit">Join</button></div></form>
          <button id="cgCreate" type="button" hidden>Create private match</button>
          <div class="cgAccountBody" id="cgAccountSettings"><span class="cgLabel">Account</span><span id="cgAccountEmail"></span><div id="cgSignOutSlot"></div></div>
        </div>
      </details>
      <button id="cgPractice" class="cgLink cgBack" type="button">Back to playing the computer</button>
    </section>`;
  document.body.appendChild(root);
  // Preserve the authenticated sign-out handler by moving the original
  // button into the new Online Games account settings.
  signOut.classList.add('cgAccountSignOut');
  document.getElementById('cgSignOutSlot').appendChild(signOut);
  const watchShortcut=document.createElement('button');
  watchShortcut.id='cgWatchShortcut';watchShortcut.type='button';watchShortcut.hidden=true;
  watchShortcut.textContent='● Live games';watchShortcut.addEventListener('click',show);
  document.body.appendChild(watchShortcut);
  const spectatorBar=document.createElement('div');
  spectatorBar.id='cgSpectatorBar';spectatorBar.hidden=true;
  const spectatorLabel=document.createElement('strong');
  const leaveWatch=document.createElement('button');
  leaveWatch.className='cgLeave';leaveWatch.type='button';leaveWatch.textContent='Exit';
  spectatorBar.append(spectatorLabel,leaveWatch);document.body.appendChild(spectatorBar);
  const $ = id => document.getElementById(id);
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let player = null, invitePresented = false;
  let shownMatch = null, matchId = null, matchMode = null, timer = null, subscription = null, pendingRead = false, again = false, syncToken = 0;
  let livePromptSeen=false, liveCount=0, livePoll=null;
  const validColor=(v)=>typeof v==='string'&&/^#[0-9a-fA-F]{6}$/.test(v);
  const colorColumns={mine:'piece_color'};
  const colorSaveTimers={mine:null};
  const colorSaveChains={mine:Promise.resolve()};
  const colorPendingKey=(kind,id)=>'sg.pendingChessColor.'+kind+'.'+id;
  const pendingColor=(kind,id)=>{
    try{return localStorage.getItem(colorPendingKey(kind,id));}
    catch{return null;}
  };
  const storePendingColor=(kind,id,hex)=>{
    try{localStorage.setItem(colorPendingKey(kind,id),hex.toLowerCase());}
    catch{/* Local storage may be disabled. */}
  };
  const clearPendingColor=(kind,id,hex)=>{
    try{
      if(pendingColor(kind,id)===hex)localStorage.removeItem(colorPendingKey(kind,id));
    }catch{/* Keep the current session usable without storage. */}
  };
  // Store edits on the device immediately; serialize and retry cloud updates.
  // If Safari closes the app mid-save, the pending value survives until login.
  function savePendingColor(kind,id){
    const column=colorColumns[kind];
    if(!column||!id)return Promise.resolve();
    colorSaveChains[kind]=colorSaveChains[kind].catch(()=>{}).then(async()=>{
      const hex=pendingColor(kind,id);
      if(!validColor(hex))return;
      const {error}=await api.from('chess_profiles')
        .update({[column]:hex.toLowerCase()}).eq('id',id);
      if(error){
        if(player?.id===id)status('Could not sync your saved colors: '+error.message,true);
        return;
      }
      clearPendingColor(kind,id,hex);
      if(kind==='mine'&&matchId&&player?.id===id)void syncMatch();
    });
    return colorSaveChains[kind];
  }
  function queueProfileColor(kind,hex){
    const id=player?.id;
    if(!id||!validColor(hex))return;
    storePendingColor(kind,id,hex);
    clearTimeout(colorSaveTimers[kind]);
    // Continuous colour-wheel dragging should not flood the database.
    colorSaveTimers[kind]=setTimeout(()=>void savePendingColor(kind,id),250);
  }
  window.addEventListener('familyChessPieceColorChanged',
    ev=>queueProfileColor('mine',ev.detail?.color));
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden||!player)return;
    for(const kind of ['mine']){
      clearTimeout(colorSaveTimers[kind]);
      if(validColor(pendingColor(kind,player.id)))
        void savePendingColor(kind,player.id);
    }
  });
  const invite = new URL(location.href).searchParams.get('game') || '';
  if (pattern.test(invite)) $('cgJoinId').value = invite;
  const status = (s, bad=false) => { $('cgMessage').textContent = s; $('cgMessage').classList.toggle('error', bad); };
  const link = id => location.origin + '/?game=' + encodeURIComponent(id);
  function getId(value) {
    const trimmed = value.trim();
    if (!trimmed.includes('://')) return trimmed;
    try { return new URL(trimmed).searchParams.get('game') || ''; } catch { return ''; }
  }
  async function copy(value) {
    try { await navigator.clipboard.writeText(value); status('Invitation copied.'); }
    catch { status('Copy this link manually: ' + value); }
  }
  function show() {
    if(!player){window.familyChessLobbyRequested=true;return;}
    window.familyChessLobbyRequested=false;
    root.hidden=false;
    document.getElementById('authAccountToggle')?.setAttribute('aria-expanded','true');
    void refresh();void loadInviteRecipients();
    $('cgClose').focus();
  }
  function close() {
    root.hidden=true;
    const profileButton=document.getElementById('authAccountToggle');
    profileButton?.setAttribute('aria-expanded','false');
    if(profileButton&&getComputedStyle(profileButton).display!=='none')profileButton.focus();
    else launch.focus();
  }
  window.familyChessOpenLobby = show;
  $('cgGoLink').addEventListener('click',()=>{void createInvite();});
  $('cgCopyNewInvite').addEventListener('click',()=>{
    const url=$('cgNewInviteURL').href;
    if(url&&url!=='#')void copy(url);
  });
  $('cgShareNewInvite').addEventListener('click',async()=>{
    const url=$('cgNewInviteURL').href;
    if(!url||url==='#')return;
    if(navigator.share) {
      try {await navigator.share({title:'Chess invitation',text:'Join me for a chess game.',url});}
      catch(e){if(e?.name!=='AbortError')status('Unable to share: '+e.message,true);}
    } else void copy(url);
  });

  async function loadInviteRecipients(){
    if(!player)return;
    const selected=$('cgInviteRecipient').value;
    const {data,error}=await api.from('chess_profiles')
      .select('id,display_name').neq('id',player.id).order('display_name').limit(100);
    if(error){status('Could not list players: '+error.message,true);return;}
    const el=$('cgInviteRecipient');
    el.replaceChildren(new Option('Choose a player…',''));
    for(const p of data||[])el.add(new Option(p.display_name,p.id));
    if([...el.options].some(x=>x.value===selected))el.value=selected;
  }
  $('cgNotifyInvite').addEventListener('click',async()=>{
    if(!player||creating)return;
    {
      const gameId=$('cgNewInviteURL').href.split('game=')[1]?.split('&')[0];
      const target=$('cgInviteRecipient').value;
      if(!target){status('Select a player to notify.',true);return;}
      if(!pattern.test(gameId||'')){status('Create a new invitation first.',true);return;}
      const button=$('cgNotifyInvite');button.disabled=true;
      try{
        const {data:id,error}=await api.rpc('chess_send_invite_to_player',{
          p_game_id:gameId,p_target:target});
        if(error)throw error;
        const {data:push,error:pushError}=await api.functions.invoke('chess-notify-challenge',{
          body:{challenge_id:id}});
        if(pushError)throw new Error('Invitation sent, but the push service could not be reached.');
        const sent=Number(push?.sent||0),failed=Number(push?.failed||0);
        status(sent>0?'Push accepted by '+sent+' device endpoint'+(sent===1?'':'s')+'.':
          push?.configured===false?'Invitation saved, but server push is not configured.':
          failed>0?'Invitation saved, but push delivery failed on '+failed+' device(s).':
          'Invitation saved, but no subscribed device received the push.');
      }catch(e){status('Could not notify player: '+(e?.message||'Unknown error'),true);}
      finally{button.disabled=false;}
    }
  });

  // Server data is authoritative. No browser can directly update the game or move tables.
  function stopMatch() {
    matchId=null;matchMode=null;
    window.dispatchEvent(new CustomEvent('familyChessMatchChanged',{detail:{id:null}}));
    spectatorBar.hidden=true;
    watchShortcut.hidden=!player||liveCount===0;
    syncToken++;
    if (timer) { clearInterval(timer); timer = null; }
    if (subscription) { const old=subscription; subscription=null; void api.removeChannel(old); }
  }
  window.familyChessOnlineStop = stopMatch;

  async function nativeBoard() {
    if (window.familyChessNative) return window.familyChessNative;
    await new Promise(resolve=>{
      window.addEventListener('familyChessNativeReady',resolve,{once:true});
      setTimeout(resolve,15000);
    });
    if (!window.familyChessNative) throw new Error('The chess board did not load. Refresh the page.');
    return window.familyChessNative;
  }

  async function syncMatch() {
    if (!matchId || !player) return;
    if (pendingRead) { again = true; return; }
    pendingRead = true;
    const id=matchId, uid=player.id, epoch=syncToken;
    try {
      const {data:g,error:gameError}=await api.from('chess_games')
        .select('id,white_player_id,black_player_id,status,current_fen,result,end_reason,created_at,updated_at,clock_mode,clock_white_ms,clock_black_ms,clock_turn_started_at,clock_state,clock_penalty_side,clock_paused_by,resumed_plies,start_fen')
        .eq('id',id).maybeSingle();
      if (gameError) throw gameError;
      if (!g) {
        if (shownMatch===id) { stopMatch(); window.familyChessNative?.leaveToPractice(); root.hidden=true; status('That match was closed.'); return false; }
        throw new Error('This match is private or no longer available.');
      }
      const isPlayer=g.white_player_id===uid||g.black_player_id===uid;
      const isWatcher=matchMode==='watch';
      if(isWatcher){
        if(g.status!=='active'&&g.status!=='finished')throw new Error('This game is not available to watch.');
        if(!g.black_player_id)throw new Error('The second player has not joined yet.');
      }else if(!isPlayer)throw new Error('You are not a player in this match. Use Watch live to spectate.');
      const {data:moves,error:movesError}=await api.from('chess_moves')
        .select('ply,move_uci').eq('game_id',id).order('ply',{ascending:true}).limit(1001);
      if (movesError) throw movesError;
      if (!moves || moves.length > 1000 || moves.some((m,i)=>m.ply!==i+1)) throw new Error('Move history is inconsistent.');
      if (epoch !== syncToken || matchId !== id || player?.id !== uid) return;
      const {data:actions,error:actionsError}=await api.from('chess_clock_actions')
        .select('id,after_ply,kind,square,fen_after,actor_id')
        .eq('game_id',id).order('id',{ascending:true}).limit(200);
      if(actionsError)throw actionsError;
      if(epoch!==syncToken||matchId!==id||player?.id!==uid)return;
      const ids=[g.white_player_id,g.black_player_id].filter(Boolean);
      const {data:profiles}=await api.from('chess_profiles').select('id,display_name,piece_color').in('id',ids);
      if (epoch !== syncToken || matchId !== id || player?.id !== uid) return;
      const labels=Object.fromEntries((profiles||[]).map(p=>[p.id,p.display_name]));
      const colors=Object.fromEntries((profiles||[]).filter(p=>validColor(p.piece_color))
        .map(p=>[p.id,p.piece_color.toLowerCase()]));
      const native=await nativeBoard();
      if (epoch !== syncToken || matchId !== id || player?.id !== uid) return;
      await native.present(g,moves.map(m=>m.move_uci),uid,labels,colors,
        {spectating:isWatcher,actions:actions||[]});
      shownMatch=id;
      if(isWatcher){
        spectatorLabel.textContent=`Watching · ${labels[g.white_player_id]||'White'} vs ${labels[g.black_player_id]||'Black'}`;
        spectatorBar.hidden=false;
      }
      if(isWatcher)status(`${g.status==='finished'?'Final':'Live'} · Watching ${labels[g.white_player_id]||'White'} vs ${labels[g.black_player_id]||'Black'} · read-only`);
      else if (g.status==='waiting') status('Waiting for your opponent to join. Share the invitation link.');
      else status('Live match connected · '+moves.length+' half-moves saved.');
      return true;
    } catch(e) {
      if (epoch === syncToken) status('Could not sync board: '+(e?.message||'Unknown error'),true);
      return false;
    } finally {
      pendingRead = false;
      if (again) {again=false;if(matchId) void syncMatch();}
    }
  }

  async function startMatch(id,mode='play',reviewAfterLoad=false) {
    if (!player || !pattern.test(id)) throw new Error('Sign in and choose a valid game.');
    // Keep the lobby visible if the game cannot be opened.
    for (let i=0;i<25 && pendingRead;i++) await new Promise(resolve=>setTimeout(resolve,120));
    if (pendingRead) throw new Error('A previous game is still loading.');
    stopMatch();
    window.familyChessNative?.endPractice?.();
    matchId=id;matchMode=mode;
    window.dispatchEvent(new CustomEvent('familyChessMatchChanged',{detail:{id,mode}}));
    watchShortcut.hidden=true;
    status(mode==='watch'?'Connecting to live spectator view…':'Loading shared board…');
    const loaded = await syncMatch();
    if (!loaded || matchId !== id) {
      stopMatch();
      root.hidden = false;
      throw new Error($('cgMessage').textContent || 'Unable to open this match.');
    }
    root.hidden = true;
    if (reviewAfterLoad) window.familyChessNative?.openReview?.();
    subscription = api.channel('chess-match-'+id)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'chess_games',filter:'id=eq.'+id},
        ()=>{void syncMatch();})
      .subscribe();
    timer = setInterval(()=>{if(matchId===id) void syncMatch();},3000);
  }

  window.familyChessOpenMatch = (id,mode='play') => startMatch(id,mode);
  window.familyChessClaimTimeout = async (id) => {
    if (!player || !matchId || matchId!==id || matchMode!=='play') return false;
    const {data,error}=await api.rpc('chess_claim_timeout',{p_game_id:id});
    if(error)throw new Error(error.message || 'Could not verify game clock.');
    if(data && matchId===id) await syncMatch();
    return !!data;
  };
  window.familyChessPause = async id => {
    if(!player||matchId!==id||matchMode!=='play')throw new Error('Sign in as a player');
    const {data,error}=await api.rpc('chess_toggle_clock_pause',{p_game_id:id});
    if(error)throw new Error(error.message||'Could not pause game');
    await syncMatch();return data;
  };
  window.familyChessPawnAction = async (id,action,square) => {
    if(!player||matchId!==id||matchMode!=='play')throw new Error('Sign in as a player');
    const {data,error}=await api.functions.invoke('chess-clock-action',{
      body:{game_id:id,action,pawn_square:square??null}
    });
    if(error)throw new Error(data?.error||error.message||'Pawn action unavailable');
    if(!data?.ok)throw new Error(data?.error||'Pawn choice rejected');
    await syncMatch();return data;
  };
  /* change the clock of the open online match; the server shifts both clocks and realtime syncs the opponent */
  window.familyChessChangeClock = async (id,mode) => {
    if(!player||matchId!==id||matchMode!=='play')throw new Error('Only a player can change this clock');
    const {data,error}=await api.rpc('chess_change_clock',{p_game_id:id,p_mode:mode});
    if(error)throw new Error(/function|schema cache/i.test(error.message||'')?'Live clock changes need the new database update.':(error.message||'Could not change the clock'));
    await syncMatch();return data;
  };
  window.familyChessSaveClockPreference = async mode => {
    if(!['off','10m','12m','15m','move60'].includes(mode))throw new Error('Invalid clock selection');
    if(!player)return false;
    const {error}=await api.from('chess_profiles').update({clock_preference:mode}).eq('id',player.id);
    if(error)throw new Error(error.message||'Could not save clock preference');
    return true;
  };
  window.familyChessCurrentMatch = () => matchId;
  window.familyChessCurrentMatchMode = () => matchMode;
  // Only a signed-in player in this active shared match may resign.
  // The database RPC validates ownership and records the winner atomically.
  window.familyChessResign = async (id) => {
    if(!player || !matchId || matchId !== id || matchMode !== 'play') {
      throw new Error('Open your active online match to resign.');
    }
    const {data,error}=await api.rpc('chess_resign_game',{p_game_id:id});
    if(error) throw new Error(error.message || 'Could not resign the game.');
    await syncMatch();
    return data;
  };

  window.familyChessSubmitMove = async (id,move) => {
    if (!player || !matchId || id !== matchId || matchMode!=='play') throw new Error('Only participating players can submit moves.');
    const {data,error}=await api.functions.invoke('chess-submit-move',{
      body:{game_id:id,move_uci:move}
    });
    if (error) {
      let message = error.message || 'Move was not saved.';
      try { const details=await error.context?.json(); if(details?.error)message=details.error; } catch {}
      await syncMatch();
      throw new Error(message);
    }
    if (!data?.ok) {await syncMatch();throw new Error(data?.error||'Move was not saved.');}
    await syncMatch();
    return data;
  };
  function leaveSpectating(){
    if(matchMode!=='watch')return;
    stopMatch();
    window.familyChessNative?.leaveToPractice();
    show();
  }
  leaveWatch.addEventListener('click',leaveSpectating);
  $('cgPractice').addEventListener('click',()=>{
    window.familyChessNative?.leaveToPractice();
    stopMatch(); close();
  });

  launch.addEventListener('click', show);
  $('cgClose').addEventListener('click', close);
  root.querySelector('.cgShade').addEventListener('click', close);
  document.addEventListener('keydown', ev => { if(ev.key==='Escape'&&!root.hidden)close(); });
  async function ensureProfile() {
    const id=player?.id;
    if(!id)return;
    // Always select the correct local profile before reading saved colours.
    // The signed-in profile then overrides its cache, except for unsynced edits.
    let native;
    try{native=await nativeBoard();}
    catch(e){status('Could not open your saved color settings: '+e.message,true);return;}
    if(player?.id!==id)return;
    native.activateColorProfile?.(id);
    const {data,error}=await api.from('chess_profiles')
      .select('display_name,piece_color,clock_preference')
      .eq('id',id).maybeSingle();
    if(player?.id!==id)return;
    if(error){status('Could not load chess profile: '+error.message,true);return;}
    if(data){
      if(window.ChessClock&&data.clock_preference)
        window.ChessClock.setPreference(data.clock_preference);
      $('cgDisplayName').value=data.display_name;
      $('cgNameValue').textContent=data.display_name;
      const hydrate=[
        ['mine',data.piece_color,'getAccountColor','setAccountColor']
      ];
      for(const [kind,remote,getter,setter] of hydrate){
        const pending=pendingColor(kind,id);
        if(validColor(pending)){
          native[setter]?.(pending);
          void savePendingColor(kind,id);
        }else if(validColor(remote)){
          native[setter]?.(remote.toLowerCase());
        }else{
          const local=native[getter]?.();
          if(validColor(local)){
            storePendingColor(kind,id,local);
            void savePendingColor(kind,id);
          }
        }
      }
      return;
    }
    const display_name='Player '+id.slice(0,6);
    const created=await api.from('chess_profiles').insert({
      id,display_name,
      piece_color:native.getAccountColor?.()||'#c60018',
      clock_preference:window.ChessClock?.getPreference?.()||'off'
    });
    if(created.error && created.error.code!=='23505'){
      status('Could not create chess profile: '+created.error.message,true);return;
    }
    $('cgDisplayName').value=display_name;
    $('cgNameValue').textContent=display_name;
  }
  $('cgProfileForm').addEventListener('submit', async ev => {
    ev.preventDefault(); if (!player) return;
    const display_name = $('cgDisplayName').value.trim();
    if (display_name.length < 2 || display_name.length > 40) { status('Names must be 2–40 characters.',true); return; }
    const saveButton=$('cgProfileForm').querySelector('button[type="submit"]');
    saveButton.disabled=true;
    try {
      const {error} = await api.from('chess_profiles').update({display_name}).eq('id',player.id);
      if(error){status('Could not save your name: '+error.message,true);return;}
      $('cgNameValue').textContent=display_name;
      $('cgSettings').open=false;
      status('Chess name updated to '+display_name+'.');
      void refresh();
      window.dispatchEvent(new Event('familyChessProfileUpdated'));
    } finally {saveButton.disabled=false;}
  });
  const displayedName=(labels,id,fallback)=>labels[id]||fallback;
  async function refreshLive(prompt=false){
    const uid=player?.id;
    if(!uid)return;
    const container=$('cgLiveGames'),counter=$('cgLiveCount');
    const {data,error}=await api.from('chess_games')
      .select('id,status,white_player_id,black_player_id,updated_at')
      .eq('status','active').not('black_player_id','is',null)
      .order('updated_at',{ascending:false}).limit(20);
    if(player?.id!==uid)return;
    if(error){
      if(!root.hidden)container.textContent='Could not load live matches: '+error.message;
      return;
    }
    const matches=(data||[]).filter(g=>g.white_player_id&&g.black_player_id);
    const others=matches.filter(g=>g.white_player_id!==uid&&g.black_player_id!==uid);
    const ids=[...new Set(matches.flatMap(g=>[g.white_player_id,g.black_player_id]))];
    let names={};
    if(ids.length){
      const {data:profiles}=await api.from('chess_profiles')
        .select('id,display_name').in('id',ids);
      if(player?.id!==uid)return;
      names=Object.fromEntries((profiles||[]).map(p=>[p.id,p.display_name]));
    }
    liveCount=others.length;
    counter.textContent=others.length?`${others.length} to watch`:'';
    watchShortcut.textContent=`● Watch live${others.length>1?` · ${others.length}`:''}`;
    watchShortcut.hidden=others.length===0||!!matchId;
    container.replaceChildren();
    if(!matches.length){
      const n=document.createElement('span');n.className='cgMuted';
      n.textContent='No games are being played right now.';container.append(n);
    }
    /* your own live games are in My matches; this list is for watching others */
    for(const game of others){
      const card=document.createElement('div');card.className='cgLiveCard';
      const white=displayedName(names,game.white_player_id,'White');
      const black=displayedName(names,game.black_player_id,'Black');
      const title=document.createElement('div');title.className='cgLiveTitle';
      title.textContent=white+' vs '+black;
      const subtitle=document.createElement('span');subtitle.className='cgLiveMeta';
      subtitle.textContent='Playing now';
      const badge=document.createElement('span');badge.className='cgLiveTag';badge.setAttribute('aria-hidden','true');
      const text=document.createElement('span');text.className='cgLiveText';text.append(title,subtitle);
      const button=document.createElement('button');
      button.className='cgButton cgWatch';button.type='button';
      const participant=game.white_player_id===uid||game.black_player_id===uid;
      button.textContent=participant?'Open':'Watch';
      button.addEventListener('click',()=>{
        void startMatch(game.id,participant?'play':'watch').catch(e=>status(e.message,true));
      });
      card.append(badge,text,button);container.append(card);
    }
    if(prompt&&!livePromptSeen&&others.length&&!pattern.test(invite)&&!matchId){
      livePromptSeen=true;
      show();
    }
  }

  async function refresh() {
    if (!player) return;
    void refreshLive(false);
    const games = $('cgGames'); games.replaceChildren(); games.textContent = 'Loading…';
    const {data,error} = await api.from('chess_games')
      .select('id,status,result,end_reason,white_player_id,black_player_id,created_at,updated_at')
      .or('white_player_id.eq.'+player.id+',black_player_id.eq.'+player.id)
      .order('created_at',{ascending:false}).limit(20);
    if (!player) return;
    if (error) { games.textContent = 'Could not load matches: ' + error.message; return; }
    games.replaceChildren();
    /* abandoned matches (closed by a newer invite) are not kept */
    const kept=(data||[]).filter(g=>g.end_reason!=='replaced');
    renderRecord(player.id);
    if (!kept.length) { games.textContent='No matches yet.'; return; }
    const players=[...new Set(kept.flatMap(g=>[g.white_player_id,g.black_player_id]).filter(Boolean))];
    const {data:profiles}=await api.from('chess_profiles').select('id,display_name').in('id',players);
    if(!player)return;
    const names=Object.fromEntries((profiles||[]).map(p=>[p.id,p.display_name]));
    const when=(t)=>{const d=new Date(t);return isNaN(d)?'':d.toLocaleDateString([], {month:'short',day:'numeric'});};
    const REASON={checkmate:'Checkmate',resignation:'Resigned',timeout:'On time',stalemate:'Stalemate',
      agreement:'Agreed draw',repetition:'Repetition','insufficient material':'Insufficient material'};
    for (const g of kept) {
      const mine=g.white_player_id===player.id?'w':'b';
      const oppId=mine==='w'?g.black_player_id:g.white_player_id;
      const opp=oppId?displayedName(names,oppId,mine==='w'?'Black':'White'):'No opponent yet';
      /* one outcome mark per row: W / L / D for finished games, LIVE / WAIT while open */
      let mark='–',cls='void',outcome='Abandoned';
      if(g.status==='waiting'){mark='WAIT';cls='wait';outcome='Waiting for opponent';}
      else if(g.status==='active'){mark='LIVE';cls='live';outcome='Playing now';}
      else if(g.end_reason!=='replaced'&&g.result){
        const won=(g.result==='1-0'&&mine==='w')||(g.result==='0-1'&&mine==='b');
        if(g.result==='1/2-1/2'){mark='D';cls='draw';outcome='Draw';}
        else if(won){mark='W';cls='win';outcome='Won';}else{mark='L';cls='loss';outcome='Lost';}
        if(REASON[g.end_reason])outcome+=' · '+REASON[g.end_reason];
      }
      const row=document.createElement('div');row.className='cgGame';row.setAttribute('role','button');row.tabIndex=0;
      const badge=document.createElement('span');badge.className='cgBadge '+cls;badge.textContent=mark;
      badge.setAttribute('aria-label',outcome);
      const text=document.createElement('span');text.className='cgGameText';
      const title=document.createElement('b');title.textContent='vs '+opp;
      const sub=document.createElement('span');
      sub.textContent=[mine==='w'?'White':'Black',outcome,when(g.updated_at||g.created_at)].filter(Boolean).join(' · ');
      text.append(title,sub);row.append(badge,text);
      /* only open games have a link worth sharing */
      if(g.status==='waiting'||g.status==='active'){
        const copyBtn=document.createElement('button');copyBtn.type='button';copyBtn.className='cgGameCopy';
        copyBtn.textContent=g.status==='waiting'?'Copy invite':'Copy link';
        copyBtn.addEventListener('click',(e)=>{e.stopPropagation();void copy(link(g.id));});
        row.append(copyBtn);
        if(g.status==='waiting'){
          const cancelBtn=document.createElement('button');cancelBtn.type='button';cancelBtn.className='cgGameCopy cgGameCancel';
          cancelBtn.textContent='Cancel';cancelBtn.setAttribute('aria-label','Cancel this invite');
          cancelBtn.addEventListener('click',(e)=>{e.stopPropagation();void cancelInvite(g.id);});
          row.append(cancelBtn);
        }
      }
      const chev=document.createElement('span');chev.className='cgChevron';chev.textContent='›';chev.setAttribute('aria-hidden','true');row.append(chev);
      const open=()=>{void startMatch(g.id,'play',g.status==='finished').catch(e=>status(e.message,true));};
      row.addEventListener('click',open);
      row.addEventListener('keydown',(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
      row.title=g.status==='finished'?'View this game':'Open this game';
      if(games.children.length>=3&&!showAllGames)row.hidden=true;
      games.append(row);
    }
    if(kept.length>3){
      const more=document.createElement('button');more.type='button';more.className='cgMore';
      more.textContent=showAllGames?'Show fewer':'Show all '+kept.length;
      more.addEventListener('click',()=>{showAllGames=!showAllGames;void refresh();});
      games.append(more);
    }
  }
  let showAllGames=false;
  /* win rate, W-L-D and a coloured bar; tap for the full stats */
  const fmtRec=(w,l,d)=>{const n=w+l+d,f=(v,c)=>'<i class="'+c+'" style="flex-grow:'+(n?v:(c==='d'?1:0))+'"></i>';
    return '<span class="cgRecMain"><b>'+(n?Math.round(w/n*100)+'%':'–')+'</b><small>'+(n?'won':'no games')+'</small></span>'+
      '<span class="cgRecWdl"><i class="w">'+w+'W</i> · <i class="l">'+l+'L</i> · <i class="d">'+d+'D</i></span>'+
      '<span class="st-wdl">'+f(w,'w')+f(d,'d')+f(l,'l')+'</span>';};
  async function renderRecord(pid){
    const c=window.familyChessCpuRecord?.()||{w:0,l:0,d:0};
    $('cgRecCpu').innerHTML=fmtRec(c.w,c.l,c.d);
    const {data}=await api.from('chess_games').select('result,white_player_id,end_reason')
      .eq('status','finished').or('white_player_id.eq.'+pid+',black_player_id.eq.'+pid).limit(1000);
    let w=0,l=0,d=0;
    for(const g of data||[]){
      if(g.end_reason==='replaced'||!g.result)continue;
      if(g.result==='1/2-1/2')d++;else if((g.result==='1-0')===(g.white_player_id===pid))w++;else l++;
    }
    $('cgRecOnline').innerHTML=fmtRec(w,l,d);
  }
  $('cgRefresh').addEventListener('click',()=>{void refresh();});
  $('cgRecOnlineCard').addEventListener('click',()=>{if(player)void window.familyChessStats?.openPlayers(api,player.id);});
  $('cgRecCpuCard').addEventListener('click',()=>{window.familyChessStats?.openComputer(0);});
  let creating = false, openInviteId = null;
  /* take back an invitation nobody has joined: the server deletes the waiting game and its pending challenge */
  async function cancelInvite(id){
    if(!player||!id)return;
    const {data,error}=await api.rpc('chess_cancel_invite',{p_game_id:id});
    if(error){status('Could not cancel the invite: '+error.message,true);return;}
    if(openInviteId===id){openInviteId=null;$('cgCreatedLink').hidden=true;$('cgNewInviteURL').href='#';$('cgNewInviteURL').textContent='';}
    if(matchId===id){stopMatch();window.familyChessNative?.leaveToPractice();}
    status(data?'Invite cancelled. That link no longer works.':'That invite was already joined or closed.');
    void refresh();
  }
  $('cgCancelInvite').addEventListener('click',()=>{void cancelInvite(openInviteId);});
  async function createInvite() {
    if(!player || creating) return;
    creating = true;
    const b=$('cgCreate');
    b.disabled=true;
    try {
      status('Creating your private chess invitation…');
      await window.familyChessClockSavePromise;
      const {data:id,error}=await api.rpc('chess_create_private_game');
      if(error)throw error;
      const url=link(id);
      openInviteId=id;
      const a=$('cgNewInviteURL');
      a.href=url;
      a.textContent=url;
      $('cgCreatedLink').hidden=false;
      $('cgCreatedLink').scrollIntoView({block:'nearest',behavior:'smooth'});
      status('Invitation ready. Earlier live games and unused invitation links have been ended.');
      await loadInviteRecipients();
      await refresh();
      return id;
    } catch(e) {
      status('Could not create invitation: '+(e?.message||'Try again.'),true);
    } finally {creating=false;b.disabled=false;}
  }
  $('cgCreate').addEventListener('click',()=>{void createInvite();});
  $('cgJoinForm').addEventListener('submit', async ev => {
    ev.preventDefault(); if (!player) return;
    const id=getId($('cgJoinId').value);
    if (!pattern.test(id)) { status('Enter a valid game invitation link or ID.',true); return; }
    const button=$('cgJoinForm').querySelector('button');button.disabled=true;
    try {
      const {data:already}=await api.from('chess_games')
        .select('white_player_id,black_player_id,status').eq('id',id).maybeSingle();
      const participant=already&&(already.white_player_id===player.id||already.black_player_id===player.id);
      if(['active','finished'].includes(already?.status)&&already.black_player_id&&!participant){
        history.replaceState(null,'',location.pathname);
        await startMatch(id,'watch');return;
      }
      if(!participant){
        const {error}=await api.rpc('chess_join_game',{p_game_id:id});
        if(error){status('Could not join: '+error.message,true);return;}
      }
      status('Opening your game board…');
      await refresh();
      history.replaceState(null,'',location.pathname);
      await startMatch(id,'play');
    } finally {button.disabled=false;}
  });
  async function onPlayer(next) {
    const old = player?.id;
    player = next || null;
    launch.hidden = !player;
    $('cgAccountEmail').textContent=player?.email||'';
    if (old && old!==player?.id) {
      // Queue any unsynced edits for the account being left. They remain
      // stored locally if the request cannot finish before Safari closes.
      for(const kind of ['mine']){
        clearTimeout(colorSaveTimers[kind]);
        if(validColor(pendingColor(kind,old)))
          void savePendingColor(kind,old);
      }
    }
    if (!player) {
      window.familyChessNative?.clearColorProfile?.();
      root.hidden=true;
      document.getElementById('authAccountToggle')?.setAttribute('aria-expanded','false');
      stopMatch();
      if(livePoll){clearInterval(livePoll);livePoll=null;}
      liveCount=0;livePromptSeen=false;watchShortcut.hidden=true;
      window.familyChessNative?.leaveToPractice();
      root.hidden=true; return;
    }
    if (old !== player.id) {
      if (old) { stopMatch(); window.familyChessNative?.leaveToPractice(); }
      await ensureProfile();
      if(window.familyChessLobbyRequested){window.familyChessLobbyRequested=false;show();}
      if(!livePoll)livePoll=setInterval(()=>{if(player)void refreshLive(false);},30000);
      if(pattern.test(invite)&&!invitePresented){
        invitePresented=true;
        const {data:part}=await api.from('chess_games')
          .select('id,status,white_player_id,black_player_id').eq('id',invite).maybeSingle();
        if(part){
          if(part.status==='finished' && !part.black_player_id){
            show();
            status('This invitation expired because a newer game was created. Ask for a fresh link.',true);
            return;
          }
          const member=part.white_player_id===player.id||part.black_player_id===player.id;
          if(member)await startMatch(invite,'play');
          else if(['active','finished'].includes(part.status)&&part.black_player_id)await startMatch(invite,'watch');
          else{show();status('Invitation found. Press Join to play as Black.');}
        }else{show();status('Invitation found. Press Join to play as Black.');}
      }else if(!pattern.test(invite)){void refreshLive(true);}
    }
  }
  api.auth.onAuthStateChange((_event,session) => {
    setTimeout(()=>{void onPlayer(session?.user||null)},0);
  });
  api.auth.getSession().then(({data})=>{void onPlayer(data.session?.user||null);});
})();
