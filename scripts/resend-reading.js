/* =============================================================
   Correct a mistyped address and send the reading again.

     node scripts/resend-reading.js <token> <corrected@address>
     node scripts/resend-reading.js <token> <corrected@address> --send

   Someone answers twenty questions, mistypes their address, and the
   report bounces into nothing. The reading itself is fine and sitting in
   the table: the only thing wrong is where it was posted. This corrects
   the address in both places that hold it and sends the same message
   again, rather than regenerating anything.

   Dry run by default. It prints the message it would send and changes
   nothing. Pass --send to write the correction and post it.

   The address lives in two places and both have to move, or the reading
   page keeps printing the old one at the foot of the report:
     mgi_v5_submissions.email
     mgi_readings.payload.meta.copy_to

   Env comes from clover-agents/.env. MGI_FROM_EMAIL must match what
   production sends from, or the manager gets a reply-to they have never
   seen. Production sends the report as:
     The Manager Gap Index <clive@managergap.com>
   ============================================================= */

var io = require('fs');

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

var token = process.argv[2];
var address = process.argv[3];
var send = process.argv.indexOf('--send') !== -1;

if (!token || !address) {
  console.error('Usage: node scripts/resend-reading.js <token> <corrected@address> [--send]');
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
  console.error('That does not look like an address: ' + address);
  process.exit(1);
}

var SUB_TABLE = process.env.MGI_TABLE || 'mgi_v5_submissions';
var READINGS = process.env.MGI_READINGS_TABLE || 'mgi_readings';

var mail = require('../report/email.js');
var send_ = require('../report/send.js');

function rest(path, opts) {
  var url = process.env.SUPABASE_URL.replace(/\/$/, '');
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  opts = opts || {};
  opts.headers = Object.assign({
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: 'Bearer ' + key
  }, opts.headers || {});
  return fetch(url + '/rest/v1/' + path, opts);
}

(async function () {
  var q = await rest(READINGS + '?token=eq.' + encodeURIComponent(token) +
    '&select=token,submission_id,payload,revoked_at');
  var row = (await q.json())[0];
  if (!row) { console.error('No reading with that token.'); process.exit(1); }
  if (row.revoked_at) { console.error('That reading is revoked. Not sending.'); process.exit(1); }

  var payload = row.payload;
  if (!payload) { console.error('That reading has no payload yet.'); process.exit(1); }
  if (!payload.eran) {
    console.error('Eran never wrote this one. Sending it would post half a report.');
    process.exit(1);
  }

  var s = await rest(SUB_TABLE + '?id=eq.' + row.submission_id +
    '&select=id,first_name,email,company,submitted_at');
  var sub = (await s.json())[0];
  if (!sub) { console.error('No submission behind that reading.'); process.exit(1); }

  var was = sub.email;
  var meta = payload.meta || {};
  var contact = { firstName: sub.first_name, email: address, company: sub.company };
  var msg = mail.reading(contact, payload, token);
  msg.from = process.env.MGI_FROM_EMAIL || msg.from;

  console.log('reading     ' + token + '  (submission ' + sub.id + ')');
  console.log('state       ' + payload.state_name);
  console.log('headline    ' + (payload.eran.headline || '(none)'));
  console.log('');
  console.log('address was ' + was);
  console.log('        now ' + address);
  console.log('page footer ' + (meta.copy_to || '(unset)') + '  ->  ' + address);
  console.log('');
  console.log('from        ' + msg.from);
  console.log('reply-to    ' + msg.reply_to);
  console.log('subject     ' + msg.subject);
  console.log('');
  console.log('---- text part ----');
  console.log(msg.text);
  console.log('-------------------');

  if (!send) {
    console.log('\nDry run. Nothing written, nothing sent. Add --send to do it.');
    return;
  }

  /* The correction lands before the message does. If the send then fails
     the address is still right and this can simply be run again, which is
     the better way round to fail. */
  var u1 = await rest(SUB_TABLE + '?id=eq.' + sub.id, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ email: address })
  });
  if (!u1.ok) { console.error('submission update failed: ' + await u1.text()); process.exit(1); }
  console.log('\nsubmission email updated');

  meta.copy_to = address;
  payload.meta = meta;
  var u2 = await rest(READINGS + '?token=eq.' + encodeURIComponent(token), {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ payload: payload })
  });
  if (!u2.ok) { console.error('payload update failed: ' + await u2.text()); process.exit(1); }
  console.log('reading payload updated');

  var ok = await send_.email(msg);
  console.log(ok ? 'sent to ' + address : 'THE SEND FAILED, see the error above');
  process.exit(ok ? 0 : 1);
})();
