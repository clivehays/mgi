"""Create the MGI v5 submissions table in the Supabase project.

Idempotent. Reads credentials from clover-agents/.env, which is not in this repo.
Kept here so the schema lives beside the code that writes to it.

Reads credentials from clover-agents/.env. Idempotent: safe to re-run.
"""
import io
import os
import re
import sys

import psycopg2

ENV = r"C:\Users\Administrator\clover-agents\.env"

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

# Supabase pooler wants the project ref in the username
user = "postgres.%s" % project

DDL = """
create table if not exists mgi_v5_submissions (
  id                    bigint generated always as identity primary key,
  submitted_at          timestamptz not null,
  created_at            timestamptz not null default now(),

  -- which instrument produced this row. Rows are only comparable to each
  -- other when both of these match; see the provenance block in scoring.js
  instrument_version    text,
  instrument_fingerprint text,

  -- who answered
  first_name            text not null,
  email                 text not null,
  company               text not null,
  role                  text not null,
  industry              text,
  industry_option       text,
  team_size             text,
  -- how long they have led this team. Recency answers scale with both team
  -- size and tenure, so both are needed to control the signal score
  tenure                text,

  -- research consent, required before anything is stored
  consent               boolean not null default false,
  consent_at            timestamptz,

  -- the twenty answers, one column each so cohort queries are plain SQL
  gut                   text not null,
  q1  smallint, q2  smallint, q3  smallint, q4  smallint,
  q5  smallint, q6  smallint, q7  smallint, q8  smallint,
  q9  smallint, q10 smallint, q11 smallint, q12 smallint,
  -- added in v6, the third item in each of equipped, work and why
  q13 smallint, q14 smallint, q15 smallint,
  output                text not null,
  external_pressure     text not null,
  energy                text not null,
  exposure              text not null,

  -- what the instrument concluded
  state                 text not null,
  decision_rule         smallint,
  confidence            text not null,
  gap                   text,
  signal                smallint,
  behaviour             numeric(4,2),
  weak_areas            smallint,
  area_ranking          text,

  -- per-area means and the most recent answer in each, for segmentation
  area_equipped         numeric(4,2), area_equipped_recency smallint,
  area_work             numeric(4,2), area_work_recency     smallint,
  area_invested         numeric(4,2), area_invested_recency smallint,
  area_why              numeric(4,2), area_why_recency      smallint,
  area_truth            numeric(4,2), area_truth_recency    smallint,

  -- full fidelity, for anything the columns above do not anticipate
  answers               jsonb not null
);

-- "create table if not exists" does nothing to a table that already exists,
-- so columns added after the first deploy need their own statements.
alter table mgi_v5_submissions add column if not exists instrument_version     text;
alter table mgi_v5_submissions add column if not exists instrument_fingerprint text;
alter table mgi_v5_submissions add column if not exists tenure                 text;
alter table mgi_v5_submissions add column if not exists q13                    smallint;
alter table mgi_v5_submissions add column if not exists q14                    smallint;
alter table mgi_v5_submissions add column if not exists q15                    smallint;

create index if not exists mgi_v5_submitted_at_idx on mgi_v5_submissions (submitted_at desc);
create index if not exists mgi_v5_instrument_idx   on mgi_v5_submissions (instrument_version, instrument_fingerprint);
create index if not exists mgi_v5_state_idx        on mgi_v5_submissions (state);
create index if not exists mgi_v5_industry_idx     on mgi_v5_submissions (industry_option);
create index if not exists mgi_v5_email_idx        on mgi_v5_submissions (email);

alter table mgi_v5_submissions enable row level security;
"""

print("connecting to %s as %s" % (host, user))
conn = psycopg2.connect(
    host=host, port=5432, dbname="postgres", user=user, password=password,
    sslmode="require", connect_timeout=20,
)
conn.autocommit = True
cur = conn.cursor()
cur.execute(DDL)
print("table created (or already present)")

cur.execute("""
    select column_name, data_type
    from information_schema.columns
    where table_name = 'mgi_v5_submissions'
    order by ordinal_position
""")
cols = cur.fetchall()
print("%d columns:" % len(cols))
print("  " + ", ".join(c[0] for c in cols))

cur.execute("""
    select relrowsecurity from pg_class where relname = 'mgi_v5_submissions'
""")
print("row level security enabled: %s" % cur.fetchone()[0])

cur.execute("select count(*) from mgi_v5_submissions")
print("rows: %d" % cur.fetchone()[0])

cur.close()
conn.close()
