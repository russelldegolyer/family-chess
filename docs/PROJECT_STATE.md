# Chess — Project State

Authoritative description of what is currently implemented. Last reviewed 2026-11-11 (after old-code cleanup).
Setup, deployment and secrets: see README.md (not repeated here).

## Architecture
- **Front end:** static files served by Vercel from the repo root; `index.html` is the app. No build.
  three.js 0.170 + chess.js via CDN/import map. Supabase JS client (pinned CDN) is created in
  `auth-gate.js` and exposed as `window.chessSupabase`.
- **Layering inside the page:** `index.html` owns the board, game state `G`, practice games and UI.
  The side scripts talk to it only through window bridges:
  `window.familyChessNative` (present match, colours, endPractice, leaveToPractice, openReview),
  `window.ChessClock`, `window.ChessReviewAnalyzer`, `window.familyChessChat`,
  `window.familyChessOpenLobby`, `window.familyChessOpenMatch`, `window.familyChessSubmitMove`,
  `window.familyChessResign`, `window.familyChessPause`, `window.familyChessClaimTimeout`.
- **Supabase (shared with League Lab, project ref `xozummfupjmsmxooawdx`):**
  tables `chess_profiles, chess_games, chess_moves, chess_challenges, chess_push_subscriptions,
  chess_chat_messages, chess_spectator_messages, chess_chat_read_state, chess_clock_actions`, all RLS on.
  Edge Functions `chess-submit-move`, `chess-clock-action`, `chess-notify-challenge`, `chess-saved-game` (verify_jwt off,
  token checked in code). Game-changing actions are SECURITY DEFINER RPCs (`chess_*`).
  Trigger `chess_games_drop_replaced` deletes a game as soon as it is marked `end_reason='replaced'`.
- **Auth:** Supabase email/password; one Auth directory shared with League Lab.
- **Realtime:** match page subscribes to `chess_games` updates for the open match plus a 3 s poll;
  presence channel for online players; challenges via table + realtime + push.
- **Deployment:** push to `main` → Vercel deploys. Edge Functions deploy separately.

