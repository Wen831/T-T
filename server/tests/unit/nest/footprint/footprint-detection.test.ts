import { describe, expect, it } from 'vitest';

import { ConfidenceScorer } from '../../../../src/nest/footprint/detection/confidence-scorer';
import { DetectionPolicy } from '../../../../src/nest/footprint/detection/detection-policy';
import { detectStays } from '../../../../src/nest/footprint/detection/detect-stays';
import { DwellSweep } from '../../../../src/nest/footprint/detection/dwell-sweep';
import { GapBridger } from '../../../../src/nest/footprint/detection/gap-bridger';
import { StayAssembler } from '../../../../src/nest/footprint/detection/stay-assembler';
import type { DetectionPoint, SweepFragment } from '../../../../src/nest/footprint/detection/types';

// The same base the Dawarich specs use, and Leipzig's coordinates so the
// geodesy matches the port's tests of origin. `north`/`east` convert metres to
// degrees locally — the fixtures below are engineered in metres and asserted in
// metres, never eyeballed in degrees.
const BASE_TS = 1_700_000_000;
const LAT0 = 51.3402;
const LON0 = 12.3712;

const north = (meters: number): number => meters / 111_320.0;
const east = (meters: number): number => meters / (111_320.0 * Math.cos((LAT0 * Math.PI) / 180));

function pt(id: number, at: number, dnorth = 0, deast = 0, accuracy = 10): DetectionPoint {
  return { id, lat: LAT0 + north(dnorth), lon: LON0 + east(deast), timestamp: BASE_TS + at, accuracy };
}

const policy = () => new DetectionPolicy(100, 300, 3, 900);
const metersBetween = (aLat: number, aLon: number, bLat: number, bLon: number): number =>
  Math.hypot((bLat - aLat) * 111_320, ((bLon - aLon) * 111_320 * Math.cos((LAT0 * Math.PI) / 180)));

describe('DwellSweep (port of Visits::Detection::DwellSweep)', () => {
  it('groups a tight stationary cluster into one fragment with a mean center', () => {
    const points = Array.from({ length: 6 }, (_, i) => pt(i + 1, i * 60, (i % 2) * 10));

    const fragments = new DwellSweep(policy()).call(points);

    expect(fragments).toHaveLength(1);
    expect(fragments[0]!.pointIds).toEqual([1, 2, 3, 4, 5, 6]);
    expect(fragments[0]!.startTs).toBe(BASE_TS);
    expect(fragments[0]!.endTs).toBe(BASE_TS + 300);
    expect(Math.abs(fragments[0]!.centerLat - LAT0)).toBeLessThan(0.0002);
  });

  it('emits fragments BELOW min dwell and min points — filtering is not its job', () => {
    const fragments = new DwellSweep(policy()).call([pt(1, 0), pt(2, 60)]);

    expect(fragments).toHaveLength(1);
    expect(fragments[0]!.pointIds).toEqual([1, 2]);
    expect(fragments[0]!.endTs - fragments[0]!.startTs).toBeLessThan(policy().minDwellS);
  });

  it('splits when the silence exceeds the sweep gap, even at the same spot', () => {
    const early = [1, 2, 3].map((i) => pt(i, (i - 1) * 60));
    const late = [4, 5, 6].map((i) => pt(i, 3600 + 300 + (i - 4) * 60));

    const fragments = new DwellSweep(policy()).call([...early, ...late]);

    expect(fragments).toHaveLength(2);
    expect(fragments[0]!.pointIds).toEqual([1, 2, 3]);
    expect(fragments[1]!.pointIds).toEqual([4, 5, 6]);
  });

  it('splits when a point leaves the stay radius', () => {
    const stay = [1, 2, 3, 4].map((i) => pt(i, (i - 1) * 60));

    const fragments = new DwellSweep(policy()).call([...stay, pt(5, 240, 0, 400)]);

    expect(fragments).toHaveLength(2);
    expect(fragments[0]!.pointIds).toEqual([1, 2, 3, 4]);
    expect(fragments[1]!.pointIds).toEqual([5]);
  });

  it('caps drift from the first member so a slow drag cannot blob', () => {
    // Each step 60 m east: always within 100 m of the running mean, but the
    // fourth point crosses 150 m (1.5 × radius) from the first member.
    const points = [0, 1, 2, 3, 4].map((i) => pt(i + 1, i * 60, 0, i * 60));

    const fragments = new DwellSweep(policy()).call(points);

    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments[0]!.pointIds.length).toBeLessThan(5);
  });

  it('returns fragments ordered by start time and handles empty input', () => {
    const fragments = new DwellSweep(policy()).call([pt(1, 0), pt(2, 5000, 0, 500)]);
    expect(fragments.map((f) => f.startTs)).toEqual([...fragments.map((f) => f.startTs)].sort((a, b) => a - b));
    expect(new DwellSweep(policy()).call([])).toEqual([]);
  });
});

