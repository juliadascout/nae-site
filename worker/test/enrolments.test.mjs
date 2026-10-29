import { makeDb, SCHEMA } from './d1-shim.mjs';
import { recordEnrolment, setStage, enrolmentNotice, tellEnrolment } from '../enrolments.js';

let pass=0, fail=0;
const check=(n,c,d='')=>{ c?(pass++,console.log(`  PASS  ${n}`)):(fail++,console.log(`  FAIL  ${n}${d?'  ['+d+']':''}`)); };

const db = makeDb(SCHEMA);
const env = { ENROLMENTS: db };

/* A sale as stripe.js hands it over. Synthetic buyer only. */
const SALE = {
  provider: 'stripe', sessionId: 'cs_test_1', paymentIntent: 'pi_test_1',
  courseId: 'crs-classic-and-hybrid-lash-extensions', courseName: 'Classic & Hybrid Lash Extensions',
  withKit: true, locationId: 'loc-rch', currency: 'CAD',
  subtotal: 1200, tax: 156, total: 1356,
  payerName: 'Sam Rivera', payerEmail: 'sam@example.com',
  paymentStatus: 'paid', stage: 'paid',
  items: [{ label: 'Course fee', value: '1000.00' }, { label: 'Kit', value: '200.00' }],
  paidAt: '2026-10-29T15:04:05.000Z', livemode: false,
};

let status = await recordEnrolment(env, SALE);
check('a new sale says so', status === 'new', status);
let row = await db.prepare('SELECT * FROM enrolments WHERE stripe_session_id = ?').bind('cs_test_1').first();
check('the sale is recorded', !!row);
check('...as a Stripe sale', row?.provider === 'stripe');
check('buyer name and email kept', row?.payer_name === 'Sam Rivera' && row?.payer_email === 'sam@example.com');
check('course and kit recorded', row?.course_name === 'Classic & Hybrid Lash Extensions' && row?.with_kit === 1);
check("totals are Stripe's", row?.total === 1356 && row?.tax === 156 && row?.subtotal === 1200, `${row?.subtotal}/${row?.tax}/${row?.total}`);
check('studio recorded', row?.location_id === 'loc-rch');
check('the payment intent is kept, for refunds and disputes', row?.stripe_payment_intent === 'pi_test_1');
check('starts in the stage it was given', row?.stage === 'paid');
check('stage is timestamped from the start', !!row?.stage_since && !isNaN(Date.parse(row.stage_since)));
check('no PayPal id on a Stripe row', row?.paypal_order_id === null);

status = await recordEnrolment(env, SALE);
check('a redelivered sale says repeat, so it is not confirmed twice', status === 'repeat', status);
const n = await db.prepare('SELECT COUNT(*) AS n FROM enrolments WHERE stripe_session_id = ?').bind('cs_test_1').first();
check('...and makes no second row', n?.n === 1, String(n?.n));

await recordEnrolment(env, { ...SALE, sessionId: 'cs_test_2', paymentIntent: 'pi_test_2', withKit: false, locationId: '' });
row = await db.prepare('SELECT * FROM enrolments WHERE stripe_session_id = ?').bind('cs_test_2').first();
check('no kit means with_kit 0', row?.with_kit === 0);
check('no studio chosen is null, not empty', row?.location_id === null, JSON.stringify(row?.location_id));

/* Two Stripe rows and two PayPal-era rows share the unique columns' NULLs. */
await db.prepare("INSERT INTO enrolments (id, created_at, course_id, course_name, paypal_order_id, stage, stage_since) VALUES ('old1','x','c','c','PP-1','paid','x')").bind().run();
await db.prepare("INSERT INTO enrolments (id, created_at, course_id, course_name, paypal_order_id, stage, stage_since) VALUES ('old2','x','c','c','PP-2','paid','x')").bind().run();
row = await db.prepare("SELECT provider FROM enrolments WHERE id = 'old1'").first();
check('rows from before the switch read as PayPal', row?.provider === 'paypal');

