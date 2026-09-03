/* =============================================================
   eran.js  ·  the numbers  ->  the words

   Eran reads the computed numbers and the manager's own answers and
   writes the report. It does no arithmetic and makes no structural
   decision: every number on the page was decided before this file ran.

   The eight rules in section 4 are stated to Eran in the prompt AND
   enforced here on the way back, because a rule that is only asked for
   is a rule that eventually gets broken on somebody's live reading.

   Spec sections 3 and 4.
   ============================================================= */

var Anthropic = require('@anthropic-ai/sdk');
var LIBRARY = require('./library.json');

var MODEL = process.env.ERAN_MODEL || 'claude-opus-5';

/* ---------- the worksheet library ----------
   The 56 worksheets are the methodology, and the next move is the one
   place on the page where handing the manager a real one beats handing
   them a good sentence. Eran picks one in a first, small call, and the
   chosen worksheet's full text is in front of it while it writes the
   second. The page then links that worksheet's PDF.

   Where the line sits: the worksheet supplies the MOVE. It never
   supplies the ARGUMENT. Rule 1 is unchanged, and the worksheets are
   full of neuroscience claims and outside research that must not reach
   the report, because the reading argues from this manager's answers
   and nothing else. */

var BY_ID = {};
LIBRARY.worksheets.forEach(function (w) { BY_ID[w.id] = w; });
var IDS = LIBRARY.worksheets.map(function (w) { return w.id; });

function catalogue() {
  return LIBRARY.worksheets.map(function (w) {
    return w.id + ' | ' + w.title + ' | ' + w.pillar + ' | level ' +
      w.difficulty + '\n    for: ' + w.forWhat;
  }).join('\n');
}

function worksheetOf(id) { return BY_ID[id] || null; }

/* ---------- the contract ----------
   Section 3, as a schema. Every key required, no extras.

   The schema cannot express a word budget, so each field carries the
   budget twice: as a description Eran reads, and as a character ceiling
   close enough to the word count to bind while it writes. Left loose at
   twelve characters a word, every budget in the object overran and every
   reading cost a full retry. Just under six plus a little headroom is
   about where written English sits, and it moves the budget from
   something checked afterwards to something true on the first pass. */

function words(max) {
  return {
    type: 'string',
    description: 'At most ' + max + ' words. This is a hard budget.',
    maxLength: Math.ceil(max * 5.9) + 4
  };
}

var READOUT = {
  type: 'object',
  properties: { asks: words(20), means: words(45) },
  required: ['asks', 'means'],
  additionalProperties: false
};

var DIAL = function (labelWords) {
  return {
    type: 'object',
    properties: {
      label: words(labelWords),
      min: { type: 'integer', description: 'The lowest setting. At least 1.' },
      max: { type: 'integer', description: 'The highest setting. Above min, and no more than 60 steps above it.' },
      'default': { type: 'integer', description: 'Where the stepper starts. Between min and max.' }
    },
    required: ['label', 'min', 'max', 'default'],
    additionalProperties: false
  };
};

var AREA_KEYS = ['readiness', 'results', 'involvement', 'direction', 'alignment'];

var SCHEMA = {
  type: 'object',
  properties: {
    /* Which ring the page leads on. The instrument supplies its
       weakest-first ranking as an input and this is the judgement made
       on top of it. focus_why is never rendered: it goes in the
       transcript Clive reads, so a strange pick is visible rather than
       mysterious. */
    focus: { type: 'string', enum: AREA_KEYS,
      description: 'The area the page leads on.' },
    focus_why: words(20),
    headline: words(6),
    sub: words(18),
    readouts: {
      type: 'object',
      properties: {
        readiness: READOUT, results: READOUT, involvement: READOUT,
        direction: READOUT, alignment: READOUT
      },
      required: ['readiness', 'results', 'involvement', 'direction', 'alignment'],
      additionalProperties: false
    },
    cost: {
      type: 'object',
      properties: {
        headline: words(10),
        dial_a: DIAL(12),
        dial_b: DIAL(14),
        caption: words(14),
        close: words(70)
      },
      required: ['headline', 'dial_a', 'dial_b', 'caption', 'close'],
      additionalProperties: false
    },
    /* Structured outputs takes neither a minItems above 1 nor a maxItems,
       so the count of four is asked for in the prompt and enforced in
       check() instead, which is where a retry can act on it. */
    changes: { type: 'array', items: words(12) },
    receipt: words(45),
    next_move: {
      type: 'object',
      properties: {
        action: words(90),
        question: words(25),
        /* why this worksheet, for this manager, in their own terms.
           Never a description of what the worksheet contains. */
        worksheet_why: words(20)
      },
      required: ['action', 'question', 'worksheet_why'],
      additionalProperties: false
    },
    state_note: words(60),
    sight_note: words(70)
  },
  required: ['focus', 'focus_why', 'headline', 'sub', 'readouts', 'cost',
    'changes', 'receipt', 'next_move', 'state_note', 'sight_note'],
  additionalProperties: false
};

