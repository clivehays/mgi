/* =============================================================
   Internal visitor opt-out.

   ?internal=1 marks this browser so the owner's own visits are
   not counted. ?internal=0 clears it. The mark is localStorage
   plus a 400-day first-party cookie, so it survives a storage
   wipe and a new tab. Nothing here is sent anywhere.

   The note is the only thing a person sees. Funnel posts and
   LinkedIn conversions look at the same flag and stay quiet.
   ============================================================= */

(function () {
  'use strict';

  var KEY = 'mgi-internal';
  var MAX_AGE = 400 * 24 * 60 * 60;
  var NOTE = "Internal mode on: your visits aren't counted";

  function readStorage() {
    try { return localStorage.getItem(KEY) === '1'; }
    catch (e) { return false; }
  }

  function writeStorage(on) {
    try {
      if (on) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch (e) { /* the cookie still carries it */ }
  }

  function readCookie() {
    try {
      var parts = document.cookie ? document.cookie.split('; ') : [];
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].indexOf(KEY + '=') === 0) return parts[i].slice(KEY.length + 1);
      }
    } catch (e) {}
    return '';
  }

  function writeCookie(on) {
    var secure = '';
    try {
      if (window.location.protocol === 'https:') secure = '; Secure';
    } catch (e) {}
    var base = '; Path=/; SameSite=Lax' + secure;
    try {
      document.cookie = on
        ? (KEY + '=1; Max-Age=' + MAX_AGE + base)
        : (KEY + '=; Max-Age=0' + base);
    } catch (e) {}
  }

  function isOn() {
    return readStorage() || readCookie() === '1';
  }

  /* Drop the param once it has been applied, and leave every other
     parameter where it is. A copied link must not opt someone else
     out, and s= / utm_* still have to be there for source capture. */
  function applyQuery() {
    var params;
    try { params = new URLSearchParams(window.location.search); }
    catch (e) { return; }
    if (!params.has('internal')) return;
    var v = params.get('internal');
    if (v === '1') {
      writeStorage(true);
      writeCookie(true);
    } else if (v === '0') {
      writeStorage(false);
      writeCookie(false);
    }
    params.delete('internal');
    var next = params.toString();
    var hash = window.location.hash || '';
    var path = window.location.pathname + (next ? '?' + next : '') + hash;
    try { window.history.replaceState(window.history.state, '', path); }
    catch (e) {}
  }

  var CSS = [
    '.internal-note{margin:0;padding:6px 16px;text-align:center;',
    'font-family:"JetBrains Mono",ui-monospace,monospace;',
    'font-size:11px;letter-spacing:0.04em;line-height:1.4;',
    'color:#6F6A60;background:#E8E2D6}',
    '@media print{.internal-note{display:none !important}}'
  ].join('');

  function showNote() {
    if (!isOn()) return;
    if (document.getElementById('internal-note')) return;
    if (!document.getElementById('internal-note-css')) {
      var style = document.createElement('style');
      style.id = 'internal-note-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    var note = document.createElement('p');
    note.id = 'internal-note';
    note.className = 'internal-note';
    note.setAttribute('role', 'status');
    note.textContent = NOTE;
    document.body.insertBefore(note, document.body.firstChild);
  }

  applyQuery();
  window.MGIInternal = { on: isOn };

  function boot() { showNote(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
