/**
 * AMAP-DIR — reading the stops out of a shared AMap (高德) directions link.
 *
 * The one rule that matters here is the datum: these links carry GCJ-02 and TT
 * stores WGS-84, so a parser that reports the numbers as-is puts every stop a few
 * hundred metres off. The parser reports what the link said and marks it `gcj`;
 * the service converts. These tests pin both halves.
 */
import {
  parseAmapRouteUrl,
  isAmapHost,
  isAmapShortHost,
  MAX_AMAP_ROUTE_WAYPOINTS,
} from '../../../src/nest/places/amap-dir.helpers';

import { describe, it, expect } from 'vitest';

describe('AMAP-DIR host recognition', () => {
  it('AMAP-DIR-001: the route hosts are recognised, and a lookalike is not', () => {
    expect(isAmapHost('ditu.amap.com')).toBe(true);
    expect(isAmapHost('uri.amap.com')).toBe(true);
    // A suffix match would accept this, which is exactly the trap.
    expect(isAmapHost('amap.com.evil.test')).toBe(false);
    expect(isAmapHost('notamap.com')).toBe(false);
  });

  it('AMAP-DIR-002: the short hosts are their own set', () => {
    expect(isAmapShortHost('surl.amap.com')).toBe(true);
    expect(isAmapHost('surl.amap.com')).toBe(false);
  });
});

describe('parseAmapRouteUrl — the indexed form', () => {
  it('AMAP-DIR-003: from/via/to are read in driving order', () => {
    const url =
      'https://ditu.amap.com/dir?type=car' +
      '&from%5Blnglat%5D=116.39,39.91&from%5Bname%5D=%E5%8C%97%E4%BA%AC' +
      '&via%5B0%5D%5Blnglat%5D=117.20,39.13&via%5B0%5D%5Bname%5D=%E5%A4%A9%E6%B4%A5' +
      '&to%5Blnglat%5D=121.47,31.23&to%5Bname%5D=%E4%B8%8A%E6%B5%B7';

    const stops = parseAmapRouteUrl(url);

    expect(stops.map((s) => s.name)).toEqual(['北京', '天津', '上海']);
    expect(stops.map((s) => s.lat)).toEqual([39.91, 39.13, 31.23]);
    expect(stops.map((s) => s.lng)).toEqual([116.39, 117.2, 121.47]);
  });

  it('AMAP-DIR-004: every coordinate is reported as GCJ-02, never as WGS-84', () => {
    // The whole reason the flag exists: the service converts only what is marked.
    const stops = parseAmapRouteUrl('https://ditu.amap.com/dir?from[lnglat]=116.39,39.91&to[lnglat]=121.47,31.23');
    expect(stops.every((s) => s.gcj)).toBe(true);
  });

  it('AMAP-DIR-005: several indexed vias keep their order', () => {
    const url =
      'https://ditu.amap.com/dir?from[lnglat]=116.39,39.91' +
      '&via[0][lnglat]=117.20,39.13&via[1][lnglat]=118.80,32.06&via[2][lnglat]=120.15,30.28' +
      '&to[lnglat]=121.47,31.23';

    const stops = parseAmapRouteUrl(url);
    expect(stops).toHaveLength(5);
    expect(stops.map((s) => s.lng)).toEqual([116.39, 117.2, 118.8, 120.15, 121.47]);
  });

  it('AMAP-DIR-006: a gap in the via indexes ends the list instead of inventing stops', () => {
    const url =
      'https://ditu.amap.com/dir?from[lnglat]=116.39,39.91' +
      '&via[0][lnglat]=117.20,39.13' +
      // No via[1]; via[2] must not be picked up as the second stop.
      '&via[2][lnglat]=120.15,30.28' +
      '&to[lnglat]=121.47,31.23';

    const stops = parseAmapRouteUrl(url);
    expect(stops.map((s) => s.lng)).toEqual([116.39, 117.2, 121.47]);
  });

  it('AMAP-DIR-007: a name carrying a comma survives intact', () => {
    // The reason AMap indexes its parts: a delimited form truncates here.
    const url =
      'https://ditu.amap.com/dir?from[lnglat]=116.39,39.91&from[name]=Cafe,+Beijing' +
      '&to[lnglat]=121.47,31.23&to[name]=Bar,+Shanghai';

    const stops = parseAmapRouteUrl(url);
    expect(stops[0].name).toBe('Cafe, Beijing');
    expect(stops[1].name).toBe('Bar, Shanghai');
  });
});

