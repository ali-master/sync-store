import { Injectable, Logger } from "@nestjs/common";
import { StorageItem } from "../entities/storage-item.entity";
import { InjectDbTransactor, PrismaTransactor } from "@root/modules/db";

interface StorageData {
  userId: string;
  instanceId: string;
  key: string;
  value: any;
  metadata?: Record<string, any>;
  version: number;
  timestamp: number;
  lastModified: Date;
  isDeleted?: boolean;
}

@Injectable()
export class SyncStorageRepository {
  private readonly logger = new Logger(SyncStorageRepository.name);

  constructor(
    @InjectDbTransactor()
    private readonly dbTransactorService: PrismaTransactor,
  ) {}

  async findByKey(userId: string, key: string): Promise<StorageItem | null> {
    const item = await this.dbTransactorService.tx.syncStorageItem.findUnique({
      where: {
        userId_key: {
          userId,
          key,
        },
      },
    });

    if (!item || item.isDeleted) {
      return null;
    }

    return new StorageItem({
      userId: item.userId,
      instanceId: item.instanceId,
      key: item.key,
      value: JSON.parse(item.value),
      metadata: item.metadata ? JSON.parse(item.metadata) : undefined,
      version: item.version,
      timestamp: Number(item.timestamp),
      lastModified: item.lastModified,
      isDeleted: item.isDeleted,
    });
  }

  async findAll(userId: string, prefix?: string): Promise<StorageItem[]> {
    const whereClause: any = {
      userId,
      isDeleted: false,
    };

    if (prefix) {
      whereClause.key = {
        startsWith: prefix,
      };
    }

    const items = await this.dbTransactorService.tx.syncStorageItem.findMany({
      where: whereClause,
      orderBy: {
        timestamp: "desc",
      },
    });

    return items.map(
      (item) =>
        new StorageItem({
          userId: item.userId,
          instanceId: item.instanceId,
          key: item.key,
          value: JSON.parse(item.value),
          metadata: item.metadata ? JSON.parse(item.metadata) : undefined,
          version: item.version,
          timestamp: Number(item.timestamp),
          lastModified: item.lastModified,
          isDeleted: item.isDeleted,
        }),
    );
  }

  async findKeys(userId: string, prefix?: string): Promise<string[]> {
    const whereClause: any = {
      userId,
      isDeleted: false,
    };

    if (prefix) {
      whereClause.key = {
        startsWith: prefix,
      };
    }

    const items = await this.dbTransactorService.tx.syncStorageItem.findMany({
      where: whereClause,
      select: {
        key: true,
      },
      orderBy: {
        key: "asc",
      },
    });

    return items.map((item) => item.key);
  }

  async upsert(data: StorageData): Promise<StorageItem> {
    const now = new Date();
    const value = JSON.stringify(data.value);
    const metadata = data.metadata ? JSON.stringify(data.metadata) : null;
    const size = Buffer.byteLength(value, "utf8");

    const item = await this.dbTransactorService.tx.syncStorageItem.upsert({
      where: {
        userId_key: {
          userId: data.userId,
          key: data.key,
        },
      },
      create: {
        userId: data.userId,
        instanceId: data.instanceId,
        key: data.key,
        value,
        metadata,
        version: data.version,
        timestamp: BigInt(data.timestamp),
        lastModified: now,
        size,
        isDeleted: false,
      },
      update: {
        instanceId: data.instanceId,
        value,
        metadata,
        version: data.version,
        timestamp: BigInt(data.timestamp),
        lastModified: now,
        size,
        isDeleted: false,
      },
    });

    this.logger.debug(`Upserted item: ${data.userId}:${data.key}`);

    return new StorageItem({
      userId: item.userId,
      instanceId: item.instanceId,
      key: item.key,
      value: JSON.parse(item.value),
      metadata: item.metadata ? JSON.parse(item.metadata) : undefined,
      version: item.version,
      timestamp: Number(item.timestamp),
      lastModified: item.lastModified,
      isDeleted: item.isDeleted,
    });
  }

  async delete(userId: string, key: string): Promise<void> {
    await this.dbTransactorService.tx.syncStorageItem.updateMany({
      where: {
        userId,
        key,
        isDeleted: false,
      },
      data: {
        isDeleted: true,
        lastModified: new Date(),
      },
    });

    this.logger.debug(`Deleted item: ${userId}:${key}`);
  }

