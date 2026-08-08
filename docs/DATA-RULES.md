# Data rules

What every number means, and when it is allowed to change. Read this before you
alter a calculation.

---

## The day

Every number is bucketed onto a **calendar day in one reporting timezone**, set by
`reportingTimezone` in `adsv2.config.json` (default `America/New_York`).

Meta reports an ad account on that account's *own* timezone, which may not be the
one you think in. Left alone, that smears spend across day boundaries and a
week-over-week comparison stops meaning anything.

So an account that already reports in your reporting timezone is stored day-for-day.
Any other account is pulled with Meta's hourly breakdown, each hour is converted to
a real instant, and the hours are re-bucketed onto reporting-timezone days.

Every row is stamped with the timezone it was cut on, and **every read filters on
that stamp**. A row without it is invisible, it exists, it looks fine in the
database, and it contributes to nothing. If spend is missing, this is the first
thing to check.

---

## Money

**Ad spend** is stored raw, in whatever currency Meta bills that ad account in, and
converted to USD *at read time* using the rate for the day the money actually moved.
Raw data is never overwritten, so a corrected rate re-flows everywhere and stays
auditable.

**Sales money is never converted. Ever.** The sales tracker is one sheet, written in
one currency. The `currency` field describes what Meta *bills the ad account* in,
and applies to spend and budgets only.

This is not a style preference. Applying an ad account's currency to the sales in
the tracker once turned a $1,200 sale into $842, and nothing looked broken, a
slightly-too-small number is indistinguishable from a real one.

**Collected vs contracted.** Collected is cash in the bank. Contracted is the value
of the agreement. ROAS uses collected, because ROAS is a question about money you
have.

---

## Attribution

The chain is: **ad → keyword → DM → person → booking → sale**.

The keyword is the join. It comes from the ad name (last word) on the spend side,
and from the DM itself on the response side.

### How a booking finds its DM

Five ways, best evidence first. The first one that hits wins:

1. a human resolution, someone looked and decided
2. the subscriber id carried through on the booking payload
3. the subscriber ↔ contact bridge recorded by the booking webhook
4. the identity layer, if you populate one
5. a subscriber id on a matching sales-tracker row

If none hit, the booking has **no** subscriber and stays unattributed. It is not
assigned to the most plausible keyword.

### How a sale finds its ad

In passes, each writing its own evidence into the row:

- **retired ad**, the DM came from an ad that is no longer being run
- **single pre-sale keyword**, this buyer only ever typed one keyword before
  buying, so it is the only possibility, not a guess
- **human resolution**, a person decided; this outranks every computed answer and
  survives every rebuild
- **organic**, the keyword belongs to organic content, not a paid ad. Real revenue,
  never credited to ad spend
- **human-confirmed non-ad**, a person looked and said this did not come from an ad

A sale that fits none of these keeps its blank and shows as unknown.

### The rule underneath all of it

**No fallbacks that guess.** If the evidence does not exist, the number does not
exist. Unattributed revenue you can see is a problem you can fix. Revenue quietly
credited to the wrong ad is a decision you will make wrongly and never know it.

---

## Counting

**DMs** are counted per distinct subscriber per day, not per message. Someone who
types the keyword three times is one DM.

**Booked calls** are counted per distinct person, not per row. Someone who
reschedules twice is one booked call, not three.

**A booking counts on the day it was MADE**, not the day the call is scheduled for.
"Booked" answers "how many calls did we book this week", so a call booked Thursday
night for a Friday slot counts under Thursday. The scheduled time still drives
whether a call is upcoming, and the Call column in the popup.

**Calls taken** comes from the sales tracker's call-taken column, ticked by a human.
Nothing detects attendance. The booking tool only knows a booking exists; whether
somebody turned up is read straight out of the sheet. Same for revenue. An unfilled
tracker produces blank show rate and blank revenue, never a guess.

**Show rate** is taken ÷ due, per person, and a call still in the future is **not**
counted as due. A booking scheduled for next week is not a no-show, and letting it
drag the rate down makes the number useless exactly when you are scaling.

**Which calendars count** is set in `salesCalendarIds`. Only sales calls. Onboarding calls, coaching calls and reschedule calendars are not bookings.

Watch for near-duplicate calendars, same name, different id. CRMs produce these
constantly and bookings split silently between them, which shows up as a booked
count that is quietly too low. `npm run calendars` lists what is really in your
data and flags likely duplicates.

---

## Organic vs paid

A keyword used in organic content is real revenue and must not be credited to ad
spend. Mark it in `registry_keywords` with `type = 'organic'` (or in
`organic_keywords`) and the labeller will flag matching sales as organic, keeping
them out of ROAS while leaving them in total revenue.

If you reuse a keyword organically after it ran as an ad, leave a cool-down. A DM
arriving the day after you paused the ad probably came from the ad.

---

## Freshness and caching

The page reads **precomputed window snapshots**, not raw rows, that is why it opens
instantly. Each snapshot is stamped with a data version. The sync bumps that version
after the facts are rebuilt, which invalidates everything cached.

If the facts pass fails, **the version is not bumped**. The tab keeps serving the
last good numbers. Stale and correct beats fresh and half-built.

A source whose newest data is older than `staleHours` (default 26) is shown as stale
rather than shown as zero.

---

## What is recorded

- `adsv2_sync_runs`, every run, including ones that were skipped and why
- `adsv2_alerts`, every problem, deduped so one problem is one alert

A run that finds nothing still writes a row. A sync that vanishes silently is a sync
nobody can prove stopped happening, and proving it is the point.

---

## Human overrides

`adsv2_booking_resolutions` and `adsv2_sale_resolutions` hold decisions a person
made. They outrank every computed answer and survive every rebuild.

This is deliberate. The machine is honest about what it cannot know; a human filling
that gap is the intended workflow, and their answer must never be silently
recomputed away.
