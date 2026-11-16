import { recordEnrolment, enrolmentNotice, tellEnrolment } from "./enrolments.js";
import { noteLead } from "./leads.js";

/* Test purchases, for staff: everything that happens after a student pays,
   without Stripe.

   Checkout is live and stays live: nothing here touches Stripe, its keys or
   the webhook. An administrator names a student address and a course, and
   this does what the webhook does for a paid session - the enrolment record,
   the lead, the student's confirmation and the administrators' alert - and
   hands back the page the student lands on after paying. Every record is a
   test and says so:

   - the enrolment's provider is "simulated", its session id starts cs_test_SIM
   - the emails go out as test payments ("[Test] ... no money moved"; the
     same wording a Stripe test-mode payment gets, mail.js)
   - the page the student lands on says it was a test, and sends no
     purchase to analytics
   - "Remove test purchases" deletes every simulated enrolment again

   Only an active administrator, signed in on this site, may do any of it:
   the accounts system is asked who the browser's session belongs to. */

export const SIMULATE_PATH = "/api/admin/test-purchase";
export const SIM_PREFIX = "cs_test_SIM";
export const isSimulated = (id) => typeof id === "string" && id.startsWith(SIM_PREFIX);

const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const line = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

function sid() {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789";
  const r = crypto.getRandomValues(new Uint8Array(24));
  return SIM_PREFIX + Array.from(r, (b) => abc[b % abc.length]).join("");
}

/* The signed-in administrator, or a Response saying why not. */
async function admin(request, env) {
  if (!env.ACCOUNTS) return json({ error: "Accounts are not available just now" }, 503);
  let who = null;
  try {
    const r = await env.ACCOUNTS.fetch(new Request("https://accounts.internal/api/auth/me", {
      headers: { Cookie: request.headers.get("Cookie") || "" },
    }));
    if (r.ok) who = (await r.json()).user;
  } catch (e) {
    return json({ error: "Accounts are not available just now" }, 503);
  }
  if (!who || !who.email) return json({ error: "Sign in on this site first, with an administrator account." }, 401);
  if (who.role !== "admin" || who.active === false) return json({ error: "Only an administrator can make test purchases." }, 403);
  return who;
}

/* POST {email, name, courseId, withKit, locationId}  -> make one
   POST {clear: true}                                  -> remove them all */
export async function handleTestPurchase(request, env, ctx, { catalogue, quote, taxLabel }) {
  /* A JSON body only: a form on another site cannot send one with this
     browser's cookie without the browser asking first. */
  if (!/^application\/json\b/i.test(request.headers.get("content-type") || "")) {
    return json({ error: "Expected JSON" }, 415);
  }
  const who = await admin(request, env);
  if (who instanceof Response) return who;
  const db = env.ENROLMENTS;
  if (!db) return json({ error: "The enrolments database is not connected" }, 503);

  let b;
  try { b = await request.json(); } catch (e) { return json({ error: "Expected JSON" }, 400); }
  if (!b || typeof b !== "object") return json({ error: "Expected JSON" }, 400);

  if (b.clear === true) {
    const r = await db.prepare("DELETE FROM enrolments WHERE provider = 'simulated'").run();
    await db.prepare("DELETE FROM lead_events WHERE kind = 'test purchase'").run();
    const n = (r && r.meta && r.meta.changes) ?? (r && r.changes) ?? 0;
    console.log("test purchases removed by", who.email, "-", n);
    return json({ ok: true, removed: n });
  }

  const email = line(b.email, 254).toLowerCase();
  const name = line(b.name, 120) || "Test Student";
  if (!ADDRESS.test(email)) return json({ error: "Enter the student's email address." }, 400);
  const courseId = typeof b.courseId === "string" ? b.courseId : "";
  const q = quote(courseId, b.withKit === true);
  if (q.error) return json({ error: q.error === "Unknown course" ? "Choose a course." : q.error }, 400);
  const studios = catalogue.studios || {};
  const locationId = typeof b.locationId === "string" && Object.hasOwn(studios, b.locationId) ? b.locationId : null;

  const sessionId = sid();
  const sale = {
    provider: "simulated",
    sessionId,
    paymentIntent: null,
    courseId,
    courseName: q.course.name,
    withKit: q.items.length > 1,
    locationId,
    currency: q.amount.currency_code,
    subtotal: Number(q.amount.breakdown.item_total.value),
    tax: Number(q.amount.breakdown.tax_total.value),
    discount: null,
    total: Number(q.amount.value),
    payerName: name,
    payerEmail: email,
    paymentStatus: "simulated",
    stage: "paid",
    items: q.items.map((i, n) => ({ label: n ? "Kit" : "Course fee", value: i.unit_amount.value })),
    paidAt: new Date().toISOString(),
    livemode: false,
  };
  const rec = await recordEnrolment(env, sale);
  if (rec !== "new") return json({ error: "The test enrolment could not be saved." }, 503);

  const lead = await noteLead(env, {
    email, name, courseId, locationId, source: "checkout", stage: "enrolled",
    event: { kind: "test purchase", detail: `TEST purchase of ${sale.courseName} by ${who.email} - simulated, no money moved` },
  });
  if (lead) {
    try { await db.prepare("UPDATE enrolments SET lead_id = ? WHERE stripe_session_id = ?").bind(lead.id, sessionId).run(); }
    catch (e) { console.error("test enrolment not linked to its lead:", e.message); }
  }
  tellEnrolment(env, ctx, enrolmentNotice(sale, catalogue, taxLabel));
  console.log("test purchase made by", who.email, "-", sessionId);

  const slug = q.course.slug || "";
  return json({
    ok: true, sessionId,
    landing: slug ? `/courses/${slug}/?paid=${sessionId}` : null,
    total: q.amount.value, currency: q.amount.currency_code,
  });
}

/* What the page after "paying" shows, read from our own record instead of
   Stripe, and marked as a test so the page sends nothing to analytics. */
export async function simulatedStatus(env, id) {
  if (!env.ENROLMENTS) return { status: 503, error: "Not connected" };
  const r = await env.ENROLMENTS.prepare(
    "SELECT course_id, with_kit, currency, total, subtotal FROM enrolments WHERE stripe_session_id = ? AND provider = 'simulated'",
  ).bind(id).first();
  if (!r) return { status: 404, error: "No such test purchase" };
  return {
    status: 200, paid: true, pending: false, simulated: true,
    reference: id, total: r.total == null ? null : Number(r.total).toFixed(2),
    currency: r.currency || "CAD", courseId: r.course_id, withKit: !!r.with_kit, items: [],
  };
}
