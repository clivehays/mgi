/* =============================================================
   POST /api/scorecard  ->  the address, and the scorecard sent to it

   The second half of the short self-check. The state was given on the
   page with nothing asked for; this is what an address buys, and it is
   the one request on that page a person is waiting for, so it answers
   properly rather than quietly.

   What it does NOT do is decide what the scorecard says. The page has
   already drawn it from answers in the browser, and this rebuilds the
   same reading from the answers stored on the row, with the same module,
   so the email and the page cannot disagree and neither takes the
   client's word for anything.

   The token is a capability for one row. It is not a secret anyone
   needs to protect: the worst it allows is re-sending that row's own
   scorecard to a different address, which is why the address is written
   once, a second attempt with a different one is refused, and the same
   one again returns the worksheet without sending a second copy.

   Environment:
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required to do anything
     RESEND_API_KEY                            required to send
     MGI_FROM_EMAIL, MGI_REPLY_TO              addresses on the message
     MGI_SELFCHECK_TABLE                       default mgi_selfcheck
     MGI_SITE_ORIGIN                           default https://managergap.com
   ============================================================= */

var SC = require('../assets/selfcheck-core.js');
var send = require('../report/send.js');

var TABLE = process.env.MGI_SELFCHECK_TABLE || 'mgi_selfcheck';
var ORIGIN = process.env.MGI_SITE_ORIGIN || 'https://managergap.com';
var FROM = process.env.MGI_FROM_EMAIL || 'The Manager Gap Index <mgi@cloverera.com>';
var REPLY_TO = process.env.MGI_REPLY_TO || 'clive@managergap.com';

var TOKEN = /^[A-Za-z0-9_-]{22}$/;
var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

var NL = String.fromCharCode(10);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'Missing body' });
  }

  var token = typeof body.token === 'string' ? body.token.trim() : '';
  var email = typeof body.email === 'string' ? body.email.trim().slice(0, 160) : '';

  if (!TOKEN.test(token)) {
    return res.status(400).json({ ok: false, error: 'Unknown scorecard' });
  }
  if (!EMAIL.test(email)) {
    return res.status(400).json({ ok: false, error: 'That does not look like an email address' });
  }

  var row = await fetchRow(token);
  if (!row) {
    return res.status(404).json({ ok: false, error: 'Unknown scorecard' });
  }

  /* A different address is someone else's reading being posted
     somewhere else, so it is refused. The same address again is a person
     pressing the button twice, or a retry, and that succeeds without
     putting a second copy of the same message in their inbox. */
  var already = (row.email || '').toLowerCase();
  if (already && already !== email.toLowerCase()) {
    return res.status(409).json({ ok: false, error: 'This scorecard already has an address' });
  }

  /* Rebuilt from the row, not from the request. */
  var reading;
  try {
    reading = readingOf(row);
  } catch (e) {
    console.error('MGI scorecard could not rebuild ' + token + ': ' + e.message);
    return res.status(500).json({ ok: false, error: 'That did not go through' });
  }

  /* Whether this request is the one that claimed the row, and so the
     one that owes a message. The write below only lands on a row with no
     address on it, so of two requests racing exactly one comes back
     having claimed it. */
  var owes = true;

  if (already) {
    owes = false;
  } else {
    var claimed = await claimEmail(token, email);
    if (claimed === null) {
      /* The address is the whole point of the request, so a store that
         will not take it is a failure worth reporting rather than hiding
         behind a sent email. */
      console.error('MGI scorecard could not store the address for ' + token);
      return res.status(500).json({ ok: false, error: 'That did not go through' });
    }
    if (claimed === 0) {
      /* Something claimed the row between the read above and the write.
         Ask the row who won rather than assuming it was this request. */
      var settled = await fetchRow(token);
      var taken = (settled && settled.email || '').toLowerCase();
      if (!taken) {
        console.error('MGI scorecard claim landed nowhere for ' + token);
        return res.status(500).json({ ok: false, error: 'That did not go through' });
      }
      if (taken !== email.toLowerCase()) {
        return res.status(409).json({ ok: false, error: 'This scorecard already has an address' });
      }
      owes = false;
    }
  }

  /* The message goes after the response. The page draws the scorecard
     from answers it already holds, so nobody is waiting on the send, and
     a slow mail API should not hold the button down. */
  if (owes) send.background(deliver(email, reading, token));

  return res.status(200).json({
    ok: true,
    sent: owes,
    worksheet: ORIGIN + '/s/' + token + '/worksheet.pdf'
  });
};

