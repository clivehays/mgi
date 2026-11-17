/* =============================================================
   POST /api/selfcheck  ->  one row for a short self-check

   The ten-question scorecard at /self-check. The page has already shown
   the manager their result by the time this runs, so nothing here can
   cost them anything: a failure is logged and the visit is still a
   visit.

   The state, the instinct gap and the line of sight are RECOMPUTED here
   from the raw answers, with the same module the browser used, so the
   stored row can never disagree with the page that was on the screen.
   What the client sends for those fields is compared, not trusted, and
   a disagreement is logged loudly because it would mean the two copies
   of the instrument had drifted apart.

   No name, no email, no company. This table is answers, campaign labels
   and timings under a random per-visit number. Tying a row back to a
   person is a separate, deliberate act, done outside the request by
   scripts/join-linkedin-leads.py against a lead export.

   Environment:
     SUPABASE_URL                 required to store anything
     SUPABASE_SERVICE_ROLE_KEY    required to store anything
     MGI_SELFCHECK_TABLE          default mgi_selfcheck
   ============================================================= */

var MGI = require('../assets/scoring.js');
var SC = require('../assets/selfcheck-core.js');
var source = require('./source.js');

var TABLE = process.env.MGI_SELFCHECK_TABLE || 'mgi_selfcheck';

/* the five evidence items this form asks, read off the short form itself
   rather than restated, so the column list here follows the questions */
var ITEMS = SC.ITEMS;

/* the same wording the full table stores, so the two can be read
   together in one query */
var GAP_SUMMARY = {
  behind: 'Instinct behind the evidence',
  aligned: 'Aligned',
  ahead: 'Instinct ahead of the evidence'
};

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'Missing body' });
  }

  var answers = {
    gut: pick(MGI.GUT, body.gut),
    output: pick(MGI.OUTPUT, body.output),
    external: pick(MGI.EXTERNAL, body.external),
    energy: pick(MGI.ENERGY, body.energy),
    exposure: pick(MGI.EXPOSURE, body.exposure)
  };

  var items = (body.items && typeof body.items === 'object') ? body.items : {};
  var evidence = ITEMS.map(function (n) { return step(items['q' + n]); });

  var missing = Object.keys(answers).filter(function (k) { return answers[k] === null; });
  if (missing.length || evidence.indexOf(null) !== -1) {
    return res.status(400).json({ ok: false, error: 'Invalid answers' });
  }

  /* Read by the same function the page used, over the answers as
     validated here rather than as the client described them. */
  var r = SC.read([answers.gut].concat(evidence,
    [answers.output, answers.external, answers.energy, answers.exposure]));

  /* The page and this function run the same module over the same answers,
     so they cannot legitimately differ. If they do, one copy of the
     instrument is stale and every row from here on is suspect, which is
     worth a line in the log rather than a silent correction. */
  if (body.state && body.state !== r.state.name) {
    console.error('MGI_SELFCHECK_DISAGREEMENT client=' + String(body.state).slice(0, 40) +
      ' server=' + r.state.name);
  }

  var submittedAt = new Date().toISOString();

  var record = {
    form: SC.FORM,
    instrument_version: MGI.VERSION,
    instrument_fingerprint: MGI.FINGERPRINT,

    submitted_at: submittedAt,
    landed_at: stamp(body.landed_at),
    started_at: stamp(body.started_at),
    seconds_taken: count(body.seconds, 0, 86400),

    gut: answers.gut,
    output: answers.output,
    external_pressure: answers.external,
    energy: answers.energy,
    exposure: answers.exposure,

    signal: r.signal,
    behaviour_mean: Number(r.mean.toFixed(2)),
    state: r.state.name,
    decision_rule: r.rule,
    gap: GAP_SUMMARY[r.gap.key],
    line_of_sight: r.lineOfSight.label,
    line_of_sight_score: r.lineOfSight.score,
    stale: r.stale,
    /* the question that has gone longest, named by the short form rather
       than by the client */
    focus: SC.ITEM_META[r.focus].name,

    visit_id: token(body.visit_id, 64),
    lead_form: label(body.lf, 40),
    referrer_host: host(body.referrer_host),
    cookie_consent: body.cookieConsent === true,
    internal: body.internal === true
  };

  ITEMS.forEach(function (n, i) { record['q' + n] = evidence[i]; });

  /* The campaign labels, cleaned by the same module the full assessment
     uses. li_fat_id is kept only when the same request says the cookie
     banner was accepted, which is that module's rule, not this one's. */
  var src = source.cleanSource(body.source, body.cookieConsent === true);
  if (src) record.source = src;

  /* a durable trace whatever the database does next */
  console.log('MGI_SELFCHECK ' + JSON.stringify(record));

  var stored = await store(record);
  if (!stored) {
    console.error('MGI selfcheck not stored, the log line above is the only copy');
  }

  return res.status(200).json({ ok: true, stored: stored });
};

/* ---------- validation ----------
   Every answer is checked against the instrument's own option list, so
   a value this build does not recognise cannot reach the table. */

function pick(item, value) {
  if (typeof value !== 'string') return null;
  for (var i = 0; i < item.options.length; i++) {
    if (item.options[i].value === value) return value;
  }
  return null;
}

function step(value) {
  return (value === 0 || value === 1 || value === 2 || value === 3) ? value : null;
}

function clean(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

function label(v, max) {
  var s = clean(v, max).toLowerCase();
  return /^[a-z0-9_.-]+$/.test(s) ? s : null;
}

function token(v, max) {
  var s = clean(v, max);
  return /^[a-f0-9]{8,}$/.test(s) ? s : null;
}

function host(v) {
  var s = clean(v, 64).toLowerCase();
  return /^[a-z0-9.-]+$/.test(s) ? s : null;
}

function count(v, lo, hi) {
  var n = Number(v);
  if (!isFinite(n)) return null;
  n = Math.round(n);
  return (n >= lo && n <= hi) ? n : null;
}

/* a timestamp the client measured. Kept because it is the only record of
   when the visit began, which is what a lead export is matched against,
   and bounded so a wrong clock cannot write a date from another century. */
function stamp(v) {
  var s = clean(v, 40);
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(s)) return null;
  var t = Date.parse(s);
  if (!isFinite(t)) return null;
  var now = Date.now();
  if (t < now - 7 * 24 * 60 * 60 * 1000 || t > now + 60 * 60 * 1000) return null;
  return s;
}

/* ---------- the store ---------- */

async function store(record) {
  var url = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('MGI selfcheck store skipped: SUPABASE_URL or key not set');
    return false;
  }

  try {
    var res = await fetch(url.replace(/\/$/, '') + '/rest/v1/' + TABLE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: 'Bearer ' + key,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(record)
    });
    if (!res.ok) {
      console.error('MGI selfcheck store failed: ' + res.status + ' ' + (await res.text()));
      return false;
    }
    return true;
  } catch (e) {
    console.error('MGI selfcheck store threw: ' + e.message);
    return false;
  }
}
