import type { RoadtripVia } from '@trek/shared';
import { gcj02ToWgs84, wgs84ToGcj02 } from './engines/amap';

/**
 * The handles that shape a drive, on the AMap renderer — TT's own, because
 * upstream has no AMap engine (see docs/MAP-ENGINES.md).
 *
 * This is the one place in the whole port where a drag writes data, and that
 * makes the datum the load-bearing detail. AMap reports a dragged marker in
 * GCJ-02; every via in TT is WGS-84, and the server stores what it is sent. Hand
 * the GCJ-02 pair straight back and the whole route shifts a few hundred metres
 * east — which looks like a routing bug, not a units bug, and is exactly the
 * class of mistake the unit tests cannot see: they stub the transform, so a
 * reversed or missing conversion still passes.
 *
 * So the rule this file exists to enforce: `gcj02ToWgs84` on the way OUT
 * (dragend → onMoveVia), `wgs84ToGcj02` on the way IN (via → marker position).
 * Nothing else in here ever touches a coordinate.
 *
 * Why this is much shorter than the GL twin: MapLibre has no draggable marker,
 * so upstream hand-writes pointerdown/move/up/cancel, a moved-enough threshold
 * to tell a drag from a click, and five `preventDefault` handlers to stop the
 * map panning underneath. An AMap marker takes `draggable: true` and reports
 * `dragend` with the new position, so the hard part there is simply absent here.
 */

/** The AMap constructors this needs. Narrowed so a test can pass a stub. */
export interface AmapViaApi {
  Marker?: new (options?: Record<string, unknown>) => AmapViaMarker;
}

export interface AmapViaMarker {
  setMap: (map: unknown | null) => void;
  on?: (event: string, handler: (e?: unknown) => void) => void;
  setPosition?: (position: [number, number]) => void;
}

export interface AmapViaMap {
  add?: (overlay: unknown) => void;
  remove?: (overlay: unknown) => void;
}

/**
 * Below this the handles are not drawn.
 *
 * A via is a handle for a few hundred metres of road. Zoomed out, a day's worth
 * of them piles into one town and dragging one moves the route by kilometres per
 * pixel. Shared with the other two renderers' own copies so the three agree on
 * when the handles exist.
 */
export const VIA_MIN_ZOOM = 9;
export const AMAP_VIA_MIN_ZOOM = VIA_MIN_ZOOM;

/** The same 12px dot the Leaflet renderer draws, so the two look alike. */
export const AMAP_VIA_ICON_HTML =
  '<span style="display:block;width:12px;height:12px;border-radius:9999px;background:#0a84ff;border:2.5px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,.45);cursor:grab;"></span>';

/** `[lng, lat]` in GCJ-02, which is what an AMap marker wants. */
const toGcjPosition = (via: RoadtripVia): [number, number] => {
  const p = wgs84ToGcj02(via.lng, via.lat);
  return [p.lng, p.lat];
};

/** Read a dragged position back out of whatever shape the event carries. */
function draggedLngLat(event: unknown): { lng: number; lat: number } | null {
  const lnglat = (event as { lnglat?: { getLng?: () => number; getLat?: () => number } } | null)?.lnglat;
  const lng = Number(lnglat?.getLng?.());
  const lat = Number(lnglat?.getLat?.());
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

export interface AmapViaHandlers {
  /** Called with WGS-84, converted here from what AMap reported. */
  onMove?: (dayId: number, id: number, lat: number, lng: number) => void;
  onRemove?: (dayId: number, id: number) => void;
}

/**
 * Draw the handles, replacing whatever this manager drew before.
 *
 * A via is not draggable when there is no move handler: a read-only viewer must
 * not be handed a handle that silently does nothing, which is worse than no
 * handle — it looks broken.
 */
export function applyViasAmap(
  api: AmapViaApi,
  map: AmapViaMap,
  vias: readonly RoadtripVia[],
  handlers: AmapViaHandlers,
  zoom: number
) {
  const drawn: AmapViaMarker[] = [];
  const Marker = api.Marker;

  // Zoomed out, the handles go away. A read-only viewer keeps them, because with
  // no map to shape there is nothing to zoom in for.
  if (!Marker || (zoom < AMAP_VIA_MIN_ZOOM && handlers.onMove)) {
    return { clear() {}, count: 0 };
  }

  for (const via of vias) {
    const marker = new Marker({
      position: toGcjPosition(via),
      content: AMAP_VIA_ICON_HTML,
      draggable: !!handlers.onMove,
      zIndex: 400,
      // The dot is 12px, so its centre is 6px in from the corner.
      offset: [-6, -6],
    });

    marker.on?.('dragend', (event) => {
      if (!handlers.onMove) return;
      const at = draggedLngLat(event);
      if (!at) return;
      // The load-bearing line: AMap reported GCJ-02, TT stores WGS-84.
      const wgs = gcj02ToWgs84(at.lng, at.lat);
      handlers.onMove(via.day_id, via.id, wgs.lat, wgs.lng);
    });

    // A right-click rather than a delete handle: a 12px dot has no room for one,
    // and the same gesture removes things elsewhere on the map. AMap names the
    // marker-level event `rightclick`; `contextmenu` is the map's own.
    marker.on?.('rightclick', () => handlers.onRemove?.(via.day_id, via.id));

    drawn.push(marker);
  }

  for (const marker of drawn) marker.setMap(map);

  return {
    /** The number of handles actually drawn, for a caller that wants to say so. */
    count: drawn.length,
    /** Take every handle off the map (mode off, zoomed out, unmount). */
    clear() {
      for (const marker of drawn) marker.setMap(null);
      drawn.length = 0;
    },
  };
}
