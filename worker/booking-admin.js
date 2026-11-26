import { findSlots, checkPlan, roomsFor, teachersFor, toMin, fromMin } from "./booking-engine.js";
import { ensureTable, liveBookings, hoursOf, studioName, tell, torontoNow } from "./booking.js";

/* What staff do with bookings: the apps' Students screens (nae-inc
   worker/students.js) call these through the Booking entrypoint
   (worker/main.js). No browser can reach them: a named entrypoint has no
   address, and only a Worker on this account with a binding to it can call.

   The apps decide who is asking. They pass:
     scope        null for an administrator or staff (everything), or
                  { courseIds, locationIds } for an instructor: their
                  teachables (tracker record, via users.person_id). Anything
                  outside it is refused here too, not only hidden there.
     canOverride  true only for administrators: book a time the engine would
                  not offer (a clash, short notice), with a warning.
     actor        the account email, kept on the record (decided_by).

   Every change emails the student (Notify.booking: confirmed, changed,
   cancelled, declined). The stored record is what counts: an email that does
   not go never undoes a change, exactly as when a student books.

   Every function takes (c, args) with c = { env, config, catalogue, ctx } and
   answers a plain object: { ok: true, ... } or { error, status }. */

const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const no = (status, error) => ({ error, status });
const text = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

function db(c) {
  if (!c.env || !c.env.ENROLMENTS) throw Object.assign(new Error("Booking is not available just now"), { status: 503 });
  return c.env.ENROLMENTS;
}

const inScope = (scope, row) => !scope || (
  (scope.courseIds || []).includes(row.course_id)
  && (row.location_id === "any" || (scope.locationIds || []).includes(row.location_id)));

const instructorName = (config, id) => (id && ((config.instructors || {})[id] || {}).name) || "";

function view(config, b) {
  return {
    id: b.id, planId: b.plan_id, createdAt: b.created_at,
    courseId: b.course_id, course: ((config.courses || {})[b.course_id] || {}).name || b.course_id,
    locationId: b.location_id, studio: studioName(config, b.location_id) || (b.location_id === "any" ? "Any studio" : b.location_id),
    room: b.room || null, instructorId: b.instructor_id || null, instructor: instructorName(config, b.instructor_id),
    start: b.starts_at || null, end: b.ends_at || null, sessionNo: b.session_no || null,
    email: b.student_email, name: b.student_name || "", status: b.status,
    wishes: b.wishes ? JSON.parse(b.wishes) : null, note: b.note || "",
    decidedBy: b.decided_by || null, decidedAt: b.decided_at || null,
  };
}

/* The config with one instructor only, so the engine answers "is THIS
   instructor free and qualified then", not "is anybody". */
const onlyTeacher = (config, id) => ({ ...config, instructors: { [id]: (config.instructors || {})[id] } });

/* Would the engine offer exactly this start for this course and studio,
   leaving the given bookings out of the count (the ones being moved)? */
async function offered(c, { courseId, locationId, start, instructorId, leaveOut = [] }) {
  const live = (await liveBookings(db(c))).filter((b) => !leaveOut.includes(b.id));
  const config = instructorId ? onlyTeacher(c.config, instructorId) : c.config;
  return findSlots({ config, courseId, locationId, from: start.slice(0, 10), days: 1, now: torontoNow(),
    bookings: live, busy: {}, hours: hoursOf(c.config) }).find((s) => s.start === start) || null;
}

const endOf = (config, courseId, start) =>
  fromMin(toMin(start) + Math.round(((config.courses[courseId] || {}).hoursPerSession || 0) * 60));

async function rowById(c, id) {
  if (typeof id !== "string" || !/^[0-9a-f-]{8,40}$/i.test(id)) return null;
  return db(c).prepare("SELECT * FROM class_bookings WHERE id = ?").bind(id).first();
}

/* Everybody in the same session as this booking (a workshop or a joined
   class): same course, studio, room and times, still booked. */
async function sessionOf(c, row) {
  const { results } = await db(c).prepare(
    `SELECT * FROM class_bookings WHERE status = 'booked' AND course_id = ? AND location_id = ?
        AND coalesce(room,'') = coalesce(?,'') AND starts_at = ? AND ends_at = ?`,
  ).bind(row.course_id, row.location_id, row.room, row.starts_at, row.ends_at).all();
  return results && results.length ? results : [row];
}

async function email(c, kind, rows, extra = {}) {
  const r = rows[0];
  const config = c.config;
  await tell(c.env, { ctx: c.ctx }, {
    kind, name: r.student_name || "", email: r.student_email,
    course: (config.courses[r.course_id] || {}).name || r.course_id, studio: studioName(config, r.location_id),
    sessions: rows.filter((x) => x.starts_at && x.ends_at).map((x) => ({ start: x.starts_at, end: x.ends_at, room: x.room || "",
      instructor: instructorName(config, x.instructor_id) })),
    sentAt: new Date().toISOString(), site: (c.catalogue && c.catalogue.site) || "",
    seller: (c.catalogue && c.catalogue.seller) || null, ...extra,
  });
}

