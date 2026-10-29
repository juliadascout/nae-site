/* Questions from the Contact page (enquiries.js): what is kept, what is
   refused, what robots get, the hourly limit, the purge, and what the apps'
   Worker is asked to send. A fake NOTIFY binding stands in for it. Synthetic
   people only. */
import { makeDb, SCHEMA } from './d1-shim.mjs';
import { handleEnquiry, ENQUIRY_PATH } from '../enquiries.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '  [' + String(d).slice(0, 200) + ']' : ''}`)); };

const COURSES = { 'crs-sample': { name: 'Sample Course' } };
const CATALOGUE = {
  courses: COURSES, booking: 'https://calendar.app.google/SAMPLE', site: 'https://site.example',
  seller: { name: 'National Association of Estheticians Inc.', address: '1 Test St, Testville, ON A1A 1A1', phone: '555-010-0199', email: 'office@example.com' },
};
let told, waits, env;
function fresh({ notify } = {}) {
  told = []; waits = [];
  env = {
    ENROLMENTS: makeDb(SCHEMA),
    NOTIFY: notify === undefined
      ? { async enquiry(q) { told.push(q); return { admins: 2, reply: 'sent' }; } }
      : notify,
  };
}
const ctx = { waitUntil: (p) => waits.push(p) };
const GOOD = {
  name: 'Alex Doe', email: 'Alex@Inbox.Example.ca', phone: '555-010-0123',
  courseId: 'crs-sample', message: 'Do you run weekend classes?\nI work weekdays.', website: '', elapsed: 9000,
};
async function ask(body, { ip = '198.51.100.7', raw } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (ip) headers['CF-Connecting-IP'] = ip;
  const res = await handleEnquiry(new Request('https://site.example' + ENQUIRY_PATH, {
    method: 'POST', headers, body: raw !== undefined ? raw : JSON.stringify(body),
  }), env, ctx, CATALOGUE);
  return { status: res.status, body: await res.json() };
}
const rows = () => env.ENROLMENTS.prepare('SELECT * FROM enquiries ORDER BY created_at').all().then((r) => r.results);

/* ------------------------------------------------------------- a question */
fresh();
let r = await ask(GOOD);
check('a question is accepted', r.status === 200 && r.body.ok === true, JSON.stringify(r));
let all = await rows();
check('it is kept', all.length === 1);
const q = all[0];
check('...with what answering needs', q.name === 'Alex Doe' && q.email === 'alex@inbox.example.ca' && q.phone === '555-010-0123');
check('...the course, by id', q.course_id === 'crs-sample');
check('...the question, in its lines', q.message === 'Do you run weekend classes?\nI work weekdays.', JSON.stringify(q.message));
check('...as a new question, timestamped for the pipeline', q.stage === 'new' && !isNaN(Date.parse(q.stage_since)));
check('...and the network address, for the hourly limit', q.ip === '198.51.100.7');
await Promise.all(waits);
check('the administrators are told, once', told.length === 1);
check('...after the answer, through waitUntil', waits.length === 1);
check('...with the course by name, not id', told[0]?.course === 'Sample Course', told[0]?.course);
check('...and what they wrote', told[0]?.name === 'Alex Doe' && told[0]?.email === 'alex@inbox.example.ca'
  && told[0]?.message === GOOD.message && told[0]?.phone === '555-010-0123' && !isNaN(Date.parse(told[0]?.sentAt)));
check('...and nothing else of theirs (no network address)', !('ip' in told[0]));
check('...with the booking link, site and seller for the instant reply',
  told[0]?.booking === CATALOGUE.booking && told[0]?.site === CATALOGUE.site && told[0]?.seller === CATALOGUE.seller);

/* ----------------------------------------------------------- the lead */
const leads = () => env.ENROLMENTS.prepare('SELECT * FROM leads').all().then((x) => x.results);
let L = await leads();
check('the person becomes a lead', L.length === 1 && L[0].email === 'alex@inbox.example.ca' && L[0].name === 'Alex Doe');
check('...new, from an enquiry, about the course', L[0]?.stage === 'new' && L[0]?.source === 'enquiry' && L[0]?.course_id === 'crs-sample');
check('...and the question is linked to them', (await rows())[0]?.lead_id === L[0]?.id);
check('the alert can link to the lead', told[0]?.leadId === L[0]?.id);
const ev = (await env.ENROLMENTS.prepare('SELECT kind, detail FROM lead_events WHERE lead_id = ? ORDER BY at').bind(L[0].id).all()).results;
check('their timeline shows the question and the instant reply', ev.map((e) => e.kind).join(',') === 'enquiry,auto-reply', JSON.stringify(ev));
const cons = (await env.ENROLMENTS.prepare('SELECT * FROM consents WHERE lead_id = ?').bind(L[0].id).all()).results;
check('implied consent is recorded, ending six months on',
  cons.length === 1 && cons[0].kind === 'implied_inquiry' && Math.round((Date.parse(cons[0].expires_at) - Date.parse(cons[0].given_at)) / 86400e3 / 30) === 6, JSON.stringify(cons));
await ask({ ...GOOD, email: 'alex@inbox.example.ca', message: 'One more thing' }, { ip: '198.51.100.8' });
await Promise.all(waits);
check('asking again is the same lead, not a second one', (await leads()).length === 1);

