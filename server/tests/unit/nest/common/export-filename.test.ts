import { exportFilename } from '../../../../src/nest/common/export-filename';
import { gpxFilename } from '../../../../src/nest/places/gpx-export.helpers';

import { describe, expect, it } from 'vitest';

// The name arrives on a receiving filesystem, so it must survive Windows and
// POSIX alike, and must not be cut in the middle of a surrogate pair — that is
// what URI-encoding the header chokes on.
describe('exportFilename', () => {
  it('folds the reserved characters and joins the words with dashes', () => {
    expect(exportFilename('Alpine: week / 4 days *?', 'csv')).toBe('Alpine-week-4-days.csv');
  });

  it('keeps a title in its own script', () => {
    expect(exportFilename('沖縄 4泊5日', 'geojson')).toBe('沖縄-4泊5日.geojson');
  });

  it('caps the name at 60 codepoints without cutting an emoji in half', () => {
    const name = exportFilename('🙂'.repeat(80), 'csv');
    expect([...name].length).toBeLessThanOrEqual(64);
    expect(name).toBe(`${'🙂'.repeat(60)}.csv`);
  });

  it('falls back to "trip" when nothing readable is left', () => {
    expect(exportFilename('   ', 'csv')).toBe('trip.csv');
    expect(exportFilename('***', 'csv')).toBe('trip.csv');
  });

  it('gives GPX the same name it always did', () => {
    expect(gpxFilename('Kyoto 4 days')).toBe(exportFilename('Kyoto 4 days', 'gpx'));
    expect(gpxFilename('沖縄-4泊5日')).toBe('沖縄-4泊5日.gpx');
  });
});
