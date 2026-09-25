import { AuthModule } from '../auth/auth.module';
import { RateLimitModule } from '../common/rate-limit.module';
import { DaysModule } from '../days/days.module';
import { McpSharedModule } from '../mcp-shared/mcp-shared.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { GoogleTransitProvider } from './google-transit.provider';
import { TransitController } from './transit.controller';
import { TransitMcp } from './transit.mcp';
import { TransitService } from './transit.service';
import { Module } from '@nestjs/common';

/**
 * Transit domain (#1065) — the Transitous/MOTIS proxy. TransitMcp carries the
 * decorator-registered MCP tools; DaysModule/ReservationsModule feed
 * create_transit_journey. Exports TransitService for in-container consumers.
 */
@Module({
  // DaysModule + ReservationsModule: TransitMcp's create_transit_journey injects both.
  imports: [McpSharedModule, RateLimitModule, DaysModule, ReservationsModule, AuthModule],
  controllers: [TransitController],
  // GoogleTransitProvider is injected by TransitService; it resolves its own key.
  providers: [TransitService, TransitMcp, GoogleTransitProvider],
  exports: [TransitService],
})
export class TransitModule {}
