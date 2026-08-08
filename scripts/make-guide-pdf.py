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
something that is not. Analogies must come from running a business, not from
logistics or engineering.

Contains NO webhook addresses, secrets, or request bodies, those are generated
per install and handed over privately.

    npm run pdf
"""

import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, NextPageTemplate, PageTemplate, Paragraph,
    Spacer, Table, TableStyle, KeepTogether, ListFlowable, ListItem, PageBreak)

VERSION = "v4"
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "docs", f"DM-Ads-Attribution-Guide-{VERSION}.pdf")
REPO = "github.com/alexwalsh520-dot/ads-v2"

# ── type ──────────────────────────────────────────────────────────────────
# Inter, bundled in scripts/fonts. Friendlier and rounder than Helvetica, and
# bundling it means anyone rebuilding this gets the same document rather than a
# silent fallback to something else.
FONTS = os.path.join(HERE, "fonts")
HAS_INTER = os.path.exists(os.path.join(FONTS, "Inter-Regular.ttf"))
if HAS_INTER:
    pdfmetrics.registerFont(TTFont("Inter", os.path.join(FONTS, "Inter-Regular.ttf")))
    pdfmetrics.registerFont(TTFont("Inter-SemiBold", os.path.join(FONTS, "Inter-SemiBold.ttf")))
    pdfmetrics.registerFont(TTFont("Inter-Bold", os.path.join(FONTS, "Inter-Bold.ttf")))
    pdfmetrics.registerFontFamily("Inter", normal="Inter", bold="Inter-Bold")
    BODY_FONT, BOLD_FONT, HEAD_FONT = "Inter", "Inter-Bold", "Inter-Bold"
    SEMI_FONT = "Inter-SemiBold"
else:
    BODY_FONT, BOLD_FONT, HEAD_FONT, SEMI_FONT = (
        "Helvetica", "Helvetica-Bold", "Helvetica-Bold", "Helvetica-Bold")

# ── colour ────────────────────────────────────────────────────────────────
INK = colors.HexColor("#15161a")
MUTED = colors.HexColor("#5a5f6b")
FAINT = colors.HexColor("#9aa0ab")
RULE = colors.HexColor("#e4e6ea")
YELLOW = colors.HexColor("#FFDF55")       # the accent from the reference page
YELLOW_SOFT = colors.HexColor("#FFF8DC")
TEACHBG = colors.HexColor("#F4F6F8")
TEACHBAR = colors.HexColor("#8B95A5")
CODEBG = colors.HexColor("#F7F7F5")

base = getSampleStyleSheet()

S = {}
S["title"] = ParagraphStyle("title", parent=base["Title"], fontName=HEAD_FONT,
                            fontSize=32, leading=36, alignment=TA_LEFT, textColor=INK, spaceAfter=10)
S["sub"] = ParagraphStyle("sub", fontName=BODY_FONT, fontSize=13, leading=20,
                          textColor=MUTED, spaceAfter=20)
S["part"] = ParagraphStyle("part", fontName=SEMI_FONT, fontSize=8.5,
                           textColor=FAINT, spaceBefore=4, spaceAfter=3)
S["h1"] = ParagraphStyle("h1", fontName=HEAD_FONT, fontSize=17.5, leading=23,
                         textColor=INK, spaceBefore=26, spaceAfter=6)
S["h2"] = ParagraphStyle("h2", fontName=SEMI_FONT, fontSize=12, leading=16,
                         textColor=INK, spaceBefore=17, spaceAfter=5)
S["body"] = ParagraphStyle("body", fontName=BODY_FONT, fontSize=10.5, leading=17,
                           textColor=INK, spaceAfter=10)
S["lead"] = ParagraphStyle("lead", fontName=BODY_FONT, fontSize=11.5, leading=18.5,
                           textColor=INK, spaceAfter=11)
S["small"] = ParagraphStyle("small", fontName=BODY_FONT, fontSize=9.5, leading=15,
                            textColor=MUTED, spaceAfter=8)
S["cell"] = ParagraphStyle("cell", fontName=BODY_FONT, fontSize=9.7, leading=14.5, textColor=INK)
S["cellhead"] = ParagraphStyle("cellhead", fontName=SEMI_FONT, fontSize=9.7,
                               leading=14.5, textColor=INK)
S["code"] = ParagraphStyle("code", fontName="Courier", fontSize=9.3, leading=14.5, textColor=INK)
S["callout"] = ParagraphStyle("callout", fontName=BODY_FONT, fontSize=10.2, leading=16, textColor=INK)
S["li"] = ParagraphStyle("li", fontName=BODY_FONT, fontSize=10.5, leading=17,
                         textColor=INK, spaceAfter=7)


def P(text, style="body"):
    return Paragraph(text, S[style])


class RoundedBox(Flowable):
    """A soft-cornered panel. Rounded corners read as friendly; square ones read
    as a compliance document, and this is meant to be enjoyable to work through."""

    def __init__(self, content, width, fill, stroke=None, radius=9, pad=13, bar=None):
        Flowable.__init__(self)
        self.content, self.boxwidth = content, width
        self.fill, self.stroke, self.radius, self.pad, self.bar = fill, stroke, radius, pad, bar
        self._h = 0

    def wrap(self, availWidth, availHeight):
        inner = self.boxwidth - 2 * self.pad - (6 if self.bar else 0)
        _, h = self.content.wrap(inner, availHeight)
        self._h = h + 2 * self.pad
        return self.boxwidth, self._h

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(self.fill)
        if self.stroke:
            c.setStrokeColor(self.stroke)
            c.setLineWidth(0.8)
        c.roundRect(0, 0, self.boxwidth, self._h, self.radius,
                    stroke=1 if self.stroke else 0, fill=1)
        if self.bar:
            c.setFillColor(self.bar)
            c.roundRect(0, 0, 5, self._h, 2.5, stroke=0, fill=1)
        c.restoreState()
        offset = self.pad + (6 if self.bar else 0)
        self.content.drawOn(c, offset, self.pad)


def code(lines):
    body = "<br/>".join(l.replace(" ", "&nbsp;") for l in lines)
    box = RoundedBox(Paragraph(body, S["code"]), 6.5 * inch, CODEBG, radius=8, pad=13)
    return KeepTogether([box, Spacer(1, 12)])


def callout(label, text):
    """A warning or an emphasis. Yellow, like the reference page's accent."""
    inner = Paragraph(f"<b>{label}</b>&nbsp; {text}", S["callout"])
    box = RoundedBox(inner, 6.5 * inch, YELLOW_SOFT, stroke=YELLOW, radius=10, pad=14)
    return KeepTogether([box, Spacer(1, 13)])


