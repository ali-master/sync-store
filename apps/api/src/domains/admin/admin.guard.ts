import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ApiKeyGuard } from "../sync-storage/guards/api-key.guard";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly keys: ApiKeyGuard) {}

  /** Require a header credential and explicit administrator scope for cross-user management. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (!request.headers.authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("An administrator Bearer key is required");
    }
    return this.keys.authorize(request, "admin");
  }
}
