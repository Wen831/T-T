import { ConfidenceScorer } from './confidence-scorer';
import { DwellSweep } from './dwell-sweep';
import { GapBridger } from './gap-bridger';
import { StayAssembler } from './stay-assembler';
import type { DetectionPolicy } from './detection-policy';
import type { DetectionPoint, Stay } from './types';

/**
 * The footprint port of the Dawarich detection pipeline
 * (`Visits::Detection::Runner#detect_stays` + `StayScoring`), composed over one
 * window's points — from Freika/dawarich (AGPL-3.0). See ./README.md for the
 * source files and licensing of this port.
 *
 *   DwellSweep → GapBridger → StayAssembler → ConfidenceScorer
 *
 * Two original stages are deliberately absent, and both absences are about the
 * input, not the algorithm: `MovementReconciler` cross-checks fragments
 * against the user's track *segments* (a transport-mode classification Dawarich
 * derives elsewhere), and OwnTracks-style reporting carries no segments to
 * reconcile — so nothing here corroborates and `corroborated` stays false;
 * `PlaceAttributor`/`Persister` are the place-matching and visit-persistence
 * layers, and the footprint stays stay unattributed and unpersisted — they are
 * recomputed on demand from the raw points, the same fetch-per-request
 * philosophy the Dawarich track overlay already runs on.
 *
 * The original batches windows longer than 31 days into calendar months and
 * stitches the batch edges afterwards; that exists to bound the per-transaction
 * persist, which has no equivalent here. One pass over the window's points is
 * the same answer without the seams.
 */

/**
 * The port of `CandidateLoader.MAX_CANDIDATE_POINTS`: a window that carries
 * more evidence than this is skipped for stay detection rather than answered
 * from a truncated sample. Track rendering is not subject to it (see
 * FootprintService).
 */
export const MAX_CANDIDATE_POINTS = 100_000;

export interface DetectStaysResult {
  stays: Stay[];
  /** True when the window was skipped for size — no answer, not an empty answer. */
  skipped: boolean;
}

export function detectStays(
  points: readonly DetectionPoint[],
  policy: DetectionPolicy,
  options: { score?: boolean } = {},
): DetectStaysResult {
  if (points.length === 0) return { stays: [], skipped: false };
  if (points.length > MAX_CANDIDATE_POINTS) return { stays: [], skipped: true };

  const fragments = new DwellSweep(policy).call(points);
  const bridged = new GapBridger(policy).call(fragments);
  const pointsById = indexById(points);
  const stays = new StayAssembler(policy).call(bridged, pointsById);

  if (options.score === false) return { stays, skipped: false };

  for (const stay of stays) {
    const scored = new ConfidenceScorer({
      durationSeconds: stay.durationS,
      pointCount: stay.count,
      accuracies: stay.pointIds.map((id) => pointsById.get(id)?.accuracy ?? null),
      radiusMeters: stay.radius,
      stayRadiusMeters: policy.stayRadiusM,
      minPoints: policy.minPoints,
      // The scoring port of StayScoring: bridged time is less trustworthy than
      // observed time, there is nothing to corroborate with, and no place match.
      bridgedFraction: stay.durationS > 0 ? stay.bridgedS / stay.durationS : 0,
      corroborated: stay.corroborated,
    }).call();
    stay.confidence = scored.score;
    stay.confidenceBreakdown = scored.breakdown;
  }

  return { stays, skipped: false };
}

function indexById(points: readonly DetectionPoint[]): Map<number, DetectionPoint> {
  const byId = new Map<number, DetectionPoint>();
  for (const point of points) byId.set(point.id, point);
  return byId;
}
