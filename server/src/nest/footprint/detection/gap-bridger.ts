import { haversineMeters } from './distance-meters';
import type { DetectionPolicy } from './detection-policy';
import type { SweepFragment } from './types';

/**
 * Decides what tracking silence MEANS — the port of
 * `Visits::Detection::GapBridger`.
 *
 * A gap whose fragments sit at the same place is evidence of a continuous
 * stay (phone idle indoors, dead battery at home) and is bridged into one
 * fragment. A gap that ends somewhere else is honest ignorance: the fragments
 * stay apart, the silence stays a hole on the timeline — never a fabricated
 * visit.
 */
export class GapBridger {
  constructor(private readonly policy: DetectionPolicy) {}

  call(fragments: readonly SweepFragment[]): SweepFragment[] {
    const merged: SweepFragment[] = [];

    for (const fragment of fragments) {
      const current: SweepFragment = { ...fragment, bridgedS: fragment.bridgedS ?? 0 };
      const previous = merged.length > 0 ? merged[merged.length - 1] : undefined;

      if (previous && bridgeable(previous, current, this.policy)) {
        mergeInto(previous, current, this.policy);
      } else {
        merged.push(current);
      }
    }

    return merged;
  }
}

function gap(previous: SweepFragment, current: SweepFragment): number {
  return current.startTs - previous.endTs;
}

function bridgeable(previous: SweepFragment, current: SweepFragment, policy: DetectionPolicy): boolean {
  return (
    gap(previous, current) <= policy.bridgeCapS &&
    haversineMeters(previous.centerLat, previous.centerLon, current.centerLat, current.centerLon) <=
      policy.stayRadiusM
  );
}

function mergeInto(previous: SweepFragment, current: SweepFragment, policy: DetectionPolicy): void {
  const silence = gap(previous, current);
  const a = previous.count;
  const b = current.count;
  const total = a + b;

  previous.centerLat = (previous.centerLat * a + current.centerLat * b) / total;
  previous.centerLon = (previous.centerLon * a + current.centerLon * b) / total;
  previous.pointIds = previous.pointIds.concat(current.pointIds);
  previous.endTs = current.endTs;
  previous.count = total;
  // Only true silence counts as bridged time — sub-sweep-gap blips are
  // ordinary tracking, not inference.
  if (silence > policy.sweepGapS) previous.bridgedS = (previous.bridgedS ?? 0) + silence;
}
