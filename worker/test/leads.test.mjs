/* The lead record (leads.js): one person per email, forward-only stages,
   the timeline and the consent kept. Synthetic people only. */
import { makeDb, SCHEMA } from './d1-shim.mjs';
import { noteLead, nextStage, addEvent } from '../leads.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '  [' + String(d).slice(0, 200) + ']' : ''}`)); };

/* -------------------------------------------------------- the stage rule */
check('forward moves happen', nextStage('new', 'enrolled') === 'enrolled' && nextStage('contacted', 'booked') === 'booked');
check('backward moves do not', nextStage('enrolled', 'new') === 'enrolled' && nextStage('booked', 'contacted') === 'booked');
check('a lost lead who comes back is live again', nextStage('lost', 'new') === 'new');
check('a first sighting takes the stage given', nextStage(undefined, 'booked') === 'booked');

/* ----------------------------------------------------------- the record */
const env = { ENROLMENTS: makeDb(SCHEMA) };
const lead = (email) => env.ENROLMENTS.prepare('SELECT * FROM leads WHERE email = ?').bind(email).first();
const events = (id) => env.ENROLMENTS.prepare('SELECT kind, detail FROM lead_events WHERE lead_id = ? ORDER BY at, rowid').bind(id).all().then((r) => r.results);

let r = await noteLead(env, { email: ' Sam@Inbox.Example.ca ', name: 'Sam Rivera', phone: '555-010-0100', courseId: 'crs-a', source: 'enquiry', stage: 'new',
  event: { kind: 'enquiry', detail: 'Asked about A' }, consent: 'implied_inquiry' });
check('a new person is created', r?.created === true && r?.stage === 'new');
let L = await lead('sam@inbox.example.ca');
check('...found by their address, lower-cased and trimmed', !!L && L.name === 'Sam Rivera' && L.source === 'enquiry');

r = await noteLead(env, { email: 'sam@inbox.example.ca', name: 'Someone Else', courseId: 'crs-b', source: 'checkout', stage: 'enrolled',
  event: { kind: 'paid', detail: 'Paid for B' }, consent: 'implied_purchase' });
L = await lead('sam@inbox.example.ca');
check('the same person is not created twice', r?.created === false && r?.id === L.id);
check('a payment moves them to enrolled', L.stage === 'enrolled');
check('the name they first gave is kept', L.name === 'Sam Rivera');
check('the course follows what they last did', L.course_id === 'crs-b');
check('where they first came from is kept', L.source === 'enquiry');
const ev = await events(L.id);
check('the timeline has the question, the move and the payment', ev.map((e) => e.kind).join(',') === 'enquiry,stage,paid', JSON.stringify(ev));
check('...the move written plainly', ev[1]?.detail === 'new → enrolled');

r = await noteLead(env, { email: 'sam@inbox.example.ca', source: 'enquiry', stage: 'new', event: { kind: 'enquiry', detail: 'Another question' } });
check('a later question does not undo the enrolment', (await lead('sam@inbox.example.ca')).stage === 'enrolled');

const cons = (await env.ENROLMENTS.prepare('SELECT kind, given_at, expires_at FROM consents WHERE email = ? ORDER BY given_at, rowid').bind('sam@inbox.example.ca').all()).results;
const months = (c) => Math.round((Date.parse(c.expires_at) - Date.parse(c.given_at)) / 86400e3 / 30.44);
check('consent from the question lasts 6 months', cons[0]?.kind === 'implied_inquiry' && months(cons[0]) === 6, JSON.stringify(cons));
check('consent from the purchase lasts 2 years', cons[1]?.kind === 'implied_purchase' && months(cons[1]) === 24, JSON.stringify(cons));
check('no consent is invented for a plain event', cons.length === 2);

/* A lost lead who asks again. */
await noteLead(env, { email: 'kim@inbox.example.ca', source: 'enquiry', stage: 'new' });
await env.ENROLMENTS.prepare("UPDATE leads SET stage = 'lost', lost_reason = 'price' WHERE email = ?").bind('kim@inbox.example.ca').run();
await noteLead(env, { email: 'kim@inbox.example.ca', source: 'enquiry', stage: 'new' });
L = await lead('kim@inbox.example.ca');
check('a lost lead who asks again is new again, reason cleared', L.stage === 'new' && L.lost_reason === null, `${L.stage} ${L.lost_reason}`);

/* Never fails its caller. */
check('no address, no lead', (await noteLead(env, { email: '', source: 'enquiry' })) === null);
const broken = { ENROLMENTS: { prepare() { return { bind() { return { async first() { throw new Error('db down'); }, async run() { throw new Error('db down'); } }; } }; } } };
let threw = false;
try { r = await noteLead(broken, { email: 'x@inbox.example.ca', source: 'enquiry' }); await addEvent(broken, 'id', 'note', 'x'); } catch (e) { threw = true; }
check('a database failure is logged, never thrown', !threw && r === null);
check('no binding at all is survivable', (await noteLead({}, { email: 'x@inbox.example.ca' })) === null);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
