"""Add two nullable columns to public.mgi_funnel.

    step    text   furthest milestone as a word (landing, start, q1, q5,
                   q10, q15, q20, contact, submitted)
    client  jsonb  coarse bot flags only: {ua, wd, scr}. Never the raw
                   user agent or screen sizes.

Idempotent and additive. api/funnel.js writes the columns when they exist
and falls back to the old row when they do not, so this can run before or
after the deploy. Reads credentials from clover-agents/.env, which is not
in this repo, and prints column names and row counts only.
"""
import io
import re

import psycopg2

ENV = r"C:\Users\Administrator\clover-agents\.env"

vals = {}
for line in io.open(ENV, encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    vals[k.strip()] = v.strip().strip("'").strip('"')

project = re.sub(r"^https://", "", vals["SUPABASE_URL"]).split(".")[0]

DDL = [
    "alter table public.mgi_funnel add column if not exists step text null",
    "alter table public.mgi_funnel add column if not exists client jsonb null",
]

COLS = ("select column_name || ':' || data_type from information_schema.columns "
        "where table_schema='public' and table_name='mgi_funnel' order by ordinal_position")

conn = psycopg2.connect(
    host=vals["SUPABASE_DB_HOST"], port=5432, dbname="postgres",
    user="postgres.%s" % project, password=vals["SUPABASE_DB_PASSWORD"],
    sslmode="require", connect_timeout=20,
)
cur = conn.cursor()


def snap():
    cur.execute(COLS)
    cols = ", ".join(r[0] for r in cur.fetchall())
    cur.execute("select count(*) from public.mgi_funnel")
    return cols, cur.fetchone()[0]


try:
    print("before: %s | rows %d" % snap())
    for sql in DDL:
        cur.execute(sql)
    conn.commit()
    cur.execute("notify pgrst, 'reload schema'")
    conn.commit()
    print("after:  %s | rows %d" % snap())
except Exception as e:  # never echo the connection details
    conn.rollback()
    print("ERROR %s" % type(e).__name__)
    raise SystemExit(1)
finally:
    conn.close()
