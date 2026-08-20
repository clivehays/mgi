# Manager Gap Index (MGI) v5

A single-purpose diagnostic at **mgi.cloverera.com**. Seventeen questions, about four
minutes, then a report on screen naming the state the team is most likely in, with a
confidence level. Clive gets an email with the raw answers the moment a submission lands.

## What it does

Teams move through four states: **Cruise** (stable and healthy), **Drift** (output still
fine, but the behaviours that produce it are slipping), **Headwinds** (output falling
while the team is healthy; the cause is external) and **Stall** (the decline has reached
the output).

The instrument works out the likely state from things the manager has directly observed:
whether output is holding or slipping, whether an external cause is acting on the team,
and whether the behaviours of a healthy team have been visible recently. Twelve evidence
items capture that last input. The absence of those behaviours is not a scoring trick; it
is what Drift and Stall look like from the manager's seat.

**Three outputs, three distinct sources, deliberately kept apart:**

1. **The state call** comes from the evidence items plus the three trajectory items
   (output, external pressure, energy).
2. **Confidence** comes from one exposure question: how much direct working contact the
   manager has with the team. A behaviour that has not reached a manager who is there
   most days is genuinely not happening. The same absence reported by a manager who sees
   the team less than weekly might be distance, not decline. Exposure never changes the
   state call, only how firmly the report stands behind it.
3. **The signal score** (sum of the twelve evidence items, 0 to 36) is reported as what
   it honestly is: how much recent first-hand evidence the manager's picture rests on. It
   is never called confidence.

Before the questions begin, the manager states their gut read. The distance between that
instinct and the evidence-based state is the **manager gap**, shown back to them in their
own words at the end.

Three rules hold everywhere in the code and copy:

1. **The state call is always "likely", never certain.** Copy says "most likely in" and
   "the evidence points to". Seventeen questions from one perspective earn a strong
   estimate, not a verdict. A lint enforces this.
2. **No product pitch.** Clover ERA appears only in the footer attribution and the
   closing block. No trial, pricing, worksheets, framework names or booking links. The
   sales conversation happens later, by phone, off this page.
3. **No framework vocabulary in the questions**, and no invented label vocabularies on
   the report. There is no Stale/Fading/Current scale. Where a summary is needed, the
   report states the underlying recency fact instead.

## Layout

```
index.html          landing, questions, contact, report (one page, four views)
assets/scoring.js   the instrument: items, state tree, confidence, gap, areas
assets/mgi.js       flow, rendering, submission
assets/mgi.css      Clover ERA Editorial system (System A)
api/submit.js       stores the submission, sends both emails
vercel.json         clean URLs, cache and security headers
```

`assets/scoring.js` is a UMD module: the browser loads it as the global `MGI`, and
`api/submit.js` requires it as CommonJS. The server recomputes the state, confidence and
gap from the raw answers, so the emails can never disagree with the page the manager saw.
Change the instrument in one place only.

## The seventeen questions

| # | Item | Scale |
|---|---|---|
| Q0 | Gut check, unscored | In great shape / Fine, as far as I can tell / Something feels off / Struggling, and I know it |
| Q1 to Q12 | Evidence items | Within the last week (3) / last month (2) / last quarter (1) / Can't recall (0) |
| Q13 | Output over the past month | Improved / Held steady / Slipped slightly / Slipped noticeably |
| Q14 | External pressure | Yes, clearly / Possibly / No |
| Q15 | Energy vs three months ago | Higher / About the same / Lower / Honestly, I couldn't say |
| Q16 | Exposure, drives confidence | Most days / A few times a week / About weekly / Less than weekly |

## Scoring

**Inputs.** B is the mean of evidence items 1, 2, 5, 6, 9, 10, 11, 12 (healthy-team
behaviours) and feeds the state tree. S is the sum of all twelve evidence items, 0 to 36,
and is reported as evidence freshness. X is Q16 and is the sole source of confidence.

**State decision tree**, applied top to bottom, first match wins. The rule number that
fired is recorded in the notification email.

If output is holding (Improved or Held steady):

1. B >= 2.0 and energy is not Lower → **Cruise**
2. otherwise → **Drift**

If output is slipping (Slipped slightly or noticeably):

