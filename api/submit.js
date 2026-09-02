/* =============================================================
   Manager Gap Index v5 - submission handler

   Stores the submission, emails Clive the raw answers as call
   prep, and emails the manager their report. The state, the
   line of sight, gap width and the instinct gap are recomputed here
   from the raw answers using the same module the browser uses, so the email
   can never disagree with the page the manager saw.

   Environment:
     RESEND_API_KEY              required for email
     MGI_NOTIFY_EMAIL            where Clive's notification lands
     MGI_FROM_EMAIL              from address on the manager's report
     MGI_NOTIFY_FROM             from address on the notification only.
                                 Defaults to MGI_FROM_EMAIL. Worth setting to
                                 a different domain if the notification is
                                 addressed to the same mailbox it is sent
                                 from, which some filters treat as spoofing.
     MGI_REPLY_TO                reply-to on the manager's report. Defaults to
                                 MGI_NOTIFY_EMAIL. Load-bearing: the closing
                                 block tells the manager to reply to it.
     MGI_FALLBACK_FROM           a from address on a domain the API key is
                                 known to allow. If a send is refused because
                                 the configured domain is not authorised, the
                                 message is retried from here rather than lost.
     SUPABASE_URL                optional, durable store
     SUPABASE_SERVICE_ROLE_KEY   optional, durable store
     MGI_TABLE                   default mgi_v5_submissions
   ============================================================= */

var MGI = require('../assets/scoring.js');

var NOTIFY_TO = process.env.MGI_NOTIFY_EMAIL || 'contact@cloverera.com';
var FROM = process.env.MGI_FROM_EMAIL || 'The Manager Gap Index <mgi@cloverera.com>';
var NOTIFY_FROM = process.env.MGI_NOTIFY_FROM || FROM;
var REPLY_TO = process.env.MGI_REPLY_TO || NOTIFY_TO;
var FALLBACK_FROM = process.env.MGI_FALLBACK_FROM || '';
var TABLE = process.env.MGI_TABLE || 'mgi_v5_submissions';

/* the signal denominator comes from the instrument, so it can never
   disagree with the page the way a hardcoded 36 did */
var SIGNAL_MAX = MGI.EVIDENCE.length * 3;

var GAP_SUMMARY = {
  behind: 'Instinct behind the evidence',
  aligned: 'Aligned',
  ahead: 'Instinct ahead of the evidence'
};

