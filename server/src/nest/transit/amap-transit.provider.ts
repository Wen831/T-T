import { getAppUrl } from '../../app-config';
import { amapFetchV3, amapSearchPlaces, getAmapKey } from '../geo/amap.service';
import { gcj02ToWgs84, wgs84ToGcj02 } from '../geo/gcj02';
import { DatabaseService } from '../database/database.service';
import { buildUserAgent } from '../maps/maps.helpers';
import { readTransitProviderSetting } from './transit-provider';
import {
  deriveTransitStats,
  encodePolyline,
  RAIL_FAMILY,
  type PlanQuery,
  type TransitItinerary,
  type TransitLeg,
  type TransitLegStop,
  type TransitPlace,
} from './transit.helpers';
import { Injectable } from '@nestjs/common';

/**
 * AMap (高德) as the transit backend, for mainland China — the region
 * Transitous cannot serve at all (no open GTFS feeds there) and where Google
 * is blocked/sparse. Activated by the Web服务 key the install already has
 * (`amap_api_key`, the same one place search uses): with the provider setting
 * untouched, a configured key routes transit through AMap automatically; an
 * explicit `transitous` (or `google`) in the setting overrides that.
 *
 * Endpoint: v3 `direction/transit/integrated`. v5 was considered and rejected:
 * its transit sub-api is documented as "steps 参考 v3 老接口" — the same
 * response shape, so the newer version number buys nothing here — while v3 is
 * what `amap.service.ts` already speaks through `amapFetchV3`.
 *
 * Two structural differences from MOTIS drive the mapping below:
 *
 * - Coordinates are GCJ-02 end to end. The journey's endpoints come in as
 *   WGS-84 (everything TREK stores is) and are converted to GCJ-02 for the
 *   request; every stop, polyline vertex and search result comes back GCJ-02
 *   and is converted out (the same iterative-inverse pair the driving
 *   provider uses).
 * - Times are `HH:mm` wall-clock strings at best, and only on rail segments /
 *   timed bus stops. So the timeline is BUILT by accumulation from the
 *   requested departure (or "now in China" when the caller gave no time),
 *   with an explicit `HH:mm` overriding the accumulator when the response
 *   actually carries one — mirroring how the Google provider fabricates walk
 *   times from its neighbours rather than shipping clock-less legs.
 */

const TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 5_000_000;

const GEOCODE_TTL = 30 * 60 * 1000;
const PLAN_TTL = 60 * 1000;
const CACHE_MAX = 200;

const cache = new Map<string, { at: number; ttl: number; data: unknown }>();

function cacheGet(key: string): unknown | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttl) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, hit);
  return hit.data;
}

function cacheSet(key: string, ttl: number, data: unknown): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), ttl, data });
}

/** Exposed for tests — module-scoped cache, the GoogleTransitProvider precedent. */
export function clearAmapTransitCache(): void {
  cache.clear();
}

function transitError(message: string, status = 502): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

let cachedUserAgent: string | null = null;
function getUserAgent(): string {
  cachedUserAgent ??= buildUserAgent(getAppUrl());
  return cachedUserAgent;
}

/**
 * `origin`/`destination` for AMap: "lng,lat", GCJ-02, six decimals — the same
 * formatting the driving/walking routes use.
 */
function toGcjCoordString(lat: number, lng: number): string {
  const g = wgs84ToGcj02(lng, lat);
  return `${g.lng.toFixed(6)},${g.lat.toFixed(6)}`;
}

function parseLatLng(value: string | undefined | null): { lat: number; lng: number } | null {
  if (!value) return null;
  const [lngStr, latStr] = String(value).split(',');
  const lng = Number.parseFloat(lngStr);
  const lat = Number.parseFloat(latStr);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return gcj02ToWgs84(lng, lat);
}

/**
 * "lng,lat;lng,lat;…" (AMap's bare polyline encoding, GCJ-02) → one WGS-84
 * Google-encoded polyline at precision 6, the shape TransitLeg.geometry carries.
 * Consecutive segments repeat the seam point; dedupe keeps lines from
 * double-drawing a vertex.
 */
