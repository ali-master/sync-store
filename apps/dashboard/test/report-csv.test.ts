import { expect, test } from "bun:test";
import { reportCsv } from "../src/lib/report-csv";

test("CSV preserves quotes, commas and zero while neutralizing spreadsheet formulas", () => {
  const csv = reportCsv([
    { key: '=HYPERLINK("evil")', count: 0, note: 'one,"two"' },
    { key: " @SUM(A1)", count: null },
  ]);
  expect(csv).toContain('"\'=HYPERLINK(""evil"")"');
  expect(csv).toContain('"\' @SUM(A1)"');
  expect(csv).toContain('"0"');
  expect(csv).toContain('"one,""two"""');
});
