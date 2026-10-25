import { Module } from "@nestjs/common";
import { SyncStorageModule } from "../sync-storage/sync-storage.module";
import { AdminController } from "./admin.controller";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";
import { SetupController } from "./setup.controller";
import { SetupService } from "./setup.service";

@Module({
  imports: [SyncStorageModule],
  controllers: [AdminController, SetupController],
  providers: [AdminService, AdminGuard, SetupService],
})
export class AdminModule {}
