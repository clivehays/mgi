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

  /* ---------- the submit sequence, Addendum B section 2 ----------
     Strictly this order, and only step 1 may fail the request. A
     submission is a lead, and no rendering bug is permitted to lose one. */

  /* 1. Persist the raw submission. The only step allowed to fail. */
  var stored = await store(record);

  /* 2. Mint the token and insert the reading with a null payload. */
  var token = mintToken();
  var haveReading = await createReading(token, contact, submittedAt);
  if (!haveReading) token = null;

  /* 3. Derive the payload, in a try/catch. On failure the row keeps its
        null payload and the route derives it on view instead, which is
        why a derive bug cannot cost a lead. */
  var payload = null;
  if (token) {
    try {
      payload = derive.derive(answers, contact, {
        copy_to: contact.email,
        generated_at: submittedAt.slice(0, 10)
      });
      await updateReading(token, payload);
    } catch (e) {
      console.error('MGI derive failed at submit, payload left null for ' +
        token + ': ' + e.message);
    }
  }

  /* 4. Send the email. Always, whether or not step 3 succeeded. */
  var notified = await sendEmail(notification(contact, result, submittedAt));
  var copied = token
    ? await sendEmail(readingEmail(contact, payload, result.state.name, token))
    : await sendEmail(managerReport(contact, result));

  /* The submission is processed regardless. A failed notification is ours to
     chase, not the manager's: it is logged above and the raw answers are in the
     MGI_SUBMISSION line, so nothing is lost. Telling the manager their own copy
     failed when it did not would be a lie, so the client keys its message off
     copySent alone. */
  if (!notified) {
    console.error('MGI notification failed for ' + contact.email + ', submission still recorded');
  }

  return res.status(200).json({ ok: true, stored: stored, notified: notified,
    copySent: copied, reading: token ? '/r/' + token : null });
};

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
var derive = require('../results/derive.js');
var renderer = require('../results/render.js');

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
      body: JSON.stringify({ payload: payload, copy_bank_ver: renderer.BANK.version })
    });
  } catch (e) {
    console.error('MGI reading update threw: ' + e.message);
  }
}

/* Three things and nothing else: the state word, the headline variant and
   the link. The headline comes from the same copy-bank key the page uses,
   so there is one definition and no second copy to drift. The wording
   lives in the bank rather than here because it changes when the
   generated layer lands. */
function readingEmail(contact, payload, stateName, token) {
  var bank = renderer.BANK;
  var variant = payload ? String(payload.quiet_count) : '0';
  var headline = (bank.headline[variant] || bank.headline['0']).head;
  var link = (process.env.MGI_SITE_ORIGIN || 'https://managergap.com') + '/r/' + token;

  var text = bank.email.body
    .split('{first_name}').join(contact.firstName)
    .split('{state}').join(stateName)
    .split('{headline}').join(headline)
    .split('{link}').join(link);

  var paras = text.split(String.fromCharCode(10, 10));
  var html = '<div style="font:16px/1.6 -apple-system,Segoe UI,Helvetica,sans-serif;color:#17161A">' +
    paras.map(function (para) {
      if (para.indexOf(link) !== -1) {
        return '<p><a href="' + link + '" style="color:#1A3565">See your result</a></p>';
      }
      return '<p>' + esc(para).split(String.fromCharCode(10)).join('<br>') + '</p>';
    }).join('') + '</div>';

  return {
    from: FROM,
    to: [contact.email],
    reply_to: 'clive@managergap.com',
    subject: bank.email.subject.split('{state}').join(stateName),
    text: text,
    html: html
  };
}

/* ---------- report copy to the manager ---------- */

