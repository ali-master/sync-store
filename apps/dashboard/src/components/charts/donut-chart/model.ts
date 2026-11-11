export interface DonutSegment {
  id: string;
  name: string;
  /** Any CSS color, such as "#2563eb" or "var(--chart-1)". */
  color: string;
  /** Nonnegative value. Zero and invalid values are left out of the ring. */
  value: number;
}

export type PlacedSegment = DonutSegment & {
  /** Share of the total, from 0 to 1. */
  share: number;
  /** Centerline arc path in the 200 × 200 viewBox. */
  path: string;
};

export const DONUT_SIZE = 200;
const CENTER = DONUT_SIZE / 2;
/** The shortest arc a segment draws, beyond its caps and gaps, so a small share stays a pill. */
const MIN_ARC_DEGREES = 6;

const point = (radius: number, degrees: number) => {
  const radians = (degrees * Math.PI) / 180;
  return [CENTER + radius * Math.sin(radians), CENTER - radius * Math.cos(radians)];
};

/**
 * Split the circle by share, but give every segment at least `minimum` degrees. Large segments give
 * up the difference in proportion to their size. Without this, a small share is shorter than its
 * own round caps and is drawn as a dot on top of its neighbour.
 */
export function allocateSweeps(shares: readonly number[], minimum: number): number[] {
  if (shares.length * minimum >= 360) return shares.map(() => 360 / shares.length);
  const sweeps = shares.map((share) => share * 360);
  const fixed = new Set<number>();
  for (;;) {
    const raised = sweeps.findIndex((sweep, index) => !fixed.has(index) && sweep < minimum);
    if (raised === -1) break;
    // Raise every short segment to the minimum, then rescale the rest to fill what remains.
    sweeps.forEach((sweep, index) => {
      if (!fixed.has(index) && sweep < minimum) fixed.add(index);
    });
    const free = sweeps.reduce(
      (sum, _, index) => (fixed.has(index) ? sum : sum + shares[index]),
      0,
    );
    const room = 360 - fixed.size * minimum;
    sweeps.forEach((_, index) => {
      sweeps[index] = fixed.has(index) ? minimum : (shares[index] / free) * room;
    });
  }
  return sweeps;
}

/**
 * Lays segments clockwise from 12 o'clock as round-capped arcs. Each arc is shortened by the gap
 * plus its own cap, so neighbouring pills keep an even gap. The legend keeps the exact shares; only
 * the ring enlarges a segment too small to draw.
 */
export function buildDonut(
  segments: readonly DonutSegment[],
  { radius, thickness, gap }: { radius: number; thickness: number; gap: number },
) {
  const valid = segments.filter((segment) => Number.isFinite(segment.value) && segment.value > 0);
  const total = valid.reduce((sum, segment) => sum + segment.value, 0);
  const capDegrees = (thickness / 2 / radius) * (180 / Math.PI);
  const single = valid.length === 1;
  const inset = single ? 0 : gap / 2 + capDegrees;
  const shares = valid.map((segment) => (total ? segment.value / total : 0));
  const sweeps = allocateSweeps(shares, 2 * inset + MIN_ARC_DEGREES);
  let cursor = 0;
  const placed: PlacedSegment[] = valid.map((segment, index) => {
    const start = cursor + inset;
    const end = Math.max(start + 0.01, cursor + sweeps[index] - inset);
    cursor += sweeps[index];
    let path: string;
    if (single) {
      // A full ring needs two half arcs; one arc cannot start and end together.
      const [x1, y1] = point(radius, 0);
      const [x2, y2] = point(radius, 180);
      path = `M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2} A ${radius} ${radius} 0 1 1 ${x1} ${y1}`;
    } else {
      const [x1, y1] = point(radius, start);
      const [x2, y2] = point(radius, end);
      path = `M ${x1} ${y1} A ${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 1 ${x2} ${y2}`;
    }
    return { ...segment, share: shares[index], path };
  });
  return { placed, total };
}
