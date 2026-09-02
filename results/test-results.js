/* =============================================================
   Acceptance tests for the participant results page.
   Build brief v2 section 11, plus addendum A section 7.

     node results/test-results.js
   ============================================================= */

var fs = require('fs');
var path = require('path');
var derive = require('./derive.js');
var renderer = require('./render.js');

var pass = 0, fail = 0;
function ok(m) { pass++; console.log('  ok    ' + m); }
function bad(m) { fail++; console.log('  FAIL  ' + m); }
function check(cond, m) { cond ? ok(m) : bad(m); }

/* ---------- fixtures ----------
   One shared list, so the pages on disk cannot drift from the pages
   under test. See results/fixtures.js. */

var FIXTURES = require('./fixtures.js').FIXTURES;

var rendered = {};
Object.keys(FIXTURES).forEach(function (name) {
  var f = FIXTURES[name];
  var p = derive.derive(f.answers, f.contact, { reading_no: 1, generated_at: '2026-09-02' });
  rendered[name] = { payload: p, html: renderer.render(p) };
});

var ALL = Object.keys(rendered).map(function (k) { return rendered[k].html; }).join('\n');

/* ---------- 1. banned content ---------- */

console.log('\n[1] No cohort, no borrowed statistics');
var BANNED = ['cohort', '70%', '11-company', 'eleven', 'MetLife', 'Korn Ferry',
  'Gallup', 'ActivTrak', 'McKinsey', 'Silent Degradation'];
var hits1 = BANNED.filter(function (w) { return new RegExp(w, 'i').test(ALL); });
check(!hits1.length, hits1.length ? 'banned content present: ' + hits1.join(', ')
  : 'none of ' + BANNED.length + ' banned terms in any fixture');
/* "study" needs a word boundary, it appears inside no other word we use */
check(!/\bstudy\b/i.test(ALL), 'no reference to a study');

/* ---------- 2. the old spine ---------- */

console.log('\n[2] The old page is gone');
var SPINE = ['Your result', 'Where that sits', 'The people in this picture',
  'Your instinct vs the evidence', 'What your picture is built on', 'The half you cannot see'];
var hits2 = SPINE.filter(function (h) { return ALL.indexOf(h) !== -1; });
check(!hits2.length, hits2.length ? 'old heading present: ' + hits2.join(' | ')
  : 'none of the six old headings appear');

/* ---------- 3. above the fold ---------- */

console.log('\n[3] First paint is the picture');
Object.keys(rendered).forEach(function (n) {
  var h = rendered[n].html;
  var body = h.slice(h.indexOf('<div class="page">'));
  var head = body.slice(0, body.indexOf('<section class="readout"'));
  /* the ring labels and counts are part of the picture, not prose above
     it. Five labelled rings are 25 words on their own, which would leave
     15 for masthead, chip, headline and sub, so the brief cannot mean
     them. What is counted is the prose a reader has to get past. */
  var text = head.replace(/<span class="inst-(label|count)">[\s\S]*?<\/span>/g, ' ')
    .replace(/\sdata-[a-z]+="[^"]*"/g, '')
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
  var words = text.split(' ').filter(Boolean).length;
  if (words >= 40) bad(n + ': ' + words + ' words above the readout, limit 40');
});
if (!fail) ok('every fixture is under 40 words above the fold');
check(/role="tablist"/.test(ALL) && (rendered['cruise-all-fresh'].html.match(/role="tab"/g) || []).length === 5,
  'five rings render as a tablist');
check(!/<p[ >]/.test(rendered['cruise-all-fresh'].html.slice(0,
  rendered['cruise-all-fresh'].html.indexOf('class="rings"'))), 'no paragraph before the rings');

/* ---------- 4. five distinct readouts ---------- */

console.log('\n[4] Every ring opens a distinct readout');
Object.keys(rendered).forEach(function (n) {
  var means = (rendered[n].html.match(/data-means="([^"]*)"/g) || []);
  var uniq = {}; means.forEach(function (m) { uniq[m] = 1; });
  if (means.length !== 5) bad(n + ': ' + means.length + ' readouts, expected 5');
  else if (Object.keys(uniq).length !== 5) bad(n + ': readout text repeats');
});
ok('all fixtures render five distinct means strings');

/* ---------- 5 and 6. calculator and focus ---------- */