function polylineToGeometry(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  const points: [number, number][] = [];
  for (const pair of raw.split(';')) {
    const w = parseLatLng(pair);
    if (!w) continue;
    const last = points[points.length - 1];
    if (!last || last[0] !== w.lat || last[1] !== w.lng) points.push([w.lat, w.lng]);
  }
  if (points.length === 0) return null;
  return encodePolyline(points, 6);
}

function firstPoint(raw: unknown): { lat: number; lng: number } | null {
  if (typeof raw !== 'string' || !raw) return null;
  return parseLatLng(raw.split(';')[0]);
}

function lastPoint(raw: unknown): { lat: number; lng: number } | null {
  if (typeof raw !== 'string' || !raw) return null;
  const parts = raw.split(';');
  return parseLatLng(parts[parts.length - 1]);
}

function safeColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const hex = v.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(hex) || /^[0-9a-fA-F]{3}$/.test(hex) ? `#${hex}` : null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/** "14:05" on the anchor day → UTC ms. */
function hHmmToMsInAnchorDay(hhmm: string, anchorMs: number): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  // UTC fields of (anchor + 8h) are exactly the China calendar date; the
  // wall-clock instant on that date is that UTC reading minus the offset.
  const chinaDay = new Date(anchorMs + 8 * 3_600_000);
  const asUtc = Date.UTC(
    chinaDay.getUTCFullYear(),
    chinaDay.getUTCMonth(),
    chinaDay.getUTCDate(),
    Number(m[1]),
    Number(m[2]),
  );
  return asUtc - 8 * 3_600_000;
}

/**
 * AMap's train classes → TREK's MOTIS-taxonomy rail tokens. The trip letter is
 * authoritative where present: G/C/D (and the 城际/高铁/动车 wording that covers
 * them) are high-speed; S is the suburban/通勤 rail family; K/T/Z/Y/L and bare
 * numbers are conventional long-distance.
 */
export function classifyRailTrip(trip: string | null, typeText: string | null): string {
  const letter = (trip || '').trim().toUpperCase().match(/^[A-Z]+/)?.[0]?.[0];
  if (letter === 'G' || letter === 'C' || letter === 'D') return 'HIGHSPEED_RAIL';
  if (letter === 'S') return 'SUBURBAN';
  if (letter) return 'LONG_DISTANCE';
  const t = typeText || '';
  if (/高铁|城际|动车|高速/.test(t)) return 'HIGHSPEED_RAIL';
  if (/市郊|通勤/.test(t)) return 'SUBURBAN';
  return 'LONG_DISTANCE';
}

/**
 * AMap bus-line type → the mode token the client has icons for. AMap's
 * "火车" lines carry the trip number in `name` (v3 sometimes nests local
 * trains here rather than in `railway`), so they join the rail classifier.
 */
export function classifyBusLine(type: string | null, name: string | null): string {
  const t = type || '';
  if (/地铁|轻轨/.test(t)) return 'SUBWAY';
  if (/磁悬浮/.test(t)) return 'SUBWAY';
  if (/轮渡|渡轮|船/.test(t)) return 'FERRY';
  if (/索道|缆车/.test(t)) return 'AERIAL_LIFT';
  if (/有轨电车/.test(t)) return 'TRAM';
  if (/火车|客运列车|城际/.test(t)) return classifyRailTrip(null, t || name);
  if (/市郊铁路/.test(t)) return 'SUBURBAN';
  if (/长途汽车|客运班线|汽车/.test(t)) return 'COACH';
  if (/机场巴士|机场班车/.test(t)) return 'BUS';
  return 'BUS';
}

interface AmapStopRaw {
  name?: string;
  location?: string;
  time?: string;
}

interface AmapRailwayRaw {
  name?: string;
  trip?: string;
  type?: string;
  distance?: string;
  origin_station?: AmapStopRaw;
  destination_station?: AmapStopRaw;
  via_stops?: Array<{ name?: string }>;
  polyline?: string;
}

