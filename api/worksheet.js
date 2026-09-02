/* =============================================================
   GET /r/{token}/worksheet.pdf  ->  the one worksheet for that reading

   The library is the methodology, and 56 PDFs sitting at guessable
   paths is the whole thing given away to anyone who tries /C1.pdf. So
   the file is served through the token instead: a valid, unrevoked
   reading gets exactly the worksheet that was chosen for it, and
   nothing else in the library is reachable at all.

   The id is read from the stored reading, never from the request, so
   the URL carries no choice for anyone to change.
   ============================================================= */

var fs = require('fs');
var path = require('path');

var READINGS = process.env.MGI_READINGS_TABLE || 'mgi_readings';
var DIR = path.join(__dirname, '..', 'worksheets');

/* ids are library-issued and match this exactly. The check is here
   because this value ends up in a filesystem path, and a stored payload
   is not a thing to trust with that on its own. */
var ID = /^[A-Z]{1,2}[0-9]{1,3}$/;

function rest(p) {
  var url = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Promise.resolve(null);
  return fetch(url.replace(/\/$/, '') + '/rest/v1/' + p, {
    headers: { apikey: key, Authorization: 'Bearer ' + key }
  });
}

function gone(res, code, msg) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(code).send(msg);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return gone(res, 405, 'Method not allowed');
  }

  var token = (req.query && req.query.token) || '';
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) {
    return gone(res, 404, 'Not found.');
  }

  var row = null;
  try {
    var r = await rest(READINGS + '?token=eq.' + encodeURIComponent(token) +
      '&select=payload,revoked_at');
    if (r && r.ok) row = (await r.json())[0];
  } catch (e) {
    console.error('MGI worksheet lookup failed: ' + e.message);
  }

  if (!row || row.revoked_at) return gone(res, 404, 'This link is no longer live.');

  var sheet = row.payload && row.payload.eran && row.payload.eran.next_move &&
    row.payload.eran.next_move.worksheet;
  var id = sheet && sheet.id;

  if (!id || !ID.test(id)) {
    return gone(res, 404, 'There is no worksheet on this reading.');
  }

  var file = path.join(DIR, id + '.pdf');
  if (!fs.existsSync(file)) {
    console.error('MGI worksheet missing from the bundle: ' + id);
    return gone(res, 404, 'There is no worksheet on this reading.');
  }

  var body = fs.readFileSync(file);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', body.length);
  /* inline, so a phone opens it in the viewer and the download
     attribute on the link still saves it on a desktop */
  res.setHeader('Content-Disposition', 'inline; filename="' + id + '.pdf"');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).send(body);
};
