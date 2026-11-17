/* =============================================================
   The Manager Gap self-check: flow, rendering, the row.

   The short form itself is assets/selfcheck-core.js, which has no DOM
   and is what the tests exercise. This file moves between the three
   views, draws what the core returns, and posts one row once the
   scorecard is already on the screen.

   Answers stay in the page, and in sessionStorage so a reload does not
   lose them, until the last question is answered. Nothing identifying
   is collected at any point.
   ============================================================= */

(function () {
  'use strict';

  var SC = window.MGISelfCheck;

  var STORE_KEY = 'mgi-selfcheck';
  var ADVANCE_DELAY = 200;

  var QUESTIONS = SC.questions();
  var TOTAL = QUESTIONS.length;

  var state = {
    values: new Array(TOTAL).fill(null),
    index: 0,
    done: false,
    view: 'landing'
  };

  var el = {};
  var timing = { landed: new Date().toISOString(), started: null };
  var lastInputWasPointer = false;

  /* ---------- campaign labels ----------
     The same keys, the same validation and the same stores the full
     assessment uses (assets/mgi.js), so a visit that moves between the
     two pages carries one set of labels. li_fat_id is LinkedIn's click
     id: it stays in the tab either way and only leaves the browser once
     the cookie banner has been accepted.

     lf is this page's own parameter, the label put on the thank-you URL
     of a LinkedIn lead form. It is what ties a scorecard back to a lead
     in that form's export. */
  var SOURCE_KEY = 'mgi-source';
  var FIRST_TOUCH_KEY = 'mgi-first-touch';
  var FIRST_TOUCH_DAYS = 30;
  var ATTR_KEYS = { s: 1, li_fat_id: 1 };

  function isAttrKey(k) {
    return !!ATTR_KEYS[k] || k.indexOf('utm_') === 0;
  }

  function hasAttr(src) {
    return Object.keys(src || {}).some(isAttrKey);
  }

  function consentAccepted() {
    return !!(window.MGIConsent && window.MGIConsent.get &&
      window.MGIConsent.get() === 'accepted');
  }

  function readSource() {
    var stored = {};
    try {
      var raw = sessionStorage.getItem(SOURCE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
    } catch (e) { stored = {}; }

    try {
      var params = new URLSearchParams(window.location.search);
      var fresh = false;
      params.forEach(function (value, key) {
        if (!isAttrKey(key) || !value) return;
        if (!fresh) {
          /* labels in the URL replace a restored first touch for this tab */
          if (stored.restored) stored = {};
          fresh = true;
        }
        stored[key] = String(value).slice(0, 200);
      });
      if (fresh && !stored.first_seen) stored.first_seen = new Date().toISOString();
    } catch (e) { /* a broken query string is not a reason to drop the visit */ }

    var clean = {};
    Object.keys(stored).forEach(function (k) {
      if (!isAttrKey(k) && k !== 'first_seen' && k !== 'restored') return;
      if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) return;
      if (typeof stored[k] !== 'string' || !stored[k]) return;
      clean[k] = stored[k].slice(0, 200);
    });

    try { sessionStorage.setItem(SOURCE_KEY, JSON.stringify(clean)); } catch (e) {}
    return clean;
  }

  /* This page is usually where a paid visit lands, so it is usually where
     first touch gets set. First touch wins: an unexpired copy is never
     overwritten, and nothing outlives the tab without consent. */
  function persistFirstTouch() {
    if (!consentAccepted()) return;
    try {
      var raw = localStorage.getItem(FIRST_TOUCH_KEY);
      if (raw) {
        var held = JSON.parse(raw);
        if (held && Number(held.expires) > Date.now()) return;
      }
    } catch (e) { /* unreadable: treated as absent */ }

    var src = readSource();
    if (!hasAttr(src) || src.restored) return;
    var keep = {};
    Object.keys(src).forEach(function (k) {
      if (isAttrKey(k) || k === 'first_seen') keep[k] = src[k];
    });
    try {
      localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify({
        source: keep,
        expires: Date.now() + FIRST_TOUCH_DAYS * 24 * 60 * 60 * 1000
      }));
    } catch (e) { /* storage blocked: the session copy still works */ }
  }

  function sourceForPost() {
    var src = readSource();
    if (consentAccepted() || !src.li_fat_id) return src;
    var out = {};
    Object.keys(src).forEach(function (k) {
      if (k !== 'li_fat_id') out[k] = src[k];
    });
    return out;
  }

  /* the lead form label, kept for the visit like the campaign labels */
  function leadForm() {
    var k = 'mgi-lf';
    try {
      var held = sessionStorage.getItem(k);
      if (held) return held;
    } catch (e) { /* storage blocked: read it fresh each time */ }
    var found = '';
    try {
      var v = (new URLSearchParams(window.location.search).get('lf') || '')
        .trim().toLowerCase().slice(0, 40);
      if (v && /^[a-z0-9_.-]+$/.test(v)) found = v;
    } catch (e) {}
    try { if (found) sessionStorage.setItem(k, found); } catch (e) {}
    return found;
  }

  /* A random number for the visit, so this scorecard and anything else
     recorded for the same visit can be lined up later. Made in the tab,
     never in a cookie, and gone when the tab closes. */
  function visitId() {
    try {
      var k = 'mgi-visit';
      var v = sessionStorage.getItem(k);
      if (!v) {
        var raw = new Uint8Array(16);
        if (window.crypto && window.crypto.getRandomValues) {
          window.crypto.getRandomValues(raw);
        } else {
          for (var i = 0; i < 16; i++) raw[i] = Math.floor(Math.random() * 256);
        }
        v = Array.prototype.map.call(raw, function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
        sessionStorage.setItem(k, v);
      }
      return v;
    } catch (e) {
      return null;
    }
  }

  /* Only the host, never the path: a full referring URL can carry an
     internal document name or a search query. */
  function referrerHost() {
    try {
      if (!document.referrer) return '';
      var host = new URL(document.referrer).hostname.toLowerCase().replace(/^www\./, '');
      var here = window.location.hostname.toLowerCase().replace(/^www\./, '');
      return (host && host !== here) ? host.slice(0, 64) : '';
    } catch (e) { return ''; }
  }

  function isInternal() {
    try {
      return !!(window.MGIInternal && typeof window.MGIInternal.on === 'function' &&
        window.MGIInternal.on());
    } catch (e) { return false; }
  }

  /* ---------- the scorecard ---------- */

  function renderResult(r) {
    el['r-state-call'].textContent = r.headline;
    el['r-state-desc'].textContent = r.state.description;
    el['r-gap'].textContent = r.gap.copy;

    /* the section heading already says Signal, so the number does not
       repeat it */
    el['r-score'].innerHTML = '';
    el['r-score'].appendChild(document.createTextNode(String(r.signal) + ' '));
    el['r-score'].appendChild(span('sc-of', 'of ' + r.signalMax));

    el['r-signal-headline'].textContent = r.signalHeadline;
    el['r-signal-copy'].textContent = r.signalMeaning;

    var list = el['r-items'];
    list.innerHTML = '';
    r.items.forEach(function (item) {
      var li = document.createElement('li');
      if (item.thinnest) li.className = 'sc-thinnest';
      li.appendChild(span('sc-item-name', item.name));
      li.appendChild(span('sc-item-when sc-when-' + item.value, item.when));
      list.appendChild(li);
    });

    el['r-sight-label'].textContent = r.lineOfSight.label;
    el['r-sight-copy'].textContent = r.lineOfSight.copy;

    el['r-action-area'].textContent = r.focusLine;
    el['r-action-body'].textContent = r.action;

    el['r-cohort'].textContent = r.cohortLine;

    document.title = r.state.name + ' | The Manager Gap self-check';
  }

  function span(cls, text) {
    var s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  /* ---------- the row ----------
     Sent after the scorecard is on the screen, and fire and forget. The
     page is the product here, so nothing about it waits for this or
     changes if it fails. */
  function send(r) {
    var body = {
      form: r.form,
      gut: r.gut,
      items: {},
      output: r.output,
      external: r.external,
      energy: r.energy,
      exposure: r.exposure,
      signal: r.signal,
      behaviour_mean: Number(r.mean.toFixed(2)),
      state: r.state.name,
      decision_rule: r.rule,
      gap: r.gap.key,
      line_of_sight: r.lineOfSight.label,
      line_of_sight_score: r.lineOfSight.score,
      stale: r.stale,
      focus: SC.ITEM_META[r.focus].name,
      landed_at: timing.landed,
      started_at: timing.started,
      seconds: timing.started
        ? Math.round((Date.now() - Date.parse(timing.started)) / 1000)
        : null,
      visit_id: visitId(),
      lf: leadForm(),
      referrer_host: referrerHost(),
      source: sourceForPost(),
      cookieConsent: consentAccepted(),
      internal: isInternal()
    };
    SC.ITEMS.forEach(function (n, i) { body.items['q' + n] = r.evidence[i]; });

    try {
      fetch('/api/selfcheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true
      }).catch(function () {});
    } catch (e) { /* the scorecard is already on the screen */ }
  }

  /* ---------- flow ---------- */

  function init() {
    [
      'view-landing', 'view-questions', 'view-result',
      'btn-start', 'btn-start-2', 'btn-back', 'btn-next',
      'q-count', 'q-bar-fill', 'q-number', 'q-text', 'q-scale',
      'r-state-call', 'r-state-desc', 'r-gap', 'r-score',
      'r-signal-headline', 'r-signal-copy', 'r-items',
      'r-sight-label', 'r-sight-copy',
      'r-action-area', 'r-action-body', 'r-cohort'
    ].forEach(function (id) { el[id] = document.getElementById(id); });

    restore();
    readSource();
    leadForm();
    visitId();
    persistFirstTouch();
    if (window.MGIConsent && window.MGIConsent.onChange) {
      window.MGIConsent.onChange(function (choice) {
        if (choice === 'accepted') persistFirstTouch();
      });
    }

    /* claim the entry we land on, so the in-page Back button can pop
       history without ever stepping off the site */
    history.replaceState({ view: state.done ? 'result' : 'landing', index: 0 }, '');

    el['btn-start'].addEventListener('click', function () { go(0); });
    /* the same button again at the foot of the page, for anyone who read
       their way down rather than starting from the top */
    if (el['btn-start-2']) {
      el['btn-start-2'].addEventListener('click', function () { go(0); });
    }
    el['btn-back'].addEventListener('click', back);
    el['btn-next'].addEventListener('click', next);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('pointerdown', function () { lastInputWasPointer = true; }, true);
    document.addEventListener('keydown', function () { lastInputWasPointer = false; }, true);
    window.addEventListener('popstate', onPopState);

    if (state.done && complete()) {
      /* a reload after finishing: the scorecard is rebuilt from the stored
         answers rather than lost, and no second row is written */
      renderResult(SC.read(state.values));
      show('result', false);
    } else {
      show('landing', false);
    }
  }

  function complete() {
    return state.values.every(function (v) { return v !== null; });
  }

  function save() {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({
        values: state.values,
        index: state.index,
        done: state.done,
        landed: timing.landed,
        started: timing.started
      }));
    } catch (e) { /* private mode, carry on in memory */ }
  }

  function restore() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return;
      var held = JSON.parse(raw);
      if (!held || !Array.isArray(held.values) || held.values.length !== TOTAL) return;
      state.values = held.values;
      state.index = Math.min(Math.max(Number(held.index) || 0, 0), TOTAL - 1);
      state.done = !!held.done;
      if (held.landed) timing.landed = held.landed;
      if (held.started) timing.started = held.started;
    } catch (e) { /* unreadable: start fresh */ }
  }

  function show(view, push) {
    state.view = view;
    ['landing', 'questions', 'result'].forEach(function (v) {
      var node = el['view-' + v];
      if (node) node.classList.toggle('is-active', v === view);
    });
    if (push !== false) history.pushState({ view: view, index: state.index }, '');
    window.scrollTo(0, 0);
  }

  function go(i) {
    state.index = i;
    if (timing.started === null) {
      timing.started = new Date().toISOString();
    }
    renderQuestion();
    if (state.view !== 'questions') show('questions');
    else history.replaceState({ view: 'questions', index: i }, '');
    save();
    focusScale();
  }

  function renderQuestion() {
    var i = state.index;
    var n = i + 1;
    var item = QUESTIONS[i];

    el['q-count'].textContent = n + ' of ' + TOTAL;
    el['q-bar-fill'].style.width = (i / TOTAL * 100) + '%';
    el['q-number'].textContent = n < 10 ? '0' + n : String(n);
    el['q-text'].textContent = item.text;

    var scale = el['q-scale'];
    scale.innerHTML = '';
    var legend = document.createElement('legend');
    legend.className = 'visually-hidden';
    legend.textContent = item.kind === 'evidence'
      ? 'How recently did this happen?' : 'Choose one';
    scale.appendChild(legend);

    item.options.forEach(function (opt, k) {
      var label = document.createElement('label');
      label.className = 'scale-option';

      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'q' + n;
      input.value = String(k);
      input.checked = state.values[i] === opt.value;
      input.addEventListener('change', function () { choose(opt.value); });

      var face = document.createElement('span');
      face.className = 'face';

      var key = document.createElement('span');
      key.className = 'key';
      key.setAttribute('aria-hidden', 'true');
      key.textContent = String(k + 1);

      var text = document.createElement('span');
      text.textContent = opt.label;

      face.appendChild(key);
      face.appendChild(text);
      label.appendChild(input);
      label.appendChild(face);
      scale.appendChild(label);
    });

    el['btn-back'].hidden = false;
    el['btn-back'].textContent = i === 0 ? 'Back to start' : 'Back';
    el['btn-next'].hidden = state.values[i] === null;
  }

  function focusScale() {
    var first = el['q-scale'].querySelector('input:checked') ||
      el['q-scale'].querySelector('input');
    if (first) first.focus({ preventScroll: true });
  }

  function choose(value) {
    state.values[state.index] = value;
    el['btn-next'].hidden = false;
    save();
    if (lastInputWasPointer) window.setTimeout(next, ADVANCE_DELAY);
  }

  function next() {
    if (state.values[state.index] === null) return;
    if (state.index < TOTAL - 1) {
      go(state.index + 1);
      return;
    }
    finish();
  }

  function finish() {
    if (!complete()) return;
    var already = state.done;
    state.done = true;
    save();
    var r = SC.read(state.values);
    renderResult(r);
    show('result');
    /* one row per completed scorecard, not one per visit to this view */
    if (!already) send(r);
  }

  function back() {
    if (state.index === 0) {
      show('landing');
      return;
    }
    go(state.index - 1);
  }

  function onPopState(e) {
    var s = e.state || { view: 'landing', index: 0 };
    if (s.view === 'questions') {
      state.index = Math.min(Math.max(Number(s.index) || 0, 0), TOTAL - 1);
      renderQuestion();
      show('questions', false);
      focusScale();
      return;
    }
    if (s.view === 'result' && complete()) {
      renderResult(SC.read(state.values));
      show('result', false);
      return;
    }
    show('landing', false);
  }

  function onKeydown(e) {
    if (state.view !== 'questions') return;
    var item = QUESTIONS[state.index];
    var n = item.options.length;

    if (e.key === 'Enter') {
      if (state.values[state.index] !== null) {
        e.preventDefault();
        next();
      }
      return;
    }
    if (e.key >= '1' && e.key <= String(n)) {
      e.preventDefault();
      choose(item.options[Number(e.key) - 1].value);
      window.setTimeout(next, ADVANCE_DELAY);
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      back();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
