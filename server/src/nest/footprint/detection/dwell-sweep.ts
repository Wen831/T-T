import { haversineMeters } from './distance-meters';
import type { DetectionPolicy } from './detection-policy';
import type { DetectionPoint, SweepFragment } from './types';

/**
 * Single-pass dwell sweep over time-ordered points (the v2 detector core) —
 * the port of `Visits::Detection::DwellSweep`.
 *
 * Emits EVERY colocated run as a fragment — including runs far below the
 * minimum dwell — because what a short run *means* is decided later:
 * GapBridger may bridge across silence and StayAssembler applies the
 * dwell/point-count filters after merging.
 */

/** A stay may drift with its running mean, but never further than this factor times the
 * stay radius from its first member — a slow walker can't drag the circle into one giant blob. */
const DRIFT_CAP_FACTOR = 1.5;

/** The open, running fragment — the port of the Ruby `open` hash. */
interface OpenFragment {
  pointIds: number[];
  first: DetectionPoint;
  driftRef: DetectionPoint;
  last: DetectionPoint;
  sumLat: number;
  sumLon: number;
  count: number;
  centerLat: number;
  centerLon: number;
}

export class DwellSweep {
  constructor(private readonly policy: DetectionPolicy) {}

  call(points: readonly DetectionPoint[]): SweepFragment[] {
    const fragments: SweepFragment[] = [];
    let open: OpenFragment | null = null;

    for (const point of points) {
      if (open === null) {
        open = openFragment(point);
      } else if (
        point.timestamp - open.last.timestamp > this.policy.sweepGapS ||
        !colocated(open, point, this.policy)
      ) {
        fragments.push(finish(open));
        open = openFragment(point);
      } else {
        addMember(open, point);
      }
    }

    if (open) fragments.push(finish(open));
    return fragments;
  }
}

function colocated(open: OpenFragment, point: DetectionPoint, policy: DetectionPolicy): boolean {
  const d = haversineMeters(open.centerLat, open.centerLon, point.lat, point.lon);
  const dRef = haversineMeters(open.driftRef.lat, open.driftRef.lon, point.lat, point.lon);

  return d <= policy.stayRadiusM && dRef <= policy.stayRadiusM * DRIFT_CAP_FACTOR;
}

function openFragment(point: DetectionPoint): OpenFragment {
  return {
    pointIds: [point.id],
    first: point,
    driftRef: point,
    last: point,
    sumLat: point.lat,
    sumLon: point.lon,
    count: 1,
    centerLat: point.lat,
    centerLon: point.lon,
  };
}

function addMember(open: OpenFragment, point: DetectionPoint): void {
  open.pointIds.push(point.id);
  open.last = point;
  open.sumLat += point.lat;
  open.sumLon += point.lon;
  open.count += 1;
  open.centerLat = open.sumLat / open.count;
  open.centerLon = open.sumLon / open.count;
}

function finish(open: OpenFragment): SweepFragment {
  return {
    pointIds: open.pointIds,
    startTs: open.first.timestamp,
    endTs: open.last.timestamp,
    centerLat: open.centerLat,
    centerLon: open.centerLon,
    count: open.count,
  };
}
