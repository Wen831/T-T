import { describe, expect, it } from 'vitest';

import {
  MAX_INGEST_ENTRIES,
  normalizeIngestEntry,
} from '../../../../src/nest/footprint/footprint-ingest';
import { footprintIngestBodySchema } from '../../../../src/nest/footprint/footprint-ingest';

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
