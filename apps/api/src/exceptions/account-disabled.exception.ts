import { UnauthorizedException } from "@nestjs/common";

export class AccountDisabledException extends UnauthorizedException {
  static readonly code = "ACCOUNT_DISABLED";

  constructor(message: string = "Account is disabled") {
    super(message);
  }
}
