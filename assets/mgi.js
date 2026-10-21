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
    lastSent: -1,
    sentContact: false,
    started: false,
    sentStart: false
  };

  /* Sends go out one at a time, so the Start event cannot land after
     the question 1 event and roll the row back. */
  var funnelQueue = Promise.resolve();
  var beaconCount = 0;

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

  /* Campaign labels from the landing URL: utm_*, s= and li_fat_id. Kept
     in sessionStorage for the visit, with the time they were first seen.
     s and utm_* are sent with both posts. li_fat_id stays in the tab so
     a later acceptance can include it, and is sent only once the cookie
     banner has been accepted. The server writes them only when
     SAVE_SOURCE=1, and stores li_fat_id only when that post says so.

     Only after the visitor accepts cookies (the same choice that loads
     the LinkedIn tag) is the first-touch copy also kept in localStorage,
     for 30 days, and brought back on a later visit that arrives with no
     labels. Without that consent nothing outlives the tab, and a
     withdrawal deletes the stored copy. */
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
    return !!(window.MGIConsent && window.MGIConsent.get && window.MGIConsent.get() === 'accepted');
  }

  function readFirstTouch() {
    try {
      var raw = localStorage.getItem(FIRST_TOUCH_KEY);
      if (!raw) return null;
      var v = JSON.parse(raw);
      if (!v || typeof v !== 'object' || !v.source || !(Number(v.expires) > Date.now())) {
        localStorage.removeItem(FIRST_TOUCH_KEY);
        return null;
      }
      return v.source;
    } catch (e) { return null; }
  }

  function clearFirstTouch() {
    try { localStorage.removeItem(FIRST_TOUCH_KEY); } catch (e) {}
  }

  /* First touch wins: an unexpired copy is never overwritten. */
  function persistFirstTouch() {
    if (!consentAccepted()) return;
    if (readFirstTouch()) return;
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

  /* A return visit with no labels of its own, and none yet this tab. */
  function restoreFirstTouch() {
    if (!consentAccepted()) return;
    var current = readSource();
    if (hasAttr(current)) return;
    var stored = readFirstTouch();
    if (!stored || !hasAttr(stored)) return;
    var out = {};
    Object.keys(stored).forEach(function (k) {
      if ((isAttrKey(k) || k === 'first_seen') && typeof stored[k] === 'string') out[k] = stored[k];
    });
    out.restored = '1';
    try { sessionStorage.setItem(SOURCE_KEY, JSON.stringify(out)); } catch (e) {}
  }

  function sourceInit() {
    readSource();
    if (window.MGIConsent && window.MGIConsent.get && window.MGIConsent.get() === 'rejected') clearFirstTouch();
    restoreFirstTouch();
    persistFirstTouch();
    if (window.MGIConsent && window.MGIConsent.onChange) {
      window.MGIConsent.onChange(function (choice) {
        if (choice === 'accepted') persistFirstTouch();
        else clearFirstTouch();
      });
    }
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
        if (!isAttrKey(key)) return;
        if (!value) return;
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

  /* What actually leaves the browser. The session copy can already hold
     li_fat_id; this drops it until the banner is accepted, then includes
     it from the next post on. s and utm_* go either way. */
  function sourceForPost() {
    var src = readSource();
    if (consentAccepted() || !src.li_fat_id) return src;
    var out = {};
    Object.keys(src).forEach(function (k) {
      if (k !== 'li_fat_id') out[k] = src[k];
    });
    return out;
  }

  /* The owner's own browser. Set by assets/internal.js from
     ?internal=1, remembered in localStorage and a first-party
     cookie. Read here as well, so a missing script cannot fail
     open and start counting him again. */
  function isInternalVisitor() {
    try {
      if (window.MGIInternal && typeof window.MGIInternal.on === 'function' && window.MGIInternal.on()) {
        return true;
      }
    } catch (e) {}
    try {
      if (localStorage.getItem('mgi-internal') === '1') return true;
    } catch (e) {}
    try {
      return /(?:^|;\s*)mgi-internal=1(?:;|$)/.test(document.cookie || '');
    } catch (e) {
      return false;
    }
  }

  function funnelSend(useBeacon) {
    /* no visit id, no beacon, no fetch. The assessment itself is unchanged. */
    if (isInternalVisitor()) return;
    if (!funnel.sid) return;
    /* nothing new to report, and the leave-beacon is always worth sending.
       Reaching the contact step is news even though furthest stays at 20:
       that question was already posted when it opened. */
    var contactNews = funnel.reachedContact && !funnel.sentContact;
    var startNews = funnel.started && !funnel.sentStart;
    if (!useBeacon && funnel.furthest <= funnel.lastSent && !funnel.submitted && !contactNews && !startNews) return;
    funnel.lastSent = funnel.furthest;
    funnel.sentContact = funnel.reachedContact;

    if (funnel.started) funnel.sentStart = true;
    funnelSave();

    var payload = JSON.stringify({
      sid: funnel.sid,
      furthest: funnel.furthest,
      reachedContact: funnel.reachedContact,
      submitted: funnel.submitted,
      step: funnelStep(),
      device: device(),
      client: clientSignals(),
      source: sourceForPost(),
      cookieConsent: consentAccepted()
    });

    try {
      if (useBeacon && navigator.sendBeacon) {
        beaconCount++;
        navigator.sendBeacon('/api/funnel', new Blob([payload], { type: 'application/json' }));
        return;
      }
      /* one at a time and in order, so the Start write cannot land after
         the question 1 write. A send still waiting when a leave-beacon
         goes out is dropped: the beacon already carries newer state. */
      var beaconsAtQueue = beaconCount;
      funnelQueue = funnelQueue.then(function () {
        if (beaconCount !== beaconsAtQueue) return;
        return fetch('/api/funnel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(function () {});
      });
    } catch (e) { /* telemetry never interrupts the assessment */ }
  }

  /* The furthest milestone as a word, for the report. */
  function funnelStep() {
    if (funnel.submitted) return 'submitted';
    if (funnel.reachedContact) return 'contact';
    var f = funnel.furthest;
    if (f >= 20) return 'q20';
    if (f >= 15) return 'q15';
    if (f >= 10) return 'q10';
    if (f >= 5) return 'q5';
    if (f >= 1) return 'q1';
    return funnel.started ? 'start' : 'landing';
  }

  /* Sizes only, so the server can flag a window larger than its own
     screen. The server keeps the flag, not the numbers. */
  function clientSignals() {
    var scr = window.screen || {};
    return {
      wd: navigator.webdriver === true,
      sw: scr.width || 0,
      sh: scr.height || 0,
      vw: window.innerWidth || 0,
      vh: window.innerHeight || 0
    };
  }

  /* Pressing Start is its own event, written before question 1 shows. */
  function funnelStart() {
    funnel.started = true;
    if (!funnel.sentStart) funnelSend(false);
  }

  function funnelMark(n) {
    if (n > funnel.furthest) funnel.furthest = n;
    /* question 1, then every fifth question, so a lost leave-beacon still
       leaves a usable trace of roughly how far someone got */
    if (funnel.furthest === 1 || funnel.furthest % 5 === 0) funnelSend(false);
  }

  /* The visit id outlives a reload, so its progress must too, or the
     reloaded page's leave-beacon would step the row back to landing. */
  var FUNNEL_KEY = 'mgi-visit-progress';

  function funnelSave() {
    try {
      sessionStorage.setItem(FUNNEL_KEY, JSON.stringify({
        furthest: funnel.furthest,
        reachedContact: funnel.reachedContact,
        submitted: funnel.submitted,
        started: funnel.started
      }));
    } catch (e) {}
  }

  function funnelRestore() {
    try {
      var v = JSON.parse(sessionStorage.getItem(FUNNEL_KEY) || 'null');
      if (!v || typeof v !== 'object') return;
      var f = Number(v.furthest);
      if (isFinite(f) && f > funnel.furthest) funnel.furthest = Math.min(Math.floor(f), TOTAL);
      if (v.reachedContact === true) funnel.reachedContact = true;
      if (v.submitted === true) funnel.submitted = true;
      if (v.started === true) funnel.started = funnel.sentStart = true;
      funnel.lastSent = funnel.furthest;
      funnel.sentContact = funnel.reachedContact;
    } catch (e) {}
  }

  function funnelInit() {
    funnel.sid = funnelId();
    if (!funnel.sid) return;
    funnelRestore();
    window.addEventListener('pagehide', function () { funnelSend(true); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') funnelSend(true);
    });
  }

  /* ---------- boot ---------- */

  function init() {
    [
      'view-landing', 'view-questions', 'view-contact', 'view-sent',
      'btn-start', 'btn-start-2', 'btn-back', 'btn-next', 'btn-submit',
      'q-count', 'q-bar-fill', 'q-number', 'q-text', 'q-scale',
      'contact-form', 'form-error', 'f-industry', 'field-industry-other', 'f-industry-other',
      'f-consent', 'sent-email', 'sent-note', 'teaser', 'teaser-rings',
      'sent-by-email', 'f-email', 'field-freemail', 'f-company', 'f-linkedin'
    ].forEach(function (id) {
      el[id] = document.getElementById(id);
    });

    sourceInit();
    restore();
    funnelInit();

    /* claim the entry we land on, so the in-page Back button can pop
       history without ever stepping off the site */
    history.replaceState({ view: state.view === 'sent' ? 'sent' : 'landing', index: 0 }, '');

    el['btn-start'].addEventListener('click', function () { funnelStart(); go(0); });
    if (el['btn-start-2']) {
      el['btn-start-2'].addEventListener('click', function () { funnelStart(); go(0); });
    }
    el['btn-back'].addEventListener('click', back);
    el['btn-next'].addEventListener('click', next);
    el['contact-form'].addEventListener('submit', onSubmit);
    el['f-industry'].addEventListener('change', onIndustryChange);
    el['f-consent'].addEventListener('change', onConsentChange);
    el['f-email'].addEventListener('input', onEmailChange);
    el['f-email'].addEventListener('change', onEmailChange);

    document.addEventListener('keydown', onKeydown);
    window.addEventListener('popstate', onPopState);

    if (state.view === 'sent' && state.contact && complete()) {
      showDestination(state.contact.email);
      show('sent', false);
    } else {
      show('landing', false);
    }
  }

  /* ---------- the confirmation ----------
     The email is the destination. No link is handed over before the
     reading is written; the email's arrival is the signal it is ready.
     (The private link for readings without an address was removed with
     the assessment form change of 21 Oct 2026: an address is required.) */
  function showDestination(email) {
    if (el['sent-by-email']) el['sent-by-email'].hidden = !email;
    if (email) el['sent-email'].textContent = email;
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

  /* The finish bar is fixed above the cookie banner, so on a short
     phone it can sit on top of the two fields. Nudge the page until
     team size is just above that bar. The tick and the button stay put. */
  function revealFieldsAboveFinish() {
    var bar = document.querySelector('.contact-finish');
    var team = document.getElementById('f-team');
    if (!bar || !team) return;
    var gap = 12;
    var overlap = team.getBoundingClientRect().bottom - (bar.getBoundingClientRect().top - gap);
    if (overlap > 0) window.scrollBy(0, overlap);
  }

  function show(view, push) {
    state.view = view;
    ['landing', 'questions', 'contact', 'sent'].forEach(function (v) {
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

  /* A click already moved the pointer onto an answer. Focusing the
     first radio on the next question drew the focus ring on an
     answer that was not chosen, which read as preselected, and the
     only click that cleared it also advanced. Pointer entry leaves
     focus alone. Keyboard entry focuses the question, or the stored
     answer when there is one. */
  function focusScale() {
    if (lastInputWasPointer) return;
    var checked = el['q-scale'].querySelector('input:checked');
    if (checked) {
      checked.focus({ preventScroll: true });
      return;
    }
    if (el['q-text']) el['q-text'].focus({ preventScroll: true });
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
      revealFieldsAboveFinish();
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

  function chooseInput(target) {
    if (!target) return;
    if (!target.checked) {
      target.checked = true;
      target.dispatchEvent(new Event('change'));
    }
    target.focus({ preventScroll: true });
  }

  function onKeydown(e) {
    if (state.view !== 'questions') return;
    if (e.key === 'Enter') {
      e.preventDefault();
      next();
      return;
    }
    var inputs = el['q-scale'].querySelectorAll('input');
    if (['1', '2', '3', '4'].indexOf(e.key) !== -1) {
      var numbered = inputs[Number(e.key) - 1];
      if (numbered) {
        e.preventDefault();
        chooseInput(numbered);
      }
      return;
    }
    /* Arrow keys used to rely on a radio being focused. Questions no
       longer open with one focused, so the keys are handled here.
       They select, and they do not advance. */
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var dir = 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') dir = 1;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') dir = -1;
    if (!dir || !inputs.length) return;
    e.preventDefault();
    var current = -1;
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].checked) current = i;
    }
    var nextIndex = current === -1
      ? (dir > 0 ? 0 : inputs.length - 1)
      : (current + dir + inputs.length) % inputs.length;
    chooseInput(inputs[nextIndex]);
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

  /* A personal address (Gmail, iCloud and the like) brings up Company,
     required, and a LinkedIn link, optional. A work address brings up
     nothing: its domain stands in for the company. The address is never
     refused for being personal. */
  function freeEmail() {
    var v = el['f-email'].value.trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && !!(window.MGIFreemail && window.MGIFreemail.isFree(v));
  }

  function onEmailChange() {
    var free = freeEmail();
    el['field-freemail'].hidden = !free;
    el['f-company'].required = free;
    if (!free) {
      el['f-company'].value = '';
      el['f-linkedin'].value = '';
    }
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
      linkedin: form.linkedin.value.trim(),
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
    var free = freeEmail();
    if (!contact.email) missing.push('your work email');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) missing.push('a valid email address');
    else if (free && !contact.company) missing.push('the company you work for');
    if (free && contact.linkedin && !window.MGIFreemail.isLinkedIn(contact.linkedin)) missing.push('a LinkedIn profile link, or leave it blank');
    if (!free) { contact.company = ''; contact.linkedin = ''; }
    if (!contact.firstName) missing.push('first name');
    if (!contact.teamSize) missing.push('team size');
    if (!contact.consent) missing.push('your consent to take part');
    /* The research step stays optional. Other is the only research answer
       that becomes required, and only once they have chosen it. */
    if (contact.industry === 'Other' && !contact.industryOther) missing.push('which industry');

    if (missing.length) {
      el['form-error'].textContent = 'Please add ' + listify(missing) + '.';
      el['form-error'].hidden = false;
      return;
    }
    el['form-error'].hidden = true;

    state.contact = contact;
    save();

    show('sent');
    send(contact);
  }

  function listify(items) {
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  function send(contact) {
    funnel.submitted = true;
    funnelSend(false);
    showDestination(contact.email);

    var answers = toAnswers();
    var payload = {
      firstName: contact.firstName,
      email: contact.email,
      company: contact.company,
      linkedin: contact.linkedin,
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
      submittedAt: new Date().toISOString(),
      source: sourceForPost(),
      cookieConsent: consentAccepted(),
      sid: funnel.sid
    };
    /* The page still submits. The server drops the row, and the
       emails, unless the table already has a column for the flag. */
    if (isInternalVisitor()) payload.internal = true;

    fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error('bad status');
      return res.json();
    }).then(function (data) {
      /* The tag queues the conversion only when its id is set and
         cookies have been accepted. An empty id, or a refusal, does
         nothing, and a missing script never blocks the reading. */
      if (!isInternalVisitor() && window.MGILinkedIn) window.MGILinkedIn.track('assessmentCompleted');
      /* The email is the destination. It is sent once the reading has
         been written, so its arrival is the signal that the page is
         ready, and there is no link to hand over before then.

         A failed notification is ours to chase and says nothing to
         them. Only their own copy decides this message. */
      if (data && data.teaser) drawTeaser(data.teaser);
      /* An internal run is a success even when nothing was stored
         and nothing was sent. A normal visitor still hears about a
         reading that could not be sent. */
      if (!isInternalVisitor() && data && data.sending === false) throw new Error('nothing to send');
    }).catch(function () {
      el['sent-note'].textContent = 'Something went wrong at our end. Your answers are safe. Write to contact@cloverera.com and we will send your reading over.';
      el['sent-note'].hidden = false;
    });
  }

  /* ---------- the teaser ----------
     The five rings while they wait, and nothing that would answer the
     question the email is there to answer. The stylesheet comes from
     rings.js too, so these are the same circles the reading draws.

     The whole thing is optional. An older cached mgi.js, a submit that
     could not compute, or a browser that never got rings.js all end up
     with the page exactly as it was before. */
  var ringCssDone = false;

  function drawTeaser(teaser) {
    var box = el['teaser'];
    var row = el['teaser-rings'];
    if (!box || !row || !teaser || !teaser.areas || !window.MGIRings) return;

    if (!ringCssDone) {
      var style = document.createElement('style');
      style.textContent = window.MGIRings.CSS;
      document.head.appendChild(style);
      ringCssDone = true;
    }

    row.innerHTML = teaser.areas.map(function (a, i) {
      return '<div class="ring">' + window.MGIRings.svg(a.items, i) +
        '<span class="ring-name">' + escapeText(a.plain) + '</span>' +
        '<span class="ring-count">' + a.fresh + '/3</span></div>';
    }).join('');
    box.hidden = false;
  }

  function escapeText(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
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


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
