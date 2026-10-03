import { beforeEach, describe, expect, it, vi } from 'vitest';

const detailsMock = vi.fn();
vi.mock('../../api/client', () => ({
  mapsApi: {
    details: (...args: unknown[]) => detailsMock(...args),
  },
}));

import { attachAmapHotspots, fetchHotspotDetail, hotspotPopup } from './amapHotspots';
import { gcj02ToWgs84 } from './engines/amap';

const labels = { add: '添加为地点', loading: '加载中', noDetail: '暂无详细信息' };

describe('fetchHotspotDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps the detail place record into what the popup shows', async () => {
    detailsMock.mockResolvedValue({
      place: { address: '广东省 · 深圳市 · 南山区 · 某街1号', phone: '0755-1234', rating: 4.5, open_time: '10:00-22:00', photos: ['https://cache.amap.com/a.jpg'] },
    });
    const detail = await fetchHotspotDetail('B001');
    expect(detailsMock).toHaveBeenCalledWith('amap:B001');
    expect(detail).toEqual({
      address: '广东省 · 深圳市 · 南山区 · 某街1号',
      phone: '0755-1234',
      rating: 4.5,
      openTime: '10:00-22:00',
      photo: 'https://cache.amap.com/a.jpg',
    });
  });

  it('one detail call per POI per session: a re-tap reuses the cached answer', async () => {
    detailsMock.mockResolvedValue({ place: { address: 'x' } });
    await fetchHotspotDetail('B002');
    await fetchHotspotDetail('B002');
    expect(detailsMock).toHaveBeenCalledTimes(1);
  });

  it('a "no details" answer is cached, a failure is not', async () => {
    detailsMock.mockResolvedValueOnce({ place: null }).mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'));
    expect(await fetchHotspotDetail('B003')).toBeNull();
    // Null place: a real answer, the next tap reads the cache.
    await fetchHotspotDetail('B003');
    expect(detailsMock).toHaveBeenCalledTimes(1);
    // Failure: not cached, the retry hits the API again (and fails again).
    await expect(fetchHotspotDetail('B004')).rejects.toThrow('offline');
    await expect(fetchHotspotDetail('B004')).rejects.toThrow('offline');
    expect(detailsMock).toHaveBeenCalledTimes(3);
  });
});

describe('hotspotPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fills with address, rating, hours and phone once the detail lands', () => {
    const popup = hotspotPopup({ hotspot: { lat: 22.5, lng: 114.0, name: '啤酒小镇', amapId: 'B001' }, labels, onAdd: vi.fn() });
    expect(popup.element.textContent).toContain('啤酒小镇');
    expect(popup.element.textContent).toContain(labels.loading);
    popup.fill({ address: '深圳市南山区', phone: '0755-1234', rating: 4.5, openTime: '10:00-22:00', photo: 'https://c/a.jpg' });
    const text = popup.element.textContent;
    expect(text).toContain('深圳市南山区');
    expect(text).toContain('⭐ 4.5');
    expect(text).toContain('10:00-22:00');
    expect(text).toContain('0755-1234');
    const img = popup.element.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://c/a.jpg');
  });

  it('a null detail shows the no-detail line, and the button still adds', () => {
    const onAdd = vi.fn();
    const popup = hotspotPopup({ hotspot: { lat: 22.5, lng: 114.0, name: '啤酒小镇', amapId: 'B001' }, labels, onAdd });
    popup.fill(null);
    expect(popup.element.textContent).toContain(labels.noDetail);
    (popup.element.querySelector('button') as HTMLButtonElement).click();
    expect(onAdd).toHaveBeenCalledWith({
      lat: 22.5,
      lng: 114.0,
      name: '啤酒小镇',
      address: null,
      website: null,
      phone: null,
      osm_id: 'amap:B001',
    });
  });

  it('an id-less hotspot adds without an osm_id, before any detail exists', () => {
    const onAdd = vi.fn();
    const popup = hotspotPopup({ hotspot: { lat: 22.5, lng: 114.0, name: '无名点', amapId: '' }, labels, onAdd });
    expect(popup.element.textContent).toContain(labels.noDetail);
    (popup.element.querySelector('button') as HTMLButtonElement).click();
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: '无名点', osm_id: '' }));
  });
});

describe('attachAmapHotspots', () => {
  it('opens the popup at the tapped label, in map coordinates, and fills from the detail', async () => {
    detailsMock.mockResolvedValue({ place: { address: '深圳市南山区', phone: null, rating: null, open_time: null, photos: [] } });
    const info = { setContent: vi.fn(), open: vi.fn(), close: vi.fn() };
    // A regular function: `new AMap.InfoWindow(...)` must be able to construct it.
    const AMap = { InfoWindow: vi.fn(function (this: unknown) { return info; }) };
    const handlers: Record<string, (e: any) => void> = {};
    const map = { on: vi.fn((ev: string, h: (e: any) => void) => (handlers[ev] = h)), off: vi.fn() };
    const suppressClick = vi.fn();
    const onAdd = vi.fn();
    const infoRef = { current: null };

    const detach = attachAmapHotspots({ map, AMap, info: infoRef, suppressClick, getLabels: () => labels, onAdd });
    expect(map.on).toHaveBeenCalledWith('hotspotclick', expect.any(Function));

    // Shenzhen, GCJ-02 — the popup anchors where the label sits (GCJ), while
    // the poi handed on crosses the boundary to WGS-84.
    // A fresh id: the B001 cache from the unit tests above must not answer here.
    handlers['hotspotclick']({ lnglat: { getLng: () => 114.06, getLat: () => 22.55 }, name: 'BREWTOWN啤酒小镇', id: 'B100' });
    expect(suppressClick).toHaveBeenCalled();
    const w = gcj02ToWgs84(114.06, 22.55);
    expect(info.open).toHaveBeenCalledWith(map, [114.06, 22.55]);
    const element = info.setContent.mock.calls[0][0] as HTMLDivElement;
    expect(element.textContent).toContain('BREWTOWN啤酒小镇');

    await Promise.resolve();
    await Promise.resolve();
    expect(element.textContent).toContain('深圳市南山区');

    (element.querySelector('button') as HTMLButtonElement).click();
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ lat: w.lat, lng: w.lng, osm_id: 'amap:B100' }));
    expect(info.close).toHaveBeenCalled();

    detach();
    expect(map.off).toHaveBeenCalledWith('hotspotclick', expect.any(Function));
  });

  it('reuses the renderer InfoWindow instead of opening a second one', () => {
    detailsMock.mockResolvedValue({ place: null });
    const shared = { setContent: vi.fn(), open: vi.fn(), close: vi.fn() };
    const AMap = { InfoWindow: vi.fn(function (this: unknown) { return shared; }) };
    const handlers: Record<string, (e: any) => void> = {};
    const map = { on: vi.fn((ev: string, h: (e: any) => void) => (handlers[ev] = h)), off: vi.fn() };
    const infoRef = { current: shared };
    attachAmapHotspots({ map, AMap, info: infoRef, suppressClick: vi.fn(), getLabels: () => labels, onAdd: vi.fn() });
    handlers['hotspotclick']({ lnglat: { getLng: () => 114.06, getLat: () => 22.55 }, name: 'x', id: 'B9' });
    expect(AMap.InfoWindow).not.toHaveBeenCalled();
    expect(shared.open).toHaveBeenCalled();
  });
});
