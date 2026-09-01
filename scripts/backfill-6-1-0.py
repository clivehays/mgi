"""Backfill line_of_sight and gap_width onto every existing submission.

Exposure and all five area recency values are stored on every row, so every
submission is fully computable. Backfilled rather than left null because the
SDI and every cohort comparison depend on the whole set being populated.

The formula is NOT reimplemented here. It is read out of scoring.js by
running the instrument, so the backfill and the live scoring cannot drift.

Moves instrument_version, which tracks the derived columns. Never touches
collected_under, which records what the participant actually saw and is
the one provenance field a backfill must leave alone.

Verifies against the fixtures in the amendment before writing anything, and
refuses to write if they do not reproduce exactly.

  python scripts/backfill-6-1-0.py            # dry run, prints what it would do
  python scripts/backfill-6-1-0.py --write    # apply
"""
import io
import json
import re
import subprocess
import sys

import psycopg2

ENV = r"C:\Users\Administrator\clover-agents\.env"
SCORING = r"C:\Users\Administrator\mgi-site\assets\scoring.js"

# from the amendment, section 3. These must reproduce exactly.
FIXTURES = {
    10: dict(los=0, mean_recency=2.20, gap_index=3.80, gap_width="Wide"),
    11: dict(los=3, mean_recency=3.00, gap_index=0.00, gap_width="Narrow"),
    12: dict(los=2, mean_recency=2.40, gap_index=1.60, gap_width="Moderate"),
    13: dict(los=2, mean_recency=2.40, gap_index=1.60, gap_width="Moderate"),
}


def derive(rows):
    """Run every row through the real instrument, in one node process."""
    script = """
var MGI = require(%s);
var rows = JSON.parse(process.argv[1]);
console.log(JSON.stringify(rows.map(function (r) {
  var s = MGI.score({
    gut: r.gut, evidence: r.evidence, output: r.output,
    external: r.external, energy: r.energy, exposure: r.exposure
  });
  return {
    id: r.id,
    line_of_sight_score: s.lineOfSight.score,
    line_of_sight: s.lineOfSight.label,
    mean_recency: s.meanRecency,
    gap_index: s.gapIndex,
    gap_width: s.gapWidth.label,
    version: MGI.VERSION,
    fingerprint: MGI.FINGERPRINT
  };
})));
""" % json.dumps(SCORING.replace("\\", "/"))
    out = subprocess.run(
        ["node", "-e", script, json.dumps(rows)],
        capture_output=True, text=True, encoding="utf-8",
    )
    if out.returncode != 0:
        raise SystemExit("node failed:\n" + (out.stderr or ""))
    return json.loads(out.stdout)


def connect():
    vals = {}
    for line in io.open(ENV, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        vals[k.strip()] = v.strip().strip("'").strip('"')
    proj = re.sub(r"^https://", "", vals["SUPABASE_URL"]).split(".")[0]
    return psycopg2.connect(
        host=vals["SUPABASE_DB_HOST"], port=5432, dbname="postgres",
        user="postgres.%s" % proj, password=vals["SUPABASE_DB_PASSWORD"],
        sslmode="require", connect_timeout=20,
    )


def main():
    write = "--write" in sys.argv

    conn = connect()
    conn.autocommit = True
    cur = conn.cursor()

    qcols = ", ".join("q%d" % i for i in range(1, 16))
    cur.execute("select id, first_name, gut, output, external_pressure, energy, "
                "exposure, %s from mgi_v5_submissions order by id" % qcols)
    names = {}
    payload = []
    for r in cur.fetchall():
        names[r[0]] = r[1]
        payload.append({
            "id": r[0], "gut": r[2], "output": r[3], "external": r[4],
            "energy": r[5], "exposure": r[6], "evidence": list(r[7:22]),
        })

    if not payload:
        print("  no rows to backfill")
        return

    derived = derive(payload)
    print("  instrument %s / %s\n" % (derived[0]["version"], derived[0]["fingerprint"]))

    print("  id  name         los  label     meanRec  gapIdx  gapWidth     fixture")
    failures = []
    for d in derived:
        fx = FIXTURES.get(d["id"])
        verdict = ""
        if fx:
            ok = (d["line_of_sight_score"] == fx["los"]
                  and abs(d["mean_recency"] - fx["mean_recency"]) < 0.005
                  and abs(d["gap_index"] - fx["gap_index"]) < 0.005
                  and d["gap_width"] == fx["gap_width"])
            verdict = "matches" if ok else "MISMATCH"
            if not ok:
                failures.append((d, fx))
        else:
            verdict = "(none)"
        print("  %-3s %-12s %-4s %-9s %6.2f  %6.2f  %-12s %s" % (
            d["id"], names[d["id"]][:12], d["line_of_sight_score"], d["line_of_sight"],
            d["mean_recency"], d["gap_index"], d["gap_width"], verdict))

    if failures:
        print("\n  REFUSING TO WRITE: %d fixture(s) did not reproduce." % len(failures))
        for d, fx in failures:
            print("    id=%s got %s, expected %s" % (d["id"], d, fx))
        raise SystemExit(1)

    if not write:
        print("\n  dry run. Re-run with --write to apply.")
        return

    for d in derived:
        cur.execute("""
            update mgi_v5_submissions
               set line_of_sight_score = %s, line_of_sight = %s,
                   mean_recency = %s, gap_index = %s, gap_width = %s,
                   instrument_version = %s
             where id = %s
        """, (d["line_of_sight_score"], d["line_of_sight"], d["mean_recency"],
              d["gap_index"], d["gap_width"], d["version"], d["id"]))
    print("\n  updated %d row(s)" % len(derived))

    cur.execute("""select count(*) from mgi_v5_submissions
                   where line_of_sight is null or gap_width is null""")
    missing = cur.fetchone()[0]
    print("  rows still missing the new fields: %d" % missing)
    if missing:
        raise SystemExit("  backfill incomplete")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
