import type { RoadtripVia } from '@trek/shared';
import { gcj02ToWgs84, wgs84ToGcj02 } from './engines/amap';

/**
 * The handles that shape a drive, on the AMap renderer — TT's own, because
 * upstream has no AMap engine (see docs/MAP-ENGINES.md).
 *
 * The datum is load-bearing: AMap reports GCJ-02; TT stores WGS-84. Conversion is
 * done only at the marker boundary, never in the route or persistence layers.
 *
 * The manager is deliberately stateful. A route write causes React to hand the map
 * a fresh via array; clearing and recreating every marker at that point destroys the
 * marker under a user's finger. On a touchscreen that is exactly the difference
 * between "drag the same handle again" and "pan the map".
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
}

export interface AmapViaMap {
  add?: (overlay: unknown) => void;
  remove?: (overlay: unknown) => void;
}

/** Below this the handles are not drawn. */
export const VIA_MIN_ZOOM = 9;
export const AMAP_VIA_MIN_ZOOM = VIA_MIN_ZOOM;

/** The mobile deletion gesture. */
export const AMAP_VIA_LONG_PRESS_MS = 600;
export const AMAP_VIA_LONG_PRESS_TOLERANCE_PX = 10;

/** The same 12px dot the Leaflet renderer draws. */
export const AMAP_VIA_ICON_HTML =
  '<span style="display:block;width:12px;height:12px;border-radius:9999px;background:#0a84ff;border:2.5px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,.45);cursor:grab;touch-action:none;"></span>';

/** Visible while a long press is counting down. */
export const AMAP_VIA_ICON_ARMED_HTML =
  '<span style="display:block;width:12px;height:12px;border-radius:9999px;background:#ff9f0a;border:2.5px solid #ffffff;box-shadow:0 0 0 6px rgba(255,159,10,.35),0 1px 4px rgba(0,0,0,.45);cursor:grabbing;touch-action:none;"></span>';

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

export interface AmapViaHandlers {
  onMove?: (dayId: number, id: number, lat: number, lng: number) => void;
  onRemove?: (dayId: number, id: number) => void;
}

export interface AmapViaManager {
  count: number;
  update: (vias: readonly RoadtripVia[], handlers: AmapViaHandlers, zoom: number) => void;
  clear: () => void;
}

type Timer = number;

type DrawnVia = {
  marker: AmapViaMarker;
  dayId: number;
  id: number;
  markerListeners: { type: string; handler: (event?: unknown) => void }[];
  domListeners: { element: HTMLElement; type: string; handler: EventListener }[];
  timer: Timer | null;
  startAt: { x: number; y: number } | null;
  element: HTMLElement | null;
};

function handleKey(dayId: number, id: number): string {
  return `${dayId}:${id}`;
}

function handleElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const element = document.createElement('span');
  element.style.cssText =
    'display:block;width:12px;height:12px;border-radius:9999px;background:#0a84ff;' +
    'border:2.5px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,.45);' +
    'cursor:grab;touch-action:none;';
  return element;
}

function setElementArmed(entry: DrawnVia, armed: boolean): void {
  if (!entry.element) return;
  entry.element.style.background = armed ? '#ff9f0a' : '#0a84ff';
  entry.element.style.boxShadow = armed
    ? '0 0 0 6px rgba(255,159,10,.35),0 1px 4px rgba(0,0,0,.45)'
    : '0 1px 4px rgba(0,0,0,.45)';
  entry.element.style.cursor = armed ? 'grabbing' : 'grab';
}

