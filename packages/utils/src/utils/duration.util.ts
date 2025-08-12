// Utilities
import { Duration } from "effect";
import { duration as humanizer } from "@visulima/humanizer";
// @ts-ignore
import { durationLanguage as DurationFaLanguage } from "@visulima/humanizer/language/fa";
// Types
import type { DurationInput, Duration as DurationType } from "effect/Duration";

export const toMillis = (self: DurationInput) => Duration.toMillis(self);
export const toSeconds = (self: DurationInput) => Duration.toSeconds(self);
export const toMinutes = (self: DurationInput) => Duration.toMinutes(self);
export const toHours = (self: DurationInput) => Duration.toHours(self);
export const toDays = (self: DurationInput) => Duration.toDays(self);
export const toWeeks = (self: DurationInput) => Duration.toWeeks(self);
export const toNanos = (self: DurationInput) => Duration.toNanos(self);
export const unsafeToNanos = (self: DurationInput) => Duration.unsafeToNanos(self);
export const toHrTime = (self: DurationInput) => Duration.toHrTime(self);

// Creation & Operations
export const weeks = (weeks: number) => Duration.weeks(weeks);
export const days = (days: number) => Duration.days(days);
export const hours = (hours: number) => Duration.hours(hours);
export const minutes = (minutes: number) => Duration.minutes(minutes);
export const seconds = (seconds: number) => Duration.seconds(seconds);
export const millis = (millis: number) => Duration.millis(millis);
export const micros = (micros: bigint) => Duration.micros(micros);
export const nanos = (nanos: bigint) => Duration.nanos(nanos);

// Formatting
/**
 * Convert to Duration from DurationInput (number | string)
 * @param self DurationInput
 * @returns number
 * @throws TypeError
 * @example
 * ```ts
 * toDuration(10n) // same as Duration.nanos(10)
 * toDuration(100) // same as Duration.millis(100)
 * toDuration(Infinity) // same as Duration.infinity
 *
 * toDuration("10 nanos") // same as Duration.nanos(10)
 * toDuration("20 micros") // same as Duration.micros(20)
 * toDuration("100 millis") // same as Duration.millis(100)
 * toDuration("2 seconds") // same as Duration.seconds(2)
 * toDuration("5 minutes") // same as Duration.minutes(5)
 * toDuration("7 hours") // same as Duration.hours(7)
 * toDuration("3 weeks") // same as Duration.weeks(3)
 * ```
 */
export const toDuration = (self: DurationInput) => Duration.decode(self);
export const formatDuration = (self: DurationInput) => Duration.format(self);

// Comparison
export const durationEq = (self: DurationInput, other: DurationInput) =>
  Duration.equals(self, other);
export const durationGt = (self: DurationInput, other: DurationInput) =>
  Duration.greaterThan(self, other);
export const durationGte = (self: DurationInput, other: DurationInput) =>
  Duration.greaterThanOrEqualTo(self, other);
export const durationLt = (self: DurationInput, other: DurationInput) =>
  Duration.lessThan(self, other);
export const durationLte = (self: DurationInput, other: DurationInput) =>
  Duration.lessThanOrEqualTo(self, other);
export const durationMax = (self: DurationInput, other: DurationInput) => Duration.max(self, other);
export const durationMin = (self: DurationInput, other: DurationInput) => Duration.min(self, other);
export const durationClamp = (
  self: DurationInput,
  minimum: DurationInput,
  maximum: DurationInput,
) =>
  Duration.clamp(self, {
    minimum,
    maximum,
  });
export const durationBetween = (
  self: DurationInput,
  minimum: DurationInput,
  maximum: DurationInput,
) =>
  Duration.between({
    minimum,
    maximum,
  })(self);
export const durationDivide = (self: DurationInput, divisor: number) =>
  Duration.divide(self, divisor);

// Validations
export const isDuration = (self: unknown): self is DurationType => {
  try {
    Duration.decode(self as DurationInput);

    return true;
  } catch {
    return false;
  }
};
export const durationIsZero = (self: Duration.Duration) => Duration.isZero(self);
export const durationIsFinite = (self: Duration.Duration) => Duration.isFinite(self);

/**
 * Humanize the duration in Persian.
 * @param input
 * @example
 * toPersianHumanDuration("1 day") // یک روز
 */
export function toPersianHumanDuration(input: string | number): string {
  let $input = input as DurationInput;
  if (!isDuration(input)) {
    $input = Duration.decode(input as DurationInput);
  }

  return humanizer(Duration.toMillis($input), {
    language: DurationFaLanguage,
  });
}