## Source Map
| Feature | Where | Notes |
| --- | --- | --- |
| Game state, moves, undo | `index.html` (`G`, `applyMove`, `playMove`, `undo`, `resetLocalGame`) | practice + online share one board |
| Computer opponent (5 levels) | `index.html` `#engineSrc` (worker), `requestComputer`, `cpu` | transposition table (Zobrist, cleared per move); UI shows numbers only; engine branches on `level === 4/5` for the two extreme styles; each has its own opening book (`BOOK`: 4 = Gukesh repertoire, 5 = Magnus repertoire) and both avoid draws |
| 3D board/pieces/themes | `index.html` `THEMES`, `#masterSrc` (`sdfMesh` surface nets + vertex snapping; knight/bishop/queen heads are SDF), `applyTheme`, `fitCamera` | themes: unnamed (Default), cats (Wooden); retired ids alias to Default |
| 2D board | `index.html` `draw2D`, `applyView`, `PREF2D` | |
| Side chooser (start screen) | `index.html` `PG`, `openPregame`, `closePregame`, `pgStep`, `goHome`, `newGame` | swipe or tap White/Black + difficulty slider |
| Piece colours | `index.html` `myColor`, `setMyColor`, `sideColors` (`BLACK_PIECES`), `openQuickColors`; sync in `chess-online.js` (`piece_color`) | one colour per account, paints White only |
| Toolbar / chat header / ⋯ menu | `index.html` `.controls`, `.chat-tools`, `openMenu` | |
| Settings dialog | `index.html` `openSettings` | one compact list: segmented controls + switches, no help text |
| Sound | `index.html` `Sound` (Web Audio), `fxForMove` | unlocked by any tap/key (document listeners); `navigator.audioSession.type='playback'` on iPhone |
| Game review | `index.html` `startReview`, `reviewStep`, `renderHistory`; `chess-review-analysis.js` | key-moments stepping |
| Analysis engine (Stockfish 18 lite WASM) | `chess-stockfish.js` (`ChessStockfish.search/evalMove`), `engine/stockfish-18-lite-single.{js,wasm}` (GPL-3.0, `engine/COPYING.txt`) | loaded on first use by review, stats accuracy and training checks; the `#engineSrc` engine stays the opponent and the fallback |
| Online draw offers / takebacks | RPCs `chess_offer`, `chess_answer_offer`, trigger `chess_moves_clear_offers` (`database/chess-draw-takeback-2026-11-17.sql`); `familyChessOffer`/`familyChessAnswerOffer` in `chess-online.js`; `askToResign`, `setOffers` in `index.html` | offered from the Resign (×) dialog; a draw offer stays open until the other player moves; a takeback is only your own last move |
| Your style page | `chess-training.js` `styleStats(filter)`, `openStyle`, `STYLE_FAMILY`, `PLAN_HELP`, `accSpark` (tappable dots), `styleAxes` (How you play / How you finish sliders; finishing read from `tags.finish` in `chess-plan.js`, `fillFinish` re-reads older computer games via `movesFromFens`), `focusPick`, `styleLine` (Training card line); game rows in `P.games` (≤30, with `notes` examples since 2026-11-19) | summary, filter, expandable rows, phase tiles with a link into the weakest phase's drill |
| Your path | `chess-training.js` `openPath` (`PATH_FILTER`, `chapterKind`), `pathCard` (steps), `CHAPTER_GOAL` | follows Your style from 3 games |
| Skewers chapter (c9) | `chess-training.js` `CHAPTERS` (`learn(text, look, demo)`, `openLearnDemo`), `skewerIn` (the skewer read from the solution line), `skewerHint`/`skewerSay`, first-move filter in `nextPuzzle` | D-42; any chapter can get worked examples by adding `demo` |
| Premoves | `index.html` `premove`, `premoveTap`, `checkPremove` (blue squares in 2D) | computer and online games |
| PGN / FEN | `index.html` `gamePgn`, `copyPgn`, `openImport` (Settings → Game record) | import continues the game via `loadSavedGame` |
| Crash reports | `chess-online.js` (top) → RPC `chess_report_error` → `chess_client_errors` (`database/chess-client-errors-2026-11-17.sql`) | signed-in players only, 30/hour, kept 60 days |
| Offline cache | `chess-sw.js` (fetch handler), registered from `index.html`; `auth-gate.js` lets a known player in offline | |
| Clocks, pause, pawn-for-time | `chess-clock.js` (practice stops at 0:30 for a choice: pawn +1:30 or play on to 3:00); pawns are picked by tapping the board (`pawnPick` in `index.html`); server `chess-clock-action` + `database/chess-pawn-time-*.sql`, `chess-move60-*.sql` | |
| Saved games | Save button (`btnSave`/`btnChatSave`, `saveCurrentGame`, `loadSavedGame`, resume banner in `index.html`); list/detail and Create game position editor (`openEditor`) in `chess-training.js` (Training → Saved games); saved clock restored via `ChessClock.resumeLocal`; `chess-saved-game` Edge Function + `database/chess-saved-games-2026-11-12.sql` | |
| Play online sheet, Your games, name (top), End game, finished-match query | `chess-online.js` (`show`, `refresh`, `refreshLive`, `startMatch`, `syncMatch`) | |
| Players, presence, challenges, push | `chess-social.js`, `chess-sw.js` | |
| Chat | `chess-chat.js` (+ `renderChat`/`sendChat` delegates in `index.html`) | |
| Your plan / style | `chess-plan.js` / `.css` (`familyChessPlan.read/open`), `fillEndPlan` in `index.html`; profile + review deck in `chess-training.js` (`recordGame`, `styleStats`, `P.review`, `P.games`) | per-move drops come from `chess-stats.js` accuracy |
| Voice chat (walkie-talkie) | `chess-voice.js` (WebRTC; `familyChessVoice.update` called from `renderChat`) | hold the mic to talk; background link while both are in the same online game (D-40) |
| Sign-in | `auth-gate.js`, `auth.css`, `config.js` | |
| Training (puzzles, Endgame Academy, Endgame Challenges, Review, threat/blunder drills, speed rounds) | `chess-training.js` / `.css`; board bridge `window.familyChessBoard` + `TRAIN`/`START_FEN` (`G.mode === 'train'`) in `index.html`; dev puzzles `chess-puzzles-dev.json`; loader `tools/import-lichess-puzzles.py`; exact endgame tables `endgame-k{q,r,p}k.bin` built by `tools/build-endgame-tables.mjs` (verified against the Lichess tablebase) | "Challenges" button at the top right beside the profile button; saves and restores the current game; progress in localStorage + `chess_training_progress` |
| Live clock change | `ChessClock.changeLocalMode` (practice), `applyClockChange` in `index.html`, `familyChessChangeClock` → RPC `chess_change_clock` (online) | total→total shifts both clocks by the difference |
| Last online | `chess-social.js` (`lastOnline`, `touchLastSeen` heartbeat → RPC `chess_touch_last_seen`) | falls back to "Offline" if the column is missing |
| Stats (record cards on Play online → vs Players / vs Computer) | `chess-stats.js` / `.css`; computer games logged per level in `recordCpuResult` (`chess.cpuRecord`, `chess.cpuGames`, last 80, this device) | online stats read `chess_games` + `chess_moves.fen_after`; move quality graded by the engine on the device, cached per game |
| Tests | `tests/*.test.mjs` (source checks + VM tests); `tests/e2e/*.e2e.mjs` (Playwright, real app with `tests/e2e/mock-supabase.js`; CI job `browser`) | |

