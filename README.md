# Ads

**One table that shows you what every ad actually gave back.**

Money spent → DMs → booked calls → calls that happened → sales → cash. For any date
range. Per ad.

Facebook can tell you what you spent. It cannot tell you what came back. This does.

---

## Who this is for

You run Meta ads that tell people to send a word in the DMs. They message you, they
book a call, some of them buy. Right now you cannot tell which ad produced the
people who bought — so you're guessing which ones to turn off.

This stops the guessing.

---

## Setting it up

**Open this folder in [Claude Code](https://claude.com/claude-code) and say "install this."**

It asks you a few questions about your business, then does the rest. You'll need to
copy three tokens from three websites, paste two links into ManyChat and your
booking tool, and pick a password. That's your whole job.

About 45 minutes, most of it waiting for accounts to create.

**[The full setup guide is here →](docs/Ads-Setup-Guide.pdf)** — written for
someone who has never opened a terminal.

Doing it yourself instead:

```bash
npm install
npm run setup     # makes your settings file and your password
npm run db        # creates your database
npm run deploy    # puts it on the internet
npm run doctor    # tells you what's still missing
```

`npm run doctor` is the one to remember. Run it whenever something looks wrong. It
checks everything and every problem it finds comes with what to do about it.

---

## Where does it live?

On the internet, at your own address — something like `your-name.vercel.app`. You
sign in with a password. It works on your phone.

It updates itself every hour, whether your computer is on or not.

You can also run it on your own computer while you're setting up (`npm run dev`),
but that only works while your computer is on and that window is open, and the
hourly update doesn't happen. That's for testing. Deploying is the real thing.

Hosting is free at the size you need. So is the database.

---

## The two rules that make it work

**1. The keyword goes at the end of the ad's name.**

Your ad tells people to DM a word. That same word has to be the last word of the
ad's name in Ads Manager.

```
Ad says "DM me TRIM"   →   name the ad:   Vet ICP | Direct CTA | TRIM
```

That word is the entire connection between money going out and DMs coming in. An ad
named without it still shows its spend — it just sits there with zeros next to it
forever, because nothing can tie it to anything.

**2. Never run two ads with the same keyword at the same time.**

One live ad, one word. If two ads both say DM me TRIM, nothing on earth can tell you
which one produced the sale.

Using a word again later is fine. Just wait a few weeks after turning the first one
off, so a straggler DM doesn't get credited to the wrong ad.

---

## What it won't do

**It won't guess.** If it can't prove a sale came from a particular ad, it shows as
*unattributed* instead of being quietly assigned to whichever ad looks likeliest.

That's on purpose. Unattributed money you can see is a problem you can go and fix.
Money silently credited to the wrong ad is a decision you'll get wrong and never
find out about.

Hover any number to see what it was built from.

---

## What you need

| | |
| --- | --- |
| A Meta ad account | the spend |
| ManyChat, or anything that can send a webhook | the DMs |
| A booking tool — GoHighLevel, Calendly, whatever | the calls |
| A Google Sheet of your sales calls | the money. Optional, but no ROAS without it |
| A free Supabase account | where the numbers get stored |
| A free Vercel account | where the website lives |

Without the sales sheet you still get spend, DMs, booked calls and show rate. You
don't get revenue, and you don't get ROAS.

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

- **[Setup guide (PDF)](docs/Ads-Setup-Guide.pdf)** — what this is, and every step, for a human
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
