import { CSV_BOM } from '../../../../src/nest/common/csv';
import { buildTripCsv, buildTripGeoJson } from '../../../../src/nest/places/export-formats.helpers';
import type { ExportPlaceRow, ExportStopRow } from '../../../../src/nest/places/export-formats.helpers';

import { describe, expect, it } from 'vitest';

const place = (over: Partial<ExportPlaceRow> = {}): ExportPlaceRow => ({
  id: 1,
  name: 'Fushimi Inari',
  description: null,
  address: '38 Fukakusa Yabunouchicho, Fushimi Ward, Kyoto 612-0003, Japan',
  lat: 34.9671,
  lng: 135.7727,
  category: 'sightseeing',
  ...over,
});

const stops: ExportStopRow[] = [
  { place_id: 1, day_number: 1, date: '2026-04-03', title: 'Arrival', order_index: 0 },
  { place_id: 2, day_number: 1, date: '2026-04-03', title: 'Arrival', order_index: 1 },
  { place_id: 1, day_number: 2, date: '2026-04-04', title: 'Temples', order_index: 0 },
];

describe('buildTripCsv', () => {
  // The address holds commas, so it is the one quoted cell in these rows: the
  // assertions pin the columns around it rather than re-writing a CSV parser.
  const QUOTED_ADDRESS = '"38 Fukakusa Yabunouchicho, Fushimi Ward, Kyoto 612-0003, Japan"';

  it('writes a header, one row per stop in day order, and the BOM Excel needs', () => {
    const rows = [place(), place({ id: 2, name: 'Kinkaku-ji', lat: 35.0394, lng: 135.7292 })];
    const csv = buildTripCsv(rows, stops);

    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(CSV_BOM.length).trimEnd().split('\r\n');
    expect(lines[0]).toBe('day,date,place_name,category,address,latitude,longitude,description');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(`1,2026-04-03,Fushimi Inari,sightseeing,${QUOTED_ADDRESS},34.9671,135.7727,`);
    expect(lines[2]).toBe(`1,2026-04-03,Kinkaku-ji,sightseeing,${QUOTED_ADDRESS},35.0394,135.7292,`);
    // The same place on day 2 is its own row, which is what the day plan says.
    expect(lines[3]).toBe(`2,2026-04-04,Fushimi Inari,sightseeing,${QUOTED_ADDRESS},34.9671,135.7727,`);
  });

  it('puts places that belong to no day last with the day columns empty', () => {
    const csv = buildTripCsv(
      [place(), place({ id: 9, name: 'Idea cafe', lat: null, lng: null, address: null })],
      [{ place_id: 1, day_number: 1, date: null, title: null, order_index: 0 }],
    );
    const lines = csv.slice(CSV_BOM.length).trimEnd().split('\r\n');
    expect(lines[1]).toBe(`1,,Fushimi Inari,sightseeing,${QUOTED_ADDRESS},34.9671,135.7727,`);
    expect(lines[2]).toBe(',,Idea cafe,sightseeing,,,,');
  });

  it('guards a place name typed as a formula', () => {
    const csv = buildTripCsv([place({ name: '=HYPERLINK("http://evil","x")' })], []);
    expect(csv).toContain('"\'=HYPERLINK(""http://evil"",""x"")"');
  });

  it('keeps a negative coordinate as a number, not a guarded string', () => {
    const csv = buildTripCsv([place({ lat: -33.8688, lng: 151.2093 })], []);
    expect(csv).toContain('-33.8688,151.2093');
  });
});

describe('buildTripGeoJson', () => {
  const parse = (input: string | null) => JSON.parse(String(input)) as Record<string, any>;

  it('writes a point per place in longitude, latitude order', () => {
    const out = parse(buildTripGeoJson('Kyoto', [place()], []));
    expect(out.type).toBe('FeatureCollection');
    expect(out.features).toHaveLength(1);
    expect(out.features[0].geometry).toEqual({ type: 'Point', coordinates: [135.7727, 34.9671] });
    expect(out.features[0].properties.name).toBe('Fushimi Inari');
    expect(out.features[0].properties.trip).toBe('Kyoto');
  });

  it('lists every day a place is assigned to', () => {
    const out = parse(buildTripGeoJson('Kyoto', [place()], stops));
    expect(out.features[0].properties.days).toEqual([1, 2]);
  });

  it('adds one line per day that has at least two stops, in plan order', () => {
    const rows = [place(), place({ id: 2, name: 'Kinkaku-ji', lat: 35.0394, lng: 135.7292 })];
    const out = parse(buildTripGeoJson('Kyoto', rows, stops));
    const lines = out.features.filter((f: Record<string, any>) => f.geometry.type === 'LineString');
    expect(lines).toHaveLength(1);
    expect(lines[0].properties).toEqual({ trip: 'Kyoto', day: 1, date: '2026-04-03', title: 'Arrival' });
    expect(lines[0].geometry.coordinates).toEqual([
      [135.7727, 34.9671],
      [135.7292, 35.0394],
    ]);
  });

  it('rounds coordinates to the centimetre GPX uses', () => {
    const out = parse(buildTripGeoJson('Kyoto', [place({ lat: 34.9671123456789, lng: 135.772700000001 })], []));
    expect(out.features[0].geometry.coordinates).toEqual([135.7727, 34.9671123]);
  });

  it('skips a place with no coordinates', () => {
    const out = parse(buildTripGeoJson('Kyoto', [place({ lat: null, lng: 135.7727 }), place({ id: 2 })], []));
    expect(out.features).toHaveLength(1);
  });

  it('returns null when nothing can be mapped, so the caller can answer 404', () => {
    expect(buildTripGeoJson('Kyoto', [place({ lat: null, lng: null })], [])).toBeNull();
    expect(buildTripGeoJson('Kyoto', [], [])).toBeNull();
  });
});
