# Stay detection — ported from Dawarich

Everything in this directory is a TypeScript port of the visit detector in
**[Freika/dawarich](https://github.com/Freika/dawarich)**, a self-hosted
location-history service. The pipeline was translated stage for stage so the
footprint addon and a real Dawarich instance answer "where was I, and for how
long" the same way — a stay detected here and the same stay detected there
should have the same bounds, which is what lets both sources feed one set of
surfaces (`DawarichTrack`, the suggestion chain, the Atlas offers).

## Where each file came from

| Here | Upstream (dawarich, `master`) |
|---|---|
| `dwell-sweep.ts` | `app/services/visits/detection/dwell_sweep.rb` |
| `gap-bridger.ts` | `app/services/visits/detection/gap_bridger.rb` |
| `stay-assembler.ts` | `app/services/visits/detection/stay_assembler.rb` |
| `detection-policy.ts` | `app/services/visits/detection/policy.rb` |
| `confidence-scorer.ts` | `app/services/visits/confidence_scorer.rb` |
| `detect-stays.ts` | `app/services/visits/detection/runner.rb` (the `detect_stays` half) |
| `types.ts` | `Visits::Detection::CandidateLoader::Pt` and the fragment/stay hashes |
| `distance-meters.ts` | every stage's `Geocoder::Calculations.distance_between` call |

The port keeps the upstream names where they are algorithm, not framework —
`DwellSweep`, `GapBridger`, `StayAssembler`, `sweep_gap_s`, `DRIFT_CAP_FACTOR` —
so reading a file beside its Ruby original stays mechanical. It is a
translation, not a call into Dawarich: no Ruby runs, nothing is shared at build
or runtime, and TT has no dependency of any kind on that repository.

## What was deliberately not ported

Two stages of the upstream pipeline have no counterpart input here, so they are
absent rather than stubbed:

- **`MovementReconciler`** cross-checks fragments against the user's track
  *segments* (a transport-mode classification Dawarich derives elsewhere);
  phone reporting via OwnTracks/Overland carries no segments to reconcile, so
  nothing here corroborates and `corroborated` stays false.
- **`PlaceAttributor` / `Persister`** are the place-matching and visit-
  persistence layers. Footprint stays are computed on demand from the raw
  points and are not written back, the same fetch-per-request shape the track
  overlay already runs on.

`Policy` also carries `SNAP_MAX_S` and `ATTRIBUTION_RADIUS_M`, which belong to
those two absent stages, so the constants read whole next to the original.

## License

Dawarich is licensed **AGPL-3.0**; TT is licensed **AGPL-3.0** as well. This
port is distributed under TT's own AGPL-3.0 terms — see the repository
`LICENSE` — which is compatible with the terms the original was released
under. The copyright in the original algorithm and its implementation remains
with Dawarich's authors; what is reproduced here is a translation of that
algorithm into another language, with attribution.

If you are looking for the upstream behaviour rather than TT's adaptation,
read the Ruby sources linked in the table above — they are the normative
description, and this directory is a derivative of them.