def teach(label, text):
    """A 'what this word means' sidebar. Grey, so it reads as optional."""
    inner = Paragraph(f"<b>{label}</b>&nbsp; {text}", S["callout"])
    box = RoundedBox(inner, 6.5 * inch, TEACHBG, radius=10, pad=14, bar=TEACHBAR)
    return KeepTogether([box, Spacer(1, 13)])


def table(rows, widths, head=True):
    data = []
    for i, row in enumerate(rows):
        style = "cellhead" if (head and i == 0) else "cell"
        data.append([Paragraph(c, S[style]) for c in row])
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0)
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, RULE),
    ]
    if head:
        cmds.append(("LINEBELOW", (0, 0), (-1, 0), 1.2, INK))
    t.setStyle(TableStyle(cmds))
    return [t, Spacer(1, 14)]


def steps(items):
    return ListFlowable(
        [ListItem(Paragraph(t, S["li"]), leftIndent=22) for t in items],
        bulletType="1", bulletFontName=BOLD_FONT, bulletFontSize=10.5,
        leftIndent=22, bulletDedent=22, spaceAfter=12)


def bullets(items):
    return ListFlowable(
        [ListItem(Paragraph(t, S["li"]), leftIndent=16) for t in items],
        bulletType="bullet", bulletFontSize=6, leftIndent=16, bulletDedent=12, spaceAfter=12)


def rule():
    t = Table([[""]], colWidths=[6.5 * inch], rowHeights=[1])
    t.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 2.2, YELLOW)]))
    return KeepTogether([t, Spacer(1, 2)])


def header_footer(canvas, doc):
    canvas.saveState()
    if doc.page > 1:
        canvas.setFont(SEMI_FONT, 7.6)
        canvas.setFillColor(FAINT)
        canvas.drawString(1 * inch, LETTER[1] - 0.62 * inch, "DM ADS ATTRIBUTION")
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(1 * inch, LETTER[1] - 0.72 * inch, LETTER[0] - 1 * inch, LETTER[1] - 0.72 * inch)
    canvas.setFont(BODY_FONT, 7.6)
    canvas.setFillColor(FAINT)
    canvas.drawRightString(LETTER[0] - 1 * inch, 0.62 * inch, str(doc.page - 1))
    canvas.restoreState()



# ═══════════════════════════════════════════════════════════════════════════
# THE COVER
# ═══════════════════════════════════════════════════════════════════════════

NEAR_BLACK = colors.HexColor("#0B0C0F")
COVER_GREY = colors.HexColor("#8A909C")


def draw_tracked(c, x, y, text, font, size, colour, tracking, centred_on=None):
    """Letter-spaced text. Tracking is what makes a small all-caps label read as
    deliberate rather than cramped, and it lives on a text object here."""
    if centred_on is not None:
        width = pdfmetrics.stringWidth(text, font, size) + tracking * (len(text) - 1)
        x = centred_on - width / 2
    t = c.beginText(x, y)
    t.setFont(font, size)
    t.setFillColor(colour)
    t.setCharSpace(tracking)
    t.textOut(text)
    # Put it back. Character spacing persists in the PDF text state, so leaving
    # it set quietly tracks out everything drawn afterwards.
    t.setCharSpace(0)
    c.drawText(t)


def fit_size(text, font, max_width, start, floor=18):
    """Largest point size at which `text` still fits `max_width`."""
    size = start
    while size > floor and pdfmetrics.stringWidth(text, font, size) > max_width:
        size -= 0.5
    return size


