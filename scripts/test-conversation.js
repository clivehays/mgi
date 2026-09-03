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

console.log('\nThe consent gate, section 6.1');

/* The bug this replaces: a manager answered "how many people on the
   team" with 7 and found a live trial, a join link and a team message
   waiting on the other side of it. */
[['a bare number answering the gate', { meta: { consent: true }, wasAsked: true, message: '7' }, false],
 ['a number with punctuation', { meta: { consent: true }, wasAsked: true, message: ' 7. ' }, false],
 ['a number with spaces round it', { meta: { consent: true }, wasAsked: true, message: '  12  ' }, false],
 ['a volunteered "how do I start"', { meta: { consent: true }, wasAsked: false, message: 'How do I start?' }, true],
 ['"Yes, set it up" with the model saying no', { meta: { consent: false }, wasAsked: false, message: 'Yes, set it up.' }, true],
 ['a bare yes with nothing asked', { meta: { consent: true }, wasAsked: false, message: 'Yes.' }, false],
 ['"Yes, I have tried that"', { meta: { consent: true }, wasAsked: false, message: 'Yes, I have tried that.' }, false],
 ['"Yes, three of us"', { meta: { consent: true }, wasAsked: false, message: 'Yes, three of us.' }, false],
 ['a bare yes to the closed question', { meta: { consent: false }, wasAsked: true, message: 'Yes.' }, true],
 ['a volunteered "set it up"', { meta: { consent: true }, wasAsked: false, message: 'Right, set it up.' }, true],
 ['consent claimed on a vague message', { meta: { consent: true }, wasAsked: false, message: 'that makes sense to me' }, false],
 ['consent claimed on a question', { meta: { consent: true }, wasAsked: false, message: 'and what does it cost?' }, false],
 ['a number, even where the gate was asked', { meta: { consent: true }, wasAsked: true, message: '9' }, false],
 ['a clear yes to the closed question', { meta: { consent: true }, wasAsked: true, message: 'yes, set it up' }, true],
 ['the button, which needs no reading', { meta: { consent: false }, pressed: true }, true],
 ['already consented, and it stays', { meta: { consent: false }, already: true }, true],
 ['interest with no claim behind it', { meta: { consent: false }, wasAsked: true, message: 'what would it involve?' }, false]
].forEach(function (t) {
  var r = c.decideConsent(t[1]);
  if (r.given === t[2]) ok((t[2] ? 'accepts ' : 'refuses ') + t[0]);
  else bad((t[2] ? 'refused ' : 'ACCEPTED ') + t[0]);
});

console.log('\nThe close is logged, step by step');
var m2 = c.clean({ close_step: 3, team_size: 7, asked_consent: true, consent: true });
is('close_step is carried', m2.close_step, 3);
is('so is the team size', m2.team_size, 7);
is('asked_consent is a real boolean', m2.asked_consent, true);
is('a close_step of nought is refused', c.clean({ close_step: 0 }).close_step, null);
is('and one past six', c.clean({ close_step: 9 }).close_step, null);
is('consent is never truthy by accident', c.clean({ consent: 'yes' }).consent, false);

console.log('\nThe page never provisions from what it reads');
var page = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'report', 'page.js'), 'utf8');
if (/offerClose/.test(page)) bad('the reply-reading close is still in the page');
else ok('nothing in the page reads a reply to decide what to offer');
if (/how many\|team size/.test(page)) bad('the page still matches on the words of a reply');
else ok('no phrase matching against Eran');
if (/parseInt\(\(input\.value/.test(page)) bad('the page still parses a number out of the box');
else ok('no number is parsed out of the input to provision with');
if (/consent_offer/.test(page) && /ui\.provision/.test(page)) {
  ok('both affordances come from the server');
} else bad('the page does not take its affordances from the server');

console.log('\nThe trial route asks the record, not the caller');
var trial = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'api', 'trial.js'), 'utf8');
if (/hasConsent/.test(trial) && /blocked: true/.test(trial)) {
  ok('provisioning is refused without a consenting turn');
} else bad('the trial route can be reached without consent');

console.log('\nWhat the prompt now says');
[['Eran never offers', /YOU NEVER OFFER THE TRIAL/],
 ['the things that are not openings', /THESE DO NOT OPEN IT/],
 ['how the offer gets earned', /HOW THE OFFER GETS EARNED/],
 ['the closed question', /Do you want to set this up now\?/],
 ['the order', /Do not reorder\. Do not skip/],
 ['section 6.3', /NOTHING IRREVERSIBLE COMES FROM A SENTENCE THEY TYPED/],
 ['rule 11', /Never ask a setup question from reading/],
 ['rule 12', /One thing per turn/],
 ['rule 14, the nouns that exist', /There\s+is no session/]
].forEach(function (t) {
  if (t[1].test(c.SYSTEM)) ok(t[0] + ' is stated');
  else bad(t[0] + ' is missing from the prompt');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