describe('GapBridger (port of Visits::Detection::GapBridger)', () => {
  const fragment = (ids: number[], startS: number, endS: number, deast = 0): SweepFragment => ({
    pointIds: ids,
    startTs: BASE_TS + startS,
    endTs: BASE_TS + endS,
    centerLat: LAT0,
    centerLon: LON0 + east(deast),
    count: ids.length,
  });

  it('bridges a long same-place silence into one fragment and records the bridged time', () => {
    const result = new GapBridger(policy()).call([
      fragment([1, 2, 3], 0, 1200),
      fragment([4, 5], 1200 + 4 * 3600, 1200 + 4 * 3600 + 600),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.pointIds).toEqual([1, 2, 3, 4, 5]);
    expect(result[0]!.endTs - result[0]!.startTs).toBe(1200 + 4 * 3600 + 600);
    expect(result[0]!.bridgedS).toBe(4 * 3600);
  });

  it('does not count sub-sweep-gap radius blips as bridged silence', () => {
    const result = new GapBridger(policy()).call([fragment([1, 2], 0, 600), fragment([3, 4], 900, 1500)]);

    expect(result).toHaveLength(1);
    expect(result[0]!.bridgedS).toBe(0);
  });

  it('refuses to bridge beyond the cap and leaves the silence a hole', () => {
    const eightDays = 8 * 24 * 3600;
    const result = new GapBridger(policy()).call([
      fragment([1, 2, 3], 0, 1200),
      fragment([4, 5, 6], eightDays, eightDays + 1200),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]!.endTs).toBe(BASE_TS + 1200);
    expect(result[1]!.startTs).toBe(BASE_TS + eightDays);
  });

  it('keeps displaced fragments apart with their boundaries intact', () => {
    const result = new GapBridger(policy()).call([
      fragment([1, 2, 3], 0, 1200),
      fragment([4, 5], 1200 + 79 * 60, 1200 + 79 * 60 + 900, 700),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]!.endTs).toBe(BASE_TS + 1200);
    expect(result[1]!.startTs).toBe(BASE_TS + 1200 + 79 * 60);
  });

  it('chain-bridges through a lone same-place fix inside the silence', () => {
    const result = new GapBridger(policy()).call([
      fragment([1, 2, 3], 0, 1200),
      fragment([4], 1200 + 2 * 3600, 1200 + 2 * 3600),
      fragment([5, 6], 1200 + 4 * 3600, 1200 + 4 * 3600 + 600),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.pointIds).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('breaks the bridge on a mid-silence fix somewhere else', () => {
    const result = new GapBridger(policy()).call([
      fragment([1, 2, 3], 0, 1200),
      fragment([4], 1200 + 2 * 3600, 1200 + 2 * 3600, 900),
      fragment([5, 6], 1200 + 4 * 3600, 1200 + 4 * 3600 + 600),
    ]);

    expect(result).toHaveLength(3);
  });
});

describe('StayAssembler (port of Visits::Detection::StayAssembler)', () => {
  const fragment = (ids: number[], startS: number, endS: number, deast = 0, bridgedS = 0): SweepFragment => ({
    pointIds: ids,
    startTs: BASE_TS + startS,
    endTs: BASE_TS + endS,
    centerLat: LAT0,
    centerLon: LON0 + east(deast),
    count: ids.length,
    bridgedS,
  });

  const assemble = (fragments: SweepFragment[], points: DetectionPoint[]) => {
    const byId = new Map(points.map((p) => [p.id, p]));
    return new StayAssembler(policy()).call(fragments, byId);
  };

  it('merges same-place fragments split by a brief excursion (re-entry)', () => {
    const points = [
      ...Array.from({ length: 6 }, (_, i) => pt(i + 1, (i + 1) * 60)),
      ...Array.from({ length: 6 }, (_, i) => pt(i + 7, 600 + (i + 7) * 60)),
    ];

    const stays = assemble([fragment([1, 2, 3, 4, 5, 6], 60, 360), fragment([7, 8, 9, 10, 11, 12], 1020, 1320)], points);

    expect(stays).toHaveLength(1);
    expect(stays[0]!.pointIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(stays[0]!.startTs).toBe(BASE_TS + 60);
    expect(stays[0]!.endTs).toBe(BASE_TS + 1320);
  });

  it('refuses to merge across more than the merge gap or across distance', () => {
    const points = Array.from({ length: 12 }, (_, i) => pt(i + 1, (i + 1) * 100));

    const farApartTime = [fragment([1, 2, 3], 0, 360), fragment([4, 5, 6], 360 + 901, 2500)];
    const farApartSpace = [fragment([1, 2, 3], 0, 360), fragment([4, 5, 6], 600, 1200, 300)];

    expect(assemble(farApartTime, points)).toHaveLength(2);
    expect(assemble(farApartSpace, points)).toHaveLength(2);
  });

  it('drops fragments below min dwell or min points — and only here', () => {
    const points = Array.from({ length: 5 }, (_, i) => pt(i + 1, (i + 1) * 10));
    const short = fragment([1, 2, 3, 4, 5], 10, 50);
    const sparse = fragment([1, 2], 10, 400);

    expect(assemble([short], points)).toEqual([]);
    expect(assemble([sparse], points)).toEqual([]);
  });

  it('counts bridged silence toward dwell', () => {
    const points = [pt(1, 0), pt(2, 60), pt(3, 1500)];
    const bridged = fragment([1, 2, 3], 0, 1500, 0, 1380);

    const stays = assemble([bridged], points);

    expect(stays).toHaveLength(1);
    expect(stays[0]!.bridgedS).toBe(1380);
  });

  it('holds the duration invariant and recomputes center and radius from points', () => {
    const points = [pt(1, 0), pt(2, 120, 40), pt(3, 400, 80)];
    const stays = assemble([fragment([1, 2, 3], 0, 400)], points);

    expect(stays).toHaveLength(1);
    expect(stays[0]!.durationS).toBe(stays[0]!.endTs - stays[0]!.startTs);
    expect(stays[0]!.centerLat).toBeGreaterThan(LAT0);
    expect(stays[0]!.centerLat).toBeLessThan(LAT0 + north(80));
    expect(stays[0]!.radius).toBeGreaterThanOrEqual(15);
  });
});

describe('ConfidenceScorer (port of Visits::ConfidenceScorer)', () => {
  const score = (overrides: Partial<ConstructorParameters<typeof ConfidenceScorer>[0]> = {}) =>
    new ConfidenceScorer({
      durationSeconds: 1800,
      pointCount: 9,
      accuracies: [10, 12, 8],
      radiusMeters: 20,
      stayRadiusMeters: 100,
      minPoints: 3,
      ...overrides,
    }).call();

  it('returns an integer score within 0..100 and a breakdown', () => {
    const result = score();
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.breakdown.dwell).toBeDefined();
  });

  it('scores a long, tight, accurate, area-matched stay in the high band', () => {
    const result = score({
      durationSeconds: 3600,
      pointCount: 30,
      accuracies: [5, 6, 7],
      radiusMeters: 10,
      placeMatch: 'area',
    });
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it('scores a short, sparse, low-accuracy, place-less stay in the low band', () => {
    const result = score({ durationSeconds: 300, pointCount: 3, accuracies: [120, 150, 100], radiusMeters: 95 });
    expect(result.score).toBeLessThan(40);
  });

  it('marks place_match unavailable and redistributes its weight when absent', () => {
    const result = score();
    expect(result.breakdown.place_match).toBe('unavailable');
  });

  it('scores a mostly-bridged stay below its fully-tracked twin', () => {
    const tracked = score({ bridgedFraction: 0.0 });
    const bridged = score({ bridgedFraction: 0.9 });
    expect(bridged.score).toBeLessThan(tracked.score);
    expect(bridged.breakdown.bridged).toBeDefined();
  });

  it('treats missing accuracies as the default 50 m without error', () => {
    expect(() => score({ accuracies: [null, null] })).not.toThrow();
  });
});

describe('detectStays — the whole pipeline over a recorded afternoon', () => {
  it('finds both stays in a stay → move → stay sequence, with the recorded bounds and centers', () => {
    // A café stay (12:00–12:12, a fix a minute, ±10 m GPS noise), a walk away
    // (eight fixes a minute apart, 60 m steps east — every sweep fragment of it
    // shorter than the dwell floor, so the walk itself is no stay), then the
    // office stay (12:23–12:40, 800 m east of the café). The kind of sequence a
    // phone actually records.
    const cafeStay = Array.from({ length: 12 }, (_, i) => pt(i + 1, i * 60, (i % 2) * 10, (i % 3) * 5));
    const walk = Array.from({ length: 8 }, (_, i) => pt(100 + i, 720 + i * 60, 0, 150 + i * 60));
    const officeStay = Array.from({ length: 18 }, (_, i) =>
      pt(200 + i, 1380 + i * 60, (i % 2) * 12, 800 + (i % 3) * 8),
    );

    const { stays, skipped } = detectStays([...cafeStay, ...walk, ...officeStay], policy());

    expect(skipped).toBe(false);
    expect(stays).toHaveLength(2);

    const cafe = stays[0]!;
    const office = stays[1]!;

    // The café: bounds are the first and last fix it kept, center is its mean.
    expect(cafe.startTs).toBe(BASE_TS);
    expect(cafe.endTs).toBe(BASE_TS + 11 * 60);
    expect(metersBetween(cafe.centerLat, cafe.centerLon, LAT0 + north(5), LON0 + east(5))).toBeLessThan(5);
    expect(cafe.count).toBe(12);
    expect(cafe.radius).toBeGreaterThanOrEqual(15);
    expect(cafe.radius).toBeLessThanOrEqual(100);

    // The office: 800 m east, same shape — and the walk in between never
    // merged into it: the walk's last fix sits 230 m from the office's center.
    expect(office.startTs).toBe(BASE_TS + 1380);
    expect(office.endTs).toBe(BASE_TS + 1380 + 17 * 60);
    expect(metersBetween(office.centerLat, office.centerLon, LAT0 + north(6), LON0 + east(808))).toBeLessThan(10);
    expect(office.count).toBe(18);

    // Both carry a scored confidence from the ported scorer.
    for (const stay of [cafe, office]) {
      expect(stay.confidence).toBeGreaterThanOrEqual(0);
      expect(stay.confidence).toBeLessThanOrEqual(100);
      expect(stay.confidenceBreakdown?.place_match).toBe('unavailable');
    }
  });

  it('bridges a phone-idle-at-home silence into one long stay', () => {
    // Home for an hour of fixes, then the phone sits still (screen off, GPS
    // asleep) for three hours, then fixes again at the same place. One stay.
    const before = Array.from({ length: 6 }, (_, i) => pt(i + 1, i * 60));
    const after = Array.from({ length: 6 }, (_, i) => pt(10 + i, 4 * 3600 + i * 60));

    const { stays } = detectStays([...before, ...after], policy());

    expect(stays).toHaveLength(1);
    expect(stays[0]!.startTs).toBe(BASE_TS);
    expect(stays[0]!.endTs).toBe(BASE_TS + 4 * 3600 + 300);
    expect(stays[0]!.bridgedS).toBe(4 * 3600 - 300);
  });

  it('skips a window past the candidate cap instead of answering from a truncated sample', () => {
    const points = Array.from({ length: 100_001 }, (_, i) => pt(i + 1, i));
    const { stays, skipped } = detectStays(points, policy());
    expect(skipped).toBe(true);
    expect(stays).toEqual([]);
  });
});
