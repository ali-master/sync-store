#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/1a95af5d2ab1116e455eb6ae0cf76584b2914d5967617d2e06134a9b6e013d10/contract';
import startContract from '../../snapshots/1a95af5d2ab1116e455eb6ae0cf76584b2914d5967617d2e06134a9b6e013d10/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/7dcc3981b1ddb934eac8a8c504fca784b55df9af762c34a8a7678a6849b04045/contract';
import endContract from '../../snapshots/7dcc3981b1ddb934eac8a8c504fca784b55df9af762c34a8a7678a6849b04045/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  collMod,
  createCollection,
  createIndex,
} from '@prisma/orm-mongo/target/migration';

class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // Adopt the legacy unmanaged collection; Mongo create without options is idempotent.
      { ...createCollection('projects'), precheck: [] },
      collMod('projects', {
        validator: {
          $jsonSchema: {
            additionalProperties: false,
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'string' },
              createdAt: { bsonType: 'date' },
              name: { bsonType: 'string' },
              tenantId: { bsonType: ['null', 'string'] },
            },
            required: ['_id', 'createdAt', 'name'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createCollection('tenants', {
        validator: {
          $jsonSchema: {
            additionalProperties: false,
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'string' },
              createdAt: { bsonType: 'date' },
              isActive: { bsonType: 'bool' },
              name: { bsonType: 'string' },
            },
            required: ['_id', 'createdAt', 'isActive', 'name'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createCollection('version_blobs', {
        validator: {
          $jsonSchema: {
            additionalProperties: false,
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'string' },
              metadata: { bsonType: ['null', 'string'] },
              owner: { bsonType: 'string' },
              value: { bsonType: 'string' },
            },
            required: ['_id', 'owner', 'value'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createCollection('version_branches', {
        validator: {
          $jsonSchema: {
            additionalProperties: false,
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'string' },
              createdAt: { bsonType: 'date' },
              head: { bsonType: ['null', 'string'] },
              name: { bsonType: 'string' },
              owner: { bsonType: 'string' },
            },
            required: ['_id', 'createdAt', 'name', 'owner'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createCollection('version_commits', {
        validator: {
          $jsonSchema: {
            additionalProperties: false,
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'string' },
              branch: { bsonType: 'string' },
              createdAt: { bsonType: 'date' },
              message: { bsonType: 'string' },
              owner: { bsonType: 'string' },
              parent: { bsonType: ['null', 'string'] },
              projected: { bsonType: 'bool' },
              tree: { bsonType: 'string' },
            },
            required: ['_id', 'branch', 'createdAt', 'message', 'owner', 'projected', 'tree'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createIndex(
        'api_keys',
        [
          { direction: 1, field: 'tenantId' },
          { direction: 1, field: 'createdAt' },
          { direction: 1, field: '_id' },
        ],
        {},
      ),
      createIndex(
        'projects',
        [
          { direction: 1, field: 'tenantId' },
          { direction: 1, field: 'createdAt' },
          { direction: 1, field: '_id' },
        ],
        {},
      ),
      createIndex(
        'tenants',
        [
          { direction: 1, field: 'createdAt' },
          { direction: 1, field: '_id' },
        ],
        {},
      ),
      createIndex(
        'version_branches',
        [
          { direction: 1, field: 'owner' },
          { direction: 1, field: 'name' },
        ],
        { unique: true },
      ),
      createIndex(
        'version_commits',
        [
          { direction: 1, field: 'owner' },
          { direction: 1, field: 'branch' },
          { direction: 1, field: 'createdAt' },
          { direction: 1, field: '_id' },
        ],
        {},
      ),
      createIndex(
        'version_commits',
        [
          { direction: 1, field: 'projected' },
          { direction: 1, field: 'createdAt' },
        ],
        {},
      ),
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
                tenantId: { bsonType: ['null', 'string'] },
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
          label: 'Update validator on api_keys (added: tenantId)',
          operationClass: 'widening',
        },
      ),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
