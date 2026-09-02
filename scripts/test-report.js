/* =============================================================
   The section 7 checks, as a test.

     node scripts/test-report.js

   Renders every shape of reading the instrument can produce, twice:
   once with an Eran draft in place, and once with Eran having failed
   entirely. Both have to come out as a complete page.

   No model call. The Eran draft here is a fixed stand-in used only to
   prove the page renders and the greps hold; the words on a real
   reading are always Eran's.
   ============================================================= */

var numbersOf = require('../report/numbers.js');
var eran = require('../report/eran.js');
var page = require('../report/page.js');
var mail = require('../report/email.js');

var fail = 0, pass = 0;
function ok(m) { pass++; console.log('  ok    ' + m); }
function bad(m) { fail++; console.log('  FAIL  ' + m); }

/* ---------- the readings to render ---------- */

function ans(evidence, extra) {
  return Object.assign({
    gut: 'fine', evidence: evidence,
    output: 'held', external: 'no', energy: 'same', exposure: 'few_times'
  }, extra || {});
}
function all(v) { return Array.from({ length: 15 }, function () { return v; }); }

var CASES = [
  ['cruise, everything fresh', ans(all(3))],
  ['stall, nothing recalled', ans(all(0), { output: 'slipped_noticeably', energy: 'lower' })],
  ['drift, output holding', ans(all(1), { output: 'held', external: 'no' })],
  ['headwinds, external cause', ans(all(2), { output: 'slipped_slightly', external: 'yes' })],
  ['mixed, minimal line of sight', ans([3, 0, 2, 1, 3, 0, 1, 2, 0, 3, 1, 0, 2, 1, 3], { exposure: 'less_weekly' })],
  ['flat middle, most days', ans(all(2), { exposure: 'most_days' })],
  ['one fresh each', ans([3, 1, 0, 3, 1, 0, 3, 1, 0, 3, 1, 0, 3, 1, 0])]
];

/* A stand-in draft, inside every budget and clean under every rule.
   It is checked against eran.check below, so a rule that this file
   breaks is a rule the test itself has to fix. */
function draft() {
  var readout = {
    asks: 'Whether this reaches you without anyone deciding to send it.',
    means: 'What you have here is what you saw yourself. The rest of it sits outside where you are placed to look, so it arrives when someone chooses to carry it.'
  };
  return {
    headline: 'Most of this reached you',
    sub: 'Two areas are running on what you remember rather than what you watched.',
    readouts: {
      readiness: readout, results: readout, involvement: readout,
      direction: readout, alignment: readout
    },
    cost: {
      headline: 'What the quiet areas cost you weekly',
      dial_a: { label: 'People on your team', min: 2, max: 40, 'default': 6 },
      dial_b: { label: 'Hours a day each spends working around something', min: 1, max: 20, 'default': 5 },
      caption: 'hours a week spent getting to the work',
      close: 'That number is not lost in the abstract. It was last week, it is this week, and the people spending it have stopped raising it, so it does not appear anywhere you would look for it.'
    },
    changes: [
      'The same blocker stops arriving in three conversations.',
      'You hear the problem from the person holding it.',
      'Estimates start meaning something again.',
      'You spend less of the week unblocking.'
    ],
    receipt: 'You answered fifteen questions about what you have actually seen. The count above is what that produced. It is your own observation, put in one place, which is more than most managers ever get.',
    next_move: {
      action: 'Take the area with the least reaching you and spend thirty minutes inside one live piece of work with the person doing it. Not a status conversation, the actual work. What you learn that was not in any update is the size of the distance.',
      question: 'What are you working around right now that you have stopped raising?'
    },
    state_note: 'Output is holding and the behaviours that produce it are visible around you. This is the state to return to, not one to sit in.',
    sight_note: 'You see the scheduled parts of the week. What happens between those points reaches you only if somebody passes it on, so your reading rests on position as much as on attention.'
  };
}

/* ---------- section 7 ---------- */

/* Word boundaries, not substrings: "nothing" and "within" are not the
   word this rule is about. */
