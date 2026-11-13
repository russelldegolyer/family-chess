# Changelog

One entry per deploy, newest first. Each entry is dated and grouped as **Added / Improved / Fixed / Removed**
(only the groups that apply). Write in plain words, the way Russell would describe it. Commit counts per day
come from `git log --format=%ad --date=short | sort | uniq -c`.

| Day | Commits |
| --- | --- |
| 2026-11-12 | 52 |
| 2026-11-11 | 31 |
| 2026-11-10 | 24 |
| 2026-11-09 | 130 |
| 2026-11-08 | 8 |

---

## Unreleased

**Added**
- **Voice chat**: tap the mic in a live game; the other player gets "X wants to talk — Join / Not now". Once connected it stays on through the end of the game, review, Home and new games, until either of you taps the green mic or leaves the app. Separate mute button. No phone numbers; audio goes app to app, encrypted, never recorded; the handshake channel is private to the two friends.

## 2026-11-12 — Your path, desktop polish (deployed 11:11 PM)

**Added**
- **Your path** in Challenges: 16 chapters from checkmate basics to two-bishop mates. Each chapter is Learn → Practise → Prove it, using the existing lessons, themed puzzles and endgame challenges. All chapters are open; the first unfinished one is marked Recommended next. Progress is saved to your account.

**Improved** (desktop)
- Top right is now two matching pills, **Challenges** and **Online**, instead of the email / "Practice mode" strip (email and Sign out stay in Online → Settings).
- Opening screen: the board is much bigger and centred above the White/Black card, and the card sits under the board (not under the chat).
- Chat header is just "Chat" with clear and close (game controls are in the bottom bar), so nothing overlaps.
- 2D board no longer has the 3D board ghosting behind it.
- "Pick your side" sits in the left column so it never covers the board.

## 2026-11-12 — Computer stays plain, black-piece colour fixes (deployed 10:00 PM)

**Fixed**
- The computer never wears a colour: as White vs the computer, its black pieces are plain; as Black, its white pieces are plain white (2D and 3D) and its name plate is neutral grey.
- 2D black-piece accents only show for a human playing Black (online: their colour; vs computer: yours when you're Black), and the lines are thinner.

**Improved**
- 2D black pieces update to a new colour right away (no need to leave and re-enter 2D), and coloured black pieces drop the light rim.
- Name plates use each person's own colour (online, the Black player's plate now shows their colour too).

## 2026-11-12 — Rematch, chat across games, pick your side (deployed 9:43 PM)

**Added**
- Online end card: **Rematch** sends your opponent a new challenge in one tap (and you can pick sides once they accept).
- Chat follows the two of you: messages from your recent games together stay in the thread (with a "New game" marker), and you can keep chatting after a game ends.
- Online games: a **Pick your side** card (White / Black) shows for both players until the first move. Tap the other side to switch seats for both of you. Not shown for resumed saved games.

**Improved**
- End card redesign: badge beside the result, tighter spacing, names instead of White/Black online; your plate, captured pieces and the status pill no longer show through it.
- Opening a new online game closes the last game's review, so chat is back right away.
- 3D board re-frames itself after an online game opens, so it never sits off in the distance.
- 2D boards: black pieces stay black, but their outline and inner lines (and the bishop's slit) are drawn in the player's colour (practice: yours; online: the Black player's).

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
