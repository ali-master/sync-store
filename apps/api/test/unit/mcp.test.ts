import "reflect-metadata";
import { expect, test } from "bun:test";
import { Module, NotFoundException, VersioningType } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { McpRegistry } from "@nestjs/mcp";
import { connectMcpClient } from "@nestjs/mcp/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Client } from "@modelcontextprotocol/client";
import { AdminService } from "../../src/domains/admin/admin.service";
import { OperationsService } from "../../src/domains/analytics/operations.service";
import { AdminMcp } from "../../src/domains/mcp/admin.mcp";
import { ConflictsMcp } from "../../src/domains/mcp/conflicts.mcp";
import { McpAccess, publicItem } from "../../src/domains/mcp/mcp-access";
import { PromptsMcp } from "../../src/domains/mcp/prompts.mcp";
import { StorageMcp } from "../../src/domains/mcp/storage.mcp";
import { syncStoreMcp } from "../../src/domains/mcp/sync-store-mcp.module";
import { VersioningMcp } from "../../src/domains/mcp/versioning.mcp";
import { ClearStorageCommand } from "../../src/domains/sync-storage/commands/impl/clear-storage.command";
import { RemoveItemCommand } from "../../src/domains/sync-storage/commands/impl/remove-item.command";
import { SetItemCommand } from "../../src/domains/sync-storage/commands/impl/set-item.command";
import { StorageItem } from "../../src/domains/sync-storage/entities/storage-item.entity";
import { ApiKeyGuard } from "../../src/domains/sync-storage/guards/api-key.guard";
import { GetItemQuery } from "../../src/domains/sync-storage/queries/impl/get-item.query";
import { GetKeysQuery } from "../../src/domains/sync-storage/queries/impl/get-keys.query";
import { SyncStorageRepository } from "../../src/domains/sync-storage/repositories/sync-storage.repository";
import { ConflictResolutionService } from "../../src/domains/sync-storage/services/conflict-resolution.service";
import { VersioningService } from "../../src/domains/sync-storage/services/versioning.service";
import { GlobalExceptionFilter } from "../../src/filters/http-exception.filter";

/** Real API-key authorization over stored key records; only the database is modelled. */
const methods = '["GET","POST","PUT","PATCH","DELETE"]';
const keys: Record<string, any> = {
  "app-key": { id: "app", name: "App", isActive: true, canRead: true, canWrite: true },
  "read-key": { id: "reader", name: "Reader", isActive: true, canRead: true, canWrite: false },
  "cart-key": {
    id: "cart",
    name: "Cart only",
    isActive: true,
    canRead: true,
    canWrite: true,
    metadata: JSON.stringify({
      access: { projectId: "default", readPrefixes: ["cart/"], writePrefixes: ["cart/"] },
    }),
  },
  "admin-key": {
    id: "admin",
    name: "Administrator",
    isActive: true,
    canRead: true,
    canWrite: true,
    scopes: '["admin"]',
  },
};
for (const [key, record] of Object.entries(keys))
  Object.assign(record, { key, allowedMethods: methods });
let charged = 0;
const database = {
  orm: {
    api_keys: { where: (filter: any) => ({ first: async () => keys[filter.key] ?? null }) },
    tenants: { where: () => ({ first: async () => null }) },
    version_branches: { where: () => ({ first: async () => null }) },
  },
  native: {
    collection: () => ({
      updateOne: async () => {
        charged++;
        return { matchedCount: 1 };
      },
    }),
  },
};

