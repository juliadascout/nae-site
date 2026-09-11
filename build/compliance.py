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
# nvbeautyboutique.com is owned by the same people (confirmed 10 Sept), so its
# images and links are first-party and are deliberately preserved. Only genuinely
# third-party asset hosts are worth a warning - those can disappear without notice.
# Modalities: Julia approved these on 10 Sept - what the curriculum covers is
# hers to decide. Kept as a warning rather than a block, so a page naming one is
# still surfaced for a look instead of being silently published. Protected titles
# and registration/accreditation claims stay blocks: those are not curriculum.
WARN = {
  'modality - review': r'\b(laser|IPL|micro-?needl\w*|botox|injectab\w*|dermal filler)\b',
  'third-party image': r'src="https?://(?!(?:www\.)?(?:naeinc\.ca|nvbeautyboutique\.com))[^"]+',
}

def check(text):
    # Stripping a tag leaves a space behind, so "the <strong>best</strong>"
    # became "the  best" and slipped past every multi-word rule below. Collapse
    # runs of whitespace first: inline markup must not be a way through the gate.
    plain = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', text)))
    blocks, warns = [], []
    for label, pat in BLOCK.items():
        hits = {m.group(0).lower() for m in re.finditer(pat, plain, re.I)}
        if hits: blocks.append((label, sorted(hits)))
    for label, pat in WARN.items():
        n = len(re.findall(pat, text, re.I))
        if n: warns.append((label, n))
    return blocks, warns
