/* =============================================================
   Manager Gap Index v5 - submission handler

   Stores the submission, emails Clive the raw answers as call
   prep, and emails the manager their report. The state, the
   confidence and the gap are recomputed here from the raw
   answers using the same module the browser uses, so the email
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
    teamSize: clean(body.teamSize, 20) || 'Not given'
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
    submitted_at: submittedAt,
    first_name: contact.firstName,
    email: contact.email,
    company: contact.company,
    role: contact.role,
    industry: contact.industryLabel,
    industry_option: contact.industry || null,
    team_size: contact.teamSize,

    gut: answers.gut,
    output: answers.output,
    external_pressure: answers.external,
    energy: answers.energy,
    exposure: answers.exposure,

    state: result.state.name,
    decision_rule: result.rule,
    confidence: result.confidence.label,
    gap: GAP_SUMMARY[result.gap.key],
    signal: result.signal,
    behaviour: Number(result.behaviour.toFixed(2)),
    weak_areas: result.weakCount,
    area_ranking: result.ranked.map(function (a) { return a.name; }).join(' | '),

    answers: answers
  };

  // the twelve evidence items, q1 through q12
  for (var q = 0; q < 12; q++) {
    record['q' + (q + 1)] = answers.evidence[q];
  }

  // per-area means, so segmentation does not have to recompute them
  result.areas.forEach(function (a) {
    record['area_' + a.key] = Number(a.mean.toFixed(2));
    record['area_' + a.key + '_recency'] = a.best;
  });

  // always leave a durable trace in the platform log, whatever else fails
  console.log('MGI_SUBMISSION ' + JSON.stringify(record));

  var stored = await store(record);
  var notified = await sendEmail(notification(contact, result, submittedAt));
  var copied = await sendEmail(managerReport(contact, result));

  /* The submission is processed regardless. A failed notification is ours to
     chase, not the manager's: it is logged above and the raw answers are in the
     MGI_SUBMISSION line, so nothing is lost. Telling the manager their own copy
     failed when it did not would be a lie, so the client keys its message off
     copySent alone. */
  if (!notified) {
    console.error('MGI notification failed for ' + contact.email + ', submission still recorded');
  }

  return res.status(200).json({ ok: true, stored: stored, notified: notified, copySent: copied });
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
   which costs a real manager the report they just answered seventeen
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
  lines.push('Team size: ' + contact.teamSize);
  lines.push('Submitted: ' + submittedAt);
  lines.push('');
  lines.push('State: ' + result.state.name + ' (decision rule ' + result.rule + ')');
  lines.push('Confidence: ' + result.confidence.label);
  lines.push('Exposure: ' + result.exposure.label);
  lines.push('Gap: ' + GAP_SUMMARY[result.gap.key]);
  lines.push('Gut read: ' + result.gap.gutLabel);
  lines.push('');
  lines.push('Signal score: ' + result.signal + '/36   Behaviour score B: ' + result.behaviour.toFixed(2));
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
      ' (' + result.confidence.label.toLowerCase() + ', signal ' + result.signal + '/36)',
    text: text,
    html: '<pre style="font:13px/1.55 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;color:#17161A">' + esc(text) + '</pre>'
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
    mute + ';margin:0 0 20px;">' + esc(result.confidence.label) + ' \u00b7 based on how often you are positioned to see this team</p>');
  h.push('<p style="font-size:17px;line-height:1.6;margin:0 0 20px;">' + esc(result.state.description) + '</p>');

  if (result.caution) {
    h.push('<p style="font-size:16px;line-height:1.6;border-left:2px solid #B03A2E;padding:2px 0 2px 18px;margin:0 0 28px;">' +
      esc(result.caution) + '</p>');
  }

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
      (here ? esc(result.confidence.label) : '') + '</td>' +
      '</tr>');
  });
  h.push('</table>');
  h.push('<p style="font-family:' + sans + ';font-size:13px;line-height:1.55;color:' + mute +
    ';margin:0 0 28px;">The marked state is the most likely one, given what you reported. The confidence beside it reflects how much of the team\u2019s week you are positioned to see.</p>');

  h.push('<hr style="border:0;border-top:1px solid ' + rule + ';margin:0 0 26px;">');

  // 4. the signal score, kept separate from confidence
  h.push(eyebrow('Your signal score'));
  h.push('<p style="font-family:' + mono + ';font-size:24px;letter-spacing:0.06em;font-weight:bold;margin:0 0 14px;">' +
    result.signal + ' / 36</p>');
  h.push('<p style="font-size:16px;line-height:1.6;margin:0 0 12px;">' + esc(MGI.SIGNAL_FRAMING) + '</p>');
  h.push('<p style="font-size:16px;line-height:1.6;margin:0 0 22px;">' + esc(result.signalCopy) + '</p>');

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

  h.push('<hr style="border:0;border-top:1px solid ' + rule + ';margin:26px 0;">');

  // 5. one action
  h.push(eyebrow('This week'));
  h.push('<p style="font-size:17px;line-height:1.6;margin:0 0 28px;">' + esc(result.action) + '</p>');

  h.push('<hr style="border:0;border-top:1px solid ' + ink + ';margin:0 0 26px;">');

  // 6. closing
  h.push('<p style="font-size:17px;line-height:1.6;margin:0 0 26px;"><strong>Talk your result through.</strong> The Manager Gap Index is part of an ongoing research cohort. Clive Hays, Clover ERA\u2019s co-founder, walks a small number of participants through their result each week: thirty minutes, your answers, what they mean, and what to do next. If you would like one of those conversations, reply to this email and say so. We will also reach out to some participants directly.</p>');

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
      ' (' + result.confidence.label.toLowerCase() + ')',
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
  L.push(result.confidence.label + ', based on how often you are positioned to see this team.');
  L.push('');
  L.push(result.state.description);
  if (result.caution) {
    L.push('');
    L.push(result.caution);
  }
  L.push('');
  L.push('YOUR INSTINCT VS THE EVIDENCE');
  L.push(result.gap.copy);
  L.push('');
  L.push('WHERE THAT SITS');
  ['cruise', 'drift', 'headwinds', 'stall'].forEach(function (key) {
    var st = MGI.STATES[key];
    var here = st.key === result.state.key;
    L.push('  ' + (here ? '> ' : '  ') + st.name + (here ? '   ' + result.confidence.label : ''));
  });
  L.push('');
  L.push('YOUR SIGNAL SCORE');
  L.push(result.signal + ' / 36');
  L.push(MGI.SIGNAL_FRAMING);
  L.push(result.signalCopy);
  L.push('');
  result.areas.forEach(function (a) {
    L.push(a.name);
    L.push('  ' + a.desc);
    L.push('  ' + a.recencyFact);
    if (a.callout) L.push('  ' + a.callout);
    L.push('');
  });
  if (result.summary) {
    L.push(result.summary);
    L.push('');
  }
  L.push('THIS WEEK');
  L.push(result.action);
  L.push('');
  L.push('TALK YOUR RESULT THROUGH');
  L.push('The Manager Gap Index is part of an ongoing research cohort. Clive Hays, Clover ERA\u2019s co-founder, walks a small number of participants through their result each week: thirty minutes, your answers, what they mean, and what to do next. If you would like one of those conversations, reply to this email and say so. We will also reach out to some participants directly.');
  L.push('');
  L.push('The Manager Gap Index is a Clover ERA research instrument. cloverera.com');
  L.push('contact@cloverera.com');
  return L.join('\n');
}
