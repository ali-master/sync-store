import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Database, InjectDatabase } from "../../modules/db";
import { AdminService } from "./admin.service";
import { BOOTSTRAP_KEY_ID } from "./bootstrap-key";
import { metrics } from "../metrics/metrics.service";
import { effectiveEnv } from "../settings/settings.store";

export interface SsoSession {
  email: string;
  expiresAt: number;
}

/** The callback on the public API origin, used when no redirect URI is set explicitly. */
function defaultRedirect(apiUrl: string | undefined): string {
  try {
    return apiUrl ? new URL(apiUrl).origin + "/api/v1/sso/callback" : "";
  } catch {
    return "";
  }
}

/** Read the identity provider settings; SSO stays off until every required value is present. */
export function ssoConfig(env: Record<string, string | undefined> = effectiveEnv()) {
  const list = (value?: string) =>
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  const minutes = Number(env.SSO_SESSION_MINUTES || 480);
  const config = {
    issuer: withoutTrailingSlash((env.SSO_ISSUER ?? "").trim()),
    clientId: (env.SSO_CLIENT_ID ?? "").trim(),
    clientSecret: env.SSO_CLIENT_SECRET ?? "",
    redirectUri: (env.SSO_REDIRECT_URI ?? "").trim() || defaultRedirect(env.API_URL),
    scopes: env.SSO_SCOPES || "openid email profile",
    name: env.SSO_PROVIDER_NAME || "SSO",
    emails: list(env.SSO_ALLOWED_EMAILS),
    domains: list(env.SSO_ALLOWED_DOMAINS),
    sessionMs: minutes * 60_000,
  };
  const enabled = Boolean(
    config.issuer &&
    config.clientId &&
    config.redirectUri &&
    (config.emails.length || config.domains.length),
  );
  // A half-configured provider must stop the boot instead of silently leaving SSO off.
  if (!enabled && (config.issuer || config.clientId))
    throw new Error(
      "SSO requires an issuer, a client ID, a redirect URI (or a public API URL) and allowed email addresses or domains",
    );
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440)
    throw new Error("SSO_SESSION_MINUTES must be between 1 and 1440");
  return { ...config, enabled };
}

type SsoConfig = ReturnType<typeof ssoConfig>;

/** The configuration in effect, or a disabled one when the settings are incomplete. */
export function currentSsoConfig(): SsoConfig & { error?: string } {
  try {
    return ssoConfig();
  } catch (error) {
    return { ...ssoConfig({}), enabled: false, error: (error as Error).message };
  }
}

/** Issuers are compared without their optional trailing slash. */
function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? withoutTrailingSlash(value.slice(0, -1)) : value;
}

/** Only explicitly listed addresses or domains may administer the installation. */
export function ssoAllowed(email: string, config: Pick<SsoConfig, "emails" | "domains">) {
  const value = email.toLowerCase();
  return (
    config.emails.includes(value) ||
    config.domains.includes(value.slice(value.lastIndexOf("@") + 1))
  );
}

/**
 * Validate the ID token claims and return the signed-in email address.
 * ponytail: the signature is not checked because the token arrives directly from the token
 * endpoint over TLS (OpenID Connect Core §3.1.3.7). Verify against the provider's JWKS if the
 * token is ever accepted from the browser.
 */
export function ssoIdentity(
  idToken: unknown,
  expected: { issuer: string; clientId: string; nonce: string },
  now = Date.now(),
): string {
  let claims: Record<string, any>;
  try {
    claims = JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString());
  } catch {
    throw new UnauthorizedException("The identity provider returned an invalid ID token");
  }
  const audiences = [claims.aud].flat();
  if (
    claims.iss !== expected.issuer ||
    !audiences.includes(expected.clientId) ||
    (audiences.length > 1 && claims.azp !== expected.clientId) ||
    typeof claims.exp !== "number" ||
    claims.exp * 1000 <= now ||
    claims.nonce !== expected.nonce
  )
    throw new UnauthorizedException("The identity provider's ID token failed validation");
  // Only an explicit verification counts: a provider that omits email_verified has not vouched for
  // the address, and the allow-list is only as trustworthy as the email it matches. Some providers
  // send the boolean as a string.
  if (
    typeof claims.email !== "string" ||
    !claims.email ||
    (claims.email_verified !== true && claims.email_verified !== "true")
  )
    throw new ForbiddenException("The identity provider did not return a verified email address");
  return claims.email.toLowerCase();
}

/** Issue a dashboard credential bound to the administrator secret, so rotating it signs everyone out. */
export function issueSsoSession(key: string, email: string, ttlMs: number, now = Date.now()) {
  const expiresAt = now + ttlMs;
  const body = Buffer.from(JSON.stringify({ email, expiresAt })).toString("base64url");
  return { token: `ss_sso.${body}.${signature(body, key)}`, email, expiresAt };
}

export function verifySsoSession(token: string, key: string, now = Date.now()): SsoSession {
  try {
    if (token.length > 4096) throw new Error();
    const [prefix, body, mac, extra] = token.split(".");
    const expected = Buffer.from(signature(body, key));
    const received = Buffer.from(mac);
    if (
      prefix !== "ss_sso" ||
      extra !== undefined ||
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    )
      throw new Error();
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    if (
      typeof data.email !== "string" ||
      typeof data.expiresAt !== "number" ||
      data.expiresAt <= now
    )
      throw new Error();
    return { email: data.email, expiresAt: data.expiresAt };
  } catch {
    throw new UnauthorizedException("Invalid or expired SSO session. Sign in again.");
  }
}

