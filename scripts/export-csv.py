"""Export every MGI submission to CSV, one row per submission, one column per question.

This dataset feeds a book, so the export is the deliverable, not the emails.
Reads credentials from clover-agents/.env, which is not in this repo.

    python scripts/export-csv.py                  -> mgi-export-<date>.csv
    python scripts/export-csv.py out.csv          -> named file
    python scripts/export-csv.py out.csv --anon   -> drops name, email and company

Use --anon for anything that leaves this machine. The raw table holds personal
data; the research claims never need it.
"""
import csv
import io
import os
import re
import sys
from datetime import date

import psycopg2

ENV = r"C:\Users\Administrator\clover-agents\.env"

# the twelve evidence items, so the header says what each column means
QUESTIONS = [
    "blocker raised early", "peer help not routed through you", "looked at real work",
    "outside comment unprompted", "unprompted idea", "unhurried one-to-one",
    "priority in their words", "pushed back on work", "open disagreement",
    "problem from the person", "least-sure person", "changed your mind",
]

PII = ("first_name", "email", "company")


def creds():
    vals = {}
    for line in io.open(ENV, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            vals[k.strip()] = v.strip().strip("'").strip('"')
    return vals


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    anon = "--anon" in sys.argv
    out = args[0] if args else "mgi-export-%s.csv" % date.today().isoformat()

    v = creds()
    project = re.sub(r"^https://", "", v["SUPABASE_URL"]).split(".")[0]
    conn = psycopg2.connect(
        host=v["SUPABASE_DB_HOST"], port=5432, dbname="postgres",
        user="postgres.%s" % project, password=v["SUPABASE_DB_PASSWORD"],
        sslmode="require", connect_timeout=20,
    )
    cur = conn.cursor()

    cur.execute("""
        select column_name from information_schema.columns
        where table_name = 'mgi_v5_submissions' and column_name <> 'answers'
        order by ordinal_position
    """)
    cols = [r[0] for r in cur.fetchall()]
    if anon:
        cols = [c for c in cols if c not in PII]

    cur.execute("select %s from mgi_v5_submissions order by id" % ", ".join('"%s"' % c for c in cols))
    rows = cur.fetchall()

    # q1..q12 get their question in the header, so the file reads without the codebook
    header = []
    for c in cols:
        m = re.match(r"^q(\d+)$", c)
        header.append("%s: %s" % (c, QUESTIONS[int(m.group(1)) - 1]) if m else c)

    with io.open(out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in rows:
            w.writerow(["" if x is None else x for x in r])

    print("%d rows, %d columns -> %s%s" % (len(rows), len(cols), out, "  (anonymised)" if anon else ""))
    if not anon and rows:
        print("NOTE: this file contains names, emails and company names. Use --anon for anything you share.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