interface AmapBusLineRaw {
  name?: string;
  type?: string;
  color?: string;
  distance?: string;
  duration?: string;
  polyline?: string;
  start_stop?: AmapStopRaw;
  end_stop?: AmapStopRaw;
  departure_stop?: AmapStopRaw;
  arrival_stop?: AmapStopRaw;
  via_stops?: Array<{ name?: string }>;
  via_num?: string;
  departure_time?: string;
  arrival_time?: string;
}

interface AmapSegmentRaw {
  walking?: { distance?: string; duration?: string; steps?: Array<{ polyline?: string; road?: string }> };
  bus?: { buslines?: AmapBusLineRaw[] };
  railway?: AmapRailwayRaw | AmapRailwayRaw[];
  taxi?: { drivetime?: string; distance?: string; startname?: string; endname?: string; polyline?: string };
}

interface AmapTransitRaw {
  cost?: { duration?: string };
  duration?: string;
  distance?: string;
  segments?: AmapSegmentRaw[];
}

function stopOf(
  raw: AmapStopRaw | undefined,
  fallbackName: string,
  fallbackPoint: { lat: number; lng: number } | null,
): TransitLegStop {
  const parsed = parseLatLng(raw?.location);
  const point = parsed || fallbackPoint;
  return {
    name: raw?.name?.trim() || fallbackName,
    lat: point?.lat ?? 0,
    lng: point?.lng ?? 0,
    time: null,
    scheduledTime: null,
    track: null,
  };
}

@Injectable()
export class AmapTransitProvider {
  constructor(private readonly db: DatabaseService) {}

  private key(): string | null {
    return getAmapKey(this.db);
  }

  /**
   * True when the instance has an AMap Web服务 key AND the admin has not pinned
   * another backend. Pinned `transitous` means "stay keyless"; pinned `google`
   * must not be silently rerouted to AMap when its key goes missing.
   */
  isActive(): boolean {
    const pinned = readTransitProviderSetting(this.db);
    if (pinned && pinned !== 'amap') return false;
    return !!this.key();
  }

  /** Station/place search for the from/to pickers, reusing the POI search. */
  async geocode(text: string, near: string | undefined): Promise<{ results: TransitPlace[] }> {
    const key = this.key();
    if (!key) throw transitError('Transit provider error (no AMap key configured)');

    const cacheKey = `amap:geocode:${text}|${near || ''}`;
    const cachedHit = cacheGet(cacheKey);
    if (cachedHit) return cachedHit as { results: TransitPlace[] };

    // MOTIS's `near` is "lat,lng"; the POI search wants the same WGS pair.
    const [nearLat, nearLng] = String(near || '').split(',').map(Number);
    const bias =
      Number.isFinite(nearLat) && Number.isFinite(nearLng) ? { lat: nearLat, lng: nearLng } : null;

    const places = await amapSearchPlaces(this.db, text, {
      locationBias: bias ? { ...bias, radius: 20_000 } : null,
      limit: 8,
    });

    const results: TransitPlace[] = places
      .filter((p) => p.lat != null && p.lng != null)
      .slice(0, 8)
      .map((p) => ({
        name: p.name,
        lat: p.lat as number,
        lng: p.lng as number,
        // MOTIS answers STOP for stations and PLACE otherwise; the picker
        // renders the two differently. AMap's typed POI categories say which
        // it is: 交通设施服务 ones are stops for our purposes.
        type: /地铁站|火车站|轻轨|客运站|港口|航站楼|班车站|交通设施/.test(p.amap_type || '') ? 'STOP' : 'PLACE',
        area: p.address || null,
      }));

    const payload = { results };
    cacheSet(cacheKey, GEOCODE_TTL, payload);
    return payload;
  }

  /** One regeo round-trip per coordinate; adcode is what the transit call's city params want. */
  private async adcodeOf(lat: number, lng: number): Promise<string> {
    const data = await amapFetchV3(
      '/v3/geocode/regeo',
      new URLSearchParams({ location: toGcjCoordString(lat, lng), extensions: 'base', output: 'JSON' }),
      this.key() as string,
    );
    const component = data?.regeocode?.addressComponent || {};
    const adcode = typeof component.adcode === 'string' ? component.adcode : '';
    if (!adcode) throw transitError('Transit provider error (AMap could not resolve the area)');
    return adcode;
  }

