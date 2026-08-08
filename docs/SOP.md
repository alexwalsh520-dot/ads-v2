# Ads V2 — Setup

**What you are building:** one table that shows what every ad actually returned.
Spend, DMs, booked calls, calls taken, sales, cash — for any date window.

**Time:** about 45 minutes, most of it waiting for accounts to create.

**You do not need to be technical.** Where a step involves the terminal, the exact
command is given and you can paste it.

---

## The shortcut

Open this folder in Claude Code and say **"install this"**.

It will do everything below except the parts that need you in a browser — creating
accounts, clicking through consent screens, generating tokens. It will ask you for
those, all at once, and handle the rest.

This document is what to read while it asks, and what to come back to when
something looks wrong.

---

## Before you start, collect these

You will need all six. Get them first and the rest takes twenty minutes.

| | Where |
| --- | --- |
| 1. Supabase project keys | supabase.com |
| 2. Google sign-in keys | console.cloud.google.com |
| 3. Meta ad account id + token, per creator | business.facebook.com |
| 4. Your ManyChat account | manychat.com |
| 5. Your booking CRM | GoHighLevel, Calendly, whatever you use |
| 6. Your sales tracker sheet | Google Sheets — optional, but no ROAS without it |

---

## 1. The database (Supabase)

1. Go to **supabase.com**, sign in, **New project**.
2. Name it anything. Pick the region closest to you. Save the database password
   somewhere — you will not be shown it again.
3. Wait for it to finish provisioning (about two minutes).
4. Go to **Project Settings → API**. Copy three things:
   - **Project URL**
   - **anon public** key
   - **service_role** key

> The service_role key can do anything to your database. It belongs in server
> settings only. Never put it in a browser, a screenshot, or a message.

Free tier is fine to start.

---

## 2. Sign-in (Google)

1. Go to **console.cloud.google.com**. Create a project, or use one you have.
2. **APIs & Services → OAuth consent screen**. Choose **External**. Fill in the app
   name and your email. Save.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   Application type: **Web application**.
4. Under **Authorised redirect URIs**, add both of these, exactly:

   ```
   http://localhost:3000/api/auth/callback/google
   https://YOUR-APP.vercel.app/api/auth/callback/google
   ```

   Replace `YOUR-APP` once you know your real address (step 7). No trailing slash.

   > **This is the single most common thing that goes wrong.** A trailing slash, a
   > missing `/callback/google`, or `http` where it should be `https` all produce
   > the same unhelpful "redirect_uri_mismatch" error.

5. Copy the **Client ID** and **Client secret**.

---

## 3. Meta ad access, per creator

You need an ad account id and an access token for each person you run ads for.

**The ad account id** is in Ads Manager, top left, next to the account name. It
looks like `act_123456789`.

**The token** — use a **System User** token. A normal token expires in about 60
days and takes your dashboard down with no warning when it does. A System User
token does not expire.

1. **business.facebook.com → Business Settings → Users → System Users**
2. **Add** → give it a name → role **Admin**
3. **Add Assets** → **Ad Accounts** → select the ad account → enable **Manage
   campaigns** (full control)
4. **Generate New Token** → select your app → tick **`ads_read`** and
   **`ads_management`** → set expiry to **Never**
5. Copy it. It is shown once.

Repeat per creator whose ads you want in the dashboard.

> If you already have a short-lived token, it can be exchanged for a long-lived
> one, but a System User token is the version that does not need doing again.

---

## 4. Install and configure

In the terminal, in this folder:

```bash
npm install
npm run setup
```

That creates `.env.local` and generates your security secrets.

Now open **`.env.local`** and fill in what you collected:

```
NEXT_PUBLIC_SUPABASE_URL=       ← step 1, Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=  ← step 1, anon public
SUPABASE_SERVICE_ROLE_KEY=      ← step 1, service_role

AUTH_GOOGLE_ID=                 ← step 2, Client ID
AUTH_GOOGLE_SECRET=             ← step 2, Client secret
ALLOWED_EMAILS=you@example.com  ← your Google account, comma-separated for more

META_AD_ACCOUNT_ALEX=act_123456789   ← step 3
META_ACCESS_TOKEN_ALEX=              ← step 3
```

