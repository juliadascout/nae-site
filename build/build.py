#!/usr/bin/env python3
"""Static build for naeinc.ca.

Two kinds of page, and the difference matters:

  GENERATED - home, courses, locations, and the 21 area pages. Their content
    comes from nae-data (course-catalog.json, locations.json). No course name,
    price, kit or address is typed into a template, so the four published price
    lists that currently disagree collapse into one that cannot drift.

  MIGRATED - editorial posts. Content comes from the WordPress export with the
    Visual Composer shell stripped.

Every page passes through compliance.check() before it is written. A page that
trips a BLOCK rule is not written at all - it is quarantined and listed in the
report. The build is the enforcement point.
"""
import os, re, json, html, sys, shutil, glob
sys.path.insert(0, os.path.dirname(__file__))
from compliance import check

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
# Course and location records live in the nae-data repo. Point NAE_DATA at its
# data/ directory, or clone nae-data beside this repo and it is found automatically.
DATA = os.environ.get("NAE_DATA") or os.path.join(os.path.dirname(ROOT), "nae-data", "data")
OUT  = os.environ.get("NAE_OUT")  or os.path.join(ROOT, "public")
if not os.path.isdir(DATA):
    raise SystemExit(f"course/location data not found at {DATA}\n"
                     f"Set NAE_DATA to the nae-data/data directory and re-run.")
E    = lambda s: html.escape(str(s if s is not None else ""), quote=True)

COURSES  = json.load(open(f"{DATA}/course-catalog.json"))["courses"]
LOCS     = json.load(open(f"{DATA}/locations.json"))["locations"]
SITE = {"legal":"National Association of Estheticians Inc.","short":"NAE",
        "phone":"289-968-2028","email":"sales@glamsquadcanada.com","domain":"https://naeinc.ca",
        # Setmore. Every booking link on the site points here. It replaced a Google
        # appointment schedule, whose free tier allowed only one schedule per
        # account and could not see the rest of Kalleigh's calendar - so it offered
        # slots she was not actually free for. To split booking by course or by
        # studio later, make this a dict keyed by course or location id; every page
        # reads it from here, so nothing else has to change.
        "booking":"https://nationalassociationofestheticiansinc.setmore.com/services/3eb667e2-bafc-4c75-8383-ed5f47b2ea27"}

def slugify(s): return re.sub(r'[^a-z0-9]+','-',s.lower()).strip('-')
def money(n):   return "$" + format(int(n), ",d")
def hours_hi(d):
    ns = re.findall(r'(\d+)\s*(?:[-–]\s*(\d+))?\s*hours?', d or '')
    return max([float(b or a) for a,b in ns] or [0])

for c in COURSES:
    c["slug"]  = slugify(c["name"])
    c["hi"]    = hours_hi(c["duration"])
    raw = (c.get("kitItems") or "").strip()
    # "Kit options: $400 A, $450 B" and "Custom kits ($500-$1200): tent, hose"
    # both put the pricing before a colon and the list after it.
    # Three shapes appear in the catalogue:
    #   "Fan, 3 lash trays, glue"                  - a plain list of contents
    #   "Kit options: $400 A, $450 B"              - pricing, then the options
    #   "Product purchase guide ($250-$500)"       - a note, nothing to list
    if ":" in raw:
        head, _, rest = raw.partition(":")
    elif "," in raw:
        head, rest = "", raw
    else:
        head, rest = raw, ""
    c["kitNote"]  = head.strip()
    c["kitList"]  = [x.strip() for x in re.split(r',(?![^(]*\))', rest) if x.strip()]
    # A course has a kit if it says so. Only an empty description, or one that
    # opens by saying there is no kit, counts as none.
    c["hasKit"]   = bool(raw) and not raw.lower().lstrip().startswith("no kit")
    c["kitFixed"] = bool(c.get("kitCost"))
    c["equipList"] = [x.strip() for x in (c.get("equipment") or "").split(",") if x.strip()]

# A course is only sellable while it stays under both ministry caps: under $2,000
# in tuition and under 40 hours of instruction. Bundling several courses is what
# pushes a programme at either one, so the check runs on the built catalogue and
# fails the build - a price edit in nae-data cannot quietly reintroduce a breach.
CAP_PRICE, CAP_HOURS = 2000, 40
over = [(c["name"], c["price"], c["hi"]) for c in COURSES
        if c["price"] >= CAP_PRICE or c["hi"] >= CAP_HOURS]
if over:
    raise SystemExit("course caps breached (must be under ${:,} and under {} hours):\n".format(
        CAP_PRICE, CAP_HOURS) + "\n".join(
        f"  {n} - ${p:,} / {h:g}h" for n, p, h in over))

# Bundles name their components by frozen id, never by title, so renaming a course
# never silently empties the bundle it belongs to.
BY_ID = {c["id"]: c for c in COURSES}
for c in COURSES:
    ids = c.get("includes") or []
    unknown = [i for i in ids if i not in BY_ID]
    if unknown:
        raise SystemExit(f'{c["name"]}: includes unknown course id(s) {unknown}')
    c["parts"] = [BY_ID[i] for i in ids]
    c["partsValue"] = sum(p["price"] for p in c["parts"])

# A bundle's kit is written as an internal reference - "Kit (1) + Kit (2)",
# "Kits 6-12" - which means nothing to a reader and produced an empty list. Where
# the components are known, the real contents are the union of their kits.
KITREF = re.compile(r'^\s*Kits?\s*[\(0-9]')
for c in COURSES:
    if not KITREF.match(c.get("kitItems") or ""): continue
    if c["parts"]:
        seen, merged = set(), []
        for part in c["parts"]:
            for item in part["kitList"]:
                k = item.lower()
                if k not in seen: seen.add(k); merged.append(item)
        c["kitList"], c["kitNote"] = merged, ""
    else:
        # No components to draw on. Keep whatever the line says after the
        # reference - "Kit (18) - Basic Body Sugaring prerequisite" is only
        # useful to a reader from the dash onwards.
        tail = re.sub(r'^\s*Kits?\s*\(?\d+[\)\-0-9]*\s*[-\u2013\u2014]?\s*', '', c["kitItems"] or "")
        c["kitList"], c["kitNote"] = [], tail.strip()
    c["partsHours"] = sum(p["hi"] for p in c["parts"])
    # Only claim a saving where the bundle delivers broadly the same instruction
    # time as its parts do separately. Where the programme compresses the hours
    # instead, the lower price is not a discount - the student is buying less
    # teaching - and presenting it as money saved would be a false comparison.
    c["comparable"] = bool(c["parts"]) and c["hi"] >= 0.85 * c["partsHours"]

