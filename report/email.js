/* =============================================================
   email.js  ·  the message that carries the link

   Short on purpose. The reading is the product; the email is the door.
   Plain text plus a minimal HTML part. No images, no tracking pixel.

   Spec section 6.
   ============================================================= */

var FROM = process.env.MGI_FROM_EMAIL || 'The Manager Gap Index <mgi@cloverera.com>';
var REPLY_TO = 'clive@managergap.com';
var ORIGIN = process.env.MGI_SITE_ORIGIN || 'https://managergap.com';

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var NL = String.fromCharCode(10);

/* The reading is ready. Eran's headline appears only if Eran returned
   one that passed: an email is not the place for a placeholder either. */
function reading(contact, numbers, token) {
  var link = ORIGIN + '/r/' + token;
  var headline = numbers && numbers.eran && numbers.eran.headline
    ? numbers.eran.headline : '';

  var paras = [
    'Hi ' + contact.firstName + ',',
    'Your reading is ready. Your team came out in ' + numbers.state_name + '.'
  ];
  if (headline) paras.push(headline);
  paras.push(link + '   See your result');
  paras.push('It reads in about a minute.');
  paras.push('Clive Hays');
  paras.push('If it looks wrong to you, that is worth knowing. Reply and tell me.');

  var text = paras.join(NL + NL) + NL;

  var html = '<div style="font:16px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#17161A">' +
    paras.map(function (p) {
      if (p.indexOf(link) === 0) {
        return '<p><a href="' + link + '" style="color:#1A3565">See your result</a></p>';
      }
      return '<p>' + esc(p) + '</p>';
    }).join('') + '</div>';

  return {
    from: FROM,
    to: [contact.email],
    reply_to: REPLY_TO,
    subject: 'Your reading: ' + numbers.state_name,
    text: text,
    html: html
  };
}

/* The store was unreachable, so there is no page to link to. Clive has
   the raw answers from the notification, so the lead is not lost. Saying
   nothing to the manager is the only outcome that would lose it. */
function pending(contact) {
  var paras = [
    'Hi ' + contact.firstName + ',',
    'Your answers are in. Your reading is being put together and Clive will send it over shortly.',
    'Clive Hays'
  ];
  var text = paras.join(NL + NL) + NL;
  var html = '<div style="font:16px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#17161A">' +
    paras.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>';

  return {
    from: FROM,
    to: [contact.email],
    reply_to: REPLY_TO,
    subject: 'Your reading is on its way',
    text: text,
    html: html
  };
}

/* ---------- what Clive gets ----------
   He receives the transcript on every exit, and he is alerted whenever
   provisioning fails. These are plain text on purpose: they are read on
   a phone between calls, not admired.

   The disclosure under the input says he reads these. It is true, and
   this is the mechanism that makes it true. */

var send = require('./send.js');

var NOTIFY_TO = process.env.MGI_NOTIFY_EMAIL || 'contact@cloverera.com';
var NOTIFY_FROM = process.env.MGI_NOTIFY_FROM || FROM;

function who(payload) {
  return (payload.meta && payload.meta.first_name || 'Someone') +
    ' (' + (payload.meta && payload.meta.copy_to || 'no address') + ')';
}

var EXIT_WORD = {
  trial: 'started a trial',
  clive: 'is for you',
  not_now: 'is a not now'
};

function transcript(payload, token, turns, meta) {
  var L = [];
  L.push(who(payload) + ' ' + (EXIT_WORD[meta.exit] || 'reached an exit') + '.');
  L.push('');
  L.push('Reading: ' + (process.env.MGI_SITE_ORIGIN || 'https://managergap.com') +
    '/r/' + token);
  var focus = require('./numbers.js').focusOf(payload);
  L.push('State: ' + payload.state_name + ', focus ' + focus.dimension +
    ', ' + payload.reading_count + ' reading and ' + payload.quiet_count + ' quiet');
  /* section 3 of the report spec: focus_why is never rendered, it comes
     here, so a pick that differs from the ranking is visible. */
  if (payload.eran && payload.eran.focus_why) {
    L.push('Why that focus: ' + payload.eran.focus_why +
      (focus.key === focus.mechanical ? '' : '  (the ranking said ' + focus.mechanical + ')'));
  }
  L.push('Exit: ' + meta.exit);
  if (meta.shape && meta.shape !== 'none') L.push('Objection: ' + meta.shape);
  if (meta.refusal) L.push('Refusal that applied: ' + meta.refusal);
  if (meta.stop) L.push('The stop rule engaged. Eran stopped selling.');
  if (meta.team_size) L.push('Team size: ' + meta.team_size);
  L.push('');
  L.push('THE CONVERSATION');
  L.push('');
  (turns || []).forEach(function (t) {
    L.push((t.role === 'eran' ? 'ERAN' : 'THEM') + ': ' + t.text);
    L.push('');
  });

  return send.email({
    from: NOTIFY_FROM,
    to: [NOTIFY_TO],
    reply_to: (payload.meta && payload.meta.copy_to) || REPLY_TO,
    subject: 'MGI conversation: ' + (meta.exit || 'exit') + ', ' +
      (payload.meta && payload.meta.first_name || 'unknown'),
    text: L.join(NL)
  });
}

function trialStarted(payload, token, t) {
  var L = [];
  L.push(who(payload) + ' started a trial for ' + t.team_size + ' people.');
  L.push('');
  L.push('Join link: ' + t.join_url);
  L.push('First report: ' + t.first_report);
  L.push('Ends: ' + t.ends_at);
  L.push('Reading: ' + (process.env.MGI_SITE_ORIGIN || 'https://managergap.com') +
    '/r/' + token);
  L.push('');
  L.push('NOTHING IS PROVISIONED IN THE PRODUCT. There is no trial API to');
  L.push('call yet, so this is a join code and a promise. Set the team up by');
  L.push('hand before ' + t.first_report + ' or the first report does not exist.');
  L.push('');
  L.push('THE MESSAGE THEY ARE SENDING THEIR TEAM');
  L.push('');
  L.push(t.message || '(the message could not be written, so they have none)');

  return send.email({
    from: NOTIFY_FROM,
    to: [NOTIFY_TO],
    reply_to: (payload.meta && payload.meta.copy_to) || REPLY_TO,
    subject: 'MGI trial: ' + (payload.meta && payload.meta.first_name || 'unknown') +
      ', ' + t.team_size + ' people',
    text: L.join(NL)
  });
}

function trialFailed(payload, token, size) {
  return send.email({
    from: NOTIFY_FROM,
    to: [NOTIFY_TO],
    reply_to: (payload.meta && payload.meta.copy_to) || REPLY_TO,
    subject: 'MGI trial FAILED to provision',
    text: [
      who(payload) + ' asked for a trial for ' + size + ' people and it did not save.',
      '',
      'They have been told it is on our side and that you will get it running today.',
      'Reading: ' + (process.env.MGI_SITE_ORIGIN || 'https://managergap.com') +
        '/r/' + token
    ].join(NL)
  });
}

module.exports = {
  reading: reading,
  pending: pending,
  transcript: transcript,
  trialStarted: trialStarted,
  trialFailed: trialFailed
};
