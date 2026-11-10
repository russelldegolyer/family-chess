# Chess — Complete Project Setup and Architecture

**Website:** https://chess.allseasonpestllc.com  
**Source repository:** https://github.com/russelldegolyer/family-chess  
**Frontend hosting:** Vercel (static site)  
**Backend:** Supabase project **league-lab-2026**  
**Supabase project reference:** **xozummfupjmsmxooawdx**  
**Documentation verified against the repository and live Supabase project:** November 10, 2026

> This is the CURRENT setup guide. The older README-SETUP.md describes an early Phase 1 and is retained only as historical documentation. Chess now has multiplayer-related infrastructure, chat, challenges, server-validated moves, clocks, and push notifications.

## 1. Project overview

Chess is a standalone, mobile-oriented chess web app, not part of the football interface. Its source is in **russelldegolyer/family-chess**. It is hosted separately from League Lab, but deliberately shares **League Lab's existing Supabase project** for authentication, Postgres data, Realtime, and server-side Edge Functions.

Features implemented in the repository include:

- 3D and 2D chessboards, board appearance settings, responsive mobile and desktop UI.
- Local two-player games and computer practice, with five numbered AI difficulties (1–5); levels 4 and 5 use differing hard-play styles.
- Email/password authentication, sign-up/confirmation, password reset and sign-out.
- Account profiles, names, persistent personal piece color and computer/practice opponent color.
- Authenticated online challenges and invites, a 60-second challenge acceptance window, player presence, live-game spectator flows, and live synchronization.
- Server-validated online moves, game persistence, game results and resignation flows.
- Separate in-game player and spectator chats, plus unread/read-state tracking.
- Timed modes: off, 10 minutes, 12 minutes, 15 minutes, and 60 seconds per move; additional pause/pawn-for-time rules apply to eligible normal timed modes. The latest move60 database update uses sudden-death timeout rather than pawn exchanges.
- Browser push support for invitations, a service worker and installable PWA assets.
- Automated JavaScript tests and a GitHub Actions verification workflow.

**Important:** The repository demonstrates these capabilities in code. Deployments, browser permissions and actual end-to-end operation still need testing when restoring or moving the app.

## 2. How Chess shares Supabase with League Lab

There is **one Supabase project**, not one per app:

| Component | Chess | League Lab |
| --- | --- | --- |
| GitHub repository | russelldegolyer/family-chess | russelldegolyer/league-lab |
| Frontend deployment | Dedicated Vercel Chess project | Separate League Lab project |
| User interface domain | chess.allseasonpestllc.com | League Lab's own domain |
| Supabase project | league-lab-2026 | league-lab-2026 |
| Supabase project ref | xozummfupjmsmxooawdx | xozummfupjmsmxooawdx |
| Database tables | public.chess_* | League Lab's football/league tables |
| Authentication | Same project-wide Supabase Auth | Same project-wide Supabase Auth |

**What is shared:** Supabase project billing/resources, the Auth user directory, the Postgres database server, Realtime infrastructure, and the environment managing Edge Functions. A single Auth user identity may therefore exist across the two apps; this does not mean their application-specific tables or screens are merged.

**What is separate:** The code, Vercel projects, UI, domain, game data and football league data. Chess data is stored in tables whose names start with chess_. Football data lives in its own tables.

**Critical protection:** Do not delete or recreate the Supabase project for Chess. Do not drop football tables, change League Lab's Auth Site URL, run a global schema reset, or deploy chess schema scripts against the wrong project. RLS policies must continue to protect each app's data.

### How the frontend connects

The public browser configuration is in **config.js** and defines window.CHESS_SUPABASE. At the time of this snapshot:

~~~js
window.CHESS_SUPABASE = {
  url: "https://xozummfupjmsmxooawdx.supabase.co",
  publishableKey: "the public key stored in config.js"
};
~~~

The real public publishable key is already present in the repository's config.js. A publishable key is intended for browsers and is not a secret. **Never put a Supabase service-role key, secret key, database password or VAPID private key in config.js, index.html, or any other browser file.**

auth-gate.js initializes the Supabase JavaScript client and exposes it as window.chessSupabase. The online, chat, clock and social scripts use that client. Online move submission and other sensitive actions go through protected database functions / Supabase Edge Functions, not arbitrary direct browser writes to match state.

