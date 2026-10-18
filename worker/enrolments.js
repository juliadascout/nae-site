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
   reason to tell the buyer something went wrong.

   Returns "new" for a sale recorded now, "repeat" for one already recorded
   (so it is not confirmed twice), "failed", or "off" with no database. */
const changes = (r) => (r && r.meta && r.meta.changes) ?? (r && r.changes) ?? 0;

export async function recordEnrolment(env, order, pu, cap, requestBody, courseName) {
  if (!env.ENROLMENTS) return "off";
  try {
    const payer = order.payer || {};
    const name = [payer.name?.given_name, payer.name?.surname].filter(Boolean).join(" ");
    const courseId = pu.reference_id || "";
    const breakdown = (pu.amount || {}).breakdown || {};
    /* custom_id and the amount sit on the purchase unit in the full order
       PayPal returns, and on the capture itself in its shorter reply. */
    const withKit = /\+kit$/.test(pu.custom_id || cap.custom_id || "") ? 1 : 0;
    const amount = pu.amount || cap.amount || {};
    const num = (v) => (v == null ? null : Number(v));
    const now = new Date().toISOString();

    const r = await env.ENROLMENTS.prepare(
      `INSERT OR IGNORE INTO enrolments
        (id, created_at, source, course_id, course_name, with_kit, currency,
         subtotal, tax, total, payer_name, payer_email, location_id,
         paypal_order_id, paypal_capture_id, payment_status, stage, stage_since)
       VALUES (?, ?, 'checkout', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?)`,
    ).bind(
      crypto.randomUUID(), now, courseId, courseName || pu.description || courseId,
      withKit, amount.currency_code || "CAD",
      num((breakdown.item_total || {}).value),
      num((breakdown.tax_total || {}).value),
      num(amount.value),
      name || null, payer.email_address || null,
      typeof requestBody?.locationId === "string" ? requestBody.locationId.slice(0, 40) : null,
      order.id, cap.id || null, order.status || null, now,
    ).run();
    return changes(r) === 1 ? "new" : "repeat";
  } catch (e) {
    /* Loud, and only here. The buyer is not told, because nothing about their
       payment went wrong. */
    console.error("enrolment not recorded:", order && order.id, e.message);
    return "failed";
  }
}

/* What the apps' Worker needs to email the student their confirmation and
   tell the administrators (nae-inc worker/notify.js): the payment as PayPal
   reports it, and from the build's catalogue the course, the studio, who the
   seller is, and the refund policy the buyer accepted at checkout. Amounts
   are PayPal's, never the page's. */
export function enrolmentNotice(env, order, pu, cap, requestBody, catalogue, taxLabel) {
  const payer = order.payer || {};
  const course = (catalogue.courses || {})[pu.reference_id || ""] || {};
  const studios = catalogue.studios || {};
  const locationId = typeof requestBody?.locationId === "string" ? requestBody.locationId : "";
  const breakdown = (pu.amount || {}).breakdown || {};
  const amount = cap.amount || pu.amount || {};
  /* The order's own lines (quote() in index.js): the course is the service,
     the kit the one physical item. */
  const items = (Array.isArray(pu.items) ? pu.items : []).map((i) => ({
    label: i.category === "PHYSICAL_GOODS" ? "Kit" : "Course fee",
    value: (Number((i.unit_amount || {}).value) * Number(i.quantity || 1)).toFixed(2),
  }));
  return {
    test: env.PAYPAL_ENV !== "live",
    name: [payer.name?.given_name, payer.name?.surname].filter(Boolean).join(" "),
    email: payer.email_address || "",
    course: course.name || pu.description || pu.reference_id || "",
    withKit: /\+kit$/.test(pu.custom_id || cap.custom_id || ""),
    studio: Object.hasOwn(studios, locationId) ? studios[locationId] : null,
    currency: amount.currency_code || catalogue.currency || "CAD",
    items,
    subtotal: (breakdown.item_total || {}).value || null,
    tax: (breakdown.tax_total || {}).value || null,
    taxLabel,
    total: amount.value || null,
    reference: cap.id || order.id,
    paidAt: cap.create_time || new Date().toISOString(),
    refundPolicy: catalogue.refundPolicy || null,
    seller: catalogue.seller || null,
  };
}

/* Hand it over. Never makes the buyer wait, and nothing that goes wrong here
   reaches them: the payment and the record are already done. */
export function tellEnrolment(env, ctx, notice) {
  const telling = (async () => {
    if (!env.NOTIFY) {
      console.error("enrolment recorded, but nobody was emailed: no NOTIFY binding", notice.reference);
      return;
    }
    try {
      const r = await env.NOTIFY.enrolment(notice);
      if (!r || !r.admins) console.error("enrolment emails: no administrator was emailed", notice.reference, JSON.stringify(r));
      else if (r.student !== "sent") console.log("enrolment emails: student not emailed -", r.student, notice.reference);
    } catch (e) {
      console.error("enrolment emails not sent:", notice.reference, e.message);
    }
  })();
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(telling);
  return telling;
}