3. external is "Yes, clearly" and B >= 1.5 and energy is not Lower → **Headwinds**
4. output is "Slipped noticeably" → **Stall**
5. external is "Yes, clearly" or "Possibly" → **Headwinds**
6. otherwise → **Stall**

Holding output with faded behaviours is the definition of Drift. Slipping output with a
clear external cause and an intact team is Headwinds. Slipping output with no external
explanation, or with the behaviours gone too, is Stall.

Exposure never enters this tree.

**Confidence** from Q16 alone: Most days and A few times a week give High, About weekly
gives Moderate, Less than weekly gives Low. At Low, a caution paragraph is appended to
the state block and one sentence is appended to the action.

**Signal score** from S, reported separately and never as confidence: 27 to 36, 15 to 26,
and 0 to 14 each get their own sentence under a shared framing line.

**The close-up variant.** The default copy for a thin score attributes it to distance
("a manager on old signal", "a picture of a previous team"). That misreads the one case
this instrument can be most certain about. A manager who is with the team most days, or a
few times a week, and still cannot recall these behaviours is not reporting a stale
picture. They are reporting absence, at close enough range to be sure of it. So when
confidence is High and the signal score is 26 or below, the band sentence and the summary
block both switch to wording that names that, injecting the manager's own exposure
answer. At 27 and above the original copy stands, because there is no contradiction to
resolve. Moderate and Low exposure keep the distance framing, which is correct for them.

The variant states the fact and stops. It does not tell the manager they have not been
paying attention, per the house rule that the system is the villain and never the person.

**Five signal areas**, two items each. Items 11 and 12 count toward B and S but belong to
no named area.

| Area | Items |
|---|---|
| How equipped the team is | 1, 2 |
| The work itself | 3, 4 |
| How invested people are | 5, 6 |
| Whether everyone knows why | 7, 8 |
| Whether truth travels upward | 9, 10 |

Each area reports a recency fact taken from the **most recent** answer across its two
items: within the last week, within the last month, over a month ago, or nothing you
could recall. No label sits on top of that.

An area is weak if its mean is below 1.0. If three or more areas are weak, the report
shows one summary block and no per-area callouts. Otherwise the two lowest-ranked areas
get differently-worded callouts, and the cohort sentence appears on the lowest only,
exactly once per report. Ranking ties prefer "Whether truth travels upward", then "How
invested people are", then the lowest item number.

**The manager gap.** Gut severity: great shape 0, fine 1, something off 2, struggling 3.
State severity: Cruise 0 or 1, Drift 2, Headwinds 2, Stall 3. Gut below the state's range
is "instinct behind the evidence", above it is "instinct ahead", inside it is "aligned".

**The compass** is inline SVG. The dot sits mid-radius in the computed state's quadrant.
The halo carries the confidence, so it shows how much of the team's week the manager is
positioned to see: none at High, a tight ring at Moderate, a wide translucent halo at Low.

## Environment variables

Set these in the Vercel project. Only `RESEND_API_KEY` is required for email to work.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `RESEND_API_KEY` | yes | none | Resend API key. Without it neither email sends and the client shows a fallback line. |
| `MGI_NOTIFY_EMAIL` | no | `contact@cloverera.com` | Where the notification lands. |
| `MGI_FROM_EMAIL` | no | `The Manager Gap Index <mgi@cloverera.com>` | From address on the manager's report. The domain must be verified in Resend. |
| `MGI_NOTIFY_FROM` | no | `MGI_FROM_EMAIL` | From address on the notification only. Set this to a different verified domain when the notification is addressed to the same mailbox it is sent from, which some filters treat as spoofing. |
| `MGI_REPLY_TO` | no | `MGI_NOTIFY_EMAIL` | Reply-to on the manager's report. Load-bearing: the closing block tells the manager to reply to it. |
| `SUPABASE_URL` | no | none | Durable store. Omit and submissions live in the notification email and the Vercel log. |
| `SUPABASE_SERVICE_ROLE_KEY` | no | none | Service role key, server side only. Never expose to the browser. |
| `MGI_TABLE` | no | `mgi_v5_submissions` | Table name. |

### Live configuration

Three domains are verified on the Clover ERA Resend account: `cloverera.com`,
`joincloverera.com` and `go.cloverera.com`, so any address on any of them can send.