def loc_courses(l):
    sc = l.get("courseScope")
    if sc is None: return COURSES
    return [c for c in COURSES if c["id"] in sc]
def loc_addr(l):
    a = l.get("address") or {}
    if l.get("showAddress") == "full":
        return ", ".join(x for x in [a.get("line1"), a.get("city"), a.get("province"), a.get("postal")] if x)
    if l.get("showAddress") == "postal":
        return ", ".join(x for x in [a.get("city"), a.get("province"), a.get("postal")] if x)
    return ""
OPEN = [l for l in LOCS if l["status"] == "open"]

# ---------------------------------------------------------------- shell
NAV = [("Courses","/courses/"),("Locations","/locations/"),("Areas served","/areas-served/"),
       ("Our team","/our-team/"),("Contact","/contact/")]
def shell(title, desc, path, body, canonical=None):
    nav_html = "".join(
        '<a href="%s"%s>%s</a>' % (h, ' aria-current="page"' if h == path else '', E(n))
        for n, h in NAV)
    open_names = " &middot; ".join(E(l["name"]) for l in OPEN)
    return f"""<!doctype html>
<html lang="en-CA"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(title)}</title>
<meta name="description" content="{E(desc)}">
<link rel="canonical" href="{SITE['domain']}{canonical or path}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Lato:wght@400;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/site.css">
<link rel="icon" href="/brand/nae-favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/brand/nae-favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/brand/nae-favicon-16.png">
<link rel="apple-touch-icon" href="/brand/nae-favicon-180.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{E(SITE['legal'])}">
<meta property="og:title" content="{E(title)}">
<meta property="og:description" content="{E(desc)}">
<meta property="og:url" content="{SITE['domain']}{canonical or path}">
<meta property="og:image" content="{SITE['domain']}/brand/nae-og-share-1200x630.png">
<meta name="twitter:card" content="summary_large_image">
</head><body>
<header class="hdr"><div class="wrap">
  <a class="brand" href="/"><img src="/brand/nae-favicon-192.png" alt="" width="28" height="28" decoding="async"><b>NAE</b><span>Ontario</span></a>
  <nav class="nav">{nav_html}</nav>
  <a class="btn btn-p" href="/contact/">Book a call</a>
</div></header>
<main>{body}</main>
<footer class="ftr"><div class="wrap">
  <div><strong style="color:var(--ink)">{E(SITE['legal'])}</strong><br>
    {E(SITE['phone'])} &nbsp;&middot;&nbsp; {E(SITE['email'])}</div>
  <div>{open_names}</div>
  <div>Kits are optional and priced separately.<br>Certificate of completion issued on every course.</div>
</div></footer></body></html>"""

# ---------------------------------------------------------------- partials
def mobile_bar(course):
    """A fixed bar on phones only. The stylesheet already reserves 74px at the
       foot of the page for it; without the bar that was just dead space."""
    return (f'<div class="mbar"><div><b class="tnum">{money(course["price"])}</b>'
            f'<span>excludes HST</span></div>'
            f'<a class="btn btn-p" href="{SITE["booking"]}" rel="noopener">Book a call</a></div>')

def booking_rail(course=None, location=None):
    price = ""
    if course:
        price = (f'<div class="price"><span style="font-size:.9rem;color:var(--muted)">from</span>'
                 f'<b class="tnum">{money(course["price"])}</b><i>CAD</i></div>'
                 f'<p style="font-size:.85rem;color:var(--muted);margin:.25rem 0 0">'
                 f'{"Optional kit " + money(course["kitCost"]) + " &middot; " if course["kitFixed"] else ("Kit options &middot; " if course["hasKit"] else "")}'
                 f'excludes HST</p><hr class="r">')
    return f"""<aside class="rail"><div class="card">{price}
  <p style="text-align:center;font-size:.85rem;color:var(--muted);margin:0 0 1rem">
    Talk it through first &mdash; dates, kit, and what the course covers.</p>
  <a class="btn btn-p btn-blk" href="{SITE['booking']}" rel="noopener">Book a 15-minute call</a>
  <ul class="bul">
    <li>Pick a time that suits you &mdash; no account needed.</li>
    <li>Kits are optional and never part of the course fee.</li>
    <li>Training dates are set directly with your trainer.</li>
    <li>Certificate of completion on finishing.</li></ul>
  <hr class="r">
  <p style="font-size:.89rem;color:var(--ink-2);margin:0">Call
    <a href="tel:+12899682028">{E(SITE['phone'])}</a> or email
    <a href="mailto:{E(SITE['email'])}">{E(SITE['email'])}</a>.</p>
</div></aside>"""

def crow(c):
    kit = (f'+ optional kit {money(c["kitCost"])}' if c["kitFixed"]
           else ("optional kit options" if c["hasKit"] else "no kit"))
    return (f'<a class="crow" href="/courses/{c["slug"]}/"><div><h4>{E(c["name"])}</h4>'
            f'<p>{E(c["duration"])}</p></div><div class="p">{money(c["price"])}<small>{kit}</small></div></a>')

