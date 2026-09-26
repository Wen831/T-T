import type { RoadtripVia } from '@trek/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AMAP_VIA_MIN_ZOOM, applyViasAmap } from './amapVias';
import { gcj02ToWgs84, wgs84ToGcj02 } from './engines/amap';

/**
 * The via handles on the AMap renderer, and the one thing that can silently
 * break here: the datum.
 *
 * These tests deliberately do NOT mock `gcj02ToWgs84` / `wgs84ToGcj02`. A stubbed
 * transform cannot tell a correct conversion from a reversed one, a missing one,
 * or one applied twice — all three pass, because the expectation is computed with
 * the same stub. The conversion is the whole risk in this file, so it is the one
 * thing these tests exercise for real.
 *
 * The reference pair below is AMap's OWN answer for a WGS-84 input (the same pair
 * `engines/amap.test.ts` pins), which is what makes it an external check rather
 * than the transform agreeing with itself.
 */

/** AMap's own conversion of this WGS-84 input, and the input it came from. */
const WGS = { lng: 116.478346, lat: 39.997361 };
const GCJ = { lng: 116.484444444445, lat: 39.998649088542 };

const via = (over: Partial<RoadtripVia> = {}): RoadtripVia =>
  ({
    id: 7,
    day_id: 2,
    after_order_index: 0,
    sequence: 0,
    lng: WGS.lng,
    lat: WGS.lat,
    ...over,
  }) as RoadtripVia;

function fakeApi() {
  const created: Array<Record<string, unknown>> = [];
  const Marker = vi.fn(function (options?: Record<string, unknown>) {
    const marker = { kind: 'Marker', options, setMap: vi.fn(), on: vi.fn(), setPosition: vi.fn() };
    created.push(marker);
    return marker;
  });
  return { api: { Marker } as never, created };
}

const map = { add: vi.fn(), remove: vi.fn() };
const at = (created: Array<Record<string, unknown>>, i = 0) =>
  (created[i].options as { position: [number, number] }).position;

const fire = (marker: Record<string, unknown>, event: string): ((e?: unknown) => void) => {
  const call = (marker.on as { mock: { calls: [string, (e?: unknown) => void][] } }).mock.calls.find(
    (c) => c[0] === event
  );
  expect(call, `no ${event} handler`).toBeTruthy();
  return call![1];
};

beforeEach(() => vi.clearAllMocks());

describe('applyViasAmap — placement', () => {
  it('FE-MAP-VIAAMAP-001: a via is drawn at its GCJ-02 position, converted on the way in', () => {
    const { api, created } = fakeApi();
    applyViasAmap(api, map, [via()], { onMove: vi.fn() }, 12);

    const position = at(created);
    // The marker must sit where AMap expects it (GCJ), not where TT stores it.
    expect(position[0]).toBeCloseTo(GCJ.lng, 6);
    expect(position[1]).toBeCloseTo(GCJ.lat, 6);
    expect(created[0].setMap).toHaveBeenCalledWith(map);
  });

  it('FE-MAP-VIAAMAP-002: clear takes every handle off the map', () => {
    const { api, created } = fakeApi();
    const manager = applyViasAmap(api, map, [via(), via({ id: 8 })], { onMove: vi.fn() }, 12);
    expect(manager.count).toBe(2);
    manager.clear();
    for (const marker of created) expect(marker.setMap).toHaveBeenLastCalledWith(null);
  });
});

