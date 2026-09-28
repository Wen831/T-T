import { describe, expect, it } from 'vitest';

import {
  MAX_INGEST_ENTRIES,
  normalizeDawarichRecord,
  normalizeIngestEntry,
} from '../../../../src/nest/footprint/footprint-ingest';
import {
  footprintCompatBodySchema,
  footprintIngestBodySchema,
} from '../../../../src/nest/footprint/footprint-ingest';

const TST = 1_700_000_000;

describe('footprint ingest — OwnTracks HTTP JSON compatibility', () => {
  it('accepts the single-record shape OwnTracks HTTP mode posts', () => {
    const body = footprintIngestBodySchema.parse({
      _type: 'location',
      tid: 'ab',
      lat: 39.9042,
      lon: 116.4074,
      tst: TST,
      acc: 5,
      batt: 85,
      vel: 1.4,
      alt: 43,
    });

    expect(body.records).toHaveLength(1);
    expect(normalizeIngestEntry(body.records[0]!)).toEqual({
      lat: 39.9042,
      lon: 116.4074,
      timestamp: TST,
      accuracy: 5,
      battery: 85,
      altitude: 43,
      velocity: 1.4,
    });
  });

  it('accepts the batch envelope, a bare JSON array, and the points wrapper', () => {
    const batch = footprintIngestBodySchema.parse({
      _type: 'batch',
      data: [
        { _type: 'location', lat: 1, lon: 2, tst: TST, acc: 10 },
        { _type: 'location', lat: 3, lon: 4, tst: TST + 1 },
      ],
    });
    expect(batch.records).toHaveLength(2);

    const array = footprintIngestBodySchema.parse([
      { _type: 'location', lat: 1, lon: 2, tst: TST },
      { _type: 'location', lat: 3, lon: 4, tst: TST + 1 },
      { _type: 'location', lat: 5, lon: 6, tst: TST + 2 },
    ]);
    expect(array.records).toHaveLength(3);

    const wrapped = footprintIngestBodySchema.parse({ points: [{ lat: 1, lon: 2, tst: TST }] });
    expect(wrapped.records).toHaveLength(1);
  });

  it('skips records that are not usable fixes instead of rejecting the batch', () => {
    const { records } = footprintIngestBodySchema.parse([
      { _type: 'location', lat: 1, lon: 2, tst: TST },
      { _type: 'waypoint', lat: 3, lon: 4, tst: TST + 1 },
      { _type: 'location', lat: 'not a number', lon: 4, tst: TST + 2 },
      { _type: 'location', lat: 0, lon: 0, tst: TST + 3 }, // Null Island
      { _type: 'location', lat: 91, lon: 4, tst: TST + 4 }, // off the Earth
      { _type: 'location', lat: 5, lon: 6, tst: 'yesterday' },
      { _type: 'location', lat: 7, lon: 8 }, // no timestamp
    ]);

    const fixes = records.map(normalizeIngestEntry).filter((fix) => fix !== null);
    expect(fixes).toHaveLength(1);
    expect(fixes[0]!.lat).toBe(1);
  });

  it('coerces string numbers and clamps battery into 0..100', () => {
    const fix = normalizeIngestEntry({ lat: '39.9', lon: '116.4', tst: `${TST}`, acc: '12', batt: 142 });
    expect(fix).toEqual({
      lat: 39.9,
      lon: 116.4,
      timestamp: TST,
      accuracy: 12,
      battery: 100,
      altitude: null,
      velocity: null,
    });
  });

  it('keeps its batch bound honest', () => {
    expect(MAX_INGEST_ENTRIES).toBeGreaterThan(0);
  });
});

describe('footprint compat — the Dawarich/Overland wire (POST /api/v1/points)', () => {
  /** The exact shape the official Dawarich apps post: Overland-style GeoJSON. */
  const officialAppBody = {
    locations: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [116.4074, 39.9042] },
        properties: {
          timestamp: '2026-09-01T08:00:00.000Z',
          battery_level: 0.85,
          battery_state: 'on',
          horizontal_accuracy: 12,
          altitude: 43.5,
          speed: 1.4,
          device_id: 'phone-1',
        },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [116.41, 39.91] },
        properties: { timestamp: 1758900000, battery_level: 0.1 },
      },
    ],
  };

  it('parses the official-app locations envelope into records', () => {
    const body = footprintCompatBodySchema.parse(officialAppBody);
    expect(body.records).toHaveLength(2);
  });

  it('maps GeoJSON coordinates and Overland properties onto the archive columns', () => {
    const { records } = footprintCompatBodySchema.parse(officialAppBody);

    const first = normalizeDawarichRecord(records[0]);
    expect(first).toEqual({
      lat: 39.9042,
      lon: 116.4074,
      timestamp: Math.floor(Date.parse('2026-09-01T08:00:00.000Z') / 1000),
      accuracy: 12,
      // Overland's battery_level is a 0..1 fraction — the same *100 the
      // upstream Points::Params applies.
      battery: 85,
      altitude: 43.5,
      velocity: 1.4,
    });

    const second = normalizeDawarichRecord(records[1]);
    expect(second!.timestamp).toBe(1758900000);
    expect(second!.battery).toBe(10);
    expect(second!.accuracy).toBeNull();
  });

  it('accepts the flat dawarich point spelling and a bare array body', () => {
    const body = footprintCompatBodySchema.parse([
      { latitude: 39.9, longitude: 116.4, timestamp: 1758900000, accuracy: 5, battery: 60 },
    ]);
    expect(normalizeDawarichRecord(body.records[0])).toEqual({
      lat: 39.9,
      lon: 116.4,
      timestamp: 1758900000,
      accuracy: 5,
      battery: 60,
      altitude: null,
      velocity: null,
    });
  });

  it('treats battery above 1 as a percentage, not a fraction', () => {
    const fix = normalizeDawarichRecord({
      latitude: 1,
      longitude: 2,
      timestamp: 1758900000,
      battery_level: 88,
    });
    expect(fix!.battery).toBe(88);
  });

  it('skips unusable records instead of rejecting the batch', () => {
    const { records } = footprintCompatBodySchema.parse({
      locations: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { timestamp: 1758900000 } }, // Null Island
        { type: 'Feature', geometry: { type: 'Point', coordinates: [200, 10] }, properties: { timestamp: 1758900000 } }, // off the Earth
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { timestamp: 'nope' } }, // bad time
        { latitude: 1, longitude: 2 }, // no timestamp
        'not even an object',
      ],
    });

    const fixes = records.map(normalizeDawarichRecord).filter((fix) => fix !== null);
    expect(fixes).toHaveLength(0);
  });
});
