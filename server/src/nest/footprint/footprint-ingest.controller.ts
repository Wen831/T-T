import { Body, Controller, HttpCode, HttpException, Post, UseGuards } from '@nestjs/common';

import type { User } from '../../types';
import { AddonGuard } from '../addons/addon.guard';
import { RequireAddon } from '../addons/require-addon.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { ADDON_IDS } from '../../addons';
import { FootprintIngestGuard } from './footprint-ingest.guard';
import { FootprintService } from './footprint.service';
import { FootprintIngestDto } from './footprint.dto';
import { MAX_INGEST_ENTRIES, normalizeIngestEntry } from './footprint-ingest';
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
}
