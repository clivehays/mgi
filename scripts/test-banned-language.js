/* =============================================================
   Amendment 6.1.0, section 5: banned constructions.

   The MGI used to tell a manager "Low confidence" at the exact moment
   it was asking them to trust what they were reading. Exposure is not
   noise in the measurement, it is the mechanism that produces the gap,
   so it is now reported as the scale of that gap rather than as a
   caveat on the result.

   This test is what stops the word coming back. It is permanent. If it
   fails, the fix is to rewrite the string, never to widen the list.

   The test to apply to any new string: does it invite the reader to
   trust the result less? If yes, rewrite it.

     node scripts/test-banned-language.js
   ============================================================= */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var MGI = require(path.join(ROOT, 'assets', 'scoring.js'));

var fail = 0;
var pass = 0;

function ok(msg) { pass++; console.log('  OK     ' + msg); }
function bad(msg) { fail++; console.log('  BANNED ' + msg); }

/* Word-boundary patterns. Each carries the reason, so whoever trips it
   understands the principle rather than just deleting a word. */
var BANNED = [
  [/\bconfidence\b/i, 'confidence: a statement about the measurement, not about the manager'],
  [/\breliabilit(y|ies)\b/i, 'reliability: invites the reader to discount the result'],
  [/\baccuracy\b/i, 'accuracy'],
  [/\bprecision\b/i, 'precision'],
  [/\bmargin of error\b/i, 'margin of error'],
  [/\bstatistical(ly)? significan/i, 'statistical significance'],
  [/\bsample quality\b/i, 'sample quality'],
  [/\bwe are less sure\b/i, 'we are less sure'],
  [/\bless certain\b/i, 'less certain'],
  [/\btake this as indicative\b/i, 'indicative hedge'],
  [/\ba rough guide\b/i, 'a rough guide'],
  [/\bdirectional only\b/i, 'directional only'],
  [/\bbased on limited data\b/i, 'based on limited data'],
  [/\byour answers were limited\b/i, 'blames the answers'],
  [/\bmay not have enough visibility to assess\b/i, 'treats position as a limit on the assessment'],
  [/\bresults may not be representative\b/i, 'results may not be representative'],
  [/\bcan be trusted\b/i, 'offers the result up to be doubted'],
  [/\btreat this result as a question\b/i, 'hedges the reading'],
  [/\bnot enough signal\b/i, 'expresses uncertainty about the signal'],
  [/\bwe could not tell\b/i, '"we could not tell" is banned; "you could not tell, and that is the finding" is required']
];

function scan(label, text) {
  if (text === null || text === undefined) return;
  var s = String(text);
  var hits = BANNED.filter(function (b) { return b[0].test(s); });
  hits.forEach(function (b) {
    bad(label + '  ->  ' + b[1] + '\n         ...' + excerpt(s, b[0]) + '...');
  });
  return hits.length === 0;
}

function excerpt(s, re) {
  var m = s.match(re);
  if (!m) return s.slice(0, 90);
  var i = s.indexOf(m[0]);
  return s.slice(Math.max(0, i - 45), i + m[0].length + 45).replace(/\s+/g, ' ');
}

/* ---------- 1. every string the instrument can emit ---------- */

console.log('\n[1] Every string the instrument can produce, across the whole answer space');

var GUTS = MGI.GUT.options.map(function (o) { return o.value; });
var OUTS = MGI.OUTPUT.options.map(function (o) { return o.value; });
var EXTS = MGI.EXTERNAL.options.map(function (o) { return o.value; });
var ENES = MGI.ENERGY.options.map(function (o) { return o.value; });
var EXPS = MGI.EXPOSURE.options.map(function (o) { return o.value; });

function m32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var rnd = m32(20260831);
var pick = function (a) { return a[Math.floor(rnd() * a.length)]; };

var checked = 0;
var dirty = 0;

/* the four corners plus a wide random sweep, so no reachable string is missed */
var cases = [];
[0, 1, 2, 3].forEach(function (v) {
  GUTS.forEach(function (g) {
    OUTS.forEach(function (o) {
      EXTS.forEach(function (e) {
        ENES.forEach(function (n) {
          EXPS.forEach(function (x) {
            cases.push({ gut: g, evidence: new Array(MGI.EVIDENCE.length).fill(v),
                         output: o, external: e, energy: n, exposure: x });
          });
        });
      });
    });
  });
});
for (var k = 0; k < 4000; k++) {
  var ev = [];
  for (var i = 0; i < MGI.EVIDENCE.length; i++) ev.push(Math.floor(rnd() * 4));
  cases.push({ gut: pick(GUTS), evidence: ev, output: pick(OUTS),
               external: pick(EXTS), energy: pick(ENES), exposure: pick(EXPS) });
}

cases.forEach(function (c) {
  var r = MGI.score(c);
  var strings = [
    r.headline, r.state.description, r.gap.copy, r.action,
    r.signalFraming, r.signalCopy, r.summary,
    r.lineOfSight.copy, r.gapWidth.copy, r.gapFraming,
    r.lineOfSight.label, r.gapWidth.label
  ];
  r.areas.forEach(function (a) {
    strings.push(a.name, a.desc, a.callout, a.recencyFact);
  });
  strings.forEach(function (s) {
    if (s === null || s === undefined) return;
    checked++;
    var s2 = String(s);
    if (BANNED.some(function (b) { return b[0].test(s2); })) {
      dirty++;
      if (dirty <= 5) scan('generated copy', s2);
    }
  });
});

