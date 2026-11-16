import { findSlots, checkPlan, toMin, fromMin } from "./booking-engine.js";

/* Booking course sessions, for a student who has paid for the course.

     GET  /api/booking/options?course=   the course's session plan and studios
     GET  /api/booking/slots?course=&studio=&from=YYYY-MM-DD&days=14
     POST /api/booking/book     { course, studio, starts: ["YYYY-MM-DDTHH:MM", ...] }
     POST /api/booking/request  { course, studio, wishes: [{ date, time }], note }
     GET  /api/booking/mine     the signed-in student's sessions and requests

   The rules live in booking-engine.js and the config the build copies here
   from nae-data (booking-config.json). Bookings are kept in the
   nae-enrolments database beside the enrolments they belong to; the table is
   made on first use, so a deploy never waits on a manual migration.

   Who may book: a signed-in student with a paid enrolment for that course
   (the same record "My courses" reads). A request needs the same, and is
   decided by a person in the apps - nothing is promised until then.

   Times are Ontario wall-clock (see booking-engine.js). Google Calendar
   sync (the instructor's invite, the room, busy times) is added on top of
   this and does not change what is stored here. */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const fail = (status, error) => json({ error }, status);

export const BOOKING_PREFIX = "/api/booking/";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS class_bookings (
     id            TEXT PRIMARY KEY,
     created_at    TEXT NOT NULL,
     plan_id       TEXT NOT NULL,          -- every session booked together
     course_id     TEXT NOT NULL,
     location_id   TEXT NOT NULL,
     room          TEXT,                   -- Floor Section; null for a request
     instructor_id TEXT,
     starts_at     TEXT,                   -- Ontario wall clock, YYYY-MM-DDTHH:MM
     ends_at       TEXT,
     session_no    INTEGER,
     student_email TEXT NOT NULL,
     student_name  TEXT,
     status        TEXT NOT NULL,          -- booked | requested | declined | cancelled
     wishes        TEXT,                   -- a request's dates and times (JSON)
     note          TEXT,
     calendar_event_id TEXT,
     decided_by    TEXT,
     decided_at    TEXT
   )`,
  "CREATE INDEX IF NOT EXISTS class_bookings_room ON class_bookings(location_id, room, starts_at)",
  "CREATE INDEX IF NOT EXISTS class_bookings_student ON class_bookings(student_email, course_id)",
  "CREATE INDEX IF NOT EXISTS class_bookings_instructor ON class_bookings(instructor_id, starts_at)",
  "CREATE INDEX IF NOT EXISTS class_bookings_status ON class_bookings(status, created_at)",
];
let ready = null;
async function ensureTable(db) {
  if (!ready) ready = db.batch(SCHEMA.map((q) => db.prepare(q))).catch((e) => { ready = null; throw e; });
  return ready;
}

/* Now, on the Ontario wall clock. */
export function torontoNow(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

async function whoIs(request, env) {
  if (!env.ACCOUNTS) return { error: fail(503, "Accounts are not available just now") };
  try {
    const r = await env.ACCOUNTS.fetch(new Request("https://accounts.internal/api/auth/me", {
      headers: { Cookie: request.headers.get("Cookie") || "" },
    }));
    if (!r.ok) return { error: fail(401, "Sign in to book your sessions.") };
    const u = (await r.json()).user;
    if (!u || !u.email) return { error: fail(401, "Sign in to book your sessions.") };
    if (!u.emailVerified) return { error: fail(403, "Confirm your email address first: check your inbox for our link.") };
    return { user: u };
  } catch (e) {
    return { error: fail(503, "Accounts are not available just now") };
  }
}

async function enrolled(db, email, courseId) {
  const r = await db.prepare(
    `SELECT 1 FROM enrolments WHERE lower(payer_email) = ? AND course_id = ?
       AND provider <> 'paypal' AND stage = 'paid' LIMIT 1`,
  ).bind(email, courseId).first();
  return !!r;
}

/* Every live booking, one per session: students in the same session are
   counted together, which is what the engine's "join" rule needs. */
async function liveBookings(db) {
  const { results } = await db.prepare(
    `SELECT MIN(id) AS id, course_id, location_id, room, instructor_id, starts_at, ends_at, COUNT(*) AS students
       FROM class_bookings WHERE status = 'booked' AND starts_at IS NOT NULL
      GROUP BY course_id, location_id, room, instructor_id, starts_at, ends_at`,
  ).all();
  return (results || []).map((b) => ({
    id: b.id, courseId: b.course_id, locationId: b.location_id, room: b.room,
    instructorId: b.instructor_id, start: b.starts_at, end: b.ends_at, students: b.students,
  }));
}

/* Instructors' weekly teaching hours, from the config (the setup sheet).
   Their calendars' busy times join this once Google Calendar is connected. */
const hoursOf = (config) => Object.fromEntries(Object.entries(config.instructors || {})
  .filter(([, i]) => Array.isArray(i.hours) && i.hours.length).map(([id, i]) => [id, i.hours]));

export async function handleBooking(request, env, url, config) {
  const db = env.ENROLMENTS;
  if (!db) return fail(503, "Booking is not available just now");
  if (!config || !config.courses) return fail(503, "Booking is not set up yet");
  const who = await whoIs(request, env);
  if (who.error) return who.error;
  const email = String(who.user.email).toLowerCase();
  try { await ensureTable(db); } catch (e) {
    console.error("booking: table not ready -", e.message);
    return fail(503, "Booking is not available just now");
  }
  const path = url.pathname.slice(BOOKING_PREFIX.length);

  if (path === "mine" && request.method === "GET") {
    const { results } = await db.prepare(
      `SELECT id, plan_id, course_id, location_id, room, starts_at AS start, ends_at AS end, session_no, status, wishes
         FROM class_bookings WHERE student_email = ? AND status IN ('booked','requested')
        ORDER BY coalesce(starts_at, created_at)`,
    ).bind(email).all();
    return json({ bookings: (results || []).map((b) => ({
      ...b, course: (config.courses[b.course_id] || {}).name || b.course_id,
      studio: ((config.studios || {})[b.location_id] || {}).name || b.location_id,
      wishes: b.wishes ? JSON.parse(b.wishes) : null,
    })) });
  }

  /* Everything else is about one course the student has paid for. */
  let body = {};
  if (request.method === "POST") {
    try { body = await request.json(); } catch (e) { return fail(400, "Expected JSON"); }
    if (!body || typeof body !== "object") return fail(400, "Expected JSON");
  }
  const courseId = (request.method === "GET" ? url.searchParams.get("course") : body.course) || "";
  const course = config.courses[courseId];
  if (!course) return fail(400, "Unknown course");
  if (!(await enrolled(db, email, courseId))) return fail(403, "Book sessions for a course once you have enrolled in it.");
  const already = await db.prepare(
    "SELECT COUNT(*) AS n FROM class_bookings WHERE student_email = ? AND course_id = ? AND status IN ('booked','requested')",
  ).bind(email, courseId).first();

  if (path === "options" && request.method === "GET") {
    const studios = Object.entries(config.studios || {}).map(([id, s]) => ({ id, name: s.name, bookable: true }));
    for (const id of config.unmapped || []) studios.push({ id, name: id, bookable: false });
    return json({
      course: { id: courseId, name: course.name, sessions: course.sessions, hoursPerSession: course.hoursPerSession },
      studios, alreadyBooked: already?.n || 0,
      rules: { minNoticeHours: config.rules.minNoticeHours, maxDaysAhead: config.rules.maxDaysAhead, gapDays: config.rules.gapDays },
    });
  }

  const studio = (request.method === "GET" ? url.searchParams.get("studio") : body.studio) || "";
  const now = torontoNow();

  if (path === "slots" && request.method === "GET") {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") || "") ? url.searchParams.get("from") : now.slice(0, 10);
    const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 14, 1), 31);
    const slots = findSlots({ config, courseId, locationId: studio, from, days, now,
      bookings: await liveBookings(db), busy: {}, hours: hoursOf(config) });
    return json({ slots: slots.map((s) => ({
      start: s.start, end: s.end, room: s.room, join: s.join,
      instructor: ((config.instructors || {})[s.instructorId] || {}).name || "",
    })) });
  }

  if (path === "book" && request.method === "POST") {
    if (already?.n) return fail(409, "You have already booked or requested sessions for this course. Contact us to change them.");
    const starts = Array.isArray(body.starts) ? body.starts.filter((s) => typeof s === "string").sort() : [];
    const problem = checkPlan(config, courseId, starts);
    if (problem) return fail(400, problem);
    /* Each session must still be free, counting the ones chosen before it. */
    const live = await liveBookings(db);
    const planId = crypto.randomUUID();
    const rows = [];
    for (let i = 0; i < starts.length; i++) {
      const day = starts[i].slice(0, 10);
      const offer = findSlots({ config, courseId, locationId: studio, from: day, days: 1, now,
        bookings: live, busy: {}, hours: hoursOf(config) }).find((s) => s.start === starts[i]);
      if (!offer) return fail(409, `${starts[i].replace("T", " at ")} is no longer free. Choose another time, or request it.`);
      live.push({ id: `pending-${i}`, courseId, locationId: studio, room: offer.room, instructorId: offer.instructorId,
                  start: offer.start, end: offer.end, students: 1 });
      rows.push({ ...offer, n: i + 1 });
    }
    const at = new Date().toISOString();
    await db.batch(rows.map((r) => db.prepare(
      `INSERT INTO class_bookings (id, created_at, plan_id, course_id, location_id, room, instructor_id, starts_at, ends_at,
         session_no, student_email, student_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'booked')`,
    ).bind(crypto.randomUUID(), at, planId, courseId, studio, r.room, r.instructorId, r.start, r.end, r.n,
           email, who.user.name || null)));
    return json({ ok: true, planId, sessions: rows.map((r) => ({ start: r.start, end: r.end, room: r.room,
      instructor: ((config.instructors || {})[r.instructorId] || {}).name || "" })) });
  }

  if (path === "request" && request.method === "POST") {
    if (already?.n) return fail(409, "You have already booked or requested sessions for this course. Contact us to change them.");
    const wishes = (Array.isArray(body.wishes) ? body.wishes : []).slice(0, 12)
      .filter((w) => w && /^\d{4}-\d{2}-\d{2}$/.test(w.date || "") && /^\d{2}:\d{2}$/.test(w.time || ""))
      .map((w) => ({ date: w.date, time: w.time }));
    if (!wishes.length) return fail(400, "Add at least one date and time you would like.");
    if (wishes.some((w) => toMin(`${w.date}T${w.time}`) < toMin(now))) return fail(400, "Those dates have to be in the future.");
    const note = typeof body.note === "string" ? body.note.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, 1000) : "";
    const id = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO class_bookings (id, created_at, plan_id, course_id, location_id, student_email, student_name,
         status, wishes, note) VALUES (?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)`,
    ).bind(id, new Date().toISOString(), id, courseId, studio || "any", email, who.user.name || null,
           JSON.stringify(wishes), note || null).run();
    return json({ ok: true, requestId: id });
  }

  return fail(404, "No such endpoint");
}

export { fromMin };
