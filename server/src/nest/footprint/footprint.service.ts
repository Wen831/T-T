import { DAWARICH_TRACK_POINTS_PER_DAY, type DawarichTrack } from '@trek/shared';
import { randomBytes, createHash } from 'crypto';
import { Injectable } from '@nestjs/common';

import { ADDON_IDS } from '../../addons';
import { bucketPointsByDay, countPoints } from '../integrations/dawarich.helpers';
import { DatabaseService } from '../database/database.service';
import { AddonsService } from '../addons/addons.service';
import { detectStays, MAX_CANDIDATE_POINTS } from './detection/detect-stays';
import { DetectionPolicy } from './detection/detection-policy';
import type { DetectionPoint, Stay } from './detection/types';
import type { IngestPoint } from './footprint-ingest';

/**
 * The user's own location archive: points ingested from a phone tracker, the
 * trail they draw, and the stays detection finds in them.
 *
 * This is the Dawarich core (record footprints) living inside TT instead of
 * beside it — the archive Dawarich would keep, the detector Dawarich runs
 * (ported stage-for-stage in ./detection, from Freika/dawarich, AGPL-3.0 — see
 * ./detection/README.md for sources and licensing), and the same `DawarichTrack`
 * contract the remote-instance integration serves, so every existing consumer
 * reads both sources through one shape. Coordinates are stored and served
 * WGS-84 end to end: the shared track schema has no coordinate-system field,
 * and the renderers convert at their own boundaries (the AMap layer runs
 * wgs84ToGcj02 when it draws), so converting here would double-shift every
 * point on the map.
 */

/** Token rows are per user — one ingest credential each, minted and rotated on demand. */
interface IngestTokenRow {
  user_id: number;
  token_hash: string;
  token_prefix: string;
  created_at: string | null;
  last_used_at: string | null;
}

export interface IngestTokenStatus {
  configured: boolean;
  tokenPrefix: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export interface IngestResult {
  received: number;
  inserted: number;
}

export interface PointsInRange {
  points: DetectionPoint[];
  /** The window hit the query cap; the answer is a prefix of the real data. */
  capped: boolean;
}

/** Guards the missing-RTREE warning: every ingest batch asks the question, and
 * repeating the same unmovable fact once a process is enough. */
let rtreeAbsenceLogged = false;

@Injectable()
export class FootprintService {
  constructor(
    private readonly db: DatabaseService,
    private readonly addons: AddonsService,
  ) {}

  // ── Addon and opt-in state ─────────────────────────────────────────────────

  isAddonEnabled(): boolean {
    return this.addons.isAddonEnabled(ADDON_IDS.FOOTPRINT);
  }

  /**
   * A user is recording locally when the addon is on and they hold an ingest
   * token — minting one is the opt-in that says "my phone reports to TT". The
   * READ side keys off the Dawarich connection's `source: 'builtin'` instead:
   * reading the archive needs no ingest credential, only the addon being on.
   */
  isLocalRecorder(userId: number): boolean {
    return this.isAddonEnabled() && this.hasIngestToken(userId);
  }

  // ── Ingest tokens ──────────────────────────────────────────────────────────

  hasIngestToken(userId: number): boolean {
    const row = this.db.get<unknown>('SELECT 1 FROM footprint_ingest_tokens WHERE user_id = ?', userId);
    return row !== undefined;
  }

  ingestTokenStatus(userId: number): IngestTokenStatus {
    const row = this.db
      .prepare('SELECT user_id, token_prefix, created_at, last_used_at FROM footprint_ingest_tokens WHERE user_id = ?')
      .get(userId) as IngestTokenRow | undefined;
    if (!row) return { configured: false, tokenPrefix: null, createdAt: null, lastUsedAt: null };
    return {
      configured: true,
      tokenPrefix: row.token_prefix,
      createdAt: row.created_at ?? null,
      lastUsedAt: row.last_used_at ?? null,
    };
  }

