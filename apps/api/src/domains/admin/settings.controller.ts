import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SettingsService } from "../settings/settings.service";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";

@ApiTags("Administration")
@ApiBearerAuth()
@Controller("admin")
@UseGuards(AdminGuard)
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly admin: AdminService,
  ) {}

  /** Installation settings apply to every tenant, so only the platform administrator sees them. */
  private async platform(actor: string) {
    if (await this.admin.tenant(actor))
      throw new ForbiddenException("Platform administrator required");
  }

  @Get("settings")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Read installation settings and where each value comes from" })
  async read(@Req() req: any) {
    await this.platform(req.apiKey.id);
    return this.settings.view();
  }

  @Patch("settings")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Override settings in the database; null falls back to the environment",
  })
  async update(@Body() body: unknown, @Req() req: any) {
    await this.platform(req.apiKey.id);
    const result = await this.settings.update(body, req.apiKey.id);
    await this.admin.audit(req.apiKey.id, "admin.settings.update", result.changed.join(","));
    return result;
  }

}
