"""Create the conversation, trial and rate-limit tables.

Idempotent. Creates them for both the live and the preview prefixes, so
a preview conversation never lands in the live record.

  python scripts/create-conversation-tables.py
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

host = vals["SUPABASE_DB_HOST"]
password = vals["SUPABASE_DB_PASSWORD"]
project = re.sub(r"^https://", "", vals["SUPABASE_URL"]).split(".")[0]
user = "postgres.%s" % project

DDL = """
create table if not exists {p}conversations (
  id           bigint generated always as identity primary key,
  token        text not null,
  turn         int  not null,
  role         text not null check (role in ('manager', 'eran')),
  text         text not null,

  -- section 4. The state after this turn.
  state        text check (state in ('reading','boundary','deciding','done')),

  -- section 10. Which of the four objections the manager's message was.
  -- The single most valuable column here: it tells Clive which objection
  -- is actually costing him, and whether the fix is the product, the
  -- report or the pitch.
  shape        text check (shape in ('surveillance','misattribution','precision','timing','none')),
  exit         text check (exit in ('trial','clive','not_now')),

  -- the stop rule. Once true it stays true for the rest of the token.
  stop         boolean not null default false,
  refusal      text,

  -- anything the reply broke. Recorded, never shown: a streamed reply
  -- cannot be recalled, so this is how the voice gets tuned.
  faults       text,

  -- section 6.1. True on the manager's turn that gave a clear yes, or
  -- that pressed the start affordance, and on every turn after it.
  -- Nothing in the close may begin without one of these behind it, and
  -- test 16 makes a close with no consenting turn a failure rather
  -- than a judgement call.
  consent      boolean not null default false,

  -- true on the reply that asked the closed question, and nothing else.
  -- Consent can only be given in answer to it, which is what stops the
  -- model reading a yes into a turn nobody asked a question in.
  asked_consent boolean not null default false,

  -- which step of 6.2 this turn was, 1 to 6, or null outside the close.
  -- Logged so a skipped or reordered step is visible afterwards.
  close_step   smallint,

  created_at   timestamptz not null default now()
);
create index if not exists {p}conversations_token_idx on {p}conversations (token, turn);

create table if not exists {p}trials (
  token         text primary key,
  team_size     int  not null,
  join_code     text not null unique,
  message_text  text,
  started_at    timestamptz not null default now(),
  first_report  date,
  ends_at       date,
  joined        int not null default 0
);
create index if not exists {p}trials_join_idx on {p}trials (join_code);

-- section 9 asks for a limit per IP as well as per token, and gives no
-- table for it. One row per address per day, counted up.
create table if not exists {p}ask_rate (
  ip     text not null,
  day    date not null,
  hits   int  not null default 0,
  primary key (ip, day)
);
"""

GRANTS = """
grant all on {p}conversations, {p}trials, {p}ask_rate to service_role;
grant usage, select on all sequences in schema public to service_role;
"""

conn = psycopg2.connect(host=host, port=5432, dbname="postgres",
                        user=user, password=password, sslmode="require")
conn.autocommit = True
cur = conn.cursor()

for prefix in ("mgi_", "mgi_preview_"):
    cur.execute(DDL.format(p=prefix))
    cur.execute(GRANTS.format(p=prefix))
    for t in ("conversations", "trials", "ask_rate"):
        cur.execute("select count(*) from %s%s" % (prefix, t))
        print("%-30s ok, %d row(s)" % (prefix + t, cur.fetchone()[0]))

cur.close()
conn.close()