/* ---------- budgets ----------
   Hard. The page works because it is short. */

var BUDGETS = [
  ['focus_why', 20],
  ['headline', 6], ['sub', 18],
  ['readouts.readiness.asks', 20], ['readouts.readiness.means', 45],
  ['readouts.results.asks', 20], ['readouts.results.means', 45],
  ['readouts.involvement.asks', 20], ['readouts.involvement.means', 45],
  ['readouts.direction.asks', 20], ['readouts.direction.means', 45],
  ['readouts.alignment.asks', 20], ['readouts.alignment.means', 45],
  ['cost.headline', 10], ['cost.dial_a.label', 12], ['cost.dial_b.label', 14],
  ['cost.caption', 14], ['cost.close', 70],
  ['changes.0', 12], ['changes.1', 12], ['changes.2', 12], ['changes.3', 12],
  ['receipt', 45],
  ['next_move.action', 90], ['next_move.question', 25],
  ['next_move.worksheet_why', 20],
  ['state_note', 60], ['sight_note', 70]
];

/* the sections the page can drop independently. A budget break or a rule
   break inside one removes that section and nothing else. */
/* focus is not in this list on purpose. Every other section can be
   dropped and the page still renders; a missing focus would leave the
   readout with no ring selected, so it falls back to the ranking
   instead of being removed. */
var SECTIONS = ['headline', 'sub', 'readouts', 'cost', 'changes', 'receipt',
  'next_move', 'state_note', 'sight_note'];

/* ---------- rule enforcement ----------
   Rules 1, 2, 3 and 7, as far as a regular expression can carry them.
   Rules 4, 5, 6 and 8 live in the prompt and in review. */

var RULES = [
  [/[—–]/, 'an em dash or en dash. Rule 7 bans them. Use a comma, a period or parentheses.'],
  [/\bcohorts?\b/i, 'the word cohort. Rule 1: the argument stands on this manager own answers.'],
  [/\b(MetLife|Korn Ferry|Gallup|McKinsey|ActivTrak|Aflac|Bain|Deloitte|Harvard|Forrester)\b/i, 'a named outside source. Rule 1 bans borrowed evidence.'],
  [/\d+\s?(%|per ?cent)/i, 'a percentage. Rule 1: no statistic that is not in the payload.'],
  [/\b(thin|uncertain|tentative|approximate|confidence|limited|best guess)\b/i, 'a word that discounts the reading. Rule 3: old evidence widens the gap, it never softens the finding.'],
  [/\b(engagement|talent|transform|unlock|elevate|seamless|robust)\b/i, 'a banned word from rule 7.'],
  [/\byour people\b/i, 'the phrase "your people". Rule 7 bans it. Use "your team".'],
  [/\b(AI[- ]powered|data[- ]driven|the future of work)\b/i, 'a banned phrase from rule 7.'],
  [/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i, 'a day of the week. No day of the week appears anywhere on the page.'],
  [/(^|[.!?]\s+|\n)\s*(And|Because)\b/, 'a sentence opening with And or Because. Rule 7.'],
  /* Rule 2 is about predicting that a person leaves or that output falls.
     Unqualified, it also fires on "I will leave it there" and "I will
     stop there", which are how a reply ends when it has decided not to
     push. So the speaker cannot be the writer, and the verb cannot be
     taking an object. */
  [/(?<!\bI )\bwill (leave|quit|resign|go|fall|drop|decline|worsen|get worse|slip|stop)\b(?!\s+(it|that|this|there|here))/i,
    'a prediction. Rule 2: state consequence in the present tense, as something already happening.'],
  [/\b(is|are) (going to|likely to)\b/i, 'a prediction. Rule 2.'],
  [/^\s*[-*•]\s/m, 'a bullet. Rule 7.'],
  /* Nouns for things this product does not have. The worksheets are
     written as facilitated sessions and two of them are titled one, so
     this vocabulary is always in front of the writer. It reached the
     page, and then the conversation, and a manager asked what session.
     There is no session. There is a worksheet.
     exercise and call are scoped to the noun: "your call" is a
     decision and "call it what you like" is a verb. */
  [/\b(sessions?|workshops?|programmes?|modules?)\b|(?<!\bof )\bcourses?\b/i,
    'a name for something this product does not have. There is a reading, a worksheet, one question a day and a trial. Nothing else has a name.'],
  [/\b(an?|another|the) exercise\b/i,
    'an exercise. The manager has a worksheet, not an exercise.'],
  /* "a call" as a thing, not "your call" as a decision. A manager's own
     video call is theirs rather than ours, but the spec is explicit
     that the word does not appear, and there is a way to say it:
     everyone at the same time, wherever they are. */
  [/\ba call\b(?! (to make|on\b))/i,
    'a call. There is no call in this product. Say everyone at the same time, wherever they are.']
];

