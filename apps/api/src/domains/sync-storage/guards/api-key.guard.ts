import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { Request } from "express";
import { Reflector } from "@nestjs/core";
import type { Socket } from "socket.io";
import { BlockList, isIP } from "node:net";
import { InjectDatabase, type Database } from "@root/modules/db";
import { quotaConsumption } from "../services/quota-window";
import { socketProxyIdentity } from "@root/trusted-proxy";
// import * as geoip from 'maxmind'; // TODO: Add GeoIP dependency if needed

interface ApiKeyRestrictions {
  allowedKeyPatterns: string[];
  blockedKeyPatterns: string[];
  allowedDomains: string[];
  ipRestrictions: string[];
  countryRestrictions: string[];
  restrictionMode: "allow" | "deny";
  maxUsersPerIp?: number;
  maxUsersPerDomain?: number;
  requireHttps: boolean;
  allowedMethods: string[];
  allowedUserAgents: string[];
  blockedUserAgents: string[];
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @InjectDatabase()
    private readonly database: Database,
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() === "ws") {
      const ws = context.switchToWs();
      const client = ws.getClient<Socket>();
      if (!client.data.identity) throw new UnauthorizedException("Unauthenticated socket");
      const event = context.getHandler().name;
      const method =
        event === "handleSetItem"
          ? "PUT"
          : event === "handleRemoveItem" || event === "handleClear"
            ? "DELETE"
            : "GET";
      return this.authorizeSocket(client, method, ws.getData());
    }
    const request = context.switchToHttp().getRequest<Request>();
    return this.authorize(
      request,
      this.reflector.getAllAndOverride<string>("required-api-key-scope", [
        context.getHandler(),
        context.getClass(),
      ]),
    );
  }

  /** Apply the same API-key restrictions to socket connections and each storage operation. */
  async authorizeSocket(client: Socket, method = "GET", body: any = {}): Promise<boolean> {
    const auth = client.handshake.auth;
    const userId = client.data.identity?.userId ?? auth.userId ?? client.handshake.query.userId;
    const instanceId =
      client.data.identity?.instanceId ?? auth.instanceId ?? client.handshake.query.instanceId;
    if (typeof userId !== "string" || !userId || typeof instanceId !== "string" || !instanceId) {
      throw new UnauthorizedException("User and instance identifiers are required");
    }
    const apiKey =
      auth.apiKey ?? client.handshake.query["api-key"] ?? client.handshake.query.apiKey;
    const proxy = socketProxyIdentity(
      client.handshake.address,
      client.handshake.secure,
      client.handshake.headers,
    );
    const request = {
      headers: {
        ...client.handshake.headers,
        "x-api-key": apiKey,
        "x-user-id": userId,
        "x-instance-id": instanceId,
      },
      method,
      body,
      params: { key: body?.key },
      query: {},
      protocol: proxy.protocol,
      ip: proxy.ip,
      socket: { remoteAddress: client.handshake.address },
    } as unknown as Request;
    await this.authorize(request);
    client.data.identity = { userId, instanceId };
    return true;
  }

  /** Reject missing identities and enforce read/write permissions before touching storage. */
  async authorize(request: Request, requiredScope?: string): Promise<boolean> {
    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      throw new UnauthorizedException("API key is required");
    }

    // Validate API key exists and is active
    const apiKeyRecord = await this.database.orm.api_keys.where({ key: apiKey }).first();

    if (!apiKeyRecord || !apiKeyRecord.isActive) {
      throw new UnauthorizedException("Invalid or inactive API key");
    }
    if (requiredScope) {
      const scopes = JSON.parse(apiKeyRecord.scopes || "[]");
      if (!Array.isArray(scopes) || (!scopes.includes(requiredScope) && !scopes.includes("*"))) {
        throw new ForbiddenException("Required API key scope: " + requiredScope);
      }
    }

    const userId = request.headers["x-user-id"] ?? request.headers["user-id"];
    const instanceId = request.headers["x-instance-id"] ?? request.headers["instance-id"];
    if (typeof userId !== "string" || !userId || typeof instanceId !== "string" || !instanceId) {
      throw new UnauthorizedException("User and instance identifiers are required");
    }
    const reading = request.method === "GET" || request.method === "HEAD";
    if (reading ? !apiKeyRecord.canRead : !apiKeyRecord.canWrite) {
      throw new ForbiddenException(
        reading ? "Read permission is required" : "Write permission is required",
      );
    }

    // Check expiration
    if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
      throw new UnauthorizedException("API key has expired");
    }

    // Parse restrictions
    const restrictions = this.parseRestrictions(apiKeyRecord);

    // Validate all restrictions
    await this.validateRestrictions(request, restrictions, apiKeyRecord.id);

    // Check rate limits and quotas
    await this.consumeQuota(apiKeyRecord.id);

    // Update usage statistics

    // Store API key info in request context
    (request as any).apiKey = apiKeyRecord;

    return true;
  }

  private extractApiKey(request: Request): string | null {
    // Check Authorization header (Bearer token)
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }

    // Check X-API-Key header
    const apiKeyHeader = (request.headers["x-api-key"] ?? request.headers["api-key"]) as string;
    if (apiKeyHeader) {
      return apiKeyHeader;
    }

    // Check query parameter
    const apiKeyQuery = request.query["api_key"] as string;
    if (apiKeyQuery) {
      return apiKeyQuery;
    }

    return null;
  }

  private parseRestrictions(apiKeyRecord: any): ApiKeyRestrictions {
    return {
      allowedKeyPatterns: JSON.parse(apiKeyRecord.allowedKeyPatterns || "[]"),
      blockedKeyPatterns: JSON.parse(apiKeyRecord.blockedKeyPatterns || "[]"),
      allowedDomains: JSON.parse(apiKeyRecord.websiteOrigins || "[]"),
      ipRestrictions: JSON.parse(apiKeyRecord.ipRestrictions || "[]"),
      countryRestrictions: JSON.parse(apiKeyRecord.countryRestrictions || "[]"),
      restrictionMode: apiKeyRecord.restrictionMode || "allow",
      maxUsersPerIp: apiKeyRecord.maxUsersPerIp,
      maxUsersPerDomain: apiKeyRecord.maxUsersPerDomain,
      requireHttps: apiKeyRecord.requireHttps || false,
      allowedMethods: JSON.parse(apiKeyRecord.allowedMethods || '["GET", "POST"]'),
      allowedUserAgents: JSON.parse(apiKeyRecord.allowedUserAgents || "[]"),
      blockedUserAgents: JSON.parse(apiKeyRecord.blockedUserAgents || "[]"),
    };
  }

  private async validateRestrictions(
    request: Request,
    restrictions: ApiKeyRestrictions,
    apiKeyId: string,
  ): Promise<void> {
    // Check HTTPS requirement
    if (restrictions.requireHttps && request.protocol !== "https") {
      throw new ForbiddenException("HTTPS is required for this API key");
    }

    // Check HTTP methods
    if (
      restrictions.allowedMethods.length > 0 &&
      !restrictions.allowedMethods.includes(request.method)
    ) {
      throw new ForbiddenException(`HTTP method ${request.method} is not allowed for this API key`);
    }

    // Check user agent restrictions
    const userAgent = request.headers["user-agent"] || "";
    if (restrictions.blockedUserAgents.length > 0) {
      for (const pattern of restrictions.blockedUserAgents) {
        if (this.matchesPattern(userAgent, pattern)) {
          throw new ForbiddenException("User agent is blocked");
        }
      }
    }

    if (restrictions.allowedUserAgents.length > 0) {
      const isAllowed = restrictions.allowedUserAgents.some((pattern) =>
        this.matchesPattern(userAgent, pattern),
      );
      if (!isAllowed) {
        throw new ForbiddenException("User agent is not allowed");
      }
    }

    // Check domain restrictions
    const origin = request.headers.origin || request.headers.referer || "";
    if (restrictions.allowedDomains.length > 0) {
      const isAllowed = restrictions.allowedDomains.some((domain) =>
        this.matchesDomain(origin, domain),
      );
      if (!isAllowed) {
        throw new ForbiddenException("Domain is not allowed");
      }
    }

    // Check IP restrictions
    const clientIp = this.getClientIp(request);
    if (restrictions.ipRestrictions.length > 0) {
      const isAllowed =
        restrictions.restrictionMode === "allow"
          ? restrictions.ipRestrictions.some((ip) => this.matchesIp(clientIp, ip))
          : !restrictions.ipRestrictions.some((ip) => this.matchesIp(clientIp, ip));

      if (!isAllowed) {
        throw new ForbiddenException("IP address is not allowed");
      }
    }

    if (restrictions.countryRestrictions.length > 0) {
      throw new ForbiddenException("Country restrictions require a configured GeoIP provider");
    }

    // Check user limits per IP and domain
    if (restrictions.maxUsersPerIp || restrictions.maxUsersPerDomain) {
      await this.checkUserLimits(request, restrictions, apiKeyId);
    }

    // Check key pattern restrictions for storage keys
    const storageKey = this.extractStorageKey(request);
    if (storageKey) {
      await this.validateKeyPatterns(storageKey, restrictions);
    }
  }

  private matchesPattern(value: string, pattern: string): boolean {
    // Convert wildcard pattern to regex
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const regex = new RegExp("^" + escaped + "$", "i");
    return regex.test(value);
  }

  private matchesDomain(origin: string, allowedDomain: string): boolean {
    if (!origin) return false;

    try {
      const url = new URL(origin);
      const hostname = url.hostname;

      // Support wildcard domains like *.example.com
      if (allowedDomain.startsWith("*")) {
        const domain = allowedDomain.substring(1);
        return hostname.endsWith(domain);
      }

      return hostname === allowedDomain;
    } catch {
      return false;
    }
  }

  /** Match actual CIDR boundaries instead of accepting addresses with a similar text prefix. */
  private matchesIp(clientIp: string, allowedIp: string): boolean {
    if (allowedIp === "*") return true;
    const address = clientIp.replace(/^::ffff:/, "");
    const family = isIP(address);
    if (!family) return false;
    if (!allowedIp.includes("/")) return address === allowedIp;
    const [network, prefix] = allowedIp.split("/");
    const type = family === 4 ? "ipv4" : "ipv6";
    const bits = Number(prefix);
    if (
      isIP(network) !== family ||
      !Number.isInteger(bits) ||
      bits < 0 ||
      bits > (family === 4 ? 32 : 128)
    )
      return false;
    const list = new BlockList();
    list.addSubnet(network, bits, type);
    return list.check(address, type);
  }

  private getClientIp(request: Request): string {
    return (request.ip ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      "127.0.0.1") as string;
  }

  private async checkUserLimits(
    request: Request,
    restrictions: ApiKeyRestrictions,
    _apiKeyId: string,
  ): Promise<void> {
    const clientIp = this.getClientIp(request);
    const origin = request.headers.origin || "";

    if (restrictions.maxUsersPerIp) {
      // Count unique users from this IP in the last 24 hours
      const uniqueUsers = await this.database.native
        .collection("sync_sessions")
        .distinct("userId", {
          ipAddress: clientIp,
          connectedAt: { $gte: new Date(Date.now() - 86_400_000) },
        });

      if (uniqueUsers.length >= restrictions.maxUsersPerIp) {
        throw new ForbiddenException(
          `Maximum users per IP (${restrictions.maxUsersPerIp}) exceeded`,
        );
      }
    }

    if (restrictions.maxUsersPerDomain && origin) {
      try {
        const domain = new URL(origin).hostname;

        const uniqueUsers = await this.database.native
          .collection("sync_sessions")
          .find(
            {
              connectedAt: { $gte: new Date(Date.now() - 86_400_000) },
            },
            { projection: { userId: 1, userAgent: 1 } },
          )
          .toArray();

        // Filter by domain (simplified - would need better domain extraction)
        const domainUsers = uniqueUsers.filter((session) => session.userAgent?.includes(domain));

        if (domainUsers.length >= restrictions.maxUsersPerDomain!) {
          throw new ForbiddenException(
            `Maximum users per domain (${restrictions.maxUsersPerDomain}) exceeded`,
          );
        }
      } catch (error) {
        if (error instanceof ForbiddenException) throw error;
        throw new ForbiddenException("Invalid origin");
      }
    }
  }

  private extractStorageKey(request: Request): string | null {
    // Extract key from URL params or body
    const key = request.params?.key || request.body?.key;
    return key || null;
  }

  private async validateKeyPatterns(
    storageKey: string,
    restrictions: ApiKeyRestrictions,
  ): Promise<void> {
    // Check blocked patterns first
    if (restrictions.blockedKeyPatterns.length > 0) {
      for (const pattern of restrictions.blockedKeyPatterns) {
        if (this.matchesPattern(storageKey, pattern)) {
          throw new ForbiddenException(
            `Storage key '${storageKey}' matches blocked pattern '${pattern}'`,
          );
        }
      }
    }

    // Check allowed patterns
    if (restrictions.allowedKeyPatterns.length > 0) {
      const isAllowed = restrictions.allowedKeyPatterns.some((pattern) =>
        this.matchesPattern(storageKey, pattern),
      );
      if (!isAllowed) {
        throw new ForbiddenException(
          `Storage key '${storageKey}' does not match any allowed patterns`,
        );
      }
    }
  }

  /** Checks all quotas and increments counters in one atomic document update. */
  private async consumeQuota(apiKeyId: string): Promise<void> {
    const { filter, update } = quotaConsumption();
    const result = await this.database.native.collection<{ _id: string }>("api_keys").updateOne(
      {
        _id: apiKeyId,
        isActive: true,
        ...filter,
      },
      update,
    );
    if (result.matchedCount !== 1)
      throw new ForbiddenException("API key quota exceeded or key disabled");
  }
}
