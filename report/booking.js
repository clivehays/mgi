/* =============================================================
   booking.js  ·  the one forward step

   Thirty minutes with Clive. It is the page's only ask and the only
   thing Eran offers, and both use this so there is one link and no
   chance of a second one appearing.

   The token rides along so Clive knows which reading a booking came
   from before he opens the call.
   ============================================================= */

var DEFAULT = 'https://calendly.com/clive-hays-cloverera/30-mins-with-clive-clover-era';

/* A configured address arrives by being pasted, and pasting picks things
   up. A zero width character in front of the scheme is invisible in the
   dashboard and fatal in an href: the browser stops reading it as an
   absolute address and resolves it against the reading, so the one ask on
   the page points at managergap.com/r/ plus the whole booking address and
   the manager lands on nothing. Clean it here, once, because everything
   that shows this link comes through here. */
function clean(value) {
  var v = String(value || '').replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, '').trim();
  return /^https?:\/\//.test(v) ? v : '';
}

var URL = clean(process.env.CALENDLY_URL) || DEFAULT;

function link(token) {
  if (!token) return URL;
  var joiner = URL.indexOf('?') === -1 ? '?' : '&';
  return URL + joiner + 'utm_source=mgi&utm_content=' + encodeURIComponent(token);
}

module.exports = { link: link, URL: URL, clean: clean };
