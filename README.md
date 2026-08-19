# Manager Gap Index (MGI) v5

A single-purpose diagnostic at **mgi.cloverera.com**. Sixteen questions, about four
minutes, then a report on screen naming the state the team is most likely in. Clive gets
an email with the raw answers the moment a submission lands.

## What it does

Teams move through four states: **Cruise** (stable and healthy), **Drift** (output still
fine, but the behaviours that produce it are slipping), **Headwinds** (output falling
while the team is healthy; the cause is external) and **Stall** (the decline has reached
the output).

The instrument works out the likely state from three things the manager has directly
observed: whether output is holding or slipping, whether an external cause is acting on
the team, and whether the behaviours of a healthy team have been visible recently. That
third input comes from twelve evidence items. The absence of those behaviours is not a
scoring trick; it is what Drift and Stall look like from the manager's seat.

The same twelve items do a second job. They measure how fresh the manager's signal is,
and that freshness becomes the **confidence level** on the state call. Stale signal gets
a hedged reading, and the report says plainly that the hedging is itself a finding.

Before the questions begin, the manager states their gut read. The distance between that
instinct and the evidence-based state is the **manager gap**, shown back to them in their
own words at the end.

Three rules hold everywhere in the code and copy:

1. **The state call is always "likely", never certain.** Copy says "most likely in" and
   "the evidence points to". Sixteen questions from one perspective earn a strong
   estimate, not a verdict. A lint enforces this.
2. **No product pitch.** Clover ERA appears only in the footer attribution and the
   closing block. No trial, pricing, worksheets, framework names or booking links. The
   sales conversation happens later, by phone, off this page.
3. **No framework vocabulary in the questions.** The report uses plain-language area
   names and the four state names.

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

## The sixteen questions

| # | Item | Scale |
|---|---|---|
| Q0 | Gut check, unscored | In great shape / Fine, as far as I can tell / Something feels off / Struggling, and I know it |
| Q1 to Q12 | Evidence items | Within the last week (3) / last month (2) / last quarter (1) / Can't recall (0) |
| Q13 | Output over the past month | Improved / Held steady / Slipped slightly / Slipped noticeably |
| Q14 | External pressure | Yes, clearly / Possibly / No |
| Q15 | Energy vs three months ago | Higher / About the same / Lower / Honestly, I couldn't say |

## Scoring

**Inputs.** B is the mean of evidence items 1, 2, 5, 6, 9, 10, 11, 12 (healthy-team
behaviours). W is the mean of items 3, 4, 7, 8 (contact with the work). S is the sum of
all twelve, 0 to 36, and drives confidence.

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

**Confidence** from S: 27 to 36 High, 15 to 26 Moderate, 0 to 14 Low.

**Five signal areas**, two items each. Items 11 and 12 count toward B and S but belong to
no named area.

| Area | Items |
|---|---|
| How equipped the team is | 1, 2 |
| The work itself | 3, 4 |
| How invested people are | 5, 6 |
| Whether everyone knows why | 7, 8 |
| Whether truth travels upward | 9, 10 |

Area mean 2.0+ is Current, 1.0 to 1.9 Fading, below 1.0 Stale. The two lowest means are
the weakest areas; ties prefer "Whether truth travels upward", then "How invested people
are", then the lowest item number.

**The manager gap.** Gut severity: great shape 0, fine 1, something off 2, struggling 3.
State severity: Cruise 0 or 1, Drift 2, Headwinds 2, Stall 3. Gut below the state's range
is "instinct behind the evidence", above it is "instinct ahead", inside it is "aligned".

**The compass** is inline SVG. The dot sits mid-radius in the computed state's quadrant.
The halo carries the confidence: none at High, a tight ring at Moderate, a wide
translucent halo at Low.

## Environment variables

Set these in the Vercel project. Only `RESEND_API_KEY` is required for email to work.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `RESEND_API_KEY` | yes | none | Resend API key. Without it neither email sends and the client shows a fallback line. |
| `MGI_NOTIFY_EMAIL` | no | `contact@cloverera.com` | Where the notification goes. |
| `MGI_FROM_EMAIL` | no | `Manager Gap Index <mgi@cloverera.com>` | From address. The domain must be verified in Resend. |
| `SUPABASE_URL` | no | none | Durable store. Omit and submissions live in the notification email and the Vercel log. |
| `SUPABASE_SERVICE_ROLE_KEY` | no | none | Service role key, server side only. Never expose to the browser. |
| `MGI_TABLE` | no | `mgi_v5_submissions` | Table name. |

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
  gap          text not null,
  gut          text not null,
  signal       int  not null,
  behaviour    numeric,
  work         numeric,
  weakest      text not null,
  answers      jsonb not null,
  created_at   timestamptz not null default now()
);

alter table mgi_v5_submissions enable row level security;
-- no policies: the service role key bypasses RLS, the anon key gets nothing
```

`answers` holds the raw submission: `{ gut, evidence: [12 ints], output, external, energy }`.

Every submission is also written to the Vercel function log as a single line prefixed
`MGI_SUBMISSION`, so nothing is lost even if both the store and the emails fail.

## Emails

Two go out per submission.

**Notification to Clive.** Subject `MGI: [First name], [Company] · [STATE] ([confidence],
[S]/36)`. Reply-to is the manager. Body carries the contact details, the computed state
with the decision rule that fired, the confidence, the gut read and the gap, the two
weakest areas, then all sixteen questions with the exact answers given. This is call
prep: the raw answers matter more than the scores.

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
stubbed, and a copy lint (no em dashes, no banned vocabulary, no RRIDA, no unhedged state
claim, Clover ERA only in the two permitted places, landing copy and question wording
verbatim against the brief).

## House style

British English. Direct, plain, short sentences. No em dashes anywhere. Banned:
"your people", "talent" as a noun, "engagement" as a frame, "AI-powered", "data-driven",
"manager enablement", "turnover prevention", "HR software", "transform", "unlock",
"elevate", "the future of work", "seamless", "robust", "game-changing", "Book a Demo".

Two places where house style overrode the brief's own sample copy, both flagged for
review: the notification subject uses a middle dot where the brief showed an em dash, and
the "instinct ahead of the evidence" gap copy says "The fix is the same in both cases"
where the brief said "Either way", which is on the banned list.

## Previous version

v4 is archived at git tag `mgi-v4-final` and branch `archive/v4-2026-08-19`, plus a
filesystem copy at `C:\Users\Administrator\archive\mgi-v4-2026-08-19\`. None of v4's
questions, scoring or copy carry over.
