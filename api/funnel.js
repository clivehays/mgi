/* =============================================================
   Funnel telemetry.

   Only completed assessments reach mgi_v5_submissions, so without this
   there is no way to tell three finishers out of five from three out of
   fifty. This records how far people get and nothing else.

   What it deliberately does NOT hold: any answer, any name, email,
   company or role, any IP, any full user-agent string. People abandon
   BEFORE the consent checkbox, so nothing recorded here can be personal
   or research data. It is operational only: a random per-visit id, the
   furthest question reached, two flags and a coarse device word.

   The id lives in sessionStorage and dies with the tab. It is not linked
   to the submission row, so an abandoned run can never be tied back to
   anyone, and a completed one cannot be joined to its answers.

   `source` is the campaign labels from the landing URL (utm_* and s).
   It is written only when SAVE_SOURCE=1. With that unset the field is
   left off the row, so a table without the column does not error.

   `step` is the furthest milestone as a word (landing, start, q1, q5,
   q10, q15, q20, contact, submitted), so a Start press with no answer
   yet is visible. `client` holds three coarse bot signals worked out
   here, never the raw values: a user-agent class (human, headless,
   linkedinbot, bot), whether navigator.webdriver was set, and whether
   the reported screen and window sizes are impossible together. The
   user-agent string and the sizes themselves are not stored.

   Both columns are optional: if the table does not have them yet the
   row is written again without them.

   Env:
     SUPABASE_URL
     SUPABASE_SERVICE_ROLE_KEY
     MGI_FUNNEL_TABLE   default mgi_funnel
     SAVE_SOURCE        set to 1 once the source column exists
   ============================================================= */

var TABLE = process.env.MGI_FUNNEL_TABLE || 'mgi_funnel';
var applySource = require('./source.js').applySource;

var DEVICES = { mobile: 1, tablet: 1, desktop: 1 };
var STEPS = { landing: 1, start: 1, q1: 1, q5: 1, q10: 1, q15: 1, q20: 1, contact: 1, submitted: 1 };

/* Coarse class only. Order matters: headless first, then LinkedIn's own
   crawler, then anything else that announces itself as automated. */
function uaClass(ua) {
  ua = String(ua || '');
  if (!ua) return 'bot';
  if (/HeadlessChrome|PhantomJS|Puppeteer|Playwright|Lighthouse|Chrome-Lighthouse|Selenium|webdriver/i.test(ua)) return 'headless';
  if (/LinkedInBot|LinkedIn-?Preview/i.test(ua)) return 'linkedinbot';
  if (/bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|embedly|curl\/|wget\/|python-|python\/|node-fetch|axios\/|go-http-client|okhttp|java\/|libwww|httpclient|scrapy|validator|monitor|pingdom|uptime/i.test(ua)) return 'bot';
  return 'human';
}

function num(v) {
  var n = Number(v);
  return isFinite(n) && n >= 0 && n < 100000 ? n : null;
}

/* A window wider or taller than its own screen (beyond zoom slack), a
   zero screen, or a phone user-agent on a desktop-sized screen. */
function screenFlag(c, ua) {
  if (!c || typeof c !== 'object') return null;
  var sw = num(c.sw), sh = num(c.sh), vw = num(c.vw), vh = num(c.vh);
  if (sw === null || sh === null || vw === null || vh === null) return null;
  if (!sw || !sh || !vw || !vh) return 'mismatch';
  if (vw > sw * 1.6 || vh > sh * 1.6) return 'mismatch';
  if (/Mobile|iPhone|Android.+Mobile/i.test(String(ua || '')) && Math.min(sw, sh) > 1000) return 'mismatch';
  return 'ok';
}

function clientInfo(body, ua) {
  var c = body && body.client;
  var out = { ua: uaClass(ua) };
  if (c && typeof c === 'object') {
    out.wd = c.wd === true;
    var scr = screenFlag(c, ua);
    if (scr) out.scr = scr;
  }
  return out;
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false });
  }

  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false });
  }

  /* a 12 to 64 char opaque token the client generated; anything else is
     discarded rather than stored, so this cannot be used to smuggle data in */
  var sid = typeof body.sid === 'string' ? body.sid : '';
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(sid)) {
    return res.status(400).json({ ok: false });
  }

  var furthest = Number(body.furthest);
  if (!isFinite(furthest) || furthest < 0 || furthest > 40) furthest = 0;

  var row = {
    sid: sid,
    furthest: Math.floor(furthest),
    reached_contact: body.reachedContact === true,
    submitted: body.submitted === true,
    device: DEVICES[body.device] ? body.device : 'unknown',
    updated_at: new Date().toISOString()
  };

  var extra = {
    step: STEPS[body.step] ? body.step : null,
    client: clientInfo(body, req.headers && req.headers['user-agent'])
  };
  if (!extra.step) delete extra.step;

  applySource(row, body);

  var ok = await upsert(Object.assign({}, row, extra));
  /* the step and client columns may not exist yet; the visit still counts */
  if (ok === 'missing-column') ok = await upsert(row);
  ok = ok === true;

  /* never let telemetry failure surface to the visitor: the assessment
     does not depend on it and a red console line helps nobody */
  return res.status(200).json({ ok: ok });
};

async function upsert(row) {
  var url = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;

  try {
    /* merge-duplicates so a later beacon overwrites the earlier row for
       the same visit. The furthest question only ever moves forward,
       which is enforced by a trigger-free guard: the client sends the
       running maximum it has seen. */
    var r = await fetch(url.replace(/\/$/, '') + '/rest/v1/' + TABLE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: 'Bearer ' + key,
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(row)
    });
    if (!r.ok) {
      var text = await r.text();
      if (r.status === 400 && /PGRST204|column/i.test(text) && (row.step !== undefined || row.client !== undefined)) {
        return 'missing-column';
      }
      console.error('funnel upsert failed: ' + r.status + ' ' + text);
      return false;
    }
    return true;
  } catch (e) {
    console.error('funnel upsert threw: ' + e.message);
    return false;
  }
}

module.exports = handler;
module.exports.uaClass = uaClass;
module.exports.screenFlag = screenFlag;
module.exports.clientInfo = clientInfo;
