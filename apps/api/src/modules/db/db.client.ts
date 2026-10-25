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
  }

  /** Releases the shared pool during graceful shutdown. */
  async onApplicationShutdown() {
    await this.prisma.close();
    await this.client.close();
  }

  /** Runs server-side analytics without loading all tenant data into memory. */
  aggregate<T extends Document>(collection: string, pipeline: Document[]): Promise<T[]> {
    return this.native.collection(collection).aggregate<T>(pipeline).toArray();
  }
}
