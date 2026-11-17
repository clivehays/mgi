/* =============================================================
   Re-measure the short self-check against the cohort, and print the
   COHORT block for assets/selfcheck-core.js.

   Two jobs, because they answer the same question from the same pull:

     1. Do the five items the short form asks still name the same state
        as the full fifteen? That is the claim the landing page makes, and
        it is a fact about the cohort, so it has to be re-measured as the
        cohort grows rather than assumed.

     2. What are the figures the scorecard quotes? It prints a COHORT
        block to paste into assets/selfcheck-core.js, which is the only
        place those numbers live.

   It also scores every other five-item subset, so if a different five
   overtakes the current choice you will see it here rather than find out
   later.

   Reads the submissions table directly. No personal data is printed:
   answers, states and counts only.

     node scripts/selfcheck-cohort.js
     node scripts/selfcheck-cohort.js --all      include the founder's own rows

   Needs SUPABASE_URL and a service key, read from clover-agents/.env if
   they are not already in the environment.
   ============================================================= */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var MGI = require(path.join(ROOT, 'assets', 'scoring.js'));
var SC = require(path.join(ROOT, 'assets', 'selfcheck-core.js'));

var ENV = 'C:\\Users\\Administrator\\clover-agents\\.env';
var TABLE = process.env.MGI_TABLE || 'mgi_v5_submissions';
var ALL = process.argv.indexOf('--all') !== -1;

/* The founder's own test submissions are not managers answering about a
   team, so they are out of the cohort by default. Matched on company,
   which is what those rows carry. */
var OWN = /nymble/i;

var BEHAVIOUR_ITEMS = [1, 2, 5, 6, 9, 10, 11, 12];

/* The function runs with SUPABASE_SERVICE_ROLE_KEY. The .env file on the
   machine this is run from calls the same secret SUPABASE_SERVICE_KEY, so
   both names are accepted rather than one of them being renamed under a
   running deploy. */
function env() {
  if (!fs.existsSync(ENV)) return;
  fs.readFileSync(ENV, 'utf8').split(/\r?\n/).forEach(function (line) {
    line = line.trim();
    if (!line || line.charAt(0) === '#' || line.indexOf('=') === -1) return;
    var i = line.indexOf('=');
    var k = line.slice(0, i).trim();
    var v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[k]) process.env[k] = v;
  });
}

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
}

async function pull() {
  env();
  var url = process.env.SUPABASE_URL;
  var key = serviceKey();
  if (!url || !key) {
    throw new Error('SUPABASE_URL and a service key are needed ' +
      '(SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY)');
  }

  var cols = ['id', 'submitted_at', 'company', 'gut', 'output', 'external_pressure',
    'energy', 'exposure', 'state', 'gap', 'instrument_fingerprint'];
  for (var i = 1; i <= 15; i++) cols.push('q' + i);

  var out = [];
  var from = 0;
  var page = 1000;
  for (;;) {
    var res = await fetch(url.replace(/\/$/, '') + '/rest/v1/' + TABLE +
      '?select=' + cols.join(',') + '&order=submitted_at.asc', {
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        Range: from + '-' + (from + page - 1)
      }
    });
    if (!res.ok) throw new Error('read failed: ' + res.status + ' ' + (await res.text()));
    var rows = await res.json();
    out = out.concat(rows);
    if (rows.length < page) break;
    from += page;
  }
  return out;
}

function evidence(r) {
  var e = [];
  for (var i = 1; i <= 15; i++) e.push(r['q' + i]);
  return e;
}

function full(r) {
  return MGI.score({
    gut: r.gut, evidence: evidence(r), output: r.output,
    external: r.external_pressure, energy: r.energy, exposure: r.exposure
  });
}

/* the state the short form would have called, from a chosen subset */
function shortState(r, items) {
  var e = evidence(r);
  var mean = items.reduce(function (t, n) { return t + e[n - 1]; }, 0) / items.length;
  return MGI.partialState(mean, r.output, r.external_pressure, r.energy, r.gut);
}

function combos(arr, k) {
  var out = [];
  (function rec(start, cur) {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (var i = start; i < arr.length; i++) {
      cur.push(arr[i]);
      rec(i + 1, cur);
      cur.pop();
    }
  })(0, []);
  return out;
}

function median(a) {
  var s = a.slice().sort(function (x, y) { return x - y; });
  return s[Math.floor(s.length / 2)];
}

