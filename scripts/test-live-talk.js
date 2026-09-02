/* =============================================================
   The conversation, end to end, against the preview tables.

     node scripts/test-live-talk.js <token>

   Runs the ask route, the close, the trial route and the join page the
   way a browser does, so the wiring is tested and not just the prompt.
   Real model calls, real rows in the preview tables. No email is sent
   to a manager: the only message is the transcript to Clive on an exit,
   which is the thing being tested.
   ============================================================= */

var io = require('fs');
var ENV = 'C:\\Users\\Administrator\\clover-agents\\.env';
io.readFileSync(ENV, 'utf8').split(/\r?\n/).forEach(function (line) {
  line = line.trim();
  if (!line || line[0] === '#' || line.indexOf('=') === -1) return;
  var i = line.indexOf('=');
  var k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
});
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;
process.env.MGI_TABLE = 'mgi_preview_submissions';
process.env.MGI_READINGS_TABLE = 'mgi_preview_readings';
process.env.MGI_SITE_ORIGIN = 'https://managergap-preview.vercel.app';
process.env.MGI_NOTIFY_EMAIL = process.env.MGI_NOTIFY_EMAIL || 'clivehays@gmail.com';
process.env.MGI_FROM_EMAIL = 'The Manager Gap Index <reading@managergap.com>';
process.env.MGI_NOTIFY_FROM = process.env.MGI_FROM_EMAIL;

var ask = require('../api/ask.js');
var trial = require('../api/trial.js');
var join = require('../api/join.js');
var reading = require('../api/reading.js');
var store = require('../report/store.js');

var token = process.argv[2];
if (!/^[A-Za-z0-9_-]{22}$/.test(token || '')) {
  console.error('Give it a token: node scripts/test-live-talk.js <token>');
  process.exit(1);
}

var fail = 0, pass = 0;
function ok(m) { pass++; console.log('  ok    ' + m); }
function bad(m) { fail++; console.log('  FAIL  ' + m); }

function res() {
  var o = { code: 0, body: '', headers: {}, chunks: 0 };
  o.status = function (c) { o.code = c; return o; };
  o.setHeader = function (k, v) { o.headers[k.toLowerCase()] = v; };
  o.write = function (c) { o.body += c; o.chunks++; return true; };
  o.send = function (b) { o.body = b; return o; };
  o.json = function (b) { o.body = JSON.stringify(b); return o; };
  o.end = function () { return o; };
  return o;
}

async function say(text) {
  var r = res();
  await ask({ method: 'POST', query: { token: token },
    headers: { 'x-forwarded-for': '203.0.113.9' }, body: { message: text } }, r);
  return r;
}

(async function () {
  console.log('token:  ' + token);
  console.log('tables: ' + store.CONVERSATIONS + ' / ' + store.TRIALS + '\n');

  var row = await store.reading(token);
  if (!row || !row.payload) { console.error('no reading for that token'); process.exit(1); }
  console.log('reading: ' + row.payload.state_name + ', focus ' + row.payload.focus + '\n');

  /* 1. the block is on the page */
  var page = res();
  await reading({ method: 'GET', query: { token: token } }, page);
  if (String(page.body).indexOf('id="talk"') > 0) ok('the conversation is on the reading');
  else bad('the conversation block did not render');
  if (/Clive reads these/.test(String(page.body))) ok('the disclosure is under the input');
  else bad('the disclosure is missing');
  if (String(page.body).indexOf('/r/' + token + '/ask') === -1 &&
      String(page.body).indexOf('data-token') === -1) {
    bad('the block carries no token');
  } else ok('the block carries its token');

  /* 2. an exchange, streamed */
  var a = await say('Who sees this? I am not putting my team into something that ends up in a performance file.');
  console.log('\n  > who sees this');
  console.log('  ' + a.body.replace(/\n/g, '\n  '));
  if (a.chunks > 1) ok('the reply arrived in ' + a.chunks + ' chunks, streamed');
  else bad('the reply did not stream, ' + a.chunks + ' chunk(s)');
  if (a.body.indexOf('[[[META') === -1) ok('the control block never reached the client');
  else bad('the control block leaked to the client');

  /* 3. it was stored, with the objection classified */
  var turns = await store.history(token);
  if (turns.length >= 2) ok('the turns were stored');
  else bad('the turns were not stored, found ' + turns.length);

  var rows = await store.rows(store.CONVERSATIONS + '?token=eq.' +
    encodeURIComponent(token) + '&role=eq.manager&select=shape,state&order=turn.desc&limit=1');
  if (rows[0] && rows[0].shape === 'surveillance') {
    ok('classified as surveillance, which is what section 10 counts');
  } else bad('classified as ' + JSON.stringify(rows[0] && rows[0].shape));

  /* 4. the close */
  var b = await say('Fair enough. There are nine of us. Set it up.');
  console.log('\n  > there are nine of us');
  console.log('  ' + b.body.replace(/\n/g, '\n  '));

  var t = res();
  await trial({ method: 'POST', query: { token: token }, body: { team_size: 9 } }, t);
  var out = JSON.parse(t.body);
  if (out.join_url) ok('provisioned, join link ' + out.join_url);
  else { bad('no join link: ' + t.body); }

  if (out.message) {
    console.log('\n  THE TEAM MESSAGE');
    console.log('  ' + out.message.replace(/\n/g, '\n  '));
    var c = require('../report/conversation.js');
    var f = c.teamFaults(out.message);
    if (f.length) bad('the team message: ' + f.join(' | '));
    else ok('the team message passes every rule in section 7');
  } else bad('no team message was written');

  if (out.first_report && out.ends_at) ok('both dates fixed: ' + out.first_report + ' and ' + out.ends_at);
  else bad('the dates are missing');

  /* 5. a team of two is declined */
  var small = res();
  await trial({ method: 'POST', query: { token: token }, body: { team_size: 2 } }, small);
  var s = JSON.parse(small.body);
  if (s.declined || s.existing) ok('a team of two gets no new trial');
  else bad('a team of two was provisioned: ' + small.body);

  /* 6. the join page */
  var code = out.join_code;
  var j = res();
  await join({ method: 'GET', query: { code: code } }, j);
  if (j.code === 200) ok('the join page answers');
  else bad('the join page returned ' + j.code);
  if (/team picture|who said what/i.test(String(j.body))) {
    ok('and answers who-can-see-it before anyone asks');
  } else bad('the join page never answers who can see it');

  var bogus = res();
  await join({ method: 'GET', query: { code: 'ZZZZ-ZZZZ' } }, bogus);
  if (bogus.code === 404) ok('an unknown code is not live');
  else bad('an unknown code returned ' + bogus.code);

  /* 7. the join was counted */
  var after = await store.trialByCode(code);
  if (after && after.joined >= 1) ok('the join was counted');
  else bad('the join was not counted');

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
