/* A stand-in for D1's prepare/bind/first/run/all over real SQLite, so the
   Worker's database code can be exercised without deploying. */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

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

/* The real migrations, in order, so the tests run against the shape the
   database actually has rather than a copy of it that can drift. */
const MIGRATIONS = new URL('../migrations/', import.meta.url);
export const SCHEMA = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(new URL(f, MIGRATIONS), 'utf8'))
  .join('\n');
