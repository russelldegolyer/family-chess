/* Supabase match invitation setup. Live moves are not enabled yet. */
(function chessOnline() {
  'use strict';
  const api = window.chessSupabase;
  const account = document.getElementById('accountControl');
  if (!api || !account) return;
  const style = document.createElement('style');
  style.textContent = `
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
    .cgDivider{border:0;border-top:1px solid #383838;margin:20px 0}
    .cgGame{padding:12px;border:1px solid #383838;border-radius:10px;margin:10px 0}
    .cgGame a{display:block;color:#bebebe;word-break:break-all;font-size:11px;margin:8px 0}
    #cgMessage{min-height:20px;color:#ccc;font-size:12px;line-height:1.5;margin-top:12px}
    #cgMessage.error{color:#ffa7a7}
    @media(max-width:600px){.cgPanel{top:auto;bottom:0;left:0;transform:none;width:100%;border-radius:16px 16px 0 0;max-height:calc(100dvh - 15px);padding-bottom:max(22px,env(safe-area-inset-bottom,0px))}}
  `;
  document.head.appendChild(style);
  const launch = document.createElement('button');
  launch.id = 'cgLaunch'; launch.type = 'button'; launch.textContent = 'Family games'; launch.hidden = true;
  account.insertBefore(launch, document.getElementById('authSignOut'));
  const root = document.createElement('div');
  root.id = 'cgLobby'; root.hidden = true; root.setAttribute('role','dialog'); root.setAttribute('aria-modal','true'); root.setAttribute('aria-label','Family game invitations');
  root.innerHTML = `
    <div class="cgShade"></div><section class="cgPanel">
      <div class="cgHeader"><div><h2>Family games</h2><span class="cgMuted">Private invitations</span></div>
        <button class="cgButton" id="cgClose" type="button" aria-label="Close">Close</button></div>
      <p class="cgMuted">Create or join a private match. Real-time board moves are not connected yet, so this is the invitation setup only.</p>
      <form id="cgProfileForm"><label class="cgLabel" for="cgDisplayName">Your chess name</label>
        <div class="cgRow"><input id="cgDisplayName" class="cgInput" type="text" required minlength="2" maxlength="40">
        <button class="cgButton" type="submit">Save</button></div></form>
      <hr class="cgDivider">
      <button id="cgCreate" class="cgButton primary" type="button">Create private match</button>
      <form id="cgJoinForm"><label class="cgLabel" for="cgJoinId">Join an invitation</label>
        <div class="cgRow"><input id="cgJoinId" class="cgInput" type="text" placeholder="Paste a game link or game ID" required>
        <button class="cgButton" type="submit">Join</button></div></form>
      <div id="cgMessage" role="status" aria-live="polite"></div>
      <hr class="cgDivider">
      <div class="cgHeader"><strong>My matches</strong><button class="cgButton" id="cgRefresh" type="button">Refresh</button></div>
      <div id="cgGames" class="cgMuted">No matches yet.</div>
    </section>`;
  document.body.appendChild(root);
  const $ = id => document.getElementById(id);
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let player = null, invitePresented = false;
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
  function show() { if (!player) return; root.hidden=false; void refresh(); $('cgClose').focus(); }
  function close() { root.hidden=true; launch.focus(); }
  launch.addEventListener('click', show);
  $('cgClose').addEventListener('click', close);
  root.querySelector('.cgShade').addEventListener('click', close);
  document.addEventListener('keydown', ev => { if(ev.key==='Escape'&&!root.hidden)close(); });
  async function ensureProfile() {
    const id = player?.id;
    if (!id) return;
    const {data,error} = await api.from('chess_profiles').select('display_name').eq('id',id).maybeSingle();
    if (player?.id !== id) return;
    if (error) { status('Could not load chess name: '+error.message,true); return; }
    if (data) { $('cgDisplayName').value = data.display_name; return; }
    const display_name = 'Player ' + id.slice(0,6);
    const created = await api.from('chess_profiles').insert({id,display_name});
    if (created.error && created.error.code !== '23505') { status('Could not create chess profile: '+created.error.message,true); return; }
    $('cgDisplayName').value = display_name;
  }
  $('cgProfileForm').addEventListener('submit', async ev => {
    ev.preventDefault(); if (!player) return;
    const display_name = $('cgDisplayName').value.trim();
    if (display_name.length < 2 || display_name.length > 40) { status('Names must be 2–40 characters.',true); return; }
    const {error} = await api.from('chess_profiles').update({display_name}).eq('id',player.id);
    status(error ? error.message : 'Chess name saved.', !!error);
  });
  async function refresh() {
    if (!player) return;
    const games = $('cgGames'); games.replaceChildren(); games.textContent = 'Loading…';
    const {data,error} = await api.from('chess_games')
      .select('id,status,white_player_id,black_player_id,created_at')
      .or('white_player_id.eq.'+player.id+',black_player_id.eq.'+player.id)
      .order('created_at',{ascending:false}).limit(20);
    if (!player) return;
    if (error) { games.textContent = 'Could not load matches: ' + error.message; return; }
    games.replaceChildren();
    if (!data?.length) { games.textContent='No matches yet.'; return; }
    for (const g of data) {
      const card=document.createElement('div'); card.className='cgGame';
      const title=document.createElement('strong');
      title.textContent = (g.white_player_id === player.id ? 'White · ' : 'Black · ') +
        (g.status==='waiting'?'Waiting for opponent':g.status==='active'?'Opponent joined':'Finished');
      const a=document.createElement('a'); a.href=link(g.id); a.textContent=link(g.id);
      const button=document.createElement('button');button.type='button';button.className='cgButton';button.textContent='Copy invite';
      button.addEventListener('click',()=>{void copy(link(g.id));});
      card.append(title,a,button);games.append(card);
    }
  }
  $('cgRefresh').addEventListener('click',()=>{void refresh();});
  $('cgCreate').addEventListener('click', async () => {
    if (!player) return;
    const button=$('cgCreate'); button.disabled=true;
    try {
      const {data,error}=await api.from('chess_games').insert({white_player_id:player.id}).select('id').single();
      if (error) { status('Could not create match: '+error.message,true); return; }
      status('Match created. Copy the invitation link below.'); await refresh();
    } finally { button.disabled=false; }
  });
  $('cgJoinForm').addEventListener('submit', async ev => {
    ev.preventDefault(); if (!player) return;
    const id=getId($('cgJoinId').value);
    if (!pattern.test(id)) { status('Enter a valid game invitation link or ID.',true); return; }
    const button=$('cgJoinForm').querySelector('button');button.disabled=true;
    try {
      const {error}=await api.rpc('chess_join_game',{p_game_id:id});
      if (error) { status('Could not join: '+error.message,true); return; }
      status('You joined as Black. Online move synchronization is the next step.'); await refresh();
      history.replaceState(null,'',location.pathname);
    } finally {button.disabled=false;}
  });
  async function onPlayer(next) {
    const old = player?.id;
    player = next || null;
    launch.hidden = !player;
    if (!player) { root.hidden=true; return; }
    if (old !== player.id) {
      await ensureProfile();
      if (pattern.test(invite) && !invitePresented) {
        invitePresented=true; show(); status('Invitation detected. Press Join to accept it.');
      }
    }
  }
  api.auth.onAuthStateChange((_event,session) => {
    setTimeout(()=>{void onPlayer(session?.user||null)},0);
  });
  api.auth.getSession().then(({data})=>{void onPlayer(data.session?.user||null);});
})();
