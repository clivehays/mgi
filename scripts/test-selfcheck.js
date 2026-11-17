/* =============================================================
   The short self-check: the invariants that must hold.

   Offline and deterministic. It does not touch the database, so it can
   run on every push. The one thing it cannot check here is how well the
   five chosen items track the full fifteen, because that is a fact about
   the cohort rather than about the code; that measurement lives in
   scripts/selfcheck-cohort.js and is quoted in the comment at the top of
   assets/selfcheck-core.js.

   What it does check is that the short form asks the instrument rather
   than a copy of it, that every answer anyone can give produces a whole
   scorecard, and that the page has somewhere to put each part of it.

     node scripts/test-selfcheck.js
   ============================================================= */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var MGI = require(path.join(ROOT, 'assets', 'scoring.js'));
var SC = require(path.join(ROOT, 'assets', 'selfcheck-core.js'));

var fail = 0;
var pass = 0;

function ok(msg) { pass++; console.log('  ok    ' + msg); }
function bad(msg) { fail++; console.log('  FAIL  ' + msg); }
function is(cond, msg) { if (cond) ok(msg); else bad(msg); }

/* ---------- 1. the eight questions ---------- */

console.log('\n[1] The eight questions');

var Q = SC.questions();

is(Q.length === 8, 'the short form asks eight questions (' + Q.length + ')');
is(Q.length === SC.TOTAL, 'TOTAL agrees with questions(): ' + SC.TOTAL);
is(SC.ITEMS.length === 3, 'three evidence items: q' + SC.ITEMS.join(', q'));

/* every question must be an object the instrument owns, or built from its
   own text. Nothing may be restated here. */
var fromInstrument = [MGI.GUT, MGI.OUTPUT, MGI.EXTERNAL, MGI.ENERGY, MGI.EXPOSURE];
var byRef = Q.filter(function (q) { return fromInstrument.indexOf(q) !== -1; });
is(byRef.length === 5, 'the gut check and the four that place the team are the instrument\'s own objects');

var evidenceQs = Q.filter(function (q) { return q.kind === 'evidence'; });
is(evidenceQs.length === SC.ITEMS.length,
  SC.ITEMS.length + ' evidence questions in the set');

var wrong = evidenceQs.filter(function (q) { return q.text !== MGI.EVIDENCE[q.n - 1]; });
is(wrong.length === 0, 'every evidence question reads its text straight from the instrument');

var scaleWrong = evidenceQs.filter(function (q) { return q.options !== MGI.SCALE; });
is(scaleWrong.length === 0, 'every evidence question uses the instrument\'s own scale');

var ordered = SC.ITEMS.slice().sort(function (a, b) { return a - b; });
is(SC.ITEMS.join() === ordered.join(), 'the items are in instrument order, so q' +
  SC.ITEMS.join('/q') + ' line up with the stored columns');

var uniq = {};
var dupes = SC.ITEMS.filter(function (n) {
  if (uniq[n]) return true;
  uniq[n] = 1;
  return false;
});
is(dupes.length === 0, 'no item is asked twice');

var meta = Object.keys(SC.ITEM_META).map(Number).sort(function (a, b) { return a - b; });
is(meta.join() === ordered.join(), 'every item asked has a short name and an area, and no spare ones');

/* ---------- 2. the chosen items are behaviour items ----------
   The state tree reads the behaviour mean. An item outside
   BEHAVIOUR_ITEMS contributes nothing to it, so including one would
   lengthen the form without improving the call. */

console.log('\n[2] Every chosen item feeds the state tree');

var BEH = [1, 2, 5, 6, 9, 10, 11, 12];
var strays = SC.ITEMS.filter(function (n) { return BEH.indexOf(n) === -1; });
is(strays.length === 0, 'all ' + SC.ITEMS.length + ' are behaviour items' +
  (strays.length ? ', but q' + strays.join(', q') + ' are not' : ''));

/* each item's area must be one the instrument knows, and must be the area
   that actually contains it */
var areaWrong = SC.ITEMS.filter(function (n) {
  var want = SC.ITEM_META[n].area;
  var area = MGI.AREAS.filter(function (a) { return a.key === want; })[0];
  return !area || area.items.indexOf(n) === -1;
});
is(areaWrong.length === 0, 'each item is mapped to the area the instrument puts it in');

/* ---------- 3. partialState is the real tree ----------
   Fifteen identical answers give a behaviour mean equal to that answer,
   so score() and partialState must agree on every such case. That is the
   only place the two can be compared directly, and it covers every
   branch of the tree. */

console.log('\n[3] partialState and score() are the same tree');

