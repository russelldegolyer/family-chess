#!/usr/bin/env node
/* Builds exact endgame tables for K+Q v K, K+R v K and K+P v K (White is the stronger side).
   One byte per position: plies until Black is checkmated with best play (0 = Black is mated now),
   255 = draw, 254 = not a legal position. Index = ((wk*64 + bk)*64 + piece)*2 + sideToMove (0 White, 1 Black),
   squares a1=0 … h8=63. Output: endgame-kqk.bin, endgame-krk.bin, endgame-kpk.bin (524,288 bytes each).
   Run: node tools/build-endgame-tables.mjs   (takes a few seconds; the app only reads the files). */
import { writeFileSync } from 'node:fs';
const DRAW = 255, BAD = 254, N = 64 * 64 * 64 * 2;
const F = (s) => s & 7, R = (s) => s >> 3;
const adj = (a, b) => a !== b && Math.abs(F(a) - F(b)) <= 1 && Math.abs(R(a) - R(b)) <= 1;
const KM = Array.from({ length: 64 }, (_, s) => { const o = []; for (let d = 0; d < 64; d++) if (adj(s, d)) o.push(d); return o; });
const DIRS = { r: [[1, 0], [-1, 0], [0, 1], [0, -1]], b: [[1, 1], [1, -1], [-1, 1], [-1, -1]] };
DIRS.q = [...DIRS.r, ...DIRS.b];
/* does a slider of kind t on p attack d, with one blocking square */
function hits(t, p, d, block) {
  if (p === d) return false;
  const df = F(d) - F(p), dr = R(d) - R(p);
  const straight = df === 0 || dr === 0, diag = Math.abs(df) === Math.abs(dr);
  if (t === 'r' ? !straight : t === 'b' ? !diag : !(straight || diag)) return false;
  const sf = Math.sign(df), sr = Math.sign(dr);
  for (let f = F(p) + sf, r = R(p) + sr; f !== F(d) || r !== R(d); f += sf, r += sr) if (r * 8 + f === block) return false;
  return true;
}
const pawnHits = (p, d) => R(d) === R(p) + 1 && Math.abs(F(d) - F(p)) === 1;
const idx = (wk, bk, p, stm) => ((wk * 64 + bk) * 64 + p) * 2 + stm;

function build(t, promo) {
  const V = new Uint8Array(N).fill(DRAW);
  const attacks = (p, d, wk) => (t === 'p' ? pawnHits(p, d) : hits(t, p, d, wk));
  const legal = (wk, bk, p, stm) => {
    if (wk === bk || wk === p || bk === p || adj(wk, bk)) return false;
    if (t === 'p' && (R(p) === 0 || R(p) === 7)) return false;
    if (stm === 0 && attacks(p, bk, wk)) return false;
    return true;
  };
  /* children of a White-to-move position: values of the resulting Black-to-move positions */
  function whiteBest(wk, bk, p, limit) { /* is there a move reaching a position with value <= limit? */
    for (const d of KM[wk]) { if (d === p || adj(d, bk) || d === bk) continue; if (V[idx(d, bk, p, 1)] <= limit) return true; }
    if (t === 'p') {
      const one = p + 8;
      if (one !== wk && one !== bk) {
        if (R(one) === 7) { for (const tab of promo) { const v = tab[idx(wk, bk, one, 1)]; if (v <= limit) return true; } }
        else {
          if (V[idx(wk, bk, one, 1)] <= limit) return true;
          const two = p + 16;
          if (R(p) === 1 && two !== wk && two !== bk && V[idx(wk, bk, two, 1)] <= limit) return true;
        }
      }
      return false;
    }
    for (const [df, dr] of DIRS[t]) {
      for (let f = F(p) + df, r = R(p) + dr; f >= 0 && f < 8 && r >= 0 && r < 8; f += df, r += dr) {
        const d = r * 8 + f; if (d === wk || d === bk) break;
        if (V[idx(wk, bk, d, 1)] <= limit) return true;
      }
    }
    return false;
  }
  /* Black to move: [number of legal moves, can reach a draw, worst (largest) child value] */
  function blackLook(wk, bk, p) {
    let n = 0, draw = false, worst = 0;
    for (const d of KM[bk]) {
      if (d === wk || adj(d, wk)) continue;
      if (d === p) { n++; draw = true; continue; } /* takes the last piece (it is undefended: d is not next to wk) */
      if (attacks(p, d, wk)) continue;
      n++; const v = V[idx(wk, d, p, 0)];
      if (v >= BAD) draw = true; else if (v > worst) worst = v;
    }
    return [n, draw, worst];
  }
  for (let wk = 0; wk < 64; wk++) for (let bk = 0; bk < 64; bk++) for (let p = 0; p < 64; p++) for (let s = 0; s < 2; s++) if (!legal(wk, bk, p, s)) V[idx(wk, bk, p, s)] = BAD;
  /* a promoted position must be legal in the target table; BAD there simply never satisfies "<= limit" (254 > limit) */
  for (let wk = 0; wk < 64; wk++) for (let bk = 0; bk < 64; bk++) for (let p = 0; p < 64; p++) {
    const i = idx(wk, bk, p, 1); if (V[i] === BAD) continue;
    const [n] = blackLook(wk, bk, p);
    if (n === 0 && attacks(p, bk, wk)) V[i] = 0;
  }
  for (let ply = 1, idle = 0; idle < 2 && ply < 250; ply++) {
    let changed = 0; const s = ply & 1 ? 0 : 1;
    for (let wk = 0; wk < 64; wk++) for (let bk = 0; bk < 64; bk++) for (let p = 0; p < 64; p++) {
      const i = idx(wk, bk, p, s); if (V[i] !== DRAW) continue;
      if (s === 0) { if (whiteBest(wk, bk, p, ply - 1)) { V[i] = ply; changed++; } }
      else { const [n, draw, worst] = blackLook(wk, bk, p); if (n && !draw && worst <= ply - 1) { V[i] = ply; changed++; } }
    }
    idle = changed ? 0 : idle + 1;
  }
  return V;
}
const t0 = Date.now();
const KQK = build('q'), KRK = build('r'), KPK = build('p', [KQK, KRK]);
const out = new URL('../', import.meta.url);
writeFileSync(new URL('endgame-kqk.bin', out), KQK); writeFileSync(new URL('endgame-krk.bin', out), KRK); writeFileSync(new URL('endgame-kpk.bin', out), KPK);
const stat = (V) => { let w = 0, d = 0, mx = 0; for (let i = 0; i < N; i++) { const v = V[i]; if (v === DRAW) d++; else if (v < BAD) { w++; if (v > mx) mx = v; } } return `wins ${w}, draws ${d}, longest ${mx} plies`; };
console.log('KQK', stat(KQK)); console.log('KRK', stat(KRK)); console.log('KPK', stat(KPK)); console.log((Date.now() - t0) + ' ms');
