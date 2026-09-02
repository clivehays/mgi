/* =============================================================
   derive.js  ยท  MGI submission  ->  payload.json

   Deterministic. No prose, no model, no I/O. Every string it emits is
   a key or a computed number; all wording lives in copy-bank.json.

   Build brief v2 section 4.
   ============================================================= */

var MGI = require('../assets/scoring.js');

/* ---------- area identity ----------
   The instrument's internal keys are not the dimension names, and the
   display order is fixed left to right so the panel is the same shape
   every reading. Never sorted by score. */

var AREAS = [
  { instrument: 'equipped', key: 'readiness',   plain: 'How equipped the team is',  dimension: 'Readiness',   prefix: 'r' },
  { instrument: 'work',     key: 'results',     plain: 'The work itself',           dimension: 'Results',     prefix: 'w' },
  { instrument: 'invested', key: 'involvement', plain: 'How invested people are',   dimension: 'Involvement', prefix: 'i' },
  { instrument: 'why',      key: 'direction',   plain: 'Whether everyone knows why', dimension: 'Direction',  prefix: 'd' },
  { instrument: 'truth',    key: 'alignment',   plain: 'Whether truth travels up',  dimension: 'Alignment',   prefix: 'a' }
];

/* ---------- tier ----------
   The brief names three tiers against a week / over-a-month / never
   scale. The instrument answers on four values and the fourth, "within
   the last month", sits between the brief's first two.

   It is mapped to fresh. The instrument already treats a value of 1 or
   0 as running on memory and 2 or 3 as current, the headline language
   is "gone quiet", and an area where something happened three weeks ago
   has not gone quiet. Calling that observation "over a month ago" on
   the page would also be untrue, which is worse than a coarse tier.

   One constant. Flip FRESH_FLOOR to 3 to read the brief literally. */

var FRESH_FLOOR = 2;

function tierOf(value) {
  if (value >= FRESH_FLOOR) return 'fresh';
  if (value === 0) return 'dark';
  return 'stale';
}

/* how the status line names each answer, so it stays true to what the
   manager actually said rather than to the tier it was bucketed into */
var RECENCY_LABEL = {
  3: 'inside the week',
  2: 'inside the month',
  1: 'over a month ago',
  0: 'not recalled'
};

/* ---------- focus ----------
   The story of the page. Lowest fresh, then most dark, then the
   instrument's own weakest-first rank, then a fixed leading-indicator
   order. Resolved silently: a page that hands the reader an unresolved
   ranking has given them work instead of an answer. */

var LEADING_ORDER = ['direction', 'alignment', 'involvement', 'readiness', 'results'];

function pickFocus(areas) {
  var sorted = areas.slice().sort(function (a, b) {
    if (a.fresh !== b.fresh) return a.fresh - b.fresh;
    if (a.dark !== b.dark) return b.dark - a.dark;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return LEADING_ORDER.indexOf(a.key) - LEADING_ORDER.indexOf(b.key);
  });
  return sorted;
}

/* which areas were level with the winner on everything the reader could
   see. Carried in the payload for the coaching read, never rendered. */
function tiesWith(sorted) {
  var top = sorted[0];
  return sorted.filter(function (a) {
    return a.fresh === top.fresh && a.dark === top.dark;
  }).map(function (a) { return a.key; });
}

/* the tier shape drives which "means" string the copy bank returns */
function pattern(area) {
  if (area.dark === 3) return 'all_dark';
  if (area.fresh === 3) return 'all_fresh';
  return area.fresh >= 2 ? 'mostly_fresh' : 'mostly_stale';
}

/* ---------- the calculator ----------
   Pattern A is a multiplier the reader sets themselves, so the
   arithmetic is theirs. Pattern B is a stated consequence, used where
   any per-day rate would be invented rather than estimated. */

var CALCULATORS = {
  direction:   { pattern: 'A', a: { min: 2, max: 40, step: 1, def: 6 }, b: { min: 1, max: 20, step: 1, def: 5 } },
  alignment:   { pattern: 'A', a: { min: 2, max: 40, step: 1, def: 6 }, b: { min: 1, max: 10, step: 1, def: 2 } },
  readiness:   { pattern: 'A', a: { min: 2, max: 40, step: 1, def: 6 }, b: { min: 0.5, max: 4, step: 0.5, def: 1 } },
  involvement: { pattern: 'B' },
  results:     { pattern: 'B' }
};

/* section 6 of addendum A, as one lookup */
var GATING = {
  direction:   { cheap: 'free',      cell4: 'default' },
  alignment:   { cheap: 'free',      cell4: 'default' },
  readiness:   { cheap: 'readiness', cell4: 'readiness' },
  involvement: { cheap: 'free',      cell4: 'involvement' },
  results:     { cheap: 'free',      cell4: 'results' }
};

/* ---------- derive ---------- */

function derive(answers, contact, meta) {
  meta = meta || {};
  var result = MGI.score(answers);

  var rankOf = {};
  result.ranked.forEach(function (a, i) { rankOf[a.key] = i; });

  var areas = AREAS.map(function (def) {
    var src = result.areas.filter(function (a) { return a.key === def.instrument; })[0];
    var counts = { fresh: 0, stale: 0, dark: 0 };
    var items = src.items.map(function (n, i) {
      var v = answers.evidence[n - 1];
      var t = tierOf(v);
      counts[t]++;
      return { id: def.prefix + (i + 1), tier: t, value: v, label: RECENCY_LABEL[v] };
    });
    return {
      key: def.key,
      plain: def.plain,
      dimension: def.dimension,
      score: src.mean,
      items: items,
      fresh: counts.fresh,
      stale: counts.stale,
      dark: counts.dark,
      rank: rankOf[def.instrument]
    };
  });

  var sorted = pickFocus(areas);
  var focus = sorted[0];
  areas.forEach(function (a) { a.pattern = pattern(a); });

  var quiet = areas.filter(function (a) { return a.fresh === 0; }).length;
  var healthy = areas.filter(function (a) { return a.fresh >= 2; }).length;

  /* quiet_count measures breadth: how many rings have nothing current in
     them. It says nothing about depth, so a team where every ring holds
     one fresh item and two stale ones scores quiet_count 0 and would get
     the congratulatory headline. `thin` catches that: most of the
     evidence behind the rings is older than a month, whatever the ring
     count says. */
  var older = areas.reduce(function (t, a) { return t + a.stale + a.dark; }, 0);
  var thin = older > (areas.length * 3) / 2;

  return {
    meta: {
      instrument: MGI.VERSION,
      fingerprint: MGI.FINGERPRINT,
      reading_no: meta.reading_no || 1,
      generated_at: meta.generated_at || new Date().toISOString().slice(0, 10),
      copy_to: meta.copy_to || (contact && contact.email) || ''
    },
    state: result.state.key,
    state_name: result.state.name,
    line_of_sight: result.lineOfSight.key,
    gap_width: result.gapWidth.key,
    signal: { score: result.signal, max: MGI.EVIDENCE.length * 3 },
    areas: areas,
    focus: focus.key,
    focus_dimension: focus.dimension,
    quiet_count: quiet,
    thin: thin,
    older_count: older,
    healthy_count: healthy,
    ties: tiesWith(sorted),
    calculator: CALCULATORS[focus.key],
    gating: GATING[focus.key]
  };
}

module.exports = { derive: derive, AREAS: AREAS, tierOf: tierOf, FRESH_FLOOR: FRESH_FLOOR };