var GUTS = MGI.GUT.options.map(function (o) { return o.value; });
var OUTS = MGI.OUTPUT.options.map(function (o) { return o.value; });
var EXTS = MGI.EXTERNAL.options.map(function (o) { return o.value; });
var ENES = MGI.ENERGY.options.map(function (o) { return o.value; });
var EXPS = MGI.EXPOSURE.options.map(function (o) { return o.value; });

var compared = 0;
var mismatch = [];
var rulesSeen = {};
[0, 1, 2, 3].forEach(function (v) {
  GUTS.forEach(function (g) {
    OUTS.forEach(function (o) {
      EXTS.forEach(function (x) {
        ENES.forEach(function (n) {
          var full = MGI.score({
            gut: g, evidence: new Array(MGI.EVIDENCE.length).fill(v),
            output: o, external: x, energy: n, exposure: 'most_days'
          });
          var part = MGI.partialState(v, o, x, n, g);
          compared++;
          rulesSeen[part.rule] = (rulesSeen[part.rule] || 0) + 1;
          if (full.state.name !== part.state.name || full.rule !== part.rule ||
              full.gap.key !== part.gap.key) {
            if (mismatch.length < 5) {
              mismatch.push(v + '/' + g + '/' + o + '/' + x + '/' + n + ': score()=' +
                full.state.name + ' rule ' + full.rule + ' gap ' + full.gap.key +
                ', partialState=' + part.state.name + ' rule ' + part.rule +
                ' gap ' + part.gap.key);
            }
          }
        });
      });
    });
  });
});
is(mismatch.length === 0, compared + ' comparisons, state, rule and instinct gap all agree' +
  (mismatch.length ? '\n          ' + mismatch.join('\n          ') : ''));
is(Object.keys(rulesSeen).length === 6, 'all six rules of the tree were reached: ' +
  Object.keys(rulesSeen).sort().join(', '));

/* ---------- 4. every answer produces a whole scorecard ----------
   The whole answer space, not a sample: four gut answers, 4^5 item
   combinations and every trajectory and exposure answer. */

console.log('\n[4] Every reachable scorecard is complete');

var FIELDS = ['headline', 'signalHeadline', 'signalMeaning', 'focusLine',
  'cohortLine', 'action'];

var checked = 0;
var empties = [];
var focusOutside = 0;
var actionMissing = 0;
var narrowWithoutNote = 0;
var statesSeen = {};
var gapsSeen = {};

function sweep(cb) {
  /* every combination of answers to however many evidence items the short
     form asks, built from the item count rather than written out, so this
     still covers the whole space if the set changes size */
  var combos = [[]];
  for (var k = 0; k < SC.ITEMS.length; k++) {
    var next = [];
    combos.forEach(function (c) {
      for (var v = 0; v < 4; v++) next.push(c.concat([v]));
    });
    combos = next;
  }
  GUTS.forEach(function (g) {
    combos.forEach(function (ev) {
      OUTS.forEach(function (o) {
        EXTS.forEach(function (x) {
          ENES.forEach(function (n) {
            EXPS.forEach(function (p) {
              cb([g].concat(ev, [o, x, n, p]));
            });
          });
        });
      });
    });
  });
}

