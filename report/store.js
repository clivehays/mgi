/* =============================================================
   store.js  ·  the reading, the conversation, the trial

   One place that knows the table names, so a preview deployment can be
   pointed somewhere else with two environment variables and nothing in
   the conversation ever lands in the live record.
   ============================================================= */

var READINGS = process.env.MGI_READINGS_TABLE || 'mgi_readings';

/* the conversation tables share the readings prefix, so preview stays
   preview without a third and fourth variable to keep in step */
var PREFIX = READINGS.replace(/readings$/, '');
var CONVERSATIONS = PREFIX + 'conversations';
var RATE = PREFIX + 'ask_rate';

function rest(path, opts) {
  var url = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Promise.resolve(null);
  opts = opts || {};
  opts.headers = Object.assign({
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: 'Bearer ' + key
  }, opts.headers || {});
  return fetch(url.replace(/\/$/, '') + '/rest/v1/' + path, opts);
}

async function rows(path) {
  var r = await rest(path);
  if (!r || !r.ok) return [];
  return await r.json();
}

/* ---------- the reading ---------- */

async function reading(token) {
  var got = await rows(READINGS + '?token=eq.' + encodeURIComponent(token) +
    '&select=token,submission_id,payload,revoked_at');
  var row = got[0];
  if (!row || row.revoked_at) return null;
  return row;
}

/* ---------- the conversation ---------- */

async function history(token) {
  return rows(CONVERSATIONS + '?token=eq.' + encodeURIComponent(token) +
    '&select=turn,role,text,state,stop,offered,raised_step,unanswered' +
    '&order=turn.asc');
}

/* Section 8. Who put the forward step on the table first, across the
   whole conversation. If this reads eran more often than about one in
   three, the objective has drifted back and the prompt is the thing to
   look at. */
async function whoRaisedStep(token) {
  var got = await rows(CONVERSATIONS + '?token=eq.' + encodeURIComponent(token) +
    '&raised_step=not.is.null&select=turn,raised_step&order=turn.asc&limit=1');
  return got[0] ? got[0].raised_step : null;
}

/* Checks what came back. Written without this it swallowed every
   failure, and a conversation that is not being stored looks exactly
   like one that is until Eran forgets the previous turn. */
async function addTurns(token, turns) {
  var r = await rest(CONVERSATIONS, {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    /* Every object in a bulk insert must carry the same keys or
       PostgREST rejects the lot with "All object keys must match". The
       manager's turn has a shape and no exit, the reply has an exit and
       no shape, so both are filled out to the same shape here. */
    body: JSON.stringify(turns.map(function (t) {
      return {
        token: token,
        turn: t.turn,
        role: t.role,
        text: t.text,
        state: t.state === undefined ? null : t.state,
        shape: t.shape === undefined ? null : t.shape,
        exit: t.exit === undefined ? null : t.exit,
        stop: t.stop === true,
        refusal: t.refusal === undefined ? null : t.refusal,
        faults: t.faults === undefined ? null : t.faults,
        raised_step: t.raised_step === undefined ? null : t.raised_step,
        offered: t.offered === true,
        unanswered: t.unanswered === undefined ? null : t.unanswered
      };
    }))
  });
  if (!r) {
    console.error('MGI turns not stored: no store configured');
    return false;
  }
  if (!r.ok) {
    console.error('MGI turns not stored: ' + r.status + ' ' + (await r.text()));
    return false;
  }
  return true;
}

/* Twelve exchanges a day, forty in all. Counted from the manager's own
   turns, so a reply that never arrived is not held against them. */
async function counts(token) {
  var all = await rows(CONVERSATIONS + '?token=eq.' + encodeURIComponent(token) +
    '&role=eq.manager&select=created_at');
  var today = new Date().toISOString().slice(0, 10);
  return {
    total: all.length,
    today: all.filter(function (r) {
      return String(r.created_at).slice(0, 10) === today;
    }).length
  };
}

/* One row per address per day. Not a precise limiter, and it is not
   meant to be: it is there so one script cannot spend the model budget
   for every manager holding a live link. */
async function rateHit(ip, ceiling) {
  if (!ip) return true;
  var day = new Date().toISOString().slice(0, 10);
  var got = await rows(RATE + '?ip=eq.' + encodeURIComponent(ip) +
    '&day=eq.' + day + '&select=hits');
  var hits = got[0] ? got[0].hits : 0;
  if (hits >= ceiling) return false;

  await rest(RATE, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ip: ip, day: day, hits: hits + 1 })
  });
  return true;
}

module.exports = {
  rest: rest,
  rows: rows,
  reading: reading,
  history: history,
  whoRaisedStep: whoRaisedStep,
  addTurns: addTurns,
  counts: counts,
  rateHit: rateHit,
  READINGS: READINGS,
  CONVERSATIONS: CONVERSATIONS,
  RATE: RATE
};
