/* =============================================================
   Internal visitor opt-out.

     node scripts/test-internal.js

   ?internal=1 remembers the browser and shows the note.
   ?internal=0 forgets it. While it is on, the funnel is not
   posted and the LinkedIn conversions do not fire. A finished
   assessment still submits, with internal: true, and the handler
   stores nothing and sends nothing unless the table already has
   an internal column. A normal visit is unchanged, including s=
   and utm_* source capture.
   ============================================================= */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var NOTE = "Internal mode on: your visits aren't counted";
var MAX_AGE = String(400 * 24 * 60 * 60);

var fail = 0, pass = 0;
function ok(m) { pass++; console.log('  ok    ' + m); }
function bad(m) { fail++; console.log('  FAIL  ' + m); }

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* ---------- a tiny page ---------- */

var MGI_IDS = [
  'view-landing', 'view-questions', 'view-contact', 'view-sent',
  'btn-start', 'btn-start-2', 'btn-back', 'btn-next', 'btn-submit',
  'q-count', 'q-bar-fill', 'q-number', 'q-text', 'q-scale',
  'contact-form', 'form-error', 'f-industry', 'field-industry-other', 'f-industry-other',
  'f-consent', 'sent-email', 'sent-note', 'teaser', 'teaser-rings',
  'sent-by-email', 'sent-by-link', 'sent-link', 'sent-url', 'sent-wait'
];

function makePage(opts) {
  opts = opts || {};
  var mem = Object.assign({}, opts.storage || {});
  var session = {};
  var jar = (opts.cookie || '').split('; ').filter(Boolean);
  var cookieWrites = [];
  var listeners = { window: {}, document: {} };
  var beacons = [];
  var fetches = [];
  var inserted = [];
  var tracked = [];
  var byId = {};

  function store(target) {
    return {
      getItem: function (k) {
        if (target === mem && opts.storageThrows) throw new Error('blocked');
        return Object.prototype.hasOwnProperty.call(target, k) ? target[k] : null;
      },
      setItem: function (k, v) {
        if (target === mem && opts.storageThrows) throw new Error('blocked');
        target[k] = String(v);
      },
      removeItem: function (k) {
        if (target === mem && opts.storageThrows) throw new Error('blocked');
        delete target[k];
      }
    };
  }

  function el(id) {
    return {
      id: id,
      tag: 'div',
      className: '',
      hidden: false,
      textContent: '',
      innerHTML: '',
      style: {},
      children: [],
      value: '',
      checked: false,
      src: '',
      type: '',
      async: false,
      classList: { toggle: function () {}, add: function () {}, remove: function () {} },
      setAttribute: function (k, v) { this[k] = v; },
      getAttribute: function (k) { return this[k] == null ? null : this[k]; },
      addEventListener: function (type, fn) {
        this._ev = this._ev || {};
        this._ev[type] = fn;
      },
      appendChild: function (c) { this.children.push(c); return c; },
      insertBefore: function (c, before) {
        var i = this.children.indexOf(before);
        if (i < 0) this.children.unshift(c);
        else this.children.splice(i, 0, c);
        return c;
      },
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      focus: function () {},
      remove: function () {}
    };
  }

  MGI_IDS.forEach(function (id) { byId[id] = el(id); });

  var head = el('head');
  var body = el('body');
  if (opts.conversion) body['data-conversion'] = opts.conversion;
  Object.defineProperty(body, 'firstChild', {
    get: function () { return body.children[0] || null; }
  });

  function walk(node, id) {
    if (!node) return null;
    if (node.id === id) return node;
    var kids = node.children || [];
    for (var i = 0; i < kids.length; i++) {
      var found = walk(kids[i], id);
      if (found) return found;
    }
    return null;
  }

  var loc = {
    protocol: opts.protocol || 'https:',
    pathname: opts.pathname || '/',
    search: opts.search || '',
    hash: opts.hash || ''
  };

  var history = {
    state: null,
    replaceState: function (state, title, url) {
      history.state = state;
      if (!url) return;
      var hashAt = url.indexOf('#');
      var before = hashAt === -1 ? url : url.slice(0, hashAt);
      var q = before.indexOf('?');
      loc.pathname = (q === -1 ? before : before.slice(0, q)) || '/';
      loc.search = q === -1 ? '' : before.slice(q);
      loc.hash = hashAt === -1 ? '' : url.slice(hashAt);
    },
    pushState: function (state) { history.state = state; }
  };

  var document = {
    readyState: 'complete',
    head: head,
    body: body,
    getElementById: function (id) {
      if (byId[id]) return byId[id];
      return walk(head, id) || walk(body, id);
    },
    createElement: function (tag) {
      var node = el(tag);
      if (tag === 'script') {
        node.parentNode = { insertBefore: function (n) { inserted.push(n); } };
      }
      return node;
    },
    getElementsByTagName: function () {
      return [{ parentNode: { insertBefore: function (n) { inserted.push(n); } } }];
    },
    addEventListener: function (type, fn) {
      (listeners.document[type] = listeners.document[type] || []).push(fn);
    },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };

  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: function () { return jar.join('; '); },
    set: function (v) {
      cookieWrites.push(String(v));
      var pair = String(v).split(';')[0];
      var eq = pair.indexOf('=');
      var name = pair.slice(0, eq).trim();
      jar = jar.filter(function (p) { return p.slice(0, p.indexOf('=')) !== name; });
      if (!/Max-Age=0/.test(v)) jar.push(name + '=' + pair.slice(eq + 1));
    }
  });

  var localStorage = store(mem);
  var sessionStorage = store(session);
  var window = {
    location: loc,
    history: history,
    document: document,
    localStorage: localStorage,
    sessionStorage: sessionStorage,
    innerWidth: opts.width || 1280,
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
    MGI_TRACKING: opts.tracking || {
      partnerId: '9887058',
      conversions: { assessmentCompleted: 31367050, callBooked: 31367058 }
    },
    MGIConsent: opts.consent || {
      get: function () { return 'accepted'; },
      onChange: function (fn) { if (fn) fn('accepted'); }
    },
    MGILinkedIn: {
      track: function (name) { tracked.push(name); return true; }
    }
  };

  var context = vm.createContext({
    window: window,
    document: document,
    localStorage: localStorage,
    sessionStorage: sessionStorage,
    history: history,
    navigator: {
      sendBeacon: function (url, data) {
        beacons.push({ url: url, data: data });
        return true;
      }
    },
    fetch: function (url, options) {
      fetches.push({ url: String(url), options: options || {} });
      var payload = { ok: true, sending: true, teaser: null };
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve(payload); }
      });
    },
    URLSearchParams: URLSearchParams,
    Blob: Blob,
    Uint8Array: Uint8Array,
    console: console,
    setTimeout: setTimeout
  });

  function run(rel) {
    vm.runInContext(read(rel), context, { filename: rel });
  }

  function fire(type) {
    (listeners.window[type] || []).forEach(function (fn) { fn(); });
  }

  function note() {
    return walk(body, 'internal-note');
  }

  return {
    run: run, fire: fire, note: note, mem: mem, session: session, loc: loc,
    cookieWrites: cookieWrites, beacons: beacons, fetches: fetches,
    inserted: inserted, tracked: tracked, byId: byId, window: window,
    cookie: function () { return jar.join('; '); }
  };
}

