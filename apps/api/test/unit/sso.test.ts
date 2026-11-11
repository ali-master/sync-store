import "reflect-metadata";
import { afterEach, expect, test } from "bun:test";
import {
  issueSsoSession,
  ssoAllowed,
  ssoConfig,
  ssoIdentity,
  SsoService,
  verifySsoSession,
} from "../../src/domains/admin/sso.service";
import { AdminGuard } from "../../src/domains/admin/admin.guard";

const env = {
  SSO_ISSUER: "https://id.example/",
  SSO_CLIENT_ID: "console",
  SSO_CLIENT_SECRET: "secret",
  SSO_REDIRECT_URI: "https://sync.example/api/v1/sso/callback",
  SSO_ALLOWED_DOMAINS: "Example.com",
  SSO_ALLOWED_EMAILS: "owner@partner.dev",
};
const idToken = (claims: object) =>
  "header." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".signature";
const claims = (overrides: object = {}) => ({
  iss: "https://id.example/",
  aud: "console",
  exp: 2000,
  nonce: "n",
  email: "Ada@Example.com",
  email_verified: true,
  ...overrides,
});
const expected = { issuer: "https://id.example/", clientId: "console", nonce: "n" };

const realFetch = globalThis.fetch;
afterEach(async () => {
  globalThis.fetch = realFetch;
  for (const name of Object.keys(env)) delete process.env[name];
});

test("configuration is off by default and refuses a half-configured provider", async () => {
  expect(ssoConfig({}).enabled).toBe(false);
  expect(ssoConfig(env)).toMatchObject({ enabled: true, issuer: "https://id.example" });
  expect(() => ssoConfig({ ...env, SSO_ALLOWED_DOMAINS: "", SSO_ALLOWED_EMAILS: "" })).toThrow(
    "SSO requires",
  );
  expect(() => ssoConfig({ ...env, SSO_REDIRECT_URI: "" })).toThrow("SSO requires");
  expect(() => ssoConfig({ ...env, SSO_SESSION_MINUTES: "0" })).toThrow("SSO_SESSION_MINUTES");
});

test("only allow-listed addresses and exact domains may sign in", async () => {
  const config = ssoConfig(env);
  expect(ssoAllowed("ada@example.com", config)).toBe(true);
  expect(ssoAllowed("OWNER@partner.dev", config)).toBe(true);
  expect(ssoAllowed("other@partner.dev", config)).toBe(false);
  expect(ssoAllowed("ada@evil-example.com", config)).toBe(false);
  expect(ssoAllowed("example.com@evil.dev", config)).toBe(false);
});

test("ID token claims must match the issuer, client, nonce, expiry and a verified email", async () => {
  expect(ssoIdentity(idToken(claims()), expected, 1000)).toBe("ada@example.com");
  expect(ssoIdentity(idToken(claims({ aud: ["console"] })), expected, 1000)).toBe(
    "ada@example.com",
  );
  for (const bad of [
    { iss: "https://evil.example/" },
    { aud: "another-client" },
    { aud: ["console", "other"] },
    { nonce: "replayed" },
    { exp: 1 },
    { exp: "2000" },
    { email: undefined },
    { email_verified: false },
    { email_verified: "false" },
  ])
    expect(() => ssoIdentity(idToken(claims(bad)), expected, 1000)).toThrow();
  expect(() => ssoIdentity("not-a-token", expected, 1000)).toThrow("invalid ID token");
  expect(() => ssoIdentity(undefined, expected, 1000)).toThrow("invalid ID token");
});

test("sessions expire, resist tampering and do not survive administrator key rotation", async () => {
  const session = issueSsoSession("admin-secret", "ada@example.com", 60_000, 1000);
  expect(verifySsoSession(session.token, "admin-secret", 1001)).toEqual({
    email: "ada@example.com",
    expiresAt: 61_000,
  });
  expect(() => verifySsoSession(session.token, "admin-secret", 61_000)).toThrow("expired");
  expect(() => verifySsoSession(session.token, "rotated", 1001)).toThrow("Invalid");
  const [, , mac] = session.token.split(".");
  const forged = Buffer.from(
    JSON.stringify({ email: "eve@example.com", expiresAt: 9e15 }),
  ).toString("base64url");
  expect(() => verifySsoSession(`ss_sso.${forged}.${mac}`, "admin-secret", 1001)).toThrow();
  expect(() => verifySsoSession("ss_admin_plain", "admin-secret", 1001)).toThrow();
});

