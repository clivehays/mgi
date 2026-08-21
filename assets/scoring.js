/* =============================================================
   Manager Gap Index v5 - the instrument

   Single source of truth. Loaded by the browser as a global (MGI)
   and required by the serverless function as a CommonJS module,
   so the client and the emails can never disagree.

   Seventeen questions:
     Q0        gut check, unscored, compared to the computed state
     Q1-Q12    evidence items, recency scale, 3/2/1/0
     Q13-Q15   trajectory items, output / external / energy
     Q16       exposure, drives confidence and nothing else

   Three outputs from three distinct sources, deliberately kept
   apart:
     state       evidence items plus the trajectory items
     confidence  exposure only. It never changes the state call,
                 only how firmly the report stands behind it.
     signal      sum of the twelve evidence items. Reported as
                 what it is, evidence freshness. Never confidence.
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

  /* ---------- Q16: exposure. Confidence comes from here alone ----------
     A behaviour that has not reached a manager who is there most days
     is genuinely not happening. The same absence reported from a
     distance might be distance, not decline. */

  var EXPOSURE = {
    key: 'exposure',
    kind: 'exposure',
    text: 'In a typical week, how much direct working contact do you have with this team?',
    options: [
      { value: 'most_days', label: 'Most days', confidence: 'high' },
      { value: 'few_times', label: 'A few times a week', confidence: 'high' },
      { value: 'weekly', label: 'About weekly', confidence: 'moderate' },
      { value: 'less_weekly', label: 'Less than weekly', confidence: 'low' }
    ]
  };

  /* ---------- the full seventeen, in order ---------- */

  var ITEMS = [GUT];
  EVIDENCE.forEach(function (text, i) {
    ITEMS.push({ key: 'e' + (i + 1), kind: 'evidence', n: i + 1, text: text, options: SCALE });
  });
  ITEMS.push(OUTPUT, EXTERNAL, ENERGY, EXPOSURE);

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
      description: 'Your output is holding, which is why this state is dangerous: nothing in the numbers says anything is wrong. But the behaviours that produce that output have stopped reaching you. Fewer unprompted ideas. Less open disagreement. Problems arriving late or second-hand. Drift is the state managers miss most, because everything that would reveal it is something that quietly stops happening. By the time Drift shows up in output, it has a new name.',
      action: 'Do not announce an initiative. Drift deepens under programmes and retreats under attention. This week, pick the person you are least sure about and have one unhurried conversation with no agenda. Then look again at your thinnest signal area above and create one situation where fresh signal can reach you in it.'
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

  /* ---------- confidence, from exposure only ---------- */

  var CONFIDENCE = {
    high: { key: 'high', label: 'High confidence' },
    moderate: { key: 'moderate', label: 'Moderate confidence' },
    low: { key: 'low', label: 'Low confidence' }
  };

  var LOW_CONFIDENCE_CAUTION = 'One caution before you take this reading at face value. You told us you have direct contact with this team less than weekly. At that distance, behaviours that haven’t reached you may still be happening out of your sight. The difference matters: it is the difference between a team going quiet and you no longer hearing them. Only fresher contact tells you which, and until then, treat this result as a question to investigate rather than an answer.';

  var LOW_CONFIDENCE_ACTION = 'And given how little of this team’s week you currently see, the single highest-value move is more direct contact. Every other read improves from there.';

  /* ---------- signal score: freshness of evidence, not confidence ---------- */

  var SIGNAL_FRAMING = 'Twelve of the seventeen questions measured how recently real, first-hand signal from this team has reached you. This score is what your current picture of the team is built on.';

  var SIGNAL_BANDS = [
    { min: 27, max: 36, copy: 'Yours is current. Whatever this team does next, you are positioned to see it early.' },
    { min: 15, max: 26, copy: 'Parts of your picture are live; parts are running on memory. The areas below show which.' },
    { min: 0, max: 14, copy: 'Most of your answers reached back a quarter or further. Whatever state this team is truly in, signal that old would not show you a change. A team can leave Cruise and travel a long way before a manager on old signal notices.' }
  ];

  var EXPOSURE_PHRASE = {
    most_days: 'most days',
    few_times: 'a few times a week',
    weekly: 'about weekly',
    less_weekly: 'less than weekly'
  };

  /* When the manager is close to the team, a thin signal score does not
     mean a stale picture. It means these things have stopped happening
     where they could see them. The default band copy attributes a low
     score to distance, which misreads the one case the instrument can
     be most certain about, so high exposure gets its own wording. */

  function closeUpSignalCopy(s, phrase) {
    if (s <= 14) {
      return 'You told us you are with this team ' + phrase + '. Even so, most of what this asked about has not reached you inside a month. That combination is the finding. A thin picture usually means distance. Yours does not: you are close enough to see, and the things worth seeing have stopped happening.';
    }
    return 'Parts of your picture are live. Parts are not. You are with this team ' + phrase + ', so that gap is not distance. Some of this stopped reaching you while you were there to see it. The areas below show which.';
  }

  function closeUpSummary(countPhrase, phrase) {
    return countPhrase + ' are running on little or nothing recent, and you are with this team ' + phrase +
      '. At that point the gaps stop being local, and they stop being about distance. This is not an old picture of the team. It is a current picture of a team that has gone quiet.';
  }

  /* ---------- recency wording ----------
     The per-area fact reports the MOST RECENT answer in that area,
     which is the honest summary: it names what the manager has, not
     a label invented on top of it. */

  var RECENCY_PHRASE = {
    3: 'within the last week',
    2: 'within the last month',
    1: 'over a month ago',
    0: 'nothing you could recall'
  };

  /* Reporting only the most recent of the two items hid the weaker half of
     every area: an area holding one answer from last month and one nobody
     could recall read identically to an area holding last month and last
     quarter. That made the ranking behind the callouts invisible, and it
     contradicted the signal-score copy, which counts every item. When the two
     differ, both are stated. */
  function recencyFact(best, worst) {
    if (best === worst) return 'Most recent signal: ' + RECENCY_PHRASE[best];
    return 'Most recent signal: ' + RECENCY_PHRASE[best] + '. The other: ' + RECENCY_PHRASE[worst];
  }

  /* "All five of your five areas" reads redundantly, so the
     five case carries its own phrasing */
  var COUNT_PHRASE = {
    3: 'Three of your five areas',
    4: 'Four of your five areas',
    5: 'All five of your areas'
  };

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

  function signalBandFor(s) {
    for (var i = 0; i < SIGNAL_BANDS.length; i++) {
      if (s >= SIGNAL_BANDS[i].min && s <= SIGNAL_BANDS[i].max) return SIGNAL_BANDS[i];
    }
    return SIGNAL_BANDS[SIGNAL_BANDS.length - 1];
  }

  /* ---------- the state decision tree ----------
     Deterministic, applied top to bottom, first match wins.
     Exposure never enters this tree. */

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
     answers: { gut, evidence: [12 ints 0-3], output, external, energy, exposure } */

  function score(answers) {
    var evidence = answers.evidence;
    var i;

    var s = 0;
    for (i = 0; i < 12; i++) s += evidence[i];

    var b = mean(evidence, BEHAVIOUR_ITEMS);

    var decision = decideState(b, answers.output, answers.external, answers.energy);
    var state = decision.state;

    var exposureOpt = optionFor(EXPOSURE, answers.exposure);
    var confidence = CONFIDENCE[exposureOpt.confidence];
    var isLow = confidence.key === 'low';
    var exposurePhrase = EXPOSURE_PHRASE[answers.exposure];

    /* close enough to the team that a thin score reports absence, not distance */
    var closeUp = confidence.key === 'high';

    var gap = decideGap(answers.gut, state);

    var areas = AREAS.map(function (a) {
      var v1 = evidence[a.items[0] - 1];
      var v2 = evidence[a.items[1] - 1];
      var best = Math.max(v1, v2);
      var worst = Math.min(v1, v2);
      var m = (v1 + v2) / 2;
      return {
        key: a.key,
        name: a.name,
        items: a.items,
        desc: a.desc,
        tie: a.tie,
        mean: m,
        best: best,
        worst: worst,
        recencyFact: recencyFact(best, Math.min(v1, v2)),
        isWeak: m < 1.0
      };
    });

    var ranked = areas.slice().sort(function (x, y) {
      if (x.mean !== y.mean) return x.mean - y.mean;
      return x.tie - y.tie;
    });
    areas.forEach(function (a) { a.rank = ranked.indexOf(a); });

    var weakCount = areas.filter(function (a) { return a.isWeak; }).length;

    /* Either one summary block, or callouts on the two lowest areas.
       Never both, and the cohort sentence appears exactly once. */
    var summary = null;
    var callouts = [];

    if (weakCount >= 3) {
      summary = closeUp
        ? closeUpSummary(COUNT_PHRASE[weakCount], exposurePhrase)
        : COUNT_PHRASE[weakCount] + ' are running on little or nothing recent. At that point the gaps stop being local. Your picture of this team is a picture of a previous team.';
    } else {
      callouts = [
        { key: ranked[0].key, copy: lowestCallout(ranked[0]) },
        { key: ranked[1].key, copy: secondCallout(ranked[1]) }
      ];
    }

    var calloutFor = {};
    callouts.forEach(function (c) { calloutFor[c.key] = c.copy; });
    areas.forEach(function (a) { a.callout = calloutFor[a.key] || null; });

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
      isLowConfidence: isLow,
      caution: isLow ? LOW_CONFIDENCE_CAUTION : null,
      exposure: { value: answers.exposure, label: exposureOpt.label },
      gap: gap,
      signal: s,
      signalFraming: SIGNAL_FRAMING,
      signalCopy: (closeUp && s <= 26) ? closeUpSignalCopy(s, exposurePhrase) : signalBandFor(s).copy,
      closeUp: closeUp,
      behaviour: b,
      areas: areas,
      ranked: ranked,
      weakCount: weakCount,
      summary: summary,
      action: isLow ? state.action + ' ' + LOW_CONFIDENCE_ACTION : state.action,
      responses: responses,
      headline: 'Based on what you’ve observed, your team is most likely in ' + state.name + '.'
    };
  }

  /* The two lowest-ranked areas always get a callout, but "lowest-ranked" is
     relative, not a verdict. On a healthy team the thinnest area can still be
     entirely current, and telling that manager their read "rests on nothing
     more recent than last week" scolds them for the best answer available.
     So the register follows what the area actually shows: a drift warning only
     when the freshest thing in it is over a week old, and a watch note when it
     is current. */

  var COHORT_DRIFT = ' In our research cohort, this is where managers\u2019 pictures drift furthest from what teams actually report.';
  var COHORT_WATCH = ' In our research cohort this is the area that fades first, so it is the one to keep an eye on.';

  function lowestCallout(area) {
    var name = lower(area.name);
    if (area.best >= 3) {
      return 'Less sits behind your read on ' + name + ' than any of the other four, though something in it did reach you within the last week.' + COHORT_WATCH;
    }
    if (area.best === 2) {
      return 'Less sits behind your read on ' + name + ' than any of the other four, and the freshest thing in it is a month old.' + COHORT_DRIFT;
    }
    if (area.best === 1) {
      return 'Nothing more recent than a month ago sits behind your read on ' + name + '.' + COHORT_DRIFT;
    }
    return 'Nothing you could recall sits behind your read on ' + name + '.' + COHORT_DRIFT;
  }

  function secondCallout(area) {
    var name = lower(area.name);
    if (area.best >= 3) {
      return 'Almost as little sits behind your read on ' + name + ', though it is current too. Worth keeping an eye on rather than fixing.';
    }
    return 'Almost as little sits behind your read on ' + name + '. This is where a fresh look would change most.';
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
    if (!optionFor(EXPOSURE, a.exposure)) return false;

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
    EXPOSURE: EXPOSURE,
    AREAS: AREAS,
    STATES: STATES,
    CONFIDENCE: CONFIDENCE,
    SIGNAL_FRAMING: SIGNAL_FRAMING,
    score: score,
    labelFor: labelFor,
    lower: lower,
    validAnswers: validAnswers
  };
}));
