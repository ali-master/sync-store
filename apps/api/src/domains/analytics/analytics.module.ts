import { Module } from "@nestjs/common";
import { DatabaseModule } from "@root/modules/db";
import { SyncStorageModule } from "@root/domains/sync-storage/sync-storage.module";
import { ApiKeyAnalyticsService } from "./services/api-key-analytics.service";
import { UserAnalyticsService } from "./services/user-analytics.service";
import { InstanceAnalyticsService } from "./services/instance-analytics.service";
import { AnalyticsAggregationService } from "./services/analytics-aggregation.service";
import { AnalyticsController } from "./controllers/analytics.controller";

@Module({
  imports: [DatabaseModule, SyncStorageModule],
  providers: [
    ApiKeyAnalyticsService,
    UserAnalyticsService,
    InstanceAnalyticsService,
    AnalyticsAggregationService,
  ],
  controllers: [AnalyticsController],
  exports: [
    ApiKeyAnalyticsService,
    UserAnalyticsService,
    InstanceAnalyticsService,
    AnalyticsAggregationService,
  ],
})
export class AnalyticsModule {}