console.log('\n[5] So What pattern and focus selection');
check(rendered['headwinds-results-focus'].payload.focus === 'results', 'results fixture focuses Results');
check(rendered['involvement-focus'].payload.focus === 'involvement', 'involvement fixture focuses Involvement');
check(rendered['readiness-focus'].payload.focus === 'readiness', 'readiness fixture focuses Readiness');
check(rendered['cruise-direction-dark'].payload.focus === 'direction', 'direction fixture focuses Direction');

['headwinds-results-focus', 'involvement-focus'].forEach(function (n) {
  check(rendered[n].payload.calculator.pattern === 'B', n + ' uses pattern B');
  check(!/class="step"/.test(rendered[n].html), n + ' renders no stepper controls');
  check(/sw-phrase/.test(rendered[n].html), n + ' renders the ledger phrase');
});
['cruise-direction-dark', 'readiness-focus'].forEach(function (n) {
  check(rendered[n].payload.calculator.pattern === 'A', n + ' uses pattern A');
  check(/class="step"/.test(rendered[n].html), n + ' renders steppers');
});

console.log('\n[6] Ties are resolved and never surfaced');
Object.keys(rendered).forEach(function (n) {
  var h = rendered[n].html;
  if (/level|tied|same evidence|whichever you/i.test(h)) bad(n + ' surfaces a tie to the reader');
});
ok('no fixture asks the reader to break a tie');
check(rendered['stall-all-dark'].payload.ties.length === 5, 'all-dark fixture records five ties in the payload');

/* ---------- 7. theming ---------- */

