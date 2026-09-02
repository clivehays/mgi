/* =============================================================
   render.js  ยท  payload + copy bank  ->  self-contained results.html

   Deterministic. Every string is a computed number or a copy-bank
   lookup. No model call, no fetch at render time, none in the output.

   Build brief v2 sections 5 and 6, addendum A.
   ============================================================= */

var fs = require('fs');
var path = require('path');

var BANK = JSON.parse(fs.readFileSync(path.join(__dirname, 'copy-bank.json'), 'utf8'));

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* copy bank strings may carry <strong> and <b>; they are authored, not
   user input, so they pass through. Everything derived from a
   submission goes through esc(). */
function copy(s) { return String(s === undefined || s === null ? '' : s); }

/* ---------- the ring ----------
   Three 120 degree slots, one per evidence item. The drawn arc is
   114.04 degrees, leaving a 5.96 degree gap, which is the brief's
   83.6 of 263.9 expressed as geometry.

   Paths rather than circles. A circle plus stroke-dasharray can place
   one segment, but it cannot then carry the 3 7 dash the dark tier
   needs, since that dasharray has to describe the whole circumference.
   A path takes pathLength="100", so one dasharray places the segment
   and another dashes it.

   Rotation rides on a --rot custom property, never an SVG transform
   attribute: the stylesheet sets transform on the segment class, and a
   presentation attribute would lose to it and stack all three on top
   of each other. */

var SEG_PATH = 'M 92 50 A 42 42 0 0 1 32.89 88.36';
var SEG_ROT = ['-90deg', '30deg', '150deg'];

function ring(area, ringIndex) {
  var segs = area.items.map(function (item, i) {
    var delay = (ringIndex * 0.06 + i * 0.05).toFixed(2);
    return '<path class="seg seg-' + item.tier + '" d="' + SEG_PATH + '" pathLength="100" ' +
      'style="--rot:' + SEG_ROT[i] + ';--off:0;animation-delay:' + delay + 's"></path>';
  }).join('');

  return '<svg viewBox="0 0 100 100" aria-hidden="true">' +
    '<circle class="halo" cx="50" cy="50" r="49"></circle>' +
    '<circle class="track" cx="50" cy="50" r="42"></circle>' +
    segs + '</svg>';
}

/* the status line stays true to what the manager actually answered
   rather than to the tier each answer was bucketed into */
function statusLine(area) {
  var order = [3, 2, 1, 0];
  var label = { 3: 'inside the week', 2: 'inside the month', 1: 'over a month ago', 0: 'not recalled' };
  var counts = {};
  area.items.forEach(function (i) { counts[i.value] = (counts[i.value] || 0) + 1; });
  var parts = order.filter(function (v) { return counts[v]; }).map(function (v) {
    var txt = counts[v] + ' ' + label[v];
    return v <= 1 ? '<b>' + txt + '</b>' : txt;
  });
  if (parts.length === 1 && area.items[0].value >= 2) {
    return esc(area.items.length + ' of ' + area.items.length + ' ' + label[area.items[0].value]);
  }
  return parts.join(' &middot; ');
}

/* The one conditional that makes phase 3 a copy change rather than a
   render change. A generated string wins where one exists; the bank is
   the fallback for every slot, permanently. */
function gen(payload, path, fallback) {
  var g = payload.generated;
  if (!g) return fallback;
  var node = g;
  var parts = path.split('.');
  for (var i = 0; i < parts.length; i++) {
    if (node === null || typeof node !== 'object') return fallback;
    node = node[parts[i]];
  }
  return (typeof node === 'string' && node.length) ? node : fallback;
}

