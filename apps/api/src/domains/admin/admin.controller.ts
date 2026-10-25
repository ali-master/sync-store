import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  Header,
  Delete,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminService } from "./admin.service";
import { AdminGuard } from "./admin.guard";
import { OperationsService } from "../analytics/operations.service";

@ApiTags("Administration")
@ApiBearerAuth()
@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly operations: OperationsService,
  ) {}

  @Get("reports/health")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Read sampled publication health and previous-period time series" })
  health(@Query() query: Record<string, string>) {
    return this.operations.health(query);
  }

  @Get("reports/usage")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Read project/key traffic trends and live UTC quota forecasts" })
  usage(@Query() query: Record<string, string>) {
    return this.operations.usage(query);
  }

  @Get("reports/changes")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Read durable change counts and sampled logical data growth" })
  changes(@Query() query: Record<string, string>) {
    return this.operations.changes(query);
  }

  @Get("reports/saved")
  @Header("Cache-Control", "no-store")
  savedReports() {
    return this.operations.savedReports();
  }

  @Post("reports/saved")
  saveReport(@Body() body: unknown, @Req() req: any) {
    return this.operations.saveReport(body, req.apiKey.id);
  }

  @Delete("reports/saved/:id")
  deleteReport(@Param("id") id: string) {
    return this.operations.deleteReport(id);
  }

  @Post("history/preview")
  @ApiOperation({ summary: "Preview a retained version and current value" })
  previewHistory(@Body() body: unknown) {
    return this.admin.previewHistory(body);
  }

  @Post("history/restore")
  @ApiOperation({
    summary: "Restore the previewed revision without overwriting a concurrent change",
  })
  restoreHistory(@Body() body: unknown, @Req() req: any) {
    return this.admin.restoreHistory(body, req.apiKey.id);
  }

  @Post("projects")
  @ApiOperation({ summary: "Create an isolated project namespace" })
  createProject(@Body() body: unknown, @Req() req: any) {
    return this.admin.createProject(body, req.apiKey.id);
  }

  @Get("overview")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Read live installation counts and database health (admin scope required)",
  })
  overview() {
    return this.admin.overview();
  }

  @Get("resources/:resource")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Read paginated records; key secrets are excluded" })
  list(@Param("resource") resource: string, @Query() query: Record<string, string>) {
    return this.admin.list(resource, query);
  }

  @Post("keys")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Create an application key; returns its secret once" })
  create(@Body() body: unknown, @Req() req: any) {
    return this.admin.createKey(body, req.apiKey.id);
  }

  @Patch("keys/:id")
  @ApiOperation({ summary: "Update application permissions, restrictions and quotas" })
  update(@Param("id") id: string, @Body() body: unknown, @Req() req: any) {
    return this.admin.updateKey(id, body, req.apiKey.id);
  }

  @Post("keys/:id/rotate")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Replace a key secret; existing credentials immediately stop authorizing new requests",
  })
  rotate(@Param("id") id: string, @Req() req: any) {
    return this.admin.rotateKey(id, req.apiKey.id);
  }

  @Post("storage")
  @ApiOperation({ summary: "Write a JSON value through the synchronized storage command path" })
  write(@Body() body: unknown, @Req() req: any) {
    return this.admin.write(body, req.apiKey.id);
  }

  @Post("storage/delete")
  @ApiOperation({
    summary: "Delete a selected user/key through the synchronized storage command path",
  })
  remove(@Body() body: unknown, @Req() req: any) {
    return this.admin.remove(body, req.apiKey.id);
  }

  @Post("sessions/:id/disconnect")
  @ApiOperation({
    summary: "Disconnect a Socket.IO session across replicas (clients may reconnect)",
  })
  disconnect(@Param("id") id: string, @Req() req: any) {
    return this.admin.disconnect(id, req.apiKey.id);
  }

  @Post("conflicts/:id/resolve")
  @ApiOperation({ summary: "Record a conflict resolution proposal; does not apply the value" })
  resolve(@Param("id") id: string, @Body() body: unknown, @Req() req: any) {
    return this.admin.resolve(id, body, req.apiKey.id);
  }

  @Patch("quotas/:id")
  @ApiOperation({ summary: "Update stored per-user quota settings" })
  quota(@Param("id") id: string, @Body() body: unknown, @Req() req: any) {
    return this.admin.quota(id, body, req.apiKey.id);
  }
}
