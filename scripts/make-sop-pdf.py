#!/usr/bin/env python3
"""Build docs/Ads-V2-Setup-SOP.pdf — the printable setup guide.

Kept in the repo so the PDF is regenerated from source rather than being an
untracked binary nobody can edit.

    python3 scripts/make-sop-pdf.py
"""

import os
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    KeepTogether, ListFlowable, ListItem,
)

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "Ads-V2-Setup-SOP.pdf")

INK = colors.HexColor("#16161a")
MUTED = colors.HexColor("#5f6169")
FAINT = colors.HexColor("#8b8d95")
RULE = colors.HexColor("#dcdce0")
BOXBG = colors.HexColor("#f5f5f3")
CODEBG = colors.HexColor("#f0f0ee")
ACCENT = colors.HexColor("#9a7b3f")

base = getSampleStyleSheet()

S = {}
S["title"] = ParagraphStyle("title", parent=base["Title"], fontName="Helvetica-Bold",
                            fontSize=27, leading=31, alignment=TA_LEFT, textColor=INK,
                            spaceAfter=6)
S["sub"] = ParagraphStyle("sub", fontName="Helvetica", fontSize=11.5, leading=17,
                          textColor=MUTED, spaceAfter=18)
S["h1"] = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=15, leading=19,
                         textColor=INK, spaceBefore=22, spaceAfter=3)
S["h2"] = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=10.5, leading=14,
                         textColor=INK, spaceBefore=13, spaceAfter=4)
S["body"] = ParagraphStyle("body", fontName="Helvetica", fontSize=9.7, leading=14.6,
                           textColor=INK, spaceAfter=8)
S["small"] = ParagraphStyle("small", fontName="Helvetica", fontSize=8.8, leading=13,
                            textColor=MUTED, spaceAfter=6)
S["cell"] = ParagraphStyle("cell", fontName="Helvetica", fontSize=8.9, leading=12.6,
                           textColor=INK)
S["cellhead"] = ParagraphStyle("cellhead", fontName="Helvetica-Bold", fontSize=8.9,
                               leading=12.6, textColor=INK)
S["code"] = ParagraphStyle("code", fontName="Courier", fontSize=8.7, leading=13,
                           textColor=INK)
S["callout"] = ParagraphStyle("callout", fontName="Helvetica", fontSize=9.2, leading=13.8,
                              textColor=INK)
S["li"] = ParagraphStyle("li", fontName="Helvetica", fontSize=9.7, leading=14.6,
                         textColor=INK, spaceAfter=3)


def P(text, style="body"):
    return Paragraph(text, S[style])


def code(lines):
    """A tinted command block."""
    body = "<br/>".join(l.replace(" ", "&nbsp;") for l in lines)
    t = Table([[Paragraph(body, S["code"])]], colWidths=[6.5 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CODEBG),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return KeepTogether([t, Spacer(1, 9)])


def callout(label, text):
    """A boxed aside with an accent rule down the left."""
    inner = Paragraph(f"<b>{label}</b>&nbsp; {text}", S["callout"])
    t = Table([[inner]], colWidths=[6.5 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BOXBG),
        ("LINEBEFORE", (0, 0), (0, -1), 2.2, ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 11),
        ("RIGHTPADDING", (0, 0), (-1, -1), 11),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    return KeepTogether([t, Spacer(1, 10)])


def table(rows, widths, head=True):
    data = []
    for i, row in enumerate(rows):
        style = "cellhead" if (head and i == 0) else "cell"
        data.append([Paragraph(c, S[style]) for c in row])
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0)
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
    ]
    if head:
        cmds.append(("LINEBELOW", (0, 0), (-1, 0), 0.9, INK))
    t.setStyle(TableStyle(cmds))
    return [t, Spacer(1, 12)]


def steps(items):
    return ListFlowable(
        [ListItem(Paragraph(t, S["li"]), leftIndent=18) for t in items],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletFontSize=9.7,
        leftIndent=18, bulletDedent=18, spaceAfter=10,
    )


def bullets(items):
    return ListFlowable(
        [ListItem(Paragraph(t, S["li"]), leftIndent=14) for t in items],
        bulletType="bullet", bulletFontSize=6, leftIndent=14, bulletDedent=10,
        spaceAfter=10,
    )


