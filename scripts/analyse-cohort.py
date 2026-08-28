"""Cohort analysis for the book.

Produces the findings the dataset can actually carry, and refuses the ones
it cannot. Read scripts/README-analysis.md before quoting anything from
this output.

Only pools rows sharing one instrument fingerprint, because rows produced
by different item sets are not comparable however similar they look.

  python scripts/analyse-cohort.py              # current instrument
  python scripts/analyse-cohort.py --all        # list every fingerprint present
"""
import io
import math
import re
import sys
from collections import Counter, defaultdict

import psycopg2

ENV = r"C:\Users\Administrator\clover-agents\.env"
SITE = r"C:\Users\Administrator\mgi-site"

# ---------------------------------------------------------------- instrument

def instrument():
    """Read the item text and area membership straight from scoring.js, so
    this script can never drift from the instrument that produced the rows."""
    src = io.open(SITE + r"\assets\scoring.js", encoding="utf-8").read()

    block = src[src.index("var EVIDENCE = ["):]
    block = block[:block.index("];")]
    items = re.findall(r"'((?:[^'\\]|\\.)*)'", block)
    items = [i.replace("\\'", "'").replace("\u2019", "'") for i in items]

    areas = {}
    ablock = src[src.index("var AREAS = ["):]
    ablock = ablock[:ablock.index("var BEHAVIOUR_ITEMS")]
    for key, name, nums in re.findall(
        r"key:\s*'(\w+)',\s*\n\s*name:\s*'([^']+)',\s*\n\s*items:\s*\[([\d,\s]+)\]", ablock
    ):
        areas[key] = (name, [int(n) for n in nums.split(",")])

    version = re.search(r"var VERSION = '([^']+)'", src).group(1)
    return items, areas, version


# ---------------------------------------------------------------- statistics

def mean(xs):
    return sum(xs) / float(len(xs)) if xs else float("nan")


def sd(xs):
    if len(xs) < 2:
        return float("nan")
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def sem(xs):
    return sd(xs) / math.sqrt(len(xs)) if len(xs) > 1 else float("nan")


def ci95(xs):
    h = 1.96 * sem(xs)
    return mean(xs) - h, mean(xs) + h


def pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return float("nan")
    mx, my = mean(xs), mean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    den = math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
    return num / den if den else float("nan")


def r_ci(r, n):
    """Fisher z interval. Wide at n=100, which is the point of showing it."""
    if n < 4 or abs(r) >= 1:
        return float("nan"), float("nan")
    z = 0.5 * math.log((1 + r) / (1 - r))
    se = 1 / math.sqrt(n - 3)
    lo, hi = z - 1.96 * se, z + 1.96 * se
    f = lambda v: (math.exp(2 * v) - 1) / (math.exp(2 * v) + 1)
    return f(lo), f(hi)


def prop_ci(k, n):
    if not n:
        return float("nan"), float("nan")
    p = k / float(n)
    h = 1.96 * math.sqrt(p * (1 - p) / n)
    return max(0.0, p - h), min(1.0, p + h)


# ---------------------------------------------------------------- data

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


def rule(ch="-", n=74):
    print(ch * n)


