#!/usr/bin/env python3
"""Build docs/DM-Ads-Attribution-Guide.pdf — the one document a human reads.

Deliberately contains NO webhook addresses, secrets, or request bodies. Those
are generated per install and handed over privately by Claude. A setup guide
that gets shared around must not carry anyone's credentials in it.

    npm run pdf
"""

import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    KeepTogether, ListFlowable, ListItem, PageBreak,
)

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "DM-Ads-Attribution-Guide.pdf")

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
                            fontSize=29, leading=33, alignment=TA_LEFT, textColor=INK, spaceAfter=8)
S["sub"] = ParagraphStyle("sub", fontName="Helvetica", fontSize=12.5, leading=18.5,
                          textColor=MUTED, spaceAfter=18)
S["part"] = ParagraphStyle("part", fontName="Helvetica-Bold", fontSize=9,
                           textColor=ACCENT, spaceBefore=4, spaceAfter=2)
S["h1"] = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=16.5, leading=21,
                         textColor=INK, spaceBefore=24, spaceAfter=5)
S["h2"] = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11, leading=15,
                         textColor=INK, spaceBefore=15, spaceAfter=4)
S["body"] = ParagraphStyle("body", fontName="Helvetica", fontSize=10.3, leading=16,
                           textColor=INK, spaceAfter=9)
S["lead"] = ParagraphStyle("lead", fontName="Helvetica", fontSize=11.5, leading=17.5,
                           textColor=INK, spaceAfter=10)
S["small"] = ParagraphStyle("small", fontName="Helvetica", fontSize=9.2, leading=13.5,
                            textColor=MUTED, spaceAfter=7)
S["cell"] = ParagraphStyle("cell", fontName="Helvetica", fontSize=9.4, leading=13.5, textColor=INK)
S["cellhead"] = ParagraphStyle("cellhead", fontName="Helvetica-Bold", fontSize=9.4,
                               leading=13.5, textColor=INK)
S["code"] = ParagraphStyle("code", fontName="Courier", fontSize=9.2, leading=14, textColor=INK)
S["callout"] = ParagraphStyle("callout", fontName="Helvetica", fontSize=9.8, leading=14.6, textColor=INK)
S["li"] = ParagraphStyle("li", fontName="Helvetica", fontSize=10.3, leading=16,
                         textColor=INK, spaceAfter=5)


def P(text, style="body"):
    return Paragraph(text, S[style])


def code(lines):
    body = "<br/>".join(l.replace(" ", "&nbsp;") for l in lines)
    t = Table([[Paragraph(body, S["code"])]], colWidths=[6.5 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CODEBG),
        ("LEFTPADDING", (0, 0), (-1, -1), 11), ("RIGHTPADDING", (0, 0), (-1, -1), 11),
        ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    return KeepTogether([t, Spacer(1, 10)])


def callout(label, text):
    inner = Paragraph(f"<b>{label}</b>&nbsp; {text}", S["callout"])
    t = Table([[inner]], colWidths=[6.5 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BOXBG),
        ("LINEBEFORE", (0, 0), (0, -1), 2.4, ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    return KeepTogether([t, Spacer(1, 11)])


def table(rows, widths, head=True):
    data = []
    for i, row in enumerate(rows):
        style = "cellhead" if (head and i == 0) else "cell"
        data.append([Paragraph(c, S[style]) for c in row])
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0)
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
    ]
    if head:
        cmds.append(("LINEBELOW", (0, 0), (-1, 0), 0.9, INK))
    t.setStyle(TableStyle(cmds))
    return [t, Spacer(1, 13)]


def steps(items):
    return ListFlowable(
        [ListItem(Paragraph(t, S["li"]), leftIndent=20) for t in items],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletFontSize=10.3,
        leftIndent=20, bulletDedent=20, spaceAfter=11,
    )


def bullets(items):
    return ListFlowable(
        [ListItem(Paragraph(t, S["li"]), leftIndent=15) for t in items],
        bulletType="bullet", bulletFontSize=6, leftIndent=15, bulletDedent=11, spaceAfter=11,
    )


def rule():
    t = Table([[""]], colWidths=[6.5 * inch], rowHeights=[1])
    t.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.9, INK)]))
    return KeepTogether([t, Spacer(1, 2)])