  /**
   * Mint (or rotate) the user's ingest token. The raw token exists in exactly
   * two places — this return value and the caller's config screen — because
   * only its hash is stored; the same contract TokenService uses for MCP/API
   * tokens.
   */
  mintIngestToken(userId: number): string {
    const raw = 'trek_fp_' + randomBytes(24).toString('hex');
    this.db.run(
      `INSERT INTO footprint_ingest_tokens (user_id, token_hash, token_prefix) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, token_prefix = excluded.token_prefix,
         created_at = CURRENT_TIMESTAMP, last_used_at = NULL`,
      userId,
      createHash('sha256').update(raw).digest('hex'),
      raw.slice(0, 15),
    );
    return raw;
  }

  /**
   * Hash, look up, resolve. A guest account never resolves: a credential-less
   * trip participant must not become a location source.
   */
  verifyIngestToken(rawToken: string): { id: number; username: string; email: string; role: 'admin' | 'user' } | null {
    if (!rawToken) return null;
    const hash = createHash('sha256').update(rawToken).digest('hex');
    const row = this.db.get<{ id: number; username: string; email: string; role: 'admin' | 'user' }>(
      `SELECT u.id, u.username, u.email, u.role
       FROM footprint_ingest_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND COALESCE(u.is_guest, 0) = 0`,
      hash,
    );
    if (!row) return null;
    this.db.run('UPDATE footprint_ingest_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE token_hash = ?', hash);
    return row;
  }

  // ── Ingest ─────────────────────────────────────────────────────────────────

  /**
   * Store one batch of validated fixes. Duplicate submissions are a no-op by
   * the (user, timestamp, lat, lon) unique index — trackers resend the current
   * fix on every reconnect, and Dawarich dedupes the same way. The RTREE row
   * rides along inside the same transaction when the SQLite build has RTREE;
   * otherwise the spatial index simply does not exist, and preparing against it
   * would throw for every single batch — so the statement is only built when the
   * index is there.
   */
  ingest(userId: number, fixes: IngestPoint[]): IngestResult {
    if (fixes.length === 0) return { received: 0, inserted: 0 };

    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO location_points (user_id, lat, lon, timestamp, accuracy, battery, altitude, velocity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const rtree = this.rtreeAvailable();
    const insertRtree = rtree
      ? this.db.prepare(
          'INSERT INTO location_points_rtree (id, min_lat, max_lat, min_lon, max_lon, user_id) VALUES (?, ?, ?, ?, ?, ?)',
        )
      : null;

    const inserted = this.db.transaction(() => {
      let count = 0;
      for (const fix of fixes) {
        const result = insert.run(
          userId,
          fix.lat,
          fix.lon,
          fix.timestamp,
          fix.accuracy,
          fix.battery,
          fix.altitude,
          fix.velocity,
        );
        if (result.changes === 1) {
          count += 1;
          insertRtree?.run(result.lastInsertRowid, fix.lat, fix.lat, fix.lon, fix.lon, userId);
        }
      }
      return count;
    });

    return { received: fixes.length, inserted };
  }

  // ── Reading the archive ────────────────────────────────────────────────────

  /**
   * Points in `[fromTs, toTs]` (unix seconds), time-ordered, bounded by `cap`.
   * The cap answers the same question CandidateLoader's MAX_CANDIDATE_POINTS
   * does: a window bigger than the cap is reported (capped) instead of
   * answered from a silently truncated sample.
   */
  pointsInRange(userId: number, fromTs: number, toTs: number, cap = MAX_CANDIDATE_POINTS): PointsInRange {
    const rows = this.db.all<{
      id: number;
      lat: number;
      lon: number;
      timestamp: number;
      accuracy: number | null;
    }>(
      'SELECT id, lat, lon, timestamp, accuracy FROM location_points WHERE user_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC LIMIT ?',
      userId,
      fromTs,
      toTs,
      cap + 1,
    );
    const capped = rows.length > cap;
    if (capped) rows.pop();
    return {
      points: rows.map((r) => ({
        id: r.id,
        lat: r.lat,
        lon: r.lon,
        timestamp: r.timestamp,
        accuracy: r.accuracy ?? null,
      })),
      capped,
    };
  }

  countPoints(userId: number): number {
    return (
      this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM location_points WHERE user_id = ?', userId)
        ?.count ?? 0
    );
  }

  /** Unix seconds of the newest stored point, null when the archive is empty. */
  latestPointAt(userId: number): number | null {
    return (
      this.db.get<{ latest: number | null }>(
        'SELECT MAX(timestamp) AS latest FROM location_points WHERE user_id = ?',
        userId,
      )?.latest ?? null
    );
  }

  // ── The DawarichTrack contract ─────────────────────────────────────────────

  /**
   * This user's recording as a `DawarichTrack` — the exact shape the
   * remote-instance path serves, built by the same `bucketPointsByDay`
   * helper the remote `points` fallback uses, so thinning, day-stitching and
   * the 600-points-per-day cap behave identically across both sources.
   *
   * Returns null when the footprint addon is off: the archive belongs to that
   * addon, and an off addon is not a data source. (Whether the archive IS the
   * Dawarich overlay's source is the Dawarich connection's `source` setting,
   * not this method's call.) Once the addon is on, the archive answers even
   * when the window is empty — a hole in your own recording is a hole, not a
   * reason to go ask another server.
   */
  localTrack(userId: number, fromIso: string, toIso: string, offsetMinutes: number): DawarichTrack | null {
    if (!this.isAddonEnabled()) return null;

    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      return { days: [], source: 'points', fetchedAt: new Date().toISOString(), pointCount: 0, truncated: false };
    }

    const { points, capped } = this.pointsInRange(userId, Math.floor(from / 1000), Math.ceil(to / 1000));
    const days = bucketPointsByDay(
      points.map((p) => ({ latitude: p.lat, longitude: p.lon, timestamp: p.timestamp })),
      offsetMinutes,
      { maxPointsPerDay: DAWARICH_TRACK_POINTS_PER_DAY },
    );
    return {
      days,
      source: 'points',
      fetchedAt: new Date().toISOString(),
      pointCount: countPoints(days),
      truncated: capped,
    };
  }

