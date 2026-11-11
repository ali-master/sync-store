import { Module } from "@nestjs/common";
import { SyncStorageModule } from "../sync-storage/sync-storage.module";
import { AdminController } from "./admin.controller";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";
import { SetupController } from "./setup.controller";
import { SetupService } from "./setup.service";
import { SsoController } from "./sso.controller";
import { SsoService } from "./sso.service";

@Module({
  imports: [SyncStorageModule],
  controllers: [AdminController, SetupController, SsoController],
  providers: [AdminService, AdminGuard, SetupService, SsoService],
})
export class AdminModule {}
