-- Who bought what, as applied to the nae-enrolments D1 database.
-- Separate from the accounts database on purpose: this Worker serves the
-- public site and has no business being able to read a password hash.

CREATE TABLE IF NOT EXISTS enrolments (
  id                TEXT PRIMARY KEY,
  created_at        TEXT NOT NULL,
  source            TEXT NOT NULL DEFAULT 'checkout',
  course_id         TEXT NOT NULL,
  course_name       TEXT NOT NULL,
  with_kit          INTEGER NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'CAD',
  subtotal          REAL,
  tax               REAL,
  total             REAL,
  payer_name        TEXT,            -- personal data: here, never in git
  payer_email       TEXT,
  location_id       TEXT,            -- which studio they chose
  paypal_order_id   TEXT UNIQUE,     -- UNIQUE is what makes a retry idempotent
  paypal_capture_id TEXT,            -- reconciles against GA4's transaction_id
  payment_status    TEXT,
  -- The pipeline reads these. Present from the first row because "how long has
  -- this sat here" cannot be reconstructed for rows written before it existed.
  stage             TEXT NOT NULL DEFAULT 'paid',
  stage_since       TEXT NOT NULL,
  note              TEXT
);

CREATE INDEX IF NOT EXISTS enrolments_stage   ON enrolments(stage, stage_since);
CREATE INDEX IF NOT EXISTS enrolments_created ON enrolments(created_at);
CREATE INDEX IF NOT EXISTS enrolments_email   ON enrolments(payer_email);
