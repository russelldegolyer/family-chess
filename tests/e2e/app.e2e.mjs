/* Browser tests: drive the real app in headless Chromium with an in-memory Supabase stand-in.
   Run: python3 -m http.server 8124 (repo root) & node --test tests/e2e/*.e2e.mjs   (needs `npm i playwright`; CI runs it on every push) */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.CHESS_URL || 'http://127.0.0.1:8124/';
const MOCK = readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8');
let browser;
before(async () => { browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); });
after(async () => { await browser?.close(); });

async function open({ width = 1200, height = 800, store = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700 });
  await ctx.addInitScript((s) => { window.__mockCfg = { signedIn: true }; for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); }, store);
  await ctx.route('**/*', (r) => r.request().url().includes('@supabase/supabase-js') ? r.fulfill({ contentType: 'application/javascript', body: MOCK }) : r.continue());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 30000 });
  await page.evaluate(() => document.getElementById('cgClose')?.click());
  await page.waitForTimeout(800);
  return { page, ctx, errors };
}
async function startCpu(page) {
  await page.evaluate(() => document.getElementById('pgWhite').click());
  await page.waitForFunction(() => window.familyChessBoard && !document.body.classList.contains('pregame'), null, { timeout: 10000 });
  if (await page.evaluate(() => familyChessBoard.view()) !== '2d') { await page.evaluate(() => familyChessBoard.setView('2d')); await page.waitForTimeout(600); }
  const box = await page.evaluate(() => {
    const rs = [...document.querySelectorAll('#board2d .b2svg rect')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 20 && r.width < 140 && Math.abs(r.width - r.height) < 1);
    const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y)); return { x, y, w: Math.max(...rs.map((r) => r.right)) - x };
  });
  return async (sq) => { const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1; await page.mouse.click(box.x + box.w * (f + 0.5) / 8, box.y + box.w * (7 - r + 0.5) / 8); await page.waitForTimeout(250); };
}
const FAST = { 'sg.view': '2d', 'sg.mode': 'instant', 'sg.cpuSpeed': 'instant' };

