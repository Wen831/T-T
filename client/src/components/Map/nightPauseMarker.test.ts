import { describe, expect, it } from 'vitest';
import type { RouteVia } from '../../types';
import { NIGHT_PAUSE_MIN_ZOOM, nightPauseMarker } from './nightPauseMarker';

/**
 * The night-stop marker, shared by all three renderers.
 *
 * It returns an HTML string rather than an element because that is the one shape
 * every engine accepts: Leaflet wraps it in a `divIcon`, MapLibre sets it as
 * `innerHTML`, and an AMap marker takes it as `content`. Delegating the drawing
 * to one function is what keeps the three from drifting into three marks that
 * each say the same thing slightly differently.
 */
const via = (over: Partial<RouteVia['nightPause']> = {}): RouteVia =>
  ({
    lat: 48.8566,
    lng: 2.3522,
    tone: 'default',
    label: 'Night 1',
    nightPause: { day: 1, atPlace: false, ...over },
  }) as RouteVia;

describe('nightPauseMarker', () => {
  it('FE-MAP-NIGHTMARK-001: names the night it belongs to', () => {
    expect(nightPauseMarker(via({ day: 3 }))).toContain('<span>3</span>');
  });

  it('FE-MAP-NIGHTMARK-002: says whether the car stands at a place or beside the road', () => {
    // The theme hook the two shapes are styled from, and the only thing telling
    // a reader that a stop is a car park rather than a lay-by.
    expect(nightPauseMarker(via({ atPlace: true }))).toContain('data-night-pause="place"');
    expect(nightPauseMarker(via({ atPlace: false }))).toContain('data-night-pause="route"');
  });

  it('FE-MAP-NIGHTMARK-003: the two shapes sit differently, so neither covers the pin', () => {
    const atPlace = nightPauseMarker(via({ atPlace: true }));
    const onRoute = nightPauseMarker(via({ atPlace: false }));
    expect(atPlace).not.toEqual(onRoute);
    // Beside the road the pill centres over the point; at a place it is hung to
    // the right, where the place's own marker already is.
    expect(onRoute).toContain('translateX(-50%)');
    expect(atPlace).not.toContain('translateX(-50%)');
  });

  it('FE-MAP-NIGHTMARK-004: never takes the pointer — the marker under it must stay clickable', () => {
    expect(nightPauseMarker(via())).toContain('pointer-events:none');
  });

  it('FE-MAP-NIGHTMARK-005: the zoom gate is the value the renderers read', () => {
    // Exported rather than local so the three renderers cannot each decide a
    // different zoom, which is how one engine ends up showing a label the others
    // have hidden.
    expect(NIGHT_PAUSE_MIN_ZOOM).toBe(6);
  });
});