/** An in-memory store behind the same commands and queries the REST controllers dispatch. */
const store = new Map<string, Map<string, StorageItem>>();
const items = (userId: string) => store.get(userId) ?? store.set(userId, new Map()).get(userId)!;
const commands = {
  async execute(command: any) {
    if (command instanceof SetItemCommand) {
      const version = (items(command.userId).get(command.key)?.version ?? 0) + 1;
      const item = new StorageItem({
        id: `${command.userId}/${command.key}`,
        userId: command.userId,
        instanceId: command.instanceId,
        key: command.key,
        value: command.value,
        metadata: command.metadata,
        version,
        timestamp: 1_700_000_000_000 + version,
        lastModified: new Date(1_700_000_000_000 + version),
      });
      items(command.userId).set(command.key, item);
      return item;
    }
    if (command instanceof RemoveItemCommand) items(command.userId).delete(command.key);
    if (command instanceof ClearStorageCommand) items(command.userId).clear();
  },
};
const queries = {
  async execute(query: any) {
    const all = [...items(query.userId).values()].filter(
      (item) => !query.prefix || item.key.startsWith(query.prefix),
    );
    if (query instanceof GetItemQuery) return items(query.userId).get(query.key) ?? null;
    if (query instanceof GetKeysQuery) return all.map((item) => item.key).sort();
    return all;
  },
};
const repository = {
  findByKey: async (userId: string, key: string) => items(userId).get(key) ?? null,
  count: async (userId: string) => items(userId).size,
  history: async (_user: string, key: string) =>
    key === "long"
      ? Array.from({ length: 50 }, (_, index) => ({
          _id: "long:" + (50 - index),
          version: 50 - index,
        }))
      : [
          {
            _id: "rec:2",
            userId: "internal-identity",
            key,
            value: '{"theme":"dark"}',
            metadata: null,
            version: 2,
            isDeleted: false,
            lastModified: new Date(1_700_000_000_000),
            instanceId: "browser",
            expiresAt: new Date(1_800_000_000_000),
          },
        ],
  preview: async (_user: string, _key: string, revision: string) => {
    if (revision !== "rec:2") throw new NotFoundException("Retained version not found");
    return {
      snapshot: { _id: "rec:2", version: 2, value: '{"theme":"dark"}', isDeleted: false },
      current: {
        id: "rec",
        version: 3n,
        value: '{"theme":"light"}',
        metadata: null,
        isDeleted: false,
      },
    };
  },
  restore: async (...args: unknown[]) => ({
    restored: true,
    item: { id: "rec", key: args[2], value: args },
  }),
};
const versions = {
  branches: async () => [{ owner: "internal", name: "main", head: null }],
  commits: async () => [
    { id: "c1", branch: "main", parent: null, message: "First", createdAt: new Date(0) },
  ],
  commit: async (_user: string, id: string) => {
    if (id !== "c1") throw new NotFoundException("Commit not found");
    return {
      id,
      owner: "internal",
      branch: "main",
      parent: null,
      message: "First",
      createdAt: new Date(0),
      tree: { a: "blob" },
    };
  },
  timeline: async () => [],
  checkpoint: async (_user: string, body: any, requestId?: string) => ({
    id: "c2",
    ...body,
    requestId,
  }),
  fork: async (_user: string, body: any) => ({ name: body.name, head: body.commitId }),
  restore: async (_user: string, id: string) => ({ id: "c3", restored: id }),
};
const conflicts = {
  getConflictHistory: async () => [],
  getUserConflictStats: async () => ({
    totalConflicts: 2,
    resolvedConflicts: 1,
    pendingConflicts: 1,
    autoResolutionRate: 0.5,
    conflictsByType: { version_mismatch: 2 },
  }),
  detectConflict: async () => ({ hasConflict: false }),
  resolveConflictById: async (id: string) => {
    throw new Error(`Conflict ${id} not found`);
  },
};
const audits: string[] = [];
const admin = {
  tenant: async () => null,
  overview: async (actor: string) => ({
    actor,
    users: 3,
    storageBytes: 12n,
    timestamp: new Date(0),
  }),
  list: async (resource: string, query: Record<string, string>) => ({
    items: [{ _id: "one", query }],
    total: 60,
    page: Number(query.page),
    pageSize: 25,
    resource,
  }),
  createKey: async (body: any) => ({ id: "new", key: "ss_new", body }),
  versionUser: async (body: any) => "resolved:" + body.userId,
  audit: async (_actor: string, action: string, target: string) =>
    void audits.push(action + " " + target),
};
const operations = {
  health: async (query: any, tenant: unknown) => ({ query, tenant, series: [] }),
};

