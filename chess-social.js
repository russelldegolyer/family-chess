/* Live chess lobby, online presence, spectator boards and 60-second challenges. */
(() => {
 'use strict';
 const api=window.chessSupabase;
 const mount=document.getElementById('cgSocialMount');
 const lobby=document.getElementById('cgLobby');
 if(!api||!mount||!lobby)return;
 const VAPID_PUBLIC_KEY='BBJfBdOHnTHFbKTs2KEqCyr_aCKMOM0l3IxpJYtaIimFJzJMswcLwD90K1_IVH7WrUDbLM5miTcs8K74vuXobTA';
 mount.innerHTML=`
 <section class="cgSocialSection">
  <div class="cgSection cgPlayersHead"><span>Friends</span><small id="cgOnlineCount" class="cgSocialMeta">Checking…</small><button id="cgEditFriends" class="cgEditFriends" type="button">Edit</button></div>
  <div id="cgPlayerList" class="cgSocialList"><div class="cgSocialEmpty">Loading players…</div></div>
  <div id="cgFriendReqs" class="cgSocialList cgFriendReqs" hidden></div>
  <div class="cgFriendAdd">
   <button id="cgMyCode" class="cgMyCode" type="button" aria-label="Copy your friend code"><small>Your friend code</small><b id="cgMyCodeText">······</b></button>
   <form id="cgAddForm" class="cgAddForm" autocomplete="off"><input id="cgAddCode" maxlength="8" placeholder="Friend's code" aria-label="Friend's code" autocapitalize="characters" spellcheck="false"><button type="submit">Add</button></form>
  </div>
  <div id="cgChallengeStatus" class="cgSocialNotice" role="status" aria-live="polite"></div>
 </section>`;
 /* notification set-up lives in Settings, out of the way of choosing an opponent */
 const notifySlot=document.getElementById('cgNotifySlot')||mount;
 notifySlot.insertAdjacentHTML('beforeend',`
  <button id="cgAllowPush" class="cgButton" type="button">Enable challenge notifications</button>
  <button id="cgTestPush" class="cgButton" type="button">Send a test notification</button>
  <span class="cgSocialSub" id="cgPushInfo">On iPhone, add this site to your Home Screen first.</span>`);
 const alert=document.createElement('div');
 alert.id='cgChallengeAlert';alert.hidden=true;alert.setAttribute('role','dialog');
 alert.setAttribute('aria-modal','true');alert.setAttribute('aria-label','Incoming chess challenge');
 alert.innerHTML=`<div class="cgAlertCard">
 <div style="font-size:31px" aria-hidden="true">♞</div>
 <h2>Chess challenge</h2>
 <p id="cgAlertFrom">A player wants to play.</p>
 <div class="cgAlertClock" id="cgAlertCountdown">60 seconds</div>
 <div class="cgAlertButtons">
 <button id="cgDecline" type="button">Decline</button>
 <button class="primary" id="cgAccept" type="button">Accept &amp; play</button>
 </div><p id="cgAlertError" role="status" style="font-size:12px;margin:12px 0 0"></p>
 </div>`;
 document.body.append(alert);
 const $=id=>document.getElementById(id);
 let user=null,presence=null,challengeChannel=null,poll=null,ticker=null;
 let profiles=[],activeGames=[],challenges=[],onlineIds=new Set(),openAlertId=null;
 let friendships=[],friendIds=new Set(),myCode='',editFriends=false;
 let openedGameIds=new Set(),requesting=false,loading=false;
 /* Last online: the server heartbeat (chess_profiles.last_seen_at) plus the last time this device saw them online */
 let hasLastSeen=true,heartbeat=null,touchOk=true;const seenOnline={};
 function lastOnline(p){
  const t=Math.max(Date.parse(p.last_seen_at||'')||0,seenOnline[p.id]||0);
  if(!t)return 'Offline';
  const mins=Math.max(0,Math.round((Date.now()-t)/60000));
  if(mins<1)return 'Last online just now';
  if(mins<60)return 'Last online '+mins+' minute'+(mins===1?'':'s')+' ago';
  const d=new Date(t),today=new Date();today.setHours(0,0,0,0);
  const day=new Date(d);day.setHours(0,0,0,0);
  const days=Math.round((today-day)/86400000);
  if(days===0){const h=Math.round(mins/60);return 'Last online '+h+' hour'+(h===1?'':'s')+' ago';}
  if(days===1)return 'Last online yesterday';
  return 'Last online '+d.toLocaleDateString([],{month:'long',day:'numeric',...(d.getFullYear()!==today.getFullYear()?{year:'numeric'}:{})});
 }
 function touchLastSeen(force){
  if(!user||!touchOk||(!force&&document.visibilityState!=='visible'))return;
  Promise.resolve(api.rpc('chess_touch_last_seen')).then(r=>{if(r?.error&&/function|schema cache/i.test(r.error.message||''))touchOk=false;}).catch(()=>{});
 }
 /* invite buttons stay green with a countdown while the 60 s challenge is open */
 const sentUntil={};let sentTimer=null;
 function tickSent(){
  clearInterval(sentTimer);
  sentTimer=setInterval(()=>{
   const now=Date.now();if(!Object.values(sentUntil).some(t=>t>now-1000)){clearInterval(sentTimer);sentTimer=null;}
   for(const k in sentUntil)if(sentUntil[k]<=now-1000)delete sentUntil[k];
   renderPlayers();
  },1000);
 }
 const validUid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(v);
 const nameFor=id=>profiles.find(p=>p.id===id)?.display_name||'Family player';
 let toastMode=false;
 const message=(msg)=>{$('cgChallengeStatus').textContent=msg;if(toastMode&&msg)window.familyChessToast?.(msg.replace(/ Push accepted for \d+ devices?\./,''),4500);};
 const remaining=c=>Math.max(0,Math.ceil((Date.parse(c.expires_at)-Date.now())/1000));
 const deepLink=new URL(location.href).searchParams.get('challenge');
 const clearDeepLink=()=>{
  if(!deepLink)return;
  const url=new URL(location.href);url.searchParams.delete('challenge');
  history.replaceState(null,'',url.pathname+url.search+url.hash);
 };
 const currentMatch=()=>window.familyChessCurrentMatch?.()||null;
 const avatar=(name)=>name.trim().split(/\s+/).map(n=>n[0]||'').slice(0,2).join('').toUpperCase();
 const node=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x;};
 const empty=(parent,msg)=>{parent.replaceChildren(node('div','cgSocialEmpty',msg));};
 const online=id=>onlineIds.has(id);
 function refreshPresence(){
  onlineIds=new Set();
  if(presence){
   const now=Date.now();
   for(const values of Object.values(presence.presenceState()||{}))for(const v of values||[])if(v?.uid)seenOnline[v.uid]=now;
   for(const values of Object.values(presence.presenceState()||{})){
    for(const item of values||[])if(validUid(item.uid))onlineIds.add(item.uid);
   }
  }
  renderPlayers();
 }
 function renderPlayers(){
  const list=$('cgPlayerList');if(!user)return;
  list.replaceChildren();
  const others=profiles.filter(p=>p.id!==user.id&&friendIds.has(p.id));
  others.sort((a,b)=>Number(online(b.id))-Number(online(a.id))||a.display_name.localeCompare(b.display_name));
  const on=others.filter(p=>online(p.id)).length;
  $('cgOnlineCount').textContent=on?on+' online':'';
  if(!others.length){empty(list,'No friends yet. Share your friend code below, or add someone else’s.');return;}
  for(const p of others){
   const game=activeGames.find(g=>g.white_player_id===p.id||g.black_player_id===p.id);
   const row=node('div','cgSocialRow');
   row.append(node('span','cgSocialAvatar',avatar(p.display_name)));
   const identity=node('div','cgSocialIdentity'),n=node('span','cgSocialName',p.display_name);
   const status=node('span','cgSocialMeta'),dot=node('i','cgSocialDot'+(online(p.id)?' online':''));
   dot.setAttribute('aria-hidden','true');
   status.append(dot,document.createTextNode((online(p.id)?'Online':lastOnline(p))+(game?' · In game':'')));
   identity.append(n,status);row.append(identity);
   /* someone mid-game can still be challenged; Watch sits beside it as a smaller eye button */
   if(game){
     const watchBtn=node('button','cgSocialAction alt cgEye','');watchBtn.type='button';
     watchBtn.setAttribute('aria-label','Watch '+p.display_name);watchBtn.title='Watch';
     watchBtn.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';
     watchBtn.addEventListener('click',()=>{void watch(game.id);});
     row.append(watchBtn);
   }
   // The badge follows the real invitation: it clears the moment it is accepted, declined or expires.
   const last=challenges.find(c=>c.challenger_id===user.id&&c.target_id===p.id);
   if(last&&last.status!=='pending'&&sentUntil[p.id]&&Date.parse(last.created_at)>=(sentUntil[p.id]-75000))delete sentUntil[p.id];
   const pend=last&&last.status==='pending'&&remaining(last)>0?last:null;
   const until=pend?Date.parse(pend.expires_at):(sentUntil[p.id]||0),live=until>Date.now();
   const challengeBtn=node('button','cgSocialAction'+(live?' sent':''),live?'Invited '+shown(Math.ceil((until-Date.now())/1000),pend?.kind)+'s':'Invite');
   challengeBtn.type='button';challengeBtn.disabled=live;
   challengeBtn.addEventListener('click',()=>{void sendChallenge(p.id);});
   if(editFriends){const rm=node('button','cgSocialAction cgRemove','Remove');rm.type='button';
     rm.addEventListener('click',()=>{if(rm.dataset.arm){void friendAct('chess_friend_remove',{p_other:p.id},p.display_name+' removed.');}else{rm.dataset.arm='1';rm.textContent='Sure?';setTimeout(()=>{if(rm.isConnected){delete rm.dataset.arm;rm.textContent='Remove';}},2500);}});
     row.append(rm);}
   else row.append(challengeBtn);
   list.append(row);
  }
 }
 /* ---------- friends: requests, add by code, remove ---------- */
 function renderFriendReqs(){
  const box=$('cgFriendReqs');if(!box||!user)return;box.replaceChildren();
  const pend=friendships.filter(f=>f.status==='pending');
  box.hidden=!pend.length;
  for(const f of pend){
   const other=f.user_a===user.id?f.user_b:f.user_a,incomingReq=f.requested_by!==user.id;
   const nm=profiles.find(p=>p.id===other)?.display_name||'A player';
   const row=node('div','cgSocialRow cgReqRow');
   row.append(node('span','cgSocialAvatar',avatar(nm)));
   const id=node('div','cgSocialIdentity');id.append(node('span','cgSocialName',nm),node('span','cgSocialMeta',incomingReq?'Wants to be friends':'Friend request sent'));row.append(id);
   if(incomingReq){
    const no=node('button','cgSocialAction alt','Decline');no.type='button';no.addEventListener('click',()=>void friendAct('chess_friend_respond',{p_id:f.id,p_accept:false},'Request declined.'));
    const yes=node('button','cgSocialAction','Accept');yes.type='button';yes.addEventListener('click',()=>void friendAct('chess_friend_respond',{p_id:f.id,p_accept:true},'You and '+nm+' are now friends.'));
    row.append(no,yes);
   }else{const c=node('button','cgSocialAction alt','Cancel');c.type='button';c.addEventListener('click',()=>void friendAct('chess_friend_remove',{p_other:other},'Request canceled.'));row.append(c);}
   box.append(row);
  }
 }
 async function friendAct(fn,args,ok){
  try{const {data,error}=await api.rpc(fn,args);if(error)throw error;message(typeof ok==='function'?ok(data):ok);}
  catch(e){message(e?.message||'That didn’t work. Try again.');}
  await refreshData();
 }
 $('cgEditFriends').addEventListener('click',()=>{editFriends=!editFriends;$('cgEditFriends').textContent=editFriends?'Done':'Edit';renderPlayers();});
 $('cgAddForm').addEventListener('submit',(e)=>{e.preventDefault();
  const code=$('cgAddCode').value.replace(/[^a-z0-9]/gi,'').toUpperCase();
  if(code.length!==6){message('Friend codes are 6 letters and numbers, like ABC-123.');return;}
  $('cgAddCode').value='';
  void friendAct('chess_friend_request',{p_code:code},(r)=>{const st=r?.status||r;
   if(st==='sent'&&r?.target)void Promise.resolve(api.functions.invoke('chess-notify-challenge',{body:{action:'friend_request',target_id:r.target}})).catch(()=>{});
   return st==='accepted'?'You’re now friends.':st==='already'?'You’re already friends.':st==='pending'?'Request already sent. Waiting for them to accept.':'Friend request sent. They’ll get a notification.';});
 });
 const showCode=(c)=>{myCode=c;$('cgMyCodeText').textContent=c.slice(0,3)+'-'+c.slice(3);};
 $('cgMyCode').addEventListener('click',async()=>{if(!myCode){$('cgMyCodeText').textContent='Loading…';
  try{const r=await api.rpc('chess_my_friend_code');if(r?.data)showCode(r.data);else throw 0;}catch{$('cgMyCodeText').textContent='Tap to retry';message('Couldn’t load your friend code. Check your connection and tap again.');return;}}
  const t=myCode.slice(0,3)+'-'+myCode.slice(3);
  Promise.resolve(navigator.clipboard?.writeText(t)).then(()=>message('Friend code '+t+' copied. Send it to someone you want to play.')).catch(()=>message('Your friend code is '+t+'.'));});
 async function watch(id){
  try {
   if(!window.familyChessOpenMatch)throw new Error('Chess board still loading. Try again.');
   message('Opening live board…');
   const game=activeGames.find(g=>g.id===id);
   const participant=game&&(game.white_player_id===user.id||game.black_player_id===user.id);
   await window.familyChessOpenMatch(id,participant?'play':'watch');
   lobby.hidden=true;
   message('Now spectating the match. Flip the board to change views.');
  }catch(e){message(e.message||'Could not spectate this match.');}
 }
 function renderOutgoing(){
  const mine=challenges.filter(c=>c.challenger_id===user?.id&&c.status==='pending'&&remaining(c)>0)[0];
  if(mine)message('Waiting for '+nameFor(mine.target_id)+' · '+left(mine)+' remaining. They can accept or decline.');
 }
 // Play invites stay open 70 s but show 60 s (the extra 10 s covers notification delay).
 function shown(r,kind){return kind==='saved'?r:Math.max(1,Math.min(60,r-10));}
 function left(c){const r=shown(remaining(c),c.kind);return r>=90?Math.floor(r/60)+':'+String(r%60).padStart(2,'0'):r+' seconds';}
 function incoming(){
  const available=challenges.filter(c=>c.target_id===user?.id&&c.status==='pending'&&remaining(c)>0);
  return available.find(c=>c.id===deepLink)||available[0]||null;
 }
 function renderAlert(){
  const c=incoming();
  if(!c){
   openAlertId=null;alert.hidden=true;
   return;
  }
  openAlertId=c.id;alert.hidden=false;
  $('cgAlertFrom').textContent=nameFor(c.challenger_id)+(c.kind==='saved'?' wants to continue your saved game. You pick up right where you left off.':' wants to play a game of chess.');
  $('cgAlertCountdown').textContent=left(c)+' remaining';
 }
 function tick(){
  if(!user)return;
  if(openAlertId){
   const c=challenges.find(x=>x.id===openAlertId);
   if(!c||remaining(c)<=0){alert.hidden=true;openAlertId=null;message('Challenge expired.');}
   else $('cgAlertCountdown').textContent=left(c)+' remaining';
  }
  renderOutgoing();
  if(challenges.some(c=>c.challenger_id===user.id&&c.status==='pending'))renderPlayers();
 }
 async function answer(accept){
  if(requesting)return;const c=incoming();if(!c)return;
  requesting=true;$('cgAccept').disabled=true;$('cgDecline').disabled=true;
  $('cgAlertError').textContent='';
  try{
   const {data,error}=await api.rpc('chess_respond_challenge',{p_id:c.id,p_accept:accept});
   if(error)throw error;
   alert.hidden=true;openAlertId=null;clearDeepLink();
   if(accept){
    if(!data)throw new Error('Challenge expired.');
    await window.familyChessOpenMatch(data,'play');
    openedGameIds.add(data);
    lobby.hidden=true;message('Game started against '+nameFor(c.challenger_id)+'.');
   } else message('Challenge declined.');
   await refreshData();
  }catch(e){$('cgAlertError').textContent=e.message||'Could not respond.';}
  finally{requesting=false;$('cgAccept').disabled=false;$('cgDecline').disabled=false;}
 }
 $('cgAccept').addEventListener('click',()=>{void answer(true)});
 $('cgDecline').addEventListener('click',()=>{void answer(false)});
 /* Rematch from the end card: same challenge, with progress shown as a toast over the board */
 window.familyChessRematch=async(targetId)=>{toastMode=true;try{await sendChallenge(targetId);}finally{toastMode=false;}};
 async function sendChallenge(targetId){
  if(!user||requesting)return;
  requesting=true;
  try{
   await window.familyChessClockSavePromise;
   const {data:id,error}=await api.rpc('chess_send_challenge',{p_target:targetId});
   if(error)throw error;
   message('Invite sent to '+nameFor(targetId)+'. They have 60 seconds to respond.');
   sentUntil[targetId]=Date.now()+70000;tickSent();
   await refreshData();
   // Always request push, even if Presence still shows the target as online.
   // A backgrounded iPhone can retain a stale green presence indicator.
   const response=await api.functions.invoke('chess-notify-challenge',{body:{challenge_id:id}});
   const sent=Number(response.data?.sent||0),failed=Number(response.data?.failed||0);
   if(response.error)message('Invite sent, but the push service could not be reached. Check the other device.');
   else if(response.data?.configured===false)message('Invite sent. Server push credentials still need repair.');
   else if(sent>0)message('Invite sent to '+nameFor(targetId)+'. Push accepted for '+sent+' device'+(sent===1?'':'s')+'. They have 60 seconds.');
   else if(failed>0)message('Invite sent, but push delivery failed for '+failed+' device(s). Re-enable notifications on that phone.');
   else if(response.data?.already_sent)message('Invite sent. A push was already attempted for this invitation.');
   else message('Invite sent. They have 60 seconds to accept in the app.');
  }catch(e){message(e.message||'Unable to send challenge.');}
  finally{requesting=false;}
 }
 async function refreshData({offerLobby=false}={}){
  if(!user||loading)return;
  loading=true;const uid=user.id;
  try{
   const [pr,gm,ch,fr]=await Promise.all([
    api.from('chess_profiles').select(hasLastSeen?'id,display_name,last_seen_at':'id,display_name').order('display_name'),
    api.from('chess_games').select('id,white_player_id,black_player_id,updated_at,status,clock_state')
      .eq('status','active').not('black_player_id','is',null).order('updated_at',{ascending:false}).limit(30),
    api.from('chess_challenges')
      .select('id,challenger_id,target_id,status,created_at,expires_at,game_id,kind,responded_at')
      .or('challenger_id.eq.'+uid+',target_id.eq.'+uid)
      .order('created_at',{ascending:false}).limit(30),
    api.from('chess_friendships').select('id,user_a,user_b,requested_by,status,created_at')
   ]);
   if(user?.id!==uid)return;
   if(pr.error&&hasLastSeen&&/last_seen_at/.test(pr.error.message||'')){hasLastSeen=false;loading=false;return refreshData({offerLobby});}
   if(pr.error||gm.error||ch.error)throw(pr.error||gm.error||ch.error);
   /* only games two people are really playing right now (moved in the last 20 minutes) */
   profiles=pr.data||[];activeGames=(gm.data||[]).filter(g=>g.white_player_id&&g.black_player_id&&(Date.now()-Date.parse(g.updated_at)<20*60000||g.clock_state==='paused'||g.clock_state==='penalty'));challenges=ch.data||[];
   friendships=fr.error?[]:(fr.data||[]);
   friendIds=new Set(friendships.filter(f=>f.status==='accepted').map(f=>f.user_a===uid?f.user_b:f.user_a));
   if(!myCode)void Promise.resolve(api.rpc('chess_my_friend_code')).then(r=>{if(r?.data){myCode=r.data;$('cgMyCodeText').textContent=r.data.slice(0,3)+'-'+r.data.slice(3);}}).catch(()=>{});
   renderFriendReqs();
   renderPlayers();renderAlert();tick();
   if(deepLink&&!incoming()){
    const linked=challenges.find(c=>c.id===deepLink&&c.target_id===uid);
    if(linked&&(linked.status!=='pending'||remaining(linked)===0))
      message('That invitation has expired or was already answered. Ask the player to send another.');
   }
   // A declined saved-game invite: say so (the waiting board closes; the save stays in Saved games).
   const declined=challenges.find(c=>c.challenger_id===uid&&c.kind==='saved'&&c.status==='declined'&&c.responded_at
     &&Date.now()-Date.parse(c.responded_at)<60000&&!openedGameIds.has('d'+c.id));
   if(declined){openedGameIds.add('d'+declined.id);
     window.familyChessToast?.(nameFor(declined.target_id)+' declined your saved game. It’s still in Challenges → Saved games.',5000);}
   // Accepting on another device also opens the challenger's board automatically.
   const accepted=challenges.find(c=>c.challenger_id===uid&&c.status==='accepted'&&c.game_id
     &&Date.now()-Date.parse(c.responded_at||c.created_at)<120000&&!openedGameIds.has(c.game_id));
   if(accepted&&accepted.game_id&&currentMatch()!==accepted.game_id){
    openedGameIds.add(accepted.game_id);
    try{await window.familyChessOpenMatch(accepted.game_id,'play');lobby.hidden=true;
      message('Challenge accepted by '+nameFor(accepted.target_id)+'. Game started.');}
    catch(e){message('Challenge accepted, but board could not open: '+e.message);}
   }
  }catch(e){message('Lobby unavailable: '+(e.message||'Try refreshing.'));}
  finally{loading=false;}
 }
 function startPresence(){
  if(!user)return;
  const uid=user.id;
  presence=api.channel('chess-family-presence-v1',{
    config:{presence:{key:crypto.randomUUID?.()||String(Date.now())+Math.random()}}
  });
  presence.on('presence',{event:'sync'},refreshPresence);
  presence.subscribe(async status=>{
   if(status==='SUBSCRIBED'&&user?.id===uid&&document.visibilityState==='visible')
    await presence.track({uid});
  });
 }
 async function syncVisibility(){
  if(!presence||!user)return;
  touchLastSeen(true);
  if(document.visibilityState==='hidden')await presence.untrack();
  else {await presence.track({uid:user.id});await refreshData();}
 }
 document.addEventListener('visibilitychange',()=>{void syncVisibility();});
 async function startUser(u){
  const prev=user?.id;user=u||null;
  if(!user){
   clearInterval(poll);clearInterval(ticker);clearInterval(heartbeat);poll=null;ticker=null;heartbeat=null;
   if(presence){void api.removeChannel(presence);presence=null;}
   if(challengeChannel){void api.removeChannel(challengeChannel);challengeChannel=null;}
   onlineIds=new Set();alert.hidden=true;return;
  }
  if(prev===user.id)return;
  if(presence){void api.removeChannel(presence);presence=null;}
  if(challengeChannel){void api.removeChannel(challengeChannel);challengeChannel=null;}
  clearInterval(poll);clearInterval(ticker);
  openedGameIds=new Set();
  startPresence();
  challengeChannel=api.channel('chess-challenge-events-'+user.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'chess_challenges',filter:'target_id=eq.'+user.id},
      ()=>{void refreshData()})
    .on('postgres_changes',{event:'*',schema:'public',table:'chess_challenges',filter:'challenger_id=eq.'+user.id},
      ()=>{void refreshData()}).subscribe();
  poll=setInterval(()=>{void refreshData()},3000);
  ticker=setInterval(tick,1000);
  clearInterval(heartbeat);heartbeat=setInterval(touchLastSeen,60000);touchLastSeen();
  await refreshData({offerLobby:true});
  void restorePushSubscription();
 }
 function urlBase64ToUInt8(base64){
  const padded=base64+'='.repeat((4-base64.length%4)%4);
  const raw=atob(padded.replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
 }
 async function storePush(sub){
  if(!user)return;
  const obj=sub?.toJSON();const k=obj?.keys;
  if(!obj?.endpoint||!k?.p256dh||!k?.auth)throw new Error('Push subscription missing encryption keys.');
  const {error}=await api.from('chess_push_subscriptions').upsert({
   user_id:user.id,endpoint:obj.endpoint,p256dh:k.p256dh,auth:k.auth
  },{onConflict:'endpoint'});
  if(error)throw error;
 }
 function supportsPush(){
  return 'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
 }
 async function restorePushSubscription(){
  if(!supportsPush()||Notification.permission!=='granted')return;
  try{
   const registration=await navigator.serviceWorker.register('/chess-sw.js');
   const existing=await registration.pushManager.getSubscription();
   if(existing)await storePush(existing);
   $('cgPushInfo').textContent=existing?'Notifications enabled on this device.':'Tap Enable to finish notifications.';
  }catch(e){$('cgPushInfo').textContent='Could not restore notifications: '+e.message;}
 }
 $('cgAllowPush').addEventListener('click',async()=>{
  if(!user)return;
  if(!supportsPush()){message('Push notifications are not supported in this browser.');return;}
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  if(ios&&!standalone){message('On iPhone, use Safari Share → Add to Home Screen. Open the installed chess app, then enable notifications.');return;}
  try {
   // Call the permission API immediately from the user gesture on iOS.
   const permission=await Notification.requestPermission();
   if(permission!=='granted')throw new Error('Notifications were not allowed on this device.');
   const reg=await navigator.serviceWorker.register('/chess-sw.js');
   const existing=await reg.pushManager.getSubscription();
   const sub=existing||await reg.pushManager.subscribe({
    userVisibleOnly:true,applicationServerKey:urlBase64ToUInt8(VAPID_PUBLIC_KEY)
   });
   await storePush(sub);
   message('Challenge notifications enabled on this device.');
   $('cgPushInfo').textContent='You can now receive a 60-second challenge while the app is closed, if server push is configured.';
  }catch(e){message('Notifications: '+(e.message||'Cannot subscribe.'));}
 });

 $('cgTestPush').addEventListener('click',async()=>{
  if(!user)return;
  if(!supportsPush()||Notification.permission!=='granted'){
    message('Enable challenge notifications on this installed Chess app first.');
    return;
  }
  const button=$('cgTestPush');button.disabled=true;
  message('Contacting Apple Push service for a test notification…');
  try{
    await restorePushSubscription();
    const {data,error}=await api.functions.invoke('chess-notify-challenge',{
      body:{action:'self_test'}
    });
    if(error)throw error;
    if(data?.configured===false){
      message('Server signing keys are unavailable. Please report this status.');
    }else if(Number(data?.sent||0)>0){
      message('Apple Push accepted the test for '+data.sent+' registered device(s). Check Notification Center. Acceptance is not proof of display.');
    }else if(Number(data?.failed||0)>0){
      message('Push provider rejected '+data.failed+' request(s). Code: '+(data.failureCodes||['unknown']).join(', ')+'.');
    }else{
      message('No registered push device found for this account. Tap Enable challenge notifications to register this phone.');
    }
  }catch(e){
    message('Test push failed: '+(e?.message||'Unknown error'));
  }finally{button.disabled=false;}
 });

 window.addEventListener('familyChessMatchChanged',()=>{void refreshData()});
 api.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>{void startUser(session?.user||null)},0)});
 api.auth.getSession().then(({data})=>{void startUser(data.session?.user||null)});
})();