function countWords(s) {
  var t = String(s === undefined || s === null ? '' : s).trim();
  return t ? t.split(/\s+/).length : 0;
}

function at(obj, path) {
  return path.split('.').reduce(function (o, k) {
    return (o === undefined || o === null) ? o : o[k];
  }, obj);
}

function sectionOf(path) { return path.split('.')[0]; }

/* every string in the returned object, with its path */
function strings(node, path, out) {
  out = out || [];
  if (typeof node === 'string') { out.push([path, node]); return out; }
  if (Array.isArray(node)) {
    node.forEach(function (v, i) { strings(v, path ? path + '.' + i : String(i), out); });
    return out;
  }
  if (node && typeof node === 'object') {
    Object.keys(node).forEach(function (k) {
      strings(node[k], path ? path + '.' + k : k, out);
    });
  }
  return out;
}

/* Every way this draft falls short, as a list the retry can act on.
   An empty list is a clean pass. */
function check(json) {
  var faults = [];
  function fault(path, why) {
    faults.push({ section: sectionOf(path), path: path, why: why });
  }

  if (!json || typeof json !== 'object') {
    return [{ section: 'all', path: 'all', why: 'is not an object.' }];
  }

  /* the focus has to be one of the five, and it has to be argued for */
  if (AREA_KEYS.indexOf(json.focus) === -1) {
    fault('focus', 'is not one of the five areas.');
  }
  if (typeof json.focus_why !== 'string' || !json.focus_why.trim()) {
    fault('focus_why', 'is missing. Every pick carries its reason.');
  }

  /* shape */
  SECTIONS.forEach(function (k) {
    if (json[k] === undefined || json[k] === null) fault(k, 'the key is missing.');
  });
  if (json.changes !== undefined &&
      (!Array.isArray(json.changes) || json.changes.length !== 4)) {
    fault('changes', 'must be exactly four lines.');
  }
  ['readiness', 'results', 'involvement', 'direction', 'alignment'].forEach(function (k) {
    if (json.readouts === undefined) return;
    var r = json.readouts && json.readouts[k];
    if (!r || typeof r.asks !== 'string' || typeof r.means !== 'string') {
      fault('readouts', 'the ' + k + ' readout is missing asks or means.');
    }
  });

  /* the dials have to be usable as steppers, and multiply into something
     a manager would recognise as their own week */
  ['dial_a', 'dial_b'].forEach(function (k) {
    if (json.cost === undefined) return;
    var d = json.cost && json.cost[k];
    if (!d) { fault('cost', k + ' is missing.'); return; }
    var whole = [d.min, d.max, d['default']].every(function (n) {
      return typeof n === 'number' && isFinite(n) && Math.floor(n) === n;
    });
    if (!whole) {
      fault('cost', k + ': min, max and default must all be whole numbers.');
    } else if (!(d.min >= 1 && d.min < d.max && d['default'] >= d.min && d['default'] <= d.max)) {
      fault('cost', k + ': needs 1 <= min < max, with default inside that range.');
    } else if (d.max - d.min > 60) {
      fault('cost', k + ': the range is too wide to set on a phone. Keep it under 60 steps.');
    }
  });

  /* budgets */
  BUDGETS.forEach(function (b) {
    var v = at(json, b[0]);
    if (typeof v !== 'string') return;
    var n = countWords(v);
    if (n > b[1]) {
      fault(b[0], 'is ' + n + ' words. The budget is ' + b[1] + '. Budgets are hard.');
    }
  });

  /* the fold: rings, chip, headline and sub, under forty words total */
  var fold = countWords(json.headline) + countWords(json.sub);
  if (fold > 34) {
    fault('sub', 'headline and sub come to ' + fold +
      ' words together. They share the fold and must stay well under forty.');
  }

  /* rules */
  strings(json, '').forEach(function (pair) {
    RULES.forEach(function (r) {
      if (r[0].test(pair[1])) fault(pair[0], 'contains ' + r[1]);
    });
  });

  return faults;
}

