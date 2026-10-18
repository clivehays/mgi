/* =============================================================
   LinkedIn Insight Tag.

   The standard loader, injected only after the visitor accepts
   cookies. There is no noscript pixel: that image would fire with
   no chance to refuse.

   A conversion fires only when its id is set in tracking-config.js
   and consent is already "accepted". An empty id sends nothing.
   An empty partner id loads nothing.
   ============================================================= */

(function () {
  'use strict';

  var loaded = false;

  function config() {
    return window.MGI_TRACKING || {};
  }

  function partnerId() {
    var id = config().partnerId;
    if (id == null) return '';
    return String(id).trim();
  }

  function conversionId(name) {
    var map = config().conversions || {};
    var id = map[name];
    if (id == null) return null;
    var s = String(id).trim();
    if (!s) return null;
    return /^\d+$/.test(s) ? Number(s) : s;
  }

  function consented() {
    return !!(window.MGIConsent && window.MGIConsent.get() === 'accepted');
  }

  /* Same flag as the funnel. An internal browser loads no tag and
     fires no conversion, including the one /booked sends on its own. */
  function internalVisitor() {
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

  /* The snippet Campaign Manager gives you, held until consent. */
  function load() {
    var id = partnerId();
    if (!id || !consented() || loaded || internalVisitor()) return;
    loaded = true;

    window._linkedin_partner_id = id;
    window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
    window._linkedin_data_partner_ids.push(window._linkedin_partner_id);

    (function (l) {
      if (!l) {
        window.lintrk = function (a, b) { window.lintrk.q.push([a, b]); };
        window.lintrk.q = [];
      }
      var s = document.getElementsByTagName('script')[0];
      var b = document.createElement('script');
      b.type = 'text/javascript';
      b.async = true;
      b.src = 'https://snap.licdn.com/li.lms-analytics/insight.min.js';
      s.parentNode.insertBefore(b, s);
    })(window.lintrk);
  }

  /* Returns true only when a call was actually queued. */
  function track(name) {
    if (internalVisitor()) return false;
    var id = conversionId(name);
    if (id == null || !consented()) return false;
    load();
    if (typeof window.lintrk !== 'function') return false;
    window.lintrk('track', { conversion_id: id });
    return true;
  }

  /* /booked sets data-conversion. A refresh in the same tab must not
     count the call twice, and a miss (no id yet, or no consent yet)
     must not be remembered as if it had fired. */
  function firePageConversion() {
    var name = document.body && document.body.getAttribute('data-conversion');
    if (!name) return;
    var key = 'mgi-li-page-' + name;
    try {
      if (sessionStorage.getItem(key)) return;
    } catch (e) { /* still try once; a blocked store just cannot dedupe */ }
    if (!track(name)) return;
    try { sessionStorage.setItem(key, '1'); } catch (e) {}
  }

  window.MGILinkedIn = { load: load, track: track };

  if (window.MGIConsent && window.MGIConsent.onChange) {
    window.MGIConsent.onChange(function (choice) {
      if (choice !== 'accepted') return;
      load();
      firePageConversion();
    });
  }

  function boot() {
    if (consented()) load();
    firePageConversion();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