def draw_chain(c, x, y, width):
    """The funnel, as the product's own shorthand. Spend goes in on the left,
    cash comes out on the right, and only the last step is lit, because that
    last step is the one nothing else can currently show you."""
    steps = ["SPEND", "DMs", "BOOKED", "SHOWED", "SALES", "CASH"]
    gap = width / (len(steps) - 1)
    for i, label in enumerate(steps):
        cx = x + i * gap
        lit = i == len(steps) - 1
        # connector to the previous node
        if i:
            c.setStrokeColor(YELLOW if lit else colors.HexColor("#2A2D34"))
            c.setLineWidth(1.4 if lit else 1)
            c.line(cx - gap + 13, y, cx - 13, y)
        c.setFillColor(YELLOW if lit else colors.HexColor("#3A3E47"))
        r = 5.5 if lit else 3.5
        c.circle(cx, y, r, stroke=0, fill=1)
        draw_tracked(c, 0, y - 19, label, SEMI_FONT, 7.4,
                     YELLOW if lit else COVER_GREY, 0.9, centred_on=cx)


def cover_page(canvas, doc):
    W, H = LETTER
    c = canvas
    c.saveState()

    c.setFillColor(NEAR_BLACK)
    c.rect(0, 0, W, H, stroke=0, fill=1)

    # A yellow spine down the left edge. One strong shape, doing the work that
    # a stock photograph would do badly.
    c.setFillColor(YELLOW)
    c.rect(0, 0, 14, H, stroke=0, fill=1)

    left = 1.15 * inch
    right_edge = W - 1.0 * inch
    usable = right_edge - left
    # The headline gets a little less than the full column so it never runs up
    # against the edge of the page.
    headline_width = usable * 0.94

    # eyebrow
    draw_tracked(c, left, H - 1.95 * inch, "DM ADS ATTRIBUTION", SEMI_FONT, 8.5, YELLOW, 2.4)

    # headline, hand-broken so the rag is deliberate rather than accidental
    lines = ["The first software", "for fitness coaches", "running DM ad funnels."]
    size = min(fit_size(l, HEAD_FONT, headline_width, 42) for l in lines)
    y = H - 2.85 * inch
    c.setFont(HEAD_FONT, size)
    c.setFillColor(colors.white)
    for line in lines:
        c.drawString(left, y, line)
        y -= size * 1.16

    # the promise, in the plainest words available
    y -= 0.30 * inch
    c.setFont(BODY_FONT, 13)
    c.setFillColor(COVER_GREY)
    c.drawString(left, y, "Know which ad actually made you money.")
    y -= 20
    c.drawString(left, y, "Down to the dollar, per ad, updating on its own.")

    # short rule
    y -= 0.5 * inch
    c.setStrokeColor(YELLOW)
    c.setLineWidth(2.6)
    c.line(left, y, left + 62, y)

    # Directly under the rule, so it reads as part of the same block rather
    # than a third thing stranded in the middle of the page.
    draw_chain(c, left + 10, y - 1.15 * inch, usable - 36)

    # a hairline separating the mark from the byline
    c.setStrokeColor(colors.HexColor("#22252B"))
    c.setLineWidth(0.8)
    c.line(left, 1.72 * inch, right_edge, 1.72 * inch)

    # byline
    c.setFont(SEMI_FONT, 11.5)
    c.setFillColor(colors.white)
    c.drawString(left, 1.30 * inch, "by Alex Walsh")
    c.setFont(BODY_FONT, 9.3)
    c.setFillColor(COVER_GREY)
    c.drawString(left, 1.30 * inch - 17, "Setup guide, and how it works")

    c.setFont(BODY_FONT, 8.3)
    c.setFillColor(colors.HexColor("#565C68"))
    c.drawRightString(right_edge, 1.30 * inch - 17, REPO)

    c.restoreState()


story = []


def A(item):
    story.extend(item) if isinstance(item, list) else story.append(item)


# ═══════════════════════════════════════════════════════════════════════════
# PART ONE, the problem, described as their actual life
# ═══════════════════════════════════════════════════════════════════════════

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
    "lands on your page, buys, and Facebook watches the whole thing and tells you which ad did it."))
A(P("DM ads do not work that way. The moment someone sends you a DM, everything moves into "
    "Instagram messages. Facebook cannot see the conversation. It cannot see the call get "
    "booked. It cannot see the money."))
A(P("So the one column you actually want, <b>which ad produced buyers</b>, does not exist in "
    "Ads Manager. It never has, and it never will."))

A(P("And the number it does show you is not real", "h2"))
A(P("Facebook shows you a cost per DM. Do not trust it."))
A(P("Facebook counts a \"conversation\" far more loosely than you would. Someone who taps your "
    "ad and types nothing can still get counted. So the number looks better than the truth, "
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
    "STRONG      $840     94     22       14       3        $4,100   4.9x",
    "SHREDDED    $610     71     9        5        1        $1,200   2.0x",
    "SUMMIT      $600     52     4        1        0        $0       0.0x",
]))
A(P("Made-up numbers, but that is the shape of it. And look how obvious the decision becomes. "
    "SUMMIT has eaten $600 and produced nothing. STRONG is printing. You would never have seen "
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
    "starting a new sheet for the next campaign. You open one page and it is already correct."))
A(P("Every campaign and every ad set you launch from then on is tracked from the minute it goes "
    "live. You do not have to do anything to add it."))

A(P("How much of this do you have to build?", "h2"))
A(P("Hardly any. You paste a link into Claude and answer questions about your business. It does "
    "the building."))
A(P("Your side is four things to copy from four websites, and about twenty minutes inside "
    "ManyChat, which this guide walks you through click by click."))

