// Decorators
import { UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
// Utilities
import { applyDecorators } from "@nestjs/common";

export function Private(tag?: string) {
  const decorators = [ApiBearerAuth(), UseGuards()];
  if (tag) {
    decorators.push(ApiTags(tag));
  }
  return applyDecorators(...decorators);
}
