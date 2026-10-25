import { Body, Controller, Get, Header, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../decorators/public.decorator";
import { SetupService } from "./setup.service";

@Public()
@ApiTags("Installation setup")
@Controller("setup")
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Check whether first-time installation setup is required" })
  status() {
    return this.setup.status();
  }

  @Post()
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Create the first administrator using the setup code from server logs" })
  complete(@Body() body: unknown) {
    return this.setup.complete(body);
  }
}
