/* Black Friday workshops (blackfriday.js, stripe.js, booking.js) through the
   Worker's front door: the price comes from the offer list and never from
   the request, no promotion code can be added, nothing can be bought after
   the sale, a paid workshop books the student into it, and the page goes
   away by itself. Stripe is a stub; the buyer is synthetic. */
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
const { offerQuote, saleOpen, whenText } = await import('../blackfriday.js');
const prices = JSON.parse(readFileSync(new URL('../prices.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '  [' + String(d).slice(0, 260) + ']' : ''}`)); };

const bf = prices.blackFriday;
const offer = bf.offers.find((o) => o.id === 'bf-sugaring');
const course = prices.courses[offer.courseId];

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, method: init.method, body: init.body ? new URLSearchParams(init.body) : null });
  if (u.endsWith('/v1/checkout/sessions') && init.method === 'POST') {
    return new Response(JSON.stringify({ id: 'cs_test_BF123456789', url: 'https://checkout.stripe.com/c/pay/cs_test_BF123456789' }), { status: 200 });
  }
  if (u.includes('/v1/tax_rates/')) return new Response(JSON.stringify({ id: 'txr_test_hst', percentage: 13, inclusive: false, active: true }), { status: 200 });
  throw new Error('unexpected fetch ' + u);
};

