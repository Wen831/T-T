import { haversineMeters } from './distance-meters';
import type { DetectionPolicy } from './detection-policy';
import type { DetectionPoint, Stay, SweepFragment } from './types';

/**
 * The single merge layer of the pipeline — the port of
 * `Visits::Detection::StayAssembler`.
 *
 * Chain-merges same-place fragments within the merge gap (brief re-entries
 * whose excursion the reconciler already vetoed away), then — and only then —
 * applies the minimum dwell / minimum points filters, then finalizes each
 * stay's center and radius from its actual points.
 */

/** A stay's reported radius never shrinks below this, however tight the fixes. */
const MIN_RADIUS_M = 15;
/** Stands in for a fix that reported no accuracy when weighting the center. */
const DEFAULT_ACCURACY_M = 50;

export class StayAssembler {
  constructor(private readonly policy: DetectionPolicy) {}

  /**
   * Finalize before gating: boundary snapping may have dropped fixes from the
   * interval, and the dwell/point floors must judge what actually persists.
   */
  call(fragments: readonly SweepFragment[], pointsById: ReadonlyMap<number, DetectionPoint>): Stay[] {
    return chainMerge(fragments, this.policy)
      .map((fragment) => finalize(fragment, pointsById))
      .filter((stay) => keep(stay, this.policy));
  }
}

function chainMerge(fragments: readonly SweepFragment[], policy: DetectionPolicy): SweepFragment[] {
  const merged: SweepFragment[] = [];

  for (const fragment of fragments) {
    const current: SweepFragment = { ...fragment };
    const previous = merged.length > 0 ? merged[merged.length - 1] : undefined;

    if (previous && mergeable(previous, current, policy)) {
      mergeInto(previous, current);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

function mergeable(previous: SweepFragment, current: SweepFragment, policy: DetectionPolicy): boolean {
  const gap = current.startTs - previous.endTs;
  if (gap > policy.mergeGapS) return false;

  return (
    haversineMeters(previous.centerLat, previous.centerLon, current.centerLat, current.centerLon) <=
    policy.stayRadiusM
  );
}

function mergeInto(previous: SweepFragment, current: SweepFragment): void {
  const a = previous.count;
  const b = current.count;
  const total = a + b;

  previous.centerLat = (previous.centerLat * a + current.centerLat * b) / total;
  previous.centerLon = (previous.centerLon * a + current.centerLon * b) / total;
  previous.pointIds = previous.pointIds.concat(current.pointIds);
  previous.endTs = Math.max(previous.endTs, current.endTs);
  previous.count = total;
  previous.bridgedS = (previous.bridgedS ?? 0) + (current.bridgedS ?? 0);
  previous.corroborated = previous.corroborated || current.corroborated || false;
}

/**
 * Bridged silence counts toward dwell — the whole point of bridging is that
 * the user was there for it.
 */
function keep(stay: Stay, policy: DetectionPolicy): boolean {
  return stay.endTs - stay.startTs >= policy.minDwellS && stay.count >= policy.minPoints;
}

/**
 * Boundary snapping is a statement about time, not about evidence: a
 * fragment's fixes are same-place by construction (DwellSweep clusters;
 * GapBridger and chain_merge only join same-place fragments), and a dark
 * venue's evidence often sits at its snapped-off edges — GPS reacquired on the
 * way out still counts toward the point floor.
 */
function finalize(fragment: SweepFragment, pointsById: ReadonlyMap<number, DetectionPoint>): Stay {
  const points: DetectionPoint[] = [];
  for (const id of fragment.pointIds) {
    const point = pointsById.get(id);
    if (point) points.push(point);
  }
  const [centerLat, centerLon] = weightedCenter(points, fragment);

  return {
    pointIds: fragment.pointIds,
    startTs: fragment.startTs,
    endTs: fragment.endTs,
    durationS: fragment.endTs - fragment.startTs,
    centerLat,
    centerLon,
    radius: radiusMeters(points, centerLat, centerLon),
    count: fragment.count,
    bridgedS: fragment.bridgedS ?? 0,
    corroborated: fragment.corroborated ?? false,
  };
}

function weightedCenter(points: readonly DetectionPoint[], fragment: SweepFragment): [number, number] {
  if (points.length === 0) return [fragment.centerLat, fragment.centerLon];

  let total = 0;
  let latSum = 0;
  let lonSum = 0;

  for (const point of points) {
    const weight = 1 / Math.max(point.accuracy ?? DEFAULT_ACCURACY_M, 1);
    latSum += point.lat * weight;
    lonSum += point.lon * weight;
    total += weight;
  }

  return [latSum / total, lonSum / total];
}

function radiusMeters(points: readonly DetectionPoint[], centerLat: number, centerLon: number): number {
  if (points.length === 0) return MIN_RADIUS_M;

  let max = 0;
  for (const point of points) {
    max = Math.max(max, haversineMeters(centerLat, centerLon, point.lat, point.lon));
  }
  return Math.round(Math.max(max, MIN_RADIUS_M));
}