describe('parseAmapRouteUrl — the flat (native scheme) form', () => {
  it('AMAP-DIR-008: slon/slat and dlon/dlat are read', () => {
    const url =
      'https://uri.amap.com/route?sourceApplication=tt&slon=116.39&slat=39.91&sname=Start' +
      '&dlon=121.47&dlat=31.23&dname=End&dev=0&t=0&m=0';

    const stops = parseAmapRouteUrl(url);
    expect(stops.map((s) => s.name)).toEqual(['Start', 'End']);
    expect(stops.map((s) => s.lat)).toEqual([39.91, 31.23]);
  });

  it('AMAP-DIR-009: the parallel via lists stay aligned', () => {
    const url =
      'https://uri.amap.com/route?slon=116.39&slat=39.91&sname=A' +
      '&vialons=117.20|118.80&vialats=39.13|32.06&vianames=B|C' +
      '&dlon=121.47&dlat=31.23&dname=D&dev=0';

    const stops = parseAmapRouteUrl(url);
    expect(stops.map((s) => s.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(stops.map((s) => s.lng)).toEqual([116.39, 117.2, 118.8, 121.47]);
  });

  it('AMAP-DIR-010: a via with a name but no coordinate is kept for geocoding', () => {
    const url =
      'https://uri.amap.com/route?slon=116.39&slat=39.91&sname=A' +
      // The name list is longer than the coordinate lists: that entry has no position.
      '&vialons=117.20&vialats=39.13&vianames=B|Somewhere+Else' +
      '&dlon=121.47&dlat=31.23&dname=D';

    const stops = parseAmapRouteUrl(url);
    const named = stops.find((s) => s.name === 'Somewhere Else');
    expect(named).toBeDefined();
    expect(named?.lat).toBeNull();
    expect(named?.lng).toBeNull();
    expect(named?.gcj).toBe(false);
  });

  it('AMAP-DIR-011: the two spellings of one coordinate are interchangeable', () => {
    const indexed = parseAmapRouteUrl('https://ditu.amap.com/dir?from[lnglat]=116.39,39.91&to[lnglat]=121.47,31.23');
    const flat = parseAmapRouteUrl('https://uri.amap.com/route?slon=116.39&slat=39.91&dlon=121.47&dlat=31.23');
    expect(flat.map((s) => [s.lat, s.lng])).toEqual(indexed.map((s) => [s.lat, s.lng]));
  });
});

describe('parseAmapRouteUrl — refusals', () => {
  it('AMAP-DIR-012: a single stop is not a route', () => {
    // One stop is a place, and the place search box already takes those.
    expect(parseAmapRouteUrl('https://ditu.amap.com/dir?from[lnglat]=116.39,39.91')).toEqual([]);
  });

  it('AMAP-DIR-013: a non-AMap host is refused rather than scraped', () => {
    expect(parseAmapRouteUrl('https://maps.google.com/dir?from[lnglat]=116.39,39.91&to[lnglat]=121.47,31.23')).toEqual(
      []
    );
  });

  it('AMAP-DIR-014: a marker link is not a route', () => {
    expect(parseAmapRouteUrl('https://uri.amap.com/marker?position=116.39,39.91&name=x')).toEqual([]);
  });

  it('AMAP-DIR-015: coordinates off the earth are dropped', () => {
    const url = 'https://ditu.amap.com/dir?from[lnglat]=999,999&to[lnglat]=121.47,31.23';
    // Only one usable stop survives, so this is not a route either.
    expect(parseAmapRouteUrl(url)).toEqual([]);
  });

  it('AMAP-DIR-016: garbage is not an exception', () => {
    expect(parseAmapRouteUrl('not a url')).toEqual([]);
    expect(parseAmapRouteUrl('')).toEqual([]);
  });

  it('AMAP-DIR-017: the stop count is capped', () => {
    const vias = Array.from({ length: 60 }, (_, i) => `&via[${i}][lnglat]=120.${i},30.1`).join('');
    const url = `https://ditu.amap.com/dir?from[lnglat]=116.39,39.91${vias}&to[lnglat]=121.47,31.23`;
    expect(parseAmapRouteUrl(url)).toHaveLength(MAX_AMAP_ROUTE_WAYPOINTS);
  });
});
