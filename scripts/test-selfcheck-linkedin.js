/* =============================================================
   Self-check LinkedIn conversions.

     node scripts/test-selfcheck-linkedin.js

   The state conversion fires once, when the state is on screen
   after the eighth question, and not before cookies are accepted.
   The address conversion fires once, only after /api/scorecard
   accepts the address. A refresh of the same result does not
   send either again. lintrk is a log, never the live tag.
   ============================================================= */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var TOKEN = 'abcdefghijklmnopqrstuv';
var COMPLETED = 32413530;
var EMAIL = 32413538;

var fail = 0, pass = 0;
function ok(m) { pass++; console.log('  ok    ' + m); }
function bad(m) { fail++; console.log('  FAIL  ' + m); }
function is(cond, m) { if (cond) ok(m); else bad(m); }

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

function flush() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

var IDS = [
  'view-landing', 'view-questions', 'view-state', 'view-result',
  'btn-start', 'btn-start-2', 'btn-back', 'btn-next',
  's-state-call', 's-state-desc', 's-gap',
  'offer-form', 'offer-error', 'f-email', 'f-website', 'btn-offer',
  'r-sheet', 'r-sheet-link', 'r-sheet-title',
  'q-count', 'q-bar-fill', 'q-number', 'q-text', 'q-scale',
  'r-state-call', 'r-state-desc', 'r-gap', 'r-score',
  'r-signal-headline', 'r-signal-copy', 'r-items',
  'r-sight-label', 'r-sight-copy',
  'r-action-area', 'r-action-body', 'r-cohort', 'r-restart'
];

