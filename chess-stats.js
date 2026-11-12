/* Stats screens behind the two record cards on Play online: all games vs people, and vs the computer (per level).
   Reads finished online games + their moves from Supabase (read-only) and the practice-game log kept on this device.
   Move quality comes from the built-in engine on this device; results are cached per game. */
(() => {
  'use strict';
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const GLYPH = { q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const REASON = { checkmate: 'Checkmate', resignation: 'Resignation', timeout: 'Time', stalemate: 'Stalemate', agreement: 'Agreement', repetition: 'Repetition', 'insufficient material': 'Material', '50-move': '50-move rule', abandoned: 'Abandoned' };
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const B = () => window.familyChessBoard;

  /* ---------------- material + events from the position after every ply ---------------- */
  function counts(fen) { const o = { w: {}, b: {} }; for (const ch of fen.split(' ')[0]) if (/[pnbrqk]/i.test(ch)) { const c = ch === ch.toUpperCase() ? 'w' : 'b'; const t = ch.toLowerCase(); o[c][t] = (o[c][t] || 0) + 1; } return o; }
  function scan(g) {
    const me = g.color, op = me === 'w' ? 'b' : 'w', took = {}, lost = {};
    let checks = 0, promos = 0, castled = false, mine = 0;
    for (let i = 1; i < g.fens.length; i++) {
      const a = counts(g.fens[i - 1]), b = counts(g.fens[i]), mover = g.fens[i - 1].split(' ')[1];
      for (const t of 'pnbrq') {
        const dOp = (a[op][t] || 0) - (b[op][t] || 0), dMe = (a[me][t] || 0) - (b[me][t] || 0);
        if (dOp > 0 && mover === me) took[t] = (took[t] || 0) + dOp;
        if (dMe > 0 && mover === op) lost[t] = (lost[t] || 0) + dMe;
      }
      if (mover === me) {
        mine++;
        if ((b[me].p || 0) < (a[me].p || 0) && ['q', 'r', 'b', 'n'].some((t) => (b[me][t] || 0) > (a[me][t] || 0))) promos++;
        const C = B()?.Chess; if (C) { try { if (new C(g.fens[i]).inCheck()) checks++; } catch { /* odd position */ } }
        if (!castled && g.fens[i - 1].split(' ')[2] !== '-') {
          const u = uciBetween(g.fens[i - 1], g.fens[i]);
          if (u && /^(e1g1|e1c1|e8g8|e8c8)$/.test(u) && g.fens[i - 1].split(' ')[0].length && (() => { try { return new (B().Chess)(g.fens[i - 1]).get(u.slice(0, 2))?.type === 'k'; } catch { return false; } })()) castled = true;
        }
      }
    }
    return { took, lost, checks, promos, castled, myMoves: mine };
  }

  /* ---------------- move quality (engine on this device, cached per game) ---------------- */
  let worker = null, wid = 0; const wait = new Map();
  function engine(fen, uci) {
    if (!worker) {
      try { worker = new Worker(URL.createObjectURL(new Blob([B().engineSource()], { type: 'text/javascript' }))); worker.onmessage = (e) => { const f = wait.get(e.data.id); if (f) { wait.delete(e.data.id); f(e.data); } }; }
      catch { return Promise.resolve(null); }
    }
    const id = ++wid;
    return new Promise((res) => { wait.set(id, res); worker.postMessage({ id, fen, level: 5, budget: 220, analysisMove: uci }); setTimeout(() => { if (wait.has(id)) { wait.delete(id); res(null); } }, 5000); });
  }
  const QKEY = 'chess.stats.q2.';
  function cached(g) { try { return JSON.parse(localStorage.getItem(QKEY + g.id) || 'null'); } catch { return null; } }
  function grade(r, uci) {
    if (!r || !Number.isFinite(r.bestScore) || !Number.isFinite(r.playedScore)) return null;
    if (r.forced || r.move === uci) return 'best';
    const loss = Math.max(0, r.bestScore - r.playedScore);
    if (r.bestScore > 98500 && r.playedScore < 98500) return 'blunder';
    if (r.playedScore < -98500 && r.bestScore > -98500) return 'blunder';
    if (loss >= 500) return 'blunder'; if (loss >= 225) return 'mistake'; if (loss >= 100) return 'inaccuracy';
    return loss <= 30 ? 'best' : 'good';
  }
  function uciBetween(a, b) {
    const C = B().Chess; const c = new C(a);
    for (const m of c.moves({ verbose: true })) { c.move(m); const same = c.fen().split(' ').slice(0, 3).join(' ') === b.split(' ').slice(0, 3).join(' '); c.undo(); if (same) return m.from + m.to + (m.promotion || ''); }
    return null; /* a pawn-for-time action, not a move */
  }
  async function analyse(g, stop) {
    const hit = cached(g); if (hit) return hit;
    const q = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, worst: null };
    for (let i = 1; i < g.fens.length; i++) {
      if (stop()) return null;
      const before = g.fens[i - 1]; if (before.split(' ')[1] !== g.color) continue;
      const uci = uciBetween(before, g.fens[i]); if (!uci) continue;
      const r = await engine(before, uci); const k = grade(r, uci); if (!k) continue;
      q[k]++;
      if ((k === 'blunder' || k === 'mistake') && (!q.worst || r.bestScore - r.playedScore > q.worst.loss)) q.worst = { loss: r.bestScore - r.playedScore, move: Math.ceil(i / 2) + (g.color === 'b' ? '…' : '.'), san: (() => { try { const c = new (B().Chess)(before); return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san; } catch { return uci; } })() };
    }
    try { localStorage.setItem(QKEY + g.id, JSON.stringify(q)); } catch { /* keep in memory */ }
    return q;
  }

  /* ---------------- data sources ---------------- */
  async function onlineGames(api, pid) {
    const { data: games, error } = await api.from('chess_games').select('id,result,end_reason,white_player_id,black_player_id,updated_at,status')
      .eq('status', 'finished').or('white_player_id.eq.' + pid + ',black_player_id.eq.' + pid).order('updated_at', { ascending: false }).limit(200);
    if (error) throw error;
    const kept = (games || []).filter((g) => g.end_reason !== 'replaced' && g.result && g.black_player_id && g.white_player_id);
    if (!kept.length) return [];
    const { data: moves, error: e2 } = await api.from('chess_moves').select('game_id,ply,fen_after').in('game_id', kept.map((g) => g.id)).order('ply', { ascending: true }).limit(20000);
    if (e2) throw e2;
    const by = {}; for (const m of moves || []) (by[m.game_id] = by[m.game_id] || []).push(m);
    return kept.map((g) => {
      const color = g.white_player_id === pid ? 'w' : 'b';
      const result = g.result === '1/2-1/2' ? 'd' : (g.result === '1-0') === (color === 'w') ? 'w' : 'l';
      const fens = [START, ...(by[g.id] || []).sort((a, b) => a.ply - b.ply).map((m) => m.fen_after)];
      return { id: 'o-' + g.id, color, result, reason: g.end_reason || '', fens, at: Date.parse(g.updated_at) || 0 };
    });
  }
  const cpuGames = () => (window.familyChessCpuGames?.() || []).map((g) => ({ ...g, id: 'c-' + g.id }));

  /* ---------------- sheet ---------------- */
  const root = el('section', 'st-sheet'); root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
  const mount = () => { if (!root.isConnected && document.body) document.body.append(root); };
  let run = 0;
  function close() { run++; root.hidden = true; }
  function header(title, sub) {
    const h = el('div', 'st-head');
    const back = el('button', 'st-back'); back.type = 'button'; back.setAttribute('aria-label', 'Back');
    back.innerHTML = '<svg width="11" height="18" viewBox="0 0 11 18" aria-hidden="true"><path d="M9 2L2 9l7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Play online</span>';
    back.addEventListener('click', close);
    const t = el('div', 'st-title'); t.append(el('h2', '', title), el('span', '', sub));
    h.append(back, t); return h;
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  function wdlBar(w, l, d) {
    const n = w + l + d, bar = el('div', 'st-wdl');
    for (const [v, c] of [[w, 'w'], [d, 'd'], [l, 'l']]) { const s = el('i', c); s.style.flexGrow = n ? v : (c === 'd' ? 1 : 0); bar.append(s); }
    return bar;
  }
  function recordCard(games, label) {
    const w = games.filter((g) => g.result === 'w').length, l = games.filter((g) => g.result === 'l').length, d = games.filter((g) => g.result === 'd').length;
    const c = el('div', 'st-card st-record');
    const top = el('div', 'st-rec-top');
    const big = el('div', 'st-rec-big'); big.append(el('b', '', games.length ? pct(w, games.length) + '%' : '–'), el('span', '', 'win rate'));
    const nums = el('div', 'st-rec-nums');
    for (const [v, k, cls] of [[w, 'Won', 'w'], [l, 'Lost', 'l'], [d, 'Drawn', 'd']]) { const x = el('div', cls); x.append(el('b', '', String(v)), el('span', '', k)); nums.append(x); }
    top.append(big, nums); c.append(el('span', 'st-label', label + ' · ' + games.length + ' game' + (games.length === 1 ? '' : 's')), top, wdlBar(w, l, d));
    return c;
  }
  function row(k, v) { const r = el('div', 'st-row'); r.append(el('span', '', k), el('b', '', v)); return r; }
  function sideCard(games) {
    const c = el('div', 'st-card'); c.append(el('span', 'st-label', 'By colour'));
    for (const [col, name] of [['w', 'As White'], ['b', 'As Black']]) {
      const gs = games.filter((g) => g.color === col), w = gs.filter((g) => g.result === 'w').length, l = gs.filter((g) => g.result === 'l').length, d = gs.length - w - l;
      const r = el('div', 'st-side'); const dot = el('span', 'st-dot ' + col);
      const txt = el('span', 'st-side-name', name); const rec = el('b', '', gs.length ? w + '–' + l + '–' + d : '–');
      r.append(dot, txt, wdlBar(w, l, d), rec); c.append(r);
    }
    return c;
  }
  function endingsCard(games) {
    const c = el('div', 'st-card'); c.append(el('span', 'st-label', 'How games ended'));
    const grid = el('div', 'st-endings');
    for (const [res, name] of [['w', 'Wins'], ['l', 'Losses'], ['d', 'Draws']]) {
      const col = el('div', 'st-end ' + res); col.append(el('b', '', name));
      const by = {}; games.filter((g) => g.result === res).forEach((g) => { const k = REASON[g.reason] || (g.reason ? g.reason : 'Other'); by[k] = (by[k] || 0) + 1; });
      const list = Object.entries(by).sort((a, b) => b[1] - a[1]);
      if (!list.length) col.append(el('span', 'st-muted', '—'));
      for (const [k, v] of list) { const r = el('span', ''); r.append(document.createTextNode(k + ' '), el('i', '', String(v))); col.append(r); }
      grid.append(col);
    }
    c.append(grid); return c;
  }
  function materialCard(games) {
    const tot = { took: {}, lost: {} }; let checks = 0, promos = 0, castled = 0, moves = 0, quickest = null;
    const played = games.filter((g) => g.fens.length > 1);
    for (const g of played) {
      const s = scan(g); moves += s.myMoves; checks += s.checks; promos += s.promos; if (s.castled) castled++;
      for (const t in s.took) tot.took[t] = (tot.took[t] || 0) + s.took[t];
      for (const t in s.lost) tot.lost[t] = (tot.lost[t] || 0) + s.lost[t];
      if (g.result === 'w' && (!quickest || s.myMoves < quickest)) quickest = s.myMoves;
    }
    const value = (o) => Object.entries(o).reduce((a, [t, n]) => a + VAL[t] * n, 0);
    const c = el('div', 'st-card'); c.append(el('span', 'st-label', 'Pieces'));
    for (const [k, o, cls] of [['Captured', tot.took, 'good'], ['Lost', tot.lost, 'bad']]) {
      const r = el('div', 'st-pieces ' + cls); r.append(el('span', 'st-pieces-name', k));
      const g = el('span', 'st-glyphs');
      for (const t of 'qrbnp') { const n = o[t] || 0; const s = el('span', n ? '' : 'zero'); s.append(el('em', '', GLYPH[t]), el('i', '', String(n))); g.append(s); }
      r.append(g, el('b', '', value(o) + ' pts')); c.append(r);
    }
    const facts = el('div', 'st-facts');
    for (const [k, v] of [['Avg. game', played.length ? Math.round(moves / played.length) + ' moves' : '–'], ['Quickest win', quickest ? quickest + ' moves' : '–'], ['Checks given', String(checks)], ['Promotions', String(promos)], ['Castled', played.length ? pct(castled, played.length) + '%' : '–']]) facts.append(row(k, v));
    c.append(facts); return c;
  }
  function qualityCard(games) {
    const c = el('div', 'st-card st-quality'); c.append(el('span', 'st-label', 'Your moves'));
    const body = el('div', 'st-q-body'); const note = el('span', 'st-muted', games.length ? 'Analysing…' : 'Play a game to see this.');
    c.append(body, note);
    const my = run;
    (async () => {
      const tot = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }; let worst = null, done = 0;
      const draw = () => {
        body.replaceChildren();
        const all = Object.values(tot).reduce((a, b) => a + b, 0);
        const acc = el('div', 'st-acc'); acc.append(el('b', '', all ? pct(tot.best + tot.good, all) + '%' : '–'), el('span', '', 'good or best'));
        const bars = el('div', 'st-qbars');
        for (const [k, name] of [['best', 'Best'], ['good', 'Good'], ['inaccuracy', 'Inaccuracies'], ['mistake', 'Mistakes'], ['blunder', 'Blunders']]) {
          const r = el('div', 'st-qrow ' + k); const track = el('span', 'st-qtrack'); const fill = el('i'); fill.style.width = (all ? (tot[k] / all) * 100 : 0) + '%'; track.append(fill);
          r.append(el('span', 'st-qname', name), track, el('b', '', String(tot[k]))); bars.append(r);
        }
        body.append(acc, bars);
        if (worst) body.append(el('span', 'st-worst', 'Biggest slip: ' + worst.move + ' ' + worst.san));
      };
      draw();
      for (const g of games) {
        if (my !== run) return;
        const q = await analyse(g, () => my !== run); if (!q) return;
        for (const k in tot) tot[k] += q[k] || 0; if (q.worst && (!worst || q.worst.loss > worst.loss)) worst = q.worst;
        done++; note.textContent = done < games.length ? 'Analysing ' + done + ' of ' + games.length + ' games…' : 'Graded by the built-in engine on this device.';
        draw();
      }
      if (!games.length) note.textContent = 'Play a game to see this.';
    })();
    return c;
  }
  function render(title, sub, games, extra) {
    run++;
    root.replaceChildren();
    const scroll = el('div', 'st-scroll');
    scroll.append(header(title, sub));
    if (extra) scroll.append(extra);
    scroll.append(recordCard(games, 'Record'), sideCard(games), endingsCard(games), materialCard(games), qualityCard(games));
    root.append(scroll); root.hidden = false; scroll.scrollTop = 0;
  }
  async function openPlayers(api, pid) {
    mount(); root.replaceChildren(el('div', 'st-loading', 'Loading your games…')); root.hidden = false; run++;
    const my = run;
    try { const games = await onlineGames(api, pid); if (my !== run) return; render('vs Players', 'All your online games', games); }
    catch (e) { root.replaceChildren(header('vs Players', ''), el('div', 'st-loading', 'Could not load games: ' + (e.message || e))); }
  }
  function openComputer(level = 0) {
    mount();
    const rec = window.familyChessCpuRecord?.() || { levels: {} };
    const all = cpuGames();
    const games = level ? all.filter((g) => g.level === level) : all;
    const lv = el('div', 'st-card st-levels'); lv.append(el('span', 'st-label', 'By level'));
    if (level) { const all = el('button', 'st-alllv', 'Showing level ' + level + ' · show all'); all.type = 'button'; all.addEventListener('click', () => openComputer(0)); lv.append(all); }
    else lv.append(el('span', 'st-muted', 'Tap a level to see its stats.'));
    for (let n = 1; n <= 5; n++) {
      const r0 = rec.levels?.[n] || { w: 0, l: 0, d: 0 };
      const r = el('button', 'st-level' + (n === level ? ' on' : '')); r.type = 'button'; r.addEventListener('click', () => openComputer(n === level ? 0 : n));
      r.append(el('span', 'st-lvnum', String(n)), wdlBar(r0.w, r0.l, r0.d), el('b', '', r0.w + '–' + r0.l + '–' + r0.d));
      lv.append(r);
    }
    render('vs Computer', level ? 'Level ' + level + ' · games on this device' : 'All levels · games on this device', games, lv);
  }
  /* ---------------- accuracy (0-100 per player, like chess.com / Lichess) ----------------
     Each move is scored by how much of the mover's winning chances it gave away compared with the
     engine's best move (Lichess's published formula), then a game score blends the average with the
     harmonic mean so a few big blunders weigh in properly. Runs on this device; cached per game. */
  const AKEY = 'chess.acc1.';
  const winPct = (cp) => { const c = Math.max(-1500, Math.min(1500, cp)); return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1); };
  function moveAcc(r, uci) {
    if (!r || !Number.isFinite(r.bestScore) || !Number.isFinite(r.playedScore)) return null;
    if (r.forced || r.move === uci) return 100;
    const drop = Math.max(0, winPct(r.bestScore) - winPct(Math.min(r.playedScore, r.bestScore)));
    return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669));
  }
  function gameAcc(list) {
    if (!list.length) return null;
    const mean = list.reduce((a, b) => a + b, 0) / list.length;
    const harm = list.length / list.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
    return Math.round(((mean + harm) / 2) * 10) / 10;
  }
  const accCached = (key) => { try { return JSON.parse(localStorage.getItem(AKEY + key) || 'null'); } catch { return null; } };
  const running = new Map();
  /* fens[i] is the position before move i (fens.length === moves.length + 1); moves are UCI */
  function accFor(key, fens, moves, onProgress) {
    const hit = accCached(key); if (hit) return Promise.resolve(hit);
    if (running.has(key)) return running.get(key);
    const job = (async () => {
      const per = { w: [], b: [] };
      for (let i = 0; i < moves.length; i++) {
        const side = fens[i].split(' ')[1] === 'b' ? 'b' : 'w';
        const r = await engine(fens[i], moves[i]); const a = moveAcc(r, moves[i]);
        if (a != null) per[side].push(a);
        try { onProgress?.(i + 1, moves.length); } catch { /* UI only */ }
      }
      const out = { w: gameAcc(per.w), b: gameAcc(per.b) };
      if (out.w != null || out.b != null) try { localStorage.setItem(AKEY + key, JSON.stringify(out)); } catch { /* memory only */ }
      return out;
    })().finally(() => running.delete(key));
    running.set(key, job);
    return job;
  }
  window.familyChessAccuracy = Object.freeze({ forGame: accFor, cached: accCached });
  window.familyChessStats = { openPlayers, openComputer, close };
})();
