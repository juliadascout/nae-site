-- Follow-ups on the lead record, and the questions that came in before leads
-- existed.
--
-- next_follow_up_at: when somebody should next contact this person. The Leads
-- board in the apps (nae-inc) sorts its "Due" list by it; NULL means nothing is
-- scheduled. It is set by a person on the board, or by the automations that
-- follow up a question or an abandoned checkout.
--
-- The backfill turns every question on the enquiries table that has no lead
-- into one, the way noteLead() would have when it arrived: matched on the
-- lower-cased email, source "enquiry", stage "new", implied consent for six
-- months from the day it was asked (CASL s.10(10)). Copied by SQL from the rows
-- already in D1, so no personal data passes through this file or git.
-- Run once:  npx wrangler d1 execute nae-enrolments --remote --file=worker/migrations/0005_lead_followups.sql

-- D1 is SQLite: there is no CREATE INDEX CONCURRENTLY, and the table is small.
ALTER TABLE leads ADD COLUMN next_follow_up_at TEXT;
CREATE INDEX IF NOT EXISTS leads_follow_up ON leads(next_follow_up_at);

INSERT OR IGNORE INTO leads (id, created_at, updated_at, email, name, phone, course_id, location_id,
                             source, stage, stage_since, next_follow_up_at)
SELECT lower(hex(randomblob(16))), e.created_at, e.created_at, lower(trim(e.email)), e.name, e.phone,
       e.course_id, NULL, 'enquiry', 'new', e.created_at, e.created_at
  FROM enquiries e
 WHERE e.lead_id IS NULL
   AND e.created_at = (SELECT MIN(x.created_at) FROM enquiries x WHERE lower(trim(x.email)) = lower(trim(e.email)));

UPDATE enquiries
   SET lead_id = (SELECT l.id FROM leads l WHERE l.email = lower(trim(enquiries.email)))
 WHERE lead_id IS NULL;

INSERT INTO lead_events (id, lead_id, at, kind, detail, actor)
SELECT lower(hex(randomblob(16))), e.lead_id, e.created_at, 'enquiry', 'Question from the Contact page (added from earlier records)', 'system'
  FROM enquiries e
 WHERE e.lead_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM lead_events v WHERE v.lead_id = e.lead_id AND v.kind = 'enquiry' AND v.at = e.created_at);

INSERT INTO consents (id, lead_id, email, kind, given_at, expires_at, source)
SELECT lower(hex(randomblob(16))), e.lead_id, lower(trim(e.email)), 'implied_inquiry', e.created_at,
       strftime('%Y-%m-%dT%H:%M:%fZ', e.created_at, '+6 months'), 'enquiry'
  FROM enquiries e
 WHERE e.lead_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM consents c WHERE c.lead_id = e.lead_id AND c.kind = 'implied_inquiry' AND c.given_at = e.created_at);