def rule():
    t = Table([[""]], colWidths=[6.5 * inch], rowHeights=[1])
    t.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.9, INK)]))
    return KeepTogether([t, Spacer(1, 2)])


def header_footer(canvas, doc):
    canvas.saveState()
    if doc.page > 1:
        canvas.setFont("Helvetica", 7.6)
        canvas.setFillColor(FAINT)
        canvas.drawString(1 * inch, LETTER[1] - 0.62 * inch, "ADS V2  ·  SETUP")
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.4)
        canvas.line(1 * inch, LETTER[1] - 0.72 * inch, LETTER[0] - 1 * inch, LETTER[1] - 0.72 * inch)
    canvas.setFont("Helvetica", 7.6)
    canvas.setFillColor(FAINT)
    canvas.drawRightString(LETTER[0] - 1 * inch, 0.62 * inch, str(doc.page))
    canvas.restoreState()


story = []


def A(item):
    story.extend(item) if isinstance(item, list) else story.append(item)

# ── page 1 ────────────────────────────────────────────────────────────────
A(P("Ads V2", "title"))
A(P("One table that tells you what every ad actually returned. Spend, DMs, booked "
    "calls, calls taken, sales, cash &mdash; for any date window.", "sub"))
A(rule())
A(Spacer(1, 14))

A(P("What this is for", "h1"))
A(P("You run Meta ads that tell people to send a keyword in the DMs. A setter books them. "
    "A closer sells them. Ads Manager can tell you what you spent. It cannot tell you what "
    "came back."))
A(P("This connects the two, keyword by keyword, so you can see which ads produce buyers "
    "rather than which ads produce clicks."))

A(P("The one thing it will not do", "h2"))
A(P("It will not guess. If a sale cannot be connected to an ad, it shows as "
    "<b>unattributed</b> rather than being assigned to the most likely candidate. "
    "Unattributed revenue you can see is a problem you can fix. Revenue quietly credited "
    "to the wrong ad is a decision you will get wrong and never know it."))

A(P("Time and difficulty", "h1"))
A(P("About 45 minutes, most of it waiting for accounts to create. You do not need to be "
    "technical. Where a step uses the terminal, the exact command is written out and you "
    "can paste it."))

A(callout("The fast way.",
          "Open the project folder in Claude Code and say <b>&ldquo;install this&rdquo;</b>. "
          "It will do everything here except the parts that need you in a browser &mdash; "
          "creating accounts, clicking consent screens, generating tokens. It asks you for "
          "those, all at once, and handles the rest. This document is what to read while it "
          "asks, and what to come back to when something looks wrong."))

A(P("Collect these first", "h1"))
A(P("All six. Get them before you start and the rest takes twenty minutes."))
A(table([
    ["", "What", "Where it comes from"],
    ["1", "Supabase project keys", "supabase.com"],
    ["2", "Google sign-in keys", "console.cloud.google.com"],
    ["3", "Meta ad account id and token, one set per creator", "business.facebook.com"],
    ["4", "Your ManyChat account", "manychat.com"],
    ["5", "Your booking CRM", "GoHighLevel, Calendly, whatever you use"],
    ["6", "Your sales tracker sheet", "Google Sheets &mdash; optional, but no ROAS without it"],
], [0.3 * inch, 2.6 * inch, 3.6 * inch]))

# ── 1 ─────────────────────────────────────────────────────────────────────
A(P("1 &nbsp; The database", "h1"))
A(steps([
    "Go to <b>supabase.com</b>, sign in, and click <b>New project</b>.",
    "Name it anything. Pick the region closest to you. Save the database password somewhere "
    "&mdash; you are not shown it again.",
    "Wait about two minutes for it to finish setting up.",
    "Open <b>Project Settings &rarr; API</b> and copy three things: the <b>Project URL</b>, "
    "the <b>anon public</b> key, and the <b>service_role</b> key.",
]))
A(callout("Careful with the service_role key.",
          "It can do anything to your database. It belongs in server settings only &mdash; "
          "never in a browser, a screenshot, or a message."))
