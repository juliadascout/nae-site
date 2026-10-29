-- Stripe replaces PayPal for online payments (29 Oct 2026), as applied to the
-- nae-enrolments D1 database. Rows already here are PayPal sandbox sales and
-- keep their PayPal columns; the provider column says which is which.
--
-- A Checkout Session is the unit Stripe pays against, so its id is the
-- retry-safe key, as paypal_order_id was. SQLite lets a UNIQUE index hold any
-- number of NULLs, so old PayPal rows do not collide with each other here, and
-- new Stripe rows leave paypal_order_id NULL without colliding there.
--
-- The payment intent is what refunds and disputes name, so it is indexed for
-- the webhook to find the row they belong to.

ALTER TABLE enrolments ADD COLUMN provider TEXT NOT NULL DEFAULT 'paypal';
ALTER TABLE enrolments ADD COLUMN stripe_session_id TEXT;
ALTER TABLE enrolments ADD COLUMN stripe_payment_intent TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS enrolments_stripe_session ON enrolments(stripe_session_id);
CREATE INDEX IF NOT EXISTS enrolments_stripe_intent ON enrolments(stripe_payment_intent);