`AUTH_SECRET`, `CRON_SECRET` and `WEBHOOK_SECRET` were generated for you. Leave them.

Then open **`adsv2.config.json`** and replace the `example` creator with a real one:

```json
{
  "key": "alex",
  "name": "Alex Rivera",
  "active": true,
  "timezone": "America/Los_Angeles",
  "currency": "USD",
  "adAccountEnv": ["META_AD_ACCOUNT_ALEX"],
  "tokenEnv": ["META_ACCESS_TOKEN_ALEX"],
  "salesCalendarIds": [],
  "matchTokens": ["alex rivera", "rivera"]
}
```

Two things to get right:

- **`timezone`** is the ad account's *reporting* timezone in Meta — not where the
  person lives. A Sydney-based coach whose account reports on Sydney time gets
  `Australia/Sydney`, and the app re-cuts their days for you.
- **`currency`** is what Meta *bills that ad account* in. It applies to ad spend
  only. Your sales figures are never touched by it.

Leave `salesCalendarIds` empty. You fill it in at step 6.

Now build the database:

```bash
npm run migrate
```

If it prints instructions instead of running, open Supabase → **SQL Editor**, paste
in `supabase/01_tables.sql`, press Run, then do the same with
`supabase/02_functions.sql`.

Check where you are:

```bash
npm run doctor
```

This lists what is set up, what is not, and what each gap costs you. Run it any time.

---

## 5. Connect ManyChat and your booking CRM

This is the part that turns spend into a funnel. Two webhooks.

Find `WEBHOOK_SECRET` in `.env.local` — you need it in both URLs below.

### ManyChat → keyword DMs

In your keyword automation, add an **External Request** action:

- **Method:** POST
- **URL:** `https://YOUR-APP/api/webhooks/manychat?secret=YOUR_WEBHOOK_SECRET`
- **Body:** JSON

```json
{
  "keyword": "TRIM",
  "subscriber_id": "{{subscriber_id}}",
  "client": "alex",
  "name": "{{first_name}} {{last_name}}",
  "setter": "{{assigned_admin}}"
}
```

`keyword`, `subscriber_id` and `client` are required. Without all three the DM
cannot be tied to an ad, to a booking, or to anyone's ad account — so the endpoint
rejects it rather than recording something misleading. Rejections show in ManyChat's
own delivery log.

### Booking CRM → booked calls

On your "appointment booked" automation, POST to:

`https://YOUR-APP/api/webhooks/booking?secret=YOUR_WEBHOOK_SECRET`

```json
{
  "appointment_id": "{{appointment.id}}",
  "calendar_id": "{{appointment.calendar_id}}",
  "calendar_name": "{{appointment.calendar_name}}",
  "contact_id": "{{contact.id}}",
  "contact_name": "{{contact.name}}",
  "start_time": "{{appointment.start_time}}",
  "manychat_user_id": "{{contact.manychat_id}}"
}
```

> **`manychat_user_id` is worth more than every other optional field combined.**
> It is what ties the booking back to the DM, and therefore to the ad. If your CRM
> can carry the ManyChat subscriber id through — a hidden field on the booking form,
> or a parameter on the booking link — send it. Without it, bookings attribute far
> more weakly and many will show as unattributed.

**To check either endpoint is live,** open its URL in a browser (a GET). It will
tell you whether your secret is right and what fields it expects.

---

## 6. Pin your sales calendars

Once a few bookings have come through:

```bash
npm run calendars
```

This prints the booking calendars that actually exist in your data, with how many
bookings each holds. Put the **sales** calendar ids into `salesCalendarIds` for the
right creator in `adsv2.config.json`.

Only sales calls. Not onboarding calls, not coaching calls, not reschedule
calendars.

> **Watch for duplicates.** CRMs make it easy to end up with "Strategy Session (AR)"
> and "Strategy Session - (AR)" side by side, and bookings split silently between
> them. This shows up as a booked count that is quietly too low. The script flags
> likely duplicates. If both are genuinely sales calls, pin both ids.

