# Instructions for Claude

You are setting this up for a **fitness coach who runs their own business**. Assume
they are not technical. Assume they have never used a terminal. Assume that if you
ask them a question containing a word like "environment variable" or "webhook
payload", they will not know the answer and will feel stupid, and you will have
made the tool worse.

Your job: **do everything except the parts that genuinely need a human in a
browser.** Ask for those in plain words, all at once, and handle the rest.

Do not hand back a half-finished setup with a list of homework.

---

## What this is

One table. Every ad, and what it actually gave back: money spent → DMs → booked
calls → calls that happened → sales → cash. Plus cost per DM, cost per booked
call, show rate, and ROAS, over any date range.

It is opinionated about one thing: **it does not guess.** If it cannot prove a sale
came from a particular ad, it says so instead of quietly picking the most likely
one. Keep that. It is the only reason the numbers are worth looking at.

---

## PHASE 1 — Interview them first

**Do this before you touch a single file.** The whole point is that the finished
dashboard fits *their* business. You cannot know that from the code.

Ask these in ONE message, numbered, in plain language. Tell them to answer what
they can and say "not sure" to the rest — you will work the rest out.

1. **What is your business called?** (just for the top of the dashboard)
2. **Do you run Meta ads yourself, or does someone run them for you?**
3. **What timezone does your Meta ad account bill in?** If they do not know: tell
   them to open Ads Manager → Billing, or just say "not sure" and you will use
   their local timezone.
4. **What do you use for your Instagram DMs?** (Expect ManyChat. If something
   else, ask whether it can send a webhook — most can.)
5. **What do you use to book calls?** (GoHighLevel, Calendly, something else)
6. **Paste the top row of your sales tracker** — the row with the column names in
   it. Assume they have one; every coach doing this does. This is the single most
   useful thing they can give you, because it is how you map their columns.
   Also ask: **is there a column where the ManyChat link gets pasted?** If not,
   they need to add one before you finish (see Phase 4).
7. **Does anyone else set appointments for you, or is it just you?**
8. **What are your ads called right now in Ads Manager?** Ask for two or three
   real examples. You need this for Phase 2.

### Then explain what they just told you

Before moving on, tell them in three or four sentences what you are about to build
**using their own words back at them**. For example:

> So: your ads tell people to DM you a word. ManyChat catches that word. They book
> into your Strategy Call calendar in GoHighLevel, and you write the result in your
> "Sales Tracker" sheet. I'm going to connect all four of those so you can see
> which ad produced which sale. Sound right?

If they say it is not right, fix your understanding before continuing. A setup
built on a wrong picture will produce numbers that look fine and are wrong.

---

## PHASE 2 — Teach the two rules, before anything is built

These are not optional and they are not technical. If they do not do these, the
dashboard will be blank and they will think it is broken.

### Rule 1 — name the ad after the keyword

Simplest version, and the one to lead with: **the ad's name is the keyword.**

```
Ad says "DM me TRIM"   ->   name the ad:   TRIM
```

Extra text in the name is allowed, but then the keyword must be the **last word**.
The parser takes the last word of the name, so `Lead Magnet | TRIM` gives `trim`
while `TRIM retarget` gives `retarget` and that ad is never credited with anything.

Do not invent a naming convention for them. Do not suggest things like
`Retarget | v3 | TEMPO` — that is not how these are named and it adds a rule
nobody asked for. Plain keyword, unless they already do something else.

Look at the real ad names they gave you in question 8. If any of them would parse
wrong, **show them that ad, renamed, in the chat.** Do not explain it in the
abstract.

Tell them plainly what happens if they do not: the money still shows up, but that
ad can never be credited with a single DM, call, or sale. It sits at the top of
the list spending money with zeros next to it.

### Rule 2 — never use the same keyword twice at the same time

One live ad, one word. If two ads both say DM me TRIM, nothing can tell you which
one produced the sale.

Reusing a word later is fine — leave a few weeks after you turn the first one off.

### Rule 3 — the sales tracker columns have to actually get filled in

Whoever takes the call fills in **did they show up** and **what did they pay**. The
dashboard reads those two columns directly. Nothing can automate it, and empty
columns mean no show rate and no revenue.

This is not a "nice to have" conversation. Their sales tracker is where ROAS comes
from — without it connected they have a funnel counter, not an attribution system.

