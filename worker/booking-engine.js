/* The booking engine: which times a student can book a course session.

   Pure: it is handed the rules (nae-data data/booking-config.json), what is
   already booked, and when instructors are busy or teaching, and answers with
   times. It reads nothing and writes nothing, so the same answer comes out
   every time for the same inputs - and the tests can prove the rules.

   The rules (Jules, 16 Nov 2026):
   - One course per room at a time. A room is a Floor Section in Google
     Workspace's Buildings and resources (Main Room, Treatment Room). Nails
     and hair are both in the Main Room, so they never overlap.
   - A second student may join a session already booked for the SAME course,
     same time, same instructor, while the room has a free matching station.
   - An instructor is offered only when they teach that course at that studio,
     have said when they teach (their hours), and are not busy then - in
     another booking anywhere, or on their own calendar.
   - Studio class hours, notice (24 hours: Jules, 16 Nov 2026 - busy time on
     instructors' calendars already blocks clashes) and how far ahead come
     from the config.
   - A studio may run one workshop at a time across all its rooms
     (oneAtATime: St. Catharines and Niagara Falls, from Kalleigh's
     Conflicts tab, 17 Nov 2026), and may cap the students in one workshop
     (maxStudents: 3 at St. Catharines).
   - Closed dates (rules.closedDates, "MM-DD" every year) offer nothing.
   Anything the engine cannot offer, the student can still ask for
   ("request this date/time"); a person decides those.

   Times are Ontario wall-clock: dates "YYYY-MM-DD", times "HH:MM", and a
   moment "YYYY-MM-DDTHH:MM". Converting Google's UTC times to these is the
   caller's job, done once, at the edge. */

const DAY = 1440;
const STEP = 30;                       // start times on the half hour