A(P("The free tier is fine to start with.", "small"))

# ── 2 ─────────────────────────────────────────────────────────────────────
A(P("2 &nbsp; Sign-in", "h1"))
A(steps([
    "Go to <b>console.cloud.google.com</b>. Create a project, or use one you already have.",
    "Open <b>APIs &amp; Services &rarr; OAuth consent screen</b>. Choose <b>External</b>. "
    "Fill in the app name and your email. Save.",
    "Open <b>APIs &amp; Services &rarr; Credentials &rarr; Create credentials &rarr; "
    "OAuth client ID</b>. Application type: <b>Web application</b>.",
    "Under <b>Authorised redirect URIs</b>, add both of the addresses below, exactly.",
    "Copy the <b>Client ID</b> and the <b>Client secret</b>.",
]))
A(code([
    "http://localhost:3000/api/auth/callback/google",
    "https://YOUR-APP.vercel.app/api/auth/callback/google",
]))
A(callout("This is the most common thing that goes wrong.",
          "A trailing slash, a missing <font face='Courier'>/callback/google</font>, or "
          "<font face='Courier'>http</font> where it should be "
          "<font face='Courier'>https</font> all produce the same unhelpful "
          "&ldquo;redirect_uri_mismatch&rdquo; error. Check it character by character. "
          "Come back and add the second address once you know your real one (step 8)."))

# ── 3 ─────────────────────────────────────────────────────────────────────
A(P("3 &nbsp; Meta ad access, per creator", "h1"))
A(P("You need an ad account id and an access token for each person whose ads you want in "
    "the dashboard."))
A(P("The <b>ad account id</b> is in Ads Manager, top left, next to the account name. It "
    "looks like <font face='Courier'>act_123456789</font>."))
A(P("The token", "h2"))
A(P("Use a <b>System User</b> token. A normal token expires after about 60 days and takes "
    "your dashboard down with no warning when it does. A System User token does not expire."))
A(steps([
    "<b>business.facebook.com &rarr; Business Settings &rarr; Users &rarr; System Users</b>",
    "<b>Add</b>, give it a name, set the role to <b>Admin</b>.",
    "<b>Add Assets &rarr; Ad Accounts</b>, select the ad account, and enable "
    "<b>Manage campaigns</b> (full control).",
    "<b>Generate New Token</b>. Select your app. Tick <b>ads_read</b> and "
    "<b>ads_management</b>. Set the expiry to <b>Never</b>.",
    "Copy it. It is shown once.",
]))
A(P("Repeat for each creator.", "small"))

# ── 4 ─────────────────────────────────────────────────────────────────────
A(P("4 &nbsp; Install and configure", "h1"))
A(P("In the terminal, inside the project folder:"))
A(code(["npm install", "npm run setup"]))
A(P("That creates <font face='Courier'>.env.local</font> and generates your security "
    "secrets. Open that file and fill in what you collected:"))
A(code([
    "NEXT_PUBLIC_SUPABASE_URL=          <-- step 1, Project URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=     <-- step 1, anon public",
    "SUPABASE_SERVICE_ROLE_KEY=         <-- step 1, service_role",
    "",
    "AUTH_GOOGLE_ID=                    <-- step 2, Client ID",
    "AUTH_GOOGLE_SECRET=                <-- step 2, Client secret",
    "ALLOWED_EMAILS=you@example.com     <-- your Google account",
    "",
    "META_AD_ACCOUNT_ALEX=act_123456789    <-- step 3",
    "META_ACCESS_TOKEN_ALEX=               <-- step 3",
]))
A(P("<font face='Courier'>AUTH_SECRET</font>, <font face='Courier'>CRON_SECRET</font> and "
    "<font face='Courier'>WEBHOOK_SECRET</font> were generated for you. Leave them alone."))

A(P("Describe your creators", "h2"))
A(P("Open <font face='Courier'>adsv2.config.json</font> and replace the "
    "<font face='Courier'>example</font> creator with a real one:"))
