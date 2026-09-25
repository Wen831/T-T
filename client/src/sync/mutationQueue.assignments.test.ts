import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mutationQueue } from './mutationQueue'
import { offlineDb, clearAll } from '../db/offlineDb'
import { isEffectivelyOffline } from './networkMode'
import { setConflictStrategy } from './offlinePrefs'
import { apiClient } from '../api/client'

vi.mock('./networkMode', () => ({ isEffectivelyOffline: vi.fn(() => true) }))
vi.mock('./authGate', () => ({ isAuthed: () => true }))
vi.mock('../api/client', () => ({ apiClient: { request: vi.fn() } }))
/**
 * The queue drain for `assignments`. They have no Dexie table of their own — the
 * cache keeps them nested inside their day row — so the server answer has to be
 * folded back through cacheAssignment. Without that path the drain deleted the
 * queue entry while the cache kept the optimistic value, so an offline edit of a
 * visit's times silently reverted to what the server normalized it to.
 */
beforeEach(async () => {
  await clearAll()
  vi.clearAllMocks()
  vi.mocked(isEffectivelyOffline).mockReturnValue(true)
  await offlineDb.days.put({
    id: 3,
    trip_id: 9,
    assignments: [{ id: 5, day_id: 3, place_id: 7, order_index: 0, assignment_time: null, assignment_end_time: null }],
  } as never)
})

describe('mutationQueue > assignments write-back', () => {
  it('folds the server answer for a queued time edit back into the day row', async () => {
    await mutationQueue.enqueue({
      id: 'mut-1', tripId: 9, method: 'PUT', url: '/trips/9/assignments/5/time',
      body: { place_time: '10:00', end_time: '11:00' }, resource: 'assignments', entityId: 5,
    })

    vi.mocked(isEffectivelyOffline).mockReturnValue(false)
    vi.mocked(apiClient.request).mockResolvedValue({
      data: { assignment: { id: 5, day_id: 3, place_id: 7, order_index: 0, assignment_time: '10:00', assignment_end_time: '11:00' } },
    } as never)

    await mutationQueue.flush()

    expect(await offlineDb.mutationQueue.count()).toBe(0)
    const day = (await offlineDb.days.get(3)) as unknown as { assignments: Array<{ assignment_time: string | null; assignment_end_time: string | null }> }
    expect(day.assignments[0].assignment_time).toBe('10:00')
    expect(day.assignments[0].assignment_end_time).toBe('11:00')
  })

  it('adopts the bare entity a 409 conflict answer carries', async () => {
    await mutationQueue.enqueue({
      id: 'mut-2', tripId: 9, method: 'PUT', url: '/trips/9/assignments/5/end-day',
      body: { end_day: true }, resource: 'assignments', entityId: 5,
    })

    vi.mocked(isEffectivelyOffline).mockReturnValue(false)
    // 'ask' (the default) would park the conflict for the picker; server-wins is
    // the path that exercises the write-back.
    setConflictStrategy('server')
    const conflict = Object.assign(new Error('conflict'), {
      response: { status: 409, data: { server: { id: 5, day_id: 3, place_id: 7, order_index: 0, end_day: true } } },
    })
    vi.mocked(apiClient.request).mockRejectedValue(conflict)

    await mutationQueue.flush()

    expect(await offlineDb.mutationQueue.count()).toBe(0)
    const day = (await offlineDb.days.get(3)) as unknown as { assignments: Array<{ end_day?: boolean }> }
    expect(day.assignments[0].end_day).toBe(true)
  })
})