module.exports = async function handler(req, res) {
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

  // honeypot: accept quietly, do nothing
  if (body.website) {
    return res.status(200).json({ ok: true });
  }

  var answers = {
    gut: body.gut,
    evidence: body.evidence,
    output: body.output,
    external: body.external,
    energy: body.energy,
    exposure: body.exposure
  };

  /* consent is a gate, not a field. Storing answers for research without it
     would be the one failure this instrument cannot recover from. */
  if (body.consent !== true) {
    return res.status(400).json({ ok: false, error: 'Consent required' });
  }

  if (!MGI.validAnswers(answers)) {
    return res.status(400).json({ ok: false, error: 'Invalid answers' });
  }

  var contact = {
    firstName: clean(body.firstName, 80),
    email: clean(body.email, 160),
    company: clean(body.company, 120),
    role: clean(body.role, 120),
    industry: clean(body.industry, 60),
    industryOther: clean(body.industryOther, 80),
    teamSize: clean(body.teamSize, 20) || 'Not given',
    currentlyLeading: clean(body.currentlyLeading, 20) || 'Not given',
    tenure: clean(body.tenure, 20) || 'Not given',
    /* research only: never reaches the report or the scoring */
    left6m: clean(body.left6m, 20) || 'Not given',
    joined6m: clean(body.joined6m, 20) || 'Not given',
    consentAt: clean(body.consentAt, 40)
  };

  /* what to show a human: the free text when they chose Other, the option otherwise */
  contact.industryLabel = (contact.industry === 'Other' && contact.industryOther)
    ? contact.industryOther
    : (contact.industry || 'Not given');

  if (!contact.firstName || !contact.company || !contact.role) {
    return res.status(400).json({ ok: false, error: 'Missing contact fields' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
    return res.status(400).json({ ok: false, error: 'Invalid email' });
  }

  var submittedAt = new Date().toISOString();
  var result = MGI.score(answers);

  /* One column per answer, not just the jsonb blob. This table is meant to be
     interrogated as a cohort later, and "mean of item 9 by industry" should be
     plain SQL rather than json extraction. The blob is kept alongside for
     fidelity and for anything the columns do not anticipate. */
  var record = {
    /* which instrument produced this row; see scoring.js.
       collected_under records what this participant actually saw and is
       never rewritten. instrument_version tracks the derived columns and
       a backfill may move it. */
    instrument_version: MGI.VERSION,
    instrument_fingerprint: MGI.FINGERPRINT,
    collected_under: MGI.VERSION,

    submitted_at: submittedAt,
    first_name: contact.firstName,
    email: contact.email,
    company: contact.company,
    role: contact.role,
    industry: contact.industryLabel,
    industry_option: contact.industry || null,
    currently_leading: contact.currentlyLeading,
    team_size: contact.teamSize,
    tenure: contact.tenure,
    left_6m: contact.left6m,
    joined_6m: contact.joined6m,
    consent: true,
    consent_at: clean(body.consentAt, 40) || submittedAt,

    gut: answers.gut,
    output: answers.output,
    external_pressure: answers.external,
    energy: answers.energy,
    exposure: answers.exposure,

    state: result.state.name,
    decision_rule: result.rule,
    line_of_sight_score: result.lineOfSight.score,
    line_of_sight: result.lineOfSight.label,
    mean_recency: result.meanRecency,
    gap_index: result.gapIndex,
    gap_width: result.gapWidth.label,
    /* deprecated 6.1.0, written so the export contract holds */
    confidence: result.confidence.label,
    gap: GAP_SUMMARY[result.gap.key],
    signal: result.signal,
    behaviour: Number(result.behaviour.toFixed(2)),
    weak_areas: result.weakCount,
    area_ranking: result.ranked.map(function (a) { return a.name; }).join(' | '),

    answers: answers
  };

  // the evidence items, q1 through q15
  for (var q = 0; q < answers.evidence.length; q++) {
    record['q' + (q + 1)] = answers.evidence[q];
  }

  // per-area means, so segmentation does not have to recompute them
  result.areas.forEach(function (a) {
    record['area_' + a.key] = Number(a.mean.toFixed(2));
    record['area_' + a.key + '_recency'] = a.best;
  });

  // always leave a durable trace in the platform log, whatever else fails
  console.log('MGI_SUBMISSION ' + JSON.stringify(record));

  /* ---------- the submit sequence, spec section 6 ----------
     Strictly this order, and only step 1 may fail the request. Steps 3
     to 5 are best effort. A submission is a lead, and nothing here may
     lose one. */

  /* 1. Persist the raw submission. The only step allowed to fail. */
  var stored = await store(record);

  /* 2. Mint the token and insert the reading with a null payload. */
  var token = mintToken();
  var haveReading = await createReading(token, contact, submittedAt);
  if (!haveReading) token = null;

  /* 3. Compute the numbers and store them. Fast, deterministic, and in
        the request, so the row is never without them for long. On
        failure the row keeps its null payload and the route computes on
        view instead, which is why a compute bug cannot cost a lead. */
  var payload = null;
  if (token) {
    try {
      payload = numbersOf.compute(answers, contact, {
        copy_to: contact.email,
        generated_at: submittedAt.slice(0, 10)
      });
      await updateReading(token, payload);
    } catch (e) {
      console.error('MGI compute failed at submit for ' + token + ': ' + e.message);
      payload = null;
    }
  }

  /* Clive's copy of the raw answers goes now, in the request. It is call
     prep and it does not depend on anything below. */
  var notified = await sendEmail(notification(contact, result, submittedAt));

  /* 4 and 5. Eran, then the manager's email, after the response has gone.
     Eran takes the better part of a minute, and nobody should watch a
     spinner for it. Sending the email only once Eran has returned makes
     the email's arrival the signal that the page is ready, which is what
     the order in section 6 is for.

     If the platform kills the background work, the reading page builds
     it on first open instead, and Clive still holds the lead from the
     notification above. */
  var finish = (async function () {
    if (!token || !payload) {
      return sendEmail(mail.pending(contact));
    }
    try {
      payload.eran = await eran.write(payload, answers);
      if (payload.eran) await updateReading(token, payload);
    } catch (e) {
      console.error('MGI Eran failed at submit for ' + token + ': ' + e.message);
    }
    return sendEmail(mail.reading(contact, payload, token));
  })();

  background(finish);

  /* The submission is processed regardless. A failed notification is ours to
     chase, not the manager's: it is logged above and the raw answers are in the
     MGI_SUBMISSION line, so nothing is lost. */
  if (!notified) {
    console.error('MGI notification failed for ' + contact.email + ', submission still recorded');
  }

  /* sending is what the client tells them about, not sent: the message
     goes out behind this response and cannot be reported on here. */
  return res.status(200).json({
    ok: true,
    stored: stored,
    notified: notified,
    sending: !!(token && payload),
    email: contact.email
  });
};

/* Work that outlives the response. On the platform this runs on, the
   request would otherwise be frozen the moment the response goes; the
   local fallback just lets the promise run and swallows its rejection,
   so nothing here throws into an already-answered request. */
function background(promise) {
  var quiet = Promise.resolve(promise).catch(function (e) {
    console.error('MGI background work failed: ' + e.message);
  });
  try {
    require('@vercel/functions').waitUntil(quiet);
  } catch (e) {
    /* not on the platform, or the helper is unavailable */
  }
}

/* ---------- helpers ---------- */

function clean(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------- durable store ---------- */

async function store(record) {
  var url = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;

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
      console.error('MGI store failed: ' + res.status + ' ' + (await res.text()));
      return false;
    }
    return true;
  } catch (e) {
    console.error('MGI store threw: ' + e.message);
    return false;
  }
}

/* ---------- email transport ---------- */

async function post(key, msg) {
  var res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key
    },
    body: JSON.stringify(msg)
  });
  return { ok: res.ok, status: res.status, body: res.ok ? '' : await res.text() };
}

