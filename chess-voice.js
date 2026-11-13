/* Voice chat for live games between two players (no phone numbers: internet audio between the two apps).
   Tap the mic to call; the other player gets "X wants to talk — Join / Not now". Once joined it is an open
   line with mute and hang up. Audio goes phone-to-phone (WebRTC); the game's Supabase realtime connection
   only carries the short "how to reach me" messages. Nothing is recorded or stored. */
(() => {
  'use strict';
  const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const RING_MS = 35000;
  const S = {
    view: null, gid: null, me: null, opp: null, oppName: '', ch: null,
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
  const HANG = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14.5c5-4.6 13-4.6 18 0l-2.2 2.6-3.3-1.4v-2.5a11 11 0 0 0-7 0v2.5l-3.3 1.4z" fill="currentColor"/></svg>';
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
#voiceBox[data-s="live"].muted .v-main{background:#3a3a3e;color:#ff8b84;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
#voiceBox[data-s="live"].talking .v-main{box-shadow:0 0 0 4px rgba(48,209,88,.75),0 0 18px rgba(48,209,88,.6)}
#voiceBox .v-end{background:#d93025;color:#fff}
#voiceBox .v-end[hidden]{display:none}
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
    endBtn = document.createElement('button'); endBtn.type = 'button'; endBtn.className = 'v-end'; endBtn.innerHTML = HANG; endBtn.hidden = true;
    endBtn.setAttribute('aria-label', 'Hang up');
    const lbl = document.createElement('span'); lbl.className = 'v-lbl';
    box.append(lbl, endBtn, mainBtn); document.body.append(box);
    mainBtn.addEventListener('click', onMain);
    endBtn.addEventListener('click', () => hangUp(true));
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
    const show = !!S.gid && !!S.opp && supported() && !document.body.classList.contains('pregame') && !document.body.classList.contains('training-open');
    box.classList.toggle('show', show || S.state !== 'idle');
    const fab = $('chatFab'), fr = fab && getComputedStyle(fab).display !== 'none' ? fab.getBoundingClientRect() : null;
    const head = document.querySelector('#panel .panel-head'), clear = head?.querySelector('.chat-clear');
    if (fr && fr.width) {
      if (box.parentNode !== document.body) document.body.append(box);
      box.classList.remove('inline');
      box.style.right = Math.round(window.innerWidth - fr.right + (fr.width - 46) / 2) + 'px';
      box.style.bottom = Math.round(window.innerHeight - fr.top + 12) + 'px';
      box.style.flexDirection = 'row';
    } else if (head) {
      if (box.parentNode !== head) (clear ? clear.before(box) : head.append(box));
      box.classList.add('inline'); box.style.right = box.style.bottom = '';
    }
  }
  function paint() {
    if (!box) return;
    box.dataset.s = S.state;
    box.classList.toggle('muted', S.muted);
    endBtn.hidden = S.state === 'idle' || S.state === 'ringing';
    const lbl = box.querySelector('.v-lbl');
    lbl.textContent = S.state === 'calling' ? 'Calling ' + S.oppName + '…' : S.state === 'connecting' ? 'Connecting…' : S.state === 'live' ? (S.muted ? 'Muted' : 'On call') : '';
    mainBtn.innerHTML = S.state === 'live' && S.muted ? MIC_OFF : MIC;
    mainBtn.setAttribute('aria-label', S.state === 'idle' ? 'Voice chat with ' + (S.oppName || 'your opponent') : S.state === 'live' ? (S.muted ? 'Unmute' : 'Mute') : 'Calling');
    mainBtn.title = mainBtn.getAttribute('aria-label');
    place();
  }

  /* ---------------- signalling over the game's realtime connection ---------------- */
  function join(gid) {
    leaveChannel();
    const c = api(); if (!c || !gid) return;
    S.ch = c.channel('chess-voice-' + gid, { config: { broadcast: { self: false } } });
    S.ch.on('broadcast', { event: 'v' }, ({ payload }) => onSignal(payload || {}));
    S.ch.subscribe();
  }
  function leaveChannel() { try { if (S.ch) api()?.removeChannel?.(S.ch); } catch { /* ignore */ } S.ch = null; }
  const send = (t, extra = {}) => S.ch?.send({ type: 'broadcast', event: 'v', payload: { t, from: S.me, to: S.opp, call: S.callId, ...extra } });

  function onSignal(m) {
    if (m.from !== S.opp || m.to !== S.me) return;          /* only my opponent, only to me */
    if (m.t === 'ring') {
      if (S.state === 'calling') { S.callId = [S.callId, m.call].sort()[0]; return void (S.me < S.opp ? startOffer() : null); } /* both tapped: lower id makes the offer */
      if (S.state !== 'idle') return;
      S.callId = m.call; S.state = 'ringing'; showRing(); return;
    }
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
    if (S.local) return S.local;
    S.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    return S.local;
  }
  function makePc() {
    const pc = new RTCPeerConnection({ iceServers: ICE });
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
      const pc = makePc(); for (const t of (await mic()).getTracks()) pc.addTrack(t, S.local);
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      send('offer', { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
    } catch (e) { console.warn('voice offer', e); micError(e); }
  }
  async function onOffer(sdp) {
    try {
      if (!S.pc) makePc();
      const pc = S.pc;
      for (const t of (await mic()).getTracks()) if (!pc.getSenders().some((s) => s.track === t)) pc.addTrack(t, S.local);
      await pc.setRemoteDescription(sdp); flushIce();
      const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
      send('answer', { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      S.state = 'connecting'; paint();
    } catch (e) { micError(e); }
  }
  async function call() {
    if (!S.ch || !S.opp) return;
    try { await mic(); } catch (e) { return micError(e); }   /* ask for the mic now, while the tap counts as a gesture */
    void audio.play().catch(() => {});
    S.callId = Math.random().toString(36).slice(2, 10); S.state = 'calling'; paint();
    send('ring', { name: S.myName });
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
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    toast(denied ? 'Microphone is blocked. Allow it in your browser settings to talk.' : 'Voice chat could not start on this device.');
    reset();
  }
  function reset() {
    clearTimeout(S.ringTimer); hideRing();
    try { S.pc?.close(); } catch { /* closed */ }
    S.pc = null; S.pendingIce = [];
    for (const t of S.local?.getTracks() || []) t.stop();
    S.local = null; S.remote = null; if (audio) audio.srcObject = null;
    stopMeter(); S.needTap = false; S.state = 'idle'; S.muted = false; S.callId = null; paint();
  }
  function onMain() {
    if (S.state === 'idle') return void call();
    if (S.needTap) { S.needTap = false; void audio.play().catch(() => {}); return; }   /* iPhone: first tap only starts the sound */
    if (S.state === 'live') {
      S.muted = !S.muted; for (const t of S.local?.getAudioTracks() || []) t.enabled = !S.muted;
      void audio.play().catch(() => {}); paint(); return;
    }
    if (S.state === 'calling' || S.state === 'connecting') hangUp(true);
  }
  function showRing() {
    ring.querySelector('b').textContent = S.oppName + ' wants to talk';
    ring.hidden = false; navigator.vibrate?.([120, 80, 120]);
    clearTimeout(S.ringTimer); S.ringTimer = setTimeout(() => { if (S.state === 'ringing') { hideRing(); reset(); } }, RING_MS + 2000);
  }
  function hideRing() { if (ring) ring.hidden = true; }
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
  function update(v) {
    build();
    const live = v && v.gameId && v.userId && (v.mySeat === 'w' || v.mySeat === 'b') && v.whiteId && v.blackId && v.status !== 'waiting';
    const gid = live ? v.gameId : null;
    const opp = live ? (v.mySeat === 'w' ? v.blackId : v.whiteId) : null;
    if (gid !== S.gid || opp !== S.opp) {
      if (S.state !== 'idle') hangUp(true);
      S.gid = gid; S.opp = opp; S.me = live ? v.userId : null;
      if (gid) join(gid); else leaveChannel();
    }
    if (live) { S.oppName = (v.mySeat === 'w' ? v.blackName : v.whiteName) || 'Your opponent'; S.myName = (v.mySeat === 'w' ? v.whiteName : v.blackName) || ''; }
    paint();
  }
  window.addEventListener('pagehide', () => hangUp(true));
  window.familyChessVoice = { update, hangUp: () => hangUp(true), state: () => S.state };
})();
