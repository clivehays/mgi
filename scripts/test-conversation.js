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

console.log('\nThe meta cleaner takes nothing on trust');
var dirty = c.clean({ state: 'selling', shape: 'panic', exit: 'signup',
  stop: 'yes', refusal: new Array(200).join('x'),
  raised_step: 'nobody', unanswered: new Array(400).join('y') });
is('an unknown state falls back to reading', dirty.state, 'reading');
is('an unknown objection falls back to none', dirty.shape, 'none');
is('an unknown exit is dropped', dirty.exit, null);
is('stop is only ever a real boolean', dirty.stop, false);
is('an unknown raiser is dropped', dirty.raised_step, null);
if (dirty.refusal.length <= 60) ok('the refusal note is bounded');
else bad('the refusal note is unbounded');
if (dirty.unanswered.length <= 200) ok('the unanswered note is bounded');
else bad('the unanswered note is unbounded');
is('the old trial exit is not accepted', c.clean({ exit: 'trial' }).exit, null);
is('booking is', c.clean({ exit: 'booking' }).exit, 'booking');

console.log('\nPreview stays out of the live record');
var live = requireFresh('mgi_readings');
is('live conversations', live.CONVERSATIONS, 'mgi_conversations');
var prev = requireFresh('mgi_preview_readings');
is('preview conversations', prev.CONVERSATIONS, 'mgi_preview_conversations');
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

console.log('\nNothing sets anything up any more');
var page = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'report', 'page.js'), 'utf8');

[['a reply-reading close', /offerClose/],
 ['a provisioning affordance', /offerProvision|offerConsent/],
 ['a number parsed out of the box', /parseInt\(\(input\.value/],
 ['a join block', /join-block/],
 ['a team message box', /team-msg/],
 ['a press flag', /pressed:true/]
].forEach(function (t) {
  if (t[1].test(page)) bad(t[0] + ' is still in the page');
  else ok('no ' + t[0]);
});

var fs = require('fs');
var api = fs.readdirSync(require('path').join(__dirname, '..', 'api'));
if (api.indexOf('trial.js') >= 0) bad('the trial route is still there');
else ok('no trial route');
if (api.indexOf('join.js') >= 0) bad('the join page is still there');
else ok('no join page');

var store = require('../report/store.js');
if (store.TRIALS || store.startTrial) bad('the store still knows about trials');
else ok('the store does not know about trials');
if (c.teamMessage || c.teamFaults) bad('the team message is still in the module');
else ok('no team message');

console.log('\nOne forward step, one link');
var booking = require('../report/booking.js');
var link = booking.link('AAAAAAAAAAAAAAAAAAAAAA');
if (/^https:\/\/calendly\.com\//.test(link)) ok('the link is the configured Calendly one');
else bad('the booking link is ' + link);
if (/utm_content=AAAAAAAAAAAAAAAAAAAAAA/.test(link)) ok('the token rides along');
else bad('the token is not on the link');
if (booking.link('') === booking.URL) ok('no token, no query junk');
else bad('an empty token still appends something');

/* A configured address is pasted, and pasting picks up characters nobody
   can see. A zero width one in front of the scheme is not a cosmetic
   problem: the browser stops reading the href as absolute and resolves it
   against the reading, so the one ask on the page lands the manager on
   managergap.com/r/ plus the entire booking address. This is the check
   that stops it coming back the next time the value is re-pasted. */
var ZW = ['\uFEFF', '\u200B', '\u200C', '\u200D', '\u2060'];
var dirty = 0;
ZW.forEach(function (ch) {
  var got = booking.clean(ch + 'https://calendly.com/x' + ch);
  if (got !== 'https://calendly.com/x') dirty++;
});
if (!dirty) ok('a pasted address survives every zero width character');
else bad(dirty + ' zero width character(s) still reach the link');

if (booking.clean('\uFEFFhttps://calendly.com/x').indexOf('http') === 0)
  ok('the cleaned address still starts with the scheme');
else bad('the cleaned address is not absolute, so the href would be relative');

if (booking.clean('managergap.com/nope') === '') ok('an address with no scheme is refused');
else bad('a scheme-less address is accepted and would resolve relatively');

var vercel = JSON.parse(fs.readFileSync(
  require('path').join(__dirname, '..', 'vercel.json'), 'utf8'));
var routes = vercel.rewrites.map(function (r) { return r.source; }).join(' ');
if (/trial|\/j\//.test(routes)) bad('a dead route is still wired: ' + routes);
else ok('no dead routes');

console.log('\nThe prompt leads with the objective, not the machinery');
[['the objective', /MOST USEFUL CONVERSATION THIS MANAGER HAS EVER HAD/],
 ['no quota', /You have no conversion job/],
 ['the earned offer', /EARNED BY THE ANSWERS, NOT ASKED FOR/],
 ['a reason per state', /A manager in Stall\s+does not want a paragraph/],
 ['the four absolutes', /FOUR THINGS THAT ARE NOT JUDGEMENT/],
 ['the nouns that exist', /There is no session/],
 ['the label is recorded, not occupied', /not a place you are standing in/],
 ['who raised the forward step', /raised_step is the one to be most honest about/]
].forEach(function (t) {
  if (t[1].test(c.SYSTEM)) ok(t[0] + ' is stated');
  else bad(t[0] + ' is missing from the prompt');
});

console.log('\nAnd carries none of the machinery it replaced');
[['a six step close', /Six steps, in this order/],
 ['a consent gate', /THE CONSENT GATE/],
 ['a state machine to occupy', /reading   Answer questions about the reading/],
 ['a setup sequence', /then team size, then the message/],
 ['anything about a team size', /how many, and is this the team/]
].forEach(function (t) {
  if (t[1].test(c.SYSTEM)) bad(t[0] + ' is still in the prompt');
  else ok('no ' + t[0]);
});

console.log('\nAbsolute 1, the reason for all of it');
[['sets nothing up', /YOU DO NOT SET ANYTHING UP/],
 ['describes only what it can', /DESCRIBE ONLY WHAT YOU CAN DESCRIBE PRECISELY/],
 ['the failure it came from', /no list to hand you/],
 ['a yes still gets the link', /you still\s+cannot/],
 ['asked once', /do not raise it again in this conversation/],
 ['the backlog', /unanswered is the backlog/]
].forEach(function (t) {
  if (t[1].test(c.SYSTEM)) ok(t[0] + ' is stated');
  else bad(t[0] + ' is missing from the prompt');
});




console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
