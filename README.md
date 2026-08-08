# DM Ads Attribution

**Real ROAS for DM funnels, per ad, updating on its own.**

Money spent → DMs → booked calls → calls that happened → sales → cash. For any date
range. Per ad, not per campaign.

---

## Why this exists

If you ran a normal funnel, Ads Manager would show you the conversion. Someone clicks,
hits a landing page, the pixel fires, and Facebook tells you which ad made the sale.

**DM ads don't work like that.** The conversation happens inside Instagram. Facebook
never sees the booking, never sees the call, never sees the money. So the column you
actually care about — which ad produced buyers — doesn't exist in Ads Manager, and
never will.

And the one number it does give you is wrong. Facebook's cost per DM counts
conversations far more generously than you would, so it's inflated, and you're making
budget decisions on it.

Which leaves most people running DM ads with a spreadsheet rebuilt every campaign,
setters logging things by hand and forgetting some, and a monthly total that's roughly
right with no idea which ad produced it.

This is the attribution system I built for my own DM ads. It sets itself up on your
accounts, in your business.

---

## What changes

Once it's running, every campaign and ad set you launch from then on is tracked
automatically. Nobody logs anything. You're not chasing setters for numbers.

You open one page and the real cost per DM, cost per booked call, show rate and ROAS
are already there, updated within the hour.

Instead of *"we spent $4,000 and made $11,000"*, you get one row per ad telling you
that **this** one costs $9 a DM and has made three sales, and **that** one has spent
$600 and produced nothing.

---

## Setting it up

**Paste this repo's link into a [Claude Code](https://claude.com/claude-code) session
and tell it to install this.**

It'll ask about your business — what you use for DMs, what you book calls with, what
your sales tracker columns are called — and build the whole thing around your answers.
You don't edit any files.

You'll need to grab three tokens from three websites, add a couple of steps in
ManyChat, and share your sales sheet. That's your side of it.

About 45 minutes, most of it waiting for accounts to create.

**[Full setup guide (PDF) →](docs/DM-Ads-Attribution-Guide-v4.pdf)**

---

## The two rules that make it work

**1. Name the ad after the keyword.**

```
Ad says "DM me STRONG"   →   name the ad:   STRONG
```

Extra text is allowed, but then the keyword has to be the **last word** —
`Lead Magnet | STRONG` works, `STRONG retarget` does not.

That word is the whole connection between money going out and DMs coming in. An ad
named wrong still shows its spend and sits there with zeros beside it forever.

**2. Never run two ads with the same keyword at once.**

One live ad, one word. If two ads both say DM me STRONG, nothing can tell you which one
produced the sale. Reusing a word later is fine — just leave a few weeks.

---

## How the keyword travels

Think of it like a promo code. One code per ad, and it rides all the way to the sale.

| Where | What carries it |
| --- | --- |
| The ad | the ad's **name** in Ads Manager |
| The DM | what they typed, saved by ManyChat into a `keyword` field |
| The booking | `utm_content` on the booking link, sent automatically when your setter tags them |
| The sale | the ManyChat link pasted on the row when the call is **booked** |

Four links. Break one and that person's journey goes dark from there — not wrong, just
unknown, which the dashboard shows you honestly.

---

## What it won't do

**It won't guess.** If it can't prove a sale came from a particular ad, it shows as
*unattributed* rather than being assigned to whichever ad looks likeliest.

Money you can see is unaccounted for is a problem you can fix. Money silently credited
to the wrong ad is a decision you'll get wrong and never find out about.

Hover any number to see what it was built from.

---

## What you need

| | |
| --- | --- |
| A Meta ad account | the spend |
| ManyChat | the DMs |
| A booking tool — GoHighLevel, Calendly, whatever | the calls |
| Your sales tracker in Google Sheets | the money |
| A free Supabase account | where the numbers get stored |
| A free Vercel account | where the website lives |

Your dashboard ends up at your own address, something like `your-name.vercel.app`,
behind a password. Works on your phone. Updates itself hourly whether your computer is
on or not.

---

## Commands

| | |
| --- | --- |
| `npm run doctor` | what's set up, what isn't, and what each gap costs you |
| `npm run db` | create the database and build the tables |
| `npm run deploy` | put it online (or push new settings) |
| `npm run sync` | pull everything in right now, without waiting for the hour |
| `npm run calendars` | list your booking calendars so you can mark the sales ones |

---

## Docs

- **[Setup guide (PDF)](docs/DM-Ads-Attribution-Guide-v4.pdf)** — why this exists, and every step, for a human
- **[DATA-RULES.md](docs/DATA-RULES.md)** — what every number means and when it's allowed to change
- **[CLAUDE.md](CLAUDE.md)** — how an AI assistant should install and look after this

---

## Layout

```
src/lib/ads-v2/       the engine — facts.ts decides what everything means
src/lib/ingest/       pulling data in (Meta spend, your sheet, currency rates)
src/app/api/webhooks/ things pushed at us (keyword DMs, bookings)
src/app/ads-v2/       the dashboard
supabase/             the database, in two files. Safe to re-run
scripts/              setup, db, deploy, doctor, calendars
```
