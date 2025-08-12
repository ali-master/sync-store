import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { Request } from "express";
import { InjectDbTransactor, type PrismaTransactor } from "@root/modules/db";
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
    @InjectDbTransactor()
    private readonly dbTransactorService: PrismaTransactor,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      throw new UnauthorizedException("API key is required");
    }

    // Validate API key exists and is active
    const apiKeyRecord = await this.dbTransactorService.tx.apiKey.findUnique({
      where: { key: apiKey },
    });

    if (!apiKeyRecord || !apiKeyRecord.isActive) {
      throw new UnauthorizedException("Invalid or inactive API key");
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
    await this.checkQuotas(apiKeyRecord);

    // Update usage statistics
    await this.updateUsageStats(apiKeyRecord.id, request);

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
    const apiKeyHeader = request.headers["x-api-key"] as string;
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
      allowedDomains: JSON.parse(apiKeyRecord.allowedDomains || "[]"),
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

    // Check country restrictions using GeoIP
    if (restrictions.countryRestrictions.length > 0) {
      try {
        const country = await this.getCountryFromIp(clientIp);
        if (country) {
          const isAllowed =
            restrictions.restrictionMode === "allow"
              ? restrictions.countryRestrictions.includes(country)
              : !restrictions.countryRestrictions.includes(country);

          if (!isAllowed) {
            throw new ForbiddenException(`Access from ${country} is not allowed`);
          }
        }
      } catch (error) {
        // Log error but don't block if GeoIP fails
        console.warn("GeoIP lookup failed:", error);
      }
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
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$", "i");
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

  private matchesIp(clientIp: string, allowedIp: string): boolean {
    // Simple IP matching - could be enhanced with CIDR support
    if (allowedIp.includes("/")) {
      // CIDR notation - simplified implementation
      const [network, prefixLength] = allowedIp.split("/");
      // This is a simplified check - in production, use a proper CIDR library
      return clientIp.startsWith(
        network
          .split(".")
          .slice(0, Math.ceil(parseInt(prefixLength) / 8))
          .join("."),
      );
    }

    return clientIp === allowedIp || allowedIp === "*";
  }

  private getClientIp(request: Request): string {
    return (request.headers["x-forwarded-for"] ||
      request.headers["x-real-ip"] ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      "127.0.0.1") as string;
  }

  private async getCountryFromIp(ip: string): Promise<string | null> {
    try {
      // This would require GeoIP database - simplified implementation
      // In production, use a proper GeoIP service or database
      if (ip === "127.0.0.1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
        return null; // Local/private IP
      }

      // Placeholder - implement actual GeoIP lookup
      return null;
    } catch {
      return null;
    }
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
      const uniqueUsers = await this.dbTransactorService.tx.syncSession.findMany({
        where: {
          ipAddress: clientIp,
          connectedAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
        select: { userId: true },
        distinct: ["userId"],
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

        const uniqueUsers = await this.dbTransactorService.tx.syncSession.findMany({
          where: {
            connectedAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
            },
          },
          select: { userId: true, userAgent: true },
          distinct: ["userId"],
        });

        // Filter by domain (simplified - would need better domain extraction)
        const domainUsers = uniqueUsers.filter((session) => session.userAgent?.includes(domain));

        if (domainUsers.length >= restrictions.maxUsersPerDomain!) {
          throw new ForbiddenException(
            `Maximum users per domain (${restrictions.maxUsersPerDomain}) exceeded`,
          );
        }
      } catch {
        // Ignore domain parsing errors
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

  private async checkQuotas(apiKeyRecord: any): Promise<void> {
    // const minute = 60 * 1000;
    // const hour = 60 * minute;
    // const day = 24 * hour;

    // Check various quota limits
    const quotaChecks = [
      { quota: apiKeyRecord.minuteQuota, usage: apiKeyRecord.currentMinuteUsage, period: "minute" },
      { quota: apiKeyRecord.hourQuota, usage: apiKeyRecord.currentHourUsage, period: "hour" },
      { quota: apiKeyRecord.dailyQuota, usage: apiKeyRecord.currentDailyUsage, period: "day" },
      {
        quota: apiKeyRecord.monthlyQuota,
        usage: apiKeyRecord.currentMonthlyUsage,
        period: "month",
      },
    ];

    for (const check of quotaChecks) {
      if (check.quota && check.usage >= check.quota) {
        throw new ForbiddenException(`${check.period} quota of ${check.quota} requests exceeded`);
      }
    }
  }

  private async updateUsageStats(apiKeyId: string, _request: Request): Promise<void> {
    const now = new Date();
    // const startTime = Date.now();

    // Update last used timestamp and increment counters
    await this.dbTransactorService.tx.apiKey.update({
      where: { id: apiKeyId },
      data: {
        lastUsedAt: now,
        totalCalls: { increment: 1 },
        successfulCalls: { increment: 1 },
        currentMinuteUsage: { increment: 1 },
        currentHourUsage: { increment: 1 },
        currentDailyUsage: { increment: 1 },
        currentMonthlyUsage: { increment: 1 },
        // Note: In a real implementation, you'd need to handle quota resets based on time periods
      },
    });

    // Record performance metrics (would be updated after response)
    // const responseTime = Date.now() - startTime;
    // This would typically be done in a response interceptor
  }
}
