/* =============================================================
   A PDF of every reading, one file per person.

     node scripts/build-report-pdfs.js
     node scripts/build-report-pdfs.js --include-tests

   The reading is a web page built for a screen, and three things about
   it do not survive being printed as-is:

     the five readouts are tabs, so four of the five are marked hidden
       and a straight print keeps only the one on top
     the conversation box prints as an empty form
     the folded rows print closed, taking the detail with them

   So each page is fetched, opened out, and printed. The page's own
   print stylesheet already handles the rest: white ground, the receipt
   inverted, the call to action dropped.

   Fonts are self-hosted at /assets, so the opened-out copy is served
   from the repo root rather than off the filesystem. That keeps the
   font files same-origin and the typography identical to the screen.

   Chrome runs against a throwaway profile. Without one it hands the
   page to the copy already running and prints nothing.
   ============================================================= */

var io = require('fs');
var path = require('path');
var http = require('http');
var os = require('os');
var { execFile } = require('child_process');
var run = require('util').promisify(execFile);

var ROOT = path.join(__dirname, '..');
var WORK = path.join(ROOT, '.pdfwork');
var OUT = process.env.MGI_PDF_OUT ||
  path.join(os.homedir(), 'Downloads', 'manager-gap-reports');
var CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
var ORIGIN = process.env.MGI_SITE_ORIGIN || 'https://managergap.com';
var PORT = 8931;

var includeTests = process.argv.indexOf('--include-tests') !== -1;

io.readFileSync('C:\\Users\\Administrator\\clover-agents\\.env', 'utf8')
  .split(/\r?\n/).forEach(function (line) {
    line = line.trim();
    if (!line || line[0] === '#' || line.indexOf('=') === -1) return;
    var i = line.indexOf('=');
    var k = line.slice(0, i).trim();
    var v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  });

var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
var SB = process.env.SUPABASE_URL.replace(/\/$/, '');

function rest(p) {
  return fetch(SB + '/rest/v1/' + p, {
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY }
  }).then(function (r) { return r.json(); });
}

/* The submission carries a first name only. Where the address is built the
   usual way it holds the surname, and a report with a full name on the file
   is a great deal easier to send to the person it belongs to. */
