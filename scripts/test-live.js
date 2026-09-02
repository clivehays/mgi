/* =============================================================
   The whole path, once, for real.

     node scripts/test-live.js you@example.com

   Calls the submit handler and then the reading handler, against the
   preview tables, the real model and real email. It writes a row, it
   sends two messages, and it costs a model call. It is not part of
   npm test for that reason.

   Env comes from clover-agents/.env plus the preview table names.
   ============================================================= */

var io = require('fs');
var path = require('path');

var ENV = 'C:\\Users\\Administrator\\clover-agents\\.env';
io.readFileSync(ENV, 'utf8').split(/\r?\n/).forEach(function (line) {
  line = line.trim();
  if (!line || line[0] === '#' || line.indexOf('=') === -1) return;
  var i = line.indexOf('=');
  var k = line.slice(0, i).trim();
  var v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  if (!process.env[k]) process.env[k] = v;
});

process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;
process.env.MGI_TABLE = 'mgi_preview_submissions';
process.env.MGI_READINGS_TABLE = 'mgi_preview_readings';
process.env.MGI_SITE_ORIGIN = process.env.MGI_SITE_ORIGIN ||
  'https://managergap-preview.vercel.app';
process.env.MGI_FROM_EMAIL = 'The Manager Gap Index <reading@managergap.com>';
process.env.MGI_NOTIFY_FROM = process.env.MGI_FROM_EMAIL;

/* pass a token instead of an address to re-check a reading already
   written, without spending another submission or another email */
var existing = /^[A-Za-z0-9_-]{22}$/.test(process.argv[2] || '') ? process.argv[2] : null;

var to = existing ? 'already sent' : process.argv[2];
if (!to) {
  console.error('Give it an address: node scripts/test-live.js you@example.com');
  process.exit(1);
}
process.env.MGI_NOTIFY_EMAIL = to;

var submit = require('../api/submit.js');
var reading = require('../api/reading.js');
var worksheetRoute = require('../api/worksheet.js');

/* a mixed reading: three areas holding something current, two that have
   gone quiet, and one item nobody could recall */
var ANSWERS = {
  gut: 'fine',
  evidence: [3, 2, 1, 0, 3, 2, 1, 0, 3, 2, 1, 0, 3, 2, 1],
  output: 'held', external: 'no', energy: 'same', exposure: 'few_times'
};

function res() {
  var out = { code: 200, body: null, headers: {} };
  out.status = function (c) { out.code = c; return out; };
  out.json = function (b) { out.body = b; return out; };
  out.send = function (b) { out.body = b; return out; };
  out.setHeader = function (k, v) { out.headers[k.toLowerCase()] = v; };
  return out;
}