# The 21 area pages that already rank, at the exact paths they hold today.
AREAS = [
 ("Toronto","loc-rch","/beauty-school-near-toronto/"),("Markham","loc-rch","/beauty-school-near-markham/"),
 ("Vaughan","loc-rch","/beauty-school-near-vaughan/"),("Newmarket","loc-rch","/beauty-school-near-newmarket/"),
 ("Aurora","loc-rch","/beauty-school-near-aurora/"),
 ("King City","loc-rch","/beauty-school-near-king-city-ontario-national-association-of-estheticians/"),
 ("Elgin Mills","loc-rch","/beauty-school-near-elgin-mills/"),("Bolton","loc-rch","/beauty-school-near-bolton/"),
 ("Pickering","loc-rch","/beauty-school-near-pickering/"),("Oshawa","loc-rch","/beauty-school-near-oshawa/"),
 ("St. Catharines","loc-stc","/beauty-school-near-st-catharines/"),
 ("Niagara Falls","loc-nf","/beauty-school-near-niagara-falls/"),
 ("Niagara-on-the-Lake","loc-stc","/beauty-school-near-niagara-on-the-lake/"),
 ("Grimsby","loc-stc","/beauty-school-near-grimsby/"),("Lincoln","loc-stc","/beauty-school-near-lincoln/"),
 ("Fort Erie","loc-nf","/beauty-school-near-fort-erie/"),
 ("Port Colborne","loc-stc","/beauty-school-near-port-colborne/"),
 ("Wainfleet","loc-stc","/beauty-school-near-wainfleet/"),("Cayuga","loc-stc","/beauty-school-near-cayuga/"),
 ("Hamilton","loc-stc","/beauty-school-near-hamilton/"),("Stoney Creek","loc-stc","/beauty-school-near-stoney-creek/"),
]
BLURB = {"lash":"Isolation, placement, retention and aftercare, practised on a live model with your trainer beside you.",
 "brow":"Mapping, product handling and finishing, worked up to a result you can repeat on a paying client.",
 "hair":"Attachment, blending and safe removal, practised on a mannequin head before any live work.",
 "skin":"Skin assessment, product selection and treatment technique, with the aftercare you send clients home with.",
 "remove":"Product temperature, application and removal, plus the skin preparation and aftercare either side of it.",
 "nails":"Preparation, application, shaping and finish, built up until the result is consistent.",
 "body":"Technique, client comfort and aftercare, taught to a standard you can work at."}
def subject(n):
    n=n.lower()
    for d,p in [("lash",r"lash|eyelash"),("brow",r"brow|microblad"),("nails",r"nail|pedicure|manicure|acrylic|gel"),
                ("hair",r"hair extension|weave|locs|micro link|micro loop|nano ring|fusion|tape-?in|braid"),
                ("skin",r"facial|microderm|skin"),("remove",r"wax|sugar|threading")]:
        if re.search(p,n): return d
    return "body"
for c in COURSES: c["subject"] = subject(c["name"])

PAGES = []   # (path, title, description, body)

def page_course(c):
    at = [l for l in OPEN if any(x["id"]==c["id"] for x in loc_courses(l))]
    sessions = (c["duration"].split("/")[1].strip() if "/" in c["duration"] else "set with your trainer")
    specs = [("Hours", c["duration"].split("/")[0].strip(), "full programme"),
             ("Sessions", sessions, ""), ("Course fee", money(c["price"]), "excludes HST"),
             ("Kit", money(c["kitCost"]) if c["kitFixed"] else ("Options" if c["hasKit"] else "None"),
              "optional, yours to keep" if c["hasKit"] else ""),
             ("Studios", ", ".join(l["name"] for l in at) or "To confirm", ""),
             ("Experience needed", "None", "starts from the beginning")]
    spec_html = "".join(f'<div><dt>{E(k)}</dt><dd>{E(v)}{f"<small>{E(s)}</small>" if s else ""}</dd></div>'
                        for k,v,s in specs)
    parts_html = ""
    if c["parts"]:
        saving = c["partsValue"] - c["price"]
        rows = "".join(
            f'<li><a href="/courses/{p["slug"]}/">{E(p["name"])}</a>'
            f'<span class="tnum">{money(p["price"])}</span></li>' for p in c["parts"])
        parts_html = (
          f'<div class="card c-parts"><h2 style="margin-bottom:.4rem">What this programme covers</h2>'
          f'<p style="color:var(--ink-2);font-size:.92rem;margin:0 0 .9rem">'
          f'{len(c["parts"])} methods, taught as one programme. '
          + ("The shared foundation is taught once rather than repeated, so the "
             "programme runs in less time than the courses take separately."
             if not c["comparable"] else
             "Booking them together costs less than booking each one on its own.")
          + '</p>'
          f'<ul class="parts">{rows}</ul>'
          + ((f'<div class="partsum"><span>Taken separately</span>'
              f'<b class="tnum">{money(c["partsValue"])}</b></div>'
              f'<div class="partsum now"><span>As one programme</span>'
              f'<b class="tnum">{money(c["price"])}</b></div>'
              + (f'<p class="save">You save {money(saving)}.</p>' if saving > 0 else ""))
             if c["comparable"] else
             f'<div class="partsum now"><span>Programme fee</span>'
             f'<b class="tnum">{money(c["price"])}</b></div>')
          + '</div>')
    kit_html = ""
    if c["hasKit"]:
        kit_html = (f'<div class="card c-kit"><h2 style="margin-bottom:.8rem">Your kit &mdash; optional</h2>'
          f'<div class="kitbar"><div><em>Optional &middot; not part of the course fee</em>'
          f'<div style="margin-top:.2rem"><b>{money(c["kitCost"]) if c["kitFixed"] else E(c["kitNote"] or "Options available")}</b> '
          f'<span style="font-size:.85rem;color:var(--muted)">&mdash; yours to keep</span></div></div>'
          + (f'<span class="chip">{len(c["kitList"])} {"items" if c["kitFixed"] else "options"}</span>'
             if c["kitList"] else "") + '</div>'
          + (f'<p style="font-size:.9rem;color:var(--ink-2);margin:.1rem 0 0"><b>{E(c["kitNote"])}</b></p>'
             if c["kitNote"] and c["kitFixed"] else "")
          + f'<p style="font-size:.9rem;color:var(--ink-2)">You can take this course without the kit. '
          f'The course fee is the same either way.</p>'
          f'<ul class="kit">{"".join(f"<li>{E(i[:1].upper()+i[1:])}</li>" for i in c["kitList"])}</ul>'
          + (f'<hr class="r"><h4 style="margin-bottom:.5rem">Equipment you will train on</h4>'
             f'<p style="color:var(--ink-2);font-size:.92rem;margin:0">{E(" · ".join(c["equipList"]))}</p>'
             if c["equipList"] else "") + '</div>')
    faqs = [("What is included in the fee?", "Your sessions with the trainer, the materials used during them, and a certificate of completion."),
            ("Do I have to buy the kit?", "No. The kit is optional and is not part of the course fee. The price is the same without it."
                if c["hasKit"] else "There is no kit for this course."),
            ("Do I need experience?", "No. The course starts from the beginning."),
            ("How long does it take?", c["duration"].replace(" / ", " of instruction, across ") + "."),
            ("What do I get at the end?", f"A certificate of completion from {SITE['legal']}, issued once you have finished the practical hours and the assessment."),
            ("If I pay now, when do I train?", "Book your training dates within two weeks of payment.")]
    if c["parts"]:
        faqs.insert(1, ("Can I take just one of these methods?",
            "Yes. Each method is also offered on its own. Taking them as one programme "
            "costs less than booking them separately and the shared theory is taught once."))
    faq_html = "".join(f'<details{" open" if i==0 else ""}><summary>{E(q)}</summary><p>{E(a)}</p></details>'
                       for i,(q,a) in enumerate(faqs))
    body = f"""<div class="wrap pad">
<p class="bcrumb"><a href="/courses/">Courses</a><span>/</span><span>{E(c['name'])}</span></p>
<div class="two"><div class="stack">
  <div class="card c-intro"><span class="chip">{E(c['subject'].title())}</span>
    <h1 style="margin:.7rem 0 .8rem">{E(c['name'])}</h1>
    <p class="lede">{E(BLURB[c['subject']])} The programme runs {E(c['duration'].replace(' / ',' across '))}, scheduled around your availability.</p></div>
  <div class="card c-specs"><h2 style="margin-bottom:1rem">At a glance</h2><dl class="specs">{spec_html}</dl></div>
  {parts_html}
  {kit_html}
  <div class="card c-faq"><h2 style="margin-bottom:.9rem">Common questions</h2><div class="faq">{faq_html}</div></div>
</div>{booking_rail(course=c)}</div>{mobile_bar(c)}</div>"""
    return (f"/courses/{c['slug']}/", f"{c['name']} Training | {SITE['short']}",
            f"{c['name']} training in {', '.join(l['name'] for l in at) or 'Ontario'}. "
            f"{c['duration']}. {money(c['price'])}, kit optional.", body)