const SECRET = 'whsec_test_secret';
const told = [];
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const env = {
  CHECKOUT_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_abc123', STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_HST_RATE: 'txr_test_hst',
  ENROLMENTS: makeDb(SCHEMA),
  NOTIFY: { async enrolment(x) { told.push(x); return { student: 'sent', admins: 2 }; } },
  ASSETS: { fetch: () => new Response('asset') },
};
const req = (path, init = {}) => worker.fetch(new Request('https://beautycourse.ca' + path, init), env, ctx);
const post = (path, body) => req(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const lastSession = () => calls.filter((c) => c.url.endsWith('/v1/checkout/sessions') && c.method === 'POST').pop().body;

/* ------------------------------------------------------------- the offers */
check('every offer is a real course, at both studios', bf.offers.length === 5
  && bf.offers.every((o) => prices.courses[o.courseId] && o.locations.join() === 'loc-rch,loc-stc'));
check('the sale is open now and closes after December 2 (Toronto)', saleOpen(prices) && bf.ends === '2026-12-03T05:00:00Z'
  && saleOpen(prices, Date.parse('2026-12-02T23:59:00-05:00')) && !saleOpen(prices, Date.parse('2026-12-03T00:00:00-05:00')));
check('the workshop reads as it will be held', whenText(offer) === 'Tuesday, December 8, 10:00 am to 2:00 pm', whenText(offer));
let q = offerQuote(prices, 'bf-sugaring', 'loc-stc', false);
check('an offer is priced from the list, HST on top', q.items.length === 1 && q.items[0].unit_amount.value === '350.00'
  && q.amount.value === (350 * 1.13).toFixed(2), JSON.stringify(q.amount));
check('...a different studio is refused', offerQuote(prices, 'bf-sugaring', 'loc-nf', false).error === 'Choose Richmond Hill or St. Catharines');
check('...an unknown offer is refused', offerQuote(prices, 'bf-nope', 'loc-stc', false).error === 'Unknown offer');
check('...no kit with the microdermabrasion workshop (the full course\'s kit)', offerQuote(prices, 'bf-microderm', 'loc-stc', true).items.length === 1);
check('...and the kit stays at its regular price', offerQuote(prices, 'bf-sugaring', 'loc-stc', true).items[1]?.unit_amount.value === course.kitCost.toFixed(2));

/* ------------------------------------------------------------- checkout */
let res = await post('/api/checkout/session', { offer: 'bf-sugaring', locationId: 'loc-rch', withKit: false, courseId: 'crs-threading', amount: 1 });
let body = await res.json();
check('a workshop goes to Stripe', res.status === 200 && /checkout\.stripe\.com/.test(body.url), JSON.stringify(body));
let p = lastSession();
check('...at the offer price, whatever the request says', p.get('line_items[0][price_data][unit_amount]') === '35000' && p.get('metadata[course_id]') === offer.courseId);
check('...with no promotion code box (BF20 is not for workshops)', p.get('allow_promotion_codes') === 'false', p.get('allow_promotion_codes'));
check('...the offer and studio ride on the session', p.get('metadata[offer]') === 'bf-sugaring' && p.get('metadata[location_id]') === 'loc-rch' && p.get('payment_intent_data[metadata][offer]') === 'bf-sugaring');
check('...and the buyer comes back to the Black Friday page', p.get('success_url') === 'https://beautycourse.ca/black-friday/?paid={CHECKOUT_SESSION_ID}');
res = await post('/api/checkout/session', { courseId: offer.courseId, withKit: false, returnPath: '/courses/x/' });
check('a regular course still takes promotion codes', lastSession().get('allow_promotion_codes') === 'true' && lastSession().get('line_items[0][price_data][unit_amount]') === String(course.price * 100));
const realNow = Date.now;
Date.now = () => Date.parse('2026-12-03T06:00:00Z');
res = await post('/api/checkout/session', { offer: 'bf-sugaring', locationId: 'loc-rch' });
body = await res.json();
check('after the sale, a workshop cannot be bought', res.status === 410 && /ended/.test(body.error), JSON.stringify(body));
res = await req('/black-friday/');
check('...and the page sends people to the courses', res.status === 302 && res.headers.get('location') === 'https://beautycourse.ca/courses/');
res = await req('/black-friday/?paid=cs_test_X');
check('...except someone coming back from paying', res.status === 200);
Date.now = realNow;
check('during the sale the page is served', (await (await req('/black-friday/')).text()) === 'asset');

/* ------------------------------------------------------------- paid */
const total = Math.round(350 * 1.13 * 100);
const session = {
  id: 'cs_test_BFPAID12345', object: 'checkout.session', livemode: false, created: Math.floor(Date.now() / 1000),
  status: 'complete', payment_status: 'paid', payment_intent: 'pi_test_BF1',
  currency: 'cad', amount_subtotal: 35000, amount_total: total, total_details: { amount_tax: total - 35000 },
  customer_details: { name: 'Riley Test', email: 'Riley@Inbox.Example.ca' },
  metadata: { course_id: offer.courseId, with_kit: '0', location_id: 'loc-stc', items: 'Course fee:350.00', offer: 'bf-sugaring' },
};
function signed(event) {
  const b = JSON.stringify(event), t = Math.floor(Date.now() / 1000);
  return { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${b}`).digest('hex')}`, 'content-type': 'application/json' }, body: b };
}
const logs = []; const keep = console.error; console.error = (...a) => logs.push(a.join(' '));
res = await req('/api/stripe/webhook', signed({ id: 'evt_bf', type: 'checkout.session.completed', data: { object: session } }));
await Promise.all(waits);
console.error = keep;
check('the webhook takes a paid workshop', res.status === 200);
const row = await env.ENROLMENTS.prepare('SELECT * FROM enrolments WHERE stripe_session_id = ?').bind(session.id).first();
check('...recorded as the workshop, not the full course', row?.course_name === 'Basic Body Sugaring (Black Friday workshop)' && row?.stage === 'paid', JSON.stringify(row));
const seat = await env.ENROLMENTS.prepare('SELECT * FROM class_bookings WHERE student_email = ?').bind('riley@inbox.example.ca').first();
check('...the student is booked into the dated session', seat?.starts_at === '2026-12-08T10:00' && seat?.ends_at === '2026-12-08T14:00'
  && seat?.location_id === 'loc-stc' && seat?.status === 'booked' && seat?.instructor_id === null, JSON.stringify(seat));
check('...in a room that can hold it', !!seat?.room, seat?.room);
check('...the confirmation names the workshop and when it is', told[0]?.course === 'Basic Body Sugaring (Black Friday workshop)'
  && told[0]?.workshop === 'Tuesday, December 8, 10:00 am to 2:00 pm, St. Catharines', JSON.stringify(told[0]));
check('...and no false price alarm', !logs.some((l) => /price list says/.test(l)), logs.join(' | '));
await req('/api/stripe/webhook', signed({ id: 'evt_bf2', type: 'checkout.session.completed', data: { object: session } }));
await Promise.all(waits);
const seats = await env.ENROLMENTS.prepare('SELECT COUNT(*) AS n FROM class_bookings').first();
check('a repeated event books nobody twice', seats.n === 1 && told.length === 1, JSON.stringify(seats));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
