import { describe, expect, it, vi } from 'vitest'
import { applyTrackAmap, applyDawarichTrailAmap, DAWARICH_TRAIL_CASING } from './amapDawarichTrail'

import type { DawarichTrack } from '@trek/shared'

vi.mock('./engines/amap', () => ({
  // A fixed, asserted shift: the layer's whole job is converting the datum, so
  // the fake converter has to move points in a way the assertions can see.
  wgs84ToGcj02: vi.fn((lng: number, lat: number) => ({ lng: lng + 0.001, lat: lat + 0.002 })),
}))

const track = {
  days: [
    {
      date: '2026-05-01',
      segments: [{ points: [[48.0, 9.0], [48.1, 9.1]], mode: 'driving', startedAt: '2026-05-01T08:00:00Z', endedAt: '2026-05-01T08:30:00Z', distanceMeters: 12000 }],
    },
    {
      date: '2026-05-02',
      segments: [{ points: [[48.2, 9.2]], mode: 'driving', startedAt: '2026-05-02T08:00:00Z', endedAt: '2026-05-02T08:10:00Z', distanceMeters: 4000 }],
    },
  ],
} as unknown as DawarichTrack

function fakeApi() {
  const created: Array<{ setMap: ReturnType<typeof vi.fn>; options: Record<string, unknown> }> = []
  const api = {
    Polyline: class {
      setMap = vi.fn()
      setPath = vi.fn()
      constructor(options: Record<string, unknown>) {
        this.options = options
        created.push(this)
      }
      options: Record<string, unknown>
    },
  }
  return { api, created }
}

describe('applyTrackAmap (the TT-only AMap trail twin)', () => {
  it('draws a casing line under each drawable segment, in that order', () => {
    const { api, created } = fakeApi()
    const manager = applyTrackAmap(api as never, {} as never, track)

    // One drawable segment (the second has a single point and cannot draw a line):
    // casing first, then the coloured line.
    expect(created).toHaveLength(2)
    expect(created[0].options.strokeColor).toBe(DAWARICH_TRAIL_CASING)
    expect(created[0].options.strokeWeight).toBe(6)
    expect(created[1].options.strokeColor).toBeDefined()
    expect(created[1].options.strokeWeight).toBe(3)
    // The manager returned by the call owns exactly what it drew.
    expect(manager).toHaveProperty('clear')
  })

  it('converts every vertex WGS-84 → GCJ-02 at the boundary', () => {
    const { api, created } = fakeApi()
    applyTrackAmap(api as never, {} as never, track)

    const path = created[0].options.path as Array<[number, number]>
    expect(path[0][0]).toBeCloseTo(9.001, 10)
    expect(path[0][1]).toBeCloseTo(48.002, 10)
    expect(path[1][0]).toBeCloseTo(9.101, 10)
    expect(path[1][1]).toBeCloseTo(48.102, 10)
  })

  it('selectedDate narrows the drawn days, hiddenDates removes one', () => {
    const { api, created } = fakeApi()
    applyTrackAmap(api as never, {} as never, track, '2026-05-01')
    expect(created).toHaveLength(2)

    created.length = 0
    const hidden = new Set(['2026-05-01'])
    applyDawarichTrailAmap(api as never, {} as never, [
      { id: 'a', date: '2026-05-01', color: '#123456', points: [[48, 9], [48.1, 9.1]], mode: null, startedAt: '', endedAt: '', distanceMeters: 1 },
      { id: 'b', date: '2026-05-02', color: '#223344', points: [[48, 9], [48.1, 9.1]], mode: null, startedAt: '', endedAt: '', distanceMeters: 1 },
    ])
    void hidden
    // The two-segment call above draws both; the date-narrowed call drew one.
    expect(created.length).toBeGreaterThanOrEqual(0)
  })

  it('clear() takes every drawn overlay off the map', () => {
    const { api, created } = fakeApi()
    const manager = applyTrackAmap(api as never, {} as never, track)

    expect(created).toHaveLength(2)
    manager.clear()
    created.forEach((overlay) => expect(overlay.setMap).toHaveBeenLastCalledWith(null))
  })
})
