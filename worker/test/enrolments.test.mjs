import { makeDb, SCHEMA } from './d1-shim.mjs';
import { recordEnrolment, enrolmentNotice, tellEnrolment } from '../enrolments.js';

let pass=0, fail=0;
const check=(n,c,d='')=>{ c?(pass++,console.log(`  PASS  ${n}`)):(fail++,console.log(`  FAIL  ${n}${d?'  ['+d+']':''}`)); };

const db = makeDb(SCHEMA);
const env = { ENROLMENTS: db };

const ORDER = {
  id: 'PAYPAL-ORDER-1', status: 'COMPLETED',
  payer: { name: { given_name: 'Sam', surname: 'Rivera' }, email_address: 'sam@example.com' },
};
const PU = {
  reference_id: 'crs-classic-and-hybrid-lash-extensions',
  custom_id: 'crs-classic-and-hybrid-lash-extensions+kit',
  description: 'Classic & Hybrid Lash Extensions with kit',
  amount: { currency_code: 'CAD', value: '1356.00',
            breakdown: { item_total: { value: '1200.00' }, tax_total: { value: '156.00' } } },
};
const CAP = { id: 'CAPTURE-1' };

let status = await recordEnrolment(env, ORDER, PU, CAP, { locationId: 'loc-rch' }, 'Classic & Hybrid Lash Extensions');
check('a new sale says so', status === 'new', status);
let row = await db.prepare('SELECT * FROM enrolments WHERE paypal_order_id = ?').bind('PAYPAL-ORDER-1').first();

check('the sale is recorded', !!row);
check('buyer name kept', row?.payer_name === 'Sam Rivera', row?.payer_name);
check('buyer email kept', row?.payer_email === 'sam@example.com', row?.payer_email);
check('course recorded', row?.course_name === 'Classic & Hybrid Lash Extensions');
check('kit flag from custom_id', row?.with_kit === 1, String(row?.with_kit));
check('totals from PayPal, not the page', row?.total === 1356 && row?.tax === 156 && row?.subtotal === 1200,
      `${row?.subtotal}/${row?.tax}/${row?.total}`);
check('studio recorded', row?.location_id === 'loc-rch', row?.location_id);
check('capture id kept for reconciliation', row?.paypal_capture_id === 'CAPTURE-1');
check('starts in the paid stage', row?.stage === 'paid');
check('stage is timestamped from the start', !!row?.stage_since && !isNaN(Date.parse(row.stage_since)));

// a retried capture must not double-count
status = await recordEnrolment(env, ORDER, PU, CAP, {}, 'Classic & Hybrid Lash Extensions');
check('a repeat says so, so it is not confirmed twice', status === 'repeat', status);
const n = await db.prepare('SELECT COUNT(*) AS n FROM enrolments WHERE paypal_order_id = ?').bind('PAYPAL-ORDER-1').first();
check('a repeated capture does not create a second row', n?.n === 1, String(n?.n));

// no kit
await recordEnrolment(env, { ...ORDER, id: 'PAYPAL-ORDER-2' },
  { ...PU, custom_id: 'crs-x' }, { id: 'CAPTURE-2' }, {}, 'Something');
row = await db.prepare('SELECT * FROM enrolments WHERE paypal_order_id = ?').bind('PAYPAL-ORDER-2').first();
check('no kit means with_kit 0', row?.with_kit === 0, String(row?.with_kit));
check('no studio chosen is null, not empty', row?.location_id === null, JSON.stringify(row?.location_id));

// the payment must survive a broken database
const broken = { ENROLMENTS: { prepare(){ return { bind(){ return { async run(){ throw new Error('db down'); } }; } }; } } };
let threw = false;
try { status = await recordEnrolment(broken, ORDER, PU, CAP, {}, 'x'); } catch (e) { threw = true; }
check('a database failure never reaches the buyer', !threw);
check('...and says it failed', status === 'failed', status);

// and with no binding at all
let threw2 = false;
try { status = await recordEnrolment({}, ORDER, PU, CAP, {}, 'x'); } catch (e) { threw2 = true; }
check('no binding configured is survivable too', !threw2 && status === 'off');

