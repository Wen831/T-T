import type { DawarichCapabilities } from '@trek/shared';
import { Injectable } from '@nestjs/common';

import { haversineMeters } from '../footprint/detection/distance-meters';
import type { Stay } from '../footprint/detection/types';
import { MAX_CANDIDATE_POINTS } from '../footprint/detection/detect-stays';
import { FootprintService } from '../footprint/footprint.service';
import { getCountryFromCoords, NAME_TO_CODE } from '../atlas/atlas-geo';
import { DawarichError } from './dawarich.client';
import type {
  DawarichLocationVisit,
  DawarichProbe,
  DawarichSlimPoint,
  DawarichTrackFeature,
  DawarichVisitedCountry,
  DawarichVisitRaw,
} from './dawarich.client';

/**
 * The builtin half of the Dawarich data seam: the same method surface as
 * `DawarichClient`, answered from TT's own footprint archive instead of a
 * remote instance.
 *
 * Every consumer that used to ask the client for visits, tracks, points,
 * nearby stays or visited cities can ask this instead and parse the exact same
 * shapes — that is the contract the Dawarich integration is built on
 * (`DawarichVisitRaw` for the suggestion chain, `DawarichSlimPoint` /
 * `DawarichTrackFeature` for the overlay), and keeping it is what makes the
 * `source` switch a one-line branch at each call site rather than a fork of
 * the whole pipeline.
 *
 * The one deliberate shape difference: `listTracks` answers empty. Tracks are
 * Dawarich's pre-segmented lines, and the local archive has no segmentation
 * step — but its points carry per-fix timestamps, so the points path buckets
 * days EXACTLY where the remote tracks path can only interpolate. Serving
 * empty here sends every consumer down the better branch on its own.
 */

/** The `X-Dawarich-Version` stand-in, so version-reading code has something to read. */
const BUILTIN_VERSION = 'tt-builtin';

/**
 * Stay detection over one window needs the whole stay in the loaded points —
 * a stay that started before the window would otherwise be detected from a
 * truncated prefix and get different bounds than the same stay seen through a
 * neighbouring window. Detection therefore runs on a window padded by the
 * bridge cap on both sides (a stay bridged across that much silence is one
 * stay by definition), and the results are filtered to the semantics of the
 * visits endpoint: stays that START inside the requested window.
 */
const DETECTION_PAD_S = 7 * 24 * 60 * 60;

/** "Was I ever here" has no window on the remote endpoint; this matches the
 * recency cut-off the sync itself applies to trips. */
const NEAR_WINDOW_DAYS = 400;

@Injectable()
export class DawarichLocalSource {
  constructor(private readonly footprint: FootprintService) {}

  /** What the probe returns for a source that is TT itself. */
  async probe(_userId: number): Promise<DawarichProbe> {
    return { version: BUILTIN_VERSION };
  }  /** What this source can answer — static, because the endpoints are code, not a probed server. */
  capabilities(): DawarichCapabilities {
    return {
      visits: true,
      tracks: false, // answered through points, which carry exact per-fix times
      points: true,
      locations: true,
      visitedCities: true,
      visitUpdatedAt: false,
      visitCountryCode: false, // derived per visit in the sync, as for an old remote instance
      serverVersion: BUILTIN_VERSION,
      probedAt: new Date().toISOString(),
    };
  }

  /**
   * Stays the detector found with their START inside `[from, to]`, shaped as
   * the visits endpoint emits them.
   *
   * `id` is content-addressed — start second plus the center quantized to
   * ~100 m — so re-running a sync over the same recording resolves to the same
   * identity and updates the suggestion row instead of duplicating it. The
   * fields that drift while a stay is ongoing (its end, its exact center) are
   * deliberately NOT part of the id: they belong to the content hash, which is
   * how a changed visit is supposed to surface.
   */
  async listVisits(
    userId: number,
    from: Date,
    to: Date,
  ): Promise<{ visits: DawarichVisitRaw[]; truncated: boolean; version: string | null }> {
    const fromSec = Math.floor(from.getTime() / 1000);
    const toSec = Math.ceil(to.getTime() / 1000);
    const { stays, skipped } = this.staysIn(userId, fromSec - DETECTION_PAD_S, toSec + DETECTION_PAD_S);
    // A capped read is not an empty archive, and the sync treats "not listed"
    // as "gone" — flagging and deleting suggestions over a size limit would be
    // data loss pretending to be reconciliation. Throwing marks the window as
    // failed (the card says partial), which is the honest answer to "we did
    // not look at all of it".
    if (skipped) {
      throw new DawarichError('too_large', 'The recording window exceeds the stay-detection candidate cap');
    }

    const visits = stays
      .filter((stay) => stay.startTs >= fromSec && stay.startTs <= toSec)
      .map((stay) => stayToVisitRaw(stay));

    return { visits, truncated: false, version: BUILTIN_VERSION };
  }

  async listTracks(
    _userId: number,
    _from: Date,
    _to: Date,
  ): Promise<{ features: DawarichTrackFeature[]; truncated: boolean }> {
    // See the class comment: the points path is exact where tracks would be an
    // approximation, so the local source simply does not offer tracks.
    return { features: [], truncated: false };
  }