---

## PHASE 3 — Build it

They may have started this by pasting the repo link at you rather than opening a
folder. Either is fine — clone it somewhere sensible and work from there.

Now do the work, in this order.

```
npm install
npm run setup
```

`npm run setup` writes their settings file and makes up their password. **Tell them
the password it printed and tell them to write it down.**

### Write their config from the interview

Edit `adsv2.config.json`:

- `business.name` — from question 1
- `business.timezone` — from question 3
- `business.currency` — whatever Meta charges them in
- `salesSheet` — set `enabled: true` and **map `columns` from the header row they
  pasted in question 6.** Column letters, counting from A. `date` and
  `prospectName` are required. Map `manychatLink` to whichever column holds the
  ManyChat link — it is worth more than all the other optional columns combined.
- Leave `salesCalendarIds` empty. You fill it in at Phase 5.

If their sheet has one tab per month, set `tabs: "monthly"` and match
`monthTabFormat` to how they actually name the tabs.

### Things only they can get

Ask for these in one message, with the exact link for each:

| What | Where | Why it matters |
| --- | --- | --- |
| Supabase access token | supabase.com/dashboard/account/tokens → Generate new token | This is where their numbers get stored |
| Meta ad account id + access token | A **System User** token, so it never expires. The setup guide PDF has the click path | Without it there is no ad spend at all |
| Vercel token | vercel.com/account/tokens → Create Token | This is what puts it on the internet |
| Their sales sheet link | Share → anyone with the link → Viewer, then copy the address | This is where money comes from |

Then:

```
npm run db        # creates their database and builds the tables
npm run deploy    # puts it online, gives them a real web address
npm run doctor    # tells you both what is left
```

---

## PHASE 4 — Connect ManyChat and their booking tool

`npm run deploy` prints their two webhook addresses with the secret already in them.
**Give them the finished addresses.** Never a template with `YOUR-APP` in it that they
have to complete themselves.

### ManyChat — where the keyword gets caught

This is a real, working shape, not a suggestion. Match it.

Their keyword automation already exists. Its trigger is **User sends a message**,
with *every* keyword listed on it — `mighty, charged, loaded, summit, hammer` and so
on, all on one trigger. If they split conversations between setters, a **Randomizer**
sits after the trigger and each branch leads into an Actions block.

In that Actions block, two things get added:

1. **Set User Field** → a custom field called `keyword`, set to **Last Text Input**.
   That captures whichever word the person actually typed.
2. **External Request** → the step that sends it over.

**One automation covers every keyword.** Because the word is read from what they
typed, they do NOT need one automation per keyword. If you tell them to build five
automations for five keywords you have made their life materially worse for no
reason.

The External Request itself:

- **Request Type:** POST
- **Request URL:** the manychat address from `npm run deploy`
- **Headers:** `Content-Type: application/json`, and `X-Webhook-Secret` set to their
  `WEBHOOK_SECRET`. Prefer the header over putting the secret in the URL — it keeps
  the secret out of anything that logs URLs.
- **Body:** JSON, using ManyChat's own field pickers

```json
{
  "subscriber_id": "<Contact Id>",
  "first_name": "<First Name>",
  "last_name": "<Last Name>",
  "keyword": "<keyword custom field>",
  "setter_name": "<the setter for this branch>"
}
```

`subscriber_id` and `keyword` are the two that matter. The rest is nice to have.

Note that ManyChat's Preview pane shows **"Invalid JSON — Variables are not defined"**
while you are editing. That is normal; it cannot resolve the merge fields until a real
contact runs through. It is not an error, and they will ask about it.

### ManyChat — where the keyword rides to the booking

This is the step people miss, and without it every booking arrives orphaned.

When the setter is ready to book someone, they apply a booking tag (`1_Day_Calendar`,
`3_Day_Calendar`, whatever they use). That tag triggers an automation that sends the
calendar link. **That link must carry the keyword:**

```
https://their-booking-link?utm_content={keyword}
```

— pulling from the same `keyword` custom field set at the top of the funnel. Every
booking tag they use needs it, not just the first one.

### Their booking tool

Whatever fires when a call is actually booked POSTs to the booking address. Fields:

