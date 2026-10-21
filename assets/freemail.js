/* =============================================================
   Free email providers

   Loaded by the browser as a global (MGIFreemail) and required by
   api/submit.js, so the form and the server agree on which address
   asks for a company. A personal address is allowed, never blocked:
   it only brings up Company (required) and LinkedIn (optional).
   A work address brings up nothing, and its domain stands in for
   the company.

   Assessment form change, 21 Oct 2026.
   ============================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MGIFreemail = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* exact domains */
  var EXACT = [
    'gmail.com', 'googlemail.com',
    'icloud.com', 'me.com', 'mac.com',
    'outlook.com', 'msn.com', 'passport.com',
    'aol.com', 'aim.com',
    'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me',
    'ymail.com', 'rocketmail.com',
    'mail.com', 'email.com', 'usa.com',
    'zoho.com', 'zohomail.com', 'yandex.com', 'yandex.ru', 'mail.ru',
    'fastmail.com', 'fastmail.fm', 'hey.com',
    'tutanota.com', 'tutanota.de', 'tuta.io', 'tuta.com',
    'web.de', 't-online.de', 'freenet.de', 'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net', 'libero.it',
    'btinternet.com', 'btopenworld.com', 'sky.com', 'virginmedia.com', 'blueyonder.co.uk',
    'talktalk.net', 'tiscali.co.uk', 'ntlworld.com', 'plus.com',
    'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net',
    'qq.com', '163.com', '126.com', 'naver.com', 'rediffmail.com'
  ];

  /* provider names that are free under any country suffix:
     hotmail.co.uk, live.fr, yahoo.co.uk, gmx.de, outlook.de and so on */
  var ANY_SUFFIX = ['hotmail', 'live', 'yahoo', 'gmx', 'outlook', 'windowslive'];

  function domainOf(email) {
    if (typeof email !== 'string') return '';
    var at = email.lastIndexOf('@');
    if (at < 0) return '';
    return email.slice(at + 1).trim().toLowerCase().replace(/\.+$/, '');
  }

  function isFree(email) {
    var d = domainOf(email);
    if (!d || d.indexOf('.') < 0) return false;
    if (EXACT.indexOf(d) !== -1) return true;
    var first = d.split('.')[0];
    return ANY_SUFFIX.indexOf(first) !== -1;
  }

  /* A LinkedIn profile link, loosely: anything on linkedin.com.
     Blank is fine; the field is optional. */
  function isLinkedIn(url) {
    if (typeof url !== 'string' || !url.trim()) return false;
    return /^(https?:\/\/)?([a-z0-9-]+\.)*linkedin\.com\/\S+$/i.test(url.trim());
  }

  function normaliseLinkedIn(url) {
    var u = String(url || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u;
  }

  return {
    domainOf: domainOf,
    isFree: isFree,
    isLinkedIn: isLinkedIn,
    normaliseLinkedIn: normaliseLinkedIn
  };
}));
