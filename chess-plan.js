/* Your plan: reads a finished game from one player's side and says, phase by phase, what they were trying to do,
   how it went, and one concrete way to do it better. Plain rules over the moves (plus the accuracy pass when it
   has run) — no outside service. Also produces compact tags for the style profile in Training.
   API: window.familyChessPlan = { read({ Chess, moves, side, acc, result }), open(read, { onPly, onPractise }) } */
(() => {
  'use strict';
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const NAMEP = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const FILES = 'abcdefgh';
  const fileOf = (sq) => FILES.indexOf(sq[0]), rankOf = (sq) => Number(sq[1]);
  const other = (c) => (c === 'w' ? 'b' : 'w');
  const moveNo = (ply) => Math.ceil(ply / 2);
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  /* where each finding sends you to practise (Training chapter or Academy lesson) */
  const FIX = {
    hung:        { chapter: 'd1', title: 'Guard your pieces', what: 'Left a piece unprotected' },
    forked:      { chapter: 'd3', title: 'Forks and pins coming', what: 'Walked into a fork or pin' },
    backRank:    { chapter: 'd2', title: 'Back-rank danger', what: 'Back-rank weakness' },
    mated:       { chapter: 'd4', title: 'Escaping mate threats', what: 'Missed a mate threat' },
    missedMate:  { chapter: 'c1', title: 'Checkmate basics', what: 'Missed a checkmate' },
    missedFree:  { chapter: 'c2', title: 'Free pieces', what: 'Missed a free piece' },
    missedFork:  { chapter: 'c3', title: 'Forks', what: 'Missed a fork' },
    passiveKing: { lesson: 's2', title: 'King activity', what: 'Passive king in the endgame' },
    tradeBehind: { lesson: 's4', title: 'Trading down', what: 'Traded pieces while behind' },
    slowDev:     { title: '', what: 'Slow development' },
    earlyQueen:  { title: '', what: 'Queen out too early' },
    drift:       { title: '', what: 'Moves without a target' },
    missedBest:  { title: '', what: 'Missed a much better move' },
  };
  const ORDER = ['hung', 'forked', 'backRank', 'mated', 'missedMate', 'missedFree', 'missedFork', 'passiveKing', 'tradeBehind', 'drift', 'slowDev', 'earlyQueen', 'missedBest'];
  const PLAN_NAME = {
    center: 'Took the centre', develop: 'Quick development', castle: 'Castled early',
    attackK: 'Kingside attack', attackQ: 'Queenside attack', wing: 'Play on one wing', centre: 'Central play',
    simplify: 'Traded down while ahead', trades: 'Traded pieces', hunt: 'Won material', checks: 'Lots of checks',
    defend: 'Defended under pressure', rooks: 'Rooks to open files', drift: 'No clear target',
    passer: 'Pushed a passed pawn', kingUp: 'Active king', convert: 'Converted extra material', promote: 'Made a queen',
  };

  function material(c) {
    const m = { w: 0, b: 0, np: 0 };
    for (const row of c.board()) for (const p of row) if (p) { m[p.color] += VAL[p.type]; if (p.type !== 'p' && p.type !== 'k') m.np += VAL[p.type]; }
    return m;
  }
  /* pieces of `victim` (value >= 3, or the king when it is check) attacked by the piece standing on sq */
  function hitsFrom(Chess, fen, sq, attacker) {
    try {
      const parts = fen.split(' '); parts[1] = attacker; parts[3] = '-';
      const x = new Chess(); x.load(parts.join(' '), { skipValidation: true });
      const own = x.get(sq); if (!own) return [];
      return x.moves({ square: sq, verbose: true }).filter((m) => m.captured && (m.captured === 'k' || VAL[m.captured] >= 3) && (m.captured === 'k' || VAL[m.captured] >= VAL[own.type] || own.type === 'p' || own.type === 'n')).map((m) => m.to);
    } catch { return []; }
  }
  function isPassed(c, sq, color) {
    const f = fileOf(sq), r = rankOf(sq);
    for (const row of c.board()) for (const p of row) {
      if (!p || p.type !== 'p' || p.color === color) continue;
      const pf = fileOf(p.square), pr = rankOf(p.square);
      if (Math.abs(pf - f) <= 1 && (color === 'w' ? pr > r : pr < r)) return false;
    }
    return true;
  }
  /* what the better move did: checkmate, a free piece or a fork */
  function classifyBest(Chess, fen, uci) {
    try {
      const c = new Chess(fen); const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
      if (c.isCheckmate()) return 'missedMate';
      if (mv.captured && VAL[mv.captured] >= 3 && !c.moves({ verbose: true }).some((m) => m.to === mv.to)) return 'missedFree';
      const t = new Set(hitsFrom(Chess, c.fen(), mv.to, mv.color)).size + (c.inCheck() ? 1 : 0);
      if (t >= 2) return 'missedFork';
    } catch { /* odd position */ }
    return 'missedBest';
  }

  function read({ Chess, moves, side, acc = null, result = null, fens = null }) {
    /* fens (optional): the position before each move — covers custom starts and pawn-for-time removals */
    const c = fens && fens[0] ? new Chess(fens[0]) : new Chess(); const H = [];
    for (let i = 0; i < moves.length; i++) {
      if (fens && fens[i] && fens[i] !== c.fen()) { try { c.load(fens[i]); } catch { break; } }
      const u = moves[i], before = c.fen();
      let mv; try { mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); } catch { break; }
      if (!mv) break;
      const m = material(c);
      H.push({ ply: i + 1, mv, before, after: c.fen(), diff: side === 'w' ? m.w - m.b : m.b - m.w, np: m.np, check: c.inCheck(), mate: c.isCheckmate() });
    }
    const n = H.length; if (n < 6) return null;
    const diffAt = (ply) => (ply <= 0 ? 0 : H[Math.min(ply, n) - 1].diff);
    const mine = (h) => h.mv.color === side;
    const drop = (ply) => (acc?.drops ? acc.drops[ply - 1] || 0 : 0);

    /* phases: opening = first 10 moves (or until the endgame), endgame = little material left */
    let eStart = H.findIndex((h) => h.np <= 26) + 1; if (eStart <= 0) eStart = n + 1;
    const oEnd = Math.min(20, n, eStart - 1);
    const ranges = [['opening', 'Opening', 1, oEnd], ['middlegame', 'Middlegame', oEnd + 1, eStart - 1], ['endgame', 'Endgame', eStart, n]];

    const issues = [];
    const addIssue = (code, ply, text) => { if (!issues.some((x) => x.code === code && Math.abs(x.ply - ply) < 4)) issues.push({ code, ply, text }); };

    /* ---- losses of material right after your move: hung piece, or a fork/pin you walked into ---- */
    for (let i = 0; i < n; i++) {
      const h = H[i]; if (!mine(h)) continue;
      const base = diffAt(h.ply - 1), later = diffAt(Math.min(n, h.ply + 3)), nx = H[i + 1];
      if (!nx || base - later < 2) continue;
      /* a trade you started is not a loss unless it was a bad one (counted by the net loss above) */
      const forkedBy = hitsFrom(Chess, nx.after, nx.mv.to, nx.mv.color);
      if (!nx.mv.captured && (new Set(forkedBy).size + (nx.check ? 1 : 0)) >= 2) { addIssue('forked', nx.ply, 'Move ' + moveNo(nx.ply) + ': ' + nx.mv.san + ' hit two of your pieces at once, and one was lost.'); continue; }
      if (nx.mv.captured && VAL[nx.mv.captured] >= 3) {
        const back = H[i + 2]; const recaptured = back && back.mv.to === nx.mv.to && back.mv.captured;
        if (h.mv.captured && h.mv.to === nx.mv.to) {   /* you captured, they took back: a bad trade, not a hung piece */
          if (VAL[nx.mv.captured] - VAL[h.mv.captured] >= 2) addIssue('hung', h.ply, 'Move ' + moveNo(h.ply) + ': ' + h.mv.san + ' gave your ' + NAMEP[nx.mv.captured] + ' for a ' + NAMEP[h.mv.captured] + ' — the square was defended.');
        } else if (!recaptured || base - later >= 3) addIssue('hung', h.ply, 'After move ' + moveNo(h.ply) + ' (' + h.mv.san + '), your ' + NAMEP[nx.mv.captured] + ' on ' + nx.mv.to + ' was taken' + (recaptured ? ' for less than it was worth.' : ' for free.'));
      }
    }
    /* ---- how the game ended ---- */
    const last = H[n - 1];
    if (last.mate && !mine(last)) {
      const back = side === 'w' ? 1 : 8;
      if ((last.mv.piece === 'r' || last.mv.piece === 'q') && rankOf(last.mv.to) === back) addIssue('backRank', last.ply, 'You were mated on your back rank (' + last.mv.san + '). The king had no escape square.');
      else addIssue('mated', last.ply, 'You were checkmated by ' + last.mv.san + '. The threat was there a move earlier.');
    }
    /* ---- missed chances from the accuracy pass ---- */
    if (acc?.big) {
      for (const b of acc.big.filter((x) => (x.ply % 2 === 1) === (side === 'w') && x.drop >= 15 && x.best).slice(0, 4)) {
        const h = H[b.ply - 1]; if (!h) continue;
        const code = classifyBest(Chess, h.before, b.best);
        let san = b.best; try { san = new Chess(h.before).move({ from: b.best.slice(0, 2), to: b.best.slice(2, 4), promotion: b.best[4] || undefined }).san; } catch { /* keep uci */ }
        addIssue(code, b.ply, 'Move ' + moveNo(b.ply) + ': ' + h.mv.san + ' — ' + san + ' was much stronger' + ({ missedMate: ' (checkmate).', missedFree: ' (it won a piece for free).', missedFork: ' (a fork).' }[code] || '.'));
      }
    }

    /* ---- phase by phase ---- */
    const phases = [];
    for (const [key, name, from, to] of ranges) {
      if (to < from) continue;
      const own = H.slice(from - 1, to).filter(mine);
      if (own.length < 2) continue;
      const P = { key, name, from, to, plans: [], aim: '', how: '', better: '', verdict: 'mixed', ply: own[0].ply };
      const d0 = diffAt(from - 1), d1 = diffAt(to), delta = d1 - d0;
      const lossList = own.map((h) => drop(h.ply)); const worst = own.reduce((a, h) => (drop(h.ply) > drop(a.ply) ? h : a), own[0]);
      P.loss = lossList.length ? Math.round(lossList.reduce((a, b) => a + b, 0) / lossList.length * 10) / 10 : 0;
      P.ply = drop(worst.ply) >= 12 ? worst.ply : own[Math.floor(own.length / 2)].ply;
      const aims = [], probs = [];
      if (key === 'opening') {
        const homes = side === 'w' ? ['b1', 'g1', 'c1', 'f1'] : ['b8', 'g8', 'c8', 'f8'];
        const dev = new Set(own.filter((h) => homes.includes(h.mv.from) && 'nb'.includes(h.mv.piece)).map((h) => h.mv.from)).size;
        const castle = own.find((h) => /^O-O/.test(h.mv.san));
        const center = own.filter((h) => h.mv.piece === 'p' && ['d4', 'e4', 'd5', 'e5', 'c4', 'c5'].includes(h.mv.to)).length;
        const queen = own.filter((h) => h.mv.piece === 'q' && h.ply <= 14).length;
        const flank = own.filter((h) => h.mv.piece === 'p' && 'abgh'.includes(h.mv.to[0]) && Math.abs(rankOf(h.mv.to) - rankOf(h.mv.from)) === 2).length + own.filter((h) => h.mv.piece === 'p' && 'ah'.includes(h.mv.to[0])).length;
        if (center) { aims.push('take the centre with pawns'); P.plans.push('center'); }
        if (dev >= 3) { aims.push('get your knights and bishops out'); P.plans.push('develop'); }
        if (castle) { aims.push('castle by move ' + moveNo(castle.ply)); P.plans.push('castle'); }
        if (!aims.length) aims.push('get your pieces moving');
        if (dev < 2 && to >= 16) { probs.push('slowDev'); addIssue('slowDev', to, 'By move ' + moveNo(to) + ' only ' + plural(dev, 'knight or bishop') + ' had moved.'); }
        if (queen >= 3) { probs.push('earlyQueen'); addIssue('earlyQueen', own.find((h) => h.mv.piece === 'q').ply, 'The queen moved ' + queen + ' times in the first moves, where it can be chased around.'); }
        if (flank >= 3) probs.push('flank');
        P.aim = 'You set out to ' + list(aims) + '.';
        P.better = probs.includes('slowDev') ? 'Bring out a knight or bishop with almost every early move, and castle before starting anything.'
          : probs.includes('earlyQueen') ? 'Keep the queen home for the first few moves; develop the small pieces first so she is not chased with tempo.'
          : probs.includes('flank') ? 'Edge-pawn moves rarely help early on. Centre pawns, knights and bishops first.'
          : !castle && to >= 16 ? 'Castle earlier — your king in the centre becomes a target once lines open.'
          : 'Solid start. Next step: have a reason for each move — which square or piece does it aim at?';
      } else if (key === 'middlegame') {
        const opp = other(side), oppK = (() => { try { const x = new Chess(H[from - 1].before); for (const row of x.board()) for (const p of row) if (p && p.type === 'k' && p.color === opp) return p.square; } catch { } return 'e8'; })();
        const enemyHalf = (sq) => (side === 'w' ? rankOf(sq) >= 5 : rankOf(sq) <= 4);
        const fwd = own.filter((h) => h.mv.piece !== 'k' && enemyHalf(h.mv.to));
        const wing = (sq) => (fileOf(sq) >= 5 ? 'k' : fileOf(sq) <= 2 ? 'q' : 'c');
        const cnt = { k: 0, q: 0, c: 0 }; fwd.forEach((h) => cnt[wing(h.mv.to)]++);
        const storm = own.filter((h) => h.mv.piece === 'p' && wing(h.mv.to) === wing(oppK) && wing(oppK) !== 'c').length;
        const kw = wing(oppK);
        const trades = []; for (let i = from - 1; i < to - 1; i++) { const a = H[i], b = H[i + 1]; if (a.mv.captured && b.mv.captured && b.mv.to === a.mv.to && VAL[a.mv.captured] >= 3) trades.push(a); }
        const ahead = d0 >= 2, behind = d0 <= -2;
        const checks = own.filter((h) => h.check).length;
        const shuffles = own.filter((h, i) => i >= 2 && own.slice(Math.max(0, i - 3), i).some((g) => g.mv.to === h.mv.from && g.mv.from === h.mv.to)).length;
        const back = own.filter((h) => h.mv.piece !== 'p' && (side === 'w' ? rankOf(h.mv.to) < rankOf(h.mv.from) : rankOf(h.mv.to) > rankOf(h.mv.from))).length;
        const rooks = own.filter((h) => h.mv.piece === 'r' && (() => { try { const x = new Chess(h.after); for (let r = 1; r <= 8; r++) { const p = x.get(h.mv.to[0] + r); if (p && p.type === 'p') return false; } return true; } catch { return false; } })()).length;
        if (fwd.length >= 3 && kw !== 'c' && cnt[kw] / fwd.length >= 0.45) { aims.push('attack the king on the ' + (kw === 'k' ? 'kingside' : 'queenside') + (storm >= 2 ? ', with a pawn storm' : '')); P.plans.push(kw === 'k' ? 'attackK' : 'attackQ'); }
        else if (fwd.length >= 3 && (cnt.k / fwd.length >= 0.55 || cnt.q / fwd.length >= 0.55)) { aims.push('press on the ' + (cnt.k > cnt.q ? 'kingside' : 'queenside')); P.plans.push('wing'); }
        else if (fwd.length >= 3 && cnt.c / fwd.length >= 0.5) { aims.push('play through the centre'); P.plans.push('centre'); }
        if (trades.length >= 2) { aims.push(ahead ? 'trade pieces while ahead' : 'trade pieces off'); P.plans.push(ahead ? 'simplify' : 'trades'); if (behind) { probs.push('tradeBehind'); addIssue('tradeBehind', trades[0].ply, 'You traded ' + plural(trades.length, 'piece') + ' while behind in material, which makes the opponent\'s job easier.'); } }
        if (rooks >= 1) { aims.push('put rooks on open files'); P.plans.push('rooks'); }
        if (checks >= 4) { P.plans.push('checks'); probs.push('checks'); }
        if (shuffles >= 2) { P.plans.push('drift'); probs.push('drift'); addIssue('drift', own.find((h, i) => i >= 2 && own.slice(Math.max(0, i - 3), i).some((g) => g.mv.to === h.mv.from && g.mv.from === h.mv.to))?.ply || from, 'Pieces moved back and forth ' + shuffles + ' times without a target.'); }
        if (back / own.length >= 0.45 && own.length >= 5) { aims.push('hold off pressure'); P.plans.push('defend'); }
        if (!aims.length) { aims.push('improve pieces one move at a time'); if (!P.plans.includes('drift')) P.plans.push('drift'); probs.push('noPlan'); }
        P.aim = 'You were trying to ' + list(aims) + '.';
        const main = P.plans[0];
        P.betterFn = (verdict) => verdict === 'bad' && (main === 'attackK' || main === 'attackQ') ? 'Before attacking, count: bring more attackers near the king than it has defenders, and keep your own pieces protected while you do.'
          : (main === 'attackK' || main === 'attackQ') ? 'Good aim. Once the king is exposed, look at every check and capture each move — that is where the attack finishes.'
          : probs.includes('tradeBehind') ? 'When you\'re behind, avoid trades. Keep pieces on and look for tactics; when you\'re ahead, trade.'
          : main === 'simplify' ? 'Right idea — trading when you\'re ahead makes the win easier. Keep going until it\'s a simple pawn ending.'
          : (probs.includes('drift') || probs.includes('noPlan')) && verdict === 'good' ? 'It worked out, but the plan was hard to see. Next time pick one target — a weak pawn, an open file, or the king — and aim every move at it.'
          : probs.includes('drift') || probs.includes('noPlan') ? 'Pick one target — a weak pawn, an open file, or the enemy king — and make each move bring a piece closer to it.'
          : probs.includes('checks') && verdict !== 'good' ? 'Checks feel strong but often just push the king to safety. Check only when it wins something or leads somewhere.'
          : main === 'defend' ? 'Under pressure, first ask what your opponent threatens, then answer it — and swap off their most dangerous attacker.'
          : main === 'centre' ? 'Holding the centre is good. Next: use it — rooks to open files and pieces aimed at the king.'
          : 'Keep asking each move: what is my opponent threatening, and which of my pieces is doing the least?';
      } else {
        const kingMoves = own.filter((h) => h.mv.piece === 'k').length;
        const passers = own.filter((h) => h.mv.piece === 'p' && (() => { try { return isPassed(new Chess(h.after), h.mv.to, side); } catch { return false; } })()).length;
        const promo = own.find((h) => h.mv.promotion);
        if (d0 >= 3) { aims.push('turn your extra material into a win'); P.plans.push('convert'); }
        if (passers >= 2) { aims.push('push a passed pawn'); P.plans.push('passer'); }
        if (promo) P.plans.push('promote');
        if (kingMoves >= Math.max(2, own.length * 0.25)) { aims.push('use your king'); P.plans.push('kingUp'); }
        else if (own.length >= 6 && kingMoves <= 1) { probs.push('passiveKing'); addIssue('passiveKing', own[0].ply, 'In the endgame your king moved ' + plural(kingMoves, 'time') + ' in ' + own.length + ' moves.'); }
        if (!aims.length) aims.push('hold the position');
        P.aim = 'In the endgame you tried to ' + list(aims) + '.';
        P.better = probs.includes('passiveKing') ? 'In the endgame the king is a strong piece. Walk it to the centre or toward the pawns early.'
          : P.plans.includes('passer') && !promo ? 'Passed pawns must be pushed — but escort them with your king or a rook behind them.'
          : P.plans.includes('convert') ? 'When ahead, trade pieces (not pawns), create a passed pawn, and bring your king.'
          : 'Count pawns on each side; the side with a passed pawn or the more active king usually wins.';
      }
      /* how it went */
      const lost = d0 - d1, maxDrop = drop(worst.ply);
      const endedHere = to === n && last.mate;
      if (endedHere && mine(last)) { P.verdict = 'good'; P.how = 'It worked — you finished with checkmate (' + last.mv.san + ').'; }
      else if (endedHere) { P.verdict = 'bad'; P.how = 'It ended in checkmate against you (' + last.mv.san + ').'; }
      else if (delta >= 2) { P.verdict = 'good'; P.how = 'It worked — you came out ' + (d1 > 0 ? plural(d1, 'point') + ' ahead' : 'with ' + plural(delta, 'point') + ' won back') + '.'; }
      else if (lost >= 2) { P.verdict = 'bad'; const w = own.filter((h) => diffAt(h.ply + 2) < diffAt(h.ply - 1)).sort((a, b) => (diffAt(a.ply + 2) - diffAt(a.ply - 1)) - (diffAt(b.ply + 2) - diffAt(b.ply - 1)))[0] || worst; P.ply = w.ply; P.how = 'It stalled — you lost ' + plural(lost, 'point') + ' of material, mostly around move ' + moveNo(w.ply) + ' (' + w.mv.san + ').'; }
      else if (maxDrop >= 25) { P.verdict = 'bad'; P.how = 'Material stayed close, but move ' + moveNo(worst.ply) + ' (' + worst.mv.san + ') gave a lot away.'; }
      else { P.verdict = acc?.drops && P.loss <= 4 ? 'good' : 'mixed'; P.how = d1 === 0 ? 'Material stayed level' + (P.verdict === 'good' ? ', and you played it accurately.' : '.') : 'Material stayed about the same (' + (d1 > 0 ? '+' : '') + d1 + ').'; }
      if (P.betterFn) { P.better = P.betterFn(P.verdict); delete P.betterFn; }
      phases.push(P);
    }

    /* the one thing to fix: the most costly finding that has practice behind it */
    const ranked = issues.slice().sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code));
    const top = ranked[0] || null;
    const tip = top ? { ...top, ...FIX[top.code] } : null;
    const counts = {}; for (const x of issues) counts[x.code] = (counts[x.code] || 0) + 1;
    const loss = {}; for (const p of phases) loss[p.key] = p.loss;
    const plans = [...new Set(phases.flatMap((p) => p.plans))];
    return { side, plies: n, result, phases, issues: ranked, tip, tags: { plans, issues: counts, loss, verdicts: Object.fromEntries(phases.map((p) => [p.key, p.verdict])) } };
  }
  function list(a) { return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function headline(R) {
    if (!R) return '';
    const names = R.tags.plans.filter((p) => !['drift', 'checks'].includes(p)).slice(0, 2).map((p) => PLAN_NAME[p]);
    return names.length ? names.join(' · ') : 'No single plan';
  }

  /* ---- the sheet ---- */
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  function open(R, { onPly, onPractise, title } = {}) {
    if (!R) return;
    document.querySelector('.pl-ov')?.remove();
    const ov = el('div', 'pl-ov'), sh = el('section', 'pl-sheet'); sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-label', 'Your game, read');
    const close = () => { ov.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
    const head = el('div', 'pl-head'); head.append(el('i', 'pl-grab'));
    const h = el('div', 'pl-title'); h.append(el('h2', '', title || 'Your game, read'), el('span', 'pl-sub', headline(R)));
    const x = el('button', 'pl-x'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>'; x.addEventListener('click', close);
    head.append(h, x); sh.append(head);
    if (R.tip) {
      const t = el('div', 'pl-tip'); t.append(el('span', 'pl-label', 'Fix this next'), el('b', '', R.tip.what), el('p', '', R.tip.text));
      const row = el('div', 'pl-row');
      if (onPly) { const b = el('button', 'pl-btn', 'See move ' + moveNo(R.tip.ply)); b.type = 'button'; b.addEventListener('click', () => { close(); onPly(R.tip.ply); }); row.append(b); }
      if (onPractise && (R.tip.chapter || R.tip.lesson)) { const b = el('button', 'pl-btn primary', 'Practise: ' + R.tip.title + ' ›'); b.type = 'button'; b.addEventListener('click', () => { close(); onPractise(R.tip); }); row.append(b); }
      if (row.childNodes.length) t.append(row);
      sh.append(t);
    }
    for (const p of R.phases) {
      const card = el('div', 'pl-phase ' + p.verdict);
      const top = el('div', 'pl-ph-top'); top.append(el('b', '', p.name), el('span', 'pl-moves', 'Moves ' + moveNo(p.from) + '–' + moveNo(p.to)), el('span', 'pl-verdict', { good: 'Worked', bad: 'Stalled', mixed: 'Even' }[p.verdict]));
      card.append(top);
      const tags = el('div', 'pl-tags'); p.plans.slice(0, 3).forEach((k) => tags.append(el('span', 'pl-tag' + (k === 'drift' ? ' warn' : ''), PLAN_NAME[k] || k))); if (tags.childNodes.length) card.append(tags);
      const dl = el('dl', 'pl-dl');
      const add = (k, v) => { dl.append(el('dt', '', k), el('dd', '', v)); };
      add('Aim', p.aim); add('How it went', p.how); add('Do better', p.better);
      card.append(dl);
      if (onPly) { const b = el('button', 'pl-link', 'See it on the board ›'); b.type = 'button'; b.addEventListener('click', () => { close(); onPly(p.ply); }); card.append(b); }
      sh.append(card);
    }
    if (R.issues.length > 1) {
      const more = el('div', 'pl-more'); more.append(el('span', 'pl-label', 'Also noticed'));
      const ul = el('ul'); R.issues.slice(1, 5).forEach((i) => { const li = el('li'); li.append(el('b', '', FIX[i.code].what + ' · '), document.createTextNode(i.text)); if (onPly) { li.classList.add('tap'); li.addEventListener('click', () => { close(); onPly(i.ply); }); } ul.append(li); });
      more.append(ul); sh.append(more);
    }
    sh.append(el('p', 'pl-foot', 'Read from your moves by simple rules' + (R.tags.loss && Object.keys(R.tags.loss).length ? ' and the accuracy check' : '') + ' — a guide to what you were doing, not a grandmaster\'s verdict.'));
    ov.append(sh); document.body.append(ov);
  }
  window.familyChessPlan = Object.freeze({ read, open, headline, FIX, PLAN_NAME, ORDER });
})();