def page_area(city, locid, path):
    l = next(x for x in LOCS if x["id"] == locid)
    picks = [c for c in loc_courses(l)][:6]
    body = f"""<div class="wrap pad">
<p class="bcrumb"><a href="/areas-served/">Areas served</a><span>/</span><span>{E(city)}</span></p>
<div class="two"><div class="stack">
  <div class="card"><p class="eyebrow">Areas served &middot; {E(l['region'])}</p>
    <h1 style="margin-bottom:.8rem">Beauty school near {E(city)}</h1>
    <p class="lede">{E(city)} students train at our {E(l['name'])} studio. Small groups and one-to-one
      sessions, scheduled around your availability.</p></div>
  <div class="card"><h2 style="margin-bottom:.8rem">Getting to {E(l['name'])} from {E(city)}</h2>
    <p style="color:var(--ink-2);margin:0">{E(loc_addr(l)) or 'Address on request.'}
      Most students travelling in book two or three longer days rather than coming weekly.
      Parking details come with your booking confirmation.</p></div>
  <div class="card"><h2 style="margin-bottom:.35rem">Popular with {E(city)} students</h2>
    <p style="color:var(--muted);font-size:.9rem;margin-bottom:1rem">Every course at
      {E(l['name'])} is open to you.</p>{''.join(crow(c) for c in picks)}</div>
  <div class="card"><h2 style="margin-bottom:.9rem">Questions from {E(city)} students</h2><div class="faq">
    <details open><summary>Do you teach in {E(city)} itself?</summary>
      <p>Not currently. {E(city)} students train at the {E(l['name'])} studio.</p></details>
    <details><summary>Are kits included?</summary>
      <p>No. Kits are optional and priced separately from the course fee.</p></details>
    <details><summary>Can I train over consecutive days?</summary>
      <p>Usually, yes. It is the most common arrangement for students travelling in.</p></details>
  </div></div>
</div>{booking_rail(location=l)}</div></div>"""
    return (path, f"Beauty School Near {city} | {SITE['short']}",
            f"Beauty and esthetics training near {city}, Ontario. Courses at our {l['name']} studio. "
            f"Kits optional, certificate of completion issued.", body)

