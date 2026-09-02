# Participant results page

Build brief v2 plus addendum A. Replaces the old prose report entirely.

    MGI submission
        |
        v  derive.js        deterministic. Tiers, focus, counters,
        |                   calculator config. Writes no prose.
        v  payload
        |
        v  render.js + copy-bank.json  ->  self-contained results.html

No model runs at render time. Every string is a computed number or a
copy-bank lookup. The rendered page makes no requests of its own.

    node results/test-results.js     53 acceptance checks, 8 fixtures

## Two decisions worth knowing

**The fourth scale value.** The brief names three tiers on a week /
over-a-month / never scale. The instrument answers on four values, and
"within the last month" sits between the brief's first two. It maps to
fresh: the instrument already treats 1 and 0 as running on memory, the
headline language is "gone quiet", and an area where something happened
three weeks ago has not gone quiet. `FRESH_FLOOR` in derive.js is the
one constant to change if that is wrong.

**Segments are paths, not circles.** A circle plus stroke-dasharray can
place one segment of three, but it cannot then carry the 3 7 dash the
dark tier needs, because that dasharray has to describe the whole
circumference. A path takes pathLength="100", so one dasharray places
the segment and another dashes it. Rotation rides on a --rot custom
property, never an SVG transform attribute, which would lose to the
stylesheet and stack all three segments on top of each other.
