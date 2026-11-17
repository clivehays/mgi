/* =============================================================
   The Manager Gap self-check: the short form itself.

   Which eight questions it asks, and everything it says about the
   answers. No DOM, no network, no storage: loaded by the browser as a
   global (MGISelfCheck) and required by scripts/test-selfcheck.js as a
   module, so the thing under test is the thing that ships.

   Nothing here restates a question, an option label, a state
   description or a move. Every one of those is read from scoring.js, so
   the short version cannot drift from the long one.

   WHICH EIGHT, AND WHY THOSE EIGHT

   The state tree reads the behaviour mean and the three trajectory
   answers, and nothing else. So the short set keeps all four of the
   questions that place the team and three of the fifteen evidence
   items, chosen by running every subset against the stored cohort.

   The four placing questions are not negotiable. Without the energy
   question five managers in Drift are told Cruise; without external
   pressure ten in Headwinds are told Stall. They are also the fastest
   questions on the form. The length is in the evidence items, so that
   is where it was taken from.

   q1, q9 and q11 named the same state as the full twenty for 44 of the
   first 50 managers and the same instinct gap for 46 of 50. The six
   disagreements were all in one direction: the short form said Drift
   where the full one said Cruise. On this cohort it never once told a
   team that was declining that it was fine, and that is the property
   worth protecting, not the raw agreement. Two other sets score a point
   or two higher and buy it by making exactly that error.

   Re-measure, including the direction, with:
     node scripts/selfcheck-cohort.js

   WHAT IT DELIBERATELY DOES NOT CLAIM

   The weakest of the five areas, and the gap width. Both need the full
   fifteen items. So this form never names an area. It names the one
   question that has gone longest without being answered by something
   real, which it can stand behind, and it takes the move from the
   instrument's own matrix.
   ============================================================= */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./scoring.js'));
  } else {
    root.MGISelfCheck = factory(root.MGI);
  }
}(typeof self !== 'undefined' ? self : this, function (MGI) {
  'use strict';

  var FORM = 'self-check 2.0.0';

  /* the three evidence items, by their position in MGI.EVIDENCE */
  var ITEMS = [1, 9, 11];

  /* A short name for each, for the list on the scorecard, and the area it
     belongs to in the instrument. The area name is never shown: it selects
     the move from MGI.ACTIONS, which is keyed by state and area.

     The three sit in three different areas on purpose. Two items from one
     area would read as the same question twice, which is a real cost in a
     form this short and does not show up in any agreement figure. */
  var ITEM_META = {
    1: { name: 'A blocker reached you before it bit', area: 'equipped' },
    9: { name: 'Someone disagreed with you openly, in front of others', area: 'truth' },
    11: { name: 'A real conversation with the person you are least sure about', area: 'invested' }
  };

  /* three answers at 0 to 3 */
  var SIGNAL_MAX = ITEMS.length * 3;

  /* ---------- the cohort ----------
     The first 50 managers to complete the full twenty questions, as at
     25 October 2026, excluding the founder's own submission. Every figure
     the scorecard quotes comes from this block, so there is one place to
     change when the cohort grows.

     Regenerate with: node scripts/selfcheck-cohort.js */
  var COHORT = {
    n: 50,
    asAt: '25 October 2026',
    states: { Cruise: 23, Drift: 16, Headwinds: 10, Stall: 1 },
    aligned: 18,
    feltWorse: 22,
    feltBetter: 10,
    medianSignal: 6
  };

  var COUNT_WORD = ['none', 'One', 'Two', 'Three', 'Four', 'Five'];
  var WHOLE_WORD = ['none', 'one', 'two', 'three', 'four', 'five'];

  /* What the thin items mean. The tail that follows, which settles whether
     an absent signal has stopped or is simply out of view, comes from the
     instrument. Indexed by how many of the items are older than a month. */
  var STALE_MEANING = [
    'Nothing on this list is running on memory. When one of these changes, you are positioned to watch it happen rather than hear about it afterwards.',
    'Most of this you have seen for yourself inside the month. The one you have not is where a change would reach you late, if it reached you at all.',
    'Most of what you believe about this team is memory rather than observation. Those parts could have moved without anything telling you, and the first sign would be something going wrong rather than something looking different.',
    'None of this is observation. It is all memory, and a team can travel a long way behind a picture that old before anything reaches the work.'
  ];

  /* ---------- the eight questions, built from the instrument ---------- */

  function questions() {
    var out = [MGI.GUT];
    ITEMS.forEach(function (n) {
      out.push({
        key: 'e' + n, kind: 'evidence', n: n,
        text: MGI.EVIDENCE[n - 1], options: MGI.SCALE
      });
    });
    out.push(MGI.OUTPUT, MGI.EXTERNAL, MGI.ENERGY, MGI.EXPOSURE);
    return out;
  }

  var TOTAL = 1 + ITEMS.length + 4;

  /* Where two items are level at the back there is no honest basis for
     doing one before the other, so this breaks the tie. It is the order
     the instrument already uses for its areas, read off MGI.AREAS so the
     two cannot diverge. */
  function areaTie(key) {
    for (var i = 0; i < MGI.AREAS.length; i++) {
      if (MGI.AREAS[i].key === key) return MGI.AREAS[i].tie;
    }
    return 99;
  }

  function scaleLabel(value) {
    for (var i = 0; i < MGI.SCALE.length; i++) {
      if (MGI.SCALE[i].value === value) return MGI.SCALE[i].label;
    }
    return 'No answer';
  }

  /* ---------- the reading ----------
     values: the eight answers in the order questions() returns them. */

  function read(values) {
    var gut = values[0];
    var evidence = values.slice(1, 1 + ITEMS.length);
    var output = values[1 + ITEMS.length];
    var external = values[2 + ITEMS.length];
    var energy = values[3 + ITEMS.length];
    var exposure = values[4 + ITEMS.length];

    var signal = evidence.reduce(function (t, n) { return t + n; }, 0);
    var mean = signal / evidence.length;

    /* the state, the rule and the instinct gap, from the instrument's own
       tree rather than from a copy of it */
    var partial = MGI.partialState(mean, output, external, energy, gut);
    var los = MGI.lineOfSightFor(exposure);

    var stale = evidence.filter(function (n) { return n <= 1; }).length;

    /* the item or items that have gone longest */
    var low = Math.min.apply(null, evidence);
    var back = ITEMS.filter(function (n, i) { return evidence[i] === low; })
      .sort(function (a, b) {
        var d = areaTie(ITEM_META[a].area) - areaTie(ITEM_META[b].area);
        return d !== 0 ? d : a - b;
      });

    var focus = back[0];
    var action = MGI.ACTIONS[partial.state.key][ITEM_META[focus].area];
    /* one window a week or less: go and look before you go and fix */
    if (los.score <= 1) action = action + ' ' + MGI.NARROW_SIGHT_ACTION;

    var closeUp = los.score >= 2;

    var r = {
      form: FORM,
      gut: gut,
      evidence: evidence,
      output: output,
      external: external,
      energy: energy,
      exposure: exposure,

      signal: signal,
      signalMax: SIGNAL_MAX,
      mean: mean,
      stale: stale,

      state: partial.state,
      rule: partial.rule,
      gap: partial.gap,
      lineOfSight: los,
      closeUp: closeUp,

      low: low,
      back: back,
      focus: focus,
      action: action
    };

    r.headline = 'Based on what you have observed, your team is most likely in ' +
      partial.state.name + '.';
    r.signalHeadline = staleHeadline(stale);
    r.signalMeaning = staleMeaning(stale, closeUp);
    r.focusLine = focusLine(r);
    r.cohortLine = cohortLine();
    r.items = ITEMS.map(function (n, i) {
      return {
        n: n,
        name: ITEM_META[n].name,
        value: evidence[i],
        when: scaleLabel(evidence[i]),
        thinnest: n === focus && low < 3
      };
    });

    return r;
  }

  function staleHeadline(stale) {
    var all = WHOLE_WORD[ITEMS.length];
    if (stale === 0) {
      return 'All ' + all + ' of the things this asked about have reached you inside the last month.';
    }
    if (stale === ITEMS.length) {
      return 'None of the ' + all + ' things this asked about has reached you inside a month.';
    }
    return COUNT_WORD[stale] + ' of the ' + all + ' things this asked about ' +
      (stale === 1 ? 'has' : 'have') + ' not reached you inside a month.';
  }

  function staleMeaning(stale, closeUp) {
    var copy = STALE_MEANING[Math.min(stale, STALE_MEANING.length - 1)];
    if (stale === 0) return copy;
    return copy + ' ' + (closeUp ? MGI.STALE_RESOLVED : MGI.STALE_UNRESOLVED);
  }

  /* The sentence above the move. It names what the move is for, and where
     several items are level it says so rather than choosing silently. */
  function focusLine(r) {
    var all = WHOLE_WORD[ITEMS.length];
    if (r.low === 3) {
      return 'Everything on that list reached you inside the week, so this is about holding it.';
    }
    if (r.back.length === 1) {
      return 'Longest without reaching you: ' + lowerFirst(ITEM_META[r.focus].name) + '.';
    }
    if (r.back.length === ITEMS.length) {
      return 'All ' + all + ' are level at the back, so where to start is your call. ' +
        'The move below is for one of them: ' + lowerFirst(ITEM_META[r.focus].name) + '.';
    }
    var names = r.back.map(function (n) { return lowerFirst(ITEM_META[n].name); });
    return COUNT_WORD[r.back.length] + ' of the ' + all + ' are level at the back: ' +
      names.join(' and ') +
      '. Take whichever is closer to the truth of this team. The move below is for the first.';
  }

  function lowerFirst(s) {
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  function cohortLine() {
    var c = COHORT;
    var s = c.states;
    return 'Of the first ' + c.n + ' managers to answer all twenty questions, ' +
      s.Cruise + ' came out in Cruise, ' + s.Drift + ' in Drift, ' +
      s.Headwinds + ' in Headwinds and ' + s.Stall + ' in Stall. For ' +
      (c.n - c.aligned) + ' of them, instinct and evidence did not agree: ' +
      c.feltWorse + ' had been carrying more worry than their own answers supported, and ' +
      c.feltBetter + ' had been reading the team more generously than their answers did. ' +
      'The median score on these ' + WHOLE_WORD[ITEMS.length] + ' questions was ' +
      c.medianSignal + ' of ' + SIGNAL_MAX + '. Figures as at ' + c.asAt + '.';
  }

  return {
    FORM: FORM,
    ITEMS: ITEMS,
    ITEM_META: ITEM_META,
    COHORT: COHORT,
    TOTAL: TOTAL,
    SIGNAL_MAX: SIGNAL_MAX,
    questions: questions,
    read: read,
    scaleLabel: scaleLabel,
    staleHeadline: staleHeadline,
    staleMeaning: staleMeaning,
    cohortLine: cohortLine
  };
}));
