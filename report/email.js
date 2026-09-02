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

module.exports = { reading: reading, pending: pending };
