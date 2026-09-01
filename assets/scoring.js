/* =============================================================
   Manager Gap Index v6 - the instrument

   Single source of truth. Loaded by the browser as a global (MGI)
   and required by the serverless function as a CommonJS module,
   so the client and the emails can never disagree.

   Twenty questions:
     Q0        gut check, unscored, compared to the computed state
     Q1-Q15    evidence items, recency scale, 3/2/1/0, three per area
     Q16-Q18   trajectory items, output / external / energy
     Q19       exposure, which becomes line of sight

   Outputs from distinct sources, deliberately kept apart:
     state         evidence items plus the trajectory items
     line of sight exposure only. How much of the team's week the
                   manager is positioned to observe. It never
                   changes the state call.
     gap width     line of sight and observation recency together.
                   How far the manager's picture and the team's
                   reality are likely to sit apart.
     signal        sum of the fifteen evidence items, reported as
                   what it is: evidence freshness.

   v6.0 changed the item set only. The state decision tree, its
   thresholds and BEHAVIOUR_ITEMS are byte-for-byte what v5 used,
   so every state finding carries over untouched.

   v6.1 changed no question and no scoring rule. It retires the
   participant-facing confidence reading and replaces it with line
   of sight and gap width. The fingerprint is therefore unchanged
   and v6.0 and v6.1 submissions pool directly.
   ============================================================= */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MGI = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- provenance ----------
     Every stored row records which instrument produced it. VERSION is
     declared by hand and should be bumped whenever an item, a threshold or
     the tree changes. FINGERPRINT is computed from those same things, so a
     change made without bumping VERSION still shows up in the data. Two
     rows are comparable only if both match. */

  var VERSION = '6.1.0';

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

  /* ---------- Q1-Q15: the evidence items ----------
     Fifteen, three per area. Two items per area gave only seven possible
     area means, so a quarter of respondents had two areas holding an
     identical pair of answers and the weakest-area call fell to a fixed
     priority list. That list systematically picked the same areas: truth
     was selected twice as often as why, from the list rather than from
     anyone's data. A third item roughly halves it. Items 13, 14 and 15
     were added for that reason; 11 and 12 already existed and are now
     assigned to the areas they always belonged to. */

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
    'When did you last change your mind because of something a team member said?',
    'When did you last clear something out of the team’s way that someone had raised with you?',
    'When did a team member last walk you through how they actually did a piece of work, not just the outcome?',
    'When did you last explain to the team why the current priority is the priority, rather than just what it is?'
  ];

  /* ---------- Q16-Q18: the trajectory items ---------- */

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

  /* ---------- Q19: exposure, which becomes line of sight ----------
     A behaviour that has not reached a manager who is there most days
     is genuinely not happening. The same absence reported from a
     distance might be distance, not decline. That distance is the
     finding, not a caveat on it.

     The confidence property on each option is DEPRECATED and is kept
     only because it is one of the inputs to the instrument fingerprint.
     Removing it would change the fingerprint and split the cohort. */

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
      short: 'Equipped',
      items: [1, 2, 13],
      tie: 2,
      desc: 'Whether blockers reach you before they bite, whether the team helps each other without routing through you, and whether anything actually gets cleared once it is raised.'
    },
    {
      key: 'work',
      name: 'The work itself',
      short: 'The work',
      items: [3, 4, 14],
      tie: 3,
      desc: 'Your direct contact with the output, unprompted comment on it from outside the team, and the team walking you through how the work was really done.'
    },
    {
      key: 'invested',
      name: 'How invested people are',
      short: 'Invested',
      items: [5, 6, 11],
      tie: 1,
      desc: 'Contribution nobody asked for, unhurried time with every person on the team, and real contact with the person you are least sure about.'
    },
    {
      key: 'why',
      name: 'Whether everyone knows why',
      short: 'The why',
      items: [7, 8, 15],
      tie: 4,
      desc: 'Whether the priority is understood in the team’s own words, whether work gets challenged as worth doing, and whether you have said why it is the priority rather than only what it is.'
    },
    {
      key: 'truth',
      name: 'Whether truth travels upward',
      short: 'Truth',
      items: [9, 10, 12],
      tie: 0,
      desc: 'Open disagreement in the room, problems reaching you from the person involved rather than second hand, and whether what you hear ever changes your mind.'
    }
  ];

  /* Unchanged from v5, deliberately. The state tree is calibrated against
     exactly these eight items, so the three items added in v6 sharpen the
     area ranking without disturbing a single state call. */
  var BEHAVIOUR_ITEMS = [1, 2, 5, 6, 9, 10, 11, 12];

  /* ---------- states ---------- */

  var STATES = {
    cruise: {
      key: 'cruise',
      name: 'Cruise',
      colour: '#1B7A4A',
      severity: [0, 1],
      description: 'Output is holding and the behaviours of a healthy team are visible around you: disagreement reaches you, problems arrive early, ideas show up unprompted. Cruise is the state every team should return to, not a state to coast in. Teams rarely leave Cruise with an announcement. They leave it quietly, through the exact behaviours this diagnostic asked about.'
    },
    drift: {
      key: 'drift',
      name: 'Drift',
      colour: '#C2842F',
      severity: [2, 2],
      description: 'Your output is holding, which is why this state is dangerous: nothing in the numbers says anything is wrong. But the behaviours that produce that output have stopped reaching you. Fewer unprompted ideas. Less open disagreement. Problems arriving late or second-hand. Drift is the state managers miss most, because everything that would reveal it is something that quietly stops happening. By the time Drift shows up in output, it has a new name.'
    },
    headwinds: {
      key: 'headwinds',
      name: 'Headwinds',
      colour: '#6B5BD2',
      severity: [2, 2],
      description: 'Your output is falling, but the evidence says the team itself is holding: the behaviours of a healthy team are still visible, and there is a clear external force acting on it. This is the most misdiagnosed state there is. Managers who miss the external cause conclude the team is failing, and treat a healthy team like a broken one. The right response to Headwinds is to name the weather, shield the team where you can, and flag the cause upward loudly. The wrong response is to push the team harder.'
    },
    stall: {
      key: 'stall',
      name: 'Stall',
      colour: '#B03A2E',
      severity: [3, 3],
      description: 'The decline has reached the output, and the behaviours of a healthy team are not visible around you. Stall is the one state every manager detects, because it is the only one that announces itself. The honest news: teams recover from Stall, but not by pushing on output. Output is the last thing to fall and the last thing to return. Recovery starts where the slide started, in the behaviours this diagnostic asked about, and it starts with signal: you cannot steer a recovery you cannot see.'
    }
  };

  /* ---------- the action matrix ----------
     One action per state and weakest-area pair, twenty in all. The state
     alone never decides it: two managers both in Drift, one whose truth
     channel has closed and one who has not looked at the work in a month,
     need different weeks. The weakest area is ranked[0] from the existing
     ranking, so the advice lands on the gap the report just named. */

  var ACTIONS = {
    cruise: {
      equipped: 'Ask in your next stand-up: what’s slowing anyone down that hasn’t felt worth mentioning? Then fix the first thing named within 48 hours, visibly. In Cruise, the speed of response to small blockers is what keeps the big ones arriving early.',
      work: 'Pick one piece of live work and review it with the person who made it. Not to check it; to understand it. Ask what they’d improve with one more day. Note whether the answer surprises you. Surprise is your signal working.',
      invested: 'Take the last unprompted idea someone brought you and give it a visible next step this week, even a small one. Ideas keep arriving at the rate the last one was seen to matter.',
      why: 'At the end of your next team session, ask someone to say what the current priority is in their own words, and why it’s the priority. If the why comes back thin, that’s your earliest warning, months ahead of anything showing in output.',
      truth: 'State your own current plan in front of the team and ask, specifically, what’s wrong with it. Count the seconds before someone answers, and say nothing until they do. The length of that silence is a number worth tracking.'
    },
    drift: {
      equipped: 'Ask each person, one-to-one this week: what’s in your way right now that you’ve stopped bothering to raise? The phrasing matters. “Stopped bothering” gives permission to name the thing they’ve written off. Then fix one raised item within the week, visibly.',
      work: 'Choose the piece of work you know least about and spend thirty minutes inside it with the person doing it. Not a status conversation; the actual work on the actual screen. What you learn that wasn’t in any update is the size of your gap.',
      invested: 'Do not announce an initiative. Drift deepens under programmes and retreats under attention. Pick the person you are least sure about and have one unhurried conversation with no agenda. Open with: what are you working on that you wish got more notice? Then let silence do the work.',
      why: 'Ask two people, separately and casually: what’s the most important thing we’re doing right now, and why? Two different answers, or the same answer with no why, shows you where the drift started.',
      truth: 'In your next team discussion, state your own current idea and then ask, specifically, what’s wrong with it. Count the seconds before someone answers, and say nothing until they do. If the silence holds past ten, name it: “the fact that nobody will say anything is the most useful information in this room.”'
    },
    headwinds: {
      equipped: 'List what the external pressure has taken from this team: time, tools, people, decision speed. Ask the team what’s missing from your list. Send the combined list upward in writing this week. Equipping a team in weather starts with an inventory someone above you can act on.',
      work: 'Take one concrete piece of the team’s output from this month and attach it to the external cause in writing: what it would have been without the weather, and what it was. One specific example does what no summary can. It makes the cause legible above you.',
      invested: 'Tell the team, in plain words, that you can see the effort and you can see the conditions. Name one person’s specific work from the last fortnight when you do. In headwinds, invisible effort curdles fastest. Witnessed effort holds.',
      why: 'Re-state the priority for the next month yourself, out loud, sized to the weather: what still matters, what’s parked, and what would count as a good month under these conditions. Teams in headwinds don’t lose the why. They lose the how much, and nobody resets it.',
      truth: 'Ask the team directly: what do you know about this situation that you think I don’t? The weather always looks different from inside the work. Then repeat what you hear upward, attributed to the front line, in writing.'
    },
    stall: {
      equipped: 'Ask each person you can reach one question: what would you need to do your best work here again? Write the answers down without defending or promising anything. The list will be shorter and more concrete than you fear, and it is the first draft of the recovery plan.',
      work: 'Go to the work itself before any meeting about the work. Sit with one person and one live piece of output and establish where it actually stands, not where the reporting says it stands. Recoveries planned from reports fail, because the reporting is part of what stalled.',
      invested: 'Have one real conversation with each person you can reach, asking what has actually been happening, and listen without defending. What you hear is the map of the way back. It will not be comfortable, and it will be the most useful thing you have heard in months.',
      why: 'Stop asking for more output and answer the question the team has stopped asking: why does this work matter now? If you cannot answer it convincingly, that is the actual stall, and it sits above you, which changes what you escalate and to whom.',
      truth: 'Tell the team one true thing about the situation that you would normally soften, then ask what they would add. Stalls run on mutual pretence, and the first unsoftened sentence usually breaks it. What comes back will be rougher than you would like and truer than what you currently have.'
    }
  };

  /* ---------- line of sight ----------
     How much of the team's week the manager is positioned to observe
     directly. Derived from the exposure answer, which is unchanged: this
     promotes an existing input to a named, first-class output.

     daily and most_days deliberately share a score. The difference between
     them does not change what a manager can see in any way we can defend,
     and separating them would be false precision. */

  var LINE_OF_SIGHT = {
    daily: {
      key: 'full', score: 3, label: 'Full',
      copy: 'You are inside your team’s week almost every day. Most of what happens reaches you directly, without anyone having to decide to tell you.'
    },
    most_days: {
      key: 'full', score: 3, label: 'Full',
      copy: 'You are inside your team’s week almost every day. Most of what happens reaches you directly, without anyone having to decide to tell you.'
    },
    few_times: {
      key: 'partial', score: 2, label: 'Partial',
      copy: 'You see the scheduled parts of your team’s week. What happens between those points reaches you only if somebody passes it on.'
    },
    weekly: {
      key: 'narrow', score: 1, label: 'Narrow',
      copy: 'You get one window a week. Everything either side of it is reconstructed from what people choose to bring you.'
    },
    less_weekly: {
      key: 'minimal', score: 0, label: 'Minimal',
      copy: 'Almost none of your team’s week reaches you directly. What you know about this team is what somebody decided to tell you. That is a fact about where you sit, not about how well you are managing.'
    }
  };

  /* ---------- gap width ----------
     How far apart the manager's picture and the team's reality are likely
     to be. Position and freshness carry equally: a manager who sees the
     team daily but has looked at nothing closely has a real gap, and so
     does one who looks hard from a distance.

     PROVISIONAL. These cut points were set by hand against a handful of
     submissions. Revisit at roughly n=50. This is the only place in the
     codebase they appear. */

  var GAP_BANDS = [
    {
      max: 1.0, key: 'narrow', label: 'Narrow',
      copy: 'You are close enough to your team’s week that your read and their reality should be within touching distance. Where they differ, the difference is real and worth chasing.'
    },
    {
      max: 2.5, key: 'moderate', label: 'Moderate',
      copy: 'Enough of the week reaches you for your read to be broadly sound, with specific conditions you have no way to confirm. The gap sits in whatever you have looked at least recently.'
    },
    {
      max: 4.0, key: 'wide', label: 'Wide',
      copy: 'Most of your team’s week never reaches you. What does reach you has been through somebody else’s judgement about what is worth passing on. The distance between your picture and your team’s is large, and closing it is a matter of position rather than attention.'
    },
    {
      max: Infinity, key: 'very_wide', label: 'Very wide',
      copy: 'You are positioned to see very little of this team directly, and you have little recent observation to work from. Almost everything you believe about this team is second-hand. That is the most useful thing this assessment can tell you.'
    }
  ];

  var GAP_FRAMING = 'This is not a measure of how good your answers were. How much of your team’s week you can see is what creates the gap in the first place, so it is the first thing worth knowing.';

  function lineOfSightFor(exposure) {
    return LINE_OF_SIGHT[exposure] || LINE_OF_SIGHT.less_weekly;
  }

  function gapWidthFor(losScore, meanRecency) {
    var index = (3 - losScore) + (3 - meanRecency);
    var band = GAP_BANDS[GAP_BANDS.length - 1];
    for (var i = 0; i < GAP_BANDS.length; i++) {
      if (index <= GAP_BANDS[i].max) { band = GAP_BANDS[i]; break; }
    }
    return { index: Number(index.toFixed(2)), key: band.key, label: band.label, copy: band.copy };
  }

  /* ---------- confidence ----------
     DEPRECATED. Retained for this release so nothing reading the export
     breaks on deploy, and still written to the database. It must not reach
     a participant, and nothing new may read it. Removal is a later release.
     Superseded by line of sight and gap width above: exposure is not noise
     in the measurement, it is the mechanism that produces the gap. */

  var CONFIDENCE = {
    high: { key: 'high', label: 'High confidence' },
    moderate: { key: 'moderate', label: 'Moderate confidence' },
    low: { key: 'low', label: 'Low confidence' }
  };

  /* Where line of sight is Narrow or Minimal the first move is one that
     increases observation, not one that changes the team. Go and look
     before you go and fix. This is an instruction, never a caveat: it
     says nothing about how far to trust the reading. */
  var NARROW_SIGHT_ACTION = 'Given how little of this team’s week you are positioned to see, the single highest-value move is more direct contact. Every other read improves from there.';

  /* ---------- signal score: freshness of evidence, not confidence ---------- */

  /* ---------- what the picture is built on ----------
     A score out of 45 tells a manager nothing they did not just type in.
     The number that means something is how many of the fifteen things have
     NOT reached them inside a month, because each of those is a thing they
     are running on memory rather than observation.

     Where line of sight is Full or Partial that count resolves further:
     a manager who is there most of the week has been positioned to see
     these things, so an item that has not reached them has stopped
     happening rather than happened out of view. That is the sharpest
     reading this instrument produces and it belongs here. */

  var NUMBER_WORD = ['none', 'One', 'Two', 'Three', 'Four', 'Five', 'Six',
    'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen',
    'Fourteen', 'Fifteen'];

  function signalHeadline(stale, total) {
    /* words throughout: "Seven of the 15" mixes registers and reads badly */
    var whole = (NUMBER_WORD[total] || String(total)).toLowerCase();
    if (stale === 0) {
      return 'All ' + whole + ' of the things this asked about have reached you inside the last month.';
    }
    if (stale === total) {
      return 'None of the ' + whole + ' things this asked about has reached you inside a month.';
    }
    return NUMBER_WORD[stale] + ' of the ' + whole + ' things this asked about ' +
      (stale === 1 ? 'has' : 'have') + ' not reached you inside a month.';
  }

  var STALE_MEANING = [
    { max: 0, copy: 'Nothing you believe about this team is running on memory. When something here changes, you are positioned to watch it happen rather than hear about it afterwards.' },
    { max: 3, copy: 'Almost all of what you believe about this team you have seen for yourself this month. The few things you have not are where a change would reach you late, if it reached you at all.' },
    { max: 8, copy: 'About half of what you believe about this team is memory rather than observation. Those parts could have moved without anything telling you, and the first sign would be something going wrong rather than something looking different.' },
    { max: 15, copy: 'Most of what you believe about this team is memory. A team can travel a long way behind a picture this old, and you would not expect to notice until it reached the work.' }
  ];

  /* the either/or, and the case where position resolves it */
  var STALE_UNRESOLVED = 'Each of those has either stopped happening or is happening somewhere you cannot see it. From where you sit the two look identical, and that is the finding rather than a gap in it.';
  var STALE_RESOLVED = 'You are with this team often enough to have seen these things happen. They have not reached you anyway, which settles what it is: not things you are missing from a distance, things that have stopped.';

  function staleMeaning(stale, closeUp) {
    var band = STALE_MEANING[STALE_MEANING.length - 1];
    for (var i = 0; i < STALE_MEANING.length; i++) {
      if (stale <= STALE_MEANING[i].max) { band = STALE_MEANING[i]; break; }
    }
    if (stale === 0) return band.copy;
    return band.copy + ' ' + (closeUp ? STALE_RESOLVED : STALE_UNRESOLVED);
  }

  var SIGNAL_FRAMING = 'Fifteen of the twenty questions measured how recently real, first-hand signal from this team has reached you. This score is what your current picture of the team is built on.';

  /* Fifteen items at 0-3 puts the maximum at 45. The band edges are the v5
     edges scaled by 45/36, so a manager scores the same band on the same
     answers as they would have under v5. */
  var SIGNAL_MAX = 45;   // fifteen items at 0-3
  var SIGNAL_LOW = 18;   // top of the thin band
  var SIGNAL_MID = 33;   // top of the middle band

  var SIGNAL_BANDS = [
    { min: 34, max: 45, copy: 'Yours is current. Whatever this team does next, you are positioned to see it early.' },
    { min: 19, max: 33, copy: 'Parts of your picture are live; parts are running on memory. The areas below show which.' },
    { min: 0, max: 18, copy: 'Most of your answers reached back a quarter or further. Whatever state this team is truly in, signal that old would not show you a change. A team can leave Cruise and travel a long way before a manager on old signal notices.' }
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
    if (s <= SIGNAL_LOW) {
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

  /* The same fact in a form that can be read at a glance. Five of these in a
     column is what lets a reader take the areas in at a glance and then
     choose what to read properly. It is the freshest item in the area, so it
     never overstates: the fuller sentence underneath names the rest. */
  var RECENCY_SHORT = {
    3: 'Within the last week',
    2: 'Within the last month',
    1: 'Over a month ago',
    0: 'Nothing recalled'
  };

  /* Reporting only the most recent item hid the weaker part of every area:
     an area holding one answer from last month and one nobody could recall
     read identically to an area holding last month and last quarter. That
     made the ranking behind the callouts invisible, and it contradicted the
     signal-score copy, which counts every item. So the freshest is named,
     and the rest of the area is named with it.

     With three items the same principle holds, but the sentence has to
     follow the shape the numbers actually take. Naming them in rank order
     regardless produced "within the last week. Then within the last week,
     then nothing you could recall", which repeats itself and reads badly.
     So each of the four arrangements gets its own wording. */
  function recencyFact(values) {
    var sorted = values.slice().sort(function (a, b) { return b - a; });
    var a = sorted[0], b = sorted[1], c = sorted[2];

    /* all three alike */
    if (a === b && b === c) {
      return 'Most recent signal: ' + RECENCY_PHRASE[a] + '.';
    }

    /* the two freshest alike, the third behind them */
    if (a === b) {
      return 'Two of the three: ' + RECENCY_PHRASE[a] +
             '. The third: ' + RECENCY_PHRASE[c] + '.';
    }

    /* one out in front, the other two alike */
    if (b === c) {
      return 'Most recent signal: ' + RECENCY_PHRASE[a] +
             '. The other two: ' + RECENCY_PHRASE[b] + '.';
    }

    /* three different answers */
    return 'Most recent signal: ' + RECENCY_PHRASE[a] +
           '. Then ' + RECENCY_PHRASE[b] +
           ', then ' + RECENCY_PHRASE[c] + '.';
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
     answers: { gut, evidence: [15 ints 0-3], output, external, energy, exposure } */

  function score(answers) {
    var evidence = answers.evidence;
    var i;

    var s = 0;
    var stale = 0;
    for (i = 0; i < EVIDENCE.length; i++) {
      s += evidence[i];
      /* over a month ago, or nothing recalled: memory rather than observation */
      if (evidence[i] <= 1) stale++;
    }

    var b = mean(evidence, BEHAVIOUR_ITEMS);

    var decision = decideState(b, answers.output, answers.external, answers.energy);
    var state = decision.state;

    var exposureOpt = optionFor(EXPOSURE, answers.exposure);
    var exposurePhrase = EXPOSURE_PHRASE[answers.exposure];

    var los = lineOfSightFor(answers.exposure);
    /* one window a week or less: the first move is to go and look */
    var narrowSight = los.score <= 1;

    /* close enough to the team that a thin score reports absence, not
       distance. Reads line of sight rather than the deprecated confidence
       key; the two select exactly the same set of exposure answers, so
       the signal copy is unchanged by this release. */
    var closeUp = los.score >= 2;

    /* deprecated, still written to the database, never shown to anyone */
    var confidence = CONFIDENCE[exposureOpt.confidence];

    var gap = decideGap(answers.gut, state);

    var areas = AREAS.map(function (a) {
      var values = a.items.map(function (n) { return evidence[n - 1]; });
      var sorted = values.slice().sort(function (p, q) { return p - q; });
      var total = values.reduce(function (p, q) { return p + q; }, 0);
      return {
        key: a.key,
        name: a.name,
        short: a.short,
        items: a.items,
        desc: a.desc,
        tie: a.tie,
        values: values,
        mean: total / values.length,
        best: sorted[sorted.length - 1],
        worst: sorted[0],
        /* the answers low-to-high, the finest comparison the area supports */
        profile: sorted,
        recencyFact: recencyFact(values),
        freshest: RECENCY_SHORT[sorted[sorted.length - 1]],
        isWeak: total / values.length < 1.0
      };
    });

    /* Ranking, weakest first.

       Mean is the primary key. Where means are equal the areas are compared
       item by item from the lowest answer upward, because an area holding a
       "can't recall" is a sharper blind spot than one that is evenly stale
       at the same mean. That comparison uses everything the area contains:
       once the sorted answers match, the two areas hold identical data and
       nothing inside the instrument can separate them.

       Only then does the fixed priority run, and the report stops claiming
       a single weakest area when it gets that far. In v5 that list decided
       roughly a quarter of all reports on its own, which is why the same
       areas kept being selected. */
    var ranked = areas.slice().sort(function (x, y) {
      if (x.mean !== y.mean) return x.mean - y.mean;
      for (var k = 0; k < x.profile.length; k++) {
        if (x.profile[k] !== y.profile[k]) return x.profile[k] - y.profile[k];
      }
      return x.tie - y.tie;
    });
    areas.forEach(function (a) { a.rank = ranked.indexOf(a); });

    /* how many areas hold answers identical to the thinnest. Two or more
       means the pick between them would be the fixed list talking rather
       than the manager's data. All five means the answers are flat and
       there is no thinnest area at all. */
    var tiedCount = ranked.filter(function (a) {
      return a.mean === ranked[0].mean &&
        a.profile.join(',') === ranked[0].profile.join(',');
    }).length;
    var indistinguishable = tiedCount >= 2;

    var weakCount = areas.filter(function (a) { return a.isWeak; }).length;

    /* Either one summary block, or callouts on the two lowest areas.
       Never both, and the cohort sentence appears exactly once. */
    var summary = null;
    var callouts = [];

    if (weakCount >= 3) {
      summary = closeUp
        ? closeUpSummary(COUNT_PHRASE[weakCount], exposurePhrase)
        : COUNT_PHRASE[weakCount] + ' are running on little or nothing recent. At that point the gaps stop being local. Your picture of this team is a picture of a previous team.';
    } else if (indistinguishable) {
      /* The two thinnest areas hold the same answers. Asserting one of them
         as the weakest would be the fixed list talking, not the manager's
         data, so both are named and the report says why. */
      callouts = [
        { key: ranked[0].key, copy: tiedCallout(ranked, tiedCount) },
        { key: ranked[1].key, copy: tiedSecondCallout(ranked[1]) }
      ];
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

    /* the most recent observation in each area, averaged. This is the
       freshness half of the gap; line of sight is the position half. */
    var meanRecency = areas.reduce(function (t, a) { return t + a.best; }, 0) / areas.length;
    var gapW = gapWidthFor(los.score, meanRecency);

    return {
      state: state,
      rule: decision.rule,

      /* how much of the team's week this manager is positioned to see */
      lineOfSight: {
        key: los.key,
        score: los.score,
        label: los.label,
        copy: los.copy
      },
      /* how far the manager's picture and the team's reality are likely
         to sit apart, from position and freshness together */
      meanRecency: Number(meanRecency.toFixed(2)),
      gapIndex: gapW.index,
      gapWidth: {
        key: gapW.key,
        label: gapW.label,
        copy: gapW.copy
      },
      gapFraming: GAP_FRAMING,
      discoveryLag: DISCOVERY_LAG[gapW.key],

      /* deprecated, retained so the export contract does not break */
      confidence: confidence,

      exposure: { value: answers.exposure, label: exposureOpt.label },
      gap: gap,
      signal: s,
      /* the interpretive reading: how much of the picture is memory, and
         what that means. The raw score stays for the cohort, not the page. */
      staleCount: stale,
      liveCount: EVIDENCE.length - stale,
      signalHeadline: signalHeadline(stale, EVIDENCE.length),
      signalMeaning: staleMeaning(stale, closeUp),
      signalFraming: SIGNAL_FRAMING,
      signalCopy: (closeUp && s <= SIGNAL_MID) ? closeUpSignalCopy(s, exposurePhrase) : signalBandFor(s).copy,
      closeUp: closeUp,
      behaviour: b,
      areas: areas,
      ranked: ranked,
      weakCount: weakCount,
      summary: summary,
      indistinguishable: indistinguishable,
      tiedWith: indistinguishable ? ranked[1].name : null,
      tiedCount: tiedCount,
      action: buildAction(state, ranked, narrowSight, indistinguishable, tiedCount),
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

  /* the same two sentences for a callout that has named more than one area */
  var COHORT_DRIFT_PLURAL = ' In our research cohort, these are the areas where managers\u2019 pictures drift furthest from what teams actually report.';
  var COHORT_WATCH_PLURAL = ' In our research cohort these are the areas that fade first, so they are the ones to keep an eye on.';

  function actionFor(state, weakestArea) {
    return ACTIONS[state.key][weakestArea.key];
  }

  /* When the two thinnest areas hold identical answers there is no honest
     basis for doing one before the other, so the action names both and
     leaves the order to the manager, who knows things the instrument
     does not. One action still gets spelled out, because a report that
     hands over two competing plans gets neither of them done. */
  var COUNT_WORD = { 2: 'Two', 3: 'Three', 4: 'Four' };

  /* Four of the five area names open with "how" or "whether", so they read as
     embedded questions and will not sit inside a clause: "your answers put the
     work itself and whether everyone knows why level" is unreadable. The names
     go after a colon, where a question-shaped phrase reads naturally, and the
     action is introduced by position rather than by splicing a name again. */
  function tiedPreamble(ranked, tiedCount) {
    if (tiedCount === 5) {
      /* not "one way in", because several actions open with "in your next..."
         and the repetition trips the reader */
      return 'All five of your areas came back level, on the same evidence, so ' +
        'where to start is your call. One option: ';
    }

    var names = ranked.slice(0, tiedCount).map(function (a) { return lower(a.name); });
    var list = names.length === 2
      ? names[0] + ' and ' + names[1]
      : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];

    return COUNT_WORD[tiedCount] + ' of your areas came back level, on the same ' +
      'evidence: ' + list + '. Take whichever you think is closer to the truth ' +
      'of this team. For the first: ';
  }

  function buildAction(state, ranked, narrowSight, indistinguishable, tiedCount) {
    var action = actionFor(state, ranked[0]);

    if (indistinguishable) {
      action = tiedPreamble(ranked, tiedCount) + lowerFirst(action);
    }

    return narrowSight ? action + ' ' + NARROW_SIGHT_ACTION : action;
  }

  function lowerFirst(sentence) {
    /* only when the opening word is ordinary prose, so "Ask" becomes "ask"
       but a name or an "I" is left alone */
    var first = sentence.split(' ')[0];
    if (first !== first.toUpperCase() && first === first.charAt(0).toUpperCase() + first.slice(1)) {
      return sentence.charAt(0).toLowerCase() + sentence.slice(1);
    }
    return sentence;
  }

  var REST_PHRASE = { 2: 'the other three', 3: 'the other two', 4: 'the fifth' };

  function nameList(ranked, n) {
    var names = ranked.slice(0, n).map(function (a) { return lower(a.name); });
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  function tiedCallout(ranked, tiedCount) {
    var area = ranked[0];
    var other = ranked[1];
    /* freshness, stated the same way the single-area callouts state it */
    var freshness = area.best >= 3
      ? 'Something in each did reach you within the last week.'
      : area.best === 2
        ? 'The freshest thing in each is a month old.'
        : area.best === 1
          ? 'Nothing more recent than a month ago sits behind any of them.'
          : 'Nothing you could recall sits behind any of them.';

    /* all five level is a different finding from two level and three above */
    if (tiedCount === 5) {
      return 'Your five areas came back level, on exactly the same answers. ' +
        freshness + ' Nothing here points to one area over another, so the ' +
        'place to start is whichever you would least want to be wrong about.' +
        (area.best >= 3 ? COHORT_WATCH_PLURAL : COHORT_DRIFT_PLURAL);
    }

    var subject = tiedCount === 2
      ? 'Your read on ' + lower(area.name) + ' and your read on ' + lower(other.name) +
        ' rest on exactly the same answers.'
      : COUNT_WORD[tiedCount] + ' of your areas rest on exactly the same answers: ' +
        nameList(ranked, tiedCount) + '.';

    /* the cohort sentence was written for a single named area, so it needs a
       plural form once the callout names three or four of them */
    var cohort = area.best >= 3
      ? (tiedCount === 2 ? COHORT_WATCH : COHORT_WATCH_PLURAL)
      : (tiedCount === 2 ? COHORT_DRIFT : COHORT_DRIFT_PLURAL);

    return subject + ' Less sits behind them than behind ' +
      (REST_PHRASE[tiedCount] || 'the rest') + '. ' + freshness +
      ' Nothing you told us separates them, so treat them as one gap rather ' +
      'than a ranking.' + cohort;
  }

  function tiedSecondCallout(area) {
    return 'Level with the area above, on the same evidence, not behind it.';
  }

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



  /* ---------- discovery lag ----------
     Gap width has been an abstraction. This is what it costs: not how
     much you can see, but how late you find out. A finding about the
     manager's position, never a caveat on the reading. */

  var DISCOVERY_LAG = {
    narrow: 'One more thing that width decides. On your answers you would watch most of this team’s week happen: your line of sight is close and your signal is recent, so what changes reaches you at roughly the speed the team reaches it. Whatever this team does next, you are placed to meet it early, which keeps every option on this page cheap.',
    moderate: 'One more thing that width decides. On your answers, part of this team’s week happens where you can see it and part arrives retold, after somebody decided it was worth passing on. A manager in your position usually meets a change a few weeks after the team does, and the list of cheap options gets shorter over those weeks.',
    wide: 'One more thing that width decides. On your answers, most of this team’s week happens out of your sight and reaches you through the output, which is the last place it shows. A team can be a month into something before a manager in your position has met the first week of it. That lag is not a lapse in attention. It comes from where you sit, and it compounds quietly.',
    very_wide: 'One more thing that width decides. Almost all of this team’s week happens where you cannot see it. For a manager in your position the usual first notice is the event itself, arriving without the weeks that produced it, which is how a quarter of movement gets experienced as a surprise. Nothing on this page is more worth changing than that.'
  };

  /* ---------- the close ----------
     The report is deliberately half a measurement, and says so. The
     cohort could price the gap only because both sides were in the
     room; this had one side. The manager cannot take the second
     measurement by asking, because the asking travels the channel the
     gap is made of. That is the argument, and the conversation is the
     only thing that answers it. */

  var CLOSE_ONE = 'Every finding here came from one chair: yours. Nobody on this team was asked anything. The 70% above was not carelessness on those managers’ part. The things a team will not say in a one-to-one do not show up in anything a manager can see from the manager’s seat, and this report has spent its length listing them.';

  var CLOSE_WIDE = ' Your gap width above says how much of this team’s week never reaches you at all. Distance like that is exactly what the 70% is made of.';

  var CLOSE_TWO = 'You cannot ask your way across this gap, because the asking travels the same channel that produced it. A channel that filters bad news will filter the answer to a question about the filter. Closing it takes a measurement of the other side, taken by somebody the answers are not about.';

  var CLOSE_THREE = 'That is a conversation with Clive Hays, Clover ERA’s co-founder, who ran the 11-company study. Thirty minutes with this report on the table, your pattern next to the cohort’s manager-and-team pairs: which of these inferences held at those companies, and what the managers who closed the gap did in the first two weeks. You leave with a written plan of three specific actions built from your answers.';

  var CLOSE_FOUR = 'If the inferences here are wrong about your team, that is worth knowing. If they are right, it is worth knowing this month rather than the month it reaches the work.';

  function closingBlocks(result) {
    var wide = result.gapWidth.key === 'wide' || result.gapWidth.key === 'very_wide';
    return [CLOSE_ONE + (wide ? CLOSE_WIDE : ''), CLOSE_TWO, CLOSE_THREE, CLOSE_FOUR];
  }

  /* =========================================================
     THE PEOPLE IN THIS PICTURE

     The report measured one manager's recall and told them about it,
     which is accurate and cold. There were no humans in it.

     This section adds them as disciplined inference, never as
     measurement, under a contract every sentence has to satisfy:

       premise   something the manager answered, restated as fact.
                 True at any line of sight, because most of the fifteen
                 behaviours happen TO the manager: a thing nobody told
                 you is a thing nobody told you from any distance.
       pattern   what is usually true of teams in that position,
                 carrying its own quantifier. The quantifier is
                 load-bearing and is asserted, never apologised for.
       pointer   an invitation to work out who. The manager supplies
                 the name. The report never does.

     The test: every sentence must survive "how do you know?" with the
     answer "your own answers, plus what is generally true of teams in
     that position". Anything whose only answer is "we believe it" is cut.

     Hard rule for anyone editing this: the subject "your team" never
     takes a mental-state verb. "Your team has stopped telling you
     things" is unsupportable and must never appear. "News that routes
     around you was routed by somebody" states the manager's own answer
     and then a near-tautology with a person inside it.

     This lives outside score() because it needs the contact answers,
     which are not inputs to the instrument. score() is untouched, so
     the fingerprint cannot move.
     ========================================================= */

  var PEOPLE_INTRO = 'Everything above is about your picture. This is about the people it is a picture of. What follows is inference, not measurement: your own answers, put next to what is usually true of teams in the position they describe. The 70% above came from measuring both sides. This is the side you can see.';

  var PEOPLE_FRAME = {
    cruise: 'Cruise reads clean from your chair, and on your answers it is the right call. Hold one thing beside it: teams leave Cruise one person at a time, and the first person to leave it stays at their desk. The inferences below mark where, on your own evidence, that usually starts.',
    drift: 'Drift is the state where the numbers and the humans part company. Output is holding, so the numbers are not asking anyone any questions, while the behaviours that produce that output have stopped reaching you in the specific ways this assessment asked about. Todd Katz of MetLife put it plainly: “Retention alone can give employers a false sense of stability, even as wellbeing, engagement, and productivity quietly erode.” He was describing companies. It scales down to one team without losing anything.',
    headwinds: 'The evidence says the people on this team are still doing what healthy teams do, under an external force you named yourself. The human inference in Headwinds is about credit. Effort spent under weather that nobody names usually stops being spent before the weather clears. Teams in these conditions watch one thing most closely: whether their manager names the weather or names them. Read the inferences below in that light: where a channel has thinned here, the weather thinned it first.',
    stall: 'Stall is visible from every chair, including theirs. The people on this team have been living inside this decline for longer than the five minutes you have been measuring it, and they hold most of the map back out of it. Nobody hands that map to a manager unasked. The inferences below say where it usually sits.'
  };

  var PEOPLE_TENURE = 'You have led this team for less than three months. Most of what this report describes was set before you arrived, and the prices in it were set by somebody else’s reactions, not yours. That is the one advantage of being new: for a short window you can ask how things got this way and be answered as an outsider.';

  var WEAK_CHANNEL_WORD = { 3: 'Three', 4: 'Four', 5: 'All five' };
  var WEAK_CHANNEL = ' of your five channels have thinned at once. Channels thin together when they share a cause, and the shared cause is usually a price: somewhere along the way, the cost of bringing you things got set too high. Nobody sets that price deliberately. It gets set by what happened the last few times, and it is learned by watching.';

  var POSITION_CLOSE = 'You are with this team PHRASE, so these behaviours had room to happen where you could see them. What follows rests on things that stopped, not things you missed.';
  var POSITION_FAR = 'Distance does not weaken what follows. Most of what this asked about happens to you directly, and a thing nobody told you is a thing nobody told you from any distance. What distance sets is how few chances a week anyone gets.';

  /* one per evidence item, fired when that item scored 1 or 0 */
  var PEOPLE_UNITS = [
    { p1: 'More than a month has passed since anyone told you they were blocked before it cost them.',
      p0: 'You could not recall the last time anyone told you they were blocked before it cost them.',
      inf: 'Teams do not stop hitting blockers. They stop reporting them, usually after reporting one changed nothing, and they absorb them instead. Absorption looks exactly like capacity, right up until the month it stops.' },
    { p1: 'More than a month has passed since you saw anyone on this team ask a teammate for help.',
      p0: 'You could not recall the last time you saw anyone on this team ask a teammate for help.',
      inf: 'People do not run out of questions. They run out of reasons to ask where asking can be seen, and a team that asks only in private has already worked out what visible uncertainty costs here. They worked it out from evidence.' },
    { p1: 'More than a month has passed since you looked at a piece of this team’s actual work, past the summary.',
      p0: 'You could not recall the last time you looked at a piece of this team’s actual work, past the summary.',
      inf: 'The people making it can tell. Work that is never examined closely gets shaped to survive its summary, and the craft that does not summarise well is usually the first thing a person stops spending.' },
    { p1: 'More than a month has passed since anyone outside the team commented on its work unprompted.',
      p0: 'You could not recall unprompted comment on this team’s work from anyone outside it.',
      inf: 'Unprompted comment is how a team learns its work lands somewhere. In its absence the audience shrinks to whoever runs the next review, and people quietly resize their effort to the smallest audience that notices.' },
    { p1: 'More than a month has passed since anyone brought you an idea you did not ask for.',
      p0: 'You could not recall the last idea anyone brought you unasked.',
      inf: 'People rarely stop having ideas. They stop submitting them, at the point where what happened to the last one stops covering the cost of raising the next one. Somebody on this team probably still has the idea they never brought you.' },
    { p1: 'There is a person on this team you have not had an unhurried conversation with in over a month. You thought of them when you answered.',
      p0: 'There is a person on this team whose last unhurried conversation with you is beyond recall. You thought of them when you answered.',
      inf: 'They keep a closer count of that interval than you do. People read meaning into that count that nobody intended, and the meaning they usually settle on is a ranking.' },
    { p1: 'More than a month has passed since you heard anyone on this team put the current priority in their own words.',
      p0: 'You could not recall hearing anyone on this team put the current priority in their own words.',
      inf: 'A team that cannot say the priority still makes priority calls all day. They make them by guessing what you would want, and guesses of that kind run safe, which is how a capable team ends up doing its safest possible work.' },
    { p1: 'More than a month has passed since anyone pushed back on a piece of work as not worth doing.',
      p0: 'You could not recall the last time anyone pushed back on a piece of work as not worth doing.',
      inf: 'Every team carries work that somebody privately doubts. Where the doubt never surfaces, the doubt did not die. On a team where nothing gets challenged, somebody has usually already decided the challenge costs more than it returns, and they are still doing the work they doubt.' },
    { p1: 'More than a month has passed since anyone disagreed with you openly, in front of others.',
      p0: 'You could not recall the last time anyone disagreed with you openly, in front of others.',
      inf: 'On a team where open disagreement has stopped, somebody has usually already decided it is not worth it. They did not announce that decision, and what replaced the disagreement looks exactly like alignment.' },
    { p1: 'More than a month has passed since a problem reached you from the person involved rather than some other way.',
      p0: 'You could not recall a problem reaching you from the person involved rather than some other way.',
      inf: 'News that routes around you was routed by somebody. Somewhere between them and you sits a calculation about what bad news costs here, and on your own answers, the route around you is currently winning.' },
    { p1: 'The person on this team you are least sure about, the one the question made you picture, has not had a real conversation with you in over a month.',
      p0: 'The person on this team you are least sure about, the one the question made you picture, has had no real conversation with you inside anything you could recall.',
      inf: 'Whatever they have been concluding in that time, they concluded it without you in the room. A month is a long time inside a decision you are not part of.' },
    { p1: 'More than a month has passed since anything a team member said changed your mind.',
      p0: 'You could not recall the last time anything a team member said changed your mind.',
      inf: 'People keep a private ledger on whether speaking up here ever moves anything. When that ledger settles at no, nobody files a complaint. The input just stops arriving, and the room gets quieter in a way that reads, from your chair, as consensus.' },
    { p1: 'More than a month has passed since you cleared something out of the team’s way that somebody had raised.',
      p0: 'You could not recall the last thing you cleared that somebody had raised.',
      inf: 'Either nothing is being raised or what gets raised is not getting cleared, and from the team’s side those two teach the same lesson. What happened to the last raised thing sets the price of raising the next one, and teams reprice that faster than they reprice anything else.' },
    { p1: 'More than a month has passed since anyone walked you through how a piece of work was actually done.',
      p0: 'You could not recall anyone walking you through how a piece of work was actually done.',
      inf: 'The distance between how work looks in an update and how it was done is where the real effort sits. Effort that is never witnessed is usually the first spend a person cuts, and output coasts on the old effort for a while afterwards, which is why nothing looks different yet.' },
    { p1: 'More than a month has passed since you explained why the current priority is the priority, rather than what it is.',
      p0: 'You could not recall the last time you explained why the current priority is the priority, rather than what it is.',
      inf: 'Downstream of that silence, people do not stop working. They supply their own why or work without one, and work without a why gets done at the minimum the instructions will bear.' }
  ];

  var LEFT_OPENER = {
    one: 'One person has left this team in the last six months.',
    'two-three': 'Two or three people have left this team in the last six months.',
    'four-plus': 'Four or more people have left this team in the last six months.'
  };
  var LEFT_BODY = ' The people still here watched each departure, and each one taught a lesson about what leaving looks like from the inside. The fullest account anyone gives of what a team is like to work on is usually given on the way out, to somebody who is not the manager. That account exists. You have not heard it.';
  var LEFT_FOUR_PLUS = ' At this rate of departure, the ones who stayed have done their own arithmetic on staying, and MetLife’s 2026 study of 2,541 employees found 56% of the people staying in their jobs are staying out of necessity rather than choice.';

  var FULL_ROSTER = 'Nobody has left this team in six months, which reads as health from a distance. MetLife’s 2026 study of 2,541 employees found 56% of the people staying in their jobs are staying out of necessity rather than choice, and Korn Ferry has watched job hugging, people holding on to the job they already have, climb from 45% to 57% in six months. A full roster is a fact about the job market before it is a fact about this team. Presence is the one thing this kind of decline never takes.';

  var ENERGY_LOWER_HOLDING = 'You said the energy in the room is lower than three months ago, while output holds. Treat your own reading as data, since energy is the one thing on this list that cannot reach you second-hand. ActivTrak’s 2026 study of 163,638 employees found disengagement risk has overtaken burnout risk, and the two fail differently: burnout announces itself, detachment does not. Lower energy under steady output is what a team spending reserves looks like from the outside.';
  var ENERGY_LOWER_SLIPPED = 'You said the energy in the room is lower than three months ago. Treat your own reading as data, since energy is the one thing on this list that cannot reach you second-hand. ActivTrak’s 2026 study of 163,638 employees found disengagement risk has overtaken burnout risk, and the two fail differently: burnout announces itself, detachment does not. On your answers the slide has already reached the work, which means the energy moved first, some time ago.';
  var ENERGY_UNSURE = 'You answered honestly that you cannot say whether the energy has changed in three months. Anyone on this team can answer that in a sentence, without preparing. The answer exists and it is specific. It currently sits with people who have not been asked.';

  var JOINED_OPENER = {
    one: 'One person has joined this team in the last six months.',
    'two-three': 'Two or three people have joined this team in the last six months.',
    'four-plus': 'Four or more people have joined this team in the last six months.'
  };
  var JOINED_BODY = ' New arrivals work out what is sayable on a team inside their first weeks, by watching what happens to the people who say things, long before anyone explains anything. Whatever this report has inferred about the channels here, the newest person has already absorbed it as simply how things are.';

  var ALL_FRESH_HOLDING = 'On your own evidence, the discretionary things a team owes nobody are still being spent on you: the unasked idea and the open disagreement, both inside the last month. That is worth having in writing, since people remake that choice every week based on what it earned last week. Teams rarely leave Cruise with an announcement; the behaviours on this list are what goes first, one person at a time. You now hold a dated record of all fifteen, and the next time this assessment reads differently, the difference is your earliest warning.';
  var ALL_FRESH_SLIPPED = 'Everything on this list is still reaching you, inside a month, while the output falls. Take that seriously as a compliment paid under pressure: people who still bring you disagreement and early bad news while things slide have not written the situation off. Channels usually close from the outside in, and yours are open. What that buys you is time, and it is not a large amount.';

  /* which two items get a unit. Value first, so a "can't recall" anywhere
     beats an "over a month" anywhere and the sharpest premises surface.
     One unit per area, so a single area cannot supply both. */
  function selectUnits(result, evidence) {
    var areaRank = {};
    result.ranked.forEach(function (a, i) { areaRank[a.key] = i; });

    var areaOf = {};
    result.areas.forEach(function (a) {
      a.items.forEach(function (n, pos) { areaOf[n] = { key: a.key, pos: pos }; });
    });

    var candidates = [];
    for (var i = 0; i < evidence.length; i++) {
      if (evidence[i] <= 1) {
        var owner = areaOf[i + 1] || { key: '', pos: 0 };
        candidates.push({ n: i + 1, value: evidence[i], area: owner.key, pos: owner.pos });
      }
    }
    candidates.sort(function (x, y) {
      if (x.value !== y.value) return x.value - y.value;
      var rx = areaRank[x.area], ry = areaRank[y.area];
      if (rx !== ry) return rx - ry;
      return x.pos - y.pos;
    });

    var taken = {};
    var out = [];
    for (i = 0; i < candidates.length && out.length < 2; i++) {
      var c = candidates[i];
      if (taken[c.area]) continue;
      taken[c.area] = true;
      var unit = PEOPLE_UNITS[c.n - 1];
      out.push({ n: c.n, premise: c.value === 0 ? unit.p0 : unit.p1, inference: unit.inf });
    }
    return out;
  }

  /* at most one, in priority order. Departures first: it is the only
     situational fact with people already out of the door. */
  function situational(result, contact, holding) {
    var left = contact.left6m;
    var joined = contact.joined6m;

    if (left === 'one' || left === 'two-three' || left === 'four-plus') {
      return LEFT_OPENER[left] + LEFT_BODY + (left === 'four-plus' ? LEFT_FOUR_PLUS : '');
    }
    if (contact.energy === 'lower') {
      return holding ? ENERGY_LOWER_HOLDING : ENERGY_LOWER_SLIPPED;
    }
    if (contact.energy === 'unsure') return ENERGY_UNSURE;
    /* aimed at the manager whose numbers look fine, so it is gated to the
       two states where a full roster invites complacency */
    if (left === 'none' && (result.state.key === 'cruise' || result.state.key === 'drift')) {
      return FULL_ROSTER;
    }
    if (JOINED_OPENER[joined]) return JOINED_OPENER[joined] + JOINED_BODY;
    return null;
  }

  /* result: the object score() returned. contact: { left6m, joined6m,
     tenure, energy }. Returns the blocks to render, in order. */
  function peopleSection(result, contact, answers) {
    contact = contact || {};
    var evidence = (answers && answers.evidence) || [];
    var holding = result.state.key === 'cruise' || result.state.key === 'drift';

    var blocks = [PEOPLE_INTRO];

    if (result.staleCount === 0) {
      blocks.push(holding ? ALL_FRESH_HOLDING : ALL_FRESH_SLIPPED);
    } else {
      var frame = PEOPLE_FRAME[result.state.key];
      if (result.weakCount >= 3) {
        frame += ' ' + (WEAK_CHANNEL_WORD[result.weakCount] || 'Several') + WEAK_CHANNEL;
      }
      blocks.push(frame);
    }

    if (contact.tenure === 'under-3m') blocks.push(PEOPLE_TENURE);

    var units = result.staleCount === 0 ? [] : selectUnits(result, evidence);
    if (units.length) {
      blocks.push(result.closeUp
        ? POSITION_CLOSE.replace('PHRASE', EXPOSURE_PHRASE[result.exposure.value] || 'often')
        : POSITION_FAR);
    }

    var sit = situational(result, contact, holding);

    return { intro: blocks, units: units, situational: sit };
  }

  /* ---------- validation ---------- */

  function validAnswers(a) {
    if (!a || typeof a !== 'object') return false;

    if (!Array.isArray(a.evidence) || a.evidence.length !== EVIDENCE.length) return false;
    for (var i = 0; i < EVIDENCE.length; i++) {
      if (a.evidence[i] !== 0 && a.evidence[i] !== 1 && a.evidence[i] !== 2 && a.evidence[i] !== 3) return false;
    }

    if (!optionFor(GUT, a.gut)) return false;
    if (!optionFor(OUTPUT, a.output)) return false;
    if (!optionFor(EXTERNAL, a.external)) return false;
    if (!optionFor(ENERGY, a.energy)) return false;
    if (!optionFor(EXPOSURE, a.exposure)) return false;

    return true;
  }

  /* ---------- the fingerprint ----------
     FNV-1a over a canonical description of everything that affects
     comparability: item wording, the scale, area composition, the state
     severities, and the source of the decision tree itself. Two rows with
     different fingerprints were produced by different instruments and
     should not be pooled, whatever the version column says. */

  function fingerprint() {
    var parts = [];

    parts.push(GUT.text);
    GUT.options.forEach(function (o) { parts.push(o.value + ':' + o.severity); });

    SCALE.forEach(function (o) { parts.push(o.value + ':' + o.label); });
    EVIDENCE.forEach(function (t) { parts.push(t); });

    [OUTPUT, EXTERNAL, ENERGY, EXPOSURE].forEach(function (q) {
      parts.push(q.key + ':' + q.text);
      q.options.forEach(function (o) {
        parts.push(o.value + ':' + (o.holding === undefined ? '' : o.holding) +
                   ':' + (o.confidence || ''));
      });
    });

    AREAS.forEach(function (a) {
      parts.push(a.key + ':' + a.items.join(',') + ':' + a.tie);
    });
    parts.push('behaviour:' + BEHAVIOUR_ITEMS.join(','));

    Object.keys(STATES).forEach(function (k) {
      parts.push(k + ':' + STATES[k].severity.join(','));
    });

    /* the tree source with comments stripped and whitespace collapsed, so
       reformatting it does not read as a change but editing a threshold does */
    parts.push(String(decideState)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\r\n]*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim());

    var str = parts.join('|~|');
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  var FINGERPRINT = fingerprint();

  return {
    VERSION: VERSION,
    FINGERPRINT: FINGERPRINT,
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
    ACTIONS: ACTIONS,
    CONFIDENCE: CONFIDENCE,
    SIGNAL_FRAMING: SIGNAL_FRAMING,
    LINE_OF_SIGHT: LINE_OF_SIGHT,
    GAP_BANDS: GAP_BANDS,
    GAP_FRAMING: GAP_FRAMING,
    lineOfSightFor: lineOfSightFor,
    gapWidthFor: gapWidthFor,
    score: score,
    peopleSection: peopleSection,
    closingBlocks: closingBlocks,
    labelFor: labelFor,
    lower: lower,
    validAnswers: validAnswers
  };
}));
