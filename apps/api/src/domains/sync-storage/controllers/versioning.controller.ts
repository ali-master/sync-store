import { Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ApiKeyAuth } from "../decorators/api-key-auth.decorator";
import { getUserId } from "@root/modules/context/context.storage";
import { VersioningService } from "../services/versioning.service";

@ApiTags("Versioning")
@Controller("versioning")
@ApiKeyAuth()
export class VersioningController {
  constructor(private readonly versions: VersioningService) {}
  @Get("branches") branches() {
    return this.versions.branches(getUserId());
  }
  @Post("branches") fork(@Body() body: unknown) {
    return this.versions.fork(getUserId(), body);
  }
  @Get("commits") commits(@Query("before") before?: string) {
    return this.versions.commits(getUserId(), before);
  }
  @Get("commits/:id") commit(@Param("id") id: string) {
    return this.versions.commit(getUserId(), id);
  }
  @Post("commits") checkpoint(
    @Body() body: unknown,
    @Headers("idempotency-key") requestId?: string,
  ) {
    return this.versions.checkpoint(getUserId(), body, requestId);
  }
  @Post("commits/:id/restore") restore(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") requestId?: string,
  ) {
    return this.versions.restore(getUserId(), id, body, requestId);
  }
  @Get("timeline") timeline() {
    return this.versions.timeline(getUserId());
  }
}
