import {
  Body,
  BadRequestException,
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
import { VersioningService } from "../sync-storage/services/versioning.service";
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
    private readonly versions: VersioningService,
    private readonly operations: OperationsService,
  ) {}

  @Get("reports/health")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Read sampled publication health and previous-period time series" })
  async health(@Query() query: Record<string, string>, @Req() req: any) {
    return this.operations.health(query, await this.admin.tenant(req.apiKey.id));
  }

  @Get("reports/usage")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Read project/key traffic trends and live UTC quota forecasts" })
  async usage(@Query() query: Record<string, string>, @Req() req: any) {
    return this.operations.usage(query, await this.admin.tenant(req.apiKey.id));
  }

  @Get("reports/changes")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Read durable change counts and sampled logical data growth" })
  async changes(@Query() query: Record<string, string>, @Req() req: any) {
    return this.operations.changes(query, await this.admin.tenant(req.apiKey.id));
  }

  @Get("reports/saved")
  @Header("Cache-Control", "no-store")
  async savedReports(@Req() req: any) {
    return this.operations.savedReports(await this.admin.tenant(req.apiKey.id));
  }

  @Post("reports/saved")
  async saveReport(@Body() body: unknown, @Req() req: any) {
    return this.operations.saveReport(body, req.apiKey.id, await this.admin.tenant(req.apiKey.id));
  }

  @Delete("reports/saved/:id")
  async deleteReport(@Param("id") id: string, @Req() req: any) {
    return this.operations.deleteReport(id, await this.admin.tenant(req.apiKey.id));
  }

  @Post("history/preview")
  @ApiOperation({ summary: "Preview a retained version and current value" })
  previewHistory(@Body() body: unknown, @Req() req: any) {
    return this.admin.previewHistory(body, req.apiKey.id);
  }

  @Post("history/restore")
  @ApiOperation({
    summary: "Restore the previewed revision without overwriting a concurrent change",
  })
  restoreHistory(@Body() body: unknown, @Req() req: any) {
    return this.admin.restoreHistory(body, req.apiKey.id);
  }

  @Get("versioning")
  async versioning(@Query() query: Record<string, string>, @Req() req: any) {
    const user = await this.admin.versionUser(query, req.apiKey.id);
    const [branches, commits, timeline] = await Promise.all([
      this.versions.branches(user),
      this.versions.commits(user, query.before),
      this.versions.timeline(user),
    ]);
    return { branches, commits, timeline };
  }
  @Post("versioning/:action")
  async versionAction(@Param("action") action: string, @Body() body: any, @Req() req: any) {
    const user = await this.admin.versionUser(body, req.apiKey.id);
    let result;
    if (action === "fork") result = await this.versions.fork(user, body);
    else if (action === "commit")
      result = await this.versions.checkpoint(user, body, body.requestId);
    else if (action === "restore")
      result = await this.versions.restore(user, body.commitId, body, body.requestId);
    else throw new BadRequestException("Unknown versioning action");
    await this.admin.audit(req.apiKey.id, "admin.versioning." + action, user);
    return result;
  }
  @Patch("tenants/:id")
  updateTenant(@Param("id") id: string, @Body() body: unknown, @Req() req: any) {
    return this.admin.updateTenant(id, body, req.apiKey.id);
  }

  @Post("tenants")
  createTenant(@Body() body: unknown, @Req() req: any) {
    return this.admin.createTenant(body, req.apiKey.id);
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
  overview(@Req() req: any) {
    return this.admin.overview(req.apiKey.id);
  }

  @Get("resources/:resource")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Read paginated records; key secrets are excluded" })
  list(
    @Param("resource") resource: string,
    @Query() query: Record<string, string>,
    @Req() req: any,
  ) {
    return this.admin.list(resource, query, req.apiKey.id);
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
