import type { RoadtripVia } from '@trek/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { pluginsApi, type PluginMapLayer, type PluginMapMarker } from '../../api/client';
import { useGeolocation } from '../../hooks/useGeolocation';
import { useTransportRoutes } from '../../hooks/useTransportRoutes';
import { useTranslation } from '../../i18n';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { RouteVia } from '../../types';
import ErrorBoundary from '../shared/ErrorBoundary';
import { MapView } from './MapView';
import { clusterAMapPoints, type AMapPlaceCluster } from './amapClusters';
import { attachAmapHotspots } from './amapHotspots';
import { applyTrackAmap, type TrailMap, type TrailOverlayApi } from './amapDawarichTrail';
import { applyHazardsAmap, type AmapHazardApi, type AmapHazardMap } from './amapHazards';
import { ReservationAMapOverlay, attachLocationAMapOverlay } from './amapOverlays';
import { applyViasAmap, type AmapViaApi, type AmapViaManager, type AmapViaMap } from './amapVias';
import { visibleRouteReservations } from '../../utils/reservationRoutes';
import { gcj02ToWgs84, loadAmap, wgs84ToGcj02, type AMapMap, type AMapModule, type AMapOverlay } from './engines/amap';
import { hazardPopup } from './hazardPopup';
import { NIGHT_PAUSE_MIN_ZOOM, nightPauseMarker } from './nightPauseMarker';
import { hasManualTrackColor, resolveTrackColor } from './trackColors';

const TONES: Record<string, string> = { default: '#4F46E5', success: '#10b981', warn: '#f59e0b', danger: '#ef4444' };
const valid = (lat: unknown, lng: unknown) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
const gcjPath = (points: [number, number][]) =>
  points
    .filter((p) => valid(p[0], p[1]))
    .map(([lat, lng]) => {
      const c = wgs84ToGcj02(lng, lat);
      return [c.lng, c.lat] as [number, number];
    });
const point = (p: any) => (valid(p?.lat, p?.lng) ? wgs84ToGcj02(Number(p.lng), Number(p.lat)) : null);
function html(value: unknown) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}
function dwell(seconds: number) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