def header_footer(canvas, doc):
    canvas.saveState()
    if doc.page > 1:
        canvas.setFont("Helvetica", 7.8)
        canvas.setFillColor(FAINT)
        canvas.drawString(1 * inch, LETTER[1] - 0.62 * inch, "DM ADS ATTRIBUTION")
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.4)
        canvas.line(1 * inch, LETTER[1] - 0.72 * inch, LETTER[0] - 1 * inch, LETTER[1] - 0.72 * inch)
    canvas.setFont("Helvetica", 7.8)
    canvas.setFillColor(FAINT)
    canvas.drawRightString(LETTER[0] - 1 * inch, 0.62 * inch, str(doc.page))
    canvas.restoreState()


story = []


def A(item):
    story.extend(item) if isinstance(item, list) else story.append(item)


# ═══════════════════════════════════════════════════════════════════════════
# PART ONE — the why
# ═══════════════════════════════════════════════════════════════════════════

A(P("DM Ads Attribution", "title"))
A(P("Real ROAS for DM funnels, per ad, updating on its own.", "sub"))
A(rule())
A(Spacer(1, 18))

A(P("Why DM ads are different", "h1"))
A(P("If you were running a normal funnel, Ads Manager would show you the conversion. "
    "Someone clicks, they hit a landing page, the pixel fires, and Facebook tells you which "
    "ad made the sale.", "lead"))
A(P("DM ads do not work like that. The conversation happens inside Instagram. Facebook never "
    "sees the booking, never sees the call, and never sees the money. So the column you "
    "actually care about — <b>which ad produced buyers</b> — does not exist in Ads Manager, "
    "and never will.", "lead"))

A(P("And the number it does give you is wrong", "h2"))
A(P("Facebook reports a cost per DM. That number is consistently optimistic — it counts "
    "conversations started far more generously than you would. So the one metric you are "
    "handed is inflated, and you are making budget decisions on it."))

A(P("Which leaves you doing it by hand", "h2"))
A(P("Most people running DM ads end up somewhere like this:"))
A(bullets([
    "a spreadsheet that gets rebuilt every time you launch a new campaign",
    "setters logging things manually, every day, and forgetting some of them",
    "spend in one place, DMs in another, bookings in a third, cash in a fourth",
    "a monthly total that is roughly right, and no idea which ad produced it",
]))
A(P("It is not that you are bad at tracking. It is that nothing was built to track this."))

A(P("So I built it", "h1"))
A(P("This is the attribution system I use for my own DM ads, and it is what this document "
    "sets up for you, in your own business, on your own accounts.", "lead"))
A(P("It follows one person the whole way through, and the connection holds the entire time:"))
A(code([
    "they see your ad",
    "     they DM you the word              ->  a DM",
    "          they book a call             ->  a booking",
    "               they show up            ->  a call taken",
    "                    they pay you       ->  a sale",
]))
A(P("Then it adds it up per ad. Not per campaign. Per ad."))
A(P("So instead of \"we spent $4,000 and made $11,000\", you get one row per ad telling you "
    "that <i>this</i> one costs $9 a DM and has made three sales, and <i>that</i> one has "
    "spent $600 and produced nothing."))

A(callout("What changes day to day.",
          "Once it is set up, every campaign and every ad set you launch from then on is "
          "tracked automatically. Nobody logs anything. You are not chasing setters for "
          "numbers. You open one page and the real cost per DM, cost per booked call, show "
          "rate and ROAS are already sitting there, updated within the hour."))

A(PageBreak())

# ── how it holds together ────────────────────────────────────────────────
A(P("PART ONE", "part"))
A(P("How the connection actually holds", "h1"))
A(P("Worth understanding, because two of the pieces are things only you can do.", "lead"))
A(P("The keyword is the tracking number. Your ad tells someone to send a word. That same word "
    "travels the whole way down the funnel:"))
A(table([
    ["Where", "What carries the keyword"],
    ["The ad", "the ad's <b>name</b> in Ads Manager"],
    ["The DM", "what they actually typed, captured by ManyChat"],
    ["The booking", "the booking link your setter sends, which carries the keyword in it"],
    ["The sale", "the ManyChat link pasted on the row in your sales tracker"],
], [1.5 * inch, 5.0 * inch]))
A(P("Four links in a chain. Break any one and the rest of that person's journey goes dark — "
    "not wrong, just unknown, which the dashboard will show you honestly."))
