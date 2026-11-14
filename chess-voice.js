/* Voice chat between two players (no phone numbers: internet audio between the two apps).
   Tap the mic to call; the other player gets "X wants to talk — Join / Not now". Once joined it is an open
   line that stays up through the end of the game, review and new games. It ends when either of you taps the
   green mic again or leaves the app.
   Privacy: the microphone is only opened after a tap (call or Join) and is fully released the moment the call
   ends. Audio goes straight between the two apps, encrypted by WebRTC (DTLS-SRTP); it is never recorded,
   uploaded or stored. The short "how to reach me" handshake runs on a PRIVATE realtime channel that only the
   two signed-in friends can join (database rule chess_voice_pair_*). */
(() => {
  'use strict';
  const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  let iceCache = null;   /* { at, servers } from the chess-voice-ice function (adds a relay when one is configured) */
  async function iceServers() {
    if (iceCache && Date.now() - iceCache.at < 10 * 60 * 1000) return iceCache.servers;
    try {
      const { data } = await api().functions.invoke('chess-voice-ice', { body: {} });
      const list = Array.isArray(data?.iceServers) && data.iceServers.length ? data.iceServers : STUN;
      iceCache = { at: Date.now(), servers: list }; return list;
    } catch { return STUN; }
  }
  const RING_MS = 35000;
  const S = {
    me: null, opp: null, oppName: '', ringTick: 0,
    state: 'idle',            /* idle | calling | ringing | connecting | live */
    pc: null, local: null, remote: null, muted: false, ringTimer: 0, callId: null, pendingIce: [],
    meter: null,
  };
  const $ = (id) => document.getElementById(id);
  const api = () => window.chessSupabase;
  const toast = (m) => window.familyChessToast?.(m);
  const supported = () => !!(navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection);

  /* ---------------- UI ---------------- */
  const MIC = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const MIC_OFF = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  let box, mainBtn, endBtn, ring, audio;
  function build() {
    if (box) return;
    const css = document.createElement('style');
    css.textContent = `
#voiceBox{position:fixed;z-index:46;display:none;align-items:center;gap:8px}
#voiceBox.show{display:flex}
#voiceBox button{width:46px;height:46px;border:0;border-radius:50%;display:grid;place-items:center;cursor:pointer;color:#f2f2f7;
 background:rgba(36,36,40,.94);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1),0 6px 18px rgba(0,0,0,.45);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
#voiceBox button:active{transform:scale(.96)}
#voiceBox[data-s="calling"] .v-main,#voiceBox[data-s="connecting"] .v-main{color:#7ee99a;animation:vPulse 1.2s ease-in-out infinite}
#voiceBox[data-s="live"] .v-main{background:#1f8f45;color:#fff;box-shadow:0 0 0 2px rgba(48,209,88,.5),0 6px 18px rgba(0,0,0,.45)}
#voiceBox[data-s="live"].talking .v-main{box-shadow:0 0 0 4px rgba(48,209,88,.75),0 0 18px rgba(48,209,88,.6)}
#voiceBox .v-mute[hidden]{display:none}
#voiceBox.muted .v-mute{background:#d93025;color:#fff}
#voiceBox .v-lbl{font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#c7c7cc;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis}
#voiceBox .v-lbl:empty{display:none}
#voiceBox.inline{position:static;gap:6px}
#voiceBox.inline button{width:36px;height:36px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
#voiceBox.inline button svg{width:18px;height:18px}
#voiceBox.inline .v-lbl{display:none}
@keyframes vPulse{0%,100%{box-shadow:0 0 0 0 rgba(48,209,88,.55),inset 0 0 0 1px rgba(255,255,255,.1)}50%{box-shadow:0 0 0 8px rgba(48,209,88,0),inset 0 0 0 1px rgba(255,255,255,.1)}}
#voiceRing{position:fixed;z-index:210;left:50%;top:max(14px,calc(env(safe-area-inset-top,0px) + 10px));transform:translateX(-50%);width:min(360px,calc(100vw - 32px));box-sizing:border-box;
 display:flex;align-items:center;gap:10px;padding:12px 12px 12px 14px;border-radius:20px;background:rgba(24,24,28,.97);color:#f2f2f7;
 box-shadow:inset 0 0 0 1px rgba(48,209,88,.45),0 18px 44px rgba(0,0,0,.6);font:500 14px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
#voiceRing[hidden]{display:none}
#voiceRing .vr-ico{flex:none;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:#1f8f45;color:#fff;animation:vPulse 1.2s ease-in-out infinite}
#voiceRing .vr-txt{flex:1;min-width:0}
#voiceRing .vr-txt b{display:block;font-weight:700;line-height:1.25}
#voiceRing .vr-txt span{color:#a1a1a6;font-size:12.5px}
#voiceRing button{flex:none;height:38px;padding:0 13px;border:0;border-radius:999px;font:700 14px/1 inherit;cursor:pointer}
#voiceRing .vr-yes{background:#30d158;color:#04210d}
#voiceRing .vr-no{background:rgba(255,255,255,.1);color:#f2f2f7}
@media (prefers-reduced-motion: reduce){#voiceBox .v-main,#voiceRing .vr-ico{animation:none!important}}`;
    document.head.append(css);
    box = document.createElement('div'); box.id = 'voiceBox'; box.dataset.s = 'idle';
    mainBtn = document.createElement('button'); mainBtn.type = 'button'; mainBtn.className = 'v-main';
    endBtn = document.createElement('button'); endBtn.type = 'button'; endBtn.className = 'v-mute'; endBtn.innerHTML = MIC_OFF; endBtn.hidden = true;
    endBtn.setAttribute('aria-label', 'Mute');
    const lbl = document.createElement('span'); lbl.className = 'v-lbl';
    box.append(lbl, endBtn, mainBtn); document.body.append(box);
    mainBtn.addEventListener('click', onMain);
    endBtn.addEventListener('click', toggleMute);
    ring = document.createElement('div'); ring.id = 'voiceRing'; ring.hidden = true; ring.setAttribute('role', 'alertdialog');
    ring.innerHTML = '<span class="vr-ico">' + MIC + '</span><span class="vr-txt"><b></b><span>Voice chat</span></span><button type="button" class="vr-no">Not now</button><button type="button" class="vr-yes">Join</button>';
    document.body.append(ring);
    ring.querySelector('.vr-yes').addEventListener('click', () => void accept());
    ring.querySelector('.vr-no').addEventListener('click', () => decline());
    audio = document.createElement('audio'); audio.autoplay = true; audio.setAttribute('playsinline', ''); audio.hidden = true; document.body.append(audio);
    new MutationObserver(place).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', place);
  }
  /* phones with chat closed: floating above the chat button; otherwise inline in the chat header */
  function place() {
    if (!box) return;
    const show = !!S.opp && S.inGame && supported() && !document.body.classList.contains('pregame') && !document.body.classList.contains('training-open');
    box.classList.toggle('show', show || S.state !== 'idle');
    const fab = $('chatFab'), fr = fab && getComputedStyle(fab).display !== 'none' ? fab.getBoundingClientRect() : null;
    const head = document.querySelector('#panel .panel-head'), clear = head?.querySelector('.chat-clear');
    if (fr && fr.width) {
      if (box.parentNode !== document.body) document.body.append(box);
      box.classList.remove('inline');
      box.style.right = Math.round(window.innerWidth - fr.right + (fr.width - 46) / 2) + 'px';
      box.style.bottom = Math.round(window.innerHeight - fr.top + 12) + 'px';
      box.style.flexDirection = 'row';
    } else if (head && head.getClientRects().length && getComputedStyle(head).visibility !== 'hidden' && head.getBoundingClientRect().bottom > 0) {
      if (box.parentNode !== head) (clear ? clear.before(box) : head.append(box));
      box.classList.add('inline'); box.style.right = box.style.bottom = '';
    } else {   /* opening screen, menus: keep a call reachable at the bottom right */
      if (box.parentNode !== document.body) document.body.append(box);
      box.classList.remove('inline');
      const card = document.body.classList.contains('pregame') ? document.querySelector('.pg-bottom')?.getBoundingClientRect() : null;
      box.style.right = 'max(16px, env(safe-area-inset-right, 0px))';
      box.style.bottom = card && card.height ? Math.round(window.innerHeight - card.top + 12) + 'px' : 'calc(env(safe-area-inset-bottom, 0px) + 96px)';
    }
    /* tell the board layout (captured-pieces line) where the mic is, so it never sits underneath it */
    const on = box.classList.contains('show') && !box.classList.contains('inline');
    if (document.body.classList.contains('voice-on') !== on) document.body.classList.toggle('voice-on', on);
  }
  function paint() {
    if (!box) return;
    box.dataset.s = S.state;
    box.classList.toggle('muted', S.muted);
    endBtn.hidden = S.state !== 'live';
    endBtn.innerHTML = S.muted ? MIC : MIC_OFF; endBtn.setAttribute('aria-label', S.muted ? 'Unmute' : 'Mute'); endBtn.title = endBtn.getAttribute('aria-label');
    const lbl = box.querySelector('.v-lbl');
    lbl.textContent = S.state === 'calling' ? 'Calling ' + S.oppName + '…' : S.state === 'connecting' ? 'Connecting…' : S.state === 'live' ? (S.muted ? 'Muted · ' : 'On call · ') + S.oppName : '';
    mainBtn.innerHTML = MIC;
    mainBtn.setAttribute('aria-label', S.state === 'idle' ? 'Voice chat with ' + (S.oppName || 'your opponent') : S.state === 'live' ? 'End voice chat' : 'Cancel call');
    mainBtn.title = mainBtn.getAttribute('aria-label');
    place();
  }

  /* ---------------- signalling over the game's realtime connection ---------------- */
  /* one PRIVATE channel per friend (chess-voice:<idA>:<idB>), so a call reaches you on any screen of the app */
  const chans = new Map(), names = new Map();   /* friendId -> channel; friendId -> display name */
  async function listen(friend) {
    if (!S.me || !friend || chans.has(friend)) return;
    const c = api(); if (!c) return;
    chans.set(friend, null);
    try { await c.realtime?.setAuth?.(); } catch { /* older client: token is already on the socket */ }
    const ch = c.channel('chess-voice:' + [S.me, friend].sort().join(':'), { config: { private: true, broadcast: { self: false } } });
    ch.on('broadcast', { event: 'v' }, ({ payload }) => onSignal(payload || {}, friend));
    ch.subscribe(); chans.set(friend, ch);
  }
  function unlistenAll() { for (const ch of chans.values()) try { if (ch) api()?.removeChannel?.(ch); } catch { /* ignore */ } chans.clear(); }
  async function loadFriends() {
    const c = api(); if (!c) return;
    let uid = null;
    try { const { data } = await c.auth.getSession(); uid = data?.session?.user?.id || null; } catch { /* signed out */ }
    if (uid !== S.me) { if (S.state !== 'idle') hangUp(true); unlistenAll(); S.me = uid; }
    if (!uid) return;
    try {
      const { data } = await c.from('chess_friendships').select('user_a,user_b').eq('status', 'accepted');
      const ids = (data || []).map((f) => (f.user_a === uid ? f.user_b : f.user_a)).filter(Boolean);
      if (ids.length) { const { data: ps } = await c.from('chess_profiles').select('id,display_name').in('id', ids); for (const p of ps || []) names.set(p.id, p.display_name || 'Your friend'); }
      for (const id of ids) void listen(id);
    } catch { /* offline: the game opponent is still covered by update() */ }
  }
  const send = (t, extra = {}) => chans.get(S.opp)?.send({ type: 'broadcast', event: 'v', payload: { t, from: S.me, to: S.opp, call: S.callId, ...extra } });

  function onSignal(m, friend) {
    if (m.from !== friend || m.to !== S.me) return;          /* only that friend, only to me */
    if (m.t === 'ring') {
      if (S.state === 'calling' && friend === S.opp && m.call !== S.callId) { S.callId = [S.callId, m.call].sort()[0]; clearInterval(S.ringTick); return void (S.me < S.opp ? startOffer() : null); } /* both tapped: lower id makes the offer */
      if (S.state !== 'idle') return;   /* already ringing (repeat ring) or on another call */
      S.opp = friend; S.oppName = names.get(friend) || m.name || 'Your friend';
      S.callId = m.call; S.state = 'ringing'; showRing(); return;
    }
    if (friend !== S.opp) return;
    if (m.call !== S.callId) return;
    if (m.t === 'cancel' || m.t === 'end') { if (S.state !== 'idle') { toast(m.t === 'end' ? S.oppName + ' left the voice chat' : 'Missed voice call from ' + S.oppName); reset(); } return; }
    if (m.t === 'decline') { toast(S.oppName + " can't talk right now"); reset(); return; }
    if (m.t === 'accept' && S.state === 'calling') return void startOffer();
    if (m.t === 'offer') return void onOffer(m.sdp);
    if (m.t === 'answer' && S.pc) return void S.pc.setRemoteDescription(m.sdp).then(flushIce).catch(() => fail());
    if (m.t === 'ice' && m.c) { if (S.pc?.remoteDescription) S.pc.addIceCandidate(m.c).catch(() => {}); else S.pendingIce.push(m.c); }
  }
  function flushIce() { const q = S.pendingIce.splice(0); for (const c of q) S.pc?.addIceCandidate(c).catch(() => {}); }

  /* ---------------- the call ---------------- */
  async function mic() {
    if (S.local && S.local.getAudioTracks().some((t) => t.readyState === 'live')) return S.local;
    S.local = null;
    if (!supported()) { const e = new Error('unsupported'); e.name = 'NotSupportedError'; throw e; }
    try { S.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }); }
    catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
      /* some phones refuse the tuned settings or a busy audio session: try once more with the plainest request */
      console.warn('voice mic (tuned)', e && e.name, e && e.message);
      try { await actx?.suspend?.(); } catch { /* no shared audio */ }
      S.local = await navigator.mediaDevices.getUserMedia({ audio: true });
      try { await actx?.resume?.(); } catch { /* ignore */ }
    }
    return S.local;
  }
  function makePc() {
    const pc = new RTCPeerConnection({ iceServers: S.ice || STUN });
    pc.onicecandidate = (e) => { if (e.candidate) send('ice', { c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.ontrack = (e) => { S.remote = e.streams[0] || new MediaStream([e.track]); audio.srcObject = S.remote; void audio.play().catch(() => { S.needTap = true; toast('Tap the mic button to hear ' + S.oppName); }); watchTalking(); };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') { S.state = 'live'; clearTimeout(S.ringTimer); paint(); toast('Voice chat on with ' + S.oppName); navigator.vibrate?.(30); }
      else if (st === 'failed') fail();
      else if (st === 'disconnected') setTimeout(() => { if (S.pc === pc && pc.connectionState === 'disconnected') fail(); }, 6000);
    };
    S.pc = pc; return pc;
  }
  async function startOffer() {
    try {
      S.state = 'connecting'; paint();
      S.ice = await iceServers();
      const pc = makePc(); for (const t of (await mic()).getTracks()) pc.addTrack(t, S.local);
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      send('offer', { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
    } catch (e) { console.warn('voice offer', e); S.local ? linkError(e) : micError(e); }
  }
  async function onOffer(sdp) {
    try {
      if (!S.pc) { S.ice = await iceServers(); makePc(); }
      const pc = S.pc;
      for (const t of (await mic()).getTracks()) if (!pc.getSenders().some((s) => s.track === t)) pc.addTrack(t, S.local);
      await pc.setRemoteDescription(sdp); flushIce();
      const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
      send('answer', { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      S.state = 'connecting'; paint();
    } catch (e) { console.warn('voice answer', e); S.local ? linkError(e) : micError(e); }
  }
  async function call() {
    if (!S.opp) return;
    try { await mic(); } catch (e) { return micError(e); }   /* first thing after the tap, while it still counts as a gesture */
    if (!chans.get(S.opp)) { try { await listen(S.opp); } catch (e) { console.warn('voice listen', e); } await new Promise((r) => setTimeout(r, 400)); }
    if (!chans.get(S.opp)) { toast('Voice chat needs a connection — check your internet and try again.'); return reset(); }
    void audio.play().catch(() => {});
    S.callId = Math.random().toString(36).slice(2, 10); S.state = 'calling'; paint();
    send('ring', { name: S.myName });
    clearInterval(S.ringTick); S.ringTick = setInterval(() => { if (S.state === 'calling') send('ring', { name: S.myName }); else clearInterval(S.ringTick); }, 3000);
    /* if their app is closed, a push lets them open it and still catch the call */
    void Promise.resolve(api()?.functions.invoke('chess-notify-challenge', { body: { action: 'voice_call', target_id: S.opp } })).catch(() => {});
    clearTimeout(S.ringTimer);
    S.ringTimer = setTimeout(() => { if (S.state === 'calling') { send('cancel'); toast(S.oppName + " didn't answer"); reset(); } }, RING_MS);
  }
  async function accept() {
    hideRing();
    try { await mic(); } catch (e) { send('decline'); return micError(e); }
    void audio.play().catch(() => {});
    S.state = 'connecting'; paint();
    send('accept');
    clearTimeout(S.ringTimer); S.ringTimer = setTimeout(() => { if (S.state === 'connecting') fail(); }, 25000);
  }
  function decline() { hideRing(); send('decline'); reset(); }
  function hangUp(tell) { if (tell && S.state !== 'idle') send(S.state === 'calling' ? 'cancel' : 'end'); reset(); }
  function fail() { if (S.state === 'idle') return; toast("Couldn't keep the voice chat connected. Try again."); send('end'); reset(); }
  function micError(e) {
    const n = (e && e.name) || 'Error';
    console.warn('voice mic', n, e && e.message);
    toast(n === 'NotAllowedError' || n === 'SecurityError' ? 'Microphone is blocked. Allow it for this site in Settings to talk.'
      : n === 'NotFoundError' ? 'No microphone found on this device.'
      : n === 'NotReadableError' || n === 'AbortError' ? 'The microphone is busy — close other apps using it (calls, recordings) and try again.'
      : n === 'NotSupportedError' ? 'This browser can’t do voice chat. Try Safari or Chrome.'
      : 'Voice chat could not start (' + n + '). Try again.');
    if (S.state !== 'idle') send(S.state === 'calling' ? 'cancel' : 'end');
    reset();
  }
  function linkError(e) {
    toast('Couldn’t connect the call (' + ((e && e.name) || 'error') + '). Try again.');
    send('end'); reset();
  }
  function reset() {
    clearTimeout(S.ringTimer); clearInterval(S.ringTick); hideRing();
    try { S.pc?.close(); } catch { /* closed */ }
    S.pc = null; S.pendingIce = [];
    for (const t of S.local?.getTracks() || []) t.stop();
    S.local = null; S.remote = null; if (audio) { try { audio.pause(); } catch { /* not playing */ } audio.srcObject = null; }
    stopMeter(); S.needTap = false; S.state = 'idle'; S.muted = false; S.callId = null;
    if (lastView !== undefined) update(lastView); else paint();
  }
  function onMain() {
    if (S.state === 'idle') return void call();
    if (S.needTap) { S.needTap = false; void audio.play().catch(() => {}); return; }   /* iPhone: first tap only starts the sound */
    hangUp(true);   /* on a call (or calling): the mic button ends it */
  }
  function toggleMute() {
    if (S.state !== 'live') return;
    S.muted = !S.muted; for (const t of S.local?.getAudioTracks() || []) t.enabled = !S.muted;
    void audio.play().catch(() => {}); paint();
  }
  /* a soft two-note ring while the card is up; Web Audio needs one earlier tap to be allowed (iPhone) */
  let actx = null, ringLoop = 0;
  const unlock = () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') void actx.resume(); } catch { /* no audio */ } };
  ['pointerdown', 'keydown', 'touchend'].forEach((e) => window.addEventListener(e, unlock, { passive: true }));
  function chime() {
    if (!actx) return;
    const t0 = actx.currentTime;
    [[659.25, 0], [880, 0.22], [659.25, 0.9], [880, 1.12]].forEach(([f, d]) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.22, t0 + d + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.32);
      o.start(t0 + d); o.stop(t0 + d + 0.35);
    });
  }
  function startRingSound() { stopRingSound(); unlock(); chime(); ringLoop = setInterval(chime, 3000); }
  function stopRingSound() { clearInterval(ringLoop); ringLoop = 0; }
  function showRing() {
    ring.querySelector('b').textContent = S.oppName + ' wants to talk';
    ring.hidden = false; navigator.vibrate?.([120, 80, 120]); startRingSound();
    clearTimeout(S.ringTimer); S.ringTimer = setTimeout(() => { if (S.state === 'ringing') { hideRing(); reset(); } }, RING_MS + 2000);
  }
  function hideRing() { if (ring) ring.hidden = true; stopRingSound(); }
  /* a soft glow on the button while the other person is speaking */
  function watchTalking() {
    stopMeter();
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx || !S.remote) return;
      const ctx = new Ctx(), an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaStreamSource(S.remote).connect(an);
      const buf = new Uint8Array(an.fftSize); let raf = 0;
      const tick = () => { an.getByteTimeDomainData(buf); let sum = 0; for (const v of buf) sum += (v - 128) * (v - 128);
        box.classList.toggle('talking', Math.sqrt(sum / buf.length) > 6); raf = requestAnimationFrame(tick); };
      tick(); S.meter = { ctx, stop: () => cancelAnimationFrame(raf) };
    } catch { /* no meter */ }
  }
  function stopMeter() { try { S.meter?.stop(); S.meter?.ctx.close(); } catch { /* closed */ } S.meter = null; box?.classList.remove('talking'); }

  /* ---------------- game hookup ---------------- */
  /* called by the game whenever the online view changes */
  let lastView = null;
  function update(v) {
    build(); lastView = v;
    const live = v && v.gameId && v.userId && (v.mySeat === 'w' || v.mySeat === 'b') && v.whiteId && v.blackId && v.status !== 'waiting';
    S.inGame = !!live;
    /* during a call nothing about the game changes it: game over, review, a new game, even Home keep talking */
    if (S.state !== 'idle') { paint(); return; }
    const opp = live ? (v.mySeat === 'w' ? v.blackId : v.whiteId) : null;
    if (live && !S.me) S.me = v.userId;
    S.opp = opp;
    if (live) { S.oppName = (v.mySeat === 'w' ? v.blackName : v.whiteName) || 'Your opponent'; S.myName = (v.mySeat === 'w' ? v.whiteName : v.blackName) || ''; names.set(opp, S.oppName); void listen(opp); }
    paint();
  }
  /* listen for calls from every friend while signed in (and refresh now and then: new friends, sign-in changes) */
  const boot = () => { if (!api()) return void setTimeout(boot, 800); build(); void loadFriends(); api().auth.onAuthStateChange?.(() => void loadFriends()); setInterval(() => void loadFriends(), 120000); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  /* leaving the app ends the call: closing it, or (phones) switching away from it */
  /* no call going: close the ring's sound engine so iPhone doesn't list the page under Now Playing */
  const quiet = () => { if (S.state !== 'idle') return; stopRingSound(); try { audio?.pause(); } catch { /* idle */ } const c = actx; actx = null; try { c && c.close(); } catch { /* closed */ } };
  window.addEventListener('pagehide', () => { hangUp(true); quiet(); });
  let awayTimer = 0;
  document.addEventListener('visibilitychange', () => {
    clearTimeout(awayTimer);
    if (document.visibilityState === 'hidden') quiet();
    if (document.visibilityState === 'hidden' && matchMedia('(pointer: coarse)').matches) awayTimer = setTimeout(() => { if (document.visibilityState === 'hidden') { hangUp(true); quiet(); } }, 4000);
  });
  window.familyChessVoice = { update, hangUp: () => hangUp(true), state: () => S.state };
})();
