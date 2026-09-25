import { decodePolyline, encodePolyline } from '../../../src/nest/transit/transit.helpers';

import { describe, expect, it } from 'vitest';

/**
 * The Google polyline codec, used to MERGE the walk steps a transit backend
 * splits a single walk across. The client has its own decoder for drawing; this
 * pair exists because joining several steps needs the encoder too.
 */
describe('polyline codec', () => {
  it('TRANSIT-POLY-001: round-trips a path at both precisions', () => {
    const path: [number, number][] = [
      [48.8566, 2.3522],
      [48.86, 2.36],
      [48.87, 2.37],
    ];
    for (const precision of [5, 6]) {
      expect(decodePolyline(encodePolyline(path, precision), precision)).toEqual(path);
    }
  });

  it('TRANSIT-POLY-002: decodes the reference example', () => {
    // The encoding Google's own documentation uses, so a wrong sign-shift or a
    // wrong byte offset cannot pass by round-tripping with itself.
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it('TRANSIT-POLY-003: merging two encoded steps equals encoding the joined path', () => {
    // The reason the encoder exists: a walk split across navigation steps is
    // several polylines that have to come back as one leg.
    const first: [number, number][] = [
      [48.8566, 2.3522],
      [48.86, 2.36],
    ];
    const second: [number, number][] = [
      [48.86, 2.36],
      [48.87, 2.37],
    ];
    const joined = [
      ...decodePolyline(encodePolyline(first, 6), 6),
      ...decodePolyline(encodePolyline(second, 6), 6).slice(1),
    ];
    expect(decodePolyline(encodePolyline(joined, 6), 6)).toEqual(joined);
  });

  it('TRANSIT-POLY-004: an empty or truncated string decodes to what it has', () => {
    expect(decodePolyline('', 5)).toEqual([]);
    // A cut-off tail must not throw; it yields the points that survived.
    expect(() => decodePolyline('_p~iF~ps|U_ul', 5)).not.toThrow();
  });
});