  // ── Stay detection ─────────────────────────────────────────────────────────

  /** Stays over a window — the ported pipeline's answer, scored. */
  staysForWindow(userId: number, fromTs: number, toTs: number): { stays: Stay[]; skipped: boolean } {
    const { points, capped } = this.pointsInRange(userId, fromTs, toTs, MAX_CANDIDATE_POINTS);
    if (capped) return { stays: [], skipped: true };
    return detectStays(points, this.policyFor());
  }

  /**
   * The four user-tunable thresholds, read from the footprint addon's config
   * JSON (`{"stay_radius_m":…,"min_dwell_s":…,"min_points":…,"merge_gap_s":…}`)
   * with the defaults underneath — the footprint counterpart of
   * `Policy.for(user)` reading `user.safe_settings`.
   */
  policyFor(): DetectionPolicy {
    const defaults = DetectionPolicy.defaults();
    if (!this.isAddonEnabled()) return defaults;

    const row = this.db.get<{ config: string | null }>('SELECT config FROM addons WHERE id = ?', ADDON_IDS.FOOTPRINT);
    if (!row?.config) return defaults;

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.config);
    } catch {
      return defaults;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;

    const config = parsed as Record<string, unknown>;
    const num = (value: unknown): number | null => {
      const n = typeof value === 'string' ? Number(value) : value;
      return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
    };
    return new DetectionPolicy(
      num(config['stay_radius_m']) ?? defaults.stayRadiusM,
      num(config['min_dwell_s']) ?? defaults.minDwellS,
      num(config['min_points']) ?? defaults.minPoints,
      num(config['merge_gap_s']) ?? defaults.mergeGapS,
    );
  }

  /** Computed once per connection — better-sqlite3 bundles SQLite with RTREE,
   * but a source build compiled without it must not take the server down. Once
   * per process it says so out loud: the spatial index then stays empty, and a
   * silent absence reads exactly like "no data" to whoever asks next. */
  private rtreeAvailable(): boolean {
    if (this.rtreeFlag === undefined) {
      const row = this.db.get<{ rtree_on: number }>(
        "SELECT sqlite_compileoption_used('ENABLE_RTREE') AS rtree_on",
      );
      this.rtreeFlag = row?.rtree_on === 1;
      if (!this.rtreeFlag && !rtreeAbsenceLogged) {
        rtreeAbsenceLogged = true;
        console.warn(
          '[footprint] This SQLite build has no ENABLE_RTREE, so location_points_rtree stays empty and spatial lookups cannot work. Points and trails are unaffected.',
        );
      }
    }
    return this.rtreeFlag;
  }

  private rtreeFlag: boolean | undefined;
}
