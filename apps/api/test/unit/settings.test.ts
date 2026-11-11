import "reflect-metadata";
import { afterEach, expect, test } from "bun:test";
import { originAllowed } from "../../src/cors";
import { currentSsoConfig } from "../../src/domains/admin/sso.service";
import {
  normalizeSetting,
  SettingsService,
  validateEffective,
} from "../../src/domains/settings/settings.service";
import { applyOverrides, SETTINGS, setting } from "../../src/domains/settings/settings.store";

const definition = (env: string) => SETTINGS.find((item) => item.env === env)!;
const saved = { ...process.env };
afterEach(async () => {
  applyOverrides({});
  for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
  Object.assign(process.env, saved);
});

/** One settings document in memory, with the update semantics MongoDB applies. */
function fixture() {
  let document: any = null;
  const collection = {
    findOne: async () => document,
    findOneAndUpdate: async (filter: any, update: any, options: any) => {
      if (document && filter.revision !== undefined && document.revision !== filter.revision)
        return null;
      if (!document && !options.upsert) return null;
      document ??= { _id: filter._id, values: {}, revision: 0 };
      for (const [path, value] of Object.entries(update.$set ?? {}))
        if (path.startsWith("values.")) document.values[path.slice(7)] = value;
        else document[path] = value;
      for (const path of Object.keys(update.$unset ?? {})) delete document.values[path.slice(7)];
      document.revision += update.$inc.revision;
      return structuredClone(document);
    },
  };
  return {
    service: new SettingsService({ native: { collection: () => collection } } as any),
    document: () => document,
  };
}

test("the database overrides the environment, and an empty override means unset", async () => {
  process.env.CORS_ALLOWED_ORIGINS = "https://env.example";
  expect(setting("CORS_ALLOWED_ORIGINS")).toBe("https://env.example");
  applyOverrides({ CORS_ALLOWED_ORIGINS: "https://db.example", DATABASE_URL: "ignored" });
  expect(setting("CORS_ALLOWED_ORIGINS")).toBe("https://db.example");
  expect(originAllowed("https://db.example")).toBe(true);
  expect(originAllowed("https://env.example")).toBe(false);
  expect(originAllowed(undefined)).toBe(true);
  // Only dashboard settings can be overridden: infrastructure stays in the environment.
  expect(setting("DATABASE_URL")).toBe(process.env.DATABASE_URL);
  applyOverrides({ SSO_ISSUER: "" });
  process.env.SSO_ISSUER = "https://id.example";
  expect(setting("SSO_ISSUER")).toBeUndefined();
});

test("each type is validated and normalized before it is stored", async () => {
  expect(normalizeSetting(definition("API_URL"), " https://sync.example.com/ ")).toBe(
    "https://sync.example.com",
  );
  expect(normalizeSetting(definition("SSO_ALLOWED_DOMAINS"), " a.com ,, b.com ")).toBe(
    "a.com, b.com",
  );
  expect(normalizeSetting(definition("HISTORY_RETENTION_DAYS"), 45)).toBe("45");
  expect(normalizeSetting(definition("SSO_ISSUER"), "")).toBe("");
  for (const [env, value] of [
    ["API_URL", "ftp://example.com"],
    ["API_URL", "https://user:pass@example.com"],
    ["API_URL", "not a url"],
    ["HISTORY_RETENTION_DAYS", "0"],
    ["HISTORY_RETENTION_DAYS", "3651"],
    ["HISTORY_RETENTION_DAYS", "1.5"],
    ["HISTORY_RETENTION_DAYS", ""],
    ["SSO_PROVIDER_NAME", "x".repeat(41)],
    ["METRICS_TOKEN", "short"],
    ["SSO_CLIENT_ID", "line\nbreak"],
    ["SSO_CLIENT_ID", { $ne: null }],
  ] as const)
    expect(() => normalizeSetting(definition(env), value), `${env}=${String(value)}`).toThrow();
  expect(() => validateEffective({ CORS_ALLOWED_ORIGINS: "https://a.com/path" })).toThrow();
  expect(() => validateEffective({ SSO_ISSUER: "https://id.example" })).toThrow("SSO requires");
});

test("the redirect URI defaults to the public API origin", async () => {
  applyOverrides({
    API_URL: "https://sync.example.com/api",
    SSO_ISSUER: "https://id.example",
    SSO_CLIENT_ID: "console",
    SSO_ALLOWED_DOMAINS: "example.com",
  });
  expect(currentSsoConfig()).toMatchObject({
    enabled: true,
    redirectUri: "https://sync.example.com/api/v1/sso/callback",
  });
  applyOverrides({ SSO_ISSUER: "https://id.example" });
  expect(currentSsoConfig()).toMatchObject({
    enabled: false,
    error: expect.stringContaining("SSO"),
  });
});

test("updates are saved, secrets are never returned and stale revisions are refused", async () => {
  const f = fixture();
  await f.service.refresh();
  const first = await f.service.update(
    {
      values: {
        API_URL: "https://sync.example.com",
        SSO_ISSUER: "https://id.example",
        SSO_CLIENT_ID: "console",
        SSO_CLIENT_SECRET: "top-secret",
        SSO_ALLOWED_EMAILS: "owner@example.com",
      },
      revision: 0,
    },
    "admin",
  );
  expect(first.revision).toBe(1);
  expect(f.document().values.SSO_CLIENT_SECRET).toBe("top-secret");
  expect(JSON.stringify(first)).not.toContain("top-secret");
  const secret = first.settings.find((item) => item.env === "SSO_CLIENT_SECRET")!;
  expect(secret).toMatchObject({ set: true, value: null, source: "database" });
  expect(first.settings.find((item) => item.env === "API_URL")).toMatchObject({
    value: "https://sync.example.com",
    source: "database",
  });
  expect(currentSsoConfig().enabled).toBe(true);

  // A half-configured provider is refused before anything is written.
  await expect(f.service.update({ values: { SSO_ALLOWED_EMAILS: "" } }, "admin")).rejects.toThrow(
    "SSO requires",
  );
  expect(f.document().values.SSO_ALLOWED_EMAILS).toBe("owner@example.com");

  await expect(
    f.service.update({ values: { API_URL: "https://other.example" }, revision: 0 }, "admin"),
  ).rejects.toThrow("changed since");

  // null removes the override, so the environment applies again.
  process.env.HISTORY_RETENTION_DAYS = "30";
  await f.service.update({ values: { HISTORY_RETENTION_DAYS: "90" } }, "admin");
  expect(setting("HISTORY_RETENTION_DAYS")).toBe("90");
  await f.service.update({ values: { HISTORY_RETENTION_DAYS: null } }, "admin");
  expect(setting("HISTORY_RETENTION_DAYS")).toBe("30");
  expect(
    f.service.view().settings.find((item) => item.env === "HISTORY_RETENTION_DAYS"),
  ).toMatchObject({ source: "environment", value: "30" });

  for (const body of [null, { values: {} }, { values: { DATABASE_URL: "x" } }, { values: [] }])
    await expect(f.service.update(body, "admin")).rejects.toThrow();
});