  /** Route search between two coordinates. Returns the same compact shape MOTIS is mapped to. */
  async plan(q: PlanQuery): Promise<{ itineraries: TransitItinerary[] }> {
    const key = this.key();
    if (!key) throw transitError('Transit provider error (no AMap key configured)');

    const [fromLat, fromLng] = q.from.split(',').map(Number);
    const [toLat, toLng] = q.to.split(',').map(Number);
    if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) {
      throw transitError('Transit provider error (bad coordinates)', 400);
    }

    const requested = (q.modes || '')
      .split(',')
      .map((m) => m.trim().toUpperCase())
      .filter(Boolean)
      .filter((m) => m !== 'TRANSIT');

    // Anchor day: the requested departure when given, else "now in China".
    // AMap times are China wall-clock, and the request `date`/`time` pair has
    // no timezone parameter — so the instant is read through UTC+8, exact for
    // a country with a single legal offset.
    const requestedMs = q.time ? new Date(q.time).getTime() : Date.now();
    if (!Number.isFinite(requestedMs)) throw transitError('time must be an ISO date-time', 400);
    const anchor = requestedMs + 8 * 3_600_000; // UTC fields now show the China local calendar day
    const shanghai = new Date(anchor);
    const date = shanghai.toISOString().slice(0, 10);
    const time = `${String(shanghai.getUTCHours()).padStart(2, '0')}-${String(shanghai.getUTCMinutes()).padStart(2, '0')}`;

    // AMap's v3 transit wants the city adcodes; intercity routing turns on
    // city≠cityd. Cross-country queries outside AMap's coverage fail here or
    // return nothing — the service treats both as "ask Transitous".
    const cityFrom = await this.adcodeOf(fromLat, fromLng);
    const cityTo = await this.adcodeOf(toLat, toLng);

    const params = new URLSearchParams({
      origin: toGcjCoordString(fromLat, fromLng),
      destination: toGcjCoordString(toLat, toLng),
      city: cityFrom,
      cityd: cityTo,
      date,
      time,
      output: 'JSON',
    });

    // The requested instant is part of the key, not just the `date`/`time`
    // pair: the itinerary timeline is accumulated from it, so entries built
    // for two different departures must not share a slot even within the TTL.
    const cacheKey = `amap:plan:${requestedMs}:${params.toString()}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached as { itineraries: TransitItinerary[] };

    params.set('key', key);
    const res = await fetch(`https://restapi.amap.com/v3/direction/transit/integrated?${params.toString()}`, {
      headers: { 'User-Agent': getUserAgent(), Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).then(async (r) => {
      const length = Number(r.headers?.get('content-length') ?? 0);
      if (length > MAX_RESPONSE_BYTES) throw transitError('Transit provider error (response too large)');
      const data = (await r.json().catch(() => ({}))) as { status?: string; info?: string; route?: unknown };
      if (!r.ok || data?.status !== '1') {
        throw transitError(`Transit provider error (AMap: ${data?.info || `HTTP ${r.status}`})`);
      }
      return data;
    });

    const route = (res?.route || {}) as { transits?: AmapTransitRaw[] };
    const itineraries: TransitItinerary[] = (Array.isArray(route.transits) ? route.transits : [])
      .flatMap((t) => {
        const built = buildItinerary(t, requestedMs);
        return built ? [built] : [];
      })
      .filter((it) => matchesRequestedModes(it, requested))
      .filter((it) => q.maxTransfers === undefined || q.maxTransfers === null || it.transfers <= q.maxTransfers)
      .slice(0, 8);

    // Empty is a legitimate "no connection" — but for AMap it is equally the
    // signature of out-of-coverage input. The service falls back to Transitous
    // on an empty answer, so a Germany query still gets routes.
    const payload = { itineraries };
    cacheSet(cacheKey, PLAN_TTL, payload);
    return payload;
  }
}