A(code([
    '{',
    '  "key": "alex",',
    '  "name": "Alex Rivera",',
    '  "active": true,',
    '  "timezone": "America/Los_Angeles",',
    '  "currency": "USD",',
    '  "adAccountEnv": ["META_AD_ACCOUNT_ALEX"],',
    '  "tokenEnv": ["META_ACCESS_TOKEN_ALEX"],',
    '  "salesCalendarIds": [],',
    '  "matchTokens": ["alex rivera", "rivera"]',
    '}',
]))
A(P("Two things to get right:"))
A(bullets([
    "<b>timezone</b> is the ad account&rsquo;s <i>reporting</i> timezone in Meta &mdash; not "
    "where the person lives. A Sydney-based coach whose ad account reports on Sydney time "
    "gets <font face='Courier'>Australia/Sydney</font>, and the app re-cuts their days onto "
    "yours so a week-over-week comparison still means something.",
    "<b>currency</b> is what Meta <i>bills that ad account</i> in. It applies to ad spend "
    "only. Your sales figures are never touched by it.",
]))
A(P("Leave <font face='Courier'>salesCalendarIds</font> empty for now. You fill it in at "
    "step 6."))

A(P("Build the database", "h2"))
A(code(["npm run migrate"]))
A(P("If it prints instructions instead of running, open Supabase &rarr; <b>SQL Editor</b>, "
    "paste in <font face='Courier'>supabase/01_tables.sql</font> and press Run, then do the "
    "same with <font face='Courier'>supabase/02_functions.sql</font>."))

A(P("Check where you are", "h2"))
A(code(["npm run doctor"]))
A(callout("Remember this one.",
          "<font face='Courier'>npm run doctor</font> lists what is set up, what is not, and "
          "what each gap actually costs you. Run it whenever anything looks wrong. It is "
          "read-only, so you can run it as often as you like."))

# ── 5 ─────────────────────────────────────────────────────────────────────
A(P("5 &nbsp; Connect ManyChat and your booking CRM", "h1"))
A(P("This is the part that turns spend into a funnel. Two webhooks. You need "
    "<font face='Courier'>WEBHOOK_SECRET</font> from "
    "<font face='Courier'>.env.local</font> for both."))

A(P("ManyChat &rarr; keyword DMs", "h2"))
A(P("In your keyword automation, add an <b>External Request</b> action. Method POST, body "
    "JSON:"))
A(code([
    "https://YOUR-APP/api/webhooks/manychat?secret=YOUR_WEBHOOK_SECRET",
    "",
    "{",
    '  "keyword":       "TRIM",',
    '  "subscriber_id": "{{subscriber_id}}",',
    '  "client":        "alex",',
    '  "name":          "{{first_name}} {{last_name}}",',
    '  "setter":        "{{assigned_admin}}"',
    "}",
]))
A(P("<font face='Courier'>keyword</font>, <font face='Courier'>subscriber_id</font> and "
    "<font face='Courier'>client</font> are required. Without all three the DM cannot be "
    "tied to an ad, to the booking it produces, or to anyone&rsquo;s ad account &mdash; so "
    "the endpoint rejects it rather than recording something misleading. Rejections show up "
    "in ManyChat&rsquo;s own delivery log."))

A(P("Booking CRM &rarr; booked calls", "h2"))
A(P("On your &ldquo;appointment booked&rdquo; automation:"))
A(code([
    "https://YOUR-APP/api/webhooks/booking?secret=YOUR_WEBHOOK_SECRET",
    "",
    "{",
    '  "appointment_id":   "{{appointment.id}}",',
    '  "calendar_id":      "{{appointment.calendar_id}}",',
    '  "calendar_name":    "{{appointment.calendar_name}}",',
    '  "contact_id":       "{{contact.id}}",',
    '  "contact_name":     "{{contact.name}}",',
    '  "start_time":       "{{appointment.start_time}}",',
    '  "manychat_user_id": "{{contact.manychat_id}}"',
    "}",
]))
A(callout("manychat_user_id is worth more than every other optional field combined.",
          "It is what ties the booking back to the DM, and therefore to the ad. If your CRM "
          "can carry the ManyChat subscriber id through &mdash; a hidden field on the booking "
          "form, or a parameter on the booking link &mdash; send it. Without it, bookings "
          "attribute far more weakly and many will show as unattributed."))