export function MapViewAMap(props: any) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapMap | null>(null);
  const amapRef = useRef<AMapModule | null>(null);
  const overlaysRef = useRef<AMapOverlay[]>([]);
  const trailRef = useRef<{ clear: () => void } | null>(null);
  const hazardRef = useRef<{ clear: () => void } | null>(null);
  const viaRef = useRef<AmapViaManager | null>(null);
  const trailPropsRef = useRef({
    track: props.dawarichTrack ?? null,
    selectedDate: props.dawarichSelectedDate ?? null,
    hiddenDates: props.dawarichHiddenDates ?? null,
  });
  trailPropsRef.current = {
    track: props.dawarichTrack ?? null,
    selectedDate: props.dawarichSelectedDate ?? null,
    hiddenDates: props.dawarichHiddenDates ?? null,
  };
  const infoRef = useRef<any>(null);
  const reservationOverlayRef = useRef<ReservationAMapOverlay | null>(null);
  const locationOverlayRef = useRef<ReturnType<typeof attachLocationAMapOverlay> | null>(null);

  // Which bookings draw a line, under the same rules the Leaflet/GL maps use:
  // transit journeys ride the day's route toggle, every other booking its own
  // connection toggle (#1065/#2019). Before this, the AMap overlay ignored
  // visibleConnectionIds entirely, so the per-booking toggles did nothing and
  // every booking drew a straight endpoint-to-endpoint line whenever the day
  // route toggle was on.
  const visibleReservations = useMemo(
    () =>
      visibleRouteReservations(props.reservations || [], {
        visibleConnectionIds: props.visibleConnectionIds,
        showTransitRoutes: !!props.showTransitRoutes,
        selectedDayId: props.selectedDayId,
        days: props.days,
      }),
    [props.reservations, props.visibleConnectionIds, props.showTransitRoutes, props.selectedDayId, props.days]
  );
  // Road-network geometry for the road-based bookings among them. On an AMap
  // instance the lines come from the server's traffic-aware proxy instead of
  // the public OSRM servers, whose Chinese road networks are thin; a routing
  // failure still falls back to the straight line.
  const hasAmapKey = useAuthStore((s) => s.hasAmapKey);
  const transportRoutes = useTransportRoutes(visibleReservations, hasAmapKey);
  const suppressMapClickRef = useRef(false);
  const callbacksRef = useRef({ onMapClick: props.onMapClick, onMapContextMenu: props.onMapContextMenu, onHotspotAdd: props.onHotspotAdd });
  callbacksRef.current = { onMapClick: props.onMapClick, onMapContextMenu: props.onMapContextMenu, onHotspotAdd: props.onHotspotAdd };
  // Basemap-hotspot popup labels, refreshed each render so a language switch
  // reaches the popup without re-binding the map listener.
  const hotspotLabelsRef = useRef({ add: '', loading: '', noDetail: '' });
  hotspotLabelsRef.current = {
    add: t('places.amapHotspotAdd'),
    loading: t('places.loadingDetails'),
    noDetail: t('places.amapHotspotNoDetail'),
  };
  const suppressMapClick = () => {
    suppressMapClickRef.current = true;
    queueMicrotask(() => {
      suppressMapClickRef.current = false;
    });
  };
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [pluginMarkers, setPluginMarkers] = useState<PluginMapMarker[]>([]);
  const [pluginLayers, setPluginLayers] = useState<PluginMapLayer[]>([]);
  const [pluginVersion, setPluginVersion] = useState(0);
  const [mapZoom, setMapZoom] = useState<number | null>(null);
  // The handle the user tapped. While one is selected the delete zone is on
  // screen: dragging the handle into it removes the point. This replaces a long
  // press, which a browser claims for text selection rather than delivering.
  const [selectedVia, setSelectedVia] = useState<{ dayId: number; id: number } | null>(null);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const places = props.places || [];
  const dayPlaces = props.dayPlaces || [];
  const selected = props.selectedPlaceId;
  const { position, mode } = useGeolocation();
  const settingsKey = useSettingsStore((s) => s.settings.amap_js_api_key);
  const points = useMemo(() => places.filter((p: any) => valid(p.lat, p.lng)), [places]);

  useEffect(() => {
    let cancelled = false;
    let onMapClick: ((event: any) => void) | null = null;
    let onContextMenu: ((event: any) => void) | null = null;
    let onZoomEnd: (() => void) | null = null;
    let detachHotspots: (() => void) | null = null;
    loadAmap(settingsKey)
      .then((AMap) => {
        if (cancelled || !hostRef.current) return;
        amapRef.current = AMap;
        const center = props.center || [0, 0];
        const c = wgs84ToGcj02(Number(center[1]), Number(center[0]));
        const is3d = props.amapViewMode === '3D';
        const map = new AMap.Map(hostRef.current, {
          zoom: Number(props.zoom ?? 5),
          center: [c.lng, c.lat],
          lang: 'zh_cn',
          viewMode: is3d ? '3D' : '2D',
          pitch: is3d ? Number(props.amapPitch ?? 45) : 0,
          rotation: Number(props.amapRotation ?? 0),
          showBuildingBlock: is3d,
          resizeEnable: true,
        });
        mapRef.current = map;
        onMapClick = (event: any) => {
          if (suppressMapClickRef.current) {
            suppressMapClickRef.current = false;
            return;
          }
          const ll = event.lnglat;
          const w = gcj02ToWgs84(Number(ll.getLng()), Number(ll.getLat()));
          callbacksRef.current.onMapClick?.({ lat: w.lat, lng: w.lng, latlng: w });
        };
        onContextMenu = (event: any) => {
          const ll = event.lnglat;
          const w = gcj02ToWgs84(Number(ll.getLng()), Number(ll.getLat()));
          callbacksRef.current.onMapContextMenu?.({
            latlng: w,
            originalEvent: event.originEvent || event.originalEvent,
          });
        };
        onZoomEnd = () => setMapZoom(Number(map.getZoom?.() ?? props.zoom ?? 5));
        map.on('click', onMapClick);
        map.on('contextmenu', onContextMenu);
        map.on('zoomend', onZoomEnd);
        // Basemap POI labels open a detail popup with an "add as place" action.
        // Bound only when a consumer actually adds — other embeds keep labels inert.
        detachHotspots = props.onHotspotAdd
          ? attachAmapHotspots({
              map,
              AMap,
              info: infoRef,
              suppressClick: suppressMapClick,
              getLabels: () => hotspotLabelsRef.current,
              onAdd: (poi) => callbacksRef.current.onHotspotAdd?.(poi),
            })
          : null;
        setMapZoom(Number(map.getZoom?.() ?? props.zoom ?? 5));
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      overlaysRef.current.forEach((o) => o.setMap(null));
      overlaysRef.current = [];
      infoRef.current?.close?.();
      const map = mapRef.current;
      if (map?.off) {
        if (onMapClick) map.off('click', onMapClick);
        if (onContextMenu) map.off('contextmenu', onContextMenu);
        if (onZoomEnd) map.off('zoomend', onZoomEnd);
      }
      detachHotspots?.();
      trailRef.current?.clear();
      trailRef.current = null;
      reservationOverlayRef.current?.destroy();
      reservationOverlayRef.current = null;
      locationOverlayRef.current?.destroy();
      locationOverlayRef.current = null;
      mapRef.current?.destroy();
      mapRef.current = null;
      setReady(false);
    };
  }, [settingsKey]); // map lifecycle is intentionally mount-only

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const center = props.center || [0, 0];
    const c = wgs84ToGcj02(Number(center[1]), Number(center[0]));
    map.setZoomAndCenter(Number(props.zoom ?? 5), [c.lng, c.lat]);
  }, [props.center?.[0], props.center?.[1], props.zoom, ready]);

  // The recorded trail, drawn under the planned route the way the Leaflet layer
  // and the GL source are (TT port of upstream 4.3.0; upstream has no AMap
  // engine, so this is TT's own twin). Segments are flattened by date outside
  // AMap and each becomes a casing line plus its day-coloured dashed line.
  useEffect(() => {
    const map = mapRef.current as unknown as TrailMap | null;
    const AMap = amapRef.current as unknown as TrailOverlayApi | null;
    if (!map || !AMap || !ready) {
      trailRef.current?.clear();
      trailRef.current = null;
      return;
    }
    trailRef.current?.clear();
    const { track, selectedDate, hiddenDates } = trailPropsRef.current;
    trailRef.current = applyTrackAmap(AMap, map, track, selectedDate, hiddenDates);
  }, [ready, props.dawarichTrack, props.dawarichSelectedDate, props.dawarichHiddenDates]);

  // Weather and disaster notices, under the planned route: they are background
  // about the road ahead, not something to click past to reach the plan. Empty
  // unless the traveller turned the layer on, so nothing is drawn by default.
  // TT's own twin of the Leaflet and GL layers — see docs/MAP-ENGINES.md.
  useEffect(() => {
    const map = mapRef.current as unknown as AmapHazardMap | null;
    const AMap = amapRef.current as unknown as AmapHazardApi | null;
    const hazards = props.hazards ?? [];
    if (!map || !AMap || !ready || hazards.length === 0) {
      hazardRef.current?.clear();
      hazardRef.current = null;
      return;
    }
    hazardRef.current?.clear();
    const color = getComputedStyle(document.documentElement).getPropertyValue('--warning').trim() || '#f59e0b';
    hazardRef.current = applyHazardsAmap(
      AMap,
      map,
      hazards,
      // A fresh window per click: one shared window across a hundred notices
      // would need telling which one it belongs to, and AMap does not close the
      // previous one for us.
      () => (AMap.InfoWindow ? new AMap.InfoWindow({ offset: [0, -8], isCustom: false }) : null),
      (hazard) => hazardPopup(hazard, t('roadtrip.hazards.note'), t('roadtrip.hazards.point')),
      color
    );
  }, [ready, props.hazards]);

  // The traveller's own handles, draggable and touch-removable. Drawn above the
  // route's tone dots so a handle is what a click lands on. The manager updates
  // existing markers in place; it must not tear down the marker under a finger
  // after the server accepts a drag.
  useEffect(() => {
    const map = mapRef.current as unknown as AmapViaMap | null;
    const AMap = amapRef.current as unknown as AmapViaApi | null;
    const byDay = props.roadtripVias as Record<number, RoadtripVia[]> | undefined;
    const vias = byDay ? Object.values(byDay).flat() : [];
    if (!map || !AMap || !ready) return;
    const handlers = {
      onMove: props.onMoveVia,
      onRemove: props.onRemoveVia,
      onSelect: (selection: { dayId: number; id: number } | null) => setSelectedVia(selection),
    };
    const zoom = mapZoom ?? Number(props.zoom ?? 5);

    if (!viaRef.current) {
      viaRef.current = applyViasAmap(AMap, map, vias, handlers, zoom);
    } else {
      viaRef.current.update(vias, handlers, zoom);
    }
  }, [ready, props.roadtripVias, props.onMoveVia, props.onRemoveVia, mapZoom]);

  // The selected handle, so the drop zone knows what it would delete and the dot
  // stays ringed while the finger travels to it.
  const selectedKey = selectedVia ? `${selectedVia.dayId}:${selectedVia.id}` : null;
  useEffect(() => {
    viaRef.current?.setSelected(selectedKey);
  }, [selectedKey]);

  // The zone is measured from the DOM rather than assumed, because the map fills
  // whatever the shell gives it and the safe-area inset differs per device.
  useEffect(() => {
    const zone = dropZoneRef.current;
    if (!viaRef.current || !zone) return;
    if (!selectedVia) {
      viaRef.current.setDropZone(null);
      return;
    }
    const r = zone.getBoundingClientRect();
    viaRef.current.setDropZone({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }, [selectedVia, ready]);

  useEffect(() => () => {
    viaRef.current?.clear();
    viaRef.current = null;
  }, []);

  // Core place markers, POIs, via points, plugin markers and InfoWindow interactions.
  useEffect(() => {
    const map = mapRef.current;
    const AMap = amapRef.current;
    if (!map || !AMap || !ready) return;
    const old = overlaysRef.current;
    old.forEach((o) => o.setMap(null));
    overlaysRef.current = [];
    const info =
      infoRef.current || (AMap.InfoWindow ? new AMap.InfoWindow({ offset: [0, -8], isCustom: false }) : null);
    infoRef.current = info;
    const addMarker = (spec: any, click?: () => void, hoverText?: string) => {
      const marker = new AMap.Marker({
        position: spec.position,
        title: spec.title || '',
        content: spec.content,
        draggable: !!spec.draggable,
        zIndex: spec.zIndex || 100,
        ...(spec.visible === undefined ? {} : { visible: spec.visible }),
      });
      marker.setMap(map);
      marker.on?.('click', () => {
        suppressMapClick();
        click?.();
      });
      if (hoverText) {
        marker.on?.('mouseover', () => info?.setContent(hoverText) && info.open(map, spec.position));
        marker.on?.('mouseout', () => info?.close());
      }
      overlaysRef.current.push(marker);
      return marker;
    };
    const clusters = clusterAMapPoints(
      points.map((place: any) => ({ item: place, lat: Number(place.lat), lng: Number(place.lng) })),
      mapZoom ?? Number(map.getZoom?.() ?? props.zoom ?? 5)
    );
    const expandCluster = (cluster: AMapPlaceCluster<any>) => {
      const c = wgs84ToGcj02(cluster.lng, cluster.lat);
      const nextZoom = Math.min(11, Number(map.getZoom?.() ?? props.zoom ?? 5) + 2);
      map.setZoomAndCenter(nextZoom, [c.lng, c.lat]);
    };
    for (const cluster of clusters) {
      if (cluster.members.length > 1) {
        const c = wgs84ToGcj02(cluster.lng, cluster.lat);
        const count = cluster.members.length;
        addMarker(
          {
            position: [c.lng, c.lat],
            title: `${count} places`,
            content: `<div style="min-width:36px;height:36px;padding:0 8px;display:flex;align-items:center;justify-content:center;border-radius:999px;background:#111827;color:#fff;border:2px solid rgba(255,255,255,.9);box-shadow:0 1px 5px #555;font:600 12px/1 sans-serif">${count}</div>`,
            zIndex: 900,
          },
          () => expandCluster(cluster)
        );
        continue;
      }
      const place = cluster.members[0] as any;
      const c = point(place)!;
      const isSelected = place.id === selected;
      const color = place.category_color || '#2563eb';
      const content = `<div style="width:${isSelected ? 22 : 18}px;height:${isSelected ? 22 : 18}px;border-radius:50%;background:${html(color)};border:3px solid ${isSelected ? '#111827' : '#fff'};box-shadow:0 1px 5px #555"></div>`;
      const marker = addMarker(
        {
          position: [c.lng, c.lat],
          title: place.name,
          content,
          draggable: !!props.onMarkerDrag,
          zIndex: isSelected ? 1000 : 100,
        },
        () => props.onMarkerClick?.(place.id),
        place.name ? `<b>${html(place.name)}</b><br/>${html(place.address || '')}` : undefined
      );
      marker.on?.('dragend', (e: any) => {
        const ll = e.lnglat;
        props.onMarkerDrag?.(place, gcj02ToWgs84(Number(ll.getLng()), Number(ll.getLat())));
      });
    }
    for (const poi of props.pois || []) {
      const c = point(poi);
      if (!c) continue;
      addMarker(
        {
          position: [c.lng, c.lat],
          title: poi.name,
          content: `<div style="width:18px;height:18px;border-radius:50%;background:#f59e0b;border:2px solid white"></div>`,
          zIndex: 500,
        },
        () => props.onPoiClick?.(poi),
        poi.name
      );
    }
    for (const via of (props.routeVias || []) as RouteVia[]) {
      const c = point(via);
      if (!c) continue;
      // A night stop is drawn as its own marker rather than a tone dot: it says
      // which night and whether the car stands at a place or beside the road.
      // The HTML is the same string the Leaflet and GL renderers mount, so all
      // three agree on what the traveller sees. Below NIGHT_PAUSE_MIN_ZOOM it is
      // left off — a label a few pixels wide over a continent is not readable,
      // and the drive is then being read rather than planned.
      const night = via.nightPause;
      const color = TONES[via.tone] || TONES.default;
      addMarker(
        {
          position: [c.lng, c.lat],
          content: night
            ? nightPauseMarker(via)
            : `<div style="width:13px;height:13px;border-radius:50%;background:#fff;border:3px solid ${color}"></div>`,
          zIndex: night ? 800 : 700,
          ...(night ? { visible: (mapZoom ?? 99) >= NIGHT_PAUSE_MIN_ZOOM } : {}),
        },
        () => {
          if (via.label || via.dwellSeconds != null) {
            info?.setContent(
              html([via.label, via.dwellSeconds != null ? dwell(via.dwellSeconds) : ''].filter(Boolean).join(' · '))
            );
            info?.open(map, [c.lng, c.lat]);
          }
        }
      );
    }
    for (const layer of pluginLayers) {
      for (const feature of layer.features || []) {
        const color = TONES[feature.tone] || TONES.default;
        if (feature.type === 'circle' && AMap.Circle && feature.center && feature.radiusM) {
          const c = wgs84ToGcj02(feature.center[1], feature.center[0]);
          const shape = new AMap.Circle({
            center: [c.lng, c.lat],
            radius: feature.radiusM,
            strokeColor: color,
            strokeWeight: feature.width,
            strokeOpacity: feature.opacity,
            fillColor: color,
            fillOpacity: feature.fill ? feature.opacity * 0.25 : 0,
          });
          shape.setMap(map);
          overlaysRef.current.push(shape);
        } else if (feature.points) {
          const path = gcjPath(feature.points);
          const Ctor = feature.type === 'polygon' ? AMap.Polygon : AMap.Polyline;
          if (!Ctor) continue;
          const shape = new Ctor({
            path,
            strokeColor: color,
            strokeWeight: feature.width,
            strokeOpacity: feature.opacity,
            strokeStyle: feature.dash === 'solid' ? 'solid' : 'dashed',
            fillColor: color,
            fillOpacity: feature.fill ? feature.opacity * 0.25 : 0,
          });
          shape.setMap(map);
          overlaysRef.current.push(shape);
        }
      }
    }
    return () => {
      overlaysRef.current.forEach((o) => o.setMap(null));
      overlaysRef.current = [];
    };
  }, [
    points,
    props.pois,
    props.routeVias,
    props.tripId,
    selected,
    props.onMarkerClick,
    props.onMarkerDrag,
    props.onPoiClick,
    pluginVersion,
    pluginLayers,
    mapZoom,
    ready,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = amapRef.current;
    if (!map || !AMap || !ready) return;
    const lines: AMapOverlay[] = [];
    const addLine = (path: [number, number][], options: any) => {
      if (path.length < 2) return;
      const line = new AMap.Polyline({ path, ...options });
      line.setMap(map);
      lines.push(line);
    };
    const route = props.route || [];
    // A drive day carries its own core and casing, so one day reads the same colour as
    // its card in the rail; absent, it is the single blue the route has always been.
    const routeColors: { line: string; casing: string }[] | undefined = props.routeColors;
    route.forEach((seg, i) => {
      const path = gcjPath(seg);
      // The white under-stroke is deliberately not the day's casing: on AMap the wider
      // halo is what keeps the line legible over satellite imagery, and the coloured
      // core sits on top of it.
      addLine(path, { strokeColor: '#fff', strokeWeight: 9, strokeOpacity: 0.95, zIndex: 20 });
      addLine(path, {
        strokeColor: routeColors?.[i]?.line ?? '#2563eb',
        strokeWeight: 5,
        strokeOpacity: 0.85,
        zIndex: 21,
      });
    });
    // The route as a click target, while it can be reshaped. A transparent band
    // rather than the drawn line: the line is 5-9px and a pointer is not that
    // accurate, so aiming at the road was most of why putting a via there felt like
    // it did not work. AMap reports GCJ-02 and TT stores WGS-84, so the handler
    // converts back before handing the point on.
    if (props.onRouteClick) {
      for (const seg of route) {
        const path = gcjPath(seg);
        if (path.length < 2) continue;
        const band = new AMap.Polyline({
          path,
          strokeColor: 'transparent',
          strokeWeight: 26,
          strokeOpacity: 0,
          zIndex: 22,
        });
        band.setMap(map);
        band.on?.('click', (event: any) => {
          suppressMapClick();
          const ll = event?.lnglat;
          const lng = Number(ll?.getLng?.());
          const lat = Number(ll?.getLat?.());
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
          const wgs = gcj02ToWgs84(lng, lat);
          props.onRouteClick?.(wgs.lat, wgs.lng);
        });
        lines.push(band);
      }
    }
    for (const place of places) {
      if (!place.route_geometry) continue;
      try {
        const coords = JSON.parse(place.route_geometry) as [number, number][];
        const path = gcjPath(coords);
        const color = resolveTrackColor(place);
        addLine(path, {
          strokeColor: '#fff',
          strokeWeight: hasManualTrackColor(place) ? 7 : 6,
          strokeOpacity: 0.95,
          zIndex: 10,
        });
        addLine(path, {
          strokeColor: color,
          strokeWeight: hasManualTrackColor(place) ? 4 : 3,
          strokeOpacity: 0.9,
          zIndex: 11,
        });
        const hit = new AMap.Polyline({
          path,
          strokeColor: 'transparent',
          strokeWeight: 18,
          strokeOpacity: 0,
          zIndex: 12,
        });
        hit.setMap(map);
        hit.on?.('click', () => {
          suppressMapClick();
          props.onMarkerClick?.(place.id);
        });
        lines.push(hit);
      } catch {
        /* invalid GPX is safely ignored */
      }
    }
    return () => lines.forEach((l) => l.setMap(null));
    // `onRouteClick` is a dependency, not just a callback: it arrives as undefined
    // while permissions and the addon are still resolving, and the click band is
    // only created when it is set. Leaving it out meant the band was never drawn
    // on a map that mounted before the planner was ready, and no click could ever
    // reach the handler.
  }, [places, props.route, props.onRouteClick, ready, props.onMarkerClick]);

  useEffect(() => {
    if (props.tripId == null) {
      setPluginMarkers([]);
      setPluginLayers([]);
      return;
    }
    let alive = true;
    Promise.all([pluginsApi.mapMarkers(props.tripId), pluginsApi.mapLayers(props.tripId)])
      .then(([m, l]) => {
        if (!alive) return;
        setPluginMarkers(m.markers || []);
        setPluginLayers(l.layers || []);
        setPluginVersion((version) => version + 1);
      })
      .catch(() => {
        if (!alive) return;
        setPluginMarkers([]);
        setPluginLayers([]);
        setPluginVersion((version) => version + 1);
      });
    return () => {
      alive = false;
    };
  }, [props.tripId]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = amapRef.current;
    if (!map || !AMap || !ready) return;
    const extras: AMapOverlay[] = [];
    for (const mk of pluginMarkers) {
      const c = point(mk);
      if (!c) continue;
      const marker = new AMap.Marker({
        position: [c.lng, c.lat],
        content: `<div style="width:16px;height:16px;border-radius:50%;background:${TONES[mk.tone] || TONES.default};border:2px solid #fff"></div>`,
      });
      marker.setMap(map);
      marker.on?.('click', () => {
        suppressMapClick();
        infoRef.current?.setContent(
          `<b>${html(mk.label)}</b><br/>${html(mk.popupText)}${mk.url ? `<br/><a href="${html(mk.url)}" target="_blank">${html(mk.url)}</a>` : ''}`
        );
        infoRef.current?.open(map, [c.lng, c.lat]);
      });
      extras.push(marker);
    }
    return () => extras.forEach((x) => x.setMap(null));
  }, [pluginMarkers, pluginVersion, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = amapRef.current;
    if (!map || !AMap || !ready) return;
    if (!reservationOverlayRef.current) reservationOverlayRef.current = new ReservationAMapOverlay(map, AMap);
    // The list is pre-filtered by the visibility rules, so everything in it
    // draws; road-routed bookings pass their real geometry, and anything the
    // router could not resolve keeps the straight-line fallback.
    reservationOverlayRef.current.update(visibleReservations, {
      showConnections: true,
      showEndpointLabels: !!props.showReservationStats,
      onEndpointClick: (reservationId: number) => {
        suppressMapClick();
        props.onReservationClick?.(reservationId);
      },
    }, transportRoutes);
  }, [visibleReservations, transportRoutes, props.showReservationStats, props.onReservationClick, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = amapRef.current;
    if (!map || !AMap || !ready) return;
    if (!locationOverlayRef.current) locationOverlayRef.current = attachLocationAMapOverlay(map, AMap);
    locationOverlayRef.current.update(position, { follow: mode === 'follow' });
  }, [position, mode, ready]);

  /**
   * Refit only when a fit is actually asked for.
   *
   * `fitKey` is that request — it is bumped when a day is selected or a place is
   * opened, which are the moments the camera should move. The two data lists are
   * in the dependency list because the effect reads them, but their identity
   * changes on every route recompute and every websocket update, and refitting on
   * those moved the map out from under the user: zoom in, a route lands, and the
   * camera jumps back to the framed view. So the data is read fresh and the fit is
   * keyed on `fitKey` alone.
   */
  const lastFitKey = useRef<number | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || props.fitKey == null) return;
    const target = (dayPlaces.length ? dayPlaces : places).filter((p: any) => valid(p.lat, p.lng));
    if (!target.length) return;
    // Already framed for this request. The first pass with data is the one that
    // counts, so a trip whose places arrive after the key still gets framed once.
    if (lastFitKey.current === props.fitKey) return;
    lastFitKey.current = props.fitKey;
    const overlays = target
      .map((p: any) => {
        const c = point(p)!;
        const m = amapRef.current?.Marker ? new amapRef.current.Marker({ position: [c.lng, c.lat] }) : null;
        m?.setMap(map);
        return m;
      })
      .filter(Boolean) as AMapOverlay[];
    map.setFitView(overlays, false, [60, 60, 60, 60]);
    overlays.forEach((o) => o.setMap(null));
  }, [props.fitKey, dayPlaces, places, ready]);

  if (failed) return <MapView {...props} />;
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 240 }}>
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} aria-label="高德地图" />
      {/* The delete zone, top-left, while a handle is selected. Out of the way of the
          map's own controls (which sit top-right and bottom) and reachable by a thumb
          holding the handle, which is the whole point of a drop target. */}
      {selectedVia && (
        <div
          ref={dropZoneRef}
          role="button"
          aria-label={t('roadtrip.via.dropToDelete')}
          data-testid="amap-via-dropzone"
          style={{
            position: 'absolute',
            left: 12,
            top: 'calc(var(--m-safe-top, 12px) + 8px)',
            zIndex: 1200,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 14px',
            borderRadius: 9999,
            background: 'rgba(220,38,38,.94)',
            color: '#fff',
            font: '600 13px/1 var(--font-system, sans-serif)',
            boxShadow: '0 6px 20px rgba(0,0,0,.35)',
            border: '2px dashed rgba(255,255,255,.85)',
            pointerEvents: 'none',
          }}
        >
          <Trash2 size={15} strokeWidth={2.4} aria-hidden="true" />
          {t('roadtrip.via.dropToDelete')}
        </div>
      )}
    </div>
  );
}

export function AMapFallbackBoundary(props: any) {
  return (
    <ErrorBoundary boundaryId="map:amap" resetKeys={['amap']} fallback={<MapView {...props} />}>
      <MapViewAMap {...props} />
    </ErrorBoundary>
  );
}
