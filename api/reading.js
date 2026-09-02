/* =============================================================
   GET /r/{token}  ->  the participant results page

   Renders on request from the stored payload plus the CURRENT copy
   bank. Nothing is cached and no HTML is stored, so a wording fix
   reaches every reading anyone opens, including links sent weeks ago.
   Rendering is string lookup, a few milliseconds, no model and no
   outbound call.

   If the payload is null, derive it here and write it back. That makes
   the derive at submit a warm cache rather than a dependency, and it is
   why a derive bug can never cost a lead.

   Addendum B sections 1, 2 and 3.
   ============================================================= */

var derive = require('../results/derive.js');
var renderer = require('../results/render.js');

var TABLE = process.env.MGI_TABLE || 'mgi_v5_submissions';
var READINGS = process.env.MGI_READINGS_TABLE || 'mgi_readings';

/* the page holds a manager's private read of their own team. It must
   never surface in a search result, and the referrer must not carry the
   token when they click the mailto. */
function headers(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'private, no-store');
}

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

/* Never a stack trace and never a blank page. A reading that cannot be
   built is a lead we still hold, so it says so and gives them Clive. */
function holding(res, code) {
  headers(res);
  res.status(code);
  res.send('<!doctype html><html lang="en-GB"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex, nofollow">' +
    '<title>Manager Gap Index</title><style>' +
    'body{margin:0;background:#F1ECE3;color:#17161A;font:16px/1.6 Georgia,serif;' +
    'display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}' +
    '.b{max-width:30em}h1{font-size:23px;font-weight:400;margin:0 0 14px}' +
    'a{color:#1A3565}@media(prefers-color-scheme:dark){body{background:#0F1214;color:#EBE6DC}a{color:#4FA6F5}}' +
    '</style></head><body><div class="b">' +
    '<h1>Your reading is being prepared.</h1>' +
    '<p>Something went wrong building this page and Clive has been told. ' +
    'Your answers are safe and nothing needs doing again.</p>' +
    '<p>If you would rather not wait, write to ' +
    '<a href="mailto:clive@managergap.com">clive@managergap.com</a> and he will send it over.</p>' +
    '</div></body></html>');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).send('Method not allowed');
    return;
  }

  var token = (req.query && req.query.token) || '';
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) {
    return holding(res, 404);
  }

  var reading = null;
  try {
    var r = await rest(READINGS + '?token=eq.' + encodeURIComponent(token) +
      '&select=token,submission_id,payload,revoked_at');
    if (r && r.ok) {
      var rows = await r.json();
      reading = rows && rows[0];
    }
  } catch (e) {
    console.error('MGI reading lookup failed: ' + e.message);
  }

  if (!reading || reading.revoked_at) return holding(res, 404);

  var payload = reading.payload;

  /* derive on view when the submit-time derive did not get there */
  if (!payload) {
    try {
      var s = await rest(TABLE + '?id=eq.' + reading.submission_id + '&select=*');
      var sub = s && s.ok ? (await s.json())[0] : null;
      if (!sub) return holding(res, 500);

      payload = derive.derive(
        {
          gut: sub.gut,
          evidence: Array.from({ length: 15 }, function (_, i) { return sub['q' + (i + 1)]; }),
          output: sub.output, external: sub.external_pressure,
          energy: sub.energy, exposure: sub.exposure
        },
        { email: sub.email },
        { copy_to: sub.email, generated_at: String(sub.submitted_at).slice(0, 10) }
      );

      await rest(READINGS + '?token=eq.' + encodeURIComponent(token), {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ payload: payload, copy_bank_ver: renderer.BANK.version })
      });
    } catch (e) {
      console.error('MGI derive-on-view failed for ' + token + ': ' + e.message);
      return holding(res, 500);
    }
  }

  try {
    headers(res);
    res.status(200).send(renderer.render(payload));
  } catch (e) {
    console.error('MGI render failed for ' + token + ': ' + e.message);
    return holding(res, 500);
  }
};
