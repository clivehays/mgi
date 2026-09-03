/* =============================================================
   page.js  ·  numbers + Eran JSON  ->  one HTML file

   Every number comes from the deterministic layer. Every word below
   the rings comes from Eran. Where Eran returned nothing usable for a
   section, that section is absent: there is no placeholder text
   anywhere in this file.

   Inline CSS and JS, no third-party request at render or at view.

   Spec section 5.
   ============================================================= */

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* The ring itself lives in assets/rings.js, because the assessment
   page draws the same five as a teaser while the reading is being
   written. One definition, two pages. */
var rings_ = require('../assets/rings.js');

function ring(area, i) {
  return rings_.svg(area.items, i);
}

/* ---------- the computed status line ----------
   Inside the readout panel, between what the area asks and what Eran
   says it means. It reports what the manager answered, not the tier the
   answer was bucketed into. */

var COUNT = ['None', 'One', 'Two', 'Three'];

function statusLine(area) {
  var parts = [COUNT[area.fresh] + ' of three reaching you'];
  if (area.stale) parts.push(COUNT[area.stale].toLowerCase() + ' gone quiet');
  if (area.dark) parts.push(COUNT[area.dark].toLowerCase() + ' not recalled');

  var best = area.items.reduce(function (m, it) {
    return it.value > m.value ? it : m;
  }, area.items[0]);

  var recent = best.value === 0
    ? 'Nothing in this area came back to you.'
    : 'Most recent: ' + best.label + '.';

  return parts.join(', ') + '. ' + recent;
}

/* ---------- pieces ---------- */

function chip(numbers) {
  /* amber for Drift, Headwinds and Stall. Never red. */
  var tone = numbers.state === 'cruise' ? 'clear' : 'watch';
  return '<p class="chip chip-' + tone + '">' +
    '<span class="dot" aria-hidden="true"></span>' +
    '<span class="chip-label">' + esc(numbers.state_name) + '</span></p>';
}

function rings(numbers) {
  var tabs = numbers.areas.map(function (a, i) {
    var on = a.key === numbers.focus;
    return '<button type="button" class="ring" role="tab" id="tab-' + a.key + '" ' +
      'aria-controls="readout" aria-selected="' + (on ? 'true' : 'false') + '" ' +
      'tabindex="' + (on ? '0' : '-1') + '" data-area="' + a.key + '">' +
      ring(a, i) +
      '<span class="ring-name">' + esc(a.plain) + '</span>' +
      '<span class="ring-count mono">' + a.fresh + '/3</span>' +
      '</button>';
  }).join('');

  return '<div class="rings" role="tablist" aria-label="The five areas">' + tabs + '</div>';
}

function readout(numbers, eran) {
  if (!eran || !eran.readouts) return '';
  var panels = numbers.areas.map(function (a) {
    var r = eran.readouts[a.key];
    if (!r) return '';
    return '<div class="panel" data-area="' + a.key + '" hidden>' +
      '<p class="eyebrow mono">' + esc(a.dimension) + '</p>' +
      '<h3 class="panel-name">' + esc(a.plain) + '</h3>' +
      '<p class="asks">' + esc(r.asks) + '</p>' +
      '<p class="status mono">' + esc(statusLine(a)) + '</p>' +
      '<p class="means">' + esc(r.means) + '</p>' +
      '</div>';
  }).join('');
  if (!panels) return '';
  return '<section class="readout" id="readout" role="tabpanel" ' +
    'aria-labelledby="tab-' + esc(numbers.focus) + '" tabindex="0">' +
    panels + '</section>';
}

function stepper(id, dial) {
  return '<div class="stepper">' +
    '<label class="stepper-label" for="' + id + '">' + esc(dial.label) + '</label>' +
    '<div class="stepper-row">' +
    '<button type="button" class="step" data-step="-1" data-for="' + id + '" ' +
    'aria-label="Fewer">&minus;</button>' +
    '<input class="stepper-value mono" id="' + id + '" type="number" inputmode="numeric" ' +
    'value="' + dial['default'] + '" min="' + dial.min + '" max="' + dial.max + '" step="1">' +
    '<button type="button" class="step" data-step="1" data-for="' + id + '" ' +
    'aria-label="More">+</button>' +
    '</div></div>';
}

function cost(eran) {
  if (!eran || !eran.cost) return '';
  var c = eran.cost;
  var weekly = c.dial_a['default'] * c.dial_b['default'] * 5;
  return '<section class="cost">' +
    '<h2 class="cost-head">' + esc(c.headline) + '</h2>' +
    '<div class="dials">' + stepper('dial-a', c.dial_a) + stepper('dial-b', c.dial_b) + '</div>' +
    '<p class="weekly mono" id="weekly" data-value="' + weekly + '" aria-live="polite">' +
    weekly + '</p>' +
    '<p class="weekly-caption">' + esc(c.caption) + '</p>' +
    '<p class="cost-close">' + esc(c.close) + '</p>' +
    '</section>';
}