A(P("<b>To check either endpoint is live</b>, open its URL in a browser. It will tell you "
    "whether your secret is right and what fields it expects."))

# ── 6 ─────────────────────────────────────────────────────────────────────
A(P("6 &nbsp; Pin your sales calendars", "h1"))
A(P("Once a few bookings have come through:"))
A(code(["npm run calendars"]))
A(P("This prints the booking calendars that actually exist in your data, with how many "
    "bookings each one holds. Put the <b>sales</b> calendar ids into "
    "<font face='Courier'>salesCalendarIds</font> for the right creator in "
    "<font face='Courier'>adsv2.config.json</font>."))
A(P("Only sales calls. Not onboarding calls, not coaching calls, not reschedule calendars."))
A(callout("Watch for duplicates.",
          "CRMs make it easy to end up with &ldquo;Strategy Session (AR)&rdquo; and "
          "&ldquo;Strategy Session - (AR)&rdquo; side by side, with bookings splitting "
          "silently between them. It shows up as a booked count that is quietly too low. "
          "The script flags likely duplicates. If both are genuinely sales calls, pin both."))
A(P("Until this step is done, <b>no booked calls are counted at all</b>. "
    "<font face='Courier'>npm run doctor</font> warns you about it."))

# ── 7 ─────────────────────────────────────────────────────────────────────
A(P("7 &nbsp; The sales tracker", "h1"))
A(P("Optional &mdash; but this is where revenue and ROAS come from. Without it you still "
    "get spend, DMs, booked calls and show rate."))
A(steps([
    "<b>console.cloud.google.com &rarr; APIs &amp; Services &rarr; Library</b>, enable the "
    "<b>Google Sheets API</b>.",
    "<b>Credentials &rarr; Create credentials &rarr; API key</b>. Copy it.",
    "Share your sales sheet as <b>anyone with the link can view</b>.",
    "The spreadsheet id is the long string in the sheet&rsquo;s URL, between "
    "<font face='Courier'>/d/</font> and <font face='Courier'>/edit</font>.",
    "Add <font face='Courier'>GOOGLE_SHEETS_API_KEY</font> and "
    "<font face='Courier'>GOOGLE_SHEETS_SPREADSHEET_ID</font> to "
    "<font face='Courier'>.env.local</font>.",
    "In <font face='Courier'>adsv2.config.json</font>, set "
    "<font face='Courier'>salesSheet.enabled</font> to <font face='Courier'>true</font> and "
    "map your columns.",
]))
A(code([
    '"columns": {',
    '  "date":             "B",',
    '  "prospectName":     "C",',
    '  "manychatLink":     "D",',
    '  "callTakenStatus":  "F",',
    '  "outcome":          "I",',
    '  "closer":           "J",',
    '  "collectedRevenue": "N",',
    '  "setter":           "P"',
    '}',
]))
A(P("Just column letters, read off your own sheet. Only <font face='Courier'>date</font> "
    "and <font face='Courier'>prospectName</font> are required; anything you leave out "
    "simply produces no data for that field rather than a wrong guess."))
A(callout("The manychatLink column is the important one.",
          "A column where setters paste the ManyChat chat link is what connects a closed sale "
          "back to the DM, and therefore to the ad. Without it, sales match on name alone, "
          "which is much weaker."))
A(callout("Two promises about your spreadsheet.",
          "This app only ever <b>reads</b> it &mdash; it will never write to your sheet. And "
          "money is read exactly as written, never converted between currencies. Your tracker "
          "is one sheet in one currency, and &ldquo;helpfully&rdquo; converting it is how a "
          "$1,200 sale silently becomes $842."))

# ── 8 ─────────────────────────────────────────────────────────────────────
A(P("8 &nbsp; Go live", "h1"))
A(steps([
    "Push the project folder to GitHub.",
    "<b>vercel.com &rarr; Add New &rarr; Project</b>, import the repository, deploy.",
    "<b>Project Settings &rarr; Environment Variables</b>: add every line from "
    "<font face='Courier'>.env.local</font>. Add <font face='Courier'>AUTH_URL</font>, set "
    "to your real address.",
    "Go back to Google (step 2) and add the production callback address.",
    "Redeploy.",
]))
A(P("The scheduled sync is already configured. It runs hourly, and a nightly check records "
    "any accuracy problems.", "small"))

