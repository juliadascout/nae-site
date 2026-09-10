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

## The compliance gate

`build/compliance.py` encodes the wording rules. Every page is checked **before it
is written**; a page that trips a rule is not emitted at all, and the build reports
it. This covers prohibited modalities, protected titles, superlatives, status
claims, and career-outcome claims that do not match Ontario reality.

The build is the enforcement point. A rule that lives only in someone's head gets
forgotten; this one fails the build.

## URLs

The 21 `beauty-school-near-*` pages are generated at the **exact paths they already
hold on the live site**, because those pages carry the search traffic. Changing
their addresses would throw that away. Verified: 21 of 21 match.

## Deploying

Build output is `public/`. Host it anywhere static.

Note: GitHub Pages' terms exclude sites "primarily directed at facilitating
commercial transactions", which a site selling courses would be. Cloudflare Pages
and Netlify both permit commercial use on their free tiers and deploy from this
repo directly.

## Not in this repo

**The WordPress export.** It contains customer order records and several thousand
email addresses.

**The 195 migrated editorial pages.** They are built and compliance-clean, but they
name eight individuals and carry seven unidentified phone numbers that may be
personal mobiles. No student, candidate or staff personal data goes into this
repository - public or private - without a specific decision to put it there.

Build them locally by pointing NAE_CLEAN at the cleaned corpus:

```sh
NAE_CLEAN=/path/to/clean python3 build/build.py
```

The generator handles them identically; only the commit is withheld.
