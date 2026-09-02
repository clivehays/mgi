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

/* ---------- the ring ----------
   Three 120 degree slots, one per evidence item. The drawn arc is
   114.04 degrees, leaving a gap either side so the three segments read
   as three rather than as a broken circle.

   Paths rather than circles: a path takes pathLength="100", so one
   dasharray places the segment and the dark tier can carry its own.

   Rotation rides on a --rot custom property, never an SVG transform
   attribute, because the stylesheet sets transform on the segment class
   and a presentation attribute would lose to it and stack all three on
   top of each other. */

var SEG_PATH = 'M 92 50 A 42 42 0 0 1 32.89 88.36';
var SEG_ROT = ['-90deg', '30deg', '150deg'];

function ring(area, i) {
  var segs = area.items.map(function (item, j) {
    var delay = (i * 0.07 + j * 0.06).toFixed(2);
    return '<path class="seg seg-' + item.tier + '" d="' + SEG_PATH +
      '" pathLength="100" style="--rot:' + SEG_ROT[j] +
      ';animation-delay:' + delay + 's"></path>';
  }).join('');

  return '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
    '<circle class="track" cx="50" cy="50" r="42"></circle>' + segs + '</svg>';
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

function nextMove(eran) {
  if (!eran || !eran.next_move) return '';
  var n = eran.next_move;
  return '<section class="next">' +
    '<h2 class="section-head mono">The next move</h2>' +
    '<p class="next-action">' + esc(n.action) + '</p>' +
    '<p class="next-question">' + esc(n.question) + '</p>' +
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
'.rings{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:0 0 26px}',
'@media (max-width:540px){.rings{grid-template-columns:repeat(3,1fr);gap:10px 6px}}',
'.ring{appearance:none;background:none;border:0;padding:8px 2px 10px;margin:0;',
'  display:flex;flex-direction:column;align-items:center;gap:7px;cursor:pointer;',
'  border-radius:10px;color:inherit;font:inherit}',
'.ring svg{width:100%;max-width:74px;height:auto;display:block;overflow:visible}',
'.ring .track{fill:none;stroke:var(--hair);stroke-width:1}',
'.seg{fill:none;stroke-linecap:butt;transform:rotate(var(--rot));',
'  transform-origin:50px 50px;stroke-dashoffset:var(--from,100);opacity:0;',
'  animation:seg-in .6s cubic-bezier(.33,.9,.35,1) forwards}',
'.seg-fresh{stroke:var(--blue);stroke-width:8;stroke-dasharray:100 100}',
'.seg-stale{stroke:var(--amber);stroke-width:2.5;stroke-dasharray:100 100}',
'.seg-dark{stroke:var(--amber);stroke-width:2.5;stroke-dasharray:3 6;--from:9}',
'@keyframes seg-in{to{stroke-dashoffset:0;opacity:1}}',
'@media (prefers-reduced-motion:reduce){.seg{animation-duration:1ms}}',
'.ring-name{font-family:var(--ui);font-size:.68rem;line-height:1.25;',
'  text-align:center;color:var(--ink-mute);max-width:9ch}',
'.ring-count{font-size:.66rem;color:var(--ink-mute)}',
'.ring[aria-selected="true"] .ring-name{color:var(--ink);font-weight:600}',
'.ring[aria-selected="true"] .ring-count{color:var(--ink)}',
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

'.next-action{margin:0 0 14px}',
'.next-question{font-style:italic;font-size:1.1rem;line-height:1.4;margin:0;',
'  padding-left:16px;border-left:2px solid var(--amber)}',

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

'.foot{margin:34px 0 0;padding:18px 0 42px;border-top:1px solid var(--hair);',
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
'})();'
].join('\n');

/* ---------- render ---------- */

function render(numbers) {
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
    nextMove(eran) + '\n' +
    folded(numbers, eran) + '\n' +

    '<footer class="foot">' + copyTo +
    ' Instrument ' + esc(numbers.meta.instrument) + '.</footer>\n' +
    '</main>\n' +

    '<script>\n' + JS + '\n</script>\n' +
    '</body>\n</html>\n';
}

module.exports = { render: render, statusLine: statusLine, CSS: CSS, JS: JS };
