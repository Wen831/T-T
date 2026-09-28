import { Body, Controller, HttpCode, HttpException, Post, UseGuards } from '@nestjs/common';

import type { User } from '../../types';
import { AddonGuard } from '../addons/addon.guard';
import { RequireAddon } from '../addons/require-addon.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { ADDON_IDS } from '../../addons';
import { FootprintIngestGuard } from './footprint-ingest.guard';
import { FootprintService } from './footprint.service';
import { FootprintCompatDto, FootprintIngestDto } from './footprint.dto';
import {
  MAX_INGEST_ENTRIES,
  normalizeDawarichRecord,
  normalizeIngestEntry,
} from './footprint-ingest';
import type { IngestPoint } from './footprint-ingest';

/**
 * `POST /api/v1/points/ingest` — where a phone tracker deposits its fixes.
 *
 * Lives on the versioned surface deliberately: this is a machine contract, the
 * kind third-party apps build against and nobody renegotiates. OwnTracks HTTP
 * JSON is the wire format (single record, JSON array, batch envelope — see
 * footprint-ingest.ts), authenticated by the per-user ingest token, and the
 * response says what was received and what actually landed, because a tracker
 * retrying a batch deserves to know the duplicates were ignored, not stored
 * twice.
 */
@Controller('api/v1/points')
@UseGuards(AddonGuard, FootprintIngestGuard)
@RequireAddon(ADDON_IDS.FOOTPRINT, 'Footprint')
export class FootprintIngestController {
  constructor(private readonly footprint: FootprintService) {}

  @Post('ingest')
  @HttpCode(200)
  ingest(
    @CurrentUser() user: User,
    @Body() body: FootprintIngestDto,
  ): { status: 'ok'; received: number; inserted: number } {
    const records = body.records;
    if (records.length > MAX_INGEST_ENTRIES) {
      throw new HttpException({ error: `Too many points in one request (max ${MAX_INGEST_ENTRIES})` }, 400);
    }

    const fixes: IngestPoint[] = [];
    for (const record of records) {
      const fix = normalizeIngestEntry(record);
      if (fix) fixes.push(fix);
    }

    const { received, inserted } = this.footprint.ingest(user.id, fixes);
    return { status: 'ok', received, inserted };
  }

  /**
   * The Dawarich-app wire, on the Dawarich-app path — so the official mobile
   * apps can point at TT as if it were their own server: same path
   * (`POST /api/v1/points`), same `api_key` authentication (verified against
   * the ingest token's hash, like every other transport), same
   * `{locations: [...]}` GeoJSON body with Overland-style properties, same
   * `{ data: [...] }` answer. `count` is TT's addition — the honest number of
   * NEW rows, since duplicates are a no-op here just as they are upstream.
   *
   * The OwnTracks route above remains the format TT speaks natively; this one
   * exists so nobody has to care which app they picked.
   */
  @Post()
  @HttpCode(200)
  compatIngest(@CurrentUser() user: User, @Body() body: FootprintCompatDto): { data: unknown[]; count: number } {
    const records = body.records;
    if (records.length > MAX_INGEST_ENTRIES) {
      throw new HttpException({ error: `Too many points in one request (max ${MAX_INGEST_ENTRIES})` }, 400);
    }

    const fixes: IngestPoint[] = [];
    for (const record of records) {
      const fix = normalizeDawarichRecord(record);
      if (fix) fixes.push(fix);
    }

    const { inserted } = this.footprint.ingest(user.id, fixes);
    return { data: [], count: inserted };
  }
}
