import { recordEnrolment, setStage, enrolmentNotice, tellEnrolment } from "./enrolments.js";
import { noteLead } from "./leads.js";

/* Stripe Checkout: how the site takes payment (29 Oct 2026, replacing PayPal).

   The shape is what makes it safe. The Worker creates the Checkout Session
   from its own price list, so the amount is decided where a buyer cannot
   reach it; the buyer pays on Stripe's page; and a sale is recorded and
   confirmed ONLY when Stripe's signed webhook says the session is paid. The
   browser coming back to the site proves nothing and records nothing - under
   PayPal it did, and a $1 order made with the public client id was recorded
   and confirmed as a $1,400 enrolment.

   Configuration (wrangler.toml and Worker secrets):
     STRIPE_SECRET_KEY      secret  sk_test_... / sk_live_... (or a restricted rk_ key)
     STRIPE_WEBHOOK_SECRET  secret  whsec_... from the webhook endpoint
     STRIPE_HST_RATE        var     optional. Left empty, the Worker finds or
                                    creates the "HST 13%" tax rate in Stripe
                                    itself (hstRate below), so nobody has to
                                    make one in the Dashboard. Stripe Tax is NOT
                                    used - it costs a fee on every sale for a
                                    rate that is always 13% here.
   Test and live each have their own three values; the key's prefix decides
   which mode the site says it is in. */

const API = "https://api.stripe.com/v1";

/* Signatures older than this are refused, so a captured delivery cannot be
   replayed later. Five minutes is the tolerance Stripe's own libraries use. */
const TOLERANCE_SECONDS = 300;

export function stripeMode(env) {
  const key = env.STRIPE_SECRET_KEY || "";
  return /^(sk|rk)_live_/.test(key) ? "live" : "test";
}

/* A key that is not a Stripe secret key is never sent anywhere. One GitHub
   token was already pasted into the PayPal secret by mistake. */
function keyProblem(env) {
  const key = env.STRIPE_SECRET_KEY || "";
  if (!key) return "STRIPE_SECRET_KEY is not set";
  if (/^pk_/.test(key)) return "STRIPE_SECRET_KEY holds the publishable key (pk_), not the secret key";
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(key)) return "STRIPE_SECRET_KEY does not look like a Stripe secret key - it was not sent";
  return null;
}

export function checkoutReady(env) {
  return env.CHECKOUT_ENABLED === "true" && !keyProblem(env) && !!env.STRIPE_WEBHOOK_SECRET;
}

/* Stripe takes form encoding with bracketed keys: line_items[0][price_data][currency]. */
function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(env, method, path, params) {
  const problem = keyProblem(env);
  if (problem) throw new Error(problem);
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(params ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: params ? form(params).toString() : undefined,
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = body && body.error ? `${body.error.type || ""} ${body.error.message || ""}`.trim() : `HTTP ${r.status}`;
    throw new Error(`Stripe refused ${method} ${path}: ${msg}`);
  }
  return body;
}

const cents = (v) => Math.round(Number(v) * 100);

/* Ontario HST, as one Stripe tax rate. Named in STRIPE_HST_RATE if someone
   set one; otherwise found among the account's active rates (13%, exclusive,
   Ontario) or created once, then remembered for this isolate. Test and live
   are separate accounts as far as tax rates go, so the memory is per key. */
const HST = { display_name: "HST", percentage: 13, inclusive: false, country: "CA", state: "ON", jurisdiction: "ON", tax_type: "hst", description: "Ontario HST (nae-site)" };
let hstCache = { key: null, id: null };

const isHst = (r) => r && r.active === true && r.inclusive === false && Number(r.percentage) === HST.percentage
  && (r.state === "ON" || r.jurisdiction === "ON" || r.tax_type === "hst");