/* ---------- the prompt ---------- */

var SYSTEM = [
  'You are Eran. You write one manager their reading of their own team.',
  '',
  'The numbers are computed before you see them. You do no arithmetic and',
  'you make no structural decision. You write the words.',
  '',
  'EIGHT RULES. They are the whole editorial standard.',
  '',
  '1. No borrowed evidence. No cohort, no survey, no named research house,',
  '   no percentage, no statistic that is not in the payload you are given.',
  '   The argument stands on this manager own answers and nothing else.',
  '   You reason about the numbers freely and print only the ones the',
  '   instrument computed. Never state a figure you were not given.',
  '2. No prediction. Never that someone will leave, that output will fall,',
  '   or that things will get worse. State consequence in the present tense,',
  '   as something already happening.',
  '3. No hedging the reading. Old evidence widens the gap, it never discounts',
  '   the finding. Never write: thin, uncertain, tentative, approximate,',
  '   confidence, limited, best guess.',
  '4. No claims about individuals. Never say what a person on the team',
  '   thinks, feels or intends.',
  '5. The manager is the subject. Every section answers what this means for',
  '   them. The health of the team is the evidence, not the topic.',
  '6. Every state gets a reason the reading matters, and it is a different',
  '   reason in each. Cruise: nothing needs fixing, which is the only time',
  '   a clean baseline can be taken, and teams do not leave Cruise with an',
  '   announcement. Drift: caught while it is still cheap, output holding,',
  '   nothing to explain upward yet. Headwinds: they need the team own',
  '   account of what the weather is doing to them, and evidence to take',
  '   upward. Stall: it cannot be fixed from their side of it, and they',
  '   want it short. Never invent a problem to justify any of them.',
  '7. Voice. Short sentences. Direct peer tone. No em dashes and no en',
  '   dashes. No bullets. Banned words: engagement, your people, talent,',
  '   transform, unlock, elevate, seamless, robust, AI-powered, data-driven,',
  '   the future of work. No sentence opens with And or Because. No day of',
  '   the week anywhere.',
  '8. Budgets are hard. The page works because it is short. A section that',
  '   runs over budget is dropped from the page, so the manager gets nothing',
  '   there rather than something long. Count your words.',
  '',
  'WHAT EACH FIELD IS',
  '',
  'focus is which of the five rings the page leads on, and the choice is',
  'yours. You are given the ranking, weakest first, and it is often the',
  'right answer. It is not always. A Direction ring that is dark while',
  'Alignment is merely stale can still have Alignment as the live problem,',
  'because what a manager can move is not always what scored lowest. Read',
  'the fifteen answers and decide.',
  '',
  'focus_why is one line saying why this one rather than the mechanical',
  'pick. The manager never sees it. Clive does, so an unusual choice is',
  'visible rather than mysterious. If you agreed with the ranking, say',
  'that plainly rather than inventing a reason to differ.',
  '',
  'headline and sub sit above the fold with five rings and a state chip.',
  'All of it together stays under forty words, so headline and sub are the',
  'shortest things you write. Say what this reading found. Do not summarise',
  'the rest of the page.',
  '',
  'Each readout is one area. asks is what that area asks of the manager,',
  'in the second person. means is what their own answers in that area mean',
  'for them now. Write all five, including the ones that came out well.',
  '',
  'cost is a small calculator the manager sets themselves. dial_a and dial_b',
  'are whole-number steppers, and their labels say what each one counts. The',
  'page multiplies dial_a by dial_b by five and shows a weekly number, so',
  'the two dials must be quantities that multiply into something weekly and',
  'true, and the five is the days in a working week. Set min, max and',
  'default to the range a real manager would move through. caption says what',
  'the weekly number represents. close is why that number is worth removing.',
  '',
  'changes is four single lines. Each is something that would be different',
  'in the manager own week. Not the week of the team. Theirs.',
  '',
  'receipt sits under two counters, the conditions still reading and the',
  'conditions gone quiet. It is the honest statement of what this reading',
  'is and what it is worth.',
  '',
  'next_move is the one action they take next, and the one question to ask.',
  'The question is a real sentence they could say out loud. A worksheet',
  'from the methodology library has been chosen for this reading and its',
  'full text is below. The action is the first move out of that worksheet,',
  'sized to what this manager can do next, in your words rather than its',
  'own. worksheet_why says why this one suits them, in terms of their own',
  'answers. It never describes what the worksheet contains.',
  '',
  'The worksheet supplies the move. It never supplies the argument. It is',
  'full of research and neuroscience, and none of that reaches the report:',
  'rule 1 stands, and the reading argues from this manager answers alone.',
  'Do not name the worksheet, quote it, or mention that one exists. The',
  'page links it separately.',
  '',
  'state_note explains what their state means. sight_note explains their',
  'line of sight and gap width together.',
  '',
  'Return the JSON object and nothing else.'
].join('\n');

