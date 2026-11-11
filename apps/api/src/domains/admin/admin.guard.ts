import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ApiKeyGuard } from "../sync-storage/guards/api-key.guard";
import { SsoService } from "./sso.service";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly keys: ApiKeyGuard,
    private readonly sso: SsoService,
  ) {}

  /** Require a header credential and explicit administrator scope for cross-user management. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const bearer: string | undefined = request.headers.authorization;
    if (!bearer?.startsWith("Bearer ")) {
      throw new UnauthorizedException("An administrator Bearer key is required");
    }
    // An SSO session acts as the installation administrator without ever revealing its key.
    if (bearer.startsWith("Bearer ss_sso.")) {
      const session = await this.sso.authenticate(bearer.slice(7));
      return this.keys.authorize(request, "admin", session.key);
    }
    return this.keys.authorize(request, "admin");
  }
}
