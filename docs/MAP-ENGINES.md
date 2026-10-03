# 地图引擎：三家并列，能力对齐，实现各自独立

TT 有三个地图渲染器，由设置项 `map_provider` **三选一**，互斥使用：

| 设置值 | 渲染器 | 底层 |
|---|---|---|
| `leaflet` | `MapView.tsx` | Leaflet + 栅格瓦片（默认） |
| `mapbox-gl` / `maplibre-gl` | `MapViewGL.tsx` | MapLibre / Mapbox GL，矢量瓦片 |
| `amap` | `MapViewAMap.tsx` | **高德 JS API** |

`MapViewAuto.tsx` 是唯一的选路处：选高德时**根本不会加载 GL chunk**，反之亦然。
所以「GL 能否适配高德」不是问题——它们不在同一条路径上。

---

## 架构原则（本文档存在的理由）

**原生高德自成体系。功能与上游地图商对齐，但不使用他们的接口。**

具体含义：

1. **能力对齐，实现独立。** 上游地图有的功能，高德也要有；但高德不该去复用
   Leaflet 或 MapLibre 的实现，也不该被那两个的实现方式约束。高德有一份自己的
   `amap*` 文件族，这是**刻意的**，不是待清理的重复。

2. **不引入上游的高德实现。** 上游 TREK 的 `amap.provider.ts`、`gcj02Crs.ts`、
   高德瓦片预设都**不移植**。TT 的高德支持（`geo/amap.service.ts` 搜索/详情/路线 +
   `MapViewAMap.tsx` 渲染）比上游成熟，且 `amap_id` / 实例级 key 的模型已经落地。
   新功能应当**接到 TT 已有的高德能力上**，而不是引入第二套。

3. **三家的 API 层次不同，实现不该长得一样。** 下面这张表是为什么「照搬 GL 到高德」
   从一开始就走不通：

| 能力 | Leaflet | MapLibre / Mapbox GL | 高德 JS API |
|---|---|---|---|
| 标记拖拽 | `L.Marker` 内建 `draggable` | **无内建**，上游手写手势判定（约 100 行） | `AMap.Marker` 内建 `draggable` |
| 坐标投影 | 内建 | `map.project()` | `map.lngLatToContainer()` |
| 弹窗 | `bindPopup` | 自己建 `Popup` | `AMap.InfoWindow` 内建 |
| 图元 | `Polygon`/`Circle`/`Polyline` | `addSource` + `addLayer` | `AMap.Polygon`/`Circle`/`Polyline` |

   结论：**GL 上难的东西，在高德上常常是内建行为**；GL 上难的东西，在高德上往往更短。

4. **坐标只在一个边界转换。** 高德说 GCJ-02，TT 内部一律 WGS-84。
   转换只在**进出高德的那一处**发生：`engines/amap.ts` 的 `wgs84ToGcj02` /
   `gcj02ToWgs84`（实现来自 `shared/src/geo/gcj02.ts` 的单一副本）。
   **任何从高德回写到服务端的坐标，必须先转回 WGS-84** —— 漏转会让整条路线偏移
   数百米，而单测里转换是桩，**方向写反时测试依然全绿**。

---

## 高德侧现状（已自成体系的文件族）

| 文件 | 职责 |
|---|---|
| `engines/amap.ts` | 加载 JS API、`wgs84ToGcj02` / `gcj02ToWgs84`、类型 |
| `MapViewAMap.tsx` | 渲染器主体：标记、聚合、日路线（含透明命中线）、插件图层 |
| `amapClusters.ts` | TT 自己的屏幕网格聚合（高德 DOM marker 无稳定聚合契约） |
| `amapHotspots.ts` | 底图 POI 热点点击（`hotspotclick` → 详情弹窗 → 「添加为地点」；仅高德有热点，另两家无底图标注可点） |
| `amapOverlays.ts` | 预约 / 定位覆盖层 |
| `amapDawarichTrail.ts` | 记录轨迹（上游无高德渲染器可移植，TT 自写） |
| `amapHandover.ts` | 导航交接（交接到高德，不是 Google Maps） |

`MapViewAMap.tsx` 已经能画 `AMap.Marker` / `Polyline` / `Polygon` / `Circle` /
`InfoWindow`，并已处理 GeoJSON feature 的三种图元分支 —— 这是后续补图层的基础。

---

## 逐引擎的功能对齐台账

「对齐」指三家都能做同一件事，不指实现相同。未做项标注原因。

| 功能 | Leaflet | GL | 高德 |
|---|---|---|---|
| 地点标记 + 聚合 | ✅ | ✅ | ✅ |
| 日路线 + 命中线 | ✅ | ✅ | ✅ |
| 记录轨迹 | ✅ | ✅ | ✅（TT 自写） |
| 预约 / 定位覆盖层 | ✅ | ✅ | ✅ |
| 插件图层 | ✅ | ✅ | ✅ |
| 悬停卡 | ✅ | ✅ | ✅ |
| 风险图层（DWD/GDACS） | ✅ | ✅ | ✅ `amapHazards.ts` |
| 夜间停靠标记 | ✅ | ⬜ 待做 | ✅ |
| 手动途径点手柄（可拖拽） | ✅ | ⬜ 缺 `attachPin` 等依赖 | ✅ `amapVias.ts` |
| 服务区停靠录入 | ✅（表单层，与引擎无关） | ✅ | ✅ |
| 底图 POI 热点点击 | ⬜ 栅格瓦片没有可点标注 | ⬜ OSM 矢量底图无交互 POI 标注 | ✅ `amapHotspots.ts` |

**已完成（本轮）**：
- 风险图层的高德侧：`amapHazards.ts` —— 一份独立的实现，不照搬 Leaflet 的 `<GeoJSON>`
  也不照搬 GL 的 source/layer。它把 `Point`/`Polygon`/`MultiPolygon` 分派到
  `AMap.Circle`/`Polygon`，顶点在**进入时**逐个过 GCJ 转换，弹窗用三家共用的
  `hazardPopup`（它返回 DOM 元素，三个引擎都收）。
- 夜间停靠标记：三个渲染器现在共用同一段标记 HTML（`nightPauseMarker`）——
  Leaflet 包进 `divIcon`、GL 设 `innerHTML`、高德作 `content`。
  `MapViewAMap` 之前只把它当普通圆点画，现在有 `nightPause` 就用月亮标记，
  并按共享的 `NIGHT_PAUSE_MIN_ZOOM` 门限隐藏。

- 途径点手柄的高德侧：`amapVias.ts` —— 拖拽用高德原生 `draggable` + `dragend`，
  比 GL 那套手写手势判定短得多（上游在 GL 上要处理 pointercancel、`MOVED_ENOUGH`
  阈值、五个 `preventDefault`）。**这里唯一的风险是坐标基准**：高德回报 GCJ-02，
  TT 存 WGS-84，所以出（dragend → onMoveVia）转 `gcj02ToWgs84`、
  入（via → marker position）转 `wgs84ToGcj02`。
  测试**不 mock 转换函数**，并断言回写值「接近 WGS-84 且不接近 GCJ-02」——
  转换写反、漏掉、或做了两次都会失败。

**优先级判断**：高德的对齐收益 > GL。理由是高德是中国用户的默认选择，
而 GL 手柄只是少数用户地图上的一个便利功能。因此顺序是
**高德风险图层 → 高德夜间停靠 → 高德途径点手柄 → 最后才是 GL 手柄**。

途径点手柄放最后，因为它是三者中唯一有**数据正确性风险**的（拖拽结果要回写服务端，
必须先转回 WGS-84），值得单独一轮认真做。
