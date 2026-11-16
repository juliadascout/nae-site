/* Booking sessions (booking.js): only enrolled, signed-in students; slots from
   the engine; a whole plan booked at once or not at all; a taken time refused;
   a request when nothing fits. Synthetic people only. */
import { makeDb, SCHEMA } from './d1-shim.mjs';
import { handleBooking, torontoNow } from '../booking.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '  [' + String(d).slice(0, 300) + ']' : ''}`)); };

const st = (id, type) => ({ id, name: id, type });
const config = {
  rules: { minNoticeHours: 24, maxDaysAhead: 365, gapDays: { min: 1, max: 30 }, bufferMinutes: 15 },
  defaultHours: { days: [0, 1, 2, 3, 4, 5, 6], open: '09:00', close: '17:00' },
  studios: { 'loc-a': { name: 'Studio A', rooms: {
    'Main Room': { stations: [st('H1', 'Hair Styling'), st('N1', 'Nail Care')] },
    'Treatment Room': { stations: [st('B1', 'Treatment Bed'), st('B2', 'Treatment Bed')] } } } },
  unmapped: ['loc-nf'],
  courses: {
    lash: { name: 'Lash', station: 'Treatment Bed', sessions: 2, hoursPerSession: 3 },
    nails: { name: 'Nails', station: 'Nail Care', sessions: 1, hoursPerSession: 4 },
    hair: { name: 'Hair', station: 'Hair Styling', sessions: 1, hoursPerSession: 4 },
  },
  instructors: {
    ann: { name: 'Ann', locationIds: ['loc-a'], courseIds: ['lash', 'nails', 'hair'], hours: [{ days: [0, 1, 2, 3, 4, 5, 6], from: '09:00', to: '17:00' }] },
  },
};

let user = null;
const env = {
  ENROLMENTS: makeDb(SCHEMA),
  ACCOUNTS: { async fetch() { return user ? new Response(JSON.stringify({ user }), { status: 200 }) : new Response('{}', { status: 401 }); } },
};
const enrol = (email, course) => env.ENROLMENTS.prepare(`INSERT INTO enrolments (id, created_at, course_id, course_name, with_kit, location_id, total,
  payer_email, stage, stage_since, provider, stripe_session_id) VALUES (?, ?, ?, ?, 0, 'loc-a', 100, ?, 'paid', ?, 'stripe', ?)`)
  .bind(crypto.randomUUID(), new Date().toISOString(), course, course, email, new Date().toISOString(), 'cs_' + Math.random()).run();
const call = async (path, { method = 'GET', body } = {}) => {
  const url = new URL('https://beautycourse.ca/api/booking/' + path);
  const res = await handleBooking(new Request(url, { method, headers: { 'content-type': 'application/json', cookie: 's=1' },
    body: body ? JSON.stringify(body) : undefined }), env, url, config);
  return { status: res.status, j: await res.json() };
};

/* A day well past the notice period, so the test never depends on today. */
const day = (n) => { const d = new Date(Date.now() + n * 86400e3); return d.toISOString().slice(0, 10); };
const D1 = day(10), D2 = day(12);

check('Ontario time is a wall-clock string', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(torontoNow()));
check('torontoNow is Ontario, not UTC', torontoNow(new Date('2026-07-01T16:00:00Z')) === '2026-07-01T12:00');

let r = await call('options?course=lash');
check('not signed in: refused', r.status === 401);
user = { email: 'Sam@Example.ca', name: 'Sam Test', emailVerified: false };
r = await call('options?course=lash');
check('email not confirmed: refused, and told why', r.status === 403 && /Confirm your email/.test(r.j.error));
user = { ...user, emailVerified: true };
r = await call('options?course=lash');
check('not enrolled in the course: refused', r.status === 403 && /once you have enrolled/.test(r.j.error));

await enrol('sam@example.ca', 'lash');
r = await call('options?course=lash');
check('enrolled: the plan and the studios', r.status === 200 && r.j.course.sessions === 2 && r.j.studios.some((s) => s.id === 'loc-a' && s.bookable)
  && r.j.studios.some((s) => s.id === 'loc-nf' && !s.bookable), JSON.stringify(r.j));