var LABELS = {
  improved: 'improved', held: 'held steady',
  slipped_slightly: 'slipped slightly', slipped_noticeably: 'slipped noticeably',
  yes: 'yes, clearly', possibly: 'possibly', no: 'no',
  higher: 'higher', same: 'about the same', lower: 'lower',
  unsure: 'they could not say',
  most_days: 'most days', few_times: 'a few times a week',
  weekly: 'about weekly', less_weekly: 'less than weekly'
};
function label(v) { return LABELS[v] || String(v); }

function brief(numbers, answers) {
  var L = [];
  L.push('THE COMPUTED NUMBERS. These are settled. Do not restate them as');
  L.push('arithmetic and do not contradict them.');
  L.push('');
  L.push('State: ' + numbers.state_name);
  L.push('Signal: ' + numbers.signal.score + ' out of ' + numbers.signal.max);
  L.push('Line of sight: ' + numbers.line_of_sight_label);
  L.push('Gap width: ' + numbers.gap_width_label);
  L.push('Conditions still reading: ' + numbers.reading_count + ' of 15');
  L.push('Conditions gone quiet: ' + numbers.quiet_count + ' of 15');
  L.push('Ranking, weakest first: ' + numbers.ranking.join(', '));
  L.push('That ordering is an input, not the answer. You choose the focus.');
  L.push('');
  L.push('THE FIVE AREAS. Each asked three things. The recency on each line');
  L.push('is what this manager answered.');
  numbers.areas.forEach(function (a) {
    L.push('');
    L.push(a.dimension + ' (' + a.plain + '): ' + a.fresh + ' reaching you, ' +
      a.stale + ' gone quiet, ' + a.dark + ' not recalled' +
      (a.key === numbers.ranking[0] ? '   <- weakest by the ranking' : ''));
    a.items.forEach(function (it) {
      L.push('  [' + it.label + '] ' + it.question);
    });
  });
  L.push('');
  L.push('CONTEXT THE MANAGER ALSO GAVE');
  L.push('Output over the past month: ' + label(answers.output));
  L.push('Something outside the team working against it: ' + label(answers.external));
  L.push('Energy against three months ago: ' + label(answers.energy));
  L.push('Direct working contact in a typical week: ' + label(answers.exposure));
  L.push('');
  L.push('Write their reading.');
  return L.join('\n');
}

/* ---------- choosing the worksheet ----------
   A small first call. The catalogue is 56 lines and the answer is one
   id, so it costs a few seconds and it keeps the writing call from
   having to hold the whole library in front of it. */

var PICK_SYSTEM = [
  'You choose one worksheet from a methodology library for one manager,',
  'from what their own answers show.',
  '',
  'The focus area is where their evidence is thinnest on the ground, and',
  'the worksheet should serve it. Weigh what they actually answered, not',
  'only the area name. A manager who is present most days and still hears',
  'nothing needs a different move from one who is rarely there.',
  '',
  'Match the difficulty to the state. A team in Cruise can take a level 3.',
  'A team in Stall needs the smallest move that works.',
  '',
  'Return the id and nothing else.'
].join('\n');

