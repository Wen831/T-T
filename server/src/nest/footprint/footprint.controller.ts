import { Controller, Get, HttpException, Post, Query, UseGuards } from '@nestjs/common';

import type { User } from '../../types';
import { AddonGuard } from '../addons/addon.guard';
import { RequireAddon } from '../addons/require-addon.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ADDON_IDS } from '../../addons';
import { FootprintService } from './footprint.service';
import type { Stay } from './detection/types';

/**
 * The session-authenticated surface of the footprint addon — token management
 * and the same data the Dawarich integration serves, read from this user's own
 * archive. The ingest endpoint (api/v1/points) is the machine-facing twin.
 *
 * `GET /track` and `GET /stays` exist so the recording stands alone, without
 * the Dawarich addon also being enabled: the trail the existing Dawarich
 * layers draw is served through the existing integration endpoints (which
 * consult this archive first for local recorders), while these two answer
 * "what do I actually have" questions about the archive itself.
 */
@Controller('api/footprint')
@UseGuards(AddonGuard, JwtAuthGuard)
@RequireAddon(ADDON_IDS.FOOTPRINT, 'Footprint')
export class FootprintController {
  constructor(private readonly footprint: FootprintService) {}

  /** Whether an ingest token exists (never its secret), and how much is archived. */
  @Get('status')
  status(@CurrentUser() user: User) {
    return {
      token: this.footprint.ingestTokenStatus(user.id),
      pointCount: this.footprint.countPoints(user.id),
      latestPointAt: this.footprint.latestPointAt(user.id),
      policy: this.policyView(),
    };
  }

  /**
   * Mint — or rotate — the user's ingest token. The raw token is returned here
   * and only here; the database keeps its hash, so losing this response means
   * rotating.
   */
  @Post('ingest-token')
  mintToken(@CurrentUser() user: User) {
    const ingestToken = this.footprint.mintIngestToken(user.id);
    return { ingestToken, ...this.footprint.ingestTokenStatus(user.id) };
  }

  /** The recorded trail for a window, in the DawarichTrack contract (WGS-84). */
  @Get('track')
  track(@CurrentUser() user: User, @Query('from') from?: string, @Query('to') to?: string, @Query('offset') offset?: string) {
    const { fromTs, toTs } = windowBounds(from, to);
    const track = this.footprint.localTrack(
      user.id,
      new Date(fromTs * 1000).toISOString(),
      new Date(toTs * 1000).toISOString(),
      parseOffsetMinutes(offset),
    );
    if (!track) {
      throw new HttpException({ error: 'Footprint recording is not configured — mint an ingest token first' }, 404);
    }
    return track;
  }

  /** Detected stays for a window, each scored by the ported ConfidenceScorer. */
  @Get('stays')
  stays(@CurrentUser() user: User, @Query('from') from?: string, @Query('to') to?: string) {
    const { fromTs, toTs } = windowBounds(from, to);
    if (!this.footprint.hasIngestToken(user.id)) {
      throw new HttpException({ error: 'Footprint recording is not configured — mint an ingest token first' }, 404);
    }
    const { stays, skipped } = this.footprint.staysForWindow(user.id, fromTs, toTs);
    return {
      window: { from: new Date(fromTs * 1000).toISOString(), to: new Date(toTs * 1000).toISOString() },
      skipped,
      stays: stays.map(serializeStay),
    };
  }

  private policyView() {
    const policy = this.footprint.policyFor();
    return {
      stayRadiusM: policy.stayRadiusM,
      minDwellS: policy.minDwellS,
      minPoints: policy.minPoints,
      mergeGapS: policy.mergeGapS,
      sweepGapS: policy.sweepGapS,
      bridgeCapS: policy.bridgeCapS,
    };
  }
}

/** A stay shaped for the API — ISO bounds and the names the UI would use. */
function serializeStay(stay: Stay) {
  return {
    startedAt: new Date(stay.startTs * 1000).toISOString(),
    endedAt: new Date(stay.endTs * 1000).toISOString(),
    durationMinutes: Math.round(stay.durationS / 60),
    centerLat: stay.centerLat,
    centerLng: stay.centerLon,
    radiusMeters: stay.radius,
    pointCount: stay.count,
    bridgedSeconds: stay.bridgedS,
    confidence: stay.confidence ?? null,
    confidenceBreakdown: stay.confidenceBreakdown ?? null,
  };
}

/**
 * `from`/`to` as unix seconds — ISO 8601 or bare numbers both accepted.
 * Default window: the last seven days, which is what "what have I been up to"
 * means when the caller says nothing.
 */
function windowBounds(from?: string, to?: string): { fromTs: number; toTs: number } {
  const now = Date.now();
  const fromTs = parseBound(from, Math.floor(now / 1000) - 7 * 86_400);
  const toTs = parseBound(to, Math.floor(now / 1000));
  if (toTs <= fromTs) {
    throw new HttpException({ error: 'to must be after from' }, 400);
  }
  return { fromTs, toTs };
}

function parseBound(value: string | undefined, fallbackSeconds: number): number {
  if (value === undefined || value.trim() === '') return fallbackSeconds;
  if (/^-?\d+(\.\d+)?$/.test(value.trim())) return Math.round(Number(value.trim()));
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new HttpException({ error: 'Invalid timestamp — use ISO 8601 or unix seconds' }, 400);
  }
  return Math.round(ms / 1000);
}

function parseOffsetMinutes(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new HttpException({ error: 'Invalid offset' }, 400);
  }
  return Math.round(n);
}
