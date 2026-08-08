#!/usr/bin/env python3
"""Build docs/Ads-Setup-Guide.pdf — the one document a human reads.

Two halves:
  1. What this is, and the rules that make it work.  (the teaching)
  2. What you personally have to do.                 (the doing)

Everything that could be handed to Claude has been. What is left here is only
the things a person has to click through in a browser themselves.

    npm run pdf
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))

from reportlab.lib import colors  # noqa: E402
from reportlab.lib.enums import TA_LEFT  # noqa: E402
from reportlab.lib.pagesizes import LETTER  # noqa: E402
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet  # noqa: E402
from reportlab.lib.units import inch  # noqa: E402
from reportlab.platypus import (  # noqa: E402
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    KeepTogether, ListFlowable, ListItem, PageBreak,
)

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "Ads-Setup-Guide.pdf")

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
                            fontSize=30, leading=34, alignment=TA_LEFT, textColor=INK, spaceAfter=8)
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
        canvas.drawString(1 * inch, LETTER[1] - 0.62 * inch, "ADS  ·  SETUP GUIDE")
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
# PART ONE — what this is
# ═══════════════════════════════════════════════════════════════════════════

A(P("Ads", "title"))
A(P("One table that shows you what every ad actually gave back.", "sub"))
A(rule())
A(Spacer(1, 18))

A(P("The problem", "h1"))
A(P("You spend money on ads. Facebook tells you what you spent, how many people saw it, "
    "and how many clicked.", "lead"))
A(P("What it cannot tell you is which of those ads produced people who <b>paid you</b>. So at "
    "the end of the month you have a spend number and a revenue number and no honest way to "
    "connect them. You end up turning ads off on a feeling.", "lead"))

A(P("What this does", "h1"))
A(P("It follows one person the whole way through:"))
A(code([
    "they see your ad",
    "     they DM you the word                (a DM)",
    "          they book a call               (a booking)",
    "               they show up              (a call taken)",
    "                    they pay you         (a sale)",
]))
A(P("And then it adds it all up per ad. So instead of \"we spent $4,000 and made $11,000\", "
    "you get one row per ad telling you that <i>this</i> one costs $9 a DM and has made three "
    "sales, and <i>that</i> one has spent $600 and made nothing."))
A(P("Then you know exactly which one to turn off."))

A(callout("It will not guess.",
          "If it cannot prove a sale came from a particular ad, it says <b>unattributed</b> "
          "instead of quietly assigning it to whichever ad looks likeliest. That is on purpose. "
          "Money you can see is unaccounted for is a problem you can go and fix. Money silently "
          "credited to the wrong ad is a decision you will get wrong and never find out about."))

A(PageBreak())

# ── the rules ────────────────────────────────────────────────────────────
A(P("PART ONE", "part"))
A(P("Two rules you have to follow", "h1"))
A(P("These are not settings. They are things <b>you</b> have to do, every time you make an ad. "
    "If you skip them the dashboard will be empty and you will think it is broken.", "lead"))

A(P("Rule 1 — put the keyword at the end of the ad's name", "h2"))
A(P("Your ad already tells people to send you a word. Something like:"))
A(code(['"Comment TRIM and I\'ll send you the plan"']))
A(P("That same word has to be the <b>last word</b> of the ad's name in Ads Manager."))
A(table([
    ["Your ad says", "Name the ad"],
    ["DM me TRIM", "Vets 35+ | Direct CTA | <b>TRIM</b>"],
    ["DM me PRIMED", "Lead magnet | v3 | <b>PRIMED</b>"],
    ["DM me TEMPO", "Retarget | <b>TEMPO</b>"],
], [2.1 * inch, 4.4 * inch]))
A(P("That word is the whole connection between the money going out and the DMs coming in. It "
    "is the tracking number on the parcel."))
A(callout("If you forget:",
          "the ad still shows up and still shows its spend. It just sits there with zeros next "
          "to it forever, because nothing can tie a single DM to it. It is not broken — it is "
          "telling you the truth, which is that it cannot know."))

A(P("Rule 2 — never run the same word twice at the same time", "h2"))
A(P("One live ad, one word. If two ads both say <i>DM me TRIM</i>, and someone DMs you TRIM "
    "and buys, nothing on earth can tell you which ad did it."))
A(P("Using a word again later is fine. Just leave a few weeks after you turn the first one "
    "off, so a late DM from the old ad does not get credited to the new one."))

A(P("And if you keep a sales spreadsheet", "h2"))
A(P("Whoever takes the call has to fill in two columns: <b>did they show up</b>, and <b>how "
    "much did they pay</b>. The dashboard reads those columns."))
A(P("If nobody fills them in, there is no show rate and no revenue — and there is nothing the "
    "software can do about that. This is the one part that is still a human job."))

A(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# PART TWO — the doing
# ═══════════════════════════════════════════════════════════════════════════

A(P("PART TWO", "part"))
A(P("Setting it up", "h1"))
A(P("Nearly all of this is done for you. Open the project folder in <b>Claude Code</b> and "
    "say:", "lead"))
A(code(["install this"]))
A(P("It will ask you about your business, then build everything. What follows is only the "
    "handful of things a person has to go and get themselves — Claude cannot log into your "
    "accounts for you.", "lead"))
A(P("Roughly 45 minutes, and most of that is waiting for accounts to finish creating.", "small"))

A(P("The four things to collect", "h1"))
A(P("Get these first and the rest goes quickly. Claude will ask you for them."))
A(table([
    ["", "What", "Where", "What it is for"],
    ["1", "Supabase token", "supabase.com", "Where your numbers get stored"],
    ["2", "Meta ad account id + token", "business.facebook.com", "Your ad spend"],
    ["3", "Vercel token", "vercel.com", "Puts it on the internet"],
    ["4", "Your sales sheet link", "Google Sheets", "Your money. Optional, but no ROAS without it"],
], [0.3 * inch, 1.85 * inch, 1.5 * inch, 2.85 * inch]))

A(P("1. Supabase — where the numbers live", "h1"))
A(P("A database is just the filing cabinet the numbers get kept in. This one is free."))
A(steps([
    "Go to <b>supabase.com</b> and make an account.",
    "Go to <b>supabase.com/dashboard/account/tokens</b>",
    "Click <b>Generate new token</b>. Name it anything.",
    "Copy it and give it to Claude.",
]))
A(P("That is all. Claude makes the project and builds everything inside it from that one "
    "token — you do not need to click around in Supabase at all.", "small"))

A(P("2. Meta — your ad spend", "h1"))
A(P("Two things: which ad account, and permission to read it."))
A(P("Your ad account id", "h2"))
A(P("Open <b>Ads Manager</b>. It is at the top left, next to the account name. It looks "
    "like <font face='Courier'>act_123456789</font>."))
A(P("Your access token", "h2"))
A(P("Use the kind that never expires. The normal kind stops working after about two months "
    "and takes your dashboard down with no warning when it does."))
A(steps([
    "Go to <b>business.facebook.com</b> → <b>Business Settings</b>",
    "In the left menu: <b>Users</b> → <b>System Users</b>",
    "Click <b>Add</b>. Name it anything. Set the role to <b>Admin</b>.",
    "Click <b>Add Assets</b> → <b>Ad Accounts</b> → tick your ad account → turn on "
    "<b>Manage campaigns</b>",
    "Click <b>Generate New Token</b>. Pick your app. Tick <b>ads_read</b> and "
    "<b>ads_management</b>. Set expiry to <b>Never</b>.",
    "Copy it. It is only shown once.",
]))
A(callout("This is the fiddliest part of the whole setup.",
          "If you get lost, say so to Claude and it will walk you through the screen you are "
          "actually looking at. Everything after this is easier."))

A(P("3. Vercel — where the website lives", "h1"))
A(steps([
    "Go to <b>vercel.com</b> and make an account.",
    "Go to <b>vercel.com/account/tokens</b>",
    "Click <b>Create Token</b>. Name it anything.",
    "Copy it and give it to Claude.",
]))

A(P("4. Your sales spreadsheet", "h1"))
A(P("This is where money comes from. Skip it and you still get spend, DMs, booked calls and "
    "show rate — but no revenue, and no ROAS."))
A(steps([
    "Open your sales tracker in Google Sheets.",
    "Click <b>Share</b> (top right) → under <b>General access</b>, change "
    "<b>Restricted</b> to <b>Anyone with the link</b>. Leave it as <b>Viewer</b>.",
    "Copy the link from your browser's address bar.",
    "Give it to Claude, and <b>paste in your top row too</b> — the row with your column "
    "names in it.",
]))
A(callout("This app can only read your sheet. It can never write to it or change it.",
          "It also never converts your money between currencies. What you typed is what it "
          "shows."))
A(P("The most valuable column you can have is one where whoever takes the call pastes the "
    "<b>ManyChat chat link</b> for that person. That link is what ties a sale back to the DM, "
    "and therefore back to the ad. Without it, sales get matched on name alone, which is much "
    "weaker. If you do not have that column, add it now."))

A(PageBreak())

# ── connecting ───────────────────────────────────────────────────────────
A(P("PART TWO", "part"))
A(P("Connecting your DMs and your calls", "h1"))
A(P("Claude will give you two web addresses. You paste one into ManyChat, and one into "
    "whatever you book calls with. This is what makes DMs and bookings show up.", "lead"))

A(P("ManyChat", "h2"))
A(P("You already have an automation that fires when someone sends your keyword. You are "
    "adding one step to the end of it."))
A(steps([
    "Open the automation for that keyword.",
    "Add a step. Choose <b>External Request</b>.",
    "Set the method to <b>POST</b>.",
    "Paste in the address Claude gave you.",
    "For the body, paste what Claude gives you — it is three lines and it includes that "
    "keyword's word.",
]))
A(P("You do this once per keyword. Five live keywords means five automations, and you are "
    "adding one step to each."))

A(P("Your booking tool", "h2"))
A(P("Same idea: whatever fires when a call gets booked, add a step that sends it to the "
    "second address. GoHighLevel, Calendly and most others can all do this — the menus are "
    "named differently, so tell Claude which one you use and it will give you the exact steps."))
A(callout("Send the ManyChat ID through if you possibly can.",
          "It is the single thing that ties a booked call back to the DM that caused it, and "
          "therefore back to the ad. Without it a lot of your bookings will show as "
          "unattributed. Ask Claude how to carry it through in your particular booking tool."))

A(P("Then mark your sales calendars", "h2"))
A(P("Once a few real bookings have come in, Claude runs one command that lists every calendar "
    "in your account. You tell it which ones are <b>sales calls</b> — not onboarding calls, "
    "not coaching calls."))
A(P("Until that is done, booked calls show as zero. It is the most common reason someone "
    "thinks the dashboard is broken when it is not.", "small"))

# ── after ────────────────────────────────────────────────────────────────
A(P("When it is done", "h1"))
A(P("You get your own web address, something like <font face='Courier'>your-name.vercel."
    "app</font>. You sign in with a password you picked. It works on your phone."))
A(P("It updates itself every hour, whether your computer is on or not."))

A(P("Check these four things before you call it finished", "h2"))
A(table([
    ["", "Check"],
    ["&#9744;", "Your ad spend is showing"],
    ["&#9744;", "Send yourself a test DM with one of your keywords — it appears in the DM column"],
    ["&#9744;", "Book a test call — it appears in the booked column"],
    ["&#9744;", "Ask Claude to run the setup check, and it comes back clean"],
], [0.3 * inch, 6.2 * inch]))
A(P("If any of those is zero, tell Claude. A setup that finished but shows an empty table is "
    "not finished, and you will not notice for a week."))

A(P("If something looks wrong later", "h1"))
A(P("Tell Claude what you are seeing, in your own words. It has a check built in that finds "
    "most problems by itself. The usual ones:"))
A(table([
    ["What you see", "What it usually is"],
    ["Everything is empty", "Something did not finish connecting. Ask Claude to run the check."],
    ["Spend, but no DMs", "The ManyChat step is not firing."],
    ["DMs, but no booked calls", "Your sales calendars have not been marked yet."],
    ["Booked calls look too low", "You have two calendars with almost the same name, and your bookings are split between them."],
    ["An ad shows spend and nothing else", "Its name does not end in its keyword. Rule 1."],
    ["Sales show as unattributed", "No ManyChat link column in your sheet, so there is nothing to match on."],
], [2.35 * inch, 4.15 * inch]))

A(Spacer(1, 14))
A(rule())
A(Spacer(1, 10))
A(P("<b>The one thing to remember:</b> put the keyword at the end of the ad's name, and never "
    "run the same word twice at once. Everything else, Claude handles.", "small"))

doc = BaseDocTemplate(
    os.path.abspath(OUT), pagesize=LETTER,
    leftMargin=1 * inch, rightMargin=1 * inch,
    topMargin=0.95 * inch, bottomMargin=0.9 * inch,
    title="Ads — Setup Guide", author="Ads",
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="body")
doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=header_footer)])
doc.build(story)
print(f"wrote {os.path.abspath(OUT)}")
