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

   Env:
     SUPABASE_URL
     SUPABASE_SERVICE_ROLE_KEY
     MGI_FUNNEL_TABLE   default mgi_funnel
   ============================================================= */

var TABLE = process.env.MGI_FUNNEL_TABLE || 'mgi_funnel';

var DEVICES = { mobile: 1, tablet: 1, desktop: 1 };

module.exports = async function handler(req, res) {
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

  var ok = await upsert(row);

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
      console.error('funnel upsert failed: ' + r.status + ' ' + (await r.text()));
      return false;
    }
    return true;
  } catch (e) {
    console.error('funnel upsert threw: ' + e.message);
    return false;
  }
}
