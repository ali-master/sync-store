#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/bfe614560ee92c8ac064147c7d6d5c5a1b847adeba36c12c7563f1455d975ae7/contract';
import endContract from '../../snapshots/bfe614560ee92c8ac064147c7d6d5c5a1b847adeba36c12c7563f1455d975ae7/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e9682b659d14d596845e3409e3aba067ca7c2f65a01c95bb72346f3d84ab01a4/contract';
import startContract from '../../snapshots/e9682b659d14d596845e3409e3aba067ca7c2f65a01c95bb72346f3d84ab01a4/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, collMod } from '@prisma/orm-mongo/target/migration';

class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      collMod(
        'sync_storage_items',
        {
          validator: {
            $jsonSchema: {
              additionalProperties: false,
              bsonType: 'object',
              properties: {
                _id: { bsonType: 'string' },
                compressionType: { bsonType: ['null', 'string'] },
                encryptionType: { bsonType: ['null', 'string'] },
                instanceId: { bsonType: 'string' },
                isDeleted: { bsonType: 'bool' },
                key: { bsonType: 'string' },
                lastModified: { bsonType: 'date' },
                leaseToken: { bsonType: ['null', 'string'] },
                leaseUntil: { bsonType: ['null', 'date'] },
                metadata: { bsonType: ['null', 'string'] },
                outbox: {
                  bsonType: ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'],
                },
                priority: { bsonType: 'int' },
                size: { bsonType: 'int' },
                tags: { bsonType: ['null', 'string'] },
                timestamp: { bsonType: 'long' },
                ttl: { bsonType: ['null', 'date'] },
                userId: { bsonType: 'string' },
                value: { bsonType: 'string' },
                version: { bsonType: 'int' },
              },
              required: [
                '_id',
                'instanceId',
                'isDeleted',
                'key',
                'lastModified',
                'priority',
                'size',
                'timestamp',
                'userId',
                'value',
                'version',
              ],
            },
          },
          validationLevel: 'strict',
          validationAction: 'error',
        },
        {
          id: 'validator.sync_storage_items.update',
          label: 'Update validator on sync_storage_items (added: leaseToken, leaseUntil, outbox)',
          operationClass: 'widening',
        },
      ),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