Until this step is done, **no booked calls are counted at all.** `npm run doctor`
warns you about it.

---

## 7. The sales tracker (optional, but it is where ROAS comes from)

Without this you get spend, DMs, booked calls and show rate. You do not get revenue.

1. **console.cloud.google.com → APIs & Services → Library**, enable **Google Sheets
   API**.
2. **Credentials → Create credentials → API key**. Copy it.
3. Share your sales sheet as **anyone with the link can view**.
4. The spreadsheet id is the long string in its URL between `/d/` and `/edit`.
5. Add both to `.env.local`:

   ```
   GOOGLE_SHEETS_API_KEY=
   GOOGLE_SHEETS_SPREADSHEET_ID=
   ```

6. In `adsv2.config.json`, set `salesSheet.enabled` to `true` and map your columns:

   ```json
   "columns": {
     "date": "B",
     "prospectName": "C",
     "manychatLink": "D",
     "callTakenStatus": "F",
     "outcome": "I",
     "closer": "J",
     "collectedRevenue": "N",
     "setter": "P"
   }
   ```

   Just column letters, from your own sheet. Only `date` and `prospectName` are
   required; anything you leave out simply produces no data for that field.

   **`manychatLink` is the important one.** A column where setters paste the
   ManyChat chat link is what connects a closed sale back to the DM and therefore to
   the ad. Without it, sales match on name only, which is much weaker.

> This app only ever **reads** your sheet. It will never write to it.
>
> Money is read exactly as written. It is never converted between currencies —
> your tracker is one sheet in one currency, and "helpfully" converting it is how a
> $1,200 sale silently becomes $842.

---

## 8. Go live

1. Push this folder to GitHub.
2. **vercel.com → Add New → Project**, import the repository, deploy.
3. **Project Settings → Environment Variables**: add every line from `.env.local`.
   Add `AUTH_URL` set to your real address (`https://your-app.vercel.app`).
4. Go back to Google (step 2) and add the production callback URI.
5. Redeploy.

The scheduled sync is already configured: it runs hourly, and a nightly check
writes any accuracy problems to the alerts table.

---

## 9. Check it actually works

Open your dashboard and confirm all four:

- [ ] **Spend appears** for each creator. If not: `npm run doctor`, then check the
      token in step 3.
- [ ] **DMs appear** after you send yourself a test keyword DM. If not: open the
      ManyChat webhook URL in a browser and check the secret.
- [ ] **A test booking appears.** If not: `salesCalendarIds` is empty or wrong — go
      back to step 6.
- [ ] **`npm run doctor` is clean.**

An install that finished but shows an empty table is not finished.

---

## When something looks wrong

| What you see | What it usually is |
| --- | --- |
| Table is empty | Run `npm run doctor`. It will tell you. |
| Spend, but no DMs | ManyChat webhook. Open its URL in a browser to test. |
| DMs, but no booked calls | `salesCalendarIds` empty or wrong. `npm run calendars` |
| Booked count too low | Duplicate calendars. `npm run calendars` flags them. |
| Sales show as unattributed | No ManyChat link column in your sheet — nothing to join on. |
| One creator vanished | Their Meta token expired. Regenerate as a System User token. |
| Numbers stopped updating | `CRON_SECRET` does not match between your env and Vercel. |
| "redirect_uri_mismatch" | The Google callback URL. Check it character by character. |

Every sync writes a row to `adsv2_sync_runs`, including runs that were skipped and
why. Every problem writes to `adsv2_alerts`. Look there before guessing.

---

## The one rule to remember

**Put the keyword at the end of the ad name.**

```
TEST | Direct CTA | TRIM      →  trim
Q3 Scaling (PRIMED)           →  primed
Lead Magnet | 50 | Tempo      →  tempo
```

That word is the whole connection between money spent and DMs received. An ad named
without it still records its spend — it just can never be credited with a single DM,
call, or sale.

And keep keywords unique across creators while they are live. Two people running the
same word at once makes it impossible to say whose ad a DM came from.