def page_home():
    subs = {}
    for c in COURSES: subs.setdefault(c["subject"], []).append(c)
    NAMES = {"lash":"Lash","brow":"Brow","hair":"Hair extensions","skin":"Skin",
             "remove":"Hair removal","nails":"Nails","body":"Body & other"}
    tiles = "".join(
        f'<a class="tile" href="/courses/"><p class="mono">{len(v)} course{"" if len(v)==1 else "s"}</p>'
        f'<h3>{E(NAMES[k])}</h3><p>From {money(min(c["price"] for c in v))}</p></a>'
        for k, v in subs.items())
    locs = "".join(
        f'<a class="lcard" href="/locations/{slugify(l["name"])}/"><div class="ph">{E(l["name"])}</div>'
        f'<div class="bd"><p class="mono" style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--vir-ink)">'
        f'{"Now enrolling" if l["status"]=="open" else "Coming soon"}</p>'
        f'<h3>{E(l["name"])}</h3><p>{E(l["region"])}</p></div></a>' for l in LOCS)
    body = f"""<div class="wrap hero">
  <p class="eyebrow">Hands-on beauty training &middot; Ontario</p>
  <h1>Learn on a real client,<br>with a trainer beside you.</h1>
  <p class="lede">{len(COURSES)} courses in lash, brow, hair extensions, skin, nails and hair removal.
    {len(OPEN)} studios open across Niagara and York Region. Every course finishes with a certificate
    of completion, and kits are always optional.</p>
  <div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-top:1.6rem">
    <a class="btn btn-p" href="/courses/">Browse courses</a>
    <a class="btn btn-g" href="/locations/">Find a studio</a></div>
  <div class="stats">
    <div><b class="tnum">{len(COURSES)}</b><span>Courses</span></div>
    <div><b class="tnum">{len(OPEN)}</b><span>Studios open</span></div>
    <div><b class="tnum">{len(AREAS)}</b><span>Areas served</span></div>
    <div><b class="tnum">2&ndash;27</b><span>Hours per course</span></div></div>
</div>
<div class="wrap pad"><p class="eyebrow">Pick a subject</p>
  <h2 style="margin-bottom:1.4rem">What do you want to learn?</h2><div class="grid3">{tiles}</div></div>
<div class="wrap pad"><p class="eyebrow">Where we teach</p>
  <h2 style="margin-bottom:1.4rem">Our studios</h2><div class="lcards">{locs}</div></div>"""
    return ("/", f"Beauty Courses in Ontario | {SITE['short']}",
            f"Hands-on beauty and esthetics training across {len(OPEN)} Ontario studios. "
            f"{len(COURSES)} courses, optional kits, certificate of completion.", body)

def page_courses():
    body = (f'<div class="wrap pad"><p class="eyebrow">All courses</p><h1 style="margin-bottom:.7rem">Courses</h1>'
            f'<p class="lede" style="margin-bottom:1.6rem">Hours shown are the full programme. '
            f'<strong>Kits are optional</strong> and never part of the course fee.</p>'
            + "".join(crow(c) for c in COURSES) + '</div>')
    return ("/courses/", f"Beauty Courses &amp; Prices | {SITE['short']}",
            f"All {len(COURSES)} courses with hours, fees and optional kit prices.", body)

def page_locations():
    cards = "".join(
        f'<a class="lcard" href="/locations/{slugify(l["name"])}/"><div class="ph">{E(l["name"])}</div>'
        f'<div class="bd"><p class="mono" style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--vir-ink)">'
        f'{"Now enrolling" if l["status"]=="open" else "Coming soon"}</p><h3>{E(l["name"])}</h3>'
        f'<p>{E(l["region"])}</p><p style="margin-top:auto;padding-top:.5rem">'
        f'{str(len(loc_courses(l))) + " courses taught here" if l["status"]=="open" else "Join the waiting list"}</p>'
        f'</div></a>' for l in LOCS)
    return ("/locations/", f"Locations | {SITE['short']}",
            "Our studios across Niagara Region and York Region.",
            f'<div class="wrap pad"><p class="eyebrow">Studios</p><h1 style="margin-bottom:.7rem">Locations</h1>'
            f'<p class="lede" style="margin-bottom:1.6rem">Each page lists what is taught there.</p>'
            f'<div class="lcards">{cards}</div></div>')

def page_location(l):
    cs = loc_courses(l); addr = loc_addr(l)
    if l["status"] != "open":
        body = f"""<div class="wrap pad"><div style="max-width:660px">
  <p class="eyebrow">{E(l['region'])}</p><h1 style="margin-bottom:.8rem">{E(l['name'])}</h1>
  <span class="chip chip-q">Not open yet</span>
  <p class="lede" style="margin-top:1.1rem">We are not teaching in {E(l['name'])} yet. Our other studios
    take students travelling in.</p>
  <div class="lcards" style="margin-top:1.4rem">{''.join(
    f'<a class="lcard" href="/locations/{slugify(x["name"])}/"><div class="ph">{E(x["name"])}</div>'
    f'<div class="bd"><h3>{E(x["name"])}</h3><p>{E(x["region"])}</p></div></a>' for x in OPEN)}</div>
</div></div>"""
        return (f"/locations/{slugify(l['name'])}/", f"{l['name']} | {SITE['short']}",
                f"Beauty training coming soon to {l['name']}.", body)
    areas = [a for a in AREAS if a[1] == l["id"]]
    area_html = ('<div class="card"><h2 style="margin-bottom:1rem">Areas this studio serves</h2><div class="acols">'
                 + "".join(f'<a href="{p}">{E(c)}</a>' for c,_,p in areas) + '</div></div>') if areas else ""
    body = f"""<div class="wrap pad">
<p class="bcrumb"><a href="/locations/">Locations</a><span>/</span><span>{E(l['name'])}</span></p>
<div class="two"><div class="stack">
  <div class="card"><p class="eyebrow">{E(l['region'])}</p>
    <h1 style="margin-bottom:.8rem">{E(l['name'])}</h1>
    <p class="lede">Training in small groups and one-to-one, scheduled around your availability.</p>
    <hr class="r"><dl class="specs q">
      <div><dt>{'Postal code' if l.get('showAddress')=='postal' else 'Address'}</dt>
        <dd style="font-size:.92rem">{E(addr)}</dd></div>
      <div><dt>Phone</dt><dd>{E(SITE['phone'])}</dd></div>
      <div><dt>Courses here</dt><dd>{len(cs)} of {len(COURSES)}</dd></div>
      <div><dt>Enrolling</dt><dd>Yes<small>current intake</small></dd></div></dl></div>
  <div class="card"><h2 style="margin-bottom:.35rem">Courses taught here</h2>
    <p style="color:var(--muted);font-size:.9rem;margin-bottom:1rem">{len(cs)} of the {len(COURSES)} courses
      run at this studio.</p>{''.join(crow(c) for c in cs)}</div>
  {area_html}
</div>{booking_rail(location=l)}</div></div>"""
    return (f"/locations/{slugify(l['name'])}/", f"{l['name']} Beauty School | {SITE['short']}",
            f"Beauty and esthetics training in {l['name']}, {l['region']}. {len(cs)} courses.", body)