def main():
    items, areas, version = instrument()
    n_items = len(items)

    conn = connect()
    cur = conn.cursor()

    cur.execute("""select instrument_version, instrument_fingerprint, count(*)
                   from mgi_v5_submissions
                   group by 1, 2 order by 3 desc""")
    groups = cur.fetchall()

    print()
    rule("=")
    print("MGI COHORT ANALYSIS")
    rule("=")
    print("\nInstrument versions present in the table:")
    for v, fp, c in groups:
        print("  %-8s %-10s %d row(s)" % (v or "(none)", fp or "(none)", c))

    if "--all" in sys.argv:
        return

    live = [g for g in groups if g[1]]
    if not live:
        print("\nNo rows carry a fingerprint yet. Nothing to analyse.")
        return
    ver, fp, _ = max(live, key=lambda g: g[2])

    qcols = ", ".join("q%d" % (i + 1) for i in range(n_items))
    cur.execute("""
        select %s, gut, state, gap, confidence, signal, behaviour,
               exposure, team_size, tenure, left_6m, joined_6m,
               industry, weak_areas
        from mgi_v5_submissions
        where instrument_fingerprint = %%s
    """ % qcols, (fp,))
    rows = cur.fetchall()
    # index by column name, never by counting offsets from the item count.
    # An arithmetic offset here is silently wrong rather than loud, and it
    # reads one column as another without ever raising.
    at = {d[0]: i for i, d in enumerate(cur.description)}
    needed = ["gut", "state", "gap", "confidence", "signal", "behaviour",
              "exposure", "team_size", "tenure", "left_6m", "joined_6m"]
    absent = [c for c in needed if c not in at]
    if absent:
        raise SystemExit("columns missing from the table: %s" % ", ".join(absent))
    cur.close()
    conn.close()

    n = len(rows)
    print("\nAnalysing %d row(s) on instrument %s / %s" % (n, ver, fp))
    if n < 30:
        print("\n  NOTE: below n=30 nothing here is worth quoting. Shown for shape only.")

    q = [[r[i] for r in rows if r[i] is not None] for i in range(n_items)]
    col = lambda name: [r[at[name]] for r in rows]
    gut, state = col("gut"), col("state")
    left6, joined6 = col("left_6m"), col("joined_6m")

    # ---------------------------------------------------------------- 1
    print()
    rule("=")
    print("1. THE ORDER IN WHICH A TEAM GOES QUIET")
    rule("=")
    print("""
The headline finding, and the one that owes nothing to the decision tree.
Each item is a specific observable behaviour. This ranks them by how
recently they last happened, lowest first: the things that have gone
longest without happening sit at the top.

Scale: 3 within the week, 2 within the month, 1 within the quarter,
0 could not recall. Two items are separable when their intervals do not
overlap.
""")
    ranked = sorted(range(n_items), key=lambda i: mean(q[i]) if q[i] else 9)
    for pos, i in enumerate(ranked, 1):
        if not q[i]:
            continue
        lo, hi = ci95(q[i])
        area = next((a[0] for k, a in areas.items() if (i + 1) in a[1]), "")
        print("  %2d. %.2f  [%.2f-%.2f]  %s" % (pos, mean(q[i]), lo, hi, area))
        print("      Q%-2d %s" % (i + 1, items[i][:88]))
    if n >= 30:
        top, bot = ranked[0], ranked[-1]
        print("\n  Spread: %.2f points between the first thing to go and the last." %
              (mean(q[bot]) - mean(q[top])))
        print("  Separable at this n when two items differ by about %.2f." %
              (1.96 * math.sqrt(2) * mean([sem(q[i]) for i in ranked if q[i]])))

    # ---------------------------------------------------------------- 2
    print()
    rule("=")
    print("2. DOES BEING THERE MEAN SEEING?")
    rule("=")
    print("""
Exposure and signal never touch each other in the scoring, so this is a
clean test. If managers who are present most days do not carry fresher
signal than those there weekly, presence is not the same as seeing.
""")
    by_exp = defaultdict(list)
    for r in rows:
        if r[at["signal"]] is not None:
            by_exp[r[at["exposure"]]].append(r[at["signal"]])
    for e in ["most_days", "few_times", "weekly", "less_weekly"]:
        v = by_exp.get(e, [])
        if not v:
            continue
        lo, hi = ci95(v)
        print("  %-12s n=%-4d signal %5.1f / %d  [%.1f-%.1f]" %
              (e, len(v), mean(v), n_items * 3, lo, hi))
    close = by_exp.get("most_days", []) + by_exp.get("few_times", [])
    far = by_exp.get("weekly", []) + by_exp.get("less_weekly", [])
    if len(close) > 5 and len(far) > 5:
        d = mean(close) - mean(far)
        pooled = math.sqrt((sd(close) ** 2 / len(close)) + (sd(far) ** 2 / len(far)))
        print("\n  close (n=%d) minus distant (n=%d): %+.1f signal points" %
              (len(close), len(far), d))
        print("  95%% interval %+.1f to %+.1f" % (d - 1.96 * pooled, d + 1.96 * pooled))
        if abs(d) < 1.96 * pooled:
            print("  Interval spans zero: no detectable difference at this n.")
            print("  That is a finding, not a null result to bury.")

    # ---------------------------------------------------------------- 3
    print()
    rule("=")
    print("3. DO THE AREAS FADE TOGETHER?")
    rule("=")
    print("""
Correlation between area means. Only intervals clear of zero are worth a
sentence. At n=100 anything below about r=0.30 will not clear it.
""")
    amean = {}
    for k, (name, its) in areas.items():
        amean[k] = [mean([r[i - 1] for i in its]) for r in rows]
    keys = list(areas.keys())
    for a in range(len(keys)):
        for b in range(a + 1, len(keys)):
            xs, ys = amean[keys[a]], amean[keys[b]]
            r = pearson(xs, ys)
            lo, hi = r_ci(r, n)
            flag = "  <-- clear of zero" if not math.isnan(lo) and lo * hi > 0 else ""
            print("  %-9s x %-9s r=%+.2f  [%+.2f, %+.2f]%s" %
                  (keys[a], keys[b], r, lo, hi, flag))

    # ---------------------------------------------------------------- 4
    print()
    rule("=")
    print("4. MOVEMENT IN AND OUT OF THE TEAM")
    rule("=")
    print("""
Departures are the nearest thing this study has to an outcome. Arrivals
are both a second outcome and a confound: a new joiner generates the very
events the recency items ask about, so a team that has taken people on
will look fresher without anything having improved.

Everything here is self-reported and cross-sectional. Correlation only.
""")
    ORDER = ["none", "one", "two-three", "four-plus"]
    SCORE = {"none": 0, "one": 1, "two-three": 2.5, "four-plus": 4}
    for label, vals in (("Left in 6 months", left6), ("Joined in 6 months", joined6)):
        c = Counter(v for v in vals if v)
        print("  %s:" % label)
        for k in ORDER:
            if c.get(k):
                lo, hi = prop_ci(c[k], n)
                print("    %-11s %3d  (%4.1f%%  [%.1f-%.1f])" %
                      (k, c[k], c[k] / float(n) * 100, lo * 100, hi * 100))
        print()

    usable = [(SCORE[l], SCORE[j], mean([r[i - 1] for i in areas["truth"][1]]),
               r[at["signal"]])
              for r, l, j in zip(rows, left6, joined6)
              if l in SCORE and j in SCORE and r[at["signal"]] is not None]
    if len(usable) >= 30:
        lv = [u[0] for u in usable]
        jv = [u[1] for u in usable]
        tv = [u[2] for u in usable]
        sv = [u[3] for u in usable]
        for name, xs, ys in (
            ("departures x truth-area mean", lv, tv),
            ("departures x signal", lv, sv),
            ("arrivals x signal  (confound check)", jv, sv),
        ):
            r = pearson(xs, ys)
            lo, hi = r_ci(r, len(usable))
            flag = "  <-- clear of zero" if not math.isnan(lo) and lo * hi > 0 else ""
            print("  %-38s r=%+.2f  [%+.2f, %+.2f]%s" % (name, r, lo, hi, flag))
        print("""
  If arrivals correlate with signal, say so in the book and control for it.
  A fresher-looking picture on a team that has just taken people on is an
  artefact of headcount, not a manager seeing more.""")
    else:
        print("  Fewer than 30 rows carry both movement answers. Not yet analysable.")

    # ---------------------------------------------------------------- 5
    print()
    rule("=")
    print("5. GUT AGAINST EVIDENCE")
    rule("=")
    print("""
Report this as the conditional it is. The unconditional "behind" rate is
close to the complement of reaching Cruise and is a property of the
instrument, not a discovery about managers.
""")
    cross = defaultdict(Counter)
    for g, s in zip(gut, state):
        cross[g][s] += 1
    states = ["Cruise", "Drift", "Headwinds", "Stall"]
    print("  gut answer      " + "".join(s.rjust(11) for s in states) + "      n")
    for g in ["great", "fine", "off", "struggling"]:
        if not cross[g]:
            continue
        tot = sum(cross[g].values())
        print("  %-14s" % g + "".join(("%d (%.0f%%)" % (cross[g][s], cross[g][s] / float(tot) * 100)).rjust(11)
                                      for s in states) + ("%7d" % tot))
    print("""
  The publishable sentence is of the form: "of the managers who said their
  team was fine, X% could evidence a team that was, against a standard of
  eight observable behaviours each having happened within the month."
  State the standard. Never report the complement as a finding.""")

    # ---------------------------------------------------------------- 6
    print()
    rule("=")
    print("6. WHAT THIS SAMPLE CANNOT SUPPORT")
    rule("=")
    print("""
  Prevalence.        Self-selected from an audience already reading about
                     this. No "X%% of managers" sentence is defensible.
  Causation.         Cross-sectional. Correlation language only.
  Subgroups.         %d rows across several industries and four team-size
                     bands leaves cells too thin to compare.
  The manager gap.   Single rater: gut against that rater's own evidence.
                     It is NOT the 70%% cohort figure, which had two sources.
                     Never let one support the other in print.
""" % n)
    print("  Reliability evidence still requires the 90-day re-invite.\n")
    rule("=")


if __name__ == "__main__":
    main()
