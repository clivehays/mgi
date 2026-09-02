/* =============================================================
   Addendum B acceptance criteria 18 to 23, plus the forward
   compatibility items from the target architecture section 4.

   These exercise the wiring rather than the page, so several work by
   deliberately breaking something and checking the lead survives.

     node results/test-wiring.js
   ============================================================= */

var fs = require('fs');
var path = require('path');
var derive = require('./derive.js');
var renderer = require('./render.js');
var FIXTURES = require('./fixtures.js').FIXTURES;

var pass = 0, fail = 0;
function ok(m) { pass++; console.log('  ok    ' + m); }
function bad(m) { fail++; console.log('  FAIL  ' + m); }
function check(c, m) { c ? ok(m) : bad(m); }

var SUBMIT = fs.readFileSync(path.join(__dirname, '..', 'api', 'submit.js'), 'utf8');
var READING = fs.readFileSync(path.join(__dirname, '..', 'api', 'reading.js'), 'utf8');
var VERCEL = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

/* ---------- 18. a derive failure never costs a lead ---------- */

console.log('\n[18] A submission whose derive throws still persists, mints and mails');

/* the order in the source is the guarantee, so it is asserted directly */
var iStore = SUBMIT.indexOf('var stored = await store(record);');
var iToken = SUBMIT.indexOf('var token = mintToken();');
var iDerive = SUBMIT.indexOf('payload = derive.derive(answers');
var iMail = SUBMIT.indexOf('var notified = await sendEmail(notification');
check(iStore > 0 && iToken > iStore, 'the token is minted after the submission is stored');
check(iDerive > iToken, 'derive runs after the token exists');
check(iMail > iDerive, 'the email is sent after derive, and unconditionally');

