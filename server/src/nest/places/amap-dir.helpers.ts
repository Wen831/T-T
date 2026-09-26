import type { DirWaypoint } from './maps-dir.helpers';

/**
 * Reading the stops out of a shared AMap (高德) directions link.
 *
 * The AMap twin of `maps-dir.helpers.ts`, and deliberately a separate file: the two
 * link grammars share nothing but the idea of a route in a URL. Google names its
 * parts (`origin`, `waypoints`) and hides coordinates in a protobuf blob; AMap
 * indexes its parts (`from[lnglat]`, `via[0][lnglat]`) and puts each coordinate in
 * the parameter that names it.
 *
 * Two shapes reach us:
 *
 * - `ditu.amap.com/dir?type=car&from[lnglat]=…&via[0][lnglat]=…&to[lnglat]=…`, which
 *   is what the app's share sheet and TT's own handover produce. Any number of
 *   indexed vias.
 * - `uri.amap.com/route?…` / the `amapuri://route/plan` native form, which uses the
 *   `slon`/`slat`/`dlon`/`dlat`/`vialons`/`vialats` spelling. The native form is what
 *   a phone shares; the web form is what a desktop shares.
 *
 * Everything here is pure — the one thing a short link needs (a redirect to follow)
 * is the caller's job, exactly as in the Google parser.
 *
 * Coordinates in these links are GCJ-02, not WGS-84. That is the whole reason this
 * file exists rather than a regex in the service: a link read as WGS-84 puts every
 * stop a few hundred metres off, which looks like a routing bug rather than a units
 * bug. The caller converts; this file only reports what the link said.
 */

/** A stop read off the link. Coordinates when the link carried them, a name otherwise. */
export interface AmapRouteWaypoint extends DirWaypoint {
  /** True when the coordinate came from the link and is therefore GCJ-02. */
  gcj: boolean;
}

/** The same ceiling the Google importer uses; the URL is user input. */
export const MAX_AMAP_ROUTE_WAYPOINTS = 30;

/** `lng,lat`, which is the order AMap writes a coordinate pair in. */
const LNG_LAT_PAIR = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/;

