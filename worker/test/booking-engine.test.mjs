/* The booking engine's rules, one by one (booking-engine.js). A small studio
   shaped like the real ones: a Main Room with hair and nail stations and a
   Treatment Room with beds. Synthetic instructors and bookings only. */
import { findSlots, checkPlan, roomsFor, teachersFor, toMin, fromMin } from '../booking-engine.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '  [' + String(d).slice(0, 300) + ']' : ''}`)); };

const st = (id, type) => ({ id, name: id, type });
const config = {
  rules: { minNoticeHours: 48, maxDaysAhead: 90, gapDays: { min: 1, max: 30 }, bufferMinutes: 15 },
  defaultHours: { days: [1, 2, 3, 4, 5, 6], open: '09:00', close: '17:00' },
  studios: {
    'loc-a': { rooms: {
      'Main Room': { stations: [st('H1', 'Hair Styling'), st('H2', 'Hair Styling'), st('N1', 'Nail Care'), st('N2', 'Nail Care'), st('S1', 'Spa/Pedicure')] },
      'Treatment Room': { stations: [st('B1', 'Treatment Bed'), st('B2', 'Treatment Bed'), st('T1', 'Spray Tan'), st('S2', 'Spa/Pedicure')] },
    } },
  },
  courses: {
    hair: { name: 'Hair', station: 'Hair Styling', sessions: 3, hoursPerSession: 5 },
    nails: { name: 'Nails', station: 'Nail Care', sessions: 2, hoursPerSession: 4 },
    lash: { name: 'Lash', station: 'Treatment Bed', sessions: 2, hoursPerSession: 3 },
    pedi: { name: 'Pedicure', station: 'Spa/Pedicure', sessions: 1, hoursPerSession: 5.5 },
    tan: { name: 'Tan', station: 'Spray Tan', sessions: 1, hoursPerSession: 4.5 },
    biz: { name: 'Business', station: null, sessions: 2, hoursPerSession: 2 },
  },
  instructors: {
    ann: { name: 'Ann', locationIds: ['loc-a'], courseIds: ['hair', 'nails', 'lash', 'pedi', 'biz', 'tan'] },
    bea: { name: 'Bea', locationIds: ['loc-a'], courseIds: ['nails', 'lash'] },
    cal: { name: 'Cal', locationIds: ['loc-b'], courseIds: ['hair'] },
  },
};
const allWeek = [{ days: [1, 2, 3, 4, 5, 6], from: '09:00', to: '17:00' }];
const hours = { ann: allWeek, bea: allWeek };
// Mon 23 Nov 2026 is a Monday; "now" is the Thursday before.
const base = { config, locationId: 'loc-a', from: '2026-11-23', days: 1, now: '2026-11-19T10:00', bookings: [], busy: {}, hours };
const at = (slots, t) => slots.find((s) => s.start === t);

/* ------------------------------------------------------------ the basics */
check('time helpers round-trip', fromMin(toMin('2026-11-23T09:30')) === '2026-11-23T09:30');
check('rooms come from stations: hair is the Main Room, 2 seats', JSON.stringify(roomsFor(config, 'hair', 'loc-a')) === '[{"room":"Main Room","seats":2}]');
check('a pedicure fits either room (a spa chair in each)', roomsFor(config, 'pedi', 'loc-a').length === 2);
check('a course with no station can use any room', roomsFor(config, 'biz', 'loc-a').length === 2);
check('only instructors who teach it there', JSON.stringify(teachersFor(config, 'hair', 'loc-a')) === '["ann"]' && teachersFor(config, 'hair', 'loc-b')[0] === 'cal');

let s = findSlots({ ...base, courseId: 'hair' });
check('an empty Monday: hair starts on the half hour from 9:00, last at 12:00 (5 h, closes 17:00)',
  s[0]?.start === '2026-11-23T09:00' && s[s.length - 1]?.start === '2026-11-23T12:00' && s.length === 7, s.map((x) => x.start).join());
check('...in the Main Room, with Ann', s.every((x) => x.room === 'Main Room' && x.instructorId === 'ann'));
check('no classes on Sunday', findSlots({ ...base, courseId: 'hair', from: '2026-11-22' }).length === 0);

/* -------------------------------------------- one course per room (nails vs hair) */
const hairBooked = [{ id: 'b1', courseId: 'hair', locationId: 'loc-a', room: 'Main Room', start: '2026-11-23T09:00', end: '2026-11-23T14:00', instructorId: 'ann', students: 1 }];
s = findSlots({ ...base, courseId: 'nails', bookings: hairBooked });
check('NAILS cannot run while HAIR is in the Main Room', !s.some((x) => toMin(x.start) < toMin('2026-11-23T14:15')), s.map((x) => x.start).join());
check('...nails can start once hair is done and the room is tidied (14:15 rounds to 14:30... but 4 h must end by 17:00)', s.length === 0 || s.every((x) => toMin(x.start) >= toMin('2026-11-23T14:30')));
s = findSlots({ ...base, courseId: 'lash', bookings: hairBooked });
check('the Treatment Room is a different room: lashes can run alongside hair', at(s, '2026-11-23T09:00')?.room === 'Treatment Room');
check('...with Bea, because Ann is teaching the hair', at(s, '2026-11-23T09:00')?.instructorId === 'bea');