/* Moving the sending domain is a two-part change: the address here and the
   scope of the API key. Get them out of step and every message is refused,
   which costs a real manager the report they just answered twenty
   questions for. So a refusal that names the domain is retried from an
   address the key is known to allow. */
function isDomainRefusal(status, body) {
  return status === 403 && /not authorized to send emails from|restricted/i.test(body || '');
}

async function sendEmail(msg) {
  var key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error('MGI email skipped: RESEND_API_KEY not set');
    return false;
  }
  try {
    var r = await post(key, msg);
    if (r.ok) return true;

    if (isDomainRefusal(r.status, r.body) && FALLBACK_FROM && msg.from !== FALLBACK_FROM) {
      console.error('MGI email refused for ' + msg.from + ', retrying from ' + FALLBACK_FROM + ': ' + r.body);
      var retry = Object.assign({}, msg, { from: FALLBACK_FROM });
      var r2 = await post(key, retry);
      if (r2.ok) return true;
      console.error('MGI fallback also failed: ' + r2.status + ' ' + r2.body);
      return false;
    }

    console.error('MGI email failed: ' + r.status + ' ' + r.body);
    return false;
  } catch (e) {
    console.error('MGI email threw: ' + e.message);
    return false;
  }
}

/* ---------- notification to Clive (call prep) ---------- */

