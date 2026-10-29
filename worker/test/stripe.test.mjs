/* A payment, end to end through the Worker's front door (index.js): Stripe is
   a stub that answers the session, tax-rate and session-read calls, webhooks
   are signed here with a test secret exactly as Stripe signs them, D1 is
   SQLite, and the apps' Worker is a fake NOTIFY binding. Synthetic buyer only.

   The PayPal integration this replaced recorded and confirmed a $1 order
   made with the public client id as a $1,400 enrolment, and treated a held
   payment as paid. Both are checked here as things that cannot happen. */
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { makeDb, SCHEMA } from './d1-shim.mjs';

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
const check = (n, c, d = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '  [' + String(d).slice(0, 220) + ']' : ''}`)); };

const [courseId, course] = Object.entries(prices.courses).find(([, c]) => c.hasKit && c.kitCost > 0 && (c.price < prices.cap || c.capAck));
const [cappedId] = Object.entries(prices.courses).find(([, c]) => c.price >= prices.cap && !c.capAck);
const studioId = Object.keys(prices.studios).find((id) => prices.studios[id].address);
const sub = course.price + course.kitCost, tax = Math.round(sub * 13) / 100;
const totalCents = Math.round((sub + tax) * 100);

/* ---------------------------------------------------------- Stripe, stubbed */
const calls = [];
let taxRate = { id: 'txr_test_hst', percentage: 13, inclusive: false, active: true, display_name: 'HST' };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, method: init.method, headers: init.headers || {}, body: init.body ? new URLSearchParams(init.body) : null });
  if (u.endsWith('/v1/checkout/sessions') && init.method === 'POST') {
    return new Response(JSON.stringify({ id: 'cs_test_NEW123456789', url: 'https://checkout.stripe.com/c/pay/cs_test_NEW123456789' }), { status: 200 });
  }
  const m = u.match(/\/v1\/checkout\/sessions\/(cs_[^/?]+)$/);
  if (m) return new Response(JSON.stringify(sessionObj({ id: m[1] })), { status: 200 });
  if (u.includes('/v1/tax_rates/')) return new Response(JSON.stringify(taxRate), { status: 200 });
  throw new Error('unexpected fetch ' + u);
};

const SECRET = 'whsec_test_secret';
const told = [];
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const env = {
  CHECKOUT_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_abc123', STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_HST_RATE: 'txr_test_hst',
  ENROLMENTS: makeDb(SCHEMA),
  NOTIFY: { async enrolment(x) { told.push(x); return { student: 'sent', admins: 2 }; }, async enquiry() { return { admins: 2 }; } },
  ASSETS: { fetch: () => new Response('asset') },
};
const req = (path, init = {}) => worker.fetch(new Request('https://beautycourse.ca' + path, init), env, ctx);
const post = (path, body) => req(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function sessionObj(over = {}) {
  return {
    id: 'cs_test_A1234567890', object: 'checkout.session', livemode: false, created: 1793286245,
    status: 'complete', payment_status: 'paid', payment_intent: 'pi_test_A123',
    currency: 'cad', amount_subtotal: sub * 100, amount_total: totalCents, total_details: { amount_tax: Math.round(tax * 100) },
    customer_details: { name: 'Sam Rivera', email: 'sam@inbox.example.ca', phone: '+15550100199' },
    metadata: { course_id: courseId, with_kit: '1', location_id: studioId, items: `Course fee:${course.price.toFixed(2)}|Kit:${course.kitCost.toFixed(2)}` },
    ...over,
  };
}
function signed(event, { secret = SECRET, t = Math.floor(Date.now() / 1000) } = {}) {
  const body = JSON.stringify(event);
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}`, 'content-type': 'application/json' }, body };
}
const hook = (event, opts) => req('/api/stripe/webhook', signed(event, opts));
const rowFor = (id) => env.ENROLMENTS.prepare('SELECT * FROM enrolments WHERE stripe_session_id = ?').bind(id).first();
const settle = async () => { await Promise.all(waits); waits.length = 0; };

