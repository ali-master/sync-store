import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Tool, type McpContext } from "@nestjs/mcp";
import * as z from "zod";
import {
  ConflictResolutionService,
  ConflictResolutionStrategy,
} from "../sync-storage/services/conflict-resolution.service";
import { json, McpAccess, who } from "./mcp-access";

type Target = { userId?: string; branch?: string };

/** The strategies that give the same result every time; `manual` and `ai_assisted` are not offered. */
const strategy = z
  .enum(["last_write_wins", "first_write_wins", "merge"])
  .describe(
    "last_write_wins keeps the newer value. first_write_wins keeps the original value. merge deep-merges two objects with the newer value winning on shared fields, joins two arrays without duplicates, and otherwise keeps the newer value.",
  );

/** Detected write conflicts of one user: what happened, and resolution proposals. */
@Injectable()
export class ConflictsMcp {
  constructor(
    private readonly access: McpAccess,
    private readonly conflicts: ConflictResolutionService,
  ) {}

  private authorize(ctx: McpContext, method: "GET" | "POST" | "PUT", path: string, target: Target) {
    return this.access.authorize(ctx, { method, path: "conflicts/" + path }, target);
  }

  @Tool({
    name: "list-item-conflicts",
    title: "List the conflicts of an item",
    description:
      "List the write conflicts recorded for one stored item of a user, newest first. itemId is the id field that get-item returns, not the key. An empty list means no conflict was recorded for that item. Needs a key without prefix restrictions.",
    inputSchema: z.object({
      itemId: z.string().min(1).max(500).describe("The item's id, from get-item's item.id."),
      ...who,
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  })
  async listItemConflicts({ itemId, ...target }: Target & { itemId: string }, ctx: McpContext) {
    const identity = await this.authorize(
      ctx,
      "GET",
      "history/" + encodeURIComponent(itemId),
      target,
    );
    const rows = await this.conflicts.getConflictHistory(itemId, identity.userId);
    return {
      itemId,
      total: rows.length,
      conflicts: rows.map((row: any) =>
        json({
          id: row.id,
          conflictType: row.conflictType,
          status: row.status,
          strategy: row.resolutionStrategy,
          confidence: row.confidence ?? null,
          reason: row.resolutionReason ?? null,
          createdAt: row.createdAt,
          resolvedAt: row.resolvedAt ?? null,
          humanReviewed: Boolean(row.humanReviewed),
        }),
      ),
    };
  }

  @Tool({
    name: "get-conflict-stats",
    title: "Count a user's conflicts",
    description:
      "Count the write conflicts recorded for a user in a time range: total, resolved, pending, and a count per conflict type. Defaults to the last 30 days. Needs a key without prefix restrictions.",
    inputSchema: z.object({
      startDate: z.iso
        .datetime({ offset: true })
        .optional()
        .describe("Start of the range, such as 2026-11-01T00:00:00Z. Default: 30 days ago."),
      endDate: z.iso
        .datetime({ offset: true })
        .optional()
        .describe("End of the range, such as 2026-11-11T00:00:00Z. Default: now."),
      ...who,
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  })
  async getConflictStats(
    { startDate, endDate, ...target }: Target & { startDate?: string; endDate?: string },
    ctx: McpContext,
  ) {
    const identity = await this.authorize(ctx, "GET", "stats", target);
    const range = {
      start: startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86_400_000),
      end: endDate ? new Date(endDate) : new Date(),
    };
    if (range.start >= range.end) throw new BadRequestException("startDate must be before endDate");
    const stats = await this.conflicts.getUserConflictStats(identity.userId, range);
    return json({
      timeRange: range,
      totalConflicts: stats.totalConflicts,
      resolvedConflicts: stats.resolvedConflicts,
      pendingConflicts: stats.pendingConflicts,
      resolvedShare: stats.autoResolutionRate,
      conflictsByType: stats.conflictsByType,
    });
  }

  @Tool({
    name: "analyze-conflict",
    title: "Check whether a write would conflict",
    description:
      "Check, without writing anything, whether storing a new value under a key would be recorded as a conflict with the current value: a version mismatch, an edit by another device in the last five seconds, or a change of the value's shape. hasConflict=false means the write would not be flagged at this moment.",
    inputSchema: z.object({
      key: z.string().min(1).max(500).describe("The exact storage key, such as preferences."),
      newValue: z
        .unknown()
        .describe('The value you intend to store: any JSON value, such as {"theme":"dark"}.'),
      expectedVersion: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "The item version you last read, from get-item's item.version. Omit it to skip the version check.",
        ),
      ...who,
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  })
  async analyzeConflict(
    {
      key,
      newValue,
      expectedVersion,
      ...target
    }: Target & { key: string; newValue?: unknown; expectedVersion?: number },
    ctx: McpContext,
  ) {
    if (newValue === undefined) throw new BadRequestException("newValue is required");
    // REST uses POST only to carry the candidate value; nothing is written, so reading is enough.
    const identity = await this.authorize(ctx, "GET", "analyze", target);
    const detection = await this.conflicts.detectConflict(
      identity.userId,
      key,
      JSON.stringify(newValue),
      (expectedVersion ?? 0) + 1,
      expectedVersion,
      identity.instanceId,
    );
    if (!detection.hasConflict) return { hasConflict: false };
    const analysis = this.conflicts.analyzeConflict(detection.conflictData);
    return json({
      hasConflict: true,
      conflictType: analysis.conflictType,
      severity: analysis.severity,
      autoResolvable: analysis.autoResolvable,
      recommendedStrategy: analysis.recommendedStrategy,
      details: detection.conflictData,
    });
  }

  @Tool({
    name: "resolve-conflict",
    title: "Record a resolution for a conflict",
    description:
      "Compute the value a strategy produces for one recorded conflict and save it on the conflict record as its resolution. This does NOT change the stored item: to apply resolvedValue, write it with set-item. Needs a key with write permission and no prefix restrictions.",
    inputSchema: z.object({
      conflictId: z.string().min(1).max(500).describe("A conflict ID from list-item-conflicts."),
      strategy,
      ...who,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  })
  async resolveConflict(
    {
      conflictId,
      strategy,
      ...target
    }: Target & { conflictId: string; strategy: "last_write_wins" | "first_write_wins" | "merge" },
    ctx: McpContext,
  ) {
    const identity = await this.authorize(
      ctx,
      "PUT",
      "resolve/" + encodeURIComponent(conflictId),
      target,
    );
    const result = await this.conflicts
      .resolveConflictById(conflictId, identity.userId, strategy as ConflictResolutionStrategy, {
        userReview: true,
      })
      .catch((error: unknown) => {
        // The service reports a missing record with a plain Error.
        if (error instanceof Error && error.message.includes("not found"))
          throw new NotFoundException(`Conflict ${conflictId} not found for this user`);
        throw error;
      });
    return json({
      conflictId,
      appliedToStoredItem: false,
      strategy: result.strategy,
      confidence: result.confidence ?? null,
      reason: result.reason ?? null,
      requiresReview: Boolean(result.needsManualResolution),
      resolvedValue: result.value,
    });
  }
}