def page_areas():
    out = []
    for l in LOCS:
        a = [x for x in AREAS if x[1] == l["id"]]
        if not a: continue
        out.append(f'<h2 style="margin:1.6rem 0 .8rem">{E(l["name"])}</h2><div class="acols">'
                   + "".join(f'<a href="{p}">{E(c)}</a>' for c,_,p in a) + '</div>')
    return ("/areas-served/", f"Areas Served | {SITE['short']}",
            f"{len(AREAS)} areas across Niagara Region, Hamilton and the GTA.",
            f'<div class="wrap pad"><p class="eyebrow">Areas served</p>'
            f'<h1 style="margin-bottom:.7rem">Where students travel from</h1>'
            f'<p class="lede" style="margin-bottom:1.4rem">{len(AREAS)} areas, each with its own page.</p>'
            + "".join(out) + '</div>')

def page_contact():
    rows = "".join(f'<div><dt>{E(l["name"])}</dt><dd style="font-size:.86rem">{E(loc_addr(l))}</dd></div>'
                   for l in OPEN)
    return ("/contact/", f"Contact | {SITE['short']}", "Get in touch about courses and enrolment.",
      f"""<div class="wrap pad"><div class="two"><div class="stack"><div class="card">
      <p class="eyebrow">Get in touch</p><h1 style="margin-bottom:.8rem">Contact</h1>
      <p class="lede">Ask about any course, or arrange a call.</p><hr class="r">
      <dl class="specs q"><div><dt>Phone</dt><dd>{E(SITE['phone'])}</dd></div>
      <div><dt>Email</dt><dd style="font-size:.84rem">{E(SITE['email'])}</dd></div>{rows}</dl>
      </div></div>{booking_rail()}</div></div>""")


# ---------------------------------------------------------------- team
# Eleven roles, no names and no photographs. Each person signs off on their own
# name, portrait and biography before any of it is published. Portraits are
# original silhouettes drawn for this site - no third-party artwork.
TEAM = [("President","lead"),("Regional Director of Operations","lead"),
        ("Director of Marketing","lead"),("Programme Coordinator","lead")] + \
       [("Instructor","inst")]*7
HAIR = [
 '<path d="M27,46 Q27,19 50,19 Q73,19 73,46 L73,78 L65,78 L65,45 Q65,31 50,31 Q35,31 35,45 L35,78 L27,78 Z"/>',
 '<path d="M29,46 Q29,24 50,24 Q71,24 71,46 L71,52 L64,52 L64,44 Q64,32 50,32 Q36,32 36,44 L36,52 L29,52 Z"/><circle cx="50" cy="14" r="8.5"/>',
 '<path d="M28,47 Q28,20 50,20 Q72,20 72,47 L72,60 Q72,64 68,64 L64,64 L64,45 Q64,31 50,31 Q36,31 36,45 L36,64 L32,64 Q28,64 28,60 Z"/>',
 '<g><circle cx="34" cy="32" r="9"/><circle cx="50" cy="24" r="10"/><circle cx="66" cy="32" r="9"/><circle cx="29" cy="45" r="7"/><circle cx="71" cy="45" r="7"/></g>',
 '<path d="M30,46 Q30,21 50,21 Q70,21 70,46 L70,50 L64,50 L64,44 Q64,31 50,31 Q36,31 36,44 L36,50 L30,50 Z"/><path d="M68,38 Q84,44 82,60 Q80,74 70,76 Q78,64 74,52 Q71,44 66,42 Z"/>',
 '<path d="M30,46 Q30,21 50,21 Q70,21 70,46 L70,50 L64,50 L64,44 Q64,31 50,31 Q36,31 36,44 L36,50 L30,50 Z"/><path d="M31,44 Q25,58 28,78 L35,78 Q31,58 36,46 Z"/><path d="M69,44 Q75,58 72,78 L65,78 Q69,58 64,46 Z"/>',
 '<path d="M31,45 Q31,23 50,23 Q69,23 69,45 L69,47 L63,47 Q63,33 50,33 Q37,33 37,47 L31,47 Z"/>',
 '<path d="M27,46 Q27,19 50,19 Q73,19 73,46 Q77,58 71,66 Q74,74 68,79 L64,79 Q68,70 65,62 Q68,52 65,45 Q65,31 50,31 Q35,31 35,45 Q32,52 35,62 Q32,70 36,79 L32,79 Q26,74 29,66 Q23,58 27,46 Z"/>',
 '<path d="M29,45 Q29,21 50,21 Q71,21 71,45 L71,49 L29,49 Z"/><path d="M27,40 Q38,33 50,33 Q62,33 73,40 L73,50 Q62,44 50,44 Q38,44 27,50 Z" opacity=".55"/>',
 '<path d="M31,46 Q29,22 50,22 Q70,22 70,42 Q64,34 52,36 Q42,38 38,47 Z"/>',
 '<path d="M27,46 Q27,19 50,19 Q73,19 73,46 L73,76 L65,76 L65,45 Q65,31 50,31 Q35,31 35,45 L35,76 L27,76 Z"/><path d="M28,36 Q50,28 72,36 L72,42 Q50,34 28,42 Z" opacity=".5"/>',
]
def avatar(i, size=74):
    warm = i % 2 == 0
    ink  = "var(--plum)" if warm else "var(--vir-ink)"
    x2,y2 = [(1,1),(0,1),(1,0),(1,0.35)][i % 4]
    s1,s2 = ("var(--plum-soft)","var(--vir-soft)") if warm else ("var(--vir-soft)","var(--plum-soft)")
    return (f'<svg class="avsvg" viewBox="0 0 100 100" width="{size}" height="{size}" role="img" '
      f'aria-label="Illustrated silhouette placeholder"><defs>'
      f'<linearGradient id="ag{i}" x1="0" y1="0" x2="{x2}" y2="{y2}">'
      f'<stop offset="0" stop-color="{s1}"/><stop offset="1" stop-color="{s2}"/></linearGradient>'
      f'<clipPath id="cag{i}"><circle cx="50" cy="50" r="50"/></clipPath></defs>'
      f'<g clip-path="url(#cag{i})"><rect width="100" height="100" fill="url(#ag{i})"/>'
      f'<g fill="{ink}"><path d="M14,100 Q14,71 50,71 Q86,71 86,100 Z"/>'
      f'<circle cx="50" cy="45" r="18"/>{HAIR[i % len(HAIR)]}</g></g></svg>')