# ── 9 ─────────────────────────────────────────────────────────────────────
A(P("9 &nbsp; Check it actually works", "h1"))
A(P("Open your dashboard and confirm all four. An install that finished but shows an empty "
    "table is not finished."))
A(table([
    ["", "Check", "If it is wrong"],
    ["&#9744;", "<b>Spend appears</b> for each creator",
     "Run <font face='Courier'>npm run doctor</font>, then re-check the token from step 3"],
    ["&#9744;", "<b>DMs appear</b> after you send yourself a test keyword DM",
     "Open the ManyChat webhook URL in a browser and check the secret"],
    ["&#9744;", "<b>A test booking appears</b>",
     "<font face='Courier'>salesCalendarIds</font> is empty or wrong &mdash; go back to step 6"],
    ["&#9744;", "<b>npm run doctor is clean</b>", "It will tell you what is left"],
], [0.28 * inch, 2.5 * inch, 3.72 * inch]))

# ── troubleshooting ───────────────────────────────────────────────────────
A(P("When something looks wrong", "h1"))
A(table([
    ["What you see", "What it usually is"],
    ["The table is empty", "Run <font face='Courier'>npm run doctor</font>. It will tell you."],
    ["Spend, but no DMs", "The ManyChat webhook. Open its URL in a browser to test it."],
    ["DMs, but no booked calls",
     "<font face='Courier'>salesCalendarIds</font> is empty or wrong. Run "
     "<font face='Courier'>npm run calendars</font>."],
    ["The booked count looks too low",
     "Duplicate calendars. <font face='Courier'>npm run calendars</font> flags them."],
    ["Sales show as unattributed",
     "No ManyChat link column in your sheet, so there is nothing to join on."],
    ["One creator vanished",
     "Their Meta token expired. Regenerate it as a System User token (step 3)."],
    ["Numbers stopped updating",
     "<font face='Courier'>CRON_SECRET</font> does not match between your file and Vercel."],
    ["&ldquo;redirect_uri_mismatch&rdquo;",
     "The Google callback address. Check it character by character."],
], [2.3 * inch, 4.2 * inch]))
A(P("Every sync writes a row to <font face='Courier'>adsv2_sync_runs</font>, including runs "
    "that were skipped and why. Every problem writes to "
    "<font face='Courier'>adsv2_alerts</font>. Look there before guessing.", "small"))

# ── the rule ──────────────────────────────────────────────────────────────
A(P("The one rule to remember", "h1"))
A(P("<b>Put the keyword at the end of the ad name.</b>"))
A(code([
    "TEST | Direct CTA | TRIM     ->   trim",
    "Q3 Scaling (PRIMED)          ->   primed",
    "Lead Magnet | 50 | Tempo     ->   tempo",
]))
A(P("That word is the whole connection between money spent and DMs received. An ad named "
    "without it still records its spend &mdash; it just can never be credited with a single "
    "DM, call, or sale."))
A(P("Keep keywords unique across creators while they are live. Two people running the same "
    "word at once makes it impossible to say whose ad a DM came from."))

A(Spacer(1, 16))
A(rule())
A(Spacer(1, 8))
A(P("Full documentation lives in the repository: <font face='Courier'>README.md</font> to "
    "get oriented, <font face='Courier'>docs/DATA-RULES.md</font> for what every number "
    "means and when it is allowed to change, and <font face='Courier'>CLAUDE.md</font> for "
    "how an AI assistant should install and maintain it.", "small"))

doc = BaseDocTemplate(
    os.path.abspath(OUT), pagesize=LETTER,
    leftMargin=1 * inch, rightMargin=1 * inch,
    topMargin=0.95 * inch, bottomMargin=0.9 * inch,
    title="Ads V2 — Setup", author="Ads V2",
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="body")
doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=header_footer)])
doc.build(story)
print(f"wrote {os.path.abspath(OUT)}")