/* Minutes since 1970-01-01 00:00 on the wall clock (no time zone in it). */
export function toMin(moment) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(moment || "");
  if (!m) throw new Error(`not a date/time: ${moment}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 60000 + (m[4] ? +m[4] * 60 + +m[5] : 0);
}
export function fromMin(n) {
  const d = new Date(n * 60000);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
const hm = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const weekday = (dayStart) => new Date(dayStart * 60000).getUTCDay();
const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

/* The rooms at a studio that can hold a course, with how many students fit
   (matching stations; any room and four seats for a course with no station). */
export function roomsFor(config, courseId, locationId) {
  const course = config.courses[courseId];
  const studio = (config.studios || {})[locationId];
  if (!course || !studio) return [];
  const out = [];
  const cap = studio.maxStudents || Infinity;
  for (const [room, r] of Object.entries(studio.rooms)) {
    const seats = Math.min(course.station ? r.stations.filter((s) => s.type === course.station).length : 4, cap);
    if (seats > 0) out.push({ room, seats });
  }
  return out;
}

/* Who may teach it there. */
export function teachersFor(config, courseId, locationId) {
  return Object.entries(config.instructors || {})
    .filter(([, i]) => i.locationIds.includes(locationId) && i.courseIds.includes(courseId))
    .map(([id]) => id);
}

/* Is the instructor teaching-available for the whole of [s, e)? Their
   weekly hours say when they teach; their calendar says when they cannot. */
function instructorFree(id, s, e, { hours, busy, bookings }) {
  const windows = (hours || {})[id];
  if (!windows || !windows.length) return false;          // never assume
  const day = Math.floor(s / DAY) * DAY;
  const inHours = windows.some((w) => w.days.includes(weekday(day))
    && s >= day + hm(w.from) && e <= day + hm(w.to));
  if (!inHours) return false;
  if (((busy || {})[id] || []).some((b) => overlaps(s, e, toMin(b.start), toMin(b.end)))) return false;
  return !bookings.some((b) => b.instructorId === id && overlaps(s, e, toMin(b.start), toMin(b.end)));
}

/* findSlots: every start time in the window the student could book, best
   option per time. Each: { start, end, room, instructorId, join, bookingId }.
     input = { config, courseId, locationId, from: "YYYY-MM-DD", days,
               now: "YYYY-MM-DDTHH:MM", bookings, busy, hours } */
export function findSlots(input) {
  const { config, courseId, locationId } = input;
  const course = config.courses[courseId];
  if (!course || !course.hoursPerSession) return [];
  const rules = config.rules || {};
  const len = Math.round(course.hoursPerSession * 60);
  const buffer = rules.bufferMinutes ?? 15;               // tidy-up between courses in a room
  const bookings = (input.bookings || []).filter((b) => b.status !== "cancelled");
  const here = bookings.filter((b) => b.locationId === locationId);
  const rooms = roomsFor(config, courseId, locationId);
  const teachers = teachersFor(config, courseId, locationId);
  const open = (config.studioHours || {})[locationId] || config.defaultHours;
  const now = toMin(input.now);
  const earliest = now + (rules.minNoticeHours ?? 24) * 60;
  const latest = Math.floor(now / DAY) * DAY + ((rules.maxDaysAhead ?? 90) + 1) * DAY;
  const first = toMin(input.from);
  const oneAtATime = !!((config.studios || {})[locationId] || {}).oneAtATime;
  const closed = new Set(rules.closedDates || []);
  const out = [];
  if (!rooms.length || !teachers.length || !open) return out;

  for (let d = 0; d < (input.days || 14); d++) {
    const day = first + d * DAY;
    if (!open.days.includes(weekday(day))) continue;
    if (closed.has(fromMin(day).slice(5, 10))) continue;
    for (let s = day + hm(open.open); s + len <= day + hm(open.close); s += STEP) {
      const e = s + len;
      if (s < earliest || e > latest) continue;
      let pick = null;
      for (const { room, seats } of rooms) {
        const inRoom = here.filter((b) => (oneAtATime || b.room === room)
          && overlaps(s - buffer, e + buffer, toMin(b.start), toMin(b.end)));
        if (inRoom.length) {
          /* Joinable only as the very same session of the same course. */
          const same = inRoom.length === 1 && inRoom[0].courseId === courseId && inRoom[0].room === room
            && toMin(inRoom[0].start) === s && toMin(inRoom[0].end) === e
            && (inRoom[0].students || 1) < seats;
          if (same) { pick = { room, instructorId: inRoom[0].instructorId, join: true, bookingId: inRoom[0].id }; break; }
          continue;
        }
        /* A free room: the least-booked qualified instructor who is free. */
        const free = teachers.filter((id) => instructorFree(id, s, e, { hours: input.hours, busy: input.busy, bookings }));
        if (!free.length) continue;
        const load = (id) => bookings.filter((b) => b.instructorId === id && Math.floor(toMin(b.start) / DAY) * DAY === day).length;
        free.sort((a, b) => load(a) - load(b));
        pick = pick || { room, instructorId: free[0], join: false, bookingId: null };
      }
      if (pick) out.push({ start: fromMin(s), end: fromMin(e), ...pick });
    }
  }
  return out;
}

/* checkPlan: are these the right number of sessions, in order, spaced by the
   rules, never overlapping? Returns null when fine, else the reason. Each
   session must also still be on offer (the caller re-runs findSlots for it). */
export function checkPlan(config, courseId, starts) {
  const course = config.courses[courseId];
  if (!course) return "Unknown course";
  if (!Array.isArray(starts) || starts.length !== course.sessions) {
    return `Choose ${course.sessions} session${course.sessions === 1 ? "" : "s"}`;
  }
  const gap = (config.rules || {}).gapDays || { min: 1, max: 30 };
  const days = starts.map((s) => Math.floor(toMin(s) / DAY));
  for (let i = 1; i < days.length; i++) {
    const g = days[i] - days[i - 1];
    if (g < gap.min) return `Leave at least ${gap.min} day${gap.min === 1 ? "" : "s"} between sessions`;
    if (g > gap.max) return `Keep sessions within ${gap.max} days of each other`;
  }
  return null;
}
