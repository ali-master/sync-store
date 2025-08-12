import { ApiTags } from "@nestjs/swagger";
import { applyDecorators, SetMetadata } from "@nestjs/common";
// Constants
import { PUBLIC_ROUTE_KEY } from "@root/constants";

export const Public = (tag?: string) => {
  const decorators: Array<MethodDecorator & ClassDecorator> = [SetMetadata(PUBLIC_ROUTE_KEY, true)];
  if (tag) {
    decorators.push(ApiTags(tag));
  }

  return applyDecorators(...decorators);
};
