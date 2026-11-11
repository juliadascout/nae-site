/* Scholarship applications (scholarship.js): what is kept, what is refused,
   the lead and consent, the emails asked for, and the account made with an
   application. Fake NOTIFY and ACCOUNTS bindings stand in for the apps'
   Worker. Synthetic people only. */
import { makeDb, SCHEMA } from './d1-shim.mjs';
import { handleScholarship, SCHOLARSHIP_PATH, isOpen, SCHOLARSHIP } from '../scholarship.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '  [' + String(d).slice(0, 300) + ']' : ''}`)); };

const CATALOGUE = {
  courses: { 'crs-lash': { name: 'Sample Lash Course' }, 'crs-brow': { name: 'Sample Brow Course' } },
  studios: { 'loc-stc': { name: 'St. Catharines' } },
  site: 'https://site.example',
  seller: { name: 'National Association of Estheticians Inc.', address: '1 Test St, Testville, ON A1A 1A1', phone: '555-010-0199', email: 'office@example.com' },
};
let told, waits, env, signups, meUser;
function fresh({ notify, accounts } = {}) {
  told = []; waits = []; signups = []; meUser = null;
  env = {
    ENROLMENTS: makeDb(SCHEMA),
    NOTIFY: notify === undefined
      ? { async scholarship(a) { told.push(a); return { admins: 2, receipt: 'sent' }; } }
      : notify,
    ACCOUNTS: accounts === undefined ? {
      async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === '/api/auth/me') {
          return meUser ? new Response(JSON.stringify({ user: meUser }), { status: 200 }) : new Response('{}', { status: 401 });
        }
        if (path === '/api/auth/signup') {
          const b = JSON.parse(new TextDecoder().decode(await req.arrayBuffer()));
          signups.push(b);
          if (b.email === 'taken@inbox.example.ca') return new Response(JSON.stringify({ error: 'exists' }), { status: 409 });
          return new Response(JSON.stringify({ user: { email: b.email } }), { status: 200, headers: { 'Set-Cookie': 'nae_session=abc; Path=/; HttpOnly; Secure' } });
        }
        return new Response('{}', { status: 404 });
      },
    } : accounts,
  };
}
const ctx = { waitUntil: (p) => waits.push(p) };
const GOOD = {
  name: 'Riley Test', email: 'Riley@Inbox.Example.ca', phone: '555-010-0144', place: 'Testville, ON, Canada',
  business: '', web: '@riley', studio: 'loc-stc', courses: ['crs-lash', 'crs-nope', 'crs-brow'], experience: 'New to beauty', heard: 'Instagram',
  q1: 'I love lashes.\nSecond line.', q2: 'Lash course', q3: 'A fresh start', q4: 'Start a business', q5: '',
  declared: true, signature: 'Riley Test', marketing: true, password: '', website: '', elapsed: 60000,
};
async function apply(body, { ip = '198.51.100.9', cookie } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (ip) headers['CF-Connecting-IP'] = ip;
  if (cookie) headers.cookie = cookie;
  const res = await handleScholarship(new Request('https://site.example' + SCHOLARSHIP_PATH, {
    method: 'POST', headers, body: JSON.stringify(body),
  }), env, ctx, CATALOGUE);
  return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie') };
}
const rows = () => env.ENROLMENTS.prepare('SELECT * FROM scholarship_applications ORDER BY created_at').all().then((r) => r.results);

/* ------------------------------------------------------------ an application */
fresh();
let r = await apply(GOOD);
check('an application is accepted', r.status === 200 && r.body.ok === true && r.body.account === 'none', JSON.stringify(r));
let all = await rows();
const a = all[0];
check('it is kept, every answer in its lines', all.length === 1 && a.q1 === 'I love lashes.\nSecond line.' && a.q4 === 'Start a business' && a.q5 === null, JSON.stringify(a));
check('...with who, where, and the address lower-cased', a.name === 'Riley Test' && a.email === 'riley@inbox.example.ca' && a.place === 'Testville, ON, Canada');
check('...only real courses, by name, and the studio by name', a.courses === '["Sample Lash Course","Sample Brow Course"]' && a.studio === 'St. Catharines', a.courses);
check('...the declaration, signature and consent', a.declared === 1 && a.signature === 'Riley Test' && a.marketing === 1);
check('...and no account, since no password was given', a.account === 'none');
await Promise.all(waits);
check('the administrators are asked to be told, once', told.length === 1);
check('...with every question and answer, the closing date and the seller',
  told[0]?.answers.length === 5 && told[0]?.answers[0][1] === GOOD.q1 && told[0]?.closes === SCHOLARSHIP.closesText && told[0]?.seller === CATALOGUE.seller);
check('...and no network address or password', !('ip' in told[0]) && !('password' in told[0]));

const L = (await env.ENROLMENTS.prepare('SELECT * FROM leads').all()).results;
check('the applicant becomes a lead, from the scholarship, with course and studio',
  L.length === 1 && L[0].source === 'scholarship' && L[0].course_id === 'crs-lash' && L[0].location_id === 'loc-stc', JSON.stringify(L[0]));
