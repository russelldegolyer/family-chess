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
  <div class="cgSection cgPlayersHead"><span>Players</span><small id="cgOnlineCount" class="cgSocialMeta">Checking…</small></div>
  <div id="cgPlayerList" class="cgSocialList"><div class="cgSocialEmpty">Loading players…</div></div>
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
 const message=(msg)=>{$('cgChallengeStatus').textContent=msg;};
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
  const others=profiles.filter(p=>p.id!==user.id);
  others.sort((a,b)=>Number(online(b.id))-Number(online(a.id))||a.display_name.localeCompare(b.display_name));
  const on=others.filter(p=>online(p.id)).length;
  $('cgOnlineCount').textContent=on?on+' online':'';
  if(!others.length){empty(list,'No other family accounts yet. Invite someone to create an account.');return;}
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
   const until=sentUntil[p.id]||0,live=until>Date.now();
   const challengeBtn=node('button','cgSocialAction'+(live?' sent':''),live?'Invited '+Math.ceil((until-Date.now())/1000)+'s':'Invite');
   challengeBtn.type='button';challengeBtn.disabled=live;
   challengeBtn.addEventListener('click',()=>{void sendChallenge(p.id);});
   row.append(challengeBtn);
   list.append(row);
  }
 }
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
  if(mine)message('Waiting for '+nameFor(mine.target_id)+' · '+remaining(mine)+'s remaining. They can accept or decline.');
 }
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
  $('cgAlertFrom').textContent=nameFor(c.challenger_id)+' wants to play a game of chess.';
  $('cgAlertCountdown').textContent=remaining(c)+' seconds remaining';
 }
 function tick(){
  if(!user)return;
  if(openAlertId){
   const c=challenges.find(x=>x.id===openAlertId);
   if(!c||remaining(c)<=0){alert.hidden=true;openAlertId=null;message('Challenge expired.');}
   else $('cgAlertCountdown').textContent=remaining(c)+' seconds remaining';
  }
  renderOutgoing();
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
 async function sendChallenge(targetId){
  if(!user||requesting)return;
  requesting=true;
  try{
   await window.familyChessClockSavePromise;
   const {data:id,error}=await api.rpc('chess_send_challenge',{p_target:targetId});
   if(error)throw error;
   message('Invite sent to '+nameFor(targetId)+'. They have 60 seconds to respond.');
   sentUntil[targetId]=Date.now()+60000;tickSent();
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
   const [pr,gm,ch]=await Promise.all([
    api.from('chess_profiles').select(hasLastSeen?'id,display_name,last_seen_at':'id,display_name').order('display_name'),
    api.from('chess_games').select('id,white_player_id,black_player_id,updated_at,status')
      .eq('status','active').not('black_player_id','is',null).order('updated_at',{ascending:false}).limit(30),
    api.from('chess_challenges')
      .select('id,challenger_id,target_id,status,created_at,expires_at,game_id')
      .or('challenger_id.eq.'+uid+',target_id.eq.'+uid)
      .order('created_at',{ascending:false}).limit(30)
   ]);
   if(user?.id!==uid)return;
   if(pr.error&&hasLastSeen&&/last_seen_at/.test(pr.error.message||'')){hasLastSeen=false;loading=false;return refreshData({offerLobby});}
   if(pr.error||gm.error||ch.error)throw(pr.error||gm.error||ch.error);
   profiles=pr.data||[];activeGames=gm.data||[];challenges=ch.data||[];
   renderPlayers();renderAlert();tick();
   if(deepLink&&!incoming()){
    const linked=challenges.find(c=>c.id===deepLink&&c.target_id===uid);
    if(linked&&(linked.status!=='pending'||remaining(linked)===0))
      message('That invitation has expired or was already answered. Ask the player to send another.');
   }
   // Accepting on another device also opens the challenger's board automatically.
   const accepted=challenges.find(c=>c.challenger_id===uid&&c.status==='accepted'&&c.game_id
     &&Date.now()-Date.parse(c.created_at)<120000&&!openedGameIds.has(c.game_id));
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