function titleCase(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).map(function (w) {
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

/* The submission carries a first name only. Where the address is built the
   usual way it holds the surname, and a report with a full name on the file
   is a great deal easier to send to the person it belongs to. */
function displayName(first, email) {
  var given = titleCase(first);
  var local = String(email || '').split('@')[0].toLowerCase();

  /* already a full name in the submission, so leave it alone */
  if (given.indexOf(' ') !== -1) return given;

  var parts = local.replace(/[0-9]+/g, ' ').split(/[._-]+/)
    .map(function (w) { return w.trim(); }).filter(Boolean);

  /* a short trailing fragment is a disambiguator, not a surname */
  if (parts.length > 2 && parts[parts.length - 1].length <= 3) parts.pop();

  if (parts.length >= 2 && parts[0] === given.toLowerCase()) {
    return parts.map(titleCase).join(' ');
  }

  /* first name and surname run together, with no separator between them */
  if (parts.length === 1 && given && parts[0].indexOf(given.toLowerCase()) === 0) {
    var rest = parts[0].slice(given.length);
    if (rest.length >= 3) return given + ' ' + titleCase(rest);
  }

  return given || titleCase(parts.join(' ')) || 'Unknown';
}

function safe(s) {
  return String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim();
}

/* ---- opening the page out ---- */

var PRINT_CSS = [
  '<style>',
  '@page{size:A4;margin:14mm 12mm}',
  /* the five readouts are tabs on screen and a list on paper */
  '.panel{display:block!important;margin:0 0 22px}',
  '.panel + .panel{padding-top:18px;border-top:1px solid rgba(23,22,26,.14)}',
  /* a form nobody can type into is not worth a page */
  '.talk{display:none!important}',
  '@media print{',
  '  .talk{display:none!important}',
  '  .panel{display:block!important}',
  '  section{break-inside:avoid-page}',
  '  .readout,.folds{break-inside:auto}',
  '  .masthead{break-after:avoid}',
  '  a{text-decoration:none;color:inherit}',
  '}',
  '</style>'
].join('\n');

function openOut(html) {
  return html
    /* Cloudflare injects this and it only slows the print down */
    .replace(/<script[^>]*cloudflare-static[^>]*>\s*<\/script>/gi, '')
    /* every readout, not just the one that happened to be on top */
    .replace(/(<div class="panel"[^>]*?)\s+hidden(\s*>)/gi, '$1$2')
    /* the folded rows carry the detail, so they go to paper open */
    .replace(/<details/gi, '<details open')
    .replace('</head>', PRINT_CSS + '\n</head>');
}

(async function () {
  if (!io.existsSync(CHROME)) {
    console.error('Chrome not found at ' + CHROME + '. Set CHROME_PATH.');
    process.exit(1);
  }
  [WORK, OUT].forEach(function (d) { io.mkdirSync(d, { recursive: true }); });

  var subs = await rest('mgi_v5_submissions?select=id,first_name,email,company,submitted_at&order=id.asc');
  var reads = await rest('mgi_readings?select=token,submission_id,payload,revoked_at&order=submission_id.asc');

  var rows = [];
  subs.forEach(function (s) {
    var r = reads.filter(function (x) { return x.submission_id === s.id; })[0];
    if (!r) { console.log('  no reading for submission ' + s.id + ', skipped'); return; }
    var isTest = /clivehays@gmail\.com/i.test(s.email || '');
    if (isTest && !includeTests) return;
    rows.push({
      id: s.id, token: r.token, email: s.email, company: s.company,
      name: displayName(s.first_name, s.email),
      state: (r.payload && r.payload.state_name) || 'unknown',
      hasReport: !!(r.payload && r.payload.eran),
      revoked: r.revoked_at, test: isTest
    });
  });

  console.log(rows.length + ' report(s) to build\n');

  /* served from the repo root so /assets/fonts.css and the woff2 files
     resolve exactly as they do in the browser */
  var server = http.createServer(function (req, res) {
    var rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    var file = path.join(ROOT, rel);
    if (file.indexOf(ROOT) !== 0 || !io.existsSync(file) || io.statSync(file).isDirectory()) {
      res.statusCode = 404; return res.end('no');
    }
    var type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css',
                 '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.end(io.readFileSync(file));
  });
  await new Promise(function (r) { server.listen(PORT, '127.0.0.1', r); });

  var profile = io.mkdtempSync(path.join(os.tmpdir(), 'mgi-chrome-'));
  var made = [], failed = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var label = (i + 1) + '/' + rows.length + '  ' + row.name;
    try {
      var res = await fetch(ORIGIN + '/r/' + row.token);
      if (!res.ok) throw new Error('page returned ' + res.status);
      var html = openOut(await res.text());

      var stem = safe(row.name) + (row.test ? ' (your own test)' : '');
      var work = path.join(WORK, row.token + '.html');
      io.writeFileSync(work, html);

      var pdf = path.join(OUT, stem + '.pdf');
      await run(CHROME, [
        '--headless', '--disable-gpu', '--no-sandbox',
        '--no-first-run', '--no-default-browser-check',
        '--user-data-dir=' + profile,
        '--no-pdf-header-footer',
        /* No virtual-time-budget. The page animates its rings, so virtual time
           never reaches the end and Chrome prints nothing at all. Left to
           itself it prints on load, in under two seconds. */
        '--print-to-pdf=' + pdf,
        'http://127.0.0.1:' + PORT + '/.pdfwork/' + row.token + '.html'
      ], { timeout: 120000 });

      if (!io.existsSync(pdf)) throw new Error('Chrome wrote no file');
      var kb = (io.statSync(pdf).size / 1024).toFixed(0);
      console.log(label + '  ->  ' + stem + '.pdf  (' + kb + ' KB, ' + row.state + ')');
      made.push({ name: row.name, file: stem + '.pdf', kb: +kb, state: row.state,
                  company: row.company, email: row.email });
    } catch (e) {
      console.log(label + '  ->  FAILED: ' + e.message);
      failed.push({ name: row.name, why: e.message });
    }
  }

  server.close();
  io.rmSync(WORK, { recursive: true, force: true });
  io.rmSync(profile, { recursive: true, force: true });

  console.log('\n' + made.length + ' built, ' + failed.length + ' failed');
  console.log('in ' + OUT);
  if (failed.length) failed.forEach(function (f) { console.log('  ' + f.name + ': ' + f.why); });
})();
