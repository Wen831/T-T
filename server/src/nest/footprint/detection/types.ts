/**
 * Shared shapes for the footprint stay-detection pipeline.
 *
 * The pipeline is a port of Dawarich's visit detector —
 * `app/services/visits/detection/{dwell_sweep,gap_bridger,stay_assembler,policy}.rb`
 * plus `app/services/visits/confidence_scorer.rb` on Freika/dawarich. The Ruby
 * `Pt` struct becomes `DetectionPoint`, the mutable fragment hashes become
 * `SweepFragment`, and the finalized stay hash becomes `Stay`. Field names keep
 * the snake_case of the source where they are pure data (bridged_s) so reading
 * the port next to the original stays mechanical.
 */

/**
 * One candidate GPS fix — the port of `Visits::Detection::CandidateLoader::Pt`.
 * `timestamp` is unix seconds UTC, `accuracy` is metres (null when the source
 * did not report one).
 */
export interface DetectionPoint {
  readonly id: number;
  readonly lat: number;
  readonly lon: number;
  readonly timestamp: number;
  readonly accuracy: number | null;
}

/**
 * A colocated run of points, as DwellSweep emits it and GapBridger /
 * StayAssembler consume and enrich. `bridgedS` is added by GapBridger;
 * `corroborated` is movement-reconciler input the original carries through —
 * the footprint port has no segment source to corroborate with, so it stays
 * false, but the field survives merges exactly as the original merges it.
 */
export interface SweepFragment {
  pointIds: number[];
  startTs: number;
  endTs: number;
  centerLat: number;
  centerLon: number;
  count: number;
  bridgedS?: number;
  corroborated?: boolean;
}

/** What the ConfidenceScorer returns, mirroring its Ruby `{ score:, breakdown: }`. */
export interface ConfidenceBreakdown {
  dwell: number;
  tightness: number;
  density: number;
  accuracy: number;
  /** A number when a place match was supplied, `'unavailable'` when not. */
  place_match?: number | 'unavailable';
  bridged?: number;
  corroboration?: number;
}

export interface ConfidenceResult {
  /** Integer 0..100. */
  score: number;
  breakdown: ConfidenceBreakdown;
}

/**
 * A stay the pipeline is confident in: one stay's finalized evidence, after
 * bridging, chain-merging and the dwell/point floors. This is the port of the
 * hash StayAssembler's `finalize` produces (plus the optional confidence pair
 * the original's StayScoring adds afterwards).
 */
export interface Stay {
  pointIds: number[];
  /** Unix seconds UTC. */
  startTs: number;
  endTs: number;
  /** `endTs - startTs` — bridged silence included, exactly as the original counts it. */
  durationS: number;
  centerLat: number;
  centerLon: number;
  /** Max point-to-center distance, floored at StayAssembler's MIN_RADIUS_M. */
  radius: number;
  count: number;
  bridgedS: number;
  corroborated: boolean;
  /** Present when the pipeline was asked to score (it is by default). */
  confidence?: number;
  confidenceBreakdown?: ConfidenceBreakdown;
}
