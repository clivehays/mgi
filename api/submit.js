/* =============================================================
   Manager Gap Index v5 - submission handler

   Stores the submission, emails Clive the raw answers as call
   prep, and emails the manager their report. Scores are
   recomputed here from the raw answers using the same module
   the browser uses, so the email can never disagree with the
   page the manager saw.

   Environment:
     RESEND_API_KEY              required for email
     MGI_NOTIFY_EMAIL            default contact@cloverera.com
     MGI_FROM_EMAIL              default Manager Gap Index <mgi@cloverera.com>
     SUPABASE_URL                optional, durable store
     SUPABASE_SERVICE_ROLE_KEY   optional, durable store
     MGI_TABLE                   default mgi_v5_submissions
   ============================================================= */

var MGI = require('../assets/scoring.js');

var NOTIFY_TO = process.env.MGI_NOTIFY_EMAIL || 'contact@cloverera.com';
var FROM = process.env.MGI_FROM_EMAIL || 'Manager Gap Index <mgi@cloverera.com>';
var TABLE = process.env.MGI_TABLE || 'mgi_v5_submissions';

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

  var answers = body.answers;
  if (!MGI.validAnswers(answers)) {
    return res.status(400).json({ ok: false, error: 'Invalid answers' });
  }

  var contact = {
    firstName: clean(body.firstName, 80),
    email: clean(body.email, 160),
    company: clean(body.company, 120),
    role: clean(body.role, 120),
    teamSize: clean(body.teamSize, 20) || 'Not given'
  };

  if (!contact.firstName || !contact.company || !contact.role) {
    return res.status(400).json({ ok: false, error: 'Missing contact fields' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
    return res.status(400).json({ ok: false, error: 'Invalid email' });
  }

  var submittedAt = new Date().toISOString();
  var result = MGI.score(answers);

  var record = {
    submitted_at: submittedAt,
    first_name: contact.firstName,
    email: contact.email,
    company: contact.company,
    role: contact.role,
    team_size: contact.teamSize,
    total: result.total,
    band: result.band.name,
    drift: result.drift.label,
    headwinds: result.headwinds.label,
    weakest: result.weakest.join(', '),
    answers: answers
  };

  // always leave a durable trace in the platform log, whatever else fails
  console.log('MGI_SUBMISSION ' + JSON.stringify(record));

  var stored = await store(record);
  var notified = await sendEmail(notification(contact, result, submittedAt));
  var copied = await sendEmail(managerReport(contact, result));

  if (!notified) {
    return res.status(502).json({ ok: false, error: 'Notification failed', stored: stored });
  }

  return res.status(200).json({ ok: true, stored: stored, copySent: copied });
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

async function sendEmail(msg) {
  var key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error('MGI email skipped: RESEND_API_KEY not set');
    return false;
  }
  try {
    var res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify(msg)
    });
    if (!res.ok) {
      console.error('MGI email failed: ' + res.status + ' ' + (await res.text()));
      return false;
    }
    return true;
  } catch (e) {
    console.error('MGI email threw: ' + e.message);
    return false;
  }
}

/* ---------- notification to Clive (call prep) ---------- */

