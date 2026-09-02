/* =============================================================
   send.js  ·  the two things every path needs

   The mail transport and the after-the-response escape hatch. Both
   were living inside api/submit.js, where the conversation cannot
   reach them, and both have a hard-won detail in them that is not
   worth reimplementing twice.
   ============================================================= */

var FALLBACK_FROM = process.env.MGI_FALLBACK_FROM || '';

async function post(key, msg) {
  var res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key
    },
    body: JSON.stringify(msg)
  });
  return { ok: res.ok, status: res.status, body: res.ok ? '' : await res.text() };
}

/* Moving the sending domain is a two-part change: the address and the
   scope of the API key. Get them out of step and every message is
   refused, which costs a real manager the report they just answered
   twenty questions for. So a refusal that names the domain is retried
   from an address the key is known to allow. */
function isDomainRefusal(status, body) {
  return status === 403 && /not authorized to send emails from|restricted/i.test(body || '');
}

async function email(msg) {
  var key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error('MGI email skipped: RESEND_API_KEY not set');
    return false;
  }
  try {
    var r = await post(key, msg);
    if (r.ok) return true;

    if (isDomainRefusal(r.status, r.body) && FALLBACK_FROM && msg.from !== FALLBACK_FROM) {
      console.error('MGI email refused for ' + msg.from + ', retrying from ' +
        FALLBACK_FROM + ': ' + r.body);
      var r2 = await post(key, Object.assign({}, msg, { from: FALLBACK_FROM }));
      if (r2.ok) return true;
      console.error('MGI fallback also failed: ' + r2.status + ' ' + r2.body);
      return false;
    }

    console.error('MGI email failed: ' + r.status + ' ' + r.body);
    return false;
  } catch (e) {
    console.error('MGI email threw: ' + e.message);
    return false;
  }
}

/* Work that outlives the response. On the platform this runs on the
   request would otherwise be frozen the moment the response goes; the
   local fallback just lets the promise run and swallows its rejection,
   so nothing here throws into an already-answered request. */
function background(promise) {
  var quiet = Promise.resolve(promise).catch(function (e) {
    console.error('MGI background work failed: ' + e.message);
  });
  try {
    require('@vercel/functions').waitUntil(quiet);
  } catch (e) {
    /* not on the platform, or the helper is unavailable */
  }
  return quiet;
}

module.exports = { email: email, background: background };
