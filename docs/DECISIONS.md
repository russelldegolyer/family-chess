# Chess — Decisions

Active decisions are authoritative. Superseded ones stay for history; don't restore them.
Dates are when the decision was made or shipped (2026).

| ID | Decision | Reason | Date | Affects | Status |
| --- | --- | --- | --- | --- | --- |
| D-01 | Host as a static site on Vercel, backend on the existing League Lab Supabase project, Chess data only in `chess_*` | Reuse one Supabase project; keep apps separate | Nov | all | Active |
| D-02 | Online moves, clock actions and challenges go through Edge Functions / SECURITY DEFINER RPCs, never direct client writes | Server-authoritative play | Nov | online | Active |
| D-03 | Five computer levels, shown as numbers 1–5 only: 1 easy, 2 casual, 3 hard, 4 and 5 extreme (4 Gukesh-style tactical/dynamic, 5 Magnus-style positional/adaptable); never the old 3-level system | Russell's request, clarified Nov 11 | Nov 9 / Nov 11 | computer | Active |
| D-04 | `move60` timeout is a sudden-death loss; pawn-for-time and pawn penalty apply to 10/12/15-min clocks | Recorded in move60 migration | Nov 9 | clocks | Active |
| D-05 | Practice clock does not start until the first move of the game | Opening/thinking shouldn't cost time | Nov 10 | clocks | Active |
| D-06 | Opening screen: side-on 3D board, swipe (or tap) to pick White/Black, difficulty slider 1–5; replaces auto-starting a computer game | Russell's request | Nov 10 | start, New | Active |
| D-07 | Black pieces are always black; a player's colour paints only White pieces (practice: yours; online: the White player's). Nothing recolours when a side is picked | Swiping to Black looked like the sides swapped | Nov 10 | colours, chooser | Active |
| D-07a | Each player's colour on their own side, plus a separate computer colour | — | Oct–Nov 10 | colours | Superseded by D-07 |
| D-08 | New returns to the opening screen; asks to confirm only if moves have been made | Russell's request | Nov 10 | toolbar | Active |
| D-09 | Old "New game" sheet (Two Players / Play Computer / starting side) retired and its code removed; no same-screen two-player unless Russell asks for it back | Replaced by D-06 | Nov 10–11 | setup | Active |
| D-10 | ⋯ menu holds only Choose board, Move history, Settings; Pause/Resign/Flip removed from it (Pause/Resign are on the toolbar) | Redundant entries | Nov 10 | menu | Active |
| D-11 | Toolbar order: New, Undo, Resign, Pause, Reset view, 2D/3D, colours, ⋯; chat header mirrors New/Undo/Resign/Pause/Reset view | Russell's request | Nov 10 | toolbar, chat | Active |
| D-12 | Abandoned matches (closed by a newer invite/challenge) are deleted by trigger, not stored | Russell's request, approved deletion | Nov 10 | DB, My matches | Active |
| D-13 | Opening an online match ends the current practice game; leaving online returns to the opening screen | Avoid leftover computer games | Nov 10 | practice/online | Active |
| D-14 | Play online is one sheet: players → share invite → live now → My matches → Settings disclosure | Simplify clutter | Nov 10 | lobby | Active |
| D-15 | Game review steps only through key moments (mistakes, blunders, inaccuracies, strong replies) by default, with an "Every move" toggle | Skip pointless "best/reasonable" stops | Nov 10 | review | Active |
| D-16 | Leaked-password protection stays off | Russell declined | Nov 10 | Supabase Auth | Active |
| D-17 | iPhone-style UI (system font, frosted panels, flat toolbar) | Russell's request | Nov 5 | UI | Active |
| D-19 | Settings is one compact list (clock, computer speed, moving pieces, 2D pieces, last move, sound, board FX) with no explanatory text, fitting one phone screen | Russell's request | Nov 11 | settings | Active |
| D-18 | Computer colour retired: one colour per account, used for White pieces only (completes D-07) | Russell confirmed Nov 11 | Nov 11 | colours, profiles | Active |
| D-20 | Training mode (puzzles, Endgame Academy, Endgame Challenges) reuses the real board via a bridge; entering saves the game in progress and leaving restores it (online matches are detached and reopened) | Russell's spec, Nov 11 | Nov 11 | training | Active |
| D-21 | Changing the clock applies to the game in progress: total→total shifts both clocks by the difference; switching to/from 60 s per move starts the new mode fresh; pauses stay paused | Russell's spec | Nov 11 | clocks | Active |
| D-22 | Academy curriculum: Fundamentals (mate/stalemate, restricting, opposition, square rule, key squares) → basic mates → pawn endgames → advanced mates. Exercises are judged by exact tables: any move that keeps the result is right; a much slower win is "inefficient", never wrong | Russell: profound lessons, fundamentals first | Nov 11 | training | Active |
| D-23 | Only two 3D boards: Default (black & white) and Wooden; the other four were removed, and anyone who had one falls back to Default | Russell: the extra 3D boards were pointless | Nov 11 | boards | Active |
| D-24 | Saved games live in the player's account (chess_saved_games), including computer games; each player saves for themselves (a second save of the same game asks overwrite or save new). Resuming with a person goes through the chess-saved-game Edge Function (moves re-checked with chess.js, 10-minute "saved" invite, inviter keeps their side). Unkept saves are deleted once picked up | Russell's spec, Nov 12 | Nov 12 | saved games, supabase | Active |
| D-25 | Friends system: you only see, invite, watch and look up people you are friends with (friend codes; existing opponents auto-friended). Invite links still work for anyone holding the link | Russell, Nov 12 | Nov 12 | friends, privacy | Active |

## D-26 Accuracy (2026-11-12)
Per-player accuracy uses Lichess's win-chance formula on the built-in engine, run on the player's device after the game. Online values are saved once per game via `chess_set_game_accuracy` (first values stay); computer games keep it in the device game log.

## D-27 2D black-piece accents (2026-11-12)
Refines D-07 for 2D only: black pieces keep a black body, but their outline and carving lines use the player's colour (practice: yours; online: the Black player's). 3D black pieces are unchanged.

## D-28 Switch sides before the first move (2026-11-12)
The challenger still starts as White, but either player can swap seats until a move or clock action exists (`chess_swap_sides`, server-checked). Saved-game resumes keep their seats.

## D-29 The computer has no colour (2026-11-12)
Russell: computer pieces are plain white or black. Vs the computer, only the human's army wears their colour (White pieces in 3D/2D when you're White; 2D black accents when you're Black). Plates rim in each human's colour; the computer's plate is neutral. Supersedes D-07's "White always wears your colour in practice" for games vs the computer (the opening chooser is unchanged).

## D-30 Challenges path (2026-11-12)
Russell: chapters build on each other, all open with a recommended next, personal only (no family progress/races). Chapter progress lives in the training profile (`P.path`), alongside lessons and challenges.
