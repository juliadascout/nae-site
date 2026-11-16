/* Staff test purchases (simulate.js): only administrators, never Stripe,
   everything a paid session does, all marked as tests, and removable. */
import { makeDb, SCHEMA } from './d1-shim.mjs';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
registerHooks({
  load(url, context, next) {
    if (url.endsWith('.json')) {
      return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')};`, shortCircuit: true };
    }
    return next(url, context);
  },
});
const { default: worker } = await import('../index.js');
const prices = JSON.parse(readFileSync(new URL('../prices.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '  [' + String(d).slice(0, 300) + ']' : ''}`)); };

let who = null, told = [], stripeCalls = 0, waits = [];
globalThis.fetch = async () => { stripeCalls++; throw new Error('no network in tests'); };
const env = {
  ENROLMENTS: makeDb(SCHEMA),
  ACCOUNTS: { async fetch(req) {
    const p = new URL(req.url).pathname;
    if (p === '/api/auth/me') return who ? new Response(JSON.stringify({ user: who }), { status: 200 }) : new Response('{}', { status: 401 });
    return new Response('{}', { status: 404 });
  } },
  NOTIFY: { async enrolment(x) { told.push(x); return { student: 'sent', admins: 2 }; } },
  ASSETS: { fetch: () => new Response('asset') },
  CHECKOUT_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_live_abc', STRIPE_WEBHOOK_SECRET: 'whsec_x',
};
const ctx = { waitUntil: (p) => waits.push(p) };
const course = Object.entries(prices.courses).find(([, c]) => c.price < prices.cap && c.hasKit);
const [courseId, c] = course;
const call = (body, { type = 'application/json', cookie = 'nae_session=abc' } = {}) =>
  worker.fetch(new Request('https://beautycourse.ca/api/admin/test-purchase', {
    method: 'POST', headers: { 'content-type': type, cookie }, body: JSON.stringify(body) }), env, ctx);
const BODY = { email: 'Jules@JulesHQ.ca', name: 'Jules TEST', courseId, withKit: true, locationId: 'loc-stc' };

who = null;
check('not signed in: refused', (await call(BODY)).status === 401);
who = { email: 'student@example.ca', role: 'member', active: true };
check('a student account: refused', (await call(BODY)).status === 403);
who = { email: 'admin@example.ca', role: 'admin', active: false };
check('an inactive administrator: refused', (await call(BODY)).status === 403);
who = { email: 'admin@example.ca', role: 'admin', active: true };
check('not JSON (a form from another site): refused', (await call(BODY, { type: 'application/x-www-form-urlencoded' })).status === 415);
check('nothing was recorded by any of those', (await env.ENROLMENTS.prepare('SELECT COUNT(*) n FROM enrolments').first()).n === 0);

let res = await call(BODY);
let j = await res.json();
await Promise.all(waits); waits = [];
check('an administrator can make one', res.status === 200 && j.ok && j.sessionId.startsWith('cs_test_SIM'), JSON.stringify(j));
const row = await env.ENROLMENTS.prepare('SELECT * FROM enrolments').first();
check('...recorded as a simulated, paid enrolment for the student', row.provider === 'simulated' && row.stage === 'paid' && row.payer_email === 'jules@juleshq.ca' && row.course_id === courseId && row.with_kit === 1);
check('...priced from the price list, with HST', Math.abs(row.total - Math.round((c.price + c.kitCost) * 113) / 100) < 0.01, row.total);
check('...the confirmation and alert go out as a test', told.length === 1 && told[0].test === true && told[0].email === 'jules@juleshq.ca' && told[0].reference === j.sessionId);
const lead = await env.ENROLMENTS.prepare("SELECT * FROM leads WHERE email = 'jules@juleshq.ca'").first();
check('...the student is an enrolled lead, with a TEST event and no purchase consent',
  lead?.stage === 'enrolled' && (await env.ENROLMENTS.prepare("SELECT detail FROM lead_events WHERE kind='test purchase'").first())?.detail.startsWith('TEST purchase')
  && (await env.ENROLMENTS.prepare('SELECT COUNT(*) n FROM consents').first()).n === 0);
check('...and Stripe was never called', stripeCalls === 0);
check('...it returns the page the student lands on', j.landing === `/courses/${c.slug}/?paid=${j.sessionId}`, j.landing);

const back = await (await worker.fetch(new Request('https://beautycourse.ca/api/checkout/session?id=' + j.sessionId), env, ctx)).json();
check('that page reads it as paid, from our record, flagged as a test', back.paid === true && back.simulated === true && back.total === row.total.toFixed(2) && stripeCalls === 0, JSON.stringify(back));

check('an unknown course is refused', (await call({ ...BODY, courseId: 'crs-nope' })).status === 400);
check('a bad address is refused', (await call({ ...BODY, email: 'nope' })).status === 400);

who = { email: 'student@example.ca', role: 'member', active: true };
check('a student cannot remove them', (await call({ clear: true })).status === 403);
who = { email: 'admin@example.ca', role: 'admin', active: true };
res = await call({ clear: true }); j = await res.json();
check('an administrator removes every test purchase and its TEST events', j.removed === 1
  && (await env.ENROLMENTS.prepare('SELECT COUNT(*) n FROM enrolments').first()).n === 0
  && (await env.ENROLMENTS.prepare("SELECT COUNT(*) n FROM lead_events WHERE kind='test purchase'").first()).n === 0);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
