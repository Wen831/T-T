import { trailSegments } from './dawarichTrail'
import type { DawarichTrack } from '@trek/shared'
import { wgs84ToGcj02 } from './engines/amap'

/**
 * The recorded trail on the AMap renderer — TT's own twin of the Leaflet layer
 * and the MapLibre source, because upstream has no AMap engine to port from.
 *
 * Same construction as those two: every drawable segment is one casing line
 * under one coloured dashed line, so a recording that crosses several days
 * reads as several day-coloured pieces rather than one long stroke. The
 * coordinates are converted WGS-84 → GCJ-02 at the boundary, like every other
 * thing this renderer draws.
 *
 * Kept as a plain function over a minimal AMap surface rather than inside the
 * component: the same shape `amapOverlays` uses, so it stays testable without
 * a map.
 */
export interface TrailOverlayApi {
  Polyline: new (options?: Record<string, unknown>) => TrailOverlay
}
export interface TrailOverlay {
  setMap: (map: unknown | null) => void
  setPath?: (path: [number, number][]) => void
}
export interface TrailMap {
  add?: (overlay: unknown) => void
  remove?: (overlay: unknown) => void
}

/** The casing under every line, so a light day colour stays readable on a pale map. */
export const DAWARICH_TRAIL_CASING = '#111827' // theme-lint-disable — map paint

/** Draw the trail, replacing whatever this manager drew before. Returns the manager. */
export function applyDawarichTrailAmap(
  api: TrailOverlayApi,
  map: TrailMap,
  segments: ReturnType<typeof trailSegments>,
) {
  const drawn: TrailOverlay[] = []

  const path = (points: Array<[number, number]>): [number, number][] =>
    points.map(([lat, lng]) => {
      const p = wgs84ToGcj02(lng, lat)
      return [p.lng, p.lat] as [number, number]
    })

  // Casing first, in its own pass, so every coloured line sits above every casing
  // rather than each above its own — the order the Leaflet panes and the GL
  // layer-before-symbol order give the other two renderers.
  for (const segment of segments) {
    if (segment.points.length < 2) continue
    drawn.push(
      new api.Polyline({
        path: path(segment.points),
        strokeColor: DAWARICH_TRAIL_CASING,
        strokeWeight: 6,
        strokeOpacity: 0.55,
        lineCap: 'round',
        lineJoin: 'round',
        zIndex: 40,
        bubble: false,
      }),
    )
  }
  for (const segment of segments) {
    if (segment.points.length < 2) continue
    drawn.push(
      new api.Polyline({
        path: path(segment.points),
        strokeColor: segment.color,
        strokeWeight: 3,
        strokeOpacity: 0.85,
        strokeStyle: 'dashed',
        strokeDasharray: [6, 5],
        lineCap: 'round',
        lineJoin: 'round',
        zIndex: 41,
        bubble: false,
      }),
    )
  }

  for (const overlay of drawn) overlay.setMap(map)

  return {
    /** Take the whole trail off the map (day toggles, addon off, unmount). */
    clear() {
      for (const overlay of drawn) overlay.setMap(null)
      drawn.length = 0
    },
  }
}

/** Convenience for the renderer: flatten and draw in one call. */
export function applyTrackAmap(
  api: TrailOverlayApi,
  map: TrailMap,
  track: DawarichTrack | null,
  selectedDate?: string | null,
  hiddenDates?: ReadonlySet<string> | null,
) {
  return applyDawarichTrailAmap(api, map, trailSegments(track, selectedDate, hiddenDates))
}