(async function () {
  var rows = await pull();
  var usable = rows.filter(function (r) {
    if (r.gut === null || r.q1 === null) return false;
    for (var i = 1; i <= 15; i++) if (r['q' + i] === null) return false;
    return ALL || !OWN.test(r.company || '');
  });

  console.log('pulled ' + rows.length + ' row(s), ' + usable.length + ' usable' +
    (ALL ? '' : ' (the founder\'s own rows excluded; pass --all to include them)'));

  /* fingerprints: rows from a different instrument must not be pooled */
  var prints = {};
  usable.forEach(function (r) {
    prints[r.instrument_fingerprint] = (prints[r.instrument_fingerprint] || 0) + 1;
  });
  console.log('instrument fingerprints: ' + JSON.stringify(prints));
  if (Object.keys(prints).length > 1 || !prints[MGI.FINGERPRINT]) {
    console.log('  WARNING: more than one instrument is represented, or none matches this');
    console.log('  build (' + MGI.FINGERPRINT + '). Figures below mix instruments.');
  }

  /* ---------- 1. does the current five still hold ---------- */

  console.log('\n--- the five the short form asks: q' + SC.ITEMS.join(', q') + ' ---');
  var sameState = 0;
  var sameGap = 0;
  var misses = [];
  usable.forEach(function (r) {
    var f = full(r);
    var s = shortState(r, SC.ITEMS);
    if (f.state.name === s.state.name) sameState++;
    else misses.push('row ' + r.id + ': full ' + f.state.name + ', short ' + s.state.name);
    if (f.gap.key === s.gap.key) sameGap++;
  });
  console.log('  same state as the full fifteen: ' + sameState + ' of ' + usable.length);
  console.log('  same instinct gap:              ' + sameGap + ' of ' + usable.length);
  if (misses.length) console.log('  ' + misses.join('\n  '));

  /* ---------- 2. is a different five now better ---------- */

  console.log('\n--- every five-item subset, best first ---');
  var ranked = combos(BEHAVIOUR_ITEMS, 5).map(function (items) {
    var n = 0;
    usable.forEach(function (r) {
      if (shortState(r, items).state.name === full(r).state.name) n++;
    });
    return { items: items, n: n };
  }).sort(function (a, b) { return b.n - a.n; });

  ranked.slice(0, 8).forEach(function (s) {
    var mark = s.items.join() === SC.ITEMS.join() ? '  <- the current set' : '';
    console.log('  q' + s.items.join(', q') + '   ' + s.n + ' of ' + usable.length + mark);
  });
  var current = ranked.filter(function (s) { return s.items.join() === SC.ITEMS.join(); })[0];
  var place = ranked.indexOf(current) + 1;
  console.log('  the current set ranks ' + place + ' of ' + ranked.length +
    (place === 1 ? ', still the best' : ', so a different five now does better'));

  /* ---------- 3. the block to paste ---------- */

  var states = {};
  Object.keys(MGI.STATES).forEach(function (k) { states[MGI.STATES[k].name] = 0; });
  var gaps = { aligned: 0, ahead: 0, behind: 0 };
  var signals = [];
  var latest = '';
  usable.forEach(function (r) {
    var f = full(r);
    states[f.state.name]++;
    gaps[f.gap.key]++;
    var e = evidence(r);
    signals.push(SC.ITEMS.reduce(function (t, n) { return t + e[n - 1]; }, 0));
    if (String(r.submitted_at) > latest) latest = String(r.submitted_at);
  });

  var asAt = new Date(latest);
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var asAtText = asAt.getUTCDate() + ' ' + MONTHS[asAt.getUTCMonth()] + ' ' +
    asAt.getUTCFullYear();

  console.log('\n--- paste into assets/selfcheck-core.js ---\n');
  console.log('  var COHORT = {');
  console.log('    n: ' + usable.length + ',');
  console.log('    asAt: \'' + asAtText + '\',');
  console.log('    states: { Cruise: ' + states.Cruise + ', Drift: ' + states.Drift +
    ', Headwinds: ' + states.Headwinds + ', Stall: ' + states.Stall + ' },');
  console.log('    aligned: ' + gaps.aligned + ',');
  /* ahead means the gut read worse than the evidence supports; behind means
     it read better. The names are the instrument's; these are the words the
     page uses, and getting them the wrong way round has happened before. */
  console.log('    feltWorse: ' + gaps.ahead + ',');
  console.log('    feltBetter: ' + gaps.behind + ',');
  console.log('    medianSignal: ' + median(signals));
  console.log('  };');

  console.log('\n  (mean score on the five: ' + (signals.reduce(function (a, b) {
    return a + b;
  }, 0) / signals.length).toFixed(1) + ' of 15, range ' +
    Math.min.apply(null, signals) + ' to ' + Math.max.apply(null, signals) + ')');

  var sum = states.Cruise + states.Drift + states.Headwinds + states.Stall;
  if (sum !== usable.length || gaps.aligned + gaps.ahead + gaps.behind !== usable.length) {
    console.log('\n  WARNING: the counts do not sum to n. Do not paste this.');
    process.exit(1);
  }
}()).catch(function (e) {
  console.error('\n' + e.message);
  process.exit(1);
});