  async clearAll(userId: string): Promise<void> {
    await this.dbTransactorService.tx.syncStorageItem.updateMany({
      where: {
        userId,
        isDeleted: false,
      },
      data: {
        isDeleted: true,
        lastModified: new Date(),
      },
    });

    this.logger.debug(`Cleared all items for user: ${userId}`);
  }

  async exists(userId: string, key: string): Promise<boolean> {
    const item = await this.findByKey(userId, key);
    return item !== null;
  }

  async count(userId: string, prefix?: string): Promise<number> {
    const whereClause: any = {
      userId,
      isDeleted: false,
    };

    if (prefix) {
      whereClause.key = {
        startsWith: prefix,
      };
    }

    return await this.dbTransactorService.tx.syncStorageItem.count({
      where: whereClause,
    });
  }

  async getStorageStats(userId?: string): Promise<{
    totalItems: number;
    totalUsers: number;
    storageSize: number;
    deletedItems: number;
  }> {
    const whereClause = userId ? { userId } : {};

    const [totalItems, deletedItems, storageSize, distinctUsers] = await Promise.all([
      this.dbTransactorService.tx.syncStorageItem.count({
        where: { ...whereClause, isDeleted: false },
      }),
      this.dbTransactorService.tx.syncStorageItem.count({
        where: { ...whereClause, isDeleted: true },
      }),
      this.dbTransactorService.tx.syncStorageItem.aggregate({
        where: whereClause,
        _sum: { size: true },
      }),
      userId
        ? null
        : this.dbTransactorService.tx.syncStorageItem.findMany({
            where: whereClause,
            select: { userId: true },
            distinct: ["userId"],
          }),
    ]);

    return {
      totalItems,
      totalUsers: userId ? 1 : distinctUsers?.length || 0,
      storageSize: Number(storageSize._sum.size || 0),
      deletedItems,
    };
  }

  async cleanup(maxAge?: number): Promise<number> {
    const whereClause: any = { isDeleted: true };

    if (maxAge) {
      const cutoff = new Date(Date.now() - maxAge);
      whereClause.lastModified = { lt: cutoff };
    }

    const result = await this.dbTransactorService.tx.syncStorageItem.deleteMany({
      where: whereClause,
    });

    const cleaned = result.count;

    if (cleaned > 0) {
      this.logger.log(`Cleaned up ${cleaned} deleted items`);
    }

    return cleaned;
  }

  async export(userId?: string): Promise<StorageData[]> {
    const whereClause: any = { isDeleted: false };
    if (userId) {
      whereClause.userId = userId;
    }

    const items = await this.dbTransactorService.tx.syncStorageItem.findMany({
      where: whereClause,
      orderBy: { lastModified: "desc" },
    });

    return items.map((item) => ({
      userId: item.userId,
      instanceId: item.instanceId,
      key: item.key,
      value: JSON.parse(item.value),
      metadata: item.metadata ? JSON.parse(item.metadata) : undefined,
      version: item.version,
      timestamp: Number(item.timestamp),
      lastModified: item.lastModified,
      isDeleted: item.isDeleted,
    }));
  }

  async import(items: StorageData[]): Promise<number> {
    let imported = 0;
    const now = new Date();

    for (const item of items) {
      if (item.userId && item.key && item.value !== undefined) {
        const value = JSON.stringify(item.value);
        const metadata = item.metadata ? JSON.stringify(item.metadata) : null;
        const size = Buffer.byteLength(value, "utf8");

        await this.dbTransactorService.tx.syncStorageItem.upsert({
          where: {
            userId_key: {
              userId: item.userId,
              key: item.key,
            },
          },
          create: {
            userId: item.userId,
            instanceId: item.instanceId,
            key: item.key,
            value,
            metadata,
            version: item.version,
            timestamp: BigInt(item.timestamp),
            lastModified: now,
            size,
            isDeleted: false,
          },
          update: {
            instanceId: item.instanceId,
            value,
            metadata,
            version: item.version,
            timestamp: BigInt(item.timestamp),
            lastModified: now,
            size,
            isDeleted: false,
          },
        });
        imported++;
      }
    }

    this.logger.log(`Imported ${imported} items`);
    return imported;
  }
}