A(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# PART TWO, teach it properly
# ═══════════════════════════════════════════════════════════════════════════

A(P("PART TWO", "part"))
A(P("How it actually works", "h1"))
A(P("Worth ten minutes. Understand this bit and the rest of the setup makes sense, and you "
    "will know straight away why a number looks wrong later on.", "lead"))

A(P("Your keyword works like a promo code", "h1"))
A(P("You already know how a promo code works. You give one code to one podcast and a different "
    "code to another. When the orders come in, the code tells you which one sent them. Same "
    "product, same checkout, the code is the only thing that separates them."))
A(P("Your keyword is that code."))
A(P("Your ad says <i>DM me STRONG</i>. Anyone who sends you STRONG came from that ad. Not "
    "probably. Definitely."))

A(P("Which is why one ad gets one word", "h2"))
A(P("Think about what happens if you give the same promo code to two podcasts. The orders come "
    "in, they all say the same code, and you have no idea which show actually worked. The code "
    "stops telling you anything."))
A(P("Exactly the same here. One ad, one word. If two ads are both running STRONG at the same "
    "time, and someone DMs STRONG and buys, nothing on earth can tell you which ad earned it."))
A(P("So every live ad gets its own word. That is the whole rule."))

A(P("Let us follow one person", "h1"))
A(P("Sarah is scrolling Instagram on a Tuesday."))
A(P("<b>1. She sees your ad.</b> It says DM me the word STRONG. Behind the scenes this ad is "
    "<i>named</i> STRONG in Ads Manager, so the system already knows every dollar spent on it "
    "belongs to the word STRONG."))
A(P("<b>2. She DMs you STRONG.</b> ManyChat replies to her, the same as it does today. But now "
    "it also quietly writes down two things: who Sarah is, and that she said STRONG. That is "
    "one DM on the STRONG row."))
A(P("<b>3. Your setter chats to her.</b> Nothing changes here. Normal conversation."))
A(P("<b>4. Your setter books her.</b> Instead of pasting the calendar link by hand, they put a "
    "tag on her, a sticker, basically. You will build a small automation (this guide walks you "
    "through it) that watches for that sticker and sends the calendar link the moment it "
    "appears. And the link it sends has STRONG tucked inside it, where Sarah never sees it. "
    "That is one booked call on the STRONG row."))
A(P("<b>5. Your setter pastes her ManyChat link into your sales sheet</b>, right there, at the "
    "moment they book her. Three seconds, while they are still looking at the conversation. "
    "This is the one genuinely new habit in the whole system."))
A(P("<b>6. She turns up, and she buys.</b> Your closer fills in the sheet exactly as they do "
    "today: ticks that she showed, writes what she paid. Nothing new for them at all."))
A(P("<b>7. That is what the dashboard reads.</b> Because Sarah's ManyChat link is sitting on "
    "that row, the system knows this row is Sarah, and it already knew Sarah was STRONG."))
A(P("<b>Done.</b> $2,000 lands on the STRONG row. You now know, for a fact, that ad produced a "
    "paying client."))

A(callout("That is the entire system.",
          "The keyword survives every step. Everything in the setup "
          "exists to make one of those handoffs happen without anybody having to think about "
          "it."))

A(PageBreak())

A(P("PART TWO", "part"))
A(P("You are not adding a new job", "h1"))
A(P("This is worth being straight about, because it is the thing that makes or breaks whether "
    "this actually works for you.", "lead"))
A(P("Nothing here detects who showed up to a call. No software can. It knows because "
    "<b>somebody ticked a box in your sales tracker</b>, the same box your closer already "
    "ticks after every call."))
A(P("That is the whole trick. You are not building a new process on top of your business. You "
    "are turning the admin your team already does into an attribution system.", "lead"))

A(P("Who does what", "h2"))
A(table([
    ["The handoff", "Who does it"],
    ["Ad → keyword", "<b>You</b>, when you name the ad"],
    ["Keyword → DM", "Automatic, once ManyChat is set up"],
    ["DM → booked call", "Automatic, from the tag your setter applies"],
    ["Booked call → the person", "<b>Whoever books it</b>, pasting the ManyChat link on the row"],
    ["Did they show up", "<b>Your closer</b>, ticking the column they already tick"],
    ["Did they buy, and for how much", "<b>Your closer</b>, filling the columns they already fill"],
], [2.4 * inch, 4.1 * inch]))

A(P("Look at that list again. Four of the six are either automatic or something your team is "
    "already doing today. The only genuinely new habit is pasting the ManyChat link when you "
    "book someone, and that is three seconds while you are already looking at the "
    "conversation."))
A(callout("Which also means the reverse is true.",
          "If your tracker stops getting filled in, your show rate and your revenue go blank. "
          "Not wrong, blank. The system will not invent them. So the discipline your team "
          "already has around the tracker is now doing double duty: it runs your sales "
          "process AND it powers every number on the dashboard."))

A(P("What happens when a handoff breaks", "h1"))
A(P("Nothing dramatic. The chain stops there for that one person, and the system tells you "
    "instead of making something up."))
A(P("If an ad is named wrong, that ad shows its spend and zeros everywhere else. If the "
    "ManyChat link is missing from a row, that sale shows as <b>unattributed</b>, real money, "
    "unknown source."))

A(callout("This is the most important promise in the whole thing.",
          "It will never guess. If it cannot prove a sale came from a particular ad, it says "
          "so. Money you can see is unaccounted for is a problem you can go and fix. Money "
          "quietly credited to the wrong ad would have you scaling the wrong thing and never "
          "finding out. The blanks are a feature, not a fault."))

A(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# PART THREE, the two habits
# ═══════════════════════════════════════════════════════════════════════════

A(P("PART THREE", "part"))
A(P("Two habits, forever", "h1"))
A(P("No software can do these for you. Skipping them is the number one reason somebody ends up "
    "staring at an empty dashboard wondering what went wrong.", "lead"))

A(P("Habit 1, name the ad after the keyword", "h1"))
A(P("When you make an ad in Ads Manager you give it a name. Whatever word that ad tells people "
    "to DM you, that is the name."))
A(table([
    ["Your ad tells people to send", "Name the ad"],
    ["STRONG", "<b>STRONG</b>"],
    ["SHREDDED", "<b>SHREDDED</b>"],
    ["SUMMIT", "<b>SUMMIT</b>"],
], [2.6 * inch, 3.9 * inch]))
A(P("That is genuinely it. Nothing else in the name. The keyword on its own is the cleanest way "
    "to do it, and it is how I name mine."))
A(callout("Want other stuff in the name too? Fine, but the keyword must be LAST.",
          "The system reads the <b>last word</b> of the name. So "
          "<font face='Courier'>Vets 35 | STRONG</font> works fine and reads as STRONG. But "
          "<font face='Courier'>STRONG retarget</font> reads as \"retarget\", and that ad will "
          "never be credited with anything, ever. If in doubt, just name it the keyword."))
A(P("An ad named wrong is not broken and nothing will warn you. It sits in your list showing "
    "its spend, with zeros in every other column, forever. That is the system being honest: "
    "it cannot tie a single DM to that ad, so it will not pretend it can."))

A(P("Habit 2, one keyword, one live ad", "h1"))
A(P("The promo code rule from earlier. Never have two ads running at the same time that both "
    "say DM me STRONG."))
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
          "or reorganise anything. And it never converts your money between currencies, what "
          "you typed is what it shows."))