function makePage(opts) {
  opts = opts || {};
  var mem = Object.assign({}, opts.storage || {});
  var session = Object.assign({}, opts.session || {});
  var calls = [];
  var fetches = [];
  var inserted = [];
  var listeners = { window: {}, document: {} };
  var byId = {};
  var consentChoice = opts.consent === undefined ? null : opts.consent;
  var consentListeners = [];
  var replaced = false;

  function node(tag) {
    var n = {
      tag: tag || 'div',
      id: '',
      className: '',
      hidden: false,
      textContent: '',
      value: '',
      checked: false,
      disabled: false,
      href: '',
      type: '',
      name: '',
      src: '',
      async: false,
      style: {},
      children: [],
      parentNode: null
    };
    n.classList = {
      toggle: function (cls, on) {
        var parts = String(n.className || '').split(/\s+/).filter(Boolean);
        var has = parts.indexOf(cls) !== -1;
        var want = arguments.length < 2 ? !has : !!on;
        if (want && !has) parts.push(cls);
        if (!want) parts = parts.filter(function (c) { return c !== cls; });
        n.className = parts.join(' ');
      }
    };
    n.setAttribute = function (k, v) { n[k] = v; };
    n.getAttribute = function (k) { return n[k] == null ? null : String(n[k]); };
    n.addEventListener = function (type, fn) {
      n._ev = n._ev || {};
      n._ev[type] = fn;
    };
    n.appendChild = function (c) {
      n.children.push(c);
      if (c) c.parentNode = n;
      return c;
    };
    n.insertBefore = function (c) { return n.appendChild(c); };
    n.focus = function () {};
    n.remove = function () {};
    n.querySelector = function (sel) { return find(n, sel); };
    Object.defineProperty(n, 'innerHTML', {
      configurable: true,
      get: function () { return ''; },
      set: function () { n.children = []; }
    });
    return n;
  }

  function matches(n, sel) {
    if (sel !== 'input' && sel !== 'input:checked') return false;
    if (n.tag !== 'input' && n.type !== 'radio') return false;
    if (sel === 'input:checked') return !!n.checked;
    return true;
  }

  function find(n, sel) {
    var kids = n.children || [];
    for (var i = 0; i < kids.length; i++) {
      if (matches(kids[i], sel)) return kids[i];
      var inner = find(kids[i], sel);
      if (inner) return inner;
    }
    return null;
  }

  IDS.forEach(function (id) {
    byId[id] = node(id.indexOf('view-') === 0 ? 'section' : 'div');
    byId[id].id = id;
  });
  byId['q-scale'].tag = 'fieldset';
  byId['f-email'].tag = 'input';
  byId['f-website'].tag = 'input';
  byId['btn-next'].tag = 'button';
  byId['btn-start'].tag = 'button';
  byId['btn-offer'].tag = 'button';
  byId['offer-form'].tag = 'form';

  var head = node('head');
  var body = node('body');

  var document = {
    readyState: 'complete',
    title: '',
    referrer: '',
    head: head,
    body: body,
    cookie: '',
    getElementById: function (id) {
      if (!byId[id]) {
        byId[id] = node('div');
        byId[id].id = id;
      }
      return byId[id];
    },
    createElement: function (tag) { return node(tag); },
    createTextNode: function (text) { return { tag: '#text', textContent: String(text), children: [] }; },
    getElementsByTagName: function () {
      var s = node('script');
      var parent = node('head');
      parent.insertBefore = function (child) { inserted.push(child); return child; };
      s.parentNode = parent;
      return [s];
    },
    addEventListener: function (type, fn) {
      (listeners.document[type] = listeners.document[type] || []).push(fn);
    },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };

  var navType = opts.navType || 'navigate';
  var loc = {
    protocol: 'https:',
    hostname: 'managergap.com',
    pathname: '/self-check',
    search: opts.search || '',
    hash: '',
    replace: function (url) { replaced = url; }
  };
  var history = {
    state: null,
    replaceState: function (state) { history.state = state; },
    pushState: function (state) { history.state = state; }
  };

  function store(target) {
    return {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(target, k) ? target[k] : null;
      },
      setItem: function (k, v) { target[k] = String(v); },
      removeItem: function (k) { delete target[k]; }
    };
  }

  var localStorage = store(mem);
  var sessionStorage = store(session);
  var consent = {
    get: function () { return consentChoice; },
    onChange: function (fn) { if (typeof fn === 'function') consentListeners.push(fn); },
    set: function (next) {
      var prev = consentChoice;
      consentChoice = next;
      consentListeners.slice().forEach(function (fn) {
        try { fn(next, prev); } catch (e) { /* a listener cannot sink the test */ }
      });
    }
  };

  var window = {
    document: document,
    location: loc,
    history: history,
    localStorage: localStorage,
    sessionStorage: sessionStorage,
    MGIConsent: consent,
    crypto: {
      getRandomValues: function (arr) {
        for (var i = 0; i < arr.length; i++) arr[i] = (i * 17 + 3) % 256;
        return arr;
      }
    },
    addEventListener: function (type, fn) {
      (listeners.window[type] = listeners.window[type] || []).push(fn);
    },
    scrollTo: function () {},
    setTimeout: setTimeout
  };
  if (opts.lintrk !== false) {
    window.lintrk = opts.lintrk || function (a, b) { calls.push([a, b]); };
  }
  if (opts.internal) {
    mem['mgi-internal'] = '1';
    window.MGIInternal = { on: function () { return true; } };
  }

  var held = {};
  var fetchImpl = opts.fetch || function (url, options) {
    var entry = { url: String(url), options: options || {} };
    fetches.push(entry);
    if (entry.url === '/api/selfcheck') {
      if (opts.selfcheck === 'hang') {
        return new Promise(function (resolve) { held.selfcheck = resolve; });
      }
      if (opts.selfcheck === 'fail') {
        return Promise.resolve({
          ok: false,
          json: function () { return Promise.resolve(null); }
        });
      }
      var stored = opts.selfcheck !== 'unstored';
      return Promise.resolve({
        ok: true,
        json: function () {
          return Promise.resolve({ ok: true, stored: stored, token: stored ? TOKEN : null });
        }
      });
    }
    if (entry.url === '/api/scorecard') {
      if (opts.scorecard === 'fail') {
        return Promise.resolve({
          ok: false,
          json: function () { return Promise.resolve({ ok: false, error: 'no' }); }
        });
      }
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve({ ok: true }); }
      });
    }
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } });
  };

  var sandbox = {
    window: window,
    self: window,
    document: document,
    localStorage: localStorage,
    sessionStorage: sessionStorage,
    history: history,
    location: loc,
    performance: {
      getEntriesByType: function (type) {
        return type === 'navigation' ? [{ type: navType }] : [];
      },
      navigation: { type: navType === 'reload' ? 1 : navType === 'back_forward' ? 2 : 0 }
    },
    fetch: fetchImpl,
    URL: URL,
    URLSearchParams: URLSearchParams,
    Uint8Array: Uint8Array,
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  };

  var context = vm.createContext(sandbox);

  function run(rel) {
    vm.runInContext(read(rel), context, { filename: rel });
  }

  function active(id) {
    return (byId[id].className || '').split(/\s+/).indexOf('is-active') !== -1;
  }

  function answerOne() {
    var input = byId['q-scale'].querySelector('input');
    if (!input || !input._ev || !input._ev.change) throw new Error('no option on ' + byId['q-count'].textContent);
    input.checked = true;
    input._ev.change();
    var next = byId['btn-next'];
    if (next.hidden || !next._ev || !next._ev.click) throw new Error('next hidden on ' + byId['q-count'].textContent);
    next._ev.click();
  }

  function start() {
    byId['btn-start']._ev.click();
  }

  function answerThrough(n) {
    start();
    for (var i = 0; i < n; i++) answerOne();
  }

  function submitEmail(address) {
    byId['f-email'].value = address || 'person@example.com';
    byId['offer-form']._ev.submit({ preventDefault: function () {} });
  }

  function pop(state) {
    (listeners.window.popstate || []).forEach(function (fn) { fn({ state: state }); });
  }

  return {
    run: run,
    byId: byId,
    calls: calls,
    fetches: fetches,
    inserted: inserted,
    session: session,
    mem: mem,
    consent: consent,
    window: window,
    active: active,
    start: start,
    answerOne: answerOne,
    answerThrough: answerThrough,
    submitEmail: submitEmail,
    pop: pop,
    held: held,
    replaced: function () { return replaced; }
  };
}

