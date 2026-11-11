import { expect, test } from "bun:test";
import { allocateSweeps, buildDonut } from "../src/components/charts/donut-chart/model";

test("small shares still get a drawable arc and the ring stays a full circle", () => {
  const shares = [0.185, 0.766, 0.035, 0.002, 0.012];
  const sweeps = allocateSweeps(shares, 21.6);
  expect(sweeps.reduce((a, b) => a + b, 0)).toBeCloseTo(360, 6);
  for (const sweep of sweeps) expect(sweep).toBeGreaterThanOrEqual(21.6 - 1e-9);
  // Large segments keep their order of size.
  expect(sweeps[1]).toBeGreaterThan(sweeps[0]);
  expect(allocateSweeps([0.5, 0.5], 10)).toEqual([180, 180]);
  expect(allocateSweeps([0.9, 0.1], 200)).toEqual([180, 180]);
});

test("segments never overlap and the legend keeps the exact shares", () => {
  const { placed, total } = buildDonut(
    [
      { id: "a", name: "A", color: "red", value: 1284 },
      { id: "b", name: "B", color: "blue", value: 5321 },
      { id: "c", name: "C", color: "gold", value: 240 },
      { id: "d", name: "D", color: "pink", value: 12 },
      { id: "e", name: "E", color: "violet", value: 90 },
    ],
    { radius: 81, thickness: 22, gap: 3 },
  );
  expect(total).toBe(6947);
  expect(placed[3].share).toBeCloseTo(12 / 6947, 9);
  // Every arc starts after the previous one ends: read the start and end angles back.
  const angle = (x: number, y: number) => (Math.atan2(x - 100, 100 - y) * 180) / Math.PI + 360;
  let previousEnd = -Infinity;
  for (const segment of placed) {
    // "M x1 y1 A r r rotation large sweep x2 y2"
    const [, x1, y1, , , , , , , x2, y2] = segment.path.split(" ").map(Number);
    const start = angle(x1, y1) % 360;
    const end = angle(x2, y2) % 360;
    expect(end).not.toBeCloseTo(start, 1);
    if (previousEnd !== -Infinity) expect(start).toBeGreaterThan(previousEnd);
    previousEnd = end < start ? end + 360 : end;
  }
});