function managerReport(contact, result) {
  var ink = '#17161A';
  var mute = '#6F6A60';
  var rule = '#C9C2B4';
  var paper = '#F1ECE3';
  /* single quotes: this goes inside a double-quoted style attribute, and
     double quotes here terminate the attribute and mangle the markup */
  var serif = "Georgia,'Times New Roman',serif";
  var mono = 'ui-monospace,Menlo,Consolas,monospace';
  var sans = 'Arial,Helvetica,sans-serif';

  function eyebrow(t) {
    return '<p style="font-family:' + mono + ';font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:' +
      mute + ';margin:0 0 12px;">' + esc(t) + '</p>';
  }

  var h = [];

  h.push('<div style="background:' + paper + ';padding:28px 0;">');
  h.push('<div style="max-width:600px;margin:0 auto;padding:0 22px;font-family:' + serif + ';color:' + ink + ';">');

  h.push(eyebrow('The Manager Gap Index'));

  // 1. the state call, always hedged
  h.push(eyebrow('Your result'));
  h.push('<p style="font-size:27px;line-height:1.2;margin:0 0 12px;">Based on what you have observed, your team is most likely in <em style="color:' +
    result.state.colour + ';font-weight:bold;">' + esc(result.state.name) + '</em>.</p>');
  h.push('<p style="font-family:' + mono + ';font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:' +
    mute + ';margin:0 0 20px;">Gap width: ' + esc(result.gapWidth.label) + '</p>');
  h.push('<p style="font-size:17px;line-height:1.6;margin:0 0 20px;">' + esc(result.state.description) + '</p>');



  h.push('<hr style="border:0;border-top:1px solid ' + rule + ';margin:0 0 26px;">');

  // 2. the gap
  h.push(eyebrow('Your instinct vs the evidence'));
  h.push('<p style="font-size:17px;line-height:1.6;margin:0 0 28px;">' + esc(result.gap.copy) + '</p>');

  h.push('<hr style="border:0;border-top:1px solid ' + rule + ';margin:0 0 26px;">');

  // 3. the four states, with this reading marked
  h.push(eyebrow('Where that sits'));
  h.push('<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-family:' + mono +
    ';font-size:11px;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 12px;">');
  ['cruise', 'drift', 'headwinds', 'stall'].forEach(function (key) {
    var st = MGI.STATES[key];
    var here = st.key === result.state.key;
    h.push('<tr>' +
      '<td style="padding:9px 0;border-bottom:1px solid ' + rule + ';width:22px;color:' + st.colour + ';">' +
      (here ? '&#9679;' : '') + '</td>' +
      '<td style="padding:9px 0;border-bottom:1px solid ' + rule + ';color:' + (here ? st.colour : mute) +
      ';font-weight:' + (here ? 'bold' : 'normal') + ';">' + esc(st.name) + '</td>' +
      '<td style="padding:9px 0;border-bottom:1px solid ' + rule + ';color:' + mute + ';text-align:right;">' +
      '</td>' +
      '</tr>');
  });
  h.push('</table>');
  h.push('<p style="font-family:' + sans + ';font-size:13px;line-height:1.55;color:' + mute +
    ';margin:0 0 28px;">The marked state is the most likely one, given what you reported.</p>');

  h.push('<hr style="border:0;border-top:1px solid ' + rule + ';margin:0 0 26px;">');

  /* 4. line of sight and gap width. Evidence, never the decision: this
     sits below the state and above the areas, and nothing here hedges
     the result. The distance is the diagnosis. */
  h.push(eyebrow('Line of sight and gap width'));
  h.push('<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 4px;">');
  h.push('<tr>' +
    '<td style="padding:0 0 6px;font-family:' + mono + ';font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:' +
    mute + ';">Line of sight</td>' +
    '<td style="padding:0 0 6px;font-family:' + mono + ';font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:' +
    mute + ';">Gap width</td></tr>');
  h.push('<tr>' +
    '<td style="padding:0 12px 14px 0;font-size:22px;font-weight:bold;vertical-align:top;">' +
    esc(result.lineOfSight.label) + '</td>' +
    '<td style="padding:0 0 14px;font-size:22px;font-weight:bold;vertical-align:top;">' +
    esc(result.gapWidth.label) + '</td></tr>');
  h.push('</table>');
  h.push('<p style="font-size:16px;line-height:1.6;margin:0 0 14px;">' + esc(result.lineOfSight.copy) + '</p>');
  h.push('<p style="font-size:16px;line-height:1.6;margin:0 0 14px;">' + esc(result.gapWidth.copy) + '</p>');
  h.push('<p style="font-family:' + sans + ';font-size:13px;line-height:1.55;color:' + mute +
    ';margin:0 0 28px;">' + esc(result.gapFraming) + '</p>');

  h.push('<hr style="border:0;border-top:1px solid ' + rule + ';margin:0 0 26px;">');

  // 5. what to try, before the evidence behind it
  h.push(eyebrow('To try this week'));
  h.push('<p style="font-size:20px;line-height:1.35;margin:0 0 10px;">' + esc(result.ranked[0].name) + '</p>');
  h.push('<p style="font-size:17px;line-height:1.6;margin:0 0 28px;">' + esc(result.action) + '</p>');

  h.push('<hr style="border:0;border-top:1px solid ' + ink + ';margin:0 0 26px;">');

  // 6. what the picture is built on. The raw score sits last: a number
  //    out of 45 tells a manager nothing they did not just type in.
  h.push(eyebrow('What your picture is built on'));
  h.push('<p style="font-size:20px;line-height:1.4;margin:0 0 14px;">' + esc(result.signalHeadline) + '</p>');
  h.push('<p style="font-size:16px;line-height:1.6;margin:0 0 20px;">' + esc(result.signalMeaning) + '</p>');

  result.areas.forEach(function (a) {
    h.push('<div style="border-top:1px solid ' + rule + ';padding:15px 0;">');
    h.push('<p style="font-size:18px;margin:0 0 6px;">' + esc(a.name) + '</p>');
    h.push('<p style="font-family:' + sans + ';font-size:14px;line-height:1.55;color:' + mute + ';margin:0 0 8px;">' + esc(a.desc) + '</p>');
    h.push('<p style="font-family:' + mono + ';font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:' +
      factColour(a.best) + ';margin:0;">' + esc(a.recencyFact) + '</p>');
    if (a.callout) {
      h.push('<p style="font-size:15px;line-height:1.55;background:#E8E2D6;border-left:2px solid ' + ink +
        ';padding:13px 15px;margin:12px 0 0;">' + esc(a.callout) + '</p>');
    }
    h.push('</div>');
  });

  if (result.summary) {
    h.push('<p style="font-size:16px;line-height:1.6;background:#E8E2D6;border-left:2px solid ' + ink +
      ';padding:15px 17px;margin:20px 0 0;">' + esc(result.summary) + '</p>');
  }

  h.push('<p style="font-family:' + mono + ';font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:' + mute +
    ';margin:18px 0 0;">Signal score ' + result.signal + ' / ' + SIGNAL_MAX + '</p>');

  h.push('<hr style="border:0;border-top:1px solid ' + rule + ';margin:26px 0;">');

  // 6. closing
  h.push('<p style="font-size:17px;line-height:1.6;margin:0 0 26px;"><strong>Talk your result through.</strong> The Manager Gap Index is part of an ongoing research cohort. Clive Hays, Clover ERA\u2019s co-founder, walks a small number of participants through their result each week: thirty minutes on your answers, and you leave with a written plan of three specific actions built from them. If you would like one of those conversations, reply to this email and say so. We will also reach out to some participants directly.</p>');

  h.push('<hr style="border:0;border-top:1px solid ' + ink + ';margin:0 0 16px;">');
  h.push('<p style="font-family:' + mono + ';font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:' + mute +
    ';line-height:1.8;margin:0;">The Manager Gap Index is a <a href="https://cloverera.com" style="color:' + mute +
    ';">Clover ERA</a> research instrument.<br>contact@cloverera.com</p>');

  h.push('</div></div>');

  return {
    from: FROM,
    to: [contact.email],
    reply_to: REPLY_TO,
    subject: 'Your Manager Gap Index result: most likely ' + result.state.name +
      ' (gap ' + result.gapWidth.label.toLowerCase() + ')',
    /* Microsoft and Gmail both read this as a signal that the sender is
       legitimate, and the closing block does say we may reach out again,
       so the recipient should have a way to say no. */
    headers: {
      'List-Unsubscribe': '<mailto:' + NOTIFY_TO + '?subject=Unsubscribe>'
    },
    html: h.join(''),
    text: managerReportText(result)
  };
}