function notification(contact, result, submittedAt) {
  var lines = [];
  lines.push('Name: ' + contact.firstName);
  lines.push('Email: ' + contact.email);
  lines.push('Company: ' + contact.company);
  lines.push('Role: ' + contact.role);
  lines.push('Industry: ' + contact.industryLabel);
  lines.push('Leading this team now: ' + contact.currentlyLeading);
  lines.push('Team size: ' + contact.teamSize);
  lines.push('Leading this team: ' + contact.tenure);
  lines.push('Left in 6 months: ' + contact.left6m + '   Joined: ' + contact.joined6m);
  lines.push('Consent: given at ' + (contact.consentAt || submittedAt));
  lines.push('Submitted: ' + submittedAt);
  lines.push('');
  lines.push('State: ' + result.state.name + ' (decision rule ' + result.rule + ')');
  lines.push('Line of sight: ' + result.lineOfSight.label +
             '   Gap width: ' + result.gapWidth.label +
             ' (index ' + result.gapIndex.toFixed(2) + ')');
  lines.push('Exposure: ' + result.exposure.label);
  lines.push('Gap: ' + GAP_SUMMARY[result.gap.key]);
  lines.push('Gut read: ' + result.gap.gutLabel);
  lines.push('');
  lines.push('Signal score: ' + result.signal + '/' + SIGNAL_MAX +
             '   Behaviour score B: ' + result.behaviour.toFixed(2));
  lines.push('');
  lines.push('AREA RANKING (weakest first)');
  result.ranked.forEach(function (a, i) {
    lines.push('  ' + (i + 1) + '. ' + a.name);
    lines.push('     ' + a.recencyFact + (a.isWeak ? '   [weak]' : ''));
  });
  if (result.summary) {
    lines.push('');
    lines.push('  ' + result.weakCount + ' of 5 areas weak, summary block shown instead of callouts.');
  }
  lines.push('');
  lines.push('ANSWERS');
  lines.push('');

  result.responses.forEach(function (item, i) {
    lines.push('Q' + i + '. ' + item.question);
    lines.push('    ' + item.label + (item.kind === 'evidence' ? ' (' + item.value + ')' : ''));
    lines.push('');
  });

  var text = lines.join('\n');

  return {
    from: NOTIFY_FROM,
    to: [NOTIFY_TO],
    reply_to: contact.email,
    subject: 'MGI: ' + contact.firstName + ', ' + contact.company + ' · ' + result.state.name.toUpperCase() +
      ' (gap ' + result.gapWidth.label.toLowerCase() + ', signal ' + result.signal + '/' + SIGNAL_MAX + ')',
    text: text,
    html: '<pre style="font:13px/1.55 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;color:#17161A">' + esc(text) + '</pre>'
  };
}


/* ---------- readings ---------- */

var crypto = require('crypto');
var numbersOf = require('../report/numbers.js');
var eran = require('../report/eran.js');
var mail = require('../report/email.js');

var READINGS = process.env.MGI_READINGS_TABLE || 'mgi_readings';

/* 128 bits from a CSPRNG, base64url, 22 chars. Not sequential, not
   derived from the submission id or the email. No expiry: managers come
   back to their reading and Clive opens it during calls weeks later, and
   a link that dies quietly is worse than one that lives. revoked_at is
   the kill switch for the rare case where someone asks. */
function mintToken() {
  return crypto.randomBytes(16).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function readingsRest(path, opts) {
  var url = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  opts = opts || {};
  opts.headers = Object.assign({
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: 'Bearer ' + key
  }, opts.headers || {});
  return fetch(url.replace(/\/$/, '') + '/rest/v1/' + path, opts);
}

/* The submission id is read back from the row just written rather than
   guessed, because the route needs it to derive on view. */
async function createReading(token, contact, submittedAt) {
  try {
    var find = await readingsRest(TABLE + '?email=eq.' +
      encodeURIComponent(contact.email) + '&submitted_at=eq.' +
      encodeURIComponent(submittedAt) + '&select=id&limit=1');
    var id = null;
    if (find && find.ok) {
      var rows = await find.json();
      id = rows && rows[0] && rows[0].id;
    }
    var r = await readingsRest(READINGS, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ token: token, submission_id: id, payload: null })
    });
    if (!r || !r.ok) {
      console.error('MGI reading insert failed: ' +
        (r ? r.status + ' ' + (await r.text()) : 'no store configured'));
      return false;
    }
    return true;
  } catch (e) {
    console.error('MGI reading insert threw: ' + e.message);
    return false;
  }
}

async function updateReading(token, payload) {
  try {
    await readingsRest(READINGS + '?token=eq.' + encodeURIComponent(token), {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ payload: payload })
    });
  } catch (e) {
    console.error('MGI reading update threw: ' + e.message);
  }
}

