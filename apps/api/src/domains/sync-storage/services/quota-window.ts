export const quotaWindows = [
  { unit: "minute", limit: "minuteQuota", counter: "currentMinuteUsage" },
  { unit: "hour", limit: "hourQuota", counter: "currentHourUsage" },
  { unit: "day", limit: "dailyQuota", counter: "currentDailyUsage" },
  { unit: "month", limit: "monthlyQuota", counter: "currentMonthlyUsage" },
] as const;

/** Database time and UTC calendar boundaries keep every replica in the same window. */
export function quotaWindow(window: (typeof quotaWindows)[number]) {
  const start = { $dateTrunc: { date: "$$NOW", unit: window.unit, timezone: "UTC" } };
  const marker = `quotaWindow_${window.unit}`;
  const current = { $gte: [{ $ifNull: [`$${marker}`, new Date(0)] }, start] };
  const usage = { $cond: [current, { $ifNull: [`$${window.counter}`, 0] }, 0] };
  return { start, marker, current, usage };
}

/** Admit and charge once, including rollover, in the same atomic document update. */
export function quotaConsumption() {
  return {
    filter: {
      $expr: {
        $and: quotaWindows.map((window) => ({
          $or: [
            { $eq: [{ $ifNull: [`$${window.limit}`, null] }, null] },
            { $lt: [quotaWindow(window).usage, `$${window.limit}`] },
          ],
        })),
      },
    },
    update: [
      {
        $set: Object.fromEntries([
          ...quotaWindows.flatMap((window) => {
            const { marker, start, usage, current } = quotaWindow(window);
            return [
              [window.counter, { $add: [usage, 1] }],
              [marker, { $cond: [current, `$${marker}`, start] }],
            ];
          }),
          ["lastUsedAt", "$$NOW"],
          ["totalCalls", { $add: [{ $ifNull: ["$totalCalls", 0] }, 1] }],
        ]),
      },
    ],
  };
}
