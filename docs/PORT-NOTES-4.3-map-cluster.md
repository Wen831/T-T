# 4.3 Map cluster — what was mounted and what deliberately was not

Nine files came over from upstream TREK 4.3.0 into `client/src/components/Map/`.
Each was checked against TT's own renderers first, because TT keeps three
(Leaflet, MapLibre/Mapbox GL, and its own AMap) where upstream has two. The
verdicts below are decisions, not oversights — and the reason each unwired file
is unwired is recorded in the file itself, so a later reader meets it there.

## Mounted

| File | Where | Why |
|---|---|---|
| `PlaceHoverCard.tsx` | `MapView.tsx`, `MapViewGL.tsx` | **The highest-value one.** TT had two inline copies of this card, byte-identical in styling, and they had already drifted in how they resolved the category icon. One component now serves both, and it carries the rating. |
| `coincidentPlaces.ts` | helper consumed by `markerCluster.ts` | Folding rule shared by the cluster helpers. |
| `transitLeg.ts` | already consumed by `TransitSearchPanel`, `DayPlanSidebar`, `MTransportSheet` | Resolves a connector's coordinate-only endpoints back to names. |

## Deliberately not mounted

| File | Verdict |
|---|---|
| `gcj02Crs.ts` | **Architecturally mismatched.** It is a Leaflet CRS for shifting WGS-84 onto GCJ-02 **raster** basemap tiles. TT's AMap renderer is the AMap **JS API** (`MapViewAMap.tsx`), which converts at its own boundary (`engines/amap.ts`, `amapDawarichTrail.ts`). TT has no AMap raster preset in `MAP_PRESETS` and no `isGcj02Basemap`, so nothing could ever pass it a GCJ tile. Mounting it would be dead code. |
| `useMergedMapPois.ts` | **Needs provider work first.** It merges a corridor list, an explore list and a refuel-offer list by `osm_id`. TT's `usePoiExplore` returns one list and has no corridor input, so wiring it now would merge nothing. |
| `ratingBadge.ts` | Not mounted yet — see below. |
| `ClusteredPois.tsx` + `poiClusters.ts` | Add real POI clustering for Leaflet, which TT lacks. Not mounted yet — see below. |
| `markerCluster.ts`, `mapHover.ts` | Not mounted yet — see below. |

## Why the three remaining ones are not mounted

They are **not** redundant — `ratingBadge` adds a rating disc TT's markers have
never drawn, and `ClusteredPois` adds POI clustering TT has never had. They are
held back on one measured finding:

TT's `MapViewGL` test harness projects coordinates through a stub that scales
degrees by ten. Under that projector, points ~0.1° apart land within the 2 px
fold radius, so folding merges **genuinely distinct** fixture places. Wiring
`coincidentPlaces` into `MapViewGL.reconcileMarkers` was tried and reverted for
exactly this reason: the existing suite's marker cases began folding pairs that
are kilometres apart.

That is a harness limitation, not a rule against the feature. Folding and badge
rendering both need either a projector that behaves like a real map, or a
position derived from coordinates rather than `map.project`, before they can be
wired and *verified*. Shipping them unverified would trade a cosmetic problem
(two pins overlapping) for a worse one (a pin that silently disappears, taking
its hover card, click target and drag handle with it).

`coincidentPlaces.ts` carries this reasoning in its header. When the harness can
project honestly, delete that note and wire the three.