function changes(eran) {
  if (!eran || !eran.changes) return '';
  var rows = eran.changes.map(function (line) {
    return '<li>' + esc(line) + '</li>';
  }).join('');
  return '<section class="changes">' +
    '<h2 class="section-head mono">What changes</h2>' +
    '<ul class="change-list">' + rows + '</ul></section>';
}

function receipt(numbers, eran) {
  var counters = '<div class="counters">' +
    '<div class="counter"><span class="counter-n mono">' + numbers.reading_count + '</span>' +
    '<span class="counter-label">conditions still reading</span></div>' +
    '<div class="counter"><span class="counter-n mono">' + numbers.quiet_count + '</span>' +
    '<span class="counter-label">conditions gone quiet</span></div>' +
    '</div>';

  var body = eran && eran.receipt
    ? '<p class="receipt-body">' + esc(eran.receipt) + '</p>' : '';

  var cta = '<p class="cta"><a href="mailto:clive@managergap.com' +
    '?subject=' + encodeURIComponent('My reading, number ' + numbers.meta.reading_no) +
    '">Tell Clive what this got wrong</a></p>';

  return '<section class="receipt">' + counters + body + cta + '</section>';
}

/* ---------- the conversation ----------
   Below the receipt, in the voice that wrote the report. It renders
   only when there is a model to answer with: a chat box that cannot
   answer is worse than no chat box, and the receipt's own CTA is still
   there either way. */

function talk(token) {
  if (!token || !process.env.ANTHROPIC_API_KEY) return '';
  return '<section class="talk" id="talk" data-token="' + encodeURIComponent(token) + '">' +
    '<h2 class="section-head mono">Ask about this</h2>' +
    '<div class="thread" id="thread" role="log" aria-live="polite" aria-label="The conversation"></div>' +
    '<form class="ask" id="ask-form">' +
    '<label class="visually-hidden" for="ask">Your message</label>' +
    '<textarea id="ask" name="ask" rows="1" placeholder="What does this actually mean for me?" ' +
    'maxlength="2000" autocomplete="off"></textarea>' +
    '<button type="submit" class="ask-send" id="ask-send">Send</button>' +
    '</form>' +
    '<p class="disclosure">Clive reads these. That is rather the point.</p>' +
    '</section>';
}

/* The worksheet sits after the question, behind a hairline. The question
   is the beat the section ends on, and a download link in front of it
   would take that away. The link is token-scoped: the library is the
   methodology, and it is not left sitting at a guessable path. */
function worksheet(eran, token) {
  var n = eran.next_move;
  if (!token || !n.worksheet || !n.worksheet.id) return '';
  return '<div class="sheet">' +
    (n.worksheet_why ? '<p class="sheet-why">' + esc(n.worksheet_why) + '</p>' : '') +
    '<a class="sheet-link" href="/r/' + encodeURIComponent(token) + '/worksheet.pdf" ' +
    'download="' + esc(n.worksheet.id) + '.pdf">' +
    '<span class="sheet-icon mono" aria-hidden="true">PDF</span>' +
    '<span class="sheet-title">' + esc(n.worksheet.title) + '</span>' +
    '</a></div>';
}

function nextMove(eran, token) {
  if (!eran || !eran.next_move) return '';
  var n = eran.next_move;
  return '<section class="next">' +
    '<h2 class="section-head mono">The next move</h2>' +
    '<p class="next-action">' + esc(n.action) + '</p>' +
    '<p class="next-question">' + esc(n.question) + '</p>' +
    worksheet(eran, token) +
    '</section>';
}

function folded(numbers, eran) {
  var rows = '';

  if (eran && eran.state_note) {
    rows += '<details class="fold"><summary>What this state means</summary>' +
      '<div class="fold-body"><p>' + esc(eran.state_note) + '</p></div></details>';
  }

  var sight = '<dl class="sight">' +
    '<dt>Line of sight</dt><dd class="mono">' + esc(numbers.line_of_sight_label) + '</dd>' +
    '<dt>Gap width</dt><dd class="mono">' + esc(numbers.gap_width_label) + '</dd>' +
    '<dt>Signal</dt><dd class="mono">' + numbers.signal.score + ' / ' + numbers.signal.max + '</dd>' +
    '</dl>';
  var note = eran && eran.sight_note ? '<p>' + esc(eran.sight_note) + '</p>' : '';
  rows += '<details class="fold"><summary>How much of this you can see</summary>' +
    '<div class="fold-body">' + sight + note + '</div></details>';

  return '<section class="folds">' + rows + '</section>';
}

