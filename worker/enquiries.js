/* Questions from the Contact page.

   The site said "ask about any course" and offered only a phone number and an
   inbox, so a question left no trace in NAE's own systems and reached whoever
   happened to read that inbox. Now it is kept here, beside the enrolments -
   the other record of who wants what - and every administrator is emailed by
   the apps' Worker, which sends all NAE email and knows who the
   administrators are (the NOTIFY binding; nae-inc worker/notify.js).
   Replying to that email answers the person who asked.

   Only what answering needs is asked for: a name, an address to answer at,
   the question, and if they like a phone number and a course. A question is
   kept for a year and then deleted; the visitor's network address only for
   a day, for the hourly limit.

   Robots: a field people never see ("website"), or a form sent within a few
   seconds of the page opening, is thanked and dropped. A robot that is told
   it failed tries again; one that is thanked moves on. */

export const ENQUIRY_PATH = "/api/enquiry";

const PER_HOUR = 5;       // from one network address: a person, not a script
const KEEP_DAYS = 365;    // then the question is deleted
const IP_HOURS = 24;      // then the network address is cleared from it
const MIN_MS = 3000;      // nobody reads the form and writes a question faster
const MAX_BODY = 10000;   // bytes; the form's limits come to well under this

/* The same test the apps' Worker applies before it emails anybody, so a
   question it would refuse is refused here, where the visitor can fix it. */
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const PHONE = /^[0-9+().\s-]{7,30}(?:\s*(?:x|ext\.?)\s*\d{1,6})?$/i;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const refuse = (status, error) => json({ error }, status);

const line = (v, max) => (typeof v === "string"
  ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
  : "");
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/* `courses` is the build's catalogue (prices.json): a course must be one of
   those to be named, and the email gives its name, not the id. */
export async function handleEnquiry(request, env, ctx, courses) {
  const db = env.ENROLMENTS;
  if (!db) return refuse(503, "Questions cannot be sent just now. Call or email us instead.");

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return refuse(413, "That is too long to send. Please shorten your question.");
    body = JSON.parse(raw);
  } catch (e) {
    return refuse(400, "Expected JSON");
  }
  if (!body || typeof body !== "object") return refuse(400, "Expected JSON");

  if (body.website || !(Number(body.elapsed) >= MIN_MS)) return json({ ok: true });

  const name = line(body.name, 120);
  const email = line(body.email, 254).toLowerCase();
  const phone = line(body.phone, 40);
  const courseId = typeof body.courseId === "string" && Object.hasOwn(courses || {}, body.courseId)
    ? body.courseId : null;
  /* Kept in its lines; control characters other than the line break go. */
  const message = typeof body.message === "string"
    ? body.message.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim()
    : "";

  if (!name) return refuse(400, "Please tell us your name.");
  if (!ADDRESS.test(email)) return refuse(400, "Please check your email address: we answer there.");
  if (phone && !PHONE.test(phone)) return refuse(400, "That phone number does not look right. You can leave it empty.");
  if (!message) return refuse(400, "Please write your question.");
  if (message.length > 2000) return refuse(400, "Please keep your question under 2,000 characters.");

  const ip = request.headers.get("CF-Connecting-IP") || null;
  const now = new Date().toISOString();
  try {
    if (ip) {
      const n = await db.prepare(
        "SELECT COUNT(*) AS n FROM enquiries WHERE ip = ? AND created_at > ?",
      ).bind(ip, ago(3600e3)).first();
      if ((n?.n || 0) >= PER_HOUR) {
        return refuse(429, "Too many questions from here in the last hour. Try again later, or call us.");
      }
    }
    await db.prepare(
      `INSERT INTO enquiries (id, created_at, name, email, phone, course_id, message, ip, stage, stage_since)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
    ).bind(crypto.randomUUID(), now, name, email, phone || null, courseId, message, ip, now).run();
    /* The purge, on the way out: nothing older than a year, and no network
       address older than a day. */
    await db.prepare("DELETE FROM enquiries WHERE created_at < ?").bind(ago(KEEP_DAYS * 86400e3)).run();
    await db.prepare("UPDATE enquiries SET ip = NULL WHERE ip IS NOT NULL AND created_at < ?")
      .bind(ago(IP_HOURS * 3600e3)).run();
  } catch (e) {
    console.error("enquiry not saved:", e.message);
    return refuse(503, "Your question could not be sent just now. Call or email us instead.");
  }

  /* Saved; now the administrators. The visitor does not wait for it, and
     nothing about it can make their question fail. */
  const telling = tell(env, {
    name, email, phone, message, sentAt: now,
    course: courseId ? courses[courseId].name : "",
  });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(telling);
  else await telling;
  return json({ ok: true });
}

async function tell(env, question) {
  if (!env.NOTIFY) {
    console.error("enquiry saved, but nobody was emailed: no NOTIFY binding");
    return;
  }
  try {
    const r = await env.NOTIFY.enquiry(question);
    if (!r || !r.admins) console.error("enquiry saved, but no administrator was emailed:", JSON.stringify(r));
  } catch (e) {
    console.error("enquiry saved, but nobody was emailed:", e.message);
  }
}