r = await call(`slots?course=lash&studio=loc-a&from=${D1}&days=1`);
check('slots come from the engine, with the instructor by name', r.status === 200 && r.j.slots[0]?.start === `${D1}T09:00` && r.j.slots[0]?.instructor === 'Ann', JSON.stringify(r.j).slice(0, 200));

r = await call('book', { method: 'POST', body: { course: 'lash', studio: 'loc-a', starts: [`${D1}T09:00`] } });
check('a plan with the wrong number of sessions is refused', r.status === 400 && r.j.error === 'Choose 2 sessions');
r = await call('book', { method: 'POST', body: { course: 'lash', studio: 'loc-a', starts: [`${D1}T09:00`, `${D2}T13:00`] } });
check('a good plan is booked, both sessions', r.status === 200 && r.j.sessions.length === 2 && r.j.sessions[0].room === 'Treatment Room', JSON.stringify(r.j));
const rows = (await env.ENROLMENTS.prepare("SELECT * FROM class_bookings ORDER BY starts_at").all()).results;
check('...stored once each, one plan, numbered, with the instructor', rows.length === 2 && rows[0].plan_id === rows[1].plan_id
  && rows[0].session_no === 1 && rows[1].session_no === 2 && rows[0].instructor_id === 'ann' && rows[0].student_email === 'sam@example.ca');
r = await call('book', { method: 'POST', body: { course: 'lash', studio: 'loc-a', starts: [`${D1}T09:00`, `${D2}T13:00`] } });
check('the same course cannot be booked twice', r.status === 409);

/* Another student, the same lash session: joins it (two beds). */
user = { email: 'kim@example.ca', name: 'Kim', emailVerified: true };
await enrol('kim@example.ca', 'lash');
r = await call(`slots?course=lash&studio=loc-a&from=${D1}&days=1`);
check('a second lash student sees the same session as joinable', r.j.slots.find((s) => s.start === `${D1}T09:00`)?.join === true);

/* Nails in the Main Room vs a booked hair class. */
user = { email: 'lee@example.ca', name: 'Lee', emailVerified: true };
await enrol('lee@example.ca', 'hair');
r = await call('book', { method: 'POST', body: { course: 'hair', studio: 'loc-a', starts: [`${D1}T09:00`] } });
check('hair cannot take 9:00 on day 1: Ann is teaching lashes then', r.status === 409);
r = await call('book', { method: 'POST', body: { course: 'hair', studio: 'loc-a', starts: [`${D2}T09:00`] } });
check('hair booked in the Main Room', r.status === 200 && r.j.sessions[0].room === 'Main Room');
user = { email: 'max@example.ca', name: 'Max', emailVerified: true };
await enrol('max@example.ca', 'nails');
r = await call(`slots?course=nails&studio=loc-a&from=${D2}&days=1`);
check('nails are not offered while hair has the Main Room on day 2', !r.j.slots.some((s) => s.start < `${D2}T13:15`), r.j.slots.map((s) => s.start).join());
r = await call('book', { method: 'POST', body: { course: 'nails', studio: 'loc-a', starts: [`${D2}T09:00`] } });
check('...and booking that time anyway is refused', r.status === 409 && /no longer free/.test(r.j.error));

/* A request when nothing fits. */
r = await call('request', { method: 'POST', body: { course: 'nails', studio: 'loc-a', wishes: [{ date: D1, time: '18:00' }, { date: 'x', time: '1' }], note: 'Evenings only please' } });
check('a request is kept, with its valid wishes and note', r.status === 200);
const req = await env.ENROLMENTS.prepare("SELECT * FROM class_bookings WHERE status = 'requested'").first();
check('...as requested, not booked', req?.student_email === 'max@example.ca' && JSON.parse(req.wishes).length === 1 && req.note === 'Evenings only please' && req.starts_at === null);
r = await call('request', { method: 'POST', body: { course: 'nails', studio: 'loc-a', wishes: [{ date: D1, time: '18:00' }] } });
check('...and only once per course', r.status === 409);
r = await call('mine');
check('the student sees their request', r.j.bookings.length === 1 && r.j.bookings[0].status === 'requested' && r.j.bookings[0].course === 'Nails');
user = { email: 'sam@example.ca', name: 'Sam', emailVerified: true };
r = await call('mine');
check('...and Sam sees both sessions, in order', r.j.bookings.length === 2 && r.j.bookings[0].start === `${D1}T09:00` && r.j.bookings[1].studio === 'Studio A');

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
