import { describe, expect, it } from 'vitest';
import {
  getAssignmentReservations,
  getDisplayTimeForDay,
  getMergedItems,
  getSpanPhase,
  getTransportForDay,
  getTransportRouteEndpoints,
  hidesOnMiddleDay,
  parseTimeToMinutes,
} from './dayMerge';

describe('parseTimeToMinutes', () => {
  it('parses HH:MM string', () => {
    expect(parseTimeToMinutes('09:30')).toBe(570);
  });

  it('parses ISO datetime string', () => {
    expect(parseTimeToMinutes('2025-03-30T14:00:00')).toBe(840);
  });

  it('returns null for null/empty', () => {
    expect(parseTimeToMinutes(null)).toBeNull();
    expect(parseTimeToMinutes(undefined)).toBeNull();
  });
});

describe('getSpanPhase', () => {
  it('returns single when start === end', () => {
    expect(getSpanPhase({ day_id: 1, end_day_id: 1 }, 1)).toBe('single');
  });

  it('returns start for the departure day', () => {
    expect(getSpanPhase({ day_id: 1, end_day_id: 3 }, 1)).toBe('start');
  });

  it('returns end for the arrival day', () => {
    expect(getSpanPhase({ day_id: 1, end_day_id: 3 }, 3)).toBe('end');
  });

  it('returns middle for days in between', () => {
    expect(getSpanPhase({ day_id: 1, end_day_id: 3 }, 2)).toBe('middle');
  });
});

describe('hidesOnMiddleDay', () => {
  it('keeps a one-day parking on its only day', () => {
    expect(hidesOnMiddleDay({ type: 'parking', day_id: 1, end_day_id: 1 }, 1)).toBe(false);
  });

  it('keeps a two-day parking on both days (no day in between exists)', () => {
    const parking = { type: 'parking', day_id: 1, end_day_id: 2 };
    expect(hidesOnMiddleDay(parking, 1)).toBe(false);
    expect(hidesOnMiddleDay(parking, 2)).toBe(false);
  });

  it('hides a three-day parking only on the day in between', () => {
    const parking = { type: 'parking', day_id: 1, end_day_id: 3 };
    expect(hidesOnMiddleDay(parking, 1)).toBe(false);
    expect(hidesOnMiddleDay(parking, 2)).toBe(true);
    expect(hidesOnMiddleDay(parking, 3)).toBe(false);
  });

  it('hides every day in between of a longer parking span (#1937)', () => {
    const parking = { type: 'parking', day_id: 1, end_day_id: 5 };
    expect([1, 2, 3, 4, 5].map((d) => hidesOnMiddleDay(parking, d))).toEqual([false, true, true, true, false]);
  });

  it('leaves a car rental visible, since its middle days move to the day header', () => {
    expect(hidesOnMiddleDay({ type: 'car', day_id: 1, end_day_id: 3 }, 2)).toBe(false);
  });

  it('leaves every other booking type alone', () => {
    for (const type of ['train', 'cruise', 'event', 'hotel', 'other']) {
      expect(hidesOnMiddleDay({ type, day_id: 1, end_day_id: 3 }, 2)).toBe(false);
    }
  });

  it('keeps a parking whose end day is not part of the trip', () => {
    expect(hidesOnMiddleDay({ type: 'parking', day_id: 1, end_day_id: 999 }, 1)).toBe(false);
  });

  it('keeps an unscheduled parking', () => {
    expect(hidesOnMiddleDay({ type: 'parking', day_id: null, end_day_id: null }, 2)).toBe(false);
  });
});

