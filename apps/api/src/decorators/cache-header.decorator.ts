// Utilities
import { toSeconds } from "@usex/utils";
import { applyDecorators, Header } from "@nestjs/common";
// Types
import type { DurationInput } from "@usex/utils";

export function CacheHeader(age: DurationInput, isPublic = true) {
  return applyDecorators(
    Header(
      "Cache-Control",
      `${isPublic ? "public" : "private"}, max-age=${toSeconds(age)}, s-maxage=${toSeconds(age)}`,
    ),
  );
}