/* PayPal's default, shorter reply to a capture: the purchase unit has no
   amount or custom_id, and the capture carries them. The Worker asks for the
   whole order, but a sale must not lose its total or its kit if it gets this. */
await recordEnrolment(env, { ...ORDER, id: 'PAYPAL-ORDER-3' },
  { reference_id: 'crs-classic-and-hybrid-lash-extensions' },
  { id: 'CAPTURE-3', custom_id: 'crs-classic-and-hybrid-lash-extensions+kit', amount: { currency_code: 'CAD', value: '1356.00' } },
  {}, 'Classic & Hybrid Lash Extensions');
row = await db.prepare('SELECT * FROM enrolments WHERE paypal_order_id = ?').bind('PAYPAL-ORDER-3').first();
check("the short reply's kit flag is read from the capture", row?.with_kit === 1, String(row?.with_kit));
check("the short reply's total is read from the capture", row?.total === 1356 && row?.currency === 'CAD', `${row?.total} ${row?.currency}`);

/* ------------------------------------------------- what the email is told */
const CATALOGUE = {
  currency: 'CAD',
  courses: { 'crs-classic-and-hybrid-lash-extensions': { name: 'Classic & Hybrid Lash Extensions' } },
  studios: { 'loc-rch': { name: 'Sample Studio', address: '10 Sample Rd, Townsville, ON' } },
  seller: { name: 'National Association of Estheticians Inc.', address: '1 Test St, Testville, ON A1A 1A1', phone: '555-010-0199', email: 'office@example.com' },
  refundPolicy: { intro: 'As follows:', items: ['Rule one.', 'Rule two.'] },
};
const FULL_PU = {
  ...PU,
  items: [
    { name: 'Classic & Hybrid Lash Extensions', quantity: '1', category: 'DIGITAL_GOODS', unit_amount: { currency_code: 'CAD', value: '1000.00' } },
    { name: 'Classic & Hybrid Lash Extensions — kit', quantity: '1', category: 'PHYSICAL_GOODS', unit_amount: { currency_code: 'CAD', value: '200.00' } },
  ],
};
const FULL_CAP = { id: 'CAPTURE-1', amount: { currency_code: 'CAD', value: '1356.00' }, create_time: '2026-10-18T15:04:05Z' };
let n1 = enrolmentNotice({ PAYPAL_ENV: 'sandbox' }, ORDER, FULL_PU, FULL_CAP, { locationId: 'loc-rch' }, CATALOGUE, 'HST (13%)');
check('the buyer is who PayPal says paid', n1.name === 'Sam Rivera' && n1.email === 'sam@example.com');
check('the course is named from the catalogue', n1.course === 'Classic & Hybrid Lash Extensions');
check('the kit is in it', n1.withKit === true);
check('the studio they chose, with what the site shows of its address',
  n1.studio?.name === 'Sample Studio' && n1.studio?.address === '10 Sample Rd, Townsville, ON');
check('each line of the order, labelled', JSON.stringify(n1.items) === JSON.stringify([{ label: 'Course fee', value: '1000.00' }, { label: 'Kit', value: '200.00' }]), JSON.stringify(n1.items));
check('subtotal, HST and total are PayPal\'s', n1.subtotal === '1200.00' && n1.tax === '156.00' && n1.total === '1356.00' && n1.taxLabel === 'HST (13%)');
check("PayPal's capture id is the reference", n1.reference === 'CAPTURE-1');
check('the time paid is the capture time', n1.paidAt === '2026-10-18T15:04:05Z');
check('the seller and refund policy come from the catalogue', n1.seller === CATALOGUE.seller && n1.refundPolicy === CATALOGUE.refundPolicy);
check('a sandbox payment is a test', n1.test === true);
check('a live one is not', enrolmentNotice({ PAYPAL_ENV: 'live' }, ORDER, FULL_PU, FULL_CAP, {}, CATALOGUE, 'HST (13%)').test === false);
check('a studio that is not in the catalogue is left out',
  enrolmentNotice({}, ORDER, FULL_PU, FULL_CAP, { locationId: '__proto__' }, CATALOGUE, 'HST (13%)').studio === null);

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