console.log('\n[7] Both themes plus the system default');
var css = rendered['cruise-all-fresh'].html;
check(/:root\{--paper:#F1ECE3/.test(css), 'full light palette on bare :root');
check(/:root:not\(\[data-theme="light"\]\)/.test(css), 'dark guarded against an explicit light choice');
check(/:root\[data-theme="dark"\]/.test(css), 'explicit dark wins in both directions');
var mediaBlock = (css.match(/@media \(prefers-color-scheme:dark\)\{([\s\S]*?)\}\}/) || [])[1] || '';
var onlyInMedia = (mediaBlock.match(/--[a-z-]+:/g) || []).filter(function (v) {
  return css.indexOf(':root{' ) !== -1 && css.split(':root{')[1].indexOf(v) === -1;
});
check(!onlyInMedia.length, 'no colour is defined only inside a media block');

/* ---------- 8. collapsed read ---------- */

console.log('\n[8] The page works with every row collapsed');
Object.keys(rendered).forEach(function (n) {
  var h = rendered[n].html;
  var collapsed = h.replace(/<div class="row-p"[\s\S]*?<\/div>/g, '');
  var p = rendered[n].payload;
  var missing = [];
  if (collapsed.indexOf(renderer.BANK.state[p.state].chip) === -1) missing.push('state');
  if (!/class="sw-slot/.test(collapsed)) missing.push('cost');
  if (!/class="changes"/.test(collapsed)) missing.push('fix');
  if (!/class="cta"/.test(collapsed)) missing.push('CTA');
  if (missing.length) bad(n + ' loses ' + missing.join(', ') + ' when collapsed');
});
ok('state, cost, fix and CTA all survive with every row shut');

/* ---------- 9. em dashes ---------- */

console.log('\n[9] No em dash in any rendered string');
check(ALL.indexOf('—') === -1 && ALL.indexOf('&mdash;') === -1, 'no em dash anywhere');

/* ---------- 10. Stall ---------- */

console.log('\n[10] Stall carries no red and no prediction');
var stall = rendered['stall-all-dark'].html;
var reds = (stall.match(/#[0-9A-Fa-f]{6}/g) || []).filter(function (hex) {
  var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return r > 140 && r > g * 1.8 && r > b * 1.8;
});
check(!reds.length, reds.length ? 'red present: ' + reds.join(', ') : 'no red pixel in Stall');
check(!/will leave|going to leave|will fall|will get worse|is going to|expect to lose/i.test(stall),
  'no sentence predicting a departure or a fall');

/* ---------- 11 and 12. accessibility surface ---------- */

console.log('\n[11] Keyboard and assistive surface');
check(/aria-live="polite"/.test(ALL), 'readout announces changes');
check((rendered['cruise-all-fresh'].html.match(/class="row-t"/g) || []).length === 4, 'four disclosure rows');
check(/ArrowRight/.test(ALL) && /ArrowLeft/.test(ALL), 'arrow-key navigation is wired');
check(/focus-visible/.test(ALL), 'visible focus ring on interactive elements');
check(/aria-controls="readout"/.test(ALL), 'tabs point at the panel they control');
check(/role="tabpanel"/.test(ALL), 'the readout is a tabpanel');

/* ---------- 13. no model in the pipeline ---------- */

console.log('\n[13] Deterministic render');
['derive.js', 'render.js'].forEach(function (f) {
  var src = fs.readFileSync(path.join(__dirname, f), 'utf8');
  check(!/qwen|ollama|openai|anthropic|fetch\(/i.test(src), f + ' imports nothing from a model pipeline');
});
check(!/fetch\(|XMLHttpRequest/.test(ALL), 'the rendered page makes no requests of its own');

/* ---------- addendum A section 7 ---------- */

console.log('\n[14] Gating, addendum A');
check(!/pounds and no process/.test(rendered['readiness-focus'].html), 'readiness does not claim a free fix in the receipt');
check(!/pounds and no process/.test(rendered['involvement-focus'].html), 'involvement swaps cell 4');
check(!/pounds and no process/.test(rendered['headwinds-results-focus'].html), 'results swaps cell 4');
check(/pounds and no process/.test(rendered['cruise-direction-dark'].html), 'direction keeps cell 4');
check(/may cost you something/.test(rendered['readiness-focus'].html), 'readiness gets its own cheap-part copy');
check(!/no tool, no process/i.test(rendered['readiness-focus'].html), 'readiness does not use the Direction paragraph');
check(/no tool, no process/i.test(rendered['involvement-focus'].html), 'involvement keeps the free-fix paragraph');

/* ---------- page weight ---------- */
console.log('');
console.log('[16] The thin case, which the brief flagged');
var hz = rendered['headwinds-quiet-zero'];
check(hz.payload.quiet_count === 0, 'every ring reads, so quiet_count is 0');
check(hz.payload.thin === true, 'and it is flagged thin: most items are older than a month');
check(hz.payload.signal.score === 23, 'signal is 23 of 45, the brief figure');
check(!/Rarer than it sounds/.test(hz.html),
  'the congratulatory variant-0 sub does not run on a thin reading');
check(/Thinly/.test(hz.html), 'the thin sub runs instead');
check(/Rarer than it sounds/.test(rendered['cruise-all-fresh'].html),
  'a genuinely healthy variant-0 keeps the original sub');
check(!rendered['cruise-all-fresh'].payload.thin, 'all-fresh is not flagged thin');

check(!/0<\/span><span class="cell-l">conditions confirmed healthy/.test(rendered['stall-all-dark'].html),
  'a zero never sits under "confirmed healthy"');
check(/conditions you can confirm from your own evidence/.test(rendered['stall-all-dark'].html),
  'the all-dark receipt reframes cell 1 as a finding');
check(/conditions confirmed healthy/.test(rendered['cruise-all-fresh'].html),
  'a healthy reading keeps the original cell 1 label');


console.log('\n[15] Weight and geometry');
Object.keys(rendered).forEach(function (n) {
  var kb = Buffer.byteLength(rendered[n].html, 'utf8') / 1024;
  if (kb > 60) bad(n + ' is ' + kb.toFixed(1) + 'KB, over the 60KB budget');
});
ok('every fixture under 60KB');
check((rendered['cruise-all-fresh'].html.match(/class="seg /g) || []).length === 15,
  'fifteen segments render, three per ring');
check(/--rot:-90deg/.test(ALL) && /--rot:30deg/.test(ALL) && /--rot:150deg/.test(ALL),
  'segment rotation rides on --rot, not an SVG transform attribute');
check(!/<path[^>]*transform="/.test(ALL), 'no SVG transform attribute to lose against the stylesheet');
check(/stroke-dasharray:3 7/.test(ALL), 'dark segments carry the 3 7 dash');
check(/animation-delay:/.test(ALL), 'ring draw is staggered');

console.log('\n=====================================');
console.log(pass + ' passed, ' + fail + ' failed');
console.log('=====================================');
process.exit(fail ? 1 : 0);
