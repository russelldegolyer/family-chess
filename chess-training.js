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
    lessons: {}, challenges: {},
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
    const back = btn('', 'tr-back', () => openHub());
    back.innerHTML = '<svg width="11" height="18" viewBox="0 0 11 18" aria-hidden="true"><path d="M9 2L2 9l7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Training</span>';
    back.setAttribute('aria-label', 'Back to Training');
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
    session++; screen = null;
    hub.hidden = true; top.hidden = true; panel.hidden = true; root.hidden = true;
    document.body.classList.remove('training-open');
    B()?.exit();
  }

  function openHub() {
    session++; screen = 'hub';
    top.hidden = true; panel.hidden = true;
    B().onMove(null); B().mark({});
    renderHub(); hub.hidden = false;
  }
  function renderHub() {
    hub.replaceChildren();
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
    card('Unlimited Puzzles', 'Tactics by rating, with hints', '♞', pz.solved ? pz.solved + ' solved' : '', () => openPuzzles());
    card('Endgame Academy', 'From the basics to checkmate', '♚', lessonsDone + '/' + LESSONS.length, () => openAcademy());
    card('Endgame Challenges', 'Win against a defending computer', '♜', chDone ? chDone + ' won' : '', () => openChallenges());
    hub.append(head, hero, mini, el('div', 'tr-section', 'Practice'), cards);
    const back = btn('Back to the game', 'tr-link', close); hub.append(back);
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
  async function nextPuzzle() {
    const cat = CATS.find((c) => c[0] === P.settings.cat) || CATS[0];
    const recent = new Set(P.puzzle.history.slice(-300).map((h) => h.id));
    let [lo, hi] = band();
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
    const p = retry && PZ ? PZ.p : await nextPuzzle();
    if (my !== session) return;
    if (!p) { say(msg, 'No puzzles available for this filter. Try Mixed.', 'bad'); panel.append(btn('Settings', '', puzzleSettings)); return; }
    const C = B().Chess, c0 = new C(p.fen);
    const side = other(c0.turn());
    PZ = { p, side, i: 1, hints: 0, failed: !!retry, done: false, retry, rated: !retry, recorded: !!retry };
    B().setup({ fen: p.fen, side, opponent: 'Puzzle' }); B().busy(true); B().mark({});
    const level = Object.entries(BANDS).find(([, [lo, hi]]) => p.rating >= lo && p.rating <= hi)?.[1][2] || '';
    renderPuzzlePanel(level);
    await sleep(650); if (my !== session) return;
    B().play(p.moves[0]); /* the opponent's last move, then the player's turn */
    await sleep(350); if (my !== session) return;
    B().busy(false);
    say(PZ.msgNode, 'Find the best move.');
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
    row.append(PZ.hintBtn, btn('Solution', 'quiet', () => void showSolution(), 'eye'), btn('Skip', 'quiet', () => void startPuzzle(), 'skip'));
    PZ.rowNode = row;
    panel.append(head, msg, row);
  }
  function themesList(t) { return t.split(' ').filter((x) => IDEA[x]); }
  function hint() {
    if (!PZ || PZ.done) return;
    const want = PZ.p.moves[PZ.i]; if (!want) return;
    PZ.hints = Math.min(3, PZ.hints + 1); P.puzzle.hints++; save();
    if (PZ.hints === 1) { const th = themesList(PZ.p.themes); say(PZ.msgNode, '' + (IDEA[th.find((x) => /mate/.test(x))] || IDEA[th[0]] || 'Look for checks, captures and threats.'), 'idea'); }
    else if (PZ.hints === 2) { B().mark({ sel: want.slice(0, 2), lift: want.slice(0, 2) }); say(PZ.msgNode, 'Move the raised piece.'); }
    else { B().mark({ arrows: [[want.slice(0, 2), want.slice(2, 4)]], lift: want.slice(0, 2) }); say(PZ.msgNode, 'Play the arrow move.'); }
    PZ.hintBtn.querySelectorAll('.tr-pips i').forEach((p, k) => p.classList.toggle('on', k < PZ.hints));
    if (PZ.hints >= 3) PZ.hintBtn.classList.add('used');
  }
  async function onPuzzleMove(uci, my) {
    if (!PZ || PZ.done || my !== session) return;
    const want = PZ.p.moves[PZ.i];
    B().mark({});
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
      pz.history.push({ id: PZ.p.id, ok, h: PZ.hints, r: PZ.p.rating, d: delta, t: Date.now() });
      if (pz.history.length > 400) pz.history = pz.history.slice(-400);
      PZ.recorded = true; save();
      const c = api();
      if (c && uid !== 'local' && remoteOk) Promise.resolve(c.from('chess_puzzle_attempts').insert({ user_id: uid, puzzle_id: PZ.p.id, solved: ok, hints: PZ.hints, rated, rating_before: Math.round(pz.rating - delta), rating_after: Math.round(pz.rating) })).catch(() => { });
    }
    return { delta, rated };
  }
  function solved() {
    PZ.done = true; B().busy(true);
    const { delta, rated } = record(!PZ.failed);
    const th = themesList(PZ.p.themes);
    panel.replaceChildren();
    const head = el('div', 'tr-result ' + (PZ.failed ? 'bad' : 'good'), PZ.retry ? 'Solved on retry' : PZ.failed ? 'Solved after a miss' : PZ.hints ? 'Solved with hints' : 'Solved!');
    const meta = el('div', 'tr-meta');
    meta.append(el('span', 'tr-pill', 'Puzzle ' + PZ.p.rating), el('span', 'tr-pill', rated ? (delta >= 0 ? '+' : '') + delta + ' → ' + Math.round(P.puzzle.rating) : 'Unrated'), el('span', 'tr-pill', 'Streak ' + P.puzzle.streak));
    const ex = el('div', 'tr-say', th.length ? th.slice(0, 2).map((x) => NAME[x] || x).join(' · ') + ' — ' + (IDEA[th.find((x) => /mate/.test(x))] || IDEA[th[0]]) : '');
    const row = el('div', 'tr-actions'); row.append(btn('Next puzzle', 'primary', () => void startPuzzle(), 'next'), btn('Retry', 'quiet', () => void startPuzzle(true), 'retry'));
    panel.append(head, meta, ex, row); puzzleTop();
  }
  function fail() {
    const first = !PZ.failed; PZ.failed = true;
    const { delta, rated } = first ? record(false) : { delta: 0, rated: false };
    say(PZ.msgNode, first && rated ? 'Not the move. ' + delta + ' rating. Try again or see the solution.' : 'Not the move. Try again.', 'bad');
    puzzleTop();
    if (!PZ.rowNode.querySelector('.retry')) { const r = btn('Retry', 'quiet retry', () => void startPuzzle(true), 'retry'); PZ.rowNode.prepend(r); }
  }
  async function showSolution() {
    if (!PZ || PZ.done) return;
    const my = session;
    if (!PZ.failed) { PZ.failed = true; record(false); }
    PZ.done = true; B().busy(true); say(PZ.msgNode, 'Solution:');
    for (let k = PZ.i; k < PZ.p.moves.length; k++) {
      const u = PZ.p.moves[k];
      B().mark({ arrows: [[u.slice(0, 2), u.slice(2, 4)]] }); await sleep(700); if (my !== session) return;
      B().play(u); await sleep(650); if (my !== session) return;
    }
    B().mark({});
    panel.replaceChildren();
    const th = themesList(PZ.p.themes);
    panel.append(el('div', 'tr-result bad', 'Puzzle failed'), el('div', 'tr-say', th.length ? (NAME[th[0]] || th[0]) + ' — ' + IDEA[th[0]] : ''));
    const row = el('div', 'tr-actions'); row.append(btn('Next puzzle', 'primary', () => void startPuzzle(), 'next'), btn('Retry', 'quiet', () => void startPuzzle(true), 'retry')); panel.append(row);
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
      const why = hangs(new C(fenBefore), m, me) ? 'Your ' + PIECE[m.piece] + ' can simply be taken.' : 'This throws away the win.';
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
    return { ...out, kind: 'ok', text: c.inCheck() ? 'Check, but the box did not shrink. Checks alone rarely help.' : 'Still winning. Look for a move that takes squares away.' };
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
      intro: ['Before you can mate, the king must be trapped. Rooks and queens cut off whole ranks and files; your king takes away the rest.', 'The red squares are the king\'s "box": every square it can still reach. Make the box smaller with each move.'],
      demo: { fen: '8/8/8/3k4/8/8/8/R3K3 w - - 0 1', auto: 'teacher', plies: 8, say: 'Watch the box shrink as the rook cuts files and ranks and the king walks up.' },
      guided: [{ fen: '8/8/8/3k4/8/8/8/R3K3 w - - 0 1', task: 'Make the king\'s box smaller (without losing your rook).', type: 'shrink' },
        { fen: '8/8/2k5/8/8/8/8/4K1Q1 w - - 0 1', task: 'Use the queen to cut the king off. Shrink the box.', type: 'shrink' }],
      harder: { fen: '8/8/8/4k3/8/8/8/4K2R w - - 0 1', task: 'Shrink the box twice in a row.', type: 'shrink', count: 2 },
      mastery: { fen: '8/8/8/3k4/8/8/8/2Q1K3 w - - 0 1', task: 'Drive the king to the edge of the board.', goal: 'edge', kind: 'teacher' } },
    { id: 'f3', title: 'The opposition',
      intro: ['When the two kings face each other with ONE square between them, they are in opposition. Neither may step forward.', 'The side that does NOT have to move holds the opposition — the other king must give way. In pawn endings this single tempo decides win or draw.'],
      demo: { fen: '8/5k2/8/8/4K1P1/8/8/8 w - - 0 1', auto: 'table', plies: 14, say: 'Watch the white king take the opposition, then outflank — the pawn only moves when its path is safe.' },
      guided: [
        { fen: '8/5k2/8/8/4K1P1/8/8/8 w - - 0 1', task: 'Take the opposition. Only one move wins.', type: 'keep' },
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
      guided: [{ fen: '8/8/8/2k5/8/8/8/4K2Q w - - 0 1', task: 'Shrink the box with the queen.', type: 'shrink' }],
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
  ];

  const LESSONS = ALL_LESSONS.filter((l) => l.id);
  function openAcademy() {
    session++; screen = 'academy'; top.hidden = true; panel.hidden = true; B().onMove(null);
    hub.replaceChildren();
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
      b.querySelector('.tr-card-text span').textContent = st.mastered ? 'Mastered' : st.stage ? 'In progress' : 'Not started';
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
    const my = ++session; const l = LS.l; stageTop(); B().onMove(null); B().mark({});
    if (LS.stage === 0) {
      const f = l.demo.fen || (l.guided[0] && l.guided[0].fen);
      B().setup({ fen: f, side: lessonSide(l), opponent: 'Defender' }); B().busy(true);
      if (!isPawnLesson(l)) tintBox(); else B().mark({});
      lessonPanel('The idea', [btn('Show me', 'primary', nextStage, 'play'), btn('Skip ahead', 'quiet', () => { LS.stage = 3; nextStage(); }, 'skip')], l.intro.join('\n\n'));
      return;
    }
    if (LS.stage === 1) return void runDemo(my);
    if (LS.stage === 2) { LS.task = 0; const step = () => { if (LS.task < l.guided.length) { const g = l.guided[LS.task++]; void runTask(g, ++session, step); } else nextStage(); }; return step(); }
    if (LS.stage === 3) return void runTask(l.harder, my, nextStage);
    if (LS.stage === 4) {
      await loadTables();
      const m = l.mastery; const fen = masteryFen(m);
      return void playEnding({ fen, goal: m.goal, kind: m.kind, task: m.task, mode: 'practice', side: m.side || 'w', onDone: (res) => {
        if (res.win) { const st = P.lessons[l.id] || (P.lessons[l.id] = {}); st.mastered = true; st.stage = 5; save(); }
        const msg = lessonPanel(res.win ? 'Lesson mastered! ' + res.summary : res.summary, [btn(res.win ? 'Back to lessons' : 'Try again', 'primary', res.win ? openAcademy : () => runStage()), btn('New position', 'quiet', () => runStage())]);
        msg.classList.add(res.win ? 'good' : 'bad');
      } });
    }
  }
  const isPawnLesson = (l) => /^(f3|f4|f5|l8|p2)$/.test(l.id);
  const lessonSide = (l) => (l.id === 'p2' ? 'b' : 'w');
  function masteryFen(m) {
    if (m.fen) return m.fen;
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
    const bx = box(B().fen(), def); B().mark({ tint: bx.squares });
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
        if (s.move) { B().mark({ arrows: [[s.move.slice(0, 2), s.move.slice(2, 4)]] }); await sleep(600); if (my !== session) return; B().play(s.move); await sleep(500); }
        B().mark({ rings: s.rings || [], tint: s.tint || [] });
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
      if (white) { B().mark({ arrows: [[u.slice(0, 2), u.slice(2, 4)]] }); await sleep(450); }
      B().play(u); await sleep(350);
      const after = new C(B().fen());
      const bx = box(B().fen(), 'b');
      B().mark({ tint: bx.squares });
      if (after.isCheckmate()) { say(msg, 'Checkmate! ' + (d.say || '')); break; }
      if (isPawnLesson(LS.l)) { say(msg, (white ? '' : 'Black: ') + sanOf(fen, u) + (white ? ' — ' + explainPawn(fen, u, B().fen(), true).replace(/^Correct — /, '') : ' — the best defence.')); B().mark(d.rings && white && i < 2 ? { rings: d.rings } : {}); }
      else if (white && d.auto !== 'teacher') { say(msg, sanOf(fen, u) + (after.inCheck() ? ' — check. ' : '. ') + (d.say || '')); B().mark(new C(B().fen()).moves().length && /p/i.test(fen.split(' ')[0].replace(/[^pP]/g, '')) ? {} : { tint: bx.squares }); }
      else if (white) say(msg, (after.inCheck() ? 'Check. ' : '') + (bx.area < before ? 'Box: ' + before + ' → ' + bx.area + ' squares.' : 'Box ' + bx.area + ' squares — ' + (u.length && new C(fen).get(u.slice(0, 2))?.type === 'k' ? 'the king steps up to help.' : 'keeping the cut.')));
      await sleep(900);
    }
  }
  async function runTask(g, my, done) {
    await loadTables(); if (my !== session) return;
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
      if (u) B().mark({ tint: box(B().fen(), 'b').squares, arrows: [[u.slice(0, 2), u.slice(2, 4)]], lift: u.slice(0, 2) });
    }, 'hint'), btn('Skip', 'quiet', done, 'skip')]);
    B().onMove(async (uci) => {
      if (my !== session) return;
      B().busy(true);
      const fenBefore = B().prevFen();
      const C = B().Chess, after = new C(B().fen());
      if (g.type === 'mate1') {
        if (after.isCheckmate()) { say(msg, 'Checkmate! ' + (g.type === 'mate1' ? 'Every escape square is covered.' : ''), 'good'); B().mark({}); await sleep(900); if (my === session) done(); return; }
        const text = after.isStalemate() ? 'Stalemate! The king has no move but is not in check — a draw. Give check while taking the last squares.' : after.inCheck() ? 'Check, but the king escapes to ' + after.moves({ verbose: true }).filter((m) => m.piece === 'k').map((m) => m.to).join(', ') + '.' : 'That is not even check. Look for a check that leaves no escape.';
        say(msg, text, after.isStalemate() ? 'bad' : 'warn'); await sleep(1300); if (my !== session) return;
        B().takeBack(1); tintBox(); B().busy(false); return;
      }
      const a = await assess(fenBefore, uci, 'mate', 'w'); if (my !== session) return;
      if (a.kind === 'mate') { say(msg, 'Checkmate!', 'good'); await sleep(900); if (my === session) done(); return; }
      if (a.kind === 'good' && (a.text.startsWith('Good — the king') || box(a.fenAfter, 'b').area < box(fenBefore, 'b').area)) {
        need--; say(msg, a.text + (need > 0 ? ' Once more.' : ''), 'good'); B().mark({ tint: box(B().fen(), 'b').squares });
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
    B().mark({});
    let tries = 0;
    const msg = lessonPanel(g.task, [btn('Hint', 'hint', () => {
      const ks = keepers(B().fen()); if (!ks.length) return;
      tries++;
      const m = ks[0]; B().mark(tries === 1 ? { lift: m.from } : { lift: m.from, arrows: [[m.from, m.to]] });
      say(msg, tries === 1 ? 'Move the raised piece.' : 'Play the arrow move.');
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
        say(msg, text + (alt > 1 ? ' (' + alt + ' moves work here.)' : ''), 'good'); B().mark({});
        await sleep(1700); if (my === session) done(); return;
      }
      say(msg, text, 'bad');
      await sleep(2300); if (my !== session) return;
      B().takeBack(1); B().busy(false);
    });
  }

  /* ------------------------------------------------------------------ play an ending against the defending computer */
  async function playEnding({ fen, goal, kind = 'engine', task, limit, mode = 'practice', side = 'w', onDone }) {
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
      if (u && my === session) { B().mark({ tint: goal === 'hold' ? [] : box(B().fen(), other(side)).squares, arrows: [[u.slice(0, 2), u.slice(2, 4)]], lift: u.slice(0, 2) }); say(msg, 'Try ' + sanOf(B().fen(), u) + ' — the raised piece.'); }
    }, 'hint'));
    buttons.push(btn('Restart', 'quiet', () => void playEnding({ fen, goal, kind, task, limit, mode, side, onDone }), 'retry'));
    buttons.push(btn('Give up', 'quiet', () => finish(false, 'You stopped this attempt.'), 'flag'));
    msg = lessonPanel(task, buttons, mode === 'challenge' ? 'No hints — full review afterwards.' : 'Your move.');
    const guided = mode === 'guided';
    const showBox = () => { if (mode !== 'challenge' && goal !== 'hold' && goal !== 'promote') B().mark({ tint: box(B().fen(), other(side)).squares }); else B().mark({}); };
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
      if (guided && !done) { const s = await suggest(B().fen(), kind === 'teacher' ? 'teacher' : 'engine'); if (s && my === session && !done) B().mark({ tint: goal === 'hold' || goal === 'promote' ? [] : box(B().fen(), other(side)).squares, arrows: [[s.slice(0, 2), s.slice(2, 4), 'rgba(255,214,10,.75)']] }); }
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
      if (stats.moves >= 60) return finish(false, 'Too many moves — use the box method to finish faster.');
      await reply();
    });
    await sleep(500); if (my !== session) return;
    if (start.turn() !== side) await reply(); else { showBox(); if (guided) { const s = await suggest(fen, kind === 'teacher' ? 'teacher' : 'engine'); if (s && my === session) B().mark({ tint: goal === 'hold' || goal === 'promote' ? [] : box(fen, other(side)).squares, arrows: [[s.slice(0, 2), s.slice(2, 4), 'rgba(255,214,10,.75)']] }); } B().busy(false); }
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
    hub.replaceChildren();
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
  async function startChallenge(ch) {
    hub.hidden = true; screen = 'challenge';
    await loadTables();
    setTop(ch.title, el('span', 'tr-chip dim', { guided: 'Guided', practice: 'Practice', challenge: 'Challenge' }[P.settings.mode]));
    const mode = P.settings.mode;
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
      const row = el('div', 'tr-actions'); row.append(btn('New position', 'primary', () => startChallenge(ch), 'next'), btn('All challenges', 'quiet', openChallenges)); panel.append(row);
    } });
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
  window.familyChessTraining = { open, close, _test: { suggest, keepers, probe, genTable, loadTables, genEnding, box, teacherMove, assess, LESSONS, CHALLENGES, nextPuzzle, P: () => P, judge, pz: () => PZ, ls: () => LS } };
})();
