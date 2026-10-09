"""What each course teaches, in the words people search with.

The course name on the page stays exactly as it is in Inventory. These tags sit
beside it: they become the skill list under the course heading, the page title
and description, the "teaches" list in the course's structured data, the skills
line on the course list, and the organisation's "knowsAbout". One list, every
place a search engine or a reader looks for what a course covers.

Where the words come from, and the rule that keeps them honest:
  - A tag names a technique that the course's own name, its bundle parts, or
    its catalogue entry already states. "Lash Lift & Tint" teaches a lash lift
    and a lash tint; "Classic Master Hair Extensions" teaches what its three
    parts teach. Nothing here describes a curriculum nobody has written down.
  - The search phrase is the wording people actually type (Google Keyword
    Planner, Canada, 9 Oct 2026). "Course" is what they type far more than
    "training" or "programme".
  - Every tag goes through the compliance gate with the page it is on. No status
    words (certified, certification, accredited, licensed, approved, registered),
    no laser, IPL, RF, energy-device or micro-needling training, no injectables,
    and no protected title - Relaxation Massage is "relaxation massage", never
    "massage therapy". The gate refuses the page if one slips in.

Tags are search wording only. They are not modalities and never feed instructor
coverage: coverage is computed from modality ids in the apps, and nothing reads
these for that.

Keyed by course id, never by name, so renaming a course in Inventory keeps its
tags. A course with no entry here still publishes - its own name stands in as
its only tag, and the build lists it so someone can add a line. An entry whose
course has gone is listed too, and otherwise ignored.

Fields:
  subject  - which section of the course list it sits in (SUBJECTS below)
  search   - the search phrase, without "Course"; the title becomes
             "<search> Course | NAE" when that fits in sixty characters
  title    - optional: the whole title, for bundles whose names say less than
             what they contain
  teaches  - the techniques, in reading order. A bundle with no list of its own
             teaches whatever its parts teach.
  lede     - optional: replaces the subject's opening line where that line does
             not describe this course (a lash lift is not an extension)
"""

# Display order and labels. The key is what the anchors on the course list
# (/courses/#lash) and the home page tiles use; the label is display only, so
# renaming one breaks nothing. Makeup was folded into "Body & other" when the
# subjects were worked out from course names; it is its own search market
# ("makeup artist course" is one of the larger ones in Canada), so it is its own
# section now.
SUBJECTS = [("lash", "Lash"), ("brow", "Brow"), ("hair", "Hair extensions"),
            ("skin", "Skin"), ("nails", "Nails"), ("remove", "Hair removal"),
            ("makeup", "Makeup"), ("body", "Body & other")]

