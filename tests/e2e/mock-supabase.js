/* In-memory stand-in for supabase-js, for regression tests only. */
(() => {
  const cfg = window.__mockCfg || {};
  const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222', U3 = '33333333-3333-4333-8333-333333333333';
  const T0 = '2026-11-10T15:00:00.000Z';
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const game = (id, w, b, status, extra = {}) => ({ id, white_player_id: w, black_player_id: b, status, current_fen: START, result: null, end_reason: null, created_at: T0, updated_at: T0, clock_mode: 'off', clock_white_ms: null, clock_black_ms: null, clock_turn_started_at: null, clock_state: 'running', clock_penalty_side: null, clock_paused_by: null, ...extra });
  const M = window.__mock = {
    U1, U2, U3, log: [], channels: [], authSubs: [],
    session: cfg.signedIn === false ? null : { user: { id: U1, email: 'russell@example.com' }, access_token: 'x' },
    tables: {
      chess_profiles: [
        { id: U1, display_name: 'Russell', piece_color: '#c60018', practice_opponent_color: '#141414', clock_preference: 'off' },
        { id: U2, last_seen_at: new Date(Date.now()-2*3600e3).toISOString(), display_name: 'Lindsay', piece_color: '#2857aa', practice_opponent_color: '#141414', clock_preference: 'off' },
        { id: U3, last_seen_at: new Date(Date.now()-26*3600e3).toISOString(), display_name: 'Zed', piece_color: '#e7a938', practice_opponent_color: '#141414', clock_preference: 'off' },
      ],
      chess_games: [
        game('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', U1, U2, 'active'),
        game('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', U2, U3, 'active'),
        game('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', U1, null, 'waiting'),
        game('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', U2, U1, 'active'),
      ],
      chess_friendships: [{id:'f1',user_a:U1,user_b:U2,requested_by:U1,status:'accepted',created_at:T0},{id:'f2',user_a:U1,user_b:U3,requested_by:U3,status:'accepted',created_at:T0}], chess_moves: [], chess_clock_actions: [], chess_challenges: [], chess_push_subscriptions: [],
      chess_chat_messages: [
        { id: 'm1', game_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', sender_id: U2, body: 'Good luck!', created_at: '2026-11-10T15:01:00.000Z' },
        { id: 'm2', game_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', sender_id: U1, body: 'You too', created_at: '2026-11-10T15:01:30.000Z' },
      ],
      chess_spectator_messages: [
        { id: 's1', game_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', sender_id: U3, body: 'hello watchers', created_at: '2026-11-10T15:02:00.000Z' },
      ],
      chess_chat_read_state: [],
    },
  };
  if (cfg.quiet) M.tables.chess_games[1].status = 'finished';
  const fenAfter = (ucis) => { const C = window.__t.Chess, c = new C(); for (const u of ucis) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); return c; };
  M.seedMoves = (gid, ucis) => {
    M.tables.chess_moves = M.tables.chess_moves.filter((m) => m.game_id !== gid);
    ucis.forEach((u, i) => M.tables.chess_moves.push({ game_id: gid, ply: i + 1, move_uci: u }));
    const g = M.tables.chess_games.find((x) => x.id === gid); g.current_fen = fenAfter(ucis).fen();
  };
  M.pushMove = (gid, uci) => {
    const ucis = M.tables.chess_moves.filter((m) => m.game_id === gid).sort((a, b) => a.ply - b.ply).map((m) => m.move_uci); ucis.push(uci);
    const c = fenAfter(ucis); M.seedMoves(gid, ucis);
    const g = M.tables.chess_games.find((x) => x.id === gid);
    if (c.isGameOver()) { g.status = 'finished'; g.result = c.isCheckmate() ? (c.turn() === 'w' ? '0-1' : '1-0') : '1/2-1/2'; g.end_reason = c.isCheckmate() ? 'checkmate' : 'draw'; }
    M.emit('chess_games', 'UPDATE', g);
  };
  M.emit = (table, event, row) => { for (const ch of M.channels) for (const h of ch.handlers) if (h.type === 'postgres_changes' && h.filter.table === table && (h.filter.event === '*' || h.filter.event === event)) { try { h.cb({ new: row, old: row, eventType: event }); } catch (e) { console.error('mock emit', e); } } };
  const match = (row, f) => {
    const [op, col, val] = f;
    if (op === 'eq') return row[col] === val;
    if (op === 'neq') return row[col] !== val;
    if (op === 'gt') return row[col] > val;
    if (op === 'in') return val.includes(row[col]);
    if (op === 'notis') return row[col] !== val;
    if (op === 'or') return val.some(([c, v]) => row[c] === v);
    return true;
  };
  const exec = (q) => {
    M.log.push([q.op, q.table]);
    const t = M.tables[q.table] || (M.tables[q.table] = []);
    let rows = t.filter((r) => q.filters.every((f) => match(r, f)));
    if (q.op === 'insert') { const row = { created_at: new Date('2026-11-10T15:05:00.000Z').toISOString(), ...q.row }; t.push(row); rows = [row]; if (q.table.endsWith('_messages')) setTimeout(() => M.emit(q.table, 'INSERT', row), 0); }
    else if (q.op === 'upsert') { t.push({ ...q.row }); rows = [q.row]; }
    else if (q.op === 'update') { rows.forEach((r) => Object.assign(r, q.patch)); }
    else if (q.op === 'delete') { M.tables[q.table] = t.filter((r) => !rows.includes(r)); setTimeout(() => M.emit(q.table, 'DELETE', {}), 0); }
    if (q.order) rows = rows.slice().sort((a, b) => (a[q.order.col] > b[q.order.col] ? 1 : a[q.order.col] < b[q.order.col] ? -1 : 0) * (q.order.asc ? 1 : -1));
    if (q.limit) rows = rows.slice(0, q.limit);
    if (q.head) return { data: null, count: rows.length, error: null };
    if (q.single) return { data: rows[0] ? { ...rows[0] } : null, error: null };
    return { data: rows.map((r) => ({ ...r })), error: null, count: rows.length };
  };
  const from = (table) => {
    const q = { table, op: 'select', filters: [] };
    const api = {
      select(cols, o) { if (o && o.head) q.head = true; return api; },
      insert(row) { q.op = 'insert'; q.row = row; return api; }, upsert(row) { q.op = 'upsert'; q.row = row; return api; },
      update(patch) { q.op = 'update'; q.patch = patch; return api; }, delete() { q.op = 'delete'; return api; },
      eq(c, v) { q.filters.push(['eq', c, v]); return api; }, neq(c, v) { q.filters.push(['neq', c, v]); return api; }, gt(c, v) { q.filters.push(['gt', c, v]); return api; },
      in(c, v) { q.filters.push(['in', c, v]); return api; }, not(c, op, v) { q.filters.push(['notis', c, v]); return api; },
      or(expr) { q.filters.push(['or', null, expr.split(',').map((p) => { const [c, , ...v] = p.split('.'); return [c, v.join('.')]; })]); return api; },
      order(col, o) { q.order = { col, asc: !o || o.ascending !== false }; return api; }, limit(n) { q.limit = n; return api; },
      maybeSingle() { q.single = true; return api; }, single() { q.single = true; return api; },
      then(res, rej) { return new Promise((r) => setTimeout(() => r(exec(q)), 5)).then(res, rej); },
    };
    return api;
  };
  const g = (id) => M.tables.chess_games.find((x) => x.id === id);
  const rpcs = {
    chess_save_local_game: (a) => { if (a.p_replace) M.tables.chess_saved_games = M.tables.chess_saved_games.filter((x) => x.id !== a.p_replace); (M.tables.chess_saved_games ||= []).unshift({ id: 'sv' + Date.now(), group_id: 'g1', source: a.p_source, owner_side: a.p_side, opponent_id: null, white_name: a.p_white, black_name: a.p_black, moves: a.p_moves, sans: a.p_sans, actions: [], fen: a.p_fen, level: a.p_level, start_fen: a.p_start_fen || null, clock: a.p_clock || null, actions: a.p_actions || [], keep: false, created_at: new Date().toISOString() }); return M.tables.chess_saved_games[0].id; },
    chess_saved_consume: () => true, chess_saved_set_keep: (a) => a.p_keep,
    chess_mark_chat_read: () => '2026-11-10T16:00:00.000Z',
    chess_resign_game: ({ p_game_id }) => { const x = g(p_game_id); x.status = 'finished'; x.end_reason = 'resignation'; x.result = x.white_player_id === M.session.user.id ? '0-1' : '1-0'; return true; },
    chess_toggle_clock_pause: ({ p_game_id }) => { const x = g(p_game_id); x.clock_state = x.clock_state === 'paused' ? 'running' : 'paused'; x.clock_paused_by = x.clock_state === 'paused' ? M.session.user.id : null; return x.clock_state; },
    chess_claim_timeout: () => false,
    chess_create_private_game: () => { const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'; M.tables.chess_games.push(game(id, M.session.user.id, null, 'waiting')); return id; },
    chess_my_friend_code: () => 'S2VBSF', chess_touch_last_seen: () => true, chess_join_game: () => true, chess_cancel_invite: (a) => { const t = M.tables.chess_games; const i = t.findIndex((g) => g.id === a.p_game_id && g.status === 'waiting'); if (i < 0) return false; t.splice(i, 1); return true; }, chess_send_challenge: () => 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', chess_respond_challenge: () => null, chess_send_invite_to_player: () => 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', chess_cancel_challenge: () => true,
  };
  const client = {
    from,
    rpc(name, args) { M.log.push(['rpc', name]); return new Promise((r) => setTimeout(() => r(rpcs[name] ? { data: rpcs[name](args || {}), error: null } : { data: null, error: { message: 'mock: no rpc ' + name } }), 5)); },
    functions: { invoke(name, { body } = {}) { M.log.push(['fn', name]); return new Promise((r) => setTimeout(() => {
      if (name === 'chess-submit-move') { try { M.pushMove(body.game_id, body.move_uci); r({ data: { ok: true }, error: null }); } catch (e) { r({ data: { ok: false, error: 'Illegal move' }, error: null }); } }
      else if (name === 'chess-saved-game') {
        const sv = (M.tables.chess_saved_games || []).find((x) => x.id === body.saved_id); const id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
        const me = M.session.user.id; const gm = game(id, body.side === 'w' ? me : null, body.side === 'b' ? me : null, 'waiting', { resumed_plies: sv.moves.length });
        M.tables.chess_games.push(gm); sv.moves.forEach((u, i) => M.tables.chess_moves.push({ game_id: id, ply: i + 1, move_uci: u }));
        gm.current_fen = (() => { const C = window.__t.Chess, c = new C(); for (const u of sv.moves) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); return c.fen(); })();
        M.lastSaved = id; r({ data: { ok: true, game_id: id, challenge_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccd' }, error: null }); }
      else if (name === 'chess-notify-challenge') r({ data: { sent: 0, failed: 0 }, error: null });
      else r({ data: { ok: false, error: 'mock' }, error: null });
    }, 5)); } },
    channel(name) { const ch = { name, handlers: [], on(type, filter, cb) { ch.handlers.push({ type, filter, cb }); return ch; }, subscribe(cb) { setTimeout(() => cb && cb('SUBSCRIBED'), 5); return ch; }, track: async () => {}, untrack: async () => {}, presenceState: () => ({ k1: [{ uid: U2 }] }) }; M.channels.push(ch); return ch; },
    removeChannel(ch) { M.channels = M.channels.filter((c) => c !== ch); return Promise.resolve('ok'); },
    auth: {
      getSession: async () => ({ data: { session: M.session }, error: null }),
      getUser: async () => ({ data: { user: M.session && M.session.user }, error: null }),
      onAuthStateChange(cb) { M.authSubs.push(cb); setTimeout(() => cb('INITIAL_SESSION', M.session), 5); return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async ({ email }) => { M.session = { user: { id: U1, email }, access_token: 'x' }; M.authSubs.forEach((cb) => cb('SIGNED_IN', M.session)); return { data: { user: M.session.user, session: M.session }, error: null }; },
      signUp: async () => ({ data: { session: null, user: null }, error: null }), resetPasswordForEmail: async () => ({ error: null }), updateUser: async () => ({ error: null }),
      signOut: async () => { M.session = null; M.authSubs.forEach((cb) => cb('SIGNED_OUT', null)); return { error: null }; },
    },
  };
  window.supabase = { createClient: () => client };
})();
