import type { RoadtripVia } from '@trek/shared';
import { gcj02ToWgs84, wgs84ToGcj02 } from './engines/amap';

/**
 * The handles that shape a drive, on the AMap renderer — TT's own, because
 * upstream has no AMap engine (see docs/MAP-ENGINES.md).
 *
 * The datum is load-bearing: AMap reports GCJ-02; TT stores WGS-84. Conversion is
 * done only at the marker boundary, never in the route or persistence layers.
 *
 * The manager is stateful, for two reasons learned the hard way:
 *
 *  - A route write hands back a fresh via array, so a manager that cleared and
 *    rebuilt its markers destroyed the one under the user's finger. Existing
 *    markers are therefore updated in place.
 *  - The zoom gate has to be read on every update, not once at construction. The
 *    map mounts at zoom 5, below the gate, so a latched answer meant no handle was
 *    ever drawn at all.
 *
 * Deletion is a drop zone rather than a gesture on the dot. A long press is not
 * usable in a browser — it selects the page's text instead of firing, because the
 * browser claims that gesture — and a 12px dot has no room for a delete control.
 * So a tap selects the handle and a zone appears on screen to drop it into; the
 * tap and the drop are both gestures a finger already makes.
 */

export interface AmapViaApi {
  Marker?: new (options?: Record<string, unknown>) => AmapViaMarker;
}

export interface AmapViaMarker {
  setMap: (map: unknown | null) => void;
  on?: (event: string, handler: (e?: unknown) => void) => void;
  off?: (event: string, handler?: (e?: unknown) => void) => void;
  setPosition?: (position: [number, number]) => void;
  setContent?: (content: string | HTMLElement) => void;
  setDraggable?: (draggable: boolean) => void;
  getPosition?: () => unknown;
}

export interface AmapViaMap {
  add?: (overlay: unknown) => void;
  remove?: (overlay: unknown) => void;
  /** Present on the real map; used to turn a dropped coordinate into a screen point. */
  lngLatToContainer?: (position: [number, number]) => { getX?: () => number; getY?: () => number } | null;
}

/** Below this the handles are not drawn. */
export const VIA_MIN_ZOOM = 9;
export const AMAP_VIA_MIN_ZOOM = VIA_MIN_ZOOM;

/** The same 12px dot the Leaflet renderer draws. */
export const AMAP_VIA_ICON_HTML =
  '<span style="display:block;width:12px;height:12px;border-radius:9999px;background:#0a84ff;border:2.5px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,.45);cursor:grab;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:none;"></span>';

/**
 * The selected dot: same size, ringed.
 *
 * Selecting must be visible without moving the dot — the point is to drag it into
 * the zone, and a handle that jumps when tapped is one the user then has to find
 * again.
 */
export const AMAP_VIA_ICON_SELECTED_HTML =
  '<span style="display:block;width:12px;height:12px;border-radius:9999px;background:#0a84ff;border:2.5px solid #ffffff;box-shadow:0 0 0 6px rgba(10,132,255,.35),0 1px 4px rgba(0,0,0,.45);cursor:grabbing;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:none;"></span>';

