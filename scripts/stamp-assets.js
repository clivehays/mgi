/* =============================================================
   Content-address the asset URLs in index.html.

   The bug this removes: index.html is served max-age=0 and is never
   edge-cached, so a visitor always gets fresh markup. /assets/ is a
   different story. vercel.json asks for max-age=0 there too, but the
   proxy in front of the site rewrites it to max-age=14400, so a browser
   can hold a four-hour-old script against markup from a minute ago.
   The first element the old script does not recognise used to throw and
   abandon the rest of the render.

   Stamping each reference with a hash of that file's contents makes the
   pair inseparable. Markup from a given deploy names exactly the script
   from that deploy, so:

     new markup  -> new hash -> new URL -> cache miss -> new script
     old markup  -> old hash -> old URL -> old script, consistent

   A mismatch stops being possible rather than being made less likely,
   and it no longer depends on anything the proxy chooses to do. It also
   means the long asset cache becomes a benefit instead of a hazard.

   Fonts under /assets/fonts/ are left alone: they are already immutable,
   referenced from CSS rather than markup, and they do not change.

     node scripts/stamp-assets.js          rewrite index.html
     node scripts/stamp-assets.js --check  exit 1 if any stamp is stale
   ============================================================= */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var ROOT = path.join(__dirname, '..');
var HTML = path.join(ROOT, 'index.html');
var check = process.argv.indexOf('--check') !== -1;

function hashOf(rel) {
  var file = path.join(ROOT, rel.replace(/^\//, ''));
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex')
    .slice(0, 8);
}

var html = fs.readFileSync(HTML, 'utf8');
var before = html;
var seen = [];
var stale = [];

/* src="/assets/x.js" and href="/assets/x.css", with or without an
   existing ?v=. Fonts are excluded: see the note above. */
var RE = /((?:src|href)=")(\/assets\/(?!fonts\/)[^"?]+)(\?v=[0-9a-f]+)?(")/g;

html = html.replace(RE, function (m, lead, rel, existing, tail) {
  var h = hashOf(rel);
  if (!h) {
    stale.push(rel + ' (file missing)');
    return m;
  }
  var want = '?v=' + h;
  seen.push({ rel: rel, hash: h, was: existing || '(none)' });
  if (existing !== want) stale.push(rel);
  return lead + rel + want + tail;
});

if (check) {
  seen.forEach(function (s) {
    var ok = stale.indexOf(s.rel) === -1;
    console.log('  ' + (ok ? 'ok    ' : 'STALE ') + s.rel + '  ' + s.hash);
  });
  if (stale.length) {
    console.log('\n  ' + stale.length + ' stamp(s) out of date. Run: node scripts/stamp-assets.js');
    process.exit(1);
  }
  console.log('\n  every asset reference matches its file');
  process.exit(0);
}

if (html === before) {
  console.log('  no change, all ' + seen.length + ' stamps already current');
} else {
  fs.writeFileSync(HTML, html, 'utf8');
  seen.forEach(function (s) {
    console.log('  ' + s.rel + '  ' + s.was + ' -> ?v=' + s.hash);
  });
  console.log('\n  ' + seen.length + ' reference(s) stamped');
}
