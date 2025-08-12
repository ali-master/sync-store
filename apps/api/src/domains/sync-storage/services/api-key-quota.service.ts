import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectDbTransactor, type PrismaTransactor } from "@root/modules/db";

@Injectable()
export class ApiKeyQuotaService {
  private readonly logger = new Logger(ApiKeyQuotaService.name);

  constructor(
    @InjectDbTransactor()
    private readonly dbTransactorService: PrismaTransactor,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async resetMinuteQuotas(): Promise<void> {
    try {
      const result = await this.dbTransactorService.tx.apiKey.updateMany({
        where: {
          currentMinuteUsage: { gt: 0 },
        },
        data: {
          currentMinuteUsage: 0,
        },
      });

      if (result.count > 0) {
        this.logger.debug(`Reset minute quotas for ${result.count} API keys`);
      }
    } catch (error) {
      this.logger.error("Failed to reset minute quotas:", error);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async resetHourQuotas(): Promise<void> {
    try {
      const result = await this.dbTransactorService.tx.apiKey.updateMany({
        where: {
          currentHourUsage: { gt: 0 },
        },
        data: {
          currentHourUsage: 0,
        },
      });

      if (result.count > 0) {
        this.logger.debug(`Reset hour quotas for ${result.count} API keys`);
      }
    } catch (error) {
      this.logger.error("Failed to reset hour quotas:", error);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async resetDailyQuotas(): Promise<void> {
    try {
      const result = await this.dbTransactorService.tx.apiKey.updateMany({
        where: {
          currentDailyUsage: { gt: 0 },
        },
        data: {
          currentDailyUsage: 0,
        },
      });

      if (result.count > 0) {
        this.logger.log(`Reset daily quotas for ${result.count} API keys`);
      }
    } catch (error) {
      this.logger.error("Failed to reset daily quotas:", error);
    }
  }

  @Cron("0 0 1 * *") // First day of every month
  async resetMonthlyQuotas(): Promise<void> {
    try {
      const result = await this.dbTransactorService.tx.apiKey.updateMany({
        where: {
          currentMonthlyUsage: { gt: 0 },
        },
        data: {
          currentMonthlyUsage: 0,
        },
      });

      if (result.count > 0) {
        this.logger.log(`Reset monthly quotas for ${result.count} API keys`);
      }
    } catch (error) {
      this.logger.error("Failed to reset monthly quotas:", error);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupExpiredKeys(): Promise<void> {
    try {
      const expiredKeys = await this.dbTransactorService.tx.apiKey.findMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
          isActive: true,
        },
        select: { id: true, name: true, expiresAt: true },
      });

      if (expiredKeys.length > 0) {
        await this.dbTransactorService.tx.apiKey.updateMany({
          where: {
            id: { in: expiredKeys.map((key) => key.id) },
          },
          data: {
            isActive: false,
          },
        });

        this.logger.log(`Deactivated ${expiredKeys.length} expired API keys`);
      }
    } catch (error) {
      this.logger.error("Failed to cleanup expired API keys:", error);
    }
  }

  async getQuotaStatus(apiKeyId: string): Promise<{
    minuteUsage: { current: number; limit?: number; remaining?: number };
    hourUsage: { current: number; limit?: number; remaining?: number };
    dailyUsage: { current: number; limit?: number; remaining?: number };
    monthlyUsage: { current: number; limit?: number; remaining?: number };
  }> {
    const apiKey = await this.dbTransactorService.tx.apiKey.findUnique({
      where: { id: apiKeyId },
      select: {
        currentMinuteUsage: true,
        currentHourUsage: true,
        currentDailyUsage: true,
        currentMonthlyUsage: true,
        minuteQuota: true,
        hourQuota: true,
        dailyQuota: true,
        monthlyQuota: true,
      },
    });

    if (!apiKey) {
      throw new Error("API key not found");
    }

    return {
      minuteUsage: {
        current: apiKey.currentMinuteUsage,
        limit: apiKey.minuteQuota || undefined,
        remaining: apiKey.minuteQuota ? apiKey.minuteQuota - apiKey.currentMinuteUsage : undefined,
      },
      hourUsage: {
        current: apiKey.currentHourUsage,
        limit: apiKey.hourQuota || undefined,
        remaining: apiKey.hourQuota ? apiKey.hourQuota - apiKey.currentHourUsage : undefined,
      },
      dailyUsage: {
        current: apiKey.currentDailyUsage,
        limit: apiKey.dailyQuota || undefined,
        remaining: apiKey.dailyQuota ? apiKey.dailyQuota - apiKey.currentDailyUsage : undefined,
      },
      monthlyUsage: {
        current: apiKey.currentMonthlyUsage,
        limit: apiKey.monthlyQuota || undefined,
        remaining: apiKey.monthlyQuota
          ? apiKey.monthlyQuota - apiKey.currentMonthlyUsage
          : undefined,
      },
    };
  }

  async recordFailure(apiKeyId: string, reason: string): Promise<void> {
    try {
      // Truncate reason to fit database column length (190 chars max for MariaDB UTF8)
      const truncatedReason = reason.length > 190 ? reason.substring(0, 187) + "..." : reason;

      await this.dbTransactorService.tx.apiKey.update({
        where: { id: apiKeyId },
        data: {
          failedCalls: { increment: 1 },
          lastFailedAt: new Date(),
          lastFailureReason: truncatedReason,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to record API key failure: ${error}`);
    }
  }

  async recordSecurityViolation(apiKeyId: string): Promise<void> {
    try {
      await this.dbTransactorService.tx.apiKey.update({
        where: { id: apiKeyId },
        data: {
          securityViolations: { increment: 1 },
          lastSecurityViolation: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(`Failed to record security violation: ${error}`);
    }
  }

  async updatePerformanceMetrics(apiKeyId: string, responseTimeMs: number): Promise<void> {
    try {
      const apiKey = await this.dbTransactorService.tx.apiKey.findUnique({
        where: { id: apiKeyId },
        select: {
          avgResponseTimeMs: true,
          totalCalls: true,
        },
      });

      if (apiKey) {
        // Calculate running average
        const newAvg = Math.round(
          (apiKey.avgResponseTimeMs * apiKey.totalCalls + responseTimeMs) / (apiKey.totalCalls + 1),
        );

        await this.dbTransactorService.tx.apiKey.update({
          where: { id: apiKeyId },
          data: {
            avgResponseTimeMs: newAvg,
            // P95 and P99 would require more complex calculations with stored percentiles
          },
        });
      }
    } catch (error) {
      this.logger.error(`Failed to update performance metrics: ${error}`);
    }
  }
}
