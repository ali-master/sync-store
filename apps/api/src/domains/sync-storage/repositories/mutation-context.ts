import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { ClientSession } from "mongodb";
import type { Database } from "@root/modules/db";

export const mutationSession = new AsyncLocalStorage<ClientSession>();

/** Normalize JSON object order so equivalent retries share a fingerprint. */
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

/** Commit the receipt, storage mutation and embedded outbox together across replicas. */
export async function runMutation<T>(
  database: Database,
  userId: string,
  requestId: string | undefined,
  payload: unknown,
  work: () => Promise<T>,
): Promise<T> {
  if (requestId === undefined) return work();
  if (typeof requestId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(requestId))
    throw new BadRequestException("Invalid Idempotency-Key (1–128 ASCII identifier characters)");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(canonical(payload)))
    .digest("hex");
  const receipts = database.native.collection<{
    _id: string;
    fingerprint: string;
    result: T | null;
  }>("mutation_receipts");
  const id = JSON.stringify([userId, requestId]);
  const session = database.client.startSession();
  try {
    // A unique receipt serializes concurrent requests, including different keys and clear operations.
    for (let attempt = 0; ; attempt++) {
      try {
        return (await session.withTransaction(
          async () => {
            const receipt = await receipts.findOne({ _id: id }, { session });
            if (receipt) {
              if (receipt.fingerprint !== fingerprint)
                throw new ConflictException("Idempotency-Key already used for another operation");
              return receipt.result;
            }
            await receipts.insertOne({ _id: id, fingerprint, result: null as T }, { session });
            const result = await mutationSession.run(session, work);
            await receipts.updateOne(
              { _id: id },
              { $set: { result: result ?? null } },
              { session },
            );
            return result;
          },
          { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true } },
        )) as T;
      } catch (error) {
        if ((error as { code?: number }).code !== 11000 || attempt >= 4) throw error;
      }
    }
  } finally {
    await session.endSession();
  }
}
