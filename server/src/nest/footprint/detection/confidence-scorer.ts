import type { ConfidenceBreakdown, ConfidenceResult } from './types';

/**
 * The port of `Visits::ConfidenceScorer`
 * (app/services/visits/confidence_scorer.rb) in Freika/dawarich (AGPL-3.0).
 * See ./README.md for the source files and licensing of this port.
 *
 * An integer 0..100 score for one stay, plus the per-component breakdown
 * behind it.
 *
 * `placeMatch` is optional (there is no place-attribution layer in the
 * footprint pipeline to feed it); when absent its weight is redistributed
 * over the components that are present, so a missing place-match doesn't cap
 * the score — it just isn't counted. `bridgedFraction` and `corroborated` are
 * likewise optional and default to supplied by the pipeline.
 */

type WeightKey = 'dwell' | 'tightness' | 'place_match' | 'density' | 'accuracy' | 'bridged' | 'corroboration';

const WEIGHTS: Record<WeightKey, number> = {
  dwell: 0.3,
  tightness: 0.25,
  place_match: 0.2,
  density: 0.15,
  accuracy: 0.1,
  bridged: 0.15,
  corroboration: 0.1,
};

const PLACE_MATCH_SCORES: Record<'area' | 'place' | 'poi' | 'address', number> = {
  area: 1.0,
  place: 0.85,
  poi: 0.6,
  address: 0.35,
};

/** An uncorroborated stay isn't suspicious — segments may simply not cover it — so
 * absence scores neutral, not zero. */
const CORROBORATION_NEUTRAL = 0.5;

const TARGET_DWELL_SECONDS = 1800;
const DEFAULT_ACCURACY_METERS = 50;

export interface ConfidenceInput {
  durationSeconds: number;
  pointCount: number;
  accuracies: Array<number | null | undefined>;
  radiusMeters: number;
  stayRadiusMeters: number;
  minPoints: number;
  placeMatch?: 'area' | 'place' | 'poi' | 'address';
  bridgedFraction?: number;
  corroborated?: boolean;
}

export class ConfidenceScorer {
  constructor(private readonly input: ConfidenceInput) {}

  call(): ConfidenceResult {
    const subs = new Map<WeightKey, number>();
    subs.set('dwell', dwellScore(this.input));
    subs.set('tightness', tightnessScore(this.input));
    subs.set('density', densityScore(this.input));
    subs.set('accuracy', accuracyScore(this.input));
    if (this.input.placeMatch !== undefined) {
      subs.set('place_match', PLACE_MATCH_SCORES[this.input.placeMatch]);
    }
    if (this.input.bridgedFraction !== undefined) {
      subs.set('bridged', clamp(1 - this.input.bridgedFraction));
    }
    if (this.input.corroborated !== undefined) {
      subs.set('corroboration', this.input.corroborated ? 1 : CORROBORATION_NEUTRAL);
    }

    // Ruby: `(weighted(subs) * 100).round.clamp(0, 100)`.
    const score = Math.min(100, Math.max(0, Math.round(weighted(subs) * 100)));
    return { score, breakdown: breakdown(subs, this.input) };
  }
}

/** Redistribute weights over only the components actually present. */
function weighted(subs: ReadonlyMap<WeightKey, number>): number {
  let totalWeight = 0;
  for (const key of subs.keys()) totalWeight += WEIGHTS[key];

  let sum = 0;
  for (const [key, value] of subs) sum += (WEIGHTS[key] / totalWeight) * value;
  return sum;
}

function breakdown(subs: ReadonlyMap<WeightKey, number>, input: ConfidenceInput): ConfidenceBreakdown {
  const result: ConfidenceBreakdown = {
    dwell: round3(subs.get('dwell') ?? 0),
    tightness: round3(subs.get('tightness') ?? 0),
    density: round3(subs.get('density') ?? 0),
    accuracy: round3(subs.get('accuracy') ?? 0),
  };
  result.place_match = input.placeMatch === undefined ? 'unavailable' : round3(subs.get('place_match') ?? 0);
  const bridged = subs.get('bridged');
  if (bridged !== undefined) result.bridged = round3(bridged);
  const corroboration = subs.get('corroboration');
  if (corroboration !== undefined) result.corroboration = round3(corroboration);
  return result;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function dwellScore(input: ConfidenceInput): number {
  return clamp(input.durationSeconds / TARGET_DWELL_SECONDS);
}

function densityScore(input: ConfidenceInput): number {
  return clamp(input.pointCount / (Math.max(Math.floor(input.minPoints), 1) * 3.0));
}

function accuracyScore(input: ConfidenceInput): number {
  return clamp(1 - (medianAccuracy(input.accuracies) - 10.0) / 90.0);
}

/**
 * `radiusMeters` is the max point-to-center distance StayAssembler reports, not
 * RMS / radius-of-gyration — so tightness is slightly harsher than a
 * gyration-based measure.
 */
function tightnessScore(input: ConfidenceInput): number {
  if (input.stayRadiusMeters <= 0) return 0;
  return clamp(1 - input.radiusMeters / input.stayRadiusMeters);
}

function medianAccuracy(accuracies: Array<number | null | undefined>): number {
  const values = accuracies.map((a) => (a == null ? DEFAULT_ACCURACY_METERS : a)).sort((a, b) => a - b);
  if (values.length === 0) return DEFAULT_ACCURACY_METERS;

  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? (values[mid] as number)
    : ((values[mid - 1] as number) + (values[mid] as number)) / 2;
}