/** Somewhere on Earth, rather than two numbers that happen to sit beside a comma. */
function onEarth(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** The AMap hosts that carry a route, and the short hosts that redirect to one. */
const AMAP_ROUTE_HOSTS = ['ditu.amap.com', 'uri.amap.com', 'www.amap.com', 'amap.com'];
const AMAP_SHORT_HOSTS = ['surl.amap.com', 'wb.amap.com', 'a.amap.com'];

export function isAmapHost(hostname: string): boolean {
  return AMAP_ROUTE_HOSTS.includes(hostname.toLowerCase());
}

export function isAmapShortHost(hostname: string): boolean {
  return AMAP_SHORT_HOSTS.includes(hostname.toLowerCase());
}

/**
 * A coordinate from one of AMap's several spellings of the same thing.
 *
 * `lnglat` is one `lng,lat` string; the native scheme splits it into `lon`/`lat`
 * (and `slon`/`slat` for the start). Both are read here so the two link shapes need
 * only one parser.
 */
function pairFrom(params: URLSearchParams, ...keys: string[]): { lat: number; lng: number } | null {
  for (const key of keys) {
    const raw = params.get(key);
    if (!raw) continue;
    const m = raw.match(LNG_LAT_PAIR);
    if (!m) continue;
    const lng = Number.parseFloat(m[1]);
    const lat = Number.parseFloat(m[2]);
    if (onEarth(lat, lng)) return { lat, lng };
  }
  return null;
}

/**
 * The `from`/`via[i]`/`to` indexed form, which is what `ditu.amap.com/dir` uses.
 *
 * Indexed rather than ordered: each leg names itself, so a name carrying a comma or a
 * `|` cannot truncate the route the way it does in a delimited form.
 */
function fromIndexedParams(params: URLSearchParams): AmapRouteWaypoint[] {
  const out: AmapRouteWaypoint[] = [];
  const push = (prefix: string) => {
    const at = pairFrom(params, `${prefix}[lnglat]`);
    const name = params.get(`${prefix}[name]`)?.trim() || null;
    if (!at) {
      if (name) out.push({ name, lat: null, lng: null, gcj: false });
      return;
    }
    out.push({ name, lat: at.lat, lng: at.lng, gcj: true });
  };
  push('from');
  // The vias are indexed from 0 and stop at the first gap, so a link that skips an
  // index does not invent a stop at the end of the list.
  for (let i = 0; i < MAX_AMAP_ROUTE_WAYPOINTS; i++) {
    if (!params.has(`via[${i}][lnglat]`) && !params.has(`via[${i}][name]`)) break;
    push(`via[${i}]`);
  }
  push('to');
  return out;
}

/**
 * The `slon`/`slat`…`vialons`/`vialats` form, which the native scheme and
 * `uri.amap.com/route` use.
 *
 * The vias arrive as three parallel `|`-separated lists — longitudes, latitudes and
 * names — which is why they are read together: a name with no position is a stop the
 * caller has to geocode, and reading the lists apart would misalign them.
 */
function fromFlatParams(params: URLSearchParams): AmapRouteWaypoint[] {
  const out: AmapRouteWaypoint[] = [];
  const start = pairFrom(params, 'slnglat', 'slon,slat');
  const startLng = params.get('slon');
  const startLat = params.get('slat');
  const sname = params.get('sname')?.trim() || null;
  const startAt =
    start ??
    (startLng && startLat && LNG_LAT_PAIR.test(`${startLng},${startLat}`)
      ? (() => {
          const lng = Number.parseFloat(startLng);
          const lat = Number.parseFloat(startLat);
          return onEarth(lat, lng) ? { lat, lng } : null;
        })()
      : null);
  if (startAt) out.push({ name: sname, lat: startAt.lat, lng: startAt.lng, gcj: true });
  else if (sname) out.push({ name: sname, lat: null, lng: null, gcj: false });

  const viaLngs = params.get('vialons')?.split('|') ?? [];
  const viaLats = params.get('vialats')?.split('|') ?? [];
  const viaNames = params.get('vianames')?.split('|') ?? [];
  // Bounded by the longest of the three: a via the link named but did not place is
  // still a stop the caller can geocode, and stopping at the coordinates would drop
  // it silently.
  const viaCount = Math.max(viaLngs.length, viaLats.length, viaNames.length);
  for (let i = 0; i < viaCount; i++) {
    const lng = Number.parseFloat(viaLngs[i] ?? '');
    const lat = Number.parseFloat(viaLats[i] ?? '');
    const name = viaNames[i]?.trim() || null;
    if (onEarth(lat, lng)) out.push({ name, lat, lng, gcj: true });
    else if (name) out.push({ name, lat: null, lng: null, gcj: false });
  }

  const dname = params.get('dname')?.trim() || null;
  const end = pairFrom(params, 'dlnglat', 'dlon,dlat');
  const endLng = params.get('dlon');
  const endLat = params.get('dlat');
  const endAt =
    end ??
    (endLng && endLat && LNG_LAT_PAIR.test(`${endLng},${endLat}`)
      ? (() => {
          const lng = Number.parseFloat(endLng);
          const lat = Number.parseFloat(endLat);
          return onEarth(lat, lng) ? { lat, lng } : null;
        })()
      : null);
  if (endAt) out.push({ name: dname, lat: endAt.lat, lng: endAt.lng, gcj: true });
  else if (dname) out.push({ name: dname, lat: null, lng: null, gcj: false });

  return out;
}

/**
 * The stops of a shared AMap directions link, in the order they are driven.
 *
 * Empty when the link is not a route, or holds fewer than two stops — one stop is a
 * place, and the place search box already takes those.
 *
 * GCJ-02 in, GCJ-02 out: the caller converts to WGS-84 before storing, because the
 * conversion is a domain rule and this file is a parser.
 */
export function parseAmapRouteUrl(raw: string, limit = MAX_AMAP_ROUTE_WAYPOINTS): AmapRouteWaypoint[] {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return [];
  }
  if (!isAmapHost(url.hostname)) return [];

  const indexed = fromIndexedParams(url.searchParams);
  const found = indexed.length >= 2 ? indexed : fromFlatParams(url.searchParams);
  return found.length >= 2 ? found.slice(0, limit) : [];
}
