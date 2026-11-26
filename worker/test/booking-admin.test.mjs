/* Staff booking actions (booking-admin.js), as the apps call them through the
   Booking entrypoint: approve a request, move a session, change who teaches,
   cancel, decline. Each one writes the record, emails the student once, and
   refuses an instructor anything outside their own courses. Synthetic people
   only. */
import { makeDb, SCHEMA } from './d1-shim.mjs';
import * as staff from '../booking-admin.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '  [' + String(d).slice(0, 300) + ']' : ''}`)); };

const st = (id, type) => ({ id, name: id, type });
const allWeek = [{ days: [0, 1, 2, 3, 4, 5, 6], from: '09:00', to: '17:00' }];
const config = {
  rules: { minNoticeHours: 24, maxDaysAhead: 365, gapDays: { min: 1, max: 30 }, bufferMinutes: 15 },
  defaultHours: { days: [0, 1, 2, 3, 4, 5, 6], open: '09:00', close: '17:00' },
  studios: { 'loc-a': { name: 'Studio A', rooms: {
    'Main Room': { stations: [st('N1', 'Nail Care')] },
    'Treatment Room': { stations: [st('B1', 'Treatment Bed'), st('B2', 'Treatment Bed')] } } } },
  locationNames: { 'loc-a': 'Alpha' },
  courses: {
    lash: { name: 'Lash', station: 'Treatment Bed', sessions: 2, hoursPerSession: 3 },
    nails: { name: 'Nails', station: 'Nail Care', sessions: 1, hoursPerSession: 4 },
  },
  instructors: {
    ann: { name: 'Ann', locationIds: ['loc-a'], courseIds: ['lash', 'nails'], hours: allWeek },
    bea: { name: 'Bea', locationIds: ['loc-a'], courseIds: ['lash'], hours: allWeek },
  },
};

const told = [];
const env = { NOTIFY: { async booking(d) { told.push(d); return { admins: 1, student: 'sent' }; } }, ENROLMENTS: makeDb(SCHEMA) };
const c = { env, config, catalogue: { site: 'https://beautycourse.ca', seller: { address: '1 Test St' } }, ctx: null };
const db = env.ENROLMENTS;

const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const D1 = day(10), D2 = day(12), D3 = day(14);

