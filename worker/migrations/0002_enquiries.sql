-- Questions from the website's Contact page, as applied to the nae-enrolments
-- D1 database (worker/enquiries.js). Beside the enrolments: both are the record
-- of who wants what, and neither belongs anywhere a password hash is.
--
-- Kept for a year, then deleted by the Worker as new questions arrive; the
-- network address only for a day, for the hourly limit.

CREATE TABLE IF NOT EXISTS enquiries (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  name        TEXT NOT NULL,          -- personal data: here, never in git
  email       TEXT NOT NULL,
  phone       TEXT,
  course_id   TEXT,                   -- a course in the catalogue, or none
  message     TEXT NOT NULL,
  ip          TEXT,                   -- cleared after a day
  -- For the same pipeline as the enrolments: how long a question has sat
  -- unanswered cannot be reconstructed for rows written without it.
  stage       TEXT NOT NULL DEFAULT 'new',
  stage_since TEXT NOT NULL,
  note        TEXT
);

CREATE INDEX IF NOT EXISTS enquiries_created ON enquiries(created_at);
CREATE INDEX IF NOT EXISTS enquiries_ip      ON enquiries(ip, created_at);
CREATE INDEX IF NOT EXISTS enquiries_stage   ON enquiries(stage, stage_since);
