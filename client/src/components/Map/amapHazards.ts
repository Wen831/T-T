import type { RoadtripHazard } from '@trek/shared';
import { wgs84ToGcj02 } from './engines/amap';

/**
 * Weather and disaster notices on the AMap renderer — TT's own, because
 * upstream has no AMap engine to port from (see docs/MAP-ENGINES.md).
 *
 * The notices arrive as GeoJSON, and this file is the one place that decides how
 * a `Point` / `Polygon` / `MultiPolygon` becomes an AMap overlay. The other two
 * renderers do the same job their own way: Leaflet hands the feature to
 * `<GeoJSON>`, MapLibre builds a source and three layers. None of them is a
 * template for this one — an AMap `Polygon` takes a flat ring and an
 * `InfoWindow` takes a DOM node, so the shapes genuinely differ.
 *
 * Coordinates cross the datum here: everything upstream of this file is WGS-84,
 * AMap speaks GCJ-02, and every vertex is converted on the way in. Nothing
 * converted ever leaves this file — these are read-only overlays, so there is no
 * path back out to get wrong.
 *
 * Kept as a plain function over a minimal AMap surface rather than inside the
 * component, for the same reason `amapDawarichTrail` is: it stays testable
 * without a map.
 */

/** The AMap constructors this needs. Narrowed so a test can pass a stub. */
export interface AmapHazardApi {
  Polygon?: new (options?: Record<string, unknown>) => AmapHazardOverlay;
  CircleMarker?: new (options?: Record<string, unknown>) => AmapHazardOverlay;
  Circle?: new (options?: Record<string, unknown>) => AmapHazardOverlay;
  InfoWindow?: new (options?: Record<string, unknown>) => AmapHazardInfoWindow;
}

export interface AmapHazardOverlay {
  setMap: (map: unknown | null) => void;
  on?: (event: string, handler: () => void) => void;
}

export interface AmapHazardInfoWindow {
  setContent: (content: unknown) => void;
  open: (map: unknown, position: [number, number]) => void;
  close: () => void;
}

export interface AmapHazardMap {
  add?: (overlay: unknown) => void;
  remove?: (overlay: unknown) => void;
}

/** The amber the other two renderers draw these in, so the three agree. */
export const HAZARD_FILL_OPACITY = 0.16;
/** A point notice has no area, so it is drawn as a disc of this radius in metres. */
export const HAZARD_POINT_RADIUS_M = 12000;

/** `[lng, lat]` in GCJ-02, which is what every AMap constructor wants. */
const toGcj = ([lng, lat]: [number, number]): [number, number] => {
  const p = wgs84ToGcj02(lng, lat);
  return [p.lng, p.lat];
};

/**
 * The rings an AMap `Polygon` takes, from a GeoJSON `Polygon` or `MultiPolygon`.
 *
 * A hole is a hole to both formats, so the rings are passed through in order:
 * GeoJSON's first ring is the outline and the rest are holes, which is the same
 * contract AMap documents.
 */
function polygonPaths(geometry: RoadtripHazard['geometry']): [number, number][][][] {
  if (geometry.type === 'Polygon') return [geometry.coordinates.map((ring) => ring.map(toGcj))];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((poly) => poly.map((ring) => ring.map(toGcj)));
  return [];
}

/**
 * Draw the notices, replacing whatever this manager drew before. Returns the
 * manager, whose `clear()` takes them all back off.
 *
 * A notice whose geometry the renderer cannot draw is skipped rather than
 * thrown over: one malformed entry in a feed of a hundred should cost that
 * entry, not the whole layer.
 */
export function applyHazardsAmap(
  api: AmapHazardApi,
  map: AmapHazardMap,
  hazards: readonly RoadtripHazard[],
  popup: () => AmapHazardInfoWindow | null,
  content: (hazard: RoadtripHazard) => unknown,
  color: string
) {
  const drawn: AmapHazardOverlay[] = [];

  for (const hazard of hazards) {
    const geometry = hazard.geometry;

    if (geometry.type === 'Point') {
      const Marker = api.Circle ?? api.CircleMarker;
      if (!Marker) continue;
      const [lng, lat] = toGcj(geometry.coordinates as [number, number]);
      const dot = new Marker({
        center: [lng, lat],
        radius: HAZARD_POINT_RADIUS_M,
        strokeColor: color,
        strokeWeight: 2,
        strokeOpacity: 1,
        fillColor: color,
        fillOpacity: 0.65,
      });
      bindDetail(dot, popup, content(hazard), map, [lng, lat]);
      drawn.push(dot);
      continue;
    }

    if (!api.Polygon) continue;
    const paths = polygonPaths(geometry);
    for (const path of paths) {
      if (path.length === 0) continue;
      const shape = new api.Polygon({
        path,
        strokeColor: color,
        strokeWeight: 2,
        strokeOpacity: 1,
        fillColor: color,
        fillOpacity: HAZARD_FILL_OPACITY,
      });
      // A notice with no single point of its own opens at the first vertex: the
      // popup needs somewhere to be, and the corner of the area it describes is
      // the honest answer.
      bindDetail(shape, popup, content(hazard), map, path[0][0]);
      drawn.push(shape);
    }
  }

  for (const overlay of drawn) overlay.setMap(map);

  return {
    /** Take every notice off the map (layer toggled off, addon off, unmount). */
    clear() {
      for (const overlay of drawn) overlay.setMap(null);
      drawn.length = 0;
    },
  };
}

/**
 * Give one overlay its popup.
 *
 * The window is created per click and closed on the way out rather than kept:
 * one shared window across a hundred notices would need to be told which one it
 * currently belongs to, and the AMap default is that opening a second one does
 * not close the first.
 */
function bindDetail(
  overlay: AmapHazardOverlay,
  popup: () => AmapHazardInfoWindow | null,
  content: unknown,
  map: AmapHazardMap,
  at: [number, number]
) {
  if (!overlay.on) return;
  overlay.on('click', () => {
    const window_ = popup();
    if (!window_) return;
    window_.setContent(content);
    window_.open(map, at);
  });
}
