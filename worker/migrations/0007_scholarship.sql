-- Scholarship applications from the website's /scholarship/ page, as applied
-- to the nae-enrolments D1 database (worker/scholarship.js). Beside the
-- questions and enrolments: the record of who wants what. Personal data:
-- here, never in git. Read by staff through the apps (nae-inc
-- /api/leads/scholarship.csv). The network address is cleared after a day.

CREATE TABLE IF NOT EXISTS scholarship_applications (
  id           TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  scholarship  TEXT NOT NULL,          -- which one: lily-mather-2026
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT,
  place        TEXT NOT NULL,          -- city / region and country
  business     TEXT,
  web          TEXT,                   -- website or social media
  studio       TEXT,                   -- preferred studio, by name
  courses      TEXT,                   -- JSON list of course names
  experience   TEXT,
  heard        TEXT,                   -- how they heard about it
  q1           TEXT NOT NULL,
  q2           TEXT NOT NULL,
  q3           TEXT NOT NULL,
  q4           TEXT NOT NULL,
  q5           TEXT,
  signature    TEXT NOT NULL,
  declared     INTEGER NOT NULL DEFAULT 0,
  marketing    INTEGER NOT NULL DEFAULT 0,  -- ticked "send me news": express consent
  account      TEXT,                   -- pending, created, existing, none, failed
  lead_id      TEXT,
  ip           TEXT,                   -- cleared after a day
  stage        TEXT NOT NULL DEFAULT 'new',
  stage_since  TEXT NOT NULL,
  note         TEXT
);

CREATE INDEX IF NOT EXISTS scholarship_created ON scholarship_applications(created_at);
CREATE INDEX IF NOT EXISTS scholarship_ip      ON scholarship_applications(ip, created_at);
CREATE INDEX IF NOT EXISTS scholarship_email   ON scholarship_applications(email);
