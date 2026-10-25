import { expect, test } from "bun:test";
import { convertBigIntToNumber } from "../../src/utils/bigint-converter.util";

test("analytics counters serialize without treating ordinary JSON as a decimal", () => {
  const input = { count: 42n, rows: [0n, null, false], metadata: { s: 1, e: 2, d: [3] } };
  const result = convertBigIntToNumber(input);
  expect(result).toEqual({ count: 42, rows: [0, null, false], metadata: { s: 1, e: 2, d: [3] } });
  expect(input.count).toBe(42n);
  expect(() => JSON.stringify(result)).not.toThrow();
});
