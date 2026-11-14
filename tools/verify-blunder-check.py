#!/usr/bin/env python3
"""Verify Blunder check answers with Stockfish (offline; not part of the app).

Input : rows.json   = [[puzzle_id, fen, "uci moves"], ...]  (the drill's puzzles: DB + chess-puzzles-dev.json)
Output: chess-blunder-check.json (shipped with the app; read by Blunder check in chess-training.js)
        {"safe": {id: "best reply"}, "lost": [ids: real mistake, no safe answer], "notBad": [ids: skipped]}

Rules (Stockfish 16.1, depth 18 for the verdict, depth 16 for the reply):
  bad  = the puzzle's first move scores 150+ centipawns worse than the best move (mate scores count as huge)
  safe = the best move, offered only when bad is true, it differs from the first move and the side to move
         is not already lost (best score >= -200); stored with Stockfish's best reply to it.

Usage: python3 verify-blunder-check.py STOCKFISH_BINARY rows.json
"""
import json, subprocess, sys

SF, ROWS = sys.argv[1], sys.argv[2]


class Engine:
    def __init__(self):
        self.p = subprocess.Popen([SF], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        for c in ('uci', 'setoption name Threads value 1', 'setoption name Hash value 64', 'isready'):
            self.send(c)
        self.until('readyok')

    def send(self, c):
        self.p.stdin.write(c + '\n')

    def until(self, tok):
        while not self.p.stdout.readline().startswith(tok):
            pass

    def go(self, fen, depth, moves='', searchmoves=''):
        self.send('position fen ' + fen + (' moves ' + moves if moves else ''))
        self.send('go depth %d' % depth + (' searchmoves ' + searchmoves if searchmoves else ''))
        score = None
        while True:
            w = self.p.stdout.readline().split()
            if w and w[0] == 'info' and 'score' in w:
                i = w.index('score'); kind, v = w[i + 1], int(w[i + 2])
                score = v if kind == 'cp' else (100000 - abs(v)) * (1 if v > 0 else -1)
            if w and w[0] == 'bestmove':
                return (None if w[1] == '(none)' else w[1]), score


def main():
    rows = json.load(open(ROWS)); e = Engine(); bad = {}; safe = {}
    for pid, fen, moves in rows:
        m0 = moves.split()[0]
        best, sb = e.go(fen, 18)
        s0 = sb if best == m0 else e.go(fen, 18, searchmoves=m0)[1]
        bad[pid] = best != m0 and sb is not None and s0 is not None and sb - s0 >= 150
        if bad[pid] and sb >= -200:
            reply, _ = e.go(fen, 16, moves=best)
            if reply: safe[pid] = best + ' ' + reply
    out = {'note': 'Blunder check answers verified by Stockfish 16.1 (depth 18). Built by tools/verify-blunder-check.py.',
           'safe': dict(sorted(safe.items())),
           'lost': sorted(i for i, b in bad.items() if b and i not in safe),
           'notBad': sorted(i for i, b in bad.items() if not b)}
    open('chess-blunder-check.json', 'w').write(json.dumps(out, separators=(',', ':')) + '\n')
    print(len(rows), 'checked;', sum(bad.values()), 'real mistakes;', len(safe), 'with a safe answer')


if __name__ == '__main__':
    main()
