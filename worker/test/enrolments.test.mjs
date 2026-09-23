import { makeDb, SCHEMA } from './d1-shim.mjs';
import { recordEnrolment } from '../enrolments.js';

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

await recordEnrolment(env, ORDER, PU, CAP, { locationId: 'loc-rch' }, 'Classic & Hybrid Lash Extensions');
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
await recordEnrolment(env, ORDER, PU, CAP, {}, 'Classic & Hybrid Lash Extensions');
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
try { await recordEnrolment(broken, ORDER, PU, CAP, {}, 'x'); } catch (e) { threw = true; }
check('a database failure never reaches the buyer', !threw);

// and with no binding at all
let threw2 = false;
try { await recordEnrolment({}, ORDER, PU, CAP, {}, 'x'); } catch (e) { threw2 = true; }
check('no binding configured is survivable too', !threw2);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
