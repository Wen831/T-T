/**
 * The single source of every stay-detection threshold — the port of
 * `Visits::Detection::Policy` (app/services/visits/detection/policy.rb) in
 * Freika/dawarich (AGPL-3.0). See ./README.md for the source files and
 * licensing of this port.
 *
 * The pipeline internals are constants here and nowhere else; the four
 * user-tunable values are the constructor arguments, which FootprintService
 * fills from the footprint addon's config JSON (the footprint port of reading
 * `user.safe_settings`). Defaults follow the task pinning: radius 100 m,
 * dwell 600 s, 3 points — and `merge_gap_s` copies Dawarich's
 * `merge_threshold_minutes` default of 15 minutes. Dawarich itself currently
 * defaults `visit_min_duration_minutes` to 5; this port pins 600 s as its
 * shipped default, per the footprint spec.
 */
export class DetectionPolicy {
  /** The sweep closes an open stay after this silence; GapBridger decides what the silence *means*. */
  static readonly SWEEP_GAP_S = 60 * 60;
  /** Longest same-place silence still bridged into one continuous stay (7 days). */
  static readonly BRIDGE_CAP_S = 7 * 24 * 60 * 60;
  /** How far a stay boundary may snap to an adjacent moving segment's edge. Unused here —
   * snapping lives in the original's MovementReconciler, which has no segment source to
   * reconcile against in the footprint port — but kept so the pipeline's contract reads whole. */
  static readonly SNAP_MAX_S = 15 * 60;
  /** Radius for matching a stay to existing places during attribution. Same status as SNAP_MAX_S. */
  static readonly ATTRIBUTION_RADIUS_M = 50;

  static defaults(): DetectionPolicy {
    return new DetectionPolicy(100, 600, 3, 15 * 60);
  }

  constructor(
    readonly stayRadiusM: number,
    readonly minDwellS: number,
    readonly minPoints: number,
    readonly mergeGapS: number,
  ) {}

  get sweepGapS(): number {
    return DetectionPolicy.SWEEP_GAP_S;
  }

  get bridgeCapS(): number {
    return DetectionPolicy.BRIDGE_CAP_S;
  }

  get snapMaxS(): number {
    return DetectionPolicy.SNAP_MAX_S;
  }

  get attributionRadiusM(): number {
    return DetectionPolicy.ATTRIBUTION_RADIUS_M;
  }
}