/* ------------------------------------------------------------- config */
let res = await req('/api/checkout/config');
let body = await res.json();
check('checkout is open when key, webhook secret and tax rate are all set', body.enabled === true && body.mode === 'test', JSON.stringify(body));
for (const [what, patch] of [
  ['no secret key', { STRIPE_SECRET_KEY: '' }],
  ['the publishable key pasted as the secret', { STRIPE_SECRET_KEY: 'pk_test_abc' }],
  ['a GitHub token pasted as the secret', { STRIPE_SECRET_KEY: 'github_pat_abc' }],
  ['no webhook secret', { STRIPE_WEBHOOK_SECRET: '' }],
  ['no tax rate', { STRIPE_HST_RATE: '' }],
  ['switched off', { CHECKOUT_ENABLED: 'false' }],
]) {
  const saved = { ...env }; Object.assign(env, patch);
  body = await (await req('/api/checkout/config')).json();
  check(`checkout stays shut with ${what}`, body.enabled === false);
  Object.assign(env, saved);
}
env.STRIPE_SECRET_KEY = 'sk_live_abc123';
check('a live key says live', (await (await req('/api/checkout/config')).json()).mode === 'live');
env.STRIPE_SECRET_KEY = 'sk_test_abc123';

/* ------------------------------------------------------------- health */
body = await (await req('/api/checkout/health')).json();
check('health: ready, and says nothing secret', body.ok === true && !JSON.stringify(body).includes('abc123') && !JSON.stringify(body).includes(SECRET), JSON.stringify(body));
taxRate = { ...taxRate, percentage: 5 };
body = await (await req('/api/checkout/health')).json();
check('health catches a tax rate that is not 13%', body.ok === false && /13%/.test(body.reason), JSON.stringify(body));
taxRate = { ...taxRate, percentage: 13 };
env.STRIPE_SECRET_KEY = 'ghp_abcdef';
const before = calls.length;
body = await (await req('/api/checkout/health')).json();
check('a key that is not Stripe\'s is never sent to Stripe', body.ok === false && calls.length === before, JSON.stringify(body));
env.STRIPE_SECRET_KEY = 'sk_test_abc123';

