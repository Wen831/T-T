import { TransitService } from '../../../src/nest/transit/transit.service';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which backend answers a transit request (#1699).
 *
 * Transitous is free and keyless and stays the fallback; Google is used only when
 * an admin picked it AND a key resolves for the caller. Getting this backwards
 * means either billing a key nobody asked to spend, or silently answering from
 * the wrong index.
 */
function makeService(opts: { active: boolean }) {
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
  const svc = new TransitService(google as unknown as ConstructorParameters<typeof TransitService>[0]);
  return { svc, google, calls };
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
});
