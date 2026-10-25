import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
} from "@nestjs/common";
import { MongoFieldFilter as F, MongoAndExpr, MongoOrExpr } from "@prisma/orm-mongo/query-ast";
import { Cron } from "@nestjs/schedule";
import { Database, InjectDatabase } from "@root/modules/db";
import { SyncStorageRepository } from "../repositories/sync-storage.repository";
import { inMutation, mutationSession, runMutation } from "../repositories/mutation-context";
import { appendCommit, groupingCommit } from "../repositories/version-store";
import { branchName, branchUser, versionScope } from "./access-policy";

/** Branches and commits use Prisma reads; session-bound writes and time series are explicit native exceptions. */
@Injectable()
export class VersioningService implements OnModuleInit {
  private readonly logger = new Logger(VersioningService.name);
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly storage: SyncStorageRepository,
  ) {}

  async onModuleInit() {
    try {
      await this.db.native.createCollection("commit_timeline", {
        timeseries: { timeField: "at", metaField: "scope", granularity: "seconds" },
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 48) throw error;
    }
    const info = await this.db.native.listCollections({ name: "commit_timeline" }).next();
    if (!info || !("options" in info) || !info.options?.timeseries)
      throw new Error("commit_timeline must be a time-series collection");
    await this.db.native
      .collection("commit_timeline")
      .createIndex({ "scope.owner": 1, "scope.branch": 1, at: -1 });
  }

  async branches(userId: string) {
    const { owner } = versionScope(userId);
    const rows = await this.db.orm.version_branches.where({ owner }).orderBy({ name: 1 }).all();
    return rows.some((row) => row.name === "main")
      ? rows
      : [{ id: JSON.stringify([owner, "main"]), owner, name: "main", head: null }, ...rows];
  }

  /** Authoritative commits remain readable even when time-series projection is delayed. */
  async commits(userId: string, before?: string) {
    const { owner, branch } = versionScope(userId);
    let query = this.db.orm.version_commits.where({ owner, branch });
    if (before) {
      const cursor = await this.db.orm.version_commits.where({ id: before, owner, branch }).first();
      if (!cursor) throw new BadRequestException("Invalid commit cursor");
      query = query.where(
        new MongoOrExpr([
          F.lt("createdAt", cursor.createdAt),
          new MongoAndExpr([F.eq("createdAt", cursor.createdAt), F.lt("id", before)]),
        ]),
      );
    }
    return query
      .select("id", "branch", "parent", "message", "createdAt", "projected")
      .orderBy({ createdAt: -1, id: -1 })
      .limit(50)
      .all();
  }

  async commit(userId: string, id: string) {
    const { owner } = versionScope(userId);
    const result = await this.db.orm.version_commits.where({ id, owner }).first();
    if (!result) throw new NotFoundException("Commit not found");
    return { ...result, tree: JSON.parse(result.tree) };
  }

  /** Deduplicate projection retries by commit ID; no unique indexes exist on MongoDB time series. */
  async timeline(userId: string) {
    const { owner, branch } = versionScope(userId);
    const recent = await this.db.orm.version_commits
      .where({ owner, branch })
      .select("id", "createdAt")
      .orderBy({ createdAt: -1, id: -1 })
      .limit(50)
      .all();
    if (!recent.length) return [];
    return this.db.native
      .collection("commit_timeline")
      .aggregate(
        [
          {
            $match: {
              "scope.owner": owner,
              "scope.branch": branch,
              at: { $gte: recent.at(-1)!.createdAt },
              commitId: { $in: recent.map((row) => row.id) },
            },
          },
          { $sort: { at: -1 } },
          {
            $group: {
              _id: "$commitId",
              at: { $first: "$at" },
              parent: { $first: "$parent" },
              message: { $first: "$message" },
            },
          },
          { $sort: { at: -1, _id: -1 } },
          { $limit: 50 },
        ],
        { maxTimeMS: 10000 },
      )
      .toArray();
  }

  private message(body: any) {
    if (typeof body?.message !== "string" || !body.message.trim() || body.message.length > 500)
      throw new BadRequestException("Commit message must contain 1–500 characters");
    if (body.expectedHead !== null && (typeof body.expectedHead !== "string" || !body.expectedHead))
      throw new BadRequestException("expectedHead is required");
    return body.message.trim();
  }

  async checkpoint(userId: string, body: any, requestId?: string) {
    const message = this.message(body);
    return runMutation(
      this.db,
      userId,
      requestId,
      { type: "commit", message, expectedHead: body.expectedHead },
      () => appendCommit(this.db, userId, message, undefined, body.expectedHead),
    );
  }

  /** Fork a committed tree atomically; a failed clone never leaves a half-populated branch. */
  async fork(userId: string, body: any) {
    const name = branchName(body?.name);
    if (name === "main" || typeof body?.commitId !== "string")
      throw new BadRequestException("Choose a new branch name and source commit");
    const { owner } = versionScope(userId),
      target = branchUser(owner, name);
    const source = await this.commit(userId, body.commitId);
    try {
      return await inMutation(this.db, () =>
        groupingCommit.run(true, async () => {
          await this.db.native
            .collection<{ _id: string; [key: string]: any }>("version_branches")
            .insertOne(
              {
                _id: JSON.stringify([owner, name]),
                owner,
                name,
                head: source.id,
                createdAt: new Date(),
              },
              { session: mutationSession.getStore() },
            );
          await this.materialize(target, source.tree);
          return { name, head: source.id };
        }),
      );
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw new ConflictException("Branch already exists");
      throw error;
    }
  }

  async restore(userId: string, id: string, body: any, requestId?: string) {
    const message = this.message(body),
      source = await this.commit(userId, id);
    return runMutation(
      this.db,
      userId,
      requestId,
      { type: "restore-commit", id, message, expectedHead: body.expectedHead },
      () =>
        groupingCommit.run(true, async () => {
          const result = await appendCommit(
            this.db,
            userId,
            message,
            undefined,
            body.expectedHead,
            source.tree,
          );
          await this.materialize(userId, source.tree);
          return result;
        }),
    );
  }

  private async materialize(userId: string, tree: Record<string, string>) {
    const session = mutationSession.getStore(),
      { owner } = versionScope(userId);
    const current = await this.db.native
      .collection("sync_storage_items")
      .find({ userId, isDeleted: false }, { session, projection: { key: 1 } })
      .toArray();
    for (const row of current)
      if (!Object.hasOwn(tree, row.key)) await this.storage.delete(userId, row.key, "versioning");
    for (const [key, id] of Object.entries(tree)) {
      const blob = await this.db.native
        .collection("version_blobs")
        .findOne({ _id: id as any, owner }, { session });
      if (!blob) throw new Error("Commit blob is missing");
      await this.storage.upsert({
        userId,
        key,
        instanceId: "versioning",
        value: JSON.parse(blob.value),
        metadata: blob.metadata ? JSON.parse(blob.metadata) : undefined,
        timestamp: Date.now(),
        version: 1,
        lastModified: new Date(),
      });
    }
  }

  /** A crash before acknowledgement leaves projected=false, so another tick safely retries. */
  @Cron("*/2 * * * * *")
  async project() {
    try {
      const pending = await this.db.orm.version_commits
        .where({ projected: false })
        .orderBy({ createdAt: 1 })
        .limit(25)
        .all();
      for (const commit of pending) {
        await this.db.native.collection("commit_timeline").insertOne({
          at: commit.createdAt,
          scope: { owner: commit.owner, branch: commit.branch },
          commitId: commit.id,
          parent: commit.parent,
          message: commit.message,
        });
        await this.db.orm.version_commits.where({ id: commit.id }).update({ projected: true });
      }
    } catch {
      this.logger.warn("Commit timeline projection deferred; authoritative commits retained");
    }
  }
}
