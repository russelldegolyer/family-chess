# Family Chess — Phase 1 (shared League Lab Supabase project)

## What this does

Standalone static chess site with working local/computer board and wired Supabase email/password sign-up, email confirmation, login, password reset and sign-out. This is **not yet live player-vs-player chess**. The original game used a Claude-specific backend, which must be replaced for production multiplayer.

## Existing Supabase configuration

This package is already configured with the **public** Supabase URL and publishable key from existing project `league-lab-2026` (`xozummfupjmsmxooawdx`). Do not create a third Supabase project.

The user has already enabled email/password signup and confirmation, and created these tables with RLS: `public.chess_profiles`, `public.chess_games`, and `public.chess_moves`. All existing football tables must remain untouched.

Auth → URL Configuration: keep the existing League Lab **Site URL** unchanged. Add `https://chess.allseasonpestllc.com/` to Redirect URLs. For temporary tests on the initial Vercel URL, add that exact URL as an additional Redirect URL too. The client explicitly passes `emailRedirectTo` and `redirectTo` for confirmation/password reset.

## Deploy on Vercel

1. Create a **new** GitHub repository for Family Chess; upload all files in this ZIP to the repository root (not the ZIP itself). A private repository is fine.
2. In Vercel, click Add New → Project → Import the new GitHub repository. Do **not** select the League Lab repository or project.
3. Framework Preset: Other. This is a static HTML site; leave Build Command and Output Directory unset (use project defaults). Deploy.
4. Open the Vercel deployment URL and verify the landing screen loads. To test email confirmations on that temporary URL, add it as an allowed Redirect URL in Supabase first.
5. In the new chess Vercel project, use Settings → Domains → Add `chess.allseasonpestllc.com`. Copy the DNS configuration Vercel displays.
6. In GoDaddy DNS for `allseasonpestllc.com`, add or update **only the chess subdomain** using the exact record and target Vercel provides (usually a CNAME for `chess`). Do not modify `nfl` or any existing records.
7. Test signup, confirmation, login, log out, forgot password, and computer/local chess.

## Next development phase

Implement private chess usernames/profile creation, invitation/join flow, game room access, secure server-authoritative validation of moves (including promotion, castling, check, checkmate, and concurrency), synchronized Realtime updates and reconnect behavior, and per-game chat with RLS. Existing `chess_games` and `chess_moves` deliberately do **not** allow arbitrary client updates or inserts.

## Security and operational notes

- Public Supabase URL and publishable key in browser JavaScript are expected. **Never** add your database password, service-role key, or secret key here.
- `chess_profiles` is currently *not automatically populated* by this Phase 1 auth gate. We will add a username/profile onboarding flow before multiplayer.
- The login gate is not a substitute for database access policies; keep RLS enabled.
- Third-party JS dependencies load from CDN; the app requires an internet connection.
- The project's built-in email delivery has limits; custom SMTP may be appropriate before wider family use.