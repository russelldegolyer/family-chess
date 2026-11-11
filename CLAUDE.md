# Chess — Claude entry point

Private family chess web app (Russell and family). Live at https://chess.allseasonpestllc.com.
Repo: russelldegolyer/family-chess (main deploys to Vercel automatically on push).

## Stack (no build step)
- Static site: `index.html` + plain JS/CSS files at the repo root. No bundler, no package.json.
- three.js 0.170 (3D board) and chess.js loaded via import map / CDN inside `index.html`.
- Supabase project `league-lab-2026` (ref `xozummfupjmsmxooawdx`), **shared with League Lab**.
  Chess owns only `public.chess_*` tables, `chess_*` RPCs and three `chess-*` Edge Functions.
- Vercel static hosting (`vercel.json` = headers only).

## Where things live (details: docs/PROJECT_STATE.md → Source Map)
- `index.html` — UI, CSS, 3D/2D boards, practice games, computer engine (`#engineSrc` worker),
  3D piece builder (`#masterSrc`), side chooser, review, settings, toolbar, chat panel shell.
- `chess-online.js` — Play online sheet, profiles/colours sync, match load/sync, invites, My matches.
- `chess-social.js` / `chess-social.css` — players + presence, 60 s challenges, push subscribe.
- `chess-chat.js` — match + spectator chat. `chess-clock.js` — clocks, pause, pawn-for-time.
- `chess-review-analysis.js` — post-game move grading. `auth-gate.js` / `auth.css` — sign-in.
- `supabase/functions/*` — move commit, clock action, challenge push. `database/*.sql` — change scripts.
- `tests/*.test.mjs` — `node --test tests/*.test.mjs` (mostly source-pattern assertions).

## Context authority (highest first)
1. Russell's latest explicit instruction.
2. Current source code + live DB schema (what actually exists).
3. Active entries in docs/DECISIONS.md.
4. Requirements in docs/PROJECT_STATE.md.
5. Older chats, summaries, automatic memory.
Code shows what exists; Russell's instructions show what he wants. If they disagree, don't assume
the code is intended. Never restore something a newer decision removed. Ask one short question if a
contradiction can't be resolved.

## Regression guards
- Black pieces are always black; a player's colour paints only White pieces (DECISIONS D-07).
- Do not touch League Lab tables, Auth settings, or Site URL in the shared Supabase project.
- Online moves/clock changes go through Edge Functions + RPCs; never add direct client writes to game state.
- Edge Functions have `verify_jwt=false` and validate the bearer token in code — keep those checks.
- Practice games never write to Supabase. Online code paths are gated by `G.onlineProvider === 'supabase'`.
- Keep the five numbered computer levels; never bring back the old three-level system.
- Bump the `?v=` query on a script/style tag in `index.html` when its file changes (cache busting).

## Workflow (token-efficient)
1. Read this file, then only the relevant section of PROJECT_STATE.md / DECISIONS.md.
2. Use the Source Map + `grep` to find code; read only the affected region of `index.html` (~7,500 lines).
3. Make the smallest reliable change; no refactors, new deps or frameworks unless asked.
4. Verify proportionally: `node --check` changed JS, run the specific relevant test or a quick
   headless check. Full suites/browser runs only for gameplay or multiplayer changes.
   Never claim a check passed unless it ran.
5. Push to main deploys; confirm the live site serves the change when it matters.
6. Database changes: apply via a reviewed migration, save a copy in `database/`, never blind-replay old scripts.

## Keeping memory accurate
- Update PROJECT_STATE.md when a feature, file location, or known issue changes (edit in place).
- Add/supersede entries in DECISIONS.md for real product/architecture decisions only.
- No session logs, no duplicated content between files, keep this file under ~100 lines.
- README.md is the deployment/setup guide; don't duplicate it here.
