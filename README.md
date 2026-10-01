# nae-site

Static site for naeinc.ca. No WordPress, no PHP, no plugins, no database at runtime.

## How it works

`build/build.py` reads course and location records from the **nae-data** repo and
writes a complete static site to `public/`. Nothing about a course — its name,
price, hours, or kit — is typed into a template. That is deliberate: the live
WordPress site currently publishes four course price lists that disagree with each
other, because the same list is pasted into 21 area pages by hand. Generating them
from one source makes that failure impossible rather than merely unlikely.

## Build

```sh
git clone https://github.com/juliadascout/nae-data   # beside this repo
python3 build/build.py
```

Or point it anywhere:

```sh
NAE_DATA=/path/to/nae-data/data NAE_OUT=/path/to/output python3 build/build.py
```

The journal pages are built from `content/editorial/`, which the build reads by
default (`NAE_CLEAN` points it elsewhere). If it cannot find them it stops, rather
than emptying `public/` and writing a site without the journal.

`NAE_STRICT=1` checks every page before writing anything, and stops if the
compliance gate refuses one. Without it a refused page is left out and reported,
as before.

## The compliance gate

`build/compliance.py` encodes the wording rules. Every page is checked **before it
is written**; a page that trips a rule is not emitted at all, and the build reports
it. This covers prohibited modalities, protected titles, superlatives, status
claims, and career-outcome claims that do not match Ontario reality.

The build is the enforcement point. A rule that lives only in someone's head gets
forgotten; this one fails the build.

A second set of rules (status wording such as "certified" or "approved", funding
claims, laser and similar modalities, and the companies whose relationship to NAE
is not established) refuses any page built from the course and studio lists, so
an edit in Inventory cannot put that wording on the site. On journal pages the
same rules only warn for now, because dozens of posts carry the wording and
are waiting on Kalleigh's review. `NAE_REVIEW_OUT=review.csv` writes that list: page,
rule, words found. Once the review is done those rules block everywhere.

A page can also be left out on purpose: `WITHHELD` in `build/build.py` names it
and says why. The build reports it every time.

## URLs

The 21 `beauty-school-near-*` pages are generated at the **exact paths they already
hold on the live site**, because those pages carry the search traffic. Changing
their addresses would throw that away. Verified: 21 of 21 match.

## Deploying

Build output is `public/`. Host it anywhere static.

`assets/_headers` marks every workers.dev address `noindex`, so the preview copy
never competes with naeinc.ca in search results. It does not apply to naeinc.ca.

The site republishes itself when the course or studio list changes. A workflow in
nae-data (`.github/workflows/publish-website.yml`) runs on any change to
`data/locations.json` or `data/course-catalog.json`. It builds strictly and pushes
`public/` and `worker/prices.json` here, and Cloudflare deploys the push. A page the
gate refuses fails the run before anything is pushed.

Note: GitHub Pages' terms exclude sites "primarily directed at facilitating
commercial transactions", which a site selling courses would be. Cloudflare Pages
and Netlify both permit commercial use on their free tiers and deploy from this
repo directly.

## Not in this repo

**The WordPress export.** It contains customer order records and several thousand
email addresses.

No student, candidate or staff personal data goes into this repository - public
or private - without a specific decision to put it there.

**Correction (1 Oct 2026):** this section used to list the migrated journal here
too. It has been in `content/editorial/` since 11 September. It is being reviewed
page by page (keep, redirect or retire, and redact) before naeinc.ca moves to this
build.
