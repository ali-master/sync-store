import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Public } from "../../decorators/public.decorator";
import { currentSsoConfig, SsoService } from "./sso.service";

const STATE_COOKIE = "ss_sso_state";
const HANDOFF_COOKIE = "ss_sso_handoff";

/** Both cookies are HttpOnly and scoped to these routes; scripts and other paths never see them. */
function cookie(name: string, value: string, maxAge: number, sameSite: "Lax" | "Strict") {
  const secure = currentSsoConfig().redirectUri.startsWith("https:") ? "; Secure" : "";
  return `${name}=${value}; Path=/api/v1/sso; Max-Age=${maxAge}; HttpOnly; SameSite=${sameSite}${secure}`;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name + "="))
    ?.slice(name.length + 1);
}

@Public()
@ApiTags("Dashboard single sign-on")
@Controller("sso")
export class SsoController {
  private readonly logger = new Logger("SSO");

  constructor(private readonly sso: SsoService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Check whether dashboard single sign-on is configured" })
  status() {
    return this.sso.status();
  }

  @Get("login")
  @ApiOperation({ summary: "Redirect the browser to the identity provider" })
  async login(@Res() reply: FastifyReply) {
    try {
      const { url, state } = await this.sso.begin();
      // Lax: the provider's redirect back to the callback is a cross-site top-level navigation.
      return reply
        .header("set-cookie", cookie(STATE_COOKIE, state, 600, "Lax"))
        .header("cache-control", "no-store")
        .redirect(url);
    } catch (error) {
      return reply.header("cache-control", "no-store").redirect(this.failure(error));
    }
  }

  @Get("callback")
  @ApiOperation({ summary: "Complete the sign-in and return the browser to the dashboard" })
  async callback(
    @Query() query: Record<string, unknown>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    reply
      .header("set-cookie", cookie(STATE_COOKIE, "", 0, "Lax"))
      .header("cache-control", "no-store");
    try {
      const session = await this.sso.complete(
        query,
        readCookie(request.headers.cookie, STATE_COOKIE),
      );
      // The session never appears in a URL: the dashboard collects it once from this cookie.
      return reply
        .header("set-cookie", cookie(HANDOFF_COOKIE, session.token, 60, "Strict"))
        .redirect("/dashboard/#sso");
    } catch (error) {
      return reply.redirect(this.failure(error));
    }
  }

  @Post("session")
  @HttpCode(200)
  @ApiOperation({ summary: "Collect the session of a completed sign-in; works once" })
  session(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    reply
      .header("set-cookie", cookie(HANDOFF_COOKIE, "", 0, "Strict"))
      .header("cache-control", "no-store");
    return this.sso.session(readCookie(request.headers.cookie, HANDOFF_COOKIE));
  }

  /** Explain refusals to the operator; unexpected failures stay in the server log. */
  private failure(error: unknown): string {
    if (!(error instanceof HttpException)) this.logger.error(error);
    return (
      "/dashboard/#sso-error=" +
      encodeURIComponent(
        error instanceof HttpException
          ? error.message
          : "Sign-in failed. Check the API logs and try again.",
      )
    );
  }
}