var PICK_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', enum: IDS, description: 'The worksheet id.' }
  },
  required: ['id'],
  additionalProperties: false
};

async function pick(client, numbers, answers) {
  var res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: 'text', text: PICK_SYSTEM + '\n\nTHE LIBRARY\n\n' + catalogue(),
      cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: PICK_SCHEMA } },
    messages: [{ role: 'user', content: brief(numbers, answers) }]
  });
  var text = '';
  (res.content || []).forEach(function (b) { if (b.type === 'text') text += b.text; });
  var id = JSON.parse(text).id;
  return worksheetOf(id);
}

/* ---------- the call ---------- */

async function ask(client, messages, sheet) {
  var system = [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }];
  system.push(sheet ? {
    type: 'text',
    text: 'THE WORKSHEET CHOSEN FOR THIS READING\n\n' + sheet.body
  } : {
    /* the choice did not come back. Write the reading anyway: a missing
       worksheet costs the page one link, and no reading costs a lead. */
    type: 'text',
    text: 'No worksheet was available for this reading. Write the action ' +
      'from the manager answers alone, and make worksheet_why a single ' +
      'plain sentence about where their attention belongs.'
  });
  var res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: system,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: messages
  });
  var text = '';
  (res.content || []).forEach(function (b) { if (b.type === 'text') text += b.text; });
  return JSON.parse(text);
}

/* Eran JSON with any section that broke a rule or a budget removed, or
   null if nothing survived. Never throws. A submission is a lead, and no
   page and no email may depend on this returning. */
async function write(numbers, answers) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('MGI: ANTHROPIC_API_KEY not set, the report renders without Eran');
    return null;
  }

  var client = new Anthropic();
  var messages = [{ role: 'user', content: brief(numbers, answers) }];
  var json = null;
  var faults = null;

  /* the worksheet first, so the writing call has it in front of it.
     If the choice fails, the reading is still written; it just goes out
     without a worksheet rather than not at all. */
  var sheet = null;
  try {
    sheet = await pick(client, numbers, answers);
  } catch (e) {
    console.error('MGI: worksheet choice failed: ' + e.message);
  }

  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      json = await ask(client, messages, sheet);
    } catch (e) {
      console.error('MGI: Eran attempt ' + (attempt + 1) + ' failed: ' + e.message);
      json = null;
      continue;
    }
    faults = check(json);
    if (!faults.length) return stamp(json, sheet);

    console.error('MGI: Eran attempt ' + (attempt + 1) + ' returned ' +
      faults.length + ' fault(s)');

    if (attempt === 0) {
      messages = messages.concat([
        { role: 'assistant', content: JSON.stringify(json) },
        {
          role: 'user',
          content: 'That draft breaks the standard in the places listed below. ' +
            'Return the whole object again with every one of them fixed and ' +
            'nothing else changed.\n\n' +
            faults.map(function (f) { return f.path + ': ' + f.why; }).join('\n')
        }
      ]);
    }
  }

  /* Second failure. Drop only the offending sections. The page renders
     with them absent rather than with placeholder text. */
  if (!json || !faults) return null;
  var dropped = {};
  faults.forEach(function (f) { dropped[f.section] = true; });
  Object.keys(dropped).forEach(function (k) {
    console.error('MGI: Eran section dropped: ' + k);
    delete json[k];
  });
  var kept = SECTIONS.filter(function (k) { return json[k] !== undefined; });
  return kept.length ? stamp(json, sheet) : null;
}

/* Which worksheet the page should link, recorded next to the words that
   were written from it. Only the id and title: the body is 12,000 words
   and lives in the bundle, and the page never renders it. If the next
   move was dropped there is nothing for the link to sit under. */
function stamp(json, sheet) {
  if (sheet && json && json.next_move) {
    json.next_move.worksheet = { id: sheet.id, title: sheet.title };
  }
  return json;
}

module.exports = {
  write: write,
  check: check,
  countWords: countWords,
  brief: brief,
  SCHEMA: SCHEMA,
  SYSTEM: SYSTEM,
  SECTIONS: SECTIONS,
  BUDGETS: BUDGETS,
  RULES: RULES,
  MODEL: MODEL
};
