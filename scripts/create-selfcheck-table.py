"""Create mgi_selfcheck, the table behind the eight-question self-check.

One row per completed scorecard at /team-state. It holds the answers, the
recomputed reading, the campaign labels from the landing URL and the
timings. It holds NO name, email, company or role, and it never should:
the page asks for none of those, and the privacy copy on it says so.

Tying a row back to a person happens outside this table, in
scripts/join-linkedin-leads.py, against a lead export from LinkedIn
Campaign Manager. landed_at is what that join matches on, so it is
indexed.

Run this BEFORE deploying the page. PostgREST refuses an insert that
names a column the table does not have, and the page posts its row after
the scorecard is already on the screen, so a missing table loses the row
silently while looking perfectly healthy.

Idempotent: safe to run again, and it reports what it found. Reads
credentials from clover-agents/.env, like the other scripts here. Pass a
table name to create a preview copy instead:

    python scripts/create-selfcheck-table.py
    python scripts/create-selfcheck-table.py mgi_selfcheck_preview

Reversible with:
    drop table mgi_selfcheck;
"""
import io
import re
import sys

import psycopg2

ENV = r"C:\Users\Administrator\clover-agents\.env"
TABLE = sys.argv[1] if len(sys.argv) > 1 else "mgi_selfcheck"

if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", TABLE):
    sys.exit("refusing an odd table name: %r" % TABLE)

vals = {}
for line in io.open(ENV, encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    vals[k.strip()] = v.strip().strip("'").strip('"')

host = vals["SUPABASE_DB_HOST"]
password = vals["SUPABASE_DB_PASSWORD"]
project = re.sub(r"^https://", "", vals["SUPABASE_URL"]).split(".")[0]
user = "postgres.%s" % project

conn = psycopg2.connect(
    host=host, port=5432, dbname="postgres", user=user, password=password,
    sslmode="require", connect_timeout=20,
)
conn.autocommit = True
cur = conn.cursor()

DDL = """
create table if not exists %(t)s (
  id                     bigserial primary key,
  created_at             timestamptz not null default now(),

  -- which form and which instrument produced this row. A row only pools
  -- with the full assessment when the fingerprints match.
  form                   text        not null,
  instrument_version     text        not null,
  instrument_fingerprint text        not null,

  -- timings. landed_at is the first paint of the page and is what a lead
  -- export is matched against; submitted_at is the server's own clock.
  landed_at              timestamptz,
  started_at             timestamptz,
  submitted_at           timestamptz not null,
  seconds_taken          integer,

  -- the ten answers. The evidence items keep the numbers they have in the
  -- full instrument, so q1 here and q1 on mgi_v5_submissions are the same
  -- question and can be compared directly.
  gut                    text        not null,
  q1                     smallint    not null,
  q9                     smallint    not null,
  q11                    smallint    not null,
  output                 text        not null,
  external_pressure      text        not null,
  energy                 text        not null,
  exposure               text        not null,

  -- the reading, recomputed server side from the answers above
  signal                 smallint    not null,
  behaviour_mean         numeric(4,2) not null,
  state                  text        not null,
  decision_rule          smallint    not null,
  gap                    text        not null,
  line_of_sight          text        not null,
  line_of_sight_score    smallint    not null,
  stale                  smallint    not null,
  focus                  text,

  -- where the visit came from. source is utm_*, s and (after cookie
  -- consent only) li_fat_id. lead_form is the lf= label put on the
  -- thank-you URL of a LinkedIn lead form.
  visit_id               text,
  lead_form              text,
  referrer_host          text,
  source                 jsonb,
  cookie_consent         boolean     not null default false,

  -- the owner's own test runs, so they can be filtered rather than lost
  internal               boolean     not null default false,

  constraint %(t)s_steps check (
    q1 between 0 and 3 and q9 between 0 and 3 and q11 between 0 and 3
  ),
  constraint %(t)s_signal check (signal between 0 and 9)
);
""" % {"t": TABLE}

INDEXES = [
    ("%s_landed_at_idx" % TABLE,
     "create index if not exists %s_landed_at_idx on %s (landed_at)" % (TABLE, TABLE)),
    ("%s_lead_form_idx" % TABLE,
     "create index if not exists %s_lead_form_idx on %s (lead_form)" % (TABLE, TABLE)),
    ("%s_submitted_at_idx" % TABLE,
     "create index if not exists %s_submitted_at_idx on %s (submitted_at)" % (TABLE, TABLE)),
]


def exists():
    cur.execute(
        "select 1 from information_schema.tables where table_name = %s", (TABLE,))
    return cur.fetchone() is not None


had = exists()
cur.execute(DDL)
print("%s %s" % (TABLE, "already existed, left as it was" if had else "created"))

for name, sql in INDEXES:
    cur.execute(sql)
print("%d index(es) in place" % len(INDEXES))

# Row level security on, with no policy: the service role key the function
# uses bypasses it, and the anon key reads nothing. Same posture as the
# submissions table.
cur.execute("alter table %s enable row level security" % TABLE)
print("row level security enabled")

cur.execute("""
  select column_name, data_type, is_nullable
  from information_schema.columns where table_name = %s order by ordinal_position
""", (TABLE,))
cols = cur.fetchall()
print("\n%d columns:" % len(cols))
for name, kind, nullable in cols:
    print("  %-24s %-28s %s" % (name, kind, "null" if nullable == "YES" else "not null"))

cur.execute("select count(*) from %s" % TABLE)
print("\nrows: %d" % cur.fetchone()[0])
