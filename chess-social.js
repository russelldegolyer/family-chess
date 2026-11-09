/* Live family lobby, online presence, spectator boards and 60-second challenges. */
(() => {
 'use strict';
 const api=window.chessSupabase;
 const mount=document.getElementById('cgSocialMount');
 const lobby=document.getElementById('cgLobby');
 if(!api||!mount||!lobby)return;
 const VAPID_PUBLIC_KEY='BBJfBdOHnTHFbKTs2KEqCyr_aCKMOM0l3IxpJYtaIimFJzJMswcLwD90K1_IVH7WrUDbLM5miTcs8K74vuXobTA';
 mount.innerHTML=`
 <section class="cgSocialSection">
  <h3 class="cgSocialHeading">Family players <small id="cgOnlineCount" class="cgSocialMeta">Checking status…</small></h3>
  <div id="cgPlayerList" class="cgSocialList"><div class="cgSocialEmpty">Loading players…</div></div>
 </section>
 <section class="cgSocialSection">
  <h3 class="cgSocialHeading">Challenges <small class="cgSocialTimer">60 seconds</small></h3>
  <div id="cgChallengeStatus" class="cgSocialNotice" role="status" aria-live="polite">Send a challenge to an online or offline family member.</div>
  <button id="cgAllowPush" class="cgButton" type="button" style="margin-top:13px;width:100%">Enable challenge notifications</button>
  <span class="cgSocialSub" id="cgPushInfo">Offline notifications require permission. On iPhone, install this website to your Home Screen first.</span>
 </section>`;
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
 let initializedFor=null,openedGameIds=new Set(),initialVisit=true,requesting=false,loading=false;
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
  $('cgOnlineCount').textContent=others.filter(p=>online(p.id)).length+' online';
  if(!others.length){empty(list,'No other family accounts yet. Invite someone to create an account.');return;}
  for(const p of others){
   const game=activeGames.find(g=>g.white_player_id===p.id||g.black_player_id===p.id);
   const row=node('div','cgSocialRow');
   row.append(node('span','cgSocialAvatar',avatar(p.display_name)));
   const identity=node('div','cgSocialIdentity'),n=node('span','cgSocialName',p.display_name);
   const status=node('span','cgSocialMeta'),dot=node('i','cgSocialDot'+(online(p.id)?' online':''));
   dot.setAttribute('aria-hidden','true');status.append(dot,document.createTextNode(game?'In game':online(p.id)?'Online':'Offline'));
   identity.append(n,status);row.append(identity);
   const btn=node('button','cgSocialAction'+(game?' alt':''),game?'Watch':online(p.id)?'Challenge':'Invite');
   btn.type='button';
   btn.addEventListener('click',()=>{if(game)void watch(game.id);else void sendChallenge(p.id);});
   row.append(btn);list.append(row);
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
   const {data:id,error}=await api.rpc('chess_send_challenge',{p_target:targetId});
   if(error)throw error;
   message('Challenge sent to '+nameFor(targetId)+'. They have 60 seconds to respond.');
   await refreshData();
   if(!online(targetId)){
    // Push is best-effort; the database challenge is authoritative.
    const response=await api.functions.invoke('chess-notify-challenge',{body:{challenge_id:id}});
    if(response.error)message('Challenge sent, but offline push could not be delivered. The invite still expires in 60 seconds.');
    else if(!response.data?.configured)message('Challenge saved. Offline push requires one-time server notification setup.');
    else if(response.data?.sent===0)message('Challenge saved. This player has not enabled push notifications yet.');
    else message('Offline challenge notification sent to '+nameFor(targetId)+'.');
   }
  }catch(e){message(e.message||'Unable to send challenge.');}
  finally{requesting=false;}
 }
 async function refreshData({offerLobby=false}={}){
  if(!user||loading)return;
  loading=true;const uid=user.id;
  try{
   const [pr,gm,ch]=await Promise.all([
    api.from('chess_profiles').select('id,display_name').order('display_name'),
    api.from('chess_games').select('id,white_player_id,black_player_id,updated_at,status')
      .eq('status','active').not('black_player_id','is',null).order('updated_at',{ascending:false}).limit(30),
    api.from('chess_challenges')
      .select('id,challenger_id,target_id,status,created_at,expires_at,game_id')
      .or('challenger_id.eq.'+uid+',target_id.eq.'+uid)
      .order('created_at',{ascending:false}).limit(30)
   ]);
   if(user?.id!==uid)return;
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
   // The existing spectator lobby handles first-visit Watch Live prompts.
   if(offerLobby)initialVisit=false;
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
  if(document.visibilityState==='hidden')await presence.untrack();
  else {await presence.track({uid:user.id});await refreshData();}
 }
 document.addEventListener('visibilitychange',()=>{void syncVisibility();});
 async function startUser(u){
  const prev=user?.id;user=u||null;
  if(!user){
   clearInterval(poll);clearInterval(ticker);poll=null;ticker=null;
   if(presence){void api.removeChannel(presence);presence=null;}
   if(challengeChannel){void api.removeChannel(challengeChannel);challengeChannel=null;}
   onlineIds=new Set();alert.hidden=true;return;
  }
  if(prev===user.id)return;
  if(presence){void api.removeChannel(presence);presence=null;}
  if(challengeChannel){void api.removeChannel(challengeChannel);challengeChannel=null;}
  clearInterval(poll);clearInterval(ticker);
  initializedFor=user.id;initialVisit=true;openedGameIds=new Set();
  startPresence();
  challengeChannel=api.channel('chess-challenge-events-'+user.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'chess_challenges',filter:'target_id=eq.'+user.id},
      ()=>{void refreshData()})
    .on('postgres_changes',{event:'*',schema:'public',table:'chess_challenges',filter:'challenger_id=eq.'+user.id},
      ()=>{void refreshData()}).subscribe();
  poll=setInterval(()=>{void refreshData()},3000);
  ticker=setInterval(tick,1000);
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
 window.addEventListener('familyChessMatchChanged',()=>{void refreshData()});
 api.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>{void startUser(session?.user||null)},0)});
 api.auth.getSession().then(({data})=>{void startUser(data.session?.user||null)});
})();