describe('applyViasAmap — the drag writes WGS-84', () => {
  it('FE-MAP-VIAAMAP-003: a dragged handle reports the WGS-84 position, not what AMap said', () => {
    const { api, created } = fakeApi();
    const onMove = vi.fn();
    applyViasAmap(api, map, [via()], { onMove }, 12);

    // AMap hands back a GCJ-02 pair, as it drew it.
    fire(created[0], 'dragend')({ lnglat: { getLng: () => GCJ.lng, getLat: () => GCJ.lat } });

    // Compared to a tolerance, not by identity: the inverse is an iterative
    // solution, so it lands sub-metre rather than exact. The point of the
    // assertion is the DIRECTION, which is why the `not` pair below matters more
    // than the `toBeCloseTo` pair.
    const [dayId, id, lat, lng] = onMove.mock.calls[0] as [number, number, number, number];
    expect(dayId).toBe(2);
    expect(id).toBe(7);
    expect(lat).toBeCloseTo(WGS.lat, 5);
    expect(lng).toBeCloseTo(WGS.lng, 5);
    // A reversed, missing or doubled conversion fails here and nowhere else.
    expect(lat).not.toBeCloseTo(GCJ.lat, 5);
    expect(lng).not.toBeCloseTo(GCJ.lng, 5);
  });

  it('FE-MAP-VIAAMAP-004: the two conversions are inverses, so a drag round-trips', () => {
    // Guards the pair itself: if someone swaps the arguments of one of them this
    // still passes, but if the two stop being inverses it fails loudly.
    const there = wgs84ToGcj02(WGS.lng, WGS.lat);
    const back = gcj02ToWgs84(there.lng, there.lat);
    expect(back.lng).toBeCloseTo(WGS.lng, 5);
    expect(back.lat).toBeCloseTo(WGS.lat, 5);
  });

  it('FE-MAP-VIAAMAP-005: a drag outside mainland China is written back unchanged', () => {
    // Paris is not shifted by either direction, so a via placed there must come
    // back exactly as it went in — this catches a conversion applied when it
    // should not be.
    const { api, created } = fakeApi();
    const onMove = vi.fn();
    const paris = via({ lng: 2.3522, lat: 48.8566 });
    applyViasAmap(api, map, [paris], { onMove }, 12);

    fire(created[0], 'dragend')({ lnglat: { getLng: () => 2.3522, getLat: () => 48.8566 } });
    expect(onMove).toHaveBeenCalledWith(2, 7, 48.8566, 2.3522);
  });

  it('FE-MAP-VIAAMAP-006: a malformed drag event writes nothing', () => {
    const { api, created } = fakeApi();
    const onMove = vi.fn();
    applyViasAmap(api, map, [via()], { onMove }, 12);

    // No lnglat, and a NaN one: neither is a position, and a write here would
    // move the route to nowhere.
    fire(created[0], 'dragend')();
    fire(created[0], 'dragend')({ lnglat: { getLng: () => NaN, getLat: () => 0 } });
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('applyViasAmap — removal and read-only', () => {
  it('FE-MAP-VIAAMAP-007: a right-click removes that via, by its day and id', () => {
    const { api, created } = fakeApi();
    const onRemove = vi.fn();
    applyViasAmap(api, map, [via({ id: 9, day_id: 4 })], { onMove: vi.fn(), onRemove }, 12);
    fire(created[0], 'rightclick')();
    expect(onRemove).toHaveBeenCalledWith(4, 9);
  });

  it('FE-MAP-VIAAMAP-008: without a move handler the handle is not draggable', () => {
    // A read-only viewer must not get a handle that silently does nothing.
    const { api, created } = fakeApi();
    applyViasAmap(api, map, [via()], { onRemove: vi.fn() }, 12);
    expect((created[0].options as { draggable: boolean }).draggable).toBe(false);
    expect(fire(created[0], 'dragend')).toBeTruthy(); // bound, but a no-op
  });

  it('FE-MAP-VIAAMAP-009: below the zoom gate no draggable handle is drawn', () => {
    const { api, created } = fakeApi();
    const manager = applyViasAmap(api, map, [via()], { onMove: vi.fn() }, AMAP_VIA_MIN_ZOOM - 1);
    expect(created).toHaveLength(0);
    expect(manager.count).toBe(0);
  });

  it('FE-MAP-VIAAMAP-010: a read-only viewer keeps its handles at any zoom', () => {
    // With nothing to shape, there is nothing to zoom in for.
    const { api, created } = fakeApi();
    applyViasAmap(api, map, [via()], { onRemove: vi.fn() }, 3);
    expect(created).toHaveLength(1);
  });

  it('FE-MAP-VIAAMAP-011: an engine without Marker degrades to no layer, not a crash', () => {
    expect(() => applyViasAmap({} as never, map, [via()], { onMove: vi.fn() }, 12)).not.toThrow();
  });
});