@Module({
  providers: [
    McpAccess,
    StorageMcp,
    VersioningMcp,
    ConflictsMcp,
    AdminMcp,
    PromptsMcp,
    { provide: ApiKeyGuard, useFactory: () => new ApiKeyGuard(database as any) },
    { provide: CommandBus, useValue: commands },
    { provide: QueryBus, useValue: queries },
    { provide: SyncStorageRepository, useValue: repository },
    { provide: VersioningService, useValue: versions },
    { provide: ConflictResolutionService, useValue: conflicts },
    { provide: AdminService, useValue: admin },
    { provide: OperationsService, useValue: operations },
  ],
  exports: [McpAccess],
})
class Primitives {}

/**
 * Set up at module level: under Bun 1.4 a beforeAll that boots the application was seen to time out
 * although its work had finished.
 */
const moduleRef: TestingModule = await Test.createTestingModule({
  imports: [Primitives, syncStoreMcp(Primitives)],
}).compile();
// The route is configured as main.ts configures it.
const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
app.setGlobalPrefix("api", { exclude: ["mcp"] });
app.useGlobalFilters(new GlobalExceptionFilter());
app.enableCors({ origin: "*" });
await app.listen(0, "127.0.0.1");
const origin = await app.getUrl();

const clients: Client[] = [];
async function connect(headers: Record<string, string>, era: "modern" | "legacy" = "modern") {
  const client = await connectMcpClient(moduleRef, { headers, era });
  clients.push(client);
  return client;
}
const text = (result: any) => (result.content as { text: string }[])[0].text;

test("every tool is described for the model and says whether it changes anything", async () => {
  const registry = moduleRef.get(McpRegistry);
  expect(registry.tools).toHaveLength(39);
  for (const tool of registry.tools) {
    expect(tool.options.description!.length, tool.name).toBeGreaterThan(60);
    expect(tool.options.title, tool.name).toBeTruthy();
    expect(typeof tool.options.annotations?.readOnlyHint, tool.name).toBe("boolean");
    expect(tool.inputSchema, tool.name).toBeTruthy();
    if (tool.name.startsWith("admin-"))
      expect(tool.options.description, tool.name).toContain("administrator key");
  }
  const readOnly = registry.tools.filter((tool) => tool.options.annotations?.readOnlyHint);
  expect(readOnly.map((tool) => tool.name)).toEqual(
    expect.arrayContaining(["get-item", "list-keys", "describe-access", "admin-overview"]),
  );
  expect(readOnly.map((tool) => tool.name)).not.toContain("set-item");
  expect(registry.prompts).toHaveLength(4);
  expect(registry.resources).toHaveLength(1);
  expect(registry.resourceTemplates).toHaveLength(3);
});

test("a client discovers tools, resources and prompts with their schemas", async () => {
  const client = await connect({ "x-api-key": "app-key", "x-user-id": "alice" });
  const { tools } = await client.listTools();
  const setItem = tools.find((tool) => tool.name === "set-item")!;
  expect(setItem.inputSchema.required).toEqual(expect.arrayContaining(["key"]));
  expect((setItem.inputSchema.properties as any).key.description).toContain("case-sensitive");
  expect(tools.find((tool) => tool.name === "get-item")!.outputSchema).toBeTruthy();
  expect((await client.listResources()).resources.map((entry) => entry.uri)).toEqual([
    "sync-store://guide",
  ]);
  expect(
    (await client.listResourceTemplates()).resourceTemplates.map((entry) => entry.uriTemplate),
  ).toEqual(
    expect.arrayContaining(["sync-store://items/{+key}", "sync-store://commits/{commitId}"]),
  );
  expect((await client.listPrompts()).prompts.map((prompt) => prompt.name)).toContain(
    "restore-previous-version",
  );
  expect(client.getInstructions()).toContain("describe-access");
});

