# Road Trip Mode

Road trip mode reads a trip as a *drive* rather than as a list of days: the whole trip routed end to end, each day as a chain of legs and stops, with driving times that update themselves and the tools to shape the road and plan what you need along it.

![Road trip mode](assets/Roadtrip-Mode-zh.png)

> **Addon.** Road trip mode is an addon. Enable **Road trip** under [Admin: Addons](Admin-Addons) before it appears.

## Turning it on

Open a trip → **Plan** tab → the switcher at the top of the left rail, between **Days** and **Road trip**.

The switch is per trip and remembered for the session, so a trip you are driving stays in drive mode across reloads, and a trip you are not does not inherit it.

## The drive rail

With the mode on, the left rail shows the drive instead of the day cards:

- **Totals** for the whole trip — distance, driving time, stop count.
- **Each day** as a card: its distance and driving time, then a chain of legs and stops.
- **Clocks** on each stop — departure and arrival, recomputed as you change the plan.
- **Overrun flags** when a day exceeds the limits you set.

On a phone the same content is the road trip tab, with a list ⇄ map switch.

## Along-the-route search

Ask what is on the way rather than what is nearby.

![Along the route](assets/Roadtrip-Corridor-zh.png)

**Where:** road trip mode → the **Along the route** panel on the right.

- **Categories** — fuel, charging, service area, campsite, lodging, food, sights. Choose several; they ride one query, so a second category costs no extra requests.
- **How far** — a range chip row narrows the search to the stretch just ahead (2 km / 5 km / 10 km by default), or choose **All day** for the whole stage. Without a chip the search covers the 50 km ahead of the driver.
- **Search** returns hits in driving order. Each row shows how far along the drive it sits (**km along**) and how far off the road it is (**off route**), with **+** to add it to the trip and a tap to bring it into view on the map.

The search follows the map engine you chose. With AMap search enabled it asks AMap, so it returns results in places where the OpenStreetMap-based search is thin.

A search that could not cover everything says so rather than quietly answering short: it reports stretches that were cut short, boxes that did not answer, and an answer the server capped.

## Importing a route from a link

Bring a route someone planned elsewhere into the trip.

**Where:** road trip mode → **⋯** at the top-right of the **Along the route** panel.

- **Google Maps route** — paste a Google Maps directions link.
- **AMap (高德) route** — paste a link from `ditu.amap.com/dir` or `uri.amap.com/route`.

Both preview the stops in driving order; pick the day to append them to and confirm. Unresolved stops are named and marked so you can see which will be skipped.

AMap links carry GCJ-02 coordinates and TT stores WGS-84, so the positions are converted on import.

## Reshaping the drive

Click the drawn route and a blue handle appears there; the drive routes through wherever you put it.

- **Tap** a handle to select it.
- **Drag** it to move it and re-route.
- **Delete** it by dragging the selected handle onto the red **Drag here to delete** zone at the top-left of the map. On desktop, a right-click on the handle also removes it.

Handles are only drawn at zoom 9 or closer — below that a single handle would move the route by kilometres per pixel, so the drive is read rather than shaped.

This works on all three map engines (Leaflet, MapLibre/Mapbox GL and AMap).

> A handle can disappear on its own if the day's stops change shape under it (a place added, a leg replaced, a track followed) — the write that does that removes the point, and TT simply reloads rather than reporting an error.

## Driving settings

**Where:** road trip mode → the **Driving settings** card at the bottom of the **Along the route** panel.

### Daily travel times

- **Start** and **end** time for the day.
- **End the day along the route** — pause on the road at the end time.
- **End the day at the last place** — stop before the next place would exceed it.
- **Restore automatic day endings** clears manual day boundaries.

A day that runs past its end time gets a **night pause** marker: which night it is, and whether the car stands at a place or beside the road.

### Driving time

Cap the minutes **per leg** and **per day**. Days that overrun are flagged in the rail.

### Avoid

Ask the router to avoid **tolls**, **motorways** and **ferries**, where the routing profile supports it.

### Vehicle and range

Set **combustion** or **electric**, then tank or battery size, consumption, current fill and a safety margin. The drive rail then marks the point where you would run dry and offers a **Search** for a station or charger around it.

### Current warnings

**Show hazard areas** draws current weather and disaster notices along the drive. These are current notices, not forecasts for your travel dates, and they never change the route.

### Service stops

Stops that are part of the drive rather than destinations — fuel, charging, rest areas — can be given a stop kind so they are left out of the day's stop count. A day with a charger between four places still reads as four stops.

**Where:** road trip mode → a stop's sheet → the stop-kind picker.

## On a phone

The road trip tab has the same content with a **list ⇄ map** switch. The map half draws every routed day as its own line, each in the colour of its card, and the along-the-route panel opens as a sheet from the search bar.

See also: [Map Features](Map-Features), [Map Settings](Map-Settings), [AMap (高德)](AMap).
