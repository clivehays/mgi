/* =============================================================
   build-library.js  ·  the worksheet library, bundled

     node scripts/build-library.js

   Reads the 56 worksheets out of Eran's corpus and their PDFs out of
   the Actions Library, and writes:

     report/library.json    id, title, pillar, difficulty, trigger, lede, body
     worksheets/<ID>.pdf    one file per worksheet, named by id alone

   Run locally whenever the library changes, then commit both. Vercel
   cannot run this: the sources live in OneDrive on this machine.

   The books and the micro-actions are deliberately left out. The report
   argues from the manager's own answers, so a book chunk in the prompt
   is a fabrication risk with nothing to earn against it.
   ============================================================= */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var CORPUS = 'C:/Users/Administrator/eran/src/data/corpus.json';
var PDFS = 'C:/Users/Administrator/OneDrive/Clive Docs/Clover ERA/Clover/' +
  'Clover ERA - Actions - Library/Actions-Library-April2026/Worksheets-PDFs';

var OUT_JSON = path.join(ROOT, 'report', 'library.json');
var OUT_PDFS = path.join(ROOT, 'worksheets');

/* What the worksheet is for, in a line Eran can choose on.

   Not every worksheet opens with prose. Several go straight from the
   title into a metadata table, so a "first paragraph" rule returns an
   editorial note or a fragment of a neuroscience table on those. The
   one field every worksheet carries is its trigger, both as a written
   line in the header table and as the corpus keys, so that is what the
   catalogue is built from and the opening paragraph is a bonus where
   one exists. */

function triggerLine(body) {
  var m = body.match(/CLOVER ERA Trigger\*?\*?\s{2,}([^\n]+)/);
  if (!m) return '';
  return m[1].replace(/\s+/g, ' ').replace(/\*+/g, '').trim();
}

function lede(body) {
  var paras = body.split(/\n\s*\n/);
  for (var i = 0; i < paras.length; i++) {
    var p = paras[i].replace(/\s+/g, ' ').trim();
    if (!p || p[0] === '#' || p[0] === '|') continue;
    if (p.indexOf('**') === 0) continue;
    /* a whole paragraph in italics is an editorial note about the
       worksheet, not a description of what it does */
    if (/^\*[^*].*\*$/.test(p)) continue;
    if (/^(Formerly|Absorbs|Replaces|Retitled)\b/i.test(p)) continue;
    if (p.length < 90) continue;
    return p.length > 340 ? p.slice(0, 337).replace(/\s\S*$/, '') + '...' : p;
  }
  return '';
}

function humanise(keys) {
  return (keys || []).map(function (k) {
    return String(k).replace(/_/g, ' ');
  }).join(', ');
}

/* the line that reaches the prompt */
function forWhat(w) {
  return triggerLine(w.body) || humanise(w.triggers);
}

function main() {
  var corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));

  /* index the PDFs by the id that leads the filename */
  var pdf = {};
  fs.readdirSync(PDFS).forEach(function (pillar) {
    var dir = path.join(PDFS, pillar);
    if (!fs.statSync(dir).isDirectory()) return;
    fs.readdirSync(dir).forEach(function (f) {
      if (!/\.pdf$/i.test(f)) return;
      pdf[f.replace(/\.pdf$/i, '').split('_')[0]] = path.join(dir, f);
    });
  });

  if (!fs.existsSync(OUT_PDFS)) fs.mkdirSync(OUT_PDFS);

  var missing = [];
  var worksheets = corpus.worksheets.map(function (w) {
    if (!pdf[w.id]) { missing.push(w.id); return null; }
    fs.copyFileSync(pdf[w.id], path.join(OUT_PDFS, w.id + '.pdf'));
    return {
      id: w.id,
      title: w.title,
      pillar: w.pillar,
      difficulty: w.difficulty,
      forWhat: forWhat(w),
      lede: lede(w.body),
      body: w.body
    };
  }).filter(Boolean);

  if (missing.length) {
    console.error('No PDF for: ' + missing.join(', '));
    process.exit(1);
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify({
    built_at: new Date().toISOString().slice(0, 10),
    source: corpus.generatedAt,
    worksheets: worksheets
  }, null, 0) + '\n');

  var bytes = fs.statSync(OUT_JSON).size;
  var pdfBytes = fs.readdirSync(OUT_PDFS).reduce(function (t, f) {
    return t + fs.statSync(path.join(OUT_PDFS, f)).size;
  }, 0);

  console.log(worksheets.length + ' worksheets');
  console.log('  library.json  ' + (bytes / 1024).toFixed(0) + ' KB');
  console.log('  worksheets/   ' + (pdfBytes / 1024 / 1024).toFixed(1) + ' MB');
  console.log('  catalogue     ' + (worksheets.reduce(function (t, w) {
    return t + w.id.length + w.title.length + w.pillar.length +
      w.forWhat.length + w.lede.length + 16;
  }, 0) / 1024).toFixed(0) + ' KB, which is what reaches the prompt');

  var noFor = worksheets.filter(function (w) { return !w.forWhat; });
  if (noFor.length) console.log('  no trigger:   ' + noFor.map(function (w) { return w.id; }).join(' '));
  var noLede = worksheets.filter(function (w) { return !w.lede; });
  if (noLede.length) console.log('  no lede:      ' + noLede.map(function (w) { return w.id; }).join(' '));
}

main();
