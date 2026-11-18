/* LinkedIn Insight Tag.

   partnerId is public. It ships in the page.
   assessmentCompleted fires from a successful submit.
   callBooked fires on /booked.
   selfCheckCompleted fires when /self-check shows the state after
   the eighth question. selfCheckEmailSubmitted fires when the
   address on that page is accepted.
   Each waits until the visitor has accepted cookies. A blank id
   would send nothing. The tag itself still loads only after consent. */
window.MGI_TRACKING = {
  partnerId: '9887058',
  conversions: {
    assessmentCompleted: 31367050,
    callBooked: 31367058,
    selfCheckCompleted: 32413530,
    selfCheckEmailSubmitted: 32413538
  }
};