/* the recency fact fades with age. No label vocabulary. */
function factColour(best) {
  if (best === 3) return '#17161A';
  if (best === 2) return '#3D3A34';
  if (best === 1) return '#6F6A60';
  return '#918B7E';
}

function managerReportText(result) {
  var L = [];
  L.push('THE MANAGER GAP INDEX');
  L.push('');
  L.push('YOUR RESULT');
  L.push('Based on what you have observed, your team is most likely in ' + result.state.name + '.');
  L.push('Gap width: ' + result.gapWidth.label);
  L.push('');
  L.push(result.state.description);
  L.push('');
  L.push('YOUR INSTINCT VS THE EVIDENCE');
  L.push(result.gap.copy);
  L.push('');
  L.push('WHERE THAT SITS');
  ['cruise', 'drift', 'headwinds', 'stall'].forEach(function (key) {
    var st = MGI.STATES[key];
    var here = st.key === result.state.key;
    L.push('  ' + (here ? '> ' : '  ') + st.name);
  });
  L.push('');
  L.push('LINE OF SIGHT AND GAP WIDTH');
  L.push('Line of sight: ' + result.lineOfSight.label);
  L.push(result.lineOfSight.copy);
  L.push('');
  L.push('Gap width: ' + result.gapWidth.label);
  L.push(result.gapWidth.copy);
  L.push('');
  L.push(result.gapFraming);
  L.push('');
  L.push('TO TRY THIS WEEK');
  L.push(result.ranked[0].name);
  L.push(result.action);
  L.push('');
  L.push('WHAT YOUR PICTURE IS BUILT ON');
  L.push(result.signalHeadline);
  L.push(result.signalMeaning);
  L.push('');
  result.areas.forEach(function (a) {
    L.push(a.name + '   ' + a.freshest);
    L.push('  ' + a.desc);
    L.push('  ' + a.recencyFact);
    if (a.callout) L.push('  ' + a.callout);
    L.push('');
  });
  if (result.summary) {
    L.push(result.summary);
    L.push('');
  }
  L.push('Signal score ' + result.signal + ' / ' + SIGNAL_MAX);
  L.push('');
  L.push('TALK YOUR RESULT THROUGH');
  L.push('The Manager Gap Index is part of an ongoing research cohort. Clive Hays, Clover ERA\u2019s co-founder, walks a small number of participants through their result each week: thirty minutes on your answers, and you leave with a written plan of three specific actions built from them. If you would like one of those conversations, reply to this email and say so. We will also reach out to some participants directly.');
  L.push('');
  L.push('The Manager Gap Index is a Clover ERA research instrument. cloverera.com');
  L.push('contact@cloverera.com');
  return L.join('\n');
}
