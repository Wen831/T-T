/**
 * Every column the port's SQL names must actually exist once the schema is
 * built. The port shipped `stop_type` / `fill_percent` / `duration_minutes` in
 * its types and in its queries with no migration behind them, so those paths
 * threw at runtime while `tsc` stayed green — nothing checks a string against a
 * column. This is that check, scoped to the tables the port touches.
 */
import { runMigrations } from '../../../src/db/migrations';
import { createTables } from '../../../src/db/schema';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

/** Columns the 4.3 port added or reads, by table. */
const PORTED: Record<string, string[]> = {
  places: ['stop_type', 'fill_percent', 'duration_minutes', 'source', 'amap_id', 'route_geometry'],
  trip_files: ['message_id'],
  budget_settlements: ['settled_at'],
  reservations: ['accommodation_id', 'end_day_id'],
};

describe('schema columns the 4.3 port depends on', () => {
  const db = new Database(':memory:');
  createTables(db);
  runMigrations(db);

  const columnsOf = (table: string): string[] =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name),
  );

  it('SCHEMA-COL-001: every ported table exists', () => {
    for (const table of Object.keys(PORTED)) expect(tables.has(table), table).toBe(true);
  });

  it('SCHEMA-COL-002: the columns the port added are present after migration', () => {
    const missing: string[] = [];
    for (const [table, cols] of Object.entries(PORTED)) {
      const have = new Set(columnsOf(table));
      for (const col of cols) if (!have.has(col)) missing.push(`${table}.${col}`);
    }
    expect(missing).toEqual([]);
  });

  it("SCHEMA-COL-003: AMap stays TT's — the port did not swap in upstream's own", () => {
    const places = columnsOf('places');
    expect(places).toContain('amap_id');
    // Upstream's migration #221 would have added both of these. TT skipped it on
    // purpose: the place key is `amap_id`, and the API key is instance-wide.
    expect(places).not.toContain('amap_poi_id');
  });

  it('SCHEMA-COL-004: the AMap key is instance-wide, not a users column', () => {
    const users = columnsOf('users');
    // `readInstanceApiKey` resolves it from `app_settings`, and the admin panel
    // shows it as an instance value. If a `users.amap_api_key` ever appears,
    // this comment and that resolver have to be reconciled before it is used.
    expect(users).not.toContain('amap_api_key');
    expect(users).toContain('maps_api_key');
  });
});