(async function () {
  console.log('to:      ' + to);
  console.log('tables:  ' + process.env.MGI_TABLE + ' / ' + process.env.MGI_READINGS_TABLE);
  console.log('origin:  ' + process.env.MGI_SITE_ORIGIN);
  console.log('model:   ' + require('../report/eran.js').MODEL);
  console.log('');

  var row = null;

  if (existing) {
    console.log('re-checking ' + existing + ', nothing sent');
  } else {
  var r1 = res();
  var t = Date.now();
  await submit({
    method: 'POST',
    body: Object.assign({
      firstName: 'Clive', email: to, company: 'Clover ERA', role: 'Founder',
      industry: 'Other', industryOther: 'Preview test', teamSize: '6-10',
      currentlyLeading: 'Yes', tenure: '2-5', left6m: '0', joined6m: '1',
      consent: true, consentAt: new Date().toISOString()
    }, ANSWERS)
  }, r1);

  console.log('submit responded in ' + ((Date.now() - t) / 1000).toFixed(1) + 's');
  console.log(JSON.stringify(r1.body));
  if (!r1.body || !r1.body.ok) { console.error('\nsubmit did not succeed'); process.exit(1); }

  }

  /* find the token the background work is filling in */
  var url = process.env.SUPABASE_URL.replace(/\/$/, '');
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var h = { apikey: key, Authorization: 'Bearer ' + key };

  for (var i = 0; !existing && i < 60 && !(row && row.payload && row.payload.eran); i++) {
    await new Promise(function (r) { setTimeout(r, 3000); });
    var q = await fetch(url + '/rest/v1/' + process.env.MGI_READINGS_TABLE +
      '?select=token,payload&order=created_at.desc&limit=1', { headers: h });
    row = (await q.json())[0];
    process.stdout.write(row && row.payload
      ? (row.payload.eran ? '\nEran landed after ' + ((i + 1) * 3) + 's\n' : '.')
      : '.');
  }

  if (existing) {
    var q0 = await fetch(url + '/rest/v1/' + process.env.MGI_READINGS_TABLE +
      '?select=token,payload&token=eq.' + encodeURIComponent(existing), { headers: h });
    row = (await q0.json())[0];
  }

  if (!row) { console.error('\nno reading row was written'); process.exit(1); }
  console.log('token:   ' + row.token);
  console.log('link:    ' + process.env.MGI_SITE_ORIGIN + '/r/' + row.token);
  if (!row.payload) { console.error('the payload never landed'); process.exit(1); }
  console.log('state:   ' + row.payload.state_name + ' | focus ' + row.payload.focus +
    ' | ' + row.payload.reading_count + ' reading, ' + row.payload.quiet_count + ' quiet');

  /* now open it the way the manager would */
  var r2 = res();
  await reading({ method: 'GET', query: { token: row.token } }, r2);
  console.log('\nGET /r/' + row.token + ' -> ' + r2.code + ', ' +
    String(r2.body).length + ' bytes');

  var out = path.join(__dirname, '..', '.preview.html');
  io.writeFileSync(out, r2.body);
  console.log('written to ' + out);

  var html = String(r2.body);
  var checks = [
    ['the headline is Eran\'s', /class="headline"/.test(html)],
    ['five readouts', (html.match(/class="panel"/g) || []).length === 5],
    ['the cost dials', /id="dial-a"/.test(html) && /id="dial-b"/.test(html)],
    ['the receipt counters', /conditions gone quiet/.test(html)],
    ['the next move', /class="next-question"/.test(html)],
    ['both folded rows', (html.match(/class="fold"/g) || []).length === 2],
    ['the worksheet is linked', new RegExp('/r/' + row.token + '/worksheet.pdf').test(html)],
    ['no em dash', !/—/.test(html)],
    ['no day of the week', !/\b(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b/i.test(html)],
    ['nothing borrowed', !/\bcohort\b|\bMetLife\b|70\s?%/i.test(html)],
    ['nothing hedged', !/\b(thin|uncertain|confidence)\b/i.test(html)],
    ['noindex header', /noindex/.test(r2.headers['x-robots-tag'] || '')],
    ['no-store header', /no-store/.test(r2.headers['cache-control'] || '')]
  ];
  /* the PDF, through the token */
  var r3 = res();
  await worksheetRoute({ method: 'GET', query: { token: row.token } }, r3);
  var pdf = r3.body;
  var isPdf = Buffer.isBuffer(pdf) && pdf.slice(0, 5).toString() === '%PDF-';
  checks.push(['the worksheet PDF serves', r3.code === 200 && isPdf]);
  checks.push(['it is served as a PDF', /application\/pdf/.test(r3.headers['content-type'] || '')]);

  var r4 = res();
  await worksheetRoute({ method: 'GET', query: { token: 'B'.repeat(22) } }, r4);
  checks.push(['an unknown token gets no worksheet', r4.code === 404]);

  console.log('\nworksheet: ' + (row.payload.eran && row.payload.eran.next_move.worksheet
    ? row.payload.eran.next_move.worksheet.id + ' ' + row.payload.eran.next_move.worksheet.title
    : 'none') + ', ' + (isPdf ? (pdf.length / 1024).toFixed(0) + ' KB' : 'not served'));

  console.log('');
  var bad = 0;
  checks.forEach(function (c) {
    console.log('  ' + (c[1] ? 'ok    ' : 'FAIL  ') + c[0]);
    if (!c[1]) bad++;
  });
  console.log('\n' + (bad ? bad + ' failed' : 'the live path holds'));
  process.exit(bad ? 1 : 0);
})();
