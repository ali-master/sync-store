import { Module, type Type, UseGuards, VERSION_NEUTRAL } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";
import { McpModule } from "@nestjs/mcp";
import { ApiExcludeController } from "@nestjs/swagger";
import { AdminModule } from "../admin/admin.module";
import { SyncStorageModule } from "../sync-storage/sync-storage.module";
import { AdminMcp } from "./admin.mcp";
import { ConflictsMcp } from "./conflicts.mcp";
import { McpAccess, McpKeyGuard } from "./mcp-access";
import { PromptsMcp } from "./prompts.mcp";
import { StorageMcp } from "./storage.mcp";
import { VersioningMcp } from "./versioning.mcp";

/** The tools, resources and prompts of the MCP server, and the API-key access they share. */
@Module({
  imports: [CqrsModule, SyncStorageModule, AdminModule],
  providers: [McpAccess, StorageMcp, VersioningMcp, ConflictsMcp, AdminMcp, PromptsMcp],
  exports: [McpAccess],
})
export class SyncStoreMcpModule {}

const INSTRUCTIONS = `Sync Store keeps JSON values per user and synchronizes them to that user's devices.
Call describe-access first to learn what this API key may do.
Every data tool acts for one user: pass userId unless the client sends the x-user-id header.
Find keys with list-keys before get-item; a key that does not exist returns found=false, never a guess.
set-item replaces a whole value: read the current value first when you change part of it.
Lists are paged: nextOffset, nextBefore or hasMore tell you that more exists.
Ask the user to confirm before clear-storage, restore-commit, admin-rotate-key and other destructive tools.
Tools named admin-* need an administrator key. Never repeat an API key secret after showing it once.
Report exactly what the tools return, including errors.`;

/**
 * The Model Context Protocol server, at /mcp on the API origin: outside the `api` prefix and the URI
 * version, authenticated by API key on the route and again on every call.
 */
export function syncStoreMcp(primitives: Type<unknown> = SyncStoreMcpModule) {
  return McpModule.forRootAsync({
    imports: [primitives],
    path: "mcp",
    endpointVersion: VERSION_NEUTRAL,
    // The route speaks JSON-RPC, so it is left out of the REST reference.
    decorators: [UseGuards(McpKeyGuard), ApiExcludeController()],
    useFactory: () => {
      return {
        name: "sync-store",
        title: "Sync Store",
        version: process.env.npm_package_version ?? "1.0.0",
        description:
          "Read, write, version and administer the data of a Sync Store installation, with the permissions of an API key.",
        websiteUrl: "https://github.com/ali-master/sync-store",
        instructions: INSTRUCTIONS,
        include: [primitives],
        // McpKeyGuard checks the Origin against the CORS setting on every request instead, so a
        // change in the dashboard applies without a restart.
        http: { allowedOrigins: false },
      };
    },
  });
}