fresh();
r = await ask({ ...GOOD, phone: '', courseId: '' });
check('phone and course are optional', r.status === 200 && (await rows())[0]?.phone === null && (await rows())[0]?.course_id === null);
fresh();
r = await ask({ ...GOOD, courseId: 'crs-not-a-course' });
check('a course that is not in the catalogue is dropped, not refused', r.status === 200 && (await rows())[0]?.course_id === null);
fresh();
r = await ask({ ...GOOD, courseId: '__proto__' });
check('...including names that are not courses at all', r.status === 200 && (await rows())[0]?.course_id === null);
fresh();
r = await ask({ ...GOOD, phone: '905 555 0100 ext. 12' });
check('a phone number with an extension is fine', r.status === 200, JSON.stringify(r));

/* ---------------------------------------------------------------- robots */
fresh();
r = await ask({ ...GOOD, website: 'http://spam.example' });
check('a robot that fills the hidden field is thanked...', r.status === 200 && r.body.ok === true);
check('...and nothing is kept or sent', (await rows()).length === 0 && told.length === 0);
fresh();
r = await ask({ ...GOOD, elapsed: 800 });
check('a form sent within seconds of opening is thanked and dropped', r.status === 200 && (await rows()).length === 0 && told.length === 0);
fresh();
const { elapsed, ...noTime } = GOOD;
r = await ask(noTime);
check('...as is one that never says how long it was open', r.status === 200 && (await rows()).length === 0);

/* ------------------------------------------------------- what is refused */
for (const [what, body, word] of [
  ['no name', { ...GOOD, name: '   ' }, /name/],
  ['an address that is not one', { ...GOOD, email: 'alex at example' }, /email address/],
  ['two addresses', { ...GOOD, email: 'a@inbox.example.ca, b@inbox.example.ca' }, /email address/],
  ['a phone number that is not one', { ...GOOD, phone: 'call me maybe' }, /phone/],
  ['no question', { ...GOOD, message: ' \n ' }, /question/],
  ['a question over 2,000 characters', { ...GOOD, message: 'x'.repeat(2001) }, /2,000/],
]) {
  fresh();
  r = await ask(body);
  check(`refused, saying why: ${what}`, r.status === 400 && word.test(r.body.error || '') && (await rows()).length === 0 && told.length === 0, JSON.stringify(r));
}
fresh();
r = await ask(null, { raw: 'not json' });
check('not JSON is refused', r.status === 400);
fresh();
r = await ask(null, { raw: JSON.stringify({ ...GOOD, message: 'x'.repeat(20000) }) });
check('a body far past the form\'s limits is refused before it is read as JSON', r.status === 413);

/* Control characters go; the line breaks stay. */
fresh();
await ask({ ...GOOD, message: 'one\r\ntwo\u0007three\u0000' });
check('control characters are removed, line breaks kept', (await rows())[0]?.message === 'one\ntwo three', JSON.stringify((await rows())[0]?.message));

/* ------------------------------------------------------------ the limit */
fresh();
for (let i = 0; i < 5; i++) await ask(GOOD);
r = await ask(GOOD);
check('a sixth question in an hour from one address is refused', r.status === 429 && /hour/.test(r.body.error), JSON.stringify(r));
r = await ask(GOOD, { ip: '203.0.113.9' });
check('...but not from another address', r.status === 200);
check('...and five plus one are kept', (await rows()).length === 6);

/* ------------------------------------------------------------ the purge */
fresh();
const ins = (id, daysAgo, ip) => env.ENROLMENTS.prepare(
  `INSERT INTO enquiries (id, created_at, name, email, message, ip, stage_since) VALUES (?, ?, 'Old', 'old@inbox.example.ca', 'm', ?, ?)`,
).bind(id, new Date(Date.now() - daysAgo * 86400e3).toISOString(), ip, new Date().toISOString()).run();
await ins('older-than-a-year', 400, null);
await ins('two-days-old', 2, '192.0.2.1');
await ask(GOOD);
all = await rows();
check('a question older than a year is deleted', !all.some((x) => x.id === 'older-than-a-year'));
check('a newer one is kept, without its network address', all.find((x) => x.id === 'two-days-old')?.ip === null);
check("today's keeps its address for the hourly limit", all.find((x) => x.name === 'Alex Doe')?.ip === '198.51.100.7');

/* -------------------------------------------------- when things break */
fresh();
env.ENROLMENTS = { prepare() { throw new Error('db down'); } };
r = await ask(GOOD);
check('if it cannot be kept, the visitor is told to call or email', r.status === 503 && /call or email/i.test(r.body.error));
check('...and nothing is sent', told.length === 0);

fresh({ notify: null });
r = await ask(GOOD);
check('without the apps bound, the question is still kept and thanked', r.status === 200 && (await rows()).length === 1);

fresh({ notify: { async enquiry() { throw new Error('apps down'); } } });
r = await ask(GOOD);
await Promise.allSettled(waits);
check('if the apps cannot be reached, the visitor is still thanked', r.status === 200 && (await rows()).length === 1);

fresh();
env.ENROLMENTS = null;
r = await ask(GOOD);
check('with no database bound, it says to call or email', r.status === 503);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