function notification(contact, result, submittedAt) {
  var weakest = result.weakestAreas.map(function (a) {
    return a.name + ' (' + a.label.toLowerCase() + ', mean ' + a.mean.toFixed(1) + ')';
  });

  var lines = [];
  lines.push('Name: ' + contact.firstName);
  lines.push('Email: ' + contact.email);
  lines.push('Company: ' + contact.company);
  lines.push('Role: ' + contact.role);
  lines.push('Team size: ' + contact.teamSize);
  lines.push('Submitted: ' + submittedAt);
  lines.push('');
  lines.push('Score: ' + result.total + ' / 36');
  lines.push('Band: ' + result.band.name);
  lines.push('');
  lines.push('Drift detection: ' + result.drift.label + ' (mean ' + result.drift.mean.toFixed(2) + ')');
  lines.push('Headwinds detection: ' + result.headwinds.label + ' (mean ' + result.headwinds.mean.toFixed(2) + ')');
  lines.push('');
  lines.push('Weakest areas:');
  lines.push('  1. ' + weakest[0]);
  lines.push('  2. ' + weakest[1]);
  lines.push('');
  lines.push('ANSWERS');
  lines.push('');

  result.items.forEach(function (item) {
    lines.push('Q' + item.n + '. ' + item.question);
    lines.push('    ' + item.label + ' (' + item.value + ')');
    lines.push('');
  });

  var text = lines.join('\n');

  return {
    from: FROM,
    to: [NOTIFY_TO],
    reply_to: contact.email,
    subject: 'MGI: ' + contact.firstName + ', ' + contact.company + ' · ' + result.band.name + ' (' + result.total + '/36)',
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
  var serif = 'Georgia,"Times New Roman",serif';
  var mono = 'ui-monospace,Menlo,Consolas,monospace';

  var h = [];

  h.push('<div style="background:' + paper + ';padding:28px 0;">');
  h.push('<div style="max-width:600px;margin:0 auto;padding:0 22px;font-family:' + serif + ';color:' + ink + ';">');

  h.push('<p style="font-family:' + mono + ';font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:' + mute + ';margin:0 0 22px;">The Manager Gap Index</p>');

  h.push('<p style="font-family:' + mono + ';font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:' + mute + ';margin:0 0 10px;">Your signal reading</p>');
  h.push('<p style="font-size:34px;line-height:1.05;margin:0 0 8px;">' + esc(result.band.name) + '</p>');
  h.push('<p style="font-family:' + mono + ';font-size:12px;letter-spacing:0.16em;color:' + mute + ';margin:0 0 18px;">' + result.total + ' / 36</p>');
  h.push('<p style="font-size:17px;line-height:1.55;margin:0 0 30px;">' + esc(result.band.desc) + '</p>');

  h.push('<hr style="border:0;border-top:1px solid ' + rule + ';margin:0 0 26px;">');

  h.push('<p style="font-family:' + mono + ';font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:' + mute + ';margin:0 0 14px;">What you could detect</p>');
  h.push('<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-family:' + mono + ';font-size:11px;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 22px;">');
  h.push(compassRow('Cruise', 'Assumed', '#1B7A4A', rule));
  h.push(compassRow('Drift', result.drift.label, '#C2842F', rule));
  h.push(compassRow('Headwinds', result.headwinds.label, '#6B5BD2', rule));
  h.push(compassRow('Stall', 'Detectable, too late to matter', '#B03A2E', rule));
  h.push('</table>');

  h.push('<p style="font-size:15px;line-height:1.6;margin:0 0 22px;">Teams move through four states. <strong>Cruise:</strong> stable and healthy. <strong>Drift:</strong> output still fine, but the things that produce it are slipping. <strong>Headwinds:</strong> output falling while the team itself is healthy; the cause is outside. <strong>Stall:</strong> the decline has reached the output. Stall is the only state every manager detects without trying, because by then it has already cost you.</p>');

  h.push('<p style="font-size:19px;line-height:1.4;font-style:italic;border-left:2px solid #2196F3;padding:2px 0 2px 18px;margin:0 0 30px;">' + esc(result.headline) + '</p>');

  h.push('<hr style="border:0;border-top:1px solid ' + rule + ';margin:0 0 26px;">');

  h.push('<p style="font-family:' + mono + ';font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:' + mute + ';margin:0 0 16px;">Where your signal comes from</p>');

  result.areas.forEach(function (a) {
    h.push('<div style="border-top:1px solid ' + rule + ';padding:15px 0;">');
    h.push('<p style="font-size:18px;margin:0 0 5px;">' + esc(a.name) + '</p>');
    h.push('<p style="font-family:' + mono + ';font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:' + areaColour(a.label) + ';margin:0 0 8px;">' + esc(a.label) + '</p>');
    h.push('<p style="font-size:14px;line-height:1.55;color:' + mute + ';margin:0;font-family:Arial,Helvetica,sans-serif;">' + esc(a.desc) + '</p>');
    if (a.isWeakest) {
      h.push('<p style="font-size:15px;line-height:1.55;background:#E8E2D6;border-left:2px solid ' + ink + ';padding:13px 15px;margin:12px 0 0;">' + esc(MGI.calloutFor(a)) + '</p>');
    }
    h.push('</div>');
  });

  h.push('<hr style="border:0;border-top:1px solid ' + rule + ';margin:26px 0;">');

  h.push('<p style="font-family:' + mono + ';font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:' + mute + ';margin:0 0 12px;">This week</p>');
  h.push('<p style="font-size:17px;line-height:1.6;margin:0 0 30px;">Pick your weakest area above. Create one situation this week where fresh signal can reach you in it: a working session instead of a status meeting, a one-to-one with the person you are least sure about, or a direct look at the work itself. Then notice how much of what you learn was not in your picture.</p>');

  h.push('<hr style="border:0;border-top:1px solid ' + ink + ';margin:0 0 26px;">');

  h.push('<p style="font-size:17px;line-height:1.6;margin:0 0 26px;"><strong>Talk your result through.</strong> The Manager Gap Index is part of an ongoing research cohort. Clive Hays, Clover ERA’s co-founder, walks a small number of participants through their result each week: thirty minutes, your answers, what they mean, and what to do about them. If you would like one of those conversations, reply to this email and say so. We will also reach out to some participants directly.</p>');

  h.push('<hr style="border:0;border-top:1px solid ' + ink + ';margin:0 0 16px;">');
  h.push('<p style="font-family:' + mono + ';font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:' + mute + ';line-height:1.8;margin:0;">The Manager Gap Index is a <a href="https://cloverera.com" style="color:' + mute + ';">Clover ERA</a> research instrument.<br>contact@cloverera.com</p>');

  h.push('</div></div>');

  return {
    from: FROM,
    to: [contact.email],
    reply_to: NOTIFY_TO,
    subject: 'Your Manager Gap Index result: ' + result.band.name + ' (' + result.total + '/36)',
    html: h.join(''),
    text: managerReportText(contact, result)
  };
}

function compassRow(state, verdict, colour, rule) {
  return '<tr>' +
    '<td style="padding:9px 0;border-bottom:1px solid ' + rule + ';color:' + colour + ';font-weight:bold;width:110px;">' + esc(state) + '</td>' +
    '<td style="padding:9px 0;border-bottom:1px solid ' + rule + ';color:#6F6A60;">' + esc(verdict) + '</td>' +
    '</tr>';
}

function areaColour(label) {
  if (label === 'Current') return '#1B7A4A';
  if (label === 'Fading') return '#C2842F';
  return '#B03A2E';
}

function managerReportText(contact, result) {
  var L = [];
  L.push('THE MANAGER GAP INDEX');
  L.push('');
  L.push('YOUR SIGNAL READING');
  L.push(result.band.name + '  (' + result.total + ' / 36)');
  L.push('');
  L.push(result.band.desc);
  L.push('');
  L.push('WHAT YOU COULD DETECT');
  L.push('  Cruise      Assumed');
  L.push('  Drift       ' + result.drift.label);
  L.push('  Headwinds   ' + result.headwinds.label);
  L.push('  Stall       Detectable, too late to matter');
  L.push('');
  L.push('Teams move through four states. Cruise: stable and healthy. Drift: output still fine, but the things that produce it are slipping. Headwinds: output falling while the team itself is healthy; the cause is outside. Stall: the decline has reached the output. Stall is the only state every manager detects without trying, because by then it has already cost you.');
  L.push('');
  L.push(result.headline);
  L.push('');
  L.push('WHERE YOUR SIGNAL COMES FROM');
  L.push('');
  result.areas.forEach(function (a) {
    L.push(a.name + ' - ' + a.label);
    L.push('  ' + a.desc);
    if (a.isWeakest) {
      L.push('  ' + MGI.calloutFor(a));
    }
    L.push('');
  });
  L.push('THIS WEEK');
  L.push('Pick your weakest area above. Create one situation this week where fresh signal can reach you in it: a working session instead of a status meeting, a one-to-one with the person you are least sure about, or a direct look at the work itself. Then notice how much of what you learn was not in your picture.');
  L.push('');
  L.push('TALK YOUR RESULT THROUGH');
  L.push('The Manager Gap Index is part of an ongoing research cohort. Clive Hays, Clover ERA’s co-founder, walks a small number of participants through their result each week: thirty minutes, your answers, what they mean, and what to do about them. If you would like one of those conversations, reply to this email and say so. We will also reach out to some participants directly.');
  L.push('');
  L.push('The Manager Gap Index is a Clover ERA research instrument. cloverera.com');
  L.push('contact@cloverera.com');
  return L.join('\n');
}