/* ---------- the reading, from the stored answers ---------- */

function readingOf(row) {
  var values = [row.gut];
  SC.ITEMS.forEach(function (n) { values.push(row['q' + n]); });
  values.push(row.output, row.external_pressure, row.energy, row.exposure);
  return SC.read(values);
}

/* ---------- the message ----------
   Short, and the same shape as the reading email the full assessment
   sends: plain text with a minimal HTML part, no images and no tracking
   pixel. It carries the scorecard rather than a link to it, because
   there is no page behind this one to send them to. */

function deliver(email, r, token) {
  var sheetUrl = ORIGIN + '/s/' + token + '/worksheet.pdf';

  var lines = [
    'Your team came out in ' + r.state.name + '.',
    r.signalHeadline,
    'Signal ' + r.signal + ' of ' + r.signalMax + '.'
  ];

  r.items.forEach(function (item) {
    lines.push('  ' + item.name + ': ' + item.when.toLowerCase());
  });

  lines.push('Line of sight: ' + r.lineOfSight.label + '. ' + r.lineOfSight.copy);
  lines.push('This week');
  lines.push(r.focusLine);
  lines.push(r.action);
  lines.push('The worksheet that runs it: ' + r.worksheet.title);
  lines.push(sheetUrl);
  lines.push('That link is yours and does not expire.');
  lines.push('Clive Hays');
  lines.push('If the reading looks wrong to you, that is worth knowing. Reply and tell me.');

  var text = lines.join(NL + NL) + NL;

  var html = '<div style="font:16px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#17161A">' +
    lines.map(function (p) {
      if (p === sheetUrl) {
        return '<p><a href="' + p + '" style="color:#1A3565">Open your worksheet</a></p>';
      }
      if (p.indexOf('  ') === 0) {
        return '<p style="margin:2px 0 2px 16px;color:#2B2926">' + esc(p.trim()) + '</p>';
      }
      if (p === 'This week') {
        return '<p style="font-weight:600;margin-top:24px">' + esc(p) + '</p>';
      }
      return '<p>' + esc(p) + '</p>';
    }).join('') + '</div>';

  return send.email({
    from: FROM,
    to: [email],
    reply_to: REPLY_TO,
    subject: 'Your scorecard: ' + r.state.name,
    text: text,
    html: html
  });
}

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- the store ---------- */

function rest(path, opts) {
  var url = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Promise.resolve(null);
  opts = opts || {};
  opts.headers = Object.assign({
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: 'Bearer ' + key
  }, opts.headers || {});
  return fetch(url.replace(/\/$/, '') + '/rest/v1/' + path, opts);
}

async function fetchRow(token) {
  var cols = ['id', 'gut', 'output', 'external_pressure', 'energy', 'exposure', 'email']
    .concat(SC.ITEMS.map(function (n) { return 'q' + n; }));
  try {
    var r = await rest(TABLE + '?token=eq.' + encodeURIComponent(token) +
      '&select=' + cols.join(','));
    if (!r || !r.ok) return null;
    return (await r.json())[0] || null;
  } catch (e) {
    console.error('MGI scorecard lookup failed: ' + e.message);
    return null;
  }
}

/* Writes the address, but only onto a row that does not have one yet,
   so the row decides which request was first instead of this handler
   guessing from a read taken a moment earlier. Returns how many rows it
   claimed, or null where the store would not answer at all.

   email_at is written on that claim and never moved afterwards: it
   records when the message went, not when somebody last pressed the
   button. */
async function claimEmail(token, email) {
  try {
    var r = await rest(TABLE + '?token=eq.' + encodeURIComponent(token) +
      '&email=is.null', {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ email: email, email_at: new Date().toISOString() })
    });
    if (!r || !r.ok) {
      console.error('MGI scorecard address store failed: ' +
        (r ? r.status + ' ' + (await r.text()) : 'no store configured'));
      return null;
    }
    var rows = await r.json();
    return Array.isArray(rows) ? rows.length : 0;
  } catch (e) {
    console.error('MGI scorecard address store threw: ' + e.message);
    return null;
  }
}
