import { mapsApi } from '../../api/client';
import { gcj02ToWgs84 } from './engines/amap';

/**
 * Basemap POI hotspots ("热点"): the labels AMap draws for places that are not
 * TT's own — restaurants, sights, malls. JS API fires `hotspotclick` on them
 * with the POI's name, id and coordinate without any HTTP call of its own, so
 * a tap on "BREWTOWN 啤酒小镇" can open a popup and offer "add as place" even
 * though the point was never in the trip. AMap-specific by nature: raster
 * tiles (Leaflet) and OSM vector tiles carry no interactive POI labels, so
 * this file has no Leaflet/GL counterpart and none is owed (MAP-ENGINES.md).
 */

/** A basemap POI the traveller tapped, coordinate already converted to WGS-84. */
export interface MapHotspot {
  lat: number;
  lng: number;
  name: string;
  amapId: string;
}

/** What the popup shows once the detail lookup answers. */
export interface HotspotDetail {
  address: string | null;
  phone: string | null;
  rating: number | null;
  openTime: string | null;
  photo: string | null;
}

/** The poi shape `openAddPlaceFromPoi` (and the prefill form) consumes. */
export interface HotspotPoi {
  lat: number;
  lng: number;
  name: string;
  address: string | null;
  website: string | null;
  phone: string | null;
  osm_id: string;
}

// Settled lookups live here so re-tapping the same label spends one detail
// call per POI per session, not one per tap. Cleared wholesale when it grows
// past a bound nobody hits in personal use — a cache eviction policy would
// outlive its purpose.
const detailCache = new Map<string, Promise<HotspotDetail | null>>();

/**
 * One WebService `/v5/place/detail` per POI (the instance's key, server-proxied
 * — the same call the place-details column makes). This is the only quota this
 * feature spends: the hotspot event itself is free.
 */
export function fetchHotspotDetail(amapId: string): Promise<HotspotDetail | null> {
  const cached = detailCache.get(amapId);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const res = await mapsApi.details(`amap:${amapId}`);
      const p = res.place as Record<string, any> | null;
      if (!p) return null;
      return {
        address: p.address || null,
        phone: p.phone || null,
        rating: typeof p.rating === 'number' && p.rating > 0 ? p.rating : null,
        openTime: p.open_time || null,
        photo: Array.isArray(p.photos) && p.photos[0] ? String(p.photos[0]) : null,
      } satisfies HotspotDetail;
    } catch (err) {
      // A failed call is not a "no details" answer — drop it from the cache so
      // the next tap retries instead of seeing the failure forever.
      detailCache.delete(amapId);
      throw err;
    }
  })();
  detailCache.set(amapId, pending);
  if (detailCache.size > 200) detailCache.clear();
  return pending;
}

export interface HotspotLabels {
  add: string;
  loading: string;
  noDetail: string;
}

export interface HotspotPopup {
  element: HTMLDivElement;
  /** Fill the detail section once the lookup settles (null = nothing found). */
  fill: (detail: HotspotDetail | null) => void;
}

/**
 * The popup itself, built as DOM (hazardPopup's pattern) because AMap
 * InfoWindow content accepts an element and real nodes keep the button's
 * listener attached without global event hacks. The add button works before
 * the details arrive — a slow lookup must not block adding a place whose name
 * and coordinate the tap already carried.
 */
export function hotspotPopup(opts: { hotspot: MapHotspot; labels: HotspotLabels; onAdd: (poi: HotspotPoi) => void }): HotspotPopup {
  const { hotspot, labels } = opts;
  const box = document.createElement('div');
  box.className = 'flex max-w-[240px] flex-col gap-1.5 text-content';
  box.style.fontSize = '13px';
  box.style.lineHeight = '1.45';

  const title = document.createElement('div');
  title.className = 'pr-5 font-semibold';
  title.textContent = hotspot.name;
  box.append(title);

  const detailLine = document.createElement('div');
  detailLine.className = 'whitespace-pre-line text-xs text-content-secondary';
  detailLine.textContent = hotspot.amapId ? labels.loading : labels.noDetail;
  box.append(detailLine);

  const photo = document.createElement('img');
  photo.alt = '';
  photo.referrerPolicy = 'no-referrer';
  photo.style.cssText = 'display:none;width:100%;max-height:110px;object-fit:cover;border-radius:6px';
  photo.addEventListener('load', () => {
    photo.style.display = 'block';
  });
  photo.addEventListener('error', () => {
    photo.remove();
  });
  box.append(photo);

  let detail: HotspotDetail | null = null;
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'mt-0.5 self-start rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-text';
  add.textContent = labels.add;
  add.addEventListener('click', () => {
    opts.onAdd({
      lat: hotspot.lat,
      lng: hotspot.lng,
      name: hotspot.name,
      address: detail?.address ?? null,
      website: null,
      phone: detail?.phone ?? null,
      // No id (rare, but hotspots can lack one): no osm_id — the form falls
      // back to coordinates for dedup and the photo cache, exactly like a
      // right-click place.
      osm_id: hotspot.amapId ? `amap:${hotspot.amapId}` : '',
    });
  });
  box.append(add);

  return {
    element: box,
    fill(d) {
      detail = d;
      if (!d) {
        detailLine.textContent = labels.noDetail;
        return;
      }
      const lines = [d.address, d.rating != null ? `⭐ ${d.rating}` : null, d.openTime, d.phone]
        .filter(Boolean)
        .join('\n');
      detailLine.textContent = lines || labels.noDetail;
      detailLine.style.display = lines ? '' : 'none';
      if (d.photo) photo.src = d.photo;
    },
  };
}

/**
 * Bind `hotspotclick` on the map. Returns the detach function — the renderer
 * calls it in the same teardown that unbinds its own map listeners.
 *
 * The tap also lands on the map itself, so the renderer's suppress-click must
 * eat the follow-up `click` (a place would otherwise be deselected right
 * under the popup). InfoWindow position stays in GCJ-02 — only the POI that
 * travels into TT's data crosses the datum boundary (MAP-ENGINES.md rule).
 */
export function attachAmapHotspots(opts: {
  map: any;
  AMap: any;
  /** The renderer's shared InfoWindow ref; created lazily on first tap. */
  info: { current: any };
  suppressClick: () => void;
  getLabels: () => HotspotLabels;
  onAdd: (poi: HotspotPoi) => void;
}): () => void {
  const onHotspotClick = (event: any) => {
    const ll = event?.lnglat;
    if (!ll || typeof ll.getLng !== 'function' || typeof ll.getLat !== 'function') return;
    opts.suppressClick();
    const lng = Number(ll.getLng());
    const lat = Number(ll.getLat());
    const w = gcj02ToWgs84(lng, lat);
    const hotspot: MapHotspot = {
      lat: w.lat,
      lng: w.lng,
      name: String(event.name || ''),
      amapId: String(event.id || ''),
    };
    const info = opts.info.current || (opts.AMap.InfoWindow ? new opts.AMap.InfoWindow({ offset: [0, -8], isCustom: false }) : null);
    if (!info) return;
    opts.info.current = info;
    const popup = hotspotPopup({
      hotspot,
      labels: opts.getLabels(),
      onAdd: (poi) => {
        info.close();
        opts.onAdd(poi);
      },
    });
    info.setContent(popup.element);
    info.open(opts.map, [lng, lat]);
    if (!hotspot.amapId) return;
    fetchHotspotDetail(hotspot.amapId)
      .then((d) => popup.fill(d))
      .catch(() => popup.fill(null));
  };
  opts.map.on('hotspotclick', onHotspotClick);
  return () => opts.map.off('hotspotclick', onHotspotClick);
}
