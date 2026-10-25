import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { ConflictException, BadRequestException } from "@nestjs/common";
import type { Database } from "@root/modules/db";
import { mutationSession } from "./mutation-context";
import { versionScope } from "../services/access-policy";

export const groupingCommit = new AsyncLocalStorage<boolean>();
type Tree = Record<string, string>;

/** Share the mutation's native session: this Prisma release cannot bind its ORM to ClientSession. */
async function blob(db: Database, owner: string, value: string, metadata: string | null) {
  const id = createHash("sha256")
    .update(JSON.stringify([owner, value, metadata]))
    .digest("hex");
  await db.native
    .collection<{ _id: string; [key: string]: any }>("version_blobs")
    .updateOne(
      { _id: id },
      { $setOnInsert: { owner, value, metadata } },
      { upsert: true, session: mutationSession.getStore() },
    );
  return id;
}

/** Advance an immutable commit graph together with data, receipts, history and the outbox. */
export async function appendCommit(
  db: Database,
  userId: string,
  message: string,
  change?: { key: string; value: string; metadata: string | null; isDeleted: boolean },
  expected?: string | null,
  replacement?: Tree,
) {
  const { owner, branch } = versionScope(userId),
    session = mutationSession.getStore();
  if (!session) throw new Error("Commit requires a storage transaction");
  const branches = db.native.collection<{ _id: string; [key: string]: any }>("version_branches");
  const commits = db.native.collection<{ _id: string; [key: string]: any }>("version_commits");
  const id = JSON.stringify([owner, branch]);
  let current = await branches.findOne({ _id: id }, { session });
  if (!current) {
    if (branch !== "main") throw new ConflictException("Branch does not exist");
    current = { _id: id, owner, name: branch, head: null, createdAt: new Date() };
    await branches.insertOne(current, { session });
  }
  if (expected !== undefined && current.head !== expected)
    throw new ConflictException("Branch changed; refresh its head before committing");
  const parent = current.head
    ? await commits.findOne({ _id: current.head, owner }, { session })
    : null;
  if (current.head && !parent) throw new Error("Branch head is missing");
  let tree: Tree = Object.create(null);
  if (replacement) tree = Object.assign(Object.create(null), replacement);
  else if (parent) {
    tree = Object.assign(Object.create(null), JSON.parse(parent.tree));
  } else {
    for await (const item of db.native
      .collection("sync_storage_items")
      .find({ userId, isDeleted: false }, { session }))
      tree[item.key] = await blob(db, owner, item.value, item.metadata ?? null);
  }
  if (change) {
    if (change.isDeleted) delete tree[change.key];
    else tree[change.key] = await blob(db, owner, change.value, change.metadata);
  }
  const encoded = JSON.stringify(tree);
  if (Buffer.byteLength(encoded) > 8 * 1024 * 1024)
    throw new BadRequestException("Branch tree exceeds the 8 MiB manifest limit");
  const commit = {
    _id: randomUUID(),
    owner,
    branch,
    parent: current.head ?? null,
    tree: encoded,
    message,
    // Keep cursor order causal across same-millisecond writes and replica clock skew.
    createdAt: new Date(Math.max(Date.now(), parent ? +parent.createdAt + 1 : 0)),
    projected: false,
  };
  await commits.insertOne(commit, { session });
  const updated = await branches.updateOne(
    { _id: id, head: current.head ?? null },
    { $set: { head: commit._id } },
    { session },
  );
  if (updated.modifiedCount !== 1) throw new ConflictException("Branch head changed");
  return { id: commit._id, branch, parent: commit.parent, message, createdAt: commit.createdAt };
}
