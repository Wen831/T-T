import { AmapTransitProvider, classifyBusLine, classifyRailTrip } from '../../../src/nest/transit/amap-transit.provider';
import { transitItinerarySchema } from '../../../src/nest/transit/transit-itinerary.helpers';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The AMap transit provider (#China coverage): auto-activation rules, the GCJ-02
 * round trip, and the v3 `transit/integrated` → MOTIS-shaped itinerary mapping.
 * Every fixture below is what restapi.amap.com actually answers (bare "lng,lat"
 * polylines, HH:mm wall-clock only on rail stops, no duration on walking) —
 * the point of these tests is that the mapped output survives
 * transitItinerarySchema, because a leg the schema rejects is a silently
 * dropped itinerary on the live instance.
 */

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

function makeDb(opts: { key?: string | null; pinned?: string | null } = {}) {
  const settings: Record<string, string | null> = {};
  if (opts.key) settings.amap_api_key = opts.key;
  if (opts.pinned) settings.transit_provider = opts.pinned;
  const db = {
    get: vi.fn((sql: string, key: string) => ({ value: settings[key] ?? null })),
    run: vi.fn(),
  };
  return db as unknown as ConstructorParameters<typeof AmapTransitProvider>[0] & { get: ReturnType<typeof vi.fn> };
}

/** regeo stub: adcode from the GCJ location the provider sent. */
function regeoStub(adcodeByPrefix: Record<string, string>) {
  return (url: string) => {
    const u = new URL(url);
    if (u.pathname === '/v3/geocode/regeo') {
      const loc = u.searchParams.get('location') || '';
      const adcode = Object.entries(adcodeByPrefix).find(([prefix]) => loc.startsWith(prefix))?.[1] ?? '310000';
      return json({ status: '1', regeocode: { addressComponent: { adcode } } });
    }
    return null;
  };
}

function json(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => data,
  } as unknown as Response;
}

const SHANGHAI_LINE_1 = {
  name: '地铁1号线(莘庄--富锦路)',
  type: '地铁线路',
  color: '#E4002B',
  distance: '9800',
  polyline: '121.4737,31.2304;121.4694,31.2393;121.4552,31.2287',
  departure_stop: { name: '人民广场', location: '121.4737,31.2304' },
  arrival_stop: { name: '徐家汇(沪闵路)', location: '121.4552,31.2287' },
  via_stops: [{ name: '黄陂南路' }, { name: '陕西南路' }],
};

async function planFixture(opts: { time?: string } = {}) {
  const db = makeDb({ key: 'test-amap-key' });
  const provider = new AmapTransitProvider(db);
  const regeo = regeoStub({ '121.47': '310101', '121.4': '310104' });
  fetchMock.mockImplementation(async (url: string) => {
    const handled = regeo(url);
    if (handled) return handled;
    const u = new URL(url);
    expect(u.pathname).toBe('/v3/direction/transit/integrated');
    return json({
      status: '1',
      info: 'OK',
      route: {
        transits: [
          {
            cost: { duration: '2700' },
            segments: [
              { walking: { distance: '420', steps: [{ polyline: '121.4600,31.2400;121.4650,31.2350' }] } },
              { bus: { buslines: [SHANGHAI_LINE_1] } },
              { walking: { distance: '310', steps: [{ polyline: '121.4552,31.2287;121.4500,31.2260' }] } },
            ],
          },
        ],
      },
    });
  });
  const result = await provider.plan({
    from: '31.2304,121.4737',
    to: '31.2260,121.4500',
    time: opts.time ?? '2026-09-29T01:00:00.000Z',
  });
  return { provider, db, result };
}

describe('amap transit activation', () => {
  it('AMAP-T-001: a configured key with no pinned setting activates AMap', () => {
    const provider = new AmapTransitProvider(makeDb({ key: 'k' }));
    expect(provider.isActive()).toBe(true);
  });

  it('AMAP-T-002: no key never activates', () => {
    const provider = new AmapTransitProvider(makeDb({ key: null }));
    expect(provider.isActive()).toBe(false);
  });

  it('AMAP-T-003: a pinned transitous or google wins over the key', () => {
    for (const pinned of ['transitous', 'google']) {
      const provider = new AmapTransitProvider(makeDb({ key: 'k', pinned }));
      expect(provider.isActive()).toBe(false);
    }
    const pinnedAmap = new AmapTransitProvider(makeDb({ key: 'k', pinned: 'amap' }));
    expect(pinnedAmap.isActive()).toBe(true);
  });
});

