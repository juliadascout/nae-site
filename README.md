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

The gate also reads the search-result description and the share titles. They sit
inside `<meta>` tags, which the gate used to strip unread.

## Skill tags

`build/skills.py` says what each course teaches, in the words people search with
("lash lift", "brow lamination", "microblading"). One list feeds:

- the **Skills covered** list under each course's name
- the page title (`<search phrase> Course | NAE`) and search description
- `teaches` and `keywords` in the course's structured data
- the skills line under each subject on `/courses/`, and that page's catalogue
- `knowsAbout` for the organisation (home page) and for each studio

The course name on the page never changes; only the title in the search result
leads with the search phrase. Tags are keyed by course id, so a rename in
Inventory keeps them. A tag only names what the course's name, its bundle parts or
its catalogue entry already state, and every page it lands on goes through the
gate. Tags are search wording only: they are not modalities and nothing computes
instructor coverage from them.

A course added in Inventory publishes straight away with its own name as its only
tag. The build log lists it under `skill tags` until someone adds a line for it.

## Course addresses

A course's address comes from its name, so a rename in Inventory moves its page.
The build keeps every address each course id has had in
`public/_course-addresses.json` and answers the old ones with a 301 to the new
page (to `/courses/` if the course is archived or deleted), so ads, bookmarks and
links to the old address keep working. `assets/.assetsignore` keeps that file off
the live site. The build log lists the moves under `course pages moved`.

## URLs

The 21 `beauty-school-near-*` pages are generated at the **exact paths they already
hold on the live site**, because those pages carry the search traffic. Changing
their addresses would throw that away. Verified: 21 of 21 match.

## Deploying

Build output is `public/`. Host it anywhere static.

`assets/_headers` marks every workers.dev address `noindex`, so the preview copy
never competes with the real domain in search results. It does not apply there.

### Where the site sits

**Decided 9 Oct 2026 (Kalleigh): option E, a new domain of its own.** The
WordPress site stays up at naeinc.ca for now. Two settings in `SITE` at the top of
`build/build.py` carry that, and nothing else does:

- `domain`: where this site is served. Every canonical address, sitemap entry,
  structured-data URL and share link follows it.
- `legacy`: the old site, while it is still up (`"https://naeinc.ca"`). The 163
  pages copied from WordPress then name their naeinc.ca original as the page to
  rank, and stay out of this site's sitemap. The journal's index, category and tag
  pages are kept out of search, and the organisation's structured data lists
  naeinc.ca as the same organisation's other site. Two sites with the same words
  compete, and the older one wins. This way they do not compete, and this site
  ranks for what only it has: the courses, prices, studios and checkout.
  Set it back to `None` the day naeinc.ca is redirected here, and rebuild.

`NAE_DOMAIN` and `NAE_LEGACY` override both settings for a test build. The publish
workflow sets neither, so what is written in `SITE` is what goes live.

Switching to the new domain, in order:

1. Register the domain in NAE's name, in an account NAE controls.
2. Add it to Cloudflare and move its nameservers there.
3. If nothing sends email from it, publish `v=spf1 -all` and a DMARC record with
   `p=reject`, so nobody else can send as it. If something will send email from it,
   set up that service's SPF and DKIM records instead.
4. Set `domain` (and `legacy`, while naeinc.ca is up) and merge. The site rebuilds.
5. Attach the domain to the `nae-site` Worker as a custom domain, and redirect
   `www` to it.
6. Add it to Google Search Console (DNS verification) and submit the sitemap. Verify
   it for Meta ads as well.
7. In Cloudflare's AI Crawl Control, allow the AI crawlers that cite their sources.

`NAE_BASE` decides where the site sits *on* its domain. Every internal link, image,
stylesheet, canonical address, sitemap entry and structured-data URL follows it.

- **At the root** (the default, `NAE_BASE` unset): the new site replaces the
  WordPress one. Old addresses on `content/redirects.csv` are answered with 301s.
- **In a subfolder** (`NAE_BASE=/beauty-school`): the old site keeps the root.
  No redirects are written, because the old site still answers its own addresses.
  For the checkout to work there, give the Worker the same value as `SITE_BASE`
  and add `"/beauty-school/api/*"` to `run_worker_first` in `wrangler.toml`.
- **Subfolder first, root later**: build with the base, then rebuild without it
  and add `/beauty-school/* /:splat 301` to `content/redirects.csv`.

The build refuses a base that is not a plain path such as `/beauty-school`.

### Redirects

`content/redirects.csv` is the one list of old WordPress addresses that now live
somewhere else: the old address, where it goes, and why. The build:

- publishes nothing at an old address on the list
- points links in the journal straight at the new page
- writes `public/_redirects`, which Cloudflare answers with a 301
- stops, before writing anything, if a redirect points at a page it is not building

The list came from the live site on 9 October 2026, read through the WordPress
REST API. Every other old address already has a page at the same place on the new
site, except the retired posts, which return the 404 page on purpose.

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
