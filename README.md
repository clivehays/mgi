# Manager Gap Index (MGI) v5

A single-purpose diagnostic at **mgi.cloverera.com**. Twelve questions, about three
minutes, then a results report on screen. Clive gets an email with the raw answers the
moment a submission lands.

## What it measures

Not the gap between what a manager thinks and what their team feels. A manager-only
instrument cannot measure that. This measures **the gap between what a manager knows and
what they assume**: how much of their picture of the team rests on fresh, first-hand
signal, and how much on stale memory.

Three rules hold everywhere in the code and copy:

1. The instrument never claims to know the team's state. It only reports on the quality
   of the manager's signal. That is why the compass has a question mark at its centre
   where the product's radar chart shows a position.
2. No product pitch in the assessment or the report. Clover ERA appears only in the
   footer attribution and the closing block. The sales conversation happens later, by
   phone, off this page.
3. No framework vocabulary in the questions. The report uses plain-language area names.

## Layout

```
index.html          landing, questions, contact, report (one page, four views)
assets/scoring.js   the instrument: questions, scale, areas, bands, scoring
assets/mgi.js       flow, rendering, submission
assets/mgi.css      Clover ERA Editorial system (System A)
api/submit.js       stores the submission, sends both emails
vercel.json         clean URLs, cache and security headers
```

`assets/scoring.js` is a UMD module: the browser loads it as the global `MGI`, and
`api/submit.js` requires it as CommonJS. The server recomputes scores from the raw
answers, so the notification email can never disagree with the page the manager saw.
Change the instrument in one place only.

## Scoring

Each of the 12 items scores 3 (within the last week), 2 (last month), 1 (last quarter)
or 0 (can't recall). Overall score is the sum, 0 to 36.

| Score | Band |
|---|---|
| 27 to 36 | Clear signal |
| 15 to 26 | Fading signal |
| 0 to 14 | Flying on memory |

Five signal areas, two items each. Items 11 and 12 are calibration items: they count
toward the overall score and toward Drift detection, but belong to no named area.

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

Drift detection is the mean of items 1, 2, 5, 6, 9, 10, 11, 12. Headwinds detection is
the mean of items 3, 4, 7, 8. Each is labelled Detectable (2.0+), Late (1.0 to 1.9) or
Blind (below 1.0). Cruise is always ASSUMED, Stall always DETECTABLE, TOO LATE TO MATTER.

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
  total        int  not null,
  band         text not null,
  drift        text not null,
  headwinds    text not null,
  weakest      text not null,
  answers      jsonb not null,
  created_at   timestamptz not null default now()
);

alter table mgi_v5_submissions enable row level security;
-- no policies: the service role key bypasses RLS, the anon key gets nothing
```

Every submission is also written to the Vercel function log as a single line prefixed
`MGI_SUBMISSION`, so nothing is lost even if both the store and the emails fail.

## Emails

Two go out per submission.

**Notification to Clive.** Subject `MGI: [First name], [Company] · [Band] ([score]/36)`.
Reply-to is the manager. Body carries the contact details, the scores, the detection
labels, the two weakest areas, then all 12 questions with the exact answers given. This
is call prep: the raw answers matter more than the scores.

**Report copy to the manager.** The same content as the on-screen report, as HTML with a
plain-text alternative. Reply-to is `contact@cloverera.com`, because the closing block
asks them to reply if they want a conversation.

The manager never waits on either. The report renders as soon as the form is submitted
and the emails are sent alongside it.

## Local development

```
node devserver.js     # if you keep a harness around; see the tests below
```

There is no build step. Open `index.html` through any static server. `/api/submit` needs
a Node handler, so use `vercel dev` or a small harness that requires `api/submit.js` and
stubs `fetch`.

## Tests

Three suites live outside the repo, in the scratchpad used to build this. They cover the
scoring against every acceptance case, the API handler with the network stubbed, and a
copy lint (no em dashes, no banned vocabulary, no RRIDA, Clover ERA only in the two
permitted places, question wording verbatim against the brief).

## House style

British English. Direct, plain, short sentences. No em dashes anywhere. Banned:
"your people", "talent" as a noun, "engagement" as a frame, "AI-powered", "data-driven",
"manager enablement", "turnover prevention", "HR software", "transform", "unlock",
"elevate", "the future of work", "seamless", "robust", "game-changing", "Book a Demo".

## Previous version

v4 is archived at git tag `mgi-v4-final` and branch `archive/v4-2026-08-19`, plus a
filesystem copy at `C:\Users\Administrator\archive\mgi-v4-2026-08-19\`. None of v4's
questions, scoring or copy carry over.
