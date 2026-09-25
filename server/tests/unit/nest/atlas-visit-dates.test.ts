import { countryVisitDates, type DatedTrip } from '../../../src/nest/atlas/visit-dates';

import { describe, expect, it } from 'vitest';

/**
 * The "First trip / Last trip" dates a country shows (#1535).
 *
 * Both used to be the earliest and latest start_date of any trip with a place in
 * the country, which meant a single trip printed its departure month twice, the
 * month you came home never appeared, and a trip you had merely booked could
 * become the last visit of a country you had already been to.
 */
describe('countryVisitDates', () => {
  const TODAY = '2026-06-15';

  const trip = (start_date: string | null, end_date: string | null): DatedTrip => ({ start_date, end_date });

  it('ATLAS-DATES-001: a single trip spans its start to its end, not start to start', () => {
    expect(countryVisitDates([trip('2026-03-01', '2026-03-20')], 'visited', TODAY)).toEqual({
      firstVisit: '2026-03-01',
      lastVisit: '2026-03-20',
    });
  });

  it('ATLAS-DATES-002: first is the earliest start and last is the latest end, across trips', () => {
    const result = countryVisitDates(
      [trip('2026-01-10', '2026-01-20'), trip('2026-05-01', '2026-05-30'), trip('2026-03-05', '2026-03-09')],
      'visited',
      TODAY,
    );
    expect(result).toEqual({ firstVisit: '2026-01-10', lastVisit: '2026-05-30' });
  });

  it('ATLAS-DATES-003: a planned trip does not count towards a visited country', () => {
    // The bug this fixes: a booked future trip became "the last visit".
    const result = countryVisitDates(
      [trip('2026-01-10', '2026-01-20'), trip('2026-12-01', '2026-12-20')],
      'visited',
      TODAY,
    );
    expect(result).toEqual({ firstVisit: '2026-01-10', lastVisit: '2026-01-20' });
  });

  it('ATLAS-DATES-004: a visited trip still running ends today, not on the planned return', () => {
    const result = countryVisitDates([trip('2026-06-01', '2026-06-30')], 'visited', TODAY);
    expect(result).toEqual({ firstVisit: '2026-06-01', lastVisit: TODAY });
  });

  it('ATLAS-DATES-005: a planned country counts only its planned trips', () => {
    const result = countryVisitDates(
      [trip('2026-01-10', '2026-01-20'), trip('2026-12-01', '2026-12-20')],
      'planned',
      TODAY,
    );
    expect(result).toEqual({ firstVisit: '2026-12-01', lastVisit: '2026-12-20' });
  });

  it('ATLAS-DATES-006: a trip with only an end date still counts, using it for both', () => {
    expect(countryVisitDates([trip(null, '2026-02-14')], 'visited', TODAY)).toEqual({
      firstVisit: '2026-02-14',
      lastVisit: '2026-02-14',
    });
  });

  it('ATLAS-DATES-007: a dateless trip contributes nothing rather than a null date', () => {
    expect(countryVisitDates([trip(null, null)], 'visited', TODAY)).toEqual({
      firstVisit: null,
      lastVisit: null,
    });
  });

  it('ATLAS-DATES-008: an end before the start never moves the range backwards', () => {
    // Defensive: bad data must not produce a lastVisit earlier than firstVisit.
    expect(countryVisitDates([trip('2026-04-10', '2026-04-01')], 'visited', TODAY)).toEqual({
      firstVisit: '2026-04-10',
      lastVisit: '2026-04-10',
    });
  });

  it('ATLAS-DATES-009: no trips at all is two nulls, which is what a manual mark shows', () => {
    expect(countryVisitDates([], 'visited', TODAY)).toEqual({ firstVisit: null, lastVisit: null });
  });
});
