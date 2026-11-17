/* =============================================================
   GET /s/{token}/worksheet.pdf  ->  the worksheet for that scorecard

   The library is the methodology, and 56 PDFs sitting at guessable
   paths is the whole thing given away to anyone who tries /C1.pdf. So
   the file is served through the row's token instead, exactly as
   api/worksheet.js does for a full reading: one row, one worksheet,
   and nothing else in the library reachable at all.

   The id comes from the stored row, never from the request, so the URL
   carries no choice for anyone to change. The row only has one because
   the short form chose it from the state and the area when the row was
   written.

   It is also the one thing on this page that was offered in exchange
   for an address, so a row with no address does not get it.
   ============================================================= */

var fs = require('fs');
var path = require('path');

var TABLE = process.env.MGI_SELFCHECK_TABLE || 'mgi_selfcheck';
var DIR = path.join(__dirname, '..', 'worksheets');

/* ids are library-issued and match this exactly. The check is here
   because this value ends up in a filesystem path, and a stored column
   is not a thing to trust with that on its own. */
var ID = /^[A-Z]{1,2}[0-9]{1,3}$/;
var TOKEN = /^[A-Za-z0-9_-]{22}$/;

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
  if (!TOKEN.test(token)) return gone(res, 404, 'Not found.');

  var row = null;
  try {
    var r = await rest(TABLE + '?token=eq.' + encodeURIComponent(token) +
      '&select=worksheet,email');
    if (r && r.ok) row = (await r.json())[0];
  } catch (e) {
    console.error('MGI sheet lookup failed: ' + e.message);
  }

  if (!row) return gone(res, 404, 'This link is no longer live.');

  /* The worksheet is what the address bought. Without one the link was
     not reached through the page it belongs to. */
  if (!row.email) {
    return gone(res, 404, 'This worksheet has not been sent out yet.');
  }

  var id = row.worksheet;
  if (!id || !ID.test(id)) {
    return gone(res, 404, 'There is no worksheet on this scorecard.');
  }

  var file = path.join(DIR, id + '.pdf');
  if (!fs.existsSync(file)) {
    console.error('MGI worksheet missing from the bundle: ' + id);
    return gone(res, 404, 'There is no worksheet on this scorecard.');
  }

  var pdf = fs.readFileSync(file);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', pdf.length);
  /* inline, so a phone opens it in the viewer and a desktop still saves
     it from the browser's own control */
  res.setHeader('Content-Disposition', 'inline; filename="' + id + '.pdf"');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).send(pdf);
};