function boot(opts) {
  var page = makePage(opts);
  page.run('assets/tracking-config.js');
  page.run('assets/linkedin.js');
  page.run('assets/scoring.js');
  page.run('assets/selfcheck-core.js');
  page.run('assets/selfcheck.js');
  return page;
}

function ids(calls) {
  return calls.map(function (c) { return c[0] + ':' + (c[1] && c[1].conversion_id); });
}

function posts(page, url) {
  return page.fetches.filter(function (f) { return f.url === url; });
}

(async function () {
  console.log('\nSelf-check conversions wait for consent, then fire once');

  var early = boot({
    consent: null,
    search: '?utm_source=linkedin&utm_medium=cpc&s=spring&li_fat_id=abc-123'
  });
  early.answerThrough(7);
  is(early.active('view-questions') && early.byId['q-count'].textContent === '8 of 8',
    'seven answers leave the eighth question on screen');
  is(early.calls.length === 0, 'nothing is sent before the eighth answer, or before consent');

  early.answerOne();
  is(early.active('view-state') && !early.active('view-result'),
    'the eighth answer shows the state, not the scorecard');
  is(early.byId['s-state-call'].textContent.length > 0, 'the state line is on the page');
  is(early.calls.length === 0, 'the state is on screen and lintrk has still not been called');
  is(early.session['mgi-li-page-selfCheckCompleted'] === undefined,
    'a miss before consent is not remembered');
  is(posts(early, '/api/selfcheck').length === 1, 'the row is posted without waiting for the tag');

  early.consent.set('accepted');
  is(ids(early.calls).join(',') === 'track:' + COMPLETED,
    'accepting cookies afterwards sends the state conversion once');
  is(early.session['mgi-li-page-selfCheckCompleted'] === '1', 'the hit is remembered for the tab');
  is(early.inserted.length === 1 &&
    early.inserted[0].src === 'https://snap.licdn.com/li.lms-analytics/insight.min.js',
    'consent is what loads the tag');

  await flush();
  var row = JSON.parse(posts(early, '/api/selfcheck')[0].options.body);
  var rowKeys = Object.keys(row).sort().join(',');
  var wantKeys = ['behaviour_mean', 'cookieConsent', 'decision_rule', 'energy', 'exposure',
    'external', 'focus', 'form', 'gap', 'gut', 'internal', 'items', 'landed_at', 'lf',
    'line_of_sight', 'line_of_sight_score', 'output', 'referrer_host', 'seconds', 'signal',
    'source', 'stale', 'started_at', 'state', 'visit_id'].sort().join(',');
  is(rowKeys === wantKeys, 'the /api/selfcheck body still has the same fields');
  is(row.email === undefined && row.cookieConsent === false && row.source &&
    row.source.utm_source === 'linkedin' && row.source.utm_medium === 'cpc' &&
    row.source.s === 'spring' && row.source.li_fat_id === undefined,
    'without consent, utm labels stay, li_fat_id stays off, and the address is not on that post');
  is(posts(early, '/api/scorecard').length === 0 && ids(early.calls).join(',') === 'track:' + COMPLETED,
    '/api/selfcheck returning does not send the address conversion');

  var beforeEmail = early.calls.length;
  early.submitEmail('person@example.com');
  is(early.calls.length === beforeEmail, 'submitting the address does not fire before the post returns');
  await flush();
  is(ids(early.calls).join(',') === 'track:' + COMPLETED + ',track:' + EMAIL,
    'a successful address sends 32413538 once');
  is(early.session['mgi-li-page-selfCheckEmailSubmitted'] === '1', 'the address hit is remembered');
  is(early.active('view-result'), 'the scorecard is shown after the address is accepted');
  var card = JSON.parse(posts(early, '/api/scorecard')[0].options.body);
  is(card.email === 'person@example.com' && card.token === TOKEN && Object.keys(card).sort().join(',') === 'email,token',
    'the scorecard post is still just the token and the address');

  early.submitEmail('person@example.com');
  await flush();
  is(ids(early.calls).join(',') === 'track:' + COMPLETED + ',track:' + EMAIL,
    'sending the same address again does not fire a second time');

  var reloaded = boot({
    consent: 'accepted',
    navType: 'reload',
    session: early.session,
    search: '?utm_source=linkedin&utm_medium=cpc&s=spring'
  });
  is(reloaded.calls.length === 0, 'a refresh sends neither conversion again');
  is(reloaded.active('view-result'), 'the refresh reopens the scorecard');
  is(posts(reloaded, '/api/selfcheck').length === 0, 'a refresh does not post the row again');

  console.log('\nConsent already given, and the paths that must stay quiet');

  var ready = boot({ consent: 'accepted', selfcheck: 'hang' });
  ready.answerThrough(7);
  is(ready.calls.length === 0, 'with consent, questions 1 to 7 still send nothing');
  ready.answerOne();
  is(ids(ready.calls).join(',') === 'track:' + COMPLETED,
    'with consent, the state conversion fires as the state is shown');
  is(typeof ready.held.selfcheck === 'function' && posts(ready, '/api/selfcheck').length === 1,
    'the row post has started and is still in flight');
  var tokenYet = null;
  try { tokenYet = JSON.parse(ready.session['mgi-selfcheck'] || '{}').token || null; } catch (e) { tokenYet = null; }
  is(!tokenYet, 'the state conversion does not wait for /api/selfcheck');
  ready.held.selfcheck({
    ok: true,
    json: function () { return Promise.resolve({ ok: true, stored: true, token: TOKEN }); }
  });
  await flush();
  is(ids(ready.calls).join(',') === 'track:' + COMPLETED,
    'the selfcheck response still does not send the address conversion');

  ready.pop({ view: 'questions', index: 7 });
  ready.answerOne();
  is(ids(ready.calls).join(',') === 'track:' + COMPLETED,
    'finishing the same eight again does not fire twice');
  is(posts(ready, '/api/selfcheck').length === 1, 'the same eight do not write a second row');

  var refused = boot({ consent: 'rejected' });
  refused.answerThrough(8);
  await flush();
  refused.submitEmail('person@example.com');
  await flush();
  is(refused.calls.length === 0 && refused.inserted.length === 0,
    'a refused cookie blocks both conversions and the tag');
  is(refused.active('view-result'), 'refusing cookies still reveals the scorecard');

  var broken = boot({
    consent: 'accepted',
    scorecard: 'fail'
  });
  broken.answerThrough(8);
  await flush();
  broken.submitEmail('not-an-email');
  is(broken.calls.length === 1 && broken.calls[0][1].conversion_id === COMPLETED,
    'an address that fails the check does not fire');
  broken.submitEmail('person@example.com');
  await flush();
  is(ids(broken.calls).join(',') === 'track:' + COMPLETED,
    'a scorecard post that fails does not fire the address conversion');
  is(broken.active('view-result'), 'a failed address still shows the scorecard');
  is(broken.session['mgi-li-page-selfCheckEmailSubmitted'] === undefined,
    'a failed address is not remembered as sent');

  var quiet = boot({ consent: 'accepted', internal: true });
  quiet.answerThrough(8);
  await flush();
  quiet.submitEmail('person@example.com');
  await flush();
  is(quiet.calls.length === 0 && quiet.inserted.length === 0,
    'an internal browser loads no tag and fires neither conversion');
  is(quiet.session['mgi-li-page-selfCheckCompleted'] === undefined &&
    quiet.session['mgi-li-page-selfCheckEmailSubmitted'] === undefined,
    'a suppressed conversion is not remembered');

  var missing = boot({ consent: 'accepted', lintrk: false });
  missing.window.lintrk = undefined;
  var threw = false;
  try { missing.answerThrough(8); } catch (e) { threw = true; }
  is(!threw && missing.active('view-state') && missing.calls.length === 0,
    'a missing lintrk does not throw and does not block the state');
  is(missing.session['mgi-li-page-selfCheckCompleted'] === undefined,
    'a missing lintrk is not remembered as a hit');

  var nasty = boot({
    consent: 'accepted',
    lintrk: function () { throw new Error('tag down'); }
  });
  threw = false;
  try { nasty.answerThrough(8); } catch (e) { threw = true; }
  is(!threw && nasty.active('view-state'), 'a throwing lintrk does not block the state');
  is(nasty.session['mgi-li-page-selfCheckCompleted'] === undefined,
    'a throw is not remembered, so a later try can still send');

  var labelled = boot({
    consent: 'accepted',
    search: '?utm_source=linkedin&utm_medium=cpc&s=spring&li_fat_id=abc-123'
  });
  labelled.answerThrough(8);
  await flush();
  var labelledRow = JSON.parse(posts(labelled, '/api/selfcheck')[0].options.body);
  is(labelledRow.cookieConsent === true && labelledRow.email === undefined &&
    labelledRow.source.utm_source === 'linkedin' && labelledRow.source.utm_medium === 'cpc' &&
    labelledRow.source.s === 'spring' && labelledRow.source.li_fat_id === 'abc-123',
    'with consent, utm labels and li_fat_id still go on the row');

  var fresh = boot({ consent: 'accepted', navType: 'navigate', session: early.session });
  is(fresh.session['mgi-li-page-selfCheckCompleted'] === undefined &&
    fresh.session['mgi-selfcheck'] === undefined,
    'a fresh arrival drops the flags and the saved answers');
  fresh.answerThrough(8);
  is(ids(fresh.calls).join(',') === 'track:' + COMPLETED,
    'a new self-check in the same tab can fire again');

  var again = boot({ consent: 'accepted' });
  again.answerThrough(8);
  await flush();
  again.submitEmail('person@example.com');
  await flush();
  again.byId['r-restart']._ev.click({ preventDefault: function () {} });
  is(again.session['mgi-li-page-selfCheckCompleted'] === undefined &&
    again.session['mgi-li-page-selfCheckEmailSubmitted'] === undefined &&
    again.session['mgi-selfcheck'] === undefined,
    'starting over for another team clears both flags');
  is(again.replaced() === '/self-check', 'starting over reloads this page');

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
}()).catch(function (e) {
  console.error(e);
  process.exit(1);
});
