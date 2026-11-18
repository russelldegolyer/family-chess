/* Walkie-talkie voice between the two players of an online game (internet audio between the two apps).
   While both of you are in the same online game, the apps quietly link up in the background (no ringing, no Join).
   Hold the mic button to talk: your voice streams live while you hold it and stops the moment you let go.
   While you hold it, the other player's mic button lights up green with "<name> is talking".
   Privacy: the microphone is only opened by holding the button, nothing is sent while it is released (the track is
   detached from the connection), and the mic is fully closed after 45 s without talking, when the game ends, or when
   you leave the app. Audio goes straight between the two apps, encrypted by WebRTC (DTLS-SRTP); it is never
   recorded, uploaded or stored. The "how to reach me" handshake runs on a PRIVATE realtime channel that only the two
   signed-in friends can join (database rule chess_voice_pair_*). */
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
  const MIC_IDLE_MS = 45000;
  const S = {
    me: null, opp: null, oppName: '', gameId: null, inGame: false,
    pc: null, sid: null, sender: null, link: 'off',   /* link: off | connecting | on */
    local: null, remote: null, holding: false, pressAt: 0, theyTalk: false,
    helloTimer: 0, linkTimer: 0, theyTimer: 0, beat: 0, idleTimer: 0, reachTimer: 0,
    pendingIce: [], offering: false, meter: null, hinted: false,
  };
  const $ = (id) => document.getElementById(id);
  const api = () => window.chessSupabase;
  const toast = (m) => window.familyChessToast?.(m);
  const supported = () => !!(navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection);
  /* iPhone: move sounds put the audio session in 'playback', and Safari refuses the microphone in that mode
     (InvalidStateError). Talking switches it to 'play-and-record'; closing the mic hands it back ('auto'). */
  const session = (t) => { try { if (navigator.audioSession && navigator.audioSession.type !== t) navigator.audioSession.type = t; } catch { /* older Safari */ } };

  /* ---------------- UI ---------------- */
  const MIC = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  let box, mainBtn, lbl, audio;
  function build() {
    if (box) return;
    const css = document.createElement('style');
    css.textContent = `
#voiceBox{position:fixed;z-index:46;display:none;align-items:center;gap:8px}
#voiceBox.show{display:flex}
#voiceBox button{width:46px;height:46px;border:0;border-radius:50%;display:grid;place-items:center;cursor:pointer;color:#f2f2f7;
 background:rgba(36,36,40,.94);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1),0 6px 18px rgba(0,0,0,.45);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);
 touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;transition:transform .12s,background .12s}
#voiceBox[data-s="talking"] .v-main{background:#1f8f45;color:#fff;transform:scale(1.12);box-shadow:0 0 0 4px rgba(48,209,88,.55),0 0 22px rgba(48,209,88,.65)}
#voiceBox[data-s="hearing"] .v-main{color:#30d158;box-shadow:0 0 0 2px rgba(48,209,88,.85),0 6px 18px rgba(0,0,0,.45);animation:vPulse 1.1s ease-in-out infinite}
#voiceBox[data-s="hearing"].loud .v-main{background:rgba(31,143,69,.35)}
#voiceBox .v-lbl{font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#c7c7cc;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis;
 padding:5px 9px;border-radius:999px;background:rgba(24,24,28,.92)}
#voiceBox[data-s="hearing"] .v-lbl{color:#30d158}
#voiceBox .v-lbl:empty{display:none}
#voiceBox.inline{position:static;gap:6px}
#voiceBox.inline button{width:36px;height:36px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
#voiceBox.inline button svg{width:18px;height:18px}
#voiceBox.inline .v-lbl{background:none;padding:0;max-width:110px}
@keyframes vPulse{0%,100%{box-shadow:0 0 0 2px rgba(48,209,88,.85),0 0 0 0 rgba(48,209,88,.5)}50%{box-shadow:0 0 0 2px rgba(48,209,88,.85),0 0 0 9px rgba(48,209,88,0)}}
@media (prefers-reduced-motion: reduce){#voiceBox .v-main{animation:none!important;transition:none}}`;
    document.head.append(css);
    box = document.createElement('div'); box.id = 'voiceBox'; box.dataset.s = 'off';
    mainBtn = document.createElement('button'); mainBtn.type = 'button'; mainBtn.className = 'v-main'; mainBtn.innerHTML = MIC;
    lbl = document.createElement('span'); lbl.className = 'v-lbl'; lbl.setAttribute('aria-live', 'polite');
    box.append(lbl, mainBtn); document.body.append(box);
    /* hold to talk: pointer (touch and mouse) plus Space/Enter for keyboards */
    mainBtn.addEventListener('pointerdown', (e) => { if (e.button > 0) return; e.preventDefault(); try { mainBtn.setPointerCapture(e.pointerId); } catch { /* old browser */ } void pressStart(); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) mainBtn.addEventListener(ev, () => pressEnd());
    mainBtn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); void pressStart(); } });
    mainBtn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pressEnd(); } });
    mainBtn.addEventListener('blur', () => pressEnd());
    box.addEventListener('contextmenu', (e) => e.preventDefault());
    audio = document.createElement('audio'); audio.autoplay = true; audio.setAttribute('playsinline', ''); audio.hidden = true; document.body.append(audio);
    new MutationObserver(place).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', place);
  }
  /* phones with chat closed: floating above the chat button; otherwise inline in the chat header */
  function place() {
    if (!box) return;
    const show = !!S.opp && S.inGame && supported() && !document.body.classList.contains('pregame') && !document.body.classList.contains('training-open');
    box.classList.toggle('show', show || S.holding);
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
    } else {   /* opening screen, menus: keep it reachable at the bottom right */
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
    const st = S.holding ? 'talking' : S.theyTalk ? 'hearing' : S.link === 'on' ? 'ready' : S.link;
    box.dataset.s = st;
    lbl.textContent = st === 'talking' ? (S.link === 'on' ? 'Talking…' : 'Connecting…') : st === 'hearing' ? S.oppName + ' is talking' : '';
    const name = S.oppName || 'your opponent';
    mainBtn.setAttribute('aria-label', 'Hold to talk to ' + name);
    mainBtn.title = S.link === 'on' ? 'Hold to talk to ' + name : 'Hold to talk (connecting to ' + name + ')';
    place();
  }

  /* ---------------- signalling over a private realtime channel per friend pair ---------------- */
  const chans = new Map();   /* friendId -> channel */
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
  const send = (t, extra = {}) => chans.get(S.opp)?.send({ type: 'broadcast', event: 'v', payload: { t, from: S.me, to: S.opp, g: S.gameId, ...extra } });

  function onSignal(m, friend) {
    if (m.from !== friend || m.to !== S.me) return;          /* only that friend, only to me */
    if (friend !== S.opp || !S.inGame || m.g !== S.gameId) return;   /* only while we're in the same game */
    if (m.t === 'hello') {
      if (S.link === 'on') relink();          /* they lost the line (app reopened): start over */
      if (S.link === 'off' && !S.offering) { if (S.me < S.opp) void makeOffer(); else send('hello'); }   /* lower id offers */
      return;
    }
    if (m.t === 'offer') return void onOffer(m);
    if (m.t === 'answer') { if (S.pc && m.sid === S.sid && S.pc.signalingState === 'have-local-offer') S.pc.setRemoteDescription(m.sdp).then(flushIce).catch(() => relink()); return; }
    if (m.t === 'ice' && m.c) { if (m.sid !== S.sid) return; if (S.pc?.remoteDescription) S.pc.addIceCandidate(m.c).catch(() => {}); else S.pendingIce.push(m.c); return; }
    if (m.t === 'talk') {
      clearTimeout(S.theyTimer);
      S.theyTalk = !!m.on;
      if (S.theyTalk) { S.theyTimer = setTimeout(() => { S.theyTalk = false; paint(); }, 5000); playRemote(); }   /* refreshed every 2 s while they hold */
      paint(); return;
    }
    if (m.t === 'bye') { relink(); }
  }
  function flushIce() { const q = S.pendingIce.splice(0); for (const c of q) S.pc?.addIceCandidate(c).catch(() => {}); }

  /* ---------------- the line (connected in the background, silent until someone holds the button) ---------------- */
  function startHello() {
    if (S.helloTimer || !S.inGame || S.link !== 'off') return;
    let n = 0;
    const tick = () => {
      S.helloTimer = 0;
      if (!S.inGame || S.link !== 'off') return;
      send('hello'); n++;
      S.helloTimer = setTimeout(tick, n < 10 ? 3000 : 10000);
    };
    S.helloTimer = setTimeout(tick, 400);
  }
  function stopHello() { clearTimeout(S.helloTimer); S.helloTimer = 0; }
  function makePc(sid) {
    const pc = new RTCPeerConnection({ iceServers: S.ice || STUN });
    pc.onicecandidate = (e) => { if (e.candidate && S.pc === pc) send('ice', { sid, c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.ontrack = (e) => { if (S.pc !== pc) return; S.remote = e.streams[0] || new MediaStream([e.track]); audio.srcObject = S.remote; playRemote(); watchLevel(); };
    pc.onconnectionstatechange = () => {
      if (S.pc !== pc) return;
      const st = pc.connectionState;
      if (st === 'connected') { S.link = 'on'; clearTimeout(S.linkTimer); clearTimeout(S.reachTimer); stopHello(); paint(); }
      else if (st === 'failed') relink();
      else if (st === 'disconnected') setTimeout(() => { if (S.pc === pc && pc.connectionState === 'disconnected') relink(); }, 5000);
    };
    S.pc = pc; S.sid = sid; return pc;
  }
  async function attachMic() {
    if (!S.sender) return;
    const track = S.holding && S.local ? S.local.getAudioTracks()[0] || null : null;
    if (S.sender.track !== track) await S.sender.replaceTrack(track).catch(() => {});
  }
  async function makeOffer() {
    if (S.pc || S.offering || !S.inGame) return;
    S.offering = true; S.link = 'connecting'; paint();
    const sid = Math.random().toString(36).slice(2, 10);
    try {
      S.ice = await iceServers();
      if (S.pc || !S.inGame) return;
      const pc = makePc(sid);
      S.sender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
      await attachMic();
      await pc.setLocalDescription(await pc.createOffer());
      send('offer', { sid, sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      clearTimeout(S.linkTimer); S.linkTimer = setTimeout(() => { if (S.pc === pc && S.link !== 'on') relink(); }, 15000);
    } catch (e) { console.warn('voice offer', e); relink(); }
    finally { S.offering = false; }
  }
  async function onOffer(m) {
    closeLink(false);
    S.sid = m.sid; S.link = 'connecting'; stopHello(); paint();
    try {
      S.ice = await iceServers();
      if (S.sid !== m.sid || !S.inGame) return;
      const keep = S.pendingIce.splice(0);
      const pc = makePc(m.sid); S.pendingIce = keep;
      await pc.setRemoteDescription(m.sdp);
      const tr = pc.getTransceivers().find((t) => t.receiver?.track?.kind === 'audio') || pc.addTransceiver('audio', { direction: 'sendrecv' });
      tr.direction = 'sendrecv'; S.sender = tr.sender;
      await attachMic();
      await pc.setLocalDescription(await pc.createAnswer());
      send('answer', { sid: m.sid, sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      flushIce();
      clearTimeout(S.linkTimer); S.linkTimer = setTimeout(() => { if (S.pc === pc && S.link !== 'on') relink(); }, 15000);
    } catch (e) { console.warn('voice answer', e); relink(); }
  }
  function closeLink(tell) {
    if (tell && S.pc) send('bye');
    clearTimeout(S.linkTimer);
    try { S.pc?.close(); } catch { /* closed */ }
    S.pc = null; S.sid = null; S.sender = null; S.pendingIce = []; S.link = 'off';
    S.remote = null; if (audio) { try { audio.pause(); } catch { /* not playing */ } audio.srcObject = null; }
    stopMeter(); clearTimeout(S.theyTimer); S.theyTalk = false;
  }
  function relink() { closeLink(false); paint(); if (S.inGame) startHello(); }
  /* iPhone plays the incoming voice only after a tap on the page: any tap retries it */
  function playRemote() { if (audio?.srcObject && audio.paused) void audio.play().catch(() => {}); }

  /* ---------------- the microphone ---------------- */
  async function mic() {
    if (S.local && S.local.getAudioTracks().some((t) => t.readyState === 'live')) return S.local;
    S.local = null;
    if (!supported()) { const e = new Error('unsupported'); e.name = 'NotSupportedError'; throw e; }
    session('play-and-record');
    try { S.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }); }
    catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
      /* some phones refuse the tuned settings: try once more with the plainest request */
      console.warn('voice mic (tuned)', e && e.name, e && e.message);
      session('play-and-record');
      S.local = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    for (const t of S.local.getAudioTracks()) t.enabled = false;
    return S.local;
  }
  function closeMic() {
    clearTimeout(S.idleTimer);
    for (const t of S.local?.getTracks() || []) t.stop();
    if (S.local) session('auto');
    S.local = null;
  }
  function micError(e) {
    const n = (e && e.name) || 'Error';
    console.warn('voice mic', n, e && e.message);
    toast(n === 'NotAllowedError' || n === 'SecurityError' ? 'The microphone is blocked. Allow it for this site in Settings to talk.'
      : n === 'NotFoundError' ? 'No microphone found on this device.'
      : n === 'NotReadableError' || n === 'AbortError' || n === 'InvalidStateError' ? 'The microphone is busy. Close other apps using it (calls, recordings) and try again.'
      : n === 'NotSupportedError' ? 'This browser can’t do voice chat. Try Safari or Chrome.'
      : 'The microphone couldn’t start (' + n + '). Try again.');
  }

  /* ---------------- hold to talk ---------------- */
  async function pressStart() {
    if (S.holding || !S.opp || !S.inGame) return;
    S.holding = true; S.pressAt = Date.now(); clearTimeout(S.idleTimer); paint();
    playRemote();
    navigator.vibrate?.(15);
    try { await mic(); } catch (e) { S.holding = false; paint(); return micError(e); }
    if (!S.holding) return void idleLater();            /* let go before the mic was ready */
    for (const t of S.local.getAudioTracks()) t.enabled = true;
    await attachMic();
    send('talk', { on: true });
    clearInterval(S.beat); S.beat = setInterval(() => { if (S.holding) send('talk', { on: true }); }, 2000);
    if (S.link === 'off') { stopHello(); startHello(); }
    clearTimeout(S.reachTimer);
    if (S.link !== 'on') S.reachTimer = setTimeout(() => { if (S.link !== 'on') toast('Can’t reach ' + (S.oppName || 'your opponent') + ' yet. Voice works while you’re both in this game.'); }, 8000);
  }
  function pressEnd() {
    if (!S.holding) return;
    S.holding = false; clearInterval(S.beat); clearTimeout(S.reachTimer);
    for (const t of S.local?.getAudioTracks() || []) t.enabled = false;
    void attachMic();   /* detaches the track: nothing is sent while released */
    send('talk', { on: false });
    if (Date.now() - S.pressAt < 300 && !S.hinted) { S.hinted = true; toast('Hold the mic button while you talk, then let go.'); }
    paint(); idleLater();
  }
  function idleLater() { clearTimeout(S.idleTimer); S.idleTimer = setTimeout(() => { if (!S.holding) closeMic(); }, MIC_IDLE_MS); }

  /* a soft green fill on the button while the other person's voice is coming through */
  function watchLevel() {
    stopMeter();
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx || !S.remote) return;
      const ctx = new Ctx(), an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaStreamSource(S.remote).connect(an);
      const buf = new Uint8Array(an.fftSize); let raf = 0;
      const tick = () => { an.getByteTimeDomainData(buf); let sum = 0; for (const v of buf) sum += (v - 128) * (v - 128);
        box.classList.toggle('loud', Math.sqrt(sum / buf.length) > 6); raf = requestAnimationFrame(tick); };
      tick(); S.meter = { ctx, stop: () => cancelAnimationFrame(raf) };
    } catch { /* no meter */ }
  }
  function stopMeter() { try { S.meter?.stop(); S.meter?.ctx.close(); } catch { /* closed */ } S.meter = null; box?.classList.remove('loud'); }

  /* ---------------- game hookup ---------------- */
  function leave(tell) {
    stopHello(); clearInterval(S.beat); clearTimeout(S.reachTimer);
    if (S.holding) { S.holding = false; send('talk', { on: false }); }
    closeLink(tell); closeMic(); paint();
  }
  /* called by the game whenever the online view changes */
  let lastView = null;
  function update(v) {
    build(); lastView = v;
    const live = !!(v && v.gameId && v.userId && (v.mySeat === 'w' || v.mySeat === 'b') && v.whiteId && v.blackId && v.status !== 'waiting');
    const opp = live ? (v.mySeat === 'w' ? v.blackId : v.whiteId) : null, gid = live ? v.gameId : null;
    if (live && v.userId !== S.me) { leave(true); unlistenAll(); S.me = v.userId; }
    if (opp !== S.opp || gid !== S.gameId) { leave(true); S.opp = opp; S.gameId = gid; }
    S.inGame = live;
    if (live) {
      S.oppName = (v.mySeat === 'w' ? v.blackName : v.whiteName) || 'Your opponent';
      void listen(opp).then(() => { if (S.inGame && S.link === 'off') startHello(); });
    }
    paint();
  }
  /* iPhone lets a page play sound only after a tap: every tap (until the voice is playing) unlocks the player */
  const unlockAudio = () => { if (audio && audio.paused) void audio.play().catch(() => {}); };
  const boot = () => { build(); ['pointerdown', 'keydown', 'touchend'].forEach((e) => window.addEventListener(e, unlockAudio, { passive: true })); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  /* leaving the app closes the line and the mic; coming back reconnects in the background */
  window.addEventListener('pagehide', () => leave(true));
  let awayTimer = 0;
  document.addEventListener('visibilitychange', () => {
    clearTimeout(awayTimer);
    if (document.visibilityState === 'hidden') { pressEnd(); awayTimer = setTimeout(() => { if (document.visibilityState === 'hidden') leave(true); }, 4000); }
    else if (lastView) update(lastView);
  });
  window.familyChessVoice = { update, hangUp: () => leave(true), state: () => (S.local ? 'mic' : 'idle') };
})();
