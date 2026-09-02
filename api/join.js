/* =============================================================
   GET /j/{code}  ->  what a team member lands on

   The manager sends a link, not a list of addresses, so the link has to
   go somewhere. This is that somewhere, and it is deliberately small:
   it says what will happen, it answers the who-can-see-my-answers
   question before anyone asks it, and it records the join.

   It does not collect an address, a name, or anything else. The daily
   question itself belongs to the product, and until that API exists
   this page is honest about being the edge of what is built.
   ============================================================= */

var store = require('../report/store.js');

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(head, body, note) {
  return '<!doctype html><html lang="en-GB"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex, nofollow">' +
    '<title>Joining</title>' +
    '<link rel="stylesheet" href="/assets/fonts.css">' +
    '<style>' +
    ':root{--paper:#F1ECE3;--ink:#17161A;--ink-2:#3A3733;--ink-mute:#6F6A60;' +
    '--hair:rgba(23,22,26,.12);--blue:#2196F3}' +
    '@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){' +
    '--paper:#121316;--ink:#ECE7DD;--ink-2:#C9C3B8;--ink-mute:#8E887D;' +
    '--hair:rgba(236,231,221,.14);--blue:#5CB2F7}}' +
    ':root[data-theme="dark"]{--paper:#121316;--ink:#ECE7DD;--ink-2:#C9C3B8;' +
    '--ink-mute:#8E887D;--hair:rgba(236,231,221,.14);--blue:#5CB2F7}' +
    'body{margin:0;background:var(--paper);color:var(--ink);' +
    'font:400 17px/1.6 "Source Serif 4",Georgia,serif;display:flex;' +
    'min-height:100vh;align-items:center;justify-content:center;padding:24px}' +
    '.b{max-width:31em}' +
    'h1{font-size:1.6rem;line-height:1.2;font-weight:400;margin:0 0 16px;' +
    'letter-spacing:-.015em}' +
    'p{margin:0 0 14px;color:var(--ink-2)}' +
    '.note{margin:22px 0 0;padding:16px 0 0;border-top:1px solid var(--hair);' +
    'font:400 .84rem/1.55 "Inter Tight",system-ui,sans-serif;color:var(--ink-mute)}' +
    'a{color:var(--blue)}' +
    '</style></head><body><div class="b">' +
    '<h1>' + head + '</h1>' + body +
    (note ? '<p class="note">' + note + '</p>' : '') +
    '</div></body></html>';
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'private, no-store');

  var code = String((req.query && req.query.code) || '').toUpperCase();
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) {
    res.status(404).send(page('That link is not live.',
      '<p>Check it against the one you were sent, or ask whoever sent it.</p>'));
    return;
  }

  var t = null;
  try {
    t = await store.countJoin(code);
  } catch (e) {
    console.error('MGI join lookup failed: ' + e.message);
  }

  if (!t) {
    res.status(404).send(page('That link is not live.',
      '<p>It has either finished or been withdrawn. Nothing is wrong at ' +
      'your end.</p>'));
    return;
  }

  res.status(200).send(page(
    'You are in.',
    '<p>From here you get one question a day. It takes about thirty ' +
    'seconds and it is on your phone.</p>' +
    '<p>Your answers go back to your manager as a team picture. They do ' +
    'not see who said what, and neither does anyone else.</p>' +
    '<p>The first questions start on ' + esc(startsOn(t)) + '.</p>',
    'This is a trial, so it stops on its own. If you would rather not take ' +
    'part, do not answer, and nothing is recorded either way.'
  ));
};

function startsOn(t) {
  var d = t.started_at ? new Date(t.started_at) : new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toLocaleDateString('en-GB',
    { day: 'numeric', month: 'long', timeZone: 'UTC' });
}
