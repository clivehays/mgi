/* Content hash for a script the reading page loads.

   index.html is stamped by scripts/stamp-assets.js. The reading is
   built per request, so it hashes the same way at runtime: CRLF
   folded away, then the first eight of sha256. /assets/ is cached
   for a year, and an unstamped name would pin an old script. */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var ROOT = path.join(__dirname, '..');
var cache = {};

var TRACKING = [
  'assets/tracking-config.js',
  'assets/internal.js',
  'assets/consent.js',
  'assets/linkedin.js'
];

function src(rel) {
  if (cache[rel]) return cache[rel];
  var text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  var CR = String.fromCharCode(13);
  var LF = String.fromCharCode(10);
  text = text.split(CR + LF).join(LF);
  var h = crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8);
  cache[rel] = '/' + rel + '?v=' + h;
  return cache[rel];
}

function trackingTags() {
  return TRACKING.map(function (rel) {
    return '<script src="' + src(rel) + '"></script>';
  }).join('\n');
}

module.exports = { src: src, trackingTags: trackingTags };
