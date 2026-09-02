/* =============================================================
   GET /r/{token}  ->  the manager's reading

   Rendered on request from the stored numbers plus Eran's stored JSON.
   No HTML is stored, so a fix to the page reaches every reading anyone
   opens, including links sent weeks ago.

   If the numbers are not there, compute them here and write them back.
   If Eran has not returned when the page is first opened, call it then
   and store the result. That makes the work at submit a warm cache
   rather than a dependency, and it is why neither a compute bug nor a
   model outage can cost a lead.

   Spec section 6.
   ============================================================= */

var numbersOf = require('../report/numbers.js');
var eran = require('../report/eran.js');
var page = require('../report/page.js');

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
   built is a lead we still hold, so it says so and gives them Clive.

   404 and 500 say different things, because they are different events
   and the manager can tell them apart. A dead link is not a failure to
   build the page: a test reading was once revoked while its email still
   sat in an inbox, this page announced that something had gone wrong,
   and the person who clicked it reasonably concluded the product was
   broken. A prospect clicking an old link would conclude the same. */
function holding(res, code) {
  var lost = code === 404;
  var head = lost ? 'This link is no longer live.'
                  : 'Your reading is being prepared.';
  var body = lost
    ? 'It has either been replaced by a newer one or withdrawn. Nothing is ' +
      'wrong with your answers and there is nothing to do again.'
    : 'Something went wrong building this page and Clive has been told. ' +
      'Your answers are safe and nothing needs doing again.';
  var close = lost ? ' and he will send you the current one.'
                   : ' and he will send it over.';

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
    '<h1>' + head + '</h1>' +
    '<p>' + body + '</p>' +
    '<p>Write to ' +
    '<!--email_off--><a href="mailto:clive@managergap.com">clive@managergap.com</a><!--/email_off-->' +
    close + '</p>' +
    '</div></body></html>');
}

function answersOf(sub) {
  return {
    gut: sub.gut,
    evidence: Array.from({ length: 15 }, function (_, i) { return sub['q' + (i + 1)]; }),
    output: sub.output,
    external: sub.external_pressure,
    energy: sub.energy,
    exposure: sub.exposure
  };
}

async function save(token, payload) {
  return rest(READINGS + '?token=eq.' + encodeURIComponent(token), {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ payload: payload })
  });
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

  var row = null;
  try {
    var r = await rest(READINGS + '?token=eq.' + encodeURIComponent(token) +
      '&select=token,submission_id,payload,revoked_at');
    if (r && r.ok) {
      var rows = await r.json();
      row = rows && rows[0];
    }
  } catch (e) {
    console.error('MGI reading lookup failed: ' + e.message);
  }

  if (!row || row.revoked_at) return holding(res, 404);

  var payload = row.payload;
  var submission = null;

  async function loadSubmission() {
    if (submission) return submission;
    var s = await rest(TABLE + '?id=eq.' + row.submission_id + '&select=*');
    submission = s && s.ok ? (await s.json())[0] : null;
    return submission;
  }

  /* the numbers, if the submit-time compute did not get there */
  if (!payload) {
    try {
      var sub = await loadSubmission();
      if (!sub) return holding(res, 500);
      payload = numbersOf.compute(
        answersOf(sub),
        { email: sub.email, firstName: sub.first_name },
        { copy_to: sub.email, generated_at: String(sub.submitted_at).slice(0, 10) }
      );
      await save(token, payload);
    } catch (e) {
      console.error('MGI compute-on-view failed for ' + token + ': ' + e.message);
      return holding(res, 500);
    }
  }

  /* Eran, if it has not returned yet. Best effort on the view too: the
     page renders without it rather than not at all. */
  if (!payload.eran) {
    try {
      var sub2 = await loadSubmission();
      if (sub2) {
        var written = await eran.write(payload, answersOf(sub2));
        if (written) {
          payload.eran = written;
          await save(token, payload);
        }
      }
    } catch (e) {
      console.error('MGI Eran-on-view failed for ' + token + ': ' + e.message);
    }
  }

  try {
    headers(res);
    res.status(200).send(page.render(payload));
  } catch (e) {
    console.error('MGI render failed for ' + token + ': ' + e.message);
    return holding(res, 500);
  }
};