def page_team():
    def grid(kind):
        return "".join(
          f'<div class="tcard"><div class="av">{avatar(i)}</div><h4>{E(t)}</h4>'
          f'<p>{"Across all studios" if k=="lead" else "Teaches by subject"}</p></div>'
          for i,(t,k) in enumerate(TEAM) if k == kind)
    body = f"""<div class="wrap pad">
  <p class="eyebrow">Who you will be working with</p><h1 style="margin-bottom:.7rem">Our team</h1>
  <p class="lede" style="margin-bottom:1.6rem">Eleven of us across the studios &mdash; a president,
    three directors and coordinators, and seven instructors. Instructors teach by subject, so you are
    taught by someone who does that work.</p>
  <h2 style="margin:1.8rem 0 1rem">Leadership</h2><div class="tgrid">{grid('lead')}</div>
  <h2 style="margin:1.8rem 0 1rem">Instructors</h2><div class="tgrid">{grid('inst')}</div>
</div>"""
    return ("/our-team/", f"Our Team | {SITE['short']}",
            "The people who teach at NAE, across our Ontario studios.", body)

# ---------------------------------------------------------------- build
PAGES = [page_home(), page_courses(), page_locations(), page_areas(), page_contact(), page_team()]
PAGES += [page_location(l) for l in LOCS]
PAGES += [page_course(c) for c in COURSES]
PAGES += [page_area(*a) for a in AREAS]


# ---------------------------------------------------------------- migrated editorial
# Posts and pages carried over from WordPress, at the paths they already hold.
# Content has been through the compliance pass; the gate still runs on each one,
# so anything that slipped through is refused rather than published.
from urllib.parse import urlparse, unquote
CLEAN = os.environ.get("NAE_CLEAN") or os.path.join(os.path.dirname(ROOT), "clean")
GENERATED = {p for p,_,_,_ in PAGES}

refused = []
def migrated_pages():
    out = []
    if not os.path.isdir(CLEAN): return out
    for f in sorted(glob.glob(os.path.join(CLEAN, "*.html"))):
        raw = open(f, encoding="utf-8").read()
        m = re.match(r"<!--\s*title:\s*(.*?)\n\s*url:\s*(.*?)\n\s*type:\s*(.*?)\s*-->\s*", raw, re.S)
        if not m: continue
        title, url, ptype = (x.strip() for x in m.groups())
        body_html = raw[m.end():]
        # WordPress emoji slugs arrive percent-encoded. Kept that way, the
        # directory on disk is literally named "%f0%9f%98%81…" while a browser
        # asking for that URL sends the encoded emoji, which the host decodes
        # back to the character - and finds nothing. Decode once, here, so the
        # directory and the link both carry the character itself.
        path = unquote(urlparse(url).path) or "/"
        if not path.endswith("/"): path += "/"
        if path in GENERATED: continue          # a generated page always wins
        plain = re.sub(r"<[^>]+>", " ", body_html)
        desc = re.sub(r"\s+", " ", html.unescape(plain)).strip()[:155]
        body = (f'<div class="wrap pad"><article class="prose">'
                f'<p class="bcrumb"><a href="/blog/">Journal</a><span>/</span>'
                f'<span>{E(title[:60])}</span></p>'
                f'<h1 style="margin-bottom:1rem">{E(title)}</h1>{body_html}</article></div>')
        # Check here, not only at write time: a page the gate will refuse must
        # not appear in the index either, or the index links into a 404.
        if check(shell(title, desc, path, body))[0]:
            refused.append(path); continue
        out.append((path, f"{title} | {SITE['short']}", desc, body, ptype))
    return out

MIG = migrated_pages()

def page_blog_index(entries):
    rows = "".join(
        f'<a class="crow" href="{p}"><div><h4>{E(t.rsplit(" | ",1)[0])}</h4>'
        f'<p>{E(d[:96])}&hellip;</p></div></a>' for p,t,d,_,ty in entries if ty == "post")
    n = sum(1 for e in entries if e[4] == "post")
    return ("/blog/", f"Journal | {SITE['short']}",
            "News, course announcements and notes from our studios.",
            f'<div class="wrap pad"><p class="eyebrow">Journal</p>'
            f'<h1 style="margin-bottom:.7rem">News &amp; notes</h1>'
            f'<p class="lede" style="margin-bottom:1.6rem">{n} posts from our studios.</p>{rows}</div>')