function fill(form) {
  ['firstName', 'email', 'company', 'role', 'industry', 'industryOther',
    'currentlyLeading', 'teamSize', 'tenure', 'left6m', 'joined6m', 'website'
  ].forEach(function (name) { form[name] = { value: '' }; });
  form.firstName.value = 'Clive';
  form.email.value = 'clive@example.com';
  form.teamSize.value = '6-10';
  form.consent = { checked: true };
}

async function beaconBody(page) {
  if (!page.beacons.length) return null;
  return JSON.parse(await page.beacons[0].data.text());
}

(async function () {
console.log('\nThe flag, the cookie and the note');

var on = makePage({ search: '?s=spring&utm_source=linkedin&internal=1' });
on.run('assets/internal.js');
if (on.mem['mgi-internal'] === '1') ok('?internal=1 sets localStorage mgi-internal=1');
else bad('localStorage was ' + on.mem['mgi-internal']);
if (on.cookieWrites.some(function (w) { return w.indexOf('mgi-internal=1') === 0 && w.indexOf('Max-Age=' + MAX_AGE) !== -1; })) {
  ok('the fallback cookie lasts 400 days');
} else bad('cookie writes were ' + JSON.stringify(on.cookieWrites));
if (on.cookieWrites.every(function (w) { return w.indexOf('Domain=') === -1 && w.indexOf('Path=/') !== -1 && w.indexOf('SameSite=Lax') !== -1 && w.indexOf('Secure') !== -1; })) {
  ok('the cookie is first-party, host-only, and secure on https');
} else bad('cookie attributes were ' + JSON.stringify(on.cookieWrites));
if (on.note() && on.note().textContent === NOTE) ok('the note uses the exact line');
else bad('note was ' + (on.note() && on.note().textContent));
if (on.loc.search === '?s=spring&utm_source=linkedin') ok('internal is stripped and s= / utm_* stay on the url');
else bad('url left as ' + on.loc.search);
if (on.window.MGIInternal && on.window.MGIInternal.on()) ok('MGIInternal.on reports the flag');
else bad('MGIInternal.on was false');

var off = makePage({
  search: '?internal=0&utm_medium=cpc',
  storage: { 'mgi-internal': '1' },
  cookie: 'mgi-internal=1'
});
off.run('assets/internal.js');
if (off.mem['mgi-internal'] === undefined && off.cookie().indexOf('mgi-internal=') === -1) {
  ok('?internal=0 clears localStorage and the cookie');
} else bad('cleared state was storage=' + off.mem['mgi-internal'] + ' cookie=' + off.cookie());
if (off.cookieWrites.some(function (w) { return /Max-Age=0/.test(w); })) ok('the clear sets Max-Age=0');
else bad('no Max-Age=0 write');
if (!off.note()) ok('the note is gone once the flag is cleared');
else bad('the note was still shown');
if (off.loc.search === '?utm_medium=cpc') ok('clearing the flag leaves the campaign parameters');
else bad('url after clear was ' + off.loc.search);

var ignored = makePage({ search: '?internal=yes&s=spring' });
ignored.run('assets/internal.js');
if (ignored.mem['mgi-internal'] === undefined && !ignored.note()) ok('only internal=1 turns the flag on');
else bad('a non-1 value turned the flag on');
if (ignored.loc.search === '?s=spring') ok('a non-1 value is still removed from the url');
else bad('url after a non-1 value was ' + ignored.loc.search);

var plain = makePage({ search: '?s=spring&utm_source=linkedin' });
plain.run('assets/internal.js');
if (plain.mem['mgi-internal'] === undefined && plain.cookieWrites.length === 0 && !plain.note()) {
  ok('a normal landing url does not touch the flag, the cookie or the note');
} else bad('a normal landing changed internal state');
if (plain.loc.search === '?s=spring&utm_source=linkedin') ok('a normal query string is left completely alone');
else bad('normal url became ' + plain.loc.search);

var again = makePage({ storage: { 'mgi-internal': '1' }, search: '' });
again.run('assets/internal.js');
if (again.note() && again.note().textContent === NOTE) ok('the note comes back on the next page without the query');
else bad('a stored flag did not show the note');

var cookieOnly = makePage({ cookie: 'other=1; mgi-internal=1', search: '' });
cookieOnly.run('assets/internal.js');
if (cookieOnly.window.MGIInternal.on() && cookieOnly.note()) ok('the cookie alone is enough when localStorage is empty');
else bad('cookie fallback did not count as on');

var blocked = makePage({ search: '?internal=1', storageThrows: true });
blocked.run('assets/internal.js');
if (blocked.cookieWrites.some(function (w) { return w.indexOf('Max-Age=' + MAX_AGE) !== -1; }) && blocked.window.MGIInternal.on()) {
  ok('a blocked localStorage still leaves the cookie, and the cookie counts');
} else bad('storage failure dropped the opt-out');

console.log('\nFunnel posts, conversions and source capture');

var quiet = makePage({ search: '?s=spring&utm_source=linkedin&internal=1' });
quiet.run('assets/internal.js');
quiet.run('assets/mgi.js');
quiet.fire('pagehide');
if (quiet.beacons.length === 0 && !quiet.fetches.some(function (f) { return f.url === '/api/funnel'; })) {
  ok('an internal visit sends no /api/funnel beacon or fetch');
} else bad('funnel was contacted ' + quiet.beacons.length + ' / ' + quiet.fetches.length);
if (quiet.session['mgi-source'] && JSON.parse(quiet.session['mgi-source']).s === 'spring' &&
    JSON.parse(quiet.session['mgi-source']).utm_source === 'linkedin' &&
    JSON.parse(quiet.session['mgi-source']).internal === undefined) {
  ok('s= and utm_* are still captured, and internal is not stored as a source');
} else bad('stored source was ' + quiet.session['mgi-source']);

fill(quiet.byId['contact-form']);
quiet.byId['contact-form']._ev.submit({ preventDefault: function () {} });
await flush();
var posted = quiet.fetches.filter(function (f) { return f.url === '/api/submit'; });
if (posted.length === 1) {
  var payload = JSON.parse(posted[0].options.body);
  if (payload.internal === true && payload.source && payload.source.s === 'spring' &&
      payload.source.utm_source === 'linkedin' && payload.firstName === 'Clive') {
    ok('the submission still goes, with internal:true and the campaign source');
  } else bad('payload was ' + posted[0].options.body);
} else bad('submit posts: ' + posted.length);
if (quiet.tracked.length === 0) ok('the assessment conversion does not fire');
else bad('tracked ' + quiet.tracked.join(','));
if (quiet.byId['sent-note'].hidden !== false || quiet.byId['sent-note'].textContent === '') {
  ok('an internal submission does not surface the failure line');
} else bad('failure line was ' + quiet.byId['sent-note'].textContent);

var normal = makePage({ search: '?s=spring&utm_source=linkedin&utm_medium=cpc' });
normal.run('assets/internal.js');
normal.run('assets/mgi.js');
normal.fire('pagehide');
var normalBody = await beaconBody(normal);
if (normal.beacons.length === 1 && normal.beacons[0].url === '/api/funnel' && normalBody &&
    normalBody.source.s === 'spring' && normalBody.source.utm_source === 'linkedin' &&
    normalBody.source.utm_medium === 'cpc' && normalBody.internal === undefined &&
    normalBody.device === 'desktop') {
  ok('a normal visit still posts the funnel, with source and without an internal flag');
} else bad('normal beacon was ' + JSON.stringify(normalBody));

fill(normal.byId['contact-form']);
normal.byId['contact-form']._ev.submit({ preventDefault: function () {} });
await flush();
var normalPost = normal.fetches.filter(function (f) { return f.url === '/api/submit'; });
var normalPayload = normalPost.length ? JSON.parse(normalPost[0].options.body) : null;
if (normalPayload && normalPayload.internal === undefined && normalPayload.source.utm_medium === 'cpc') {
  ok('a normal submission has no internal field, and still carries source');
} else bad('normal payload was ' + (normalPost[0] && normalPost[0].options.body));
if (normal.tracked.length === 1 && normal.tracked[0] === 'assessmentCompleted') {
  ok('a normal submission still fires the assessment conversion');
} else bad('normal tracking was ' + normal.tracked.join(','));

var storedOnly = makePage({ storage: { 'mgi-internal': '1' }, search: '?utm_source=linkedin' });
storedOnly.run('assets/mgi.js');
storedOnly.fire('pagehide');
if (storedOnly.beacons.length === 0) ok('mgi.js itself refuses the funnel when the flag is already stored');
else bad('stored flag still beaconed');

var liOff = makePage({ storage: { 'mgi-internal': '1' }, conversion: 'callBooked' });
liOff.run('assets/linkedin.js');
if (liOff.window.MGILinkedIn.track('assessmentCompleted') === false &&
    liOff.window.MGILinkedIn.track('callBooked') === false &&
    liOff.inserted.length === 0) {
  ok('the Insight Tag does not load and neither conversion fires');
} else bad('linkedin still loaded or tracked');
if (!liOff.session['mgi-li-page-callBooked']) ok('a suppressed page conversion is not remembered as fired');
else bad('the booked conversion was remembered');

var liOn = makePage({ conversion: 'callBooked' });
liOn.run('assets/linkedin.js');
if (liOn.inserted.length === 1 && liOn.inserted[0].src === 'https://snap.licdn.com/li.lms-analytics/insight.min.js' &&
    liOn.window.MGILinkedIn.track('callBooked') === true) {
  ok('without the flag the tag still loads and the booked conversion still fires');
} else bad('normal linkedin load failed');

var liNoConsent = makePage({
  consent: { get: function () { return 'rejected'; }, onChange: function () {} }
});
liNoConsent.run('assets/linkedin.js');
if (liNoConsent.window.MGILinkedIn.track('assessmentCompleted') === false && liNoConsent.inserted.length === 0) {
  ok('a refused cookie still blocks the tag');
} else bad('consent no longer blocks the tag');

console.log('\nThe handler skips the row and the emails unless the column exists');

var MGI = require('../assets/scoring.js');
var submit = require('../api/submit.js');

var saved = {
  fetch: global.fetch,
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  resend: process.env.RESEND_API_KEY,
  source: process.env.SAVE_SOURCE,
  anthropic: process.env.ANTHROPIC_API_KEY
};

function restoreEnv() {
  global.fetch = saved.fetch;
  if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
  if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  if (saved.resend === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved.resend;
  if (saved.source === undefined) delete process.env.SAVE_SOURCE; else process.env.SAVE_SOURCE = saved.source;
  if (saved.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.anthropic;
}

function fakeRes(status, body) {
  var text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status: status,
    json: function () { return Promise.resolve(body); },
    text: function () { return Promise.resolve(text); }
  };
}

var net = [];
function installNet(columnOk) {
  net = [];
  global.fetch = function (url, options) {
    var entry = {
      url: String(url),
      method: (options && options.method) || 'GET',
      body: options && options.body
    };
    net.push(entry);
    if (entry.url.indexOf('select=internal') !== -1) {
      return Promise.resolve(columnOk
        ? fakeRes(200, [])
        : fakeRes(400, { message: 'column mgi_v5_submissions.internal does not exist' }));
    }
    if (entry.url.indexOf('api.resend.com') !== -1) return Promise.resolve(fakeRes(200, { id: 'email-1' }));
    if (entry.method === 'POST' && entry.url.indexOf('select=id') !== -1) {
      return Promise.resolve(fakeRes(201, [{ id: 'row-1' }]));
    }
    return Promise.resolve(fakeRes(201, {}));
  };
}

function useStore() {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  process.env.RESEND_API_KEY = 're_test';
  delete process.env.ANTHROPIC_API_KEY;
}

function answers(extra) {
  return Object.assign({
    firstName: 'Clive',
    email: 'clive@example.com',
    company: 'Clover ERA',
    role: 'Founder',
    teamSize: '6-10',
    consent: true,
    consentAt: '2026-10-18T00:00:00.000Z',
    gut: 'fine',
    evidence: new Array(MGI.EVIDENCE.length).fill(1),
    output: 'held',
    external: 'no',
    energy: 'same',
    exposure: 'few_times',
    source: { utm_source: 'linkedin', s: 'spring' }
  }, extra || {});
}

function mockRes() {
  var out = { code: 200, body: null };
  out.status = function (c) { out.code = c; return out; };
  out.json = function (b) { out.body = b; return out; };
  out.send = function (b) { out.body = b; return out; };
  out.setHeader = function () {};
  return out;
}

function inserts() {
  return net.filter(function (c) {
    return c.method === 'POST' && c.url.indexOf('/rest/v1/mgi_v5_submissions') !== -1;
  });
}
function probes() {
  return net.filter(function (c) { return c.url.indexOf('select=internal') !== -1; });
}
function emails() {
  return net.filter(function (c) { return c.url.indexOf('api.resend.com') !== -1; });
}

async function post(body) {
  var res = mockRes();
  var log = console.log, err = console.error;
  console.log = function () {};
  console.error = function () {};
  try {
    await submit({ method: 'POST', body: body }, res);
    await flush();
  } finally {
    console.log = log;
    console.error = err;
  }
  return res;
}

function flush() {
  return new Promise(function (resolve) { setTimeout(resolve, 20); });
}

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.SAVE_SOURCE;

var noStore = await post(answers({ internal: true }));
if (noStore.code === 200 && noStore.body && noStore.body.ok === true && noStore.body.stored === false &&
    noStore.body.internal === true && noStore.body.sending === true && net.length === 0) {
  ok('with no database configured, an internal submission succeeds and calls nothing');
} else bad('no-store response ' + noStore.code + ' ' + JSON.stringify(noStore.body) + ' calls ' + net.length);

useStore();
installNet(false);
var skipped = await post(answers({ internal: true }));
if (skipped.code === 200 && skipped.body.ok === true && skipped.body.stored === false && skipped.body.notified === false) {
  ok('a missing internal column returns success without storing');
} else bad('skip response ' + JSON.stringify(skipped.body));
if (inserts().length === 0 && emails().length === 0 && probes().length === 1 && probes()[0].method === 'GET') {
  ok('that path does not insert and does not send email');
} else bad('calls were ' + net.map(function (c) { return c.method + ' ' + c.url; }).join(' | '));
if (probes()[0].url.indexOf('clive@example.com') === -1 && probes()[0].url.indexOf('internal=true') === -1) {
  ok('the column probe carries no address and no IP');
} else bad('probe url was ' + probes()[0].url);

installNet(true);
process.env.SAVE_SOURCE = '1';
var kept = await post(answers({ internal: true }));
var keptRow = inserts().length ? JSON.parse(inserts()[0].body) : null;
if (kept.code === 200 && kept.body.ok === true && kept.body.stored === true && keptRow && keptRow.internal === true &&
    keptRow.source && keptRow.source.utm_source === 'linkedin' && keptRow.source.s === 'spring') {
  ok('when the column exists the row is stored with internal:true and the source');
} else bad('kept row ' + JSON.stringify(keptRow) + ' response ' + JSON.stringify(kept.body));
if (emails().length >= 1) ok('when the column exists the ordinary emails still go out');
else bad('no email was sent for a storable internal row');

delete process.env.SAVE_SOURCE;
installNet(false);
var stranger = await post(answers());
var strangerRow = inserts().length ? JSON.parse(inserts()[0].body) : null;
if (stranger.code === 200 && stranger.body.ok === true && stranger.body.stored === true &&
    strangerRow && strangerRow.internal === undefined && probes().length === 0) {
  ok('a normal submission is stored and never probed for the internal column');
} else bad('normal row ' + JSON.stringify(strangerRow) + ' probes ' + probes().length);

installNet(false);
process.env.SAVE_SOURCE = '1';
var sourced = await post(answers());
var sourcedRow = inserts().length ? JSON.parse(inserts()[0].body) : null;
if (sourcedRow && sourcedRow.source && sourcedRow.source.utm_source === 'linkedin' && sourcedRow.source.s === 'spring' &&
    sourcedRow.internal === undefined) {
  ok('s= and utm_* are still saved for a normal submission when SAVE_SOURCE=1');
} else bad('sourced row ' + JSON.stringify(sourcedRow && sourcedRow.source));

installNet(false);
var asString = await post(answers({ internal: 'true' }));
var stringRow = inserts().length ? JSON.parse(inserts()[0].body) : null;
if (stringRow && stringRow.internal === undefined && probes().length === 0) {
  ok('only a boolean true is the internal flag');
} else bad('string flag row ' + JSON.stringify(stringRow));

installNet(false);
var honey = await post(answers({ internal: true, website: 'https://spam.example' }));
if (honey.code === 200 && honey.body.ok === true && net.length === 0) {
  ok('the honeypot still accepts quietly and does nothing');
} else bad('honeypot calls ' + net.length + ' body ' + JSON.stringify(honey.body));

installNet(false);
var refused = await post(answers({ internal: true, consent: false }));
if (refused.code === 400 && net.length === 0) ok('an internal post without consent is still rejected');
else bad('consent response ' + refused.code + ' calls ' + net.length);

var submitSrc = read('api/submit.js');
if (!/x-forwarded-for|req\.socket|\.ip\b|remoteAddress/i.test(submitSrc)) {
  ok('submit does not read an IP');
} else bad('submit appears to read an IP');
if (!/alter table|add column/i.test(submitSrc)) ok('submit does not change the schema');
else bad('submit contains a schema change');

console.log('\nEvery page that can count a visit gets the flag');

['index.html', 'booked.html'].forEach(function (rel) {
  var text = read(rel);
  var internalAt = text.indexOf('/assets/internal.js');
  var linkedinAt = text.indexOf('/assets/linkedin.js');
  var mgiAt = text.indexOf('/assets/mgi.js');
  if (internalAt !== -1 && internalAt < linkedinAt && (mgiAt === -1 || internalAt < mgiAt)) {
    ok(rel + ' loads the opt-out before anything that counts');
  } else bad(rel + ' script order is wrong');
});

var tags = require('../report/asset-url.js').trackingTags();
if (/\/assets\/internal\.js\?v=[0-9a-f]{8}/.test(tags) && tags.indexOf('internal.js') < tags.indexOf('linkedin.js')) {
  ok('the reading page loads the opt-out before the Insight Tag');
} else bad('reading tags were ' + tags);

if (read('assets/internal.js').indexOf(NOTE) !== -1) ok('the note string is the one in the script');
else bad('the note string drifted');

restoreEnv();

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
}()).catch(function (e) {
  console.error(e);
  process.exit(1);
});
