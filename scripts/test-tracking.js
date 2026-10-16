/* =============================================================
   Source capture and the LinkedIn tag.

     node scripts/test-tracking.js

   The flag must keep `source` off the row until SAVE_SOURCE=1.
   The tag must be the standard loader, with no noscript pixel,
   and a conversion must wait for both an id and consent.
   ============================================================= */

var fs = require('fs');
var path = require('path');
var source = require('../api/source.js');

var fail = 0, pass = 0;
function ok(m) { pass++; console.log('  ok    ' + m); }
function bad(m) { fail++; console.log('  FAIL  ' + m); }

var ROOT = path.join(__dirname, '..');

console.log('\nSource is ignored unless SAVE_SOURCE=1');

var was = process.env.SAVE_SOURCE;
delete process.env.SAVE_SOURCE;
var quiet = { sid: 'abc' };
source.applySource(quiet, { source: { utm_source: 'linkedin', s: 'spring', email: 'a@b.c' } });
if (quiet.source === undefined) ok('unset flag leaves the row untouched');
else bad('unset flag wrote source');

process.env.SAVE_SOURCE = '0';
source.applySource(quiet, { source: { utm_source: 'linkedin' } });
if (quiet.source === undefined) ok('any value other than 1 is off');
else bad('SAVE_SOURCE=0 still wrote source');

process.env.SAVE_SOURCE = '1';
var row = {};
source.applySource(row, {
  source: {
    utm_source: 'linkedin',
    utm_medium: 'cpc',
    utm_campaign: '  book  ',
    s: 'spring',
    email: 'a@b.c',
    gclid: 'no',
    utm_bad: 12,
    'utm_x<script>': 'no',
    utm_empty: '   '
  }
});
var want = { utm_source: 'linkedin', utm_medium: 'cpc', utm_campaign: 'book', s: 'spring' };
if (JSON.stringify(row.source) === JSON.stringify(want)) ok('only utm_* and s, trimmed');
else bad('cleaned source was ' + JSON.stringify(row.source));

var junk = {};
source.applySource(junk, { source: null });
source.applySource(junk, { source: ['utm_source'] });
source.applySource(junk, {});
source.applySource(junk, { source: { utm_source: '' } });
if (junk.source === undefined) ok('empty or unusable source is omitted');
else bad('empty source was stored');

var long = {};
source.applySource(long, { source: { utm_source: new Array(250).join('a') } });
if (long.source.utm_source.length === 200) ok('a value is capped at 200 characters');
else bad('value length ' + long.source.utm_source.length);

if (was === undefined) delete process.env.SAVE_SOURCE;
else process.env.SAVE_SOURCE = was;

console.log('\nThe Insight Tag waits for consent and an id');

var config = fs.readFileSync(path.join(ROOT, 'assets', 'tracking-config.js'), 'utf8');
if (/partnerId:\s*'9887058'/.test(config)) ok('partner id is 9887058');
else bad('partner id is not 9887058');
if (/assessmentCompleted:\s*31367050\b/.test(config) && /callBooked:\s*31367058\b/.test(config)) {
  ok('assessment completed is 31367050 and call booked is 31367058');
} else bad('a conversion id is wrong');

var loader = fs.readFileSync(path.join(ROOT, 'assets', 'linkedin.js'), 'utf8');
if (loader.indexOf('https://snap.licdn.com/li.lms-analytics/insight.min.js') !== -1) {
  ok('the standard loader is the one used');
} else bad('the insight loader URL is missing');
if (loader.indexOf('_linkedin_data_partner_ids') !== -1) ok('the partner id array is set up');
else bad('the partner id array is missing');
if (/px\.ads\.linkedin\.com|<noscript>/i.test(loader)) bad('a noscript pixel is in the loader');
else ok('no noscript pixel');
if (/consented\(\)/.test(loader) && /conversionId\(/.test(loader)) {
  ok('a conversion checks the id and consent');
} else bad('the conversion guard is missing');

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

['index.html', 'booked.html'].forEach(function (rel) {
  var text = read(rel);
  var has = text.indexOf('tracking-config.js') !== -1 &&
    text.indexOf('consent.js') !== -1 &&
    text.indexOf('linkedin.js') !== -1;
  if (has) ok(rel + ' includes the tag scripts');
  else bad(rel + ' is missing a tag script');
  if (/px\.ads\.linkedin\.com|<noscript>[^<]*linkedin/i.test(text)) {
    bad(rel + ' contains a noscript pixel');
  }
});

var urls = read('report/asset-url.js');
if (urls.indexOf('assets/tracking-config.js') !== -1 &&
    urls.indexOf('assets/consent.js') !== -1 &&
    urls.indexOf('assets/linkedin.js') !== -1) {
  ok('the reading shares the same three scripts');
} else bad('the reading script list is incomplete');

['report/page.js', 'api/reading.js'].forEach(function (rel) {
  if (read(rel).indexOf('trackingTags') !== -1) ok(rel + ' adds the tag on the page');
  else bad(rel + ' does not add the tag');
});

var tags = require('../report/asset-url.js').trackingTags();
if (/tracking-config\.js\?v=[0-9a-f]{8}/.test(tags) &&
    /consent\.js\?v=[0-9a-f]{8}/.test(tags) &&
    /linkedin\.js\?v=[0-9a-f]{8}/.test(tags)) {
  ok('the reading stamps the three scripts');
} else bad('the reading tags are ' + tags);

var client = read('assets/mgi.js');
if (client.indexOf("track('assessmentCompleted')") !== -1) ok('submit fires the assessment conversion');
else bad('submit does not fire the assessment conversion');
if (client.indexOf('source: readSource()') !== -1) ok('both posts can carry source');
else bad('source is not attached in the client');

var booked = read('booked.html');
if (/data-conversion="callBooked"/.test(booked)) ok('the booked page names its conversion');
else bad('the booked page has no conversion');

var consent = read('assets/consent.js');
if (consent.indexOf(">That\\'s fine</button>") !== -1 && consent.indexOf('>No thanks</button>') !== -1 &&
    consent.indexOf('class="cookie-choice" id="cookie-accept"') !== -1 &&
    consent.indexOf('class="cookie-choice" id="cookie-reject"') !== -1) {
  ok("That's fine and No thanks are both the same kind of button");
} else bad("That's fine and No thanks are not both the same kind of button");
if (consent.indexOf('mgi-cookie-consent') !== -1) ok('the choice is stored');
else bad('the choice is not stored');
if (consent.indexOf('data-cookie-settings') !== -1) ok('the choice can be reopened');
else bad('there is no way back to the banner');

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
