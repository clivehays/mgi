"""Clone the submissions and readings tables for the preview branch.

A preview deployment takes real submissions from whoever is testing it.
Those are not research, and the cohort is only worth anything if nothing
but real participants is in it, so the preview writes to its own pair of
tables and the live ones never see a test.

Structure only, no rows. Idempotent: safe to re-run.

  python scripts/create-preview-tables.py
"""
import io
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
user = "postgres.%s" % project

DDL = """
create table if not exists mgi_preview_submissions
  (like mgi_v5_submissions including all);

create table if not exists mgi_preview_readings
  (like mgi_readings including all);
"""

GRANTS = """
grant all on mgi_preview_submissions to service_role;
grant all on mgi_preview_readings to service_role;
grant usage, select on all sequences in schema public to service_role;
"""

conn = psycopg2.connect(host=host, port=5432, dbname="postgres",
                        user=user, password=password, sslmode="require")
conn.autocommit = True
cur = conn.cursor()
cur.execute(DDL)
cur.execute(GRANTS)

for t in ("mgi_preview_submissions", "mgi_preview_readings"):
    cur.execute("select count(*) from %s" % t)
    print("%-26s ok, %d row(s)" % (t, cur.fetchone()[0]))

cur.close()
conn.close()
print("\nPoint the preview at these with MGI_TABLE and MGI_READINGS_TABLE.")
