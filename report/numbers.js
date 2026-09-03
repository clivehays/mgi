/* =============================================================
   numbers.js  ·  a submission  ->  the numbers

   Deterministic. No prose, no model, no I/O. Every string it emits
   is a key, a label the manager themselves chose, or a computed
   number. Eran does no arithmetic and makes no structural decision,
   so everything Eran needs to decide anything is decided here first.

   Spec section 2.
   ============================================================= */

var MGI = require('../assets/scoring.js');

/* ---------- area identity ----------
   The instrument's internal keys are not the names the page uses. The
   plain English name leads; the RRIDA word appears only inside an
   opened readout. Display order is fixed left to right and is never
   sorted by score, so the panel is the same shape every reading. */

var AREAS = [
  { instrument: 'equipped', key: 'readiness',   plain: 'How equipped the team is',   dimension: 'Readiness',   prefix: 'r' },
  { instrument: 'work',     key: 'results',     plain: 'The work itself',            dimension: 'Results',     prefix: 'w' },
  { instrument: 'invested', key: 'involvement', plain: 'How invested people are',    dimension: 'Involvement', prefix: 'i' },
  { instrument: 'why',      key: 'direction',   plain: 'Whether everyone knows why', dimension: 'Direction',   prefix: 'd' },
  { instrument: 'truth',    key: 'alignment',   plain: 'Whether truth travels up',   dimension: 'Alignment',   prefix: 'a' }
];

/* ---------- tier ----------
   The spec names three tiers against a week / over-a-month / nothing
   recalled scale. The instrument answers on four values, and the
   fourth, "within the last month", sits between the spec's first two.

   It is mapped to fresh, for one reason: the receipt counts conditions
   still reading and conditions gone quiet, and the instrument defines
   gone quiet as not having reached the manager inside a month. A ring
   that classified a three-week-old observation as stale would put a
   different count on the page from the receipt directly below it.

   One constant. Set FRESH_FLOOR to 3 to read the spec literally. */

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

/* ---------- ranking ----------
   Weakest first: fewest fresh, then the instrument's own ordering, then
   the fixed order below.

   This used to decide the focus. It does not any more. The instrument
   publishes the ranking and Eran picks which ring the page leads on,
   because the mechanical answer is often right and not always: a
   Direction ring that is dark while Alignment is merely stale can still
   have Alignment as the live problem. Ranking is an input to that
   judgement, and ranking[0] is what the page falls back to when Eran
   has not answered at all. */

var FIXED_ORDER = ['direction', 'alignment', 'involvement', 'readiness', 'results'];

function ranked(areas) {
  return areas.slice().sort(function (a, b) {
    if (a.fresh !== b.fresh) return a.fresh - b.fresh;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return FIXED_ORDER.indexOf(a.key) - FIXED_ORDER.indexOf(b.key);
  });
}

/* ---------- the numbers ---------- */

function compute(answers, contact, meta) {
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
      return {
        id: def.prefix + (i + 1),
        tier: t,
        value: v,
        label: RECENCY_LABEL[v],
        question: MGI.EVIDENCE[n - 1]
      };
    });
    return {
      key: def.key,
      plain: def.plain,
      dimension: def.dimension,
      items: items,
      fresh: counts.fresh,
      stale: counts.stale,
      dark: counts.dark,
      rank: rankOf[def.instrument]
    };
  });

  var order = ranked(areas);

  /* the receipt's two counters, across all fifteen items */
  var reading = areas.reduce(function (t, a) { return t + a.fresh; }, 0);
  var quiet = 15 - reading;

  return {
    meta: {
      instrument: MGI.VERSION,
      fingerprint: MGI.FINGERPRINT,
      reading_no: meta.reading_no || 1,
      generated_at: meta.generated_at || new Date().toISOString().slice(0, 10),
      copy_to: meta.copy_to || (contact && contact.email) || '',
      first_name: (contact && contact.firstName) || ''
    },
    state: result.state.key,
    state_name: result.state.name,
    areas: areas,

    /* weakest first, supplied to Eran as input. The page leads on
       Eran's focus; this is what it leads on if Eran never answered. */
    ranking: order.map(function (a) { return a.key; }),
    signal: { score: result.signal, max: MGI.EVIDENCE.length * 3 },
    line_of_sight: result.lineOfSight.key,
    line_of_sight_label: result.lineOfSight.label,
    gap_width: result.gapWidth.key,
    gap_width_label: result.gapWidth.label,
    reading_count: reading,
    quiet_count: quiet,
    /* Eran's JSON lands here. Absent until it does, and the page renders
       either way, so a model outage can never cost a lead. */
    eran: null
  };
}

/* Which ring the page leads on. Eran's pick where there is one, and the
   mechanical answer where there is not, so a model outage costs the
   page its words and not its shape. */
function focusOf(payload) {
  var chosen = payload.eran && payload.eran.focus;
  var known = payload.areas.filter(function (a) { return a.key === chosen; })[0];
  var area = known || payload.areas.filter(function (a) {
    return a.key === payload.ranking[0];
  })[0] || payload.areas[0];
  return {
    key: area.key,
    plain: area.plain,
    dimension: area.dimension,
    mechanical: payload.ranking[0],
    erans: !!known
  };
}

module.exports = {
  compute: compute,
  focusOf: focusOf,
  ranked: ranked,
  AREAS: AREAS,
  tierOf: tierOf,
  FRESH_FLOOR: FRESH_FLOOR,
  FIXED_ORDER: FIXED_ORDER
};
