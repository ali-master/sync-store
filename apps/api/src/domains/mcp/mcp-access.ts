import {
  BadRequestException,
  ForbiddenException,
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { McpContext } from "@nestjs/mcp";
import * as z from "zod";
import { originAllowed } from "../../cors";
import { publicDocument } from "../admin/admin.service";
import { ApiKeyGuard } from "../sync-storage/guards/api-key.guard";
import type { AccessPolicy } from "../sync-storage/services/access-policy";

/** The REST request a call is equivalent to; authorization applies the rules of that request. */
export interface McpOperation {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path under /api/v1, such as `item/theme` or `versioning/commits`. */
  path: string;
  /** The storage key the call touches, checked against the API key's prefixes and patterns. */
  key?: string;
  /** `admin` for calls only an administrator key may make. */
  scope?: "admin";
  /** The call is about the key itself, not a user's data: no user needs to be named. */
  anonymous?: true;
}

export interface McpIdentity {
  /** The server-side storage identity: tenant, project and branch are already applied. */
  userId: string;
  instanceId: string;
  apiKey: { id: string; tenantId?: string | null };
  access: AccessPolicy;
}

/** Arguments every data tool accepts to say whose data, and which branch, a call is about. */
export const who = {
  userId: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe(
      "The user whose data to use, such as user_42. Omit it to use the x-user-id request header.",
    ),
  branch: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe(
      "The data branch, such as main or drafts. Omit it to use the x-branch request header, or main.",
    ),
};

export const requestId = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{1,128}$/)
  .optional()
  .describe(
    "A new unique ID for this change, such as a UUID. Send the same ID again only to retry the same change: the server then applies it once and returns the first result.",
  );

/** BSON dates and 64-bit counters become plain JSON a client can read back exactly. */
export const json = publicDocument;

/** The public fields of a stored item, as REST returns them; never the internal storage identity. */
export function publicItem(item: any) {
  return json({
    id: item.id ?? item._id ?? null,
    key: item.key,
    value: item.value,
    metadata: item.metadata ?? null,
    version: item.version,
    timestamp: item.timestamp,
    lastModified: item.lastModified,
  });
}

/** A page of an in-memory list, with what the caller needs to know it is not the whole list. */
export function page<T>(all: T[], offset: number, limit: number) {
  const items = all.slice(offset, offset + limit);
  const next = offset + items.length;
  return {
    total: all.length,
    offset,
    returned: items.length,
    nextOffset: next < all.length ? next : null,
    items,
  };
}

export const paging = {
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("How many entries to skip. Pass the previous result's nextOffset to continue."),
  limit: z.number().int().min(1).max(200).default(50).describe("How many entries to return."),
};

function header(http: any, name: string): string | undefined {
  const value = http?.headers?.[name];
  return typeof value === "string" && value ? value : undefined;
}

/** An API key from `Authorization: Bearer`, `x-api-key` or, for clients that cannot send headers, `?api_key=`. */
function credential(http: any): string {
  const bearer = header(http, "authorization");
  const key = bearer?.startsWith("Bearer ")
    ? bearer.slice(7).trim()
    : (header(http, "x-api-key") ?? http?.query?.api_key);
  if (typeof key !== "string" || !key)
    throw new UnauthorizedException(
      "An API key is required: send it as the Authorization: Bearer or x-api-key header",
    );
  if (key.startsWith("ss_session.") || key.startsWith("ss_sso."))
    throw new UnauthorizedException("The MCP endpoint accepts API keys, not session tokens");
  return key;
}

/**
 * API-key authorization for MCP, by the same rules as REST and Socket.IO: every call is checked as
 * the REST request it is equivalent to, so permissions, prefixes, restrictions and quotas agree.
 */
@Injectable()
export class McpAccess {
  constructor(private readonly keys: ApiKeyGuard) {}

  private request(http: any, operation: McpOperation, userId: string, branch: string) {
    return {
      headers: {
        ...http.headers,
        "x-user-id": userId,
        "x-instance-id": header(http, "x-instance-id") ?? "mcp",
        "x-branch": branch,
      },
      method: operation.method,
      url: "/api/v1/" + operation.path,
      body: { key: operation.key },
      params: { key: operation.key },
      query: {},
      protocol: http.protocol,
      ip: http.ip,
      socket: http.socket ?? {},
      transport: "mcp",
    } as any;
  }

  /** Refuse an HTTP request without a valid key before any MCP message is read. Charges no quota. */
  async authenticate(http: any): Promise<void> {
    const request = this.request(
      http,
      { method: "GET", path: "mcp" },
      header(http, "x-user-id") ?? "mcp",
      "main",
    );
    await this.keys.authorize(request, undefined, credential(http), false);
  }

  /** Authorize one call, charge it to the key's quota and resolve whose data it uses. */
  async authorize(
    ctx: McpContext,
    operation: McpOperation,
    target: { userId?: string; branch?: string } = {},
  ): Promise<McpIdentity> {
    const http = ctx.request;
    if (!http) throw new UnauthorizedException("This server is reached over HTTP with an API key");
    const userId =
      target.userId ??
      header(http, "x-user-id") ??
      (operation.scope || operation.anonymous ? "mcp" : undefined);
    if (!userId)
      throw new BadRequestException(
        "Whose data? Pass userId, or configure the x-user-id request header in your MCP client",
      );
    const request = this.request(
      http,
      operation,
      userId,
      target.branch ?? header(http, "x-branch") ?? "main",
    );
    await this.keys.authorize(request, operation.scope, credential(http));
    // Let the HTTP metrics hook attribute this request to the key, as it does for REST.
    http.metricsIdentity ??= request.metricsIdentity;
    return {
      userId: request.storageUserId,
      instanceId: request.headers["x-instance-id"],
      apiKey: request.apiKey,
      access: request.access,
    };
  }
}

/** Guards the endpoint's HTTP route. Calls are authorized again, one by one, by `McpAccess.authorize`. */
@Injectable()
export class McpKeyGuard implements CanActivate {
  constructor(private readonly access: McpAccess) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    // A page on another site, in a user's browser, must not reach the server; clients outside a
    // browser send no Origin and pass.
    const origin = http.getRequest().headers?.origin;
    if (!originAllowed(typeof origin === "string" ? origin : undefined))
      throw new ForbiddenException("This origin is not allowed to call the MCP endpoint");
    await this.access.authenticate(http.getRequest());
    // The MCP module writes straight to the socket, which drops headers set on the Fastify reply:
    // carry the CORS headers over so browser-based clients can read the response.
    const reply = http.getResponse();
    for (const [name, value] of Object.entries(reply.getHeaders?.() ?? {}))
      if (name.startsWith("access-control-") || name === "vary")
        reply.raw.setHeader(name, value as string);
    return true;
  }
}
