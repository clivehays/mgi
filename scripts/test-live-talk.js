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
  if (a.body.indexOf('[[[UI]]]') !== -1) ok('the affordance line is on the wire');
  else bad('no affordance line was sent');

  /* 3. it was stored, with the objection classified */
  var turns = await store.history(token);
  if (turns.length >= 2) ok('the turns were stored');
  else bad('the turns were not stored, found ' + turns.length);

  var rows = await store.rows(store.CONVERSATIONS + '?token=eq.' +
    encodeURIComponent(token) + '&role=eq.manager&select=shape,state&order=turn.desc&limit=1');
  if (rows[0] && rows[0].shape === 'surveillance') {
    ok('classified as surveillance, which is what section 10 counts');
  } else bad('classified as ' + JSON.stringify(rows[0] && rows[0].shape));

  /* 4. The bug, replayed. A number on its own, with no consenting turn
     behind it, provisions nothing. */
  var num = await say('9');
  console.log('\n  > 9');
  console.log('  ' + num.body.split('[[[UI]]]')[0].replace(/\n/g, '\n  '));

  var blocked = res();
  await trial({ method: 'POST', query: { token: token }, body: { team_size: 9 } }, blocked);
  var bj = JSON.parse(blocked.body);
  if (bj.blocked) ok('a call that did not come from a press is refused');
  else bad('the trial route provisioned without a press: ' + blocked.body);
  if (!bj.join_code) ok('no join code was minted');
  else bad('a join code was minted anyway');

  /* 5. the manager opens the door in their own words, then presses */
  var b = await say('What would my team say about this? I want to set it up.');
  console.log('\n  > what would my team say, I want to set it up');
  console.log('  ' + b.body.split('[[[UI]]]')[0].replace(/\n/g, '\n  '));

  var who = await store.whoRaisedTrial(token);
  if (who === 'manager') ok('the record says the manager raised it, not Eran');
  else console.log('    note  raised_trial reads ' + JSON.stringify(who));

  var t = res();
  await trial({ method: 'POST', query: { token: token },
    body: { team_size: 9, pressed: true } }, t);
  var out = JSON.parse(t.body);
  if (out.join_url) ok('provisioned from a press');
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

  /* 6. a team of two is declined */
  var small = res();
  await trial({ method: 'POST', query: { token: token },
    body: { team_size: 2, pressed: true } }, small);
  var s = JSON.parse(small.body);
  if (s.declined || s.existing) ok('a team of two gets no new trial');
  else bad('a team of two was provisioned: ' + small.body);

  /* 7. the join page */
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

  /* 8. the join was counted */
  var after = await store.trialByCode(code);
  if (after && after.joined >= 1) ok('the join was counted');
  else bad('the join was not counted');

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
