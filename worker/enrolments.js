/* Who bought what, kept where we can see it.

   A payment provider has the record of a sale; this keeps NAE's own, so a sale
   can be followed up, counted, and turned into an enrolment without somebody
   logging into the provider's dashboard and reading it off by hand.

   The buyer's name and email come from the provider. They are personal data,
   so they go in D1 and never near the data repository - a contact committed to
   git is in that history permanently.

   stage and stage_since are here from the first row on purpose: the pipeline
   that will read this needs to know how long something has sat where it is,
   and a timestamp cannot be invented later for rows that predate it.

   THESE MUST NOT FAIL THE CALLER. By the time they run the provider has
   already decided about the money. A failure here is a bookkeeping problem,
   loud in the log, and never a reason to tell the buyer something went wrong.

   The sale arrives as a plain object, so nothing here knows which provider
   sent it (stripe.js builds it from a Checkout Session):

     { provider, sessionId, paymentIntent, courseId, courseName, withKit,
       currency, subtotal, tax, total, payerName, payerEmail, locationId,
       paymentStatus, stage, items: [{label, value}], paidAt, livemode } */
const changes = (r) => (r && r.meta && r.meta.changes) ?? (r && r.changes) ?? 0;

/* Returns "new" for a sale recorded now, "repeat" for one already recorded
   (so it is not confirmed twice), "failed", or "off" with no database. */
export async function recordEnrolment(env, sale) {
  if (!env.ENROLMENTS) return "off";
  try {
    const now = new Date().toISOString();
    const r = await env.ENROLMENTS.prepare(
      `INSERT OR IGNORE INTO enrolments
        (id, created_at, source, course_id, course_name, with_kit, currency,
         subtotal, tax, total, payer_name, payer_email, location_id,
         payment_status, stage, stage_since,
         provider, stripe_session_id, stripe_payment_intent)
       VALUES (?, ?, 'checkout', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), now, sale.courseId || "", sale.courseName || sale.courseId || "",
      sale.withKit ? 1 : 0, sale.currency || "CAD",
      sale.subtotal ?? null, sale.tax ?? null, sale.total ?? null,
      sale.payerName || null, sale.payerEmail || null,
      typeof sale.locationId === "string" && sale.locationId ? sale.locationId.slice(0, 40) : null,
      sale.paymentStatus || null, sale.stage || "paid", now,
      sale.provider || "stripe", sale.sessionId || null, sale.paymentIntent || null,
    ).run();
    return changes(r) === 1 ? "new" : "repeat";
  } catch (e) {
    /* Loud, and only here. The buyer is not told, because nothing about their
       payment went wrong. */
    console.error("enrolment not recorded:", sale && sale.sessionId, e.message);
    return "failed";
  }
}

/* Move a sale to a new stage - paid, refunded, disputed. Matched by the
   session or by the payment intent (refunds and disputes only know the
   latter). Returns how many rows moved: 0 means it was already there, or is
   not a sale this site took, which callers use to send an email only once.
   An unchanged stage keeps its stage_since, so "how long has it sat here"
   stays true. */
export async function setStage(env, { sessionId, paymentIntent }, stage, paymentStatus) {
  if (!env.ENROLMENTS) return 0;
  const col = sessionId ? "stripe_session_id" : "stripe_payment_intent";
  const key = sessionId || paymentIntent;
  if (!key) return 0;
  try {
    const r = await env.ENROLMENTS.prepare(
      `UPDATE enrolments
          SET stage = ?, stage_since = ?, payment_status = COALESCE(?, payment_status)
        WHERE ${col} = ? AND stage <> ?`,
    ).bind(stage, new Date().toISOString(), paymentStatus || null, key, stage).run();
    return changes(r);
  } catch (e) {
    console.error("enrolment stage not changed:", key, stage, e.message);
    return 0;
  }
}

/* What the apps' Worker needs to email the student their confirmation and
   tell the administrators (nae-inc worker/notify.js): the payment as the
   provider reports it, and from the build's catalogue the course, the studio,
   who the seller is, and the refund policy the buyer accepted at checkout.
   Amounts are the provider's, never the page's. */
export function enrolmentNotice(sale, catalogue, taxLabel) {
  const course = (catalogue.courses || {})[sale.courseId || ""] || {};
  const studios = catalogue.studios || {};
  const locationId = typeof sale.locationId === "string" ? sale.locationId : "";
  const fixed = (v) => (v == null ? null : Number(v).toFixed(2));
  return {
    test: sale.livemode !== true,
    name: sale.payerName || "",
    email: sale.payerEmail || "",
    course: course.name || sale.courseName || sale.courseId || "",
    withKit: !!sale.withKit,
    studio: Object.hasOwn(studios, locationId) ? studios[locationId] : null,
    currency: sale.currency || catalogue.currency || "CAD",
    items: Array.isArray(sale.items) ? sale.items : [],
    subtotal: fixed(sale.subtotal),
    tax: fixed(sale.tax),
    taxLabel,
    total: fixed(sale.total),
    reference: sale.paymentIntent || sale.sessionId || "",
    paidAt: sale.paidAt || new Date().toISOString(),
    refundPolicy: catalogue.refundPolicy || null,
    seller: catalogue.seller || null,
  };
}

/* Hand it over. Never makes the caller wait, and nothing that goes wrong here
   reaches the buyer: the payment and the record are already done. */
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