A(P("One sheet, not one per campaign", "h2"))
A(P("If you currently start a fresh sheet for every campaign, stop doing that. Use one sheet."))
A(P("The only reason you were splitting them was to keep campaigns apart. That is now a column "
    "the system fills in for you, automatically, per ad. Far better than a separate file."))

A(P("The columns it reads", "h2"))
A(P("You almost certainly have most of these already. The names do not matter and the order "
    "does not matter, Claude reads your sheet, works out which column is which, and shows you "
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
A(P("Why it matters so much: without it, a sale gets matched to a DM <i>by name</i>. Two "
    "Sarahs, someone using a nickname, a typo, a maiden name, and the match quietly fails. "
    "With the link it is exact, every single time."))

A(P("Whoever books the call fills it in, when they book it", "h2"))
A(P("Not at the end of the week. Not when the sale closes. <b>At the moment they book the "
    "call.</b>"))
A(P("They open that person in ManyChat, copy the link out of the address bar, and paste it on "
    "that person's row. Three seconds, while they are already looking at the conversation."))
A(P("Do it later and it will not happen. The conversation will be twelve messages back, they "
    "will not remember which Sarah it was, and the row stays blank."))
A(callout("Add this column today, before you set anything else up.",
          "Rows already in your sheet without it can never be matched afterwards. Every day you "
          "wait is another day of sales that can never be traced back to an ad."))

A(P("The two columns your closer already fills in", "h2"))
A(P("Whether they showed up, and what they paid."))
A(P("Nothing detects these. Nothing can. Your show rate comes from that tick box, and your "
    "revenue and ROAS come from that number. The dashboard is reading your team's admin, which "
    "is exactly why it costs you no extra work."))
A(P("It also means the discipline you already have around the tracker now does two jobs. It "
    "runs your sales process, and it powers every number on the dashboard. If the tracker goes "
    "unfilled for a week, your show rate and revenue go blank for that week. Blank, not "
    "wrong. The system will not invent them."))

A(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# PART FOUR, collecting the four things
# ═══════════════════════════════════════════════════════════════════════════

A(P("PART FOUR", "part"))
A(P("Setting it up", "h1"))
A(P("Open Claude Code, paste in the link below, and tell it to install this.", "lead"))
A(code([f"https://{REPO}"]))
A(P("It will ask you questions about your business, what you use for DMs, what you book calls "
    "with, what your ad account is. Then it builds the whole thing. You do not edit any files "
    "or write anything technical.", "lead"))
A(P("If you get stuck anywhere, tell it what you can see on your screen. That genuinely works, "
    "it will pick up from wherever you are."))

A(P("Four things to go and copy", "h1"))
A(P("Claude cannot log into your accounts, so these four are on you. Get them first and "
    "everything else goes quickly."))
A(table([
    ["", "What", "Where from", "What it is for"],
    ["1", "Supabase personal access token", "supabase.com", "Where your numbers get stored"],
    ["2", "Meta ad account id and token", "business.facebook.com", "Your ad spend"],
    ["3", "Vercel access token", "vercel.com", "Puts your dashboard on the internet"],
    ["4", "Your sales tracker link", "Google Sheets", "Your money"],
], [0.3 * inch, 2.1 * inch, 1.45 * inch, 2.65 * inch]))

A(teach("What is a \"token\"?",
        "A very long password that lets one app talk to another on your behalf. You generate "
        "it, copy it once, paste it in, and never look at it again. That is the whole idea."))

A(P("1. Supabase, where your numbers get stored", "h1"))
A(P("A database is just a filing cabinet for numbers. This one is free at the size you need."))
A(callout("Supabase has several different keys. You want ONE specific one.",
          "Inside a Supabase project you will find things called <i>anon</i>, <i>service role</i>, "
          "<i>publishable</i> and <i>secret</i> keys. <b>You do not want any of those.</b> You "
          "want an account-level <b>personal access token</b>, which lives somewhere completely "
          "different, under your account settings, not inside a project. Follow the steps "
          "below exactly and you will land in the right place."))
A(steps([
    "Go to <b>supabase.com</b> and make an account. You do <b>not</b> need to create a "
    "project, Claude does that part for you.",
    "Go straight to this address: <b>supabase.com/dashboard/account/tokens</b>",
    "Check the page title says <b>Access Tokens</b> and that you are in your <b>account</b> "
    "settings, not inside a project.",
    "Click <b>Generate new token</b>. Give it a name like <i>ads dashboard</i>.",
    "Copy it. It starts with <font face='Courier'>sbp_</font>, that prefix is how you know "
    "you got the right one. Supabase only shows it once.",
    "Paste it to Claude.",
]))

A(PageBreak())

A(P("PART FOUR", "part"))
A(P("2. Meta, your ad spend", "h1"))
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

A(P("3. Vercel, where your dashboard lives", "h1"))
A(P("This is what turns it into a real website with a real address, instead of something that "
    "only works while your laptop is open."))
A(callout("The Scope setting matters. Pick Full Account.",
          "Vercel lets you limit a token to one project. That sounds sensible and it will "
          "<b>break the setup</b>, your project does not exist yet, so a project-limited token "
          "has nothing to point at and cannot create one. Choose <b>Full Account</b>."))
A(steps([
    "Go to <b>vercel.com</b> and make an account.",
    "At the top left of the dashboard, make sure you are looking at your <b>personal "
    "account</b>, not a team.",
    "Go to <b>vercel.com/account/tokens</b>",
    "Click <b>Create Token</b>. Give it a name like <i>ads dashboard</i>.",
    "Under <b>Scope</b>, choose <b>Full Account</b>.",
    "Choose an expiration. Pick the longest option offered, when it expires, your dashboard "
    "stops updating until you make a new one.",
    "Click <b>Create</b>, then copy the token. It starts with "
    "<font face='Courier'>vcp_</font> and is only shown once.",
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
# PART FIVE, ManyChat, starting from nothing
# ═══════════════════════════════════════════════════════════════════════════

A(P("PART FIVE", "part"))
A(P("ManyChat", "h1"))
A(P("The longest part, so take your time. It is also the part that makes the whole thing work, "
    "so it is worth going slowly.", "lead"))

A(P("What you almost certainly have right now", "h2"))
A(P("One automation. A trigger that fires when someone sends your keyword, and a message that "
    "goes back to them. Two boxes joined by a line:"))
A(code([
    "  [ When someone sends \"STRONG\" ]  ---->  [ Send them a message ]",
]))
A(P("That is a perfectly good setup and you are not throwing any of it away. You are adding to "
    "it."))

A(P("What you are adding", "h2"))
A(bullets([
    "<b>Part A</b>, one new box, slotted in <b>between</b> those two, so every DM records "
    "itself",
    "<b>Part B</b>, one brand new automation, so booking someone also records which ad they "
    "came from",
]))

A(teach("Before you start, check you are on ManyChat Pro.",
        "One of the steps below (External Request) is a paid feature. If you cannot find it in "
        "the menu, that is why, it is not you being blind. Upgrading is the fix."))

A(P("Part A, recording every DM", "h1"))
A(P("Open the automation that already replies to your keyword. You will see your keyword "
    "trigger, and your message box, joined by a line."))

A(callout("The new box goes BETWEEN them, not at the end.",
          "It has to run before anything else happens, so the keyword gets saved the instant "
          "the DM lands. You are inserting a step into the middle of a chain you already have, "
          "trigger first, then your new box, then your message."))
A(P("So you are going from this:"))
A(code(["  [ trigger ]  ---->  [ message ]"]))
A(P("To this:"))
A(code(["  [ trigger ]  ---->  [ NEW: action box ]  ---->  [ message ]"]))
A(P("If you use a randomiser to split conversations between two setters, the new box goes "
    "between the trigger and the randomiser. Same idea, it comes first.", "small"))

A(P("Building it", "h2"))
A(steps([
    "In the flow builder, add a new step using the <b>+</b> button, and choose <b>Action</b>. "
    "A new empty box appears on the canvas.",
    "Drag the line so it goes <b>trigger → your new action box → your message</b>. You may "
    "need to unhook the existing line from the trigger first, then join it back up through "
    "the new box.",
]))
A(teach("What is an \"Action\" box?",
        "A little to-do list ManyChat runs for that person before it moves on. You have "
        "probably never added one. It does not send them anything and they never see it."))

A(P("Now put two things inside that box.", "h2"))
A(P("<b>First, save which word they sent.</b>"))
A(teach("What is a \"custom field\"?",
        "ManyChat keeps a card on every person who messages you, their name, when they first "
        "wrote, and so on. A custom field is a blank box on that card that you get to name and "
        "fill in yourself. You are about to make one called <b>keyword</b> and put the word "
        "that person sent you into it. That is all a custom field is."))
A(steps([
    "Inside the action box click <b>+ Add Action</b>, and pick <b>Set User Field</b>.",
    "For the field, choose to create a new one, and call it <b>keyword</b>.",
    "For the value, pick <b>Last Text Input</b> from the list.",
]))
A(callout("\"Last Text Input\" means: whatever they just typed.",
          "This is the clever bit. Because you are saving what they actually sent, <b>ONE "
          "automation handles all of your keywords at once.</b> You do not need one for STRONG "
          "and another for SHREDDED. Put every keyword on the same trigger and each person "
          "records themselves correctly."))

A(P("<b>Second, send it over to your dashboard.</b>"))
A(P("Still inside the same action box, click <b>+ Add Action</b> again and pick "
    "<b>External Request</b>."))
A(teach("What is an \"External Request\"?",
        "It is ManyChat telling another app that something just happened. Like a text message "
        "from ManyChat to your dashboard saying \"Sarah just sent STRONG\". Nobody sees it, and "
        "it takes a fraction of a second."))
A(P("Claude gives you the exact address to paste in, and exactly what to put in each box. "
    "Follow what it gives you, it is filled in for your account specifically."))
A(callout("You will see a red \"Invalid JSON\" warning. Ignore it.",
          "ManyChat shows that while you are editing, because there is no real person for it to "
          "test with yet. It goes away the moment a genuine DM comes through. It is not an "
          "error and you have not done anything wrong."))
A(P("Save it. Part A is done, every DM now records itself."))

A(PageBreak())

# ── B. the booking automation ────────────────────────────────────────────
A(P("PART FIVE", "part"))
A(P("Part B, recording every booked call", "h1"))
A(P("This is a brand new automation, separate from the one above. You have almost certainly "
    "never built anything like it, and it is the highest-value twenty minutes in this guide.",
    "lead"))

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
A(P("Same effort for the setter. Less, actually, one click instead of hunting for a link and "
    "pasting it."))

A(teach("What is a \"tag\"?",
        "A sticker you put on a person in ManyChat. That is genuinely all it is. You make up "
        "the name. The useful part is that ManyChat can watch for a sticker being applied and "
        "do something the moment it happens, which is exactly what you are about to build."))

A(P("Build it", "h2"))
A(steps([
    "In ManyChat go to <b>Settings</b>, then <b>Tags</b>, and make a new tag. Name it after "
    "the calendar it will send, something like <font face='Courier'>1_Day_Calendar</font>. "
    "If you offer more than one calendar, make one tag for each.",
    "Go to <b>Automation</b> and start a <b>New Automation</b>. This is a separate one, not "
    "the keyword automation you edited in Part A.",
    "For the trigger, choose <b>Contact event occurs</b>, then <b>Tag applied</b>, then pick "
    "the tag you just made.",
    "Add one step: <b>Send Message</b>.",
    "In that message, put your normal booking link, then add the keyword onto the end of it, "
    "exactly as described below.",
]))

A(P("Adding the keyword to the link", "h2"))
A(teach("What you are about to do, in plain terms.",
        "You are sticking a small label on the end of your booking link. When Sarah clicks it, "
        "the label travels along with her and lands in your booking tool, so it knows she came "
        "from STRONG. She never sees it and it changes nothing for her."))
A(P("Take your booking link and add this onto the end:"))
A(code(["?utm_content=", "", "...then insert your keyword field straight after the = sign"]))
A(P("So a finished link looks like this, where the last part is your keyword <i>field</i>, not "
    "typed-out text:"))
A(code(["https://your-booking-link.com/strategy-call?utm_content={keyword}"]))
A(P("To insert the field: while you are writing the message, use ManyChat's field picker, the "
    "little <font face='Courier'>{ }</font> button, and choose your <b>keyword</b> field. Do "
    "not type the word out with brackets around it yourself."))

A(callout("THE MOST IMPORTANT CHECK IN THIS WHOLE GUIDE: it has to be BLUE.",
          "When you insert the field properly, ManyChat shows it as a <b>blue chip</b> in the "
          "message. If it is plain black text, ManyChat will send the literal characters "
          "<font face='Courier'>{keyword}</font> to every single lead, and not one booking will "
          "ever be attributed. So look at it. Is it blue? Good. If it is black, delete it and "
          "insert it again using the field picker."))

A(P("If you offer more than one calendar, a one-day and a three-day, say, each tag needs its "
    "own automation, and every one of those links needs the keyword on it."))

A(P("Tell your setter what changed", "h2"))
A(P("Two things change for them, and both need saying out loud:"))
A(bullets([
    "To book someone, <b>apply the tag</b>. The link goes out by itself. Do not paste the old "
    "link by hand, those bookings arrive with nothing attached.",
    "Then <b>paste that person's ManyChat link into the sales sheet</b>, straight away, on "
    "the row for that booking.",
]))

A(P("Last piece: your booking tool", "h1"))
A(P("Whatever you book calls with, GoHighLevel, Calendly, anything, needs to tell the "
    "dashboard when a call actually gets booked."))
A(P("The menus are named differently in every tool, so tell Claude which one you use and it "
    "will give you the exact steps for yours."))

A(P("Which calendars count as sales calls", "h2"))
A(P("Claude asks you this during setup, before you ever open the dashboard. You just say which "
    "of your calendars are <b>sales calls</b>, not onboarding calls, not coaching calls. Those "
    "are real bookings, they are just not the thing you are measuring here."))

A(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# PART SIX, done
# ═══════════════════════════════════════════════════════════════════════════

A(P("PART SIX", "part"))
A(P("You are done", "h1"))
A(P("You have your own web address, something like <font face='Courier'>your-name.vercel."
    "app</font>, behind a password you picked."))
A(P("It updates itself every hour, whether your laptop is on or not."))

A(P("Check these four before you trust it", "h2"))
A(table([
    ["", "Check", "If it comes back empty"],
    ["&#9744;", "Your ad spend is showing", "Tell Claude, usually the Meta token"],
    ["&#9744;", "Send yourself a test DM with one of your keywords. It shows up in the DM column",
     "The action box did not save, or it is after the message instead of before it"],
    ["&#9744;", "Put your booking tag on yourself. You get the link, and it has the keyword on "
     "the end of it", "The keyword is black, not blue"],
    ["&#9744;", "Ask Claude to run the setup check. It comes back clean", "It will tell you what to fix"],
], [0.3 * inch, 3.2 * inch, 3.0 * inch]))
A(P("Do not skip these. A setup that finished but shows an empty table is not finished, and you "
    "will not notice for a week."))

A(P("Give it two weeks before you judge an ad", "h2"))
A(P("The dashboard is instant. Your sales cycle is not. Someone who DMs you today might buy in "
    "ten days. A brand new ad showing zero sales on day two is not a bad ad, it is an ad you "
    "have not waited for yet."))
A(P("Cost per DM and cost per booked call tell you something within a couple of days. ROAS "
    "needs longer."))

A(P("Why this is worth doing now", "h1"))
A(P("Right now you are making budget decisions on a number Facebook inflates and a feeling "
    "about which ads are working. That is not a small problem. It is the difference between "
    "your current revenue and your next level.", "lead"))
A(bullets([
    "<b>You stop wasting spend.</b> The ad quietly eating $600 a month and producing nothing "
    "becomes obvious on day one instead of never.",
    "<b>You scale the right thing.</b> When you find the ad that actually produces buyers, you "
    "can put real money behind it and know it will hold.",
    "<b>You get your time back.</b> No more Monday mornings pulling numbers together. No more "
    "asking your setter what happened last week.",
    "<b>You decide faster.</b> The gap between \"something changed\" and \"I know what changed\" "
    "goes from weeks to hours.",
]))
A(P("Every week you run without this is a week of spend you cannot account for, and a week of "
    "data you will never get back. Set it up once and it runs forever."))

A(P("When something looks off", "h1"))
A(P("Tell Claude what you are seeing, in normal words. There is a check built in that catches "
    "most of it. The usual suspects:"))
A(table([
    ["What you see", "What it almost always is"],
    ["One ad shows spend and zeros everywhere else", "Its name does not end in its keyword"],
    ["No DMs at all", "The action box is missing, in the wrong place, or you are not on Pro"],
    ["Bookings arriving with no keyword on them", "The keyword in the booking link is black, not blue"],
    ["No booked calls at all", "Your sales calendars were never marked"],
    ["Booked calls look too low", "Two calendars with nearly the same name, splitting them"],
    ["Sales showing as unattributed", "No ManyChat link pasted on those rows"],
    ["Everything froze on a certain date", "Your Meta token expired. Make a System User one"],
], [2.6 * inch, 3.9 * inch]))

A(Spacer(1, 16))
A(rule())
A(Spacer(1, 12))
A(P("<b>Stuck on anything?</b> Ask your Claude first, it has the full setup instructions and "
    "it knows this system inside out. If you are still stuck after that, come and ask me. More "
    "than happy to help you get it working."))
A(P("<b>And the whole thing in one sentence:</b> the keyword goes at the end of the ad name, "
    "gets saved when they DM you, rides inside the booking link, and lands on the sales row "
    "your team already fills in.", "small"))

doc = BaseDocTemplate(
    os.path.abspath(OUT), pagesize=LETTER,
    leftMargin=1 * inch, rightMargin=1 * inch,
    topMargin=0.95 * inch, bottomMargin=0.9 * inch,
    title="DM Ads Attribution, Setup Guide", author="DM Ads Attribution")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="body")
doc.addPageTemplates([
    PageTemplate(id="cover", frames=[Frame(0, 0, LETTER[0], LETTER[1], id="cover")],
                 onPage=cover_page),
    PageTemplate(id="main", frames=[frame], onPage=header_footer),
])
# The cover is drawn entirely on the canvas, so the story starts by switching
# templates and turning the page. Nothing flows onto the cover itself.
doc.build([NextPageTemplate("main"), PageBreak()] + story)
print(f"wrote {os.path.abspath(OUT)}")
if not HAS_INTER:
    print("NOTE: Inter not found in scripts/fonts, fell back to Helvetica.")
