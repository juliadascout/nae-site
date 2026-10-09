"""The rule, as code. A page that trips this is not written — it is quarantined
   for a human to look at. Cheaper to enforce at build time than to audit later."""
import re, html

BLOCK = {
  'status claim':        r'\b(accredited|accreditation|licensed (school|college|institution)|diploma)\b',
  'protected title':     r'\b(nurse|massage therapist|registered massage)\b',
  'superlative':         r"\b(the best|top beauty|leading beauty|premier|canada'?s top|niagara'?s top|#1 beauty)\b",
  'career-outcome claim':r'\b(licensed (aesthetician|esthetician)|cosmetology licen[cs]e)\b',
  # The legal name is "National Association of Estheticians Inc." Variants that
  # look plausible are the dangerous ones - the privacy policy carried
  # "…for Canada (NAEC)" for years without anyone noticing.
  # Only "National Association of Estheticians Inc." names this company. The
  # rest are variants that have each turned up in real copy at some point, so
  # the pattern matches the stem rather than one exact phrasing: "New Age
  # Beauty Academy", "New Age Beauty", "newagebeauty.ca", NABA, and the
  # "…for Canada (NAEC)" wording that sat in the privacy policy for years.
  'wrong entity':        r'\b(new[\s-]?age\s?beauty\w*|NABA|estheticians for canada|NAEC)\b',
}
# An image served from another site's address breaks when that site changes or
# goes offline, so any host other than naeinc.ca warns. That includes
# nvbeautyboutique.com: an earlier note here called it first-party, but how NV
# Beauty relates to NAE is not established, and whether NAE may copy those
# images into assets/ is an open question.
WARN = {
  # Only images. Matching any src= counted the analytics script, so every page
  # warned and the pages with a real third-party image were lost in the noise.
  'third-party image': r'<img\b[^>]*\ssrc="https?://(?!(?:www\.)?naeinc\.ca)[^"]+',
}

# The rules the BLOCK list above was narrower than (second review, 1 Oct 2026):
# NAE's status is never described - not certified, recognised, approved or
# registered, by a ministry or otherwise - and funding is not promised. "Certificate
# of completion" is a true description of what a student receives and is not
# caught. The three companies whose relationship to NAE is unestablished are
# never named.
#
# These refuse a page built from the course and studio lists outright, since an
# edit in Inventory could otherwise put the wording on the site. The migrated
# journal carries them in dozens of posts, so there they warn and are listed for
# Kalleigh's review; they move into BLOCK once that review is done.
#
# Laser, IPL, RF, energy devices and micro-needling are never added as training,
# so a course or studio page naming one is refused. They were a warning everywhere
# after 10 Sept; in the journal they still are, until that review.
REVIEW = {
  'modality':             r'\b(laser|IPL|micro-?needl\w*|botox|injectab\w*|dermal filler|radio[- ]?frequency|energy[- ]device)\b',
  'status wording':       r'\b(certif(?:ied|ications?)|recogni[sz]ed|approved|registered|ministry)\b',
  'funding claim':        r'\bgrants?\b',
  'unestablished entity': r'\b(nv\s*beauty\w*|nvbeautyboutique|beauty\s*bar\s*one|europa\s+beauty\w*)\b',
}

def check(text, strict=False, path=""):
    # Stripping a tag leaves a space behind, so "the <strong>best</strong>"
    # became "the  best" and slipped past every multi-word rule below. Collapse
    # runs of whitespace first: inline markup must not be a way through the gate.
    plain = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', text)))
    # Words a reader sees that are not body text: the page's address, image alt
    # text, and the description and share titles - which live inside <meta> tags,
    # so stripping tags above threw them away unread. The search-result snippet
    # is the copy a searcher is most likely to read, so it is checked like the
    # page. Checked against the review rules, and against everything on a strict
    # page.
    metas = re.findall(r'<meta\s+(?:name|property)="(?:description|keywords|og:title|og:description|'
                       r'twitter:title|twitter:description)"\s+content="([^"]*)"', text, re.I)
    extra = " ".join([re.sub(r'[-_/]+', ' ', path)] +
                     [html.unescape(a) for a in re.findall(r'\salt="([^"]*)"', text)] +
                     [html.unescape(m) for m in metas])
    blocks, warns = [], []
    for label, pat in BLOCK.items():
        hits = {m.group(0).lower() for m in re.finditer(pat, plain + (" " + extra if strict else ""), re.I)}
        if hits: blocks.append((label, sorted(hits)))
    for label, pat in REVIEW.items():
        hits = {m.group(0).lower() for m in re.finditer(pat, plain + " " + extra, re.I)}
        if hits: (blocks if strict else warns).append((label if strict else "review: " + label, sorted(hits)))
    for label, pat in WARN.items():
        n = len(re.findall(pat, text, re.I))
        if n: warns.append((label, n))
    return blocks, warns
