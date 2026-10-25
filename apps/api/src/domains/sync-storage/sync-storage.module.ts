import { VersioningService } from "./services/versioning.service";
import { VersioningController } from "./controllers/versioning.controller";
import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";
import { SyncStorageController } from "./controllers/sync-storage.controller";
import { ConflictResolutionController } from "./controllers/conflict-resolution.controller";
import { SyncStorageGateway } from "./gateways/sync-storage.gateway";
import { SyncStorageService } from "./services/sync-storage.service";
import { ConflictResolutionService } from "./services/conflict-resolution.service";
import { CommandHandlers } from "./commands/handlers";
import { QueryHandlers } from "./queries/handlers";
import { OutboxService } from "./services/outbox.service";
import { SyncStorageRepository } from "./repositories/sync-storage.repository";
import { ApiKeyGuard } from "./guards/api-key.guard";
import { ApiKeyQuotaService } from "./services/api-key-quota.service";
import { ApiKeyMetricsInterceptor } from "./interceptors/api-key-metrics.interceptor";

@Module({
  imports: [CqrsModule],
  controllers: [SyncStorageController, ConflictResolutionController, VersioningController],
  providers: [
    VersioningService,
    SyncStorageGateway,
    SyncStorageService,
    ConflictResolutionService,
    SyncStorageRepository,
    ApiKeyGuard,
    ApiKeyQuotaService,
    ApiKeyMetricsInterceptor,
    ...CommandHandlers,
    ...QueryHandlers,
    OutboxService,
  ],
  exports: [
    VersioningService,
    SyncStorageRepository,
    SyncStorageService,
    ApiKeyQuotaService,
    ApiKeyMetricsInterceptor,
    ApiKeyGuard,
    SyncStorageGateway,
    ConflictResolutionService,
  ],
})
export class SyncStorageModule {}
