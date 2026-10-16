/* =============================================================
   Campaign source.

   The browser sends every utm_* parameter and s= from the landing
   URL, kept for the visit and posted as `source`. The column is not
   on the table yet. SAVE_SOURCE=1 is the switch that starts writing
   it, and it stays off until the column exists.

   With the switch off the field is left off the row, so an insert
   never names a column the database does not have and never errors
   on the extra JSON.
   ============================================================= */

function applySource(row, body) {
  if (process.env.SAVE_SOURCE !== '1') return row;
  var clean = cleanSource(body && body.source);
  if (clean) row.source = clean;
  return row;
}

function cleanSource(src) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
  var out = {};
  var n = 0;
  var keys = Object.keys(src);
  for (var i = 0; i < keys.length; i++) {
    if (n >= 20) break;
    var k = keys[i];
    if (k !== 's' && k.indexOf('utm_') !== 0) continue;
    if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
    var v = src[k];
    if (typeof v !== 'string') continue;
    v = v.trim().slice(0, 200);
    if (!v) continue;
    out[k] = v;
    n++;
  }
  return n ? out : null;
}

module.exports = { applySource: applySource, cleanSource: cleanSource };
