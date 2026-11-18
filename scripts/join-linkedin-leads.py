"""Match self-check scorecards to the people who filled in the LinkedIn form.

WHY THIS IS A JOIN AND NOT A LOOKUP

A LinkedIn lead gen form sends everyone to the same thank-you URL. There is
no per-lead parameter, token or macro to put in it, and li_fat_id is a click
id for ad attribution that cannot be resolved to a person. So nothing arrives
at /self-check carrying the identity of the lead who just submitted the form,
and the page asks for nothing, by design.

What both sides do carry is a clock. LinkedIn's export stamps each lead with
the moment they submitted the form; mgi_selfcheck stamps each scorecard with
landed_at, the moment the page opened. A lead who clicks through lands a few
seconds later, so the two line up. This script does that lining up, nearest
first, and refuses to guess when two leads are close enough together that the
nearest is not obviously right.

That makes a match evidence, not a fact. The basis column says which:

  window      one lead in the window, and no other lead near it. Trust it.
  ambiguous   more than one candidate within AMBIGUOUS_SECONDS of each
              other. The nearest is reported, and so is the runner up, and
              the row is flagged. Read it before using it.
  none        no lead in the window. Someone reached the page another way,
              or the lead export does not cover this period.

USAGE

Download the leads from Campaign Manager (Account Assets -> Lead Gen Forms ->
Download leads) and pass the CSV:

    python scripts/join-linkedin-leads.py leads.csv
    python scripts/join-linkedin-leads.py leads.csv --out matched.csv
    python scripts/join-linkedin-leads.py leads.csv --window 20

The output CSV carries the lead's details beside their scorecard. Those
details come from the LinkedIn form, where the person gave them, and this is
the only place in this project where a scorecard and a name sit together:
mgi_selfcheck itself holds no personal data and nothing here writes any back.

PRIVACY NOTE WORTH ACTING ON: the consent text on the LinkedIn form should
say the result may be linked to the details they are giving. It takes a
sentence in Campaign Manager, and without it this join is doing something the
person was not told about.

Needs SUPABASE_URL and a service key, read from clover-agents/.env.
"""
import argparse
import csv
import io
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ENV = r"C:\Users\Administrator\clover-agents\.env"
TABLE = os.environ.get("MGI_SELFCHECK_TABLE", "mgi_selfcheck")

# A lead submits the form, then lands on the page. Landing first is possible
# by a second or two if the clocks disagree, so the window is asymmetric.
BEFORE_SECONDS = 900          # a lead up to 15 minutes before the landing
AFTER_SECONDS = 120           # or up to 2 minutes after it
AMBIGUOUS_SECONDS = 90        # two candidates this close: do not guess