check('...linked to the application', (await rows())[0].lead_id === L[0].id);
const C = (await env.ENROLMENTS.prepare('SELECT kind, expires_at FROM consents ORDER BY kind').all()).results;
check('ticking "email me news" records express consent; applying records implied',
  C.length === 2 && C.some((c) => c.kind === 'express' && c.expires_at === null) && C.some((c) => c.kind === 'implied_inquiry'), JSON.stringify(C));

fresh();
await apply({ ...GOOD, marketing: false }); await Promise.all(waits);
const C2 = (await env.ENROLMENTS.prepare('SELECT kind FROM consents').all()).results;
check('left unticked, no express consent', C2.length === 1 && C2[0].kind === 'implied_inquiry');

/* -------------------------------------------------------------- accounts */
fresh();
r = await apply({ ...GOOD, password: 'a long enough password' });
check('a password makes the account, and the browser comes back signed in',
  r.body.account === 'created' && /nae_session=abc/.test(r.cookie || ''), JSON.stringify(r));
check('...through the usual sign-up, agreed, with the name and phone, quietly',
  signups.length === 1 && signups[0].agree === true && signups[0].name === 'Riley Test' && signups[0].phone === '555-010-0144' && signups[0].withApplication === true);
check('...and the application says so', (await rows())[0].account === 'created');
await Promise.all(waits);
check('...as does the alert', told[0]?.account === 'created');

fresh();
r = await apply({ ...GOOD, email: 'taken@inbox.example.ca', password: 'a long enough password' });
check('an address that already has an account: kept, and said so', r.status === 200 && r.body.account === 'existing' && !r.cookie);

fresh();
meUser = { email: 'riley@inbox.example.ca', name: 'Riley Test' };
r = await apply(GOOD, { cookie: 'nae_session=xyz' });
check('signed in with the same address: linked, nothing asked', r.body.account === 'existing' && signups.length === 0);

fresh();
r = await apply({ ...GOOD, password: 'short' });
check('a password that is too short is refused before anything is kept', r.status === 400 && r.body.field === 'password' && (await rows()).length === 0);

fresh({ accounts: { async fetch() { throw new Error('down'); } } });
r = await apply({ ...GOOD, password: 'a long enough password' });
check('accounts down: the application still goes, the account is "failed"', r.status === 200 && r.body.account === 'failed' && (await rows()).length === 1);

/* --------------------------------------------------------------- refusals */
for (const [what, body, field] of [
  ['no name', { ...GOOD, name: ' ' }, 'name'],
  ['bad email', { ...GOOD, email: 'nope' }, 'email'],
  ['no place', { ...GOOD, place: '' }, 'place'],
  ['question 3 empty', { ...GOOD, q3: '  ' }, 'q3'],
  ['declaration not ticked', { ...GOOD, declared: 'yes' }, 'declared'],
  ['no signature', { ...GOOD, signature: '' }, 'signature'],
  ['bad phone', { ...GOOD, phone: 'call me' }, 'phone'],
]) {
  fresh();
  r = await apply(body);
  check(`refused: ${what}`, r.status === 400 && r.body.field === field && (await rows()).length === 0, JSON.stringify(r));
}
fresh();
r = await apply({ ...GOOD, studio: 'loc-fake', experience: 'Astronaut', heard: '<b>x</b>' });
check('unknown choices are dropped, not refused', r.status === 200 && (await rows())[0].studio === null && (await rows())[0].experience === null && (await rows())[0].heard === null);

/* ---------------------------------------------------------------- robots */
fresh();
r = await apply({ ...GOOD, website: 'spam.example' });
check('a filled hidden field is thanked and dropped', r.status === 200 && (await rows()).length === 0 && told.length === 0);
fresh();
r = await apply({ ...GOOD, elapsed: 1500 });
check('a form sent in seconds is thanked and dropped', r.status === 200 && (await rows()).length === 0);

/* ------------------------------------------------------------ hourly limit */
fresh();
for (let i = 0; i < 3; i++) await apply({ ...GOOD, email: `p${i}@inbox.example.ca` });
r = await apply({ ...GOOD, email: 'p9@inbox.example.ca' });
check('three applications an hour from one address', r.status === 429 && (await rows()).length === 3);

/* -------------------------------------------------------- closing and email */
check('open now, closed after Nov 30 in Ontario', isOpen(Date.parse('2026-11-30T23:59:00-05:00')) && !isOpen(Date.parse('2026-12-01T00:00:01-05:00')));
fresh({ notify: { async scholarship() { throw new Error('mail down'); } } });
r = await apply(GOOD); await Promise.all(waits);
check('email failing never fails the application', r.status === 200 && (await rows()).length === 1);
fresh({ notify: null });
r = await apply(GOOD); await Promise.all(waits);
check('...nor does a missing NOTIFY binding', r.status === 200 && (await rows()).length === 1);

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