describe('amap mode classification', () => {
  it('AMAP-T-010: train classes map by trip letter', () => {
    expect(classifyRailTrip('G7501', null)).toBe('HIGHSPEED_RAIL');
    expect(classifyRailTrip('C2', null)).toBe('HIGHSPEED_RAIL');
    expect(classifyRailTrip('D3075', null)).toBe('HIGHSPEED_RAIL');
    expect(classifyRailTrip('S1', null)).toBe('SUBURBAN');
    expect(classifyRailTrip('K1234', null)).toBe('LONG_DISTANCE');
    expect(classifyRailTrip('Z99', null)).toBe('LONG_DISTANCE');
    expect(classifyRailTrip('', '城际列车')).toBe('HIGHSPEED_RAIL');
  });

  it('AMAP-T-011: bus-line types map to the client taxonomy', () => {
    expect(classifyBusLine('地铁线路', '地铁1号线')).toBe('SUBWAY');
    expect(classifyBusLine('轮渡', '轮渡')).toBe('FERRY');
    expect(classifyBusLine('索道', '缆车')).toBe('AERIAL_LIFT');
    expect(classifyBusLine('有轨电车', '张江有轨电车1路')).toBe('TRAM');
    expect(classifyBusLine('公交线路', '71路')).toBe('BUS');
    expect(classifyBusLine('客运班线', '长途汽车')).toBe('COACH');
  });
});