/* ------------------------------------------------------------- stages */
let moved = await setStage(env, { paymentIntent: 'pi_test_1' }, 'refunded', null);
row = await db.prepare('SELECT stage, payment_status FROM enrolments WHERE stripe_session_id = ?').bind('cs_test_1').first();
check('a refund moves the sale, found by its payment', moved === 1 && row?.stage === 'refunded', `${moved} ${row?.stage}`);
check('...and keeps the payment status it had', row?.payment_status === 'paid');
moved = await setStage(env, { paymentIntent: 'pi_test_1' }, 'refunded', null);
check('moving to the stage it is already in moves nothing', moved === 0);
moved = await setStage(env, { sessionId: 'cs_test_2' }, 'paid', 'paid');
check('a sale already paid is not "moved" to paid again (no second email)', moved === 0);
moved = await setStage(env, { paymentIntent: 'pi_unknown' }, 'disputed', null);
check('a payment this site never recorded moves nothing', moved === 0);
check('no key at all moves nothing', (await setStage(env, {}, 'paid')) === 0);

/* the payment must survive a broken database */
const broken = { ENROLMENTS: { prepare(){ return { bind(){ return { async run(){ throw new Error('db down'); } }; } }; } } };
let threw = false;
try { status = await recordEnrolment(broken, SALE); moved = await setStage(broken, { sessionId: 'x' }, 'paid'); } catch (e) { threw = true; }
check('a database failure never reaches the caller', !threw);
check('...and says it failed', status === 'failed' && moved === 0, `${status} ${moved}`);
let threw2 = false;
try { status = await recordEnrolment({}, SALE); } catch (e) { threw2 = true; }
check('no binding configured is survivable too', !threw2 && status === 'off');

/* ------------------------------------------------- what the email is told */
const CATALOGUE = {
  currency: 'CAD',
  courses: { 'crs-classic-and-hybrid-lash-extensions': { name: 'Classic & Hybrid Lash Extensions' } },
  studios: { 'loc-rch': { name: 'Sample Studio', address: '10 Sample Rd, Townsville, ON' } },
  seller: { name: 'National Association of Estheticians Inc.', address: '1 Test St, Testville, ON A1A 1A1', phone: '555-010-0199', email: 'office@example.com' },
  refundPolicy: { intro: 'As follows:', items: ['Rule one.', 'Rule two.'] },
};
const n1 = enrolmentNotice(SALE, CATALOGUE, 'HST (13%)');
check('the buyer is who Stripe says paid', n1.name === 'Sam Rivera' && n1.email === 'sam@example.com');
check('the course is named from the catalogue', n1.course === 'Classic & Hybrid Lash Extensions');
check('the kit is in it', n1.withKit === true);
check('the studio they chose, with its address', n1.studio?.name === 'Sample Studio' && n1.studio?.address === '10 Sample Rd, Townsville, ON');
check('each line of the order, labelled', JSON.stringify(n1.items) === JSON.stringify(SALE.items), JSON.stringify(n1.items));
check("subtotal, HST and total are Stripe's, as money", n1.subtotal === '1200.00' && n1.tax === '156.00' && n1.total === '1356.00' && n1.taxLabel === 'HST (13%)');
check('the payment intent is the reference', n1.reference === 'pi_test_1');
check('the time paid is carried', n1.paidAt === '2026-10-29T15:04:05.000Z');
check('the seller and refund policy come from the catalogue', n1.seller === CATALOGUE.seller && n1.refundPolicy === CATALOGUE.refundPolicy);
check('a test-mode payment is a test', n1.test === true);
check('a live one is not', enrolmentNotice({ ...SALE, livemode: true }, CATALOGUE, 'x').test === false);
check('a studio that is not in the catalogue is left out', enrolmentNotice({ ...SALE, locationId: '__proto__' }, CATALOGUE, 'x').studio === null);

/* --------------------------------------------------- handing it over */
const told = [];
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
await tellEnrolment({ NOTIFY: { async enrolment(x) { told.push(x); return { student: 'sent', admins: 2 }; } } }, ctx, n1);
check('it is handed to the apps once', told.length === 1 && told[0] === n1);
check('...after the answer, through waitUntil', waits.length === 1);
let threw3 = false;
try {
  await tellEnrolment({ NOTIFY: { async enrolment() { throw new Error('apps down'); } } }, null, n1);
  await tellEnrolment({}, null, n1);
} catch (e) { threw3 = true; }
check('if the apps cannot be reached, or are not bound, nothing reaches the buyer', !threw3);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
