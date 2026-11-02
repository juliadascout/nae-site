/* "My courses": what a signed-in person has bought, and only theirs.
   The accounts system is a fake binding that answers /api/auth/me for a
   cookie; the sales are real SQLite rows. Synthetic buyers only. */
import { makeDb, SCHEMA } from './d1-shim.mjs';
import { myCourses } from '../mycourses.js';
import prices from '../prices.json' with { type: 'json' };

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '  [' + d + ']' : ''}`)); };

const PEOPLE = {
  'nae_session=sam': { email: 'Sam@Example.com', emailVerified: true },
  'nae_session=new': { email: 'sam@example.com', emailVerified: false },
  'nae_session=pat': { email: 'pat@example.com', emailVerified: true },
};
const accounts = { async fetch(r) {
  const who = PEOPLE[r.headers.get('Cookie')];
  return who ? new Response(JSON.stringify({ user: who }), { status: 200 })
             : new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401 });
} };

const db = makeDb(SCHEMA);
let n = 0;
async function sale(email, over = {}) {
  n++;
  await db.prepare(`INSERT INTO enrolments (id, created_at, course_id, course_name, with_kit, location_id, total, payer_email,
     stage, stage_since, provider, stripe_session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind('e' + n, `2026-10-${10 + n}T10:00:00Z`, over.course || 'crs-classic-and-hybrid-lash-extensions',
          'Classic & Hybrid Lash Extensions', 1, 'loc-stc', 1356, email, over.stage || 'paid', '2026-10-01',
          over.provider || 'stripe', over.provider === 'paypal' ? null : 'cs_' + n).run();
}
await sale('sam@example.com');
await sale('SAM@example.com', { stage: 'payment pending' });
await sale('sam@example.com', { stage: 'payment failed' });
await sale('sam@example.com', { provider: 'paypal' });
await sale('someone.else@example.com');

const env = { ACCOUNTS: accounts, ENROLMENTS: db };
const ask = async (cookie, e = env) => {
  const res = await myCourses(new Request('https://site.test/api/account/courses', { headers: cookie ? { Cookie: cookie } : {} }), e, prices);
  return { status: res.status, body: await res.json() };
};

let r = await ask(null);
check('signed out: 401', r.status === 401);
r = await ask('nae_session=sam');
check('a confirmed address sees its purchases, whatever the case of the email', r.status === 200 && r.body.courses.length === 2, JSON.stringify(r.body));
check('failed payments are left out', !r.body.courses.some((c) => c.status === 'Payment failed'));
check('the old PayPal sandbox rows are left out', r.body.courses.length === 2);
check('newest first', r.body.courses[0].status === 'Payment processing' && r.body.courses[1].status === 'Paid');
check('the studio is named, not given as an id', r.body.courses[0].studio === 'St. Catharines');
check('the course links to its page', r.body.courses[0].url === '/courses/classic-hybrid-lash-extensions/', r.body.courses[0].url);
check('no buyer details come back', !JSON.stringify(r.body).includes('@'));
r = await ask('nae_session=new');
check('an unconfirmed address sees nothing, and is asked to confirm', r.body.courses.length === 0 && r.body.confirmEmail === true);
r = await ask('nae_session=pat');
check("someone with no purchases sees an empty list, not someone else's", r.body.courses.length === 0);
r = await ask('nae_session=sam', { ENROLMENTS: db });
check('without the accounts binding: 503', r.status === 503);
r = await ask('nae_session=sam', { ACCOUNTS: { fetch: async () => { throw new Error('down'); } }, ENROLMENTS: db });
check('accounts unreachable: 503, not a crash', r.status === 503);

const quiet = console.error; console.error = () => {};
r = await ask('nae_session=sam', { ACCOUNTS: { fetch: async () => new Response('not json', { status: 200 }) }, ENROLMENTS: db });
check('an unreadable answer from accounts: 503, not a crash', r.status === 503);
r = await ask('nae_session=sam', { ACCOUNTS: accounts, ENROLMENTS: { prepare() { throw new Error('D1 is down'); } } });
check('the sales cannot be read: 503 with a message', r.status === 503 && typeof r.body.error === 'string');
console.error = quiet;

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
