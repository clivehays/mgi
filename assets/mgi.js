/* =============================================================
   Manager Gap Index v5 - flow, rendering, submission
   Answers stay in the page (and sessionStorage) until the
   contact form is submitted. Nothing leaves the browser before.
   ============================================================= */

(function () {
  'use strict';

  var STORE_KEY = 'mgi-v5';
  var ADVANCE_DELAY = 200;

  var state = {
    answers: new Array(12).fill(null),
    index: 0,
    contact: null,
    view: 'landing'
  };

  var el = {};

  /* ---------- boot ---------- */

  function init() {
    [
      'view-landing', 'view-questions', 'view-contact', 'view-report',
      'btn-start', 'btn-back', 'btn-next', 'btn-submit',
      'q-count', 'q-bar-fill', 'q-number', 'q-text', 'q-scale',
      'contact-form', 'form-error',
      'band-name', 'band-score', 'band-desc',
      'svg-drift', 'svg-headwinds', 'key-drift', 'key-headwinds',
      'headline-finding', 'areas-list', 'report-sent'
    ].forEach(function (id) {
      el[id] = document.getElementById(id);
    });

    restore();

    /* claim the entry we land on, so the in-page Back button can pop
       history without ever stepping off the site */
    history.replaceState({ view: state.view === 'report' ? 'report' : 'landing', index: 0 }, '');

    el['btn-start'].addEventListener('click', function () { go(0); });
    el['btn-back'].addEventListener('click', back);
    el['btn-next'].addEventListener('click', next);
    el['contact-form'].addEventListener('submit', onSubmit);

    document.addEventListener('keydown', onKeydown);
    window.addEventListener('popstate', onPopState);

    if (state.view === 'report' && state.contact) {
      renderReport(MGI.score(state.answers));
      show('report', false);
    } else {
      show('landing', false);
    }
  }

  /* ---------- persistence ---------- */

  function save() {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) { /* private mode, carry on in memory */ }
  }

  function restore() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return;
      var prev = JSON.parse(raw);
      if (prev && Array.isArray(prev.answers) && prev.answers.length === 12) {
        state.answers = prev.answers;
        state.index = prev.index || 0;
        state.contact = prev.contact || null;
        state.view = prev.view || 'landing';
      }
    } catch (e) { /* ignore corrupt state */ }
  }

  /* ---------- view switching ---------- */

  function show(view, push) {
    state.view = view;
    ['landing', 'questions', 'contact', 'report'].forEach(function (v) {
      el['view-' + v].classList.toggle('is-active', v === view);
    });
    if (push !== false) {
      history.pushState({ view: view, index: state.index }, '');
    }
    window.scrollTo(0, 0);
    save();
  }

  function onPopState(e) {
    var s = e.state;
    if (!s) { show('landing', false); return; }
    if (s.view === 'questions') {
      state.index = s.index || 0;
      renderQuestion();
      show('questions', false);
    } else {
      show(s.view, false);
    }
  }

  /* ---------- questions ---------- */

  function go(i) {
    state.index = i;
    renderQuestion();
    show('questions');
    focusScale();
  }

  function renderQuestion() {
    var i = state.index;
    var n = i + 1;

    el['q-count'].textContent = n + ' of 12';
    el['q-bar-fill'].style.width = (i / 12 * 100) + '%';
    el['q-number'].textContent = n < 10 ? '0' + n : String(n);
    el['q-text'].textContent = MGI.QUESTIONS[i];

    var scale = el['q-scale'];
    scale.innerHTML = '';
    var legend = document.createElement('legend');
    legend.className = 'visually-hidden';
    legend.textContent = 'How recently did this happen?';
    scale.appendChild(legend);

    MGI.SCALE.forEach(function (opt, k) {
      var label = document.createElement('label');
      label.className = 'scale-option';

      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'q' + n;
      input.value = String(opt.value);
      input.checked = state.answers[i] === opt.value;
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
    el['btn-next'].hidden = state.answers[i] === null;
  }

  function focusScale() {
    var first = el['q-scale'].querySelector('input:checked') || el['q-scale'].querySelector('input');
    if (first) first.focus({ preventScroll: true });
  }

  function choose(value) {
    state.answers[state.index] = value;
    el['btn-next'].hidden = false;
    save();
    if (lastInputWasPointer) {
      window.setTimeout(next, ADVANCE_DELAY);
    }
  }

  function next() {
    if (state.answers[state.index] === null) return;
    if (state.index < 11) {
      go(state.index + 1);
    } else {
      show('contact');
      var first = document.getElementById('f-first');
      if (first) first.focus({ preventScroll: true });
    }
  }

  /* pop rather than push, so the in-page Back button and the
     phone's own back gesture walk the same single history stack */
  function back() {
    history.back();
  }

  /* pointer selection auto-advances; keyboard selection does not,
     because arrow keys move and select in one action */
  var lastInputWasPointer = false;
  document.addEventListener('pointerdown', function () { lastInputWasPointer = true; }, true);
  document.addEventListener('keydown', function () { lastInputWasPointer = false; }, true);

  function onKeydown(e) {
    if (state.view !== 'questions') return;
    if (e.key === 'Enter') {
      e.preventDefault();
      next();
      return;
    }
    if (['1', '2', '3', '4'].indexOf(e.key) !== -1) {
      var inputs = el['q-scale'].querySelectorAll('input');
      var target = inputs[Number(e.key) - 1];
      if (target) {
        e.preventDefault();
        target.checked = true;
        choose(Number(target.value));
        target.focus({ preventScroll: true });
      }
    }
  }

  /* ---------- contact ---------- */

  function onSubmit(e) {
    e.preventDefault();

    var form = el['contact-form'];
    var contact = {
      firstName: form.firstName.value.trim(),
      email: form.email.value.trim(),
      company: form.company.value.trim(),
      role: form.role.value.trim(),
      teamSize: form.teamSize.value,
      website: form.website.value
    };

    var missing = [];
    if (!contact.firstName) missing.push('first name');
    if (!contact.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) missing.push('a valid work email');
    if (!contact.company) missing.push('company');
    if (!contact.role) missing.push('role');

    if (missing.length) {
      el['form-error'].textContent = 'Please add ' + listify(missing) + '.';
      el['form-error'].hidden = false;
      return;
    }
    el['form-error'].hidden = true;

    state.contact = contact;
    save();

    var result = MGI.score(state.answers);
    renderReport(result);
    show('report');

    send(contact, result);
  }

  function listify(items) {
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  function send(contact, result) {
    el['report-sent'].textContent = 'A copy of this report is on its way to ' + contact.email + '.';

    var payload = {
      firstName: contact.firstName,
      email: contact.email,
      company: contact.company,
      role: contact.role,
      teamSize: contact.teamSize,
      website: contact.website,
      answers: state.answers,
      submittedAt: new Date().toISOString()
    };

    fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error('bad status');
    }).catch(function () {
      el['report-sent'].textContent = 'We could not send the email copy just now. This report is complete as it stands, and you can reach us at contact@cloverera.com.';
    });
  }

  /* ---------- report ---------- */

  function renderReport(r) {
    el['band-name'].textContent = r.band.name;
    el['band-score'].textContent = r.total + ' / 36';
    el['band-desc'].textContent = r.band.desc;

    el['svg-drift'].textContent = r.drift.label.toUpperCase();
    el['svg-headwinds'].textContent = r.headwinds.label.toUpperCase();
    el['key-drift'].textContent = r.drift.label;
    el['key-headwinds'].textContent = r.headwinds.label;

    el['headline-finding'].textContent = r.headline;

    var list = el['areas-list'];
    list.innerHTML = '';

    r.areas.forEach(function (a) {
      var wrap = document.createElement('div');
      wrap.className = 'area';

      var head = document.createElement('div');
      head.className = 'area-head';

      var name = document.createElement('h3');
      name.className = 'area-name';
      name.textContent = a.name;

      var label = document.createElement('span');
      label.className = 'area-label lab-' + a.label.toLowerCase();
      label.textContent = a.label;

      head.appendChild(name);
      head.appendChild(label);

      var bar = document.createElement('div');
      bar.className = 'area-bar';
      var fill = document.createElement('span');
      fill.style.width = (a.mean / 3 * 100) + '%';
      bar.appendChild(fill);

      var desc = document.createElement('p');
      desc.className = 'area-desc';
      desc.textContent = a.desc;

      wrap.appendChild(head);
      wrap.appendChild(bar);
      wrap.appendChild(desc);

      if (a.isWeakest) {
        var callout = document.createElement('p');
        callout.className = 'area-callout';
        callout.textContent = MGI.calloutFor(a);
        wrap.appendChild(callout);
      }

      list.appendChild(wrap);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
