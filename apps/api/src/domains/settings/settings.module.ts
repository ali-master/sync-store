import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../modules/db";
import { SettingsService } from "./settings.service";

/** Global, so overrides are loaded before any module reads them at boot. */
@Global()
@Module({ imports: [DatabaseModule], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
