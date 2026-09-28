/**
 * The Dawarich integration with `source: 'builtin'` — the connection reading
 * TT's own footprint archive instead of a remote instance.
 *
 * The point these tests pin: switching the source changes WHERE visits, tracks
 * and nearby-stay answers come from and NOTHING else. The suggestion chain
 * (sync → review rows → accept), the track contract and the settings card all
 * behave for a builtin row exactly as they do for an external one, and an
 * external row — the default — is untouched by the field's existence.
 */
import { buildApp } from '../../src/bootstrap';
import { runMigrations } from '../../src/db/migrations';
import { createTables } from '../../src/db/schema';
import { FootprintService } from '../../src/nest/footprint/footprint.service';
import { authCookie } from '../helpers/auth';
import { createUser } from '../helpers/factories';
import { resetTestDb, resetRateLimits } from '../helpers/test-db';
import type { INestApplication } from '@nestjs/common';

import type { Application } from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

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
    canAccessTrip: (tripId: unknown, userId: number) =>
      db
        .prepare(
          `SELECT t.id, t.user_id FROM trips t LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ? WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)`,
        )
        .get(userId, tripId, userId),
    isOwner: (tripId: unknown, userId: number) =>
      !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId),
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../src/db/database', () => dbMock);
vi.mock('../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trek-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
  SESSION_DURATION: '24h',
  SESSION_DURATION_MS: 86400000,
  SESSION_DURATION_SECONDS: 86400,
  DEFAULT_LANGUAGE: 'en',
}));
vi.mock('../../src/websocket', () => ({
  broadcast: vi.fn(),
  broadcastToUser: vi.fn(),
  getOnlineUserIds: vi.fn(() => []),
}));

let nestApp: INestApplication;
let app: Application;

// Leipzig, the same fixture ground the detection unit tests use, so the stay
// centers here are the ones those tests already characterized.
const LAT0 = 51.3402;
const LON0 = 12.3712;
const north = (meters: number): number => meters / 111_320.0;
const east = (meters: number): number => meters / (111_320.0 * Math.cos((LAT0 * Math.PI) / 180));

/** Four hours ago, so the recording is inside a sync window that clamps at `now`. */
const BASE_TS = Math.floor(Date.now() / 1000) - 4 * 3600;

interface IngestRecord {
  _type: 'location';
  lat: number;
  lon: number;
  tst: number;
  acc: number;
}

/** café (12 min) → walk → office (25 min, 800 m east) — two stays the detector keeps. */
function recording(): IngestRecord[] {
  const records: IngestRecord[] = [];
  for (let i = 0; i < 12; i++) {
    records.push({ _type: 'location', lat: LAT0 + north((i % 2) * 10), lon: LON0 + east((i % 3) * 5), tst: BASE_TS + i * 60, acc: 10 });
  }
  for (let i = 0; i < 8; i++) {
    records.push({ _type: 'location', lat: LAT0, lon: LON0 + east(150 + i * 60), tst: BASE_TS + 720 + i * 60, acc: 10 });
  }
  for (let i = 0; i < 26; i++) {
    records.push({
      _type: 'location',
      lat: LAT0 + north((i % 2) * 12),
      lon: LON0 + east(800 + (i % 3) * 8),
      tst: BASE_TS + 1380 + i * 60,
      acc: 10,
    });
  }
  return records;
}

