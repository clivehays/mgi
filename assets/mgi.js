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
      'signal-headline', 'signal-score', 'signal-copy', 'areas-list', 'areas-summary',
      'action-area', 'action-body', 'report-sent',
      'people-intro', 'people-units', 'people-situational', 'closing-body',
      'discovery-lag'
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

  /* HTML and JS are separate files with independent caches, so there is
     always a window in which a visitor holds one version of one and a
     different version of the other. A missing element used to throw and
     abandon the rest of the render, leaving a half-blank report. Writing
     through this instead means an unknown element is skipped and
     everything else still draws. */
  function setText(id, value) {
    var node = el[id] || document.getElementById(id);
    if (node) node.textContent = value;
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

    setText('state-desc', r.state.description);
    setText('gap-body', r.gap.copy);

    /* line of sight and gap width. Evidence, not the decision: nothing
       here tells the reader to trust the result less. */
    setText('los-value', r.lineOfSight.label);
    setText('los-copy', r.lineOfSight.copy);
    setText('gap-width-value', r.gapWidth.label);
    setText('gap-width-copy', r.gapWidth.copy);
    setText('discovery-lag', r.discoveryLag);

    renderCompass(r);
    renderArrows(r);

    /* the meaning first. The raw score is kept, small and last, because a
       number out of 45 tells a manager nothing they did not just type in. */
    setText('signal-headline', r.signalHeadline);
    setText('signal-score', 'Signal score ' + r.signal + ' / ' + (MGI.EVIDENCE.length * 3));
    setText('signal-copy', r.signalMeaning);
    renderPeople(r);
    renderClosing(r);
    renderRadar(r);
    renderAreas(r);

    /* name the area the action addresses, so a reader who skims still
       knows what this week is for */
    setText('action-area', r.ranked[0].name);
    setText('action-body', r.action);
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
      caption.textContent = COMPASS_CAPTION[r.state.key] +
        ' The halo is your line of sight: ' + r.lineOfSight.label.toLowerCase() + '.';
    }

    setText('compass-desc',
      'The evidence points to ' + r.state.name + '. Line of sight is ' + r.lineOfSight.label.toLowerCase() +
      ', gap width ' + r.gapWidth.label.toLowerCase() +
      '. The dot sits in the ' + r.state.name + ' quadrant, ' + pos.where +
      ' of the compass. Cruise is at the top, Headwinds on the right, Stall at the bottom, Drift on the left.' +
      COMPASS_ARROW_DESC[r.state.key]);
  }



  /* ---------- direction of travel ----------
     A dashed arc on the compass already there, no second figure. It
     carries the whole thesis before a word is read: this state is not
     a place, it is a position on a road. Stall gets no arrow, and its
     caption says why, which is itself the finding. */

  var PATH_ARROWS = {
    cruise: [{ d: 'M 236.7 81.9 A 140 140 0 0 0 153.1 155.8', head: [153.1, 155.8, 115] }],
    drift: [{ d: 'M 146.9 258.3 A 140 140 0 0 0 236.7 348.1', head: [236.7, 348.1, 18] }],
    headwinds: [
      { d: 'M 413.1 258.3 A 140 140 0 0 1 323.3 348.1', head: [323.3, 348.1, 162] },
      { d: 'M 413.1 171.7 A 140 140 0 0 0 323.3 81.9', head: [323.3, 81.9, -162] }
    ],
    stall: []
  };

  var COMPASS_CAPTION = {
    cruise: 'The dot marks Cruise. The dashed line is the way teams usually leave it, quietly toward Drift.',
    drift: 'The dot marks Drift. The dashed line is where Drift usually goes when nothing interrupts it.',
    headwinds: 'The dot marks Headwinds. The two dashed lines are the two ways it usually resolves. The weather does not choose between them, the response does.',
    stall: 'The dot marks Stall. No line leads out, because the usual exits from Stall are not on the compass: the door, or the slow climb back through the behaviours.'
  };

  var COMPASS_ARROW_DESC = {
    cruise: ' A dashed arrow curves from the Cruise quadrant toward Drift, the direction this state usually moves when it moves.',
    drift: ' A dashed arrow curves from the Drift quadrant toward Stall, the direction this state usually moves when nothing interrupts it.',
    headwinds: ' Two dashed arrows leave the Headwinds quadrant, one curving toward Cruise and one toward Stall, the two ways this state usually resolves.',
    stall: ' No arrow leaves the Stall quadrant. The usual exits from Stall are not states on the compass.'
  };

  function renderArrows(r) {
    var g = document.getElementById('path-arrows');
    if (!g) return;
    g.innerHTML = '';
    (PATH_ARROWS[r.state.key] || []).forEach(function (a) {
      g.appendChild(svgEl('path', {
        d: a.d, fill: 'none', stroke: '#17161A', 'stroke-opacity': '0.45',
        'stroke-width': 1.5, 'stroke-dasharray': '5 7', 'stroke-linecap': 'round'
      }));
      var x = a.head[0], y = a.head[1], rot = a.head[2];
      g.appendChild(svgEl('polygon', {
        points: '0,-4.5 9,0 0,4.5',
        fill: '#17161A', 'fill-opacity': '0.45',
        transform: 'translate(' + x + ' ' + y + ') rotate(' + rot + ')'
      }));
    });
  }

  /* ---------- the people ---------- */

  function renderPeople(r) {
    var intro = el['people-intro'];
    var units = el['people-units'];
    if (!intro || !units) return;

    var people = MGI.peopleSection(r, {
      left6m: (state.contact && state.contact.left6m) || 'none',
      joined6m: (state.contact && state.contact.joined6m) || 'none',
      tenure: (state.contact && state.contact.tenure) || '',
      energy: state.values[18]
    }, toAnswers());

    intro.innerHTML = '';
    people.intro.forEach(function (t) {
      var p = document.createElement('p');
      p.className = 'people-intro';
      p.textContent = t;
      intro.appendChild(p);
    });

    units.innerHTML = '';
    people.units.forEach(function (u) {
      var wrap = document.createElement('div');
      wrap.className = 'people-unit';
      var pre = document.createElement('p');
      pre.className = 'people-premise';
      pre.textContent = u.premise;
      var inf = document.createElement('p');
      inf.className = 'people-inference';
      inf.textContent = u.inference;
      wrap.appendChild(pre);
      wrap.appendChild(inf);
      units.appendChild(wrap);
    });

    var sit = el['people-situational'];
    if (sit) {
      sit.textContent = people.situational || '';
      sit.hidden = !people.situational;
    }
  }

  function renderClosing(r) {
    var box = el['closing-body'];
    if (!box) return;
    box.innerHTML = '';
    MGI.closingBlocks(r).forEach(function (t, i) {
      var p = document.createElement('p');
      p.className = i === 3 ? 'closing-fork' : 'closing-body';
      p.textContent = t;
      box.appendChild(p);

      /* a live address after the offer. The report email can land in a
         junk folder, so the page must not be the only route back. */
      if (i === 2) {
        var contact = document.createElement('p');
        contact.className = 'closing-body';
        contact.appendChild(document.createTextNode('Reply to the report email, or write to '));
        var a = document.createElement('a');
        a.href = 'mailto:clive@managergap.com?subject=' +
          encodeURIComponent('My Manager Gap Index result: ' + r.state.name);
        a.textContent = 'clive@managergap.com';
        contact.appendChild(a);
        contact.appendChild(document.createTextNode('.'));
        box.appendChild(contact);
      }
    });
  }

  /* ---------- the radar ----------
     Five areas, one shape. The five area means sit on the same 0-3 recency
     scale, which is the case a radar actually suits: the axes are
     commensurable, so the polygon means something rather than merely
     looking like it does.

     Deliberately not a second compass. The compass above is a filled,
     coloured circle carrying the state; this is an unfilled pentagon in
     ink on paper, sitting well below it in the evidence layer. A reader
     should never have to work out how the two relate.

     Read it as: the further a corner is pulled in, the longer since
     anything in that area reached you. A corner at the centre means
     nothing in it could be recalled at all. */

  var RADAR = {
    cx: 210, cy: 176, r: 108,
    rings: [1, 2, 3],
    labelPad: 34
  };

  function radarPoint(i, value, n) {
    /* first axis at the top, then clockwise */
    var angle = (-Math.PI / 2) + (i * 2 * Math.PI / n);
    var rad = RADAR.r * (value / 3);
    return {
      x: RADAR.cx + rad * Math.cos(angle),
      y: RADAR.cy + rad * Math.sin(angle),
      angle: angle
    };
  }

  function svgEl(name, attrs) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function renderRadar(r) {
    var svg = document.getElementById('radar');
    if (!svg) return;

    /* keep the title and desc, drop any previous drawing */
    var keep = {};
    ['radar-title', 'radar-desc'].forEach(function (id) {
      var n = document.getElementById(id);
      if (n) keep[id] = n;
    });
    svg.innerHTML = '';
    Object.keys(keep).forEach(function (id) { svg.appendChild(keep[id]); });

    var areas = r.areas;
    var n = areas.length;

    /* the rings, faintest first, so the outer edge reads as the ceiling */
    RADAR.rings.forEach(function (ring) {
      var pts = [];
      for (var i = 0; i < n; i++) {
        var p = radarPoint(i, ring, n);
        pts.push(p.x.toFixed(1) + ',' + p.y.toFixed(1));
      }
      svg.appendChild(svgEl('polygon', {
        points: pts.join(' '),
        fill: 'none',
        stroke: ring === 3 ? '#C9C2B4' : '#D9D3C5',
        'stroke-width': ring === 3 ? 1 : 1,
        'stroke-dasharray': ring === 3 ? '' : '2 4'
      }));
    });

    /* spokes */
    for (var i = 0; i < n; i++) {
      var edge = radarPoint(i, 3, n);
      svg.appendChild(svgEl('line', {
        x1: RADAR.cx, y1: RADAR.cy, x2: edge.x.toFixed(1), y2: edge.y.toFixed(1),
        stroke: '#D9D3C5', 'stroke-width': 1
      }));
    }

    /* the shape itself */
    var shape = [];
    for (i = 0; i < n; i++) {
      var pt = radarPoint(i, areas[i].mean, n);
      shape.push(pt.x.toFixed(1) + ',' + pt.y.toFixed(1));
    }
    svg.appendChild(svgEl('polygon', {
      points: shape.join(' '),
      fill: '#1A3565',
      'fill-opacity': '0.10',
      stroke: '#1A3565',
      'stroke-width': 2,
      'stroke-linejoin': 'round'
    }));

    /* a dot per corner, tinted the way the area answers are tinted, so the
       chart and the list below use one colour language */
    var TINT = { 3: '#17161A', 2: '#3D3A34', 1: '#6F6A60', 0: '#918B7E' };
    for (i = 0; i < n; i++) {
      var d = radarPoint(i, areas[i].mean, n);
      svg.appendChild(svgEl('circle', {
        cx: d.x.toFixed(1), cy: d.y.toFixed(1), r: 4,
        fill: TINT[areas[i].best] || '#6F6A60'
      }));
    }

    /* axis labels, nudged out past the outer ring */
    for (i = 0; i < n; i++) {
      var lp = radarPoint(i, 3, n);
      var out = {
        x: RADAR.cx + (RADAR.r + RADAR.labelPad) * Math.cos(lp.angle),
        y: RADAR.cy + (RADAR.r + RADAR.labelPad) * Math.sin(lp.angle)
      };
      var anchor = 'middle';
      if (out.x > RADAR.cx + 8) anchor = 'start';
      if (out.x < RADAR.cx - 8) anchor = 'end';
      var t = svgEl('text', {
        x: out.x.toFixed(1), y: (out.y + 4).toFixed(1),
        'text-anchor': anchor, class: 'radar-label'
      });
      t.textContent = areas[i].short;
      svg.appendChild(t);
    }

    /* the text alternative carries the same reading, not a description of
       a picture somebody using a screen reader cannot see */
    var desc = document.getElementById('radar-desc');
    if (desc) {
      desc.textContent = r.ranked.map(function (a) {
        return a.name + ', ' + a.freshest.toLowerCase();
      }).join('. ') + '.';
    }

    setText('radar-caption', 'Each corner is one area, pulled in the longer it has been since anything in it reached you. ' +
      r.ranked[0].short + ' is furthest in.');
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

      /* the description earns its words only where the reader is being
         asked to do something about that area */
      var desc = null;
      if (a.callout) {
        desc = document.createElement('p');
        desc.className = 'area-desc';
        desc.textContent = a.desc;
      }

      /* the honest summary of an area is its recency, stated plainly.
         No label vocabulary sits on top of it. The answer line above
         gives the freshest item; this names the rest of the area. */
      var fact = document.createElement('p');
      fact.className = 'area-fact';
      fact.textContent = a.recencyFact;

      wrap.appendChild(head);
      if (desc) wrap.appendChild(desc);
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
    setText('areas-summary', r.summary || '');
    el['areas-summary'].hidden = !r.summary;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
