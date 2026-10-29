-- The CRM's lead record, as applied to the nae-enrolments D1 database
-- (29 Oct 2026). One row per person, found by email address, whatever brought
-- them in: a question from the Contact page, a checkout, a booked call, or
-- somebody typing them in. The enquiries and enrolments tables stay the
-- record of each thing that happened; a lead is the person they happened to.
--
-- Personal data, here and never in git (the apps' old contacts.json was in
-- git; its few rows come in as source 'import').

CREATE TABLE IF NOT EXISTS leads (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  email         TEXT NOT NULL,        -- lower-cased; the one key across sources
  name          TEXT,
  phone         TEXT,
  course_id     TEXT,                 -- the course they last asked about or bought
  location_id   TEXT,
  source        TEXT NOT NULL,        -- how they first came: enquiry, checkout, booking, manual, import
  -- new -> contacted -> booked -> enrolled, or lost (with lost_reason).
  -- Automatic moves only go forward; a person moves a lead anywhere.
  stage         TEXT NOT NULL DEFAULT 'new',
  stage_since   TEXT NOT NULL,
  owner         TEXT,                 -- who follows them up (an account email)
  lost_reason   TEXT,
  last_contact_at TEXT,
  note          TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS leads_stage ON leads(stage, stage_since);

-- What happened to a lead, newest last. Never edited: the timeline on the
-- lead card, and the evidence of when somebody was answered.
CREATE TABLE IF NOT EXISTS lead_events (
  id        TEXT PRIMARY KEY,
  lead_id   TEXT NOT NULL,
  at        TEXT NOT NULL,
  kind      TEXT NOT NULL,            -- enquiry, auto-reply, checkout, paid, stage, note, ...
  detail    TEXT,
  actor     TEXT                      -- an account email, or 'system'
);
CREATE INDEX IF NOT EXISTS lead_events_lead ON lead_events(lead_id, at);

-- Canada's anti-spam law puts proving consent on the sender (CASL s.13).
-- Each row is one grant, kept as it was given: implied by a question (good
-- for 6 months) or a purchase (2 years), or express (a ticked box, until
-- withdrawn). Never edited except to set withdrawn_at.
CREATE TABLE IF NOT EXISTS consents (
  id            TEXT PRIMARY KEY,
  lead_id       TEXT NOT NULL,
  email         TEXT NOT NULL,
  kind          TEXT NOT NULL,        -- implied_inquiry, implied_purchase, express
  given_at      TEXT NOT NULL,
  expires_at    TEXT,                 -- NULL for express consent
  wording       TEXT,                 -- the words the person saw, for express consent
  source        TEXT,                 -- the form or checkout it came from
  withdrawn_at  TEXT
);
CREATE INDEX IF NOT EXISTS consents_email ON consents(email, kind);

ALTER TABLE enquiries  ADD COLUMN lead_id TEXT;
ALTER TABLE enrolments ADD COLUMN lead_id TEXT;
