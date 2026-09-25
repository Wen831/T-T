import { PluginSearchController } from '../../../src/nest/plugins/contributions/plugin-search.controller';
import { MAX_LIMIT, MAX_QUERY } from '../../../src/nest/plugins/contributions/plugin-search.helpers';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/plugin-search — places found by plugins implementing `searchProvider`.
 *
 * A search index TT does not ship. Additive and fail-safe: a provider that errors
 * or times out contributes nothing, and the search is drawn without it — one
 * installed plugin must never be able to turn a search into a 500.
 */
const killSwitch = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../../src/nest/plugins/kill-switch', () => ({
  pluginsEnabled: () => killSwitch.enabled,
}));

interface HookArgs {
  query: string;
  limit: number;
  lang?: string;
  near?: { lat: number; lng: number };
}

function makeController(
  opts: {
    providers?: string[];
    answer?: (id: string, req: HookArgs) => unknown;
  } = {},
) {
  const calls: Array<{ id: string; req: HookArgs; userId: number }> = [];
  const providers = opts.providers ?? ['p1'];
  const hooks = {
    providersOf: vi.fn(() => providers),
    searchPlaces: vi.fn(async (id: string, req: HookArgs, userId: number) => {
      calls.push({ id, req, userId });
      return opts.answer ? opts.answer(id, req) : [{ name: `${id} result`, lat: 1, lng: 2 }];
    }),
  };
  const controller = new PluginSearchController(hooks as never);
  return { controller, hooks, calls };
}

const reqFor = (id?: number) => ({ user: id === undefined ? undefined : { id } }) as never;

beforeEach(() => {
  killSwitch.enabled = true;
});

describe('PluginSearchController', () => {
  it('PLUGSEARCH-001: returns nothing when the plugin runtime is switched off', async () => {
    killSwitch.enabled = false;
    const { controller, hooks } = makeController();
    expect(await controller.search('hotel', undefined, undefined, undefined, undefined, reqFor(1))).toEqual({
      places: [],
    });
    // The kill switch is checked before any provider is asked.
    expect(hooks.providersOf).not.toHaveBeenCalled();
  });

  it('PLUGSEARCH-002: an anonymous caller gets nothing', async () => {
    const { controller, hooks } = makeController();
    expect(await controller.search('hotel', undefined, undefined, undefined, undefined, reqFor())).toEqual({
      places: [],
    });
    expect(hooks.searchPlaces).not.toHaveBeenCalled();
  });

  it('PLUGSEARCH-003: an empty query is not an error, it is an empty answer', async () => {
    const { controller, hooks } = makeController();
    expect(await controller.search('   ', undefined, undefined, undefined, undefined, reqFor(1))).toEqual({
      places: [],
    });
    expect(hooks.providersOf).not.toHaveBeenCalled();
  });

  it('PLUGSEARCH-004: no installed provider means no fan-out', async () => {
    const { controller, hooks } = makeController({ providers: [] });
    expect(await controller.search('hotel', undefined, undefined, undefined, undefined, reqFor(1))).toEqual({
      places: [],
    });
    expect(hooks.searchPlaces).not.toHaveBeenCalled();
  });

  it('PLUGSEARCH-005: the query is trimmed and capped before it reaches a provider', async () => {
    const { controller, calls } = makeController();
    await controller.search(`  ${'x'.repeat(MAX_QUERY + 50)}  `, undefined, undefined, undefined, undefined, reqFor(7));
    expect(calls[0].req.query).toHaveLength(MAX_QUERY);
    expect(calls[0].req.query.startsWith('x')).toBe(true);
  });

  it('PLUGSEARCH-006: the acting user is the one the hook is asked for', async () => {
    const { controller, calls } = makeController();
    await controller.search('hotel', undefined, undefined, undefined, undefined, reqFor(42));
    expect(calls[0].userId).toBe(42);
  });

  it('PLUGSEARCH-007: a limit above the cap is clamped, and a missing one falls back', async () => {
    const { controller, calls } = makeController();
    await controller.search('hotel', undefined, undefined, undefined, String(MAX_LIMIT + 100), reqFor(1));
    expect(calls[0].req.limit).toBe(MAX_LIMIT);
    calls.length = 0;
    await controller.search('hotel', undefined, undefined, undefined, undefined, reqFor(1));
    expect(calls[0].req.limit).toBeLessThanOrEqual(MAX_LIMIT);
  });

  it('PLUGSEARCH-008: coordinates become a near bias, and nonsense ones are dropped', async () => {
    const { controller, calls } = makeController();
    await controller.search('hotel', '48.85', '2.35', undefined, undefined, reqFor(1));
    expect(calls[0].req.near).toEqual({ lat: 48.85, lng: 2.35 });

    calls.length = 0;
    await controller.search('hotel', 'not-a-number', '2.35', undefined, undefined, reqFor(1));
    expect(calls[0].req.near).toBeUndefined();

    calls.length = 0;
    // Out-of-range values are not a location, so they must not become a bias.
    await controller.search('hotel', '91', '2.35', undefined, undefined, reqFor(1));
    expect(calls[0].req.near).toBeUndefined();
  });

  it('PLUGSEARCH-009: a provider that throws contributes nothing, the rest still answer', async () => {
    const { controller } = makeController({
      providers: ['good', 'bad'],
      answer: (id) => {
        if (id === 'bad') throw new Error('provider exploded');
        return [{ name: 'Good result', lat: 1, lng: 2 }];
      },
    });
    const result = await controller.search('hotel', undefined, undefined, undefined, undefined, reqFor(1));
    expect(result.places.length).toBeGreaterThan(0);
    expect(result.places.some((p) => String((p as { name?: string }).name).includes('Good'))).toBe(true);
  });

  it('PLUGSEARCH-010: every provider is asked, and the hits are interleaved', async () => {
    const { controller, calls } = makeController({
      providers: ['a', 'b'],
      // lat/lng are required: a hit with no place on the earth cannot be shown, so
      // the normaliser drops it and a fixture without coordinates would silently
      // pass an interleave assertion against an empty list.
      answer: (id) => [
        { name: `${id}1`, lat: 1, lng: 2 },
        { name: `${id}2`, lat: 3, lng: 4 },
      ],
    });
    const result = await controller.search('hotel', undefined, undefined, undefined, undefined, reqFor(1));
    expect(calls.map((c) => c.id).sort()).toEqual(['a', 'b']);
    // Interleaved round-robin rather than provider-by-provider.
    expect(result.places.map((p) => (p as { name?: string }).name)).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('PLUGSEARCH-011: a hostile provider answer is normalised, not passed through', async () => {
    const { controller } = makeController({
      providers: ['evil'],
      answer: () => [{ name: 'x'.repeat(5000), lat: 1, lng: 2, rating: 999, url: 'javascript:alert(1)' }],
    });
    const result = await controller.search('hotel', undefined, undefined, undefined, undefined, reqFor(1));
    const first = result.places[0] as { name: string; rating?: number; url?: string };
    expect(first.name.length).toBeLessThan(5000);
    // The clamp is the helper's job; the point is it was applied at all.
    if (first.rating !== undefined) expect(first.rating).toBeLessThanOrEqual(5);
    if (first.url !== undefined) expect(String(first.url).startsWith('javascript:')).toBe(false);
  });
});
