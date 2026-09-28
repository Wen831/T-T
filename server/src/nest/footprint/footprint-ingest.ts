/**
 * OwnTracks HTTP JSON compatibility for `POST /api/v1/points/ingest`.
 *
 * OwnTracks' HTTP mode posts one location record per request
 * (`{"_type":"location","lat":…,"lon":…,"tst":…,"acc":…,"batt":…}`); several
 * clients batch instead — a bare JSON array of records, the `{"_type":"batch",
 * "data":[…]}` envelope, or the `{"points":[…]}` wrapper Dawarich's own apps
 * use. The schema below preprocesses all four shapes into one `{ records }`
 * envelope before validating, so the endpoint's DTO (and the boot gate behind
 * it) can carry the union of wire formats as a plain object type.
 *
 * Anything that is not recognisably a GPS fix inside the envelope is skipped
 * rather than rejected, because a tracker that interleaves waypoints or
 * heartbeat records must not have its whole batch dropped over one odd member.
 */

import { z } from 'zod';

/** One record on the wire — loose by design; field-level validation is normalizeIngestEntry's job. */
const ownTracksRecordSchema = z.looseObject({
  _type: z.string().nullish(),
  lat: z.union([z.number(), z.string()]).nullish(),
  lon: z.union([z.number(), z.string()]).nullish(),
  /** Unix seconds — the field OwnTracks and Dawarich both use. */
  tst: z.union([z.number(), z.string()]).nullish(),
  /** Horizontal accuracy in metres. */
  acc: z.union([z.number(), z.string()]).nullish(),
  /** Battery percentage 0–100. */
  batt: z.union([z.number(), z.string()]).nullish(),
  alt: z.union([z.number(), z.string()]).nullish(),
  vel: z.union([z.number(), z.string()]).nullish(),
  cog: z.union([z.number(), z.string()]).nullish(),
  tid: z.string().nullish(),
});

export type OwnTracksRecord = z.infer<typeof ownTracksRecordSchema>;

/**
 * The wire: one record, a JSON array of them, an OwnTracks `batch` envelope, or
 * Dawarich's `{ points: [...] }` wrapper — normalized into `{ records: [...] }`.
 */
export const footprintIngestBodySchema = z.preprocess((raw: unknown) => {
  if (Array.isArray(raw)) return { records: raw };
  if (raw !== null && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj['data'])) return { records: obj['data'] };
    if (Array.isArray(obj['points'])) return { records: obj['points'] };
    return { records: [obj] };
  }
  return { records: [] };
}, z.object({ records: z.array(ownTracksRecordSchema) }));

export type FootprintIngestBody = z.infer<typeof footprintIngestBodySchema>;

/**
 * The batch bound for one ingest request. OwnTracks batches are small, but the
 * endpoint is machine-facing and unbounded input is a denial-of-service shape —
 * a bigger import has no business arriving on this endpoint one POST at a time.
 */
export const MAX_INGEST_ENTRIES = 10_000;

/** A validated fix, ready for the location_points table. */
export interface IngestPoint {
  lat: number;
  lon: number;
  /** Unix seconds UTC. */
  timestamp: number;
  accuracy: number | null;
  battery: number | null;
  altitude: number | null;
  velocity: number | null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Validate one record into an IngestPoint, or null when it is not a usable fix.
 *
 * The (0, 0) reject is Dawarich's own Null-Island rule (CandidateLoader's
 * `NOT (ST_X = 0 AND ST_Y = 0)`), applied at the door instead: TT keeps no
 * anomaly column to re-filter against later, so a fix that is not on the
 * Earth's surface never enters the archive at all.
 */
export function normalizeIngestEntry(record: OwnTracksRecord): IngestPoint | null {
  if (record._type !== undefined && record._type !== null && record._type !== 'location') return null;

  const lat = toNumberOrNull(record.lat);
  const lon = toNumberOrNull(record.lon);
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;

  const timestamp = toNumberOrNull(record.tst);
  if (timestamp === null || timestamp <= 0) return null;

  const accuracy = toNumberOrNull(record.acc);
  const battery = toNumberOrNull(record.batt);
  const altitude = toNumberOrNull(record.alt);
  const velocity = toNumberOrNull(record.vel);

  return {
    lat,
    lon,
    timestamp: Math.round(timestamp),
    accuracy: accuracy === null ? null : Math.max(0, accuracy),
    battery: battery === null ? null : Math.round(Math.min(100, Math.max(0, battery))),
    altitude,
    velocity,
  };
}