if (dirty === 0) {
  ok(checked.toLocaleString() + ' generated strings across ' +
     cases.length.toLocaleString() + ' answer combinations, all clean');
} else {
  bad(dirty + ' generated string(s) carry banned language');
}

/* ---------- 2. participant-facing templates ---------- */

console.log('\n[2] Participant-facing templates');

/* index.html minus the questions and the privacy block: the privacy block
   legitimately discusses what is stored, and the item text is fixed by the
   instrument, not by this amendment */
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
/* comments are NOT stripped: they ship to the browser and show in
   view-source, so they are participant-facing too */
var body = html
  .replace(/<section class="landing-note"[\s\S]*?<\/section>/g, '');
if (scan('index.html', body)) ok('index.html carries no banned language');

/* the manager's report email: both the HTML and the plain text branches.
   Read as source, so a banned word in a template literal is caught even if
   that branch is rarely rendered. */
var submit = fs.readFileSync(path.join(ROOT, 'api', 'submit.js'), 'utf8');

/* the deprecated column write is allowed: it is a database field name,
   never shown to anyone */
var ALLOWED = [
  "confidence: result.confidence.label,",
  "/* deprecated 6.1.0, written so the export contract holds */"
];
var submitScan = submit;
ALLOWED.forEach(function (a) { submitScan = submitScan.split(a).join(''); });

/* strip the comment blocks, which discuss the retirement by name */
submitScan = submitScan.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

if (scan('api/submit.js', submitScan)) ok('api/submit.js carries no banned language');

/* the client */
var client = fs.readFileSync(path.join(ROOT, 'assets', 'mgi.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
if (scan('assets/mgi.js', client)) ok('assets/mgi.js carries no banned language');

/* ---------- 3. the retired field must not be read anywhere new ---------- */

console.log('\n[3] The deprecated field is written, never read');

var reads = (submit.match(/result\.confidence/g) || []).length;
if (reads === 1) ok('api/submit.js reads result.confidence exactly once, for the deprecated column');
else bad('api/submit.js reads result.confidence ' + reads + ' times; it should be exactly 1');

if (!/\.confidence/.test(client)) ok('the client never reads confidence');
else bad('the client still reads confidence');

/* ---------- 4. the new terms are actually present ---------- */

console.log('\n[4] The replacement is wired, not merely the removal');

var sample = MGI.score({
  gut: 'fine', evidence: new Array(MGI.EVIDENCE.length).fill(1),
  output: 'held', external: 'no', energy: 'same', exposure: 'less_weekly'
});
[['lineOfSight.label', sample.lineOfSight.label],
 ['lineOfSight.copy', sample.lineOfSight.copy],
 ['gapWidth.label', sample.gapWidth.label],
 ['gapWidth.copy', sample.gapWidth.copy],
 ['gapFraming', sample.gapFraming],
 ['gapIndex', sample.gapIndex],
 ['meanRecency', sample.meanRecency]].forEach(function (p) {
  if (p[1] !== undefined && p[1] !== null && p[1] !== '') ok(p[0] + ' present');
  else bad(p[0] + ' missing from the score output');
});

/* The replacement now lives on the reading, not on the assessment page:
   line of sight and gap width sit in the folded detail, under a summary
   that asks how much of this the manager can see. */
var numbersOf = require(path.join(ROOT, 'report', 'numbers.js'));
var reportPage = require(path.join(ROOT, 'report', 'page.js'));
var reading = reportPage.render(numbersOf.compute(
  { gut: 'fine', evidence: new Array(MGI.EVIDENCE.length).fill(1),
    output: 'held', external: 'no', energy: 'same', exposure: 'less_weekly' },
  { email: 'test@example.com', firstName: 'Test' }, { generated_at: '2026-09-02' }
));

if (/Line of sight/.test(reading)) ok('the reading names line of sight');
else bad('the reading never names line of sight');
if (/Gap width/.test(reading)) ok('the reading names gap width');
else bad('the reading never names gap width');
if (/How much of this you can see/.test(reading)) ok('the folded row asks what it is for');
else bad('the folded row does not ask how much of this they can see');

scan('the reading, with Eran absent', reading.replace(/<style>[\s\S]*?<\/style>/, ''));

/* ---------- 5. thresholds live in exactly one place ---------- */

console.log('\n[5] Band thresholds appear once');

var scoring = fs.readFileSync(path.join(ROOT, 'assets', 'scoring.js'), 'utf8');
var bandLits = (scoring.match(/max: (1\.0|2\.5|4\.0)\b/g) || []).length;
if (bandLits === 3) ok('the three gap-width cut points appear once each, in GAP_BANDS');
else bad('expected 3 gap-width cut points in one place, found ' + bandLits);

var elsewhere = ['api/submit.js', 'assets/mgi.js'].filter(function (f) {
  return /2\.5[^0-9]|4\.0[^0-9]/.test(fs.readFileSync(path.join(ROOT, f), 'utf8'));
});
if (!elsewhere.length) ok('no gap-width threshold is duplicated outside the instrument');
else bad('gap-width thresholds may be duplicated in: ' + elsewhere.join(', '));

/* ---------- */

console.log('\n=====================================');
console.log(fail === 0 ? 'CLEAN: no banned language' : fail + ' violation(s)');
console.log('=====================================');
process.exit(fail ? 1 : 0);
