/* Offline, opt-in game review using the existing chess engine in a separate Worker.
   No moves, positions or personal data are sent to an external analysis service. */
(() => {
  'use strict';
  const CACHE_VERSION = 'chess-review-estimate-v2:';
  let worker = null, workerURL = null, token = 0, steps = [], results = [];
  let signature = '', focusPly = 0, busy = false, error = '', onUpdate = () => {};
  let activeIndex = -1, timeoutId = 0;

  const hash = text => {
    let n = 2166136261;
    for (let i = 0; i < text.length; i++) {
      n ^= text.charCodeAt(i);
      n = Math.imul(n, 16777619);
    }
    return (n >>> 0).toString(36);
  };
  function save() {
    if (!signature || !results.length) return;
    try {
      localStorage.setItem(CACHE_VERSION + hash(signature),
        JSON.stringify({ signature, results }));
    } catch (_) { /* storage may be unavailable */ }
  }
  function load(sig, total) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_VERSION + hash(sig)) || 'null');
      if (cached && cached.signature === sig && Array.isArray(cached.results)) {
        return Array.from({ length: total }, (_, i) => {
          const r = cached.results[i];
          return r && r.played === steps[i]?.move && typeof r.depth === 'number' ? r : null;
        });
      }
    } catch (_) { /* ignore corrupt cache */ }
    return Array(total).fill(null);
  }
  function stop() {
    token++;
    if (timeoutId) { clearTimeout(timeoutId); timeoutId = 0; }
    if (worker) { worker.terminate(); worker = null; }
    if (workerURL) { URL.revokeObjectURL(workerURL); workerURL = null; }
    busy = false; activeIndex = -1;
  }
  function classify(r) {
    if (!r || !Number.isFinite(r.bestScore) || !Number.isFinite(r.playedScore) || !r.move)
      return { kind: 'unknown', label: 'Not enough analysis', loss: null };
    if (r.forced || r.played === r.move) return { kind: 'best', label: 'Best found', loss: 0 };
    const loss = Math.max(0, r.bestScore - r.playedScore);
    // Low-depth results are shown as provisional rather than branding a real move a mistake.
    if (r.depth < 3) return { kind: 'uncertain', label: 'Preliminary estimate', loss };
    if (r.bestScore > 98500 && r.playedScore < 98500)
      return { kind: 'blunder', label: 'Missed checkmate', loss };
    if (r.playedScore < -98500 && r.bestScore > -98500)
      return { kind: 'blunder', label: 'Allowed checkmate', loss };
    if (loss >= 500) return { kind: 'blunder', label: 'Blunder', loss };
    if (loss >= 225) return { kind: 'mistake', label: 'Mistake', loss };
    if (loss >= 100) return { kind: 'inaccuracy', label: 'Inaccuracy', loss };
    return { kind: 'good', label: 'Reasonable move', loss };
  }
  const get = ply => {
    if (!(ply >= 1 && ply <= results.length)) return null;
    const r = results[ply - 1];
    return r ? { ...r, ...classify(r) } : null;
  };
  const isIssue = r => r && ['inaccuracy', 'mistake', 'blunder'].includes(r.kind);
  function issues() {
    const all = [];
    for (let i = 0; i < results.length; i++) {
      const v = get(i + 1);
      if (isIssue(v)) all.push({ ply: i + 1, ...v });
    }
    return all;
  }
  function counts() {
    const totals = { w: { inaccuracy: 0, mistake: 0, blunder: 0 },
      b: { inaccuracy: 0, mistake: 0, blunder: 0 } };
    for (let i = 0; i < results.length; i++) {
      const x = get(i + 1);
      if (isIssue(x)) totals[i % 2 === 0 ? 'w' : 'b'][x.kind]++;
    }
    return totals;
  }
  function status() {
    return {
      done: results.filter(Boolean).length, total: steps.length,
      busy, error, complete: results.length > 0 && results.every(Boolean)
    };
  }
  function notify() { try { onUpdate(); } catch (_) { /* UI redraw must not stop engine */ } }
  function next(run) {
    if (run !== token || !worker) return;
    const unscored = [];
    for (let i = 0; i < steps.length; i++) if (!results[i]) unscored.push(i);
    if (!unscored.length) {
      save();
      busy = false;
      worker.terminate(); worker = null;
      if (workerURL) { URL.revokeObjectURL(workerURL); workerURL = null; }
      notify();
      return;
    }
    const target = Math.max(0, focusPly - 1);
    unscored.sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
    activeIndex = unscored[0];
    const step = steps[activeIndex];
    busy = true;
    worker.postMessage({ id: activeIndex + 1, fen: step.fen, analysisMove: step.move, level: 3,
      budget: 750 });
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      if (run !== token || activeIndex < 0) return;
      error = 'Analysis took too long on this device. You can still replay the game.';
      stop(); notify();
    }, 10000);
  }
  function start(items, source, update) {
    stop();
    error = '';
    onUpdate = typeof update === 'function' ? update : () => {};
    steps = items.map(x => ({ fen: x.fen, move: x.move }));
    signature = steps.map(x => x.move).join(',');
    focusPly = 0;
    results = load(signature, steps.length);
    notify();
    if (!steps.length || results.every(Boolean)) return;
    if (!window.Worker || !window.Blob) {
      error = 'This browser cannot run offline move analysis.';
      notify();
      return;
    }
    const run = token;
    try {
      workerURL = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      worker = new Worker(workerURL);
      worker.onerror = () => {
        if (run !== token) return;
        error = 'Move analysis could not start. Replay still works.';
        stop(); notify();
      };
      worker.onmessage = (event) => {
        if (run !== token) return;
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = 0; }
        const data = event.data || {};
        const i = Number(data.id) - 1;
        if (i !== activeIndex || i < 0 || i >= steps.length) return;
        results[i] = {
          played: steps[i].move, move: data.move || null,
          depth: Number(data.depth) || 0, nodes: Number(data.nodes) || 0,
          bestScore: Number.isFinite(data.bestScore) ? data.bestScore : null,
          playedScore: Number.isFinite(data.playedScore) ? data.playedScore : null,
          forced: !!data.forced
        };
        if (data.error) {
          error = 'The engine could not evaluate all positions.';
          stop(); notify(); return;
        }
        activeIndex = -1;
        if (results.filter(Boolean).length % 5 === 0) save();
        notify();
        next(run);
      };
      next(run);
    } catch (_) {
      error = 'This browser cannot start the review engine.';
      stop(); notify();
    }
  }
  function focus(ply) { focusPly = Math.max(0, ply || 0); }
  window.ChessReviewAnalyzer = Object.freeze({ start, stop, focus, get, issues, counts, status });
})();