export async function hstRate(env) {
  if (/^txr_/.test(env.STRIPE_HST_RATE || "")) return env.STRIPE_HST_RATE;
  if (hstCache.key === env.STRIPE_SECRET_KEY && hstCache.id) return hstCache.id;
  const list = await stripe(env, "GET", "/tax_rates?active=true&inclusive=false&limit=100");
  let rate = ((list && list.data) || []).find(isHst);
  if (!rate) rate = await stripe(env, "POST", "/tax_rates", HST);
  hstCache = { key: env.STRIPE_SECRET_KEY, id: rate.id };
  return rate.id;
}

/* Where the buyer comes back to: a path on this site, never an address the
   request names, so the session cannot be used to send somebody elsewhere. */
function returnPath(p) {
  return typeof p === "string" && /^\/[A-Za-z0-9/_-]{0,200}$/.test(p) ? p : "/courses/";
}

/* "Course fee:900.00|Kit:300.00" - what the confirmation email itemises,
   carried on the session so the webhook does not need a second call. */
const itemsTag = (q) => q.items
  .map((i) => `${i.category === "PHYSICAL_GOODS" ? "Kit" : "Course fee"}:${i.unit_amount.value}`)
  .join("|");
const itemsFromTag = (s) => String(s || "").split("|").filter(Boolean).map((p) => {
  const i = p.lastIndexOf(":");
  return { label: p.slice(0, i), value: p.slice(i + 1) };
});

/* POST /api/checkout/session { courseId, withKit, locationId, returnPath }
   -> { url } of Stripe's hosted payment page. */
export async function createSession(request, env, quote, origin) {
  let body;
  try { body = await request.json(); } catch (e) { return { status: 400, error: "Expected JSON" }; }

  const courseId = String(body.courseId || "");
  const withKit = body.withKit === true;
  const q = quote(courseId, withKit);
  if (q.error) return { status: 400, error: q.error };

  const locationId = typeof body.locationId === "string" ? body.locationId.slice(0, 40) : "";
  const back = origin + returnPath(body.returnPath);
  const meta = { course_id: courseId, with_kit: withKit ? "1" : "0", location_id: locationId, items: itemsTag(q) };
  const taxRate = await hstRate(env);

  const session = await stripe(env, "POST", "/checkout/sessions", {
    mode: "payment",
    line_items: q.items.map((i) => ({
      quantity: 1,
      price_data: {
        currency: q.amount.currency_code.toLowerCase(),
        unit_amount: cents(i.unit_amount.value),
        product_data: { name: i.name },
      },
      tax_rates: [taxRate],
    })),
    /* The phone number is the second way to reach a new student, and the
       pipeline needs one; Stripe asks for it on its page. */
    phone_number_collection: { enabled: true },
    metadata: meta,
    /* On the payment too: refunds and disputes arrive naming the payment,
       and this says which course it was without a lookup. */
    payment_intent_data: { metadata: { course_id: courseId, with_kit: meta.with_kit } },
    success_url: `${back}?paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back}?checkout=cancelled`,
  });
  return { status: 200, url: session.url, id: session.id };
}

/* GET /api/checkout/session?id=cs_... - what the page shows when the buyer
   comes back. Read-only, and decides nothing: the webhook records the sale. */
export async function sessionStatus(env, id) {
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(id || "")) return { status: 400, error: "Missing session id" };
  const s = await stripe(env, "GET", `/checkout/sessions/${id}`);
  const md = s.metadata || {};
  return {
    status: 200,
    paid: s.payment_status === "paid",
    /* Complete but not yet paid: a bank debit that takes days to clear. */
    pending: s.status === "complete" && s.payment_status === "unpaid",
    reference: s.payment_intent || s.id,
    total: s.amount_total == null ? null : (s.amount_total / 100).toFixed(2),
    currency: (s.currency || "cad").toUpperCase(),
    courseId: md.course_id || null,
    withKit: md.with_kit === "1",
    items: itemsFromTag(md.items),
  };
}

/* ------------------------------------------------------------------ webhook */

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/* Constant-time: how long a comparison takes must not say how much of a
   forged signature was right. */
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* Stripe-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">[,v1=...]
   More than one v1 appears while a rolled secret is still valid. */
