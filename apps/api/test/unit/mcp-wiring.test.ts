import "reflect-metadata";
import { expect, test } from "bun:test";

/** Compile the real application graph; nothing connects until the application initializes. */
Object.assign(process.env, {
  DATABASE_URL: "mongodb://127.0.0.1:1/unused",
  JWT_SECRET: "j".repeat(40),
  CSRF_SECRET: "c".repeat(40),
  API_URL: "http://localhost:3000",
});
const { Test } = await import("@nestjs/testing");
const { McpRegistry } = await import("@nestjs/mcp");
const { AppModule } = await import("../../src/app.module");
const { StorageMcp } = await import("../../src/domains/mcp/storage.mcp");
const { SyncStorageController } =
  await import("../../src/domains/sync-storage/controllers/sync-storage.controller");
const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

test("the application wires the MCP server to the services REST uses", async () => {
  const registry = moduleRef.get(McpRegistry, { strict: false });
  // Scanning fails on duplicate names, invalid schemas and request-scoped providers.
  registry.scan();
  expect(registry.tools).toHaveLength(39);
  expect(registry.resources).toHaveLength(1);
  expect(registry.resourceTemplates).toHaveLength(3);
  expect(registry.prompts).toHaveLength(4);
  // MCP writes dispatch on the bus whose handlers publish synchronization events.
  const mcp = moduleRef.get(StorageMcp, { strict: false }) as any;
  const rest = moduleRef.get(SyncStorageController, { strict: false }) as any;
  expect(mcp.commands).toBe(rest.commandBus);
  expect(mcp.queries).toBe(rest.queryBus);
});