The MGI project is configured to send the manager's report as
`clive@joincloverera.com`, which is the mailbox the closing block asks them to reply to.
The notification to Clive is sent from `mgi@cloverera.com` instead, because it is
addressed to `clive@joincloverera.com` and mail that arrives from outside carrying the
recipient's own domain in the From header is the pattern spam filters treat as spoofing.
Different domain, no such pattern, and DMARC still aligns because both are verified.

The MGI uses its own Resend key, not the one in `clover-crm/.env`. This endpoint is
public, so a leak here should be one key to rotate rather than two systems to fix.

### Optional Supabase table

```sql
create table if not exists mgi_v5_submissions (
  id           bigint generated always as identity primary key,
  submitted_at timestamptz not null,
  first_name   text not null,
  email        text not null,
  company      text not null,
  role         text not null,
  team_size    text,
  state        text not null,
  confidence   text not null,
  exposure     text not null,
  gap          text not null,
  gut          text not null,
  signal       int  not null,
  behaviour    numeric,
  weak_areas   int,
  area_ranking text,
  answers      jsonb not null,
  created_at   timestamptz not null default now()
);

alter table mgi_v5_submissions enable row level security;
-- no policies: the service role key bypasses RLS, the anon key gets nothing
```

`answers` holds the raw submission: `{ gut, evidence: [12 ints], output, external, energy, exposure }`.

Every submission is also written to the Vercel function log as a single line prefixed
`MGI_SUBMISSION`, so nothing is lost even if both the store and the emails fail.

## Emails

Two go out per submission.

**Notification to Clive.** Subject `MGI: [First name], [Company] · [STATE] ([confidence],
signal [S]/36)`. Reply-to is the manager. Body carries the contact details, the computed
state with the decision rule that fired, the confidence, the exposure answer, the gap and
the gut read, the area ranking with each area's recency fact, then all seventeen
questions with the exact answers given. This is call prep: the raw answers matter more
than the scores.

**Report copy to the manager.** The same content as the on-screen report, as HTML with a
plain-text alternative. The compass becomes a four-row table with the computed state
marked, since SVG support in email is poor. Reply-to is `contact@cloverera.com`, because
the closing block asks them to reply if they want a conversation.

The manager never waits on either. The report renders as soon as the form is submitted
and the emails are sent alongside it.

## Local development

No build step. Serve the directory statically and open `/`. `/api/submit` needs a Node
handler, so use `vercel dev`, or a small harness that requires `api/submit.js` and stubs
`fetch`.

## Tests

Three suites live in the scratchpad used to build this: the scoring against every
acceptance case and every branch of the decision tree, the API handler with the network
stubbed, and a copy lint. Between them they cover all twelve acceptance checks, plus
guards for the things that are easy to regress: that exposure never moves the state, that
no label vocabulary reappears, that confidence is never derived from the signal score,
that the cohort sentence appears at most once, and that no area name produces a doubled
word in a callout.

## House style

British English. Direct, plain, short sentences. No em dashes anywhere. Banned:
"your people", "talent" as a noun, "engagement" as a frame, "AI-powered", "data-driven",
"manager enablement", "turnover prevention", "HR software", "transform", "unlock",
"elevate", "the future of work", "seamless", "robust", "game-changing", "Book a Demo".

Four places where the build departed from the brief's sample copy, all flagged for
review and each a one-line revert:

1. The notification subject uses a middle dot where the brief showed an em dash.
2. The "instinct ahead of the evidence" gap copy says "The fix is the same in both cases"
   where the brief said "Either way", which is on the banned list.
3. The five-weak-areas summary says "All five of your areas" rather than the brief's
   literal substitution, which produced "All five of your five areas".
4. The second-lowest area callout says "runs nearly as thin" rather than "is nearly as
   thin", because one area name ends in "is" and the literal wording produced "how
   equipped the team is is nearly as thin".
5. The signal band sentence and the summary block have a high-exposure variant that the
   brief does not specify. See "The close-up variant" above. Added at Clive's direction on
   2026-08-20 after the default copy was found to misread the high-exposure, low-signal
   case.

## Previous version

v4 is archived at git tag `mgi-v4-final` and branch `archive/v4-2026-08-19`, plus a
filesystem copy at `C:\Users\Administrator\archive\mgi-v4-2026-08-19\`. None of v4's
questions, scoring or copy carry over.