/** A screen rectangle the user can drop a handle into to remove it. */
export interface AmapDropZone {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const toGcjPosition = (via: RoadtripVia): [number, number] => {
  const p = wgs84ToGcj02(via.lng, via.lat);
  return [p.lng, p.lat];
};

function draggedLngLat(event: unknown): { lng: number; lat: number } | null {
  const lnglat = (event as { lnglat?: { getLng?: () => number; getLat?: () => number } } | null)?.lnglat;
  const lng = Number(lnglat?.getLng?.());
  const lat = Number(lnglat?.getLat?.());
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

/** Where the drag ended, in viewport pixels, from whichever shape AMap hands back. */
function droppedPoint(event: unknown): { x: number; y: number } | null {
  const e = event as {
    pixel?: { getX?: () => number; getY?: () => number };
    point?: { x?: number; y?: number };
  } | null;
  const px = e?.pixel?.getX?.();
  const py = e?.pixel?.getY?.();
  if (Number.isFinite(px) && Number.isFinite(py)) return { x: Number(px), y: Number(py) };
  const x = e?.point?.x;
  const y = e?.point?.y;
  if (Number.isFinite(x) && Number.isFinite(y)) return { x: Number(x), y: Number(y) };
  return null;
}

function inZone(point: { x: number; y: number } | null, zone: AmapDropZone | null): boolean {
  if (!point || !zone) return false;
  return point.x >= zone.left && point.x <= zone.right && point.y >= zone.top && point.y <= zone.bottom;
}

export interface AmapViaHandlers {
  /** Called with WGS-84, converted here from what AMap reported. */
  onMove?: (dayId: number, id: number, lat: number, lng: number) => void;
  onRemove?: (dayId: number, id: number) => void;
  /** A tap on a handle, or `null` when the selection is dropped. */
  onSelect?: (selection: { dayId: number; id: number } | null) => void;
}

export interface AmapViaManager {
  readonly count: number;
  update: (vias: readonly RoadtripVia[], handlers: AmapViaHandlers, zoom: number) => void;
  /** Which handle is ringed. Keyed by `dayId:id`, or null for none. */
  setSelected: (key: string | null) => void;
  /** Where a handle may be dropped to be removed. Null hides the behaviour. */
  setDropZone: (zone: AmapDropZone | null) => void;
  clear: () => void;
}

type DrawnVia = {
  marker: AmapViaMarker;
  dayId: number;
  id: number;
  markerListeners: { type: string; handler: (event?: unknown) => void }[];
};

function handleKey(dayId: number, id: number): string {
  return `${dayId}:${id}`;
}

/**
 * Draw or update the handles. Existing markers are moved in place; they are only
 * destroyed when their via disappears, the layer is cleared, or the zoom gate closes.
 */
export function applyViasAmap(
  api: AmapViaApi,
  map: AmapViaMap,
  vias: readonly RoadtripVia[],
  handlers: AmapViaHandlers,
  zoom: number,
): AmapViaManager {
  const Marker = api.Marker;
  const drawn = new Map<string, DrawnVia>();
  let currentHandlers = handlers;
  let selectedKey: string | null = null;
  let dropZone: AmapDropZone | null = null;

  /**
   * The zoom gate is evaluated on every update, never latched.
   *
   * It used to be checked once, at construction, and the manager built below the
   * threshold was a no-op shell that `update` could never escape. The map mounts
   * at zoom 5 — below the gate — so the manager was always that shell and no
   * handle could ever appear, at any zoom.
   */
  const handlesHidden = (nextZoom: number, nextHandlers: AmapViaHandlers): boolean =>
    !Marker || (nextZoom < AMAP_VIA_MIN_ZOOM && !!nextHandlers.onMove);

  const paint = (entry: DrawnVia): void => {
    entry.marker.setContent?.(handleKey(entry.dayId, entry.id) === selectedKey ? AMAP_VIA_ICON_SELECTED_HTML : AMAP_VIA_ICON_HTML);
  };

  const removeEntry = (key: string, entry: DrawnVia): void => {
    for (const listener of entry.markerListeners) entry.marker.off?.(listener.type, listener.handler);
    entry.marker.setMap(null);
    drawn.delete(key);
  };

  const createEntry = (via: RoadtripVia): DrawnVia => {
    const marker = new Marker({
      position: toGcjPosition(via),
      // A string, not an element: AMap mounts the content itself, so an element
      // created here is never the one on the map and styling it changes nothing.
      content: AMAP_VIA_ICON_HTML,
      draggable: !!currentHandlers.onMove,
      zIndex: 400,
      offset: [-6, -6],
    });
    const entry: DrawnVia = { marker, dayId: via.day_id, id: via.id, markerListeners: [] };
    const on = (type: string, handler: (event?: unknown) => void): void => {
      marker.on?.(type, handler);
      entry.markerListeners.push({ type, handler });
    };

    // A tap selects. On a touchscreen this is also how the handle is picked up for
    // the drop zone, since there is no hover and no right button.
    on('click', () => {
      selectedKey = handleKey(entry.dayId, entry.id);
      for (const other of drawn.values()) paint(other);
      currentHandlers.onSelect?.({ dayId: entry.dayId, id: entry.id });
    });

    on('dragend', (event) => {
      if (!currentHandlers.onMove && !currentHandlers.onRemove) return;
      // Dropped into the zone: that is the delete. Checked before the move so a
      // drag out of the zone and back does not half-apply.
      const point = droppedPoint(event) ?? screenPointOf(map, event);
      if (inZone(point, dropZone)) {
        currentHandlers.onRemove?.(entry.dayId, entry.id);
        return;
      }
      if (!currentHandlers.onMove) return;
      const at = draggedLngLat(event);
      if (!at) return;
      const wgs = gcj02ToWgs84(at.lng, at.lat);
      currentHandlers.onMove(entry.dayId, entry.id, wgs.lat, wgs.lng);
    });

    // Desktop: a right-click still removes outright, which is quicker than
    // selecting and dragging for someone with a mouse.
    on('rightclick', () => currentHandlers.onRemove?.(entry.dayId, entry.id));

    marker.setMap(map);
    return entry;
  };

  /** Fall back to projecting the reported coordinate when the event carries no pixel. */
  const screenPointOf = (target: AmapViaMap, event: unknown): { x: number; y: number } | null => {
    const at = draggedLngLat(event);
    if (!at || !target.lngLatToContainer) return null;
    const p = target.lngLatToContainer([at.lng, at.lat]);
    const x = Number(p?.getX?.());
    const y = Number(p?.getY?.());
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  };

  const update = (nextVias: readonly RoadtripVia[], nextHandlers: AmapViaHandlers, nextZoom: number): void => {
    currentHandlers = nextHandlers;
    // Re-read every time: the zoom changes under this manager, and a latched
    // answer is what kept the handles off the map entirely.
    if (handlesHidden(nextZoom, nextHandlers)) {
      for (const [key, entry] of drawn) removeEntry(key, entry);
      return;
    }
    const wanted = new Set<string>();
    for (const via of nextVias) {
      const key = handleKey(via.day_id, via.id);
      wanted.add(key);
      const existing = drawn.get(key);
      if (existing) {
        existing.dayId = via.day_id;
        existing.id = via.id;
        existing.marker.setPosition?.(toGcjPosition(via));
        existing.marker.setDraggable?.(!!nextHandlers.onMove);
        // The callbacks are read through currentHandlers, so no listener is rebound.
        continue;
      }
      const entry = createEntry(via);
      paint(entry);
      drawn.set(key, entry);
    }
    // Anything the caller no longer holds — moved to another day, deleted, or the
    // route re-anchored — comes off. This is the only place a marker is destroyed.
    for (const [key, entry] of drawn) if (!wanted.has(key)) removeEntry(key, entry);
    // A selection whose handle has gone is no longer a selection.
    if (selectedKey && !wanted.has(selectedKey)) {
      selectedKey = null;
      currentHandlers.onSelect?.(null);
    }
  };

  update(vias, handlers, zoom);

  return {
    get count(): number {
      return drawn.size;
    },
    update,
    setSelected(key: string | null): void {
      selectedKey = key;
      for (const entry of drawn.values()) paint(entry);
    },
    setDropZone(zone: AmapDropZone | null): void {
      dropZone = zone;
    },
    clear(): void {
      for (const [key, entry] of drawn) removeEntry(key, entry);
      selectedKey = null;
    },
  };
}