test("items round-trip with exact values, paging and an honest not-found", async () => {
  const client = await connect({ "x-api-key": "app-key", "x-user-id": "alice" });
  const before = charged;
  const value = { theme: "dark", sizes: [1, 2.5], nested: { on: true, none: null } };
  const stored = await client.callTool({
    name: "set-item",
    arguments: { key: "preferences", value, metadata: { source: "test" } },
  });
  expect(stored.isError).toBeFalsy();
  expect((stored.structuredContent as any).item).toMatchObject({
    key: "preferences",
    value,
    metadata: { source: "test" },
    version: 1,
  });
  // The internal storage identity never leaves the server.
  expect(JSON.stringify(stored)).not.toContain("userId");

  const read = await client.callTool({ name: "get-item", arguments: { key: "preferences" } });
  expect(read.structuredContent).toMatchObject({ found: true, item: { value, version: 1 } });
  expect(JSON.parse(text(read))).toEqual(read.structuredContent);

  const missing = await client.callTool({ name: "get-item", arguments: { key: "Preferences" } });
  expect(missing.isError).toBeFalsy();
  expect(missing.structuredContent).toEqual({ found: false, item: null });

  for (const key of ["a", "b", "c"])
    await client.callTool({ name: "set-item", arguments: { key, value: null } });
  const first = await client.callTool({ name: "list-keys", arguments: { limit: 3 } });
  expect(first.structuredContent).toEqual({
    total: 4,
    offset: 0,
    returned: 3,
    nextOffset: 3,
    items: ["a", "b", "c"],
  });
  const last = await client.callTool({ name: "list-keys", arguments: { limit: 3, offset: 3 } });
  expect(last.structuredContent).toMatchObject({ returned: 1, nextOffset: null });
  expect(
    (
      (await client.callTool({ name: "list-items", arguments: { prefix: "pref" } }))
        .structuredContent as any
    ).items,
  ).toHaveLength(1);

  expect(
    (await client.callTool({ name: "remove-item", arguments: { key: "a" } })).structuredContent,
  ).toEqual({ key: "a", existed: true });
  expect(
    (await client.callTool({ name: "remove-item", arguments: { key: "a" } })).structuredContent,
  ).toEqual({ key: "a", existed: false });
  expect(
    (await client.callTool({ name: "clear-storage", arguments: {} })).structuredContent,
  ).toEqual({
    itemsBefore: 3,
  });
  // Every call is charged to the key's quota exactly once.
  expect(charged - before).toBe(12);
});

test("arguments the schema refuses never reach the store", async () => {
  const client = await connect({ "x-api-key": "app-key", "x-user-id": "alice" });
  const before = charged;
  for (const bad of [
    { name: "get-item", arguments: {} },
    { name: "get-item", arguments: { key: "" } },
    { name: "list-keys", arguments: { limit: 1000 } },
    { name: "set-item", arguments: { key: "k", value: 1, requestId: "has spaces" } },
    { name: "set-item", arguments: { key: "k" } },
    { name: "restore-item-revision", arguments: { key: "k", revision: "r" } },
    { name: "admin-report", arguments: { report: "health", hours: 5 } },
  ]) {
    const result = await client.callTool(bad);
    expect(result.isError, JSON.stringify(bad)).toBe(true);
    expect(text(result), JSON.stringify(bad)).toContain("Input validation error");
  }
  expect(charged).toBe(before);
});

test("a key's permissions, prefixes and scope decide each call, as they do over REST", async () => {
  const reader = await connect({ "x-api-key": "read-key", "x-user-id": "alice" });
  const denied = await reader.callTool({ name: "set-item", arguments: { key: "k", value: 1 } });
  expect(denied.isError).toBe(true);
  expect(text(denied)).toBe("Write permission is required");
  expect((await reader.callTool({ name: "list-keys", arguments: {} })).isError).toBeFalsy();
  expect(
    (await reader.callTool({ name: "describe-access", arguments: {} })).structuredContent,
  ).toMatchObject({
    keyName: "Reader",
    canRead: true,
    canWrite: false,
    isAdministrator: false,
    projectId: "default",
    defaultUserId: "alice",
    defaultBranch: "main",
  });

  const cart = await connect({ "x-api-key": "cart-key", "x-user-id": "bob" });
  await cart.callTool({ name: "set-item", arguments: { key: "cart/items", value: [1] } });
  const outside = await cart.callTool({
    name: "set-item",
    arguments: { key: "profile", value: 1 },
  });
  expect(text(outside)).toContain("outside this API key's permitted prefixes");
  expect(text(await cart.callTool({ name: "get-item", arguments: { key: "profile" } }))).toContain(
    "permitted prefixes",
  );
  expect(text(await cart.callTool({ name: "clear-storage", arguments: {} }))).toContain(
    "unrestricted write access",
  );
  expect(text(await cart.callTool({ name: "list-branches", arguments: {} }))).toContain(
    "Versioning requires unrestricted",
  );
  expect(items("bob").has("profile")).toBe(false);
  expect(items("bob").has("cart/items")).toBe(true);

  const refused = await reader.callTool({ name: "admin-overview", arguments: {} });
  expect(refused.isError).toBe(true);
  expect(text(refused)).toBe("Required API key scope: admin");
});