/* Make the table, then two requests and one booked nails class. */
await staff.queue(c, {});
const add = (id, course, status, email, extra = {}) => db.prepare(
  `INSERT INTO class_bookings (id, created_at, plan_id, course_id, location_id, room, instructor_id, starts_at, ends_at,
     session_no, student_email, student_name, status, wishes) VALUES (?, ?, ?, ?, 'loc-a', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
).bind(id, new Date().toISOString(), extra.plan || id, course, extra.room || null, extra.instructor || null, extra.start || null, extra.end || null,
  extra.n || null, email, extra.name || 'Test Person', status, extra.wishes ? JSON.stringify(extra.wishes) : null).run();
const R1 = crypto.randomUUID(), R2 = crypto.randomUUID(), R3 = crypto.randomUUID(), N1 = crypto.randomUUID();
await add(R1, 'lash', 'requested', 'sam@example.com', { name: 'Sam Test', wishes: [{ date: D1, time: '09:00' }] });
await add(R2, 'nails', 'requested', 'kim@example.com', { wishes: [{ date: D1, time: '10:00' }] });
await add(R3, 'lash', 'requested', 'lee@example.com', { wishes: [{ date: D3, time: '13:00' }] });
await add(N1, 'nails', 'booked', 'other@example.com', { room: 'Main Room', instructor: 'ann', start: `${D1}T10:00`, end: `${D1}T14:00`, n: 1 });

const beaScope = { courseIds: ['lash'], locationIds: ['loc-a'] };

/* reading */
let cat = await staff.catalogue(c);
check('catalogue: names and who teaches what, no people', cat.courses.lash.name === 'Lash' && cat.studios['loc-a'].name === 'Alpha'
  && cat.instructors.bea.courseIds.join() === 'lash' && !JSON.stringify(cat).includes('@'));
let r = await staff.queue(c, { from: D1, to: D3 });
check('queue: every waiting request', r.requests.length === 3, JSON.stringify(r.requests.map((x) => x.course)));
check('queue: the booked class in the window', r.sessions.length === 1 && r.sessions[0].instructor === 'Ann' && r.sessions[0].studio === 'Alpha');
r = await staff.queue(c, { scope: beaScope, from: D1, to: D3 });
check('queue: an instructor sees only their courses', r.requests.length === 2 && r.requests.every((x) => x.courseId === 'lash') && r.sessions.length === 0);
r = await staff.slots(c, { courseId: 'lash', locationId: 'loc-a', from: D1, days: 1 });
check('slots: times and who teaches it there', r.ok && r.slots.length > 0 && r.teachers.map((t) => t.id).join() === 'ann,bea');
r = await staff.slots(c, { courseId: 'nails', locationId: 'loc-a', from: D1, scope: beaScope });
check('slots: refused outside an instructor\'s courses', r.status === 403);

/* approve */
r = await staff.approve(c, { id: R1, starts: [`${D1}T09:00`], actor: 'jules@example.com' });
check('approve: needs the whole plan (2 sessions)', r.status === 400 && /2 sessions/.test(r.error), r.error);
r = await staff.approve(c, { id: R2, starts: [`${D1}T10:00`], scope: beaScope });
check('approve: an instructor cannot take another course', r.status === 403);
told.length = 0;
r = await staff.approve(c, { id: R1, starts: [`${D2}T09:00`, `${D1}T09:00`], instructorId: 'bea', scope: beaScope, actor: 'bea@example.com' });
check('approve: books both sessions, in order, with the chosen instructor', r.ok && r.sessions.length === 2
  && r.sessions[0].start === `${D1}T09:00` && r.sessions.every((s) => s.instructorId === 'bea' && s.room === 'Treatment Room'), JSON.stringify(r));
const reqRow = await db.prepare('SELECT status, decided_by FROM class_bookings WHERE id = ?').bind(R1).first();
check('approve: the request is kept, marked approved, with who decided', reqRow.status === 'approved' && reqRow.decided_by === 'bea@example.com');
check('approve: one "confirmed" email with both sessions', told.length === 1 && told[0].kind === 'confirmed' && told[0].sessions.length === 2
  && told[0].email === 'sam@example.com' && told[0].sessions[0].instructor === 'Bea');
r = await staff.approve(c, { id: R1, starts: [`${D1}T09:00`, `${D2}T09:00`] });
check('approve: a request is only approved once', r.status === 404);
r = await staff.approve(c, { id: R2, starts: [`${D1}T10:00`] });
check('approve: a clash is refused', r.status === 409, JSON.stringify(r));
r = await staff.approve(c, { id: R2, starts: [`${D1}T10:00`], canOverride: true, actor: 'jules@example.com' });
check('approve: an administrator may book over it, with a warning', r.ok && r.warnings.length === 1, JSON.stringify(r));

/* rebook */
const sam = (await staff.forStudent(c, { email: 'SAM@example.com' })).bookings;
check('forStudent: every status, booked sessions and the request', sam.length === 3 && sam.filter((b) => b.status === 'booked').length === 2);
const first = sam.find((b) => b.status === 'booked' && b.sessionNo === 1);
told.length = 0;
r = await staff.rebook(c, { id: first.id, start: `${D1}T12:00`, actor: 'jules@example.com' });
check('rebook: moves one session and keeps its instructor if free', r.ok && r.session.start === `${D1}T12:00` && r.session.end === `${D1}T15:00`, JSON.stringify(r));
check('rebook: one "changed" email saying what it was', told.length === 1 && told[0].kind === 'changed' && told[0].was.start === `${D1}T09:00`);
r = await staff.rebook(c, { id: first.id, start: `${D1}T09:00`, instructorId: 'ann', scope: { courseIds: ['nails'], locationIds: ['loc-a'] } });
check('rebook: refused outside an instructor\'s courses', r.status === 403);
r = await staff.rebook(c, { id: first.id, start: `${D1}T18:00` });
check('rebook: a time the studio is closed is refused', r.status === 409);

/* assign */
r = await staff.assign(c, { id: first.id, instructorId: 'nobody' });
check('assign: only someone who teaches it there', r.status === 400);
await staff.rebook(c, { id: first.id, start: `${D3}T09:00` });
told.length = 0;
r = await staff.assign(c, { id: first.id, instructorId: 'ann', actor: 'jules@example.com' });
check('assign: changes who teaches and tells the student', r.ok && r.students === 1 && told.length === 1 && told[0].sessions[0].instructor === 'Ann', JSON.stringify(r));
/* Ann teaches the overridden nails class at 10:00-14:00 on D1, so a lash
   session at 12:00 overlaps it - only an administrator may assign her. */
r = await staff.rebook(c, { id: first.id, start: `${D1}T12:00`, instructorId: 'bea' });
r = await staff.assign(c, { id: first.id, instructorId: 'ann' });
check('assign: refused when the instructor is teaching then', r.status === 409, JSON.stringify(r));
r = await staff.assign(c, { id: first.id, instructorId: 'ann', canOverride: true });
check('assign: an administrator may, with a warning', r.ok && r.warnings.length === 1);

/* cancel and decline */
told.length = 0;
r = await staff.cancel(c, { id: first.id, whole: true, reason: 'student moved away', actor: 'jules@example.com' });
check('cancel: the whole plan', r.ok && r.cancelled === 2);
check('cancel: one "cancelled" email listing both', told.length === 1 && told[0].kind === 'cancelled' && told[0].sessions.length === 2 && told[0].reason === 'student moved away');
r = await staff.cancel(c, { id: first.id });
check('cancel: not twice', r.status === 404);
told.length = 0;
r = await staff.decline(c, { id: R3, reason: 'no instructor that week', scope: beaScope, actor: 'bea@example.com' });
check('decline: the request closes', r.ok && (await db.prepare('SELECT status FROM class_bookings WHERE id = ?').bind(R3).first()).status === 'declined');
check('decline: one "declined" email with the times asked for', told.length === 1 && told[0].kind === 'declined' && told[0].wishes.length === 1);
check('bad ids are refused, not looked up', (await staff.cancel(c, { id: "1' OR 1=1 --" })).status === 404);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