describe('getTransportRouteEndpoints', () => {
  const pickup = { role: 'from', lat: 48.1, lng: 11.5 };
  const dropoff = { role: 'to', lat: 52.5, lng: 13.4 };
  // A car rental spanning day 1 (pickup) through day 3 (drop-off).
  const rental = { day_id: 1, end_day_id: 3, endpoints: [pickup, dropoff] };

  it('routes to the pickup only on the start day of a multi-day rental', () => {
    expect(getTransportRouteEndpoints(rental, 1)).toEqual({ from: { lat: 48.1, lng: 11.5 }, to: null });
  });

  it('routes from the drop-off only on the end day', () => {
    expect(getTransportRouteEndpoints(rental, 3)).toEqual({ from: null, to: { lat: 52.5, lng: 13.4 } });
  });

  it('adds no waypoints on the days in between (regression for #1210)', () => {
    expect(getTransportRouteEndpoints(rental, 2)).toEqual({ from: null, to: null });
  });

  it('uses both endpoints for a single-day transport', () => {
    const sameDay = { day_id: 1, end_day_id: 1, endpoints: [pickup, dropoff] };
    expect(getTransportRouteEndpoints(sameDay, 1)).toEqual({
      from: { lat: 48.1, lng: 11.5 },
      to: { lat: 52.5, lng: 13.4 },
    });
  });

  it('returns nulls when the endpoints carry no coordinates', () => {
    const noCoords = { day_id: 1, end_day_id: 1, endpoints: [{ role: 'from' }, { role: 'to' }] };
    expect(getTransportRouteEndpoints(noCoords, 1)).toEqual({ from: null, to: null });
  });
});

describe('getDisplayTimeForDay', () => {
  const r = {
    day_id: 1,
    end_day_id: 3,
    reservation_time: '2025-01-01T09:00:00',
    reservation_end_time: '2025-01-03T14:00:00',
  };

  it('returns reservation_time on start day', () => {
    expect(getDisplayTimeForDay(r, 1)).toBe(r.reservation_time);
  });

  it('returns reservation_end_time on end day', () => {
    expect(getDisplayTimeForDay(r, 3)).toBe(r.reservation_end_time);
  });

  it('returns null for middle day', () => {
    expect(getDisplayTimeForDay(r, 2)).toBeNull();
  });
});

describe('getTransportForDay', () => {
  const days = [
    { id: 1, day_number: 1 },
    { id: 2, day_number: 2 },
    { id: 3, day_number: 3 },
  ];

  it('excludes hotel (rendered via accommodation path)', () => {
    const reservations = [{ id: 10, type: 'hotel', day_id: 1 }];
    expect(getTransportForDay({ reservations, dayId: 1, dayAssignmentIds: [], days })).toHaveLength(0);
  });

  it('includes tour booking on the correct day', () => {
    const reservations = [{ id: 20, type: 'tour', day_id: 1 }];
    expect(getTransportForDay({ reservations, dayId: 1, dayAssignmentIds: [], days })).toHaveLength(1);
    expect(getTransportForDay({ reservations, dayId: 2, dayAssignmentIds: [], days })).toHaveLength(0);
  });

  it('includes restaurant, event, and other bookings by day_id', () => {
    const reservations = [
      { id: 30, type: 'restaurant', day_id: 2 },
      { id: 31, type: 'event', day_id: 2 },
      { id: 32, type: 'other', day_id: 2 },
    ];
    expect(getTransportForDay({ reservations, dayId: 2, dayAssignmentIds: [], days })).toHaveLength(3);
    expect(getTransportForDay({ reservations, dayId: 1, dayAssignmentIds: [], days })).toHaveLength(0);
  });

  it('includes single-day transport on the correct day', () => {
    const reservations = [{ id: 10, type: 'flight', day_id: 1, end_day_id: 1 }];
    expect(getTransportForDay({ reservations, dayId: 1, dayAssignmentIds: [], days })).toHaveLength(1);
    expect(getTransportForDay({ reservations, dayId: 2, dayAssignmentIds: [], days })).toHaveLength(0);
  });

  it('includes multi-day transport on all spanned days', () => {
    const reservations = [{ id: 10, type: 'train', day_id: 1, end_day_id: 3 }];
    expect(getTransportForDay({ reservations, dayId: 1, dayAssignmentIds: [], days })).toHaveLength(1);
    expect(getTransportForDay({ reservations, dayId: 2, dayAssignmentIds: [], days })).toHaveLength(1);
    expect(getTransportForDay({ reservations, dayId: 3, dayAssignmentIds: [], days })).toHaveLength(1);
  });

  it('excludes transport linked to an assignment on that day', () => {
    const reservations = [{ id: 10, type: 'bus', day_id: 1, end_day_id: 1, assignment_id: 42 }];
    expect(getTransportForDay({ reservations, dayId: 1, dayAssignmentIds: [42], days })).toHaveLength(0);
    expect(getTransportForDay({ reservations, dayId: 1, dayAssignmentIds: [99], days })).toHaveLength(1);
  });

  it('expands a multi-leg TRAIN into one row per leg with train detail on __leg (#1150)', () => {
    const reservations = [
      {
        id: 40,
        type: 'train',
        day_id: 1,
        end_day_id: 2,
        metadata: JSON.stringify({
          train_number: 'ICE 100',
          legs: [
            {
              from: 'Berlin',
              to: 'Frankfurt',
              train_number: 'ICE 100',
              platform: '5',
              dep_day_id: 1,
              dep_time: '08:00',
              arr_day_id: 1,
              arr_time: '12:00',
            },
            {
              from: 'Frankfurt',
              to: 'München',
              train_number: 'ICE 500',
              platform: '9',
              dep_day_id: 2,
              dep_time: '09:00',
              arr_day_id: 2,
              arr_time: '12:00',
            },
          ],
        }),
      },
    ];
    const day1 = getTransportForDay({ reservations, dayId: 1, dayAssignmentIds: [], days });
    expect(day1).toHaveLength(1);
    expect(day1[0].__leg).toMatchObject({
      index: 0,
      total: 2,
      from: 'Berlin',
      to: 'Frankfurt',
      train_number: 'ICE 100',
      platform: '5',
    });
    const day2 = getTransportForDay({ reservations, dayId: 2, dayAssignmentIds: [], days });
    expect(day2).toHaveLength(1);
    expect(day2[0].__leg).toMatchObject({
      index: 1,
      from: 'Frankfurt',
      to: 'München',
      train_number: 'ICE 500',
      platform: '9',
    });
  });

  it('leaves a single-leg train untouched (no __leg)', () => {
    const reservations = [
      { id: 41, type: 'train', day_id: 1, end_day_id: 1, metadata: JSON.stringify({ train_number: 'RE 1' }) },
    ];
    const rows = getTransportForDay({ reservations, dayId: 1, dayAssignmentIds: [], days });
    expect(rows).toHaveLength(1);
    expect(rows[0].__leg).toBeUndefined();
  });
});