/* ------------------------------------------------------------ reading */

/* Names for ids, and who teaches what where: for the apps' lists, pickers,
   and an instructor's scope (their record here matches the hours tracker's,
   both made from the setup sheet). No personal data. */
export async function catalogue(c) {
  const config = c.config;
  const names = config.locationNames || {};
  return {
    ok: true,
    courses: Object.fromEntries(Object.entries(config.courses || {}).map(([id, x]) => [id, { name: x.name, sessions: x.sessions, hoursPerSession: x.hoursPerSession }])),
    studios: Object.fromEntries([...Object.keys(config.studios || {}), ...(config.unmapped || [])]
      .map((id) => [id, { name: names[id] || ((config.studios || {})[id] || {}).name || id, bookable: !!(config.studios || {})[id] }])),
    instructors: Object.fromEntries(Object.entries(config.instructors || {}).map(([id, i]) => [id, {
      name: i.name, courseIds: i.courseIds || [], locationIds: i.locationIds || [] }])),
  };
}

/* One student's bookings and requests, every status, oldest first. */
export async function forStudent(c, { email, scope = null } = {}) {
  const who = String(email || "").trim().toLowerCase();
  if (!who.includes("@")) return no(400, "Which student?");
  await ensureTable(db(c));
  const { results } = await db(c).prepare(
    "SELECT * FROM class_bookings WHERE student_email = ? ORDER BY coalesce(starts_at, created_at)",
  ).bind(who).all();
  return { ok: true, bookings: (results || []).filter((b) => inScope(scope, b)).map((b) => view(c.config, b)) };
}

/* What is waiting and what is coming: every open request, and the booked
   sessions between from and to (Ontario dates, to inclusive). */
export async function queue(c, { scope = null, from, to } = {}) {
  await ensureTable(db(c));
  const today = torontoNow().slice(0, 10);
  const a = DAY.test(from || "") ? from : today;
  const z = DAY.test(to || "") ? to : fromMin(toMin(a) + 6 * 1440).slice(0, 10);
  const { results: requests } = await db(c).prepare(
    "SELECT * FROM class_bookings WHERE status = 'requested' ORDER BY created_at",
  ).all();
  const { results: sessions } = await db(c).prepare(
    `SELECT * FROM class_bookings WHERE status = 'booked' AND starts_at >= ? AND starts_at < ?
      ORDER BY starts_at, course_id, student_email`,
  ).bind(`${a}T00:00`, `${fromMin(toMin(z) + 1440).slice(0, 10)}T00:00`).all();
  return {
    ok: true, from: a, to: z,
    requests: (requests || []).filter((b) => inScope(scope, b)).map((b) => view(c.config, b)),
    sessions: (sessions || []).filter((b) => inScope(scope, b)).map((b) => view(c.config, b)),
  };
}

/* Open times for a course at a studio, with who would teach, and every
   instructor who teaches it there (for "Change instructor"). */
export async function slots(c, { courseId, locationId, from, days = 14, instructorId = null, scope = null } = {}) {
  const config = c.config;
  if (!config.courses[courseId]) return no(400, "Unknown course");
  if (!(config.studios || {})[locationId]) return no(400, "That studio can't be booked online yet");
  if (scope && !inScope(scope, { course_id: courseId, location_id: locationId })) return no(403, "That is not one of your courses");
  await ensureTable(db(c));
  const now = torontoNow();
  const start = DAY.test(from || "") ? from : now.slice(0, 10);
  const teachers = teachersFor(config, courseId, locationId);
  if (instructorId && !teachers.includes(instructorId)) return no(400, "That instructor doesn't teach this course there");
  const found = findSlots({ config: instructorId ? onlyTeacher(config, instructorId) : config, courseId, locationId, from: start,
    days: Math.min(Math.max(Number(days) || 14, 1), 31), now, bookings: await liveBookings(db(c)), busy: {}, hours: hoursOf(config) });
  return {
    ok: true,
    slots: found.map((s) => ({ start: s.start, end: s.end, room: s.room, join: s.join,
      instructorId: s.instructorId, instructor: instructorName(config, s.instructorId) })),
    teachers: teachers.map((id) => ({ id, name: instructorName(config, id) })),
  };
}

/* ------------------------------------------------------------ changing */

/* A request becomes booked sessions: the times chosen (one per session in
   the course's plan), at a studio, with an instructor (or the engine's
   pick). The request is kept, marked approved, as the record of who
   decided. */