```json
{
  "appointment_id": "...", "calendar_id": "...", "contact_id": "...",
  "contact_name": "...", "start_time": "...", "manychat_user_id": "..."
}
```

Use their tool's own merge-field syntax — GoHighLevel and Calendly differ. If you do
not know it, look it up rather than inventing field names.

The keyword arrives two ways: from `utm_content` on the booking link, and from
`manychat_user_id` if their tool can carry it. Either works. Both is better.

### The sales tracker habit

When the setter books someone, they paste that person's **ManyChat conversation link**
onto the row in the sales tracker. That is what ties the eventual sale back to the DM.

Check they actually have that column. If they do not, tell them to add it now, before
setup finishes — retrofitting it later means the sales already in the sheet can never
be attributed.

**To check either endpoint is live**, open its address in a browser. It answers with
whether the secret is right and what it expects.

## PHASE 5 — Pin the sales calendars

After a few real bookings have come through:

```
npm run calendars
```

This prints the calendars that actually exist in their data. Put the **sales call**
ones into `salesCalendarIds`. Not onboarding calls. Not coaching calls.

Watch for two calendars with almost the same name and different ids — booking tools
produce these constantly and bookings split silently between them, which shows up
as a booked count that is quietly too low. The script flags them.

**Until this is done, no booked calls are counted at all.**

---

## PHASE 6 — Verify. Do not skip this.

Open the dashboard and check, out loud, all four:

- spend is showing
- a test keyword DM appears in the DM column
- a test booking appears in the booked column
- `npm run doctor` is clean

If any is zero, say so plainly and go and find out why. **A setup that "finished"
but shows an empty table is not finished**, and they will not know the difference
until a week has gone by.

Then write them a short `MY-SETUP.md` in the project folder: their web address,
their password, their two webhook addresses, which columns you mapped, and their
live keywords. They will lose this chat. They will not lose that file.

---

## Rules that are not negotiable

Each of these encodes a failure that already happened and produced confident wrong
numbers for weeks before anyone noticed.

**Never convert sales money between currencies.** The tracker is one sheet in one
currency. `currency` describes what Meta *charges them*, and applies to ad spend
only. Converting tracker money once turned a $1,200 sale into $842 and nothing
looked broken.

**Never write to their spreadsheet.** This reads. That is all it does.

**Never invent a number to fill a gap.** If a sale cannot be tied to an ad, it stays
blank and shows as unattributed. Do not add a fallback that assigns it to the most
likely keyword. The blank is the product.

**Never loosen a keyword match.** Keywords are exact. Fuzzy matching moves revenue
onto the wrong ad.

**Never remove the `reporting_timezone` stamp** from spend rows. Every read filters
on it. An unstamped row exists, looks fine, and counts toward nothing.

---

## How the code is arranged

```
src/lib/ads-v2/       the engine. facts.ts decides what everything means
src/lib/ingest/       pulling data in (Meta spend, the sheet, currency rates)
src/app/api/webhooks/ things pushed at us (keyword DMs, bookings)
src/app/ads-v2/       the dashboard itself. ads-v2.css is self-contained
supabase/             the database, in two files. Safe to re-run
scripts/              setup, db, deploy, doctor, calendars — read these first
```

`docs/DATA-RULES.md` explains what every number means and when it is allowed to
change. Read it before altering any calculation.

---

## When something is wrong

| What they see | Look here first |
| --- | --- |
| Table is empty | `npm run doctor`, then the `adsv2_sync_runs` table for the last error |
| Spend but no DMs | ManyChat. Open the webhook address in a browser to test it |
| DMs but no booked calls | `salesCalendarIds` is empty or wrong. `npm run calendars` |
| Booked count too low | Two near-identical calendars. `npm run calendars` flags them |
| Sales all unattributed | No ManyChat link column in their sheet, so there is nothing to join on |
| Everything stopped updating | `CRON_SECRET` differs between their file and Vercel |

`adsv2_sync_runs` and `adsv2_alerts` record every run and every problem, including
runs that were skipped. Read them before theorising.

---

## How to talk to them

Short sentences. No jargon that you do not define in the same breath. When
something is broken, say what is broken and what you are doing about it — do not
bury it at the end of a status update.

They are a coach, not a developer. They do not want to understand this. They want
to know which ad to turn off.
