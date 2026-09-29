import { toCsv } from '../common/csv';

/**
 * The two formats a trip exports in that are not a map device's: a table for a
 * spreadsheet and GeoJSON for QGIS, Google My Maps or anything else that reads
 * the geojson.org spec.
 *
 * Both are built from the same two row shapes the GPX exporter already collects —
 * the trip's places, and its stops in day order — so the three exports cannot
 * drift apart on what "the trip" contains. Headers stay English and snake_case:
 * they are column names a pivot table looks up, not prose, and the server does
 * not know the reader's locale.
 */

/** A place as the table and GeoJSON writers need it. */
export interface ExportPlaceRow {
  id: number;
  name: string;
  description: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  category: string | null;
}

/** One assignment of a place to a day, in the order the day plan draws it. */
export interface ExportStopRow {
  place_id: number;
  day_number: number;
  date: string | null;
  title: string | null;
  order_index: number;
}

const CSV_HEADER = ['day', 'date', 'place_name', 'category', 'address', 'latitude', 'longitude', 'description'];

/** Coordinates to 7 decimals, the same precision GPX writes: about a centimetre. */
function coord(value: number): number {
  return Number(value.toFixed(7));
}

function byPlaceId(stops: ExportStopRow[]): Map<number, ExportStopRow[]> {
  const grouped = new Map<number, ExportStopRow[]>();
  for (const stop of stops) {
    const list = grouped.get(stop.place_id);
    if (list) list.push(stop);
    else grouped.set(stop.place_id, [stop]);
  }
  return grouped;
}

/**
 * One row per stop, so a place that appears on two days is two rows — which is
 * what the day plan says, and what someone filtering by date expects. Places that
 * belong to the trip but to no day come last with the day columns empty, because
 * dropping them would silently lose part of the trip.
 */
export function buildTripCsv(places: ExportPlaceRow[], stops: ExportStopRow[]): string {
  const byId = new Map(places.map((place) => [place.id, place]));
  const assigned = byPlaceId(stops);
  const rows: (string | number | null)[][] = [];

  const push = (place: ExportPlaceRow, stop: ExportStopRow | null): void => {
    rows.push([
      stop?.day_number ?? '',
      stop?.date ?? '',
      place.name,
      place.category,
      place.address,
      place.lat ?? '',
      place.lng ?? '',
      place.description,
    ]);
  };

  // `stops` arrives already ordered by day and then by position within the day.
  for (const stop of stops) {
    const place = byId.get(stop.place_id);
    if (place) push(place, stop);
  }
  for (const place of places) {
    if (!assigned.has(place.id)) push(place, null);
  }

  // BOM on purpose: Excel decides an encoding from the bytes, not from the
  // Content-Type header the download carried.
  return toCsv(CSV_HEADER, rows);
}

/**
 * Points for every place that has coordinates, plus one LineString per day that
 * has at least two of them — the planned route, which is the part a spreadsheet
 * cannot hold and the reason to offer GeoJSON at all.
 *
 * Returns null when neither exists, so the caller answers 404 rather than handing
 * over an empty collection that opens as a blank map.
 */
export function buildTripGeoJson(tripTitle: string, places: ExportPlaceRow[], stops: ExportStopRow[]): string | null {
  const stopsOf = byPlaceId(stops);
  const features: Record<string, unknown>[] = [];

  for (const place of places) {
    if (place.lat === null || place.lng === null) continue;
    const assigned = stopsOf.get(place.id) ?? [];
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coord(place.lng), coord(place.lat)] },
      properties: {
        trip: tripTitle,
        name: place.name,
        category: place.category,
        address: place.address,
        description: place.description,
        days: assigned.map((stop) => stop.day_number),
      },
    });
  }

  const days = new Map<number, { date: string | null; title: string | null; points: { lat: number; lng: number }[] }>();
  const byId = new Map(places.map((place) => [place.id, place]));
  for (const stop of stops) {
    const place = byId.get(stop.place_id);
    if (!place || place.lat === null || place.lng === null) continue;
    let day = days.get(stop.day_number);
    if (!day) {
      day = { date: stop.date, title: stop.title, points: [] };
      days.set(stop.day_number, day);
    }
    day.points.push({ lat: place.lat, lng: place.lng });
  }

  for (const [dayNumber, day] of [...days.entries()].sort((a, b) => a[0] - b[0])) {
    if (day.points.length < 2) continue;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: day.points.map((point) => [coord(point.lng), coord(point.lat)]),
      },
      properties: { trip: tripTitle, day: dayNumber, date: day.date, title: day.title },
    });
  }

  if (features.length === 0) return null;
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
}
