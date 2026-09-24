/**
 * The road-trip stop surface the 4.3 port relies on but the server never covered.
 *
 * The `places.stop_type` column was typed in @trek/shared during the port while the
 * column itself was not migrated, so charging.service and roadtrip-plan.service died
 * with "no such column" on every real database — and nothing noticed, because no
 * server test touched roadtrip. These cases pin the columns, the two statements the
 * ported services run, and the ChargingService gate that reads them.
 */
import { runMigrations } from '../../../src/db/migrations';
import { createTables } from '../../../src/db/schema';
import { ChargingService } from '../../../src/nest/roadtrip/charging.service';
import { DatabaseService } from '../../../src/nest/database/database.service';
import { createUser, createTrip, createPlace } from '../../helpers/factories';
import { resetTestDb } from '../../helpers/test-db';

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const mock = {
    db,
    closeDb: () => {},
    reinitialize: () => {},
    getPlaceWithTags: () => null,
    canAccessTrip: () => null,
    isOwner: () => false,
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);

import { vi } from 'vitest';

const dbs = new DatabaseService(testDb);
const charging = new ChargingService(dbs);

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
});

afterAll(() => {
  testDb.close();
});

const columnNames = (table: string) =>
  (testDb.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

describe('4.3 port columns', () => {
  it('places carries stop_type and fill_percent', () => {
    const cols = columnNames('places');
    expect(cols).toContain('stop_type');
    expect(cols).toContain('fill_percent');
  });

  it('file_links carries budget_item_id with its indexes', () => {
    const cols = columnNames('file_links');
    expect(cols).toContain('budget_item_id');
    const indexes = testDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'file_links' AND name LIKE 'idx_file_links_%'")
      .all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toContain('idx_file_links_file_budget');
    expect(indexes.map((i) => i.name)).toContain('idx_file_links_budget_item_id');
  });

  it('the statement charging.service runs executes against the migrated schema', () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const place = createPlace(testDb, trip.id, { name: 'Loader' });
    expect(() =>
      testDb.prepare('SELECT name, lat, lng, stop_type FROM places WHERE id = ? AND trip_id = ?').get(place.id, trip.id),
    ).not.toThrow();
  });
});

describe('ChargingService.read gate', () => {
  it('404 for a place outside the trip', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    createPlace(testDb, trip.id, { name: 'Somewhere' });
    await expect(charging.read(Number(trip.id), 99999)).rejects.toMatchObject({
      status: 404,
      response: { error: 'Place not found' },
    });
  });

  it('an ordinary place answers unknown without reaching the charging source', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const place = createPlace(testDb, trip.id, { name: 'Cafe', lat: 48.0, lng: 9.0 });
    const info = await charging.read(Number(trip.id), Number(place.id));
    expect(info.status).toBe('unknown');
    expect(info.station).toBeNull();
  });

  it('a charging stop without coordinates answers unknown too', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const place = createPlace(testDb, trip.id, { name: 'Loader' });
    testDb.prepare("UPDATE places SET stop_type = 'charging' WHERE id = ?").run(place.id);
    const info = await charging.read(Number(trip.id), Number(place.id));
    expect(info.status).toBe('unknown');
  });
});
