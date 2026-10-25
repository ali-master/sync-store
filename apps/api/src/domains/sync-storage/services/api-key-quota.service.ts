import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectDatabase, Database, type MongoDocument } from "@root/modules/db";
import type { Models } from "@root/modules/db/contract.d";
import { quotaWindows, quotaWindow } from "./quota-window";

@Injectable()
export class ApiKeyQuotaService {
  private readonly logger = new Logger(ApiKeyQuotaService.name);
  constructor(@InjectDatabase() private readonly database: Database) {}

  private get keys() {
    return this.database.native.collection<MongoDocument<Models.unbound_ApiKey>>("api_keys");
  }

  private async reset(
    counter:
      "currentMinuteUsage" | "currentHourUsage" | "currentDailyUsage" | "currentMonthlyUsage",
  ) {
    const window = quotaWindows.find((window) => window.counter === counter)!;
    const { marker, start, current } = quotaWindow(window);
    await this.keys.updateMany({ $expr: { $not: [current] } }, [
      { $set: { [counter]: 0, [marker]: start, lastQuotaResetAt: "$$NOW" } },
    ]);
  }

  @Cron(CronExpression.EVERY_MINUTE, { timeZone: "UTC" })
  async resetMinuteQuotas() {
    await this.reset("currentMinuteUsage");
  }

  @Cron(CronExpression.EVERY_HOUR, { timeZone: "UTC" })
  async resetHourQuotas() {
    await this.reset("currentHourUsage");
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: "UTC" })
  async resetDailyQuotas() {
    await this.reset("currentDailyUsage");
  }

  @Cron("0 0 1 * *", { timeZone: "UTC" })
  async resetMonthlyQuotas() {
    await this.reset("currentMonthlyUsage");
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupExpiredKeys() {
    await this.keys.updateMany(
      { expiresAt: { $lt: new Date() }, isActive: true },
      { $set: { isActive: false } },
    );
  }

  async getQuotaStatus(apiKeyId: string) {
    const key = await this.database.orm.api_keys.where({ id: apiKeyId }).first();
    if (!key) throw new Error("API key not found");
    const usage = (current: number, limit: number | null) => ({
      current,
      limit: limit ?? undefined,
      remaining: limit == null ? undefined : Math.max(0, limit - current),
    });
    return {
      minuteUsage: usage(key.currentMinuteUsage, key.minuteQuota),
      hourUsage: usage(key.currentHourUsage, key.hourQuota),
      dailyUsage: usage(key.currentDailyUsage, key.dailyQuota),
      monthlyUsage: usage(key.currentMonthlyUsage, key.monthlyQuota),
    };
  }

  async recordFailure(apiKeyId: string, reason: string) {
    await this.keys
      .updateOne(
        { _id: apiKeyId },
        {
          $inc: { failedCalls: 1 },
          $set: { lastFailedAt: new Date(), lastFailureReason: reason.slice(0, 1000) },
        },
      )
      .catch((error) => this.logger.error("Failed to record request failure", error));
  }

  async recordSecurityViolation(apiKeyId: string) {
    await this.keys
      .updateOne(
        { _id: apiKeyId },
        {
          $inc: { securityViolations: 1 },
          $set: { lastSecurityViolation: new Date() },
        },
      )
      .catch((error) => this.logger.error("Failed to record security violation", error));
  }

  /** Updates the running average atomically so concurrent responses do not overwrite each other. */
  async updatePerformanceMetrics(apiKeyId: string, responseTimeMs: number) {
    await this.keys
      .updateOne({ _id: apiKeyId }, [
        {
          $set: {
            avgResponseTimeMs: {
              $toInt: {
                $round: [
                  {
                    $divide: [
                      {
                        $add: [
                          { $multiply: ["$avgResponseTimeMs", "$successfulCalls"] },
                          responseTimeMs,
                        ],
                      },
                      { $add: ["$successfulCalls", 1] },
                    ],
                  },
                  0,
                ],
              },
            },
            successfulCalls: { $add: ["$successfulCalls", 1] },
          },
        },
      ])
      .catch((error) => this.logger.error("Failed to record response metrics", error));
  }
}