describe('getAssignmentReservations', () => {
  it('returns every booking pinned to the assignment, not just the first (#2201)', () => {
    const reservations = [
      { id: 1, assignment_id: 42, reservation_time: '2025-06-01T10:00:00' },
      { id: 2, assignment_id: 42, reservation_time: '2025-06-01T09:00:00' },
      { id: 3, assignment_id: 7, reservation_time: '2025-06-01T08:00:00' },
    ];
    expect(getAssignmentReservations(reservations, 42).map((r) => r.id)).toEqual([2, 1]);
  });

  it('puts untimed bookings last and breaks ties on the id', () => {
    const reservations = [
      { id: 5, assignment_id: 42, reservation_time: null },
      { id: 4, assignment_id: 42, reservation_time: null },
      { id: 6, assignment_id: 42, reservation_time: '2025-06-01T09:00:00' },
    ];
    expect(getAssignmentReservations(reservations, 42).map((r) => r.id)).toEqual([6, 4, 5]);
  });

  it('returns nothing without an assignment', () => {
    const reservations = [{ id: 1, assignment_id: 42, reservation_time: null }];
    expect(getAssignmentReservations(reservations, null)).toEqual([]);
    expect(getAssignmentReservations(reservations, undefined)).toEqual([]);
  });

  it('leaves the caller array untouched', () => {
    const reservations = [
      { id: 1, assignment_id: 42, reservation_time: '2025-06-01T10:00:00' },
      { id: 2, assignment_id: 42, reservation_time: '2025-06-01T09:00:00' },
    ];
    getAssignmentReservations(reservations, 42);
    expect(reservations.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe('getMergedItems', () => {
  it('merges places and notes sorted by sortKey', () => {
    const dayAssignments = [
      { id: 1, order_index: 0, place: { place_time: null } },
      { id: 2, order_index: 2, place: { place_time: null } },
    ];
    const dayNotes = [{ id: 10, sort_order: 1 }];
    const result = getMergedItems({ dayAssignments, dayNotes, dayTransports: [], dayId: 5 });
    expect(result.map((i) => i.type)).toEqual(['place', 'note', 'place']);
    expect(result[0].data.id).toBe(1);
    expect(result[1].data.id).toBe(10);
    expect(result[2].data.id).toBe(2);
  });

  it('inserts transport by time when no per-day position is set', () => {
    const dayAssignments = [
      { id: 1, order_index: 0, place: { place_time: '08:00' } },
      { id: 2, order_index: 1, place: { place_time: '13:00' } },
    ];
    const dayTransports = [
      { id: 20, type: 'flight', day_id: 5, end_day_id: 5, reservation_time: '10:30', day_positions: null },
    ];
    const result = getMergedItems({ dayAssignments, dayNotes: [], dayTransports, dayId: 5 });
    const types = result.map((i) => i.type);
    // transport (10:30) should be between place at 08:00 (idx 0) and place at 13:00 (idx 1)
    expect(types).toEqual(['place', 'transport', 'place']);
  });

  it('orders a timed transport chronologically regardless of a stale per-day position', () => {
    const dayAssignments = [
      { id: 1, order_index: 0, place: { place_time: '08:00' } },
      { id: 2, order_index: 1, place: { place_time: '13:00' } },
    ];
    // The train is at 10:30, so it sorts between the 08:00 and 13:00 places by time —
    // timed items are arranged chronologically even if an old manual position exists.
    const dayTransports = [
      { id: 20, type: 'train', day_id: 5, end_day_id: 5, reservation_time: '10:30', day_positions: { 5: 1.5 } },
    ];
    const result = getMergedItems({ dayAssignments, dayNotes: [], dayTransports, dayId: 5 });
    const types = result.map((i) => i.type);
    expect(types).toEqual(['place', 'transport', 'place']);
  });
});

/**
 * TT's day ordering is the same rule upstream TREK 4.3 factored out into
 * `shared/src/day/chrono-order.ts`, and these are its cases. Upstream pulled the
 * rule out because its server kept its own copy that pushed every untimed stop
 * to the end of the day, so setting one start time yanked a stop from the bottom
 * of the plan to the top. TT never had that second copy — the client's
 * `applyChronoOrder` is the only implementation — but nothing pinned it to the
 * published rule either, so this locks the behaviour to the upstream cases
 * rather than to whatever the client happens to do today.
 */
describe('chrono ordering matches the upstream chrono-order rule', () => {
  const stop = (name: string, place_time: string | null, order_index: number) => ({
    id: order_index + 1,
    order_index,
    place: { name, place_time },
  });
  const order = (spec: Array<[string, string | null]>) =>
    getMergedItems({
      dayAssignments: spec.map(([n, t], i) => stop(n, t, i)) as any,
      dayNotes: [],
      dayTransports: [],
      dayId: 1,
    }).map((i) => i.data?.place?.name);

  it('leaves untimed stops in front of the first timed one where they are', () => {
    expect(
      order([
        ['A', null],
        ['B', null],
        ['C', '14:00'],
      ])
    ).toEqual(['A', 'B', 'C']);
  });

  it('keeps an untimed stop behind the timed stop it followed', () => {
    expect(
      order([
        ['A', '09:00'],
        ['B', null],
        ['C', '14:00'],
      ])
    ).toEqual(['A', 'B', 'C']);
  });

  it('sorts timed stops among themselves and leaves the untimed head alone', () => {
    expect(
      order([
        ['A', null],
        ['B', '15:00'],
        ['C', '10:00'],
      ])
    ).toEqual(['A', 'C', 'B']);
  });

  it('carries an untimed stop along with the timed stop in front of it', () => {
    // B inherits 15:00 from A, so both go behind C at 10:00, and B stays behind A.
    expect(
      order([
        ['A', '15:00'],
        ['B', null],
        ['C', '10:00'],
      ])
    ).toEqual(['C', 'A', 'B']);
  });

  it('keeps the incoming order for equal times', () => {
    expect(
      order([
        ['A', '10:00'],
        ['B', '10:00'],
        ['C', '09:00'],
        ['D', '09:00'],
      ])
    ).toEqual(['C', 'D', 'A', 'B']);
  });

  it('treats a missing time like null and orders midnight as a real time', () => {
    expect(
      order([
        ['A', null],
        ['B', '01:00'],
        ['C', '00:00'],
      ])
    ).toEqual(['A', 'C', 'B']);
  });
});