var GREP = [
  [/\bcohorts?\b/i, 'cohort'],
  [/70\s?%/, '70%'],
  [/\beleven\b/i, 'eleven'],
  [/\bMetLife\b/i, 'MetLife'],
  [/\bKorn Ferry\b/i, 'Korn Ferry'],
  [/\bThursday\b/i, 'Thursday'],
  [/\bthin\b/i, 'thin'],
  [/\bconfidence\b/i, 'confidence'],
  [/\buncertain\b/i, 'uncertain'],
  [/\b(Monday|Tuesday|Wednesday|Friday|Saturday|Sunday)\b/i, 'a day of the week'],
  [/—/, 'an em dash'],
  [/#B03A2E|\bred\b/i, 'red']
];

/* The prose above the fold: the state chip, the headline and the sub.

   The five ring labels are not counted. They are the fixed area names
   from section 2 and come to twenty words on their own, which with the
   chip and the ring counts would leave fourteen for a headline and a sub
   whose own budgets in section 3 add up to twenty-four. Counting them
   would make the two sections contradict each other, so the forty is
   read as the prose the manager reads, and the labels are checked
   separately below. */
function foldWords(html) {
  var text = '';
  ['chip-label', 'headline', 'sub'].forEach(function (cls) {
    var m = html.match(new RegExp('class="' + cls + '"[^>]*>([\\s\\S]*?)<'));
    if (m) text += ' ' + m[1];
  });
  text = text.replace(/\s+/g, ' ').trim();
  return text ? text.split(' ').length : 0;
}

var RING_NAMES = ['How equipped the team is', 'The work itself',
  'How invested people are', 'Whether everyone knows why',
  'Whether truth travels up'];

console.log('\nThe stand-in draft, against the eight rules');
var faults = eran.check(draft());
if (faults.length) {
  faults.forEach(function (f) { bad(f.path + ': ' + f.why); });
} else {
  ok('clean under every rule and every budget');
}

CASES.forEach(function (c) {
  var name = c[0], answers = c[1];
  var n = numbersOf.compute(answers, { email: 'test@example.com', firstName: 'Test' },
    { generated_at: '2026-09-02' });

  [['with Eran', draft()], ['Eran failed entirely', null]].forEach(function (mode) {
    var label = name + ' (' + mode[0] + ')';
    n.eran = mode[1];
    var html;
    try {
      html = page.render(n);
    } catch (e) {
      bad(label + ': render threw ' + e.message);
      return;
    }

    console.log('\n' + label);

    /* a complete page, either way */
    if (html.indexOf('</html>') === -1) bad('the document does not close');
    else ok('renders a complete document');

    /* all five rings, and all five open a distinct readout */
    var ringCount = (html.match(/class="ring"/g) || []).length;
    if (ringCount !== 5) bad('has ' + ringCount + ' rings, expected 5');
    else ok('five rings');

    var order = (html.match(/class="ring-name">([^<]*)</g) || [])
      .map(function (s) { return s.replace(/.*>/, '').replace(/</, ''); });
    if (order.join('|') !== RING_NAMES.join('|')) {
      bad('the ring order is ' + order.join(', '));
    } else ok('the five plain names, left to right, in the fixed order');

    if (/\b(Readiness|Results|Involvement|Direction|Alignment)\b/.test(
        (html.match(/<div class="rings"[\s\S]*?<\/div>\s*<h1/) || [''])[0])) {
      bad('a RRIDA word appears on a ring');
    }

    if (mode[1]) {
      var panels = (html.match(/class="panel"/g) || []).length;
      if (panels !== 5) bad('has ' + panels + ' readout panels, expected 5');
      else ok('five distinct readouts');

      var status = (html.match(/class="status mono"/g) || []).length;
      if (status !== 5) bad('has ' + status + ' status lines, expected 5');
      else ok('every readout carries its computed status line');

      if (html.indexOf('id="weekly"') === -1) bad('the cost number is missing');
      else if (html.indexOf('id="dial-a"') === -1 || html.indexOf('id="dial-b"') === -1) {
        bad('a dial is missing');
      } else ok('the cost number and both dials are present');
    } else {
      if (html.indexOf('class="panel"') !== -1) bad('a readout rendered with no Eran');
      else if (html.indexOf('id="weekly"') !== -1) bad('the cost rendered with no Eran');
      else ok('the Eran sections are absent, not placeholdered');

      if (html.indexOf('conditions still reading') === -1) {
        bad('the computed counters are missing');
      } else ok('the computed counters still render');
    }

    /* the counters are computed, always */
    if (html.indexOf('conditions gone quiet') === -1) bad('the receipt counters are missing');

    /* above the fold: under forty words */
    var fw = foldWords(html);
    if (fw >= 40) bad('the fold is ' + fw + ' words, the budget is under 40');
    else ok('the fold is ' + fw + ' words');

    /* no paragraph above the fold beyond the sub */
    var foldBlock = (html.match(/<div class="fold-top">[\s\S]*?(?=<section|<\/main>)/) || [''])[0];
    var paras = (foldBlock.match(/<p[ >]/g) || []).length;
    var allowed = mode[1] ? 2 : 1;   /* the chip, and the sub if Eran wrote one */
    if (paras > allowed) bad('the fold holds ' + paras + ' paragraphs, expected at most ' + allowed);
    else ok('no paragraph above the fold');

    /* the greps */
    var hits = GREP.filter(function (g) { return g[0].test(html); });
    if (hits.length) {
      hits.forEach(function (g) { bad('the page contains ' + g[1]); });
    } else ok('clean on every banned term, and no em dash');

    /* Stall renders with no red */
    if (n.state === 'stall' && /chip-watch/.test(html) === false) {
      bad('Stall did not render the amber chip');
    }

    /* both themes defined outside a media block */
    if (html.indexOf(':root{') === -1) bad('the light tokens are not on bare :root');
    if (html.indexOf(':root[data-theme="dark"]{') === -1) bad('the dark theme toggle is missing');
    if (html.indexOf('prefers-color-scheme:dark') === -1) bad('the system dark theme is missing');
  });

  /* the email */
  n.eran = draft();
  var m = mail.reading({ firstName: 'Test', email: 'test@example.com' }, n, 'A'.repeat(22));
  console.log('\n' + name + ' (email)');
  if (m.text.indexOf('/r/' + 'A'.repeat(22)) === -1) bad('the email carries no link');
  else ok('the email carries the link');
  if (m.reply_to !== 'clive@managergap.com') bad('reply-to is wrong');
  else ok('reply-to is Clive');
  if (/<img|tracking/i.test(m.html)) bad('the email holds an image or a pixel');
  else ok('no image, no pixel');

  var noEran = Object.assign({}, n, { eran: null });
  var m2 = mail.reading({ firstName: 'Test', email: 'test@example.com' }, noEran, 'A'.repeat(22));
  if (m2.text.indexOf('undefined') !== -1) bad('the email leaks undefined with no Eran');
  else ok('the email is delivered with no Eran');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
