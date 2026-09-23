/* Who bought what, kept where we can see it.

   Until now a payment left no trace in NAE's own systems: PayPal had the
   record and nobody else did, so a sale could not be followed up, counted, or
   turned into an enrolment without somebody logging into PayPal and reading it
   off by hand.

   The buyer's name and email come back from PayPal on capture. They are
   personal data, so they go in D1 and never near the data repository - a
   contact committed to git is in that history permanently.

   stage and stage_since are here from the first row on purpose: the pipeline
   that will read this needs to know how long something has sat where it is,
   and a timestamp cannot be invented later for rows that predate it.

   THIS MUST NOT FAIL THE PAYMENT. The money has already moved by the time this
   runs. A failure here is a bookkeeping problem, loud in the log, and never a
   reason to tell the buyer something went wrong. */
export async function recordEnrolment(env, order, pu, cap, requestBody, courseName) {
  if (!env.ENROLMENTS) return;
  try {
    const payer = order.payer || {};
    const name = [payer.name?.given_name, payer.name?.surname].filter(Boolean).join(" ");
    const courseId = pu.reference_id || "";
    const breakdown = (pu.amount || {}).breakdown || {};
    const withKit = /\+kit$/.test(pu.custom_id || "") ? 1 : 0;
    const num = (v) => (v == null ? null : Number(v));
    const now = new Date().toISOString();

    await env.ENROLMENTS.prepare(
      `INSERT OR IGNORE INTO enrolments
        (id, created_at, source, course_id, course_name, with_kit, currency,
         subtotal, tax, total, payer_name, payer_email, location_id,
         paypal_order_id, paypal_capture_id, payment_status, stage, stage_since)
       VALUES (?, ?, 'checkout', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?)`,
    ).bind(
      crypto.randomUUID(), now, courseId, courseName || pu.description || courseId,
      withKit, (pu.amount || {}).currency_code || "CAD",
      num((breakdown.item_total || {}).value),
      num((breakdown.tax_total || {}).value),
      num((pu.amount || {}).value),
      name || null, payer.email_address || null,
      typeof requestBody?.locationId === "string" ? requestBody.locationId.slice(0, 40) : null,
      order.id, cap.id || null, order.status || null, now,
    ).run();
  } catch (e) {
    /* Loud, and only here. The buyer is not told, because nothing about their
       payment went wrong. */
    console.error("enrolment not recorded:", order && order.id, e.message);
  }
}