const isoOf = (ts: number): string => new Date(ts * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const dateOf = (ts: number): string => new Date(ts * 1000).toISOString().slice(0, 10);

let token = '';
let tripId = 0;

beforeAll(async () => {
  createTables(testDb);
  runMigrations(testDb);
  nestApp = await buildApp();
  app = nestApp.getHttpAdapter().getInstance();
});

beforeEach(() => {
  resetTestDb(testDb);
  resetRateLimits(nestApp);
  // Both addons on: footprint owns the archive being read, dawarich gates the
  // surface reading it. Neither addon is seeded in this harness.
  const enableAddon = testDb.prepare(
    "INSERT OR REPLACE INTO addons (id, name, description, type, icon, enabled, sort_order) VALUES (?, ?, '', 'integration', 'Puzzle', 1, 40)",
  );
  enableAddon.run('dawarich', 'Dawarich');
  enableAddon.run('footprint', 'Footprint');
});

afterAll(async () => {
  await nestApp.close();
  testDb.close();
});

/** A user with both addons on, a recorded afternoon, a trip over it, and source=builtin. */
async function builtinRecorder(): Promise<{ userId: number }> {
  const { user } = createUser(testDb);
  const footprint = nestApp.get(FootprintService);
  token = footprint.mintIngestToken(user.id);

  const ingest = await request(app)
    .post('/api/v1/points/ingest')
    .set('X-Ingest-Token', token)
    .send(recording());
  expect(ingest.status).toBe(200);
  expect(ingest.body.inserted).toBe(46);

  tripId = Number(
    testDb
      .prepare('INSERT INTO trips (user_id, title, start_date, end_date) VALUES (?, ?, ?, ?)')
      .run(user.id, 'Leipzig weekend', dateOf(BASE_TS - 26 * 3600), dateOf(BASE_TS + 26 * 3600)).lastInsertRowid,
  );

  const saved = await request(app)
    .put('/api/integrations/dawarich/settings')
    .set('Cookie', authCookie(user.id))
    .send({ url: '', syncEnabled: true, source: 'builtin' });
  expect(saved.status).toBe(200);

  return { userId: user.id };
}

describe('Dawarich source: builtin', () => {
  it('DASRC-001 — the settings card reports the source, and builtin alone counts as connected', async () => {
    const { userId } = await builtinRecorder();

    const card = await request(app).get('/api/integrations/dawarich/settings').set('Cookie', authCookie(userId));
    expect(card.status).toBe(200);
    expect(card.body.source).toBe('builtin');
    expect(card.body.connected).toBe(true);
    expect(card.body.url).toBe('');
  });

  it('DASRC-002 — the trip track overlay is drawn from the local archive, same contract', async () => {
    const { userId } = await builtinRecorder();

    const track = await request(app)
      .get(`/api/integrations/dawarich/trips/${tripId}/track`)
      .set('Cookie', authCookie(userId));
    expect(track.status).toBe(200);
    expect(track.body.source).toBe('points');
    expect(track.body.truncated).toBe(false);
    expect(track.body.pointCount).toBeGreaterThan(0);
    expect(track.body.days.length).toBeGreaterThanOrEqual(1);
    for (const day of track.body.days) {
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const segment of day.segments) {
        expect(segment.mode).toBeNull();
        expect(segment.points.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('DASRC-003 — a sync turns the detected stays into reviewable suggestions, idempotently', async () => {
    const { userId } = await builtinRecorder();

    const first = await request(app).post('/api/integrations/dawarich/sync').set('Cookie', authCookie(userId));
    expect(first.status).toBe(200);
    expect(first.body.state).toBe('ok');
    expect(first.body.created).toBe(2);

    const list = await request(app).get('/api/integrations/dawarich/suggestions').set('Cookie', authCookie(userId));
    expect(list.status).toBe(200);
    expect(list.body.connected).toBe(true);
    expect(list.body.suggestions).toHaveLength(2);

    // The list is ordered newest-first; pick by duration so the assertions read
    // the same regardless of which stay started later.
    const cafe = (list.body.suggestions as Array<Record<string, unknown>>).find((s) => s.durationMinutes === 11);
    const office = (list.body.suggestions as Array<Record<string, unknown>>).find((s) => s.durationMinutes === 25);
    expect(cafe).toBeDefined();
    expect(office).toBeDefined();
    expect(String(cafe!.sourceVisitId)).toMatch(/^local:/);
    expect(cafe!.startedAt).toBe(isoOf(BASE_TS));
    expect(cafe!.sourceStatus).toBe('suggested');
    expect(cafe!.state).toBe('new');
    expect(cafe!.tripId).toBe(tripId);
    expect(cafe!.confidence).toBeGreaterThanOrEqual(0);
    expect(cafe!.confidence).toBeLessThanOrEqual(100);
    expect(office!.lat).toBeCloseTo(LAT0 + north(6), 3);

    // The second run sees the same stays — the content-addressed id holds, so
    // nothing new appears and nobody's state is disturbed.
    const second = await request(app).post('/api/integrations/dawarich/sync').set('Cookie', authCookie(userId));
    expect(second.body.created).toBe(0);
    const relist = await request(app).get('/api/integrations/dawarich/suggestions').set('Cookie', authCookie(userId));
    expect(relist.body.suggestions).toHaveLength(2);
  });

  it('DASRC-004 — the connection test answers from the archive, not from a probe', async () => {
    const { userId } = await builtinRecorder();

    const status = await request(app)
      .post('/api/integrations/dawarich/test')
      .set('Cookie', authCookie(userId))
      .send({ url: '' });
    expect(status.status).toBe(200);
    expect(status.body.connected).toBe(true);
    expect(status.body.visitCount).toBe(2);
    expect(status.body.capabilities.serverVersion).toBe('tt-builtin');
    expect(status.body.capabilities.visits).toBe(true);
  });

  it('DASRC-005 — the bucket scan and the Atlas read the same archive', async () => {
    const { userId } = await builtinRecorder();

    testDb
      .prepare("INSERT INTO bucket_list (user_id, name, lat, lng) VALUES (?, 'Office', ?, ?)")
      .run(userId, LAT0 + north(6), LON0 + east(808));

    const scan = await request(app).post('/api/integrations/dawarich/bucket-list/scan').set('Cookie', authCookie(userId));
    expect(scan.status).toBe(200);
    expect(scan.body.matches).toHaveLength(1);
    expect(scan.body.matches[0].match).not.toBeNull();
    expect(scan.body.matches[0].match.minutes).toBe(25);
    expect(scan.body.matches[0].match.points).toBe(26);

    const atlas = await request(app)
      .get('/api/integrations/dawarich/atlas/suggestions')
      .set('Cookie', authCookie(userId))
      .query({ from: isoOf(BASE_TS - 3600), to: isoOf(BASE_TS + 3600) });
    expect(atlas.status).toBe(200);
    expect(atlas.body.countries.length).toBeGreaterThanOrEqual(1);
    expect(atlas.body.countries[0].countryCode).toBe('DE');
  });
});

describe('Dawarich-compatible ingest (POST /api/v1/points)', () => {
  it('DASRC-008 — the official app payload lands in the archive, authenticated by ?api_key=', async () => {
    const { user } = createUser(testDb);
    const footprint = nestApp.get(FootprintService);
    const token = footprint.mintIngestToken(user.id);

    // Exactly what the official Dawarich apps post: Overland-style GeoJSON
    // under `locations`, with the fix's metadata in `properties`.
    const res = await request(app)
      .post('/api/v1/points')
      .query({ api_key: token })
      .send({
        locations: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [LON0, LAT0] },
            properties: {
              timestamp: new Date(BASE_TS * 1000).toISOString(),
              battery_level: 0.77,
              horizontal_accuracy: 8,
            },
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(Array.isArray(res.body.data)).toBe(true);

    const stored = testDb
      .prepare('SELECT lat, lon, timestamp, accuracy, battery FROM location_points WHERE user_id = ?')
      .get(user.id) as { lat: number; lon: number; timestamp: number; accuracy: number; battery: number };
    expect(stored.lat).toBeCloseTo(LAT0, 5);
    expect(stored.lon).toBeCloseTo(LON0, 5);
    expect(stored.timestamp).toBe(BASE_TS);
    expect(stored.accuracy).toBe(8);
    expect(stored.battery).toBe(77);
  });

  it('DASRC-009 — a token that is not the caller\'s own is refused, and resends are no-ops', async () => {
    const { user } = createUser(testDb);
    const footprint = nestApp.get(FootprintService);
    const token = footprint.mintIngestToken(user.id);

    const unauthorised = await request(app)
      .post('/api/v1/points')
      .query({ api_key: 'trek_fp_not_a_real_token' })
      .send({ locations: [] });
    expect(unauthorised.status).toBe(401);

    const body = {
      locations: [
        { geometry: { coordinates: [LON0, LAT0] }, properties: { timestamp: BASE_TS } },
      ],
    };
    const first = await request(app).post('/api/v1/points').query({ api_key: token }).send(body);
    const second = await request(app).post('/api/v1/points').query({ api_key: token }).send(body);
    expect(first.body.count).toBe(1);
    // The (user, timestamp, lat, lon) unique index — a tracker re-sending its
    // current fix is a no-op, exactly as upstream dedupes.
    expect(second.body.count).toBe(0);
  });
});

describe('Dawarich source: external stays the default', () => {  it('DASRC-006 — a fresh card reads external and unconnected; saving without source keeps builtin', async () => {
    const { user } = createUser(testDb);

    const fresh = await request(app).get('/api/integrations/dawarich/settings').set('Cookie', authCookie(user.id));
    expect(fresh.body.source).toBe('external');
    expect(fresh.body.connected).toBe(false);

    // An old-form payload that predates the field must not reset a builtin row.
    const { userId } = await builtinRecorder();
    const resent = await request(app)
      .put('/api/integrations/dawarich/settings')
      .set('Cookie', authCookie(userId))
      .send({ url: '', syncEnabled: true });
    expect(resent.status).toBe(200);
    const card = await request(app).get('/api/integrations/dawarich/settings').set('Cookie', authCookie(userId));
    expect(card.body.source).toBe('builtin');
  });

  it('DASRC-007 — an external row keeps its shape and its remote semantics', async () => {
    const { user } = createUser(testDb);

    // A private LAN address saves with a warning — the SSRF guard's documented
    // answer for the common self-hosted case — and never needs the network.
    const saved = await request(app)
      .put('/api/integrations/dawarich/settings')
      .set('Cookie', authCookie(user.id))
      .send({ url: 'https://10.0.0.1:8443', apiKey: 'test-key-123', syncEnabled: false });
    expect(saved.status).toBe(200);
    expect(saved.body.success).toBe(true);

    const card = await request(app).get('/api/integrations/dawarich/settings').set('Cookie', authCookie(user.id));
    expect(card.body.source).toBe('external');
    expect(card.body.connected).toBe(true);
    expect(card.body.syncEnabled).toBe(false);
    expect(card.body.apiKeyMasked).not.toBe('');
  });
});
