/* The $50 welcome code (welcome.js): only a student's own confirmed account,
   one code per email however often it is asked for, on Jules's terms (one
   use, first-time customers, $200 minimum, 90 days). Stripe is a stub. */
import { makeDb, SCHEMA } from './d1-shim.mjs';
import { handleWelcome, WELCOME } from '../welcome.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '  [' + String(d).slice(0, 260) + ']' : ''}`)); };

const calls = [];
let couponExists = false;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? new URLSearchParams(init.body) : null;
  calls.push({ u, method: init.method || 'GET', body });
  if (u.endsWith('/v1/coupons/nae-welcome-50')) {
    return couponExists ? new Response('{"id":"nae-welcome-50"}', { status: 200 })
      : new Response('{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such coupon: \'nae-welcome-50\'"}}', { status: 404 });
  }
  if (u.endsWith('/v1/coupons') && init.method === 'POST') { couponExists = true; return new Response('{"id":"nae-welcome-50"}', { status: 200 }); }
  if (u.endsWith('/v1/promotion_codes') && init.method === 'POST') {
    return new Response(JSON.stringify({ id: 'promo_' + calls.length, code: body.get('code') }), { status: 200 });
  }
  throw new Error('unexpected ' + u);
};

let user = null;
const env = {
  CHECKOUT_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_abc123', STRIPE_WEBHOOK_SECRET: 'whsec_x',
  ENROLMENTS: makeDb(SCHEMA),
  ACCOUNTS: { async fetch() { return user ? new Response(JSON.stringify({ user }), { status: 200 }) : new Response('{}', { status: 401 }); } },
};
const ask = async () => { const r = await handleWelcome(new Request('https://beautycourse.ca/api/account/welcome', { headers: { cookie: 's=1' } }), env); return { status: r.status, j: await r.json() }; };

let r = await ask();
check('not signed in: refused', r.status === 401);
user = { email: 'Sam@Example.ca', role: 'member', emailVerified: false };
r = await ask();
check('email not confirmed: no code yet, and told why', r.j.code === null && /Confirm your email/.test(r.j.reason));
user = { ...user, role: 'staff', emailVerified: true };
r = await ask();
check('staff accounts get no code', r.j.code === null && calls.length === 0);
user = { ...user, role: 'member' };
r = await ask();
check('a confirmed student gets a code', /^WELCOME-[A-Z2-9]{6}$/.test(r.j.code) && r.j.amount === 50 && r.j.minimum === 200, JSON.stringify(r.j));
const promo = calls.find((c) => c.u.endsWith('/v1/promotion_codes')).body;
check('...on the welcome coupon, made once', calls.some((c) => c.u.endsWith('/v1/coupons') && c.method === 'POST' && c.body.get('amount_off') === '5000' && c.body.get('currency') === 'cad' && c.body.get('duration') === 'once'));
check('...one use, first-time customers, $200 minimum', promo.get('promotion[type]') === 'coupon' && promo.get('promotion[coupon]') === WELCOME.coupon
  && promo.get('max_redemptions') === '1' && promo.get('restrictions[first_time_transaction]') === 'true'
  && promo.get('restrictions[minimum_amount]') === '20000' && promo.get('restrictions[minimum_amount_currency]') === 'cad', [...promo].join('&'));
const days = (Number(promo.get('expires_at')) * 1000 - Date.now()) / 864e5;
check('...lasting 90 days', days > 89.9 && days <= 90, days);
const first = r.j.code, n = calls.length;
r = await ask();
check('asking again gives the same code, and makes nothing new', r.j.code === first && calls.length === n);
user = { ...user, email: 'SAM@example.ca' };
r = await ask();
check('...whatever the capitals in the address', r.j.code === first && calls.length === n);
user = { email: 'kim@example.ca', role: 'member', emailVerified: true };
r = await ask();
check('another student gets their own code, on the same coupon', r.j.code && r.j.code !== first && !calls.slice(n).some((c) => c.u.endsWith('/v1/coupons') && c.method === 'POST'));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
