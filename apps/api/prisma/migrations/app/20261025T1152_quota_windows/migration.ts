#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/1a95af5d2ab1116e455eb6ae0cf76584b2914d5967617d2e06134a9b6e013d10/contract';
import endContract from '../../snapshots/1a95af5d2ab1116e455eb6ae0cf76584b2914d5967617d2e06134a9b6e013d10/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/bfe614560ee92c8ac064147c7d6d5c5a1b847adeba36c12c7563f1455d975ae7/contract';
import startContract from '../../snapshots/bfe614560ee92c8ac064147c7d6d5c5a1b847adeba36c12c7563f1455d975ae7/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, collMod } from '@prisma/orm-mongo/target/migration';

class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      collMod(
        'api_keys',
        {
          validator: {
            $jsonSchema: {
              additionalProperties: false,
              bsonType: 'object',
              properties: {
                _id: { bsonType: 'string' },
                alertThresholds: { bsonType: ['null', 'string'] },
                allowedMethods: { bsonType: ['null', 'string'] },
                allowedUserAgents: { bsonType: ['null', 'string'] },
                avgResponseTimeMs: { bsonType: 'int' },
                blockedUserAgents: { bsonType: ['null', 'string'] },
                canRead: { bsonType: 'bool' },
                canWrite: { bsonType: 'bool' },
                countryRestrictions: { bsonType: ['null', 'string'] },
                createdAt: { bsonType: 'date' },
                currentDailyUsage: { bsonType: 'int' },
                currentHourUsage: { bsonType: 'int' },
                currentMinuteUsage: { bsonType: 'int' },
                currentMonthlyUsage: { bsonType: 'int' },
                dailyQuota: { bsonType: ['null', 'int'] },
                description: { bsonType: ['null', 'string'] },
                enableAnalytics: { bsonType: 'bool' },
                expiresAt: { bsonType: ['null', 'date'] },
                failedCalls: { bsonType: 'int' },
                hourQuota: { bsonType: ['null', 'int'] },
                ipRestrictions: { bsonType: ['null', 'string'] },
                isActive: { bsonType: 'bool' },
                key: { bsonType: 'string' },
                lastFailedAt: { bsonType: ['null', 'date'] },
                lastFailureReason: { bsonType: ['null', 'string'] },
                lastQuotaResetAt: { bsonType: 'date' },
                lastSecurityViolation: { bsonType: ['null', 'date'] },
                lastUsedAt: { bsonType: ['null', 'date'] },
                metadata: { bsonType: ['null', 'string'] },
                minuteQuota: { bsonType: ['null', 'int'] },
                monthlyQuota: { bsonType: ['null', 'int'] },
                name: { bsonType: 'string' },
                originRestrictions: { bsonType: ['null', 'string'] },
                p95ResponseTimeMs: { bsonType: 'int' },
                p99ResponseTimeMs: { bsonType: 'int' },
                quotaWindow_day: { bsonType: ['null', 'date'] },
                quotaWindow_hour: { bsonType: ['null', 'date'] },
                quotaWindow_minute: { bsonType: ['null', 'date'] },
                quotaWindow_month: { bsonType: ['null', 'date'] },
                rateLimitPerSecond: { bsonType: ['null', 'int'] },
                requireHttps: { bsonType: 'bool' },
                restrictionMode: { bsonType: ['null', 'string'] },
                scopes: { bsonType: ['null', 'string'] },
                securityViolations: { bsonType: 'int' },
                successfulCalls: { bsonType: 'int' },
                totalCalls: { bsonType: 'int' },
                updatedAt: { bsonType: 'date' },
                webhookEvents: { bsonType: ['null', 'string'] },
                webhookUrl: { bsonType: ['null', 'string'] },
                websiteOrigins: { bsonType: ['null', 'string'] },
              },
              required: [
                '_id',
                'avgResponseTimeMs',
                'canRead',
                'canWrite',
                'createdAt',
                'currentDailyUsage',
                'currentHourUsage',
                'currentMinuteUsage',
                'currentMonthlyUsage',
                'enableAnalytics',
                'failedCalls',
                'isActive',
                'key',
                'lastQuotaResetAt',
                'name',
                'p95ResponseTimeMs',
                'p99ResponseTimeMs',
                'requireHttps',
                'securityViolations',
                'successfulCalls',
                'totalCalls',
                'updatedAt',
              ],
            },
          },
          validationLevel: 'strict',
          validationAction: 'error',
        },
        {
          id: 'validator.api_keys.update',
          label:
            'Update validator on api_keys (added: quotaWindow_day, quotaWindow_hour, quotaWindow_minute, quotaWindow_month)',
          operationClass: 'widening',
        },
      ),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