/* ---------------------------------------------------- creating a session */
res = await post('/api/checkout/session', { courseId, withKit: true, locationId: studioId, returnPath: `/courses/${course.slug}/`, amount: 1, total: '1.00' });
body = await res.json();
check('a session is made and the buyer is sent to Stripe', res.status === 200 && /^https:\/\/checkout\.stripe\.com\//.test(body.url), JSON.stringify(body));
const made = calls.filter((c) => c.url.endsWith('/v1/checkout/sessions') && c.method === 'POST').pop();
const p = made.body;
check('priced from the list, not the request (amount fields ignored)',
  p.get('line_items[0][price_data][unit_amount]') === String(course.price * 100) && p.get('line_items[1][price_data][unit_amount]') === String(course.kitCost * 100),
  [...p].join('&'));
check('in Canadian dollars', p.get('line_items[0][price_data][currency]') === 'cad');
check('HST is the fixed rate, on every line (no Stripe Tax)', p.get('line_items[0][tax_rates][0]') === 'txr_test_hst' && p.get('line_items[1][tax_rates][0]') === 'txr_test_hst' && !p.has('automatic_tax[enabled]'));
check('a one-time payment', p.get('mode') === 'payment');
check('the course, kit, studio and lines ride on the session', p.get('metadata[course_id]') === courseId && p.get('metadata[with_kit]') === '1' && p.get('metadata[location_id]') === studioId && /^Course fee:.+\|Kit:/.test(p.get('metadata[items]')));
check('...and the course on the payment, for refunds and disputes', p.get('payment_intent_data[metadata][course_id]') === courseId);
check('the buyer comes back to the course page', p.get('success_url') === `https://beautycourse.ca/courses/${course.slug}/?paid={CHECKOUT_SESSION_ID}` && p.get('cancel_url') === `https://beautycourse.ca/courses/${course.slug}/?checkout=cancelled`, p.get('success_url'));
check('a phone number is asked for', p.get('phone_number_collection[enabled]') === 'true');
check('the secret key is sent as a bearer token', made.headers.Authorization === 'Bearer sk_test_abc123');

await post('/api/checkout/session', { courseId, withKit: false, returnPath: 'https://evil.example/' });
const off = calls.filter((c) => c.url.endsWith('/v1/checkout/sessions') && c.method === 'POST').pop().body;
check('a return address off this site is replaced, not followed', off.get('success_url').startsWith('https://beautycourse.ca/courses/?paid='), off.get('success_url'));
check('no kit, no kit line', !off.has('line_items[1][price_data][unit_amount]') && off.get('metadata[with_kit]') === '0');

res = await post('/api/checkout/session', { courseId: 'crs-nope' });
check('an unknown course is refused', res.status === 400);
res = await post('/api/checkout/session', { courseId: cappedId });
check('a course at the $2,000 cap is refused online', res.status === 400 && /cannot be paid for online/.test((await res.json()).error));
env.CHECKOUT_ENABLED = 'false';
res = await post('/api/checkout/session', { courseId });
check('nothing is made while checkout is shut', res.status === 503);
env.CHECKOUT_ENABLED = 'true';

/* ------------------------------------------------- coming back to the site */
const madeBefore = (await env.ENROLMENTS.prepare('SELECT COUNT(*) AS n FROM enrolments').first()).n;
res = await req('/api/checkout/session?id=cs_test_A1234567890');
body = await res.json();
check('the page can say it is paid, with the total', body.paid === true && body.total === (sub + tax).toFixed(2) && body.currency === 'CAD', JSON.stringify(body));
check('...and what was bought, for the purchase event', body.courseId === courseId && body.withKit === true && body.items.length === 2);
check('coming back records nothing (only the webhook does)', (await env.ENROLMENTS.prepare('SELECT COUNT(*) AS n FROM enrolments').first()).n === madeBefore);
check('a malformed session id is refused before Stripe is asked', (await req('/api/checkout/session?id=../../x')).status === 400);

/* -------------------------------------------------------- the webhook */
res = await req('/api/stripe/webhook', { method: 'POST', body: JSON.stringify({ type: 'checkout.session.completed', data: { object: sessionObj() } }) });
check('an unsigned "paid" is refused', res.status === 400);
res = await hook({ type: 'checkout.session.completed', data: { object: sessionObj() } }, { secret: 'whsec_wrong' });
check('a wrongly signed one is refused', res.status === 400);
res = await hook({ type: 'checkout.session.completed', data: { object: sessionObj() } }, { t: Math.floor(Date.now() / 1000) - 3600 });
check('a replayed old one is refused', res.status === 400);
check('...and none of them recorded or emailed anything', !(await rowFor('cs_test_A1234567890')) && told.length === 0);

res = await hook({ id: 'evt_1', type: 'checkout.session.completed', data: { object: sessionObj() } });
await settle();
let row = await rowFor('cs_test_A1234567890');
check('a signed, paid session is recorded', res.status === 200 && row?.stage === 'paid' && row?.provider === 'stripe', JSON.stringify(row));
check("...with Stripe's totals", row?.total === sub + tax && row?.tax === tax && row?.subtotal === sub, `${row?.subtotal}/${row?.tax}/${row?.total}`);
check('...the kit, the studio, the buyer and the payment intent', row?.with_kit === 1 && row?.location_id === studioId && row?.payer_email === 'sam@inbox.example.ca' && row?.stripe_payment_intent === 'pi_test_A123');
check('the confirmation is sent once', told.length === 1);
const nt = told[0] || {};
check('...naming the course, studio and lines', nt.course === course.name && nt.studio?.name === prices.studios[studioId].name && nt.items?.length === 2 && nt.items[1].label === 'Kit');
check('...with HST and the payment intent as the reference', nt.taxLabel === 'HST (13%)' && nt.tax === tax.toFixed(2) && nt.reference === 'pi_test_A123');
check('...marked as a test in test mode', nt.test === true);
check('...and the seller and refund policy', !!nt.seller?.address && nt.refundPolicy?.items?.length >= 3);

res = await hook({ id: 'evt_1', type: 'checkout.session.completed', data: { object: sessionObj() } });
await settle();
check('a redelivered event confirms nothing twice', res.status === 200 && told.length === 1);

/* A bank debit: complete at checkout, paid days later. */
const pend = sessionObj({ id: 'cs_test_PAD1234567', payment_intent: 'pi_test_PAD', payment_status: 'unpaid' });
await hook({ type: 'checkout.session.completed', data: { object: pend } });
await settle();
row = await rowFor('cs_test_PAD1234567');
check('an unpaid (pending) session is recorded as pending, not paid', row?.stage === 'payment pending', row?.stage);
check('...and nobody is told they are enrolled', told.length === 1);
await hook({ type: 'checkout.session.async_payment_succeeded', data: { object: { ...pend, payment_status: 'paid' } } });
await settle();
row = await rowFor('cs_test_PAD1234567');
check('when it clears it moves to paid', row?.stage === 'paid' && row?.payment_status === 'paid', `${row?.stage} ${row?.payment_status}`);
check('...and is confirmed then, once', told.length === 2);
await hook({ type: 'checkout.session.async_payment_succeeded', data: { object: { ...pend, payment_status: 'paid' } } });
await settle();
check('a repeat of that confirms nothing more', told.length === 2);

const pend2 = sessionObj({ id: 'cs_test_PAD2234567', payment_intent: 'pi_test_PAD2', payment_status: 'unpaid' });
await hook({ type: 'checkout.session.completed', data: { object: pend2 } });
await hook({ type: 'checkout.session.async_payment_failed', data: { object: pend2 } });
await settle();
check('a debit that fails is marked failed, never confirmed', (await rowFor('cs_test_PAD2234567'))?.stage === 'payment failed' && told.length === 2);

/* The completed event missed; the cleared one arrives alone. */
const lone = sessionObj({ id: 'cs_test_LONE234567', payment_intent: 'pi_test_LONE' });
await hook({ type: 'checkout.session.async_payment_succeeded', data: { object: lone } });
await settle();
check('a cleared payment whose first event was missed is still recorded and confirmed', (await rowFor('cs_test_LONE234567'))?.stage === 'paid' && told.length === 3);

/* Refunds and disputes come later, naming only the payment. */
await hook({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_test_A123', refunded: false, amount_refunded: 10000 } } });
check('a partial refund is recorded', (await rowFor('cs_test_A1234567890'))?.stage === 'partly refunded');
await hook({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_test_A123', refunded: true } } });
check('a full refund is recorded', (await rowFor('cs_test_A1234567890'))?.stage === 'refunded');
await hook({ type: 'charge.dispute.created', data: { object: { payment_intent: 'pi_test_PAD', reason: 'fraudulent' } } });
check('a dispute is recorded', (await rowFor('cs_test_PAD1234567'))?.stage === 'disputed');
await hook({ type: 'charge.dispute.closed', data: { object: { payment_intent: 'pi_test_PAD', status: 'won' } } });
check('a dispute won returns the sale to paid', (await rowFor('cs_test_PAD1234567'))?.stage === 'paid');
res = await hook({ type: 'customer.created', data: { object: {} } });
check('an event it does not handle is acknowledged, so Stripe stops retrying', res.status === 200);
check('none of those emailed anybody', told.length === 3);

/* A paid session whose total does not match the price list is recorded
   (the money moved) and logged loudly. */
const logged = [];
const origErr = console.error;
console.error = (...a) => logged.push(a.join(' '));
await hook({ type: 'checkout.session.completed', data: { object: sessionObj({ id: 'cs_test_ODD1234567', payment_intent: 'pi_test_ODD', amount_total: 100 }) } });
await settle();
console.error = origErr;
check('a total that disagrees with the price list is recorded and shouted about',
  (await rowFor('cs_test_ODD1234567'))?.total === 1 && logged.some((l) => /price list says/.test(l)), logged.join(' | '));

/* PayPal is gone from the front door. */
for (const path of ['/api/checkout/order', '/api/checkout/capture']) {
  check(`${path} no longer exists`, (await post(path, {})).status === 404);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