sweep(function (values) {
  var r = SC.read(values);
  checked++;
  statesSeen[r.state.name] = 1;
  gapsSeen[r.gap.key] = 1;

  FIELDS.forEach(function (f) {
    if (typeof r[f] !== 'string' || !r[f].trim()) {
      if (empties.length < 5) empties.push(f + ' empty for ' + values.join(','));
    }
  });
  if (/undefined|NaN|\[object/.test(FIELDS.map(function (f) { return r[f]; }).join(' '))) {
    if (empties.length < 5) empties.push('a hole in the copy for ' + values.join(','));
  }
  if (SC.ITEMS.indexOf(r.focus) === -1) focusOutside++;
  if (!r.action || r.action.length < 20) actionMissing++;
  /* one window a week or less must carry the go-and-look instruction */
  if (r.lineOfSight.score <= 1 && r.action.indexOf(MGI.NARROW_SIGHT_ACTION) === -1) {
    narrowWithoutNote++;
  }
  if (r.items.length !== SC.ITEMS.length) {
    empties.push('wrong number of items for ' + values.join(','));
  }
  if (r.signal < 0 || r.signal > SC.SIGNAL_MAX) {
    empties.push('signal out of range for ' + values.join(','));
  }
});

is(empties.length === 0, checked.toLocaleString() + ' scorecards, every part present' +
  (empties.length ? '\n          ' + empties.join('\n          ') : ''));
is(focusOutside === 0,
  'the question named is always one of the ' + SC.ITEMS.length + ' asked');
is(actionMissing === 0, 'every scorecard carries a move');
is(narrowWithoutNote === 0, 'a narrow line of sight always adds the instruction to go and look');
is(Object.keys(statesSeen).length === 4, 'all four states are reachable: ' +
  Object.keys(statesSeen).sort().join(', '));
is(Object.keys(gapsSeen).length === 3, 'all three instinct gaps are reachable: ' +
  Object.keys(gapsSeen).sort().join(', '));

/* ---------- 5. the moves exist for every pair it can select ---------- */

console.log('\n[5] The move matrix covers every pair the short form can reach');

var holes = [];
Object.keys(MGI.STATES).forEach(function (s) {
  SC.ITEMS.forEach(function (n) {
    var area = SC.ITEM_META[n].area;
    var action = MGI.ACTIONS[s] && MGI.ACTIONS[s][area];
    if (typeof action !== 'string' || action.length < 20) holes.push(s + '/' + area);
  });
});
is(holes.length === 0, 'every state and area pair has a move' +
  (holes.length ? ': missing ' + holes.join(', ') : ''));

/* ---------- 6. the cohort block adds up ---------- */

console.log('\n[6] The cohort figures are self-consistent');

var c = SC.COHORT;
var stateSum = Object.keys(c.states).reduce(function (t, k) { return t + c.states[k]; }, 0);
is(stateSum === c.n, 'the states sum to n: ' + stateSum + ' of ' + c.n);
is(c.aligned + c.feltWorse + c.feltBetter === c.n,
  'aligned plus the two disagreements sum to n: ' +
  c.aligned + ' + ' + c.feltWorse + ' + ' + c.feltBetter + ' = ' + c.n);
is(Object.keys(c.states).sort().join() ===
   Object.keys(MGI.STATES).map(function (k) { return MGI.STATES[k].name; }).sort().join(),
  'the cohort names exactly the instrument\'s four states');
is(c.medianSignal >= 0 && c.medianSignal <= SC.SIGNAL_MAX,
  'the median score is inside the scale, 0 to ' + SC.SIGNAL_MAX);
var line = SC.cohortLine();
is(line.indexOf(String(c.n)) !== -1 && line.indexOf(String(c.feltWorse)) !== -1,
  'the sentence on the page is built from that block, not written out again');

/* ---------- 7. the page can hold the scorecard ----------
   Every id the client looks up must exist in the markup. A typo here is
   a scorecard that renders blank, and it would not show up anywhere else
   until someone finished the form. */

console.log('\n[7] The page has somewhere to put every part');

var client = fs.readFileSync(path.join(ROOT, 'assets', 'selfcheck.js'), 'utf8');
var html = fs.readFileSync(path.join(ROOT, 'team-state.html'), 'utf8');

/* the id list is the array literal handed to .forEach(function (id). It
   holds no nested brackets, so the matching open bracket is simply the
   last one before it. A lazy regex over the whole file finds the first
   bracket in the file instead, which is how this check once "passed"
   while reading a completely different array. */
var tail = client.indexOf('].forEach(function (id)');
var head = tail === -1 ? -1 : client.lastIndexOf('[', tail);
if (head === -1) {
  bad('could not find the id list in assets/selfcheck.js');
} else {
  var ids = (client.slice(head, tail).match(/'([a-z0-9-]+)'/g) || []).map(function (s) {
    return s.replace(/'/g, '');
  });
  var present = {};
  (html.match(/id="([a-zA-Z0-9-]+)"/g) || []).forEach(function (m) {
    present[m.slice(4, -1)] = 1;
  });
  var absent = ids.filter(function (id) { return !present[id]; });
  is(ids.length > 15 && ids.length < 40, ids.length + ' ids looked up by the client');
  is(absent.length === 0, 'every one of them exists in team-state.html' +
    (absent.length ? ': missing ' + absent.join(', ') : ''));
}

/* the page must load the core, or the client has nothing to read */
is(/selfcheck-core\.js/.test(html), 'team-state.html loads the short form module');
is(/scoring\.js/.test(html), 'team-state.html loads the instrument');
is(/name="robots" content="noindex/.test(html),
  'team-state.html is noindex, so the short version does not compete with the full one');

/* ---------- 8. the table has a column for every answer ---------- */

console.log('\n[8] The migration matches the questions');

var ddl = fs.readFileSync(path.join(ROOT, 'scripts', 'create-selfcheck-table.py'), 'utf8');
var missingCols = SC.ITEMS.filter(function (n) {
  return !new RegExp('\\n\\s+q' + n + '\\s').test(ddl);
});
is(missingCols.length === 0, 'the table has a column for every item asked' +
  (missingCols.length ? ': missing q' + missingCols.join(', q') : ''));
['gut', 'output', 'external_pressure', 'energy', 'exposure', 'signal', 'state',
  'gap', 'line_of_sight', 'landed_at', 'lead_form', 'source'].forEach(function (col) {
  is(new RegExp('\\n\\s+' + col + '\\s').test(ddl), 'the table has ' + col);
});

/* ---------- 9. the worksheet table ----------
   Twelve entries, one per move the short form can produce. Each must be
   a real worksheet, with the title the library gives it, and a PDF that
   actually ships in the bundle. A title typed here that has drifted from
   the library would put a wrong name on the page and in the email, and an
   id whose PDF is missing would hand someone a dead link straight after
   they gave an address for it. */

console.log('\n[9] Every move has a worksheet that exists');

var LIBRARY = require(path.join(ROOT, 'report', 'library.json')).worksheets;
var byId = {};
LIBRARY.forEach(function (w) { byId[w.id] = w; });

var pairs = 0;
var badId = [];
var badTitle = [];
var missingPdf = [];
var tooHard = [];
var sheetAreas = {};
SC.ITEMS.forEach(function (n) { sheetAreas[SC.ITEM_META[n].area] = 1; });

/* the rule the full reading's picker is given: Cruise can take a level 3,
   Stall needs the smallest move that works */
var CEILING = { cruise: 3, drift: 2, headwinds: 2, stall: 1 };

Object.keys(MGI.STATES).forEach(function (key) {
  Object.keys(sheetAreas).forEach(function (area) {
    pairs++;
    var sheet = SC.WORKSHEETS[key] && SC.WORKSHEETS[key][area];
    if (!sheet || !sheet.id) { badId.push(key + '/' + area + ' has none'); return; }
    var w = byId[sheet.id];
    if (!w) {
      badId.push(key + '/' + area + ' -> ' + sheet.id + ' is not in the library');
      return;
    }
    if (w.title !== sheet.title) {
      badTitle.push(sheet.id + ': the table says "' + sheet.title +
        '", the library says "' + w.title + '"');
    }
    if (!fs.existsSync(path.join(ROOT, 'worksheets', sheet.id + '.pdf'))) {
      missingPdf.push(sheet.id);
    }
    if (w.difficulty > CEILING[key]) {
      tooHard.push(key + '/' + area + ' -> ' + sheet.id + ' is level ' +
        w.difficulty + ', above the ceiling of ' + CEILING[key] + ' for ' + key);
    }
  });
});

is(pairs === 12, 'twelve state and area pairs to cover (' + pairs + ')');
is(badId.length === 0, 'every pair names a worksheet in the library' +
  (badId.length ? ': ' + badId.join('; ') : ''));
is(badTitle.length === 0, 'every title matches the library' +
  (badTitle.length ? ': ' + badTitle.join('; ') : ''));
is(missingPdf.length === 0, 'every chosen worksheet ships as a PDF' +
  (missingPdf.length ? ': missing ' + missingPdf.join(', ') : ''));
is(tooHard.length === 0, 'no state is given a worksheet harder than it should take' +
  (tooHard.length ? ': ' + tooHard.join('; ') : ''));

var noSheet = 0;
sweep(function (values) {
  var r = SC.read(values);
  if (!r.worksheet || !r.worksheet.id || !byId[r.worksheet.id]) noSheet++;
});
is(noSheet === 0, 'every reachable scorecard carries a real worksheet');

/* ---------- 10. the table holds the address and the worksheet ---------- */

console.log('\n[10] The migration carries the address and the worksheet');

['token', 'email', 'email_at', 'worksheet'].forEach(function (col) {
  is(new RegExp('\\n\\s+' + col + '\\s').test(ddl), 'the table has ' + col);
});
is(/token\s+text\s+not null unique/.test(ddl), 'the token is unique and required');

/* ---------- the page has the state view and the offer ---------- */

console.log('\n[11] The page can hold the state and the offer');

[['view-state', 'the state view'], ['offer-form', 'the address form'],
 ['s-state-call', 'the state headline'], ['s-gap', 'the instinct gap'],
 ['r-sheet-link', 'the worksheet link']].forEach(function (pair) {
  is(html.indexOf('id="' + pair[0] + '"') !== -1, 'the page has ' + pair[1]);
});
is(!/No email, no signup/.test(html),
  'the page no longer promises that no email is asked for');

/* ---------- done ---------- */

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
