/* =============================================================
   booking.js  ·  the one forward step

   Thirty minutes with Clive. It is the page's only ask and the only
   thing Eran offers, and both use this so there is one link and no
   chance of a second one appearing.

   The token rides along so Clive knows which reading a booking came
   from before he opens the call.
   ============================================================= */

var URL = process.env.CALENDLY_URL ||
  'https://calendly.com/clive-hays-cloverera/30-mins-with-clive-clover-era';

function link(token) {
  if (!token) return URL;
  var joiner = URL.indexOf('?') === -1 ? '?' : '&';
  return URL + joiner + 'utm_source=mgi&utm_content=' + encodeURIComponent(token);
}

module.exports = { link: link, URL: URL };
