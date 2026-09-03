/* =============================================================
   POST /r/{token}/trial  ->  the join link

   Provisioning, as far as it goes. There is no live Clover ERA trial
   API to call, so what happens here is: the team size is checked, a
   join code is minted, the team message is written, the two dates are
   fixed, and Clive is told. The handoff into the product itself is the
   boundary and it stays unwired until that API exists.

   Nothing here may lose the person. If any of it fails they are told
   what happened in plain words and Clive is alerted with the token.

   Eran spec, sections 6, 7 and 9.
   ============================================================= */

var crypto = require('crypto');
var conversation = require('../report/conversation.js');
var store = require('../report/store.js');
var send = require('../report/send.js');
var mail = require('../report/email.js');

var FIRST_REPORT_DAYS = 14;
var TRIAL_DAYS = 21;

/* No I, O, 0 or 1: this gets read off a screen and typed by somebody
   else, and a join code nobody can transcribe is a team that never
   joins. */
var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function mintCode() {
  var bytes = crypto.randomBytes(8);
  var out = '';
  for (var i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out.slice(0, 4) + '-' + out.slice(4);
}

function plusDays(n) {
  var d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function json(res, code, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(code).send(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  var token = (req.query && req.query.token) || '';
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return json(res, 404, { error: 'Not found' });

  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  var size = Math.round(Number(body && body.team_size));

  var row = await store.reading(token);
  if (!row || !row.payload) return json(res, 404, { error: 'Not found' });

  /* Absolute 1, and the only part of the offer that is machinery. This
     route provisions on a press and on nothing else. A manager answered
     a question with the number seven and found a live trial, a join
     link and a team message on the other side of it, because the page
     was reading replies and calling this itself.

     The press is the whole gate. There is exactly one caller in the
     client and it is a button, and this refuses anything that did not
     come from one. The word said is not a gate: sentences are Eran's
     business, and the irreversible thing is not. */
  if (body.pressed !== true) {
    console.error('MGI trial refused for ' + token + ': not from a press');
    return json(res, 200, {
      blocked: true,
      reply: 'Nothing is set up yet. Nothing will be until you press the ' +
        'button that says so.'
    });
  }

  /* Below three, decline and hand over. A team picture drawn from two
     people is not a team picture, and provisioning one anyway would be
     the first promise this product broke. */
  if (!isFinite(size) || size < 3) {
    return json(res, 200, {
      declined: true,
      reply: 'On a team that size the answers cannot come back as a team ' +
        'picture, so I am not going to set one up and pretend otherwise. ' +
        'Write to clive@managergap.com. There is a better way to do this ' +
        'for a team of ' + (isFinite(size) && size > 0 ? size : 'that size') + '.'
    });
  }
  if (size > 200) return json(res, 200, {
    declined: true,
    reply: 'That is more than one team. Write to clive@managergap.com and ' +
      'he will set it up properly across them.'
  });

  /* Already running. Hand back what they have rather than a second one. */
  var already = await store.trial(token);
  if (already) {
    return json(res, 200, {
      join_url: joinUrl(already.join_code),
      join_code: already.join_code,
      team_size: already.team_size,
      message: already.message_text,
      first_report: already.first_report,
      ends_at: already.ends_at,
      existing: true
    });
  }

  var code = mintCode();
  var first = plusDays(FIRST_REPORT_DAYS);
  var ends = plusDays(TRIAL_DAYS);

  var message = null;
  try {
    message = await conversation.teamMessage(row.payload);
  } catch (e) {
    console.error('MGI team message failed for ' + token + ': ' + e.message);
  }

  var saved = await store.startTrial({
    token: token,
    team_size: size,
    join_code: code,
    message_text: message,
    first_report: first,
    ends_at: ends
  });

  if (!saved) {
    /* Provisioning failure never loses the person. */
    send.background(mail.trialFailed(row.payload, token, size));
    return json(res, 200, {
      failed: true,
      reply: 'Something went wrong setting that up, and it is on our side ' +
        'rather than yours. Clive has been told and he will get it running ' +
        'today. Nothing needs doing again.'
    });
  }

  send.background(mail.trialStarted(row.payload, token, {
    team_size: size, join_code: code, join_url: joinUrl(code),
    first_report: first, ends_at: ends, message: message
  }));

  return json(res, 200, {
    join_url: joinUrl(code),
    join_code: code,
    team_size: size,
    message: message,
    first_report: first,
    ends_at: ends
  });
};

function joinUrl(code) {
  var origin = process.env.MGI_SITE_ORIGIN || 'https://managergap.com';
  return origin + '/j/' + code;
}
