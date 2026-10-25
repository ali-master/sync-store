import { Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import mongo from "@prisma/orm-mongo/runtime";
import { contractFromJson } from "@prisma/orm-mongo/static";
import { MongoClient, type Document } from "mongodb";
import type { Contract } from "./contract.d";
import contractJson from "./contract.json";
export type MongoDocument<T> = Omit<T, "id"> & { _id: string };

/** Shares one MongoDB pool between Prisma queries and atomic driver operations. */
@Injectable()
export class Database implements OnModuleInit, OnApplicationShutdown {
  readonly client: MongoClient;
  readonly orm: ReturnType<typeof mongo<Contract>>["orm"];
  readonly native: ReturnType<MongoClient["db"]>;
  private readonly prisma: ReturnType<typeof mongo<Contract>>;

  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url || !/^mongodb(?:\+srv)?:\/\//.test(url)) {
      throw new Error("DATABASE_URL must be a MongoDB connection string");
    }
    this.client = new MongoClient(url, { serverSelectionTimeoutMS: 10_000 });
    this.native = this.client.db();
    this.prisma = mongo({
      contract: contractFromJson<Contract>(contractJson),
      mongoClient: this.client,
      dbName: this.native.databaseName,
    });
    this.orm = this.prisma.orm;
  }

  /** Refuses to serve requests until the configured database is reachable. */
  async onModuleInit() {
    await this.client.connect();
    await this.native.command({ ping: 1 });
    const topology = await this.native.command({ hello: 1 });
    if (!topology.setName && topology.msg !== "isdbgrid")
      throw new Error(
        "Sync Store requires a MongoDB replica set for atomic storage, history and request receipts",
      );
    const retention = Number(process.env.HISTORY_RETENTION_DAYS ?? 30);
    if (!Number.isInteger(retention) || retention < 1 || retention > 3650)
      throw new Error("HISTORY_RETENTION_DAYS must be an integer between 1 and 3650");
    await this.native
      .collection("storage_history")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.native
      .collection("storage_history")
      .createIndex({ userId: 1, key: 1, lastModified: -1, version: -1, _id: -1 });
  }

  /** Releases the shared pool during graceful shutdown. */
  async onApplicationShutdown() {
    await this.prisma.close();
    await this.client.close();
  }

  /** Runs server-side analytics without loading all tenant data into memory. */
  async aggregate<T extends Document>(collection: string, pipeline: Document[]): Promise<T[]> {
    if (Object.hasOwn(contractJson.roots, collection)) {
      const plan = this.prisma.raw
        .collection(collection as keyof Contract["roots"])
        .aggregate<T>(pipeline)
        .build();
      return (await this.prisma.runtime())
        .query(plan, { signal: AbortSignal.timeout(10000) })
        .toArray();
    }
    // Operational projections and time-series collections have no Prisma contract model.
    return this.native
      .collection(collection)
      .aggregate<T>(pipeline, { maxTimeMS: 10000 })
      .toArray();
  }
}
