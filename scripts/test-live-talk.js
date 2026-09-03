/* =============================================================
   The conversation, end to end, against the preview tables.

     node scripts/test-live-talk.js <token>

   Runs the ask route the way a browser does, so the wiring is tested
   and not just the prompt. Real model calls, real rows in the preview
   tables. No email reaches a manager: the only message is the
   transcript to Clive on an exit, which is part of what is tested.
   ============================================================= */

var io = require('fs');
var path = require('path');
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
  if (a.body.indexOf('[[[') === -1) ok('nothing but the reply reached the client');
  else bad('a control marker leaked to the client');

  /* 3. it was stored, with the objection classified */
  var turns = await store.history(token);
  if (turns.length >= 2) ok('the turns were stored');
  else bad('the turns were not stored, found ' + turns.length);

  var rows = await store.rows(store.CONVERSATIONS + '?token=eq.' +
    encodeURIComponent(token) + '&role=eq.manager&select=shape,state&order=turn.desc&limit=1');
  if (rows[0] && rows[0].shape === 'surveillance') {
    ok('classified as surveillance, which is what section 10 counts');
  } else bad('classified as ' + JSON.stringify(rows[0] && rows[0].shape));

  /* 4. Nothing sets anything up any more. */
  var setup = await say('Yes please, set it up for my team.');
  console.log('\n  > yes please, set it up');
  console.log('  ' + setup.body.replace(/\n/g, '\n  '));
  if (/calendly\.com/i.test(setup.body)) ok('handed over the booking link');
  else bad('no booking link on a direct ask');
  if (/how many|team size|join link|starts on/i.test(setup.body)) {
    bad('talked as though it could set something up');
  } else ok('asked for nothing and started nothing');

  var who = await store.whoRaisedStep(token);
  console.log('    note  raised_step reads ' + JSON.stringify(who));

  /* 5. what could not be described precisely, for the backlog */
  var vague = await say('What are the fifteen daily questions? Give me the list.');
  console.log('\n  > give me the list');
  console.log('  ' + vague.body.replace(/\n/g, '\n  '));
  var logged = await store.rows(store.CONVERSATIONS + '?token=eq.' +
    encodeURIComponent(token) + '&unanswered=not.is.null&select=unanswered');
  if (logged.length) ok('recorded for the backlog: ' + logged[0].unanswered);
  else bad('nothing was recorded as unanswerable');

  /* 6. the routes that used to exist are gone */
  var api = io.readdirSync(path.join(__dirname, '..', 'api'));
  if (api.indexOf('trial.js') === -1 && api.indexOf('join.js') === -1) {
    ok('no trial route and no join page');
  } else bad('a dead route is still deployed');

  /* 7. the page's only ask is the same booking link */
  var html = String(page.body);
  var cta = (html.match(/class="cta-link" href="([^"]*)"/) || [])[1] || '';
  if (/calendly\.com/.test(cta)) ok('the page CTA is the booking link');
  else bad('the page CTA is ' + cta);
  if (cta.indexOf(token) > 0) ok('and it carries the token');
  else bad('the CTA carries no token');
  if (/Replying to the email/.test(html)) ok('the reply-to-email line is under it');
  else bad('no reply-to-email line');


  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
