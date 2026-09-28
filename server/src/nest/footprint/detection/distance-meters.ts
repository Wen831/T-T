/**
 * Great-circle distance in metres — the footprint port of the
 * `Geocoder::Calculations.distance_between([lat, lon], [lat, lon], units: :km) * 1000`
 * every detection stage calls. Spherical haversine on the same 6371 km earth
 * radius the Ruby gem uses, so radius comparisons behave identically at the
 * 100 m scale the pipeline works on.
 */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}
