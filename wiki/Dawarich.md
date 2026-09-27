# Dawarich

Dawarich is a self-hosted location history service. Connect one to TT and TT can read back where you actually went, then offer that as journal entries, places and countries — which you confirm before anything is added.

![Dawarich connection](assets/Dawarich-Settings-zh.png)

> **Addon.** Enable **Dawarich** under [Admin: Addons](Admin-Addons) first. The connection card lives on the **Integrations** settings tab, which itself only appears when at least one integration addon is on.

> **A note for readers in mainland China.** Dawarich's own image is OpenStreetMap-based, so it is unlikely to be useful there and testing it further has little value. Dawarich is documented here because the integration exists and works for instances elsewhere; it is not the recommended way to record travel inside China.

## Connecting

**Where:** **Settings** → **Integrations** → the **Dawarich** card.

| Field | What it is |
|---|---|
| **Instance address** | The base URL of your Dawarich instance |
| **API key** | Found in Dawarich under **Account → API key**. Stored encrypted, and never shown again |
| **Check for new stays automatically** | Off means TT only reads Dawarich when you ask it to |
| **Allow self-signed certificate** | Only needed if your instance uses a certificate your server does not trust |

**Save** stores the connection; **Test connection** verifies it and reports the result, so a wrong address or key is caught before you rely on it.

## What TT does with it — and what it does not

TT is a **reader** here:

- It reads visits and recorded routes from Dawarich.
- It *suggests* journal entries, places and countries from what it read.
- Nothing is added to your trips until **you confirm it**, and TT never writes back to Dawarich.

That is deliberate: a poll that quietly ticked off countries would overwrite decisions you made by hand.

## The recorded trail on the map

A recorded route can be drawn on the trip map, in the plan view.

- **Toggle it** from the pill at the bottom-right of the map, which also carries the status — loading, nothing recorded for these dates, instance unreachable, or offline — so you can see *why* there is no line rather than guessing.
- The line is drawn under the planned route, because the plan is what you are editing.
- It is drawn, never applied: correcting the plan from the recording is a different feature.

Works on all three map engines (Leaflet, MapLibre/Mapbox GL and AMap).

## Related

- Recording your own movement inside TT, without an external service, is not part of 0.8.0. See [New Features in 0.8.0](New-Features) for what did ship.
- [Journey Journal](Journey-Journal) for what the suggestions turn into.
- [Atlas](Atlas) for the countries and cities side.
