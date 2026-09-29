import { TransitService } from '../../../src/nest/transit/transit.service';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which backend answers a transit request (#1699).
 *
 * Transitous is free and keyless and stays the fallback; Google is used only when
 * an admin picked it AND a key resolves for the caller; AMap activates on its own
 * when the instance has a Web服务 key and nobody pinned a backend, but an
 * out-of-coverage AMap plan falls back to Transitous rather than answering empty.
 */
function makeService(opts: { active: boolean; amapActive?: boolean; amapPlan?: 'routes' | 'empty' | 'throws' }) {
  const calls: string[] = [];
  const google = {
    isActive: vi.fn(() => opts.active),
    geocode: vi.fn(async () => {
      calls.push('google.geocode');
      return { results: [{ name: 'Google hit', lat: 1, lng: 2, type: 'PLACE', area: null }] };
    }),
    plan: vi.fn(async () => {
      calls.push('google.plan');
      return { itineraries: [] };
    }),
  };
  const amapItinerary = {
    startTime: '2026-09-29T01:00:00.000Z',
    endTime: '2026-09-29T02:00:00.000Z',
    duration: 3600,
    transfers: 0,
    walkSeconds: 0,
    legs: [],
  };
  const amap = {
    isActive: vi.fn(() => opts.amapActive === true),
    geocode: vi.fn(async () => {
      calls.push('amap.geocode');
      return { results: [{ name: 'AMap hit', lat: 3, lng: 4, type: 'STOP', area: null }] };
    }),
    plan: vi.fn(async () => {
      calls.push('amap.plan');
      if (opts.amapPlan === 'throws') {
        const err = new Error('Transit provider error (AMap: INVALID_USER_KEY)') as Error & { status: number };
        err.status = 502;
        throw err;
      }
      return { itineraries: opts.amapPlan === 'routes' ? [amapItinerary] : [] };
    }),
  };
  const svc = new TransitService(
    google as unknown as ConstructorParameters<typeof TransitService>[0],
    amap as unknown as ConstructorParameters<typeof TransitService>[1],
  );
  return { svc, google, amap, calls };
}

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  // The Transitous path reads the body with res.json(), so the stub has to offer it.
  fetchMock.mockResolvedValue({
    ok: true,
    headers: { get: () => null },
    json: async () => [],
    text: async () => JSON.stringify([]),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response);
});
afterEach(() => vi.unstubAllGlobals());

describe('transit backend dispatch', () => {
  it('TRANSIT-DISPATCH-001: Transitous answers when Google is not active', async () => {
    const { svc, google, calls } = makeService({ active: false });
    const result = await svc.geocode('Berlin', 'en', undefined, 7);
    expect(result.provider).toBe('transitous');
    expect(calls).toEqual([]);
    // The key resolution is not even consulted when Google is off.
    expect(google.geocode).not.toHaveBeenCalled();
  });

  it('TRANSIT-DISPATCH-002: Google answers, and says so, when it is active', async () => {
    const { svc, google, calls } = makeService({ active: true });
    const result = await svc.geocode('Kyoto', 'en', undefined, 7);
    expect(result.provider).toBe('google');
    expect(calls).toEqual(['google.geocode']);
    expect(google.geocode).toHaveBeenCalledWith('Kyoto', 'en', undefined, 7);
  });

  it('TRANSIT-DISPATCH-003: the caller id reaches the provider, so the key is theirs', async () => {
    const { svc, google } = makeService({ active: true });
    await svc.geocode('Kyoto', 'en', undefined, 42);
    // Not 0, not the instance: the Google key resolves per caller.
    expect(google.isActive).toHaveBeenCalledWith(42);
    expect(google.geocode).toHaveBeenCalledWith('Kyoto', 'en', undefined, 42);
  });

  it('TRANSIT-DISPATCH-004: a one-character query answers empty without asking anyone', async () => {
    const { svc, google } = makeService({ active: true });
    const result = await svc.geocode('K', 'en', undefined, 7);
    expect(result.results).toEqual([]);
    expect(google.geocode).not.toHaveBeenCalled();
  });

  it('TRANSIT-DISPATCH-005: plan routes to the same backend as geocode', async () => {
    const { svc, calls } = makeService({ active: true });
    const result = await svc.plan({ from: '1,2', to: '3,4' }, 7);
    expect(result.provider).toBe('google');
    expect(calls).toEqual(['google.plan']);
  });

  it('TRANSIT-DISPATCH-006: an invalid coordinate is refused before any backend runs', async () => {
    const { svc, calls } = makeService({ active: true });
    await expect(svc.plan({ from: 'nope', to: '3,4' }, 7)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('TRANSIT-DISPATCH-007: an AMap key with no pinned backend routes through AMap', async () => {
    const { svc, calls } = makeService({ active: false, amapActive: true });
    const result = await svc.geocode('Paris', 'en', undefined, 7);
    expect(result.provider).toBe('amap');
    expect(calls).toEqual(['amap.geocode']);
  });

  it('TRANSIT-DISPATCH-008: an active Google pin beats the AMap auto-activation', async () => {
    const { svc, calls, amap } = makeService({ active: true, amapActive: true });
    const result = await svc.geocode('Kyoto', 'en', undefined, 7);
    expect(result.provider).toBe('google');
    expect(calls).toEqual(['google.geocode']);
    expect(amap.geocode).not.toHaveBeenCalled();
  });

  it('TRANSIT-DISPATCH-009: an AMap plan with routes answers as amap', async () => {
    const { svc, calls } = makeService({ active: false, amapActive: true, amapPlan: 'routes' });
    const result = await svc.plan({ from: '31.2,121.4', to: '31.3,121.5' }, 7);
    expect(result.provider).toBe('amap');
    expect(result.itineraries).toHaveLength(1);
    expect(calls).toEqual(['amap.plan']);
  });

  it('TRANSIT-DISPATCH-010: an empty AMap plan falls back to Transitous', async () => {
    const { svc, calls } = makeService({ active: false, amapActive: true, amapPlan: 'empty' });
    // Fresh coordinates: the Transitous response cache is module-level and a
    // shared key would let the preceding test's entry answer this one.
    const result = await svc.plan({ from: '39.9,116.4', to: '39.95,116.45' }, 7);
    // Out-of-coverage (e.g. a European journey) keeps working on the MOTIS index.
    expect(calls).toEqual(['amap.plan']);
    expect(result.provider).toBe('transitous');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('TRANSIT-DISPATCH-011: an AMap error falls back to Transitous too', async () => {
    const { svc } = makeService({ active: false, amapActive: true, amapPlan: 'throws' });
    const result = await svc.plan({ from: '48.2,16.3', to: '48.3,16.4' }, 7);
    expect(result.provider).toBe('transitous');
  });

  it('TRANSIT-DISPATCH-012: both providers failing surfaces the AMap failure', async () => {
    const { svc } = makeService({ active: false, amapActive: true, amapPlan: 'throws' });
    fetchMock.mockRejectedValue(new Error('motis down'));
    await expect(svc.plan({ from: '52.1,13.2', to: '52.2,13.4' }, 7)).rejects.toThrow('HTTP 502');
  });
});
