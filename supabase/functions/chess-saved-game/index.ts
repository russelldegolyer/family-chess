// Send a saved game to a family member: re-checks every saved move with chess.js, opens a waiting
// game at that exact position (history included, inviter in their chosen seat) and a 10-minute
// "saved" invitation. The target accepts through chess_respond_challenge like any other invite.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { Chess } from 'npm:chess.js@1.4.0';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const allowedOrigins = new Set(['https://chess.allseasonpestllc.com', 'https://family-chess-theta.vercel.app']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uciRe = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  const cors = {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://chess.allseasonpestllc.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Vary': 'Origin',
  };
  const reply = (code: number, payload: unknown) => new Response(JSON.stringify(payload), {
    status: code, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  try {
    const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '')?.[1];
    if (!token) return reply(401, { error: 'Sign in first.' });
    const { data: auth, error: authErr } = await db.auth.getUser(token);
    const me = auth?.user?.id;
    if (authErr || !me) return reply(401, { error: 'Your session expired. Sign in again.' });

    const body = await req.json().catch(() => ({}));
    const { saved_id, target_id } = body || {};
    if (typeof saved_id !== 'string' || !uuid.test(saved_id) || typeof target_id !== 'string' || !uuid.test(target_id))
      return reply(400, { error: 'Invalid request.' });
    if (target_id === me) return reply(400, { error: 'Choose another player.' });

    const { data: s, error: sErr } = await db.from('chess_saved_games')
      .select('id,owner_id,group_id,owner_side,moves,actions,start_fen,clock').eq('id', saved_id).maybeSingle();
    if (sErr) throw sErr;
    if (!s || s.owner_id !== me) return reply(404, { error: 'Saved game not found.' });
    const side = body.side === 'w' || body.side === 'b' ? body.side : s.owner_side;
    const { data: target } = await db.from('chess_profiles').select('id').eq('id', target_id).maybeSingle();
    if (!target) return reply(404, { error: 'Player not found.' });
    const { data: fr } = await db.from('chess_friendships').select('id').eq('user_a', me < target_id ? me : target_id)
      .eq('user_b', me < target_id ? target_id : me).eq('status', 'accepted').maybeSingle();
    if (!fr) return reply(403, { error: 'You can only send games to friends.' });

    // Re-play the saved game from the start. Pawn-for-time changes are applied after their ply.
    const moves: string[] = Array.isArray(s.moves) ? s.moves : [];
    const actions: { after_ply: number; kind: string; square: string | null; fen_after: string; side: string }[] =
      Array.isArray(s.actions) ? s.actions : [];
    const startFen: string | null = typeof s.start_fen === 'string' && s.start_fen ? s.start_fen : null;
    if ((!moves.length && !startFen) || moves.length > 1000) return reply(422, { error: 'This saved game is empty.' });
    let chess: Chess;
    try { chess = startFen ? new Chess(startFen) : new Chess(); }
    catch { return reply(422, { error: 'This saved position is not a legal chess position.' }); }
    const rows: { ply: number; move_uci: string; move_san: string; fen_after: string; mover: string }[] = [];
    const applyActions = (ply: number) => {
      for (const a of actions) if (Number(a.after_ply) === ply) chess.load(a.fen_after);
    };
    applyActions(0);
    for (let i = 0; i < moves.length; i++) {
      const u = moves[i];
      if (!uciRe.test(u)) return reply(422, { error: 'This saved game has an invalid move.' });
      const mover = chess.turn();
      let mv;
      try { mv = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); }
      catch { return reply(422, { error: 'This saved game has an illegal move at ply ' + (i + 1) + '.' }); }
      rows.push({ ply: i + 1, move_uci: mv.from + mv.to + (mv.promotion || ''), move_san: mv.san, fen_after: chess.fen(), mover });
      applyActions(i + 1);
    }
    if (chess.isGameOver()) return reply(409, { error: 'That game is already over.' });
    const fen = chess.fen();

    // Opening an invitation closes the inviter's other live games and pending invites (same rule as a new invite).
    const now = new Date().toISOString();
    await db.from('chess_games').update({ status: 'finished', end_reason: 'replaced', updated_at: now })
      .in('status', ['waiting', 'active']).or(`white_player_id.eq.${me},black_player_id.eq.${me}`);
    await db.from('chess_challenges').update({ status: 'canceled', responded_at: now })
      .eq('challenger_id', me).eq('status', 'pending');

    const { data: game, error: gErr } = await db.from('chess_games').insert({
      white_player_id: side === 'w' ? me : null, black_player_id: side === 'b' ? me : null,
      status: 'waiting', current_fen: fen, resumed_plies: rows.length, saved_group: s.group_id, start_fen: startFen,
    }).select('id').single();
    if (gErr) throw gErr;
    // Pick up with the time each side had when the game was saved (not fresh clocks).
    const ck = s.clock && typeof s.clock === 'object' ? s.clock : null;
    // Modes: off, legacy 10m/12m/15m/move60, m<minutes> (1-180), s<seconds per move> (5-600).
    const validMode = (m: unknown) => typeof m === 'string' && /^(off|10m|12m|15m|move60|m([1-9]|[1-9][0-9]|1[0-7][0-9]|180)|s([5-9]|[1-9][0-9]|[1-5][0-9][0-9]|600))$/.test(m);
    if (ck && validMode(ck.mode)) {
      const ms = (v: unknown) => Math.max(0, Math.min(10800000, Math.floor(Number(v) || 0)));
      const upd: Record<string, unknown> = { clock_mode: ck.mode, clock_white_ms: ms(ck.w), clock_black_ms: ms(ck.b) };
      if (['end', 'sec60', 'pawn'].includes(ck.expiry)) upd.clock_expiry = ck.expiry;
      await db.from('chess_games').update(upd).eq('id', game.id);
    }
    const other = target_id;
    const { error: mErr } = !rows.length ? { error: null } : await db.from('chess_moves').insert(rows.map((r) => ({
      game_id: game.id, player_id: r.mover === side ? me : other, ply: r.ply,
      move_uci: r.move_uci, move_san: r.move_san, fen_after: r.fen_after,
    })));
    if (mErr) { await db.from('chess_games').delete().eq('id', game.id); throw mErr; }
    if (actions.length) {
      const { error: aErr } = await db.from('chess_clock_actions').insert(actions.map((a) => ({
        game_id: game.id, actor_id: a.side === side ? me : other, after_ply: Number(a.after_ply),
        kind: a.kind, square: a.square, fen_after: a.fen_after,
      })));
      if (aErr) { await db.from('chess_games').delete().eq('id', game.id); throw aErr; }
    }
    const { data: ch, error: cErr } = await db.from('chess_challenges').insert({
      challenger_id: me, target_id, game_id: game.id, kind: 'saved',
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }).select('id').single();
    if (cErr) { await db.from('chess_games').delete().eq('id', game.id); throw cErr; }
    return reply(200, { ok: true, challenge_id: ch.id, game_id: game.id });
  } catch (e) {
    console.error('chess-saved-game', e instanceof Error ? e.message : 'Unexpected error');
    return reply(500, { error: 'Could not send the saved game. Try again.' });
  }
});
