/* =============================================================
   Manager Gap Index v5 - flow, rendering, submission
   Answers stay in the page (and sessionStorage) until the
   contact form is submitted. Nothing leaves the browser before.
   ============================================================= */

(function () {
  'use strict';

  var STORE_KEY = 'mgi-v5';
  var ADVANCE_DELAY = 200;
  var TOTAL = 20;

  /* where the dot sits in each quadrant, at mid-radius */
  var MARKER_POS = {
    cruise: { x: 280, y: 135, where: 'at the top' },
    headwinds: { x: 360, y: 215, where: 'on the right' },
    stall: { x: 280, y: 295, where: 'at the bottom' },
    drift: { x: 200, y: 215, where: 'on the left' }
  };

  /* the halo IS line of sight: it widens as the manager sees less of
     the team's week. Keyed on the line of sight score so the picture
     and the words on the page cannot disagree. */
  var MARKER_STYLE = {
    3: { dot: 7, halo: 0, haloOpacity: 0 },
    2: { dot: 7, halo: 20, haloOpacity: 0.20 },
    1: { dot: 7, halo: 36, haloOpacity: 0.17 },
    0: { dot: 5, halo: 52, haloOpacity: 0.14 }
  };

  var state = {
    values: new Array(TOTAL).fill(null),
    index: 0,
    contact: null,
    view: 'landing'
  };

  var el = {};

  /* ---------- funnel telemetry ----------
     Only finished assessments reach the database, so without this there
     is no way to tell three finishers out of five from three out of
     fifty. It sends a random per-visit id, how far the visitor got, two
     flags and a coarse device word. No answers, no identity, nothing
     that could be personal: people abandon before the consent box, so
     nothing gathered here may be research data.

     Every call is fire and forget. The assessment must work identically
     with this endpoint broken, blocked or absent. */

  var funnel = {
    sid: null,
    furthest: 0,
    reachedContact: false,
    submitted: false,
    lastSent: -1
  };

  function funnelId() {
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
      return null;   /* private mode, storage blocked: telemetry simply stops */
    }
  }

  function device() {
    var w = window.innerWidth || 1024;
    if (w < 620) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  function funnelSend(useBeacon) {
    if (!funnel.sid) return;
    /* nothing new to report, and the leave-beacon is always worth sending */
    if (!useBeacon && funnel.furthest <= funnel.lastSent && !funnel.submitted) return;
    funnel.lastSent = funnel.furthest;

    var payload = JSON.stringify({
      sid: funnel.sid,
      furthest: funnel.furthest,
      reachedContact: funnel.reachedContact,
      submitted: funnel.submitted,
      device: device()
    });

    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon('/api/funnel', new Blob([payload], { type: 'application/json' }));
        return;
      }
      fetch('/api/funnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      }).catch(function () {});
    } catch (e) { /* telemetry never interrupts the assessment */ }
  }

  function funnelMark(n) {
    if (n > funnel.furthest) funnel.furthest = n;
    /* checkpoint every fifth question, so a lost leave-beacon still
       leaves a usable trace of roughly how far someone got */
    if (funnel.furthest % 5 === 0) funnelSend(false);
  }

  function funnelInit() {
    funnel.sid = funnelId();
    if (!funnel.sid) return;
    window.addEventListener('pagehide', function () { funnelSend(true); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') funnelSend(true);
    });
  }

  /* ---------- boot ---------- */

  function init() {
    [
      'view-landing', 'view-questions', 'view-contact', 'view-report',
      'btn-start', 'btn-back', 'btn-next', 'btn-submit',
      'q-count', 'q-bar-fill', 'q-number', 'q-text', 'q-scale',
      'contact-form', 'form-error', 'f-industry', 'field-industry-other', 'f-industry-other',
      'f-consent',
      'state-call', 'state-desc', 'gap-body',
      'los-value', 'los-copy', 'gap-width-value', 'gap-width-copy', 'gap-framing',
      'compass-desc', 'marker-halo', 'marker-dot',
      'signal-score', 'signal-framing', 'signal-copy', 'areas-list', 'areas-summary',
      'action-area', 'action-body', 'report-sent'
    ].forEach(function (id) {
      el[id] = document.getElementById(id);
    });

    restore();
    funnelInit();

    /* claim the entry we land on, so the in-page Back button can pop
       history without ever stepping off the site */
    history.replaceState({ view: state.view === 'report' ? 'report' : 'landing', index: 0 }, '');

    el['btn-start'].addEventListener('click', function () { go(0); });
    el['btn-back'].addEventListener('click', back);
    el['btn-next'].addEventListener('click', next);
    el['contact-form'].addEventListener('submit', onSubmit);
    el['f-industry'].addEventListener('change', onIndustryChange);
    el['f-consent'].addEventListener('change', onConsentChange);

    document.addEventListener('keydown', onKeydown);
    window.addEventListener('popstate', onPopState);

    if (state.view === 'report' && state.contact && complete()) {
      renderReport(MGI.score(toAnswers()));
      show('report', false);
    } else {
      show('landing', false);
    }
  }

  function toAnswers() {
    return {
      gut: state.values[0],
      evidence: state.values.slice(1, 16),
      output: state.values[16],
      external: state.values[17],
      energy: state.values[18],
      exposure: state.values[19]
    };
  }

  function complete() {
    return state.values.every(function (v) { return v !== null; });
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
      if (prev && Array.isArray(prev.values) && prev.values.length === TOTAL) {
        state.values = prev.values;
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
    funnelMark(i + 1);
    renderQuestion();
    show('questions');
    focusScale();
  }

  function renderQuestion() {
    var i = state.index;
    var n = i + 1;
    var item = MGI.ITEMS[i];

    el['q-count'].textContent = n + ' of ' + TOTAL;
    el['q-bar-fill'].style.width = (i / TOTAL * 100) + '%';
    el['q-number'].textContent = n < 10 ? '0' + n : String(n);
    el['q-text'].textContent = item.text;

    var scale = el['q-scale'];
    scale.innerHTML = '';
    var legend = document.createElement('legend');
    legend.className = 'visually-hidden';
    legend.textContent = item.kind === 'evidence' ? 'How recently did this happen?' : 'Choose one';
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
    var first = el['q-scale'].querySelector('input:checked') || el['q-scale'].querySelector('input');
    if (first) first.focus({ preventScroll: true });
  }

  function choose(value) {
    state.values[state.index] = value;
    el['btn-next'].hidden = false;
    save();
    if (lastInputWasPointer) {
      window.setTimeout(next, ADVANCE_DELAY);
    }
  }

  function next() {
    if (state.values[state.index] === null) return;
    if (state.index < TOTAL - 1) {
      go(state.index + 1);
    } else {
      funnel.reachedContact = true;
      funnelMark(TOTAL);
      funnelSend(false);
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
        target.dispatchEvent(new Event('change'));
        target.focus({ preventScroll: true });
      }
    }
  }

  /* ---------- contact ---------- */

  /* the free-text box only exists once Other is chosen, so the form stays
     one tap for everyone else */
  function onIndustryChange() {
    var isOther = el['f-industry'].value === 'Other';
    el['field-industry-other'].hidden = !isOther;
    /* focus without preventScroll here: on a phone this pops the keyboard, and
       the field needs to be scrolled clear of it */
    if (isOther) el['f-industry-other'].focus();
    else el['f-industry-other'].value = '';
  }

  /* the button is the gate: nothing can be submitted until consent is given,
     and the submit handler checks again in case the two ever drift apart */
  function onConsentChange() {
    el['btn-submit'].disabled = !el['f-consent'].checked;
  }

  function onSubmit(e) {
    e.preventDefault();

    var form = el['contact-form'];
    var contact = {
      firstName: form.firstName.value.trim(),
      email: form.email.value.trim(),
      company: form.company.value.trim(),
      role: form.role.value.trim(),
      industry: form.industry.value,
      industryOther: form.industryOther.value.trim(),
      currentlyLeading: form.currentlyLeading.value,
      teamSize: form.teamSize.value,
      tenure: form.tenure.value,
      left6m: form.left6m.value,
      joined6m: form.joined6m.value,
      consent: form.consent.checked,
      website: form.website.value
    };

    var missing = [];
    if (!contact.firstName) missing.push('first name');
    if (!contact.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) missing.push('a valid work email');
    if (!contact.company) missing.push('company');
    if (!contact.role) missing.push('role');
    if (!contact.consent) missing.push('your consent to take part');
    if (!contact.currentlyLeading) missing.push('whether you lead this team at the moment');
    if (!contact.teamSize) missing.push('team size');
    if (!contact.tenure) missing.push('how long you have led this team');
    if (!contact.left6m) missing.push('how many people have left');
    if (!contact.joined6m) missing.push('how many have joined');
    if (!contact.industry) missing.push('industry');
    else if (contact.industry === 'Other' && !contact.industryOther) missing.push('which industry');

    if (missing.length) {
      el['form-error'].textContent = 'Please add ' + listify(missing) + '.';
      el['form-error'].hidden = false;
      return;
    }
    el['form-error'].hidden = true;

    state.contact = contact;
    save();

    var result = MGI.score(toAnswers());
    renderReport(result);
    show('report');

    send(contact);
  }

  function listify(items) {
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  function send(contact) {
    funnel.submitted = true;
    funnelSend(false);
    el['report-sent'].textContent = 'A copy of this report is on its way to ' + contact.email + '.';

    var answers = toAnswers();
    var payload = {
      firstName: contact.firstName,
      email: contact.email,
      company: contact.company,
      role: contact.role,
      industry: contact.industry,
      industryOther: contact.industryOther,
      currentlyLeading: contact.currentlyLeading,
      teamSize: contact.teamSize,
      tenure: contact.tenure,
      left6m: contact.left6m,
      joined6m: contact.joined6m,
      consent: contact.consent,
      consentAt: new Date().toISOString(),
      website: contact.website,
      gut: answers.gut,
      evidence: answers.evidence,
      output: answers.output,
      external: answers.external,
      energy: answers.energy,
      exposure: answers.exposure,
      submittedAt: new Date().toISOString()
    };

    fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error('bad status');
      return res.json();
    }).then(function (data) {
      /* only the manager's own copy decides this message. A failed
         notification is ours to chase and says nothing to them. */
      if (data && data.copySent === false) throw new Error('copy not sent');
    }).catch(function () {
      el['report-sent'].textContent = 'We could not send the email copy just now. This report is complete as it stands, and you can reach us at contact@cloverera.com.';
    });
  }

  /* ---------- report ---------- */

  function renderReport(r) {
    /* the state call stays hedged: most likely, never certain */
    var call = el['state-call'];
    call.innerHTML = '';
    call.appendChild(document.createTextNode('Based on what you’ve observed, your team is most likely in '));
    var name = document.createElement('em');
    name.className = 'state-name';
    name.style.color = r.state.colour;
    name.textContent = r.state.name;
    call.appendChild(name);
    call.appendChild(document.createTextNode('.'));

    el['state-desc'].textContent = r.state.description;
    el['gap-body'].textContent = r.gap.copy;

    /* line of sight and gap width. Evidence, not the decision: nothing
       here tells the reader to trust the result less. */
    el['los-value'].textContent = r.lineOfSight.label;
    el['los-copy'].textContent = r.lineOfSight.copy;
    el['gap-width-value'].textContent = r.gapWidth.label;
    el['gap-width-copy'].textContent = r.gapWidth.copy;
    el['gap-framing'].textContent = r.gapFraming;

    renderCompass(r);

    el['signal-score'].textContent = r.signal + ' / ' + (MGI.EVIDENCE.length * 3);
    el['signal-framing'].textContent = MGI.SIGNAL_FRAMING;
    el['signal-copy'].textContent = r.signalCopy;
    renderAreas(r);

    /* name the area the action addresses, so a reader who skims still
       knows what this week is for */
    if (el['action-area']) el['action-area'].textContent = r.ranked[0].name;
    el['action-body'].textContent = r.action;
  }

  function renderCompass(r) {
    var pos = MARKER_POS[r.state.key];
    var style = MARKER_STYLE[r.lineOfSight.score];

    var halo = el['marker-halo'];
    halo.setAttribute('cx', pos.x);
    halo.setAttribute('cy', pos.y);
    halo.setAttribute('r', style.halo);
    halo.setAttribute('fill', style.halo ? r.state.colour : 'none');
    halo.setAttribute('fill-opacity', style.haloOpacity);

    var dot = el['marker-dot'];
    dot.setAttribute('cx', pos.x);
    dot.setAttribute('cy', pos.y);
    dot.setAttribute('r', style.dot);
    dot.setAttribute('fill', r.state.colour);

    var caption = document.querySelector('.compass-caption');
    if (caption) {
      caption.textContent = 'The dot marks ' + r.state.name +
        '. The halo is your line of sight: ' + r.lineOfSight.label.toLowerCase() + '.';
    }

    el['compass-desc'].textContent =
      'The evidence points to ' + r.state.name + '. Line of sight is ' + r.lineOfSight.label.toLowerCase() +
      ', gap width ' + r.gapWidth.label.toLowerCase() +
      '. The dot sits in the ' + r.state.name + ' quadrant, ' + pos.where +
      ' of the compass. Cruise is at the top, Headwinds on the right, Stall at the bottom, Drift on the left.';
  }

  function renderAreas(r) {
    var list = el['areas-list'];
    list.innerHTML = '';

    r.areas.forEach(function (a) {
      var wrap = document.createElement('div');
      wrap.className = 'area';

      /* Name and answer on one line, so five areas read as five answers
         down the page and a reader can take them in at a glance. The
         prose sits underneath for whoever wants it. Same words, same
         voice; the reader chooses the depth rather than the page. */
      var head = document.createElement('div');
      head.className = 'area-head';

      var name = document.createElement('h3');
      name.className = 'area-name';
      name.textContent = a.name;

      var answer = document.createElement('p');
      answer.className = 'area-answer fact-' + a.best;
      answer.textContent = a.freshest;

      head.appendChild(name);
      head.appendChild(answer);

      var desc = document.createElement('p');
      desc.className = 'area-desc';
      desc.textContent = a.desc;

      /* the honest summary of an area is its recency, stated plainly.
         No label vocabulary sits on top of it. The answer line above
         gives the freshest item; this names the rest of the area. */
      var fact = document.createElement('p');
      fact.className = 'area-fact';
      fact.textContent = a.recencyFact;

      wrap.appendChild(head);
      wrap.appendChild(desc);
      wrap.appendChild(fact);

      if (a.callout) {
        var callout = document.createElement('p');
        callout.className = 'area-callout';
        callout.textContent = a.callout;
        wrap.appendChild(callout);
      }

      list.appendChild(wrap);
    });

    /* either the summary block or the per-area callouts, never both */
    el['areas-summary'].textContent = r.summary || '';
    el['areas-summary'].hidden = !r.summary;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