A(P("The middle two are automatic once set up. The first and last are on you.", "small"))

A(P("It will not guess", "h1"))
A(P("If it cannot prove a sale came from a particular ad, it shows as <b>unattributed</b> "
    "rather than being quietly assigned to whichever ad looks likeliest."))
A(P("This is on purpose, and it is the reason the numbers are worth anything. Money you can "
    "see is unaccounted for is a problem you can go and fix. Money silently credited to the "
    "wrong ad is a decision you will get wrong and never find out about."))
A(P("Hover any number and it shows you what it was built from.", "small"))

A(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# PART TWO — your two jobs
# ═══════════════════════════════════════════════════════════════════════════

A(P("PART TWO", "part"))
A(P("The two things only you can do", "h1"))
A(P("Everything else in this document gets done for you. These two do not, and if you skip "
    "them the dashboard will be empty and you will think it is broken.", "lead"))

A(P("1. Name your ads after the keyword", "h1"))
A(P("Whatever word your ad tells people to send — that is the ad's name in Ads Manager."))
A(table([
    ["Your ad says", "Name the ad"],
    ["DM me TRIM", "<b>TRIM</b>"],
    ["DM me MIGHTY", "<b>MIGHTY</b>"],
    ["DM me TEMPO", "<b>TEMPO</b>"],
], [2.2 * inch, 4.3 * inch]))
A(P("That is it. Plain. The keyword and nothing else is the cleanest way to do it, and it is "
    "how I name mine."))
A(callout("If you want other things in the ad name too, that is fine &mdash; "
          "but the keyword has to be the LAST word.",
          "The system reads the last word of the name. So "
          "<font face='Courier'>Lead Magnet | TRIM</font> works and gives you "
          "<i>trim</i>. <font face='Courier'>TRIM retarget</font> does not &mdash; it reads "
          "as <i>retarget</i>, and that ad will never be credited with anything. If you are "
          "not sure, just name it the keyword."))
A(P("An ad named wrong is not broken. It still shows up, still shows its spend, and sits "
    "there with zeros beside it, because nothing can honestly tie a DM to it."))

A(P("2. Never run the same word twice at once", "h1"))
A(P("One live ad, one word. If two ads both say <i>DM me TRIM</i> and someone DMs TRIM and "
    "buys, nothing on earth can tell you which ad did it."))
A(P("Reusing a word later is fine. Leave a few weeks after turning the first one off, so a "
    "late DM from the old ad does not get credited to the new one."))

A(PageBreak())

# ── the sales tracker ────────────────────────────────────────────────────
A(P("PART TWO", "part"))
A(P("Your sales tracker", "h1"))
A(P("Your sales tracker is where the money lives, so it is what turns this from a funnel "
    "counter into actual ROAS. You are going to connect it to the system, and it stays "
    "exactly where it is — you keep working in the same sheet you already use.", "lead"))
A(callout("This system can only read your sheet.",
          "It can never write to it, change it, or reorganise it. It also never converts your "
          "money between currencies &mdash; what you typed is what it shows."))

A(P("The columns it reads", "h1"))
A(P("You almost certainly have most of these already. The column letters do not matter and "
    "the names do not matter — you say which is which during setup, once."))
A(table([
    ["Column", "Why it is needed"],
    ["<b>Date</b>", "which day the call belongs to. Required."],
    ["<b>Name</b>", "who it was. Required."],
    ["<b>ManyChat link</b>", "<b>the important one.</b> Ties the sale back to the DM, and therefore to the ad"],
    ["<b>Did they show</b>", "your show rate, and it separates a no-show from a lost sale"],
    ["<b>Cash collected</b>", "the money. This is what ROAS is calculated on"],
    ["<b>Total contracted</b>", "the full deal value, for when it differs from cash in hand"],
    ["<b>Outcome</b>", "won, lost, no-show, follow-up"],
    ["<b>Closer</b>", "who took it"],
    ["<b>Setter</b>", "who set it"],
], [1.6 * inch, 4.9 * inch]))

A(P("Add the ManyChat link column if you do not have it", "h2"))
A(P("When your setter books someone, they paste that person's ManyChat conversation link onto "
    "the row. It takes three seconds and it is the single highest-value habit in this whole "
    "system."))
A(P("Without it, sales get matched to DMs by name alone. Two people called Sarah, someone "
    "using a nickname, a typo — and the match fails silently. With the link it is exact, "
    "every time."))

A(callout("One thing that stays a human job.",
          "Whoever takes the call fills in whether they showed and what they paid. Nothing can "
          "automate that, and the dashboard reads those two columns directly. Empty columns "
          "mean no show rate and no revenue &mdash; not a bug, just nothing to read."))

A(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# PART THREE — setting it up
# ═══════════════════════════════════════════════════════════════════════════

A(P("PART THREE", "part"))
A(P("Setting it up", "h1"))
A(P("Open Claude Code and paste in the link to the project. Tell it to install this.", "lead"))
A(P("It will ask you about your business — what you use for DMs, what you book calls with, "
    "and what the columns in your sales tracker are called — and then build the whole thing "
    "around your answers. You do not edit any files."))
A(P("Roughly 45 minutes, and most of that is waiting for accounts to finish creating.", "small"))

A(P("The four things to go and get", "h1"))
A(P("Claude cannot log into your accounts for you, so these four are yours. Collect them "
    "first and the rest goes quickly."))
A(table([
    ["", "What", "Where", "What it is for"],
    ["1", "Supabase token", "supabase.com", "Where your numbers get stored"],
    ["2", "Meta ad account id + token", "business.facebook.com", "Your ad spend"],
    ["3", "Vercel token", "vercel.com", "Puts it on the internet"],
    ["4", "Your sales tracker link", "Google Sheets", "Your money"],
], [0.3 * inch, 1.9 * inch, 1.5 * inch, 2.8 * inch]))

A(P("1. Supabase — where the numbers live", "h1"))
A(P("A database is just the filing cabinet the numbers get kept in. Free at the size you need."))
A(steps([
    "Go to <b>supabase.com</b> and make an account.",
    "Go to <b>supabase.com/dashboard/account/tokens</b>",
    "Click <b>Generate new token</b>. Name it anything.",
    "Copy it and give it to Claude.",
]))
A(P("From that one token Claude creates the project and builds everything inside it. You never "
    "have to click around in Supabase.", "small"))

A(P("2. Meta — your ad spend", "h1"))
A(P("Your ad account id is in <b>Ads Manager</b>, top left, next to the account name. It "
    "looks like <font face='Courier'>act_123456789</font>."))
A(P("Then the access token. Use the kind that never expires — the normal kind dies after "
    "about two months and takes your dashboard down with no warning."))
A(steps([
    "Go to <b>business.facebook.com</b> → <b>Business Settings</b>",
    "Left menu: <b>Users</b> → <b>System Users</b>",
    "<b>Add</b>. Name it anything. Role: <b>Admin</b>.",
    "<b>Add Assets</b> → <b>Ad Accounts</b> → tick your ad account → turn on "
    "<b>Manage campaigns</b>",
    "<b>Generate New Token</b>. Pick your app. Tick <b>ads_read</b> and "
    "<b>ads_management</b>. Expiry: <b>Never</b>.",
    "Copy it. It is only shown once.",
]))
A(callout("This is the fiddliest part of the whole setup.",
          "If you get lost, tell Claude which screen you are actually looking at and it will "
          "walk you through from there. Everything after this is easier."))

A(P("3. Vercel — where the website lives", "h1"))
A(steps([
    "Go to <b>vercel.com</b> and make an account.",
    "Go to <b>vercel.com/account/tokens</b>",
    "Click <b>Create Token</b>. Name it anything.",
    "Copy it and give it to Claude.",
]))

A(P("4. Your sales tracker", "h1"))
A(steps([
    "Open your sales tracker in Google Sheets.",
    "Click <b>Share</b> → under <b>General access</b>, change <b>Restricted</b> to "
    "<b>Anyone with the link</b>. Leave it on <b>Viewer</b>.",
    "Copy the link from your browser's address bar.",
    "Give Claude the link, and <b>paste in your top row too</b> — the row with your column "
    "names in it. That is how it works out which column is which.",
]))

A(PageBreak())

# ── connecting manychat ──────────────────────────────────────────────────
A(P("PART THREE", "part"))
A(P("Connecting ManyChat", "h1"))
A(P("Claude gives you a private address to paste in. Two places in ManyChat need touching, "
    "and both are in flows you already have.", "lead"))

A(P("Where the keyword gets captured", "h2"))
A(P("In the automation that fires when someone sends one of your keywords, you add two things "
    "to the Actions block:"))
A(bullets([
    "<b>Set User Field</b> — save the keyword to a custom field, set to "
    "<b>Last Text Input</b>. This grabs whichever word they actually sent.",
    "<b>External Request</b> — the step that sends it over. Claude gives you the address and "
    "exactly what goes in it.",
]))
A(callout("One automation covers all your keywords.",
          "Because the keyword is read from what they typed, you do not need a separate "
          "automation per word. List every keyword on the same trigger, and each DM records "
          "itself correctly. If you split conversations between setters with a randomiser, "
          "that keeps working exactly as it does now &mdash; put the request step after it, "
          "in the actions."))

A(P("Where the keyword rides to the booking", "h2"))
A(P("When your setter is ready to book someone, they apply your booking tag — the one that "
    "already sends the calendar link."))
A(P("That message needs the keyword on the end of the booking link, as "
    "<font face='Courier'>utm_content</font>, pulled from the custom field you just set:"))
A(code(["your-booking-link?utm_content={keyword}"]))
A(P("That one addition is what carries the keyword from the DM onto the booked call. Without "
    "it the booking arrives with no idea which ad it came from."))
A(P("If you use more than one booking tag — a one-day calendar and a three-day calendar, say "
    "— each one needs it.", "small"))

A(P("Your booking tool", "h2"))
A(P("Whatever fires when a call actually gets booked needs to send it over too. GoHighLevel, "
    "Calendly and most others can do this; the menus differ, so tell Claude which one you use "
    "and it will give you the exact steps."))

A(P("Then mark your sales calendars", "h2"))
A(P("Once a few real bookings have come through, Claude lists every calendar in your account "
    "and you say which are <b>sales calls</b> — not onboarding calls, not coaching calls."))
A(P("Until that is done, booked calls show as zero. It is the most common reason someone "
    "thinks this is broken when it is not.", "small"))

# ── after ────────────────────────────────────────────────────────────────
A(P("When it is done", "h1"))
A(P("You get your own web address, something like <font face='Courier'>your-name.vercel."
    "app</font>, behind a password you picked. It works on your phone."))
A(P("It updates itself every hour, whether your computer is on or not. From this point on, "
    "every new campaign and every new ad set you launch is tracked from the moment it goes "
    "live — as long as the ad name ends in its keyword."))

A(P("Check these four before you call it finished", "h2"))
A(table([
    ["", "Check"],
    ["&#9744;", "Your ad spend is showing"],
    ["&#9744;", "Send yourself a test DM with one of your keywords — it lands in the DM column"],
    ["&#9744;", "Book a test call — it lands in the booked column"],
    ["&#9744;", "Ask Claude to run the setup check, and it comes back clean"],
], [0.3 * inch, 6.2 * inch]))
A(P("If any is zero, tell Claude. A setup that finished but shows an empty table is not "
    "finished, and you will not notice for a week."))

A(P("If something looks off later", "h1"))
A(P("Tell Claude what you are seeing in your own words. There is a check built in that finds "
    "most of it. The usual suspects:"))
A(table([
    ["What you see", "What it usually is"],
    ["One ad shows spend and nothing else", "Its name does not end in its keyword"],
    ["Spend, but no DMs at all", "The ManyChat request step is not firing"],
    ["DMs, but no booked calls", "Your sales calendars have not been marked yet"],
    ["Booked calls look too low", "Two calendars with nearly the same name, splitting your bookings"],
    ["Bookings show, but no keyword", "The booking link is missing <font face='Courier'>utm_content</font>"],
    ["Sales show as unattributed", "No ManyChat link on those rows in your tracker"],
], [2.5 * inch, 4.0 * inch]))

A(Spacer(1, 14))
A(rule())
A(Spacer(1, 10))
A(P("<b>The whole thing in one line:</b> the keyword goes at the end of the ad name, rides "
    "the booking link, and lands on the sales row. Claude does the rest.", "small"))

doc = BaseDocTemplate(
    os.path.abspath(OUT), pagesize=LETTER,
    leftMargin=1 * inch, rightMargin=1 * inch,
    topMargin=0.95 * inch, bottomMargin=0.9 * inch,
    title="DM Ads Attribution — Setup Guide", author="DM Ads Attribution",
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="body")
doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=header_footer)])
doc.build(story)
print(f"wrote {os.path.abspath(OUT)}")
