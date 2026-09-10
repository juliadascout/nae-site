"""The rule, as code. A page that trips this is not written — it is quarantined
   for a human to look at. Cheaper to enforce at build time than to audit later."""
import re, html

BLOCK = {
  'status claim':        r'\b(accredited|accreditation|licensed (school|college|institution)|diploma)\b',
  'prohibited modality': r'\b(laser|IPL|micro-?needl\w*|botox|injectab\w*|dermal filler)\b',
  'protected title':     r'\b(nurse|massage therapist|registered massage)\b',
  'superlative':         r"\b(the best|top beauty|leading beauty|premier|canada'?s top|niagara'?s top|#1 beauty)\b",
  'career-outcome claim':r'\b(licensed (aesthetician|esthetician)|cosmetology licen[cs]e)\b',
  'wrong entity':        r'\b(new age beauty academy)\b',
}
# nvbeautyboutique.com is owned by the same people (confirmed 10 Sept), so its
# images and links are first-party and are deliberately preserved. Only genuinely
# third-party asset hosts are worth a warning - those can disappear without notice.
WARN = {
  'third-party image': r'src="https?://(?!(?:www\.)?(?:naeinc\.ca|nvbeautyboutique\.com))[^"]+',
}

def check(text):
    plain = html.unescape(re.sub(r'<[^>]+>', ' ', text))
    blocks, warns = [], []
    for label, pat in BLOCK.items():
        hits = {m.group(0).lower() for m in re.finditer(pat, plain, re.I)}
        if hits: blocks.append((label, sorted(hits)))
    for label, pat in WARN.items():
        n = len(re.findall(pat, text, re.I))
        if n: warns.append((label, n))
    return blocks, warns