def taxonomy_pages(entries):
    """WordPress served a /category/<slug>/ and /tag/<slug>/ archive for every
       term, and a large share of the site's search traffic lands on them. They
       are rebuilt from the taxonomy captured alongside the corpus rather than
       from the 17MB export, so the build needs nothing but this repo.

       An archive only lists posts that actually got built: a term whose posts
       were all retired produces no page at all, rather than an empty one."""
    tax_file = os.path.join(CLEAN, "taxonomy.json")
    if not os.path.isfile(tax_file): return []
    tax = json.load(open(tax_file, encoding="utf-8"))
    # The area pages are posts in WordPress but are generated here, so an
    # archive has to be able to list them too - they are the pages the
    # area-name categories exist for. Anything already built is eligible.
    live = {p: (p, t, d) for p, t, d, _, ty in entries if ty == "post"}
    for p_, t_, d_, _b in PAGES:
        live.setdefault(p_, (p_, t_, d_))
    terms = {}   # (kind, slug) -> [name, [(path,title,desc), ...]]
    for path, rec in tax.items():
        if path not in live: continue
        for kind, key in (("category", "categories"), ("tag", "tags")):
            for slug, name in rec.get(key, []):
                terms.setdefault((kind, slug), [name, []])[1].append(live[path])
    def display(n):
        # WordPress stored some term names all-lowercase ("richmond hill"),
        # which reads as a typo in a page heading. Only touch those: a name
        # with any capital already is how someone chose to write it.
        return n.title() if n == n.lower() else n

    out = []
    for (kind, slug), (name, posts) in sorted(terms.items()):
        name = display(name)
        posts.sort(key=lambda x: x[1])
        rows = "".join(
            f'<a class="crow" href="{p}"><div><h4>{E(t.rsplit(" | ",1)[0])}</h4>'
            f'<p>{E(d[:96])}&hellip;</p></div></a>' for p, t, d in posts)
        label = "Category" if kind == "category" else "Tag"
        out.append((f"/{kind}/{slug}/", f"{name} | {SITE['short']}",
                    f"{len(posts)} post{'s' if len(posts) != 1 else ''} on {name} "
                    f"from {SITE['legal']}.",
                    f'<div class="wrap pad"><p class="eyebrow">{label}</p>'
                    f'<h1 style="margin-bottom:.7rem">{E(name)}</h1>'
                    f'<p class="lede" style="margin-bottom:1.6rem">'
                    f'{len(posts)} post{"s" if len(posts) != 1 else ""}. '
                    f'<a href="/blog/">All posts</a></p>{rows}</div>'))
    return out

PAGES.append(page_blog_index(MIG))
PAGES.extend(taxonomy_pages(MIG))
ALL = [(p,t,d,b) for p,t,d,b in PAGES] + [(p,t,d,b) for p,t,d,b,_ in MIG]

if os.path.isdir(OUT): shutil.rmtree(OUT)
os.makedirs(OUT, exist_ok=True)
shutil.copy(os.path.join(HERE, "site.css"), os.path.join(OUT, "site.css"))
# Static files that are served but not generated - the image library carried
# over from WordPress. They live in assets/ rather than in public/, because the
# build empties public/ on every run and would delete anything left there.
ASSETS = os.path.join(ROOT, "assets")
if os.path.isdir(ASSETS):
    def _skip(_d, names):
        # originals/ holds the artwork as supplied - the served sizes are
        # generated from it, so shipping it too would double the payload.
        return {"originals"} & set(names)
    for name in sorted(os.listdir(ASSETS)):
        src = os.path.join(ASSETS, name)
        dst = os.path.join(OUT, name)
        if os.path.isdir(src): shutil.copytree(src, dst, ignore=_skip)
        else: shutil.copy(src, dst)

# WordPress served the same front page at / and at /home/. Both URLs are worth
# keeping, but only one may claim to be the home page, so /home/ points its
# canonical at / rather than competing with it for the same searches.
CANONICAL = {"/home/": "/"}

written, quarantined, warned = 0, [], []
seen = set()
for path, title, desc, body in ALL:
    if path in seen: continue
    seen.add(path)
    doc = shell(title, desc, path, body, canonical=CANONICAL.get(path))
    blocks, warns = check(doc)
    if blocks:
        quarantined.append((path, blocks)); continue
    if warns: warned.append((path, warns))
    d = os.path.join(OUT, path.strip("/"))
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(doc)
    written += 1

# Served for any URL that matches no page. Without it the host decides, and a
# host that answers an unknown path with the home page tells a search engine
# every wrong URL is a real page. Written as a bare file, not a directory, and
# kept out of the sitemap and the link check because nothing links to it.
_404 = shell(
    f"Page not found | {SITE['short']}",
    "That page is not here. Browse the courses, the studios, or the journal.",
    "/404.html",
    '<div class="wrap pad"><p class="eyebrow">404</p>'
    '<h1 style="margin-bottom:.7rem">That page is not here</h1>'
    '<p class="lede" style="margin-bottom:1.6rem">It may have been retired, or the '
    'address may have a typo in it. These are the places most people are heading.</p>'
    '<div class="two"><div class="stack">'
    '<a class="crow" href="/courses/"><div><h4>All courses</h4>'
    '<p>Every programme, with hours, fees and what the kit contains&hellip;</p></div></a>'
    '<a class="crow" href="/locations/"><div><h4>Studios</h4>'
    '<p>Where we teach, and which courses run at each one&hellip;</p></div></a>'
    '<a class="crow" href="/blog/"><div><h4>Journal</h4>'
    '<p>News and notes from the studios&hellip;</p></div></a>'
    '<a class="crow" href="/contact/"><div><h4>Contact</h4>'
    '<p>Book a call, or ask us a question&hellip;</p></div></a>'
    '</div></div></div>')
if check(_404)[0]:
    raise SystemExit("the 404 page itself trips the compliance gate")
open(f"{OUT}/404.html", "w", encoding="utf-8").write(_404)

open(f"{OUT}/sitemap.xml","w").write(
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + "".join(f"  <url><loc>{SITE['domain']}{p}</loc></url>\n"
              for p in sorted(seen) if p not in CANONICAL) + "</urlset>\n")
open(f"{OUT}/robots.txt","w").write(f"User-agent: *\nAllow: /\nSitemap: {SITE['domain']}/sitemap.xml\n")

gen_n = len(PAGES)
print(f"generated from data : {gen_n}")
print(f"migrated editorial  : {written - gen_n + len(quarantined)}")
print(f"total written       : {written}")
print(f"refused by the gate : {len(refused)} (excluded from the index, so no dead links)")
for r in refused: print(f"    {r}")
print(f"quarantined at write: {len(quarantined)}")
for p, b in quarantined[:8]: print(f"    {p}  ->  {b}")
print(f"pages with warnings : {len(warned)}")
for p, w in warned[:6]: print(f"    {p}  ->  {w}")
