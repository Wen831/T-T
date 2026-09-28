# Footprint — recording your own location history

**Footprint** is TT's own location archive. A phone tracker reports your position straight into TT, TT stores the points and works out where you stopped, and the result is drawn on your trips and offered as journal entries, places and countries — exactly the same surfaces the [Dawarich](Dawarich) integration feeds, without running a second server.

It is the builtin half of the Dawarich connection: the same card, a different data source.

> **Addons.** Enable **Footprint** *and* **Dawarich** under [Admin: Addons](Admin-Addons). Footprint owns the archive and the ingest endpoint; Dawarich owns the surfaces that read it (the trail overlay, the suggestions panel, the Atlas offers).

## Two data sources, one card

**Settings → Integrations → Dawarich** opens with a **Data source** choice:

| Source | What it means |
|---|---|
| **External Dawarich instance** | TT reads visits and routes from a Dawarich server you run (see [Dawarich](Dawarich)) |
| **TT built-in engine** | A phone reports into TT itself; no external server involved |

Only the fields that apply to the chosen source are shown. Switching to the built-in engine hides the instance form and keeps its values, so switching back never asks for them again.

## Setting up the built-in engine

1. Enable the **Footprint** and **Dawarich** addons.
2. **Settings → Integrations → Dawarich** → choose **TT built-in engine** → **Save**.
3. Press **Generate ingest token**. The token is shown **once** — copy it then; only its hash is stored, so a lost token means generating a new one (the old one stops working immediately).
4. Point your tracker app at the ingest address shown on the card:

   ```
   https://<your-tt-address>/api/v1/points/ingest
   ```

   with the token as the credential. Three transports are accepted, whichever your app supports:

   | Transport | Value |
   |---|---|
   | Header | `Authorization: Bearer <token>` |
   | Header | `X-Ingest-Token: <token>` |
   | URL parameter | `?token=<token>` |
   | URL parameter | `?api_key=<token>` — the spelling the official Dawarich apps use |

5. Open a trip's map and switch the trail on from the pill at the bottom-right.

The card also shows how much is archived (points recorded, latest fix) so you can tell at a glance whether the phone is reporting.

## Which phone apps work

Anything that can POST a JSON position to an address of your choosing will work. These are known-good:

| App | Platform | Notes |
|---|---|---|
| **Dawarich** (official) | iOS, Android | Point it at the address above with `?api_key=<token>`. Uses the `POST /api/v1/points` route, which TT serves in the same shape the app already posts to a real Dawarich server |
| **OwnTracks** | iOS, Android | The format TT speaks natively. HTTP mode → URL with `?token=<token>`. Free and open source |
| **Overland** | iOS | Native custom endpoint; its payload is the same one the official apps send |
| **GPSLogger** | Android | The most flexible: custom URL, custom `Authorization: Bearer <token>` header, custom interval. A common pairing |
| **Home Assistant companion** | iOS, Android | Automate a `device_tracker` position into an HTTP POST |
| **iOS Shortcuts / Tasker / MacroDroid** | iOS, Android | Anything that can send a timed HTTP POST; build the JSON yourself |

### Example payloads

The email-and-password route (`/api/v1/points/ingest`) takes OwnTracks JSON — one record, an array, a `{"_type":"batch","data":[…]}` envelope, or `{"points":[…]}`:

```json
{"_type":"location","lat":31.2304,"lon":121.4737,"tst":1758900000,"acc":12,"batt":80}
```

The Dawarich-app route (`/api/v1/points`) takes the Overland-style GeoJSON the official apps post:

```json
{
  "locations": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [121.4737, 31.2304] },
      "properties": {
        "timestamp": "2026-09-26T10:00:00.000Z",
        "horizontal_accuracy": 12,
        "battery_level": 0.8,
        "speed": 1.4,
        "altitude": 43
      }
    }
  ]
}
```

Notes that save an afternoon of debugging:

- **`tst` is unix seconds**, not milliseconds, on the OwnTracks route. The Dawarich-app route takes either a unix-seconds value or an ISO-8601 string.
- Coordinates are **`[longitude, latitude]`** in the GeoJSON form — the opposite order to how they are usually spoken.
- **`battery_level` is a 0–1 fraction** in the GeoJSON form (Overland's convention); a value above 1 is read as a percentage.
- A `(0, 0)` fix is discarded at the door, so a tracker that has not got a lock yet does not plant a point off the coast of Africa.
- Re-sending a fix is **safe and free**: points are deduplicated on (user, timestamp, latitude, longitude), so a tracker that retries a batch after a dropped connection does not create duplicates.

## What TT does with the recording

Once points arrive, TT runs stay detection over them — the same algorithm Dawarich runs, ported stage for stage (dwell sweeping, gap bridging, chain merging, then a minimum-dwell / minimum-points filter and a confidence score). Out of that comes:

- **The trail on the map** — per-day lines, drawn on the trip map and in the [Journey Journal](Journey-Journal). Toggled from the pill at the map's bottom-right, which also carries the status.
- **Stay suggestions** — "you were here for 25 minutes", offered as journal entries, places or countries in the suggestions panel, exactly as with an external instance. **Nothing is added until you confirm it.**
- **Wishlist matching** — the bucket-list scan can tell you whether a recorded stay actually reached a place you wanted to visit.
- **Atlas offers** — countries the recordings put you in, offered (never applied) to the [Atlas](Atlas).

Nothing here is written back to any external service — the archive lives in TT's own database, and the whole thing is a reader of it.

## Privacy and practicalities

- Points are stored in TT's own database, WGS-84, with your user id — the same database as the rest of your trips.
- The ingest token is **per user** and stored only as a hash; the settings card can show its prefix, never the token itself.
- The archive belongs to the Footprint addon: turning the addon off stops the endpoints and the local reads (the points stay in the database).
- Reported points and detected stays are **recomputed on request** — there is no background job writing derived rows, so changing the detection thresholds changes the answer immediately.

## Related

- [Dawarich](Dawarich) — the external instance this is the alternative to, and the surfaces both feed.
- [Journey Journal](Journey-Journal) — what accepted stays become.
- [Atlas](Atlas) — the countries and cities side.
