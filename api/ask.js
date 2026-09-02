/* =============================================================
   POST /r/{token}/ask  ->  Eran, streaming

   The reply streams as plain text. The control block Eran writes after
   it never leaves this function: it is cut here, stored against the
   turn, and the client only ever receives what the manager should see.

   Eran spec, sections 4, 5, 9 and 10.
   ============================================================= */

var conversation = require('../report/conversation.js');
var store = require('../report/store.js');
var send = require('../report/send.js');
var mail = require('../report/email.js');

var PER_DAY = 12;
var PER_TOKEN = 40;
var PER_IP_DAY = 60;

function ipOf(req) {
  var h = req.headers || {};
  var fwd = h['x-forwarded-for'] || '';
  return String(fwd).split(',')[0].trim() || h['x-real-ip'] || '';
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
  var message = body && typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return json(res, 400, { error: 'Nothing to answer' });
  if (message.length > 2000) message = message.slice(0, 2000);

  var row = await store.reading(token);
  if (!row || !row.payload) return json(res, 404, { error: 'Not found' });

  if (!await store.rateHit(ipOf(req), PER_IP_DAY)) {
    return json(res, 429, { error: 'busy' });
  }

  /* On the limit, offer Clive. No countdown is ever shown: a number
     counting down turns a conversation into a metered thing. */
  var n = await store.counts(token);
  if (n.total >= PER_TOKEN || n.today >= PER_DAY) {
    return json(res, 200, {
      done: true,
      reply: 'We have covered a lot here. Write to clive@managergap.com ' +
        'and take it up with him directly. He reads these anyway.'
    });
  }

  var past = await store.history(token);
  var stopped = past.some(function (t) { return t.stop; });
  var turn = past.length;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  res.status(200);

  var out;
  try {
    out = await conversation.exchange(
      row.payload,
      past.map(function (t) { return { role: t.role, text: t.text }; }),
      message,
      function (chunk) { res.write(chunk); }
    );
  } catch (e) {
    console.error('MGI ask failed for ' + token + ': ' + e.message);
    /* Never an error in the manager's face. If nothing has been written
       yet the client hides the block; if something has, it stands. */
    res.end();
    return;
  }

  /* The stop rule is a property of the conversation, not of one turn:
     once it has engaged it stays engaged for everything after it. */
  var stop = stopped || out.meta.stop;

  /* Stored before the response closes, not after it. The manager has
     already read the reply, so the wait costs them nothing, and putting
     this in the background loses the turn to anyone who types the next
     message quickly: Eran would answer their second question having
     forgotten the first. */
  try {
    await store.addTurns(token, [
      { turn: turn, role: 'manager', text: message, state: out.meta.state,
        shape: out.meta.shape, stop: stop },
      { turn: turn + 1, role: 'eran', text: out.reply, state: out.meta.state,
        exit: out.meta.exit, stop: stop, refusal: out.meta.refusal,
        faults: out.faults.length ? out.faults.join(' | ') : null }
    ]);
  } catch (e) {
    console.error('MGI turn store failed for ' + token + ': ' + e.message);
  }

  res.end();

  if (out.faults.length) {
    console.error('MGI conversation faults on ' + token + ': ' + out.faults.join(' | '));
  }

  /* Clive receives the transcript on every exit. That one can wait. */
  if (out.meta.exit) {
    send.background((async function () {
      var full = await store.history(token);
      await mail.transcript(row.payload, token, full, out.meta);
    })());
  }
};
