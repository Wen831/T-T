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

## The rest of the wired-or-not picture

Two audits swept every file this port added, checking each for a non-test
reference. 367 source files came over; 24 had none, and the honest split is:

**Wired after the audit found them** — these had a clear home and were mounted:

| File | Where |
|---|---|
| `MDawarichConnectionSection` | `MSettingsIntegrations` — the phone twin of the card the desktop screen already had |
| `placeSource` | `PlaceFormModal` — the AMap result badge was the literal `高德`, so a reader of any other language saw Chinese; it now resolves per locale |
| `dockTabs` | `MTripShell` — its five-seat cap is what keeps the pill's targets apart |
| `ReleaseNoticeVisuals` | `ReleaseNoticeModal` — the card's picture, falling back to the icon |

**Predate this port** — 20 of the 24 were added by r1/r2 (`a64ac62b`) and are
unmounted for reasons already recorded there: `DawarichTrailPill`,
`HazardLayers`, `useRoadtripHazards`, `ServiceStopSection`, `NightPause*`,
`RoadtripViaMarkers`, `stageMap`, `serviceMarker`. They are the road trip's
optional layers, and wiring them is a product decision about which of those
surfaces a trip should show by default — not a defect in the port.

**Documented as deliberately unwired** — the two remaining have a TT equivalent
that has not drifted, so adopting them would be a refactor with no defect behind
it. Each carries the reason in its own header:

- `shared/MarkdownText.tsx` — TT already renders Markdown through `JournalBody`
  and `markdownLinkComponents`, and clamps row previews with `stripMarkdown`.
- `Journey/journeyMapPopup.ts` — TT builds journey popups in both map components
  and they have not diverged, which is the drift upstream extracted it to stop.

A file with no caller is how ~90 roadtrip components came to pass their own
tests while nothing rendered them. The difference here is that each of the
remaining ones says why, in the file, where the next reader will meet it.