function touchPoint(event: Event): { x: number; y: number } | null {
  const touch = (event as TouchEvent).touches?.[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
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
) {
  const Marker = api.Marker;
  const drawn = new Map<string, DrawnVia>();
  let currentHandlers = handlers;

  if (!Marker || (zoom < AMAP_VIA_MIN_ZOOM && handlers.onMove)) {
    return { count: 0, update() {}, clear() {} };
  }

  const cancelHold = (entry: DrawnVia): void => {
    if (entry.timer !== null) window.clearTimeout(entry.timer);
    entry.timer = null;
    entry.startAt = null;
    setElementArmed(entry, false);
  };

  const removeEntry = (key: string, entry: DrawnVia): void => {
    cancelHold(entry);
    for (const listener of entry.markerListeners) entry.marker.off?.(listener.type, listener.handler);
    for (const listener of entry.domListeners) listener.element.removeEventListener(listener.type, listener.handler);
    entry.marker.setMap(null);
    drawn.delete(key);
  };

  const bindTouchRemoval = (entry: DrawnVia): void => {
    const element = entry.element;
    if (!element || !currentHandlers.onRemove) return;

    const onStart: EventListener = (event) => {
      const point = touchPoint(event);
      if (!point) return;
      entry.startAt = point;
      setElementArmed(entry, true);
      entry.timer = window.setTimeout(() => {
        entry.timer = null;
        entry.startAt = null;
        setElementArmed(entry, false);
        currentHandlers.onRemove?.(entry.dayId, entry.id);
      }, AMAP_VIA_LONG_PRESS_MS);
    };
    const onMove: EventListener = (event) => {
      const point = touchPoint(event);
      const start = entry.startAt;
      if (!point || !start) return;
      if (Math.hypot(point.x - start.x, point.y - start.y) > AMAP_VIA_LONG_PRESS_TOLERANCE_PX) cancelHold(entry);
    };
    const onEnd: EventListener = () => cancelHold(entry);

    element.addEventListener('touchstart', onStart, { passive: true });
    element.addEventListener('touchmove', onMove, { passive: true });
    element.addEventListener('touchend', onEnd, { passive: true });
    element.addEventListener('touchcancel', onEnd, { passive: true });
    entry.domListeners.push(
      { element, type: 'touchstart', handler: onStart },
      { element, type: 'touchmove', handler: onMove },
      { element, type: 'touchend', handler: onEnd },
      { element, type: 'touchcancel', handler: onEnd },
    );
  };

  const createEntry = (via: RoadtripVia): DrawnVia => {
    const element = handleElement();
    const marker = new Marker({
      position: toGcjPosition(via),
      content: element ?? AMAP_VIA_ICON_HTML,
      draggable: !!currentHandlers.onMove,
      zIndex: 400,
      offset: [-6, -6],
    });
    const entry: DrawnVia = {
      marker,
      dayId: via.day_id,
      id: via.id,
      markerListeners: [],
      domListeners: [],
      timer: null,
      startAt: null,
      element,
    };
    const on = (type: string, handler: (event?: unknown) => void): void => {
      marker.on?.(type, handler);
      entry.markerListeners.push({ type, handler });
    };
    on('dragend', (event) => {
      cancelHold(entry);
      if (!currentHandlers.onMove) return;
      const at = draggedLngLat(event);
      if (!at) return;
      const wgs = gcj02ToWgs84(at.lng, at.lat);
      currentHandlers.onMove(entry.dayId, entry.id, wgs.lat, wgs.lng);
    });
    // Desktop mouse fallback. Touch devices use the long-press DOM handlers below.
    on('rightclick', () => currentHandlers.onRemove?.(entry.dayId, entry.id));
    bindTouchRemoval(entry);
    marker.setMap(map);
    return entry;
  };

  const update = (nextVias: readonly RoadtripVia[], nextHandlers: AmapViaHandlers, nextZoom: number): void => {
    currentHandlers = nextHandlers;
    if (nextZoom < AMAP_VIA_MIN_ZOOM && nextHandlers.onMove) {
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
      drawn.set(key, createEntry(via));
    }
    for (const [key, entry] of drawn) if (!wanted.has(key)) removeEntry(key, entry);
  };

  update(vias, handlers, zoom);

  return {
    get count(): number {
      return drawn.size;
    },
    update,
    clear(): void {
      for (const [key, entry] of drawn) removeEntry(key, entry);
    },
  };
}
