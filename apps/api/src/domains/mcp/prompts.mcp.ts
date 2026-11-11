import { Injectable } from "@nestjs/common";
import { Prompt } from "@nestjs/mcp";
import * as z from "zod";

const userId = z
  .string()
  .min(1)
  .max(500)
  .describe("The user whose data this is about, such as user_42.");
const key = z.string().min(1).max(500).describe("The exact storage key, such as preferences.");

/** Rules every prompt repeats: the model must report what the server returned, nothing else. */
const ACCURACY = `Rules:
- Report only what the tools return. If a tool returns found=false, an empty list or an error, say so; never fill the gap with a guess.
- Quote keys, IDs, versions and timestamps exactly as returned.
- When a result has nextOffset, nextBefore or hasMore, say that more exists, and fetch it if the answer depends on it.`;

/** Message templates a person picks in the client; each drives the tools in a safe order. */
@Injectable()
export class PromptsMcp {
  @Prompt({
    name: "review-user-data",
    title: "Review a user's stored data",
    description: "Summarize what a user has stored, optionally under one key prefix.",
    argsSchema: z.object({
      userId,
      prefix: z
        .string()
        .max(500)
        .optional()
        .describe("Only keys that start with this text, such as cart/."),
    }),
  })
  reviewUserData({ userId, prefix }: { userId: string; prefix?: string }) {
    return `Review the data that user "${userId}" has stored in Sync Store${prefix ? ` under the key prefix "${prefix}"` : ""}.

1. Call describe-access to confirm that this API key may read.
2. Call list-keys with userId "${userId}"${prefix ? ` and prefix "${prefix}"` : ""}. Follow nextOffset until it is null.
3. Call get-item for the keys that matter. For more than 20 keys, read a representative sample and say which keys you did not read.
4. Summarize: how many keys exist, what each group of keys holds, and anything that looks inconsistent or stale (compare lastModified).

Do not change anything.

${ACCURACY}`;
  }

  @Prompt({
    name: "restore-previous-version",
    title: "Restore an earlier version of an item",
    description:
      "Find an earlier value of one key and restore it without overwriting a newer edit.",
    argsSchema: z.object({ userId, key }),
  })
  restorePreviousVersion({ userId, key }: { userId: string; key: string }) {
    return `Help me restore an earlier version of the key "${key}" for user "${userId}".

1. Call list-item-history with key "${key}" and userId "${userId}". Show me each revision: its revision ID, version, lastModified, whether it is a deletion, and a short description of its value.
2. Ask me which revision to restore. Do not choose for me.
3. Call preview-item-revision for that revision and show me the difference between it and the current value.
4. Only after I confirm, call restore-item-revision with the same key and revision and the expected field from step 3, unchanged.
5. If the restore is refused because the item changed, preview again and ask me again.

${ACCURACY}`;
  }

  @Prompt({
    name: "resolve-item-conflicts",
    title: "Resolve the conflicts of an item",
    description: "Inspect the write conflicts recorded for one key and propose a resolution.",
    argsSchema: z.object({ userId, key }),
  })
  resolveItemConflicts({ userId, key }: { userId: string; key: string }) {
    return `Help me resolve the write conflicts of the key "${key}" for user "${userId}".

1. Call get-item with key "${key}" and userId "${userId}" and note item.id and the current value.
2. Call list-item-conflicts with that item.id. If the list is empty, tell me there is nothing to resolve and stop.
3. For each conflict that is not resolved, explain its type and recommend one strategy: last_write_wins, first_write_wins or merge. Say why.
4. After I choose, call resolve-conflict. It records the resolution; it does not change the stored item.
5. Show me resolvedValue and ask whether to apply it. Only if I agree, write it with set-item.

${ACCURACY}`;
  }

  @Prompt({
    name: "investigate-sync-health",
    title: "Investigate synchronization health",
    description:
      "Check whether the installation is publishing changes and serving requests normally. Needs an administrator key.",
    argsSchema: z.object({
      hours: z
        .enum(["1", "24", "168", "720"])
        .describe("The window to inspect, in hours: 1, 24, 168 (7 days) or 720 (30 days)."),
    }),
  })
  investigateSyncHealth({ hours }: { hours: string }) {
    return `Investigate the health of this Sync Store installation over the last ${hours} hours.

1. Call admin-overview for the current state: database response time, connected sessions and record counts.
2. Call admin-report with report "health" and hours ${hours}: look at publish failures, publish latency and disconnections.
3. Call admin-report with report "usage" and hours ${hours}: look at HTTP errors, 429 responses and quota rejections per API key.
4. Call admin-report with report "changes" and hours ${hours}: look at the rate of writes and the growth of stored size.
5. Tell me what is normal, what is not, and what to check next. Separate what the reports show from what you infer.

Publication latency measures the time until the server published a change, not until a client received it. An interval without samples is missing data, not zero traffic.

Do not change anything.

${ACCURACY}`;
  }
}