/* ------------------------------------------------------ joining a session */
s = findSlots({ ...base, courseId: 'hair', bookings: hairBooked });
check('a second hair student can join the same session (2 hair stations)', at(s, '2026-11-23T09:00')?.join === true && at(s, '2026-11-23T09:00')?.bookingId === 'b1');
check('...but not a different time that overlaps it', !at(s, '2026-11-23T09:30'));
s = findSlots({ ...base, courseId: 'hair', bookings: [{ ...hairBooked[0], students: 2 }] });
check('a full session takes nobody else', !at(s, '2026-11-23T09:00'));
s = findSlots({ ...base, courseId: 'tan', bookings: [{ id: 't1', courseId: 'tan', locationId: 'loc-a', room: 'Treatment Room', start: '2026-11-23T09:00', end: '2026-11-23T13:30', instructorId: 'ann', students: 1 }] });
check('one spray tan booth: a tan session is full with one student', !at(s, '2026-11-23T09:00'));

/* ---------------------------------------------------------- instructors */
s = findSlots({ ...base, courseId: 'hair', hours: { ann: [{ days: [1], from: '13:00', to: '17:00' }] } });
check('only inside the instructor\'s teaching hours (13-17 fits no 5 h session)', s.length === 0);
s = findSlots({ ...base, courseId: 'lash', hours: { ann: [{ days: [1], from: '12:00', to: '17:00' }] } });
check('...a 3 h lash fits 12:00-17:00 (12:00 to 14:00 starts)', s[0]?.start === '2026-11-23T12:00' && s.length === 5, s.map((x) => x.start).join());
s = findSlots({ ...base, courseId: 'hair', hours: {} });
check('an instructor who has not given hours is never assumed free', s.length === 0);
s = findSlots({ ...base, courseId: 'hair', busy: { ann: [{ start: '2026-11-23T11:00', end: '2026-11-23T12:00' }] } });
check('busy on their own calendar 11-12: only the 12:00 start is left (5 h ends at closing)', s.length === 1 && s[0].start === '2026-11-23T12:00', s.map((x) => x.start).join());
s = findSlots({ ...base, courseId: 'hair', bookings: [{ id: 'x', courseId: 'hair', locationId: 'loc-b', room: 'Main Room', start: '2026-11-23T08:00', end: '2026-11-23T10:00', instructorId: 'ann' }] });
check('teaching at another studio counts too', !at(s, '2026-11-23T09:00') && !!at(s, '2026-11-23T10:00'));
s = findSlots({ ...base, courseId: 'nails', bookings: [{ id: 'y', courseId: 'lash', locationId: 'loc-a', room: 'Treatment Room', start: '2026-11-23T09:00', end: '2026-11-23T12:00', instructorId: 'bea' }] });
check('the least-busy qualified instructor is offered', at(s, '2026-11-23T09:00')?.instructorId === 'ann');

/* ------------------------------------------------------- notice and range */
s = findSlots({ ...base, courseId: 'lash', now: '2026-11-21T12:00' });
check('48 hours notice: nothing before Monday 12:00 when it is Saturday noon', s.every((x) => toMin(x.start) >= toMin('2026-11-23T12:00')) && s.length > 0);
s = findSlots({ ...base, courseId: 'lash', from: '2027-03-01', now: '2026-11-19T10:00' });
check('nothing more than 90 days ahead', s.length === 0);
check('a course with no session length offers nothing', findSlots({ ...base, courseId: 'nope' }).length === 0);
check('a cancelled booking frees the room', !!at(findSlots({ ...base, courseId: 'nails', bookings: [{ ...hairBooked[0], status: 'cancelled' }] }), '2026-11-23T09:00'));

/* -------------------------------------------------------------- the plan */
check('a plan needs exactly the course\'s sessions', checkPlan(config, 'hair', ['2026-11-23T09:00']) === 'Choose 3 sessions');
check('...on different days', checkPlan(config, 'nails', ['2026-11-23T09:00', '2026-11-23T13:00']) === 'Leave at least 1 day between sessions');
check('...no more than 30 days apart', checkPlan(config, 'nails', ['2026-11-23T09:00', '2027-01-04T09:00']) === 'Keep sessions within 30 days of each other');
check('...and a good plan passes', checkPlan(config, 'hair', ['2026-11-23T09:00', '2026-11-25T09:00', '2026-11-27T09:00']) === null);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
