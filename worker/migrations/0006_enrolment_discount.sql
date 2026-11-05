-- The amount a promotion code took off at Stripe checkout, before HST
-- (Stripe's total_details.amount_discount). NULL when no code was used.
-- subtotal stays the list price, so subtotal - discount + tax = total.
-- Run once:  npx wrangler d1 execute nae-enrolments --remote --file=worker/migrations/0006_enrolment_discount.sql
ALTER TABLE enrolments ADD COLUMN discount REAL;