test('home screen shows the Challenges and Online buttons', async () => {
  const { page, ctx, errors } = await open({ width: 390, height: 844 });
  const vis = await page.evaluate(() => ['.train-top', '#cgLaunch, .auth-account-toggle'].map((s) => [...document.querySelectorAll(s)].some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })));
  assert.deepEqual(vis, [true, true]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a game against the computer: you move, it replies', async () => {
  const { page, ctx, errors } = await open({ store: FAST });
  const click = await startCpu(page);
  await click('e2'); await click('e4');
  await page.waitForFunction(() => familyChessBoard.moves().length >= 2, null, { timeout: 15000, polling: 200 }).catch(async (e) => { console.log('moves', await page.evaluate(() => familyChessBoard.moves())); throw e; });
  assert.equal((await page.evaluate(() => familyChessBoard.moves()))[0], 'e2e4');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a premove plays as soon as it is your turn', async () => {
  const { page, ctx, errors } = await open({ store: { ...FAST, 'sg.cpuSpeed': 'slow' } });
  const click = await startCpu(page);
  await click('e2'); await click('e4');
  await click('g1'); await click('f3');
  await page.waitForFunction(() => familyChessBoard.moves().length >= 3, null, { timeout: 20000, polling: 200 });
  assert.equal((await page.evaluate(() => familyChessBoard.moves()))[2], 'g1f3');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('settings open and close; a PGN can be set up and copied back', async () => {
  const { page, ctx, errors } = await open({ store: FAST });
  await startCpu(page);
  const settings = async () => { await page.evaluate(() => document.getElementById('btnMenu').click()); await page.waitForTimeout(300); await page.evaluate(() => [...document.querySelectorAll('button,[role=menuitem]')].find((e) => /^Settings/.test(e.textContent.trim()))?.click()); await page.waitForSelector('.settings-card'); };
  await settings();
  await page.evaluate(() => [...document.querySelectorAll('.set-pick')].find((b) => b.textContent === 'Set up…').click());
  await page.fill('textarea', '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Play computer').click());
  await page.waitForFunction(() => familyChessBoard.moves().length >= 6, null, { polling: 200 });
  await settings();
  const pgn = await page.evaluate(async () => { let t = ''; navigator.clipboard.writeText = (x) => { t = x; return Promise.resolve(); }; [...document.querySelectorAll('.set-pick')].find((b) => b.textContent === 'Copy PGN').click(); await new Promise((r) => setTimeout(r, 100)); return t; });
  assert.match(pgn, /1\. e4 e5 2\. Nf3 Nc6 3\. Bb5 a6/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('game review flags a blunder (Stockfish, or the built-in engine as fallback)', async () => {
  const { page, ctx, errors } = await open({ store: FAST });
  const r = await page.evaluate(() => new Promise((res) => {
    const C = familyChessBoard.Chess, c = new C(), items = [];
    for (const m of ['e2e4', 'e7e5', 'g1f3', 'd8h4', 'f3h4']) { items.push({ fen: c.fen(), move: m }); c.move({ from: m.slice(0, 2), to: m.slice(2, 4) }); }
    ChessReviewAnalyzer.start(items, familyChessBoard.engineSource(), () => { const s = ChessReviewAnalyzer.status(); if (s.complete || s.error) res({ s, i: ChessReviewAnalyzer.issues().map((x) => [x.ply, x.kind]) }); });
  }));
  assert.equal(r.s.error, '');
  assert.ok(r.i.some(([ply, kind]) => ply === 4 && kind === 'blunder'), JSON.stringify(r.i));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Skewers chapter: two worked examples, then a skewer puzzle with a ringed hint and a skewer explanation', async () => {
  const { page, ctx, errors } = await open({ width: 390, height: 844, store: { 'chess.trainView': '2d' } });
  const tap = (txt) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent && !e.disabled && e.textContent.includes(t)); if (!b) throw new Error('no button ' + t); b.click(); }, txt);
  const ready = (txt) => page.waitForFunction((t) => [...document.querySelectorAll('button')].some((b) => b.offsetParent && !b.disabled && b.textContent.includes(t)), txt, { timeout: 15000, polling: 100 });
  await page.evaluate(() => familyChessTraining.open());
  await page.evaluate(() => familyChessTraining.openChapterId('c9'));
  await page.evaluate(() => [...document.querySelectorAll('.tr-step')][0].click());
  await tap('See it on the board');
  for (let k = 0; k < 5; k++) { await ready('Next'); await tap('Next'); }
  await ready('Got it');
  assert.equal(await page.evaluate(() => familyChessBoard.fen().split(' ')[0]), 'Bn4k1/p4ppp/1p2q3/8/8/P7/1P3PPP/6K1');
  await tap('Got it');
  await page.waitForFunction(() => familyChessTraining._test.pz()?.sk && familyChessBoard.moves().length === 1, null, { timeout: 15000, polling: 100 });
  const pz = await page.evaluate(() => { const z = familyChessTraining._test.pz(); return { moves: z.p.moves, sk: z.sk }; });
  assert.equal(pz.sk.set, 1);   /* practice puzzles open with the skewer itself */
  await ready('Hint'); await tap('Hint');
  assert.match(await page.evaluate(() => document.querySelector('.tr-legend')?.textContent || ''), /Ringed: the two pieces on one line/);
  for (let i = 1; i < pz.moves.length; i += 2) {
    await page.waitForFunction(([u, n]) => { if (familyChessBoard.moves().length === n - 1) familyChessBoard.userMove(u); return familyChessBoard.moves().length >= n; }, [pz.moves[i], i + 1], { timeout: 15000, polling: 150 });
  }
  await page.waitForFunction(() => !!document.querySelector('.tr-result'), null, { timeout: 15000, polling: 100 });
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('.tr-say')].some((e) => e.textContent.startsWith('Skewer — '))));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Your style: tapping a dot on the accuracy line shows that game', async () => {
  const { page, ctx, errors } = await open({ width: 390, height: 844 });
  await page.evaluate(() => familyChessTraining.open());
  const cap = await page.evaluate(() => {
    const T = familyChessTraining._test, P = T.P(), now = Date.now();
    P.games = [0, 1, 2, 3, 4].map((i) => ({ key: 'g:00000000-0000-4000-8000-00000000000' + i, at: now - (5 - i) * 864e5, side: i % 2 ? 'b' : 'w', res: i % 2 ? 'loss' : 'win', mode: 'live', plies: 50, acc: 80 + i,
      tags: { plans: ['center'], issues: i % 2 ? { hung: 1 } : {}, loss: {}, verdicts: { opening: 'good', middlegame: i % 2 ? 'bad' : 'good' } }, tip: null }));
    T.openStyle();
    document.querySelectorAll('.tr-spark circle.hit')[4].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return document.querySelector('.tr-spark-pick').textContent;
  });
  assert.match(cap, /online · won · accuracy 84/);
  assert.match(cap, /Open ›/);
  assert.deepEqual(errors, []);
  await ctx.close();
});