def load_env():
    if not os.path.exists(ENV):
        return
    with io.open(ENV, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            if k not in os.environ:
                os.environ[k] = v.strip().strip("'").strip('"')


def service_key():
    return (os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            or os.environ.get("SUPABASE_SERVICE_KEY") or "")


def fetch_scorecards():
    """Every self-check row, oldest first. Answers and timings only."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = service_key()
    if not base or not key:
        sys.exit("SUPABASE_URL and a service key are needed "
                 "(SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY)")

    cols = ("id,landed_at,submitted_at,seconds_taken,state,gap,signal,stale,"
            "line_of_sight,focus,gut,exposure,lead_form,source,visit_id,internal")
    url = "%s/rest/v1/%s?select=%s&order=landed_at.asc" % (
        base, TABLE, urllib.parse.quote(cols, safe=",:"))
    req = urllib.request.Request(url, headers={
        "apikey": key, "Authorization": "Bearer " + key})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            import json
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        sys.exit("read failed: %s %s" % (e.code, e.read().decode("utf-8", "replace")))


def parse_time(value):
    """A timestamp from either source, as an aware UTC datetime."""
    if not value:
        return None
    s = str(value).strip().replace("Z", "+00:00")
    # LinkedIn writes "2026-11-14 09:12:33" or an ISO stamp depending on export
    for fmt in (None, "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M",
                "%m/%d/%Y %H:%M", "%Y/%m/%d %H:%M:%S"):
        try:
            dt = datetime.fromisoformat(s) if fmt is None else datetime.strptime(s, fmt)
        except ValueError:
            continue
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return None


def find_column(header, *wants):
    """The first column whose name contains all of one want group."""
    for want in wants:
        needles = [w.lower() for w in (want if isinstance(want, tuple) else (want,))]
        for name in header:
            low = (name or "").lower()
            if all(n in low for n in needles):
                return name
    return None


def read_leads(path):
    """The lead export, with its columns worked out from the header.

    LinkedIn's export has changed shape more than once and varies by locale,
    so nothing here depends on a fixed column order or an exact header."""
    with io.open(path, encoding="utf-8-sig", newline="") as fh:
        sniff = fh.read(8192)
        fh.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sniff, delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        rows = list(csv.DictReader(fh, dialect=dialect))

    if not rows:
        sys.exit("no rows in %s" % path)

    header = list(rows[0].keys())
    cols = {
        "when": find_column(header, ("submitted",), ("date",), ("time",), ("created",)),
        "first": find_column(header, ("first", "name"), ("firstname",)),
        "last": find_column(header, ("last", "name"), ("lastname",)),
        "full": find_column(header, ("full", "name"),),
        "email": find_column(header, ("email",)),
        "company": find_column(header, ("company",), ("organization",), ("organisation",)),
        "title": find_column(header, ("title",), ("job",), ("position",)),
        "form": find_column(header, ("form", "name"), ("campaign",)),
    }
    if not cols["when"]:
        sys.exit("could not find a submitted-time column in %s.\n  columns: %s"
                 % (path, ", ".join(header)))

    leads = []
    undated = 0
    for row in rows:
        when = parse_time(row.get(cols["when"]))
        if when is None:
            undated += 1
            continue
        name = " ".join(x for x in (row.get(cols["first"]) or "",
                                    row.get(cols["last"]) or "") if x).strip()
        if not name and cols["full"]:
            name = (row.get(cols["full"]) or "").strip()
        leads.append({
            "when": when,
            "name": name,
            "email": (row.get(cols["email"]) or "").strip() if cols["email"] else "",
            "company": (row.get(cols["company"]) or "").strip() if cols["company"] else "",
            "title": (row.get(cols["title"]) or "").strip() if cols["title"] else "",
            "form": (row.get(cols["form"]) or "").strip() if cols["form"] else "",
            "used": False,
        })

    leads.sort(key=lambda l: l["when"])
    print("read %d lead(s) from %s%s" % (
        len(leads), path,
        "" if not undated else ", skipped %d with no readable date" % undated))
    print("  columns used: %s" % ", ".join(
        "%s=%s" % (k, v) for k, v in cols.items() if v))
    return leads


def match(scorecards, leads, before, after):
    """One pass, oldest scorecard first, each lead claimed at most once."""
    out = []
    for card in scorecards:
        landed = parse_time(card.get("landed_at")) or parse_time(card.get("submitted_at"))
        row = dict(card)
        row["_landed"] = landed
        row["_basis"] = "none"
        row["_lead"] = None
        row["_runner_up"] = None
        row["_offset"] = ""

        if landed is None:
            out.append(row)
            continue

        lo = landed - timedelta(seconds=before)
        hi = landed + timedelta(seconds=after)
        near = [l for l in leads if not l["used"] and lo <= l["when"] <= hi]
        if not near:
            out.append(row)
            continue

        # nearest in time to the landing wins
        near.sort(key=lambda l: abs((l["when"] - landed).total_seconds()))
        best = near[0]
        row["_lead"] = best
        row["_offset"] = int((landed - best["when"]).total_seconds())
        best["used"] = True

        if len(near) > 1:
            second = near[1]
            gap = abs((second["when"] - best["when"]).total_seconds())
            if gap <= AMBIGUOUS_SECONDS:
                row["_basis"] = "ambiguous"
                row["_runner_up"] = second
            else:
                row["_basis"] = "window"
        else:
            row["_basis"] = "window"
        out.append(row)
    return out


FIELDS = ["selfcheck_id", "match_basis", "lead_seconds_before_landing",
          "name", "email", "company", "job_title", "lead_form", "lead_submitted_at",
          "landed_at", "submitted_at", "seconds_taken",
          "state", "gap", "signal_of_15", "not_inside_a_month", "line_of_sight",
          "longest_without_reaching_them", "gut", "exposure",
          "lf", "utm_source", "utm_medium", "utm_campaign", "visit_id", "internal",
          "runner_up_name", "runner_up_submitted_at"]


def write_csv(path, rows):
    with io.open(path, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            lead = r["_lead"] or {}
            second = r["_runner_up"] or {}
            src = r.get("source") or {}
            if not isinstance(src, dict):
                src = {}
            w.writerow({
                "selfcheck_id": r.get("id"),
                "match_basis": r["_basis"],
                "lead_seconds_before_landing": r["_offset"],
                "name": lead.get("name", ""),
                "email": lead.get("email", ""),
                "company": lead.get("company", ""),
                "job_title": lead.get("title", ""),
                "lead_form": lead.get("form", ""),
                "lead_submitted_at": lead["when"].isoformat() if lead.get("when") else "",
                "landed_at": r.get("landed_at") or "",
                "submitted_at": r.get("submitted_at") or "",
                "seconds_taken": r.get("seconds_taken") or "",
                "state": r.get("state") or "",
                "gap": r.get("gap") or "",
                "signal_of_15": r.get("signal"),
                "not_inside_a_month": r.get("stale"),
                "line_of_sight": r.get("line_of_sight") or "",
                "longest_without_reaching_them": r.get("focus") or "",
                "gut": r.get("gut") or "",
                "exposure": r.get("exposure") or "",
                "lf": r.get("lead_form") or "",
                "utm_source": src.get("utm_source", ""),
                "utm_medium": src.get("utm_medium", ""),
                "utm_campaign": src.get("utm_campaign", ""),
                "visit_id": r.get("visit_id") or "",
                "internal": r.get("internal"),
                "runner_up_name": second.get("name", ""),
                "runner_up_submitted_at":
                    second["when"].isoformat() if second.get("when") else "",
            })


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("leads", help="the CSV downloaded from LinkedIn Campaign Manager")
    ap.add_argument("--out", default="selfcheck-leads.csv", help="where to write the result")
    ap.add_argument("--window", type=int, default=BEFORE_SECONDS // 60,
                    help="minutes before a landing to look for its lead (default %d)"
                         % (BEFORE_SECONDS // 60))
    ap.add_argument("--include-internal", action="store_true",
                    help="keep the owner's own test runs")
    args = ap.parse_args()

    load_env()
    leads = read_leads(args.leads)
    cards = fetch_scorecards()
    if not args.include_internal:
        kept = [c for c in cards if not c.get("internal")]
        if len(kept) != len(cards):
            print("skipped %d internal test run(s); pass --include-internal to keep them"
                  % (len(cards) - len(kept)))
        cards = kept
    print("read %d scorecard(s) from %s" % (len(cards), TABLE))

    rows = match(cards, leads, args.window * 60, AFTER_SECONDS)

    counts = {}
    for r in rows:
        counts[r["_basis"]] = counts.get(r["_basis"], 0) + 1
    unclaimed = [l for l in leads if not l["used"]]

    print("\nmatched:")
    for basis in ("window", "ambiguous", "none"):
        if counts.get(basis):
            print("  %-10s %d" % (basis, counts[basis]))
    print("  %d lead(s) with no scorecard (filled the form, did not finish the ten "
          "questions)" % len(unclaimed))

    if counts.get("ambiguous"):
        print("\n  %d row(s) had two leads within %ds of each other. The nearest is "
              "reported\n  and the runner up is in the last two columns. Read those "
              "before using them." % (counts["ambiguous"], AMBIGUOUS_SECONDS))

    write_csv(args.out, rows)
    print("\nwrote %s" % os.path.abspath(args.out))

    named = [r for r in rows if r["_lead"]]
    if named:
        print("\nthe first few, as a sanity check:")
        for r in named[:5]:
            print("  %-22s %-10s signal %2s/15  %-12s  %s" % (
                (r["_lead"].get("name") or r["_lead"].get("email") or "?")[:22],
                r.get("state"), r.get("signal"), r.get("line_of_sight"), r["_basis"]))


if __name__ == "__main__":
    main()
