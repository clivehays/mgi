/* =============================================================
   Cookie consent.

   UK GDPR and PECR: nothing non-essential loads before a choice,
   Reject is the same kind of control as Accept, the choice is
   stored, and it can be changed later from Cookie settings.

   The choice itself is strictly necessary, so it is kept in
   localStorage rather than behind a second banner. LinkedIn is
   loaded by assets/linkedin.js, and only after "accepted".
   ============================================================= */

(function () {
  'use strict';

  var KEY = 'mgi-cookie-consent';
  var memory = null;
  var listeners = [];

  function readStored() {
    try {
      var v = localStorage.getItem(KEY);
      if (v === 'accepted' || v === 'rejected') return v;
    } catch (e) { /* storage blocked: the banner stays up */ }
    return null;
  }

  function get() {
    return memory || readStored();
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function notify(choice, prev) {
    listeners.forEach(function (fn) {
      try { fn(choice, prev); } catch (e) { /* a listener cannot block the choice */ }
    });
  }

  /* First-party names the Insight Tag sets on this host. Cookies it
     sets on linkedin.com cannot be cleared from here. Reloading after
     a withdrawal is what stops the tag. */
  function clearLinkedInCookies() {
    ['li_sugr', 'UserMatchHistory', 'AnalyticsSyncHistory', 'bcookie', 'bscookie',
      'lidc', 'li_gc', 'lms_ads', 'lms_analytics', '_guid', 'li_fat_id'
    ].forEach(function (name) {
      document.cookie = name + '=; Max-Age=0; path=/';
    });
  }

  function setChoice(choice) {
    var prev = get();
    memory = choice;
    try { localStorage.setItem(KEY, choice); } catch (e) { /* this page still honours it */ }
    if (prev !== choice) notify(choice, prev);
    if (prev === 'accepted' && choice === 'rejected') {
      clearLinkedInCookies();
      window.location.reload();
      return;
    }
    render(false);
  }

  function open() {
    render(true);
  }

  window.MGIConsent = { get: get, onChange: onChange, open: open };

  var CSS = [
    '.cookie-banner{position:fixed;z-index:30;left:0;right:0;bottom:0;',
    'background:var(--paper,#F1ECE3);color:var(--ink,#17161A);',
    'border-top:1px solid var(--rule,#C9C2B4);',
    'font-family:"Inter Tight",system-ui,-apple-system,sans-serif}',
    '.cookie-banner[hidden]{display:none !important}',
    '.cookie-banner-inner{max-width:720px;margin:0 auto;padding:10px 24px;',
    'display:flex;gap:16px;align-items:center;justify-content:space-between}',
    '.cookie-copy{margin:0;font-size:13px;line-height:1.4;color:var(--ink-mute,#6F6A60)}',
    '.cookie-actions{display:flex;gap:8px;flex:0 0 auto}',
    '.cookie-choice{font-family:inherit;font-weight:600;font-size:13px;line-height:1;',
    'background:var(--accent,var(--navy,#1A3565));color:#fff;',
    'border:1px solid var(--accent,var(--navy,#1A3565));',
    'padding:10px 14px;cursor:pointer}',
    '.cookie-choice:hover{background:var(--accent-lift,#225A8D);border-color:var(--accent-lift,#225A8D)}',
    /* No thanks is outlined so it does not read as the Start button.
       Same size and weight as That's fine, so the choice stays equal. */
    '#cookie-reject{background:transparent;color:var(--accent,var(--navy,#1A3565))}',
    '#cookie-reject:hover{background:var(--accent,var(--navy,#1A3565));color:#fff}',
    '.cookie-settings{font-family:"JetBrains Mono",ui-monospace,monospace;',
    'font-size:10px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;',
    'background:none;border:0;border-bottom:1px solid var(--rule,#C9C2B4);',
    'color:var(--ink-mute,#6F6A60);padding:0;cursor:pointer}',
    '.cookie-settings:hover{color:var(--ink,#17161A);border-bottom-color:var(--ink,#17161A)}',
    '@media (max-width:560px){',
    '.cookie-banner-inner{padding:9px 14px;gap:10px}',
    '.cookie-copy{font-size:12px;line-height:1.35}',
    '.cookie-actions{flex:0 0 auto}',
    '.cookie-choice{padding:10px 11px;font-size:12.5px;white-space:nowrap}',
    '}',
    '@media print{.cookie-banner{display:none !important}body{padding-bottom:0 !important}}'
  ].join('');

  function injectStyle() {
    if (document.getElementById('cookie-consent-css')) return;
    var style = document.createElement('style');
    style.id = 'cookie-consent-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function banner() {
    var el = document.getElementById('cookie-banner');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'cookie-banner';
    el.className = 'cookie-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'cookie-title');
    el.hidden = true;
    el.innerHTML =
      '<div class="cookie-banner-inner">' +
        '<p class="cookie-copy" id="cookie-title">We use cookies to see which LinkedIn posts bring people here, so I can share more of what helps. Nothing about your answers is shared.</p>' +
        '<div class="cookie-actions">' +
          '<button type="button" class="cookie-choice" id="cookie-accept">That\'s fine</button>' +
          '<button type="button" class="cookie-choice" id="cookie-reject">No thanks</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    document.getElementById('cookie-accept').addEventListener('click', function () {
      setChoice('accepted');
    });
    document.getElementById('cookie-reject').addEventListener('click', function () {
      setChoice('rejected');
    });
    return el;
  }

  function bindSettings() {
    var buttons = document.querySelectorAll('[data-cookie-settings]');
    if (!buttons.length) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cookie-settings';
      btn.setAttribute('data-cookie-settings', '');
      btn.textContent = 'Cookie settings';
      var footer = document.querySelector('footer');
      if (footer) footer.appendChild(btn);
      else document.body.appendChild(btn);
      buttons = [btn];
    }
    Array.prototype.forEach.call(buttons, function (btn) {
      if (btn.getAttribute('data-bound')) return;
      btn.setAttribute('data-bound', '1');
      btn.addEventListener('click', function () { open(); });
    });
  }

  function fit(el) {
    var open = !!(el && !el.hidden);
    document.body.classList.toggle('has-cookie-banner', open);
    if (!open) {
      document.body.style.paddingBottom = '';
      document.documentElement.style.removeProperty('--banner-h');
      return;
    }
    var h = el.offsetHeight;
    document.body.style.paddingBottom = (h + 8) + 'px';
    document.documentElement.style.setProperty('--banner-h', h + 'px');
  }

  function render(forceOpen) {
    var el = banner();
    var choice = get();
    el.hidden = !forceOpen && !!choice;
    fit(el);
  }

  function boot() {
    memory = readStored();
    injectStyle();
    bindSettings();
    render(false);
    window.addEventListener('resize', function () { fit(document.getElementById('cookie-banner')); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
