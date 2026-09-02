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
  -- other when the fingerprints match; see the provenance block in scoring.js.
  --
  -- The two version columns mean different things and must not be conflated:
  --   collected_under    the version live when the participant submitted.
  --                      What they actually saw. Written once, never touched
  --                      by a backfill.
  --   instrument_version the version that produced the derived columns in
  --                      this row as they stand now. A backfill moves it.
  instrument_version    text,
  instrument_fingerprint text,
  collected_under       text,

  -- who answered
  first_name            text not null,
  email                 text not null,
  company               text not null,
  role                  text not null,
  industry              text,
  industry_option       text,
  -- whether this is a team they lead now. The recency items ask "when did
  -- you last", which means something different about a team someone has
  -- left, so those rows are labelled rather than mixed in or turned away
  currently_leading     text,
  team_size             text,
  -- how long they have led this team. Recency answers scale with both team
  -- size and tenure, so both are needed to control the signal score
  tenure                text,
  -- movement in the last six months. Research only: neither field reaches
  -- the report or the scoring. Departures are the nearest thing this study
  -- has to an outcome; arrivals are both a second outcome and a confound,
  -- because a new joiner generates the very events the recency items ask
  -- about and will freshen several of them on their own
  left_6m               text,
  joined_6m             text,

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

  -- how much of the team's week this manager is positioned to observe,
  -- and how far their picture and the team's reality are likely to sit
  -- apart. Exposure is not noise in the measurement, it is the mechanism
  -- that produces the gap, so it is reported as the scale of that gap
  line_of_sight_score   smallint,
  line_of_sight         text,
  mean_recency          numeric(3,2),
  gap_index             numeric(3,2),
  gap_width             text,

  -- DEPRECATED as of 6.1.0. Superseded by line_of_sight and gap_width.
  -- Still written so nothing reading the export breaks; must never reach
  -- a participant. Drop in a later release once nothing reads it.
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
alter table mgi_v5_submissions add column if not exists left_6m                text;
alter table mgi_v5_submissions add column if not exists joined_6m              text;
alter table mgi_v5_submissions add column if not exists currently_leading      text;
alter table mgi_v5_submissions add column if not exists line_of_sight_score    smallint;
alter table mgi_v5_submissions add column if not exists line_of_sight          text;
alter table mgi_v5_submissions add column if not exists mean_recency           numeric(3,2);
alter table mgi_v5_submissions add column if not exists gap_index              numeric(3,2);
alter table mgi_v5_submissions add column if not exists gap_width              text;
alter table mgi_v5_submissions add column if not exists collected_under        text;

comment on column mgi_v5_submissions.collected_under is
  'The instrument version live when this participant submitted, ie what they saw. Written once at submission and never changed by a backfill. instrument_version, by contrast, tracks the version that produced the derived columns as they now stand.';

comment on column mgi_v5_submissions.confidence is
  'DEPRECATED 6.1.0. Superseded by line_of_sight and gap_width. Still written so the export contract holds; never shown to a participant. Drop in a later release.';

-- One reading per submission. The PAYLOAD is stored, never rendered HTML:
-- the page renders on request from the payload plus the CURRENT copy bank,
-- so a wording fix reaches every reading anyone opens, including ones sent
-- weeks earlier. With HTML stored, old links keep their bugs permanently.
--
-- copy_bank_ver answers "what did they actually see". It is never used to
-- pin rendering to an old bank.
--
-- payload is deliberately loosely typed. Generated strings land in
-- payload.generated later and the jsonb schema must not preclude them.
create table if not exists mgi_readings (
  token           text primary key,          -- 22-char base64url, 128 bits
  submission_id   bigint references mgi_v5_submissions(id),
  payload         jsonb,                     -- null until derived; derived on view if so
  copy_bank_ver   text,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz                -- no expiry; this is the kill switch
);

create index if not exists mgi_readings_submission_idx on mgi_readings (submission_id);

alter table mgi_readings enable row level security;

-- Created now, unused. Phase 3 writes the Eran exchange here, and a
-- migration during that build is one more thing to get wrong.
create table if not exists mgi_transcripts (
  id              bigint generated always as identity primary key,
  token           text references mgi_readings(token),
  role            text not null,
  text            text not null,
  created_at      timestamptz not null default now()
);

create index if not exists mgi_transcripts_token_idx on mgi_transcripts (token, created_at);

alter table mgi_transcripts enable row level security;

-- Funnel telemetry. Deliberately a separate table with no key back to a
-- submission: people abandon before the consent box, so nothing here may be
-- personal or research data. A random per-visit id, how far they got, two
-- flags, a coarse device word. No answers, no identity, no IP.
create table if not exists mgi_funnel (
  sid                   text primary key,
  started_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  furthest              smallint not null default 0,
  reached_contact       boolean not null default false,
  submitted             boolean not null default false,
  device                text
);

create index if not exists mgi_funnel_started_idx on mgi_funnel (started_at desc);

alter table mgi_funnel enable row level security;

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