test("calls name their user, and credentials other than an API key are refused", async () => {
  const anonymous = await connect({ authorization: "Bearer app-key" });
  const whose = await anonymous.callTool({ name: "list-keys", arguments: {} });
  expect(whose.isError).toBe(true);
  expect(text(whose)).toContain("Pass userId");
  await anonymous.callTool({
    name: "set-item",
    arguments: { key: "k", value: 1, userId: "carol" },
  });
  expect(items("carol").get("k")?.value).toBe(1);
  expect(items("carol").get("k")?.instanceId).toBe("mcp");
  // A branch is part of the storage identity.
  const branch = await anonymous.callTool({
    name: "get-item",
    arguments: { key: "k", userId: "carol", branch: "drafts" },
  });
  expect(text(branch)).toBe("Branch does not exist");

  for (const headers of [
    {},
    { "x-api-key": "unknown" },
    { "x-api-key": "ss_session.abc.def" },
    { authorization: "Bearer ss_sso.abc.def" },
  ] as Record<string, string>[]) {
    const client = await connect({ ...headers, "x-user-id": "alice" });
    const result = await client.callTool({ name: "list-keys", arguments: {} });
    expect(result.isError, JSON.stringify(headers)).toBe(true);
    expect(text(result), JSON.stringify(headers)).toMatch(/API key|session tokens/);
  }
});

test("history, versioning and conflict tools return parsed, JSON-safe results", async () => {
  const client = await connect({ "x-api-key": "app-key", "x-user-id": "alice" });
  const history = JSON.parse(
    text(await client.callTool({ name: "list-item-history", arguments: { key: "preferences" } })),
  );
  expect(history).toMatchObject({
    returned: 1,
    nextBefore: null,
    revisions: [{ revision: "rec:2", version: 2, value: { theme: "dark" }, isDeleted: false }],
  });
  expect(JSON.stringify(history)).not.toContain("internal-identity");
  const long = JSON.parse(
    text(await client.callTool({ name: "list-item-history", arguments: { key: "long" } })),
  );
  expect(long.nextBefore).toBe("long:1");

  const preview = JSON.parse(
    text(
      await client.callTool({
        name: "preview-item-revision",
        arguments: { key: "preferences", revision: "rec:2" },
      }),
    ),
  );
  // A 64-bit version from MongoDB becomes the integer that restore requires.
  expect(preview.expected).toEqual({ id: "rec", version: 3 });
  expect(preview.current.value).toEqual({ theme: "light" });
  const restored = JSON.parse(
    text(
      await client.callTool({
        name: "restore-item-revision",
        arguments: { key: "preferences", revision: "rec:2", expected: preview.expected },
      }),
    ),
  );
  expect(restored).toMatchObject({
    restored: true,
    isDeleted: false,
    item: { key: "preferences" },
  });
  const gone = await client.callTool({
    name: "preview-item-revision",
    arguments: { key: "preferences", revision: "missing" },
  });
  expect(gone.isError).toBe(true);
  expect(text(gone)).toBe("Retained version not found");

  const branches = JSON.parse(
    text(await client.callTool({ name: "list-branches", arguments: {} })),
  );
  expect(branches).toEqual({ branches: [{ name: "main", head: null, createdAt: null }] });
  const commit = JSON.parse(
    text(await client.callTool({ name: "get-commit", arguments: { commitId: "c1" } })),
  );
  expect(commit).toMatchObject({ id: "c1", keyCount: 1, createdAt: "1970-01-01T00:00:00.000Z" });
  expect(commit.owner).toBeUndefined();
  const created = JSON.parse(
    text(
      await client.callTool({
        name: "create-commit",
        arguments: { message: "Snapshot", expectedHead: null, requestId: "req-1" },
      }),
    ),
  );
  expect(created).toEqual({
    id: "c2",
    message: "Snapshot",
    expectedHead: null,
    requestId: "req-1",
  });
  expect(
    (await client.callTool({ name: "create-commit", arguments: { message: "No head" } })).isError,
  ).toBe(true);

  const stats = JSON.parse(
    text(await client.callTool({ name: "get-conflict-stats", arguments: {} })),
  );
  expect(stats).toMatchObject({ totalConflicts: 2, pendingConflicts: 1, resolvedShare: 0.5 });
  const unknown = await client.callTool({
    name: "resolve-conflict",
    arguments: { conflictId: "nope", strategy: "merge" },
  });
  expect(text(unknown)).toBe("Conflict nope not found for this user");
  const manual = await client.callTool({
    name: "resolve-conflict",
    arguments: { conflictId: "nope", strategy: "ai_assisted" },
  });
  expect(text(manual)).toContain("Input validation error");
});

