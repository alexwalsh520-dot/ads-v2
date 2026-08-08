# Ads V2

One table that tells you what every ad actually returned — spend, DMs, booked calls,
calls taken, sales, cash — for any date window.

Built for DM-funnel Meta advertising: an ad tells someone to send a keyword, they
DM it, a setter books them, a closer sells them. Ads Manager can tell you what you
spent. This tells you what came back.

---

## The fastest way to install this

Open this folder in [Claude Code](https://claude.com/claude-code) and say:

> Install this.

`CLAUDE.md` tells it everything else. It will do the setup, ask you for the handful
of things that need a human in a browser, wire it up, and check it works.

**Prefer to do it yourself?** `docs/SOP.md` is the step-by-step version, about 45
minutes start to finish.

---

## What you need

| | | |
| --- | --- | --- |
| Supabase | free tier is fine | the database |
| Vercel | free tier is fine | hosting and the scheduled sync |
| A Google account | | sign-in |
| A Meta ad account per creator | | the spend |
| ManyChat, or anything that can POST a webhook | | the DMs |
| A booking CRM that can POST a webhook | GoHighLevel, Calendly, … | the calls |
| A sales tracker in Google Sheets | optional | the cash, and therefore ROAS |

Without the sales sheet you still get spend, DMs, booked calls and show rate. You
do not get revenue or ROAS.

---

## Install

```bash
npm install
npm run setup      # writes .env.local, generates your secrets
# fill in .env.local and adsv2.config.json  (see docs/SOP.md)
npm run migrate    # creates the database schema
npm run doctor     # tells you exactly what is still missing
npm run dev
```

`npm run doctor` is the one to remember. Run it whenever anything looks wrong; it
checks your config, your environment, your schema and your data, and every failure
says what to do about it.

---

## The one rule that makes it work

**The keyword goes at the end of the ad name.**

```
TEST | Direct CTA | TRIM      →  trim
Q3 Scaling (PRIMED)           →  primed
Lead Magnet | 50 | Tempo      →  tempo
```

That word is the entire join between money spent and DMs received. Name an ad
without it and the spend still records, but it can never be credited to a DM, a
call, or a sale.

A keyword must also be unique across every creator while it is live. Two people
running the same word at once makes it impossible to say whose ad a DM came from.

---

## What it will not do

It will not guess. If a sale cannot be connected to an ad, it shows as
unattributed rather than being assigned to the most likely candidate. Unattributed
revenue you can see is a problem you can fix; revenue quietly credited to the wrong
ad is a decision you will make wrongly and never know it.

Everything the dashboard shows carries its evidence. Hover a number to see what it
was built from.

---

## Commands

| | |
| --- | --- |
| `npm run doctor` | what is set up, what is not, and what each gap costs you |
| `npm run migrate` | create or update the database schema |
| `npm run sync` | pull everything in right now, without waiting for the cron |
| `npm run calendars` | list the booking calendars in your data, so you can pin the sales ones |
| `npm test` | the unit tests |

---

## Documentation

- **`docs/SOP.md`** — the setup guide, for a human
- **`docs/DATA-RULES.md`** — what every number means and when it is allowed to change
- **`CLAUDE.md`** — how an AI assistant should install and maintain this

---

## Layout

```
src/lib/ads-v2/       the engine — facts.ts decides what everything means
src/lib/ingest/       pulling data in (Meta spend, sales sheet, FX rates)
src/app/api/webhooks/ pushes in (ManyChat keyword DMs, bookings)
src/app/ads-v2/       the UI
supabase/             the schema, in two idempotent files
scripts/              doctor, migrate, sync, calendars
```
