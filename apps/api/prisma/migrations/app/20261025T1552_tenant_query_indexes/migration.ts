#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/7dcc3981b1ddb934eac8a8c504fca784b55df9af762c34a8a7678a6849b04045/contract';
import startContract from '../../snapshots/7dcc3981b1ddb934eac8a8c504fca784b55df9af762c34a8a7678a6849b04045/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/922f2f4a6ca1bdb756f67e35e7a16c99832ed21c005b9dcb30d9b1c2960585d4/contract';
import endContract from '../../snapshots/922f2f4a6ca1bdb756f67e35e7a16c99832ed21c005b9dcb30d9b1c2960585d4/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, createIndex } from '@prisma/orm-mongo/target/migration';

class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      createIndex(
        'sync_storage_items',
        [
          { direction: 1, field: 'userId' },
          { direction: 1, field: 'isDeleted' },
          { direction: 1, field: 'key' },
        ],
        {},
      ),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