  async listPoints(
    userId: number,
    from: Date,
    to: Date,
  ): Promise<{ points: DawarichSlimPoint[]; truncated: boolean }> {
    const { points, capped } = this.footprint.pointsInRange(
      userId,
      Math.floor(from.getTime() / 1000),
      Math.ceil(to.getTime() / 1000),
      MAX_CANDIDATE_POINTS,
    );
    return {
      points: points.map((p) => ({ id: p.id, latitude: p.lat, longitude: p.lon, timestamp: p.timestamp })),
      truncated: capped,
    };
  }

  /**
   * Countries the stays put the user in, for the Atlas.
   *
   * The country comes from TT's own border index (`getCountryFromCoords` — the
   * same resolution the sync applies to every visit), not from any city
   * knowledge the archive does not have, so the `cities` lists are empty: a
   * country offered with no cities is honest, a guessed city is not.
   */
  async listVisitedCities(userId: number, from: Date, to: Date): Promise<DawarichVisitedCountry[]> {
    const fromSec = Math.floor(from.getTime() / 1000);
    const toSec = Math.ceil(to.getTime() / 1000);
    const { stays, skipped } = this.staysIn(userId, fromSec - DETECTION_PAD_S, toSec + DETECTION_PAD_S);
    // Same reasoning as listVisits: a capped read is "we did not look", not
    // "you went nowhere", and the Atlas should say so rather than offer silence.
    if (skipped) {
      throw new DawarichError('too_large', 'The recording window exceeds the stay-detection candidate cap');
    }

    const byCountry = new Map<string, number>();
    for (const stay of stays) {
      if (stay.startTs < fromSec || stay.startTs > toSec) continue;
      const code = getCountryFromCoords(stay.centerLat, stay.centerLon);
      if (!code) continue;
      byCountry.set(code, (byCountry.get(code) ?? 0) + stay.durationS / 60);
    }

    return [...byCountry.keys()].map((code) => ({
      country: codeToName(code),
      cities: [],
    }));
  }

  /**
   * Stays within `radiusMeters` of a coordinate, longest first — the local
   * answer to `GET /api/v1/locations`. Searched over the same recency window
   * the sync's trip selection uses; a wish ticked from a year older than that
   * is beyond what this source claims to know.
   */
  async findVisitsNear(
    userId: number,
    lat: number,
    lng: number,
    radiusMeters: number,
    limit: number,
  ): Promise<DawarichLocationVisit[]> {
    const toSec = Math.ceil(Date.now() / 1000);
    const fromSec = toSec - NEAR_WINDOW_DAYS * 86_400;
    const { stays } = this.staysIn(userId, fromSec - DETECTION_PAD_S, toSec + DETECTION_PAD_S);

    const near: Array<{ stay: Stay; distance: number }> = [];
    for (const stay of stays) {
      const distance = haversineMeters(stay.centerLat, stay.centerLon, lat, lng);
      if (distance <= radiusMeters) near.push({ stay, distance });
    }
    near.sort((a, b) => b.stay.durationS - a.stay.durationS);

    return near.slice(0, limit).map(({ stay, distance }) => ({
      timestamp: stay.startTs,
      date: new Date(stay.startTs * 1000).toISOString().slice(0, 10),
      distance_meters: Math.round(distance),
      points_count: stay.count,
      visit_details: {
        start_time: isoOf(stay.startTs),
        end_time: isoOf(stay.endTs),
        duration_minutes: Math.round(stay.durationS / 60),
        city: null,
        country: getCountryFromCoords(stay.centerLat, stay.centerLon),
      },
    }));
  }

  /** Detect stays over a (padded) window, with the cap answered as `skipped`. */
  private staysIn(userId: number, fromSec: number, toSec: number): { stays: Stay[]; skipped: boolean } {
    return this.footprint.staysForWindow(userId, fromSec, toSec);
  }
}

/** Unix seconds → the ISO shape the remote visits endpoint emits (no millis). */
function isoOf(ts: number): string {
  return new Date(ts * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** ~100 m quantization for the content-addressed visit id. */
function quantize(value: number): string {
  return value.toFixed(3);
}

function stayToVisitRaw(stay: Stay): DawarichVisitRaw {
  const confidence = stay.confidence ?? null;
  return {
    id: `local:${stay.startTs}:${quantize(stay.centerLat)}:${quantize(stay.centerLon)}`,
    area_id: null,
    started_at: isoOf(stay.startTs),
    ended_at: isoOf(stay.endTs),
    /** Seconds, matching current Dawarich builds; the sync normalises the unit. */
    duration: stay.durationS,
    name: null,
    status: 'suggested',
    confidence,
    confidence_band: confidence === null ? null : confidence >= 70 ? 'high' : confidence >= 40 ? 'medium' : 'low',
    place: {
      latitude: stay.centerLat,
      longitude: stay.centerLon,
      id: null,
      country_code: null, // the sync resolves it from the coordinates, as it does for remote visits
    },
  };
}

/**
 * The Atlas maps a source's country NAME through NAME_TO_CODE; the local
 * source starts from the code, so it needs the inverse. First name wins for a
 * code with several spellings — any of them maps back.
 */
const CODE_TO_NAME: ReadonlyMap<string, string> = (() => {
  const inverse = new Map<string, string>();
  for (const [name, code] of Object.entries(NAME_TO_CODE)) {
    const key = code.toUpperCase();
    if (!inverse.has(key)) inverse.set(key, name);
  }
  return inverse;
})();

function codeToName(code: string): string {
  return CODE_TO_NAME.get(code.toUpperCase()) ?? code;
}
