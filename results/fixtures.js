/* =============================================================
   The fixture set. One list, used by the acceptance tests and by the
   writer, so the pages on disk can never fall behind the pages under
   test. They did once: four of eight were written and the four missing
   were the edge cases.
   ============================================================= */

/* item order per area, from AREAS in derive.js:
   readiness 1,2,13 | results 3,4,14 | involvement 5,6,11
   direction 7,8,15 | alignment 9,10,12 */
var ITEMS = {
  readiness: [1, 2, 13], results: [3, 4, 14], involvement: [5, 6, 11],
  direction: [7, 8, 15], alignment: [9, 10, 12]
};

function build(map) {
  var e = new Array(15).fill(3);
  Object.keys(map).forEach(function (k) {
    ITEMS[k].forEach(function (n, i) { e[n - 1] = map[k][i]; });
  });
  return e;
}

function sub(evidence, o) {
  o = o || {};
  return {
    answers: {
      gut: o.gut || 'fine', evidence: evidence,
      output: o.output || 'held', external: o.external || 'no',
      energy: o.energy || 'same', exposure: o.exposure || 'few_times'
    },
    contact: { email: 'm@example.com' }
  };
}

module.exports = {
  build: build,
  FIXTURES: {
    'cruise-direction-dark': sub(build({ direction: [0, 0, 0] }),
      { gut: 'great', exposure: 'most_days' }),

    'headwinds-all-stale': sub([0, 3, 3, 3, 0, 2, 0, 0, 2, 0, 2, 2, 3, 1, 1],
      { gut: 'struggling', output: 'slipped_slightly', external: 'yes', exposure: 'less_weekly' }),

    /* The case the brief flagged and the reference does not cover: every
       ring holds something current, so quiet_count is 0, while ten of the
       fifteen items are older than a month and the team is in Headwinds.
       Signal 23 of 45. The default variant-0 sub congratulates here,
       which is why sub_thin exists. */
    'headwinds-all-thin': sub(build({
      readiness: [3, 1, 1], results: [3, 1, 1], involvement: [3, 1, 1],
      direction: [2, 1, 1], alignment: [2, 1, 1]
    }), { gut: 'off', output: 'slipped_slightly', external: 'yes', exposure: 'weekly' }),

    /* 1c. thin with two quiet rings. Two areas dark, and the three still
       reading hold one fresh item each, so the sub has to say both things
       at once without contradicting itself. */
    'thin-two-quiet': sub(build({
      direction: [0, 0, 0], alignment: [0, 0, 0],
      readiness: [3, 1, 1], results: [2, 1, 1], involvement: [2, 1, 1]
    }), { gut: 'off', output: 'held', energy: 'lower', exposure: 'weekly' }),

    /* the same two quiet rings with solid ones behind them, which must NOT
       read as thin. The pair is the point. */
    'solid-two-quiet': sub(build({
      direction: [0, 0, 0], alignment: [0, 0, 0]
    }), { gut: 'fine', output: 'held', exposure: 'most_days' }),

    'cruise-all-fresh': sub(new Array(15).fill(3), { gut: 'great', exposure: 'most_days' }),

    'drift-two-quiet': sub(build({ direction: [0, 1, 1], alignment: [1, 0, 1] }),
      { gut: 'fine', output: 'held', energy: 'lower', exposure: 'weekly' }),

    'stall-all-dark': sub(new Array(15).fill(0),
      { gut: 'struggling', output: 'slipped_noticeably', external: 'no', energy: 'lower', exposure: 'less_weekly' }),

    'headwinds-results-focus': sub(build({ results: [0, 1, 1] }),
      { gut: 'off', output: 'slipped_slightly', external: 'yes', exposure: 'few_times' }),

    'readiness-focus': sub(build({ readiness: [0, 1, 1] }),
      { gut: 'fine', exposure: 'most_days' }),

    'involvement-focus': sub(build({ involvement: [0, 1, 1] }),
      { gut: 'fine', exposure: 'most_days' })
  }
};
