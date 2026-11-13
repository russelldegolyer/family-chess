# Changelog

One entry per deploy, newest first. Each entry is dated and grouped as **Added / Improved / Fixed / Removed**
(only the groups that apply). Write in plain words, the way Russell would describe it. Commit counts per day
come from `git log --format=%ad --date=short | sort | uniq -c`.

| Day | Commits |
| --- | --- |
| 2026-11-12 | 38 |
| 2026-11-11 | 31 |
| 2026-11-10 | 24 |
| 2026-11-09 | 130 |
| 2026-11-08 | 8 |

---

## 2026-11-12 — Your plate, biggest swing, softer 3D last move (deployed 8:37 PM)

**Added**
- End card: **Biggest swing** line under accuracy (your costliest move, e.g. "move 14… Nf3"); tap it to jump straight into Review at that move. A clean game says so.

**Improved**
- Phones: your own name plate now floats above the bottom bar with your clock inside, matching the opponent's plate. Captured pieces sit beside it.
- Long names show the first name only on phones; names are a little smaller on narrow screens.
- 3D last move is a softer yellow, matching the 2D board.

## 2026-11-12 — Clock in the name plate, tidier chat header (deployed 7:30 PM)

**Improved**
- Phones: the opponent's clock sits inside their name plate (one button, player colour border) instead of a separate box below. Challenges and Online pills are a little slimmer in games to make room. The plate stays the same size with chat open or closed.
- Chat header on phones: clock, tools, clear and close are one even row of matching pills (the clock turns green on your turn, red when low); the reset-view button is left out there since the board is flat with chat open.
- Captured pieces and +N stay visible with chat open (just above the chat), and sit beside your clock instead of covering it.

## 2026-11-12 — Accuracy, captured pieces, new opening screen (deployed 5:53 PM)

**Added**
- **Accuracy** (0–100, like chess.com): worked out on your phone after every game and shown on the end card,
  next to each finished game in My matches, and as an average on both record cards. Saved with online games.
- **Captured pieces and +N**: on phones, each player's taken pieces show in a small strip (opponent under their
  name, yours above the bottom bar) with the material lead, e.g. +3.

**Fixed**
- New friends now appear in your Friends list right after accepting (server fix, live already).

**Removed**
- "Play the computer / Choose your side" text on the opening screen.

**Improved**
- The **New** button is now **Home**: it takes you straight back to the opening screen (asks first mid-game).
- End card "New game" link is now "Home".
- 2D last move toned down: a soft yellow on both squares, no frames.
- Going home fades smoothly through black into the opening screen instead of snapping.
- Tapping **Your friend code** always shows it (loads it if it hadn’t appeared yet), then copies it.
- Watching a game shows one clear "Watching · A vs B — Leave" bar; Leave goes straight to the start screen.
- In online games the New button reads **Leave**.
- Saved games and Create game use the real board and pieces (your chosen 2D board colours).
- The top-right profile circle is now an **Online** button, styled like Challenges.
- Opening screen redesign: **Challenges** and **Online** are two big equal cards across the top (small again once a game starts), darker spotlight background, glass panel, red difficulty slider.
- No white flash while the app loads, in light or dark mode.

## 2026-11-12 — Friends, colour wheel, last move (deployed 4:16 PM)

**Added**
- **Friends**: everyone has a friend code; add friends by code, accept or decline requests, remove friends (Edit).
  Only friends show in the list, can see you online, can invite you or send you games, and can watch your games.
  People who had already played together start as friends. Joining through an invite link makes you friends.
- Friend requests send a push notification.
- Custom 2D board colours open the colour wheel.

**Improved**
- Opponent's last move is much easier to see (yellow squares, gold frame on 2D; brighter in 3D).
- Chat header and opponent name plate stay on one line with clocks showing.
- A saved game against someone who isn't a friend offers Play vs computer instead of a failing Invite.
- Automatic tests for friends.

## 2026-11-12 — Create game, per-player saves, saved clocks (deployed 1:46 PM)

**Added**
- **Create game** (Challenges → Saved games): set up any position (place, move and erase pieces, side to move),
  save it, then play it against the computer, on one screen, or send it to family. Load any saved game into the
  editor and save it as new or overwrite the original.
- Saved games pick up with the **same time on both clocks** as when they were saved (online and practice).
- Saving a game that already has a save asks **Overwrite last save / Save as new**.
- Bookmark fills in once the current position is saved.
- Board picker shows **2D and 3D boards on one screen**.

**Improved**
- Each player saves games for themselves (no longer saved for both).
- Saved game page and list fit on one screen; Keep and Delete side by side.
- Intro is a plain black fade into the board.
- Declining a saved-game invite closes the sender's waiting board and tells them.
- Games with pawn-for-time changes can now be saved.
- "Picking up where you left off" shows in a compact form while chat is open.
- Saved games limit is 30 per player.
- My matches shows "Open invite" instead of a cut-off "vs No opponent yet"; Load-saved sheet has a quiet Cancel.
- Automatic tests for saving, clocks, sending, Create game and early resign.

**Removed**
- "Setting the board" loading text.

## 2026-11-12 — Saved games, early resign, invites (deployed)

**Added**
- Save button (bookmark) next to resign; Saved games in Challenges with Invite / Continue / Send / Keep / Delete;
  resumed games mark both players' last moves.
- About Training page; puzzle settings sheet with rating ranges.

**Improved**
- Training board marks: outlined red zone, solid 3D zone, arrows above pieces, a key under the task, clearer lesson text.
- Training menu is a full-screen page (board hidden behind it).
- Invites stay open 70 s (notification still says 60 s); the "Invited" button clears on accept/decline.

**Fixed**
- Resigning in the first 3 moves removes the game instead of counting it (older ones cleaned up).

## 2026-11-11

**Added**
- Training mode: puzzles, Endgame Academy, Endgame Challenges. Live clock changes, "Last online".
- Record cards with full stats (vs players overall, vs computer per level).

**Improved**
- Chat open on phones: board keeps full width; clocks sit in the name plate and chat header.
- End-of-game card, opening screen, bottom bar and chat header redesigns.
- Computer levels 4/5 opening books and styles; pawn-for-time picked on the board.

**Removed**
- Four 3D boards (kept Default and Wooden); dead code sweep.

## 2026-11-10

**Added**
- Opening side chooser (swipe to pick White/Black, difficulty slider); five numbered computer levels.

**Improved**
- Settings and menus simplified; Play online simplified; review steps through key moments.

**Removed**
- Old pre-Supabase live layer and abandoned matches.

## 2026-11-09

**Added**
- Online play through Supabase: invites, 60-second challenges, push notifications, chat, clocks, pawn-for-time,
  per-profile piece colours.

## 2026-11-08

**Added**
- First version of the family chess app.
