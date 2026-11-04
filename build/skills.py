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

# What each course page says first, under the course name. One or two sentences,
# then the page adds how long the programme runs. Replaces both the subject's
# general line (BLURB in build.py) and any "lede" above.
#
# The same honesty rule as the tags: every sentence comes from something written
# down - the course name and its parts, its kit and equipment in the catalogue,
# or, for the two skin courses, the 2026 Facial and Microdermabrasion Training
# Manual. "Live model" appears only where the page already said so; hair
# extensions and microblading say what the kit gives you to practise on
# (mannequin head, practice skin). Nothing promises an outcome, a status, or a
# protected title. Reviewed for the copy pass of 4 Nov 2026.
ABOUT = {
    # ---------------------------------------------------------------- lash
    "crs-classic-and-hybrid-lash-extensions":
        "Classic and hybrid lash extensions from consultation to aftercare: isolation, "
        "placement and retention. You work on a live model with your trainer beside you "
        "until each extension goes on cleanly and lasts.",
    "crs-hybrid-and-volume-lash-extensions":
        "Hybrid and volume lash extensions: mapping a fuller set, placing several fine "
        "extensions on one natural lash, and keeping the weight safe for it. Practised on "
        "a live model with your trainer beside you, with the retention and aftercare a "
        "full set needs.",
    "crs-classic-and-volume-lash-extensions":
        "Classic, hybrid and volume lash extensions in one programme, so you can offer "
        "every set from natural to full. You practise on a live model with your trainer "
        "beside you, covering isolation, placement, retention and aftercare for each style.",
    "crs-lash-lift-and-tint":
        "Lifting and tinting the natural lash: consultation, choosing the rod size, timing "
        "the lift solution and tinting safely around the eye. Practised on a live model "
        "with your trainer beside you.",
    "crs-grand-master-lash-artist-classic-volume-lift-and-tint":
        "Classic, hybrid and volume extensions plus the lash lift and tint, so you can offer "
        "every lash service from one chair. Practised on a live model with your trainer "
        "beside you, covering placement, retention, lifting, tinting and aftercare.",
    # ---------------------------------------------------------------- brow
    "crs-brow-mapping":
        "Measuring and mapping brows to suit each face with a caliper, ruler and mapping "
        "string, then shaping to the map. You finish able to draw a balanced brow outline "
        "and repeat it client after client.",
    "crs-eyebrow-lamination-wax-and-tint":
        "Brow lamination, waxing and tinting in one appointment: mapping the shape, setting "
        "the brow hairs in place, tinting, and a wax clean-up to finish. You learn timing, "
        "product handling and aftercare so the result is consistent client after client.",
    "crs-brow-lamination-and-wax":
        "Brow lamination and waxing: mapping the shape, setting the brow hairs in place with "
        "the lift solution, and a wax clean-up to finish. You learn timing, product handling "
        "and aftercare so the result is consistent client after client.",
    "crs-brow-tint-and-wax":
        "Brow tinting and waxing: mapping the shape, mixing and timing tint to suit the "
        "client's colouring, and a wax clean-up to finish. You learn product handling and "
        "aftercare so the result is consistent client after client.",
    "crs-microblading":
        "Brow mapping, stroke patterns and pigment work for microblading, starting on "
        "practice skin before any live work. You also learn the hygiene and aftercare a "
        "semi-permanent brow depends on.",
    "crs-master-brow":
        "Every brow service in one programme: mapping and shaping, lamination, tinting, "
        "waxing and microblading. You build from the quicker services to semi-permanent "
        "work, so you can offer a full brow menu.",
    # ---------------------------------------------------------------- hair extensions
    "crs-fusion-hair-extensions":
        "Applying fusion (bonded) extensions, colour-matching and blending them into the "
        "natural hair, and removing them safely. You practise on a mannequin head before "
        "any live work.",
    "crs-tape-in-hair-extensions":
        "Placing tape-in extensions in clean sections, colour-matching and blending them, "
        "and removing them safely. You practise on a mannequin head before any live work.",
    "crs-micro-link-micro-loop-and-nano-ring-hair-extensions":
        "Three bead methods (micro link, micro loop and nano ring) with the pliers and loop "
        "tool each one needs, plus colour-matching, blending and safe removal. You practise "
        "on a mannequin head before any live work.",
    "crs-braid-in-hair-extensions":
        "Braiding a secure base and attaching extension hair to it, then blending and "
        "finishing the style. You practise on a mannequin head with practice hair before "
        "any live work.",
    "crs-classic-weave-hair-extensions":
        "Braiding a foundation and attaching weft hair for a classic weave, then blending "
        "and finishing the style. You practise on a mannequin head with practice hair "
        "before any live work.",
    "crs-micro-bead-weave-hair-extensions":
        "Fitting a row of micro beads and sewing weft hair onto it with needle and thread, "
        "with no braids underneath, then blending it into the natural hair. You practise on "
        "a mannequin head before any live work.",
    "crs-locs-hair-extensions":
        "Installing loc extensions with a crochet hook, then sectioning, finishing and "
        "caring for them. You practise on a mannequin head before any live work.",
    "crs-classic-master-hair-extensions":
        "Fusion, tape-in, and micro link, micro loop and nano ring extensions in one "
        "programme, so you can match the method to each client's hair. You practise every "
        "method on a mannequin head before any live work, with colour-matching, blending "
        "and safe removal for each.",
    "crs-camille-master-hair-extensions":
        "Braid-in, classic weave and locs extensions in one programme, covering the main "
        "braided and woven styles. You practise on a mannequin head before any live work, "
        "with blending, finishing and aftercare for each method.",
    "crs-grand-master-hair-extensions":
        "All seven hair extension methods we teach, from fusion and tape-in to weaves and "
        "locs, in one programme. You practise each on a mannequin head before any live work, "
        "and learn to match the method to the client's hair and lifestyle.",
    # ---------------------------------------------------------------- skin
    "crs-facial-training":
        "A complete facial from consultation to aftercare: skin analysis, cleansing, "
        "exfoliation, extractions where suitable, massage, masks and moisturizing. You also "
        "learn to screen for contraindications, keep a clean workstation and write a "
        "treatment record for every client.",
    "crs-microdermabrasion-and-facial-training":
        "The full facial sequence plus microdermabrasion, used as the exfoliation step once "
        "a client has been screened as suitable. You learn consultation and consent, "
        "contraindications, safe machine use, and the aftercare and records that go with "
        "every treatment.",
    # ---------------------------------------------------------------- hair removal
    "crs-basic-body-sugaring":
        "Sugaring the face, limbs and underarms: preparing the skin, working the sugar at "
        "the right temperature and removing hair cleanly. You also learn the aftercare that "
        "keeps skin calm afterwards.",
    "crs-sugaring-brazilian-women":
        "Brazilian sugaring for women, building on Basic Body Sugaring: client comfort, "
        "positioning, hygiene and technique for the bikini area. You finish with the "
        "aftercare advice to give every client.",
    "crs-sugaring-brazilian-women-and-men":
        "Brazilian sugaring for women and men, building on Basic Body Sugaring: client "
        "comfort, positioning, hygiene and technique for each. You finish with the aftercare "
        "advice to give every client.",
    "crs-basic-body-waxing":
        "Body waxing with soft and hard wax: preparing the skin, getting the wax temperature "
        "right, and applying and removing it cleanly. You also learn the aftercare that "
        "keeps skin calm afterwards.",
    "crs-basic-body-wax-and-brazilian":
        "Body waxing plus the Brazilian, with soft and hard wax: skin preparation, wax "
        "temperature, clean application and removal, and client comfort for the bikini "
        "area. You also learn the hygiene and aftercare each service needs.",
    "crs-threading":
        "Thread handling and technique for brows and face, from shaping a brow to removing "
        "fine facial hair. Practised on a live model with your trainer beside you.",
    # ---------------------------------------------------------------- nails
    "crs-basic-nail-training":
        "The foundations of nail work: hygiene and tool cleaning, nail preparation, "
        "manicures and polish. You build up preparation, shaping and finish until the "
        "result is consistent.",
    "crs-master-acrylic-nail-technician-tips-and-shaping":
        "Acrylic nail enhancements: preparing the natural nail, applying tips, building and "
        "shaping acrylic, and finishing. You practise until the shape and thickness are "
        "consistent nail after nail.",
    "crs-master-gel-and-gel-x-technician-tips-and-shaping":
        "Gel and Gel X nail extensions: preparing the natural nail, applying tips, building "
        "and shaping gel, curing and finishing. You practise until the shape and finish are "
        "consistent nail after nail.",
    "crs-grand-master-nail-technician-acrylic-gel-tips":
        "Acrylic, gel and tips in one programme, so you can offer the main nail enhancement "
        "services. You practise preparation, application, shaping and finish for each until "
        "the result is consistent.",
    "crs-pedicure-training-course":
        "A full pedicure: preparing and soaking the feet, trimming and shaping, cuticle "
        "care, exfoliation and polish. You also learn the hygiene and tool cleaning a "
        "pedicure station needs.",
    "crs-specialty-designs-nail-technician-advanced":
        "Nail art and design for clients who want more than one colour, building on the nail "
        "skills you already have. You practise each design until it is neat and repeatable.",
    # ---------------------------------------------------------------- makeup
    "crs-basic-makeup-training-on-self":
        "Doing your own makeup well: skin preparation, base, brows, eyes and lips, and "
        "choosing products that suit you. Your trainer gives you a product guide during the "
        "course, so you know what to buy afterwards.",
    "crs-makeup-artist-training-on-other":
        "Doing makeup on other people: skin preparation, matching foundation, brows, eyes "
        "and lips, and building a finished look. You and your trainer shop for your products "
        "together during training, so your kit suits the work you want to do.",
    # ---------------------------------------------------------------- body & other
    "crs-spray-tan":
        "Client preparation, even application and aftercare for spray tanning, practised on "
        "a live model with your trainer beside you. You also learn to set up the tent and "
        "machine and look after the equipment.",
    "crs-relaxation-massage":
        "Relaxation massage: draping, client positioning, flowing strokes and steady "
        "pressure. You learn to keep clients comfortable from the start of the session to "
        "the end.",
    "crs-teeth-whitening-training":
        "Client preparation, whitening application and aftercare for cosmetic teeth "
        "whitening, practised on a live model with your trainer beside you. You also learn "
        "to use an LED light, if your kit includes one.",
    "crs-business-development":
        "The business side of running your own beauty services: choosing who you serve, "
        "naming and registering a business, pricing, records, insurance and marketing. You "
        "work through each step for the services you plan to offer.",
}
