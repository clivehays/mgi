"""Give the reading and transcript foreign keys an on-delete behaviour.

A reading is derived entirely from a submission and a transcript belongs
to a reading, so neither outlives its parent in any meaningful sense.
Both keys were left at NO ACTION, which means removing a submission takes
three deletes in the right order and fails with a constraint error in the
dashboard. Cascade is the behaviour that matches what the rows are.

Reversible: swap `on delete cascade` for `on delete no action` and re-run.

No rows are deleted here. This only changes what happens when someone
else deletes one.
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

conn = psycopg2.connect(host=vals["SUPABASE_DB_HOST"], port=5432, dbname="postgres",
                        user="postgres.%s" % project, password=vals["SUPABASE_DB_PASSWORD"],
                        sslmode="require")
cur = conn.cursor()

DDL = """
alter table mgi_readings
  drop constraint mgi_readings_submission_id_fkey;
alter table mgi_readings
  add constraint mgi_readings_submission_id_fkey
  foreign key (submission_id) references mgi_v5_submissions(id)
  on delete cascade;

alter table mgi_transcripts
  drop constraint mgi_transcripts_token_fkey;
alter table mgi_transcripts
  add constraint mgi_transcripts_token_fkey
  foreign key (token) references mgi_readings(token)
  on delete cascade;
"""

cur.execute("begin")
cur.execute(DDL)
cur.execute("commit")
print("both keys altered\n")

cur.execute("""
select c.conname, src.relname, tgt.relname,
  case c.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE' when 'n' then 'SET NULL' else c.confdeltype::text end
from pg_constraint c
join pg_class src on src.oid = c.conrelid
join pg_class tgt on tgt.oid = c.confrelid
where c.contype = 'f' and (src.relname like 'mgi%' or tgt.relname like 'mgi%')
order by src.relname
""")
for name, frm, to, od in cur.fetchall():
    print("  %-40s %s -> %s   on delete %s" % (name, frm, to, od))

# what a submission delete would now take with it, and what it would not
print("\n=== what still would not be cleaned up ===\n")
cur.execute("""
select count(*) from mgi_conversations c
where not exists (select 1 from mgi_readings r where r.token = c.token)
""")
print("  mgi_conversations rows already orphaned: %d" % cur.fetchone()[0])
cur.execute("select count(*) from mgi_conversations")
print("  mgi_conversations rows in total:         %d" % cur.fetchone()[0])
print("  (no foreign key on that table, so turns survive a submission delete)")

cur.close()
conn.close()
