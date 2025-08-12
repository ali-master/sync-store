import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";
import { SyncStorageController } from "./controllers/sync-storage.controller";
import { ConflictResolutionController } from "./controllers/conflict-resolution.controller";
import { SyncStorageGateway } from "./gateways/sync-storage.gateway";
import { SyncStorageService } from "./services/sync-storage.service";
import { ConflictResolutionService } from "./services/conflict-resolution.service";
import { CommandHandlers } from "./commands/handlers";
import { QueryHandlers } from "./queries/handlers";
import { EventHandlers } from "./events/handlers";
import { SyncStorageRepository } from "./repositories/sync-storage.repository";
import { UserSessionService } from "./services/user-session.service";
import { SyncQueueService } from "./services/sync-queue.service";
import { ApiKeyGuard } from "./guards/api-key.guard";
import { ApiKeyQuotaService } from "./services/api-key-quota.service";
import { ApiKeyMetricsInterceptor } from "./interceptors/api-key-metrics.interceptor";

@Module({
  imports: [CqrsModule],
  controllers: [SyncStorageController, ConflictResolutionController],
  providers: [
    SyncStorageGateway,
    SyncStorageService,
    ConflictResolutionService,
    SyncStorageRepository,
    UserSessionService,
    SyncQueueService,
    ApiKeyGuard,
    ApiKeyQuotaService,
    ApiKeyMetricsInterceptor,
    ...CommandHandlers,
    ...QueryHandlers,
    ...EventHandlers,
  ],
  exports: [SyncStorageService, ApiKeyQuotaService, ApiKeyMetricsInterceptor],
})
export class SyncStorageModule {}