/* ---------- the stylesheet ----------
   Tokens are defined in full on bare :root and only redefined under
   prefers-color-scheme and [data-theme]. No colour has its only
   definition inside a media block. */

var CSS = [
':root{',
'  --paper:#F1ECE3; --paper-2:#E8E2D6; --card:#FBF8F2;',
'  --ink:#17161A; --ink-2:#3A3733; --ink-mute:#6F6A60;',
'  --rule:rgba(23,22,26,.16); --hair:rgba(23,22,26,.10);',
'  --blue:#2196F3; --amber:#A9711A; --navy:#0F2B4C;',
'  --on-navy:#EDE7DB; --on-navy-mute:#A7B4C4;',
'  --serif:"Source Serif 4",Georgia,"Times New Roman",serif;',
'  --ui:"Inter Tight",system-ui,-apple-system,"Segoe UI",sans-serif;',
'  --mono:"JetBrains Mono",ui-monospace,"SFMono-Regular",Menlo,monospace;',
'}',
'@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){',
'  --paper:#121316; --paper-2:#191A1E; --card:#1B1D21;',
'  --ink:#ECE7DD; --ink-2:#C9C3B8; --ink-mute:#8E887D;',
'  --rule:rgba(236,231,221,.20); --hair:rgba(236,231,221,.12);',
'  --blue:#5CB2F7; --amber:#D3A24E; --navy:#0B1F38;',
'  --on-navy:#ECE7DD; --on-navy-mute:#9AA9BB;',
'}}',
':root[data-theme="dark"]{',
'  --paper:#121316; --paper-2:#191A1E; --card:#1B1D21;',
'  --ink:#ECE7DD; --ink-2:#C9C3B8; --ink-mute:#8E887D;',
'  --rule:rgba(236,231,221,.20); --hair:rgba(236,231,221,.12);',
'  --blue:#5CB2F7; --amber:#D3A24E; --navy:#0B1F38;',
'  --on-navy:#ECE7DD; --on-navy-mute:#9AA9BB;',
'}',
'*,*::before,*::after{box-sizing:border-box}',
'html{-webkit-text-size-adjust:100%}',
'body{margin:0;background:var(--paper);color:var(--ink);',
'  font:400 17px/1.55 var(--serif);',
'  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}',
'.wrap{width:100%;max-width:37rem;margin:0 auto;padding:0 20px}',
'.mono{font-family:var(--mono);font-size:.72rem;letter-spacing:.06em;',
'  text-transform:uppercase}',
'h1,h2,h3{font-weight:400;margin:0}',
'p{margin:0}',

/* masthead */
'.masthead{border-bottom:1px solid var(--rule)}',
'.masthead .wrap{display:flex;align-items:baseline;justify-content:space-between;',
'  gap:12px;padding-top:16px;padding-bottom:14px}',
'.brand{font-family:var(--ui);font-size:.9rem;font-weight:600;letter-spacing:-.01em}',
'.stamp{font-family:var(--mono);font-size:.66rem;letter-spacing:.06em;',
'  color:var(--ink-mute);text-align:right;white-space:nowrap}',

/* fold */
'.fold-top{padding:30px 0 6px}',
'.chip{display:inline-flex;align-items:center;gap:8px;margin:0 0 22px;',
'  padding:5px 13px 5px 11px;border-radius:100px;border:1px solid var(--rule);',
'  background:var(--card);font-family:var(--ui);font-size:.8rem;font-weight:500}',
'.chip .dot{width:8px;height:8px;border-radius:50%;background:var(--blue)}',
'.chip-watch .dot{background:var(--amber)}',
'.chip-watch{border-color:color-mix(in srgb,var(--amber) 45%,transparent)}',

/* rings */
/* the ring geometry and colours come from assets/rings.js, the same
   stylesheet the assessment page injects for its teaser */
rings_.CSS,
'.rings{margin:0 0 26px}',
'.ring{cursor:pointer}',
'.ring[aria-selected="true"] .ring-name{color:var(--ring-lead);font-weight:600}',
'.ring[aria-selected="true"] .ring-count{color:var(--ring-lead)}',
'.ring:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',

'.headline{font-size:1.72rem;line-height:1.18;letter-spacing:-.015em;margin:0 0 10px}',
'@media (max-width:400px){.headline{font-size:1.5rem}}',
'.sub{font-size:1.02rem;line-height:1.45;color:var(--ink-2);margin:0 0 4px}',

/* readout */
'.readout{margin:26px 0 0;padding:20px 20px 22px;background:var(--card);',
'  border:1px solid var(--hair);border-radius:12px}',
'.readout:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
'.eyebrow{color:var(--amber);margin:0 0 7px}',
'.panel-name{font-size:1.18rem;line-height:1.25;margin:0 0 12px}',
'.asks{font-style:italic;color:var(--ink-2);margin:0 0 12px}',
'.status{color:var(--ink-mute);text-transform:none;letter-spacing:.01em;',
'  font-size:.76rem;line-height:1.5;margin:0 0 14px;',
'  padding-top:12px;border-top:1px solid var(--hair)}',
'.means{margin:0}',

/* sections */
'.section-head{color:var(--ink-mute);margin:0 0 14px}',
'.cost,.changes,.next{padding:34px 0 0}',
'.cost-head{font-size:1.3rem;line-height:1.25;margin:0 0 20px}',
'.dials{display:grid;gap:16px;margin:0 0 20px}',
'@media (min-width:480px){.dials{grid-template-columns:1fr 1fr;gap:18px}}',
'.stepper-label{display:block;font-family:var(--ui);font-size:.82rem;',
'  color:var(--ink-2);margin:0 0 8px}',
'.stepper-row{display:flex;align-items:stretch;border:1px solid var(--rule);',
'  border-radius:9px;overflow:hidden;background:var(--card)}',
'.step{appearance:none;border:0;background:none;color:var(--ink);cursor:pointer;',
'  width:44px;flex:0 0 44px;font:400 1.2rem/1 var(--ui)}',
'.step:hover{background:var(--paper-2)}',
'.step:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}',
'.stepper-value{flex:1 1 auto;min-width:0;width:100%;border:0;background:none;',
'  color:var(--ink);text-align:center;font-size:.95rem;padding:10px 0;',
'  border-left:1px solid var(--hair);border-right:1px solid var(--hair);',
'  -moz-appearance:textfield}',
'.stepper-value::-webkit-outer-spin-button,',
'.stepper-value::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}',
'.stepper-value:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}',
'.weekly{font-size:3.4rem;line-height:1;letter-spacing:-.03em;text-transform:none;',
'  color:var(--ink);margin:0 0 6px;font-variant-numeric:tabular-nums}',
'.weekly-caption{font-family:var(--ui);font-size:.82rem;color:var(--ink-mute);',
'  margin:0 0 18px}',
'.cost-close{margin:0}',

'.change-list{list-style:none;margin:0;padding:0;border-top:1px solid var(--hair)}',
'.change-list li{padding:13px 0;border-bottom:1px solid var(--hair)}',

/* receipt */
'.receipt{margin:38px 0 0;padding:26px 22px;border-radius:12px;',
'  background:var(--navy);color:var(--on-navy)}',
'.counters{display:flex;gap:26px;margin:0 0 18px}',
'.counter{display:flex;flex-direction:column;gap:4px}',
'.counter-n{font-size:2rem;line-height:1;color:var(--on-navy);text-transform:none;',
'  letter-spacing:-.02em}',
'.counter-label{font-family:var(--ui);font-size:.75rem;line-height:1.3;',
'  color:var(--on-navy-mute);max-width:14ch}',
'.receipt-body{margin:0 0 18px;color:var(--on-navy)}',
'.cta{margin:0;font-family:var(--ui);font-size:.92rem}',
'.cta a{color:var(--on-navy);text-decoration:none;',
'  border-bottom:1px solid rgba(237,231,219,.45);padding-bottom:2px}',
'.cta a:hover{border-bottom-color:var(--on-navy)}',

/* the conversation */
'.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;',
'  clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}',
'.talk{padding:34px 0 0}',
'.thread{display:flex;flex-direction:column;gap:14px;margin:0 0 16px}',
'.thread:empty{margin:0}',
'.turn{max-width:92%;font-size:.98rem;line-height:1.5}',
'.turn-them{align-self:flex-end;background:var(--card);',
'  border:1px solid var(--hair);border-radius:12px 12px 3px 12px;padding:11px 14px}',
'.turn-eran{align-self:flex-start;white-space:pre-wrap}',
'.turn-eran::before{content:"";display:block;width:22px;height:2px;',
'  background:var(--amber);margin:0 0 9px}',
'.turn-wait{color:var(--ink-mute)}',
'.ask{display:flex;gap:9px;align-items:flex-end}',
'.ask textarea{flex:1 1 auto;min-width:0;resize:none;font:400 1rem/1.45 var(--serif);',
'  color:var(--ink);background:var(--card);border:1px solid var(--rule);',
'  border-radius:10px;padding:11px 13px;max-height:9rem}',
'.ask textarea:focus-visible{outline:2px solid var(--blue);outline-offset:-1px}',
'.ask-send{flex:0 0 auto;appearance:none;border:0;border-radius:10px;',
'  background:var(--navy);color:var(--on-navy);cursor:pointer;',
'  font:500 .92rem/1 var(--ui);padding:14px 17px}',
'.ask-send:disabled{opacity:.45;cursor:default}',
'.ask-send:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
'.disclosure{margin:11px 0 0;font-family:var(--ui);font-size:.76rem;',
'  color:var(--ink-mute)}',
/* the two affordances. Nothing irreversible happens without one of
   these being pressed, so they look like something you press. */
'.offer{align-self:flex-start;display:flex;align-items:center;gap:12px;',
'  flex-wrap:wrap;margin:2px 0 0}',
'.offer-wide{flex-direction:column;align-items:flex-start;gap:8px;',
'  max-width:26em}',
'.offer-btn{appearance:none;border:0;border-radius:9px;cursor:pointer;',
'  background:var(--navy);color:var(--on-navy);',
'  font:500 .9rem/1 var(--ui);padding:12px 16px}',
'.offer-btn:hover{background:color-mix(in srgb,var(--navy) 88%,var(--blue))}',
'.offer-btn:disabled{opacity:.5;cursor:default}',
'.offer-btn:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
'.offer-aside{font-family:var(--ui);font-size:.8rem;color:var(--ink-mute)}',
'.offer-note{margin:0;font-family:var(--ui);font-size:.8rem;line-height:1.5;',
'  color:var(--ink-mute)}',

'.join{margin:14px 0 0;padding:14px;border:1px solid var(--rule);',
'  border-radius:10px;background:var(--card)}',
'.join-label{font-family:var(--ui);font-size:.74rem;color:var(--ink-mute);',
'  margin:0 0 7px;text-transform:uppercase;letter-spacing:.06em}',
'.join a{font-family:var(--mono);font-size:.82rem;text-transform:none;',
'  color:var(--blue);word-break:break-all}',
'.team-msg{width:100%;margin:12px 0 0;resize:vertical;min-height:8rem;',
'  font:400 .95rem/1.5 var(--serif);color:var(--ink);background:var(--paper);',
'  border:1px solid var(--rule);border-radius:10px;padding:12px 13px}',

'.next-action{margin:0 0 14px}',
'.next-question{font-style:italic;font-size:1.1rem;line-height:1.4;margin:0;',
'  padding-left:16px;border-left:2px solid var(--amber)}',
'.sheet{margin:24px 0 0;padding:16px 0 0;border-top:1px solid var(--hair)}',
'.sheet-why{font-family:var(--ui);font-size:.85rem;line-height:1.45;',
'  color:var(--ink-mute);margin:0 0 12px}',
'.sheet-link{display:inline-flex;align-items:center;gap:11px;',
'  text-decoration:none;color:var(--ink);padding:11px 15px 11px 12px;',
'  border:1px solid var(--rule);border-radius:9px;background:var(--card)}',
'.sheet-link:hover{border-color:var(--blue)}',
'.sheet-link:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
/* blue rather than navy: navy against the dark card is a badge nobody
   can read, and blue carries a legible foreground in both themes */
'.sheet-icon{flex:0 0 auto;font-size:.6rem;letter-spacing:.08em;color:var(--paper);',
'  background:var(--blue);border-radius:4px;padding:4px 6px;line-height:1}',
'.sheet-title{font-family:var(--ui);font-size:.92rem;font-weight:500;line-height:1.3}',

/* folded detail */
'.folds{margin:38px 0 0;border-top:1px solid var(--hair)}',
'.fold{border-bottom:1px solid var(--hair)}',
'.fold summary{cursor:pointer;list-style:none;padding:15px 0;',
'  font-family:var(--ui);font-size:.88rem;color:var(--ink-2);',
'  display:flex;align-items:center;justify-content:space-between;gap:12px}',
'.fold summary::-webkit-details-marker{display:none}',
'.fold summary::after{content:"+";font-family:var(--mono);color:var(--ink-mute)}',
'.fold[open] summary::after{content:"\\2212"}',
'.fold summary:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
'.fold-body{padding:0 0 18px;font-size:.95rem;color:var(--ink-2)}',
'.sight{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0 0 14px}',
'.sight dt{font-family:var(--ui);font-size:.82rem;color:var(--ink-mute)}',
'.sight dd{margin:0;text-transform:none;color:var(--ink)}',

/* no rule of its own: the last folded row already closes with one */
'.foot{margin:0;padding:18px 0 42px;',
'  font-family:var(--ui);font-size:.76rem;line-height:1.6;color:var(--ink-mute)}',

/* print */
'@media print{',
'  body{background:#fff;color:#000}',
'  .seg{animation:none;opacity:1;stroke-dashoffset:0}',
'  .fold-body{display:block!important}',
'  .fold summary::after{content:""}',
'  .receipt{background:#fff;color:#000;border:1px solid #000}',
'  .counter-label,.receipt-body,.cta a{color:#000}',
'  .cta{display:none}',
'  .sheet-link{border:1px solid #000}',
'  .sheet-icon{background:#000;color:#fff}',
'}'
].join('\n');

