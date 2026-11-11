#!/usr/bin/env python3
"""Load the Lichess puzzle database (CC0, ~5M rows) into public.chess_puzzles.

Run from a computer, never from the app. Needs: pip install zstandard psycopg[binary]
  DATABASE_URL=postgresql://... python3 tools/import-lichess-puzzles.py            # stream + COPY
  python3 tools/import-lichess-puzzles.py --csv puzzles.csv                        # just write a CSV
Options: --min-plays N (default 50) and --min-popularity N (default 0) skip unreliable puzzles;
--limit N for a trial run. Apply database/chess-training-clock-presence-2026-11-11.sql first.
Rows are upserted by puzzle id, so re-running refreshes ratings without duplicates.
"""
import argparse, csv, io, os, sys, urllib.request

URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst'
COLS = ('id', 'fen', 'moves', 'rating', 'rating_deviation', 'popularity', 'nb_plays', 'themes')


def rows(min_plays, min_pop, limit):
    import zstandard
    with urllib.request.urlopen(URL) as resp:
        text = io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(resp), encoding='utf-8')
        n = 0
        for r in csv.DictReader(text):
            if int(r['NbPlays'] or 0) < min_plays or int(r['Popularity'] or 0) < min_pop:
                continue
            themes = '{' + ','.join(t for t in r['Themes'].split() if t.isalnum()) + '}'
            yield (r['PuzzleId'], r['FEN'], r['Moves'], int(r['Rating']), int(r['RatingDeviation'] or 0),
                   int(r['Popularity'] or 0), int(r['NbPlays'] or 0), themes)
            n += 1
            if limit and n >= limit:
                return


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv'); ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--min-plays', type=int, default=50); ap.add_argument('--min-popularity', type=int, default=0)
    a = ap.parse_args()
    src = rows(a.min_plays, a.min_popularity, a.limit)
    if a.csv:
        with open(a.csv, 'w', newline='') as f:
            w = csv.writer(f); w.writerow(COLS); n = sum(1 for r in src if w.writerow(r) or True)
        print(f'wrote {n} puzzles to {a.csv}'); return
    url = os.environ.get('DATABASE_URL')
    if not url:
        sys.exit('Set DATABASE_URL (or use --csv).')
    import psycopg
    with psycopg.connect(url) as con, con.cursor() as cur:
        cur.execute('create temp table puzzle_load (like public.chess_puzzles including defaults) on commit drop')
        n = 0
        with cur.copy('copy puzzle_load (' + ','.join(COLS) + ') from stdin') as cp:
            for r in src:
                cp.write_row(r); n += 1
                if n % 250000 == 0:
                    print(n, 'rows streamed', flush=True)
        cur.execute('insert into public.chess_puzzles (' + ','.join(COLS) + ') select ' + ','.join(COLS) +
                    ' from puzzle_load on conflict (id) do update set rating=excluded.rating,'
                    ' rating_deviation=excluded.rating_deviation, popularity=excluded.popularity,'
                    ' nb_plays=excluded.nb_plays, themes=excluded.themes')
        con.commit()
    print(f'loaded {n} puzzles')


if __name__ == '__main__':
    main()
