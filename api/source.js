/* =============================================================
   Campaign source.

   The browser sends every utm_* parameter, s= and li_fat_id from the
   landing URL, kept for the visit and posted as `source`, with the
   first-seen time and a restored flag when it came from the
   consent-gated first-touch store. The column is not
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

/* Keys besides utm_* that may be stored. li_fat_id is LinkedIn's click
   id from the ad URL. first_seen is when this browser first saw the
   campaign labels, and restored='1' marks labels brought back from the
   30-day first-touch store (only ever written after cookie consent). */
var EXTRA = { s: 1, li_fat_id: 1, first_seen: 1, restored: 1 };

function cleanSource(src) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
  var out = {};
  var n = 0;
  var keys = Object.keys(src);
  for (var i = 0; i < keys.length; i++) {
    if (n >= 20) break;
    var k = keys[i];
    if (!EXTRA[k] && k.indexOf('utm_') !== 0) continue;
    if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
    var v = src[k];
    if (typeof v !== 'string') continue;
    v = v.trim().slice(0, 200);
    if (!v) continue;
    if (k === 'first_seen' && !/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(v)) continue;
    if (k === 'restored' && v !== '1') continue;
    out[k] = v;
    n++;
  }
  return n ? out : null;
}

module.exports = { applySource: applySource, cleanSource: cleanSource };
