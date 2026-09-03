/* =============================================================
   rings.js  ·  the five rings, drawn once

   Loaded by the browser as a global (MGIRings) and required by the
   serverless functions as a CommonJS module, so the teaser on the
   assessment page and the rings on the reading are the same circles
   from the same code and cannot drift apart.

   It carries its own colours rather than reading the page's tokens.
   The two pages have different palettes and only one of them has a
   dark theme, and a ring that changes meaning depending on which page
   it is drawn on is worse than a ring that ignores the page.
   ============================================================= */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MGIRings = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Three 120 degree slots, one per evidence item. The drawn arc is
     114.04 degrees, leaving a gap either side so the three segments
     read as three rather than as a broken circle.

     Paths rather than circles: a path takes pathLength="100", so one
     dasharray places the segment and the dark tier can carry its own.

     Rotation rides on a --rot custom property, never an SVG transform
     attribute, because the stylesheet sets transform on the segment
     class and a presentation attribute would lose to it and stack all
     three on top of each other. */

  var SEG_PATH = 'M 92 50 A 42 42 0 0 1 32.89 88.36';
  var SEG_ROT = ['-90deg', '30deg', '150deg'];

  /* items is [{tier}, {tier}, {tier}]. index staggers the draw across
     a row so the five arrive in sequence rather than all at once. */
  function svg(items, index) {
    var segs = items.map(function (item, j) {
      var delay = ((index || 0) * 0.07 + j * 0.06).toFixed(2);
      return '<path class="seg seg-' + item.tier + '" d="' + SEG_PATH +
        '" pathLength="100" style="--rot:' + SEG_ROT[j] +
        ';animation-delay:' + delay + 's"></path>';
    }).join('');

    return '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
      '<circle class="track" cx="50" cy="50" r="42"></circle>' + segs + '</svg>';
  }

  var CSS = [
    '.rings{',
    '  --ring-live:#2196F3; --ring-quiet:#A9711A;',
    '  --ring-track:rgba(23,22,26,.11); --ring-label:#6F6A60; --ring-lead:#17161A;',
    '  display:grid;grid-template-columns:repeat(5,1fr);gap:6px',
    '}',
    '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .rings{',
    '  --ring-live:#5CB2F7; --ring-quiet:#D3A24E;',
    '  --ring-track:rgba(236,231,221,.13); --ring-label:#8E887D; --ring-lead:#ECE7DD;',
    '}}',
    ':root[data-theme="dark"] .rings{',
    '  --ring-live:#5CB2F7; --ring-quiet:#D3A24E;',
    '  --ring-track:rgba(236,231,221,.13); --ring-label:#8E887D; --ring-lead:#ECE7DD;',
    '}',
    '@media (max-width:540px){.rings{grid-template-columns:repeat(3,1fr);gap:14px 6px}}',
    '.ring{appearance:none;background:none;border:0;padding:8px 2px 10px;margin:0;',
    '  display:flex;flex-direction:column;align-items:center;gap:7px;',
    '  border-radius:10px;color:inherit;font:inherit;text-align:center}',
    '.ring svg{width:100%;max-width:74px;height:auto;display:block;overflow:visible}',
    '.ring .track{fill:none;stroke:var(--ring-track);stroke-width:1}',
    '.seg{fill:none;stroke-linecap:butt;transform:rotate(var(--rot));',
    '  transform-origin:50px 50px;stroke-dashoffset:var(--from,100);opacity:0;',
    '  animation:seg-in .6s cubic-bezier(.33,.9,.35,1) forwards}',
    '.seg-fresh{stroke:var(--ring-live);stroke-width:8;stroke-dasharray:100 100}',
    '.seg-stale{stroke:var(--ring-quiet);stroke-width:2.5;stroke-dasharray:100 100}',
    '.seg-dark{stroke:var(--ring-quiet);stroke-width:2.5;stroke-dasharray:3 6;--from:9}',
    '@keyframes seg-in{to{stroke-dashoffset:0;opacity:1}}',
    '@media (prefers-reduced-motion:reduce){.seg{animation-duration:1ms}}',
    /* The five names wrap to different depths, and without a floor
       under them the counts sit at five different heights across the
       row. Three lines is the deepest of them. */
    '.ring-name{font-family:var(--ui);font-size:.68rem;line-height:1.25;',
    '  color:var(--ring-label);max-width:10ch;min-height:3.75em}',
    '.ring-count{font-family:var(--mono);font-size:.66rem;letter-spacing:.06em;',
    '  color:var(--ring-label)}'
  ].join('\n');

  return { svg: svg, CSS: CSS, SEG_PATH: SEG_PATH, SEG_ROT: SEG_ROT };
}));