SKILLS = {
    # ---------------------------------------------------------------- lash
    "crs-classic-and-hybrid-lash-extensions": {
        "subject": "lash", "search": "Classic & Hybrid Lash Extension",
        "teaches": ["Classic lash extensions", "Hybrid lash extensions"]},
    "crs-hybrid-and-volume-lash-extensions": {
        "subject": "lash", "search": "Hybrid & Volume Lash Extension",
        "teaches": ["Hybrid lash extensions", "Volume lash extensions"]},
    "crs-classic-and-volume-lash-extensions": {
        "subject": "lash", "search": "Classic & Volume Lash Extension"},
    "crs-lash-lift-and-tint": {
        "subject": "lash", "search": "Lash Lift & Tint",
        "teaches": ["Lash lift", "Lash tint"],
        "lede": "Lifting and tinting the natural lash, practised on a live model "
                "with your trainer beside you."},
    "crs-grand-master-lash-artist-classic-volume-lift-and-tint": {
        "subject": "lash", "search": "Lash Extension, Lift & Tint",
        "title": "Grand Master Lash Course: Extensions, Lift & Tint | NAE"},

    # ---------------------------------------------------------------- brow
    "crs-brow-mapping": {
        "subject": "brow", "search": "Brow Mapping",
        "teaches": ["Brow mapping", "Brow shaping"]},
    "crs-eyebrow-lamination-wax-and-tint": {
        "subject": "brow", "search": "Brow Lamination, Wax & Tint",
        "teaches": ["Brow lamination", "Brow waxing", "Brow tinting"]},
    "crs-brow-lamination-and-wax": {
        "subject": "brow", "search": "Brow Lamination & Wax",
        "teaches": ["Brow lamination", "Brow waxing"]},
    "crs-brow-tint-and-wax": {
        "subject": "brow", "search": "Brow Tint & Wax",
        "teaches": ["Brow tinting", "Brow waxing"]},
    "crs-microblading": {
        "subject": "brow", "search": "Microblading",
        "teaches": ["Microblading"]},
    # NAE's own page for this course says it "teaches eyebrow mapping & shaping,
    # eyebrow microblading, eyebrow lamination lift and tint"
    # (/master-brow-artist-microblading-lamination-lift-and-tint/), and the
    # catalogue describes its kit as "lamination, wax, tint & microblading
    # materials combined".
    "crs-master-brow": {
        "subject": "brow", "search": "Master Brow",
        "title": "Master Brow Course: Lamination to Microblading | NAE",
        "teaches": ["Brow mapping", "Brow shaping", "Microblading", "Brow lamination",
                    "Brow tinting", "Brow waxing"]},

    # ---------------------------------------------------------------- hair extensions
    "crs-fusion-hair-extensions": {
        "subject": "hair", "search": "Fusion Hair Extension",
        "teaches": ["Fusion hair extensions"]},
    "crs-tape-in-hair-extensions": {
        "subject": "hair", "search": "Tape-In Hair Extension",
        "teaches": ["Tape-in hair extensions"]},
    "crs-micro-link-micro-loop-and-nano-ring-hair-extensions": {
        "subject": "hair", "search": "Micro Link & Nano Ring Hair Extension",
        "teaches": ["Micro link hair extensions", "Micro loop hair extensions",
                    "Nano ring hair extensions"]},
    "crs-braid-in-hair-extensions": {
        "subject": "hair", "search": "Braid-In Hair Extension",
        "teaches": ["Braid-in hair extensions"]},
    "crs-classic-weave-hair-extensions": {
        "subject": "hair", "search": "Classic Weave Hair Extension",
        "teaches": ["Classic weave hair extensions"]},
    "crs-micro-bead-weave-hair-extensions": {
        "subject": "hair", "search": "Micro Bead Weave Hair Extension",
        "teaches": ["Micro bead weave hair extensions"]},
    "crs-locs-hair-extensions": {
        "subject": "hair", "search": "Locs Hair Extension",
        "teaches": ["Locs hair extensions"]},
    "crs-classic-master-hair-extensions": {
        "subject": "hair", "search": "Hair Extension",
        "title": "Hair Extension Course: Fusion, Tape-In & Micro Link | NAE"},
    "crs-camille-master-hair-extensions": {
        "subject": "hair", "search": "Weave, Braid-In & Locs Extension"},
    "crs-grand-master-hair-extensions": {
        "subject": "hair", "search": "Hair Extension",
        "title": "Grand Master Hair Extension Course: 7 Methods | NAE"},

    # ---------------------------------------------------------------- skin
    "crs-facial-training": {
        "subject": "skin", "search": "Facial Training",
        "teaches": ["Facial treatments"]},
    "crs-microdermabrasion-and-facial-training": {
        "subject": "skin", "search": "Microdermabrasion & Facial",
        "teaches": ["Microdermabrasion", "Facial treatments"]},

    # ---------------------------------------------------------------- hair removal
    # The 2026-27 curriculum names the areas: "Basic Body Sugaring (face, limbs,
    # underarms)".
    "crs-basic-body-sugaring": {
        "subject": "remove", "search": "Body Sugaring",
        "teaches": ["Body sugaring", "Face sugaring", "Limb and underarm sugaring"]},
    "crs-sugaring-brazilian-women": {
        "subject": "remove", "search": "Women's Brazilian Sugaring",
        "teaches": ["Brazilian sugaring"]},
    "crs-sugaring-brazilian-women-and-men": {
        "subject": "remove", "search": "Brazilian Sugaring for Women & Men",
        "title": "Brazilian Sugaring Course for Women & Men | NAE",
        "teaches": ["Brazilian sugaring for women and men"]},
    "crs-basic-body-waxing": {
        "subject": "remove", "search": "Body Waxing",
        "teaches": ["Body waxing"]},
    "crs-basic-body-wax-and-brazilian": {
        "subject": "remove", "search": "Body Wax & Brazilian Wax",
        "teaches": ["Body waxing", "Brazilian waxing"]},
    "crs-threading": {
        "subject": "remove", "search": "Threading",
        "teaches": ["Eyebrow threading", "Thread hair removal"],
        "lede": "Thread handling and technique for brows and face, practised on a "
                "live model with your trainer beside you."},

    # ---------------------------------------------------------------- nails
    "crs-basic-nail-training": {
        "subject": "nails", "search": "Basic Nail Technician",
        "teaches": ["Nail technician basics"]},
    "crs-master-acrylic-nail-technician-tips-and-shaping": {
        "subject": "nails", "search": "Acrylic Nail",
        "title": "Acrylic Nail Course: Tips & Shaping | NAE",
        "teaches": ["Acrylic nails", "Nail tips", "Nail shaping"]},
    "crs-master-gel-and-gel-x-technician-tips-and-shaping": {
        "subject": "nails", "search": "Gel & Gel X Nail",
        "title": "Gel & Gel X Nail Course: Tips & Shaping | NAE",
        "teaches": ["Gel nails", "Gel X nail extensions", "Nail tips", "Nail shaping"]},
    "crs-grand-master-nail-technician-acrylic-gel-tips": {
        "subject": "nails", "search": "Nail Technician",
        "title": "Nail Technician Course: Acrylic, Gel & Tips | NAE",
        "teaches": ["Acrylic nails", "Gel nails", "Nail tips"]},
    "crs-pedicure-training-course": {
        "subject": "nails", "search": "Pedicure",
        "teaches": ["Pedicures"]},
    "crs-specialty-designs-nail-technician-advanced": {
        "subject": "nails", "search": "Nail Art & Design",
        "title": "Nail Art & Design Course (Advanced) | NAE",
        "teaches": ["Nail art", "Nail designs"]},

    # ---------------------------------------------------------------- makeup
    "crs-basic-makeup-training-on-self": {
        "subject": "makeup", "search": "Basic Makeup",
        "title": "Basic Makeup Course (On Yourself) | NAE",
        "teaches": ["Makeup application on yourself"]},
    "crs-makeup-artist-training-on-other": {
        "subject": "makeup", "search": "Makeup Artist",
        "teaches": ["Makeup application on clients", "Makeup artistry"]},

    # ---------------------------------------------------------------- body & other
    "crs-spray-tan": {
        "subject": "body", "search": "Spray Tan",
        "teaches": ["Spray tanning"],
        "lede": "Client preparation, even application and aftercare, practised on a "
                "live model with your trainer beside you."},
    "crs-relaxation-massage": {
        "subject": "body", "search": "Relaxation Massage",
        "teaches": ["Relaxation massage"]},
    "crs-teeth-whitening-training": {
        "subject": "body", "search": "Teeth Whitening",
        "teaches": ["Cosmetic teeth whitening"],
        "lede": "Client preparation, whitening application and aftercare, practised "
                "on a live model with your trainer beside you."},
    "crs-business-development": {
        "subject": "body", "search": "Beauty Business Development",
        "teaches": ["Beauty business development"],
        "lede": "The business side of running your own beauty services."},
}
