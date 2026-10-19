/* =============================================================
   Content-address the asset URLs in index.html and booked.html.

   Markup is always fresh. A versioned asset URL (?v=<hash>) is cached
   for a year as immutable, which is safe because the hash is the
   contents: new markup names a new URL, and old markup keeps its pair.

   The bare path is a different cache key. It used to carry the same
   immutable year-long header, so a browser or edge that had fetched
   /assets/mgi.js once kept that body for a year after the file changed.
   vercel.json now sends max-age=0 on any /assets file that has no ?v=,
   and this script writes a temporary redirect from each bare stamped
   path to its current hash. The redirect is temporary so a later stamp
   cannot be pinned by a cached permanent redirect. Fonts under
   /assets/fonts/ stay immutable and unstamped: they are referenced from
   CSS and they do not change.

     node scripts/stamp-assets.js          rewrite the pages and vercel.json
     node scripts/stamp-assets.js --check  exit 1 if any stamp is stale
   ============================================================= */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var ROOT = path.join(__dirname, '..');
var PAGES = ['index.html', 'booked.html'];
var check = process.argv.indexOf('--check') !== -1;

/* Line endings are normalised before hashing. Git rewrites them on
   checkout, so the same commit hashes differently on a Windows working
   copy and on the Linux box that builds the deploy. Hashing the raw
   bytes made the stamp depend on who checked the file out, which is the
   one thing a content hash must not do. */
function hashOf(rel) {
  var file = path.join(ROOT, rel.replace(/^\//, ''));
  if (!fs.existsSync(file)) return null;
  var CR = String.fromCharCode(13), LF = String.fromCharCode(10);
  var text = fs.readFileSync(file, 'utf8').split(CR + LF).join(LF);
  return crypto.createHash('sha256')
    .update(text, 'utf8')
    .digest('hex')
    .slice(0, 8);
}

/* src="/assets/x.js" and href="/assets/x.css", with or without an
   existing ?v=. Fonts are excluded: see the note above. */
var RE = /((?:src|href)=")(\/assets\/(?!fonts\/)[^"?]+)(\?v=[0-9a-f]+)?(")/g;

var failed = 0;
var stamped = {};

PAGES.forEach(function (page) {
  var file = path.join(ROOT, page);
  if (!fs.existsSync(file)) {
    console.log('  missing ' + page);
    failed++;
    return;
  }

  var html = fs.readFileSync(file, 'utf8');
  var before = html;
  var seen = [];
  var stale = [];

  html = html.replace(RE, function (m, lead, rel, existing, tail) {
    var h = hashOf(rel);
    if (!h) {
      stale.push(rel + ' (file missing)');
      return m;
    }
    var want = '?v=' + h;
    stamped[rel] = h;
    seen.push({ rel: rel, hash: h, was: existing || '(none)' });
    if (existing !== want) stale.push(rel);
    return lead + rel + want + tail;
  });

  console.log(page);
  if (check) {
    seen.forEach(function (s) {
      var ok = stale.indexOf(s.rel) === -1;
      console.log('  ' + (ok ? 'ok    ' : 'STALE ') + s.rel + '  ' + s.hash);
    });
    if (stale.length) failed += stale.length;
    return;
  }

  if (html === before) {
    console.log('  no change, all ' + seen.length + ' stamps already current');
  } else {
    fs.writeFileSync(file, html, 'utf8');
    seen.forEach(function (s) {
      console.log('  ' + s.rel + '  ' + s.was + ' -> ?v=' + s.hash);
    });
    console.log('  ' + seen.length + ' reference(s) stamped');
  }
});

/* Bare /assets/<file> must follow the hash the pages name. A permanent
   redirect would itself be cacheable and would pin the previous hash,
   so these stay temporary and the script rewrites them on every stamp. */
function isAssetRedirect(r) {
  return r && typeof r.source === 'string' &&
    /^\/assets\/[^/]+$/.test(r.source) &&
    Array.isArray(r.missing) &&
    r.missing.some(function (m) { return m && m.type === 'query' && m.key === 'v'; });
}

function wantedRedirects() {
  return Object.keys(stamped).sort().map(function (rel) {
    return {
      source: rel,
      missing: [{ type: 'query', key: 'v' }],
      destination: rel + '?v=' + stamped[rel],
      permanent: false
    };
  });
}

function syncRedirects() {
  var vfile = path.join(ROOT, 'vercel.json');
  var cfg = JSON.parse(fs.readFileSync(vfile, 'utf8'));
  var want = wantedRedirects();
  var current = (cfg.redirects || []).filter(isAssetRedirect);
  var same = JSON.stringify(current) === JSON.stringify(want);

  if (check) {
    if (same) console.log('\nvercel.json asset redirects match');
    else {
      console.log('\nvercel.json asset redirects are stale. Run: node scripts/stamp-assets.js');
      failed++;
    }
    return;
  }

  if (same) {
    console.log('\nvercel.json asset redirects already current');
    return;
  }

  var rest = (cfg.redirects || []).filter(function (r) { return !isAssetRedirect(r); });
  cfg.redirects = want.concat(rest);
  fs.writeFileSync(vfile, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  console.log('\nvercel.json  ' + want.length + ' asset redirect(s) written');
}

syncRedirects();

if (check) {
  if (failed) {
    console.log('\n  ' + failed + ' stamp(s) out of date. Run: node scripts/stamp-assets.js');
    process.exit(1);
  }
  console.log('\n  every asset reference matches its file');
  process.exit(0);
}