export async function approve(c, { id, starts, locationId, instructorId = null, scope = null, canOverride = false, actor = "" } = {}) {
  const config = c.config;
  const req = await rowById(c, id);
  if (!req || req.status !== "requested") return no(404, "That request isn't waiting any more");
  if (!inScope(scope, req)) return no(403, "That is not one of your courses");
  const studio = (locationId || (req.location_id !== "any" ? req.location_id : "")) || "";
  if (!(config.studios || {})[studio]) return no(400, "Choose the studio");
  if (scope && !(scope.locationIds || []).includes(studio)) return no(403, "That is not one of your studios");
  if (instructorId && !teachersFor(config, req.course_id, studio).includes(instructorId)) return no(400, "That instructor doesn't teach this course there");
  const list = (Array.isArray(starts) ? starts : []).filter((s) => typeof s === "string" && MOMENT.test(s)).sort();
  const problem = checkPlan(config, req.course_id, list);
  if (problem) return no(400, problem);

  const warnings = [];
  const rows = [];
  const live = await liveBookings(db(c));
  for (let i = 0; i < list.length; i++) {
    const slot = findSlots({ config: instructorId ? onlyTeacher(config, instructorId) : config, courseId: req.course_id, locationId: studio,
      from: list[i].slice(0, 10), days: 1, now: torontoNow(), bookings: live, busy: {}, hours: hoursOf(config) }).find((s) => s.start === list[i]);
    let room, teacher;
    if (slot) { room = slot.room; teacher = slot.instructorId; }
    else if (canOverride) {
      room = (roomsFor(config, req.course_id, studio)[0] || {}).room || null;
      teacher = instructorId || null;
      warnings.push(`${list[i].replace("T", " at ")} was booked over a clash or the notice period`);
    } else return no(409, `${list[i].replace("T", " at ")} isn't free. Choose another time.`);
    const end = slot ? slot.end : endOf(config, req.course_id, list[i]);
    live.push({ id: `pending-${i}`, courseId: req.course_id, locationId: studio, room, instructorId: teacher, start: list[i], end, students: 1 });
    rows.push({ id: crypto.randomUUID(), course_id: req.course_id, location_id: studio, room, instructor_id: teacher,
      starts_at: list[i], ends_at: end, session_no: i + 1, student_email: req.student_email, student_name: req.student_name });
  }
  const at = new Date().toISOString();
  const by = text(actor, 254) || "staff";
  const d = db(c);
  await d.batch([
    ...rows.map((r) => d.prepare(
      `INSERT INTO class_bookings (id, created_at, plan_id, course_id, location_id, room, instructor_id, starts_at, ends_at,
         session_no, student_email, student_name, status, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?, ?)`,
    ).bind(r.id, at, req.id, r.course_id, r.location_id, r.room, r.instructor_id, r.starts_at, r.ends_at, r.session_no,
           r.student_email, r.student_name, by, at)),
    d.prepare("UPDATE class_bookings SET status = 'approved', decided_by = ?, decided_at = ? WHERE id = ? AND status = 'requested'").bind(by, at, req.id),
  ]);
  await email(c, "confirmed", rows);
  return { ok: true, planId: req.id, sessions: rows.map((r) => view(config, { ...r, plan_id: req.id, status: "booked", created_at: at })), warnings };
}

/* One student's session moves to another time (and optionally another
   instructor). Their other sessions stay as they are. */
export async function rebook(c, { id, start, instructorId = null, scope = null, canOverride = false, actor = "" } = {}) {
  const config = c.config;
  const row = await rowById(c, id);
  if (!row || row.status !== "booked") return no(404, "That session isn't booked any more");
  if (!inScope(scope, row)) return no(403, "That is not one of your courses");
  if (typeof start !== "string" || !MOMENT.test(start)) return no(400, "Choose the new time");
  const teacher = instructorId || null;
  if (teacher && !teachersFor(config, row.course_id, row.location_id).includes(teacher)) return no(400, "That instructor doesn't teach this course there");
  const slot = await offered(c, { courseId: row.course_id, locationId: row.location_id, start, instructorId: teacher, leaveOut: [row.id] });
  const warnings = [];
  if (!slot) {
    if (!canOverride) return no(409, `${start.replace("T", " at ")} isn't free. Choose another time.`);
    warnings.push(`${start.replace("T", " at ")} was booked over a clash or the notice period`);
  }
  const moved = {
    ...row, starts_at: start, ends_at: slot ? slot.end : endOf(config, row.course_id, start),
    room: slot ? slot.room : row.room, instructor_id: slot ? slot.instructorId : (teacher || row.instructor_id),
  };
  const at = new Date().toISOString();
  await db(c).prepare(
    "UPDATE class_bookings SET starts_at = ?, ends_at = ?, room = ?, instructor_id = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'booked'",
  ).bind(moved.starts_at, moved.ends_at, moved.room, moved.instructor_id, text(actor, 254) || "staff", at, row.id).run();
  await email(c, "changed", [moved], { was: { start: row.starts_at, end: row.ends_at } });
  return { ok: true, session: view(config, moved), warnings };
}