test("administrator tools act as the key and keep filters honest", async () => {
  const client = await connect({ "x-api-key": "admin-key" });
  const overview = JSON.parse(
    text(await client.callTool({ name: "admin-overview", arguments: {} })),
  );
  expect(overview).toEqual({
    actor: "admin",
    users: 3,
    storageBytes: "12",
    timestamp: "1970-01-01T00:00:00.000Z",
  });
  const records = JSON.parse(
    text(
      await client.callTool({
        name: "admin-list-records",
        arguments: {
          resource: "storage",
          page: 2,
          search: "cart",
          userId: "u1",
          projectId: "shop",
        },
      }),
    ),
  );
  expect(records).toMatchObject({ total: 60, page: 2, pageSize: 25, hasMore: true });
  expect(records.items[0].query).toEqual({
    page: "2",
    q: "cart",
    scopeUser: "u1",
    projectId: "shop",
  });
  const wrongFilter = await client.callTool({
    name: "admin-list-records",
    arguments: { resource: "keys", userId: "u1" },
  });
  expect(text(wrongFilter)).toContain("userId cannot filter keys");

  const report = JSON.parse(
    text(
      await client.callTool({ name: "admin-report", arguments: { report: "health", hours: 168 } }),
    ),
  );
  expect(report).toEqual({ query: { hours: "168" }, tenant: null, series: [] });
  const key = JSON.parse(
    text(
      await client.callTool({
        name: "admin-create-key",
        arguments: { name: "Web", canWrite: true },
      }),
    ),
  );
  expect(key).toEqual({ id: "new", key: "ss_new", body: { name: "Web", canWrite: true } });

  const action = JSON.parse(
    text(
      await client.callTool({
        name: "admin-versioning-action",
        arguments: { action: "fork", userId: "u1", name: "drafts", commitId: "c1" },
      }),
    ),
  );
  expect(action).toEqual({ action: "fork", result: { name: "drafts", head: "c1" } });
  expect(audits).toContain("admin.versioning.fork resolved:u1");
  const incomplete = await client.callTool({
    name: "admin-versioning-action",
    arguments: { action: "commit", userId: "u1", message: "m" },
  });
  expect(text(incomplete)).toContain("expectedHead is required");
});

test("resources and prompts are served, and a missing resource is an error", async () => {
  const client = await connect({ "x-api-key": "app-key", "x-user-id": "dana" });
  const guide = await client.readResource({ uri: "sync-store://guide" });
  expect((guide.contents[0] as { text: string }).text).toContain("describe-access");
  await client.callTool({ name: "set-item", arguments: { key: "cart/items", value: [1, 2] } });
  const item = await client.readResource({ uri: "sync-store://items/cart/items" });
  expect(JSON.parse((item.contents[0] as { text: string }).text)).toMatchObject({
    key: "cart/items",
    value: [1, 2],
  });
  await expect(client.readResource({ uri: "sync-store://items/none" })).rejects.toThrow();
  const keysOf = await client.readResource({ uri: "sync-store://keys/dana" });
  expect(JSON.parse((keysOf.contents[0] as { text: string }).text)).toEqual({
    userId: "dana",
    branch: "main",
    keys: ["cart/items"],
  });
  const commit = await client.readResource({ uri: "sync-store://commits/c1" });
  expect(JSON.parse((commit.contents[0] as { text: string }).text).id).toBe("c1");
  await expect(
    (await connect({})).readResource({ uri: "sync-store://items/cart/items" }),
  ).rejects.toThrow();

  const prompt = await client.getPrompt({
    name: "restore-previous-version",
    arguments: { userId: "dana", key: "cart/items" },
  });
  expect((prompt.messages[0].content as { text: string }).text).toContain(
    "restore-item-revision with the same key and revision and the expected field",
  );
  await expect(
    client.getPrompt({ name: "investigate-sync-health", arguments: { hours: "5" } }),
  ).rejects.toThrow();
});