describe('amap plan mapping', () => {
  it('AMAP-T-020: a v3 transit answer maps to a schema-valid MOTIS-shaped itinerary', async () => {
    const { result } = await planFixture();
    expect(result.itineraries).toHaveLength(1);
    const it0 = result.itineraries[0];

    const parsed = transitItinerarySchema.safeParse(it0);
    expect(parsed.success).toBe(true);

    expect(it0.legs.map((l) => l.mode)).toEqual(['WALK', 'SUBWAY', 'WALK']);
    expect(it0.transfers).toBe(0);
    // Wall-clock from the requested departure: 420 m at ~1.11 m/s ≈ 378 s,
    // then the line's own run, then 279 s — start is exactly the request.
    expect(it0.startTime).toBe('2026-09-29T01:00:00.000Z');
    expect(Date.parse(it0.endTime)).toBeGreaterThan(Date.parse(it0.startTime));

    const rail = it0.legs[1];
    expect(rail.line).toBe('地铁1号线(莘庄--富锦路)');
    expect(rail.lineColor).toBe('#E4002B');
    expect(rail.from.name).toBe('人民广场');
    expect(rail.to.name).toBe('徐家汇(沪闵路)');
    expect(rail.intermediateStops).toBe(2);
    expect(rail.distance).toBe(9800);
    // Coordinates round-tripped out of GCJ-02: over Shanghai the inverse
    // conversion lands ~350 m west of and ~210 m north of the raw GCJ pair —
    // which is what puts the line on an OSM tile where the station actually is.
    expect(rail.from.lat).toBeGreaterThan(31.2304);
    expect(rail.from.lat).toBeLessThan(31.2324);
    expect(rail.from.lng).toBeLessThan(121.4737);
    expect(rail.from.lng).toBeGreaterThan(121.4671);

    // The first walk starts at the journey origin token, the last ends at END.
    expect(it0.legs[0].from.name).toBe('START');
    expect(it0.legs[0].to.name).toBe('人民广场');
    expect(it0.legs[2].to.name).toBe('END');
  });

  it('AMAP-T-021: the request carries GCJ coordinates, adcodes and the China date pair', async () => {
    await planFixture({ time: '2026-09-29T11:30:00.000Z' });
    const planCall = fetchMock.mock.calls
      .map((c) => new URL(String(c[0])))
      .find((u) => u.pathname === '/v3/direction/transit/integrated');
    expect(planCall).toBeDefined();
    const params = planCall!.searchParams;
    expect(params.get('date')).toBe('2026-09-29');
    // 11:30Z is 19:30 in China — the request must be anchored there.
    expect(params.get('time')).toBe('19-30');
    expect(params.get('city')).toBe('310101');
    expect(params.get('cityd')).toBe('310104');
    expect(params.get('key')).toBe('test-amap-key');
    // Sent coordinates are GCJ-02 — over Shanghai the datum sits north-east of
    // the raw WGS pair, so the forward conversion is visible in both axes.
    const [lng, lat] = params.get('origin')!.split(',').map(Number);
    expect(lat).toBeLessThan(31.2304);
    expect(lat).toBeGreaterThan(31.2284);
    expect(lng).toBeGreaterThan(121.4737);
    expect(lng).toBeLessThan(121.4802);
  });

  it('AMAP-T-022: a rail segment with explicit times overrides the accumulator', async () => {
    const provider = new AmapTransitProvider(makeDb({ key: 'test-amap-key' }));
    const regeo = regeoStub({});
    fetchMock.mockImplementation(async (url: string) => {
      const handled = regeo(url);
      if (handled) return handled;
      return json({
        status: '1',
        route: {
          transits: [
            {
              segments: [
                {
                  railway: {
                    name: '沪宁城际',
                    trip: 'G7001',
                    type: '城际列车',
                    distance: '295000',
                    origin_station: { name: '上海', location: '121.4558,31.2497', time: '09:15' },
                    destination_station: { name: '南京南', location: '118.7981,32.0541', time: '10:35' },
                    polyline: '121.4558,31.2497;118.7981,32.0541',
                  },
                },
              ],
            },
          ],
        },
      });
    });
    const { itineraries } = await provider.plan({
      from: '31.2497,121.4558',
      to: '32.0541,118.7981',
      time: '2026-09-29T00:00:00.000Z',
    });
    expect(itineraries).toHaveLength(1);
    const leg = itineraries[0].legs[0];
    expect(leg.mode).toBe('HIGHSPEED_RAIL');
    expect(leg.line).toBe('G7001');
    // 09:15 and 10:35 China wall-clock → 01:15Z / 02:35Z, duration 80 min.
    expect(leg.from.time).toBe('2026-09-29T01:15:00.000Z');
    expect(leg.to.time).toBe('2026-09-29T02:35:00.000Z');
    expect(leg.duration).toBe(4800);
    expect(transitItinerarySchema.safeParse(itineraries[0]).success).toBe(true);
  });

  it('AMAP-T-023: a requested fine mode filters the answer', async () => {
    const db = makeDb({ key: 'test-amap-key' });
    const provider = new AmapTransitProvider(db);
    const regeo = regeoStub({});
    fetchMock.mockImplementation(async (url: string) => {
      const handled = regeo(url);
      if (handled) return handled;
      return json({
        status: '1',
        route: {
          transits: [
            { segments: [{ bus: { buslines: [{ ...SHANGHAI_LINE_1, type: '地铁线路' }] } }] },
            {
              segments: [
                {
                  bus: {
                    buslines: [
                      {
                        name: '49路',
                        type: '公交线路',
                        distance: '5000',
                        duration: '900',
                        polyline: '121.4700,31.2300;121.4500,31.2280',
                        start_stop: { name: '成都北路', location: '121.4700,31.2300' },
                        end_stop: { name: '上海体育馆', location: '121.4500,31.2280' },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      });
    });
    const subwayOnly = await provider.plan({
      from: '31.2304,121.4737',
      to: '31.2260,121.4500',
      time: '2026-09-29T03:00:00.000Z',
      modes: 'SUBWAY',
    });
    expect(subwayOnly.itineraries).toHaveLength(1);
    expect(subwayOnly.itineraries[0].legs[0].mode).toBe('SUBWAY');

    // A rail request accepts the whole rail family, like the Google provider.
    const db2 = makeDb({ key: 'test-amap-key' });
    const provider2 = new AmapTransitProvider(db2);
    const rail = await provider2.plan({
      from: '31.2304,121.4737',
      to: '31.2260,121.4500',
      time: '2026-09-29T04:00:00.000Z',
      modes: 'HIGHSPEED_RAIL',
    });
    // Subway is NOT part of the rail family, so the metro itinerary is filtered
    // out and only… nothing remains: the bus one fails the filter too.
    expect(rail.itineraries).toHaveLength(0);
  });

  it('AMAP-T-024: an AMap error status propagates with its status code', async () => {
    const db = makeDb({ key: 'test-amap-key' });
    const provider = new AmapTransitProvider(db);
    const regeo = regeoStub({});
    fetchMock.mockImplementation(async (url: string) => {
      const handled = regeo(url);
      if (handled) return handled;
      return json({ status: '0', info: 'USER_DAILY_QUERY_OVER_LIMIT' });
    });
    await expect(
      provider.plan({ from: '31.2304,121.4737', to: '31.2260,121.4500', time: '2026-09-29T05:00:00.000Z' }),
    ).rejects.toMatchObject({ status: 502, message: expect.stringContaining('USER_DAILY_QUERY_OVER_LIMIT') });
  });

  it('AMAP-T-025: geocode maps POI hits to WGS places and classifies stops', async () => {
    const db = makeDb({ key: 'test-amap-key' });
    const provider = new AmapTransitProvider(db);
    fetchMock.mockImplementation(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === '/v5/place/text' || u.pathname === '/v5/place/around') {
        return json({
          status: '1',
          pois: [
            {
              name: '上海虹桥站',
              location: '121.320086,31.194089',
              type: '交通设施服务;火车站;火车站',
              address: '申长路900号',
              pname: '上海市',
              cityname: '上海市',
              adname: '闵行区',
            },
            {
              name: '星巴克(虹桥天地店)',
              location: '121.321000,31.195000',
              type: '餐饮服务;饮料食品企业',
              address: '申长路900号',
            },
          ],
        });
      }
      return json({ status: '0', info: 'unexpected path' });
    });
    const { results } = await provider.geocode('虹桥', undefined);
    expect(results).toHaveLength(2);
    expect(results[0].type).toBe('STOP');
    expect(results[0].name).toBe('上海虹桥站');
    // GCJ → WGS: the converted pair differs from the raw one by the (small,
    // region-dependent) datum shift — proof it went through the converter.
    expect(results[0].lat).not.toBe(31.194089);
    expect(Math.abs(results[0].lat - 31.194089)).toBeLessThan(0.01);
    expect(results[0].lng).not.toBe(121.320086);
    expect(results[1].type).toBe('PLACE');
  });

  it('AMAP-T-026: without a key every call refuses instead of hitting the network', async () => {
    const provider = new AmapTransitProvider(makeDb({ key: null }));
    await expect(provider.geocode('x', undefined)).rejects.toMatchObject({ status: 502 });
    await expect(provider.plan({ from: '1,2', to: '3,4' })).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