/* A session (or a student's whole course plan, whole = true) is cancelled. */
export async function cancel(c, { id, whole = false, reason = "", scope = null, actor = "" } = {}) {
  const row = await rowById(c, id);
  if (!row || row.status !== "booked") return no(404, "That session isn't booked any more");
  if (!inScope(scope, row)) return no(403, "That is not one of your courses");
  const d = db(c);
  const rows = whole
    ? ((await d.prepare("SELECT * FROM class_bookings WHERE plan_id = ? AND student_email = ? AND status = 'booked' ORDER BY starts_at")
        .bind(row.plan_id, row.student_email).all()).results || [row])
    : [row];
  const at = new Date().toISOString();
  const by = text(actor, 254) || "staff";
  const why = text(reason, 300);
  await d.batch(rows.map((r) => d.prepare(
    `UPDATE class_bookings SET status = 'cancelled', decided_by = ?, decided_at = ?,
       note = CASE WHEN ? = '' THEN note ELSE trim(coalesce(note,'') || ' [cancelled: ' || ? || ']') END
     WHERE id = ? AND status = 'booked'`,
  ).bind(by, at, why, why, r.id)));
  await email(c, "cancelled", rows, { reason: why });
  return { ok: true, cancelled: rows.length };
}

/* Who teaches a session. It is set for everybody in that session (a
   workshop, or students who joined one class), and each of them is told. */
export async function assign(c, { id, instructorId, scope = null, canOverride = false, actor = "" } = {}) {
  const config = c.config;
  const row = await rowById(c, id);
  if (!row || row.status !== "booked") return no(404, "That session isn't booked any more");
  if (!inScope(scope, row)) return no(403, "That is not one of your courses");
  if (!instructorId || !teachersFor(config, row.course_id, row.location_id).includes(instructorId)) {
    return no(400, "That instructor doesn't teach this course there");
  }
  const group = await sessionOf(c, row);
  const live = (await liveBookings(db(c))).filter((b) => !(b.courseId === row.course_id && b.locationId === row.location_id
    && (b.room || "") === (row.room || "") && b.start === row.starts_at && b.end === row.ends_at));
  /* Free then: in their hours and not teaching anything else at that time. */
  const ok = findSlots({ config: onlyTeacher(config, instructorId), courseId: row.course_id, locationId: row.location_id,
    /* "now" just before the notice period, so notice never blocks a change
       of instructor on a session that is already booked. */
    from: row.starts_at.slice(0, 10), days: 1,
    now: fromMin(toMin(row.starts_at) - ((config.rules || {}).minNoticeHours ?? 24) * 60 - 60),
    bookings: live, busy: {}, hours: hoursOf(config) })
    .some((s) => s.start === row.starts_at);
  const warnings = [];
  if (!ok) {
    if (!canOverride) return no(409, `${instructorName(config, instructorId)} isn't free then`);
    warnings.push(`${instructorName(config, instructorId)} was assigned outside their hours or over another class`);
  }
  const at = new Date().toISOString();
  const by = text(actor, 254) || "staff";
  const d = db(c);
  await d.batch(group.map((r) => d.prepare(
    "UPDATE class_bookings SET instructor_id = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'booked'",
  ).bind(instructorId, by, at, r.id)));
  for (const r of group) await email(c, "changed", [{ ...r, instructor_id: instructorId }]);
  return { ok: true, students: group.length, warnings };
}

/* A request nobody can take: closed, and the student told to pick again. */
export async function decline(c, { id, reason = "", scope = null, actor = "" } = {}) {
  const req = await rowById(c, id);
  if (!req || req.status !== "requested") return no(404, "That request isn't waiting any more");
  if (!inScope(scope, req)) return no(403, "That is not one of your courses");
  const why = text(reason, 300);
  const at = new Date().toISOString();
  await db(c).prepare(
    `UPDATE class_bookings SET status = 'declined', decided_by = ?, decided_at = ?,
       note = CASE WHEN ? = '' THEN note ELSE trim(coalesce(note,'') || ' [declined: ' || ? || ']') END
     WHERE id = ? AND status = 'requested'`,
  ).bind(text(actor, 254) || "staff", at, why, why, req.id).run();
  await email(c, "declined", [req], { reason: why, wishes: req.wishes ? JSON.parse(req.wishes) : [] });
  return { ok: true };
}