/**
 * One `transits[]` entry → one itinerary. `anchorMs` is the caller's requested
 * departure instant (UTC); every leg starts where the previous ended, and an
 * explicit `HH:mm` on a stop overrides the accumulator (then the accumulator
 * resumes from the override) so transfers still line up.
 */
function buildItinerary(t: AmapTransitRaw, anchorMs: number): TransitItinerary | null {
  const segments = Array.isArray(t.segments) ? t.segments : [];
  if (segments.length === 0) return null;

  const legs: TransitLeg[] = [];
  let cursor = anchorMs;

  const pushLeg = (
    mode: string,
    from: TransitLegStop,
    to: TransitLegStop,
    durationSec: number,
    opts: { line?: string | null; lineColor?: string | null; headsign?: string | null; geometry?: string | null; intermediateStops?: number; explicitStartMs?: number | null } = {},
  ): void => {
    if (typeof opts.explicitStartMs === 'number') cursor = opts.explicitStartMs;
    const fromMs = cursor;
    const toMs = cursor + durationSec * 1000;
    cursor = toMs;
    const iso = (ms: number) => new Date(ms).toISOString();
    from.time = iso(fromMs);
    from.scheduledTime = iso(fromMs);
    to.time = iso(toMs);
    to.scheduledTime = iso(toMs);
    legs.push({
      mode,
      from,
      to,
      duration: durationSec,
      distance: null,
      headsign: opts.headsign ?? null,
      line: opts.line ?? null,
      lineColor: opts.lineColor ?? null,
      lineTextColor: null,
      agency: null,
      intermediateStops: opts.intermediateStops ?? 0,
      geometry: opts.geometry ?? null,
      geometryPrecision: 6,
    });
  };

  for (const seg of segments) {
    const walk = seg.walking;
    // AMap v3 often ships `walking` as an empty shell ({distance: undefined,
    // steps: undefined}) on segments whose real content is the bus/railway
    // leg. A bare truthiness check lets that shell swallow the whole segment
    // — `continue` fires before the bus/railway branches run, so the journey
    // collapses to WALK-only and the transitLegs guard below discards it.
    // Only treat a walking entry as an actual walk when it carries content.
    if (walk && ((Array.isArray(walk.steps) && walk.steps.length > 0) || num(walk.distance) > 0)) {
      const walkMeters = num(walk.distance);
      // v3 walking carries distance but often no duration: 4 km/h is the same
      // assumption MOTIS makes for an untimed pedestrian edge.
      const walkSeconds = num(walk.duration) || Math.max(60, Math.round(walkMeters / 1.11));
      const steps = Array.isArray(walk.steps) ? walk.steps : [];
      const geometry = polylineToGeometry(steps.map((s) => s.polyline || '').filter(Boolean).join(';'));
      const start = firstPoint(steps[0]?.polyline);
      const end = lastPoint(steps[steps.length - 1]?.polyline);
      const prev = legs[legs.length - 1];
      const fromStop: TransitLegStop = {
        // A walk before the first transit leg starts from the journey's origin
        // ('START' — the client swaps in the user's own from-place name).
        name: prev?.to.name || 'START',
        lat: prev?.to.lat ?? start?.lat ?? 0,
        lng: prev?.to.lng ?? start?.lng ?? 0,
        time: null,
        scheduledTime: null,
        track: null,
      };
      const toStop: TransitLegStop = {
        name: 'END',
        lat: end?.lat ?? 0,
        lng: end?.lng ?? 0,
        time: null,
        scheduledTime: null,
        track: null,
      };
      pushLeg('WALK', fromStop, toStop, walkSeconds, { geometry });
      const built = legs[legs.length - 1];
      if (built) built.distance = walkMeters || null;
      continue;
    }

    const buslines = Array.isArray(seg.bus?.buslines) ? seg.bus!.buslines! : seg.bus?.buslines ? [seg.bus.buslines] : [];
    for (const line of buslines) {
      if (!line || typeof line !== 'object') continue;
      const lineName = String(line.name || '');
      const type = line.type == null ? null : String(line.type);
      const mode = classifyBusLine(type, lineName);
      const geometry = polylineToGeometry(line.polyline);
      const start = firstPoint(line.polyline);
      const end = lastPoint(line.polyline);
      const dep = line.departure_stop || line.start_stop;
      const arr = line.arrival_stop || line.end_stop;
      const fromStop = stopOf(dep, 'START', start);
      const toStop = stopOf(arr, 'END', end);
      const depMs = timeStrToMs(line.departure_time || dep?.time, anchorMs);
      const arrMs = timeStrToMs(line.arrival_time || arr?.time, anchorMs);
      // v3 buslines often carry neither a duration nor stop times, and a
      // zero-duration leg cannot satisfy the wire contract (endTime must be
      // after startTime, every leg needs times). Order of preference: the
      // reported duration, the explicit time pair, then a speed estimate
      // (metro ~30 km/h, bus ~20 km/h — closer to reality than "instant").
      const estimateMsPerKm = mode === 'SUBWAY' || RAIL_FAMILY.has(mode) ? 120 : 180;
      const durationSec =
        num(line.duration) ||
        (depMs !== null && arrMs !== null && arrMs >= depMs ? Math.round((arrMs - depMs) / 1000) : 0) ||
        Math.max(120, Math.round((num(line.distance) / 1000) * estimateMsPerKm));
      const viaCount = Array.isArray(line.via_stops)
        ? line.via_stops.length
        : num(line.via_num);
      const prev = legs[legs.length - 1];
      if (prev) {
        fromStop.name = fromStop.name === 'START' && prev.to.name ? prev.to.name : fromStop.name;
        fromStop.lat = fromStop.lat || prev.to.lat;
        fromStop.lng = fromStop.lng || prev.to.lng;
      }
      pushLeg(mode, fromStop, toStop, durationSec, {
        line: lineName || null,
        lineColor: safeColor(line.color),
        intermediateStops: viaCount,
        geometry,
        explicitStartMs: depMs,
      });
      const built = legs[legs.length - 1];
      if (built) built.distance = num(line.distance) || null;
    }

    const rails = Array.isArray(seg.railway) ? seg.railway : seg.railway ? [seg.railway] : [];
    for (const rail of rails) {
      // AMap v3 pads metro segments with an empty railway object (no line, no
      // stations, no polyline) — building it would only emit a ghost
      // LONG_DISTANCE leg with no geometry or times.
      if (!rail || (!rail.polyline && !rail.origin_station && !rail.trip)) continue;
      const geometry = polylineToGeometry(rail.polyline);
      const start = firstPoint(rail.polyline);
      const end = lastPoint(rail.polyline);
      const fromStop = stopOf(rail.origin_station, 'START', start);
      const toStop = stopOf(rail.destination_station, 'END', end);
      const trip = String(rail.trip || rail.name || '');
      const mode = classifyRailTrip(trip || null, rail.type == null ? null : String(rail.type));
      const depHm = timeStrToMs(rail.origin_station?.time, anchorMs);
      const arrHm = timeStrToMs(rail.destination_station?.time, anchorMs);
      // Same reasoning as buslines: an untimed rail leg still needs a positive
      // duration — 2.5 min/km ≈ a 240 km/h average including station stops.
      const durationSec =
        depHm !== null && arrHm !== null && arrHm >= depHm
          ? Math.round((arrHm - depHm) / 1000)
          : Math.max(300, Math.round((num(rail.distance) / 1000) * 2.5));
      const prev = legs[legs.length - 1];
      if (prev) {
        fromStop.name = fromStop.name === 'START' && prev.to.name ? prev.to.name : fromStop.name;
        fromStop.lat = fromStop.lat || prev.to.lat;
        fromStop.lng = fromStop.lng || prev.to.lng;
      }
      pushLeg(mode, fromStop, toStop, durationSec, {
        line: trip || null,
        intermediateStops: Array.isArray(rail.via_stops) ? rail.via_stops.length : 0,
        geometry,
        explicitStartMs: depHm,
      });
      const built = legs[legs.length - 1];
      if (built) {
        built.distance = num(rail.distance) || null;
        if (arrHm !== null && depHm !== null && arrHm >= depHm) {
          // to.time already equals dep+duration — re-pin to the explicit arrival.
          built.to.time = new Date(arrHm).toISOString();
          built.to.scheduledTime = built.to.time;
        }
      }
    }

    const taxi = seg.taxi;
    // Same empty-shell padding as railway: on transit segments the taxi slot
    // often carries no drivetime, distance, names or polyline — building it
    // would emit a geometry-less CAR leg between two "Transfer" non-places.
    if (taxi && (taxi.polyline || taxi.startname || taxi.endname || num(taxi.drivetime) > 0 || num(taxi.distance) > 0)) {
      const geometry = polylineToGeometry(taxi.polyline);
      const start = firstPoint(taxi.polyline);
      const end = lastPoint(taxi.polyline);
      const fromStop = stopOf(undefined, 'Transfer', start);
      const toStop = stopOf(undefined, 'Transfer', end);
      fromStop.name = String(taxi.startname || '') || fromStop.name;
      toStop.name = String(taxi.endname || '') || toStop.name;
      if (!start) {
        const prev = legs[legs.length - 1];
        if (prev) {
          fromStop.lat = prev.to.lat;
          fromStop.lng = prev.to.lng;
        }
      }
      const taxiSeconds =
        num(taxi.drivetime) || Math.max(120, Math.round((num(taxi.distance) / 1000) * 3));
      pushLeg('CAR', fromStop, toStop, taxiSeconds, { line: null, geometry });
      const built = legs[legs.length - 1];
      if (built) built.distance = num(taxi.distance) || null;
    }
  }

  const transitLegs = legs.filter((leg) => leg.mode !== 'WALK');
  if (transitLegs.length === 0) return null;

  // The journey-endpoints convention MOTIS uses (and the client swaps names
  // for): first/last leg touches START/END tokens.
  legs[0].from.name = legs[0].from.name || 'START';
  legs[legs.length - 1].to.name = legs[legs.length - 1].to.name || 'END';
  // Fill "END" placeholders left by coordinate-only stops: consecutive legs
  // share the transfer point, so copy the neighbour's real name across, and
  // keep the bare "END" token only on the very last leg (the client swaps in
  // the user's own destination name there).
  for (let i = 1; i < legs.length; i++) {
    if (!legs[i].from.name || legs[i].from.name === 'END') legs[i].from.name = legs[i - 1].to.name;
  }
  for (let i = 0; i < legs.length - 1; i++) {
    if (legs[i].to.name === 'END' && legs[i + 1].from.name && legs[i + 1].from.name !== 'END') {
      legs[i].to.name = legs[i + 1].from.name;
    }
  }
  for (const leg of legs) {
    if (!leg.from.name) leg.from.name = 'Transfer';
    if (!leg.to.name) leg.to.name = 'Transfer';
  }

  const startTime = legs[0].from.time;
  const endTime = legs[legs.length - 1].to.time;
  if (!startTime || !endTime) return null;

  return {
    startTime,
    endTime,
    ...deriveTransitStats(startTime, endTime, legs),
    legs,
  };
}

/** "14:05" on the anchor day → UTC ms; AMap also answers "HH:MM:SS". */
function timeStrToMs(value: unknown, anchorMs: number): number | null {
  if (typeof value !== 'string' || !value) return null;
  return hHmmToMsInAnchorDay(value, anchorMs);
}

/**
 * The response-side half of the mode filter — AMap has no request-side mode
 * parameter, so a "subway only" search is held to it here exactly like the
 * Google provider does with its coarser travel-mode buckets.
 */
function matchesRequestedModes(itinerary: TransitItinerary, requested: string[]): boolean {
  if (requested.length === 0) return true;
  const wanted = new Set(requested);
  const railWanted = requested.some((mode) => RAIL_FAMILY.has(mode));
  return itinerary.legs.every(
    (leg) => leg.mode === 'WALK' || wanted.has(leg.mode) || (railWanted && RAIL_FAMILY.has(leg.mode)),
  );
}