## 3. Live chess-specific database structure

At the documentation date, these tables exist in **public** on the shared project. All nine have **Row Level Security (RLS) enabled**:

| Table | Purpose |
| --- | --- |
| chess_profiles | Profile display name, owned piece color, practice opponent color and default clock preference; linked to auth.users |
| chess_games | Games, player IDs, current FEN, status/result and clock state |
| chess_moves | Ordered move history, SAN/UCI and post-move FEN |
| chess_challenges | Player invitations, expiry, status, game link and push dispatch state |
| chess_push_subscriptions | Browser push endpoints and per-subscription encryption material |
| chess_chat_messages | Private participant messages for a match |
| chess_spectator_messages | Separate spectator chat |
| chess_chat_read_state | Per-user last-read timestamps for game/spectator channels |
| chess_clock_actions | Pawn-for-time/penalty/waiver actions in supported clock modes |

The **database/** folder contains versioned Chess SQL scripts covering some of the evolution of this schema and the chess-specific functions/policies. It is NOT a complete, safely replayable dump of all live Supabase SQL, all historic migrations or actual records. Several live migrations are recorded in Supabase migration history and may not have a matching standalone file here.

**Do not blindly execute every file in database/ against an existing deployment.** Check whether the change has already been applied, compare current schema and policies, back up first, and use a reviewed migration for the specific change. Running older scripts after newer scripts may restore obsolete rules.

### Active Supabase Edge Functions

The live shared project currently has these Chess-specific functions deployed:

| Function | Source in this repository | Responsibility |
| --- | --- | --- |
| chess-submit-move | supabase/functions/chess-submit-move/index.ts | Authenticate, validate legal online moves and commit game state |
| chess-clock-action | supabase/functions/chess-clock-action/index.ts | Validate/apply clock and pawn-related actions |
| chess-notify-challenge | supabase/functions/chess-notify-challenge/index.ts | Send invitation push notifications to subscriptions |

These Edge Functions use server-managed Supabase credentials, validate caller identity in their code, and use database RPCs as needed. The deployed functions are not automatically updated merely by publishing the static Vercel frontend. They must be deployed separately when backend code changes.

Other Chess database RPCs are referenced from the frontend and SQL, including functions for sending/responding to challenges, read receipts, and authoritative move/clock changes. Access and security policies depend on the actual live database.

## 4. Repository file guide

| Path | Purpose |
| --- | --- |
| index.html | Main chess UI, CSS, board rendering, embedded computer engine and application state |
| config.js | Public Supabase URL and publishable browser key |
| auth-gate.js, auth.css | Supabase Auth interface and account/session handling |
| chess-online.js | Profile/settings UI, online invites, match state and network sync |
| chess-social.js, chess-social.css | Player presence, online challenges, spectator/lobby UX and push subscriptions |
| chess-chat.js | Match/spectator chat and read states |
| chess-clock.js | Local and online clock HUD and timing behaviors |
| chess-review-analysis.js | Post-game/move review features |
| chess-sw.js | Push service worker; opens game invitation when clicked |
| manifest.webmanifest, manifest-svg-v4.webmanifest | Installable web app manifests |
| icon-*, favicon*, apple-touch-icon* | Branding and PWA icons |
| database/*.sql | Chess-specific SQL change scripts and policy/function updates |
| supabase/functions/*/index.ts | Source for the three Chess Supabase Edge Functions |
| tests/*.test.mjs | Node.js automated regression tests |
| .github/workflows/chess-verify.yml | GitHub Actions verification |
| vercel.json | Static Vercel routing/header configuration |
| README-SETUP.md | Historical early-stage deployment notes |
| README.md | This current guide |

There is no Node dependency installation or frontend build required for this static site. The Supabase JavaScript client is loaded from a pinned external CDN in index.html, so browser connectivity to that CDN is needed.

## 5. Deploying the Chess frontend to Vercel

For changes to the existing app:

1. Edit files in **russelldegolyer/family-chess**, normally on the main branch (prefer a branch and pull request for substantial changes).
2. Run the tests in section 10.
3. Push the verified changes to GitHub.
4. If the Chess Vercel project is linked to this repository/branch, Vercel will build/deploy the static files according to its Git integration. Confirm the deployment in the **Chess** Vercel project, not League Lab's.
5. Test https://chess.allseasonpestllc.com on desktop, iOS Safari and the installed PWA. Hard-refresh or reopen the PWA if cached assets remain.

For a fresh static Vercel setup:

1. In Vercel, choose **Add New Project** and import **russelldegolyer/family-chess**.
2. Use **Other** / static HTML framework configuration; no application build command is required.
3. The repository root is the web root; index.html is the entrypoint. Keep vercel.json.
4. Deploy and confirm the Vercel preview URL loads.
5. Under that Vercel project's **Settings > Domains**, add **chess.allseasonpestllc.com**.
6. In GoDaddy DNS for allseasonpestllc.com, create/update only the record Vercel prescribes for the **chess** subdomain (commonly a CNAME). Leave the football subdomain and all unrelated DNS records untouched.
7. Test HTTPS, login, multiplayer, chat and PWA behavior. Verify that any Supabase redirect URLs include the deployed URL.

A previously referenced Vercel preview origin in the source is **https://family-chess-theta.vercel.app**. Verify that it is still the correct project deployment before depending on it or editing CORS allowlists.

### Local development

For a quick static preview, serve the repository via a local HTTP server (do not rely on opening index.html via file://):

~~~bash
cd family-chess
python3 -m http.server 8000
# Then open http://localhost:8000
~~~

The local UI can be inspected this way. **Auth redirect flows and Edge Function CORS may fail on localhost** until localhost is added to Supabase Auth redirect allowlists and the Edge Functions' explicit allowed origins are changed for that development environment. Avoid putting development origins in production unnecessarily.

## 6. Supabase authentication configuration

1. Go to https://supabase.com/dashboard/project/xozummfupjmsmxooawdx.
2. Check **Authentication > Providers** and ensure Email/password is enabled if using the built-in login flow.
3. In **Authentication > URL Configuration**, **keep League Lab's current Site URL unchanged**.
4. Add **https://chess.allseasonpestllc.com/** to **Redirect URLs**. Add any Vercel preview URL only when needed; add localhost redirects only for deliberate local testing.
5. Configure/verify email confirmations and password recovery; production email volume may require a custom SMTP provider.
6. Test registration, email confirmation, sign-in, password reset and sign-out using actual client URLs.

Because the Supabase Auth directory is shared, changing a project-wide authentication setting can affect **both Chess and League Lab**. Changes to auth templates, allowed redirect URLs, email delivery, providers or security controls need cross-app review.

## 7. Realtime, challenges, chat and push

- The game sends/receives match state through Supabase database tables/functions and Realtime subscriptions. User identity comes from Supabase Auth.
- Online challenges are stored in **chess_challenges**, with expiry approximately 60 seconds after creation. The accept/decline flow calls database RPCs and can create/join games.
- Online move commits are designed to be server-authoritative. The Edge Function checks the logged-in user and legal chess position before calling a database commit function. Avoid replacing these protected operations with unsecured direct client inserts/updates.
- Participants' chat and spectators' chat are **separate tables** and have their own access policies. Review RLS whenever modifying spectator access or adding new messages.
- Push subscriptions are registered from chess-social.js and notifications displayed by chess-sw.js. The browser uses a **public** VAPID key. The corresponding **private** VAPID key belongs only in protected Supabase secrets / an appropriately protected Vault flow.
- iOS Web Push generally requires the user to install the website on the Home Screen and grant notification permission; support depends on browser/OS conditions. Test notification and invite opening on a real device.
- Three Chess Edge Function source files exist under supabase/functions. Updating one requires a deliberate Supabase deployment; updating index.html alone does not publish Edge Function changes.

Be aware that the deployed Edge Functions' **verify_jwt** setting is currently false, while the function code explicitly validates the bearer token/user. Preserve and review this internal validation before any change; disabling application-level checks would be a serious security problem.

## 8. Clock modes and profile preferences

Current DB clock options: **off**, **10m**, **12m**, **15m**, and **move60** (60 seconds per move).

- The frontend clock implementation is in chess-clock.js.
- Online game clocks are stored on chess_games; the backend commit functions determine authoritative updates.
- Special pawn-for-time rules were built for normal timed games. The newer **move60** mode instead uses a sudden-death loss on timeout.
- Personal color settings persist on **chess_profiles.piece_color**; the computer/practice opponent preference persists on **chess_profiles.practice_opponent_color**.
- The app also uses browser localStorage for some UI preferences and pending edits. Browser storage does not replace a successful Supabase profile save.
- If changing clock or profile behavior, test across two separate signed-in browsers and after a full reload; verify both 2D and 3D views and that saved colors appear to the other online participant.

## 9. Edge Function deployment and secrets

If backend source changes, deploy the specific function to the **existing** project xozummfupjmsmxooawdx using the current Supabase Dashboard, CLI or authorized integration. Confirm the exact active project before applying changes.

Source folders:

~~~text
supabase/functions/chess-submit-move/
supabase/functions/chess-clock-action/
supabase/functions/chess-notify-challenge/
~~~

Relevant server-only values used by function code:

- SUPABASE_URL
- SUPABASE_ANON_KEY (where used)
- SUPABASE_SERVICE_ROLE_KEY
- CHESS_VAPID_PUBLIC_KEY (public half, also used server-side for sending)
- CHESS_VAPID_PRIVATE_KEY (must remain private; code may consult protected Vault configuration)

Supabase provides standard project environment variables for Edge Functions. Keep service credentials and the VAPID private key out of GitHub and frontend files; use Supabase-managed secrets and restricted access. Never paste secrets into issue comments or a downloaded support ZIP.

Before production changes, back up relevant live data and test RLS/permissions for participating players, spectators, unrelated authenticated users and signed-out visitors. Do not loosen security policies simply to make client queries pass.

## 10. Regression tests and checks

This repository includes a GitHub Actions job running Node.js 22, syntax checks and automated tests. Run locally with Node.js 22 or a compatible runtime:

~~~bash
node --check auth-gate.js
node --check chess-online.js
node --check chess-social.js
node --check chess-sw.js
node --test tests/*.test.mjs
~~~

Tests cover AI five-level behavior, profile color persistence, timing and pause rules, social features and UI expectations. Passing tests do not substitute for real-device tests of multiplayer reconnects, email redirects, push delivery, RLS and the live database.

Recommended manual verification after significant changes: login/logout; two different accounts in separate browsers; create/accept/decline/expire challenges; moves and reconnect after refresh; spectators; send/read/delete chat as permitted; timed play and pause; persistent profile colors; computer levels 1–5; 2D/3D boards; iPhone keyboard/chat layout; Home Screen PWA.

## 11. Backup, migration and restoration: read before using this ZIP

The GitHub project ZIP is a **snapshot of the tracked source code**: static frontend, assets, SQL scripts, tests, and Edge Function source. It is **not** a full backup of the live shared Supabase instance, Auth accounts, database rows, Supabase Vault, function secrets, runtime configuration, Git commit history, or Vercel/GoDaddy account settings.

If restoring from scratch to a DIFFERENT Supabase project, you will need additional work: export/migrate the Chess schema **including full table definitions, RLS policies, functions, triggers, grants and Realtime configuration**; handle Auth users and IDs; deploy the Edge Functions with new protected secrets; update config.js and origin allowlists; set auth redirect URLs; and establish hosting/DNS. The incremental SQL files in database/ are not sufficient to promise a full blank-database rebuild.

For a safe backup of the **current** installation, keep:
1. A dated ZIP / Git commit of this repository.
2. A verified database backup or SQL export of the Chess-specific schema and any Chess data you intend to preserve, performed using an authorized secure method.
3. A separate inventory of Supabase Auth, RLS, Edge Function deployment versions and project-level settings (without exposing secret values).
4. Vercel project/domain and GoDaddy DNS configuration records.

Do not run destructive backup/restore experiments on the League Lab production project: Chess and the football app share that infrastructure.

## 12. Useful links

- Chess live site: https://chess.allseasonpestllc.com
- GitHub: https://github.com/russelldegolyer/family-chess
- Supabase project: https://supabase.com/dashboard/project/xozummfupjmsmxooawdx
- Vercel dashboard: https://vercel.com/dashboard
- GitHub Actions: https://github.com/russelldegolyer/family-chess/actions
- Supabase documentation: https://supabase.com/docs

---

**Maintenance rule:** Edit Chess in the Chess repository and Chess-prefixed database resources; preserve League Lab's separate frontend and football tables. Update this README when the Supabase schema, Edge Functions, deployment settings, or core game behavior changes.