/* derive is inside a try/catch and the mail is not inside it */
var deriveBlock = SUBMIT.slice(iToken, iMail);
check(/try \{/.test(deriveBlock) && /catch \(e\)/.test(deriveBlock),
  'derive is wrapped so a throw cannot escape');
check(!/await sendEmail/.test(deriveBlock), 'no email send sits inside the derive try block');
check(/var stored = await store\(record\);/.test(SUBMIT) &&
  SUBMIT.slice(0, iStore).lastIndexOf('try {') < SUBMIT.slice(0, iStore).lastIndexOf('}'),
  'the store call is not inside a try that could swallow it');

/* prove derive actually throws on a malformed payload rather than
   returning something broken, which is what the catch is there for */
var threw = false;
try {
  derive.derive({ gut: 'fine', evidence: null, output: 'held', external: 'no', energy: 'same', exposure: 'weekly' }, {}, {});
} catch (e) { threw = true; }
check(threw, 'a malformed submission makes derive throw, which the catch handles');

/* ---------- 19. derive on view ---------- */

console.log('\n[19] A null payload derives on view and is written back');
check(/if \(!payload\)/.test(READING), 'the route checks for a null payload');
check(/derive\.derive\(/.test(READING), 'and derives it at request time');
check(/method: 'PATCH'/.test(READING), 'and writes it back');
check(/holding\(res, 500\)/.test(READING), 'a second derive failure serves the holding page, not a trace');
/* the real property is that no error detail can reach the body:
   holding() takes only a status, so there is nothing to leak */
var holdingSig = READING.match(/function holding\(([^)]*)\)/);
check(holdingSig && holdingSig[1].replace(/\s/g, '') === 'res,code',
  'the holding page takes no error argument, so none can be rendered');
var sends = READING.match(/res\.send\([\s\S]*?\);/g) || [];
check(sends.length && !sends.some(function (b) { return /e\.(message|stack)/.test(b); }),
  'no response body interpolates a caught error');

/* the holding page is a real page, not an error */
check(/Your reading is being prepared/.test(READING), 'the holding page says what happened');
check(/clive@managergap\.com/.test(READING), 'and still gives them Clive');

/* ---------- 20. copy edits reach existing tokens ---------- */

console.log('\n[20] Editing the bank changes what an existing token renders');
var f = FIXTURES['cruise-direction-dark'];
var storedPayload = derive.derive(f.answers, f.contact, {});
var before = renderer.render(storedPayload);

var bankPath = path.join(__dirname, 'copy-bank.json');
var original = fs.readFileSync(bankPath, 'utf8');
try {
  var edited = JSON.parse(original);
  edited.ui.ring_hint = 'A DIFFERENT HINT ENTIRELY.';
  fs.writeFileSync(bankPath, JSON.stringify(edited, null, 2));
  delete require.cache[require.resolve('./render.js')];
  var fresh = require('./render.js');
  var after = fresh.render(storedPayload);
  check(before.indexOf('A DIFFERENT HINT ENTIRELY') === -1 &&
        after.indexOf('A DIFFERENT HINT ENTIRELY') !== -1,
    'the same payload renders the new wording with no migration and no re-derive');
} finally {
  fs.writeFileSync(bankPath, original);
  delete require.cache[require.resolve('./render.js')];
}
check(!/results_html|rendered_html/.test(SUBMIT + READING),
  'no rendered HTML is stored anywhere, which is what makes that possible');

/* ---------- 21. headers ---------- */

console.log('\n[21] The results route is not indexable and leaks no referrer');
check(/X-Robots-Tag/.test(READING) && /noindex/.test(READING), 'route sets X-Robots-Tag noindex');
check(/Referrer-Policy/.test(READING) && /no-referrer/.test(READING), 'route sets Referrer-Policy no-referrer');
check(/private, no-store/.test(READING), 'route sets Cache-Control private, no-store');
var rHeader = (VERCEL.headers || []).filter(function (h) { return h.source === '/r/(.*)'; })[0];
check(!!rHeader, 'vercel.json carries the same headers at the edge');
check(rHeader && rHeader.headers.some(function (h) { return h.key === 'X-Robots-Tag'; }),
  'including X-Robots-Tag');
check(/<meta name="robots" content="noindex, nofollow">/.test(READING),
  'the holding page carries the meta robots tag');
var robots = fs.readFileSync(path.join(__dirname, '..', 'robots.txt'), 'utf8');
check(/Disallow: \/r\//.test(robots), 'robots.txt disallows /r/');

/* ---------- 22. one headline definition ---------- */

console.log('\n[22] The email and the page share one headline definition');
var bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
check(!!bank.headline && Object.keys(bank.headline).length === 6, 'six headline variants in the bank');
check(/bank\.headline\[variant\]/.test(SUBMIT), 'the email looks the headline up from the bank');
check(!/Four are live|All five are reading|has gone quiet/.test(SUBMIT),
  'no headline string is duplicated in the mailer');
check(!/Four are live|All five are reading/.test(fs.readFileSync(path.join(__dirname, 'render.js'), 'utf8')),
  'nor in the renderer');

/* ---------- 23. the email works as plain text ---------- */

console.log('\n[23] The email reads correctly with no HTML part');
check(/text: text/.test(SUBMIT), 'a plain text part is always set');
check(!/<img/.test(SUBMIT.slice(SUBMIT.indexOf('function readingEmail'))), 'no image in the email');
check(!/tracking|pixel|open\.gif/i.test(SUBMIT), 'no tracking pixel');
check(/reply_to: 'clive@managergap\.com'/.test(SUBMIT), 'reply-to is a person, not noreply');
var body = bank.email.body;
check(body.indexOf('{link}') !== -1, 'the plain text body carries the link itself');
check(body.indexOf('{headline}') !== -1, 'and the headline');
check(body.trim().split('\n').pop().length > 0, 'and closes on the reply-driver line');

/* ---------- forward compatibility, target architecture section 4 ---------- */

console.log('\n[F] Phase 3 is not precluded');
var p = derive.derive(f.answers, f.contact, {});
check(p.generated && typeof p.generated === 'object' && !Object.keys(p.generated).length,
  'the payload carries an empty generated object');

p.generated = { sowhat: 'GEN SOWHAT', thursday: 'GEN THURSDAY', means: { direction: 'GEN MEANS' }, changes: ['a', 'b'] };
var g = renderer.render(p);
check(g.indexOf('GEN SOWHAT') !== -1 && g.indexOf('GEN MEANS') !== -1 && g.indexOf('GEN THURSDAY') !== -1,
  'the renderer prefers generated strings over the bank');
check(/<li>a<\/li><li>b<\/li>/.test(g), 'including the changes list');
p.generated = {};
check(renderer.render(p).indexOf('GEN SOWHAT') === -1, 'and falls back silently when a slot is absent');

var rw = (VERCEL.rewrites || []).filter(function (r) { return r.source === '/r/:token'; })[0];
check(!!rw, '/r/:token is routed');
check(!(VERCEL.rewrites || []).some(function (r) { return /\/ask/.test(r.source); }),
  '/r/{token}/ask is left free for the Eran endpoint');
var schema = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'create-table.py'), 'utf8');
check(/create table if not exists mgi_transcripts/.test(schema), 'the transcripts table exists, unused');
check(/payload         jsonb/.test(schema), 'payload is loosely typed jsonb');
check(!!bank.email && !!bank.email.body, 'the email body lives in the copy bank, not the mailer');
check(!!bank.version, 'the bank carries a version for copy_bank_ver');

console.log('\n=====================================');
console.log(pass + ' passed, ' + fail + ' failed');
console.log('=====================================');
process.exit(fail ? 1 : 0);