## Feature Registry
**Implemented and verified** (checked in a browser or by tests during 2026-11 sessions)
- Opening screen: side-on 3D board, swipe/tap to pick White or Black, difficulty slider 1–5.
- New → back to opening screen; confirm dialog if moves have been made; online shows "Leave this match?".
- Practice clock starts on the game's first move.
- Toolbar: New, Undo, Resign (×), Pause, Reset view, 2D/3D, colour wheel, ⋯ menu; chat header mirrors it.
- ⋯ menu: Choose board, Move history, Settings.
- Colour rule: White = player colour (practice: yours; online: White player's), Black always black.
- Play online sheet: Your name at top, players (Challenge / watch), Share invite link, Live now (human games updated in the last 20 min), Your games (waiting/active only), Settings disclosure (notifications, join by link, sign out). Record and finished matches are in Challenges → Matches (`openMatches`, All/Humans/Computer).
- Clocks: None / Seconds / Minutes with typed amounts; time-out rule (end / 60 s a move / pawn trade) in Settings (D-33). Online End deletes the game (`chess_end_game`).
- Abandoned (replaced) matches are deleted, not stored. A waiting invite can be cancelled (box after Share invite link, or Cancel on a WAIT row) via RPC `chess_cancel_invite`.
- Opening an online match ends the practice game; returning from online opens the side chooser.
- Review: Next/Prev stop only on inaccuracies, mistakes, blunders and strong replies; "Every move" toggle.
- Five computer levels; 4 and 5 use different decision criteria (tests in `chess-ai-five-levels.test.mjs`).
- Online games end on threefold repetition on the server (`chess-submit-move` v5), as well as mate, stalemate, insufficient material and the fifty-move rule.
- Adaptive puzzles: every third one comes from the weakest theme (6+ attempts, under 70%).

**Implemented but unverified end-to-end here** (code present; needs real devices / two accounts)
- Online play with server-validated moves; realtime sync; spectating; separate spectator chat.
- 60-second challenges, push notifications to installed iPhone web app.
- Online pause (either player), timeout claims, pawn-for-time and penalty rules on 10/12/15-min clocks.
- Profile colours persisting across reopen and showing to opponents.

**Partially implemented**
- `mode 'local'` (two players on one screen) is now only the idle state behind the opening screen; there is no way to start a same-screen two-player game (by decision D-09).

**Removed** (don't restore)
- Computer/"practice opponent" colour — code removed 2026-11-11; DB column `chess_profiles.practice_opponent_color` is left in place, unused.
- Old New-game sheet (Two Players / Play Computer / starting side) and the "Preferred starting position" setting — removed 2026-11-11.
- 3D boards Red & Black, Navy Blue & Silver, Northern Lights, Volcano (and their Aurora/Lava settings) — removed 2026-11-11.
- The pre-Supabase in-page live layer (seats, shared doc, archive, Claude feedback) — removed 2026-11-10.

## Requirements vs implementation (discrepancies)
- **Visual identity:** requirement is black-and-red; current UI accent is iOS blue (#0a84ff) on buttons, slider, badges.
- **Custom colours:** requirement lists custom board and piece colours; pieces now allow only the White colour (by decision D-07). 2D board styles (green/bw/wood/custom) and 3D themes remain.
- **60 s per move:** requirement describes the pawn timeout rules generally; `move60` uses sudden-death loss on timeout (per `database/chess-move60-sudden-death-2026-11-09.sql`); pawn rules apply to 10/12/15-min modes.
- **Timeout rule:** opponent removes a pawn, timed-out side gets 3:00 (`180000`) — matches. Below 30 s, sacrifice a pawn for +1:30 — matches.

## Known Issues
- `chess_puzzles` holds 10,000 Lichess puzzles (loaded 2026-11-11, balanced by level and category, ~4 MB); signed-out or offline play uses the bundled dev subset. More can be added with `tools/import-lichess-puzzles.py`.
- Endgame truth: built-in exact tables for K+Q/K+R/K+P vs K (offline); Lichess tablebase API for other ≤7-piece endings when reachable; otherwise the engine (two bishops, bishop+knight, multi-pawn).
- Supabase advisor: leaked-password protection is off (Russell chose to leave it); League Lab functions flagged as executable by signed-in users (not Chess's to change).
- Opening-screen swipe smoothness only checked in a slow headless browser; confirm on phone.

## Critical Dependencies
- `index.html` game state `G` + `mySeat`/`viewSide` feed board, clocks, chat and review; `present()` in `familyChessNative` rebuilds `G` from server rows — keep its FEN/move-count checks.
- `G.onlineProvider === 'supabase'` is the switch between practice and online behaviour in many functions.
- `sideColors()` drives 3D materials, 2D drawing, plates and the colour wheel.
- `fitCamera` handles both the opening screen (`PG.on`) and normal play; `viewYShift` must interpolate when it changes.
- Clock state lives in `chess-clock.js`; local timeouts call back into `index.html`; online timeouts are settled only by the server.
- Shared Supabase project: any SQL must target `public.chess_*` only.
- Deploy contents: `.vercelignore` keeps database/, docs/, supabase/, tests/, tools/, .github/, README.md and CLAUDE.md out of Vercel deploys. A new runtime file must live at the repo root (or a folder not listed there).
- Blunder check answers: `chess-blunder-check.json` (Stockfish 16.1, depth 18; rebuild with `tools/verify-blunder-check.py` when drill puzzles change). Puzzles not in it fall back to Stockfish in the browser.
- `engine/` (Stockfish WASM, ~7 MB) must stay deployable (not in `.vercelignore`); bump `URL_SF ?v=` in `chess-stockfish.js` when replacing it.
- Visual system: iOS look on near-black surfaces; `chess-skin.css` (loaded last) only darkens backgrounds and holds two layout fixes (D-36).
