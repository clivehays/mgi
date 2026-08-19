/* =============================================================
   Manager Gap Index v5 - scoring
   Single source of truth. Loaded by the browser as a global (MGI)
   and required by the serverless function as a CommonJS module,
   so the client and the notification email can never disagree.
   ============================================================= */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MGI = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var QUESTIONS = [
    'When did a team member last tell you they were blocked or missing something, before it affected their work?',
    'When did you last watch someone on your team ask a teammate for help, rather than coming to you?',
    'When did you last look at a piece of your team’s actual work in detail, not a summary or a status update?',
    'When did someone outside the team, a customer or another department, last comment on your team’s work without you asking?',
    'When did someone last bring you an idea or improvement you didn’t ask for?',
    'When did you last have an unhurried one-to-one conversation with each person on your team? Answer for the person it has been longest for.',
    'When did you last hear a team member explain the team’s current priority in their own words?',
    'When did a team member last push back on a piece of work because it didn’t seem worth doing?',
    'When did someone last disagree with you openly, in front of others?',
    'When did you last learn about a problem from the person involved, rather than finding out another way?',
    'Think of the team member you are least sure about right now. When did you last have a real conversation with them?',
    'When did you last change your mind because of something a team member said?'
  ];

  var SCALE = [
    { value: 3, label: 'Within the last week' },
    { value: 2, label: 'Within the last month' },
    { value: 1, label: 'Within the last quarter' },
    { value: 0, label: 'Can’t recall' }
  ];

  /* items are 1-indexed question numbers.
     tie is the tie-break priority when area means are equal:
     lower wins the "weakest" slot. Spec order is truth, then
     invested, then remaining areas by lowest item number. */
  var AREAS = [
    {
      key: 'equipped',
      name: 'How equipped the team is',
      items: [1, 2],
      tie: 2,
      desc: 'Whether blockers reach you before they bite, and whether the team helps each other without routing through you.'
    },
    {
      key: 'work',
      name: 'The work itself',
      items: [3, 4],
      tie: 3,
      desc: 'Your direct contact with the output, and unprompted comment on it from outside the team.'
    },
    {
      key: 'invested',
      name: 'How invested people are',
      items: [5, 6],
      tie: 1,
      desc: 'Contribution nobody asked for, and unhurried time with every person on the team.'
    },
    {
      key: 'why',
      name: 'Whether everyone knows why',
      items: [7, 8],
      tie: 4,
      desc: 'Whether the priority is understood in the team’s own words, and whether work gets challenged as worth doing.'
    },
    {
      key: 'truth',
      name: 'Whether truth travels upward',
      items: [9, 10],
      tie: 0,
      desc: 'Open disagreement in the room, and problems reaching you from the person involved rather than second hand.'
    }
  ];

  var DRIFT_ITEMS = [1, 2, 5, 6, 9, 10, 11, 12];
  var HEADWIND_ITEMS = [3, 4, 7, 8];

  var BANDS = [
    {
      key: 'clear',
      min: 27,
      max: 36,
      name: 'Clear signal',
      desc: 'Your picture of this team is current. The question now is what it’s telling you.'
    },
    {
      key: 'fading',
      min: 15,
      max: 26,
      name: 'Fading signal',
      desc: 'Parts of your picture are live. Parts are assumption. The breakdown below names which.'
    },
    {
      key: 'memory',
      min: 0,
      max: 14,
      name: 'Flying on memory',
      desc: 'Most of your read on this team is a snapshot from a while ago. Teams change faster than snapshots.'
    }
  ];

  var HEADLINES = {
    driftBlind: 'With your current signal, Drift would reach you as Stall.',
    headwindsBlind: 'With your current signal, falling output would be hard to read. Without evidence about cause, a healthy team fighting headwinds looks like a failing team.',
    clear: 'Your signal is current. If this team starts to slide, you are positioned to see it early. Most managers are not.'
  };

  function scaleLabel(v) {
    for (var i = 0; i < SCALE.length; i++) {
      if (SCALE[i].value === v) return SCALE[i].label;
    }
    return 'No answer';
  }

  /* recency phrase used in the weakest-area callout */
  function recencyPhrase(v) {
    if (v === 0) return 'memory';
    if (v === 1) return 'last quarter';
    if (v === 2) return 'last month';
    return 'last week';
  }

  function mean(answers, items) {
    var total = 0;
    for (var i = 0; i < items.length; i++) {
      total += answers[items[i] - 1];
    }
    return total / items.length;
  }

  function detectionLabel(m) {
    if (m >= 2) return 'Detectable';
    if (m >= 1) return 'Late';
    return 'Blind';
  }

  function areaLabel(m) {
    if (m >= 2) return 'Current';
    if (m >= 1) return 'Fading';
    return 'Stale';
  }

  function bandFor(total) {
    for (var i = 0; i < BANDS.length; i++) {
      if (total >= BANDS[i].min && total <= BANDS[i].max) return BANDS[i];
    }
    return BANDS[BANDS.length - 1];
  }

  /* answers: array of 12 integers 0-3 */
  function score(answers) {
    var i;
    var total = 0;
    for (i = 0; i < 12; i++) total += answers[i];

    var band = bandFor(total);

    var areas = AREAS.map(function (a) {
      var m = mean(answers, a.items);
      var worst = Math.min(answers[a.items[0] - 1], answers[a.items[1] - 1]);
      return {
        key: a.key,
        name: a.name,
        items: a.items,
        desc: a.desc,
        tie: a.tie,
        mean: m,
        label: areaLabel(m),
        worst: worst,
        recency: recencyPhrase(worst)
      };
    });

    /* two lowest means; ties resolved by the spec priority order */
    var ranked = areas.slice().sort(function (x, y) {
      if (x.mean !== y.mean) return x.mean - y.mean;
      return x.tie - y.tie;
    });
    var weakest = [ranked[0].key, ranked[1].key];

    areas.forEach(function (a) {
      a.isWeakest = weakest.indexOf(a.key) !== -1;
    });

    var driftMean = mean(answers, DRIFT_ITEMS);
    var headwindsMean = mean(answers, HEADWIND_ITEMS);
    var drift = detectionLabel(driftMean);
    var headwinds = detectionLabel(headwindsMean);

    var headline;
    if (drift === 'Blind' || drift === 'Late') {
      headline = HEADLINES.driftBlind;
    } else if (headwinds === 'Blind' || headwinds === 'Late') {
      headline = HEADLINES.headwindsBlind;
    } else {
      headline = HEADLINES.clear;
    }

    var items = [];
    for (i = 0; i < 12; i++) {
      items.push({
        n: i + 1,
        question: QUESTIONS[i],
        value: answers[i],
        label: scaleLabel(answers[i])
      });
    }

    return {
      total: total,
      band: band,
      areas: areas,
      weakest: weakest,
      weakestAreas: [ranked[0], ranked[1]],
      drift: { mean: driftMean, label: drift },
      headwinds: { mean: headwindsMean, label: headwinds },
      headline: headline,
      items: items
    };
  }

  /* the weakest-area callout sentence.
     The "last week" case only occurs on a near-perfect result,
     where "rests on nothing more recent than" would misread. */
  function calloutFor(area) {
    var opening;
    if (area.worst >= 3) {
      opening = 'Your read on ' + lower(area.name) + ' is current, with nothing in it older than last week. It is still the thinnest part of your picture.';
    } else {
      opening = 'Your read on ' + lower(area.name) + ' currently rests on nothing more recent than ' + area.recency + '.';
    }
    return opening + ' In our research cohort, this is where managers’ pictures drift furthest from what teams actually report.';
  }

  function lower(name) {
    return name.charAt(0).toLowerCase() + name.slice(1);
  }

  function validAnswers(a) {
    if (!Array.isArray(a) || a.length !== 12) return false;
    for (var i = 0; i < 12; i++) {
      if (a[i] !== 0 && a[i] !== 1 && a[i] !== 2 && a[i] !== 3) return false;
    }
    return true;
  }

  return {
    QUESTIONS: QUESTIONS,
    SCALE: SCALE,
    AREAS: AREAS,
    BANDS: BANDS,
    score: score,
    calloutFor: calloutFor,
    lower: lower,
    scaleLabel: scaleLabel,
    validAnswers: validAnswers
  };
}));
