/**
 * Server-side createZodDto wrapper over the footprint ingest contract, so the
 * global ZodValidationPipe (APP_PIPE) validates the POST body by metatype —
 * the boot gate in `validate-body-contracts.ts` refuses any mutation route
 * whose @Body() is not one of these.
 */
import { createZodDto } from 'nestjs-zod';

import { footprintIngestBodySchema } from './footprint-ingest';

export class FootprintIngestDto extends createZodDto(footprintIngestBodySchema) {}