export async function verifySignature(payload, header, secret, now = Date.now()) {
  if (!secret || !header) return false;
  let t = null;
  const sigs = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") sigs.push(v);
  }
  if (!t || !/^\d+$/.test(t) || !sigs.length) return false;
  if (Math.abs(now / 1000 - Number(t)) > TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`)));
  return sigs.some((s) => same(s, expected));
}

/* The sale as enrolments.js takes it, from a Checkout Session. */
function saleFrom(s, catalogue) {
  const md = s.metadata || {};
  const cd = s.customer_details || {};
  const course = (catalogue.courses || {})[md.course_id || ""] || {};
  const money = (c) => (c == null ? null : c / 100);
  return {
    provider: "stripe",
    sessionId: s.id,
    paymentIntent: typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent && s.payment_intent.id) || null,
    courseId: md.course_id || "",
    courseName: course.name || md.course_id || "",
    withKit: md.with_kit === "1",
    locationId: md.location_id || null,
    currency: (s.currency || "cad").toUpperCase(),
    subtotal: money(s.amount_subtotal),
    tax: money((s.total_details || {}).amount_tax),
    total: money(s.amount_total),
    payerName: cd.name || null,
    payerEmail: cd.email || null,
    paymentStatus: s.payment_status || null,
    items: itemsFromTag(md.items),
    paidAt: new Date((s.created || Date.now() / 1000) * 1000).toISOString(),
    livemode: s.livemode === true,
  };
}

/* The buyer, onto the lead record: enrolled once paid, and the sale linked
   to them. A debit still clearing leaves them where they were, with a note. */
async function leadFromSale(env, sale, paid) {
  const lead = await noteLead(env, {
    email: sale.payerEmail, name: sale.payerName, courseId: sale.courseId, locationId: sale.locationId,
    source: "checkout", stage: paid ? "enrolled" : "new",
    event: paid
      ? { kind: "paid", detail: `Paid ${sale.total != null ? sale.total.toFixed(2) : "?"} ${sale.currency} for ${sale.courseName}${sale.withKit ? " with kit" : ""}` }
      : { kind: "payment pending", detail: `Bank payment for ${sale.courseName} is clearing` },
    consent: paid ? "implied_purchase" : null,
  });
  if (lead && env.ENROLMENTS) {
    try { await env.ENROLMENTS.prepare("UPDATE enrolments SET lead_id = ? WHERE stripe_session_id = ?").bind(lead.id, sale.sessionId).run(); }
    catch (e) { console.error("enrolment not linked to its lead:", sale.sessionId, e.message); }
  }
}

/* The session was made by this Worker from the price list, so its total can
   only differ from today's quote if the price list or the tax rate changed
   in between - or the tax rate in the Dashboard is not 13%. The money has
   moved either way, so it is recorded; the mismatch is made loud. */
function checkAgainstQuote(sale, quote) {
  const q = quote(sale.courseId, sale.withKit);
  if (q.error) {
    console.error("stripe: paid session names a course the price list refuses -", sale.sessionId, sale.courseId, q.error);
    return;
  }
  if (cents(q.amount.value) !== Math.round((sale.total || 0) * 100)) {
    console.error(`stripe: paid ${sale.total} but the price list says ${q.amount.value} -`, sale.sessionId,
      "(check the HST tax rate in Stripe is 13% exclusive)");
  }
}

/* POST /api/stripe/webhook. Answers 2xx for anything verified, handled or
   not, so Stripe stops retrying; 400 for anything it cannot prove came from
   Stripe. Database work is a few milliseconds; email goes after the answer. */
export async function handleWebhook(request, env, ctx, { catalogue, quote, taxLabel }) {
  const payload = await request.text();
  const ok = await verifySignature(payload, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) {
    console.error("stripe: webhook signature refused");
    return { status: 400, body: { error: "Bad signature" } };
  }
  let event;
  try { event = JSON.parse(payload); } catch (e) { return { status: 400, body: { error: "Bad JSON" } }; }

  const obj = (event.data || {}).object || {};
  const confirm = (sale) => tellEnrolment(env, ctx, enrolmentNotice(sale, catalogue, taxLabel));

  switch (event.type) {
    case "checkout.session.completed": {
      const sale = saleFrom(obj, catalogue);
      const paid = obj.payment_status === "paid";
      sale.stage = paid ? "paid" : "payment pending";
      const rec = await recordEnrolment(env, sale);
      if (paid) checkAgainstQuote(sale, quote);
      /* Confirmed once: a redelivered event finds the row already there. */
      if (rec !== "repeat") await leadFromSale(env, sale, paid);
      if (paid && rec !== "repeat") confirm(sale);
      break;
    }
    case "checkout.session.async_payment_succeeded": {
      /* A bank debit cleared days after checkout. Recorded now if the
         completed event was missed; confirmed only on the move to paid. */
      const sale = saleFrom(obj, catalogue);
      sale.stage = "paid";
      const rec = await recordEnrolment(env, sale);
      const moved = rec === "new" ? 1 : await setStage(env, { sessionId: obj.id }, "paid", obj.payment_status);
      checkAgainstQuote(sale, quote);
      if (moved) await leadFromSale(env, sale, true);
      if (moved && rec !== "failed") confirm(sale);
      break;
    }
    case "checkout.session.async_payment_failed": {
      const sale = saleFrom(obj, catalogue);
      sale.stage = "payment failed";
      if ((await recordEnrolment(env, sale)) === "repeat") {
        await setStage(env, { sessionId: obj.id }, "payment failed", obj.payment_status);
      }
      console.error("stripe: delayed payment failed -", obj.id);
      break;
    }
    case "charge.refunded": {
      const full = obj.refunded === true;
      const n = await setStage(env, { paymentIntent: obj.payment_intent }, full ? "refunded" : "partly refunded", null);
      if (!n) console.log("stripe: refund for a payment not recorded here -", obj.payment_intent);
      break;
    }
    case "charge.dispute.created": {
      await setStage(env, { paymentIntent: obj.payment_intent }, "disputed", null);
      /* Disputes have a deadline for evidence; until the pipeline alerts on
         stages, the log is where this shows. */
      console.error("stripe: DISPUTE opened -", obj.payment_intent, obj.reason, "respond in the Dashboard before the deadline");
      break;
    }
    case "charge.dispute.closed": {
      const stage = obj.status === "won" ? "paid" : obj.status === "lost" ? "dispute lost" : "disputed";
      await setStage(env, { paymentIntent: obj.payment_intent }, stage, null);
      break;
    }
    default:
      /* Not one the endpoint subscribes to; acknowledged so it is not retried. */
      break;
  }
  return { status: 200, body: { received: true } };
}

/* GET /api/checkout/health - is checkout configured and does Stripe accept
   the key? Says nothing secret: presence, the mode, and what the tax rate is. */
export async function health(env) {
  const out = {
    mode: stripeMode(env),
    enabled: env.CHECKOUT_ENABLED === "true",
    keyProblem: keyProblem(env),
    webhookSecretSet: !!env.STRIPE_WEBHOOK_SECRET,
  };
  if (out.keyProblem) return { ...out, ok: false, reason: out.keyProblem };
  try {
    const id = await hstRate(env);
    const r = await stripe(env, "GET", `/tax_rates/${id}`);
    out.hstRate = { percentage: r.percentage, inclusive: r.inclusive, active: r.active, name: r.display_name };
    const right = Number(r.percentage) === 13 && r.inclusive === false && r.active === true;
    if (!right) return { ...out, ok: false, reason: "the tax rate is not an active, exclusive 13%" };
    if (!out.webhookSecretSet) return { ...out, ok: false, reason: "STRIPE_WEBHOOK_SECRET is not set" };
    return { ...out, ok: out.enabled, reason: out.enabled ? "ready" : "CHECKOUT_ENABLED is not true" };
  } catch (e) {
    return { ...out, ok: false, reason: e.message };
  }
}