/** Model the provider's discovery and token endpoints and the stored administrator. */
function fixture(tokenClaims: (nonce: string) => object) {
  Object.assign(process.env, env);
  const admin = { id: "sync-store-bootstrap-admin", key: "ss_admin_secret", isActive: true };
  const audits: string[] = [];
  const requests: { url: string; init?: RequestInit }[] = [];
  let nonce = "";
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/.well-known/openid-configuration"))
      return Response.json({
        issuer: "https://id.example/",
        authorization_endpoint: "https://id.example/authorize",
        token_endpoint: "https://id.example/token",
      });
    return Response.json({ id_token: idToken(tokenClaims(nonce)) });
  }) as typeof fetch;
  const service = new SsoService(
    { orm: { api_keys: { where: () => ({ first: async () => admin }) } } } as any,
    {
      audit: async (_: string, action: string, target: string) => audits.push(action + target),
    } as any,
  );
  return {
    service,
    admin,
    audits,
    requests,
    async begin() {
      const started = await service.begin();
      const url = new URL(started.url);
      nonce = url.searchParams.get("nonce")!;
      return { ...started, url };
    },
  };
}

test("a full sign-in uses PKCE, issues an administrator session and audits the person", async () => {
  const f = fixture((nonce) => claims({ nonce, exp: Date.now() / 1000 + 60 }));
  const { url, state } = await f.begin();
  expect(url.origin + url.pathname).toBe("https://id.example/authorize");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("redirect_uri")).toBe(env.SSO_REDIRECT_URI);
  const query = { code: "code", state: url.searchParams.get("state")! };

  await expect(f.service.complete(query, undefined)).rejects.toThrow("expired or was not started");
  await expect(f.service.complete({ ...query, state: "forged" }, state)).rejects.toThrow();
  await expect(f.service.complete({ error: "access_denied" }, state)).rejects.toThrow(
    "access_denied",
  );

  const session = await f.service.complete(query, state);
  const exchange = f.requests.at(-1)!;
  expect(exchange.url).toBe("https://id.example/token");
  expect(String(exchange.init!.body)).toContain("code_verifier=");
  expect((exchange.init!.headers as any).authorization).toStartWith("Basic ");
  expect(f.audits).toEqual(["admin.sso.loginada@example.com"]);
  expect(JSON.stringify(session)).not.toContain(f.admin.key);

  expect(await f.service.session(session.token)).toMatchObject({ email: "ada@example.com" });
  await expect(f.service.session(undefined)).rejects.toThrow("Sign in again");

  // The guard swaps the session for the stored administrator credential, server-side only.
  const calls: unknown[][] = [];
  const guard = new AdminGuard(
    { authorize: async (...args: unknown[]) => calls.push(args) > 0 } as any,
    f.service,
  );
  const context = (authorization?: string) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }) }) as any;
  expect(await guard.canActivate(context("Bearer " + session.token))).toBe(true);
  expect(calls[0].slice(1)).toEqual(["admin", f.admin.key]);
  expect(await guard.canActivate(context("Bearer ss_admin_other"))).toBe(true);
  expect(calls[1].slice(1)).toEqual(["admin"]);
  await expect(guard.canActivate(context())).rejects.toThrow("Bearer key is required");

  f.admin.key = "ss_admin_rotated";
  await expect(guard.canActivate(context("Bearer " + session.token))).rejects.toThrow("Invalid");
});

test("people outside the allow-list and unfinished installations are refused", async () => {
  const outsider = fixture((nonce) =>
    claims({ nonce, exp: Date.now() / 1000 + 60, email: "eve@evil.dev" }),
  );
  let started = await outsider.begin();
  await expect(
    outsider.service.complete(
      { code: "code", state: started.url.searchParams.get("state")! },
      started.state,
    ),
  ).rejects.toThrow("eve@evil.dev is not allowed");
  expect(outsider.audits).toEqual([]);

  const unfinished = fixture((nonce) => claims({ nonce, exp: Date.now() / 1000 + 60 }));
  unfinished.admin.isActive = false;
  started = await unfinished.begin();
  await expect(
    unfinished.service.complete(
      { code: "code", state: started.url.searchParams.get("state")! },
      started.state,
    ),
  ).rejects.toThrow("Finish installation setup");
});

test("SSO endpoints do not exist until a provider is configured", async () => {
  const service = new SsoService({} as any, {} as any);
  expect(service.status()).toEqual({ enabled: false, name: "SSO" });
  await expect(service.begin()).rejects.toThrow("not configured");
  await expect(service.authenticate("ss_sso.a.b")).rejects.toThrow("not configured");
});
