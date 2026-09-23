/* A stand-in for D1's prepare/bind/first/run/all over real SQLite, so the
   account endpoints can be exercised without deploying. */
import { DatabaseSync } from 'node:sqlite';

export function makeDb(schemaSql) {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaSql);
  return {
    prepare(sql) {
      let bound = [];
      const api = {
        bind(...args) { bound = args.map(v => v === undefined ? null : (typeof v === 'boolean' ? (v?1:0) : v)); return api; },
        async first() { const r = db.prepare(sql).get(...bound); return r === undefined ? null : r; },
        async run() { return db.prepare(sql).run(...bound); },
        async all() { return { results: db.prepare(sql).all(...bound) }; },
      };
      return api;
    },
  };
}

export const SCHEMA = `
CREATE TABLE enrolments (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'checkout',
  course_id TEXT NOT NULL, course_name TEXT NOT NULL, with_kit INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CAD', subtotal REAL, tax REAL, total REAL,
  payer_name TEXT, payer_email TEXT, location_id TEXT,
  paypal_order_id TEXT UNIQUE, paypal_capture_id TEXT, payment_status TEXT,
  stage TEXT NOT NULL DEFAULT 'paid', stage_since TEXT NOT NULL, note TEXT);
`;