function tabs(payload) {
  return payload.areas.map(function (a, i) {
    var d = BANK.dimension[a.key];
    var quiet = a.fresh === 0;
    var selected = a.key === payload.focus;
    /* type="button" is not decoration. A <button> with no type defaults to
       submit, and these two are the tab strip and the disclosure toggles.
       There is no form on the page today, so they are inert, and the day
       anyone wraps this markup in one they become reload buttons on the
       manager's own reading. */
    return '<button type="button" class="inst' + (quiet ? ' off' : '') + '" role="tab" id="t-' + a.key + '"' +
      ' aria-controls="readout" aria-selected="' + (selected ? 'true' : 'false') + '"' +
      ' tabindex="' + (selected ? '0' : '-1') + '"' +
      ' data-key="' + a.key + '"' +
      ' data-dim="' + esc(a.dimension) + '"' +
      ' data-name="' + esc(a.plain) + '"' +
      ' data-quiet="' + (quiet ? '1' : '0') + '"' +
      ' data-asks="' + esc(d.asks) + '"' +
      ' data-status="' + statusLine(a).replace(/"/g, '&quot;') + '"' +
      ' data-means="' + copy(gen(payload, 'means.' + a.key, d.means[a.pattern])).replace(/"/g, '&quot;') + '">' +
      ring(a, i) +
      '<span class="inst-label">' + esc(a.plain) + '</span>' +
      '<span class="inst-count">' + a.fresh + '/3</span>' +
      '</button>';
  }).join('');
}

/* ---------- So What ---------- */

function soWhat(payload) {
  var d = BANK.dimension[payload.focus];
  var calc = payload.calculator;

  if (calc.pattern === 'B') {
    var slot = copy(d.ledger.slot).split('\n').map(esc).join('<br>');
    return '<section class="sowhat">' +
      '<span class="eyebrow">' + esc(BANK.ui.sowhat_eyebrow) + '</span>' +
      '<h2 class="sw-head">' + esc(payload.stale_majority ? BANK.sowhat_headline_stale_majority : d.sowhat.split('.')[0] + '.') + '</h2>' +
      '<p class="sw-slot sw-phrase">' + slot + '</p>' +
      '<p class="sw-cap">' + esc(d.ledger.caption) + '</p>' +
      '<p class="sw-body">' + copy(gen(payload, 'sowhat', d.sowhat)) + '</p>' +
      '</section>';
  }

  function stepper(which, cfg, label) {
    return '<div class="dial">' +
      '<span class="dial-label">' + esc(label) + '</span>' +
      '<div class="dial-ctl">' +
      '<button type="button" class="step" data-dial="' + which + '" data-dir="-1" aria-label="Decrease ' + esc(label) + '">&minus;</button>' +
      '<output class="dial-val" id="dial-' + which + '" data-min="' + cfg.min + '" data-max="' + cfg.max + '" data-step="' + cfg.step + '">' + cfg.def + '</output>' +
      '<button type="button" class="step" data-dial="' + which + '" data-dir="1" aria-label="Increase ' + esc(label) + '">+</button>' +
      '</div></div>';
  }

  return '<section class="sowhat">' +
    '<span class="eyebrow">' + esc(BANK.ui.sowhat_eyebrow) + '</span>' +
    '<h2 class="sw-head">' + esc(payload.stale_majority ? BANK.sowhat_headline_stale_majority : d.calc.head) + '</h2>' +
    '<p class="sw-lead">' + esc(d.calc.lead) + '</p>' +
    '<div class="dials">' + stepper('a', calc.a, d.calc.a) + stepper('b', calc.b, d.calc.b) + '</div>' +
    '<p class="sw-slot sw-num" id="sw-num" data-value="' + (calc.a.def * calc.b.def * 5) + '">' +
      (calc.a.def * calc.b.def * 5) + '</p>' +
    '<p class="sw-cap">' + esc(d.calc.caption) + '</p>' +
    '<p class="print-note">' + esc(BANK.ui.print_note) + '</p>' +
    '<p class="sw-body">' + copy(gen(payload, 'sowhat', d.sowhat)) + '</p>' +
    '</section>';
}

/* ---------- the cheap part ---------- */

/* A generated list wins over the bank's. Kept as a statement rather than
   an expression inside the concatenation: + binds tighter than ?:, so an
   inline ternary here silently swallowed the whole section once. */
function changeLines(payload, d) {
  var g = payload.generated && payload.generated.changes;
  var lines = (Array.isArray(g) && g.length) ? g : d.changes;
  return lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('');
}

function cheap(payload) {
  var d = BANK.dimension[payload.focus];
  var c = BANK.cheap[payload.gating.cheap];
  return '<section class="cheap">' +
    '<span class="eyebrow">' + esc(BANK.cheap.eyebrow) + '</span>' +
    '<h2 class="sw-head">' + esc(c.head) + '</h2>' +
    '<p class="sw-body">' + esc(c.body) + '</p>' +
    '<ul class="changes">' + changeLines(payload, d) + '</ul></section>';
}

/* ---------- the receipt ---------- */

function receipt(payload) {
  var st = BANK.state[payload.state];
  var cell4 = BANK.receipt.cell4[payload.gating.cell4];
  var cells = [
    /* a leading zero under "confirmed healthy" reads as a score rather
       than as a finding, which is the sarcasm the brief warns about */
    { v: payload.healthy_count,
      l: payload.healthy_count === 0 ? BANK.receipt.cell1_label_none : BANK.receipt.cell1_label },
    { v: Math.max(1, payload.quiet_count), l: BANK.receipt.cell2_label },
    { v: 1, l: BANK.receipt.cell3_label },
    { v: cell4.value, l: cell4.label }
  ];
  var subject = 'MGI ' + payload.state_name + ' / ' + payload.focus_dimension;
  return '<div class="receipt">' +
    '<span class="eyebrow">' + esc(BANK.receipt.eyebrow) + '</span>' +
    '<h2>' + esc(st.receipt_head) + '</h2>' +
    '<div class="grid">' +
    cells.map(function (c) {
      return '<div class="cell"><span class="cell-v">' + esc(c.v) + '</span>' +
        '<span class="cell-l">' + esc(c.l) + '</span></div>';
    }).join('') +
    '</div>' +
    '<p class="r-body">' + esc(BANK.receipt.body) + '</p>' +
    '<p class="r-pivot">' + esc(BANK.receipt.pivot) + '</p>' +
    '<!--email_off--><a class="cta" href="mailto:clive@managergap.com?subject=' + encodeURIComponent(subject) + '">' +
      esc(BANK.receipt.cta) + '</a><!--/email_off-->' +
    '<p class="r-sig">' + esc(BANK.receipt.sig) + '</p>' +
    '</div>';
}

/* ---------- disclosure ---------- */

function rows(payload) {
  var d = BANK.dimension[payload.focus];
  var st = BANK.state[payload.state];
  var los = { full: 'Full', partial: 'Partial', narrow: 'Narrow', minimal: 'Minimal' }[payload.line_of_sight];
  var gw = { narrow: 'Narrow', moderate: 'Moderate', wide: 'Wide', very_wide: 'Very wide' }[payload.gap_width];

  var items = [
    { t: BANK.disclosure.thursday.title, b: '<p class="ask">' + esc(gen(payload, 'thursday', d.thursday)) + '</p>' },
    { t: BANK.disclosure.rings.title, b: '<p>' + esc(BANK.disclosure.rings.body) + '</p>' },
    { t: BANK.disclosure.state.title.replace('{state}', payload.state_name), b: '<p>' + esc(st.means) + '</p>' },
    { t: BANK.disclosure.chair.title,
      b: '<p class="dl">Line of sight <b>' + esc(los) + '</b> &middot; Gap width <b>' + esc(gw) +
         '</b> &middot; Signal <b>' + payload.signal.score + ' / ' + payload.signal.max + '</b></p>' +
         '<p>' + copy(BANK.disclosure.chair.body) + '</p>' }
  ];

  return '<div class="rows">' + items.map(function (r, i) {
    return '<div class="row">' +
      '<button type="button" class="row-t" aria-expanded="false" aria-controls="p' + i + '" id="b' + i + '">' +
      '<span>' + esc(r.t) + '</span><span class="plus" aria-hidden="true">+</span></button>' +
      '<div class="row-p" id="p' + i + '" role="region" aria-labelledby="b' + i + '" hidden>' + r.b + '</div>' +
      '</div>';
  }).join('') + '</div>';
}

/* ---------- the page ---------- */

/* The proxy in front of this domain rewrites any address it finds into
   a placeholder that only a script can decode. It turned the one CTA on
   the page into a dead link for anyone without that script, and told the
   manager their copy was on its way to "[email protected]" rather than
   to their own address. Cloudflare's documented opt-out is this comment
   pair, which travels with the markup instead of depending on a
   dashboard setting or on whether the proxy is on at all. */
function render(payload) {
  var h = BANK.headline[String(payload.quiet_count)];
  /* stale_majority qualifies the sub wherever it discriminates. Two quiet rings
     with three solid ones behind them is a different position from two
     quiet with three running on memory, and those read alike otherwise.
     Variants 3 and above carry no variant: at that quiet count the flag is
     arithmetically certain, so a variant would replace the brief's
     sub outright rather than qualify it. */
  /* Variant 0 is the one congratulatory line in the bank, and quiet_count
     alone does not earn it. A manager who reported slipping work and an
     external squeeze can still have something current in all five rings,
     and the page would open by congratulating them on a team the
     instrument had just put in Headwinds. stale_majority does not catch
     it: that measures the age of the evidence, and this manager's
     evidence is current. What disqualifies the congratulation is the
     state, which is the manager's own account of the week. Only Cruise
     earns it. */
  var adverse = payload.state !== 'cruise';
  var subText = h.sub;
  if (payload.stale_majority && h.sub_stale_majority) subText = h.sub_stale_majority;
  else if (adverse && h.sub_adverse) subText = h.sub_adverse;
  var sub = subText.replace('{state}', payload.state_name);
  var st = BANK.state[payload.state];

  return '<!doctype html>\n<html lang="en-GB"><head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
'<title>Manager Gap Index</title>\n' +
'<meta name="robots" content="noindex">\n' +
'<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
'<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
'<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">\n' +
'<style>' + CSS + '</style>\n' +
'</head><body>\n' +
'<div class="page">\n' +
  '<header class="masthead"><span class="wordmark">Manager Gap Index</span>' +
  '<span class="eyebrow">Reading ' + String(payload.meta.reading_no).padStart(3, '0') +
  ' &middot; ' + esc(payload.meta.generated_at) + '</span></header>\n' +
  '<div class="chip chip-' + esc(payload.state) + '"><i></i>' + esc(st.chip) + '</div>\n' +
  '<div class="rings" role="tablist" aria-label="The five conditions">' + tabs(payload) + '</div>\n' +
  '<p class="hint">' + esc(BANK.ui.ring_hint) + '</p>\n' +
  '<h1 class="headline">' + esc(h.head) + '</h1>\n' +
  '<p class="sub">' + esc(sub) + '</p>\n' +
  '<section class="readout" id="readout" role="tabpanel" aria-live="polite" aria-labelledby="t-' + esc(payload.focus) + '">' +
    '<span class="eyebrow" id="r-dim"></span>' +
    '<h2 id="r-name"></h2>' +
    '<p class="asks"><span class="lbl">' + esc(BANK.ui.asks_label) + '</span> <i id="r-asks"></i></p>' +
    '<p class="status"><span class="lbl">' + esc(BANK.ui.status_label) + '</span> <span id="r-status"></span></p>' +
    '<p class="means"><span class="lbl">' + esc(BANK.ui.means_label) + '</span> <span id="r-means"></span></p>' +
  '</section>\n' +
  soWhat(payload) + '\n' + cheap(payload) + '\n' + receipt(payload) + '\n' + rows(payload) + '\n' +
  '<footer class="foot"><span class="eyebrow">' +
    '<!--email_off-->' + esc(BANK.ui.copy_to.replace('{email}', payload.meta.copy_to)) + '<!--/email_off--></span>' +
  '<span class="eyebrow">MGI v' + esc(payload.meta.instrument) + '</span></footer>\n' +
'</div>\n<script>' + JS + '</script>\n</body></html>\n';
}

/* ---------- styles ----------
   Full light palette on bare :root. Dark redefines only the tokens,
   under a guarded media query and again under an explicit data-theme,
   so the toggle wins in both directions and no colour is ever declared
   only inside a media block. */

var CSS = [
':root{--paper:#F1ECE3;--panel:#E9E3D7;--ink:#17161A;--muted:#6F6A60;--faint:#8A8478;--rule:#D6CFC1;--live:#1668B0;--live-bright:#2196F3;--quiet:#A9711A;--field:#0F2B4C;--on-field:#EDE7DC;',
'--serif:"Source Serif 4",Georgia,"Times New Roman",serif;--ui:"Inter Tight",system-ui,-apple-system,sans-serif;--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Consolas,monospace}',
'@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#0F1214;--panel:#171B1E;--ink:#EBE6DC;--muted:#948F86;--faint:#7C776E;--rule:#2C3136;--live:#4FA6F5;--live-bright:#5AACF7;--quiet:#DCA753;--field:#0B1E33;--on-field:#EBE6DC}}',
':root[data-theme="dark"]{--paper:#0F1214;--panel:#171B1E;--ink:#EBE6DC;--muted:#948F86;--faint:#7C776E;--rule:#2C3136;--live:#4FA6F5;--live-bright:#5AACF7;--quiet:#DCA753;--field:#0B1E33;--on-field:#EBE6DC}',
'*{box-sizing:border-box}html,body{margin:0;background:var(--paper);color:var(--ink)}',
'body{font-family:var(--ui);line-height:1.5;-webkit-font-smoothing:antialiased}',
'.page{max-width:760px;margin:0 auto;padding:26px 22px 60px}',
'.eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:500}',
'.masthead{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding-bottom:16px;border-bottom:1px solid var(--rule)}',
'.wordmark{font-family:var(--serif);font-style:italic;font-size:18px}',
'.chip{display:inline-flex;align-items:center;gap:8px;margin:20px 0 22px;padding:6px 13px;border:1px solid var(--rule);border-radius:100px;font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}',
'.chip i{width:7px;height:7px;border-radius:50%;background:var(--quiet)}.chip-cruise i{background:var(--live)}.chip-stall i{background:#8A5A12}',
'.rings{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:0 0 12px}',
'@media (max-width:540px){.rings{grid-template-columns:repeat(3,1fr);gap:14px}}',
'.inst{display:flex;flex-direction:column;align-items:center;gap:7px;background:none;border:0;padding:8px 2px;cursor:pointer;color:var(--muted);font-family:inherit}',
'.inst svg{width:100%;max-width:78px;height:auto;overflow:visible}',
'.track{fill:none;stroke:var(--rule);stroke-width:5;opacity:.5}',
'.halo{fill:none;stroke:var(--live);stroke-width:1;opacity:0;transition:opacity .25s ease}',
'.inst.off .halo{stroke:var(--quiet)}.inst[aria-selected="true"] .halo{opacity:.55}',
'.seg{fill:none;stroke-linecap:butt;transform:rotate(var(--rot));transform-origin:50% 50%;stroke-dasharray:100;stroke-dashoffset:100;animation:draw .95s cubic-bezier(.22,.68,.3,1) forwards}',
'@keyframes draw{to{stroke-dashoffset:var(--off)}}',
'.seg-fresh{stroke:var(--live);stroke-width:5}',
'.seg-stale{stroke:var(--quiet);stroke-width:2}',
'.seg-dark{stroke:var(--quiet);stroke-width:2;stroke-dasharray:3 7;stroke-dashoffset:0;opacity:0;animation:fade .7s ease .95s forwards}',
'@keyframes fade{to{opacity:1}}',
'.inst-label{font-size:12.5px;line-height:1.35;text-align:center;font-weight:500}',
'.inst-count{font-family:var(--mono);font-size:10px;letter-spacing:.08em;color:var(--faint);font-variant-numeric:tabular-nums}',
'.inst.off .inst-label,.inst.off .inst-count{color:var(--quiet)}.inst.off .inst-label{font-weight:600}',
'.inst[aria-selected="true"] .inst-label{color:var(--ink);box-shadow:inset 0 -2px 0 var(--ink)}',
'.hint{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);text-align:center;margin:0 0 30px}',
'.headline{font-family:var(--serif);font-size:clamp(27px,5.4vw,38px);line-height:1.14;letter-spacing:-.02em;font-weight:400;margin:0 0 10px}',
'.sub{font-family:var(--serif);font-size:clamp(16px,3.2vw,18px);color:var(--muted);margin:0 0 30px;max-width:34em}',
'.readout{background:var(--panel);border-radius:3px;padding:22px 22px 24px;margin:0 0 34px;transition:opacity .18s ease}',
'.readout.swap{opacity:0}',
'.readout .eyebrow{color:var(--live);display:block;margin-bottom:9px}',
'.readout.quiet .eyebrow{color:var(--quiet)}',
'.readout h2{font-family:var(--serif);font-size:24px;font-weight:400;margin:0 0 16px;line-height:1.2}',
'.lbl{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-right:7px}',
'.asks{margin:0 0 14px;border-left:2px solid var(--rule);padding-left:14px}',
'.asks i{font-family:var(--serif);font-style:italic;font-size:17px;color:var(--ink)}',
'.status{font-family:var(--mono);font-size:11px;letter-spacing:.03em;color:var(--muted);margin:0 0 14px}',
'.status b{color:var(--quiet);font-weight:500}',
'.means{font-family:var(--serif);font-size:16.5px;line-height:1.6;margin:0}',
'.sowhat,.cheap{margin:0 0 34px}',
'.sw-head{font-family:var(--serif);font-size:clamp(21px,4vw,27px);font-weight:400;line-height:1.24;margin:10px 0 12px;max-width:26em}',
'.sw-lead{color:var(--muted);margin:0 0 20px;max-width:32em}',
'.dials{display:flex;flex-wrap:wrap;gap:22px 34px;margin:0 0 22px}',
'.dial-label{display:block;font-size:13px;color:var(--muted);margin-bottom:7px;max-width:19em}',
'.dial-ctl{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--rule);border-radius:3px}',
'.step{background:none;border:0;color:var(--muted);font-size:17px;line-height:1;padding:8px 13px;cursor:pointer;font-family:inherit}',
'.step:hover{color:var(--ink)}',
'.dial-val{font-family:var(--mono);font-size:15px;min-width:44px;text-align:center;font-variant-numeric:tabular-nums;color:var(--ink)}',
'.sw-slot{color:var(--quiet);font-family:var(--serif);margin:0 0 6px;line-height:1.02}',
'.sw-num{font-size:clamp(66px,13vw,104px);font-variant-numeric:tabular-nums}',
'.sw-phrase{font-size:clamp(34px,6vw,54px);line-height:1.12}',
'.sw-cap{color:var(--muted);font-size:14px;margin:0 0 20px;max-width:28em}',
'.sw-body{font-family:var(--serif);font-size:16.5px;line-height:1.62;margin:0;max-width:34em}',
'.changes{list-style:none;padding:0;margin:20px 0 0;border-top:1px solid var(--rule)}',
'.changes li{position:relative;padding:11px 0 11px 20px;border-bottom:1px solid var(--rule);font-size:15px}',
'.changes li:before{content:"";position:absolute;left:2px;top:18px;width:5px;height:5px;border-radius:50%;background:var(--live)}',
'.receipt{background:var(--field);color:var(--on-field);border-radius:3px;padding:28px 24px 30px;margin:0 0 34px}',
'.receipt .eyebrow{color:rgba(237,231,220,.62);display:block;margin-bottom:10px}',
'.receipt h2{font-family:var(--serif);font-size:clamp(22px,4.2vw,28px);font-weight:400;margin:0 0 22px;line-height:1.2}',
'.grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:rgba(237,231,220,.16);margin:0 0 22px}',
'.cell{background:var(--field);padding:15px 4px 15px 0}',
'.cell-v{display:block;font-family:var(--serif);font-size:34px;line-height:1;font-variant-numeric:tabular-nums}',
'.cell-l{display:block;font-size:12.5px;line-height:1.4;color:rgba(237,231,220,.72);margin-top:5px;max-width:15em}',
'.r-body{font-size:15px;line-height:1.6;color:rgba(237,231,220,.82);margin:0 0 16px;max-width:34em}',
'.r-pivot{font-family:var(--serif);font-size:17.5px;line-height:1.5;margin:0 0 22px;max-width:30em}',
'.cta{display:inline-block;background:var(--on-field);color:var(--field);text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:2px}',
'.r-sig{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(237,231,220,.55);margin:16px 0 0}',
'.rows{border-top:1px solid var(--rule)}',
'.row{border-bottom:1px solid var(--rule)}',
'.row-t{width:100%;display:flex;justify-content:space-between;align-items:center;gap:14px;background:none;border:0;padding:15px 0;cursor:pointer;color:var(--ink);font-family:inherit;font-size:15px;text-align:left}',
'.plus{color:var(--muted);font-size:17px;transition:transform .2s ease}',
'.row-t[aria-expanded="true"] .plus{transform:rotate(45deg)}',
'.row-p{padding:0 0 18px;font-size:15px;line-height:1.62;color:var(--muted);max-width:36em}',
'.row-p p{margin:0 0 12px}.row-p p:last-child{margin:0}',
'.row-p .ask{font-family:var(--serif);font-style:italic;font-size:16.5px;color:var(--ink);border-left:2px solid var(--rule);padding-left:14px}',
'.row-p .dl{font-family:var(--mono);font-size:11px;letter-spacing:.04em;text-transform:uppercase}',
'.foot{margin-top:44px;display:flex;gap:14px 30px;flex-wrap:wrap;justify-content:space-between}',
'.print-note{display:none}',
'button:focus-visible,a:focus-visible{outline:2px solid var(--live-bright);outline-offset:3px}',
'@media (prefers-reduced-motion:reduce){*{transition:none!important}',
'.seg{animation:none;stroke-dashoffset:var(--off)}.seg-dark{animation:none;opacity:1}.plus{transition:none}}',
'@media print{.page{max-width:none}.rings{page-break-inside:avoid}.step{display:none}',
'.row-p{display:block!important}.plus{display:none}.print-note{display:block;font-size:12px;color:var(--muted);margin:0 0 14px}',
'.receipt{background:none;color:var(--ink);border:1px solid var(--rule)}.cell{background:none}',
'.cta{border:1px solid var(--ink);color:var(--ink);background:none}.r-body,.cell-l,.r-sig{color:var(--muted)}}'
].join('');

/* ---------- behaviour ----------
   Tablist with arrow keys, disclosure rows, and the count-up. No
   fetches, no dependencies. */

var JS = [
'(function(){',
'var tabs=[].slice.call(document.querySelectorAll(".inst"));',
'var ro=document.getElementById("readout");',
'function paint(b){',
'  ro.classList.add("swap");',
'  var go=function(){',
'    document.getElementById("r-dim").textContent=b.dataset.dim;',
'    document.getElementById("r-name").textContent=b.dataset.name;',
'    document.getElementById("r-asks").textContent=b.dataset.asks;',
'    document.getElementById("r-status").innerHTML=b.dataset.status;',
'    document.getElementById("r-means").innerHTML=b.dataset.means;',
'    ro.classList.toggle("quiet",b.dataset.quiet==="1");',
'    ro.setAttribute("aria-labelledby",b.id);',
'    ro.classList.remove("swap");',
'  };',
'  if(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches){go();}',
'  else{setTimeout(go,180);}',
'}',
'function select(b,focus){',
'  tabs.forEach(function(t){t.setAttribute("aria-selected",t===b?"true":"false");t.tabIndex=t===b?0:-1;});',
'  paint(b); if(focus)b.focus();',
'}',
'tabs.forEach(function(b){',
'  b.addEventListener("click",function(){select(b,false);});',
'  b.addEventListener("keydown",function(e){',
'    var i=tabs.indexOf(b),n=null;',
'    if(e.key==="ArrowRight"||e.key==="ArrowDown")n=tabs[(i+1)%tabs.length];',
'    if(e.key==="ArrowLeft"||e.key==="ArrowUp")n=tabs[(i-1+tabs.length)%tabs.length];',
'    if(e.key==="Home")n=tabs[0]; if(e.key==="End")n=tabs[tabs.length-1];',
'    if(n){e.preventDefault();select(n,true);}',
'  });',
'});',
'var sel=document.querySelector(\'.inst[aria-selected="true"]\')||tabs[0];',
'if(sel){document.getElementById("r-dim").textContent=sel.dataset.dim;',
'document.getElementById("r-name").textContent=sel.dataset.name;',
'document.getElementById("r-asks").textContent=sel.dataset.asks;',
'document.getElementById("r-status").innerHTML=sel.dataset.status;',
'document.getElementById("r-means").innerHTML=sel.dataset.means;',
'ro.classList.toggle("quiet",sel.dataset.quiet==="1");}',
'[].forEach.call(document.querySelectorAll(".row-t"),function(b){',
'  b.addEventListener("click",function(){',
'    var open=b.getAttribute("aria-expanded")==="true";',
'    b.setAttribute("aria-expanded",open?"false":"true");',
'    document.getElementById(b.getAttribute("aria-controls")).hidden=open;',
'  });',
'});',
'var num=document.getElementById("sw-num");',
'if(num){',
'  var dials={a:document.getElementById("dial-a"),b:document.getElementById("dial-b")};',
'  var raf=null;',
'  var reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;',
'  function val(o){return parseFloat(o.textContent);}',
'  function fmt(n){return String(Math.round(n));}',
'  function count(to){',
'    var from=parseFloat(num.dataset.value)||0;',
'    num.dataset.value=to;',
'    /* write the answer first. The count is decoration, and rAF does not',
'       always run: a throttled or backgrounded tab would otherwise leave',
'       the reader looking at the previous number. */',
'    num.textContent=fmt(to);',
'    if(reduce||from===to)return;',
'    if(raf)cancelAnimationFrame(raf);',
'    var t0=null,dur=320;',
'    function tick(t){',
'      if(!t0)t0=t;',
'      var p=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-p,3);',
'      num.textContent=fmt(from+(to-from)*e);',
'      if(p<1)raf=requestAnimationFrame(tick);',
'    }',
'    raf=requestAnimationFrame(tick);',
'  }',
'  function recompute(){count(val(dials.a)*val(dials.b)*5);}',
'  [].forEach.call(document.querySelectorAll(".step"),function(btn){',
'    btn.addEventListener("click",function(){',
'      var o=dials[btn.dataset.dial];',
'      var step=parseFloat(o.dataset.step),min=parseFloat(o.dataset.min),max=parseFloat(o.dataset.max);',
'      var v=val(o)+step*parseInt(btn.dataset.dir,10);',
'      v=Math.min(max,Math.max(min,Math.round(v/step)*step));',
'      o.textContent=(step<1?v.toFixed(1):String(v));',
'      recompute();',
'    });',
'  });',
'}',
'})();'
].join('\n');

module.exports = { render: render, BANK: BANK };
