/* Stockfish 18 (lite, single-threaded WASM, GPL-3.0 — engine/COPYING.txt) for analysis only:
   game review, accuracy grades and hints. Loaded on first use; the built-in engine stays the opponent
   and is the fallback when this browser can't run WebAssembly.
   Scores are centipawns for the side to move; mate is ±(100000 - plies), so values past ±98500 are mates. */
(() => {
  const URL_SF = './engine/stockfish-18-lite-single.js?v=1';
  let worker = null, ready = null, failed = false, queue = Promise.resolve();
  let onLine = null;

  function boot() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      if (!window.WebAssembly || !window.Worker) { failed = true; reject(new Error('no wasm')); return; }
      let w;
      try { w = new Worker(URL_SF); } catch (e) { failed = true; reject(e); return; }
      const t = setTimeout(() => { failed = true; try { w.terminate(); } catch {} reject(new Error('timeout')); }, 20000);
      w.onerror = () => { clearTimeout(t); failed = true; reject(new Error('worker error')); };
      w.onmessage = (e) => {
        const line = String(e.data || '');
        if (line === 'readyok' && !worker) { clearTimeout(t); worker = w; resolve(w); return; }
        if (onLine) onLine(line);
      };
      w.postMessage('uci');
      w.postMessage('setoption name Hash value 32');
      w.postMessage('isready');
    });
    return ready;
  }

  /* one search: {fen, moves?, ms?, depth?, searchmoves?} -> {move, score, depth, pv} */
  function search({ fen, ms = 400, depth = 0, searchmoves = '' }) {
    const run = () => boot().then((w) => new Promise((resolve) => {
      let score = null, d = 0, pv = '';
      const guard = setTimeout(() => { w.postMessage('stop'); }, (ms || 3000) + 4000);
      onLine = (line) => {
        if (line.startsWith('info ') && line.includes(' score ')) {
          const p = line.split(' ');
          const i = p.indexOf('score'), kind = p[i + 1], v = Number(p[i + 2]);
          if (p.includes('lowerbound') || p.includes('upperbound')) return;
          score = kind === 'mate' ? (v > 0 ? 100000 - (2 * v - 1) : -100000 + (-2 * v)) : v;
          d = Number(p[p.indexOf('depth') + 1]) || d;
          const k = p.indexOf('pv'); if (k > 0) pv = p.slice(k + 1).join(' ');
        } else if (line.startsWith('bestmove')) {
          clearTimeout(guard); onLine = null;
          const m = line.split(' ')[1];
          resolve({ move: m && m !== '(none)' ? m : null, score, depth: d, pv });
        }
      };
      w.postMessage('position fen ' + fen);
      w.postMessage('go ' + (depth ? 'depth ' + depth : 'movetime ' + ms) + (searchmoves ? ' searchmoves ' + searchmoves : ''));
    }));
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  /* Same shape the built-in engine returns for {analysisMove}: best move, its score and the played move's score. */
  async function evalMove(fen, played, ms = 350) {
    const best = await search({ fen, ms });
    if (!best.move) return { move: null, bestScore: best.score ?? 0, playedScore: best.score ?? 0, depth: best.depth, forced: true };
    let playedScore = best.score;
    if (played && played !== best.move) playedScore = (await search({ fen, ms: Math.max(150, ms * 0.6), searchmoves: played })).score;
    let forced = false;
    try { const C = window.familyChessBoard?.Chess; if (C) forced = new C(fen).moves().length === 1; } catch {}
    return { move: best.move, bestScore: best.score, playedScore, depth: best.depth, nodes: 0, forced, pv: best.pv, engine: 'stockfish' };
  }

  function stop() { try { worker?.postMessage('stop'); } catch {} }
  function available() { return !failed && !!window.WebAssembly && !!window.Worker; }

  window.ChessStockfish = Object.freeze({ boot, search, evalMove, stop, available });
})();
