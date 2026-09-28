import { Module } from '@nestjs/common';

import { AddonsModule } from '../addons/addons.module';
import { FootprintController } from './footprint.controller';
import { FootprintIngestController } from './footprint-ingest.controller';
import { FootprintIngestGuard } from './footprint-ingest.guard';
import { FootprintService } from './footprint.service';

/**
 * The footprint addon: TT records its users' location history itself instead
 * of reading it from a separate Dawarich instance.
 *
 * Three pieces: the ingest endpoint (`POST /api/v1/points/ingest`, token
 * auth, OwnTracks JSON), the archive + detection (`FootprintService` — the
 * ported Dawarich pipeline lives in ./detection), and the session surface
 * (`/api/footprint` — token management and direct reads). The DawarichModule
 * imports this one so its track endpoints can serve a local recorder's
 * archive through the existing contract; the import is the whole integration.
 */
@Module({
  imports: [AddonsModule],
  controllers: [FootprintIngestController, FootprintController],
  providers: [FootprintService, FootprintIngestGuard],
  exports: [FootprintService],
})
export class FootprintModule {}
