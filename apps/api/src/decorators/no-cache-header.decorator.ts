// Utilities
import { Header } from "@nestjs/common";
import { applyDecorators } from "@nestjs/common";

export function NoCache() {
  return applyDecorators(
    Header("Surrogate-Control", "no-store"),
    Header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate"),
    Header("Pragma", "no-cache"),
    Header("Expires", "0"),
  );
}
