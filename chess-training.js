/* Training: Unlimited Puzzles, Endgame Academy and Endgame Challenges.
   Uses the real board through window.familyChessBoard (index.html), so the player's own 3D/2D board, theme
   and colours stay as they are. Practice/online games are saved on entry and restored on exit.
   Puzzles: Supabase table chess_puzzles (Lichess, CC0) when it exists, else the bundled development subset.
   Endgame truth: Lichess tablebase API for <= 7 pieces when reachable, else the built-in engine. */
(() => {
  'use strict';
  const B = () => window.familyChessBoard;
  const api = () => window.chessSupabase || null;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const ICON = {
    hint: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
    skip: '<path d="M5 6l7 6-7 6zM13 6l7 6-7 6z"/>', retry: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/>',
    next: '<path d="M5 12h13M13 6l6 6-6 6"/>', flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>', play: '<path d="M7 5l12 7-12 7z"/>',
  };
  const svgIcon = (k) => '<svg class="tr-ico" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON[k] + '</svg>';
  const btn = (label, cls, fn, icon) => {
    const b = el('button', (/\btr-(x|back|card|item|link|chip)\b/.test(cls || '') ? '' : 'tr-btn ') + (cls || ''));
    if (icon && ICON[icon]) b.innerHTML = svgIcon(icon);
    b.append(el('span', 'tr-btn-label', label)); b.type = 'button'; b.addEventListener('click', fn); return b;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const FILES = 'abcdefgh';
  const sqName = (f, r) => FILES[f] + (r + 1);
  const SQS = []; for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) SQS.push(sqName(f, r));
  const fr = (sq) => [FILES.indexOf(sq[0]), Number(sq[1]) - 1];
  const dist = (a, b) => { const [f1, r1] = fr(a), [f2, r2] = fr(b); return Math.max(Math.abs(f1 - f2), Math.abs(r1 - r2)); };
  const other = (c) => (c === 'w' ? 'b' : 'w');
  const uciOf = (m) => m.from + m.to + (m.promotion || '');

  /* ------------------------------------------------------------------ progress (per profile) */
  let uid = 'local';
  const fresh = () => ({
    v: 1, updated: 0,
    puzzle: { rating: 1200, peak: 1200, attempted: 0, solved: 0, clean: 0, failed: 0, streak: 0, best: 0, hints: 0, cats: {}, history: [] },
    settings: { level: 'adaptive', cat: 'mixed', mode: 'practice' },
    lessons: {}, challenges: {}, path: {}, daily: { day: '', done: false, streak: 0, best: 0, last: '' },
    /* review: misses that come back (1, 3, 7 days); drills: threat + blunder counters; speed: best rounds;
       games: compact plan reads of your recent games (style profile); seen: puzzle ids used by drills */
    review: [], drills: { threat: { a: 0, s: 0, streak: 0, best: 0 }, blunder: { a: 0, s: 0, streak: 0, best: 0 } }, speed: {}, games: [], seen: [],
  });
  let P = fresh();
  const key = () => 'chess.training.' + uid;
  function loadLocal() { try { const v = JSON.parse(localStorage.getItem(key()) || 'null'); if (v && v.v === 1) P = { ...fresh(), ...v, puzzle: { ...fresh().puzzle, ...v.puzzle }, settings: { ...fresh().settings, ...v.settings } }; else P = fresh(); } catch { P = fresh(); } }
  let saveTimer = 0, remoteOk = true;
  function save() {
    P.updated = Date.now();
    try { localStorage.setItem(key(), JSON.stringify(P)); } catch { /* storage blocked: keep in memory */ }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const c = api(); if (!c || uid === 'local' || !remoteOk) return;
      try {
        const { error } = await c.from('chess_training_progress').upsert({ user_id: uid, puzzle_rating: Math.round(P.puzzle.rating), puzzle_rating_peak: Math.round(P.puzzle.peak), data: P, updated_at: new Date().toISOString() });
        if (error && /relation|schema cache|does not exist/i.test(error.message || '')) remoteOk = false;
      } catch { /* offline */ }
    }, 1200);
  }
  async function loadProfile() {
    const c = api();
    try { const { data } = c ? await c.auth.getSession() : { data: null }; uid = data?.session?.user?.id || 'local'; } catch { uid = 'local'; }
    loadLocal();
    if (!c || uid === 'local' || !remoteOk) return;
    try {
      const { data, error } = await c.from('chess_training_progress').select('data,updated_at').eq('user_id', uid).maybeSingle?.() ?? {};
      if (error) { if (/relation|schema cache|does not exist/i.test(error.message || '')) remoteOk = false; return; }
      if (data?.data?.v === 1 && (data.data.updated || 0) > (P.updated || 0)) { P = { ...fresh(), ...data.data }; try { localStorage.setItem(key(), JSON.stringify(P)); } catch { } }
    } catch { /* table not created yet */ }
  }

  /* ------------------------------------------------------------------ engine + tablebase */
  let worker = null, wseq = 0; const waiting = new Map();
  function engine(fen, level = 5, budget = 800, analysisMove = '') {
    if (!worker) {
      try {
        worker = new Worker(URL.createObjectURL(new Blob([B().engineSource()], { type: 'text/javascript' })));
        worker.onmessage = (e) => { const w = waiting.get(e.data.id); if (w) { waiting.delete(e.data.id); w(e.data); } };
      } catch { return Promise.resolve(null); }
    }
    const id = ++wseq;
    return new Promise((res) => { waiting.set(id, res); worker.postMessage({ id, fen, level, budget, analysisMove }); setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); res(null); } }, budget + 4000); });
  }
  const MATE = 100000;
  let tbOk = true;
  async function tablebase(fen) {
    if (!tbOk) return null;
    const pieces = fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;
    if (pieces > 7) return null;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch('https://tablebase.lichess.ovh/standard?fen=' + encodeURIComponent(fen), { signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch { tbOk = false; return null; } /* blocked or offline: use the engine from now on */
  }
  /* exact built-in tables (tools/build-endgame-tables.mjs): K+Q, K+R, K+P (White) vs K — perfect play offline */
  const TABLES = {}; let tablesP = null;
  function loadTables() {
    if (!tablesP) tablesP = Promise.all(['q', 'r', 'p'].map(async (t) => {
      try { const r = await fetch('endgame-k' + t + 'k.bin?v=1'); if (r.ok) TABLES[t] = new Uint8Array(await r.arrayBuffer()); } catch { /* fall back to tablebase/engine */ }
    }));
    return tablesP;
  }
  /* plies to mate for the side to move from an exact table, or null when the position is not covered */
  function probe(fen) {
    const parts = fen.split(' '), rows = parts[0].split('/'); const pcs = [];
    rows.forEach((row, ri) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { pcs.push([ch, (7 - ri) * 8 + f]); f++; } } });
    const wk = pcs.find((x) => x[0] === 'K'), bk = pcs.find((x) => x[0] === 'k'); if (!wk || !bk) return null;
    const rest = pcs.filter((x) => x[0] !== 'K' && x[0] !== 'k');
    if (!rest.length || (rest.length === 1 && /[BNbn]/.test(rest[0][0]))) return { r: 'draw', src: 'rules' };
    if (rest.length !== 1 || !/[QRP]/.test(rest[0][0])) return null;
    const T = TABLES[rest[0][0].toLowerCase()]; if (!T) return null;
    const stm = parts[1] === 'w' ? 0 : 1, v = T[((wk[1] * 64 + bk[1]) * 64 + rest[0][1]) * 2 + stm];
    if (v === 254) return null;
    if (v === 255) return { r: 'draw', plies: null, src: 'table' };
    return { r: stm === 0 ? 'win' : 'loss', plies: v, src: 'table' };
  }
  /* best move by the exact table: the winner mates fastest, the loser lasts longest or grabs a draw */
  function tableBest(fen) {
    const C = B().Chess, c = new C(fen); const here = probe(fen); if (!here || here.src !== 'table') return null;
    let best = null, bestKey = -Infinity;
    for (const m of c.moves({ verbose: true })) {
      c.move(m); const mate = c.isCheckmate(); const j = mate ? { r: 'loss', plies: 0 } : (c.isStalemate() || c.isInsufficientMaterial()) ? { r: 'draw' } : probe(c.fen()); c.undo();
      if (!j) continue;
      /* key from the mover's point of view: opponent loses fast > draw > opponent wins slowly */
      let key = j.r === 'loss' ? 1000 - j.plies : j.r === 'draw' ? 0 : -1000 + (j.plies || 0);
      if (j.r === 'draw' && here.r === 'draw') { c.move(m); const n = keepers(c.fen()).length; c.undo(); key -= n / 100; }
      if (key > bestKey) { bestKey = key; best = uciOf(m); }
    }
    return best;
  }
  /* outcome for the side to move: 'win' | 'draw' | 'loss', plus a comparable distance when known */
  async function judge(fen) {
    const C = B().Chess, c = new C(fen);
    if (c.isCheckmate()) return { r: 'loss', mate: 0, plies: 0, src: 'rules' };
    if (c.isStalemate() || c.isInsufficientMaterial() || c.isDraw()) return { r: 'draw', src: 'rules' };
    await loadTables();
    const t = probe(fen); if (t) return t;
    const tb = await tablebase(fen);
    if (tb && tb.category) {
      const cat = tb.category;
      const r = /win/.test(cat) && !/cursed|maybe/.test(cat) ? 'win' : /loss/.test(cat) && !/blessed|maybe/.test(cat) ? 'loss' : 'draw';
      return { r, dtm: tb.dtm ?? null, dtz: tb.dtz ?? null, best: tb.moves?.[0]?.uci || null, src: 'tablebase' };
    }
    const e = await engine(fen, 5, 700);
    const sc = e?.score ?? 0;
    const r = sc > 350 ? 'win' : sc < -350 ? 'loss' : 'draw';
    return { r, score: sc, mate: Math.abs(sc) > MATE - 500 ? MATE - Math.abs(sc) : null, best: e?.move || null, src: 'engine' };
  }
  async function bestMove(fen) {
    await loadTables();
    const tm = tableBest(fen); if (tm) return tm;
    const tb = await tablebase(fen);
    if (tb?.moves?.length) return tb.moves[0].uci;
    const e = await engine(fen, 5, 900);
    return e?.move || null;
  }

  /* ------------------------------------------------------------------ king-box geometry (lessons + feedback) */
  function attackedBy(c, sq, color) { try { return c.isAttacked(sq, color); } catch { return false; } }
  /* squares the defending king could ever reach without stepping onto an attacked square */
  function box(fen, def) {
    const C = B().Chess, c = new C(fen);
    const k = c.board().flat().find((p) => p && p.type === 'k' && p.color === def);
    if (!k) return { area: 0, squares: [] };
    const kSq = k.square; c.remove(kSq);
    const att = other(def), seen = new Set([kSq]), q = [kSq];
    while (q.length) {
      const s = q.shift(), [f, r] = fr(s);
      for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
        const nf = f + df, nr = r + dr; if ((!df && !dr) || nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        const n = sqName(nf, nr); if (seen.has(n)) continue;
        const pc = c.get(n);
        if (pc && pc.color === att) continue;
        if (attackedBy(c, n, att)) continue;
        seen.add(n); q.push(n);
      }
    }
    return { area: seen.size, squares: [...seen], king: kSq };
  }
  const kingSq = (c, color) => c.board().flat().find((p) => p && p.type === 'k' && p.color === color)?.square;
  const onEdge = (sq) => { const [f, r] = fr(sq); return f === 0 || f === 7 || r === 0 || r === 7; };
  function mateMoves(c) { return c.moves({ verbose: true }).filter((m) => { c.move(m); const x = c.isCheckmate(); c.undo(); return x; }); }
  function hangs(c, m, me) { /* the moved piece can simply be taken by the defending king */
    if (m.piece === 'k') return false;
    const ks = kingSq(c, other(me)); if (!ks || dist(ks, m.to) > 1) return false;
    return !attackedBy(c, m.to, me);
  }
  /* The box method as a move chooser for K+Q / K+R / K+R+R vs K: shrink the box, keep pieces safe, bring the
     king, never stalemate. Used for demonstrations and suggestions when the tablebase is unavailable. */
  function teacherMove(fen, seen = new Set()) {
    const C = B().Chess, c = new C(fen), me = c.turn(), def = other(me);
    let best = null, bestS = Infinity;
    for (const m of c.moves({ verbose: true })) {
      c.move(m);
      if (c.isCheckmate()) { c.undo(); return uciOf(m); }
      const bad = c.isStalemate() || c.isDraw() || hangs(c, m, me);
      if (bad) { c.undo(); continue; }
      let worst = -Infinity;
      for (const r of c.moves({ verbose: true })) {
        if (r.captured) { worst = 1e6; break; }
        c.move(r);
        const bx = box(c.fen(), def), ks = kingSq(c, me), dk = kingSq(c, def);
        const s = bx.area * 10 + dist(ks, dk) * 2 + (seen.has(c.fen().split(' ').slice(0, 2).join(' ')) ? 30 : 0);
        c.undo(); if (s > worst) worst = s;
      }
      const s = worst + Math.random() * 0.5;
      c.undo();
      if (s < bestS) { bestS = s; best = uciOf(m); }
    }
    return best;
  }

  /* ------------------------------------------------------------------ UI shell */
  const root = el('div', 'tr-root'); root.hidden = true; root.setAttribute('aria-label', 'Training');
  const hub = el('section', 'tr-sheet'); hub.hidden = true;
  const top = el('div', 'tr-top'); top.hidden = true;
  const panel = el('div', 'tr-panel'); panel.hidden = true;
  root.append(hub, top, panel);
  document.addEventListener('DOMContentLoaded', () => document.body.append(root));
  if (document.body) document.body.append(root);

  let screen = null; /* 'hub' | 'puzzle' | 'lesson' | 'challenge' */
  let session = 0; /* bumps on every screen change so stale async work stops */
  function setTop(title, right) {
    top.replaceChildren();
    const back = btn('', 'tr-back', () => (RETURN ? RETURN() : openHub()));
    back.innerHTML = '<svg width="11" height="18" viewBox="0 0 11 18" aria-hidden="true"><path d="M9 2L2 9l7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Training</span>';
    if (RETURN) { const sp = back.querySelector('span'); if (sp) sp.textContent = RETURN.label || 'Chapter'; }
    back.setAttribute('aria-label', RETURN ? 'Back to ' + (RETURN.label || 'the chapter').toLowerCase() : 'Back to Training');
    const t = el('div', 'tr-title', title);
    const r = el('div', 'tr-right');
    const v = el('button', 'tr-chip tr-view', B().view() === '2d' ? '3D' : '2D'); v.type = 'button';
    v.setAttribute('aria-label', 'Switch to ' + v.textContent + ' board');
    v.addEventListener('click', () => { const nv = B().view() === '2d' ? '3d' : '2d'; B().setView(nv); try { localStorage.setItem('chess.trainView', JSON.stringify(nv)); } catch { } v.textContent = nv === '2d' ? '3D' : '2D'; v.setAttribute('aria-label', 'Switch to ' + v.textContent + ' board'); });
    r.append(v); if (right) r.append(right);
    top.append(back, t, r); top.hidden = false;
  }
  const say = (node, text, tone) => { node.textContent = text; node.className = 'tr-say' + (tone ? ' ' + tone : ''); };

  function open() {
    if (!B()) return;
    root.hidden = false; document.body.classList.add('training-open');
    B().enter();
    void loadProfile().then(() => { if (screen === 'hub') renderHub(); });
    openHub();
  }
  function close() {
    session++; screen = null; B()?.onTap?.(null); RV = null;
    hub.hidden = true; top.hidden = true; panel.hidden = true; root.hidden = true;
    document.body.classList.remove('training-open');
    B()?.exit();
  }

  /* board marks + a one-line key under the task so the colours are never a guess */
  function mark(m) {
    m = m || {}; B().mark(m);
    let lg = panel.querySelector('.tr-legend');
    let items = [];
    if (m.tint && m.tint.length && !m.noLegend) items.push(['zone', 'Red zone: squares the enemy king can reach']);
    if (m.arrows && m.arrows.length) items.push(['arrow', 'Arrow: the move to play']);
    if (m.lift && !(m.arrows && m.arrows.length)) items.push(['lift', 'Highlighted: the piece to move']);
    if (m.legend) items = m.legend; else if (m.noLegend) items = [];
    if (!items.length || panel.hidden) { lg?.remove(); return; }
    if (!lg) { lg = el('div', 'tr-legend'); const head = panel.querySelector('.tr-head2'); if (head) head.after(lg); else panel.prepend(lg); }
    lg.replaceChildren(...items.map(([k, t]) => { const i = el('span', 'tr-lg ' + k); i.append(el('i'), document.createTextNode(t)); return i; }));
  }
  function openHub() {
    session++; screen = 'hub'; PATH = null; RETURN = null; RV = null;
    top.hidden = true; panel.hidden = true;
    B().onMove(null); B().onTap(null); mark({});
    renderHub(); hub.hidden = false;
    void loadSavedRows().then(() => {
      if (screen !== 'hub') return;
      const b = [...hub.querySelectorAll('.tr-card')].find((c) => c.textContent.includes('Saved games'))?.querySelector('.tr-card-badge');
      if (b) b.textContent = savedCount ? String(savedCount) : '';
    }).catch(() => {});
  }
  function renderHub() {
    hub.classList.remove('tr-sg-page', 'tr-ed-page'); hub.replaceChildren();
    const head = el('div', 'tr-head');
    head.append(el('h2', '', 'Training'));
    const x = btn('', 'tr-x', close); x.setAttribute('aria-label', 'Close training');
    x.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
    head.append(x);
    const pz = P.puzzle;
    const acc = pz.attempted ? Math.round((pz.solved / pz.attempted) * 100) + '%' : '–';
    const lessonsDone = LESSONS.filter((l) => P.lessons[l.id]?.mastered).length;
    const chDone = Object.values(P.challenges).reduce((a, c) => a + (c.wins || 0), 0);
    const overall = Math.round(((Math.min(pz.solved, 100) / 100) + lessonsDone / LESSONS.length + Math.min(chDone, 20) / 20) / 3 * 100);
    /* hero: puzzle rating + overall progress ring; then four compact counters */
    const hero = el('div', 'tr-hero');
    const hm = el('div', 'tr-hero-main');
    hm.append(el('span', 'tr-hero-label', 'Puzzle rating'), el('b', 'tr-hero-num', String(Math.round(pz.rating))),
      el('span', 'tr-hero-sub', 'Peak ' + Math.round(pz.peak) + (pz.streak ? ' · 🔥 ' + pz.streak + ' streak' : '')));
    const ring = el('div', 'tr-ring'); ring.style.setProperty('--p', overall);
    ring.innerHTML = '<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" class="trk"/><circle cx="18" cy="18" r="15.5" class="val" pathLength="100" stroke-dasharray="' + overall + ' 100"/></svg>';
    const rl = el('span', 'tr-ring-label'); rl.append(el('b', '', overall + '%'), el('span', '', 'overall')); ring.append(rl);
    hero.append(hm, ring);
    const mini = el('div', 'tr-mini');
    const m = (v, l) => { const d = el('div'); d.append(el('b', '', v), el('span', '', l)); mini.append(d); };
    m(String(pz.solved), 'Solved'); m(acc, 'Accuracy'); m(lessonsDone + '/' + LESSONS.length, 'Lessons'); m(String(chDone), 'Challenges');
    const cards = el('div', 'tr-cards');
    const card = (title, sub, icon, badge, fn) => { const c = btn('', 'tr-card', fn); c.innerHTML = '<span class="tr-card-ico" aria-hidden="true">' + icon + '</span><span class="tr-card-text"><b></b><span></span></span><span class="tr-card-badge"></span><span class="tr-chev" aria-hidden="true">›</span>'; c.querySelector('b').textContent = title; c.querySelector('.tr-card-text span').textContent = sub; c.querySelector('.tr-card-badge').textContent = badge; cards.append(c); };
    const due = reviewDue().length, D = P.drills || {};
    const sharp = el('div', 'tr-cards');
    const scard = (title, sub, icon, badge, fn, hot) => { card(title, sub, icon, badge, fn); const c = cards.lastChild; if (hot) c.classList.add('hot'); sharp.append(c); };
    scard('Review', due ? due + ' due today — misses come back' : 'Misses come back after 1, 3 and 7 days', '↻', due ? String(due) : '', () => openReview(), due > 0);
    scard('Spot the threat', 'See what your opponent is planning, then stop it', '⚠', D.threat?.streak ? '🔥 ' + D.threat.streak : '', () => { PATH = null; RETURN = null; startThreat(); });
    scard('Blunder check', 'Safe move, or a blunder? Decide before you play', '?', D.blunder?.streak ? '🔥 ' + D.blunder.streak : '', () => { PATH = null; RETURN = null; startBlunder(); });
    scard('Speed rounds', 'Five quick puzzles on one pattern', '⚡', '', () => openSpeed());
    card('Unlimited Puzzles', 'Tactics by rating, with hints', '♞', pz.solved ? pz.solved + ' solved' : '', () => openPuzzles());
    card('Endgame Academy', 'From the basics to checkmate', '♚', lessonsDone + '/' + LESSONS.length, () => openAcademy());
    card('Endgame Challenges', 'Win against a defending computer', '♜', chDone ? chDone + ' won' : '', () => openChallenges());
    card('Saved games', 'Pick up a game where you left it', '★', savedCount ? String(savedCount) : '', () => openSaved());
    card('Matches', 'Your record vs humans and the computer', '⚔', '', () => void openMatchesPage());
    const you = el('div', 'tr-cards');
    const ng = (P.games || []).length;
    card('Your style', ng >= 3 ? 'What you go for, what costs you, what to fix' : 'Builds up from your games', '◎', ng ? String(Math.min(ng, 20)) + (ng === 1 ? ' game' : ' games') : '', () => openStyle()); you.append(cards.lastChild);
    hub.append(head, hero, mini, pathCard(), dailyCard(), el('div', 'tr-section', 'Sharpen'), sharp, el('div', 'tr-section', 'Practice'), cards, el('div', 'tr-section', 'You'), you);
    const info = el('div', 'tr-cards tr-about-row');
    const ab = btn('', 'tr-card', () => openAbout());
    ab.innerHTML = '<span class="tr-card-ico grey" aria-hidden="true">i</span><span class="tr-card-text"><b>About Training</b><span>Ratings, levels and how it all works</span></span><span class="tr-chev" aria-hidden="true">›</span>';
    info.append(ab); hub.append(info);
    const back = btn('Back to the game', 'tr-link', close); hub.append(back);
  }
  /* ------------------------------------------------------------------ saved games */
  let savedCount = 0, savedRows = [];
  const BACK = '<svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2L2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const TRASH = '<svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const subHead = (title, backTo, backLabel) => {
    const head = el('div', 'tr-head'); const back = btn('', 'tr-back', backTo);
    back.innerHTML = BACK + (backLabel || 'Training'); head.append(back, el('h2', '', title)); return head;
  };
  async function loadSavedRows() {
    const c = api(); if (!c || uid === 'local') return null;
    const { data, error } = await c.from('chess_saved_games')
      .select('id,group_id,source,owner_side,opponent_id,white_name,black_name,moves,sans,actions,fen,level,keep,created_at,start_fen,clock')
      .order('created_at', { ascending: false }).limit(60);
    if (error) throw error;
    savedRows = data || []; savedCount = savedRows.length; return savedRows;
  }
  const oppName = (g) => (g.owner_side === 'w' ? g.black_name : g.white_name) || 'your opponent';
  const savedTitle = (g) => g.source === 'custom' ? 'Custom position' : g.source === 'online' ? 'vs ' + oppName(g) : g.source === 'computer' ? 'vs Computer · Level ' + (g.level || 2) : 'Two players';
  const sideName = (s) => (s === 'b' ? 'Black' : 'White');
  const turnOf = (g) => ((g.fen || '').split(' ')[1] === 'b' ? 'b' : 'w');
  const whenOf = (g) => { const d = new Date(g.created_at); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
  function lastTwo(g) {
    const n = g.moves.length, out = [];
    for (let i = Math.max(0, n - 2); i < n; i++) out.push({ uci: g.moves[i], san: (g.sans || [])[i] || g.moves[i], color: i % 2 === 0 ? 'w' : 'b' });
    // A pawn-for-time change can shift whose move a ply was; trust the position for the last mover.
    if (out.length) { const last = out[out.length - 1]; const mover = turnOf(g) === 'w' ? 'b' : 'w'; if (last.color !== mover) out.forEach((m) => { m.color = m.color === 'w' ? 'b' : 'w'; }); }
    return out;
  }
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  function miniBoard(g) {
    const flip = g.owner_side === 'b', rows = (g.fen || '').split(' ')[0].split('/');
    const mark = {}; for (const m of lastTwo(g)) { mark[m.uci.slice(0, 2)] = m.color + 'f'; mark[m.uci.slice(2, 4)] = m.color + 't'; }
    let svg = '<svg viewBox="0 0 8 8" aria-hidden="true">';
    for (let r = 0; r < 8; r++) { let f = 0; for (const ch of rows[r] || '') {
      if (/\d/.test(ch)) { for (let k = 0; k < +ch; k++) { svg += sqSvg(r, f, null); f++; } continue; }
      svg += sqSvg(r, f, ch); f++; } }
    return svg + '</svg>';
    function sqSvg(r, f, pc) {
      const x = flip ? 7 - f : f, y = flip ? 7 - r : r, sq = 'abcdefgh'[f] + (8 - r), light = (r + f) % 2 === 0;
      const bc = window.familyChessBoardColors?.() || { light: '#ebecd0', dark: '#739552' };
      let out = '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + (light ? bc.light : bc.dark) + '"/>';
      const m = mark[sq]; if (m) out += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + (m[0] === 'w' ? '#64d2ff' : '#ff9f0a') + '" opacity="' + (m[1] === 't' ? 0.6 : 0.35) + '"/>';
      if (pc) { const src = window.familyChessPieceImg?.(pc);
        if (src) out += '<image href="' + src.replace(/"/g, '&quot;') + '" x="' + x + '" y="' + y + '" width="1" height="1"/>';
        else { const w = pc === pc.toUpperCase(); out += '<text x="' + (x + 0.5) + '" y="' + (y + 0.8) + '" text-anchor="middle" font-size="0.86" fill="' + (w ? '#fff' : '#111') + '">' + GLYPH[pc.toLowerCase()] + '</text>'; } }
      return out;
    }
  }
  /* ------------------------------------------------------------------ create game (position editor) */
  const PCS = ['K', 'Q', 'R', 'B', 'N', 'P'];
  function parseFen(fen) {
    const b = {}, parts = (fen || '').split(' '), rows = (parts[0] || '').split('/');
    for (let r = 0; r < 8; r++) { let f = 0; for (const ch of rows[r] || '') { if (/\d/.test(ch)) f += +ch; else { b['abcdefgh'[f] + (8 - r)] = ch; f++; } } }
    return { board: b, turn: parts[1] === 'b' ? 'b' : 'w' };
  }
  function buildFen(board, turn) {
    let place = '';
    for (let r = 8; r >= 1; r--) { let empty = 0; for (const f of 'abcdefgh') { const p = board[f + r]; if (!p) { empty++; continue; } if (empty) { place += empty; empty = 0; } place += p; } if (empty) place += empty; if (r > 1) place += '/'; }
    let cas = '';
    if (board.e1 === 'K') { if (board.h1 === 'R') cas += 'K'; if (board.a1 === 'R') cas += 'Q'; }
    if (board.e8 === 'k') { if (board.h8 === 'r') cas += 'k'; if (board.a8 === 'r') cas += 'q'; }
    return place + ' ' + turn + ' ' + (cas || '-') + ' - 0 1';
  }
  function checkFen(board, turn) {
    const all = Object.values(board);
    if (all.filter((p) => p === 'K').length !== 1 || all.filter((p) => p === 'k').length !== 1) return 'Each side needs exactly one king.';
    for (const sq in board) if (/p/i.test(board[sq]) && (sq[1] === '1' || sq[1] === '8')) return 'Pawns can’t stand on the first or last rank.';
    const C = B().Chess, fen = buildFen(board, turn);
    let c; try { c = new C(fen); } catch (e) { return 'That isn’t a legal position.'; }
    let other; try { other = new C(buildFen(board, turn === 'w' ? 'b' : 'w')); } catch { other = null; }
    if (other && other.inCheck()) return (turn === 'w' ? 'Black' : 'White') + ' is in check but it’s ' + (turn === 'w' ? 'White' : 'Black') + '’s move.';
    if (c.isCheckmate()) return 'That position is already checkmate.';
    if (c.isStalemate()) return 'That position is already stalemate.';
    return null;
  }
  function openEditor(src) {
    session++; hub.classList.remove('tr-sg-page', 'tr-ed-page'); hub.replaceChildren();
    hub.classList.add('tr-ed-page');
    let { board, turn } = parseFen(src ? src.fen : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    let editing = src || null, tool = 'move', from = null, flip = false;
    hub.append(subHead(editing ? 'Edit position' : 'Create game', () => { hub.classList.remove('tr-ed-page'); editing ? openSavedGame(editing) : openSaved(); }, editing ? 'Back' : 'Saved games'));
    const boardEl = el('div', 'tr-ed-board');
    const pal = el('div', 'tr-ed-pal');
    const note = el('p', 'tr-ed-note');
    const say = (t, bad) => { note.textContent = t || ''; note.classList.toggle('bad', !!bad); };
    const glyph = (p) => { const src = window.familyChessPieceImg?.(p);
      if (src) { const im = el('img', 'tr-ed-img'); im.src = src; im.alt = ''; im.draggable = false; return im; }
      return el('span', 'tr-ed-pc ' + (p === p.toUpperCase() ? 'w' : 'b'), GLYPH[p.toLowerCase()]); };
    const bc = window.familyChessBoardColors?.();
    function draw() {
      boardEl.replaceChildren(); if (bc?.frame) boardEl.style.boxShadow = '0 0 0 4px ' + bc.frame + ', 0 10px 26px rgba(0,0,0,.5)';
      for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
        const file = 'abcdefgh'[flip ? 7 - f : f], rank = flip ? r + 1 : 8 - r, sq = file + rank;
        const cell = el('button', 'tr-ed-sq ' + ((f + r) % 2 ? 'd' : 'l') + (from === sq ? ' from' : ''));
        if (bc) cell.style.backgroundColor = (f + r) % 2 ? bc.dark : bc.light;
        cell.type = 'button'; cell.setAttribute('aria-label', sq);
        if (board[sq]) cell.append(glyph(board[sq]));
        if (f === 0) cell.append(el('i', 'tr-ed-rk', String(rank)));
        if (r === 7) cell.append(el('i', 'tr-ed-fl', file));
        cell.addEventListener('click', () => tap(sq));
        boardEl.append(cell);
      }
      for (const b of pal.querySelectorAll('button[data-t]')) b.classList.toggle('on', b.dataset.t === tool);
      for (const b of turnSeg.children) b.classList.toggle('on', b.dataset.v === turn);
    }
    function tap(sq) {
      say('');
      if (tool === 'move') {
        if (!from) { if (board[sq]) from = sq; }
        else { if (from !== sq) { board[sq] = board[from]; delete board[from]; } from = null; }
      } else if (tool === 'x') { delete board[sq]; }
      else {
        if (board[sq] === tool) delete board[sq];
        else { if (/k/i.test(tool)) for (const q in board) if (board[q] === tool) delete board[q]; board[sq] = tool; }
      }
      draw();
    }
    const tb = (t, content, label) => { const b = btn('', 'tr-ed-tool', () => { tool = t; from = null; draw(); }); b.dataset.t = t; b.setAttribute('aria-label', label); if (typeof content === 'string') b.textContent = content; else b.append(content); return b; };
    const r1 = el('div', 'tr-ed-row'), r2 = el('div', 'tr-ed-row'), r3 = el('div', 'tr-ed-row tools');
    for (const p of PCS) r1.append(tb(p, glyph(p), 'White ' + p));
    for (const p of PCS) r2.append(tb(p.toLowerCase(), glyph(p.toLowerCase()), 'Black ' + p));
    const mv = tb('move', '', 'Move pieces'); mv.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Move</span>';
    const er = tb('x', '', 'Erase'); er.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 20H9L4 15l9-9 7 7-6 6M8 11l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Erase</span>';
    const clear = btn('Clear', 'tr-ed-tool txt', () => { board = {}; from = null; draw(); });
    const reset = btn('Start', 'tr-ed-tool txt', () => { board = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1').board; from = null; draw(); });
    const fl = btn('Flip', 'tr-ed-tool txt', () => { flip = !flip; draw(); });
    r3.append(mv, er, clear, reset, fl);
    pal.append(r1, r2, r3);
    const turnSeg = el('div', 'tr-sg-seg tr-ed-turn');
    for (const v of ['w', 'b']) { const b = btn((v === 'w' ? 'White' : 'Black') + ' to move', '', () => { turn = v; draw(); }); b.dataset.v = v; turnSeg.append(b); }
    const bottom = el('div', 'tr-ed-actions');
    const load = btn('Load saved', 'tr-ed-load', () => void pickSaved());
    const save = btn(editing ? 'Save…' : 'Save', 'tr-sg-primary tr-ed-save', () => void doSaveEdit());
    bottom.append(load, save);
    hub.append(boardEl, pal, turnSeg, note, bottom);
    draw();
    async function pickSaved() {
      let rows; try { rows = await loadSavedRows(); } catch (e) { say('Could not load saved games.', true); return; }
      if (!rows || !rows.length) { say('No saved games to load yet.', true); return; }
      const ov = el('div', 'tr-pop-ov'), card = el('div', 'tr-pop'), close = () => ov.remove();
      ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
      const hd = el('div', 'tr-pop-head'); hd.append(el('h3', '', 'Load a saved game'));
      card.append(el('i', 'tr-grab'), hd);
      const list = el('div', 'tr-saved tr-ed-pick');
      for (const g of rows) {
        const row = el('div', 'tr-saved-row');
        const go = btn('', 'tr-saved-go', () => { close(); editing = g; ({ board, turn } = parseFen(g.fen)); from = null; save.textContent = 'Save…'; hub.querySelector('.tr-head h2').textContent = 'Edit position'; say('Loaded “' + savedTitle(g) + '”. Edit it, then save as new or overwrite it.'); draw(); });
        const th = el('span', 'tr-saved-thumb'); th.innerHTML = miniBoard(g);
        const tx = el('span', 'tr-card-text'); tx.append(el('b', '', savedTitle(g)), el('span', 'tr-saved-meta', whenOf(g)));
        go.append(th, tx); row.append(go); list.append(row);
      }
      card.append(list, btn('Cancel', 'tr-ed-alt', close)); ov.append(card); root.append(ov);
    }
    async function doSaveEdit() {
      const err = checkFen(board, turn); if (err) { say(err, true); return; }
      const fen = buildFen(board, turn);
      const write = async (replace) => {
        const c = api(); if (!c || uid === 'local') { say('Sign in to save.', true); return; }
        say('Saving…');
        const { error } = await c.rpc('chess_save_local_game', { p_source: 'custom', p_moves: [], p_sans: [], p_fen: fen, p_side: turn, p_level: 2,
          p_white: 'White', p_black: 'Black', p_replace: replace, p_start_fen: fen });
        if (error) { say('Could not save: ' + error.message, true); return; }
        hub.classList.remove('tr-ed-page'); openSaved();
      };
      if (!editing) { await write(null); return; }
      const ov = el('div', 'tr-pop-ov'), card = el('div', 'tr-pop'), close = () => ov.remove();
      ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
      const hd = el('div', 'tr-pop-head'); hd.append(el('h3', '', 'Save position'));
      card.append(el('i', 'tr-grab'), hd, el('p', 'tr-ed-poptext', 'You loaded “' + savedTitle(editing) + '”. Replace it with this position, or keep both?'),
        btn('Overwrite original', 'primary', () => { close(); void write(editing.id); }),
        btn('Save as new', 'tr-ed-alt', () => { close(); void write(null); }),
        btn('Cancel', 'tr-ed-alt quiet', close));
      ov.append(card); root.append(ov);
    }
  }
  async function openSaved() {
    session++; hub.classList.remove('tr-sg-page', 'tr-ed-page'); hub.replaceChildren(); hub.append(subHead('Saved games', () => openHub()));
    const loading = el('p', 'tr-about-foot', 'Loading…'); hub.append(loading);
    let rows;
    try { rows = await loadSavedRows(); } catch (e) { loading.textContent = 'Could not load saved games. ' + (e?.message || ''); return; }
    loading.remove();
    if (rows === null) { const e = el('div', 'tr-saved-empty'); e.append(el('b', '', 'Sign in to use saved games'), el('p', '', 'Saved games live in your account so you can pick them up on any device.')); hub.append(e); return; }
    const create = btn('', 'tr-create', () => openEditor(null));
    create.innerHTML = '<span class="tr-create-ico" aria-hidden="true">+</span><span class="tr-card-text"><b>Create game</b><span>Set up any position, then save it</span></span><span class="tr-chev" aria-hidden="true">›</span>';
    hub.append(create);
    if (!rows.length) {
      const e = el('div', 'tr-saved-empty');
      e.append(el('b', '', 'No saved games yet'), el('p', '', 'During any game, tap the bookmark next to resign, or create a position above.'));
      hub.append(e); return;
    }
    const box = el('div', 'tr-saved');
    for (const g of rows) {
      const row = el('div', 'tr-saved-row');
      const go = btn('', 'tr-saved-go', () => openSavedGame(g));
      const txt = el('span', 'tr-card-text');
      const title = el('b', '', savedTitle(g)); if (g.keep) title.append(el('em', 'tr-keep-star', '★'));
      const meta = el('span', 'tr-saved-meta'); meta.append(el('span', '', 'Move ' + (Math.floor(g.moves.length / 2) + 1) + ' · ' + sideName(turnOf(g)) + ' to move'), el('span', 'tr-saved-when', whenOf(g)));
      txt.append(title, meta);

      const thumb = el('span', 'tr-saved-thumb'); thumb.innerHTML = miniBoard(g);
      go.append(thumb, txt, el('span', 'tr-chev', '›'));
      const canSend = g.source === 'online' && !!g.opponent_id;
      const under = el('div', 'tr-swipe-under');
      under.append(el('span', 'tr-swipe-send', canSend ? '↗ Send to ' + oppName(g) : 'Online games only'), el('span', 'tr-swipe-del', 'Delete 🗑'));
      row.append(under, go); box.append(row);
      swipeRow(row, go, { canSend, onDelete: () => swipeDelete(row, g), onSend: () => swipeSend(row, g) });
    }
    hub.append(box, el('p', 'tr-about-foot', 'Swipe left to delete · right to send back · ★ kept games stay'));
  }
  /* swipe a saved game: left (red) deletes, right (green) re-sends it exactly as it was to the same opponent */
  function swipeRow(row, go, { canSend, onDelete, onSend }) {
    let d = null;
    const W = () => row.getBoundingClientRect().width || 300;
    const set = (x, anim) => { go.style.transition = anim ? 'transform .22s ease' : 'none'; go.style.transform = x ? 'translateX(' + x + 'px)' : ''; row.dataset.dir = x < 0 ? 'del' : x > 0 ? 'send' : ''; row.classList.toggle('armed', Math.abs(x) > W() * 0.35); };
    row.addEventListener('pointerdown', (e) => { if (e.button > 0 || row.dataset.busy) return; d = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false, dx: 0 }; });
    row.addEventListener('pointermove', (e) => {
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.on) { if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { d = null; return; } if (Math.abs(dx) < 12) return; d.on = true; try { row.setPointerCapture(e.pointerId); } catch { } }
      d.dx = dx > 0 && !canSend ? Math.min(dx, 60) * 0.5 : dx; set(d.dx);
    });
    const end = (e) => {
      if (!d || (e && e.pointerId !== d.id)) return;
      const was = d; d = null; if (!was.on) return;
      go.dataset.swiped = '1'; setTimeout(() => delete go.dataset.swiped, 50);
      if (was.dx < -W() * 0.35) { set(-W(), true); setTimeout(onDelete, 200); return; }
      if (was.dx > W() * 0.35 && canSend) { set(0, true); onSend(); return; }
      set(0, true);
    };
    row.addEventListener('pointerup', end); row.addEventListener('pointercancel', () => { d = null; set(0, true); });
    go.addEventListener('click', (e) => { if (go.dataset.swiped) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  }
  function swipeDelete(row, g) {
    row.dataset.busy = '1'; row.replaceChildren();
    const bar = el('div', 'tr-swipe-undo'); bar.append(el('span', '', 'Deleted ' + savedTitle(g)));
    let undone = false;
    bar.append(btn('Undo', 'tr-chip', () => { undone = true; openSaved(); }));
    row.append(bar);
    setTimeout(async () => {
      if (undone) return;
      const { error } = await api().from('chess_saved_games').delete().eq('id', g.id);
      if (error) { window.familyChessToast?.('Could not delete: ' + error.message); if (screen === 'saved' || hub.contains(row)) openSaved(); return; }
      savedCount = Math.max(0, savedCount - 1);
      row.classList.add('gone'); setTimeout(() => row.remove(), 260);
    }, 3500);
  }
  function swipeSend(row, g) {
    row.dataset.busy = '1'; row.classList.add('sending');
    const t = row.querySelector('.tr-saved-meta span'); const old = t ? t.textContent : '';
    if (t) t.textContent = 'Sending to ' + oppName(g) + '…';
    void sendSaved(g, g.opponent_id, g.owner_side, oppName(g), (msg, bad) => {
      if (!bad) return;
      delete row.dataset.busy; row.classList.remove('sending'); if (t) t.textContent = old;
      window.familyChessToast?.(msg);
    });
  }
  function openSavedGame(g) {
    session++; hub.classList.remove('tr-sg-page', 'tr-ed-page'); hub.replaceChildren(); hub.append(subHead(savedTitle(g), () => openSaved(), 'Saved games'));
    const top = el('div', 'tr-sg-top');
    const board = el('div', 'tr-sg-board'); board.innerHTML = miniBoard(g);
    const info = el('div', 'tr-sg-info');
    info.append(el('span', 'tr-sg-label', g.moves.length ? 'Last moves' : 'Custom position'));
    for (const m of lastTwo(g)) { const c = el('span', 'tr-sg-move ' + m.color); c.append(el('i'), document.createTextNode(sideName(m.color) + ' · ' + m.san)); info.append(c); }
    info.append(el('span', 'tr-sg-turn', sideName(turnOf(g)) + ' to move'), el('span', 'tr-sg-meta', (g.source === 'custom' ? 'You play ' : 'You were ') + sideName(g.owner_side) + ' · saved ' + whenOf(g)));
    top.append(board, info); hub.append(top);
    const note = el('p', 'tr-sg-note'); const say = (t, bad) => { note.textContent = t; note.classList.toggle('bad', !!bad); };
    // Primary: pick it straight back up the way it was being played.
    const actions = el('div', 'tr-sg-actions');
    const inviteBtn = btn('Invite ' + oppName(g), 'tr-sg-primary', () => void sendSaved(g, g.opponent_id, g.owner_side, oppName(g), say));
    if (g.source === 'online' && g.opponent_id) {
      actions.append(inviteBtn);
      // Only friends can be invited: swap to the computer if this opponent isn't a friend any more.
      void Promise.resolve(api()?.rpc('chess_are_friends', { p_a: uid, p_b: g.opponent_id })).then((r) => {
        if (r && r.data === false && inviteBtn.isConnected) {
          inviteBtn.replaceWith(btn('Play vs computer', 'tr-sg-primary', () => resumeHere(g, 'cpu', 2, g.owner_side)));
          say('Add ' + oppName(g) + ' as a friend to invite them (Play online → Friend’s code).');
        }
      }).catch(() => {});
    }
    else if (g.source === 'computer') actions.append(btn('Continue', 'tr-sg-primary', () => resumeHere(g, 'cpu', g.level || 2, g.owner_side)));
    else if (g.source === 'custom') actions.append(btn('Play vs computer', 'tr-sg-primary', () => resumeHere(g, 'cpu', 2, g.owner_side)));
    else actions.append(btn('Continue on this screen', 'tr-sg-primary', () => resumeHere(g, 'local', 2, g.owner_side)));
    actions.append(btn('Edit position', 'tr-sg-edit', () => openEditor(g)));
    hub.append(actions, note);
    // Other ways to play this position.
    hub.append(el('div', 'tr-section', 'Play it another way'));
    const list = el('div', 'tr-sg-list');
    let side = g.owner_side, level = g.level || 2;
    const sideSeg = el('div', 'tr-sg-seg');
    const paintSide = () => [...sideSeg.children].forEach((b) => b.classList.toggle('on', b.dataset.v === side));
    for (const v of ['w', 'b']) { const b = btn('Play ' + sideName(v), '', () => { side = v; paintSide(); }); b.dataset.v = v; sideSeg.append(b); }
    paintSide();
    const sideRow = el('div', 'tr-sg-item'); sideRow.append(el('span', 'tr-sg-item-label', 'Your side'), sideSeg); list.append(sideRow);
    const cpuRow = el('div', 'tr-sg-item');
    const lvSeg = el('div', 'tr-sg-seg lv');
    const paintLv = () => [...lvSeg.children].forEach((b) => b.classList.toggle('on', +b.dataset.v === level));
    for (let v = 1; v <= 5; v++) { const b = btn(String(v), '', () => { level = v; paintLv(); }); b.dataset.v = v; lvSeg.append(b); }
    paintLv();
    const cpuGo = btn('Play vs computer', 'tr-sg-go', () => resumeHere(g, 'cpu', level, side));
    cpuRow.append(el('span', 'tr-sg-item-label', 'Computer level'), lvSeg, cpuGo); list.append(cpuRow);
    const localRow = el('div', 'tr-sg-item');
    localRow.append(btn('Two players on this screen', 'tr-sg-go wide', () => resumeHere(g, 'local', 2, side))); list.append(localRow);
    const sendRow = el('div', 'tr-sg-item');
    const pick = el('select', 'tr-sg-pick'); pick.append(new Option('Choose a player…', ''));
    const sendGo = btn('Send', 'tr-sg-go', () => { const t = pick.value; if (!t) { say('Choose who to send it to.', true); return; } void sendSaved(g, t, side, pick.selectedOptions[0].textContent, say); });
    sendRow.append(el('span', 'tr-sg-item-label', 'Send to a player'), pick, sendGo); list.append(sendRow);
    hub.append(list);
    void (async () => { const c = api(); if (!c) return;
      // Friends only: games can only be sent to people you're friends with.
      const { data: fr } = await c.from('chess_friendships').select('user_a,user_b').eq('status', 'accepted');
      const ids = (fr || []).map((f) => (f.user_a === uid ? f.user_b : f.user_a));
      if (!ids.length) { pick.options[0].textContent = 'Add a friend first'; return; }
      const { data } = await c.from('chess_profiles').select('id,display_name').in('id', ids).order('display_name');
      for (const p of data || []) pick.add(new Option(p.display_name || 'Player', p.id)); if (g.opponent_id && ids.includes(g.opponent_id)) pick.value = g.opponent_id; })();
    // Keep + delete
    const keepRow = el('label', 'tr-sg-keep');
    const keep = el('input'); keep.type = 'checkbox'; keep.checked = !!g.keep;
    const kt = el('span', 'tr-card-text'); kt.append(el('b', '', 'Keep'), el('span', '', g.keep ? 'On: stays to replay any time' : 'Off: removed once picked up'));
    keepRow.append(kt, keep, el('i', 'tr-switch'));
    keep.addEventListener('change', async () => { const c = api(); const { error } = await c.rpc('chess_saved_set_keep', { p_id: g.id, p_keep: keep.checked });
      if (error) { keep.checked = !keep.checked; say('Could not update: ' + error.message, true); } else { g.keep = keep.checked; kt.lastChild.textContent = keep.checked ? 'On: stays to replay any time' : 'Off: removed once picked up'; } });
    const del = btn('Delete', 'tr-sg-delete', async () => {
      if (!del.classList.contains('arm')) { del.classList.add('arm'); del.textContent = 'Tap to confirm'; setTimeout(() => { if (del.isConnected) { del.classList.remove('arm'); del.textContent = 'Delete'; } }, 2500); return; }
      const { error } = await api().from('chess_saved_games').delete().eq('id', g.id);
      if (error) say('Could not delete: ' + error.message, true); else openSaved();
    });
    const foot = el('div', 'tr-sg-foot'); foot.append(keepRow, del); hub.append(foot);
    hub.classList.add('tr-sg-page'); hub.scrollTop = 0;
  }
  function resumeHere(g, mode, level, side) {
    if (!window.familyChessSaved) return;
    close();
    setTimeout(() => { window.familyChessSaved.load(g, { mode, level, side }); }, 60);
    if (!g.keep) void Promise.resolve(api()?.rpc('chess_saved_consume', { p_id: g.id })).catch(() => {});
  }
  async function sendSaved(g, target, side, name, say) {
    const c = api(); if (!c) return;
    say('Sending…');
    try {
      const { data, error } = await c.functions.invoke('chess-saved-game', { body: { saved_id: g.id, target_id: target, side } });
      if (error || !data?.ok) throw new Error(data?.error || (error && (await error.context?.json?.().catch(() => null))?.error) || error?.message || 'Could not send.');
      void c.functions.invoke('chess-notify-challenge', { body: { challenge_id: data.challenge_id } }).catch(() => {});
      close();
      await window.familyChessOpenMatch?.(data.game_id, 'play');
      window.familyChessToast?.('Invite sent to ' + name + '. They have 10 minutes to accept.');
    } catch (e) { say(e.message || 'Could not send.', true); }
  }
  function openAbout() {
    hub.classList.remove('tr-sg-page', 'tr-ed-page'); hub.replaceChildren();
    const head = el('div', 'tr-head'); const back = btn('', 'tr-back', () => openHub());
    back.innerHTML = '<svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2L2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>Training';
    head.append(back, el('h2', '', 'About'));
    hub.append(head);
    const sec = (title, rows) => {
      hub.append(el('div', 'tr-section', title));
      const box = el('div', 'tr-about');
      for (const [t, d] of rows) { const r = el('div', 'tr-about-item'); r.append(el('b', '', t), el('p', '', d)); box.append(r); }
      hub.append(box);
    };
    const n = Math.round(P.puzzle.rating);
    sec('Puzzle rating', [
      ['Starts at 1200', 'Everyone begins at 1200, a standard chess starting point (Chess.com uses 400–1200 by skill, Lichess uses 1500). It lands your first puzzles in the Easy range. You are at ' + n + ' now.'],
      ['Comparable to Lichess', 'Every puzzle comes from the Lichess database and carries its official difficulty, measured from millions of attempts, so your number lines up roughly with Lichess puzzle ratings.'],
      ['Peak', 'Your highest rating so far. It never goes down.'],
    ]);
    sec('How it changes', [
      ['Solve it clean', 'Solve a puzzle without hints and your rating goes up. Beating a puzzle rated above you is worth more.'],
      ['Miss it', 'A wrong first move lowers your rating. Missing an easy puzzle costs more than missing a hard one.'],
      ['Hints and solutions', 'Using a hint, showing the solution or retrying a miss makes that puzzle unrated. It still counts as practice.'],
      ['Settles in', 'Your first 20 puzzles move your rating faster so it finds your level quickly. After that, changes get smaller.'],
    ]);
    sec('Difficulty', [
      ['Adaptive', 'Picks puzzles within 150 points of your rating, so they get harder as you improve.'],
      ['Fixed levels', 'Beginner 400–999 · Easy 1000–1399 · Intermediate 1400–1799 · Advanced 1800–2199 · Expert 2200+.'],
      ['Categories', 'Mixed gives every theme. Pick one (mates, forks, pins and more) to drill a single idea.'],
    ]);
    sec('Sharpen', [
      ['Review', 'Every puzzle, drill or game move you miss comes back: the next day, then after 3 days, then after a week. Get it right three times in a row and it is learned. Review cards never change your rating.'],
      ['Spot the threat', 'Your opponent has a tactic ready. Tap the piece that would strike, then play a move that stops it. Trains seeing the moves being laid against you.'],
      ['Blunder check', 'You are shown a move you are thinking about. Decide: safe, or does it lose something? If it loses, show why by tapping the punishing piece.'],
      ['Speed rounds', 'Five easy puzzles on one pattern with a soft clock (aim for under 15 seconds each). Quick, correct repetition is what makes a pattern automatic. Unrated.'],
    ]);
    sec('Endgames', [
      ['Endgame Academy', LESSONS.length + ' lessons: check and stalemate, the basic mates, pawn endings, queen and rook endings (Lucena and Philidor), pawn structure, and the defender\'s side. A lesson is mastered when you pass its final test.'],
      ['Your path', CHAPTERS.length + ' chapters that build on each other, including ' + CHAPTERS.filter((c) => c.defend).length + ' defence chapters (🛡). Each one: learn the idea, practise it (puzzles, a drill or a lesson), then prove it (in a row with no help, or a challenge). Every chapter is open; the first unfinished one is recommended next — or, once your style profile has enough games, the chapter that fixes what keeps costing you.'],
      ['Endgame Challenges', 'Win a set ending (basic mates, stalemate traps, pawn endings) against a computer that fights back. Several use exact endgame tables, so only precise play wins.'],
      ['Overall', 'The ring on the Training page averages three things: puzzles solved (up to 100), lessons mastered and challenges won (up to 20).'],
    ]);
    sec('Your games', [
      ['Your plan', 'After each game the end card reads it from your side: what you were trying to do in the opening, middlegame and endgame, how it went, and one way to do it better — with a link to the drill that fixes it.'],
      ['Your style', 'Collects those reads from your recent games: the plans you go for, the mistakes that keep costing you, and your weakest phase. Positions where you missed a much better move go into your review deck.'],
    ]);
    hub.append(el('p', 'tr-about-foot', 'Progress is saved to your family account and is separate for each player.'));
    hub.scrollTop = 0;
  }

  /* ------------------------------------------------------------------ puzzles */
  const BANDS = { 1: [400, 999, 'Beginner'], 2: [1000, 1399, 'Easy'], 3: [1400, 1799, 'Intermediate'], 4: [1800, 2199, 'Advanced'], 5: [2200, 3200, 'Expert'] };
  const CATS = [
    ['mixed', 'Mixed', () => true, null], ['mate1', 'Mate in 1', (t) => t.includes('mateIn1'), 'mateIn1'],
    ['mate2', 'Mate in 2', (t) => t.includes('mateIn2'), 'mateIn2'], ['mate3', 'Mate in 3+', (t) => /mateIn[345]/.test(t), 'mateIn3'],
    ['fork', 'Forks', (t) => /\bfork\b/.test(t), 'fork'], ['pin', 'Pins', (t) => /\bpin\b/.test(t), 'pin'],
    ['skewer', 'Skewers', (t) => /\bskewer\b/.test(t), 'skewer'], ['discovered', 'Discovered attacks', (t) => /discoveredAttack/.test(t), 'discoveredAttack'],
    ['double', 'Double attacks', (t) => /doubleCheck|\bfork\b/.test(t), 'doubleCheck'], ['sacrifice', 'Sacrifices', (t) => /sacrifice/.test(t), 'sacrifice'],
    ['defense', 'Defensive tactics', (t) => /defensiveMove/.test(t), 'defensiveMove'], ['promotion', 'Promotion', (t) => /promotion/i.test(t), 'promotion'],
    ['endgame', 'Endgame tactics', (t) => /endgame/.test(t), 'endgame'],
  ];
  const IDEA = {
    mateIn1: 'There is a checkmate right now. Look at every check.', mateIn2: 'Checkmate in two: a forcing first move leaves the king no escape.',
    mateIn3: 'A forced mate: keep checking and take away flight squares.', mateIn4: 'A long forced mate: every move should check or threaten mate.',
    fork: 'One piece can attack two targets at once.', pin: 'A piece is stuck in front of something more valuable. Use or win it.',
    skewer: 'Attack a valuable piece so that it moves and exposes the piece behind it.', discoveredAttack: 'Move one piece out of the way to unleash an attack from the piece behind it.',
    doubleCheck: 'Two pieces can give check at once; only a king move answers that.', sacrifice: 'Giving up material here opens the way to something bigger.',
    defensiveMove: 'You are under threat. Find the move that defends everything.', promotion: 'A pawn is close to queening. Clear its path or force it through.',
    advancedPawn: 'An advanced pawn is the key. Push it or support it.', hangingPiece: 'Something is unprotected. Win it.', trappedPiece: 'A piece has no safe squares. Attack it.',
    backRankMate: "The king is stuck behind its own pawns. Use the back rank.", deflection: 'Lure a defender away from what it protects.', attraction: 'Drag the king or a piece onto a square where it can be hit.',
    clearance: 'Clear a square or line for another piece.', interference: 'Put a piece between a defender and what it guards.', xRayAttack: 'Attack through an enemy piece.',
    zugzwang: 'Every move makes the opponent worse. Find the quiet waiting move.', quietMove: 'The strongest move is quiet: no check, no capture, but a big threat.',
    intermezzo: 'Before recapturing, insert a stronger in-between move.', capturingDefender: 'Take the piece that defends the key square.', exposedKing: 'The king is exposed. Attack it.',
    endgame: 'Endgame tactic: count tempi and use your king actively.', crushing: 'A strong blow decides the game.',
  };
  const NAME = { mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3', mateIn4: 'Mate in 4', mateIn5: 'Mate in 5', fork: 'Fork', pin: 'Pin', skewer: 'Skewer', discoveredAttack: 'Discovered attack', doubleCheck: 'Double check', sacrifice: 'Sacrifice', defensiveMove: 'Defensive move', promotion: 'Promotion', hangingPiece: 'Hanging piece', backRankMate: 'Back-rank mate', deflection: 'Deflection', attraction: 'Attraction', zugzwang: 'Zugzwang', quietMove: 'Quiet move', trappedPiece: 'Trapped piece', clearance: 'Clearance', interference: 'Interference', intermezzo: 'In-between move', xRayAttack: 'X-ray attack', capturingDefender: 'Remove the defender', exposedKing: 'Exposed king', advancedPawn: 'Advanced pawn', endgame: 'Endgame' };
  let devSet = null;
  async function loadDev() {
    if (devSet) return devSet;
    try { const r = await fetch('chess-puzzles-dev.json?v=1'); const j = await r.json(); devSet = j.puzzles.map(([id, fen, moves, rating, themes]) => ({ id, fen, moves: moves.split(' '), rating, themes })); }
    catch { devSet = []; }
    return devSet;
  }
  let remotePuzzles = true;
  function band() {
    const lv = P.settings.level;
    if (lv === 'adaptive') { const r = Math.round(P.puzzle.rating); return [r - 150, r + 150]; }
    return BANDS[lv].slice(0, 2);
  }
  /* opt (drills, speed rounds): { theme: string | string[], lo, hi } instead of the puzzle settings */
  async function nextPuzzle(opt = null) {
    let cat = CATS.find((c) => c[0] === P.settings.cat) || CATS[0];
    const recent = new Set(P.puzzle.history.slice(-300).map((h) => h.id).concat((P.seen || []).slice(-200)));
    let [lo, hi] = band();
    if (opt) {
      const th = Array.isArray(opt.theme) ? pick(opt.theme) : opt.theme;
      if (th) { const re = new RegExp('\\b' + th + '\\b'); cat = [th, th, (t) => re.test(t), th]; } else cat = CATS[0];
      lo = Math.max(400, opt.lo); hi = Math.max(lo + 200, opt.hi);
    } else if (PATH && PATH.theme) { const th = PATH.theme, re = new RegExp('\\b' + th + '\\b'); cat = [th, th, (t) => re.test(t), th]; const up = Math.max(0, Math.min(400, Math.round(P.puzzle.rating) - 1300)); lo = PATH.lo + up; hi = PATH.hi + up; }
    const c = api();
    if (c && remotePuzzles && uid !== 'local') {
      try {
        for (let widen = 0; widen < 3; widen++) {
          const { data, error } = await c.rpc('chess_next_puzzle', { p_min: lo - widen * 200, p_max: hi + widen * 200, p_theme: cat[3], p_exclude: [...recent].slice(-200) });
          if (error) { remotePuzzles = false; break; }
          const row = Array.isArray(data) ? data[0] : data;
          if (row && row.fen) return { id: row.id, fen: row.fen, moves: row.moves.split(' '), rating: row.rating, themes: (row.themes || []).join(' '), src: 'db' };
        }
      } catch { remotePuzzles = false; }
    }
    const all = (await loadDev()).filter((p) => cat[2](p.themes));
    for (let widen = 0; widen < 6; widen++) {
      const inBand = all.filter((p) => p.rating >= lo - widen * 150 && p.rating <= hi + widen * 150);
      const unseen = inBand.filter((p) => !recent.has(p.id));
      if (unseen.length) return { ...pick(unseen), src: 'dev' };
      if (widen === 5 && inBand.length) { /* everything seen: oldest first */
        const order = new Map(P.puzzle.history.map((h, i) => [h.id, i]));
        return { ...inBand.sort((a, b) => (order.get(a.id) ?? -1) - (order.get(b.id) ?? -1))[0], src: 'dev' };
      }
    }
    return all.length ? { ...pick(all), src: 'dev' } : null;
  }

  let PZ = null; /* current puzzle state */
  function openPuzzles() {
    hub.hidden = true; screen = 'puzzle';
    void startPuzzle();
  }
  function puzzleTop() {
    if (PATH && PATH.speed) { PATH.chip = el('span', 'tr-chip dim tr-timer', speedChip()); setTop('Speed · ' + PATH.label, PATH.chip); return; }
    if (PATH && PATH.review) { setTop('Review', el('span', 'tr-chip dim', (RV ? RV.i + 1 : 1) + '/' + (RV ? RV.items.length : 1))); return; }
    if (PATH && PATH.daily) { setTop('Daily puzzle', el('span', 'tr-chip dim', '🔥 ' + (P.daily.streak || 0))); return; }
    if (PATH) { setTop(PATH.ch.title, el('span', 'tr-chip dim', pathPill())); return; }
    const r = el('button', 'tr-chip', Math.round(P.puzzle.rating) + ''); r.type = 'button'; r.title = 'Puzzle rating · settings';
    r.addEventListener('click', puzzleSettings);
    setTop('Puzzles', r);
  }
  function puzzleSettings() {
    const ov = el('div', 'tr-pop-ov'), card = el('div', 'tr-pop');
    const close = () => ov.remove();
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
    const hd = el('div', 'tr-pop-head'); hd.append(el('h3', '', 'Puzzle settings'), el('span', 'tr-pop-sub', 'Rating ' + Math.round(P.puzzle.rating)));
    card.append(el('i', 'tr-grab'), hd);
    const lv = el('div', 'tr-seg tr-lv');
    for (const [v, label] of [['adaptive', 'Adaptive'], [1, 'Beginner'], [2, 'Easy'], [3, 'Intermediate'], [4, 'Advanced'], [5, 'Expert']]) {
      const b = btn('', P.settings.level === v ? 'on' : '', () => { P.settings.level = v; save(); close(); void startPuzzle(); });
      b.append(el('b', '', label), el('small', '', v === 'adaptive' ? 'Matches you' : BANDS[v][0] + (v === 5 ? '+' : '–' + BANDS[v][1])));
      lv.append(b);
    }
    card.append(el('span', 'tr-label', 'Difficulty'), lv);
    const cs = el('div', 'tr-seg wrap');
    for (const [v, label] of CATS) { const b = btn(label, P.settings.cat === v ? 'on' : '', () => { P.settings.cat = v; save(); close(); void startPuzzle(); }); cs.append(b); }
    card.append(el('span', 'tr-label', 'Category'), cs, btn('Done', 'primary', close));
    ov.append(card); root.append(ov);
  }
  async function startPuzzle(retry = false) {
    const my = ++session; screen = 'puzzle';
    puzzleTop(); panel.hidden = false; panel.replaceChildren();
    const msg = el('div', 'tr-say', 'Loading a puzzle…'); panel.append(msg);
    const p = retry && PZ ? PZ.p : PATH && PATH.review ? unpackP(PATH.item.data) : await nextPuzzle(PATH && PATH.opt || null);
    if (my !== session) return;
    if (!p && PATH) { say(msg, 'Couldn’t load a puzzle for this chapter. Check your connection and try again.', 'bad'); const r = el('div', 'tr-actions'); r.append(btn('Try again', 'primary', () => void startPuzzle()), btn('Back to chapter', 'quiet', () => RETURN && RETURN())); panel.append(r); return; }
    if (!p) { say(msg, 'No puzzles available for this filter. Try Mixed.', 'bad'); panel.append(btn('Settings', '', puzzleSettings)); return; }
    const C = B().Chess, c0 = new C(p.fen);
    const side = other(c0.turn());
    const casual = !!(PATH && (PATH.review || PATH.speed));   /* review cards and speed rounds never move your rating */
    PZ = { p, side, i: 1, hints: 0, failed: !!retry, done: false, retry, rated: !retry && !casual, recorded: !!retry };
    if (PATH && PATH.opt) { P.seen = (P.seen || []).concat(p.id).slice(-300); }
    B().setup({ fen: p.fen, side, opponent: 'Puzzle' }); B().busy(true); mark({});
    const level = Object.entries(BANDS).find(([, [lo, hi]]) => p.rating >= lo && p.rating <= hi)?.[1][2] || '';
    renderPuzzlePanel(level);
    await sleep(650); if (my !== session) return;
    B().play(p.moves[0]); /* the opponent's last move, then the player's turn */
    await sleep(350); if (my !== session) return;
    B().busy(false);
    say(PZ.msgNode, PATH && PATH.review ? 'You missed this one before. Find the best move.' : 'Find the best move.');
    if (PATH && PATH.speed) { PATH.t0 = performance.now(); speedTick(my); }
    B().onMove((uci) => void onPuzzleMove(uci, my));
  }
  function renderPuzzlePanel(level) {
    panel.replaceChildren();
    const head = el('div', 'tr-head2');
    head.append(el('span', 'tr-turn ' + PZ.side, PZ.side === 'w' ? '♔' : '♚'), el('b', 'tr-h-title', (PZ.side === 'w' ? 'White' : 'Black') + ' to move'));
    const tags = el('span', 'tr-h-tags'); tags.append(el('span', 'tr-tag', level + ' ' + PZ.p.rating));
    if (P.puzzle.streak) tags.append(el('span', 'tr-tag hot', '🔥 ' + P.puzzle.streak));
    head.append(tags);
    const msg = el('div', 'tr-say', 'Find the best move.'); PZ.msgNode = msg;
    const row = el('div', 'tr-actions');
    PZ.hintBtn = btn('Hint', 'hint', () => hint(), 'hint'); PZ.hintBtn.setAttribute('aria-label', 'Hint (level 1 of 3)');
    const pips = el('span', 'tr-pips'); for (let k = 0; k < 3; k++) pips.append(el('i')); PZ.hintBtn.append(pips);
    if (PATH && PATH.speed) row.append(btn('Pass', 'quiet', () => speedResult(false), 'skip'), btn('Stop round', 'quiet', () => openSpeed(), 'flag'));
    else row.append(PZ.hintBtn, btn('Solution', 'quiet', () => void showSolution(), 'eye'), btn(PATH && PATH.review ? 'Next card' : 'Skip', 'quiet', () => { if (PATH && PATH.review) { reviewResult(PATH.item, false); return reviewNext(); } if (PATH && PATH.step === 'prove' && !pathState(PATH.ch).prove) { pathState(PATH.ch).streak = 0; save(); } void startPuzzle(); }, 'skip'));
    PZ.rowNode = row;
    panel.append(head, msg, row);
  }
  function themesList(t) { return t.split(' ').filter((x) => IDEA[x]); }
  function hint() {
    if (!PZ || PZ.done) return;
    const want = PZ.p.moves[PZ.i]; if (!want) return;
    PZ.hints = Math.min(3, PZ.hints + 1); P.puzzle.hints++; save();
    if (PZ.hints === 1) { const th = themesList(PZ.p.themes); say(PZ.msgNode, '' + (IDEA[th.find((x) => /mate/.test(x))] || IDEA[th[0]] || 'Look for checks, captures and threats.'), 'idea'); }
    else if (PZ.hints === 2) { mark({ sel: want.slice(0, 2), lift: want.slice(0, 2) }); say(PZ.msgNode, 'Hint: move the highlighted piece.'); }
    else { mark({ arrows: [[want.slice(0, 2), want.slice(2, 4)]], lift: want.slice(0, 2) }); say(PZ.msgNode, 'Hint: play the move the arrow shows.'); }
    PZ.hintBtn.querySelectorAll('.tr-pips i').forEach((p, k) => p.classList.toggle('on', k < PZ.hints));
    if (PZ.hints >= 3) PZ.hintBtn.classList.add('used');
  }
  async function onPuzzleMove(uci, my) {
    if (!PZ || PZ.done || my !== session) return;
    const want = PZ.p.moves[PZ.i];
    mark({});
    const C = B().Chess, c = new C(B().fen());
    const mateNow = c.isCheckmate();
    if (uci === want || (mateNow && PZ.i === PZ.p.moves.length - 1) || (mateNow)) {
      PZ.i += 2;
      if (PZ.i - 1 >= PZ.p.moves.length || mateNow) return void solved();
      say(PZ.msgNode, 'Correct. Keep going.', 'good');
      B().busy(true); await sleep(450); if (my !== session) return;
      B().play(PZ.p.moves[PZ.i - 1]); await sleep(300); if (my !== session) return;
      B().busy(false); return;
    }
    /* a different move: is it an equally good alternative (not just a "still winning" one)? */
    B().busy(true);
    const fenBefore = (() => { const h = new C(PZ.p.fen); for (let k = 0; k < PZ.i; k++) h.move({ from: PZ.p.moves[k].slice(0, 2), to: PZ.p.moves[k].slice(2, 4), promotion: PZ.p.moves[k][4] }); return h.fen(); })();
    say(PZ.msgNode, 'Checking your move…');
    const a = await engine(fenBefore, 5, 900, uci);
    if (my !== session) return;
    const close = a && a.playedScore != null && a.playedScore >= a.bestScore - 25 && a.playedScore >= 250 && Math.abs(a.bestScore) < MATE - 500;
    await sleep(250); B().takeBack(1); B().busy(false);
    if (close) { say(PZ.msgNode, 'That also wins, but this puzzle has a more forcing move. Try again.', 'warn'); return; }
    fail();
  }
  function ratingChange(ok) {
    const r = P.puzzle.rating, pr = PZ.p.rating, n = P.puzzle.attempted;
    const E = 1 / (1 + Math.pow(10, (pr - r) / 400)), K = n < 20 ? 40 : 24;
    return Math.round(ok ? K * (1 - E) : -K * E);
  }
  function record(ok) {
    const pz = P.puzzle, rated = PZ.rated && !PZ.hints && !PZ.recorded;
    let delta = 0;
    if (!PZ.recorded) {
      pz.attempted++;
      if (ok) { pz.solved++; if (!PZ.hints) pz.clean++; pz.streak++; pz.best = Math.max(pz.best, pz.streak); }
      else { pz.failed++; pz.streak = 0; }
      for (const t of themesList(PZ.p.themes).concat(CATS.filter((c) => c[0] !== 'mixed' && c[2](PZ.p.themes)).map((c) => c[0]))) {
        const s = pz.cats[t] || (pz.cats[t] = { a: 0, s: 0 }); s.a++; if (ok) s.s++;
      }
      if (rated) { delta = ratingChange(ok); pz.rating = Math.max(100, pz.rating + delta); pz.peak = Math.max(pz.peak, pz.rating); }
      if (!ok && !(PATH && PATH.review)) reviewAdd('puzzle', PZ.p);
      pz.history.push({ id: PZ.p.id, ok, h: PZ.hints, r: PZ.p.rating, d: delta, t: Date.now() });
      if (pz.history.length > 400) pz.history = pz.history.slice(-400);
      PZ.recorded = true; save();
      const c = api();
      if (c && uid !== 'local' && remoteOk) Promise.resolve(c.from('chess_puzzle_attempts').insert({ user_id: uid, puzzle_id: PZ.p.id, solved: ok, hints: PZ.hints, rated, rating_before: Math.round(pz.rating - delta), rating_after: Math.round(pz.rating) })).catch(() => { });
    }
    return { delta, rated };
  }
  function solved() {
    if (PATH && PATH.speed) return speedResult(!PZ.failed);
    PZ.done = true; B().busy(true);
    const { delta, rated } = record(!PZ.failed);
    const th = themesList(PZ.p.themes);
    panel.replaceChildren();
    const head = el('div', 'tr-result ' + (PZ.failed ? 'bad' : 'good'), PZ.retry ? 'Solved on retry' : PZ.failed ? 'Solved after a miss' : PZ.hints ? 'Solved with hints' : 'Solved!');
    const meta = el('div', 'tr-meta');
    meta.append(el('span', 'tr-pill', 'Puzzle ' + PZ.p.rating), el('span', 'tr-pill', rated ? (delta >= 0 ? '+' : '') + delta + ' → ' + Math.round(P.puzzle.rating) : 'Unrated'), el('span', 'tr-pill', 'Streak ' + P.puzzle.streak));
    const ex = el('div', 'tr-say', th.length ? th.slice(0, 2).map((x) => NAME[x] || x).join(' · ') + ' — ' + (IDEA[th.find((x) => /mate/.test(x))] || IDEA[th[0]]) : '');
    const row = el('div', 'tr-actions'); row.append(btn('Next puzzle', 'primary', () => void startPuzzle(), 'next'), btn('Retry', 'quiet', () => void startPuzzle(true), 'retry'));
    const pathNote = PATH ? pathPuzzleResult(!PZ.failed, !PZ.hints, row) : null;
    panel.append(head, meta, ex); if (pathNote) panel.append(pathNote); panel.append(row); puzzleTop();
  }
  function fail() {
    if (PATH && PATH.speed) { PZ.failed = true; return speedResult(false); }
    const first = !PZ.failed; PZ.failed = true;
    if (first && PATH && PATH.step === 'prove') { pathState(PATH.ch).streak = 0; save(); }
    const { delta, rated } = first ? record(false) : { delta: 0, rated: false };
    say(PZ.msgNode, first && rated ? 'Not the move. ' + delta + ' rating. Try again or see the solution.' : 'Not the move. Try again.', 'bad');
    puzzleTop();
    if (!PZ.rowNode.querySelector('.retry')) { const r = btn('Retry', 'quiet retry', () => void startPuzzle(true), 'retry'); PZ.rowNode.prepend(r); }
  }
  async function showSolution() {
    if (!PZ || PZ.done) return;
    const my = session;
    if (!PZ.failed) { PZ.failed = true; record(false); if (PATH && PATH.step === 'prove') { pathState(PATH.ch).streak = 0; save(); } }
    PZ.done = true; B().busy(true); say(PZ.msgNode, 'Solution:');
    for (let k = PZ.i; k < PZ.p.moves.length; k++) {
      const u = PZ.p.moves[k];
      mark({ arrows: [[u.slice(0, 2), u.slice(2, 4)]] }); await sleep(700); if (my !== session) return;
      B().play(u); await sleep(650); if (my !== session) return;
    }
    mark({});
    panel.replaceChildren();
    const th = themesList(PZ.p.themes);
    panel.append(el('div', 'tr-result bad', 'Puzzle failed'), el('div', 'tr-say', th.length ? (NAME[th[0]] || th[0]) + ' — ' + IDEA[th[0]] : ''));
    const row = el('div', 'tr-actions');
    if (PATH && PATH.review) { reviewResult(PATH.item, false); panel.append(el('div', 'tr-say', 'It will come back tomorrow.')); row.append(btn('Next card', 'primary', reviewNext, 'next')); }
    else row.append(btn('Next puzzle', 'primary', () => void startPuzzle(), 'next'), btn('Retry', 'quiet', () => void startPuzzle(true), 'retry'));
    panel.append(row);
    puzzleTop();
  }

  /* ------------------------------------------------------------------ endgame positions */
  /* random legal start for a mating-material ending: player (White) to move, nothing in check, no stalemate */
  function genEnding(pieces, opts = {}) {
    const C = B().Chess;
    for (let tries = 0; tries < 4000; tries++) {
      const c = new C(); c.clear();
      const used = new Set();
      const place = (type, color, sq) => { c.put({ type, color }, sq); used.add(sq); };
      const free = () => { let s; do s = pick(SQS); while (used.has(s)); return s; };
      const bk = opts.bk ? pick(opts.bk) : free(); place('k', 'b', bk);
      let wk; do wk = free(); while (dist(wk, bk) < 2); place('k', 'w', wk);
      let bad = false; const lightSq = (s) => { const [f, r] = fr(s); return (f + r) % 2 === 1; };
      const bishops = [];
      for (const t of pieces) { let s; do s = free(); while (dist(s, bk) < 2); if (t === 'b') bishops.push(s); if (t === 'p') { const r = fr(s)[1]; if (r === 0 || r === 7) { bad = true; break; } } place(t, 'w', s); }
      if (bad) continue;
      if (bishops.length === 2 && lightSq(bishops[0]) === lightSq(bishops[1])) continue;
      const fen = c.fen().replace(/ w .*$/, ' w - - 0 1');
      let x; try { x = new C(fen); } catch { continue; }
      const blackView = new C(fen.replace(' w ', ' b '));
      if (blackView.inCheck() || x.inCheck() || x.isGameOver()) continue;
      if (opts.minBox && box(fen, 'b').area < opts.minBox) continue;
      if (opts.test && !opts.test(x, fen)) continue;
      return fen;
    }
    return null;
  }
  const EDGE = SQS.filter(onEdge), CORNER = ['a1', 'a2', 'b1', 'b2', 'a8', 'a7', 'b8', 'b7', 'g1', 'h1', 'h2', 'g2', 'h8', 'g8', 'h7', 'g7'];

  /* ------------------------------------------------------------------ move judgement for endgames */
  async function assess(fenBefore, uci, goal, me) {
    const C = B().Chess, c = new C(fenBefore), def = other(me);
    const mates = mateMoves(new C(fenBefore));
    const bxBefore = box(fenBefore, def).area;
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
    const fenAfter = c.fen();
    const out = { kind: 'ok', text: '', fenAfter, missedMate: mates.length && !c.isCheckmate() ? mates.map(uciOf) : null };
    if (c.isCheckmate()) return { ...out, kind: 'mate', text: 'Checkmate!' };
    if (c.isStalemate()) return { ...out, kind: 'stalemate', text: 'Stalemate — the king has no legal move but is not in check, so it is a draw. ' + (m.piece === 'q' ? 'Leave the king a square, or bring your king closer before the final check.' : 'Always leave the king one square until you can give mate.') };
    if (c.isDraw() || c.isInsufficientMaterial()) return goal === 'hold' ? { ...out, kind: 'held', text: 'The pawn is gone — draw secured!' } : { ...out, kind: 'draw', text: 'That position is a draw.' };
    const pawnEnding = /p/i.test(fenBefore.split(' ')[0].replace(/[kK]/g, '')) && probe(fenBefore)?.src === 'table';
    if (goal === 'hold') {
      const j = await judge(fenAfter); /* computer (attacker) to move */
      if (j.r === 'win') return { ...out, kind: 'lost', text: pawnEnding ? explainPawn(fenBefore, uci, fenAfter, false) : 'That lets the computer win. Keep your king in front of the pawn and take the opposition.' };
      return { ...out, kind: 'good', text: pawnEnding ? explainPawn(fenBefore, uci, fenAfter, true) : 'Good defence. The draw holds.' };
    }
    const jb = probe(fenBefore);
    const j = await judge(fenAfter); /* defender to move: 'loss' means you are still winning */
    if (j.r !== 'loss') {
      if (pawnEnding) return { ...out, kind: 'lost', text: explainPawn(fenBefore, uci, fenAfter, false) };
      const why = hangs(new C(fenBefore), m, me) ? 'Your ' + PIECE[m.piece] + ' can simply be taken.' : j.src === 'engine' ? 'That makes the win much harder.' : 'This throws away the win.';
      return { ...out, kind: 'lost', text: why + ' Take it back and keep your pieces protected.' };
    }
    if (pawnEnding && goal !== 'mate') return { ...out, kind: 'good', text: m.promotion ? 'Promoted!' : explainPawn(fenBefore, uci, fenAfter, true) };
    /* exact distance: a winning move that is much slower than the best is "inefficient", never "wrong" */
    if (jb && jb.src === 'table' && j.src === 'table' && jb.plies != null && j.plies != null && j.plies > jb.plies - 1 + 6 && !out.missedMate) {
      return { ...out, kind: 'inefficient', text: 'Still winning, but slower: mate in ' + Math.ceil(j.plies / 2) + ' now (it was ' + Math.ceil(jb.plies / 2) + '). ' + (box(fenAfter, def).area >= bxBefore ? 'Keep the box shrinking.' : 'Bring your king closer.') };
    }
    const bxAfter = box(fenAfter, def).area;
    if (out.missedMate) return { ...out, kind: 'inefficient', text: 'Still winning, but you had checkmate with ' + sanOf(fenBefore, out.missedMate[0]) + '.' };
    if (goal === 'promote' || goal === 'win') return { ...out, kind: 'good', text: m.promotion ? 'Promoted!' : 'Good — still winning.' };
    if (bxAfter < bxBefore) return { ...out, kind: 'good', text: 'Good — the king\'s box shrinks to ' + bxAfter + ' squares.' };
    if (bxAfter > bxBefore) return { ...out, kind: 'inefficient', text: (c.inCheck() ? 'You checked the king, but ' : '') + 'the box grew to ' + bxAfter + ' squares — the king escapes toward the centre. Restrict a rank or file first.' };
    if (m.piece === 'k') return { ...out, kind: 'good', text: 'Good — your king joins the attack.' };
    return { ...out, kind: 'ok', text: c.inCheck() ? 'Check, but the red zone did not shrink. Checks alone rarely help.' : 'Still winning. Look for a move that takes squares away.' };
  }
  const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  function sanOf(fen, uci) { try { const c = new (B().Chess)(fen); return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' }).san; } catch { return uci; } }
  async function suggest(fen, kind) {
    if (kind === 'teacher') {
      /* teach the box method; the exact table vetoes any box move that would spoil the win */
      await loadTables();
      const t = teacherMove(fen);
      const here = probe(fen);
      if (t && here?.src === 'table') {
        /* accept the box move only if it still makes progress (distance to mate never grows): no endless shuffling */
        const c = new (B().Chess)(fen); c.move({ from: t.slice(0, 2), to: t.slice(2, 4), promotion: t[4] || 'q' });
        const j = c.isCheckmate() ? { r: 'loss', plies: 0 } : probe(c.fen());
        if (j && j.r === 'loss' && j.plies <= here.plies) return t;
        return tableBest(fen);
      }
      if (t) return t;
      const tb = await tablebase(fen); if (tb?.moves?.length) return tb.moves[0].uci; return null;
    }
    return bestMove(fen);
  }

  /* ------------------------------------------------------------------ Endgame Academy */
  /* ------------------------------------------------------------------ pawn-ending teaching (exact tables) */
  const fileOf = (sq) => FILES.indexOf(sq[0]), rankOf = (sq) => Number(sq[1]);
  function kpkPieces(fen) { const c = new (B().Chess)(fen); const b = c.board().flat().filter(Boolean); return { c, wk: b.find((x) => x.type === 'k' && x.color === 'w')?.square, bk: b.find((x) => x.type === 'k' && x.color === 'b')?.square, p: b.find((x) => x.type === 'p')?.square }; }
  const inOpposition = (a, b) => (fileOf(a) === fileOf(b) && Math.abs(rankOf(a) - rankOf(b)) === 2) || (rankOf(a) === rankOf(b) && Math.abs(fileOf(a) - fileOf(b)) === 2);
  /* key squares of a white pawn (not a rook pawn): two ranks ahead on ranks 2-4, one rank ahead from the 5th */
  function keySquares(p) {
    const f = fileOf(p), r = rankOf(p), kr = r >= 5 ? Math.min(8, r + 1) : r + 2; const out = [];
    for (const df of [-1, 0, 1]) { const ff = f + df; if (ff >= 0 && ff < 8) out.push(FILES[ff] + kr); if (r >= 5 && ff >= 0 && ff < 8 && r + 2 <= 8) out.push(FILES[ff] + (r + 2)); }
    return out;
  }
  /* the pawn's square: can the black king (to move or not) catch the pawn without help? */
  function insideSquare(p, bk, blackToMove) {
    let steps = 8 - rankOf(p); if (rankOf(p) === 2) steps--;
    const kd = Math.max(Math.abs(fileOf(bk) - fileOf(p)), 8 - rankOf(bk));
    return kd - (blackToMove ? 1 : 0) <= steps;
  }
  /* why a move in a K+P ending threw the result away (or why it was right), from the actual position */
  function explainPawn(fenBefore, uci, fenAfter, good) {
    const before = kpkPieces(fenBefore), after = kpkPieces(fenAfter);
    if (!after.p) return good ? 'Good.' : 'The pawn is lost — a lone king cannot win.';
    const mover = before.c.turn();
    if (mover === 'w') {
      if (good) {
        if (uci.slice(0, 2) === before.p) return !insideSquare(after.p, after.bk, true) ? 'Correct — the black king is outside the square: the pawn runs home alone.' : 'Correct — the pawn advances with the king\'s support.';
        if (inOpposition(after.wk, after.bk)) return 'Correct — you took the opposition. Black\'s king must give way.';
        if (keySquares(after.p).includes(after.wk)) return 'Correct — your king stands on a key square. The pawn will queen.';
        return 'Correct — the only winning move. Your king heads for the key squares.';
      }
      if (uci.slice(0, 2) === before.p) return insideSquare(after.p, after.bk, true) ? 'The black king is inside the pawn\'s square and catches it. Bring your king first.' : 'The pawn ran ahead of its king — Black blocks it in front and the draw is certain.';
      const c = new (B().Chess)(fenAfter);
      for (const m of c.moves({ verbose: true })) { c.move(m); const pk = kpkPieces(c.fen()); const j = probe(c.fen()); c.undo(); if (j && j.r === 'draw' && pk.wk && inOpposition(pk.wk, pk.bk) && m.piece === 'k') return 'This hands Black the opposition (' + m.san + '). Facing your king with you to move, Black blocks the way forward.'; }
      return 'Your king does not reach the key squares (' + keySquares(before.p).join(', ') + ') in time. That is a draw.';
    }
    /* the player defends with Black */
    if (good) return inOpposition(after.wk, after.bk) ? 'Correct — you hold the opposition.' : 'Correct — your king stays in front of the pawn.';
    return 'That lets the white king reach a key square (' + keySquares(after.p).join(', ') + '). Keep your king in front of the pawn and take the opposition when the kings face each other.';
  }
  /* random positions from an exact table: type q/r/p, wanted result for the side to move */
  function genTable(type, { stm = 'w', want = 'win', minPlies = 0, maxPlies = 99, minLegal = 4, test } = {}) {
    const C = B().Chess;
    for (let i = 0; i < 6000; i++) {
      const wk = pick(SQS), bk = pick(SQS), ps = pick(SQS); if (new Set([wk, bk, ps]).size < 3 || dist(wk, bk) < 2) continue;
      if (type === 'p' && (rankOf(ps) === 1 || rankOf(ps) === 8 || fileOf(ps) === 0 || fileOf(ps) === 7)) continue;
      const c = new C(); c.clear(); c.put({ type: 'k', color: 'w' }, wk); c.put({ type: 'k', color: 'b' }, bk); c.put({ type, color: 'w' }, ps);
      const fen = c.fen().replace(/ [wb] .*$/, ' ' + stm + ' - - 0 1');
      const j = probe(fen); if (!j || j.r !== want) continue;
      if (want !== 'draw' && (j.plies < minPlies || j.plies > maxPlies)) continue;
      let x; try { x = new C(fen); } catch { continue; } if (x.isGameOver() || x.moves().length < minLegal) continue;
      if (test && !test(x, fen)) continue;
      return fen;
    }
    return null;
  }
  /* how many moves keep the result for the side to move (used to find positions that need thought) */
  function keepers(fen) {
    const C = B().Chess, c = new C(fen), here = probe(fen); if (!here) return [];
    return c.moves({ verbose: true }).filter((m) => { c.move(m); const j = c.isCheckmate() ? { r: 'loss' } : probe(c.fen()); c.undo(); return j && (here.r === 'win' ? j.r === 'loss' : here.r === 'draw' ? j.r !== 'win' : true); });
  }

  /* ------------------------------------------------------------------ Endgame Academy */
  /* scripted lines (rook endings): user steps accept listed moves; reply steps are the defence. Texts name ranks and
     pieces, never files, so a line can be mirrored or shifted to another file (vary). */
  const LUCENA = { fen: '1K6/1P1k4/8/8/8/8/r7/2R5 w - - 0 1', mid: '1K6/1P2k3/8/8/3R4/8/8/r7 w - - 0 1', steps: [
    { ok: ['c1d1'], ask: 'First, check the black king to push it one more file away.', say: 'Check — the king is pushed another file away.', no: 'Start with a rook check that pushes the king further from the pawn.' },
    { reply: 'd7e7' },
    { ok: ['d1d4'], ask: 'Now build the bridge: put your rook on the 4th rank.', say: 'The bridge is ready. Later the rook will block the checks.', no: 'The rook belongs on the 4th rank — that is the bridge.' },
    { reply: 'a2a1' },
    { ok: ['b8c7'], ask: 'Step your king out from in front of the pawn.', say: 'The king is out. Black can only check.', no: 'Walk the king off the queening square, away from the black rook\'s side.' },
    { reply: 'a1c1' },
    { ok: ['c7b6'], ask: 'Keep walking up the board next to your pawn.', say: 'Good — up the board, beside the pawn.', no: 'Walk up the board, staying beside the pawn.' },
    { reply: 'c1b1' },
    { ok: ['b6c6'], ask: 'Step off the file the rook is checking on.', say: 'The checks keep coming…', no: 'Step off the checking file, toward your rook.' },
    { reply: 'b1c1' },
    { ok: ['c6b5'], ask: 'One more step up — toward your rook.', say: 'Now one more check will come…', no: 'Head up the board toward your rook on the 4th rank.' },
    { reply: 'c1b1' },
    { ok: ['d4b4'], ask: 'Block the check with your rook.', say: 'The bridge! No more checks — the pawn will queen.', no: 'Use the rook on the 4th rank to block the check.' },
  ] };
  const PHILIDOR = { fen: '4k3/7R/8/3KP3/8/8/8/r7 b - - 0 1', steps: [
    { ok: ['a1a6'], ask: 'Put your rook on the 6th rank to keep the white king out.', say: 'The Philidor position: the white king cannot come forward.', no: 'Guard the 6th rank with your rook.' },
    { reply: 'e5e6', say: 'White pushes the pawn to the 6th rank.' },
    { ok: ['a6a1'], ask: 'The king has lost its shelter. Drop your rook all the way back.', say: 'Right — far away, ready to check from behind.', no: 'Go all the way back: the further the rook, the better the checks.' },
    { reply: 'd5d6' },
    { ok: ['a1d1'], ask: 'Check the king from behind.', say: 'Check.', no: 'Give a check from behind, along the file.' },
    { reply: 'd6e5' },
    { ok: ['d1e1'], ask: 'Keep checking.', say: 'The checks never end — a draw.', no: 'Keep checking from behind.' },
  ] };
  /* mastery series pools (s2 king activity, s3 blockade, s4 trading) */
  const SERIES = {
    s2a: { fen: '8/p4pk1/1p4p1/8/8/1P4P1/P4PK1/8 w - - 0 1', type: 'best', prefer: ['g2f3'], vary: true, task: 'Best plan?', why: 'King to the centre.' },
    s2b: { fen: '8/5k2/1p3p2/p1p3p1/P1P3P1/1P3P2/5K2/8 w - - 0 1', type: 'best', prefer: ['f2e3'], vary: true, task: 'Best plan?', why: 'King to the centre.' },
    s2c: { fen: '8/pp3k2/2p5/8/8/2P5/PP3K2/8 w - - 0 1', type: 'best', prefer: ['f2e3', 'f2f3'], vary: true, task: 'Best plan?', why: 'King to the centre.' },
    s2d: { fen: '8/1p3pk1/6p1/8/8/6P1/1P3PK1/8 w - - 0 1', type: 'best', prefer: ['g2f3'], vary: true, task: 'Best plan?', why: 'King to the centre.' },
    s3a: { fen: '8/4k3/8/3P4/2K5/8/4B3/2b5 b - - 0 1', side: 'b', type: 'best', prefer: ['e7d6'], vary: true, task: 'Blockade square?', why: 'King in front of the pawn, on your bishop\'s colour.' },
    s4a: { fen: '4r1k1/5pp1/4q2p/8/8/P3Q2P/5PP1/4R1K1 w - - 0 1', type: 'best', prefer: ['e3e6'], vary: true, task: 'You are ahead. Best move?', why: 'Trade queens.' },
    s4b: { fen: '3r4/4kpp1/7p/8/8/2N4P/5PP1/3R2K1 w - - 0 1', type: 'best', prefer: ['d1d8'], vary: true, task: 'You are ahead. Best move?', why: 'Trade rooks.' },
    s4c: { fen: '3rk3/5ppp/8/8/8/8/P4PPP/3R2K1 w - - 0 1', type: 'best', prefer: ['d1d8'], vary: true, task: 'You are ahead. Best move?', why: 'Trade into a won pawn ending.' },
  };
  const ALL_LESSONS = [
    { group: 'Fundamentals' },
    { id: 'l1', title: 'Check, mate and stalemate',
      intro: ['Check: the king is attacked. Checkmate: it is attacked and has no legal move. Stalemate: it is NOT attacked but has no legal move — that is a draw.', 'A king may only step to squares that are empty (or hold an enemy piece) and are not attacked.'],
      demo: { fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', steps: [
        { say: 'The black king sits behind its own pawns. Its flight squares f7, g7 and h7 are blocked.', rings: ['f7', 'g7', 'h7'] },
        { move: 'a1a8', say: 'Ra8+ attacks the king along the back rank. f8 and h8 are covered by the rook too — checkmate.', rings: ['f8', 'h8'] },
        { fen: '7k/8/6Q1/8/8/8/8/6K1 b - - 0 1', say: 'Stalemate: Black to move, not in check, but g8, g7 and h7 are all attacked. Draw!', tint: ['g8', 'g7', 'h7'] },
      ] },
      guided: [{ fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', task: 'Find checkmate in one.', type: 'mate1' }],
      harder: { fen: '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1', task: 'Mate in one — but several queen moves are stalemate!', type: 'mate1' },
      mastery: { fen: '6k1/8/5K2/8/8/8/8/7Q w - - 0 1', task: 'Checkmate the king. The computer will defend.', goal: 'mate', kind: 'teacher' } },
    { id: 'l2', title: 'Restricting the king',
      intro: ['Before you can mate, the king must be trapped. Rooks and queens cut off whole ranks and files; your king takes away the rest.', 'The red zone is the king\'s "box": every square it can still reach. Make it smaller with each move.'],
      demo: { fen: '8/8/8/3k4/8/8/8/R3K3 w - - 0 1', auto: 'teacher', plies: 8, say: 'Watch the red zone shrink as the rook cuts off files and ranks and the king walks up.' },
      guided: [{ fen: '8/8/8/3k4/8/8/8/R3K3 w - - 0 1', task: 'Make the red zone smaller without losing your rook.', type: 'shrink' },
        { fen: '8/8/2k5/8/8/8/8/4K1Q1 w - - 0 1', task: 'Use the queen to cut the king off and make the red zone smaller.', type: 'shrink' }],
      harder: { fen: '8/8/8/4k3/8/8/8/4K2R w - - 0 1', task: 'Make the red zone smaller on two moves in a row.', type: 'shrink', count: 2 },
      mastery: { fen: '8/8/8/3k4/8/8/8/2Q1K3 w - - 0 1', task: 'Drive the king to the edge of the board.', goal: 'edge', kind: 'teacher' } },
    { id: 'f3', title: 'The opposition',
      intro: ['When the two kings face each other with ONE square between them, they are in opposition. Neither may step forward.', 'The side that does NOT have to move holds the opposition — the other king must give way. In pawn endings this single tempo decides win or draw.'],
      demo: { fen: '8/5k2/8/8/4K1P1/8/8/8 w - - 0 1', auto: 'table', plies: 14, say: 'Watch the white king take the opposition, then outflank — the pawn only moves when its path is safe.' },
      guided: [
        { fen: '8/5k2/8/8/4K1P1/8/8/8 w - - 0 1', task: 'Take the opposition: face the black king with one square between you. Only one move wins.', type: 'keep' },
        { fen: '8/6k1/8/8/5PK1/8/8/8 w - - 0 1', task: 'Find the only winning move.', type: 'keep' },
        { fen: '8/8/5k2/8/4K3/6P1/8/8 w - - 0 1', task: 'Distant opposition: only one king move wins.', type: 'keep' },
      ],
      harder: { fen: '8/8/8/2k5/8/8/2K1P3/8 w - - 0 1', task: 'Opposition from far away — find the only winning move.', type: 'keep' },
      mastery: { table: 'p', minPlies: 22, task: 'Win the pawn ending against perfect defence.', goal: 'promote', kind: 'engine' } },
    { id: 'f4', title: 'The square rule',
      intro: ['Draw a square from the pawn to its queening rank. If the defending king can step into that square, it catches the pawn. If not, the pawn runs home alone.', 'A pawn on its starting square may move two — count the square from where it lands. And it matters whose move it is.'],
      demo: { fen: '8/8/8/3P4/k7/8/8/6K1 w - - 0 1', steps: [
        { say: 'The d5-pawn\'s square: d5–d8–a8–a5. The king on a4 is just outside it.', tint: ['a5', 'b5', 'c5', 'd5', 'a6', 'b6', 'c6', 'd6', 'a7', 'b7', 'c7', 'd7', 'a8', 'b8', 'c8', 'd8'] },
        { move: 'd5d6', say: 'd6! The square shrinks to d6–d8–b8–b6. The king cannot step into it.', tint: ['b6', 'c6', 'd6', 'b7', 'c7', 'd7', 'b8', 'c8', 'd8'] },
        { move: 'a4b5', say: 'Black runs, but always one step behind.' },
        { move: 'd6d7', say: 'd7 — and the pawn queens next move. No help from the white king needed.' },
      ] },
      guided: [
        { fen: '8/8/8/4P3/1k6/8/8/6K1 w - - 0 1', task: 'Can the king be outrun? Only one move wins.', type: 'keep' },
        { fen: '8/K7/8/8/8/k7/6P1/8 w - - 0 1', task: 'Your king is far away. Find the only winning move.', type: 'keep' },
        { fen: '8/8/8/1P3k2/8/8/4K3/8 w - - 0 1', task: 'Count the square — only one move wins.', type: 'keep' },
      ],
      harder: { fen: '8/8/5P2/2k5/8/8/2K5/8 w - - 0 1', task: 'One move wins. Everything else lets the king in.', type: 'keep' },
      mastery: { table: 'p', minPlies: 14, test: (c, f) => { const k = kpkPieces(f); return !insideSquare(k.p, k.bk, false) && dist(k.wk, k.p) > 3; }, task: 'Race the pawn home.', goal: 'promote', kind: 'engine' } },
    { id: 'f5', title: 'Key squares',
      intro: ['Every pawn has key squares: if your king reaches one, the pawn queens no matter whose move it is.', 'For a pawn on ranks 2–4 they are the three squares two ranks in front of it. From the 5th rank on, the squares one and two ranks in front. Race your king there — the pawn can wait.'],
      demo: { fen: '8/3k4/8/8/4PK2/8/8/8 w - - 0 1', auto: 'table', plies: 14, rings: ['d6', 'e6', 'f6'], say: 'Pawn on e4: its key squares are d6, e6 and f6. The king races for them first.' },
      guided: [
        { fen: '8/3k4/8/8/4PK2/8/8/8 w - - 0 1', task: 'Head for the key squares. Only one move wins.', type: 'keep' },
        { fen: '8/8/k7/3P4/1K6/8/8/8 w - - 0 1', task: 'Only one king move reaches the key squares in time.', type: 'keep' },
        { fen: '7k/8/8/8/4P3/6K1/8/8 w - - 0 1', task: 'Find the only winning move.', type: 'keep' },
      ],
      harder: { fen: '1k6/8/8/8/8/2P2K2/8/8 w - - 0 1', task: 'Key squares of a c3-pawn: b5, c5, d5. Only one move wins.', type: 'keep' },
      mastery: { table: 'p', minPlies: 26, task: 'Win from a fresh position — key squares first, pawn second.', goal: 'promote', kind: 'engine' } },
    { group: 'Basic checkmates' },
    { id: 'l4', title: 'King and queen vs king',
      intro: ['The box method: put the queen a knight\'s jump from the king and follow it, shrinking the box each move.', 'When the king is on the edge, STOP shrinking — bring your king next to it, then mate. A queen move that leaves no squares but no check is stalemate.'],
      demo: { fen: '8/8/8/4k3/8/8/8/1Q2K3 w - - 0 1', auto: 'teacher', plies: 30, say: 'The queen shadows the king; the white king walks up; mate on the edge.' },
      guided: [{ fen: '8/8/8/2k5/8/8/8/4K2Q w - - 0 1', task: 'Make the red zone smaller with the queen.', type: 'shrink' }],
      harder: { fen: 'k7/8/1K6/8/8/8/7Q/8 w - - 0 1', task: 'Mate in one — one wrong queen move is stalemate.', type: 'mate1' },
      mastery: { gen: ['q'], task: 'Checkmate with king and queen.', goal: 'mate', kind: 'teacher' } },
    { id: 'l5', title: 'King and rook vs king',
      intro: ['The rook cuts the board; the kings face each other (opposition). When the kings are in opposition, a rook check drives the king back one rank.', 'If the defending king attacks your rook, move the rook to the far side along the same line — never give up the cut.'],
      demo: { fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', auto: 'teacher', plies: 40, say: 'Cut, approach with the king, check in opposition, repeat.' },
      guided: [{ fen: '8/8/8/8/4k3/8/8/R3K3 w - - 0 1', task: 'Cut the king off with the rook.', type: 'shrink' }],
      harder: { fen: '4k3/8/4K3/8/8/8/8/7R w - - 0 1', task: 'The kings are in opposition. Mate in one.', type: 'mate1' },
      mastery: { gen: ['r'], task: 'Checkmate with king and rook.', goal: 'mate', kind: 'teacher' } },
    { id: 'l3', title: 'Two-rook ladder',
      intro: ['Two rooks mate without help from the king. One rook guards a rank, the other checks on the next rank — like climbing a ladder.', 'If the king comes close to a rook, move that rook to the far side of the board and continue.'],
      demo: { fen: '8/8/8/3k4/8/8/8/R3K2R w - - 0 1', steps: [
        { say: 'The rooks will take turns: one cuts a rank, the other gives check one rank further.' },
        { move: 'a1a4', say: 'Ra4 cuts off the 4th rank. The king must stay on ranks 5–8.', rings: ['a4'] },
        { move: 'd5e5', say: 'The king steps aside.' },
        { move: 'h1h5', say: 'Rh5+ checks on the 5th rank; the a-rook still guards the 4th.' },
        { move: 'e5d6', say: 'Forced up a rank.' },
        { move: 'a4a6', say: 'Ra6+ — the other rook climbs.' },
        { move: 'd6c7', say: 'Up again.' },
        { move: 'h5h7', say: 'Rh7+ — the 7th rank.' },
        { move: 'c7d8', say: 'The king reaches the back rank.' },
        { move: 'a6a8', say: 'Ra8# — the 7th and 8th ranks are both controlled. Checkmate!' },
      ] },
      guided: [{ fen: '8/8/8/8/3k4/8/R7/1R2K3 w - - 0 1', task: 'Take the next rung: cut the king off a rank higher.', type: 'shrink' }],
      harder: { fen: '4k3/R7/8/8/8/8/8/1R2K3 w - - 0 1', task: 'The 7th rank is cut. Deliver mate in one.', type: 'mate1' },
      mastery: { gen: ['r', 'r'], task: 'Mate with two rooks from a new position.', goal: 'mate', kind: 'teacher' } },
    { group: 'Pawn endgames' },
    { id: 'l8', title: 'Winning king and pawn',
      intro: ['Put it together: king in front of the pawn, take the opposition, reach a key square, and only then push.', 'A pawn that runs ahead of its king is caught; a king that wanders off the pawn loses it.'],
      demo: { fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', auto: 'engine', plies: 10, say: 'King on the 6th in front of the pawn: it always wins.' },
      guided: [
        { fen: '8/1k6/8/8/K7/6P1/8/8 w - - 0 1', task: 'Only one move wins. Think opposition.', type: 'keep' },
        { fen: '8/8/8/8/8/5k2/2P5/4K3 w - - 0 1', task: 'Only one move wins.', type: 'keep' },
      ],
      harder: { table: 'p', minPlies: 30, task: 'Win against perfect defence.', goal: 'promote', kind: 'engine' },
      mastery: { table: 'p', minPlies: 36, task: 'Mastery: a long win against perfect defence.', goal: 'promote', kind: 'engine' } },
    { id: 'p2', title: 'Defending against the pawn',
      intro: ['With the lone king, stand IN FRONT of the pawn. When the kings face each other, keep the opposition; when the pawn reaches your back rank\'s neighbour, step straight back.', 'Every endgame of king and pawn against king is either a forced win or a draw — your job is to make no mistake.'],
      demo: { fen: '4k3/8/4K3/4P3/8/8/8/8 b - - 0 1', auto: 'engine', plies: 6, say: 'When the attacker already owns a key square, nothing helps — so stop it earlier.' },
      guided: [
        { fen: '5k2/8/2K5/8/4P3/8/8/8 b - - 0 1', task: 'You are Black. Only one move holds the draw.', type: 'keep', side: 'b' },
        { fen: '2k5/8/4P3/1K6/8/8/8/8 b - - 0 1', task: 'Only one move draws.', type: 'keep', side: 'b' },
        { fen: '6k1/3K4/8/8/8/8/5P2/8 b - - 0 1', task: 'Only one move draws.', type: 'keep', side: 'b' },
      ],
      harder: { fen: '4k3/8/2P5/5K2/8/8/8/8 b - - 0 1', task: 'Only one move draws — which way does the king go?', type: 'keep', side: 'b' },
      mastery: { table: 'p', want: 'draw', side: 'b', task: 'Hold the draw for 25 moves against perfect play.', goal: 'hold', kind: 'engine' } },
    { group: 'Advanced mates' },
    { id: 'l6', title: 'Two bishops',
      intro: ['Side by side, two bishops make an unbreakable wall of diagonals. Push the king to the edge, then into any corner.', 'Your king must help: it covers the squares the bishops cannot.'],
      demo: { fen: '8/8/8/3k4/8/8/8/2B1KB2 w - - 0 1', auto: 'engine', plies: 12, say: 'The bishops work together, the king comes forward.' },
      guided: [{ fen: '8/8/8/3k4/8/8/8/2B1KB2 w - - 0 1', task: 'Put a bishop where it takes squares from the king.', type: 'shrink' }],
      harder: { fen: '7k/8/5K2/4BB2/8/8/8/8 w - - 0 1', task: 'Finish it: checkmate in the corner.', goal: 'mate', kind: 'engine' },
      mastery: { gen: ['b', 'b'], bk: CORNER, task: 'Mate with two bishops.', goal: 'mate', kind: 'engine' } },
    { id: 'l7', title: 'Bishop and knight',
      intro: ['The hardest basic mate. It only works in a corner of the SAME colour as your bishop.', 'Drive the king to the edge, then walk it along the edge toward the right corner with the knight\'s "W" manoeuvre.'],
      demo: { fen: 'k7/3N4/1K6/8/8/8/8/5B2 w - - 0 1', steps: [
        { say: 'Light-squared bishop → mate happens on a8 or h1 (light corners).', rings: ['a8', 'h1'] },
        { say: 'Here a7 and b7 are covered by the king, b8 by the knight on d7.', rings: ['a7', 'b7', 'b8'] },
        { move: 'f1g2', say: 'Bg2# — the long diagonal. Checkmate!' },
      ] },
      guided: [{ fen: 'k7/3N4/1K6/8/8/8/8/5B2 w - - 0 1', task: 'Mate in one. Many moves here are stalemate!', type: 'mate1' }],
      harder: { fen: '1k6/8/1K1N4/8/8/8/8/5B2 w - - 0 1', task: 'Force mate in the light corner.', goal: 'mate', kind: 'engine' },
      mastery: { gen: ['b', 'n'], bk: CORNER, task: 'Mate with bishop and knight.', goal: 'mate', kind: 'engine' } },
    { group: 'Queen and rook endings' },
    { id: 'q1', title: 'Queen vs pawn on the 7th', noBox: true,
      intro: ['A queen beats a pawn on the 7th rank. Check the king, or pin the pawn, until the king has to step IN FRONT of its own pawn.', 'Each time the king blocks its pawn, you get one free move: bring your king a step closer. Repeat until your king arrives, then win the pawn.'],
      demo: { fen: 'K7/8/8/8/8/8/3pk3/7Q w - - 0 1', auto: 'engine', plies: 14, say: 'Checks and pins force the king in front of its pawn; each time, the white king steps closer.' },
      guided: [
        { fen: 'K7/8/8/8/8/8/3pk3/7Q w - - 0 1', type: 'best', prefer: ['h1e4', 'h1h5', 'h1g2', 'h1h2'], task: 'The pawn is one step from queening. Stop it with a check.', why: 'Check first — the king must answer, and the pawn cannot move.' },
        { fen: 'K7/8/8/8/8/4Q3/3p4/3k4 w - - 0 1', type: 'best', prefer: ['a8b7', 'a8a7'], task: 'The king is stuck in front of its own pawn. Use your free move.', why: 'The king blocks its own pawn, so you have time: bring your king one step closer.' },
      ],
      harder: { fen: '8/8/8/8/1K6/8/2kp4/5Q2 w - - 0 1', type: 'best', prefer: ['f1e2', 'f1c4'], task: 'Find the move that stops the pawn for good.', why: 'The queen covers the queening square (or checks), so the pawn cannot move.' },
      mastery: { make: () => genQvP(), task: 'Win with the queen against the pawn on the 7th.', goal: 'mate', kind: 'engine', intro: 'Your move. Check or pin until the king has to block its own pawn — then step your king closer. Win the pawn, then mate.' } },
    { id: 'r1', title: 'Lucena: building a bridge', noBox: true,
      intro: ['Rook and pawn against rook. Your king stands in front of your pawn on the 7th rank, and the enemy king is cut off by your rook. To get your king out, you need a "bridge".', 'Check the enemy king one more file away, then put your rook on the 4th rank. Walk your king out; when the checks run out of room, your rook steps in front of your king and blocks them.'],
      demo: { fen: LUCENA.fen, steps: [
        { say: 'Your king is in front of the pawn, and the black king is cut off by your rook. But the king cannot get out: the black rook checks it.' },
        { move: 'c1d1', say: 'Check — the black king is pushed one more file away.' }, { move: 'd7e7', say: 'The king must step aside.' },
        { move: 'd1d4', say: 'The rook goes to the 4th rank. This is the bridge.' }, { move: 'a2a1', say: 'Black waits for a chance to check.' },
        { move: 'b8c7', say: 'Now the king walks out.' }, { move: 'a1c1', say: 'Check.' }, { move: 'c7b6', say: 'The king walks up next to the pawn.' },
        { move: 'c1b1', say: 'Check.' }, { move: 'b6c6', say: 'Away from the file.' }, { move: 'b1c1', say: 'Check.' }, { move: 'c6b5', say: 'One more step.' },
        { move: 'c1b1', say: 'Check — but now…' }, { move: 'd4b4', say: 'The bridge! The rook blocks, the checks are over and the pawn queens.' },
      ] },
      guided: [
        { type: 'line', ...LUCENA, steps: LUCENA.steps.slice(0, 3), task: 'Start the Lucena: check, then build the bridge.' },
        { type: 'line', fen: LUCENA.mid, steps: LUCENA.steps.slice(4), task: 'The bridge is built. Walk the king out and finish it.' },
      ],
      harder: { type: 'line', ...LUCENA, vary: true, task: 'The whole Lucena, on a different file.' },
      mastery: { line: true, ...LUCENA, vary: true, task: 'Play the Lucena from start to finish — no hints, no mistakes.' } },
    { id: 'r2', title: 'Philidor: the drawing defence', side: 'b', noBox: true,
      intro: ['Defending rook and pawn with your rook: keep your king in front of the pawn and your rook on your 3rd rank (the 6th, when you are Black). The white king cannot come forward.', 'When the pawn steps onto that rank, the white king loses its shelter. Drop your rook to the far end of the board and check from behind — the checks never end. Draw.'],
      demo: { fen: PHILIDOR.fen, steps: [
        { say: 'You are Black. The white king wants to reach the 6th rank and help the pawn.' },
        { move: 'a1a6', say: 'Ra6! The rook guards the whole 6th rank. The king cannot advance.' },
        { move: 'e5e6', say: 'White pushes the pawn to the 6th — but now the king has no cover from behind.' },
        { move: 'a6a1', say: 'The rook drops all the way back…' }, { move: 'd5d6', say: 'The king tries to hide in front of the pawn.' },
        { move: 'a1d1', say: 'Check from behind.' }, { move: 'd6e5', say: 'The king steps away…' },
        { move: 'd1e1', say: 'And check again. White can never get rid of the checks: a draw.' },
      ] },
      guided: [
        { type: 'line', side: 'b', ...PHILIDOR, task: 'Hold the Philidor: rook to the 6th, then checks from behind.' },
        { type: 'line', side: 'b', fen: '4k3/1R6/r7/3KP3/8/8/8/8 b - - 0 1', steps: [{ ok: ['e8f8', 'e8d8', 'a6g6', 'a6h6'], ask: 'White is waiting. Make a safe waiting move — and keep your rook on the 6th rank.', say: 'Right: the rook stays on the 6th rank and the white king still cannot come forward.', no: 'Keep the rook on the 6th rank and do not leave it where it can be taken.' }], task: 'White waits. What do you do?' },
      ],
      harder: { type: 'line', side: 'b', fen: '4k3/7R/r3P3/3K4/8/8/8/8 b - - 0 1', steps: [{ ok: ['a6a1', 'a6a2', 'a6a3'], ask: 'The pawn is already on the 6th. What now?', say: 'Yes — far back, ready to check from behind.', no: 'The king has no shelter now. Drop the rook far back and check from behind.' }], task: 'The pawn has stepped forward. Find the drawing idea.' },
      mastery: { line: true, side: 'b', ...PHILIDOR, vary: true, task: 'Hold the Philidor from start to finish — no hints, no mistakes.' } },
    { group: 'Pawn structure' },
    { id: 's1', title: 'The outside passed pawn', noBox: true,
      intro: ['A passed pawn far away from the other pawns is a decoy. The enemy king has to run over and stop it.', 'While it is busy, your king walks to the other side and eats the pawns there. Push the outside pawn first; bring the king second.'],
      demo: { fen: '8/5pk1/6p1/8/P7/6P1/5PK1/8 w - - 0 1', auto: 'engine', plies: 14, say: 'The a-pawn runs; the black king must chase it; the white king takes the kingside.' },
      guided: [
        { fen: '8/5pk1/6p1/8/P7/6P1/5PK1/8 w - - 0 1', type: 'best', prefer: ['a4a5'], task: 'You have an outside passed pawn. Use it.', why: 'Push it! The black king has to run after it — far away from its own pawns.' },
        { fen: '8/5pk1/6p1/8/1P6/6P1/5PK1/8 w - - 0 1', type: 'best', prefer: ['b4b5'], task: 'Same idea, different pawn.', why: 'Push the passed pawn: it drags the enemy king away.' },
      ],
      harder: { fen: '8/5p2/6p1/P7/1k6/6P1/5PK1/8 w - - 0 1', type: 'best', prefer: ['a5a6'], task: 'The black king is coming. Keep it busy.', why: 'Push on: the king must chase the pawn, and your king gets the other side.' },
      mastery: { make: () => pick(['8/5pk1/6p1/8/P7/6P1/5PK1/8 w - - 0 1', '8/5pk1/6p1/8/1P6/6P1/5PK1/8 w - - 0 1', '8/5p2/6p1/P7/1k6/6P1/5PK1/8 w - - 0 1']), task: 'Win it: make a new queen.', goal: 'promote', kind: 'engine', intro: 'Your move. Push the outside pawn to drag the king away, then take the other side with your king.' } },
    { id: 's2', title: 'King activity', noBox: true,
      intro: ['In the endgame the king stops hiding and becomes a fighting piece. A king in the centre reaches both sides of the board.', 'When there is nothing urgent, ask: can my king come closer to the centre or to the pawns? It is usually the best move on the board.'],
      demo: { fen: '8/5k2/1p3p2/p1p3p1/P1P3P1/1P3P2/5K2/8 w - - 0 1', auto: 'engine', plies: 10, say: 'Both kings race for the centre: whoever arrives first gets to the pawns.' },
      guided: [
        { fen: '8/p4pk1/1p4p1/8/8/1P4P1/P4PK1/8 w - - 0 1', type: 'best', prefer: ['g2f3'], task: 'Nothing is attacked. Find the best plan.', why: 'Kf3 — the king heads for the centre, where it will be needed.' },
        { fen: '8/5k2/1p3p2/p1p3p1/P1P3P1/1P3P2/5K2/8 w - - 0 1', type: 'best', prefer: ['f2e3'], task: 'The pawns are locked. Which piece matters now?', why: 'Ke3 — the king walks to the centre, toward the squares it needs.' },
      ],
      harder: { fen: '8/pp3k2/2p5/8/8/2P5/PP3K2/8 w - - 0 1', type: 'best', prefer: ['f2e3', 'f2f3'], task: 'Find the move that matters most.', why: 'The king comes to the centre first — then it can go to whichever side needs it.' },
      mastery: { series: ['s2a', 's2b', 's2c', 's2d'], need: 3, task: 'Three positions in a row, first try, no hints.' } },
    { id: 's3', title: 'Opposite-coloured bishops', side: 'b', noBox: true,
      intro: ['When each side has one bishop and they run on different colours, the defender can often hold even a pawn down.', 'Build a blockade: put your king in front of the passed pawn, on a square your bishop also guards. The other bishop can never chase you away from it.'],
      demo: { fen: '8/4k3/8/3P4/2K5/8/4B3/2b5 b - - 0 1', steps: [
        { say: 'You are Black, a pawn down. The bishops run on opposite colours.' },
        { move: 'e7d6', say: 'Kd6! The king stands in front of the pawn — on a dark square your bishop controls. The light bishop can never attack it.' },
        { move: 'c4b5', say: 'White tries to go around…' }, { move: 'c1g5', say: '…and your bishop simply keeps guarding. Nothing gets through: a draw.' },
      ] },
      guided: [
        { fen: '8/4k3/8/3P4/2K5/8/4B3/2b5 b - - 0 1', side: 'b', type: 'best', prefer: ['e7d6'], task: 'You are a pawn down. Set up the blockade.', why: 'King in front of the pawn, on your bishop\'s colour. White\'s bishop can never chase it away.' },
        { fen: '8/4k3/8/3P4/2K5/8/4B3/2b5 b - - 0 1', side: 'b', type: 'best', prefer: ['e7d6'], vary: true, task: 'Same idea, new place.', why: 'King in front of the pawn, on your bishop\'s colour.' },
      ],
      harder: { fen: '8/4k3/8/3P4/2K5/8/4B3/2b5 b - - 0 1', side: 'b', type: 'best', prefer: ['e7d6'], vary: true, task: 'Find the blockade square.', why: 'The blockade holds: the pawn cannot move and nothing can chase your king.' },
      mastery: { series: ['s3a', 's3a', 's3a'], need: 3, task: 'Three blockades in a row, first try, no hints.' } },
    { id: 's4', title: 'Trading down', noBox: true,
      intro: ['When you are ahead, trade pieces — not pawns. Fewer pieces means fewer tricks for your opponent, and your extra material counts for more.', 'When you are behind, do the opposite: keep pieces on and look for chances.'],
      demo: { fen: '3rk3/5ppp/8/8/8/8/P4PPP/3R2K1 w - - 0 1', steps: [
        { say: 'White is a pawn up. With rooks on, Black still has chances.' },
        { move: 'd1d8', say: 'Rxd8+! Trade the rooks.' }, { move: 'e8d8', say: 'The king takes back…' },
        { say: '…and now it is a pawn ending with an extra outside pawn. That wins easily.' },
      ] },
      guided: [
        { fen: '4r1k1/5pp1/4q2p/8/8/P3Q2P/5PP1/4R1K1 w - - 0 1', type: 'best', prefer: ['e3e6'], task: 'You are a pawn up. Simplify.', why: 'Trade queens: with fewer pieces, your extra pawn decides.' },
        { fen: '3r4/4kpp1/7p/8/8/2N4P/5PP1/3R2K1 w - - 0 1', type: 'best', prefer: ['d1d8'], task: 'You are a knight up. Make it simple.', why: 'Trade the rooks. Knight against nothing is an easy win.' },
      ],
      harder: { fen: '3rk3/5ppp/8/8/8/8/P4PPP/3R2K1 w - - 0 1', type: 'best', prefer: ['d1d8'], task: 'A pawn up. Turn it into a win.', why: 'Rxd8+ — the pawn ending with an outside passed pawn is a simple win.' },
      mastery: { series: ['s4a', 's4b', 's4c'], need: 3, task: 'Three positions in a row, first try, no hints.' } },
    { group: 'Defender\'s side' },
    { id: 'dq', title: 'Survive the queen', side: 'b', noBox: true,
      intro: ['Play the lone king against king and queen. You will lose — but seeing the mate from the other side teaches you how it works.', 'Stay in the middle of the board and keep away from the edges and corners. Stay close to the enemy king\'s side: the queen alone can\'t mate you.'],
      demo: { fen: '8/8/8/3k4/8/8/8/1Q2K3 w - - 0 1', auto: 'engine', plies: 16, say: 'The best defence heads for the centre every time it gets the chance.' },
      guided: [{ type: 'longest', table: 'q', minPlies: 12, task: 'You are the lone king. Pick the move that survives longest.' }, { type: 'longest', table: 'q', minPlies: 14, task: 'Again: the longest defence.' }],
      harder: { type: 'longest', table: 'q', minPlies: 16, task: 'Find the longest defence.' },
      mastery: { survive: 'q', task: 'Survive as long as you can: 7 of every 10 moves must be the longest defence.' } },
    { id: 'dr', title: 'Survive the rook', side: 'b', noBox: true,
      intro: ['Now the lone king against king and rook. The rook mate takes longer — make it as long as possible.', 'Attack the rook when you can, step away from the rook\'s line, and avoid facing the white king (opposition) on the edge.'],
      demo: { fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', auto: 'engine', plies: 16, say: 'The defending king keeps to the centre and makes the rook work for every square.' },
      guided: [{ type: 'longest', table: 'r', minPlies: 20, task: 'Pick the move that survives longest.' }, { type: 'longest', table: 'r', minPlies: 24, task: 'Again: the longest defence.' }],
      harder: { type: 'longest', table: 'r', minPlies: 28, task: 'Find the longest defence.' },
      mastery: { survive: 'r', task: 'Survive as long as you can: 7 of every 10 moves must be the longest defence.' } },
  ];

  const LESSONS = ALL_LESSONS.filter((l) => l.id);
  function openAcademy() {
    session++; screen = 'academy'; top.hidden = true; panel.hidden = true; B().onMove(null);
    hub.classList.remove('tr-sg-page', 'tr-ed-page'); hub.replaceChildren();
    const head = el('div', 'tr-head'); const back = btn('', 'tr-back', () => openHub());
    back.innerHTML = '<svg width="11" height="18" viewBox="0 0 11 18" aria-hidden="true"><path d="M9 2L2 9l7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Training</span>';
    head.append(back, el('h2', '', 'Endgame Academy'));
    const list = el('div', 'tr-list');
    let n = 0;
    ALL_LESSONS.forEach((l) => {
      if (l.group) { list.append(el('div', 'tr-group', l.group)); return; }
      const i = n++;
      const st = P.lessons[l.id] || {};
      const b = btn('', 'tr-item', () => startLesson(l));
      b.innerHTML = '<span class="tr-num"></span><span class="tr-card-text"><b></b><span></span></span><span class="tr-badge"></span>';
      b.querySelector('.tr-num').textContent = String(i + 1); b.querySelector('b').textContent = l.title;
      b.querySelector('.tr-card-text span').textContent = (st.mastered ? 'Mastered' : st.stage ? 'In progress' : 'Not started') + (lessonSide(l) === 'b' ? ' · you defend' : '');
      b.querySelector('.tr-badge').textContent = st.mastered ? '✓' : '';
      list.append(b);
    });
    hub.append(head, list); hub.hidden = false;
  }

  /* lesson stages: intro → demo → guided → harder → mastery */
  let LS = null;
  function startLesson(l, stage = 0) {
    hub.hidden = true; screen = 'lesson';
    LS = { l, stage, task: 0, shrinks: 0 };
    runStage();
  }
  const STAGES = ['Concept', 'Demo', 'Guided', 'Harder', 'Mastery'];
  function stageTop() {
    const s = el('span', 'tr-chip dim', (LS.stage + 1) + '/5 ' + STAGES[LS.stage]);
    setTop(LS.l.title, s);
  }
  function lessonPanel(title, buttons = [], sub = '') {
    panel.hidden = false; panel.replaceChildren();
    const head = el('div', 'tr-head2'); head.append(el('span', 'tr-turn lesson', '♔'), el('b', 'tr-h-title', title));
    const msg = el('div', 'tr-say', sub); const row = el('div', 'tr-actions'); buttons.forEach((b) => row.append(b));
    panel.append(head, msg, row); return msg;
  }
  function nextStage() {
    const st = P.lessons[LS.l.id] || (P.lessons[LS.l.id] = {});
    LS.stage++; LS.task = 0; LS.shrinks = 0; st.stage = Math.max(st.stage || 0, LS.stage); save();
    runStage();
  }
  async function runStage() {
    const my = ++session; const l = LS.l; stageTop(); B().onMove(null); mark({});
    if (LS.stage === 0) {
      const f = l.demo.fen || (l.guided[0] && l.guided[0].fen);
      B().setup({ fen: f, side: lessonSide(l), opponent: 'Defender' }); B().busy(true);
      if (!isPawnLesson(l) && !l.noBox) tintBox(); else mark({});
      lessonPanel('The idea', [btn('Show me', 'primary', nextStage, 'play'), btn('Skip ahead', 'quiet', () => { LS.stage = 3; nextStage(); }, 'skip')], l.intro.join('\n\n'));
      return;
    }
    if (LS.stage === 1) return void runDemo(my);
    if (LS.stage === 2) { LS.task = 0; const step = () => { if (LS.task < l.guided.length) { const g = l.guided[LS.task++]; void runTask(g, ++session, step); } else nextStage(); }; return step(); }
    if (LS.stage === 3) return void runTask(l.harder, my, nextStage);
    if (LS.stage === 4) {
      await loadTables(); if (my !== session) return;
      const m = l.mastery;
      const mastered = (res) => {
        if (res.win) { const st = P.lessons[l.id] || (P.lessons[l.id] = {}); st.mastered = true; st.stage = 5; save(); }
        B().onMove(null); B().busy(true);
        const msg = lessonPanel(res.win ? 'Lesson mastered! ' + res.summary : res.summary, [btn(res.win ? (RETURN ? 'Back to chapter' : 'Back to lessons') : 'Try again', 'primary', res.win ? (RETURN || openAcademy) : () => runStage()), btn('New position', 'quiet', () => runStage())]);
        msg.classList.add(res.win ? 'good' : 'bad');
      };
      if (m.survive) return void playSurvive(m.survive, m.task, mastered);
      if (m.series) return void runSeries(m, my, mastered);
      if (m.line) {
        const L = m.vary ? varyLine(m) : m;
        B().setup({ fen: L.fen, side: m.side || 'w', opponent: 'Defender' }); B().busy(true);
        return void runLine(L, my, () => mastered({ win: true, summary: 'Played without a mistake.' }), true, () => mastered({ win: false, summary: 'One wrong move ends a mastery attempt. Try a fresh one.' }));
      }
      const fen = masteryFen(m);
      return void playEnding({ fen, goal: m.goal, kind: m.kind, task: m.task, mode: 'practice', side: m.side || 'w', intro: m.intro, noBox: l.noBox, onDone: (res) => {
        if (res.win) { const st = P.lessons[l.id] || (P.lessons[l.id] = {}); st.mastered = true; st.stage = 5; save(); }
        const msg = lessonPanel(res.win ? 'Lesson mastered! ' + res.summary : res.summary, [btn(res.win ? (RETURN ? 'Back to chapter' : 'Back to lessons') : 'Try again', 'primary', res.win ? (RETURN || openAcademy) : () => runStage()), btn('New position', 'quiet', () => runStage())]);
        msg.classList.add(res.win ? 'good' : 'bad');
      } });
    }
  }
  const isPawnLesson = (l) => /^(f3|f4|f5|l8|p2)$/.test(l.id);
  const lessonSide = (l) => l.side || (l.id === 'p2' ? 'b' : 'w');
  function masteryFen(m) {
    if (m.fen) return m.fen;
    if (m.make) return m.make();
    if (m.table) {
      const want = m.want || 'win', stm = m.side === 'b' ? 'b' : 'w';
      /* positions that need thought: few moves keep the result */
      const fair = (c, f) => { const k = kpkPieces(f); return dist(k.bk, k.p) >= 2 && (!m.test || m.test(c, f)); };
      for (let k = 0; k < 80; k++) { const f = genTable(m.table, { stm, want, minPlies: m.minPlies || 0, test: fair }); if (!f) continue; const n = keepers(f).length; if (n >= 1 && n <= 2 && new (B().Chess)(f).moves().length - n >= 3) return f; }
      return genTable(m.table, { stm, want, minPlies: m.minPlies || 0, test: m.test });
    }
    return genEnding(m.gen, { bk: m.bk, minBox: m.gen.length === 1 ? 12 : 8 });
  }
  function tintBox(def = 'b') {
    const bx = box(B().fen(), def); mark({ tint: bx.squares });
  }
  async function runDemo(my) {
    const d = LS.l.demo;
    B().setup({ fen: d.fen, side: lessonSide(LS.l), opponent: 'Defender' }); B().busy(true);
    const msg = lessonPanel('Watch', [btn('Your turn', 'primary', nextStage, 'next'), btn('Replay', 'quiet', () => runStage(), 'retry')], d.say || '');
    await sleep(700); if (my !== session) return;
    if (d.steps) {
      for (const s of d.steps) {
        if (my !== session) return;
        if (s.fen) { B().setup({ fen: s.fen, side: 'w', opponent: 'Defender' }); B().busy(true); }
        if (s.move) { mark({ arrows: [[s.move.slice(0, 2), s.move.slice(2, 4)]] }); await sleep(600); if (my !== session) return; B().play(s.move); await sleep(500); }
        mark({ rings: s.rings || [], tint: s.tint || [], noLegend: true });
        say(msg, s.say); await sleep(2600);
      }
      return;
    }
    const seen = new Set();
    for (let i = 0; i < (d.plies || 10); i++) {
      if (my !== session) return;
      const fen = B().fen(), C = B().Chess, c = new C(fen);
      if (c.isGameOver()) break;
      const white = c.turn() === 'w';
      const u = white ? (d.auto === 'teacher' ? (await suggest(fen, 'teacher')) : await bestMove(fen)) : await bestMove(fen);
      if (my !== session || !u) return;
      seen.add(fen.split(' ').slice(0, 2).join(' '));
      const before = box(fen, 'b').area;
      if (white) { mark({ arrows: [[u.slice(0, 2), u.slice(2, 4)]] }); await sleep(450); }
      B().play(u); await sleep(350);
      const after = new C(B().fen());
      const bx = box(B().fen(), 'b');
      mark(LS.l.noBox ? {} : { tint: bx.squares });
      if (after.isCheckmate()) { say(msg, 'Checkmate! ' + (d.say || '')); break; }
      if (isPawnLesson(LS.l)) { say(msg, (white ? '' : 'Black: ') + sanOf(fen, u) + (white ? ' — ' + explainPawn(fen, u, B().fen(), true).replace(/^Correct — /, '') : ' — the best defence.')); mark(d.rings && white && i < 2 ? { rings: d.rings } : {}); }
      else if (white && d.auto !== 'teacher') { say(msg, sanOf(fen, u) + (after.inCheck() ? ' — check. ' : '. ') + (d.say || '')); mark(new C(B().fen()).moves().length && /p/i.test(fen.split(' ')[0].replace(/[^pP]/g, '')) ? {} : { tint: bx.squares }); }
      else if (white) say(msg, (after.inCheck() ? 'Check. ' : '') + (bx.area < before ? 'Box: ' + before + ' → ' + bx.area + ' squares.' : 'Box ' + bx.area + ' squares — ' + (u.length && new C(fen).get(u.slice(0, 2))?.type === 'k' ? 'the king steps up to help.' : 'keeping the cut.')));
      await sleep(900);
    }
  }
  async function runTask(g, my, done) {
    await loadTables(); if (my !== session) return;
    if (g.type === 'line') { const L = g.vary ? varyLine(g) : g; B().setup({ fen: L.fen, side: g.side || 'w', opponent: 'Defender' }); B().busy(true); return void runLine(L, my, () => done()); }
    if (g.type === 'best') { const G2 = g.vary ? varyBest(g) : g; B().setup({ fen: G2.fen, side: g.side || 'w', opponent: 'Defender' }); B().busy(false); mark({}); return void runBest(G2, my, () => done()); }
    if (g.type === 'longest') { const f = genDefence(g.table, g.minPlies || 12); B().setup({ fen: f, side: 'b', opponent: 'Computer' }); B().busy(false); mark({}); return void runLongest(g, my, done); }
    const fen0 = g.fen || masteryFen(g);
    B().setup({ fen: fen0, side: g.side || 'w', opponent: 'Defender' }); B().busy(false);
    if (g.type === 'keep') return void runKeep(g, my, done);
    if (g.goal) {
      return void playEnding({ fen: fen0, goal: g.goal, kind: g.kind, task: g.task, limit: g.limit, side: g.side || 'w', mode: 'guided', onDone: (res) => {
        const msg = lessonPanel(res.summary, [btn(res.win ? 'Continue' : 'Try again', 'primary', res.win ? done : () => runStage())]); msg.classList.add(res.win ? 'good' : 'bad');
      } });
    }
    tintBox();
    let need = g.count || 1;
    const msg = lessonPanel(g.task, [btn('Hint', 'hint', async () => {
      const u = g.type === 'mate1' ? uciOf(mateMoves(B().chess())[0]) : await suggest(B().fen(), 'teacher');
      if (u) mark({ tint: box(B().fen(), 'b').squares, arrows: [[u.slice(0, 2), u.slice(2, 4)]], lift: u.slice(0, 2) });
    }, 'hint'), btn('Skip', 'quiet', done, 'skip')]);
    B().onMove(async (uci) => {
      if (my !== session) return;
      B().busy(true);
      const fenBefore = B().prevFen();
      const C = B().Chess, after = new C(B().fen());
      if (g.type === 'mate1') {
        if (after.isCheckmate()) { say(msg, 'Checkmate! ' + (g.type === 'mate1' ? 'Every escape square is covered.' : ''), 'good'); mark({}); await sleep(900); if (my === session) done(); return; }
        const text = after.isStalemate() ? 'Stalemate! The king has no move but is not in check — a draw. Give check while taking the last squares.' : after.inCheck() ? 'Check, but the king escapes to ' + after.moves({ verbose: true }).filter((m) => m.piece === 'k').map((m) => m.to).join(', ') + '.' : 'That is not even check. Look for a check that leaves no escape.';
        say(msg, text, after.isStalemate() ? 'bad' : 'warn'); await sleep(1300); if (my !== session) return;
        B().takeBack(1); tintBox(); B().busy(false); return;
      }
      const a = await assess(fenBefore, uci, 'mate', 'w'); if (my !== session) return;
      if (a.kind === 'mate') { say(msg, 'Checkmate!', 'good'); await sleep(900); if (my === session) done(); return; }
      if (a.kind === 'good' && (a.text.startsWith('Good — the king') || box(a.fenAfter, 'b').area < box(fenBefore, 'b').area)) {
        need--; say(msg, a.text + (need > 0 ? ' Once more.' : ''), 'good'); mark({ tint: box(B().fen(), 'b').squares });
        if (need <= 0) { await sleep(1100); if (my === session) done(); return; }
        const reply = await bestMove(B().fen()); if (my !== session) return;
        if (reply) B().play(reply); await sleep(300); tintBox(); B().busy(false); return;
      }
      say(msg, a.text, a.kind === 'lost' || a.kind === 'stalemate' ? 'bad' : 'warn'); await sleep(1500); if (my !== session) return;
      B().takeBack(1); tintBox(); B().busy(false);
    });
  }

  /* one-move exercise judged by the exact table: any move that keeps the result is right (not just the "book" move) */
  function runKeep(g, my, done) {
    mark({});
    let tries = 0;
    const msg = lessonPanel(g.task, [btn('Hint', 'hint', () => {
      const ks = keepers(B().fen()); if (!ks.length) return;
      tries++;
      const m = ks[0]; mark(tries === 1 ? { lift: m.from } : { lift: m.from, arrows: [[m.from, m.to]] });
      say(msg, tries === 1 ? 'Hint: move the highlighted piece.' : 'Hint: play the move the arrow shows.');
    }, 'hint'), btn('Skip', 'quiet', done, 'skip')]);
    B().onMove(async (uci) => {
      if (my !== session) return;
      B().busy(true);
      const fenBefore = B().prevFen(), fenAfter = B().fen();
      const before = probe(fenBefore), j = probe(fenAfter) || (await judge(fenAfter));
      const ok = before && (before.r === 'win' ? j.r === 'loss' : j.r !== 'win');
      const text = /p/i.test(fenBefore.split(' ')[0].replace(/[kK]/g, '')) ? explainPawn(fenBefore, uci, fenAfter, ok) : ok ? 'Correct.' : 'That gives away the result.';
      if (ok) {
        const alt = keepers(fenBefore).length;
        say(msg, text + (alt > 1 ? ' (' + alt + ' moves work here.)' : ''), 'good'); mark({});
        await sleep(1700); if (my === session) done(); return;
      }
      say(msg, text, 'bad');
      await sleep(2300); if (my !== session) return;
      B().takeBack(1); B().busy(false);
    });
  }

  /* ------------------------------------------------------------------ play an ending against the defending computer */
  async function playEnding({ fen, goal, kind = 'engine', task, limit, mode = 'practice', side = 'w', onDone, intro, noBox }) {
    const my = ++session;
    if (!fen) { lessonPanel('Could not create a position. Try again.', [btn('Try again', 'primary', () => runStage())]); return; }
    const C = B().Chess;
    const start = new C(fen);
    B().setup({ fen, side, opponent: 'Computer' }); B().busy(true);
    const stats = { moves: 0, mistakes: [], missed: 0, stalemates: 0, hints: 0, inefficient: 0, log: [] };
    let msg; let done = false;
    const buttons = [];
    if (mode !== 'challenge') buttons.push(btn('Hint', 'hint', async () => {
      if (done || B().turn() !== side) return;
      stats.hints++; const u = await suggest(B().fen(), kind === 'teacher' ? 'teacher' : 'engine');
      if (u && my === session) { mark({ tint: goal === 'hold' ? [] : box(B().fen(), other(side)).squares, arrows: [[u.slice(0, 2), u.slice(2, 4)]], lift: u.slice(0, 2) }); say(msg, 'Hint: play ' + sanOf(B().fen(), u) + ', following the arrow.'); }
    }, 'hint'));
    buttons.push(btn('Restart', 'quiet', () => void playEnding({ fen, goal, kind, task, limit, mode, side, onDone, intro, noBox }), 'retry'));
    buttons.push(btn('Give up', 'quiet', () => finish(false, 'You stopped this attempt.'), 'flag'));
    msg = lessonPanel(task, buttons, mode === 'challenge' ? 'No hints. You get a full review afterwards.' : intro || ({ mate: 'Your move. Shrink the red zone until the king has nowhere to go.', edge: 'Your move. Push the red zone toward the edge of the board.', promote: 'Your move. Walk the pawn to the last rank safely.', hold: 'Your move. Stop the pawn: a draw counts as a win here.' }[goal] || 'Your move.'));
    const guided = mode === 'guided';
    const showBox = () => { if (mode !== 'challenge' && goal !== 'hold' && goal !== 'promote' && !noBox) mark({ tint: box(B().fen(), other(side)).squares }); else mark({}); };
    const finish = (win, why) => {
      if (done) return; done = true; B().busy(true); B().onMove(null);
      const parts = [why];
      parts.push(stats.moves + ' move' + (stats.moves === 1 ? '' : 's'));
      if (stats.mistakes.length) parts.push(stats.mistakes.length + ' major mistake' + (stats.mistakes.length === 1 ? '' : 's'));
      if (stats.missed) parts.push(stats.missed + ' missed mate' + (stats.missed === 1 ? '' : 's'));
      if (stats.stalemates) parts.push(stats.stalemates + ' stalemate error' + (stats.stalemates === 1 ? '' : 's'));
      if (stats.hints) parts.push(stats.hints + ' hint' + (stats.hints === 1 ? '' : 's'));
      const perf = win ? Math.max(1, 5 - stats.mistakes.length - stats.stalemates - (stats.missed ? 1 : 0) - (stats.hints ? 1 : 0) - (stats.inefficient > 6 ? 1 : 0)) : 0;
      onDone({ win, perf, stats, summary: parts.join(' · ') + (win ? ' · ' + '★'.repeat(perf) + '☆'.repeat(5 - perf) : '') });
    };
    const boardOver = () => { const o = B().over(); if (!o || done) return false; finish(goal === 'hold', o === 'checkmate' ? 'Checkmate.' : 'Draw (' + o + ').'); return true; };
    const reply = async () => {
      const f = B().fen(), c = new C(f);
      if (boardOver() || c.isGameOver()) return;
      const u = await bestMove(f); if (my !== session || done) return;
      if (!u) return;
      B().play(u); await sleep(320); if (boardOver()) return;
      const after = new C(B().fen());
      if (after.isCheckmate()) return finish(false, 'You were checkmated.');
      if (after.isGameOver()) return finish(goal === 'hold', goal === 'hold' ? 'Draw — you held it!' : 'Draw.');
      if (goal === 'hold' && u.length === 5) { const j = await judge(B().fen()); if (j.r === 'loss') return finish(false, 'The pawn promoted.'); }
      showBox();
      if (guided && !done) { const s = await suggest(B().fen(), kind === 'teacher' ? 'teacher' : 'engine'); if (s && my === session && !done) mark({ tint: goal === 'hold' || goal === 'promote' ? [] : box(B().fen(), other(side)).squares, arrows: [[s.slice(0, 2), s.slice(2, 4), 'rgba(255,214,10,.75)']] }); }
      B().busy(false);
    };
    B().onMove(async (uci) => {
      if (my !== session || done) return;
      B().busy(true); stats.moves++;
      if (B().over() && !['checkmate', 'stalemate'].includes(B().over())) return void boardOver();
      const fenBefore = B().prevFen();
      say(msg, 'Thinking…');
      const a = await assess(fenBefore, uci, goal, side); if (my !== session || done) return;
      stats.log.push({ uci, kind: a.kind });
      if (a.missedMate) stats.missed++;
      if (a.kind === 'mate') return finish(goal !== 'hold', 'Checkmate!');
      if (a.kind === 'held') return finish(true, a.text);
      if (a.kind === 'stalemate') { stats.stalemates++; if (mode === 'challenge') return finish(false, 'Stalemate — a draw.'); say(msg, a.text, 'bad'); await sleep(1600); if (my !== session) return; B().takeBack(1); showBox(); B().busy(false); return; }
      if (a.kind === 'lost' || a.kind === 'draw') {
        stats.mistakes.push(uci);
        if (mode === 'challenge') return finish(false, a.kind === 'draw' ? 'Draw — the win is gone.' : 'That move gave away the result.');
        say(msg, a.text, 'bad'); await sleep(1600); if (my !== session) return; B().takeBack(1); showBox(); B().busy(false); return;
      }
      if (a.kind === 'inefficient') stats.inefficient++;
      if (mode !== 'challenge') say(msg, a.text, a.kind === 'good' ? 'good' : 'warn'); else say(msg, 'Move ' + stats.moves);
      const nowC = new C(B().fen());
      if (goal === 'edge') { const k = kingSq(nowC, other(side)); if (k && onEdge(k)) return finish(true, 'The king is on the edge!'); }
      if (goal === 'promote' && uci.length === 5) return finish(true, 'Promoted — and the new queen is safe.');
      if (goal === 'hold' && stats.moves >= 25) return finish(true, 'You held the draw for 25 moves!');
      if (limit && stats.moves >= limit) return finish(false, 'Not mate within ' + limit + ' moves. Look for the most forcing line.');
      if (stats.moves >= 60) return finish(false, 'Too many moves. Keep shrinking the red zone to finish faster.');
      await reply();
    });
    await sleep(500); if (my !== session) return;
    if (start.turn() !== side) await reply(); else { showBox(); if (guided) { const s = await suggest(fen, kind === 'teacher' ? 'teacher' : 'engine'); if (s && my === session) mark({ tint: goal === 'hold' || goal === 'promote' ? [] : box(fen, other(side)).squares, arrows: [[s.slice(0, 2), s.slice(2, 4), 'rgba(255,214,10,.75)']] }); } B().busy(false); }
  }

  /* ------------------------------------------------------------------ Endgame Challenges */
  const CHALLENGES = [
    { id: 'kq', title: 'King and queen mate', task: 'Checkmate with king and queen.', goal: 'mate', kind: 'teacher', gen: () => genTable('q', { minPlies: 15 }) || genEnding(['q'], { minBox: 14 }) },
    { id: 'kr', title: 'King and rook mate', task: 'Checkmate with king and rook.', goal: 'mate', kind: 'teacher', gen: () => genTable('r', { minPlies: 25 }) || genEnding(['r'], { minBox: 14 }) },
    { id: 'krr', title: 'Two-rook ladder', task: 'Ladder mate with two rooks.', goal: 'mate', kind: 'teacher', gen: () => genEnding(['r', 'r'], { minBox: 10 }) },
    { id: 'kbb', title: 'Two bishops mate', task: 'Checkmate with two bishops.', goal: 'mate', kind: 'engine', gen: () => genEnding(['b', 'b'], { bk: EDGE, minBox: 6 }) },
    { id: 'kbn', title: 'Bishop and knight mate', task: 'Checkmate with bishop and knight.', goal: 'mate', kind: 'engine', gen: () => genEnding(['b', 'n'], { bk: CORNER }) },
    { id: 'stale', title: 'Stalemate avoidance', task: 'Mate the cornered king — without stalemating it.', goal: 'mate', kind: 'teacher', gen: () => genEnding(['q'], { bk: ['a8', 'h8', 'a1', 'h1'], test: (c, f) => { const k = kingSq(c, 'b'); return dist(k, kingSq(c, 'w')) <= 3 && box(f, 'b').area <= 4; } }) },
    { id: 'promo', title: 'King and pawn: win it', task: 'Promote the pawn — perfect defence, only precise moves win.', goal: 'promote', kind: 'engine', gen: () => hardKPK('w', 'win') },
    { id: 'pawns', title: 'Winning pawn endgames', task: 'Win the pawn ending: promote a pawn.', goal: 'promote', kind: 'engine', gen: () => pick(['8/8/8/4k3/8/p7/P3K1P1/8 w - - 0 1', '8/5pk1/8/8/8/1P6/5PK1/8 w - - 0 1', '8/8/2k5/p7/P7/2K5/6P1/8 w - - 0 1', '8/8/4k3/8/4KP2/6P1/8/8 w - - 0 1', '8/5p2/5k2/8/5K2/5P2/5P2/8 w - - 0 1', '8/8/8/2k5/8/1PK5/1P6/8 w - - 0 1']) },
    { id: 'hold', title: 'King and pawn: hold it', task: 'You are Black. Hold the draw for 25 moves.', goal: 'hold', kind: 'engine', side: 'b', gen: () => hardKPK('b', 'draw') },
  ];
  function hardKPK(stm, want) {
    const fair = (c, f) => { const k = kpkPieces(f); return dist(k.bk, k.p) >= 2 && dist(k.wk, k.p) <= 4; };
    for (let k = 0; k < 120; k++) {
      const f = genTable('p', { stm, want, minPlies: want === 'win' ? 20 : 0, test: fair }); if (!f) continue;
      const n = keepers(f).length, legal = new (B().Chess)(f).moves().length;
      if (n >= 1 && n <= 2 && legal - n >= 3) return f;
    }
    return genTable('p', { stm, want });
  }
  function openChallenges() {
    session++; screen = 'challenges'; top.hidden = true; panel.hidden = true; B().onMove(null);
    hub.classList.remove('tr-sg-page', 'tr-ed-page'); hub.replaceChildren();
    const head = el('div', 'tr-head'); const back = btn('', 'tr-back', () => openHub());
    back.innerHTML = '<svg width="11" height="18" viewBox="0 0 11 18" aria-hidden="true"><path d="M9 2L2 9l7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Training</span>';
    head.append(back, el('h2', '', 'Endgame Challenges'));
    const modes = el('div', 'tr-seg');
    for (const [v, label] of [['guided', 'Guided'], ['practice', 'Practice'], ['challenge', 'Challenge']]) modes.append(btn(label, P.settings.mode === v ? 'on' : '', () => { P.settings.mode = v; save(); openChallenges(); }));
    const desc = { guided: 'Suggested moves and explanations as you play.', practice: 'Play on your own; hints when you want them.', challenge: 'No help during the attempt; full review afterwards.' }[P.settings.mode];
    const list = el('div', 'tr-list');
    for (const ch of CHALLENGES) {
      const st = P.challenges[ch.id] || {};
      const b = btn('', 'tr-item', () => startChallenge(ch));
      b.innerHTML = '<span class="tr-card-text"><b></b><span></span></span><span class="tr-badge"></span>';
      b.querySelector('b').textContent = ch.title;
      b.querySelector('.tr-card-text span').textContent = st.attempts ? (st.wins || 0) + ' won of ' + st.attempts + (st.best ? ' · best ' + '★'.repeat(st.best) : '') : 'Not tried';
      b.querySelector('.tr-badge').textContent = st.wins ? '✓' : '';
      list.append(b);
    }
    hub.append(head, modes, el('p', 'tr-note', desc), list); hub.hidden = false;
  }
  async function startChallenge(ch, forced) {
    hub.hidden = true; screen = 'challenge';
    await loadTables();
    const mode = forced || P.settings.mode;
    setTop(ch.title, el('span', 'tr-chip dim', { guided: 'Guided', practice: 'Practice', challenge: 'Challenge' }[mode]));
    void playEnding({ fen: ch.gen(), goal: ch.goal, kind: ch.kind, task: ch.task, mode, side: ch.side || 'w', onDone: (res) => {
      const st = P.challenges[ch.id] || (P.challenges[ch.id] = { attempts: 0, wins: 0, best: 0 });
      st.attempts++; if (res.win) { st.wins++; st.best = Math.max(st.best || 0, res.perf); } save();
      panel.replaceChildren();
      panel.append(el('div', 'tr-result ' + (res.win ? 'good' : 'bad'), res.win ? (ch.goal === 'hold' ? 'Draw held' : 'Won') : (/draw/i.test(res.summary) ? 'Draw' : 'Not won')), el('div', 'tr-say', res.summary));
      if (mode === 'challenge' && res.stats.log.length) {
        const rev = el('div', 'tr-review'); rev.append(el('span', 'tr-label', 'Review'));
        res.stats.log.forEach((m, i) => { const tag = { mate: 'mate', good: '✓', ok: '·', inefficient: 'slow', lost: '✗ lost win', stalemate: '✗ stalemate', draw: '✗ draw' }[m.kind] || m.kind; rev.append(el('span', 'tr-rev ' + m.kind, (i + 1) + '. ' + m.uci + ' ' + tag)); });
        panel.append(rev);
      }
      const row = el('div', 'tr-actions'); if (RETURN && res.win) row.append(btn('Back to chapter', 'primary', RETURN, 'next'), btn('New position', 'quiet', () => startChallenge(ch, forced)));
      else row.append(btn(RETURN ? 'Try again' : 'New position', 'primary', () => startChallenge(ch, forced), 'next'), btn(RETURN ? 'Back to chapter' : 'All challenges', 'quiet', RETURN || openChallenges));
      panel.append(row);
    } });
  }

  /* ------------------------------------------------------------------ the path
     One route through everything: each chapter teaches one idea (Learn), drills it (Practise) and tests it
     (Prove it). Every chapter is open; the first unfinished one is marked "Recommended next". */
  let PATH = null;   /* { ch, step, theme, lo, hi, count } while a path puzzle set is running */
  let RETURN = null; /* where Back / Done go while working through a chapter */
  const learn = (text, look) => ({ text, look });
  const CHAPTERS = [
    { id: 'c1', title: 'Checkmate basics', blurb: 'What check, mate and stalemate are, and finishing a game.',
      learn: { lesson: 'l1' }, practise: { theme: 'mateIn1', lo: 400, hi: 1300, count: 6 }, prove: { challenge: 'stale' } },
    { id: 'c2', title: 'Free pieces', blurb: 'Spot pieces that are left unprotected, and take them.',
      learn: learn(['Before every move, ask: what did my opponent just leave undefended?', 'Count attackers and defenders on each piece. If a piece is attacked more times than it is defended, it can be won.'], ['Every capture', 'Pieces with no defender', 'Pieces defended only once']),
      practise: { theme: 'hangingPiece', lo: 400, hi: 1300, count: 6 }, prove: { theme: 'hangingPiece', lo: 800, hi: 1600, count: 3 } },
    { id: 'd1', title: 'Guard your pieces', blurb: 'See what your opponent can take — before you move.', defend: true,
      learn: learn(['Most games between beginners are lost to a piece left unprotected, not to a deep plan.', 'Before every move, look at your opponent\'s pieces one by one: what can each of them capture next move? If something of yours is attacked and not defended — or attacked more times than defended — deal with it first.'], ['Your pieces with no defender', 'What the opponent\'s last move attacks', 'Captures your opponent has next move']),
      practise: { drill: 'threat', theme: ['hangingPiece'], count: 5 }, prove: { drill: 'blunder', theme: ['hangingPiece', 'fork'], count: 4 } },
    { id: 'c3', title: 'Forks', blurb: 'One piece attacking two things at once.',
      learn: learn(['A fork is one move that attacks two targets. They can only save one.', 'Knights are the classic forkers, but queens, pawns and even kings fork too. Look for a square that touches two loose pieces, or the king and a piece.'], ['Knight jumps near the king', 'Two pieces on the same colour square', 'Checks that also attack']),
      practise: { theme: 'fork', lo: 600, hi: 1400, count: 6 }, prove: { theme: 'fork', lo: 1000, hi: 1700, count: 3 } },
    { id: 'c4', title: 'King and queen mate', blurb: 'The first mate everyone needs: push the king to the edge.',
      learn: { lesson: 'l2' }, practise: { lesson: 'l4' }, prove: { challenge: 'kq' } },
    { id: 'c5', title: 'Pins', blurb: 'Freeze a piece in front of something more valuable.',
      learn: learn(['A pinned piece cannot move without exposing something bigger behind it — often the king, so it cannot legally move at all.', 'Pile up on a pinned piece: it cannot run, so attack it again and again.'], ['Pieces lined up with the king or queen', 'Bishops and rooks behind them', 'Attacking a piece that cannot move']),
      practise: { theme: 'pin', lo: 700, hi: 1500, count: 6 }, prove: { theme: 'pin', lo: 1100, hi: 1800, count: 3 } },
    { id: 'c6', title: 'Back-rank mates', blurb: 'The king trapped behind its own pawns.',
      learn: learn(['A king that has castled and never moved its pawns has no escape square. A rook or queen landing on the back rank can be mate.', 'Check whether the back rank is guarded. If the only defender can be distracted, the mate works.'], ['Kings with no "luft" (escape square)', 'Rooks and queens on open files', 'The one piece guarding the back rank']),
      practise: { theme: 'backRankMate', lo: 600, hi: 1500, count: 6 }, prove: { theme: 'backRankMate', lo: 1100, hi: 1900, count: 3 } },
    { id: 'd2', title: 'Back-rank danger', blurb: 'Spot the back-rank mate coming at you, and stop it.', defend: true,
      learn: learn(['If your king sits behind unmoved pawns, one rook or queen on your back rank can be checkmate.', 'Fix it before it happens: make an escape square (a "luft") by pushing a pawn in front of your king, or keep a rook guarding the back rank.'], ['Your king with no escape square', 'Enemy rooks and queens on open files', 'The one piece guarding your back rank']),
      practise: { drill: 'threat', theme: ['backRankMate'], count: 5 }, prove: { drill: 'blunder', theme: ['backRankMate'], count: 3 } },
    { id: 'c7', title: 'Rook mates', blurb: 'Mate with one rook, and the two-rook ladder.',
      learn: { lesson: 'l5' }, practise: { lesson: 'l3' }, prove: { challenge: 'kr' } },
    { id: 'c8', title: 'Mate in two', blurb: 'A forcing first move, then mate.',
      learn: learn(['Most mates in two start with a check or a capture that leaves the king no choice.', 'Try every check first, even ones that give up material. Then ask what the king can do, and whether you have mate after each reply.'], ['Checks, then captures, then threats', 'Squares the king can still reach', 'Sacrifices that open the king']),
      practise: { theme: 'mateIn2', lo: 800, hi: 1500, count: 6 }, prove: { theme: 'mateIn2', lo: 1300, hi: 2000, count: 3 } },
    { id: 'd4', title: 'Escaping mate threats', blurb: 'When your king is in danger, find the defence.', defend: true,
      learn: learn(['A mate threat comes before the mate. When your opponent piles pieces toward your king, ask: if it were their move, could they checkmate me?', 'Defend with the most forcing answer: take the attacker, block the line, give your king a square, or check back.'], ['Enemy pieces near your king', 'Squares your king can escape to', 'Checks they could give next move']),
      practise: { drill: 'threat', theme: ['mateIn1', 'mateIn2', 'backRankMate'], count: 5 }, prove: { theme: 'defensiveMove', lo: 800, hi: 1600, count: 3 } },
    { id: 'c9', title: 'Skewers', blurb: 'Attack a big piece so it moves and exposes the one behind.',
      learn: learn(['A skewer is a pin in reverse: the valuable piece is in front. When it moves away, you take what was behind it.', 'Look for the king or queen on the same line as another piece, with your bishop, rook or queen able to reach that line.'], ['King and queen on one line', 'Checks along a file, rank or diagonal', 'Long-range pieces']),
      practise: { theme: 'skewer', lo: 800, hi: 1600, count: 6 }, prove: { theme: 'skewer', lo: 1200, hi: 1900, count: 3 } },
    { id: 'd3', title: 'Forks and pins coming', blurb: 'See a fork or pin before it lands on you.', defend: true,
      learn: learn(['A fork needs a square that touches two of your pieces. A pin needs your pieces lined up with your king or queen.', 'Look for enemy knight jumps that land next to two of your pieces, and for your king and queen standing on the same line as an enemy bishop, rook or queen. Move one of them first.'], ['Your pieces a knight\'s jump from one square', 'Your king and queen on one line', 'Checks that also attack something']),
      practise: { drill: 'threat', theme: ['fork', 'pin', 'skewer'], count: 5 }, prove: { drill: 'blunder', theme: ['fork', 'pin'], count: 4 } },
    { id: 'c10', title: 'Discovered attacks', blurb: 'Move one piece to unleash another behind it.',
      learn: learn(['When a piece steps out of the way, the piece behind it suddenly attacks. If the moving piece also threatens something, the opponent faces two threats at once.', 'A discovered check is the strongest version: the moving piece can go almost anywhere, even grab material.'], ['Your pieces lined up behind each other', 'Lines toward the enemy king or queen', 'Where the front piece can go with a threat']),
      practise: { theme: 'discoveredAttack', lo: 900, hi: 1600, count: 6 }, prove: { theme: 'discoveredAttack', lo: 1300, hi: 2000, count: 3 } },
    { id: 'c11', title: 'King and pawn basics', blurb: 'The opposition and the square rule.',
      learn: { lesson: 'f3' }, practise: { lesson: 'f4' }, prove: { challenge: 'promo' } },
    { id: 'c12', title: 'Winning pawn endings', blurb: 'Key squares and turning a pawn into a queen.',
      learn: { lesson: 'f5' }, practise: { lesson: 'l8' }, prove: { challenge: 'pawns' } },
    { id: 'c13', title: 'Deflection and sacrifice', blurb: 'Lure a defender away; give material to break through.',
      learn: learn(['Every defender has a job. If you attack it, or offer it something juicy, it may have to leave that job.', 'A sacrifice is worth it when what you get back — mate, a bigger piece, a queen — is more than you gave.'], ['Pieces doing two jobs', 'What each defender is guarding', 'Forcing moves after a sacrifice']),
      practise: { theme: 'deflection', lo: 900, hi: 1700, count: 6 }, prove: { theme: 'sacrifice', lo: 1300, hi: 2000, count: 3 } },
    { id: 'c14', title: 'Defending', blurb: 'Hold the position when you are the one under pressure.',
      learn: { lesson: 'p2' }, practise: { theme: 'defensiveMove', lo: 900, hi: 1700, count: 6 }, prove: { challenge: 'hold' } },
    { id: 'c15', title: 'Longer mates', blurb: 'Mate in three and beyond: keep forcing.',
      learn: learn(['Long mates are a chain of forcing moves. Every move should be a check or a threat the opponent must answer.', 'Picture the final mating net first, then work backwards: which checks drive the king there?'], ['Checks that take away squares', 'Where the king ends up', 'Quiet moves that threaten unstoppable mate']),
      practise: { theme: 'mateIn3', lo: 1100, hi: 1900, count: 6 }, prove: { theme: 'mateIn3', lo: 1500, hi: 2200, count: 3 } },
    { id: 'c16', title: 'Two bishops and B + N', blurb: 'The hardest basic mates.',
      learn: { lesson: 'l6' }, practise: { lesson: 'l7' }, prove: { challenge: 'kbb' } },
  ];
  const pathState = (ch) => P.path[ch.id] || (P.path[ch.id] = { learn: false, practise: 0, prove: false, streak: 0 });
  const lessonById = (id) => LESSONS.find((l) => l.id === id);
  const challengeById = (id) => CHALLENGES.find((c) => c.id === id);
  function stepDone(ch, step) {
    const st = pathState(ch), s = ch[step];
    if (s.lesson) return !!P.lessons[s.lesson]?.mastered;
    if (s.challenge) return (P.challenges[s.challenge]?.wins || 0) > 0;
    if (step === 'learn') return !!st.learn || (st.practise || 0) >= ch.practise.count;   /* practised it all: the idea has landed */
    if (step === 'practise') return (st.practise || 0) >= s.count;
    return !!st.prove;
  }
  const STEPS = ['learn', 'practise', 'prove'];
  const chapterDone = (ch) => STEPS.every((k) => stepDone(ch, k));
  const nextStep = (ch) => STEPS.find((k) => !stepDone(ch, k)) || null;
  const recommended = () => { try { const f = styleFocus(); if (f && f.ch) return f.ch; } catch { /* no profile yet */ } return CHAPTERS.find((ch) => !chapterDone(ch)) || null; };
  const fromGames = (ch) => { try { const f = styleFocus(); return !!(f && f.ch === ch); } catch { return false; } };
  function stepLabel(ch, step) {
    const s = ch[step];
    if (s.drill) return (s.drill === 'threat' ? 'Spot the threat: ' + s.count + ' positions' : 'Blunder check: ' + s.count + ' in a row');
    if (s.lesson) return 'Lesson: ' + (lessonById(s.lesson)?.title || 'Lesson');
    if (s.challenge) return 'Challenge: ' + (challengeById(s.challenge)?.title || 'Challenge');
    if (step === 'learn') return 'The idea';
    const name = NAME[s.theme] || s.theme;
    return step === 'practise' ? 'Solve ' + s.count + ' ' + name.toLowerCase() + ' puzzles' : 'Solve ' + s.count + ' in a row, no hints';
  }
  function stepSub(ch, step) {
    const s = ch[step], st = pathState(ch);
    if (stepDone(ch, step)) return 'Done';
    if (s.lesson) return P.lessons[s.lesson]?.stage ? 'In progress' : 'Concept, demo, guided, mastery';
    if (s.challenge) return (P.challenges[s.challenge]?.attempts ? 'Not won yet' : 'Win it once') + ' · against a defending computer';
    if (step === 'learn') return 'A short read: what to look for';
    if (s.drill) return step === 'practise' ? (st.practise || 0) + ' of ' + s.count + ' stopped without help' : (st.streak || 0) + ' of ' + s.count + ' in a row · no help';
    if (step === 'practise') return (st.practise || 0) + ' of ' + s.count + ' solved without a miss';
    return (st.streak || 0) + ' of ' + s.count + ' in a row · harder puzzles';
  }
  function pathPill() {
    const st = pathState(PATH.ch), s = PATH.ch[PATH.step];
    return PATH.step === 'practise' ? Math.min(st.practise || 0, s.count) + '/' + s.count : Math.min(st.streak || 0, s.count) + '/' + s.count + ' in a row';
  }
  /* after a path puzzle: count it, and offer the next step when this one is done */
  function pathPuzzleResult(clean, noHints, row) {
    if (PATH.daily) return dailyResult(row);
    if (PATH.review) {
      const ok = clean && noHints && !PZ.retry; if (!PZ.retry) reviewResult(PATH.item, ok);
      row.replaceChildren(btn('Next card', 'primary', reviewNext, 'next'));
      return el('div', 'tr-say ' + (ok ? 'good' : ''), ok ? reviewNote(PATH.item) : 'Not clean yet — it comes back tomorrow.');
    }
    const ch = PATH.ch, st = pathState(ch), s = ch[PATH.step];
    if (PZ.retry) return el('div', 'tr-say', 'Retries are for practice and don’t change your chapter progress.');
    let done = false;
    if (PATH.step === 'practise') { if (clean) st.practise = (st.practise || 0) + 1; done = st.practise >= s.count; }
    else { if (clean && noHints) st.streak = (st.streak || 0) + 1; else st.streak = 0; if (st.streak >= s.count) { st.prove = true; done = true; } }
    save();
    const note = el('div', 'tr-say ' + (done ? 'good' : ''), done ? (PATH.step === 'practise' ? 'Practice complete! ' : 'Proven! ') + (chapterDone(ch) ? 'Chapter finished.' : 'Next step is open.')
      : PATH.step === 'practise' ? (clean ? 'Counts toward the chapter: ' : 'Solve it without a miss to count it: ') + Math.min(st.practise || 0, s.count) + '/' + s.count
      : (clean && noHints ? 'In a row: ' : 'Streak reset — no misses or hints here: ') + (st.streak || 0) + '/' + s.count);
    if (done) { row.replaceChildren(btn(chapterDone(ch) ? 'Back to the path' : 'Back to chapter', 'primary', chapterDone(ch) ? openPath : () => openChapter(ch), 'next'), btn('One more', 'quiet', () => void startPuzzle(), 'retry')); }
    return note;
  }
  /* ---- daily puzzle: one a day from the chapter you're on, with a streak ---- */
  const dayKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return dayKey(d); };
  function dailyState() {
    const D = P.daily || (P.daily = { day: '', done: false, streak: 0, best: 0, last: '' });
    const today = dayKey();
    if (D.day !== today) { D.day = today; D.done = false; }
    if (D.last && D.last !== today && D.last !== yesterday()) D.streak = 0;   /* missed a day: the flame goes out */
    return D;
  }
  function dailyTheme() {
    const rec = recommended() || CHAPTERS[CHAPTERS.length - 1];
    const s = rec.practise.theme && !rec.practise.drill ? rec.practise : rec.prove.theme && !rec.prove.drill ? rec.prove : rec.practise.drill ? { theme: [].concat(rec.practise.theme)[0], lo: 600, hi: 1400 } : null;
    return s ? { theme: s.theme, lo: s.lo, hi: s.hi, label: rec.title } : { theme: 'mateIn2', lo: 900, hi: 1600, label: rec.title };
  }
  function dailyCard() {
    const D = dailyState(), t = dailyTheme();
    const c = btn('', 'tr-daily' + (D.done ? ' done' : ''), () => (D.done ? null : startDaily()));
    c.innerHTML = '<span class="tr-daily-flame"></span><span class="tr-card-text"><b></b><span></span></span><span class="tr-daily-go"></span>';
    c.querySelector('.tr-daily-flame').textContent = D.streak ? '🔥' : '✦';
    c.querySelector('b').textContent = D.done ? 'Daily puzzle done' : 'Daily puzzle';
    c.querySelector('.tr-card-text span').textContent = D.done ? (D.streak > 1 ? D.streak + ' days in a row — back tomorrow' : 'Back tomorrow to start a streak')
      : (D.streak ? D.streak + '-day streak · keep it alive' : 'One puzzle a day') + ' · ' + t.label;
    c.querySelector('.tr-daily-go').textContent = D.done ? '✓' : 'Play';
    return c;
  }
  function startDaily() {
    const t = dailyTheme(), up = Math.max(0, Math.min(400, Math.round(P.puzzle.rating) - 1300));
    RETURN = withLabel(() => openHub(), 'Training');
    PATH = { daily: true, theme: t.theme, lo: t.lo, hi: t.hi, step: 'daily' };
    hub.hidden = true; screen = 'puzzle'; void startPuzzle();
  }
  function dailyResult(row) {
    const D = dailyState(), today = dayKey();
    if (!D.done) { D.streak = D.last === yesterday() ? (D.streak || 0) + 1 : 1; D.best = Math.max(D.best || 0, D.streak); D.last = today; D.done = true; save(); }
    row.replaceChildren(btn('Back to Training', 'primary', () => openHub(), 'next'), btn('Keep going', 'quiet', () => { PATH = null; RETURN = null; void startPuzzle(); }, 'retry'));
    return el('div', 'tr-say good', '🔥 ' + D.streak + (D.streak === 1 ? ' day' : ' days') + ' in a row' + (D.streak > 1 && D.streak === D.best ? ' — your best yet!' : '') + ' See you tomorrow.');
  }
  function pathCard() {
    const rec = recommended(), done = CHAPTERS.filter(chapterDone).length;
    const c = btn('', 'tr-path-card', () => openPath());
    c.innerHTML = '<span class="tr-path-top"><span>Your path</span><em></em></span><b></b><span class="tr-path-sub"></span><span class="tr-path-bar"><i></i></span>';
    c.querySelector('em').textContent = done + ' of ' + CHAPTERS.length + ' chapters';
    c.querySelector('b').textContent = rec ? 'Next: ' + rec.title : 'Every chapter finished';
    c.querySelector('.tr-path-sub').textContent = rec ? stepLabel(rec, nextStep(rec)) : 'Keep sharp with puzzles and challenges below.';
    c.querySelector('.tr-path-bar i').style.width = Math.round(done / CHAPTERS.length * 100) + '%';
    return c;
  }
  function openPath() {
    session++; screen = 'path'; PATH = null; RETURN = null; top.hidden = true; panel.hidden = true; B().onMove(null); mark({});
    hub.classList.remove('tr-sg-page', 'tr-ed-page'); hub.replaceChildren();
    const rec = recommended();
    hub.append(subHead('Your path', openHub), el('p', 'tr-note', 'Each chapter: learn the idea, practise it, then prove it. Everything is open — the green one is recommended next' + (rec && fromGames(rec) ? ', picked from what keeps costing you in your games.' : '.') + ' Chapters marked 🛡 train defence: seeing what your opponent is planning.'));
    const list = el('div', 'tr-path-list');
    CHAPTERS.forEach((ch, i) => {
      const b = btn('', 'tr-chap' + (chapterDone(ch) ? ' done' : '') + (ch === rec ? ' next' : ''), () => openChapter(ch));
      b.innerHTML = '<span class="tr-chap-num"></span><span class="tr-card-text"><b></b><span></span></span><span class="tr-dots"><i></i><i></i><i></i></span>';
      b.querySelector('.tr-chap-num').textContent = chapterDone(ch) ? '✓' : String(i + 1);
      b.querySelector('b').textContent = (ch.defend ? '🛡 ' : '') + ch.title;
      b.querySelector('.tr-card-text span').textContent = ch === rec ? (fromGames(ch) ? 'Recommended from your games · ' : 'Recommended next · ') + ch.blurb : ch.blurb;
      b.querySelectorAll('.tr-dots i').forEach((d, k) => d.classList.toggle('on', stepDone(ch, STEPS[k])));
      list.append(b);
    });
    hub.append(list); hub.hidden = false;
    hub.querySelector('.tr-chap.next')?.scrollIntoView({ block: 'center' });
  }
  function openChapter(ch) {
    session++; screen = 'chapter'; PATH = null; RETURN = () => openChapter(ch); top.hidden = true; panel.hidden = true; B().onMove(null); mark({});
    hub.classList.remove('tr-sg-page', 'tr-ed-page'); hub.replaceChildren();
    const i = CHAPTERS.indexOf(ch), nx = nextStep(ch);
    hub.append(subHead(ch.title, openPath, 'Path'), el('p', 'tr-note', 'Chapter ' + (i + 1) + ' · ' + ch.blurb));
    const list = el('div', 'tr-steps');
    STEPS.forEach((k, j) => {
      const b = btn('', 'tr-step' + (stepDone(ch, k) ? ' done' : '') + (k === nx ? ' next' : ''), () => runStep(ch, k));
      b.innerHTML = '<span class="tr-step-num"></span><span class="tr-card-text"><small></small><b></b><span></span></span><span class="tr-chev" aria-hidden="true">›</span>';
      b.querySelector('.tr-step-num').textContent = stepDone(ch, k) ? '✓' : String(j + 1);
      b.querySelector('small').textContent = ['Learn', 'Practise', 'Prove it'][j];
      b.querySelector('b').textContent = stepLabel(ch, k);
      b.querySelector('.tr-card-text span').textContent = stepSub(ch, k);
      list.append(b);
    });
    hub.append(list);
    if (!nx) hub.append(el('div', 'tr-chap-done', '★ Chapter complete'));
    const row = el('div', 'tr-actions tr-chap-actions');
    if (nx) row.append(btn('Start: ' + ['Learn', 'Practise', 'Prove it'][STEPS.indexOf(nx)], 'primary', () => runStep(ch, nx), 'play'));
    else { const nc = recommended(); row.append(btn(nc ? 'Next chapter: ' + nc.title : 'Back to the path', 'primary', () => (nc ? openChapter(nc) : openPath()), 'next')); }
    hub.append(row); hub.hidden = false; hub.scrollTop = 0;
  }
  function runStep(ch, step) {
    const s = ch[step];
    RETURN = () => openChapter(ch);
    if (s.lesson) { const l = lessonById(s.lesson); if (l) { PATH = null; return startLesson(l); } }
    if (s.challenge) { const c = challengeById(s.challenge); if (c) { PATH = null; return void startChallenge(c, P.settings.mode === 'guided' ? 'practice' : undefined); } }
    if (step === 'learn') return openLearn(ch);
    if (step === 'prove') pathState(ch).streak = 0;
    if (s.drill) { PATH = { ch, step, drill: s.drill, theme: s.theme, count: s.count }; hub.hidden = true; return void (s.drill === 'threat' ? startThreat() : startBlunder()); }
    PATH = { ch, step, theme: s.theme, lo: s.lo, hi: s.hi, count: s.count };
    hub.hidden = true; screen = 'puzzle'; void startPuzzle();
  }
  function openLearn(ch) {
    session++; screen = 'learn'; top.hidden = true; panel.hidden = true; B().onMove(null);
    hub.classList.remove('tr-sg-page', 'tr-ed-page'); hub.replaceChildren();
    hub.append(subHead('The idea', () => openChapter(ch), ch.title));
    const card = el('div', 'tr-learn');
    card.append(el('h3', '', ch.title));
    for (const t of ch.learn.text) card.append(el('p', '', t));
    if (ch.learn.look) { card.append(el('span', 'tr-label', 'Look for')); const ul = el('ul'); for (const t of ch.learn.look) ul.append(el('li', '', t)); card.append(ul); }
    hub.append(card);
    const row = el('div', 'tr-actions tr-chap-actions');
    row.append(btn('Got it — practise', 'primary', () => { pathState(ch).learn = true; save(); runStep(ch, 'practise'); }, 'play'));
    hub.append(row); hub.hidden = false; hub.scrollTop = 0;
  }

  /* ================================================================== sharpen: review, drills, speed, style */
  const mvOf = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
  const secs = (ms) => (ms / 1000).toFixed(1) + ' s';
  const backHead = (title, fn, label) => subHead(title, fn, label);
  const withLabel = (fn, label) => { fn.label = label; return fn; };
  function choice(label, cls, fn) { const b = btn(label, 'tr-choice ' + (cls || ''), fn); return b; }

  /* ---------------- mistakes come back: 1 day, then 3, then 7; right three times = learned ---------------- */
  const GAPS = [1, 3, 7];
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dayKey(d); };
  const packP = (p) => ({ id: p.id, fen: p.fen, moves: Array.isArray(p.moves) ? p.moves.join(' ') : p.moves, rating: p.rating, themes: p.themes, ...(p.cand ? { cand: p.cand, unsafe: !!p.unsafe } : {}) });
  const unpackP = (d) => ({ ...d, moves: String(d.moves).split(' ') });
  function reviewAdd(kind, data, id) {
    const R = P.review || (P.review = []);
    const key = kind + ':' + (id || data.id);
    const ex = R.find((x) => x.key === key);
    if (ex) { ex.box = 0; ex.due = addDays(1); ex.miss = (ex.miss || 0) + 1; }
    else R.push({ key, kind, data: kind === 'game' ? data : packP(data), box: 0, due: addDays(1), miss: 1, at: Date.now() });
    if (R.length > 160) R.splice(0, R.length - 160);
    save();
  }
  const reviewDue = () => { const t = dayKey(); return (P.review || []).filter((x) => x.due <= t); };
  function reviewResult(item, ok) {
    if (!item || item.seen === dayKey() + (RV ? RV.id : '')) return;
    item.seen = dayKey() + (RV ? RV.id : '');
    if (ok) { item.box = (item.box || 0) + 1; if (item.box >= GAPS.length) { P.review = (P.review || []).filter((x) => x !== item); P.learned = (P.learned || 0) + 1; item.learned = true; } else item.due = addDays(GAPS[item.box]); }
    else { item.box = 0; item.due = addDays(1); item.miss = (item.miss || 0) + 1; }
    if (RV) { if (ok) RV.ok++; else RV.miss++; }
    save();
  }
  const reviewNote = (item) => (item.learned ? 'Learned — this one won\'t come back.' : 'Got it. Back in ' + GAPS[item.box] + (GAPS[item.box] === 1 ? ' day' : ' days') + ' to make sure.');
  let RV = null;
  function openReview() {
    session++; screen = 'review'; PATH = null; RETURN = null; RV = null; top.hidden = true; panel.hidden = true; B().onMove(null); B().onTap(null); mark({});
    hub.classList.remove('tr-sg-page', 'tr-ed-page'); hub.replaceChildren();
    const due = reviewDue(), all = P.review || [], soon = all.filter((x) => x.due === addDays(1)).length;
    hub.append(backHead('Review', openHub), el('p', 'tr-note', 'Everything you miss comes back: the next day, then after 3 days, then after a week. Get it right three times and it is learned.'));
    const mini = el('div', 'tr-mini');
    const m = (v, l) => { const d = el('div'); d.append(el('b', '', String(v)), el('span', '', l)); mini.append(d); };
    m(due.length, 'Due now'); m(soon, 'Tomorrow'); m(all.length, 'In the deck'); m(P.learned || 0, 'Learned');
    hub.append(mini);
    const kinds = { puzzle: 'Puzzles', threat: 'Spot the threat', blunder: 'Blunder checks', game: 'From your games' };
    const list = el('div', 'tr-list');
    for (const [k, label] of Object.entries(kinds)) {
      const n = due.filter((x) => x.kind === k).length, tot = all.filter((x) => x.kind === k).length;
      if (!tot) continue;
      const r = el('div', 'tr-item static'); r.innerHTML = '<span class="tr-card-text"><b></b><span></span></span><span class="tr-badge"></span>';
      r.querySelector('b').textContent = label; r.querySelector('.tr-card-text span').textContent = tot + ' in the deck'; r.querySelector('.tr-badge').textContent = n ? n + ' due' : '';
      list.append(r);
    }
    if (list.childNodes.length) hub.append(list);
    else hub.append(el('div', 'tr-empty', 'Nothing here yet. Puzzles, drills and game moves you miss will land here automatically.'));
    const row = el('div', 'tr-actions tr-chap-actions');
    const go = btn(due.length ? 'Start review · ' + Math.min(due.length, 15) : 'Nothing due today', 'primary', () => startReview(), 'play'); go.disabled = !due.length;
    row.append(go); hub.append(row); hub.hidden = false; hub.scrollTop = 0;
  }
  function startReview() {
    const due = reviewDue().sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : (b.miss || 0) - (a.miss || 0))).slice(0, 15);
    if (!due.length) return openReview();
    RV = { id: Date.now().toString(36), items: due, i: -1, ok: 0, miss: 0 };
    reviewNext();
  }
  function reviewNext() {
    if (!RV) return openReview();
    RV.i++; B().onTap(null); B().onMove(null); mark({});
    if (RV.i >= RV.items.length) return reviewDone();
    const item = RV.items[RV.i];
    RETURN = withLabel(() => openReview(), 'Review'); hub.hidden = true;
    if (item.kind === 'puzzle') { PATH = { review: true, item }; screen = 'puzzle'; return void startPuzzle(); }
    PATH = null;
    if (item.kind === 'threat') return void startThreat({ review: item });
    if (item.kind === 'blunder') return void startBlunder({ review: item });
    return void startGameCard(item);
  }
  function reviewDone() {
    const r = RV; RV = null; PATH = null; RETURN = null; B().busy(true);
    setTop('Review', el('span', 'tr-chip dim', 'Done'));
    const msg = lessonPanel('Review done', [btn('Back to Training', 'primary', openHub, 'next'), btn('Review page', 'quiet', openReview)]);
    say(msg, r.ok + ' right, ' + r.miss + ' to see again.' + (reviewDue().length ? ' ' + reviewDue().length + ' more are due.' : ' Come back tomorrow for the next ones.'), r.miss ? '' : 'good');
  }

  /* ---------------- a position from your own game: find the move you missed ---------------- */
  async function startGameCard(item) {
    const my = ++session; screen = 'drill';
    const d = item.data, C = B().Chess; let c0; try { c0 = new C(d.fen); } catch { reviewResult(item, true); return reviewNext(); }
    const side = c0.turn(), playedSan = sanOf(d.fen, d.played);
    setTop('From your game', el('span', 'tr-chip dim', (RV ? RV.i + 1 : 1) + '/' + (RV ? RV.items.length : 1)));
    B().setup({ fen: d.fen, side, opponent: 'Your game' }); B().busy(false); mark({});
    let misses = 0, hints = 0;
    const msg = lessonPanel('Move ' + Math.ceil(d.ply / 2) + ' of your game', [
      btn('Hint', 'hint', () => { hints++; mark(hints === 1 ? { lift: d.best.slice(0, 2) } : { lift: d.best.slice(0, 2), arrows: [[d.best.slice(0, 2), d.best.slice(2, 4)]] }); say(msg, hints === 1 ? 'Hint: move the highlighted piece.' : 'Hint: play the move the arrow shows.'); }, 'hint'),
      btn('Next card', 'quiet', () => { reviewResult(item, false); reviewNext(); }, 'skip')],
      'In the game you played ' + playedSan + '. There was something much better. Find it.');
    B().onMove(async (uci) => {
      if (my !== session) return;
      B().busy(true); say(msg, 'Checking…');
      let ok = uci === d.best;
      if (!ok) { const a = await engine(d.fen, 5, 900, uci); if (my !== session) return; ok = !!(a && a.playedScore != null && a.bestScore != null && a.playedScore >= a.bestScore - 40); }
      if (ok) {
        const clean = !misses && !hints; reviewResult(item, clean);
        say(msg, (uci === d.best ? 'Yes — ' + sanOf(d.fen, d.best) + '.' : 'That works too (' + sanOf(d.fen, d.best) + ' was the engine\'s choice).') + ' ' + (clean ? reviewNote(item) : 'It comes back tomorrow.'), 'good');
        mark({}); panel.querySelector('.tr-actions')?.replaceChildren(btn('Next card', 'primary', reviewNext, 'next'));
        return;
      }
      misses++;
      say(msg, uci === d.played ? 'That is what you played in the game. Look again — something stronger is there.' : 'Not it. Look at checks, captures and threats first.', 'bad');
      await sleep(1500); if (my !== session) return; B().takeBack(1); B().busy(false);
    });
  }

  /* ---------------- spot the threat: the opponent has a tactic ready; see it, then stop it ---------------- */
  const THREAT_THEMES = ['hangingPiece', 'fork', 'pin', 'skewer', 'mateIn1', 'mateIn2', 'backRankMate', 'discoveredAttack', 'trappedPiece'];
  const drillBand = () => { const r = Math.round(P.puzzle.rating); return { lo: Math.max(400, r - 450), hi: Math.max(900, r - 50) }; };
  function threatIdea(themes) {
    const t = themes || [];
    if (t.some((x) => /mate/i.test(x))) return 'checkmate.';
    if (t.includes('fork')) return 'a fork — one piece hitting two of yours.';
    if (t.includes('pin')) return 'a pin — your piece can’t move without losing what is behind it.';
    if (t.includes('skewer')) return 'a skewer — your big piece moves and the one behind it falls.';
    if (t.includes('discoveredAttack')) return 'a discovered attack — one piece moves and uncovers another.';
    if (t.includes('trappedPiece')) return 'a trapped piece — it has no safe square.';
    if (t.includes('hangingPiece')) return 'a free capture — that piece is not protected.';
    if (t.includes('promotion') || t.includes('advancedPawn')) return 'a pawn about to queen.';
    return 'it wins material.';
  }
  /* name the tactic from what the move really does on the board; puzzle tags describe the whole line, not move one */
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  const PNAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  /* line (optional): the puzzle's solution from this move on. A skewer, pin or fork is only named when the
     solution really goes on to win the piece it names; otherwise the move is described as what it is. */
  function moveIdea(fen, uci, themes, line = null) {
    const C = B()?.Chess; let c, mv;
    try { c = new C(fen); mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }); } catch { return threatIdea(themes); }
    if (!mv) return threatIdea(themes);
    const me = mv.color, you = me === 'w' ? 'b' : 'w', at = mv.to;
    const xy = (q) => ['abcdefgh'.indexOf(q[0]), +q[1] - 1], sq = (x, y) => (x >= 0 && x < 8 && y >= 0 && y < 8 ? 'abcdefgh'[x] + (y + 1) : null);
    const guarded = (q, by) => { try { return c.attackers(q, by).length > 0; } catch { return false; } };
    if (c.isCheckmate()) return 'checkmate.';
    const check = c.inCheck();
    const mate = (themes || []).some((x) => /mate/i.test(x)), gain = (themes || []).includes('equality') ? '.' : ', which wins material.';
    /* safe = nothing of theirs can take the attacker profitably (a cheaper piece, or any piece when it's undefended) */
    let takers = []; try { takers = c.attackers(at, you).map((q) => c.get(q).type); } catch { /* old chess.js */ }
    const safe = !takers.length || (guarded(at, me) && takers.every((t) => VAL[t] >= VAL[mv.piece]));
    /* a skewering check only works if the king must step aside: no capture of the checker, no block */
    const kingMustMove = check && c.moves({ verbose: true }).every((m) => m.piece === 'k');
    const others = (q, skip) => { try { return c.attackers(q, you).filter((a) => a !== skip).length; } catch { return 0; } };
    /* does the solution win one of these pieces? follow them if they move, look for our capture on their square */
    const wins = (targets) => {
      if (!line) return true;
      const d = new C(fen), pos = new Set(targets.filter((q) => c.get(q)?.type !== 'k'));
      if (!pos.size) return false;
      for (let i = 0; i < line.length; i++) {
        let x; try { x = d.move({ from: line[i].slice(0, 2), to: line[i].slice(2, 4), promotion: line[i][4] || undefined }); } catch { return false; }
        if (!x) return false;
        if (i % 2) { if (pos.has(x.from)) { pos.delete(x.from); pos.add(x.to); } }
        else if (i && x.captured && pos.has(x.to)) return true;
      }
      return false;
    };
    /* rays from the moved slider: the first and second pieces it meets */
    const dirs = { r: [[1,0],[-1,0],[0,1],[0,-1]], b: [[1,1],[1,-1],[-1,1],[-1,-1]] }; dirs.q = dirs.r.concat(dirs.b);
    const [x0, y0] = xy(at);
    for (const [dx, dy] of dirs[mv.piece] || []) {
      let x = x0 + dx, y = y0 + dy, first = null;
      for (; sq(x, y); x += dx, y += dy) {
        const pc = c.get(sq(x, y)); if (!pc) continue;
        if (!first) { if (pc.color !== you) break; first = { q: sq(x, y), pc }; continue; }
        if (pc.color !== you) break;
        const front = first.pc, back = pc, bq = sq(x, y);
        if (check && front.type !== 'k') break;   /* a check is the point: don't name a side line on another ray */
        if (!safe || (front.type === 'k' && !kingMustMove)) break;
        /* the piece behind must be winnable: worth more than the attacker, or not defended by anything but the front piece */
        if ((front.type === 'k' || VAL[front.type] > VAL[back.type]) && VAL[back.type] >= 3 && (VAL[back.type] > VAL[mv.piece] || !others(bq, first.q)) && wins([bq]))
          return 'a skewer — your ' + PNAME[front.type] + ' on ' + first.q + ' is attacked, and when it moves your ' + PNAME[back.type] + ' on ' + bq + ' behind it falls.';
        if (front.type !== 'p' && (back.type === 'k' || VAL[back.type] > VAL[front.type] + 1) && wins([first.q, bq]))
          return 'a pin — your ' + PNAME[front.type] + ' on ' + first.q + ' is pinned to your ' + PNAME[back.type] + ' on ' + bq + ': if it steps off that line, the ' + PNAME[back.type] + ' is exposed.';
        break;
      }
    }
    /* fork: the moved piece hits two targets worth having */
    const hits = [];
    for (const row of c.board()) for (const pc of row) {
      if (!pc || pc.color !== you) continue;
      let by = []; try { by = c.attackers(pc.square, me); } catch { /* old chess.js */ }
      if (!by.includes(at)) continue;
      if (pc.type === 'k' || (pc.type !== 'p' && (VAL[pc.type] > VAL[mv.piece] || !guarded(pc.square, you)))) hits.push(pc);
    }
    const won = safe && hits.length >= 2 ? hits.find((h) => h.type !== 'k' && wins([h.square])) : null;
    if (won) {   /* name the piece the solution really wins, with the king (or another target) */
      const pair = [hits.find((h) => h.type === 'k') || hits.find((h) => h !== won), won];
      return 'a fork — the ' + PNAME[mv.piece] + ' on ' + at + ' hits your ' + pair.map((h) => PNAME[h.type] + ' on ' + h.square).join(' and ') + '.';
    }
    const answer = kingMustMove ? 'your king has to move' : 'you have to answer the check';
    if (mv.captured) {
      const what = 'your ' + PNAME[mv.captured] + ' on ' + at;
      if (check) return 'it takes ' + what + ' with check — ' + answer + ', and the attack goes on.';
      return !guarded(at, you) ? 'a free capture — ' + what + ' isn’t protected.' : 'it takes ' + what + '.';
    }
    if (mv.promotion) return 'the pawn queens.';
    if (check) return 'a check — ' + answer + (mate ? ', and the attack ends in checkmate.' : ', and that sets up the next blow' + gain);
    return mate ? 'it starts an attack that ends in checkmate.' : gain === '.' ? 'it starts a forcing line you have to answer exactly.' : 'it starts an attack that wins material.';
  }
  async function threatPosition(theme, given) {
    const C = B().Chess;
    for (let t = 0; t < (given ? 1 : 6); t++) {
      const p = given || await nextPuzzle({ theme: theme || THREAT_THEMES, ...drillBand() });
      if (!p) return null;
      try {
        const c = new C(p.fen); c.move(mvOf(p.moves[0]));
        if (c.inCheck()) continue;   /* the attacker is in check: the move can't be handed over */
        const attacker = c.turn(), parts = c.fen().split(' '); parts[1] = other(attacker); parts[3] = '-';
        const fen = parts.join(' '); const x = new C(fen); if (x.isGameOver()) continue;
        if (!given) { const e = await engine(fen, 5, 700, '0000'); if (e && Number.isFinite(e.bestScore) && e.bestScore < -350 && t < 5) continue; }   /* nothing saves you: not a fair drill */
        return { p, fen, threat: p.moves[1], attacker, defender: other(attacker), before: c.fen(), last: p.moves[0] };
      } catch { /* odd puzzle: try another */ }
    }
    return null;
  }
  let TD = null;
  const drillTop = (title, stat) => setTop(title, el('span', 'tr-chip dim', RV ? (RV.i + 1) + '/' + RV.items.length : PATH && PATH.drill ? pathPill() : '🔥 ' + (stat.streak || 0)));
  async function startThreat(opts = {}) {
    const my = ++session; screen = 'drill'; hub.hidden = true;
    const ST = P.drills.threat || (P.drills.threat = { a: 0, s: 0, streak: 0, best: 0 });
    drillTop('Spot the threat', ST);
    panel.hidden = false; panel.replaceChildren(el('div', 'tr-say', 'Setting up a position…'));
    B().onTap(null); B().onMove(null); mark({});
    const pos = await threatPosition(PATH && PATH.drill === 'threat' ? PATH.theme : null, opts.review ? unpackP(opts.review.data) : null);
    if (my !== session) return;
    if (!pos) {
      if (opts.review) { reviewResult(opts.review, true); return reviewNext(); }
      const msg = lessonPanel('Couldn’t load a position', [btn('Try again', 'primary', () => startThreat(opts)), btn('Back', 'quiet', () => (RETURN ? RETURN() : openHub()))]); say(msg, 'Check your connection and try again.', 'bad'); return;
    }
    TD = { ...pos, review: opts.review || null, taps: 0, misses: 0, hints: 0, stage: 'spot', my, tries: 0 };
    B().setup({ fen: pos.fen, side: pos.defender, opponent: 'Opponent' }); B().busy(true);
    const lastSan = sanOf(pos.p.fen, pos.last);
    const grey = [[pos.last.slice(0, 2), pos.last.slice(2, 4), 'rgba(170,170,180,.6)']];
    mark({ arrows: grey, legend: [['arrow grey', 'Grey arrow: your last move']] });
    TD.msg = lessonPanel('You are ' + (pos.defender === 'w' ? 'White' : 'Black') + ' · what’s the threat?', [
      btn('Hint', 'hint', () => threatHint(), 'hint'), btn('Show me', 'quiet', () => { TD.misses++; threatReveal('Here it is.'); }, 'eye'),
      btn(opts.review ? 'Next card' : 'Skip', 'quiet', () => { if (opts.review) { reviewResult(opts.review, false); return reviewNext(); } if (PATH && PATH.drill && PATH.step === 'prove') { pathState(PATH.ch).streak = 0; save(); } startThreat(); }, 'skip')],
      'Your last move was ' + lastSan + ' (grey arrow). Now your opponent has a strong threat. Tap the enemy piece that would strike.');
    B().onTap((sq) => threatTap(sq, my));
  }
  function threatHint() {
    if (!TD) return; TD.hints++;
    if (TD.stage === 'spot') {
      if (TD.hints === 1) say(TD.msg, 'Hint: for each enemy piece, ask what it could capture or check next move. Start with the piece that just moved.', 'idea');
      else { mark({ rings: [TD.threat.slice(0, 2)], legend: [['ring', 'Ring: the dangerous piece']] }); say(TD.msg, 'Hint: the ringed piece is the danger. Tap it.'); }
    } else void (async () => { const e = await engine(TD.fen, 5, 900); if (e && e.move && TD) { mark({ arrows: [[TD.threat.slice(0, 2), TD.threat.slice(2, 4), 'rgba(255,69,58,.85)'], [e.move.slice(0, 2), e.move.slice(2, 4), 'rgba(255,214,10,.85)']], lift: e.move.slice(0, 2), legend: [['arrow red', 'Red: the threat'], ['arrow', 'Yellow: a move that stops it']] }); say(TD.msg, 'Hint: ' + sanOf(TD.fen, e.move) + ' stops it.'); } })();
  }
  function threatTap(sq, my) {
    if (!TD || TD.stage !== 'spot' || my !== session) return;
    const from = TD.threat.slice(0, 2), to = TD.threat.slice(2, 4);
    if (sq === from) return threatReveal(TD.taps ? 'There it is.' : 'Yes — that piece.');
    if (sq === to) return threatReveal('Yes — that is the target. The danger comes from the piece behind the red arrow.');
    TD.taps++; if (TD.taps === 1) TD.misses++;
    const pc = B().chess().get(sq);
    say(TD.msg, !pc ? 'That square is empty. Tap a piece.' : pc.color === TD.defender ? 'That is one of your pieces. Which ENEMY piece is dangerous?' : 'Not that one. Look at what each enemy piece could take or check.', 'warn');
    if (TD.taps >= 3) threatReveal('Here it is.');
  }
  function threatReveal(prefix) {
    if (!TD || TD.stage !== 'spot') return;
    TD.stage = 'stop'; B().onTap(null);
    const from = TD.threat.slice(0, 2), to = TD.threat.slice(2, 4), san = sanOf(TD.before, TD.threat);
    TD.idea = moveIdea(TD.before, TD.threat, themesList(TD.p.themes).concat(TD.p.themes.split(' ')), TD.p.moves.slice(1));
    mark({ arrows: [[from, to, 'rgba(255,69,58,.9)']], rings: [to], legend: [['arrow red', 'Red arrow: the threat']] });
    say(TD.msg, prefix + ' The threat is ' + san + ' — ' + TD.idea + ' Now stop it: play a move that defends.', 'idea');
    B().busy(false); const my = TD.my; B().onMove((uci) => void threatDefend(uci, my));
  }
  async function threatDefend(uci, my) {
    if (!TD || my !== session) return;
    B().busy(true); say(TD.msg, 'Checking…');
    const a = await engine(TD.fen, 5, 1000, uci); if (my !== session || !TD) return;
    const ok = !!(a && a.playedScore != null && a.bestScore != null && (a.playedScore >= a.bestScore - 70 || a.move === uci));
    if (ok) return threatDone(!TD.misses && !TD.hints && !TD.tries, a.move !== uci && a.bestScore - a.playedScore > 25 ? sanOf(TD.fen, a.move) : null);
    TD.tries++;
    const e = await engine(B().fen(), 5, 700); if (my !== session || !TD) return;
    if (e && e.move) mark({ arrows: [[e.move.slice(0, 2), e.move.slice(2, 4), 'rgba(255,69,58,.9)']], legend: [['arrow red', 'Red arrow: how they punish it']] });
    say(TD.msg, 'That doesn’t stop it: ' + (e && e.move ? sanOf(B().fen(), e.move) + ' still wins.' : 'they still win material.') + ' Try again.', 'bad');
    await sleep(2000); if (my !== session || !TD) return;
    B().takeBack(1); mark({ arrows: [[TD.threat.slice(0, 2), TD.threat.slice(2, 4), 'rgba(255,69,58,.9)']], legend: [['arrow red', 'Red arrow: the threat']] }); B().busy(false);
    if (TD.tries >= 2) threatHint();
  }
  function threatDone(clean, better) {
    const t = TD; TD = null; B().onMove(null); B().busy(true);
    const ST = P.drills.threat;
    ST.a++; if (clean) { ST.s++; ST.streak++; ST.best = Math.max(ST.best, ST.streak); } else ST.streak = 0;
    if (!clean && !t.review) reviewAdd('threat', t.p);
    save();
    panel.replaceChildren();
    panel.append(el('div', 'tr-result ' + (clean ? 'good' : 'bad'), clean ? 'Threat stopped!' : 'Stopped — with help'));
    const meta = el('div', 'tr-meta'); meta.append(el('span', 'tr-pill', 'Streak ' + ST.streak), el('span', 'tr-pill', 'Best ' + ST.best)); panel.append(meta);
    panel.append(el('div', 'tr-say', 'The threat was ' + sanOf(t.before, t.threat) + ' — ' + t.idea + (better ? ' (' + better + ' was even stronger.)' : '') + (clean ? '' : ' It will come back for review.')));
    const row = el('div', 'tr-actions');
    let note = null;
    if (t.review) { reviewResult(t.review, clean); note = el('div', 'tr-say ' + (clean ? 'good' : ''), clean ? reviewNote(t.review) : 'Comes back tomorrow.'); row.append(btn('Next card', 'primary', reviewNext, 'next')); }
    else {
      row.append(btn('Next position', 'primary', () => startThreat(), 'next'));
      if (PATH && PATH.drill) note = pathDrillResult(clean, row);
      else row.append(btn('Training', 'quiet', openHub));
    }
    if (note) panel.append(note); panel.append(row); drillTop('Spot the threat', ST);
  }

  /* ---------------- blunder check: is the move you're about to play safe? ---------------- */
  /* Blunder check answers are checked offline by Stockfish 16.1 at depth 18 (tools/verify-blunder-check.py):
     bad = the puzzle's first move really loses 1.5+ pawns; safe = [the best move, their best reply]. */
  let blunderSet = null;
  async function blunderFacts(p) {
    if (!blunderSet) {
      try { const j = await (await fetch('chess-blunder-check.json?v=1')).json(); blunderSet = { safe: j.safe, lost: new Set(j.lost), notBad: new Set(j.notBad) }; }
      catch { return null; }   /* offline: the quick engine decides, as before */
    }
    const S = blunderSet;
    if (S.safe[p.id]) return { bad: true, safe: S.safe[p.id].split(' ') };
    if (S.lost.has(p.id)) return { bad: true, safe: null };
    if (S.notBad.has(p.id)) return { bad: false, safe: null };
    return null;
  }
  async function blunderPosition(theme, given) {
    const C = B().Chess;
    for (let t = 0; t < (given ? 1 : 10); t++) {
      const p = given || await nextPuzzle({ theme: theme || THREAT_THEMES, ...drillBand() });
      if (!p) return null;
      try {
        const c0 = new C(p.fen); if (c0.isGameOver()) continue;
        const v = await blunderFacts(p);
        if (given) {   /* old review cards were set up by the quick engine: re-check them against the verified answer */
          if (v && v.bad === false) return null;
          if (v && !p.unsafe) { if (!v.safe) return null; return { p, cand: v.safe[0], reply: v.safe[1] || null, unsafe: false, mover: c0.turn() }; }
          return { p, cand: p.cand, unsafe: !!p.unsafe, mover: c0.turn() };
        }
        if (v && v.bad === false) continue;   /* its first move isn't really a mistake */
        if (v) { const unsafe = !v.safe || Math.random() < 0.55; return { p, cand: unsafe ? p.moves[0] : v.safe[0], reply: unsafe ? null : v.safe[1] || null, unsafe, mover: c0.turn() }; }
        /* not checked offline: fall back to the quick in-browser engine */
        const unsafe = Math.random() < 0.55;
        const e = await engine(p.fen, 5, 800, p.moves[0]);
        if (!e || !e.move || e.playedScore == null || e.bestScore == null) continue;
        if (e.bestScore - e.playedScore < 150) continue;   /* the puzzle's first move must really be a mistake */
        if (!unsafe && (e.move === p.moves[0] || e.bestScore < -200)) continue;
        return { p, cand: unsafe ? p.moves[0] : e.move, unsafe, mover: c0.turn() };
      } catch { /* odd puzzle */ }
    }
    return null;
  }
  let BD = null;
  async function startBlunder(opts = {}) {
    const my = ++session; screen = 'drill'; hub.hidden = true;
    const ST = P.drills.blunder || (P.drills.blunder = { a: 0, s: 0, streak: 0, best: 0 });
    drillTop('Blunder check', ST);
    panel.hidden = false; panel.replaceChildren(el('div', 'tr-say', 'Setting up a position…'));
    B().onTap(null); B().onMove(null); mark({});
    const pos = await blunderPosition(PATH && PATH.drill === 'blunder' ? PATH.theme : null, opts.review ? unpackP(opts.review.data) : null);
    if (my !== session) return;
    if (!pos) {
      if (opts.review) { reviewResult(opts.review, true); return reviewNext(); }
      const msg = lessonPanel('Couldn’t load a position', [btn('Try again', 'primary', () => startBlunder(opts)), btn('Back', 'quiet', () => (RETURN ? RETURN() : openHub()))]); say(msg, 'Check your connection and try again.', 'bad'); return;
    }
    BD = { ...pos, review: opts.review || null, my, taps: 0 };
    B().setup({ fen: pos.p.fen, side: pos.mover, opponent: 'Opponent' }); B().busy(true);
    const f = pos.cand.slice(0, 2), t = pos.cand.slice(2, 4);
    mark({ arrows: [[f, t, 'rgba(255,214,10,.85)']], lift: f, legend: [['arrow', 'Yellow arrow: the move you’re thinking about']] });
    BD.msg = lessonPanel('Safe, or a blunder?', [choice('Safe ✓', 'safe', () => blunderAnswer(false)), choice('Blunder ✗', 'unsafe', () => blunderAnswer(true)),
      btn(opts.review ? 'Next card' : 'Skip', 'quiet', () => { if (opts.review) { reviewResult(opts.review, false); return reviewNext(); } if (PATH && PATH.drill && PATH.step === 'prove') { pathState(PATH.ch).streak = 0; save(); } startBlunder(); }, 'skip')],
      'You are ' + (pos.mover === 'w' ? 'White' : 'Black') + ' and thinking about ' + sanOf(pos.p.fen, pos.cand) + '. Before you play it: is it safe, or does it lose something?');
  }
  async function blunderAnswer(saidUnsafe) {
    if (!BD || BD.answered) return; BD.answered = true;
    const my = BD.my, right = saidUnsafe === BD.unsafe, p = BD.p, candSan = sanOf(p.fen, BD.cand);
    panel.querySelector('.tr-actions')?.replaceChildren();
    mark({}); B().play(BD.cand); await sleep(500); if (my !== session || !BD) return;
    if (BD.unsafe) {
      const pun = p.moves[1], punFen = B().fen(), punSan = sanOf(punFen, pun);
      BD.idea = moveIdea(punFen, pun, themesList(p.themes).concat(p.themes.split(' ')), p.moves.slice(1));
      if (right) {
        say(BD.msg, 'Right — ' + candSan + ' loses something. Now show why: tap the enemy piece that punishes it.', 'good');
        B().onTap((sq) => {
          if (!BD || my !== session) return;
          if (sq === pun.slice(0, 2) || sq === pun.slice(2, 4)) { B().onTap(null); return void blunderShow(true, 'Exactly: ' + punSan + ' — ' + BD.idea); }
          BD.taps++; say(BD.msg, BD.taps >= 2 ? 'Here it is.' : 'Not that one. Which enemy piece can now take or check?', 'warn');
          if (BD.taps >= 2) { B().onTap(null); void blunderShow(false, 'The punishment: ' + punSan + ' — ' + BD.idea); }
        });
        return;
      }
      return void blunderShow(false, 'It loses: ' + punSan + ' — ' + BD.idea + ' Before every move, check what your opponent can do next.');
    }
    const e = BD.reply ? { move: BD.reply } : await engine(B().fen(), 5, 700); if (my !== session || !BD) return;
    if (e && e.move) mark({ arrows: [[e.move.slice(0, 2), e.move.slice(2, 4), 'rgba(170,170,180,.7)']], legend: [['arrow grey', 'Grey arrow: their best reply']] });
    blunderDone(right, right ? 'Right — ' + candSan + ' is safe. Their best reply' + (e && e.move ? ', ' + sanOf(B().fen(), e.move) + ',' : '') + ' doesn’t win anything.'
      : 'Actually it’s safe: their best reply' + (e && e.move ? ', ' + sanOf(B().fen(), e.move) + ',' : '') + ' wins nothing. Not every move is a trap — check, then trust it.');
  }
  async function blunderShow(clean, text) {
    if (!BD) return; const my = BD.my, pun = BD.p.moves[1];
    mark({ arrows: [[pun.slice(0, 2), pun.slice(2, 4), 'rgba(255,69,58,.9)']], legend: [['arrow red', 'Red arrow: the punishment']] });
    await sleep(700); if (my !== session || !BD) return;
    B().play(pun); await sleep(300);
    blunderDone(clean, text);
  }
  function blunderDone(clean, text) {
    const b = BD; BD = null; B().onTap(null); B().busy(true);
    const ST = P.drills.blunder;
    ST.a++; if (clean) { ST.s++; ST.streak++; ST.best = Math.max(ST.best, ST.streak); } else ST.streak = 0;
    if (!clean && !b.review) reviewAdd('blunder', { ...b.p, cand: b.cand, unsafe: b.unsafe });
    save();
    panel.replaceChildren();
    panel.append(el('div', 'tr-result ' + (clean ? 'good' : 'bad'), clean ? 'Well spotted!' : 'Not this time'));
    const meta = el('div', 'tr-meta'); meta.append(el('span', 'tr-pill', 'Streak ' + ST.streak), el('span', 'tr-pill', 'Best ' + ST.best)); panel.append(meta);
    panel.append(el('div', 'tr-say', text));
    const row = el('div', 'tr-actions'); let note = null;
    if (b.review) { reviewResult(b.review, clean); note = el('div', 'tr-say ' + (clean ? 'good' : ''), clean ? reviewNote(b.review) : 'Comes back tomorrow.'); row.append(btn('Next card', 'primary', reviewNext, 'next')); }
    else { row.append(btn('Next position', 'primary', () => startBlunder(), 'next')); if (PATH && PATH.drill) note = pathDrillResult(clean, row); else row.append(btn('Training', 'quiet', openHub)); }
    if (note) panel.append(note); panel.append(row); drillTop('Blunder check', ST);
  }

  /* ---------------- speed rounds: five easy puzzles on one pattern, against a soft clock ---------------- */
  const SPEED = [['mateIn1', 'Mate in 1'], ['hangingPiece', 'Free pieces'], ['fork', 'Forks'], ['pin', 'Pins'], ['skewer', 'Skewers'], ['backRankMate', 'Back-rank mates'], ['mateIn2', 'Mate in 2'], ['defensiveMove', 'Defence']];
  const SPEED_N = 5, PACE = 15000;
  function openSpeed() {
    session++; screen = 'speed'; PATH = null; RETURN = null; top.hidden = true; panel.hidden = true; B().onMove(null); B().onTap(null); mark({});
    hub.classList.remove('tr-sg-page', 'tr-ed-page'); hub.replaceChildren();
    hub.append(backHead('Speed rounds', openHub), el('p', 'tr-note', 'Five easy puzzles on one pattern. The clock is soft — nothing fails on time — but aim for under 15 seconds each. Fast, correct and often: that is how patterns stick.'));
    const list = el('div', 'tr-list');
    for (const [th, label] of SPEED) {
      const st = P.speed[th] || {};
      const b = btn('', 'tr-item', () => startSpeed(th, label));
      b.innerHTML = '<span class="tr-card-text"><b></b><span></span></span><span class="tr-badge"></span>';
      b.querySelector('b').textContent = label;
      b.querySelector('.tr-card-text span').textContent = st.runs ? (st.best ? 'Best ' + secs(st.best) + ' for 5' : 'No perfect round yet') + ' · ' + st.runs + (st.runs === 1 ? ' round' : ' rounds') : 'Not tried';
      b.querySelector('.tr-badge').textContent = st.best && st.best <= SPEED_N * PACE ? '⚡' : '';
      list.append(b);
    }
    hub.append(list); hub.hidden = false; hub.scrollTop = 0;
  }
  function startSpeed(theme, label) {
    const r = Math.round(P.puzzle.rating);
    PATH = { speed: true, theme0: theme, label, opt: { theme, lo: Math.max(400, r - 550), hi: Math.max(900, r - 150) }, res: [], t0: 0 };
    RETURN = withLabel(() => openSpeed(), 'Speed');
    hub.hidden = true; screen = 'puzzle'; void startPuzzle();
  }
  const speedChip = () => Math.min(PATH.res.length + 1, SPEED_N) + '/' + SPEED_N + ' · ' + (PATH.t0 ? secs(performance.now() - PATH.t0).replace('.0 ', ' ') : '0 s');
  function speedTick(my) {
    if (my !== session || !PATH || !PATH.speed || !PZ || PZ.done) return;
    if (PATH.chip) { PATH.chip.textContent = speedChip(); PATH.chip.classList.toggle('slow', performance.now() - PATH.t0 > PACE); }
    setTimeout(() => speedTick(my), 250);
  }
  async function speedResult(ok) {
    if (!PZ || PZ.done || !PATH || !PATH.speed) return;
    PZ.done = true; B().busy(true); B().onMove(null);
    const my = session, t = PATH.t0 ? performance.now() - PATH.t0 : 0;
    PATH.res.push({ ok, t }); record(ok);
    if (ok) say(PZ.msgNode, '✓ ' + secs(t), 'good');
    else { const want = PZ.p.moves[PZ.i]; if (want) mark({ arrows: [[want.slice(0, 2), want.slice(2, 4)]], lift: want.slice(0, 2) }); say(PZ.msgNode, 'The move was ' + (want ? sanOf(B().fen(), want) : '—') + '. It goes into your review deck.', 'bad'); }
    if (PATH.chip) PATH.chip.textContent = Math.min(PATH.res.length, SPEED_N) + '/' + SPEED_N + ' · ' + secs(t);
    await sleep(ok ? 500 : 1700); if (my !== session || !PATH || !PATH.speed) return;
    if (PATH.res.length >= SPEED_N) return speedDone();
    void startPuzzle();
  }
  function speedDone() {
    const R = PATH.res, th = PATH.theme0, label = PATH.label;
    const right = R.filter((x) => x.ok).length, total = R.reduce((a, x) => a + x.t, 0);
    const st = P.speed[th] || (P.speed[th] = { runs: 0, best: 0, last: 0 });
    st.runs++; st.last = Math.round(total);
    const record = right === SPEED_N && (!st.best || total < st.best);
    if (record) st.best = Math.round(total);
    save(); B().busy(true); mark({});
    setTop('Speed · ' + label, el('span', 'tr-chip dim', right + '/' + SPEED_N));
    panel.hidden = false; panel.replaceChildren();
    panel.append(el('div', 'tr-result ' + (right === SPEED_N ? 'good' : 'bad'), right === SPEED_N ? (record ? 'New best: ' + secs(total) + '!' : 'Perfect round · ' + secs(total)) : right + ' of ' + SPEED_N + ' · ' + secs(total)));
    const strip = el('div', 'tr-speed'); R.forEach((x) => strip.append(el('span', 'tr-speed-cell ' + (x.ok ? (x.t <= PACE ? 'fast' : 'ok') : 'miss'), x.ok ? secs(x.t) : '✗')));
    panel.append(strip);
    panel.append(el('div', 'tr-say', right < SPEED_N ? 'Misses go into your review deck and come back tomorrow.' : total <= SPEED_N * PACE ? 'Under the target pace — this pattern is sticking.' : 'All right. Next time aim for under 15 seconds each.'));
    const row = el('div', 'tr-actions'); row.append(btn('Go again', 'primary', () => startSpeed(th, label), 'retry'), btn('All rounds', 'quiet', openSpeed)); panel.append(row);
    PATH = null;
  }

  /* ---------------- path steps that use the drills ---------------- */
  function pathDrillResult(clean, row) {
    const ch = PATH.ch, st = pathState(ch), s = ch[PATH.step]; let done = false;
    if (PATH.step === 'practise') { if (clean) st.practise = (st.practise || 0) + 1; done = st.practise >= s.count; }
    else { if (clean) st.streak = (st.streak || 0) + 1; else st.streak = 0; if (st.streak >= s.count) { st.prove = true; done = true; } }
    save();
    if (done) row.replaceChildren(btn(chapterDone(ch) ? 'Back to the path' : 'Back to chapter', 'primary', chapterDone(ch) ? openPath : () => openChapter(ch), 'next'), btn('One more', 'quiet', () => (PATH.drill === 'threat' ? startThreat() : startBlunder()), 'retry'));
    return el('div', 'tr-say ' + (done ? 'good' : ''), done ? (PATH.step === 'practise' ? 'Practice complete! ' : 'Proven! ') + (chapterDone(ch) ? 'Chapter finished.' : 'Next step is open.')
      : PATH.step === 'practise' ? (clean ? 'Counts: ' : 'Do it without help to count it: ') + Math.min(st.practise || 0, s.count) + '/' + s.count
      : (clean ? 'In a row: ' : 'Streak reset — no help here: ') + (st.streak || 0) + '/' + s.count);
  }

  /* ---------------- lesson task types: scripted lines, engine-checked best moves, longest defence ---------------- */
  /* mirror and/or shift a position (and its moves) to another file so the idea is learned, not the squares */
  function transform(fen, moves) {
    const sqs = []; fen.split(' ')[0].split('/').forEach((row, ri) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { sqs.push(f); f++; } } });
    for (const u of moves) { sqs.push(FILES.indexOf(u[0]), FILES.indexOf(u[2])); }
    const mirror = Math.random() < 0.5;
    const fs = sqs.map((f) => (mirror ? 7 - f : f)); const lo = -Math.min(...fs), hi = 7 - Math.max(...fs);
    const df = lo + Math.floor(Math.random() * (hi - lo + 1));
    const mapF = (f) => (mirror ? 7 - f : f) + df;
    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    fen.split(' ')[0].split('/').forEach((row, ri) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { grid[ri][mapF(f)] = ch; f++; } } });
    const board = grid.map((r) => { let out = '', e = 0; for (const x of r) { if (!x) e++; else { if (e) out += e; e = 0; out += x; } } return out + (e || ''); }).join('/');
    const parts = fen.split(' '); parts[0] = board; parts[2] = '-'; parts[3] = '-';
    const mu = (u) => FILES[mapF(FILES.indexOf(u[0]))] + u[1] + FILES[mapF(FILES.indexOf(u[2]))] + u[3] + (u[4] || '');
    return { fen: parts.join(' '), map: mu };
  }
  function varyLine(g) {
    const all = []; for (const s of g.steps) { if (s.reply) all.push(s.reply); (s.ok || []).forEach((u) => all.push(u)); }
    const T = transform(g.fen, all);
    return { ...g, fen: T.fen, steps: g.steps.map((s) => ({ ...s, reply: s.reply ? T.map(s.reply) : undefined, ok: s.ok ? s.ok.map(T.map) : undefined })) };
  }
  function varyBest(g) { const T = transform(g.fen, g.prefer || []); return { ...g, fen: T.fen, prefer: (g.prefer || []).map(T.map) }; }
  function runLine(L, my, done, strict = false, onFail) {
    let k = 0, hints = 0, errors = 0, lead = '';
    const msg = lessonPanel(L.task, strict ? [btn('Give up', 'quiet', () => onFail && onFail(), 'flag')] : [btn('Hint', 'hint', () => {
      const s = L.steps[k]; if (!s || !s.ok) return; hints++;
      const u = s.ok[0]; mark(hints % 2 ? { lift: u.slice(0, 2) } : { lift: u.slice(0, 2), arrows: [[u.slice(0, 2), u.slice(2, 4)]] });
    }, 'hint'), btn('Skip', 'quiet', done, 'skip')]);
    const advance = async () => {
      while (k < L.steps.length && L.steps[k].reply) {
        const s = L.steps[k++]; B().busy(true); await sleep(650); if (my !== session) return;
        B().play(s.reply); if (s.say) { lead = (lead + ' ' + s.say).trim(); say(msg, lead); } await sleep(450); if (my !== session) return;
      }
      if (k >= L.steps.length) { mark({}); await sleep(900); if (my === session) done({ errors, hints }); return; }
      const s = L.steps[k]; say(msg, (lead ? lead + ' ' : '') + (s.ask || ''), lead ? 'good' : ''); lead = '';
      B().busy(false);
    };
    B().onMove(async (uci) => {
      if (my !== session) return;
      const s = L.steps[k]; if (!s || !s.ok) return;
      B().busy(true); mark({});
      if (s.ok.includes(uci) || s.ok.includes(uci.slice(0, 4))) { k++; lead = s.say || 'Correct.'; say(msg, lead, 'good'); await sleep(900); if (my === session) void advance(); return; }
      errors++; say(msg, s.no || 'Not this time. Think about the idea above.', 'bad');
      await sleep(1700); if (my !== session) return;
      B().takeBack(1);
      if (strict) { if (onFail) onFail(); return; }
      say(msg, s.ask || L.task); B().busy(false);
    });
    void advance();
  }
  function runBest(g0, my, done, strict = false, onFail) {
    const g = g0;
    let hints = 0, misses = 0;
    const msg = lessonPanel(g.task, strict ? [btn('Give up', 'quiet', () => onFail && onFail(), 'flag')] : [btn('Hint', 'hint', async () => {
      hints++; const u = (g.prefer && g.prefer[0]) || (await engine(B().fen(), 5, 900))?.move; if (!u || my !== session) return;
      mark(hints === 1 ? { lift: u.slice(0, 2) } : { lift: u.slice(0, 2), arrows: [[u.slice(0, 2), u.slice(2, 4)]] }); say(msg, hints === 1 ? 'Hint: move the highlighted piece.' : 'Hint: play the move the arrow shows.');
    }, 'hint'), btn('Skip', 'quiet', () => done({ skipped: true }), 'skip')]);
    B().onMove(async (uci) => {
      if (my !== session) return;
      B().busy(true); mark({});
      const fenBefore = B().prevFen(), pref = (g.prefer || []).some((u) => u === uci || u === uci.slice(0, 4));
      let ok = pref, a = null;
      if (!ok) { say(msg, 'Checking…'); a = await engine(fenBefore, 5, 1200, uci); if (my !== session) return; ok = !!(a && a.playedScore != null && a.bestScore != null && a.playedScore >= a.bestScore - (g.tol || 60)) && !(g.avoid || []).includes(uci) && !(strict && g.prefer); }
      if (ok) {
        say(msg, pref ? (g.why || 'Correct.') : 'That works too. The lesson move was ' + sanOf(fenBefore, g.prefer?.[0] || a?.move || uci) + ' — ' + (g.why || 'the engine\'s choice.'), 'good');
        await sleep(pref ? 1800 : 2800); if (my === session) done({ hints, misses }); return;
      }
      misses++;
      const cost = a && a.bestScore != null && a.playedScore != null ? a.bestScore - a.playedScore : 0;
      say(msg, (strict ? 'Not this one. ' : 'Not the idea. ') + (cost >= 150 ? 'That gives away about ' + Math.max(1, Math.round(cost / 100)) + (Math.round(cost / 100) === 1 ? ' pawn.' : ' pawns.') : 'Think about the idea above.'), 'bad');
      await sleep(1800); if (my !== session) return;
      B().takeBack(1);
      if (strict) { if (onFail) onFail(); return; }
      say(msg, g.task); B().busy(false);
    });
  }
  /* the lone king: every move is measured by how long it delays mate (exact tables) */
  function defenceOptions(fen) {
    const C = B().Chess, c = new C(fen), out = [];
    for (const m of c.moves({ verbose: true })) { c.move(m); const mate = c.isCheckmate(); const j = mate ? { r: 'win', plies: 0 } : (c.isStalemate() || c.isInsufficientMaterial()) ? { r: 'draw', plies: 999 } : probe(c.fen()); c.undo(); if (j) out.push({ uci: uciOf(m), plies: j.r === 'draw' ? 999 : j.plies ?? 0, m }); }
    return out.sort((a, b) => b.plies - a.plies);
  }
  function genDefence(table, minPlies) {
    for (let k = 0; k < 60; k++) {
      const f = genTable(table, { stm: 'b', want: 'loss', minPlies, test: (x) => !x.inCheck() }); if (!f) continue;
      const o = defenceOptions(f); if (o.length >= 3 && o[0].plies - o[o.length - 1].plies >= 6) return f;
    }
    return genTable(table, { stm: 'b', want: 'loss', minPlies });
  }
  function runLongest(g, my, done) {
    let hints = 0, tries = 0;
    const msg = lessonPanel(g.task, [btn('Hint', 'hint', () => { hints++; const o = defenceOptions(B().fen()); if (!o.length) return; mark(hints === 1 ? { lift: o[0].m.from } : { lift: o[0].m.from, arrows: [[o[0].m.from, o[0].m.to]] }); say(msg, hints === 1 ? 'Hint: move the highlighted piece.' : 'Hint: the arrow is the longest defence.'); }, 'hint'), btn('Skip', 'quiet', done, 'skip')],
      'Mate is coming. Make it take as long as possible.');
    B().onMove(async (uci) => {
      if (my !== session) return; B().busy(true); mark({});
      const fenBefore = B().prevFen(), o = defenceOptions(fenBefore), best = o[0], mine = o.find((x) => x.uci === uci.slice(0, 4) || x.uci === uci);
      if (best && mine && mine.plies >= best.plies - 2) { say(msg, 'Longest defence — mate is still ' + Math.ceil(mine.plies / 2) + ' moves away. ' + (dist(kingSq(new (B().Chess)(B().fen()), 'b'), 'e4') <= 2 ? 'Staying central is what makes it last.' : ''), 'good'); await sleep(1900); if (my === session) done(); return; }
      tries++;
      say(msg, 'This shortens it: mate in ' + Math.ceil((mine?.plies || 0) / 2) + ' now — the best defence lasts ' + Math.ceil((best?.plies || 0) / 2) + '. ' + (tries > 1 ? 'Head for the centre, away from the edge.' : 'Try again.'), 'bad');
      await sleep(2000); if (my !== session) return; B().takeBack(1); B().busy(false);
    });
  }
  /* mastery: survive a whole mate against perfect play */
  async function playSurvive(type, task, onDone) {
    const my = ++session; await loadTables(); if (my !== session) return;
    const fen = genDefence(type, type === 'q' ? 16 : 30);
    if (!fen) { lessonPanel('Could not create a position.', [btn('Try again', 'primary', () => runStage())]); return; }
    B().setup({ fen, side: 'b', opponent: 'Computer' }); B().busy(false); mark({});
    const start = probe(fen); let good = 0, moves = 0;
    const msg = lessonPanel(task, [btn('Give up', 'quiet', () => onDone({ win: false, summary: 'You stopped this attempt.' }), 'flag')], 'Best defence lasts ' + Math.ceil((start?.plies || 0) / 2) + ' moves. Make it last.');
    B().onMove(async (uci) => {
      if (my !== session) return; B().busy(true);
      const fenBefore = B().prevFen(), o = defenceOptions(fenBefore), best = o[0], mine = o.find((x) => x.uci === uci.slice(0, 4) || x.uci === uci);
      moves++; const ok = best && mine && mine.plies >= best.plies - 2; if (ok) good++;
      say(msg, (ok ? '✓ Longest defence.' : '✗ Shorter — the best lasted ' + Math.ceil((best?.plies || 0) / 2) + ' moves.') + ' ' + good + '/' + moves + ' best so far.', ok ? 'good' : 'warn');
      await sleep(450); if (my !== session) return;
      const u = tableBest(B().fen()) || (await bestMove(B().fen())); if (my !== session || !u) return;
      B().play(u); await sleep(380); if (my !== session) return;
      const c = new (B().Chess)(B().fen());
      if (c.isCheckmate() || c.isGameOver()) {
        const pct = Math.round(good / Math.max(1, moves) * 100), win = moves >= 4 && pct >= 70;
        return onDone({ win, summary: 'You lasted ' + moves + ' moves (perfect defence: ' + Math.ceil((start?.plies || 0) / 2) + ') · ' + pct + '% longest-defence moves' });
      }
      B().busy(false);
    });
  }
  /* mastery: several positions in a row, first try, no hints */
  function runSeries(m, my, onDone) {
    const pool = m.series.map((k) => SERIES[k]).filter(Boolean);
    const order = pool.slice().sort(() => Math.random() - 0.5); let i = 0;
    const next = async () => {
      if (my !== session) return;
      if (i >= (m.need || order.length)) return onDone({ win: true, summary: (m.need || order.length) + ' in a row' });
      const g0 = order[i % order.length], g = g0.vary ? varyBest(g0) : g0; i++;
      await loadTables(); if (my !== session) return;
      B().setup({ fen: g.fen, side: g.side || 'w', opponent: 'Defender' }); B().busy(false); mark({});
      runBest({ ...g, task: i + ' of ' + (m.need || order.length) + ' · ' + g.task }, my, () => next(), true, () => onDone({ win: false, summary: 'Missed on ' + i + ' of ' + (m.need || order.length) + '. First try counts here.' }));
    };
    void next();
  }
  /* king and queen against a pawn on the 7th (centre files: always a win) */
  function genQvP() {
    const C = B().Chess;
    for (let t = 0; t < 3000; t++) {
      const pawn = pick(['d2', 'e2']), c = new C(); c.clear();
      const nb = SQS.filter((s) => dist(s, pawn) === 1 && s !== pawn[0] + '1'); const bk = pick(nb);
      let wk; do wk = pick(SQS); while (dist(wk, pawn) < 5 || dist(wk, bk) < 2);
      let q; do q = pick(SQS); while ([pawn, bk, wk].includes(q) || dist(q, bk) < 2);
      c.put({ type: 'p', color: 'b' }, pawn); c.put({ type: 'k', color: 'b' }, bk); c.put({ type: 'k', color: 'w' }, wk); c.put({ type: 'q', color: 'w' }, q);
      const fen = c.fen().replace(/ [wb] .*$/, ' w - - 0 1');
      let x; try { x = new C(fen); } catch { continue; }
      if (x.inCheck() || x.isGameOver() || new C(fen.replace(' w ', ' b ')).inCheck()) continue;
      return fen;
    }
    return 'K7/8/8/8/8/8/3pk3/7Q w - - 0 1';
  }

  /* ---------------- your style: what you go for, what costs you, where to focus ---------------- */
  function recordGame(g) {
    const apply = () => {
      const G = P.games || (P.games = []);
      const i = G.findIndex((x) => x.key === g.key); const prev = i >= 0 ? G[i] : null;
      const row = { key: g.key, at: prev?.at || g.at, side: g.side, res: g.res, mode: g.mode, plies: g.plies, acc: g.acc ?? prev?.acc ?? null, tags: g.tags, tip: g.tip };
      if (i >= 0) G[i] = row; else G.push(row);
      if (G.length > 30) G.splice(0, G.length - 30);
      if (g.misses && g.misses.length && !(prev && prev.misses)) { row.misses = g.misses.length; for (const m of g.misses) if (m.fen && m.best) reviewAdd('game', m, g.key + ':' + m.ply); }
      else if (prev && prev.misses) row.misses = prev.misses;
      save();
    };
    if (screen) apply(); else void loadProfile().then(apply);
  }
  /* computer games already on this device: read them once so the profile has history from day one */
  function backfillGames() {
    const PL = window.familyChessPlan, log = window.familyChessCpuGames?.() || [];
    if (!PL || !log.length) return;
    const C = B().Chess, have = new Set((P.games || []).map((x) => x.key));
    for (const g of log.slice(-20)) {
      const key = 'c:' + g.id; if (have.has(key) || !Array.isArray(g.fens) || g.fens.length < 9) continue;
      try {
        const moves = [];
        for (let i = 0; i + 1 < g.fens.length; i++) {
          const c = new C(g.fens[i]), want = g.fens[i + 1].split(' ').slice(0, 2).join(' ');
          const m = c.moves({ verbose: true }).find((x) => { c.move(x); const ok = c.fen().split(' ').slice(0, 2).join(' ') === want; c.undo(); return ok; });
          if (!m) break; moves.push(uciOf(m));
        }
        if (moves.length < 8) continue;
        let acc = null; try { acc = JSON.parse(localStorage.getItem('chess.acc2.' + key) || 'null'); } catch { }
        const R = PL.read({ Chess: C, moves, side: g.color, acc, fens: g.fens.slice(0, moves.length), result: g.result === 'w' ? 'win' : g.result === 'l' ? 'loss' : 'draw' });
        if (!R) continue;
        P.games.push({ key, at: g.at || 0, side: g.color, res: g.result === 'w' ? 'win' : g.result === 'l' ? 'loss' : 'draw', mode: 'cpu', plies: moves.length, acc: g.acc ?? (acc ? acc[g.color] : null), tags: R.tags, tip: R.tip ? { code: R.tip.code } : null });
      } catch { /* skip odd games */ }
    }
    P.games.sort((a, b) => (a.at || 0) - (b.at || 0)); if (P.games.length > 30) P.games.splice(0, P.games.length - 30);
    save();
  }
  function styleStats() {
    const PL = window.familyChessPlan, G = (P.games || []).slice(-20), N = G.length;
    const plans = {}, issues = {}, phases = { opening: { n: 0, bad: 0, loss: 0, ln: 0 }, middlegame: { n: 0, bad: 0, loss: 0, ln: 0 }, endgame: { n: 0, bad: 0, loss: 0, ln: 0 } };
    for (const g of G) {
      for (const p of g.tags?.plans || []) { const x = plans[p] || (plans[p] = { n: 0, w: 0 }); x.n++; if (g.res === 'win') x.w++; }
      for (const k of Object.keys(g.tags?.issues || {})) issues[k] = (issues[k] || 0) + 1;
      for (const [k, v] of Object.entries(g.tags?.verdicts || {})) { const ph = phases[k]; if (!ph) continue; ph.n++; if (v === 'bad') ph.bad++; }
      for (const [k, v] of Object.entries(g.tags?.loss || {})) { const ph = phases[k]; if (ph && Number.isFinite(v) && g.acc != null) { ph.loss += v; ph.ln++; } }
    }
    const order = PL ? PL.ORDER : [];
    const costs = Object.entries(issues).map(([k, n]) => ({ code: k, n, fix: PL?.FIX[k] || { what: k } })).sort((a, b) => b.n - a.n || order.indexOf(a.code) - order.indexOf(b.code));
    const goes = Object.entries(plans).map(([k, v]) => ({ code: k, ...v, name: PL?.PLAN_NAME[k] || k })).sort((a, b) => b.n - a.n);
    const ph = Object.entries(phases).filter(([, v]) => v.n >= 2).map(([k, v]) => ({ key: k, ...v, rate: v.bad / v.n, avg: v.ln ? v.loss / v.ln : null }));
    const score = (x) => x.rate + (x.avg != null ? x.avg / 40 : 0);
    const weakest = ph.filter((x) => x.bad > 0).sort((a, b) => score(b) - score(a))[0] || null;
    const accs = G.map((g) => g.acc).filter((v) => Number.isFinite(v));
    return { N, goes, costs, phases: ph, weakest, accs, wins: G.filter((g) => g.res === 'win').length };
  }
  /* the profile's top finding (with practice behind it) becomes the recommended chapter */
  function styleFocus() {
    const S = styleStats(); if (S.N < 5) return null;
    const top = S.costs.find((c) => (c.fix.chapter || c.fix.lesson) && c.n / S.N >= 0.3);
    if (!top) return null;
    if (top.fix.chapter) { const ch = CHAPTERS.find((c) => c.id === top.fix.chapter); if (!ch || chapterDone(ch)) return null; return { ...top, ch }; }
    if (P.lessons[top.fix.lesson]?.mastered) return null;
    return { ...top, lesson: top.fix.lesson };
  }
  function openStyle() {
    session++; screen = 'style'; PATH = null; RETURN = null; top.hidden = true; panel.hidden = true; B().onMove(null); B().onTap(null); mark({});
    try { backfillGames(); } catch { /* history is optional */ }
    hub.classList.remove('tr-sg-page', 'tr-ed-page'); hub.replaceChildren();
    const S = styleStats();
    hub.append(backHead('Your style', openHub), el('p', 'tr-note', S.N ? 'Read from your last ' + S.N + (S.N === 1 ? ' game' : ' games') + ' — online and against the computer. Every finished game adds to it.' : 'Your style builds up from your games. After each game, the end card reads your plan — it all collects here.'));
    if (S.N < 3) { hub.append(el('div', 'tr-empty', S.N ? 'Play ' + (3 - S.N) + ' more ' + (3 - S.N === 1 ? 'game' : 'games') + ' and your profile appears here.' : 'Finish a game against the computer or a friend to start your profile.')); hub.hidden = false; return; }
    const card = (title) => { const c = el('div', 'tr-style-card'); c.append(el('span', 'tr-label', title)); hub.append(c); return c; };
    const bar = (label, n, of, sub, tone) => { const r = el('div', 'tr-bar-row' + (tone ? ' ' + tone : '')); const t = el('div', 'tr-bar-top'); t.append(el('b', '', label), el('span', 'cnt', sub || n + ' of ' + of)); const b = el('div', 'tr-bar'); const i = el('i'); i.style.width = Math.round(n / Math.max(1, of) * 100) + '%'; b.append(i); r.append(t, b); return r; };
    /* focus first: the one thing to work on */
    const F = styleFocus() || (S.costs[0] && (S.costs[0].fix.chapter || S.costs[0].fix.lesson) ? { ...S.costs[0], ch: S.costs[0].fix.chapter ? CHAPTERS.find((c) => c.id === S.costs[0].fix.chapter) : null, lesson: S.costs[0].fix.lesson } : null);
    if (F) {
      const f = el('div', 'tr-focus'); f.append(el('span', 'tr-label', 'Focus next'), el('b', '', F.fix.what), el('p', '', 'Showed up in ' + F.n + ' of your last ' + S.N + ' games. ' + (F.ch ? 'Chapter "' + F.ch.title + '" drills exactly this' + (styleFocus() ? ' — it is now your recommended next step.' : '.') : 'The "' + F.fix.title + '" lesson in the Academy covers it.')));
      f.append(btn('Practise: ' + (F.ch ? F.ch.title : F.fix.title), 'primary', () => (F.ch ? openChapter(F.ch) : (() => { const l = lessonById(F.lesson); if (l) startLesson(l); })()), 'play'));
      hub.append(f);
    }
    const c1 = card('What you go for');
    S.goes.filter((g) => g.code !== 'drift').slice(0, 5).forEach((g) => c1.append(bar(g.name, g.n, S.N, g.n + ' of ' + S.N + ' games' + (g.n >= 2 ? ' · won ' + g.w : ''))));
    if (!c1.querySelector('.tr-bar-row')) c1.append(el('p', 'tr-muted', 'No clear plan shows up yet — the profile sharpens as you play.'));
    const c2 = card('What costs you');
    if (S.costs.length) S.costs.slice(0, 5).forEach((c) => {
      const r = bar(c.fix.what, c.n, S.N, c.n + ' of ' + S.N + ' games', 'warn');
      if (c.fix.chapter || c.fix.lesson) { const go = btn('Practise ›', 'tr-chip tr-mini-link', () => { if (c.fix.chapter) { const ch = CHAPTERS.find((x) => x.id === c.fix.chapter); if (ch) openChapter(ch); } else { const l = lessonById(c.fix.lesson); if (l) startLesson(l); } }); r.querySelector('.tr-bar-top').append(go); }
      c2.append(r);
    });
    else c2.append(el('p', 'tr-muted', 'Nothing keeps repeating. Nice.'));
    const c3 = card('By phase');
    const NAMES = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' };
    S.phases.forEach((p) => c3.append(bar(NAMES[p.key] + (S.weakest && S.weakest.key === p.key ? ' · weakest' : ''), p.n - p.bad, p.n, 'held up in ' + (p.n - p.bad) + ' of ' + p.n, S.weakest && S.weakest.key === p.key ? 'warn' : '')));
    if (S.weakest) c3.append(el('p', 'tr-muted', { opening: 'Openings: develop knights and bishops first, castle early, don’t move a piece twice.', middlegame: 'Middlegames: before each move, check what your opponent threatens — the Spot the threat and Blunder check drills train exactly that.', endgame: 'Endgames: the Academy’s pawn and rook lessons, plus king activity, turn these around fastest.' }[S.weakest.key]));
    if (S.accs.length >= 4) {
      const h = Math.floor(S.accs.length / 2), avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
      const before = avg(S.accs.slice(0, h)), after = avg(S.accs.slice(h));
      const c4 = card('Accuracy'); const t = el('div', 'tr-acc-trend'); t.append(el('b', '', before + ' → ' + after), el('span', '', after > before ? 'Going up — keep it going.' : after < before ? 'Dipped lately. A review session helps.' : 'Steady.')); c4.append(t);
    }
    hub.hidden = false; hub.scrollTop = 0;
  }


  /* ================================================================== matches: your W/L/D record and every finished game
     Humans = online games that ended with a result (ended/abandoned games never count); Computer = games on this device. */
  let MATCH_FILTER = 'all';
  async function loadHumanMatches() {
    // The online-game query lives in chess-online.js (training never touches online game tables).
    if (uid === 'local' || !window.familyChessFinishedMatches) return [];
    return (await window.familyChessFinishedMatches(uid)).map((g) => ({ ...g, acc: g.acc ?? window.familyChessAccuracy?.cached?.('g:' + g.id)?.[g.side] ?? null }));
  }
  function computerMatches() {
    return (window.familyChessCpuGames?.() || []).filter((g) => ['w', 'l', 'd'].includes(g.result)).map((g) => ({
      kind: 'cpu', id: g.id, fens: g.fens, title: 'vs Computer · Level ' + g.level, side: g.color, res: g.result, reason: g.reason || '', at: g.at || 0, acc: typeof g.acc === 'number' ? g.acc : null,
    }));
  }
  async function openMatchesPage(filter) {
    if (filter) MATCH_FILTER = filter;
    session++; const my = session; screen = 'matches'; PATH = null; RETURN = null; top.hidden = true; panel.hidden = true; B().onMove(null); B().onTap(null); mark({});
    hub.classList.remove('tr-sg-page', 'tr-ed-page'); hub.replaceChildren();
    hub.append(backHead('Matches', openHub), el('p', 'tr-note', 'Every game that finished with a win, loss or draw. Games that were ended early never count.'));
    const segRow = el('div', 'tr-seg tr-match-seg');
    for (const [v, label] of [['all', 'All'], ['human', 'Humans'], ['cpu', 'Computer']]) segRow.append(btn(label, MATCH_FILTER === v ? 'on' : '', () => openMatchesPage(v)));
    hub.append(segRow);
    const body = el('div'); body.append(el('p', 'tr-about-foot', 'Loading…')); hub.append(body); hub.hidden = false; hub.scrollTop = 0;
    let human = [], err = null;
    if (MATCH_FILTER !== 'cpu') { try { human = await loadHumanMatches(); } catch (e) { err = e; } }
    if (my !== session) return;
    const cpu = MATCH_FILTER !== 'human' ? computerMatches() : [];
    const list = (MATCH_FILTER === 'human' ? human : MATCH_FILTER === 'cpu' ? cpu : human.concat(cpu)).sort((a, b) => b.at - a.at);
    body.replaceChildren();
    if (err) body.append(el('p', 'tr-note', 'Could not load online games: ' + (err.message || err)));
    const w = list.filter((g) => g.res === 'w').length, l = list.filter((g) => g.res === 'l').length, d = list.filter((g) => g.res === 'd').length, n = w + l + d;
    const accs = list.map((g) => g.acc).filter((v) => Number.isFinite(v));
    const rec = el('div', 'tr-record');
    const big = el('div', 'tr-record-big'); big.append(el('b', '', n ? Math.round(w / n * 100) + '%' : '–'), el('span', '', n ? 'won' : 'no games yet'));
    const nums = el('div', 'tr-record-nums');
    for (const [v, k, c] of [[w, 'Won', 'w'], [l, 'Lost', 'l'], [d, 'Drawn', 'd']]) { const x = el('div', c); x.append(el('b', '', String(v)), el('span', '', k)); nums.append(x); }
    const bar = el('div', 'tr-record-bar'); for (const [v, c] of [[w, 'w'], [d, 'd'], [l, 'l']]) { const i = el('i', c); i.style.flexGrow = String(n ? v : c === 'd' ? 1 : 0); bar.append(i); }
    const top2 = el('div', 'tr-record-top'); top2.append(big, nums);
    rec.append(el('span', 'tr-label', { all: 'All matches', human: 'vs Humans', cpu: 'vs Computer' }[MATCH_FILTER] + ' · ' + n + (n === 1 ? ' game' : ' games')), top2, bar);
    if (accs.length) rec.append(el('span', 'tr-record-acc', (accs.reduce((a, b) => a + b, 0) / accs.length).toFixed(1) + ' average accuracy'));
    const more = el('div', 'tr-record-more');
    if (MATCH_FILTER !== 'cpu') more.append(btn('Full stats vs humans ›', 'tr-chip', () => { if (uid !== 'local') void window.familyChessStats?.openPlayers(api(), uid); }));
    if (MATCH_FILTER !== 'human') more.append(btn('Full stats vs computer ›', 'tr-chip', () => window.familyChessStats?.openComputer(0)));
    rec.append(more);
    body.append(rec);
    if (!list.length) { body.append(el('div', 'tr-empty', MATCH_FILTER === 'cpu' ? 'Finish a game against the computer and it shows up here.' : 'Finish a game against a friend and it shows up here.')); return; }
    const REASON = { checkmate: 'Checkmate', resignation: 'Resigned', timeout: 'On time', stalemate: 'Stalemate', agreement: 'Agreed draw', repetition: 'Repetition', 'insufficient material': 'Insufficient material' };
    const box = el('div', 'tr-list tr-matches');
    for (const g of list.slice(0, 100)) {
      const row = btn('', 'tr-item tr-match', () => {
        if (g.kind === 'human') { close(); setTimeout(() => window.familyChessOpenMatch?.(g.id, 'play'), 60); }
        else openCpuRead(g);
      });
      row.innerHTML = '<span class="tr-match-badge"></span><span class="tr-card-text"><b></b><span></span></span><span class="tr-match-acc"></span><span class="tr-chev" aria-hidden="true">›</span>';
      const bdg = row.querySelector('.tr-match-badge'); bdg.textContent = g.res.toUpperCase(); bdg.classList.add(g.res);
      row.querySelector('b').textContent = g.title;
      const dt = g.at ? new Date(g.at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
      row.querySelector('.tr-card-text span').textContent = [g.side === 'b' ? 'Black' : 'White', { w: 'Won', l: 'Lost', d: 'Draw' }[g.res] + (REASON[g.reason] ? ' · ' + REASON[g.reason] : ''), dt].filter(Boolean).join(' · ');
      if (g.acc != null) row.querySelector('.tr-match-acc').textContent = g.acc.toFixed(1);
      box.append(row);
    }
    body.append(box);
  }
  /* a computer game is kept as its positions: rebuild the moves and open the plan read for it */
  function openCpuRead(g) {
    const PL = window.familyChessPlan, C = B()?.Chess, f = Array.isArray(g.fens) ? g.fens : [];
    const key = (x) => x.split(' ').slice(0, 2).join(' ');
    const moves = [];
    if (PL && C) for (let i = 1; i < f.length; i++) {
      let c; try { c = new C(f[i - 1]); } catch { break; }
      const hit = c.moves({ verbose: true }).find((m) => { c.move(m); const same = key(c.fen()) === key(f[i]); c.undo(); return same; });
      if (!hit) break; moves.push(hit.from + hit.to + (hit.promotion || ''));
    }
    let R = null;
    try { if (moves.length) R = PL.read({ Chess: C, moves, side: g.side, result: { w: 'win', l: 'loss', d: 'draw' }[g.res], fens: f.slice(0, moves.length) }); } catch { R = null; }
    if (!R) { window.familyChessStats?.openComputer(0); return; }
    PL.open(R, { title: g.title, onPractise: (tip) => { if (tip.chapter) openChapterId(tip.chapter); else if (tip.lesson) openLessonId(tip.lesson); } });
  }
  function openMatches(filter) {
    if (!B()) return;
    if (root.hidden) open();   // same entry as the Challenges button, so the board stays covered
    void openMatchesPage(filter);
  }

  /* ------------------------------------------------------------------ toolbar button */
  function mountButton() {
    if (document.getElementById('btnTrain') || !document.body) return;
    const b = document.createElement('button');
    b.className = 'train-top'; b.id = 'btnTrain'; b.type = 'button'; b.textContent = 'Challenges';
    b.setAttribute('aria-label', 'Challenges: puzzles, endgame lessons and challenges');
    b.addEventListener('click', () => (root.hidden ? open() : close()));
    document.body.append(b);
  }
  mountButton(); document.addEventListener('DOMContentLoaded', mountButton);
  /* open Training straight on one chapter (the end card's "Practise" link) */
  function openChapterId(id) {
    const ch = CHAPTERS.find((c) => c.id === id); if (!ch || !B()) return;
    root.hidden = false; document.body.classList.add('training-open'); B().enter();
    void loadProfile().then(() => { if (screen === 'chapter') openChapter(ch); });
    openChapter(ch);
  }
  function openLessonId(id) {
    const l = lessonById(id); if (!l || !B()) return;
    root.hidden = false; document.body.classList.add('training-open'); B().enter();
    void loadProfile().then(() => { if (screen === 'lesson' && LS && LS.l === l && LS.stage === 0) startLesson(l); });
    RETURN = null; startLesson(l);
  }
  window.familyChessTraining = { open, close, openChapterId, openLessonId, recordGame, openMatches, _test: { reviewDue, reviewAdd, startThreat, startBlunder, startSpeed, openStyle, styleStats, transform, varyLine, LUCENA, PHILIDOR, SERIES, CHAPTERS, defenceOptions, genDefence, genQvP, openReview, openSpeed, startLesson, lessonById, td: () => TD, bd: () => BD, suggest, keepers, probe, genTable, loadTables, genEnding, box, teacherMove, assess, LESSONS, CHALLENGES, nextPuzzle, P: () => P, judge, pz: () => PZ, ls: () => LS } };
})();