/* ---------- the behaviour ---------- */

var JS = [
'(function(){',
'  "use strict";',
'  var tabs=[].slice.call(document.querySelectorAll(".ring"));',
'  var panels=[].slice.call(document.querySelectorAll(".panel"));',
'  function select(key,focus){',
'    tabs.forEach(function(t){',
'      var on=t.getAttribute("data-area")===key;',
'      t.setAttribute("aria-selected",on?"true":"false");',
'      t.tabIndex=on?0:-1;',
'      if(on&&focus)t.focus();',
'    });',
'    panels.forEach(function(p){p.hidden=p.getAttribute("data-area")!==key;});',
'    var panel=document.getElementById("readout");',
'    if(panel)panel.setAttribute("aria-labelledby","tab-"+key);',
'  }',
'  tabs.forEach(function(t,i){',
'    t.addEventListener("click",function(){select(t.getAttribute("data-area"),false);});',
'    t.addEventListener("keydown",function(e){',
'      var d=e.key==="ArrowRight"||e.key==="ArrowDown"?1:',
'            e.key==="ArrowLeft"||e.key==="ArrowUp"?-1:0;',
'      if(!d)return;',
'      e.preventDefault();',
'      var n=tabs[(i+d+tabs.length)%tabs.length];',
'      select(n.getAttribute("data-area"),true);',
'    });',
'  });',
'  var start=document.querySelector(\'.ring[aria-selected="true"]\');',
'  if(start)select(start.getAttribute("data-area"),false);',
'',
'  var a=document.getElementById("dial-a");',
'  var b=document.getElementById("dial-b");',
'  var out=document.getElementById("weekly");',
'  if(a&&b&&out){',
'    var shown=Number(out.getAttribute("data-value"))||0;',
'    var timer=null;',
'    function clamp(el){',
'      var v=Math.round(Number(el.value));',
'      var lo=Number(el.min),hi=Number(el.max);',
'      if(!isFinite(v))v=lo;',
'      v=Math.max(lo,Math.min(hi,v));',
'      el.value=String(v);',
'      return v;',
'    }',
'    function run(){',
'      var target=clamp(a)*clamp(b)*5;',
'      if(timer)clearInterval(timer);',
'      var step=Math.max(1,Math.ceil(Math.abs(target-shown)/18));',
'      timer=setInterval(function(){',
'        if(shown===target){clearInterval(timer);timer=null;return;}',
'        shown+=shown<target?Math.min(step,target-shown):-Math.min(step,shown-target);',
'        out.textContent=String(shown);',
'      },16);',
'    }',
'    [a,b].forEach(function(el){',
'      el.addEventListener("input",run);',
'      el.addEventListener("change",run);',
'    });',
'    [].slice.call(document.querySelectorAll(".step")).forEach(function(btn){',
'      btn.addEventListener("click",function(){',
'        var el=document.getElementById(btn.getAttribute("data-for"));',
'        if(!el)return;',
'        el.value=String(Number(el.value)+Number(btn.getAttribute("data-step")));',
'        run();',
'      });',
'    });',
'  }',
'',
'  window.addEventListener("beforeprint",function(){',
'    [].slice.call(document.querySelectorAll("details")).forEach(function(d){d.open=true;});',
'  });',
'',
'  /* ---------- the conversation ---------- */',
'  var talk=document.getElementById("talk");',
'  if(talk){',
'    var token=talk.getAttribute("data-token");',
'    var thread=document.getElementById("thread");',
'    var form=document.getElementById("ask-form");',
'    var input=document.getElementById("ask");',
'    var sendBtn=document.getElementById("ask-send");',
'    var UI="[[[UI]]]";',
'    var busy=false;',
'    var spoken=false;',
'',
'    function bubble(cls,text){',
'      var p=document.createElement("p");',
'      p.className="turn "+cls;',
'      p.textContent=text||"";',
'      thread.appendChild(p);',
'      return p;',
'    }',
'',
'    function grow(){',
'      input.style.height="auto";',
'      input.style.height=Math.min(input.scrollHeight,144)+"px";',
'    }',
'    input.addEventListener("input",grow);',
'    input.addEventListener("keydown",function(e){',
'      if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();form.requestSubmit();}',
'    });',
'',
'    form.addEventListener("submit",function(e){',
'      e.preventDefault();',
'      var msg=input.value.trim();',
'      if(!msg)return;',
'      input.value="";grow();',
'      talkTo(msg,{});',
'    });',
'',
'    /* The trailing control line is written by the server and cut here.',
'       A marker can arrive split across two chunks, so anything that',
'       could still become one is held back rather than rendered. */',
'    function visible(sofar){',
'      var i=sofar.indexOf(UI);',
'      if(i!==-1)return sofar.slice(0,i);',
'      for(var n=UI.length-1;n>0;n--){',
'        if(sofar.slice(-n)===UI.slice(0,n))return sofar.slice(0,-n);',
'      }',
'      return sofar;',
'    }',
'',
'    function talkTo(msg,extra){',
'      if(busy)return;',
'      busy=true;sendBtn.disabled=true;',
'      bubble("turn-them",msg);',
'      var out=bubble("turn-eran turn-wait","...");',
'      out.scrollIntoView({block:"nearest"});',
'',
'      var payload={message:msg};',
'      for(var k in extra){',
'        if(Object.prototype.hasOwnProperty.call(extra,k))payload[k]=extra[k];',
'      }',
'',
'      fetch("/r/"+token+"/ask",{',
'        method:"POST",',
'        headers:{"Content-Type":"application/json"},',
'        body:JSON.stringify(payload)',
'      }).then(function(r){',
'        if(!r.ok||!r.body)throw new Error("no");',
'        var ct=r.headers.get("content-type")||"";',
'        if(ct.indexOf("application/json")===0){',
'          return r.json().then(function(j){',
'            out.className="turn turn-eran";',
'            out.textContent=j.reply||"";',
'            spoken=true;',
'            return "";',
'          });',
'        }',
'        var reader=r.body.getReader();',
'        var dec=new TextDecoder();',
'        var acc="";',
'        return (function pump(){',
'          return reader.read().then(function(res){',
'            if(res.done)return acc;',
'            acc+=dec.decode(res.value,{stream:true});',
'            out.className="turn turn-eran";',
'            out.textContent=visible(acc);',
'            spoken=true;',
'            out.scrollIntoView({block:"nearest"});',
'            return pump();',
'          });',
'        })();',
'      }).then(function(acc){',
'        if(!out.textContent.trim())throw new Error("empty");',
'        if(typeof acc!=="string")return;',
'        var i=acc.indexOf(UI);',
'        if(i===-1)return;',
'        try{applyUi(JSON.parse(acc.slice(i+UI.length)));}catch(e){}',
'      }).catch(function(){',
'        /* A model that cannot answer hides the block rather than',
'           showing an error. Once it has said something real that would',
'           take the conversation away, so it just stops. */',
'        if(spoken){',
'          out.className="turn turn-eran";',
'          if(!out.textContent.trim())out.parentNode.removeChild(out);',
'          form.hidden=true;',
'        }else{',
'          talk.parentNode.removeChild(talk);',
'        }',
'      }).then(function(){',
'        busy=false;sendBtn.disabled=false;',
'      });',
'    }',
'',
'    /* ---------- what the page may offer ----------',
'       The server decides. This used to read the reply text for "how',
'       many people", then intercept the next message and provision off',
'       whatever number it found there. A manager answered that question',
'       with seven and got a live trial, a join link and a team message.',
'       Nothing here reads the prose now. */',
'    function applyUi(ui){',
'      if(!ui)return;',
'      if(ui.consent_offer)offerConsent();',
'      if(ui.provision)offerProvision(ui.provision);',
'    }',
'',
'    function offerConsent(){',
'      if(document.getElementById("consent-block"))return;',
'      var box=document.createElement("div");',
'      box.className="offer";box.id="consent-block";',
'      var btn=document.createElement("button");',
'      btn.type="button";btn.className="offer-btn";',
'      btn.textContent="Yes, set it up";',
'      btn.addEventListener("click",function(){',
'        if(box.parentNode)box.parentNode.removeChild(box);',
'        talkTo("Yes, set it up.",{consent:true});',
'      });',
'      var aside=document.createElement("span");',
'      aside.className="offer-aside";',
'      aside.textContent="or keep asking";',
'      box.appendChild(btn);box.appendChild(aside);',
'      thread.appendChild(box);',
'      box.scrollIntoView({block:"nearest"});',
'    }',
'',
'    /* Section 6.3. The trial, the join link and the team message happen',
'       when the manager presses this. They are never the answer to a',
'       sentence somebody typed. */',
'    function offerProvision(size){',
'      if(document.getElementById("provision-block"))return;',
'      if(document.getElementById("join-block"))return;',
'      var box=document.createElement("div");',
'      box.className="offer offer-wide";box.id="provision-block";',
'      var btn=document.createElement("button");',
'      btn.type="button";btn.className="offer-btn";',
'      btn.textContent="Create the link and the message";',
'      var note=document.createElement("p");',
'      note.className="offer-note";',
'      note.textContent="For a team of "+size+". This writes a message you can "+',
'        "edit and a link to send. Nothing reaches your team until you send it.";',
'      btn.addEventListener("click",function(){',
'        btn.disabled=true;',
'        provision(size,box);',
'      });',
'      box.appendChild(btn);box.appendChild(note);',
'      thread.appendChild(box);',
'      box.scrollIntoView({block:"nearest"});',
'    }',
'',
'    function provision(size,box){',
'      var out=bubble("turn-eran turn-wait","...");',
'      fetch("/r/"+token+"/trial",{',
'        method:"POST",headers:{"Content-Type":"application/json"},',
'        body:JSON.stringify({team_size:size})',
'      }).then(function(r){return r.json();}).then(function(j){',
'        out.className="turn turn-eran";',
'        if(box&&box.parentNode)box.parentNode.removeChild(box);',
'        if(j.reply){out.textContent=j.reply;return;}',
'        out.textContent="That is set up. First report "+j.first_report+',
'          ", and it stops on its own on "+j.ends_at+".";',
'        var join=document.createElement("div");',
'        join.className="join";join.id="join-block";',
'        var label=document.createElement("p");',
'        label.className="join-label";',
'        label.textContent="Send this to your team";',
'        join.appendChild(label);',
'        var a=document.createElement("a");',
'        a.href=j.join_url;a.textContent=j.join_url;',
'        join.appendChild(a);',
'        if(j.message){',
'          var ta=document.createElement("textarea");',
'          ta.className="team-msg";ta.value=j.message;',
'          ta.setAttribute("aria-label","The message to your team, edit it");',
'          join.appendChild(ta);',
'        }',
'        thread.appendChild(join);',
'        join.scrollIntoView({block:"nearest"});',
'      }).catch(function(){',
'        out.className="turn turn-eran";',
'        out.textContent="Something went wrong setting that up and Clive "+',
'          "has been told. Nothing needs doing again.";',
'      });',
'    }',
'  }',
'})();'
].join('\n');

