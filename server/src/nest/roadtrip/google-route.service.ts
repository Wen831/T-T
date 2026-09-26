import { HttpException, Injectable } from '@nestjs/common';
import type { GoogleRouteImport, GoogleRoutePreview } from '@trek/shared';
import { MapsService, GOOGLE_SHORT_HOSTS, isGoogleMapsHost } from '../maps/maps.service';
import { isDirectionsUrl, parseDirectionsUrl, MAX_DIR_WAYPOINTS } from '../places/maps-dir.helpers';
import { isAmapHost, isAmapShortHost, parseAmapRouteUrl, MAX_AMAP_ROUTE_WAYPOINTS } from '../places/amap-dir.helpers';
import { gcj02ToWgs84 } from '../geo/gcj02';
import { safeFetchFollow } from '../../utils/ssrfGuard';
import { DatabaseService } from '../database/database.service';
import { PlacesService } from '../places/places.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { PermissionsService } from '../permissions/permissions.service';

@Injectable()
export class GoogleRouteService {
  constructor(private readonly maps: MapsService, private readonly db: DatabaseService,
    private readonly places: PlacesService, private readonly assignments: AssignmentsService,
    private readonly permissions: PermissionsService) {}

  async preview(raw: string): Promise<GoogleRoutePreview> {
    let url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !isGoogleMapsHost(url.hostname) && !GOOGLE_SHORT_HOSTS.includes(url.hostname))
      throw new HttpException({ error: 'Use a Google Maps directions link.' }, 400);
    if (GOOGLE_SHORT_HOSTS.includes(url.hostname)) {
      const reply = await safeFetchFollow(url.href, { signal: AbortSignal.timeout(10000) });
      url = new URL(reply.url);
      await reply.body?.cancel();
      if (!isGoogleMapsHost(url.hostname)) throw new HttpException({ error: 'Use a Google Maps directions link.' }, 400);
    }
    if (url.protocol !== 'https:' || !isDirectionsUrl(url.href))
      throw new HttpException({ error: 'Use a Google Maps directions link.' }, 400);
    const waypoints = parseDirectionsUrl(url.href, MAX_DIR_WAYPOINTS + 1);
    if (waypoints.length < 2 || waypoints.length > MAX_DIR_WAYPOINTS)
      throw new HttpException({ error: 'The link must contain between 2 and 30 readable stops.' }, 400);
    const stops: GoogleRoutePreview['stops'] = [];
    for (const waypoint of waypoints) {
      let name = (waypoint.name || `${waypoint.lat}, ${waypoint.lng}`).slice(0, 200);
      if (waypoint.lat !== null && waypoint.lng !== null) {
        if (!waypoint.name) {
          try {
            const place = await this.maps.reverseGeocode(String(waypoint.lat), String(waypoint.lng), undefined, { lane: 'background', timeoutMs: 5000, locality: true });
            name = (place.name || place.address || name).slice(0, 200);
          } catch { /* Keep the supplied position when its name cannot be resolved. */ }
        }
        stops.push({ name, lat: waypoint.lat, lng: waypoint.lng });
        continue;
      }
      let position: { lat: number; lng: number } | null = null;
      if (!/^(your location|my location|dein standort|mein standort|current location)$/i.test(name)) {
        try { position = await this.maps.geocodeQuery(name); } catch { position = null; }
      }
      if (position && (!Number.isFinite(position.lat) || !Number.isFinite(position.lng) || Math.abs(position.lat) > 90 || Math.abs(position.lng) > 180)) position = null;
      stops.push({ name, lat: position?.lat ?? null, lng: position?.lng ?? null });
    }
    return { stops };
  }

  /**
   * The stops of a shared AMap (高德) directions link.
   *
   * A twin of `preview` rather than a branch inside it: the two link grammars share
   * nothing but the idea of a route in a URL, and the rule that differs is the
   * important one — AMap writes GCJ-02, TT stores WGS-84, so every coordinate is
   * converted here. Keeping the link's own numbers would put each stop a few hundred
   * metres off, which reads as a routing bug rather than a units bug.
   *
   * A stop that carries only a name is geocoded, the same as the Google path, so a
   * link without coordinates still imports.
   */
  async previewAmap(raw: string): Promise<GoogleRoutePreview> {
    let url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !isAmapHost(url.hostname) && !isAmapShortHost(url.hostname))
      throw new HttpException({ error: 'Use an AMap directions link.' }, 400);
    if (isAmapShortHost(url.hostname)) {
      // One hop only: `stopAtFirstRedirect` returns the first 3xx itself instead of
      // walking the chain, because the second hop re-encodes Chinese names as latin1
      // and corrupts them beyond recovery — the trap the place resolver documents.
      const reply = await safeFetchFollow(
        url.href,
        { signal: AbortSignal.timeout(10000) },
        { stopAtFirstRedirect: true },
      );
      const hop = reply.headers.get('location');
      await reply.body?.cancel();
      if (!hop) throw new HttpException({ error: 'Use an AMap directions link.' }, 400);
      url = new URL(hop, url.href);
      if (!isAmapHost(url.hostname)) throw new HttpException({ error: 'Use an AMap directions link.' }, 400);
    }
    const waypoints = parseAmapRouteUrl(url.href, MAX_AMAP_ROUTE_WAYPOINTS);
    if (waypoints.length < 2 || waypoints.length > MAX_AMAP_ROUTE_WAYPOINTS)
      throw new HttpException({ error: 'The link must contain between 2 and 30 readable stops.' }, 400);
    const stops: GoogleRoutePreview['stops'] = [];
    for (const waypoint of waypoints) {
      let name = (waypoint.name || '').slice(0, 200);
      if (waypoint.lat !== null && waypoint.lng !== null) {
        // The link's own pair is GCJ-02; everything downstream is WGS-84.
        const wgs = gcj02ToWgs84(waypoint.lng, waypoint.lat);
        if (!name) {
          try {
            const place = await this.maps.reverseGeocode(String(wgs.lat), String(wgs.lng), undefined, { lane: 'background', timeoutMs: 5000, locality: true });
            name = (place.name || place.address || `${wgs.lat}, ${wgs.lng}`).slice(0, 200);
          } catch { name = `${wgs.lat}, ${wgs.lng}`; }
        }
        stops.push({ name, lat: wgs.lat, lng: wgs.lng });
        continue;
      }
      let position: { lat: number; lng: number } | null = null;
      if (name) {
        try { position = await this.maps.geocodeQuery(name); } catch { position = null; }
      }
      if (position && (!Number.isFinite(position.lat) || !Number.isFinite(position.lng) || Math.abs(position.lat) > 90 || Math.abs(position.lng) > 180)) position = null;
      stops.push({ name, lat: position?.lat ?? null, lng: position?.lng ?? null });
    }
    return { stops };
  }

  import(tripId: number, userId: number, input: GoogleRouteImport, socketId?: string) {
    const access = this.db.canAccessTrip(tripId, userId);
    if (!access) throw new HttpException({ error: 'Trip not found' }, 404);
    const role = this.db.get<{ role: string }>('SELECT role FROM users WHERE id = ?', userId)?.role ?? 'user';
    if (!['place_edit', 'day_edit'].every(action => this.permissions.checkPermission(action, role, access.user_id, userId, access.user_id !== userId)))
      throw new HttpException({ error: 'Permission denied' }, 403);
    if (!this.assignments.dayExists(String(input.dayId), String(tripId))) throw new HttpException({ error: 'Day not found' }, 404);
    const imported = this.db.transaction(() => input.stops.map(stop => {
      const place = this.places.create(String(tripId), { ...stop, transport_mode: 'car', duration_minutes: 0 });
      const assignment = this.assignments.createAssignment(input.dayId, place.id);
      return { place, assignment };
    }));
    for (const { place, assignment } of imported) {
      this.places.broadcast(String(tripId), 'place:created', { place }, socketId);
      this.assignments.broadcast(String(tripId), 'assignment:created', { assignment }, socketId);
    }
    this.assignments.reconcile(tripId, socketId);
    return { imported: imported.length };
  }
}
