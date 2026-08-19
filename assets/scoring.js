/* =============================================================
   Manager Gap Index v5 - the instrument

   Single source of truth. Loaded by the browser as a global (MGI)
   and required by the serverless function as a CommonJS module,
   so the client and the emails can never disagree.

   Sixteen questions:
     Q0        gut check, unscored, compared to the computed state
     Q1-Q12    evidence items, recency scale, 3/2/1/0
     Q13-Q15   trajectory items, output / external / energy

   From those: a most-likely state, a confidence level, and the
   manager gap between instinct and evidence.
   ============================================================= */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MGI = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Q0: the gut check ---------- */

  var GUT = {
    key: 'gut',
    kind: 'gut',
    text: 'Before the questions: going on instinct alone, which best describes your team right now?',
    intro: true,
    options: [
      { value: 'great', label: 'In great shape', severity: 0 },
      { value: 'fine', label: 'Fine, as far as I can tell', severity: 1 },
      { value: 'off', label: 'Something feels off', severity: 2 },
      { value: 'struggling', label: 'Struggling, and I know it', severity: 3 }
    ]
  };

  /* ---------- Q1-Q12: the evidence items ---------- */

  var SCALE = [
    { value: 3, label: 'Within the last week' },
    { value: 2, label: 'Within the last month' },
    { value: 1, label: 'Within the last quarter' },
    { value: 0, label: 'Can’t recall' }
  ];

  var EVIDENCE = [
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

  /* ---------- Q13-Q15: the trajectory items ---------- */

  var OUTPUT = {
    key: 'output',
    kind: 'output',
    text: 'Over the past month, the team’s output, meaning quality, volume and deadlines, has:',
    options: [
      { value: 'improved', label: 'Improved', holding: true },
      { value: 'held', label: 'Held steady', holding: true },
      { value: 'slipped_slightly', label: 'Slipped slightly', holding: false },
      { value: 'slipped_noticeably', label: 'Slipped noticeably', holding: false }
    ]
  };

  var EXTERNAL = {
    key: 'external',
    kind: 'external',
    text: 'Is something outside the team working against it right now? Dependencies, resourcing, market conditions, organisational change.',
    options: [
      { value: 'yes', label: 'Yes, clearly' },
      { value: 'possibly', label: 'Possibly' },
      { value: 'no', label: 'No' }
    ]
  };

  var ENERGY = {
    key: 'energy',
    kind: 'energy',
    text: 'Compared with three months ago, the energy in the team’s day-to-day interactions is:',
    options: [
      { value: 'higher', label: 'Higher' },
      { value: 'same', label: 'About the same' },
      { value: 'lower', label: 'Lower' },
      { value: 'unsure', label: 'Honestly, I couldn’t say' }
    ]
  };

  /* ---------- the full sixteen, in order ---------- */

  var ITEMS = [GUT];
  EVIDENCE.forEach(function (text, i) {
    ITEMS.push({ key: 'e' + (i + 1), kind: 'evidence', n: i + 1, text: text, options: SCALE });
  });
  ITEMS.push(OUTPUT, EXTERNAL, ENERGY);

  /* ---------- signal areas ---------- */

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

  var BEHAVIOUR_ITEMS = [1, 2, 5, 6, 9, 10, 11, 12];
  var WORK_ITEMS = [3, 4, 7, 8];

  /* ---------- states ---------- */

  var STATES = {
    cruise: {
      key: 'cruise',
      name: 'Cruise',
      colour: '#1B7A4A',
      severity: [0, 1],
      description: 'Output is holding and the behaviours of a healthy team are visible around you: disagreement reaches you, problems arrive early, ideas show up unprompted. Cruise is the state every team should return to, not a state to coast in. Teams rarely leave Cruise with an announcement. They leave it quietly, through the exact behaviours this diagnostic asked about.',
      action: 'Protect the behaviours that told you this. Disagreement, early problems, unprompted ideas: these are the instruments that will tell you the moment Cruise ends. This week, notice one of them happening and make sure the person who did it would do it again.'
    },
    drift: {
      key: 'drift',
      name: 'Drift',
      colour: '#C2842F',
      severity: [2, 2],
      description: 'Your output is holding, which is why this state is dangerous: nothing in the numbers says anything is wrong. But the behaviours that produce that output are fading around you. Fewer unprompted ideas. Less open disagreement. Problems arriving late or second-hand. Drift is the state managers miss most, because everything that would reveal it is a thing that quietly stops happening. By the time Drift shows up in output, it has a new name.',
      action: 'Do not announce an initiative. Drift deepens under programmes and retreats under attention. This week, pick the person you are least sure about and have one unhurried conversation with no agenda. Then look again at your weakest signal area above and create one situation where fresh signal can reach you in it.'
    },
    headwinds: {
      key: 'headwinds',
      name: 'Headwinds',
      colour: '#6B5BD2',
      severity: [2, 2],
      description: 'Your output is falling, but the evidence says the team itself is holding: the behaviours of a healthy team are still visible, and there is a clear external force acting on it. This is the most misdiagnosed state there is. Managers who miss the external cause conclude the team is failing, and treat a healthy team like a broken one. The right response to Headwinds is to name the weather, shield the team where you can, and flag the cause upward loudly. The wrong response is to push the team harder.',
      action: 'Name the weather out loud to the team this week; they already feel it, and hearing you name it converts private stress into shared context. Then flag the cause upward, specifically and in writing. Your team’s output is the evidence; your job is to make sure it is read as weather, not as failure.'
    },
    stall: {
      key: 'stall',
      name: 'Stall',
      colour: '#B03A2E',
      severity: [3, 3],
      description: 'The decline has reached the output, and the behaviours of a healthy team are not visible around you. Stall is the one state every manager detects, because it is the only one that announces itself. The honest news: teams recover from Stall, but not by pushing on output. Output is the last thing to fall and the last thing to return. Recovery starts where the slide started, in the behaviours this diagnostic asked about, and it starts with signal: you cannot steer a recovery you cannot see.',
      action: 'Resist the instinct to push on output. This week, restart the signal: one real conversation with each person you can reach, asking what has actually been happening, and listening without defending. What you hear will be the map of the way back. It will not be comfortable, and it will be the most useful thing you have heard in months.'
    }
  };

  /* ---------- confidence ---------- */

  var CONFIDENCE = [
    {
      key: 'high',
      min: 27,
      max: 36,
      label: 'High confidence',
      copy: 'Twelve of the sixteen questions measured how recently real signal from this team has reached you. Yours is current, so this reading rests on evidence, not memory. Treat it accordingly.'
    },
    {
      key: 'moderate',
      min: 15,
      max: 26,
      label: 'Moderate confidence',
      copy: 'Twelve of the sixteen questions measured how recently real signal from this team has reached you. Parts of your picture are live; parts are running on memory. This reading is a strong estimate, not a verdict. The areas below show where it is thinnest.'
    },
    {
      key: 'low',
      min: 0,
      max: 14,
      label: 'Low confidence',
      copy: 'Twelve of the sixteen questions measured how recently real signal from this team has reached you, and most of your answers reached back a quarter or further. That makes this reading provisional, and that is a finding in itself: whatever state this team is truly in, your current signal would not show you a change. A team can leave Cruise and travel a long way before a manager on stale signal notices.'
    }
  ];

  /* ---------- lookups ---------- */

  function optionFor(item, value) {
    for (var i = 0; i < item.options.length; i++) {
      if (item.options[i].value === value) return item.options[i];
    }
    return null;
  }

  function itemByKey(key) {
    for (var i = 0; i < ITEMS.length; i++) {
      if (ITEMS[i].key === key) return ITEMS[i];
    }
    return null;
  }

  function labelFor(key, value) {
    var item = itemByKey(key);
    if (!item) return 'No answer';
    var opt = optionFor(item, value);
    return opt ? opt.label : 'No answer';
  }

  /* ---------- helpers ---------- */

  function mean(evidence, items) {
    var total = 0;
    for (var i = 0; i < items.length; i++) total += evidence[items[i] - 1];
    return total / items.length;
  }

  function areaLabel(m) {
    if (m >= 2) return 'Current';
    if (m >= 1) return 'Fading';
    return 'Stale';
  }

  function recencyPhrase(v) {
    if (v === 0) return 'memory';
    if (v === 1) return 'last quarter';
    if (v === 2) return 'last month';
    return 'last week';
  }

  function confidenceFor(s) {
    for (var i = 0; i < CONFIDENCE.length; i++) {
      if (s >= CONFIDENCE[i].min && s <= CONFIDENCE[i].max) return CONFIDENCE[i];
    }
    return CONFIDENCE[CONFIDENCE.length - 1];
  }

  /* ---------- the state decision tree ----------
     Deterministic, applied top to bottom, first match wins.
     Holding output with faded behaviours is the definition of
     Drift. Slipping output with a clear external cause and an
     intact team is Headwinds. Slipping output with no external
     explanation, or with the behaviours gone too, is Stall. */

  function decideState(b, output, external, energy) {
    var holding = optionFor(OUTPUT, output).holding;
    var energyLower = energy === 'lower';

    if (holding) {
      if (b >= 2.0 && !energyLower) return { state: STATES.cruise, rule: 1 };
      return { state: STATES.drift, rule: 2 };
    }

    if (external === 'yes' && b >= 1.5 && !energyLower) return { state: STATES.headwinds, rule: 3 };
    if (output === 'slipped_noticeably') return { state: STATES.stall, rule: 4 };
    if (external === 'yes' || external === 'possibly') return { state: STATES.headwinds, rule: 5 };
    return { state: STATES.stall, rule: 6 };
  }

  /* ---------- the manager gap ---------- */

  function decideGap(gutValue, state) {
    var gutOpt = optionFor(GUT, gutValue);
    var sev = gutOpt.severity;
    var lo = state.severity[0];
    var hi = state.severity[1];

    if (sev < lo) {
      return {
        key: 'behind',
        gutLabel: gutOpt.label,
        copy: 'Before the questions, your instinct said “' + gutOpt.label + '”. The evidence points to ' + state.name +
          '. That distance is the manager gap: the space between the picture a manager carries and what the observable evidence supports. It is not a character flaw. It is what happens when signal goes stale, and it closes the same way it opened: through what you let yourself see.'
      };
    }
    if (sev > hi) {
      return {
        key: 'ahead',
        gutLabel: gutOpt.label,
        copy: 'Before the questions, your instinct said “' + gutOpt.label + '”, but the observable evidence points to ' + state.name +
          '. Two possibilities: your gut is picking up something these questions didn’t reach, or you are carrying worry the evidence doesn’t support. The fix is the same in both cases: go get fresher signal and find out which.'
      };
    }
    return {
      key: 'aligned',
      gutLabel: gutOpt.label,
      copy: 'Before the questions, your instinct said “' + gutOpt.label + '”, and the evidence agrees. Your read on this team is calibrated. The section below shows which parts of it are running on fresh signal and which are coasting.'
    };
  }

  /* ---------- score ----------
     answers: { gut, evidence: [12 ints 0-3], output, external, energy } */

  function score(answers) {
    var evidence = answers.evidence;
    var i;

    var s = 0;
    for (i = 0; i < 12; i++) s += evidence[i];

    var b = mean(evidence, BEHAVIOUR_ITEMS);
    var w = mean(evidence, WORK_ITEMS);

    var decision = decideState(b, answers.output, answers.external, answers.energy);
    var state = decision.state;
    var confidence = confidenceFor(s);
    var gap = decideGap(answers.gut, state);

    var areas = AREAS.map(function (a) {
      var m = mean(evidence, a.items);
      var worst = Math.min(evidence[a.items[0] - 1], evidence[a.items[1] - 1]);
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

    var ranked = areas.slice().sort(function (x, y) {
      if (x.mean !== y.mean) return x.mean - y.mean;
      return x.tie - y.tie;
    });
    var weakest = [ranked[0].key, ranked[1].key];
    areas.forEach(function (a) { a.isWeakest = weakest.indexOf(a.key) !== -1; });

    /* every answer, in order, for the notification email */
    var responses = ITEMS.map(function (item, idx) {
      var value = item.kind === 'evidence' ? evidence[item.n - 1] : answers[item.key];
      var opt = optionFor(item, value);
      return {
        n: idx,
        key: item.key,
        kind: item.kind,
        question: item.text,
        value: value,
        label: opt ? opt.label : 'No answer'
      };
    });

    return {
      state: state,
      rule: decision.rule,
      confidence: confidence,
      gap: gap,
      signal: s,
      behaviour: b,
      work: w,
      areas: areas,
      weakest: weakest,
      weakestAreas: [ranked[0], ranked[1]],
      responses: responses,
      headline: 'Based on what you’ve observed, your team is most likely in ' + state.name + '.'
    };
  }

  /* the weakest-area callout. The "last week" case only occurs on a
     near-perfect signal score, where "rests on nothing more recent
     than" would misread. */
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

  /* ---------- validation ---------- */

  function validAnswers(a) {
    if (!a || typeof a !== 'object') return false;

    if (!Array.isArray(a.evidence) || a.evidence.length !== 12) return false;
    for (var i = 0; i < 12; i++) {
      if (a.evidence[i] !== 0 && a.evidence[i] !== 1 && a.evidence[i] !== 2 && a.evidence[i] !== 3) return false;
    }

    if (!optionFor(GUT, a.gut)) return false;
    if (!optionFor(OUTPUT, a.output)) return false;
    if (!optionFor(EXTERNAL, a.external)) return false;
    if (!optionFor(ENERGY, a.energy)) return false;

    return true;
  }

  return {
    ITEMS: ITEMS,
    GUT: GUT,
    SCALE: SCALE,
    EVIDENCE: EVIDENCE,
    OUTPUT: OUTPUT,
    EXTERNAL: EXTERNAL,
    ENERGY: ENERGY,
    AREAS: AREAS,
    STATES: STATES,
    CONFIDENCE: CONFIDENCE,
    score: score,
    calloutFor: calloutFor,
    labelFor: labelFor,
    lower: lower,
    validAnswers: validAnswers
  };
}));