/* ---------- render ---------- */

function render(numbers, token) {
  var eran = numbers.eran || null;

  var head = eran && eran.headline
    ? '<h1 class="headline">' + esc(eran.headline) + '</h1>' : '';
  var sub = eran && eran.sub
    ? '<p class="sub">' + esc(eran.sub) + '</p>' : '';

  var date = new Date(numbers.meta.generated_at + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  var copyTo = numbers.meta.copy_to
    ? 'A copy of this went to ' + esc(numbers.meta.copy_to) + '.' : '';

  return '<!doctype html>\n<html lang="en-GB">\n<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<meta name="robots" content="noindex, nofollow, noarchive">\n' +
    '<meta name="referrer" content="no-referrer">\n' +
    '<title>Manager Gap Index</title>\n' +
    '<link rel="stylesheet" href="/assets/fonts.css">\n' +
    '<style>\n' + CSS + '\n</style>\n' +
    '</head>\n<body>\n' +

    '<header class="masthead"><div class="wrap">' +
    '<span class="brand">Manager Gap Index</span>' +
    '<span class="stamp">Reading ' + numbers.meta.reading_no + '<br>' + esc(date) + '</span>' +
    '</div></header>\n' +

    '<main class="wrap">\n' +
    '<div class="fold-top">' + chip(numbers) + rings(numbers) + head + sub + '</div>\n' +
    readout(numbers, eran) + '\n' +
    cost(eran) + '\n' +
    changes(eran) + '\n' +
    receipt(numbers, eran) + '\n' +
    talk(token) + '\n' +
    nextMove(eran, token) + '\n' +
    folded(numbers, eran) + '\n' +

    '<footer class="foot">' + copyTo +
    ' Instrument ' + esc(numbers.meta.instrument) + '.</footer>\n' +
    '</main>\n' +

    '<script>\n' + JS + '\n</script>\n' +
    '</body>\n</html>\n';
}

module.exports = { render: render, statusLine: statusLine, CSS: CSS, JS: JS };