function signature(body: string, key: string): string {
  return createHmac("sha256", key)
    .update("sync-store-sso-session:" + body)
    .digest("base64url");
}

interface ProviderMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
}

/** OpenID Connect authorization-code sign-in for the dashboard, with PKCE, state and nonce. */
@Injectable()
export class SsoService {
  private readonly logger = new Logger("SSO");
  private discovery?: { issuer: string; metadata: Promise<ProviderMetadata> };

  /**
   * Read on every use, so a change saved in the dashboard applies at once on every replica. Saved
   * settings are validated before they are stored; an invalid environment fails the boot instead.
   */
  private get config() {
    const config = currentSsoConfig();
    if (config.error) this.logger.error(config.error);
    return config;
  }

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly admin: AdminService,
  ) {}

  status() {
    return { enabled: this.config.enabled, name: this.config.name };
  }

  /** Discover each issuer once; a failed lookup, or a changed issuer, is looked up again. */
  private metadata(): Promise<ProviderMetadata> {
    const { issuer } = this.config;
    if (this.discovery?.issuer === issuer) return this.discovery.metadata;
    const metadata = fetch(issuer + "/.well-known/openid-configuration", {
      signal: AbortSignal.timeout(10_000),
    })
      .then(async (response) => {
        const document = (await response.json()) as ProviderMetadata;
        if (
          !response.ok ||
          typeof document.issuer !== "string" ||
          withoutTrailingSlash(document.issuer) !== issuer ||
          !document.authorization_endpoint ||
          !document.token_endpoint
        )
          throw new Error("SSO discovery document does not match the configured issuer");
        return document;
      })
      .catch((error) => {
        if (this.discovery?.metadata === metadata) this.discovery = undefined;
        throw error;
      });
    this.discovery = { issuer, metadata };
    return metadata;
  }

  private requireEnabled() {
    if (!this.config.enabled) throw new NotFoundException("SSO is not configured");
  }

  /** Start a sign-in: the returned state must travel in an HttpOnly cookie on this browser. */
  async begin(): Promise<{ url: string; state: string }> {
    this.requireEnabled();
    const metadata = await this.metadata();
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const url = new URL(metadata.authorization_endpoint);
    for (const [name, value] of Object.entries({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes,
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }))
      url.searchParams.set(name, value);
    return {
      url: url.toString(),
      state: Buffer.from(JSON.stringify({ state, nonce, verifier })).toString("base64url"),
    };
  }

  complete(query: Record<string, unknown>, stateCookie: string | undefined) {
    return metrics.signIn(this.signIn(query, stateCookie));
  }

  /** Finish a sign-in: exchange the code, validate the identity and issue a dashboard session. */
  private async signIn(query: Record<string, unknown>, stateCookie: string | undefined) {
    this.requireEnabled();
    if (typeof query.error === "string")
      throw new UnauthorizedException(
        "The identity provider refused the sign-in: " + query.error.slice(0, 200),
      );
    let pending: { state: string; nonce: string; verifier: string };
    try {
      pending = JSON.parse(Buffer.from(stateCookie ?? "", "base64url").toString());
      const expected = Buffer.from(pending.state);
      const received = Buffer.from(String(query.state));
      if (expected.length !== received.length || !timingSafeEqual(expected, received))
        throw new Error();
    } catch {
      throw new UnauthorizedException("The sign-in request expired or was not started here");
    }
    if (typeof query.code !== "string" || !query.code)
      throw new UnauthorizedException("The identity provider returned no authorization code");

    const metadata = await this.metadata();
    const { clientId, clientSecret } = this.config;
    const response = await fetch(metadata.token_endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        ...(clientSecret
          ? {
              authorization:
                "Basic " +
                Buffer.from(
                  encodeURIComponent(clientId) + ":" + encodeURIComponent(clientSecret),
                ).toString("base64"),
            }
          : {}),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: query.code,
        redirect_uri: this.config.redirectUri,
        client_id: clientId,
        code_verifier: pending.verifier,
      }),
    });
    const tokens = (await response.json().catch(() => ({}))) as { id_token?: unknown };
    if (!response.ok)
      throw new UnauthorizedException("The identity provider rejected the authorization code");
    const email = ssoIdentity(tokens.id_token, {
      issuer: metadata.issuer,
      clientId,
      nonce: pending.nonce,
    });
    if (!ssoAllowed(email, this.config))
      throw new ForbiddenException(email + " is not allowed to administer this installation");
    const session = issueSsoSession(await this.administratorKey(), email, this.config.sessionMs);
    await this.admin.audit(BOOTSTRAP_KEY_ID, "admin.sso.login", email);
    return session;
  }

  /** Hand the session from the one-time cookie to the dashboard's memory. */
  async session(token: string | undefined) {
    this.requireEnabled();
    if (!token) throw new UnauthorizedException("No SSO sign-in is waiting. Sign in again.");
    return { token, ...(await this.authenticate(token)) };
  }

  /** Recheck the secret and the allow-list on every request made with an SSO session. */
  async authenticate(token: string): Promise<SsoSession & { key: string }> {
    this.requireEnabled();
    const key = await this.administratorKey();
    const session = verifySsoSession(token, key);
    if (!ssoAllowed(session.email, this.config))
      throw new ForbiddenException(
        session.email + " is not allowed to administer this installation",
      );
    return { ...session, key };
  }

  private async administratorKey(): Promise<string> {
    const record = await this.db.orm.api_keys.where({ id: BOOTSTRAP_KEY_ID }).first();
    if (!record?.isActive)
      throw new ForbiddenException("Finish installation setup before signing in with SSO");
    return record.key;
  }
}
