import type { RoadtripHazard } from '@trek/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyHazardsAmap } from './amapHazards';

// A fixed shift, so a test asserts the conversion happened without depending on
// the real datum maths. The direction is asserted separately, below.
vi.mock('./engines/amap', () => ({
  wgs84ToGcj02: vi.fn((lng: number, lat: number) => ({ lng: lng + 0.006, lat: lat + 0.006 })),
}));

function hazard(over: Partial<RoadtripHazard> = {}): RoadtripHazard {
  return {
    id: 'h1',
    source: 'DWD',
    title: 'Flooding',
    description: 'Road closed',
    updatedAt: '2026-06-01T00:00:00.000Z',
    validUntil: null,
    url: 'https://example.org/h1',
    geometry: { type: 'Point', coordinates: [2.3522, 48.8566] },
    ...over,
  } as RoadtripHazard;
}

/** Records every overlay constructed, and what was done to it. */
function fakeApi() {
  const created: Array<Record<string, unknown>> = [];
  const make = (name: string) =>
    vi.fn(function (this: unknown, options?: Record<string, unknown>) {
      const overlay = { kind: name, options, setMap: vi.fn(), on: vi.fn() };
      created.push(overlay);
      return overlay;
    });
  const api = {
    Polygon: make('Polygon'),
    Circle: make('Circle'),
    InfoWindow: vi.fn(function () {
      return { setContent: vi.fn(), open: vi.fn(), close: vi.fn() };
    }),
  };
  return { api, created };
}

const map = { add: vi.fn(), remove: vi.fn() };
const noopPopup = () => null;
const content = () => 'popup';

beforeEach(() => vi.clearAllMocks());

describe('applyHazardsAmap', () => {
  it('FE-MAP-HAZAMAP-001: a Point notice is a disc at the converted coordinate', () => {
    const { api, created } = fakeApi();
    applyHazardsAmap(api as never, map, [hazard()], noopPopup, content, '#f59e0b');

    const dot = created.find((o) => o.kind === 'Circle')!;
    expect(dot).toBeTruthy();
    // WGS-84 [2.3522, 48.8566] through the stub's +0.006 shift. Asserted to a
    // tolerance rather than by literal: 2.3522 + 0.006 is not exactly 2.3582 in
    // binary floating point, and a literal would be pinning the rounding.
    const center = (dot.options as { center: number[] }).center;
    expect(center[0]).toBeCloseTo(2.3582, 6);
    expect(center[1]).toBeCloseTo(48.8626, 6);
    expect(dot.setMap).toHaveBeenCalledWith(map);
  });

  it('FE-MAP-HAZAMAP-002: a Polygon notice is one ring, converted vertex by vertex', () => {
    const { api, created } = fakeApi();
    applyHazardsAmap(
      api as never,
      map,
      [
        hazard({
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [2.0, 48.0],
                [2.1, 48.0],
                [2.1, 48.1],
                [2.0, 48.0],
              ],
            ],
          } as RoadtripHazard['geometry'],
        }),
      ],
      noopPopup,
      content,
      '#f59e0b'
    );

    const shape = created.find((o) => o.kind === 'Polygon')!;
    const path = (shape.options as { path: number[][][] }).path;
    expect(path).toHaveLength(1);
    expect(path[0][0]).toEqual([2.006, 48.006]);
    expect(path[0][2]).toEqual([2.106, 48.106]);
  });

  it('FE-MAP-HAZAMAP-003: a MultiPolygon is one overlay per part', () => {
    const { api, created } = fakeApi();
    const ring = [
      [
        [2.0, 48.0],
        [2.1, 48.0],
        [2.1, 48.1],
        [2.0, 48.0],
      ],
    ];
    applyHazardsAmap(
      api as never,
      map,
      [
        hazard({
          geometry: { type: 'MultiPolygon', coordinates: [ring, ring] } as RoadtripHazard['geometry'],
        }),
      ],
      noopPopup,
      content,
      '#f59e0b'
    );
    expect(created.filter((o) => o.kind === 'Polygon')).toHaveLength(2);
  });

  it('FE-MAP-HAZAMAP-004: the fill is the faint amber the other renderers use', () => {
    const { api, created } = fakeApi();
    applyHazardsAmap(
      api as never,
      map,
      [
        hazard({
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [2.0, 48.0],
                [2.1, 48.0],
                [2.1, 48.1],
                [2.0, 48.0],
              ],
            ],
          } as RoadtripHazard['geometry'],
        }),
      ],
      noopPopup,
      content,
      '#f59e0b'
    );
    const options = created[0].options as { fillOpacity: number; strokeColor: string };
    expect(options.fillOpacity).toBeCloseTo(0.16);
    expect(options.strokeColor).toBe('#f59e0b');
  });

  it('FE-MAP-HAZAMAP-005: clear takes every overlay back off the map', () => {
    const { api, created } = fakeApi();
    const manager = applyHazardsAmap(api as never, map, [hazard()], noopPopup, content, '#f59e0b');
    manager.clear();
    for (const overlay of created) expect(overlay.setMap).toHaveBeenLastCalledWith(null);
  });

  it('FE-MAP-HAZAMAP-006: a notice with no drawable geometry costs only itself', () => {
    const { api, created } = fakeApi();
    // An empty polygon ring is the realistic malformed case.
    applyHazardsAmap(
      api as never,
      map,
      [hazard({ geometry: { type: 'Polygon', coordinates: [] } as RoadtripHazard['geometry'] }), hazard({ id: 'h2' })],
      noopPopup,
      content,
      '#f59e0b'
    );
    // The second one still drew: one bad entry does not take the whole layer.
    expect(created.filter((o) => o.kind === 'Circle')).toHaveLength(1);
  });

  it('FE-MAP-HAZAMAP-007: with no geometry constructors at all, nothing throws', () => {
    // An engine build without Polygon/Circle must degrade to no layer, not to a
    // crashed map — the same rule the trail and overlay managers follow.
    expect(() => applyHazardsAmap({} as never, map, [hazard()], noopPopup, content, '#f59e0b')).not.toThrow();
  });

  it('FE-MAP-HAZAMAP-008: a click opens the notice, and asks for a fresh window each time', () => {
    const { api, created } = fakeApi();
    const window_ = { setContent: vi.fn(), open: vi.fn(), close: vi.fn() };
    const popup = vi.fn(() => window_);
    applyHazardsAmap(api as never, map, [hazard()], popup, content, '#f59e0b');

    const click = (created[0].on as { mock: { calls: [string, () => void][] } }).mock.calls.find(
      (c) => c[0] === 'click'
    )![1];
    click();
    expect(window_.setContent).toHaveBeenCalledWith('popup');
    const at = window_.open.mock.calls[0] as unknown as [unknown, number[]];
    expect(at[0]).toBe(map);
    expect(at[1][0]).toBeCloseTo(2.3582, 6);
    expect(at[1][1]).toBeCloseTo(48.8626, 6);
  });
});