test("clients of the 2025 protocol revisions are served too", async () => {
  const legacy = await connect({ "x-api-key": "app-key", "x-user-id": "erin" }, "legacy");
  const result = await legacy.callTool({ name: "set-item", arguments: { key: "k", value: "v" } });
  expect((result.structuredContent as any).item.value).toBe("v");
});

/** The route itself, over a socket: its path, and the API key checked before any MCP message is read. */
async function post(path: string, headers: Record<string, string> = {}, body?: object) {
  const response = await fetch(origin + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body ?? { jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  return { statusCode: response.status, body: await response.text(), headers: response.headers };
}

/**
 * Under Bun 1.4 the promise of a test that calls a server in its own process was seen never to
 * settle, although every request had completed; a done callback is honoured.
 */
const settled = (run: () => Promise<void>) => (done: (error?: unknown) => void) =>
  void run().then(() => done(), done);

test(
  "the endpoint is /mcp on the API origin and refuses a request without a valid API key",
  settled(async () => {
    const before = charged;
    for (const headers of [
      {},
      { "x-api-key": "unknown" },
      { authorization: "Bearer ss_sso.a.b" },
    ]) {
      const response = await post("/mcp", headers);
      expect(response.statusCode, JSON.stringify(headers)).toBe(401);
      expect(response.body).not.toContain("get-item");
    }
    expect((await post("/api/v1/mcp", { "x-api-key": "app-key" })).statusCode).toBe(404);
    expect((await post("/api/mcp", { "x-api-key": "app-key" })).statusCode).toBe(404);

    const listed = await post("/mcp", { "x-api-key": "app-key" });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).toContain("get-item");
    expect((await post("/mcp?api_key=app-key")).statusCode).toBe(200);
    // A browser client on another origin passes the Origin check and can read the response.
    const browser = await post("/mcp", { "x-api-key": "app-key", origin: "https://app.example" });
    expect(browser.statusCode).toBe(200);
    expect(browser.headers.get("access-control-allow-origin")).toBe("*");
    // Authenticating the transport request charges nothing; calls are charged one by one.
    expect(charged).toBe(before);

    const called = await post(
      "/mcp",
      { authorization: "Bearer app-key", "x-user-id": "frank" },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "set-item", arguments: { key: "over-http", value: { ok: true } } },
      },
    );
    expect(called.statusCode).toBe(200);
    expect(called.body).toContain("over-http");
    expect(items("frank").get("over-http")?.value).toEqual({ ok: true });
    expect(charged).toBe(before + 1);
  }),
);

test("the global exception filter leaves MCP errors to the MCP module", async () => {
  const error = new NotFoundException("No such item");
  expect(() => new GlobalExceptionFilter().catch(error, { getType: () => "mcp" } as any)).toThrow(
    error,
  );
});

test(
  "clients and the application close cleanly",
  settled(async () => {
    for (const client of clients) await client.close();
    await app.close();
  }),
);

test("public items never carry the internal storage identity", async () => {
  expect(
    publicItem({
      _id: "id",
      userId: "tenant:a:u",
      instanceId: "i",
      key: "k",
      value: 1n,
      version: 2,
    }),
  ).toEqual({
    id: "id",
    key: "k",
    value: "1",
    metadata: null,
    version: 2,
    timestamp: undefined,
    lastModified: undefined,
  });
});
