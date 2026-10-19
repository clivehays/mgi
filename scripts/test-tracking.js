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

var li = {};
source.applySource(li, { source: {
  s: 'li-adA', utm_content: 'adA', li_fat_id: ' abc-123 ',
  first_seen: '2026-10-19T06:00:00.000Z', restored: '1', li_other: 'no'
} });
if (JSON.stringify(li.source) === JSON.stringify({
  s: 'li-adA', utm_content: 'adA', li_fat_id: 'abc-123',
  first_seen: '2026-10-19T06:00:00.000Z', restored: '1'
})) ok('li_fat_id, first_seen and restored are kept');
else bad('li_fat_id source was ' + JSON.stringify(li.source));

var badMeta = {};
source.applySource(badMeta, { source: { s: 'x', first_seen: 'yesterday', restored: 'yes' } });
if (JSON.stringify(badMeta.source) === JSON.stringify({ s: 'x' })) ok('a malformed first_seen or restored is dropped');
else bad('malformed meta was ' + JSON.stringify(badMeta.source));

if (was === undefined) delete process.env.SAVE_SOURCE;
else process.env.SAVE_SOURCE = was;

console.log('\nFunnel bot signals are coarse');

var funnel = require('../api/funnel.js');
var CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
var IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
[
  [CHROME, 'human'],
  [IPHONE, 'human'],
  [CHROME.replace('Chrome/', 'HeadlessChrome/'), 'headless'],
  ['LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)', 'linkedinbot'],
  ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'bot'],
  ['curl/8.4.0', 'bot'],
  ['', 'bot']
].forEach(function (c) {
  var got = funnel.uaClass(c[0]);
  if (got === c[1]) ok('user agent class ' + c[1] + (c[0] ? '' : ' (empty)'));
  else bad('user agent ' + c[0].slice(0, 40) + ' was ' + got);
});
if (funnel.screenFlag({ sw: 1920, sh: 1080, vw: 1903, vh: 960 }, CHROME) === 'ok') ok('a normal window is ok');
else bad('a normal window was flagged');
if (funnel.screenFlag({ sw: 800, sh: 600, vw: 1920, vh: 1080 }, CHROME) === 'mismatch') ok('a window larger than its screen is flagged');
else bad('a window larger than its screen passed');
if (funnel.screenFlag({ sw: 0, sh: 0, vw: 800, vh: 600 }, CHROME) === 'mismatch') ok('a zero screen is flagged');
else bad('a zero screen passed');
if (funnel.screenFlag({ sw: 1920, sh: 1080, vw: 1920, vh: 1080 }, IPHONE) === 'mismatch') ok('a phone on a desktop screen is flagged');
else bad('a phone on a desktop screen passed');
var info = funnel.clientInfo({ client: { wd: true, sw: 1, sh: 1, vw: 1, vh: 1, extra: 'x' } }, CHROME);
if (JSON.stringify(info) === JSON.stringify({ ua: 'human', wd: true, scr: 'ok' })) ok('only the three flags are kept, never the sizes');
else bad('client info was ' + JSON.stringify(info));

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

if (/funnelStart\(\); go\(0\)/.test(client) && client.indexOf("return funnel.started ? 'start' : 'landing'") !== -1) {
  ok('pressing Start writes its own step');
} else bad('Start does not write a step');
if (/funnel\.furthest === 1 \|\| funnel\.furthest % 5 === 0/.test(client)) ok('question 1 is a checkpoint');
else bad('question 1 is not a checkpoint');
if (client.indexOf('keepalive: true') !== -1 && client.indexOf('navigator.sendBeacon') !== -1) ok('sends use keepalive or a beacon');
else bad('a send can be lost on leave');
if (/li_fat_id: 1/.test(client)) ok('li_fat_id is captured');
else bad('li_fat_id is not captured');
if (/function persistFirstTouch\(\) \{\s*if \(!consentAccepted\(\)\) return;/.test(client) &&
    /function restoreFirstTouch\(\) \{\s*if \(!consentAccepted\(\)\) return;/.test(client)) {
  ok('the first-touch store waits for cookie consent');
} else bad('the first-touch store does not wait for consent');
if (/FIRST_TOUCH_DAYS = 30/.test(client)) ok('first touch expires after 30 days');
else bad('first-touch expiry is not 30 days');
if (/else clearFirstTouch\(\)/.test(client)) ok('a withdrawal deletes the first touch');
else bad('a withdrawal leaves the first touch');

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
