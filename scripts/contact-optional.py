"""Make the optional contact columns nullable.

The form requires a first name and a team size. Email, company and role are
part of the optional research step, and a blank is inserted as null. Email
was made nullable by email-optional.py. Company and role were still
`not null` from the day the table was created, so a skipped research step
fails the insert and the lead is lost.

Idempotent. Reads credentials from clover-agents/.env, like the other
scripts here. Pass a table name to migrate a preview copy instead:

    python scripts/contact-optional.py
    python scripts/contact-optional.py mgi_preview_submissions
"""
import io
import re
import sys

import psycopg2

ENV = r"C:\Users\Administrator\clover-agents\.env"
TABLE = sys.argv[1] if len(sys.argv) > 1 else "mgi_v5_submissions"
COLUMNS = ("email", "company", "role")

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


def nullable(column):
    cur.execute(
        "select is_nullable from information_schema.columns "
        "where table_name = %s and column_name = %s", (TABLE, column))
    row = cur.fetchone()
    if not row:
        sys.exit("no %s column on %s" % (column, TABLE))
    return row[0] == "YES"


for column in COLUMNS:
    if nullable(column):
        print("%s.%s is already nullable, nothing to do" % (TABLE, column))
    else:
        cur.execute("alter table %s alter column %s drop not null" % (TABLE, column))
        print("%s.%s is now nullable" % (TABLE, column))

cur.close()
conn.close()
