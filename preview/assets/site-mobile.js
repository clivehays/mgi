/* =============================================================
   Clover ERA — shared mobile chrome behaviour
   Toggles the hamburger drawer with a11y bookkeeping.
   Works with two masthead variants (.masthead + nav.primary
   and .topnav + nav).
   ============================================================= */
(function () {
  'use strict';

  function init() {
    var btn = document.querySelector('.hamburger');
    if (!btn) return;

    var navId = btn.getAttribute('aria-controls');
    var nav = navId ? document.getElementById(navId) : null;
    if (!nav) {
      nav = document.querySelector('.masthead nav.primary, .topnav nav');
    }
    if (!nav) return;

    // Backdrop, lazily appended once.
    var backdrop = document.querySelector('.nav-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'nav-backdrop';
      backdrop.setAttribute('aria-hidden', 'true');
      document.body.appendChild(backdrop);
    }

    function setOpen(open) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      nav.classList.toggle('open', open);
      backdrop.classList.toggle('open', open);
      document.body.classList.toggle('nav-locked', open);
    }

    btn.addEventListener('click', function () {
      var isOpen = btn.getAttribute('aria-expanded') === 'true';
      setOpen(!isOpen);
    });

    backdrop.addEventListener('click', function () { setOpen(false); });

    // Close when a nav link is activated
    var links = nav.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function () { setOpen(false); });
    }

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        btn.focus();
      }
    });

    // Close if viewport returns to desktop
    var mq = window.matchMedia('(min-width: 721px)');
    function onMq(e) { if (e.matches) setOpen(false); }
    if (mq.addEventListener) mq.addEventListener('change', onMq);
    else if (mq.addListener) mq.addListener(onMq);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
