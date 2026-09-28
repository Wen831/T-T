import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';
import { loadAmap, wgs84ToGcj02, type AMapMap } from '../Map/engines/amap';

/**
 * The AMap preview on Settings → Map.
 *
 * The GL providers get `MapboxPreview`, which the settings tab can talk to
 * through one shared `gl` prop; AMap has no such shared surface, so this is a
 * small purpose-built component instead of widening that one. It owns nothing
 * but one map instance — no places, no routes, no overlays — because its job is
 * to answer "does this key work, and what does the map look like".
 *
 * The map is destroyed whenever the key changes. That matters more here than in
 * the real map: the settings tab is where a key is typed for the first time, and
 * `loadAmap` caches per key, so a stale instance would keep showing the previous
 * (possibly rejected) SDK.
 */
export default function AMapPreview({
  apiKey,
  lat,
  lng,
  zoom,
}: {
  apiKey: string;
  lat: number;
  lng: number;
  zoom: number;
}) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AMapMap | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    loadAmap(apiKey)
      .then((AMap) => {
        if (cancelled || !hostRef.current) return;
        // Same conversion as the real renderer: the archive and every coordinate
        // the app holds are WGS-84, while AMap draws in GCJ-02.
        const center = wgs84ToGcj02(lng, lat);
        const map = new AMap.Map(hostRef.current, {
          zoom,
          center: [center.lng, center.lat],
          lang: 'zh_cn',
          viewMode: '2D',
          resizeEnable: true,
        });
        mapRef.current = map;
      })
      .catch(() => {
        // A rejected key is the normal failure here, and it is worth saying so
        // rather than showing an empty frame that looks like a rendering bug.
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, [apiKey, lat, lng, zoom]);

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-lg border border-edge bg-surface-secondary px-4 text-center text-caption text-content-muted">
        {t('map.amapPreviewFailed')}
      </div>
    );
  }

  return <div ref={hostRef} className="h-full w-full overflow-hidden rounded-lg border border-edge" />;
}
