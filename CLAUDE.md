# Instructions for Claude

You are installing **Ads V2** for the person you are talking to. This file tells you
how. Read it fully before you start.

Your job is to do everything that does not require a human in a browser, tell them
plainly what is left, and then verify it works. Do not hand back a half-installed
app with a list of homework.

---

## What this is

One table. Every ad keyword, and what it actually returned: spend → DMs → booked
calls → calls taken → sales → cash. Plus ROAS, cost per DM, cost per booked call,
and show rate, over any date window.

It is opinionated about one thing: **it will not guess.** A number it cannot prove
shows as unattributed rather than being quietly assigned to something plausible.
Keep that property. It is the reason the tool is trusted.

---

## The install, in order

Work through these. After each step that touches config or environment, run
`npm run doctor` — it is the source of truth for what is still missing.

### 1. Dependencies and scaffolding

```
npm install
npm run setup
```

`npm run setup` creates `.env.local` from the example and generates `AUTH_SECRET`,
`CRON_SECRET` and `WEBHOOK_SECRET`. It never overwrites an existing value.

### 2. Things only the human can do

You cannot create accounts, click OAuth consent screens, or generate Meta tokens.
Ask for these, all at once, in one short message — not one at a time:

| What you need | Where they get it |
| --- | --- |
| Supabase URL + anon key + service role key | supabase.com → new project → Settings → API |
| Google OAuth client id + secret | console.cloud.google.com → APIs & Services → Credentials → OAuth client ID (Web application) |
| Meta ad account id + access token, per creator | See `docs/SOP.md` §3 — a **System User** token, so it does not expire |
| Google Sheets API key + spreadsheet id | Only if they want revenue and ROAS |

`docs/SOP.md` is the human-readable version of this table with screenshots-worth of
detail. Point them at it rather than re-explaining it in chat.

**The Google OAuth redirect URI must be exactly:**
```
http://localhost:3000/api/auth/callback/google
https://THEIR-DOMAIN/api/auth/callback/google
```
A trailing slash breaks it. This is the single most common install failure.

### 3. Write `adsv2.config.json`

Replace the `example` creator. One entry per person they run ads for. Ask them for:

- a short key (lowercase, no spaces, never changed once data exists)
- the display name
- **the ad account's reporting timezone in Meta** — not where the person lives.
  A Sydney-based coach whose ad account reports on Sydney time gets
  `Australia/Sydney`, and the ingester re-cuts their days for you.
- the currency Meta *bills that ad account* in, if not USD

Leave `salesCalendarIds` empty for now. You fill it in at step 6.

### 4. Create the schema

```
npm run migrate
```

If that prints instructions instead of running, the human needs to paste
`supabase/01_tables.sql` then `supabase/02_functions.sql` into the Supabase SQL
editor. Both are idempotent. Do not write your own migration files.

### 5. First sync

```
npm run dev          # one terminal
npm run sync -- --lookback=90    # another
```

Then `npm run doctor` and confirm `ads_meta_insights_daily` has rows.

### 6. Wire the webhooks, then pin the calendars

Give them these two URLs, with `WEBHOOK_SECRET` filled in from `.env.local`:

```
ManyChat  → POST https://APP/api/webhooks/manychat?secret=SECRET
Bookings  → POST https://APP/api/webhooks/booking?secret=SECRET
```

`docs/SOP.md` §5 has the field lists. Both endpoints answer `GET` with what they
expect, which is the fastest way to check one is live.

Once a few bookings have arrived:

```
npm run calendars
```

This prints the booking calendars that actually exist in their data, with counts.
Put the **sales** calendar ids into `salesCalendarIds`. Not onboarding calls, not
coaching calls, not reschedule calendars.

Watch for near-duplicate calendars with the same name and different ids — CRMs
produce these constantly and bookings split silently between them. The script
flags them. If both are genuinely sales calls, pin both.

### 7. Deploy

Push to GitHub, import into Vercel, copy every variable from `.env.local` into the
project's environment variables, set `AUTH_URL` to the production URL, and add the
production callback URI to the Google OAuth client. `vercel.json` already schedules
the crons.

### 8. Verify — do not skip this

Open the dashboard and confirm, out loud, that:

- spend appears for each configured creator
- the DM column is non-zero after a test keyword DM
- a test booking appears in the booked column
- `npm run doctor` is clean

If any of those is zero, say so plainly and diagnose it. An install that "completed"
but shows an empty table is not an install.

---

## Rules that are not negotiable

These encode failures that already happened, each of which produced confident wrong
numbers for weeks before anyone noticed.

**Never FX-convert sales money.** The sales tracker is one sheet in one currency for
every creator. `currency` on a creator describes what Meta *bills their ad account*
in, and applies to spend and budgets only. Converting tracker money once turned a
$1,200 sale into $842 and nothing looked broken.

**Never write to the user's spreadsheet.** This app reads. That is all it does.

**Never make a number up to fill a gap.** If attribution cannot connect a sale to an
ad, it stays blank and shows as unattributed. Do not add a fallback that assigns it
to the most likely keyword. The blank is the product.

**Never widen a keyword match.** Keywords are exact after normalisation. Fuzzy
matching moves one creator's revenue onto another creator's ads.

**Never remove the `reporting_timezone` stamp** from `ads_meta_insights_daily` rows.
Every read filters on it. An unstamped row exists, looks fine in the table, and
contributes to nothing.

**Never let one creator's failure take down another's.** Every sync step is isolated
already. Keep it that way.

**A keyword must be unique across every creator while it is live.** Two people
running the same word at once makes it impossible to say whose ad a DM came from.

---

## How the code is arranged

```
src/lib/ads-v2/       the engine. facts.ts decides what everything means.
src/lib/ingest/       pulling the outside world in (Meta, sheets, FX)
src/app/api/webhooks/ pushes from ManyChat and the booking CRM
src/app/ads-v2/       the UI. ads-v2.css is self-contained.
supabase/             the schema. Two files, both idempotent.
scripts/              doctor, migrate, sync, calendars — read these first
```

The sync orchestrator is `src/lib/ads-v2/sync.ts`. It reads top-to-bottom and the
comments explain why each step is where it is.

`docs/DATA-RULES.md` explains what each number means and when it is allowed to
change. Read it before altering any calculation.

---

## When something is wrong

| Symptom | Look here first |
| --- | --- |
| Table is empty | `npm run doctor`, then `adsv2_sync_runs` for the last run's error |
| Spend but no DMs | the ManyChat webhook — `GET` the endpoint to check it is live |
| DMs but no booked calls | `salesCalendarIds` is empty or has the wrong ids. `npm run calendars` |
| Booked count looks low | duplicate calendars. `npm run calendars` flags them |
| Sales show as unattributed | the sales sheet has no ManyChat link column, so there is nothing to join on |
| One creator missing entirely | their Meta token expired. `adsv2_sync_runs.detail` names them |
| Numbers stopped updating | `CRON_SECRET` mismatch between the env and the scheduler |

`adsv2_sync_runs` and `adsv2_alerts` record every run and every problem, including
runs that were skipped. Read them before theorising.

---

## Tone

The person you are helping may not be technical. Write plainly. No jargon where a
normal word works. When something is broken, say what is broken and what you are
doing about it — do not bury it in a status update.
