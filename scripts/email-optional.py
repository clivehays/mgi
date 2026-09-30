"""Make mgi_v5_submissions.email nullable.

An address is optional on the form: a manager who leaves it blank reads their
reading from the link on the confirmation page instead, and nothing is sent to
them. The column was `not null` from the day the table was created, so without
this every such submission fails the insert and the lead is lost.

Idempotent, and reversible with:
    alter table mgi_v5_submissions alter column email set not null;
(which will only succeed once every row has an address again).

Reads credentials from clover-agents/.env, like the other scripts here.
Pass a table name to migrate a preview copy instead:
    python scripts/email-optional.py mgi_preview_submissions
"""
import io
import re
import sys

import psycopg2

ENV = r"C:\Users\Administrator\clover-agents\.env"
TABLE = sys.argv[1] if len(sys.argv) > 1 else "mgi_v5_submissions"

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


def nullable():
    cur.execute(
        "select is_nullable from information_schema.columns "
        "where table_name = %s and column_name = 'email'", (TABLE,))
    row = cur.fetchone()
    if not row:
        sys.exit("no email column on %s" % TABLE)
    return row[0] == "YES"


if nullable():
    print("%s.email is already nullable, nothing to do" % TABLE)
else:
    cur.execute("alter table %s alter column email drop not null" % TABLE)
    print("%s.email is now nullable" % TABLE)

cur.execute("select count(*) from %s where email is null" % TABLE)
print("rows with no address: %d" % cur.fetchone()[0])
