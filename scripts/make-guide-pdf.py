#!/usr/bin/env python3
"""Build the one document a human reads.

WHO THIS IS FOR, and it matters more than anything else in this file:

A coach who runs DM ads. Right now they keep one Google Sheet per campaign and
type numbers into it by hand off Ads Manager. Their ManyChat setup is ONE
automation: someone sends the keyword, ManyChat replies with a message. That is
all of it. No custom fields. No action steps. No tags. They send booking links
by hand in the chat. They have never heard of a UTM.

So: assume nothing. Define every term the first time it appears. Start from what
they already have on screen and add to it. Never say "simply" or "just" about
something that is not.

Contains NO webhook addresses, secrets, or request bodies — those are generated
per install and handed over privately.

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

VERSION = "v3"
OUT = os.path.join(
    os.path.dirname(__file__), "..", "docs", f"DM-Ads-Attribution-Guide-{VERSION}.pdf"
)

INK = colors.HexColor("#16161a")
MUTED = colors.HexColor("#5f6169")
FAINT = colors.HexColor("#8b8d95")
RULE = colors.HexColor("#dcdce0")
BOXBG = colors.HexColor("#f5f5f3")
TEACHBG = colors.HexColor("#eef2f5")
CODEBG = colors.HexColor("#f0f0ee")
ACCENT = colors.HexColor("#9a7b3f")
TEACHBAR = colors.HexColor("#5b7d99")

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
S["h2"] = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11.5, leading=15.5,
                         textColor=INK, spaceBefore=16, spaceAfter=4)
S["body"] = ParagraphStyle("body", fontName="Helvetica", fontSize=10.5, leading=16.5,
                           textColor=INK, spaceAfter=9)
S["lead"] = ParagraphStyle("lead", fontName="Helvetica", fontSize=11.5, leading=17.5,
                           textColor=INK, spaceAfter=10)
S["small"] = ParagraphStyle("small", fontName="Helvetica", fontSize=9.4, leading=14,
                            textColor=MUTED, spaceAfter=7)
S["cell"] = ParagraphStyle("cell", fontName="Helvetica", fontSize=9.6, leading=14, textColor=INK)
S["cellhead"] = ParagraphStyle("cellhead", fontName="Helvetica-Bold", fontSize=9.6,
                               leading=14, textColor=INK)
S["code"] = ParagraphStyle("code", fontName="Courier", fontSize=9.4, leading=14.5, textColor=INK)
S["callout"] = ParagraphStyle("callout", fontName="Helvetica", fontSize=10, leading=15, textColor=INK)
S["li"] = ParagraphStyle("li", fontName="Helvetica", fontSize=10.5, leading=16.5,
                         textColor=INK, spaceAfter=6)


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


def callout(label, text, kind="warn"):
    inner = Paragraph(f"<b>{label}</b>&nbsp; {text}", S["callout"])
    bg, bar = (TEACHBG, TEACHBAR) if kind == "teach" else (BOXBG, ACCENT)
    t = Table([[inner]], colWidths=[6.5 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LINEBEFORE", (0, 0), (0, -1), 2.4, bar),
        ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    return KeepTogether([t, Spacer(1, 11)])


def teach(label, text):
    """A 'what this word means' sidebar. Different colour so it reads as optional."""
    return callout(label, text, kind="teach")


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
        bulletType="1", bulletFontName="Helvetica-Bold", bulletFontSize=10.5,
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
# PART ONE — the problem, described as their actual life
# ═══════════════════════════════════════════════════════════════════════════

A(P("DM Ads Attribution", "title"))
A(P("Know which ad actually made you money. And stop typing numbers into "
    "spreadsheets forever.", "sub"))
A(rule())
A(Spacer(1, 18))

A(P("Let me guess how you do this right now", "h1"))
A(P("You launch a campaign. You start a new Google Sheet for it, because the last one got "
    "messy.", "lead"))
A(P("Every few days you open Ads Manager, look at what you spent, and type it into the sheet. "
    "You ask your setter how many people booked. You type that in too. At the end of the month "
    "you look at what came in and type that in as well.", "lead"))
A(P("Then you sit there and try to work out which ad did it. And honestly, you cannot. You have "
    "a spend number, a revenue number, and a feeling.", "lead"))
A(P("You are not bad at this. Nobody ever built the thing that would let you do it properly. "
    "That is what this is."))

A(P("Why Facebook cannot help you", "h1"))
A(P("If you sent people to a website, Facebook would know everything. Someone taps your ad, "
    "lands on your page, buys — Facebook watches the whole thing and tells you which ad did it."))
A(P("DM ads do not work that way. The moment someone sends you a DM, everything moves into "
    "Instagram messages. Facebook cannot see the conversation. It cannot see the call get "
    "booked. It cannot see the money."))
A(P("So the one column you actually want — <b>which ad produced buyers</b> — does not exist in "
    "Ads Manager. It never has, and it never will."))

A(P("And the number it does show you is not real", "h2"))
A(P("Facebook shows you a cost per DM. Do not trust it."))
A(P("Facebook counts a \"conversation\" far more loosely than you would. Someone who taps your "
    "ad and types nothing can still get counted. So the number looks better than the truth — "
    "and it is the number you have been making budget decisions on."))
A(P("Your real cost per DM is almost always worse than what is on the screen. Which means some "
    "of the ads you think are working are not."))

A(PageBreak())

# ── what you get ─────────────────────────────────────────────────────────
A(P("PART ONE", "part"))
A(P("What you get instead", "h1"))
A(P("One page. One row per ad. Everything that ad actually produced, all the way to cash."))
A(code([
    "AD          SPENT    DMs    BOOKED   SHOWED   SALES    CASH     ROAS",
    "TRIM        $840     94     22       14       3        $4,100   4.9x",
    "MIGHTY      $610     71     9        5        1        $1,200   2.0x",
    "SUMMIT      $600     52     4        1        0        $0       0.0x",
]))
A(P("Made-up numbers, but that is the shape of it. And look how obvious the decision becomes. "
    "SUMMIT has eaten $600 and produced nothing. TRIM is printing. You would never have seen "
    "that in Ads Manager, because Ads Manager stops at the DM."))

A(P("And you stop typing things in", "h2"))
A(P("This is the part people underrate. Once it is running:"))
A(bullets([
    "your ad spend comes in by itself, every hour",
    "every DM records itself the second it lands",
    "every booked call records itself",
    "your sales come out of the tracker you already keep",
]))
A(P("Nobody logs anything. You are not chasing your setter for numbers on a Monday. You are not "
    "starting a new sheet for the next campaign. You open one page on your phone and it is "
    "already correct."))
A(P("Every campaign and every ad set you launch from then on is tracked from the minute it goes "
    "live. You do not have to do anything to add it."))

A(P("How much of this do you have to build?", "h2"))
A(P("Hardly any. You paste a link into Claude and answer questions about your business. It does "
    "the building."))
A(P("Your side is four things to copy from four websites, and about twenty minutes inside "
    "ManyChat, which this guide walks you through click by click."))

A(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# PART TWO — teach it properly
# ═══════════════════════════════════════════════════════════════════════════

A(P("PART TWO", "part"))
A(P("How it actually works", "h1"))
A(P("Worth ten minutes. Understand this bit and the rest of the setup makes sense — and you "
    "will know straight away why a number looks wrong later on.", "lead"))

A(P("Your keyword is a tracking number", "h1"))
A(P("Think about posting a parcel. It gets a tracking number, and that number stays with it the "
    "whole way. Warehouse, van, doorstep. You can always find out where it is, because the "
    "number never leaves the parcel."))
A(P("Your keyword is that tracking number."))
A(P("Your ad says <i>DM me TRIM</i>. TRIM is the number on this parcel. And TRIM has to stay "
    "attached to that person all the way from the ad to the money in your account."))

A(P("Let us follow one person", "h1"))
A(P("Sarah is scrolling Instagram on a Tuesday."))
A(P("<b>1. She sees your ad.</b> It says DM me the word TRIM. Behind the scenes this ad is "
    "<i>named</i> TRIM in Ads Manager, so the system already knows every dollar spent on it "
    "belongs to the word TRIM."))
A(P("<b>2. She DMs you TRIM.</b> ManyChat replies to her, the same as it does today. But now it "
    "also quietly writes down two things: who Sarah is, and that she said TRIM. That is one DM "
    "on the TRIM row."))
A(P("<b>3. Your setter chats to her.</b> Nothing changes here. Normal conversation."))
A(P("<b>4. Your setter books her.</b> Instead of pasting the calendar link by hand, they put a "
    "tag on her. ManyChat sends her the link automatically — and tucks TRIM inside that link "
    "where she never sees it. That is one booked call on the TRIM row."))
A(P("<b>5. She turns up.</b> Your booking tool tells the system she was there. One call taken "
    "on the TRIM row."))
A(P("<b>6. She buys.</b> You fill in your sales tracker like you always do, and paste her "
    "ManyChat chat link onto her row. That link is how the system knows this sale is Sarah — "
    "and Sarah was TRIM."))
A(P("<b>Done.</b> $2,000 lands on the TRIM row. You now know, for a fact, that ad produced a "
    "paying client."))

A(callout("That is the entire system.",
          "Five handoffs, and the keyword survives every one of them. Everything in the setup "
          "exists to make one of those handoffs happen without anybody having to think about "
          "it."))

A(PageBreak())

A(P("PART TWO", "part"))
A(P("Which handoffs are your job", "h1"))
A(P("Three of the five happen on their own once you are set up. Two are yours, forever."))
A(table([
    ["The handoff", "Who does it"],
    ["Ad → keyword", "<b>You.</b> By naming the ad after the keyword"],
    ["Keyword → DM", "Automatic, once ManyChat is set up"],
    ["DM → booked call", "Automatic, from the tag your setter applies"],
    ["Booked call → showed up", "Automatic, from your booking tool"],
    ["Sale → the person", "<b>You.</b> By pasting the ManyChat link on the sales row"],
], [2.3 * inch, 4.2 * inch]))
A(P("Both of yours take about three seconds each, and they are the whole difference between "
    "real numbers and blank ones. They get a section of their own next."))

A(P("What happens when a handoff breaks", "h1"))
A(P("Nothing dramatic. The chain stops there for that one person, and the system tells you "
    "instead of making something up."))
A(P("If an ad is named wrong, that ad shows its spend and zeros everywhere else. If the "
    "ManyChat link is missing from a sales row, that sale shows as <b>unattributed</b> — real "
    "money, unknown source."))

A(callout("This is the most important promise in the whole thing.",
          "It will never guess. If it cannot prove a sale came from a particular ad, it says "
          "so. Money you can see is unaccounted for is a problem you can go and fix. Money "
          "quietly credited to the wrong ad would have you scaling the wrong thing and never "
          "finding out. The blanks are a feature, not a fault."))

A(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# PART THREE — the two habits
# ═══════════════════════════════════════════════════════════════════════════

A(P("PART THREE", "part"))
A(P("Two habits, forever", "h1"))
A(P("No software can do these for you. Skipping them is the number one reason somebody ends up "
    "staring at an empty dashboard wondering what went wrong.", "lead"))

A(P("Habit 1 — name the ad after the keyword", "h1"))
A(P("When you make an ad in Ads Manager you give it a name. Whatever word that ad tells people "
    "to DM you — that is the name."))
A(table([
    ["Your ad tells people to send", "Name the ad"],
    ["TRIM", "<b>TRIM</b>"],
    ["MIGHTY", "<b>MIGHTY</b>"],
    ["SUMMIT", "<b>SUMMIT</b>"],
], [2.6 * inch, 3.9 * inch]))
A(P("That is genuinely it. Nothing else in the name. The keyword on its own is the cleanest way "
    "to do it, and it is how I name mine."))
A(callout("Want other stuff in the name too? Fine — but the keyword must be LAST.",
          "The system reads the <b>last word</b> of the name. So "
          "<font face='Courier'>Vets 35 | TRIM</font> works fine and reads as TRIM. But "
          "<font face='Courier'>TRIM retarget</font> reads as \"retarget\", and that ad will "
          "never be credited with anything, ever. If in doubt, just name it the keyword."))
A(P("An ad named wrong is not broken and nothing will warn you. It sits in your list showing "
    "its spend, with zeros in every other column, forever. That is the system being honest — "
    "it cannot tie a single DM to that ad, so it will not pretend it can."))

A(P("Habit 2 — one keyword, one live ad", "h1"))
A(P("Never have two ads running at the same time that both say DM me TRIM."))
A(P("If you do, and someone DMs TRIM and buys $3,000, there is no way on earth to know which of "
    "the two ads earned it. That is not a limit of this tool. Nothing could know that."))
A(P("Using a word again months later is fine. Just leave a few weeks after switching the first "
    "one off, so a straggler DM from the old ad does not get credited to the new one."))

A(PageBreak())

# ── the sales tracker ────────────────────────────────────────────────────
A(P("PART THREE", "part"))
A(P("Your sales tracker", "h1"))
A(P("You already keep one. It stays exactly where it is, and you keep working in it exactly the "
    "same way. The system just reads it.", "lead"))

A(callout("Two promises about your spreadsheet.",
          "It can only READ your sheet. It can never write to it, change it, move your columns "
          "or reorganise anything. And it never converts your money between currencies — what "
          "you typed is what it shows."))

A(P("One sheet, not one per campaign", "h2"))
A(P("If you currently start a fresh sheet for every campaign, stop doing that. Use one sheet."))
A(P("The only reason you were splitting them was to keep campaigns apart. That is now a column "
    "the system fills in for you, automatically, per ad. Far better than a separate file."))

A(P("The columns it reads", "h2"))
A(P("You almost certainly have most of these already. The names do not matter and the order "
    "does not matter — Claude reads your sheet, works out which column is which, and shows you "
    "so you can confirm it got it right."))
A(table([
    ["Column", "What it is for"],
    ["<b>Date</b>", "which day the call was. Required"],
    ["<b>Name</b>", "who it was. Required"],
    ["<b>ManyChat link</b>", "<b>the big one.</b> How a sale gets tied back to the DM, and so to the ad"],
    ["<b>Did they show</b>", "your show rate, and it separates a no-show from a lost sale"],
    ["<b>Cash collected</b>", "money actually in the bank. ROAS is worked out from this"],
    ["<b>Total contracted</b>", "the full deal value, for when it is more than you took today"],
    ["<b>Outcome</b>", "won, lost, no-show, follow-up"],
    ["<b>Closer</b> and <b>Setter</b>", "who took it, who set it"],
], [1.75 * inch, 4.75 * inch]))

A(P("You probably need to add one column", "h2"))
A(P("The <b>ManyChat link</b> column. Most people do not have this yet, and it is the single "
    "most valuable column in the sheet."))
A(P("When your setter books someone, they open that person in ManyChat, copy the link out of "
    "the address bar, and paste it on that person's row. Three seconds."))
A(P("Why it matters so much: without it, a sale gets matched to a DM <i>by name</i>. Two "
    "Sarahs, someone using a nickname, a typo, a maiden name — and the match quietly fails. "
    "With the link it is exact, every single time."))
A(callout("Add this column today, before you set anything else up.",
          "Rows already in your sheet without it can never be matched afterwards. Every day you "
          "wait is another day of sales that can never be traced back to an ad."))

A(P("And someone has to fill it in", "h2"))
A(P("Whoever takes the call fills in whether they showed up and what they paid. That has always "
    "been a human job and it stays one. Empty columns mean no show rate and no revenue — not "
    "broken, just nothing there to read."))

A(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# PART FOUR — collecting the four things
# ═══════════════════════════════════════════════════════════════════════════

A(P("PART FOUR", "part"))
A(P("Setting it up", "h1"))
A(P("Open Claude Code, paste in the link to the project, and tell it to install this.", "lead"))
A(P("It will ask you questions about your business — what you use for DMs, what you book calls "
    "with, what your ad account is. Then it builds the whole thing. You do not edit any files "
    "or write anything technical.", "lead"))
A(P("If you get stuck anywhere, tell it what you can see on your screen. That genuinely works — "
    "it will pick up from wherever you are."))

A(P("Four things to go and copy", "h1"))
A(P("Claude cannot log into your accounts, so these four are on you. Get them first and "
    "everything else goes quickly."))
A(table([
    ["", "What", "Where from", "What it is for"],
    ["1", "Supabase token", "supabase.com", "Where your numbers get stored"],
    ["2", "Meta ad account id and token", "business.facebook.com", "Your ad spend"],
    ["3", "Vercel token", "vercel.com", "Puts your dashboard on the internet"],
    ["4", "Your sales tracker link", "Google Sheets", "Your money"],
], [0.3 * inch, 2.0 * inch, 1.55 * inch, 2.65 * inch]))

A(teach("What is a \"token\"?",
        "A very long password that lets one app talk to another on your behalf. You generate "
        "it, copy it once, paste it in, and never look at it again. That is the whole idea."))

A(P("1. Supabase — where your numbers get stored", "h1"))
A(P("A database is just a filing cabinet for numbers. This one is free at the size you need."))
A(steps([
    "Go to <b>supabase.com</b> and make an account.",
    "Go to <b>supabase.com/dashboard/account/tokens</b>",
    "Click <b>Generate new token</b>. Name it anything you like.",
    "Copy it and paste it to Claude.",
]))
A(P("That is your entire involvement with Supabase. Claude builds everything inside it from "
    "that one token — you never have to click around in there.", "small"))

A(P("2. Meta — your ad spend", "h1"))
A(P("Two pieces: which ad account, and permission to read it."))
A(P("Your ad account id", "h2"))
A(P("Open <b>Ads Manager</b>. It is at the top left, next to the account name. It looks like "
    "<font face='Courier'>act_123456789</font>. Copy the whole thing, including the "
    "<font face='Courier'>act_</font> bit."))
A(P("Your access token", "h2"))
A(P("There are two kinds, and you want the one that never expires. The ordinary kind dies after "
    "about two months and takes your dashboard down with no warning, usually on a day you "
    "actually needed it."))
A(steps([
    "Go to <b>business.facebook.com</b>, then <b>Business Settings</b>",
    "In the left menu find <b>Users</b>, then <b>System Users</b>",
    "Click <b>Add</b>. Name it anything. Set the role to <b>Admin</b>.",
    "Click <b>Add Assets</b>, then <b>Ad Accounts</b>, tick your ad account, and turn on "
    "<b>Manage campaigns</b>",
    "Click <b>Generate New Token</b>. Pick your app. Tick <b>ads_read</b> and "
    "<b>ads_management</b>. Set expiry to <b>Never</b>.",
    "Copy it. Facebook only shows it to you once.",
]))
A(callout("This is the fiddliest thing in the whole setup.",
          "If you get lost, tell Claude the name of the screen you are looking at and it will "
          "pick up from there. Everything after this is easier."))

A(P("3. Vercel — where your dashboard lives", "h1"))
A(P("This is what turns it into a real website with a real address, instead of something that "
    "only works while your laptop is open."))
A(steps([
    "Go to <b>vercel.com</b> and make an account.",
    "Go to <b>vercel.com/account/tokens</b>",
    "Click <b>Create Token</b>. Name it anything.",
    "Copy it and paste it to Claude.",
]))

A(P("4. Your sales tracker", "h1"))
A(steps([
    "Open your sales tracker in Google Sheets.",
    "Click <b>Share</b>, top right.",
    "Under <b>General access</b>, change <b>Restricted</b> to <b>Anyone with the link</b>. "
    "Leave it set to <b>Viewer</b>.",
    "Copy the link out of your browser's address bar and paste it to Claude.",
]))
A(P("That is all you do. Claude reads your column names itself and tells you which column it "
    "thinks is which. You just check it got them right."))

A(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# PART FIVE — ManyChat, starting from nothing
# ═══════════════════════════════════════════════════════════════════════════

A(P("PART FIVE", "part"))
A(P("ManyChat", "h1"))
A(P("The longest part, so take your time. It is also the part that makes the whole thing work, "
    "so it is worth going slowly.", "lead"))

A(P("What you almost certainly have right now", "h2"))
A(P("One automation. A trigger that fires when someone sends your keyword, and a message that "
    "goes back to them. Like this:"))
A(code([
    "  When someone sends \"TRIM\"    ->    Send them a message",
]))
A(P("That is a perfectly good setup and you are not throwing any of it away. You are adding to "
    "it."))

A(P("What you are adding", "h2"))
A(bullets([
    "<b>Part A</b> — two extra steps on the end of the automation you already have, so every "
    "DM records itself",
    "<b>Part B</b> — one brand new automation, so booking someone also records which ad they "
    "came from",
]))

A(teach("Before you start, check you are on ManyChat Pro.",
        "One of the steps below (External Request) is a paid feature. If you cannot find it in "
        "the menu, that is why — it is not you being blind. Upgrading is the fix."))

A(P("Part A — recording every DM", "h1"))
A(P("Open the automation that already replies to your keyword. You will see your trigger box, "
    "and your message box after it."))

A(P("Step 1: save which word they sent", "h2"))
A(teach("What is a \"custom field\"?",
        "ManyChat keeps a little card on every person who messages you — their name, when they "
        "first wrote, and so on. A custom field is a blank box on that card that you get to "
        "name and fill in yourself. You are about to make one called <b>keyword</b> and put "
        "the word that person sent you into it. That is all a custom field is."))
A(steps([
    "Click the <b>+</b> underneath your message box.",
    "Choose <b>Action</b>. An empty box appears — think of it as a little to-do list ManyChat "
    "runs for that person. You have probably never used one of these. That is fine.",
    "Inside that box click <b>+ Add Action</b>, and pick <b>Set User Field</b>.",
    "For the field, choose to create a new one, and call it <b>keyword</b>.",
    "For the value, pick <b>Last Text Input</b> from the list.",
]))
A(callout("\"Last Text Input\" means: whatever they just typed.",
          "This is the clever bit. Because you are saving what they actually sent, <b>ONE "
          "automation handles all of your keywords at once.</b> You do not need one for TRIM "
          "and another for MIGHTY. Put every keyword on the same trigger and each person "
          "records themselves correctly."))

A(P("Step 2: send it over to your dashboard", "h2"))
A(P("Stay inside the same action box. Click <b>+ Add Action</b> again and pick "
    "<b>External Request</b>."))
A(teach("What is an \"External Request\"?",
        "It is ManyChat telling another app that something just happened. Like a text message "
        "from ManyChat to your dashboard saying \"Sarah just sent TRIM\". Nobody sees it, and "
        "it takes a fraction of a second."))
A(P("Claude gives you the exact address to paste in, and exactly what to put in each box. "
    "Follow what it gives you — it is filled in for your account specifically."))
A(callout("You will see a red \"Invalid JSON\" warning. Ignore it.",
          "ManyChat shows that while you are editing, because there is no real person for it to "
          "test with yet. It goes away the moment a genuine DM comes through. It is not an "
          "error and you have not done anything wrong."))
A(P("Save it. Part A is done — every DM now records itself."))

A(PageBreak())

# ── B. the booking automation ────────────────────────────────────────────
A(P("PART FIVE", "part"))
A(P("Part B — recording every booked call", "h1"))
A(P("This is a brand new automation. You have almost certainly never built anything like it, "
    "and it is the highest-value twenty minutes in this guide.", "lead"))

A(P("What you do today", "h2"))
A(P("When your setter is ready to book someone, they paste your calendar link into the chat by "
    "hand."))
A(P("That link tells you nothing. Someone books through it and it arrives with no idea who they "
    "are or which ad they came from. That is exactly why bookings are impossible to attribute "
    "at the moment."))

A(P("What you are replacing it with", "h2"))
A(P("Your setter puts a <b>tag</b> on the person instead. ManyChat spots the tag, sends the "
    "calendar link automatically, and slips that person's keyword inside the link on the way "
    "out."))
A(P("Same effort for the setter. Less, actually — one click instead of hunting for a link and "
    "pasting it."))

A(teach("What is a \"tag\"?",
        "A sticker you put on a person in ManyChat. That is genuinely all it is. You make up "
        "the name. The useful part is that ManyChat can watch for a sticker being applied and "
        "do something the moment it happens."))

A(P("Build it", "h2"))
A(steps([
    "In ManyChat go to <b>Settings</b>, then <b>Tags</b>, and make a new tag. Name it after "
    "the calendar it will send — something like <font face='Courier'>1_Day_Calendar</font>. "
    "If you offer more than one calendar, make one tag for each.",
    "Go to <b>Automation</b> and start a <b>New Automation</b>.",
    "For the trigger, choose <b>Contact event occurs</b>, then <b>Tag applied</b>, then pick "
    "the tag you just made.",
    "Add one step: <b>Send Message</b>.",
    "In that message, put your normal booking link — then add the keyword onto the end of it, "
    "exactly as described below.",
]))

A(P("Adding the keyword to the link", "h2"))
A(teach("What you are about to do, in plain terms.",
        "You are sticking a little label on the end of your booking link. When Sarah clicks it, "
        "the label travels along with her and lands in your booking tool, so it knows she came "
        "from TRIM. She never sees it and it changes nothing for her."))
A(P("Take your booking link and add this onto the end:"))
A(code(["?utm_content=", "", "...then insert your keyword field straight after the = sign"]))
A(P("So a finished link looks like this — where the last part is your keyword <i>field</i>, not "
    "typed-out text:"))
A(code(["https://your-booking-link.com/strategy-call?utm_content={keyword}"]))
A(P("To insert the field: while you are writing the message, use ManyChat's field picker — the "
    "little <font face='Courier'>{ }</font> button — and choose your <b>keyword</b> field. Do "
    "not type the word out with brackets around it yourself."))

A(callout("THE MOST IMPORTANT CHECK IN THIS WHOLE GUIDE: it has to be BLUE.",
          "When you insert the field properly, ManyChat shows it as a <b>blue chip</b> in the "
          "message. If it is plain black text, ManyChat will send the literal characters "
          "<font face='Courier'>{keyword}</font> to every single lead, and not one booking will "
          "ever be attributed. So look at it. Is it blue? Good. If it is black, delete it and "
          "insert it again using the field picker."))

A(P("If you offer more than one calendar — a one-day and a three-day, say — each tag needs its "
    "own automation, and every one of those links needs the keyword on it."))

A(P("Tell your setter what changed", "h2"))
A(P("From now on, their whole job when booking someone is: <b>apply the tag</b>. The link goes "
    "out by itself with the keyword already inside it."))
A(P("Say this to them out loud. If they keep pasting the old link by hand out of habit, those "
    "bookings arrive with nothing attached and can never be traced."))

A(P("Last piece: your booking tool", "h1"))
A(P("Whatever you book calls with — GoHighLevel, Calendly, anything — needs to tell the "
    "dashboard when a call actually gets booked."))
A(P("The menus are named differently in every tool, so tell Claude which one you use and it "
    "will give you the exact steps for yours."))

A(P("Which calendars count as sales calls", "h2"))
A(P("Claude asks you this during setup, before you ever open the dashboard. You just say which "
    "of your calendars are <b>sales calls</b> — not onboarding calls, not coaching calls. Those "
    "are real bookings, they are just not the thing you are measuring here."))

A(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# PART SIX — done
# ═══════════════════════════════════════════════════════════════════════════

A(P("PART SIX", "part"))
A(P("You are done. What now?", "h1"))
A(P("You have your own web address, something like <font face='Courier'>your-name.vercel."
    "app</font>, behind a password you picked. It works on your phone — put it on your home "
    "screen."))
A(P("It updates itself every hour, whether your laptop is on or not."))

A(P("Check these four before you trust it", "h2"))
A(table([
    ["", "Check", "If it comes back empty"],
    ["&#9744;", "Your ad spend is showing", "Tell Claude — usually the Meta token"],
    ["&#9744;", "Send yourself a test DM with one of your keywords. It shows up in the DM column",
     "The ManyChat action did not save"],
    ["&#9744;", "Put your booking tag on yourself. You get the link, and it has the keyword on "
     "the end of it", "The keyword is black, not blue"],
    ["&#9744;", "Ask Claude to run the setup check. It comes back clean", "It will tell you what to fix"],
], [0.3 * inch, 3.4 * inch, 2.8 * inch]))
A(P("Do not skip these. A setup that finished but shows an empty table is not finished, and you "
    "will not notice for a week."))

A(P("Give it two weeks before you judge an ad", "h2"))
A(P("The dashboard is instant. Your sales cycle is not. Someone who DMs you today might buy in "
    "ten days. A brand new ad showing zero sales on day two is not a bad ad, it is an ad you "
    "have not waited for yet."))
A(P("Cost per DM and cost per booked call tell you something within a couple of days. ROAS "
    "needs longer."))

A(P("When something looks off", "h1"))
A(P("Tell Claude what you are seeing, in normal words. There is a check built in that catches "
    "most of it. The usual suspects:"))
A(table([
    ["What you see", "What it almost always is"],
    ["One ad shows spend and zeros everywhere else", "Its name does not end in its keyword"],
    ["No DMs at all", "The ManyChat action did not save, or you are not on Pro"],
    ["Bookings arriving with no keyword on them", "The keyword in the booking link is black, not blue"],
    ["No booked calls at all", "Your sales calendars were never marked"],
    ["Booked calls look too low", "Two calendars with nearly the same name, splitting them"],
    ["Sales showing as unattributed", "No ManyChat link pasted on those rows"],
    ["Everything froze on a certain date", "Your Meta token expired. Make a System User one"],
], [2.6 * inch, 3.9 * inch]))

A(Spacer(1, 14))
A(rule())
A(Spacer(1, 10))
A(P("<b>The whole thing in one sentence:</b> the keyword goes at the end of the ad name, gets "
    "saved when they DM you, rides along inside the booking link, and lands on the sales row. "
    "Four handoffs. Claude builds three of them.", "small"))

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
