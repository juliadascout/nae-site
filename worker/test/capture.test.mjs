/* A payment, end to end through the Worker's front door (index.js): PayPal is
   a stub that answers the token and capture calls, D1 is SQLite, and the apps'
   Worker is a fake NOTIFY binding. Checks that the capture asks PayPal for the
   whole order, that the sale is recorded with its totals and kit, and that the
   apps are asked to send the confirmation with what the email needs - once,
   after the answer, and without anything that goes wrong there reaching the
   buyer. Synthetic buyer only. */
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { makeDb, SCHEMA } from './d1-shim.mjs';

/* Wrangler bundles index.js's `import prices from "./prices.json"`; Node
   wants an import attribute for that, so here a JSON file loads as a module. */
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

/* A course that takes a kit and is sold online, and a studio that teaches it. */
const [courseId, course] = Object.entries(prices.courses).find(([, c]) => c.hasKit && c.kitCost > 0 && (c.price < prices.cap || c.capAck));
const studioId = Object.keys(prices.studios).find((id) => prices.studios[id].address);
const fee = course.price.toFixed(2), kit = course.kitCost.toFixed(2);
const sub = (course.price + course.kitCost), tax = Math.round(sub * 13) / 100;

/* ---------------------------------------------------------- PayPal, stubbed */
const calls = [];
const captured = new Set();
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, headers: init.headers || {} });
  if (u.endsWith('/v1/oauth2/token')) {
    return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 });
  }
  const m = u.match(/\/v2\/checkout\/orders\/([^/]+)\/capture$/);
  if (m) {
    if (captured.has(m[1])) return new Response(JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }), { status: 422 });
    captured.add(m[1]);
    const full = (init.headers || {}).Prefer === 'return=representation';
    const capture = { id: 'CAP-' + m[1], status: 'COMPLETED', custom_id: `${courseId}+kit`,
                      amount: { currency_code: 'CAD', value: (sub + tax).toFixed(2) }, create_time: '2026-10-18T15:04:05Z' };
    const unit = full ? {
      reference_id: courseId, custom_id: `${courseId}+kit`, description: `${course.name} with kit`,
      amount: { currency_code: 'CAD', value: (sub + tax).toFixed(2),
                breakdown: { item_total: { currency_code: 'CAD', value: sub.toFixed(2) }, tax_total: { currency_code: 'CAD', value: tax.toFixed(2) } } },
      items: [
        { name: course.name, quantity: '1', category: 'DIGITAL_GOODS', unit_amount: { currency_code: 'CAD', value: fee } },
        { name: `${course.name} — kit`, quantity: '1', category: 'PHYSICAL_GOODS', unit_amount: { currency_code: 'CAD', value: kit } },
      ],
      payments: { captures: [capture] },
    } : { reference_id: courseId, payments: { captures: [capture] } };
    return new Response(JSON.stringify({
      id: m[1], status: 'COMPLETED',
      payer: { name: { given_name: 'Sam', surname: 'Rivera' }, email_address: 'sam@inbox.example.ca' },
      purchase_units: [unit],
    }), { status: 201 });
  }
  throw new Error('unexpected fetch ' + u);
};

const told = [];
let notifyFails = false;
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const env = {
  PAYPAL_ENV: 'sandbox', PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret', CHECKOUT_ENABLED: 'true',
  ENROLMENTS: makeDb(SCHEMA),
  NOTIFY: {
    async enrolment(x) { if (notifyFails) throw new Error('apps down'); told.push(x); return { student: 'sent', admins: 2 }; },
    async enquiry() { return { admins: 2 }; },
  },
  ASSETS: { fetch: () => new Response('asset') },
};
const capture = (orderId) => worker.fetch(new Request('https://site.example/api/checkout/capture', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ orderId, locationId: studioId }),
}), env, ctx);

/* ------------------------------------------------------------- a payment */
let res = await capture('ORDER-0001');
let body = await res.json();
check('the payment is completed for the buyer', res.status === 200 && body.status === 'COMPLETED' && body.captureId === 'CAP-ORDER-0001', JSON.stringify(body));
const cap = calls.find((c) => c.url.endsWith('/ORDER-0001/capture'));
check('the capture asks PayPal for the whole order back', cap?.headers?.Prefer === 'return=representation', JSON.stringify(cap?.headers));
const row = await env.ENROLMENTS.prepare('SELECT * FROM enrolments WHERE paypal_order_id = ?').bind('ORDER-0001').first();
check('the sale is recorded with its totals', row?.subtotal === sub && row?.tax === tax && row?.total === Number((sub + tax).toFixed(2)), `${row?.subtotal}/${row?.tax}/${row?.total}`);
check('...and its kit', row?.with_kit === 1);
await Promise.all(waits);
check('the apps are asked to send the emails, once', told.length === 1);
check('...after the answer, through waitUntil', waits.length === 1);
const n = told[0] || {};
check('...for the buyer PayPal names', n.email === 'sam@inbox.example.ca' && n.name === 'Sam Rivera');
check('...naming the course from the catalogue, with the kit', n.course === course.name && n.withKit === true);
check('...and the studio they chose', n.studio?.name === prices.studios[studioId].name && n.studio?.address === prices.studios[studioId].address);
check('...itemised as charged', JSON.stringify(n.items) === JSON.stringify([{ label: 'Course fee', value: fee }, { label: 'Kit', value: kit }]), JSON.stringify(n.items));
check('...with HST at the rate charged', n.taxLabel === 'HST (13%)' && n.tax === tax.toFixed(2) && n.total === (sub + tax).toFixed(2));
check('...the seller with a mailing address', n.seller?.name === 'National Association of Estheticians Inc.' && !!n.seller?.address && !!n.seller?.phone);
check('...and the refund policy from the About page', n.refundPolicy?.items?.length >= 3 && /refund/i.test(n.refundPolicy.intro + n.refundPolicy.items.join(' ')));
check('...marked as a test while PayPal is in sandbox', n.test === true);

/* ------------------------------------------------- a second capture */
res = await capture('ORDER-0001');
check('capturing the same order again fails at PayPal, as before', res.status === 502);
check('...and nothing more is sent', told.length === 1);

/* ------------------------------------------ the apps cannot be reached */
notifyFails = true;
waits.length = 0;
res = await capture('ORDER-0002');
await Promise.allSettled(waits);
check('if the apps cannot be reached, the buyer still sees the payment completed', res.status === 200 && (await res.json()).status === 'COMPLETED');
check('...and the sale is still recorded', !!(await env.ENROLMENTS.prepare('SELECT id FROM enrolments WHERE paypal_order_id = ?').bind('ORDER-0002').first()));

/* ------------------------------------ the question form, through the door */
res = await worker.fetch(new Request('https://site.example/api/enquiry', {
  method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' },
  body: JSON.stringify({ name: 'Alex Doe', email: 'alex@inbox.example.ca', message: 'Hello?', elapsed: 9000, courseId }),
}), env, ctx);
check('a question reaches its endpoint through the Worker', res.status === 200 && (await res.json()).ok === true);
res = await worker.fetch(new Request('https://site.example/api/enquiry'), env, ctx);
check('...by POST only', res.status === 404);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
