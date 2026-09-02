/* =============================================================
   The conversation, in the parts that need no model.

     node scripts/test-conversation.js

   The marker handling, the two validators, the meta cleaner, and the
   table prefixes. The behaviour itself is in test-personas.js, which
   costs money and runs on its own.
   ============================================================= */

var c = require('../report/conversation.js');

var fail = 0, pass = 0;
function ok(m) { pass++; console.log('  ok    ' + m); }
function bad(m) { fail++; console.log('  FAIL  ' + m); }
function is(name, got, want) {
  if (got === want) ok(name);
  else bad(name + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
}

console.log('\nThe control block never reaches the manager');

var withMeta = 'Nobody on your team has been asked anything.\n' +
  c.MARK + '{"state":"deciding","shape":"surveillance","exit":null,"stop":false}';
var split = c.splitMeta(withMeta);
is('the reply is cut at the marker', split.reply.trim(),
  'Nobody on your team has been asked anything.');
is('the state is read', split.meta.state, 'deciding');
is('the objection is read', split.meta.shape, 'surveillance');

var none = c.splitMeta('Just an answer.');
is('a turn with no block still returns its reply', none.reply, 'Just an answer.');
is('and is unclassified rather than failed', none.meta, null);

var broken = c.splitMeta('An answer.\n' + c.MARK + '{not json');
is('a broken block is survived', broken.reply.trim(), 'An answer.');
is('and classifies as nothing', broken.meta, null);

console.log('\nA marker split across two chunks is held back');
is('nothing of it leaks at one character', c.visible('Answer.\n['), 'Answer.\n');
is('nor at six', c.visible('Answer.\n[[[MET'), 'Answer.\n');
is('nor at the whole marker', c.visible('Answer.\n' + c.MARK + '{"a":1}'), 'Answer.\n');
is('ordinary brackets still render', c.visible('Answer [see below]'), 'Answer [see below]');

console.log('\nWhat can be repaired mid-stream, is');

/* built from code points on purpose. Written literally, these two
   characters get normalised out of this file by the same habit that
   keeps them off the page, and the test then asserts that a comma
   stays a comma. */
var EM = String.fromCharCode(0x2014);
var EN = String.fromCharCode(0x2013);

is('em dashes become commas', c.sanitise('one thing' + EM + ' two'), 'one thing, two');
is('and so do en dashes', c.sanitise('one thing' + EN + ' two'), 'one thing, two');
is('exclamation marks become full stops', c.sanitise('Good!'), 'Good.');
is('an em dash cannot survive a whole reply',
  /[–—]/.test(c.sanitise('A' + EM + 'B' + EN + 'C')), false);

console.log('\nThe reply validator');
[['a cohort claim', 'Across our cohort the average was similar.'],
 ['a percentage', 'That puts you in the top 30% of managers.'],
 ['a prediction', 'On this reading someone will leave within the quarter.'],
 ['hedging the reading', 'The evidence is thin so treat it with low confidence.'],
 ['a banned word', 'This is about team engagement, really.']
].forEach(function (t) {
  if (c.faultsIn(t[1]).length) ok('catches ' + t[0]);
  else bad('missed ' + t[0] + ': ' + t[1]);
});

/* Rule 2 has to catch a prediction without catching the phrase a reply
   ends on when it has decided not to push. */
[['I will leave it there.', false],
 ['Otherwise I will leave it there.', false],
 ['I will stop there.', false],
 ['The reading will keep.', false],
 ['Someone will leave within the quarter.', true],
 ['Your best person will resign.', true],
 ['Output will fall next quarter.', true]
].forEach(function (t) {
  var fired = c.faultsIn(t[0]).some(function (f) { return /prediction/.test(f); });
  if (fired === t[1]) ok((t[1] ? 'catches ' : 'allows ') + '"' + t[0] + '"');
  else bad((t[1] ? 'missed ' : 'wrongly faulted ') + '"' + t[0] + '"');
});

var clean = 'Nobody on your team has been asked anything. This whole page is ' +
  'your own answers. If you run a trial their answers come back as a team ' +
  'picture, with no individual view for anyone, including you.';
if (c.faultsIn(clean).length) bad('a clean reply was faulted: ' + c.faultsIn(clean).join(' '));
else ok('a clean reply passes');

var long = new Array(90).join('word ');
if (c.faultsIn(long).some(function (f) { return /six lines/.test(f); })) {
  ok('catches a reply past six lines on a phone');
} else bad('a ninety-word reply was not faulted for length');

console.log('\nThe team message validator, section 7');
var good = 'I have been thinking about how we work rather than what we ship, ' +
  'and I want a better read on it than my own impression. From next week ' +
  'there is one question a day, about thirty seconds. Answers come back to ' +
  'me as a team picture, not individually, and I never see who said what. ' +
  'I will tell you what I do with it. If it turns out to be noise we stop.';
var gf = c.teamFaults(good);
if (gf.length) bad('the spec target was faulted: ' + gf.join(' | '));
else ok('the spec target passes');

[['monitor', 'I want to monitor how the team is doing, one question a day, ' +
   'answers come back as a team picture and I never see who said what.'],
 ['track', 'I am going to track how we work. Answers come back as a team picture.'],
 ['measure', 'I want to measure how we work. Answers come back as a team picture.'],
 ['engagement', 'This is about engagement. Answers come back as a team picture.'],
 ['survey', 'A short survey, one question a day. Answers come back as a team picture.'],
 ['a product name', 'We are trying Clover ERA. Answers come back as a team picture.']
].forEach(function (t) {
  if (c.teamFaults(t[1]).length) ok('rejects ' + t[0]);
  else bad('allowed ' + t[0]);
});

var silent = 'I have been thinking about how we work rather than what we ship. ' +
  'From next week there is one question a day, about thirty seconds each.';
if (c.teamFaults(silent).some(function (f) { return /who-can-see-it/.test(f); })) {
  ok('rejects a message that never answers who can see it');
} else bad('a message that never answers who can see it was allowed');

var over = 'Answers come back as a team picture. ' + new Array(90).join('word ');
if (c.teamFaults(over).some(function (f) { return /80/.test(f); })) {
  ok('rejects a message over eighty words');
} else bad('a message over eighty words was allowed');

console.log('\nThe meta cleaner takes nothing on trust');
var dirty = c.clean({ state: 'selling', shape: 'panic', exit: 'signup',
  stop: 'yes', team_size: '9', refusal: new Array(200).join('x') });
is('an unknown state falls back to reading', dirty.state, 'reading');
is('an unknown objection falls back to none', dirty.shape, 'none');
is('an unknown exit is dropped', dirty.exit, null);
is('stop is only ever a real boolean', dirty.stop, false);
is('a numeric string team size is taken as a number', dirty.team_size, 9);
if (dirty.refusal.length <= 60) ok('the refusal note is bounded');
else bad('the refusal note is unbounded');
is('a team size of nought is refused', c.clean({ team_size: 0 }).team_size, null);

console.log('\nPreview stays out of the live record');
var live = requireFresh('mgi_readings');
is('live conversations', live.CONVERSATIONS, 'mgi_conversations');
is('live trials', live.TRIALS, 'mgi_trials');
var prev = requireFresh('mgi_preview_readings');
is('preview conversations', prev.CONVERSATIONS, 'mgi_preview_conversations');
is('preview trials', prev.TRIALS, 'mgi_preview_trials');
is('preview rate limit', prev.RATE, 'mgi_preview_ask_rate');

function requireFresh(table) {
  var was = process.env.MGI_READINGS_TABLE;
  process.env.MGI_READINGS_TABLE = table;
  delete require.cache[require.resolve('../report/store.js')];
  var s = require('../report/store.js');
  if (was === undefined) delete process.env.MGI_READINGS_TABLE;
  else process.env.MGI_READINGS_TABLE = was;
  return s;
}
delete require.cache[require.resolve('../report/store.js')];

console.log('\nThe page never asks for an address it already has');
var pageSrc = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'report', 'page.js'), 'utf8');
if (/type="email"|name="email"|your email/i.test(pageSrc)) {
  bad('the reading asks for an email address somewhere');
} else ok('nothing on the reading asks for an address');

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
