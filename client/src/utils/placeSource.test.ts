import { describe, expect, it, vi } from 'vitest';
import { sourceLabelFor } from './placeSource';

const translate = vi.fn((key: string) => `translated:${key}`);

describe('sourceLabelFor', () => {
  it('labels a result-owned AMap source through i18n', () => {
    expect(sourceLabelFor({ source: 'amap' }, 'native', translate)).toBe('translated:places.source.amap');
  });

  it('keeps proper-name sources untranslated', () => {
    expect(sourceLabelFor({ source: 'trek-places' }, 'native', translate)).toBe('TREK');
    expect(sourceLabelFor({ source: 'nominatim' }, 'native', translate)).toBe('OpenStreetMap');
    expect(sourceLabelFor({ source: 'google' }, 'native', translate)).toBe('Google');
  });

  it('uses the list source when the result has no own source', () => {
    expect(sourceLabelFor({}, 'openstreetmap', translate)).toBe('OpenStreetMap');
    expect(sourceLabelFor({}, 'nominatim', translate)).toBe('OpenStreetMap');
  });

  it('returns null for an unknown source instead of inventing a label', () => {
    expect(sourceLabelFor({}, 'unknown-provider', translate)).toBeNull();
  });
});
